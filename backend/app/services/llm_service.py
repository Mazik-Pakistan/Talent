"""Shared LLM client — OpenAI-compatible endpoint with optional Gemini fallback.

Uses the provider configured via OPENROUTER_* env vars (OpenRouter, OmniRoute,
LiteLLM, LocalAI, etc.). Falls back to direct Gemini only if the primary
provider is unavailable and GEMINI_API_KEY is present.
"""

from __future__ import annotations

import json
import re
from typing import Any

import httpx
from loguru import logger

from app.core.config import settings

# OpenRouter 402 often says: "You requested up to 4096 tokens, but can only afford 2506."
_AFFORD_RE = re.compile(r"can only afford\s+(\d+)", re.IGNORECASE)


def llm_configured() -> bool:
    or_key = (settings.OPENROUTER_API_KEY or "").strip()
    gem_key = (settings.GEMINI_API_KEY or "").strip()
    return bool(or_key) or (bool(gem_key) and not gem_key.startswith("YOUR_"))


def _openrouter_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.OPENROUTER_API_KEY.strip()}",
        "Content-Type": "application/json",
        "HTTP-Referer": (settings.FRONTEND_URL or "http://localhost:3000").rstrip("/"),
        "X-Title": settings.APP_NAME or "TalentAI",
    }


def _default_max_tokens() -> int:
    return settings.OPENROUTER_MAX_TOKENS


def _affordable_tokens_from_error(text: str, *, requested: int) -> int | None:
    """Parse OpenRouter 402 'can only afford N' and return a safe retry budget.

    Must never return more than N (previous bug: floor of 256 broke retries when
    affordability was 201).
    """
    match = _AFFORD_RE.search(text or "")
    if not match:
        return None
    try:
        afford = int(match.group(1))
    except ValueError:
        return None
    # Leave a tiny headroom; never exceed what they can afford or what we asked.
    budget = min(requested, max(0, afford - 8))
    if budget < 64:
        return None  # too low for useful JSON — don't burn another failed call
    return budget


def _gemini_key_usable() -> bool:
    gem_key = (settings.GEMINI_API_KEY or "").strip()
    if not gem_key or gem_key.startswith("YOUR_"):
        return False
    # Standard keys: AIza… · Auth keys (AI Studio default now): AQ.…
    if (gem_key.startswith("AIza") or gem_key.startswith("AQ.")) and len(gem_key) >= 20:
        return True
    logger.warning(
        "GEMINI_API_KEY does not look like a Google AI Studio key (expected AIza… or AQ.…). "
        "Get one from https://aistudio.google.com/apikey"
    )
    return False


async def call_llm_json(
    prompt: str,
    *,
    timeout: float = 60.0,
    max_tokens: int | None = None,
    temperature: float | None = None,
) -> dict | None:
    """Send a prompt and parse a JSON object response. Returns None on failure."""
    if (settings.OPENROUTER_API_KEY or "").strip():
        result = await _call_openrouter_json(
            prompt, timeout=timeout, max_tokens=max_tokens, temperature=temperature
        )
        if result is not None:
            return result
        logger.warning("Primary LLM provider failed; trying Gemini fallback if configured.")

    if _gemini_key_usable():
        return await _call_gemini_json(prompt, timeout=timeout)
    return None


async def _call_openrouter_json(
    prompt: str,
    *,
    timeout: float,
    max_tokens: int | None = None,
    temperature: float | None = None,
) -> dict | None:
    model = settings.OPENROUTER_MODEL.strip()
    actual_tokens = max_tokens if max_tokens is not None else _default_max_tokens()
    actual_temp = temperature if temperature is not None else 0.2

    # First attempt, then one retry if OpenRouter says we can't afford max_tokens.
    for attempt_tokens in (actual_tokens, None):
        tokens = attempt_tokens if attempt_tokens is not None else actual_tokens
        payload: dict[str, Any] = {
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": "You are a precise API. Always respond with a single valid JSON object only — no markdown fences.",
                },
                {"role": "user", "content": prompt},
            ],
            "temperature": actual_temp,
            "max_tokens": tokens,
            "stream": False,
        }
        try:
            # Connect/write stay short; read must cover OmniRoute routing + slow models.
            http_timeout = httpx.Timeout(timeout, connect=10.0)
            async with httpx.AsyncClient(timeout=http_timeout) as client:
                response = await client.post(
                    settings.OPENROUTER_BASE_URL, headers=_openrouter_headers(), json=payload
                )
                result = _process_openrouter_response(response, model)
                if result is not None:
                    return result

                # 402 retry: OpenRouter credit-limit — reduce tokens and retry once.
                if response.status_code == 402 and attempt_tokens is not None:
                    affordable = _affordable_tokens_from_error(response.text[:500], requested=tokens)
                    if affordable and affordable < tokens:
                        logger.warning(
                            "LLM provider credit limit: retrying with max_tokens={} (was {})",
                            affordable,
                            tokens,
                        )
                        actual_tokens = affordable
                        continue
                    logger.error(
                        "LLM provider credits nearly exhausted. "
                        "Add credits at https://openrouter.ai/settings/credits"
                    )
                return None
        except httpx.TimeoutException as exc:
            logger.error(
                "LLM call timed out after {}s ({}). url={} model={}",
                timeout,
                type(exc).__name__,
                settings.OPENROUTER_BASE_URL,
                model,
            )
            return None
        except Exception as exc:
            logger.error(
                "LLM call failed: {}: {} url={} model={}",
                type(exc).__name__,
                exc or repr(exc),
                settings.OPENROUTER_BASE_URL,
                model,
            )
            return None
    return None


def _process_openrouter_response(response: httpx.Response, model: str) -> dict | None:
    """Parse and validate an OpenAI-compatible Chat Completions response.

    Logs detailed diagnostic information on any failure.
    Returns the parsed JSON dict on success, None on any error.
    """
    raw_body = response.text
    headers = dict(response.headers)
    status = response.status_code

    if status != 200:
        logger.error(
            "LLM call failed: status={} url={} model={} headers={} body={}",
            status,
            settings.OPENROUTER_BASE_URL,
            model,
            headers,
            raw_body[:1000],
        )
        return None

    if not raw_body or not raw_body.strip():
        logger.error(
            "LLM call returned 200 with empty body. url={} model={} headers={}",
            settings.OPENROUTER_BASE_URL,
            model,
            headers,
        )
        return None

    content_type = headers.get("content-type", "")
    if "application/json" not in content_type and "text/json" not in content_type:
        logger.warning(
            "LLM call returned 200 with unexpected Content-Type: {} url={} model={} body={}",
            content_type,
            settings.OPENROUTER_BASE_URL,
            model,
            raw_body[:500],
        )
        # Continue trying to parse — some providers omit the content-type header.

    try:
        data = json.loads(raw_body)
    except json.JSONDecodeError:
        logger.error(
            "LLM call returned 200 with non-JSON body. url={} model={} content-type={} body={}",
            settings.OPENROUTER_BASE_URL,
            model,
            content_type,
            raw_body[:1000],
        )
        return None

    try:
        text = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        logger.error(
            "LLM call returned 200 with unexpected structure. url={} model={} data={}",
            settings.OPENROUTER_BASE_URL,
            model,
            json.dumps(data, default=str)[:500],
        )
        return None

    routed_model = data.get("model") or model
    usage = data.get("usage") or {}
    if usage:
        logger.info(
            "LLM usage requested={} routed={} prompt_tokens={} completion_tokens={} total={}",
            model,
            routed_model,
            usage.get("prompt_tokens"),
            usage.get("completion_tokens"),
            usage.get("total_tokens"),
        )

    result = _parse_json_content(text)
    if result is None:
        logger.warning(
            "LLM response could not be parsed as JSON. url={} model={} text={}",
            settings.OPENROUTER_BASE_URL,
            model,
            text[:500],
        )
    return result


async def _call_gemini_json(prompt: str, *, timeout: float) -> dict | None:
    model = settings.GEMINI_MODEL.strip()
    url = f"{settings.GEMINI_BASE_URL}/{model}:generateContent"
    api_key = settings.GEMINI_API_KEY.strip()
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json"},
    }
    # Auth keys (AQ.…) require x-goog-api-key; query ?key= often returns 401.
    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": api_key,
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, headers=headers, json=payload)
            raw_body = response.text
            headers_dict = dict(response.headers)
            status = response.status_code

            if status != 200:
                logger.error(
                    "Gemini call failed: status={} url={} model={} headers={} body={}",
                    status,
                    url,
                    model,
                    headers_dict,
                    raw_body[:500],
                )
                return None

            if not raw_body or not raw_body.strip():
                logger.error(
                    "Gemini call returned 200 with empty body. url={} model={}",
                    url,
                    model,
                )
                return None

            try:
                data = json.loads(raw_body)
            except json.JSONDecodeError:
                logger.error(
                    "Gemini call returned 200 with non-JSON body. url={} model={} body={}",
                    url,
                    model,
                    raw_body[:500],
                )
                return None

            try:
                text = data["candidates"][0]["content"]["parts"][0]["text"]
            except (KeyError, IndexError, TypeError):
                logger.error(
                    "Gemini call returned 200 with unexpected structure. url={} model={} data={}",
                    url,
                    model,
                    json.dumps(data, default=str)[:500],
                )
                return None

            result = _parse_json_content(text)
            if result is None:
                logger.warning(
                    "Gemini response could not be parsed as JSON. url={} model={} text={}",
                    url,
                    model,
                    text[:500],
                )
            return result
    except Exception as exc:
        logger.error(
            "Gemini call raised: {} url={} model={}",
            exc,
            url,
            model,
        )
        return None


def _parse_json_content(text: str) -> dict | None:
    if not text:
        return None
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()
    try:
        parsed = json.loads(cleaned)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start >= 0 and end > start:
            try:
                parsed = json.loads(cleaned[start : end + 1])
                return parsed if isinstance(parsed, dict) else None
            except json.JSONDecodeError:
                return None
        return None

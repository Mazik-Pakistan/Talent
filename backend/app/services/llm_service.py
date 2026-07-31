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


_JSON_SYSTEM = (
    "You are a precise API. Output a single JSON object. "
    "Never write explanations, analysis, or chain-of-thought — JSON only."
)
_JSON_SYSTEM_COMPACT = (
    "JSON API only. Continue the JSON object that was started. "
    "No prose, no reasoning, no markdown. Short values."
)
_COMPACT_RETRY_SUFFIX = (
    "\n\nCRITICAL: Do NOT think out loud. Continue the JSON object now. "
    'Keep message under 200 chars and at most 3 short suggested_replies. '
    'Valid shapes: {"action":"tool","tool":"...","args":{...}} '
    'or {"action":"reply","message":"...","suggested_replies":[],"ui_hint":null}'
)
# Prefill forces stubborn free models (e.g. big-pickle) to emit JSON instead of CoT prose.
_JSON_ASSISTANT_PREFILL = '{"action":'


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

    # normal (with JSON prefill) → compact retry with the same token budget.
    attempts: list[tuple[str, str, int]] = [
        ("normal", _JSON_SYSTEM, actual_tokens),
        ("compact", _JSON_SYSTEM_COMPACT, actual_tokens),
    ]

    for attempt_name, system_content, tokens in attempts:
        user_content = prompt if attempt_name == "normal" else prompt + _COMPACT_RETRY_SUFFIX
        payload: dict[str, Any] = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_content},
                {"role": "user", "content": user_content},
                # Assistant prefill — completion must continue this JSON.
                {"role": "assistant", "content": _JSON_ASSISTANT_PREFILL},
            ],
            "temperature": actual_temp if attempt_name == "normal" else 0.0,
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
                result, meta = _process_openrouter_response(
                    response, model, prefill=_JSON_ASSISTANT_PREFILL
                )
                if result is not None:
                    return result

                # 402 retry: OpenRouter credit-limit — reduce tokens and retry once (same attempt style).
                if response.status_code == 402:
                    affordable = _affordable_tokens_from_error(response.text[:500], requested=tokens)
                    if affordable and affordable < tokens:
                        logger.warning(
                            "LLM provider credit limit: retrying with max_tokens={} (was {})",
                            affordable,
                            tokens,
                        )
                        payload["max_tokens"] = affordable
                        response = await client.post(
                            settings.OPENROUTER_BASE_URL,
                            headers=_openrouter_headers(),
                            json=payload,
                        )
                        result, meta = _process_openrouter_response(
                            response, model, prefill=_JSON_ASSISTANT_PREFILL
                        )
                        if result is not None:
                            return result
                    else:
                        logger.error(
                            "LLM provider credits nearly exhausted. "
                            "Add credits at https://openrouter.ai/settings/credits"
                        )
                        return None

                # Empty / truncated / non-JSON → try compact pass once, then give up.
                if attempt_name == "normal" and meta.get("retryable"):
                    logger.warning(
                        "LLM JSON parse failed (finish_reason={}, empty={}); retrying compact.",
                        meta.get("finish_reason"),
                        meta.get("empty_content"),
                    )
                    continue
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


def _message_text(message: Any) -> str:
    """Normalize OpenAI-compatible message content to a plain string."""
    if message is None:
        return ""
    if isinstance(message, str):
        return message
    if not isinstance(message, dict):
        return str(message)

    content = message.get("content")
    if isinstance(content, str) and content.strip():
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, str) and part.strip():
                parts.append(part)
            elif isinstance(part, dict):
                text = part.get("text") or part.get("content")
                if isinstance(text, str) and text.strip():
                    parts.append(text)
        if parts:
            return "\n".join(parts)

    # Some routed models put the useful text in reasoning / refusal fields.
    for key in ("reasoning_content", "reasoning", "refusal"):
        alt = message.get(key)
        if isinstance(alt, str) and alt.strip():
            return alt
    return content if isinstance(content, str) else ""


def _process_openrouter_response(
    response: httpx.Response,
    model: str,
    *,
    prefill: str = "",
) -> tuple[dict | None, dict[str, Any]]:
    """Parse and validate an OpenAI-compatible Chat Completions response.

    Returns (parsed_dict_or_None, meta). meta.retryable is True when a compact
    retry may help (empty content, truncation, or non-JSON text).
    """
    raw_body = response.text
    headers = dict(response.headers)
    status = response.status_code
    meta: dict[str, Any] = {"retryable": False, "finish_reason": None, "empty_content": False}

    if status != 200:
        logger.error(
            "LLM call failed: status={} url={} model={} headers={} body={}",
            status,
            settings.OPENROUTER_BASE_URL,
            model,
            headers,
            raw_body[:1000],
        )
        return None, meta

    if not raw_body or not raw_body.strip():
        logger.error(
            "LLM call returned 200 with empty body. url={} model={} headers={}",
            settings.OPENROUTER_BASE_URL,
            model,
            headers,
        )
        meta["retryable"] = True
        meta["empty_content"] = True
        return None, meta

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
        return None, meta

    try:
        choice = data["choices"][0]
        message = choice.get("message") or {}
        finish_reason = choice.get("finish_reason") or choice.get("native_finish_reason")
        meta["finish_reason"] = finish_reason
        text = _message_text(message)
    except (KeyError, IndexError, TypeError):
        logger.error(
            "LLM call returned 200 with unexpected structure. url={} model={} data={}",
            settings.OPENROUTER_BASE_URL,
            model,
            json.dumps(data, default=str)[:500],
        )
        meta["retryable"] = True
        return None, meta

    routed_model = data.get("model") or model
    usage = data.get("usage") or {}
    if usage:
        logger.info(
            "LLM usage requested={} routed={} prompt_tokens={} completion_tokens={} total={} finish_reason={}",
            model,
            routed_model,
            usage.get("prompt_tokens"),
            usage.get("completion_tokens"),
            usage.get("total_tokens"),
            meta.get("finish_reason"),
        )

    if not (text or "").strip():
        meta["empty_content"] = True
        meta["retryable"] = True
        logger.warning(
            "LLM call returned empty message content. url={} model={} finish_reason={} message_keys={}",
            settings.OPENROUTER_BASE_URL,
            model,
            meta.get("finish_reason"),
            list(message.keys()) if isinstance(message, dict) else type(message).__name__,
        )
        return None, meta

    result = _parse_json_content(text, prefill=prefill)
    if result is None:
        truncated = str(meta.get("finish_reason") or "").lower() in ("length", "max_tokens")
        meta["retryable"] = True
        logger.warning(
            "LLM response could not be parsed as JSON. url={} model={} finish_reason={} truncated={} text={}",
            settings.OPENROUTER_BASE_URL,
            model,
            meta.get("finish_reason"),
            truncated,
            text[:500],
        )
    return result, meta


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


def _parse_json_content(text: str, *, prefill: str = "") -> dict | None:
    if not text and not prefill:
        return None
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()
    # Provider may return only the continuation after our assistant prefill.
    if prefill and cleaned and not cleaned.startswith("{"):
        cleaned = prefill + cleaned

    try:
        parsed = json.loads(cleaned)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start >= 0 and end > start:
            try:
                parsed = json.loads(cleaned[start : end + 1])
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                pass
        # Common with free models: hit max_tokens mid-object. Close strings/brackets.
        salvaged = _salvage_truncated_json(cleaned)
        if salvaged is not None:
            logger.info(
                "Salvaged truncated LLM JSON (action={})",
                salvaged.get("action"),
            )
        return salvaged


def _salvage_truncated_json(text: str) -> dict | None:
    """Best-effort repair when the model hit max_tokens mid-JSON."""
    start = text.find("{")
    if start < 0:
        return None
    chunk = text[start:]

    in_string = False
    escape = False
    stack: list[str] = []
    for ch in chunk:
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            stack.append("}")
        elif ch == "[":
            stack.append("]")
        elif ch in "}]":
            if stack and stack[-1] == ch:
                stack.pop()

    repaired = chunk.rstrip()
    if in_string:
        repaired += '"'
    repaired = repaired.rstrip()
    if repaired.endswith(","):
        repaired = repaired[:-1]
    while stack:
        repaired += stack.pop()

    try:
        parsed = json.loads(repaired)
        if isinstance(parsed, dict) and parsed.get("action") in ("tool", "reply"):
            if parsed.get("action") == "reply" and not isinstance(parsed.get("message"), str):
                return None
            if parsed.get("action") == "tool" and not parsed.get("tool"):
                return None
            replies = parsed.get("suggested_replies")
            if isinstance(replies, list):
                parsed["suggested_replies"] = [
                    r for r in replies if isinstance(r, str) and len(r.strip()) >= 3
                ]
            else:
                parsed["suggested_replies"] = []
            parsed.setdefault("ui_hint", None)
            if parsed.get("action") == "tool":
                parsed.setdefault("args", {})
            return parsed
    except json.JSONDecodeError:
        pass

    # Last resort: pull action + message even if the rest is garbage.
    action_m = re.search(r'"action"\s*:\s*"(tool|reply)"', chunk)
    if not action_m or action_m.group(1) != "reply":
        return None
    msg_m = re.search(r'"message"\s*:\s*"((?:\\.|[^"\\])*)(?:"|$)', chunk, re.DOTALL)
    if not msg_m:
        return None
    try:
        message = json.loads(f'"{msg_m.group(1)}"')
    except json.JSONDecodeError:
        message = msg_m.group(1)
    if not isinstance(message, str) or not message.strip():
        return None
    return {
        "action": "reply",
        "message": message.strip(),
        "suggested_replies": [],
        "ui_hint": None,
    }

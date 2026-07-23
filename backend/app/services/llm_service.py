"""Shared LLM client — OpenRouter (OpenAI-compatible) with optional Gemini fallback.

Prefer OpenRouter when OPENROUTER_API_KEY is set. Falls back to direct Gemini
only if OpenRouter is unavailable and GEMINI_API_KEY is present.
"""

from __future__ import annotations

import json
import re
from typing import Any

import httpx
from loguru import logger

from app.core.config import settings

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

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
    return int(getattr(settings, "OPENROUTER_MAX_TOKENS", 2048) or 2048)


def _affordable_tokens_from_error(text: str) -> int | None:
    match = _AFFORD_RE.search(text or "")
    if not match:
        return None
    try:
        return max(256, int(match.group(1)) - 64)
    except ValueError:
        return None


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
        logger.warning("OpenRouter failed; trying Gemini fallback if configured.")

    gem_key = (settings.GEMINI_API_KEY or "").strip()
    if gem_key and not gem_key.startswith("YOUR_"):
        return await _call_gemini_json(prompt, timeout=timeout)
    return None


async def _call_openrouter_json(
    prompt: str,
    *,
    timeout: float,
    max_tokens: int | None = None,
    temperature: float | None = None,
) -> dict | None:
    model = (settings.OPENROUTER_MODEL or "google/gemini-2.5-flash").strip()
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
            "response_format": {"type": "json_object"},
        }
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    OPENROUTER_URL, headers=_openrouter_headers(), json=payload
                )
                if response.status_code == 200:
                    data = response.json()
                    text = data["choices"][0]["message"]["content"]
                    usage = data.get("usage") or {}
                    if usage:
                        logger.info(
                            "OpenRouter usage model={} prompt_tokens={} completion_tokens={} total={}",
                            model,
                            usage.get("prompt_tokens"),
                            usage.get("completion_tokens"),
                            usage.get("total_tokens"),
                        )
                    return _parse_json_content(text)

                body = response.text[:500]
                logger.error(f"OpenRouter call failed: {response.status_code} {body[:400]}")

                if response.status_code == 402 and attempt_tokens is not None:
                    affordable = _affordable_tokens_from_error(body)
                    if affordable and affordable < tokens:
                        logger.warning(
                            "OpenRouter credit limit: retrying with max_tokens={} (was {})",
                            affordable,
                            tokens,
                        )
                        actual_tokens = affordable
                        continue
                return None
        except Exception as exc:
            logger.error(f"OpenRouter call raised: {exc}")
            return None
    return None


async def _call_gemini_json(prompt: str, *, timeout: float) -> dict | None:
    model = (settings.GEMINI_MODEL or "gemini-2.0-flash").strip()
    url = f"{GEMINI_BASE}/{model}:generateContent"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json"},
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                url, params={"key": settings.GEMINI_API_KEY.strip()}, json=payload
            )
            if response.status_code != 200:
                if response.status_code in (401, 403):
                    logger.error(
                        "Gemini auth failed ({}). Check GEMINI_API_KEY in .env — "
                        "use a Generative Language API key from Google AI Studio, not an OAuth token. {}",
                        response.status_code,
                        response.text[:240],
                    )
                else:
                    logger.error(
                        f"Gemini call failed: {response.status_code} {response.text[:400]}"
                    )
                return None
            data = response.json()
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            return _parse_json_content(text)
    except Exception as exc:
        logger.error(f"Gemini call raised: {exc}")
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

"""Shared LLM client — OpenRouter (OpenAI-compatible) with optional Gemini fallback.

Prefer OpenRouter when OPENROUTER_API_KEY is set. Falls back to direct Gemini
only if OpenRouter is unavailable and GEMINI_API_KEY is present.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
from loguru import logger

from app.core.config import settings

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models"


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


async def call_llm_json(prompt: str, *, timeout: float = 60.0) -> dict | None:
    """Send a prompt and parse a JSON object response. Returns None on failure."""
    if (settings.OPENROUTER_API_KEY or "").strip():
        result = await _call_openrouter_json(prompt, timeout=timeout)
        if result is not None:
            return result
        logger.warning("OpenRouter failed; trying Gemini fallback if configured.")

    gem_key = (settings.GEMINI_API_KEY or "").strip()
    if gem_key and not gem_key.startswith("YOUR_"):
        return await _call_gemini_json(prompt, timeout=timeout)
    return None


async def _call_openrouter_json(prompt: str, *, timeout: float) -> dict | None:
    model = (settings.OPENROUTER_MODEL or "google/gemini-2.5-flash").strip()
    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "You are a precise API. Always respond with a single valid JSON object only — no markdown fences.",
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
        "max_tokens": int(getattr(settings, "OPENROUTER_MAX_TOKENS", 4096) or 4096),
        "response_format": {"type": "json_object"},
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                OPENROUTER_URL, headers=_openrouter_headers(), json=payload
            )
            if response.status_code != 200:
                logger.error(
                    f"OpenRouter call failed: {response.status_code} {response.text[:400]}"
                )
                return None
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
    except Exception as exc:
        logger.error(f"OpenRouter call raised: {exc}")
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

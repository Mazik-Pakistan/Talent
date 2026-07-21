"""US-074, US-075, US-090(lite)/US-099: Gemini-powered learning intelligence.

Design principle: Gemini never invents course titles/URLs. It only ever
(a) picks/ranks from a real Microsoft Learn candidate pool we already fetched
via ms_learn_service, or (b) names skills/roles in plain text. Any course
attached to a recommendation always comes straight from the MS Learn catalog.
"""

from __future__ import annotations

import json

import httpx
from loguru import logger

from app.core.config import settings

GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"


async def _call_gemini_json(prompt: str, *, timeout: float = 45.0) -> dict | None:
    gemini_key = (settings.GEMINI_API_KEY or "").strip()
    if not gemini_key:
        return None
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json"},
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(GEMINI_URL, params={"key": gemini_key}, json=payload)
            if response.status_code != 200:
                logger.error(f"Gemini call failed: {response.status_code} {response.text[:300]}")
                return None
            data = response.json()
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            return json.loads(text.strip())
    except Exception as exc:  # pragma: no cover - network dependent
        logger.error(f"Gemini call raised: {exc}")
        return None


def _candidate_brief(candidates: list[dict]) -> str:
    lines = []
    for item in candidates:
        lines.append(
            json.dumps(
                {
                    "uid": item.get("uid"),
                    "title": item.get("title"),
                    "type": item.get("type"),
                    "summary": (item.get("summary") or "")[:220],
                    "level": (item.get("levels") or ["beginner"])[0],
                    "duration_minutes": item.get("duration_minutes"),
                    "roles": item.get("roles"),
                    "products": item.get("products"),
                }
            )
        )
    return "\n".join(lines)


async def rank_recommended_courses(
    *,
    job_title: str | None,
    department: str | None,
    current_skills: list[str],
    career_goal: str | None,
    candidates: list[dict],
    top_n: int = 8,
) -> list[dict]:
    """US-074: Gemini ranks/selects from a real candidate pool. Returns
    [{"uid": ..., "reason": "..."}] in priority order, or [] on failure."""
    if not candidates:
        return []

    prompt = f"""You are an AI learning coach for an internal talent platform.
Employee profile:
- Job title: {job_title or "Unknown"}
- Department: {department or "Unknown"}
- Current skills: {", ".join(current_skills) or "None recorded"}
- Career goal: {career_goal or "Not specified"}

Below is a JSON-lines list of REAL Microsoft Learn courses (one per line) that are
available right now. You must choose ONLY from this list — never invent a course.

{_candidate_brief(candidates)}

Select and rank the best {top_n} courses for this employee's role, skill gaps, and
career goal. Prioritize relevance and a mix of levels appropriate to their current
skills. Return JSON only, no markdown:
{{"recommendations": [{{"uid": "<uid from the list above, exact match>", "reason": "<one short sentence, specific to this employee>"}}]}}
"""
    result = await _call_gemini_json(prompt)
    if not result or "recommendations" not in result:
        return []

    valid_uids = {c["uid"] for c in candidates}
    picks = []
    for rec in result.get("recommendations") or []:
        uid = rec.get("uid")
        if uid in valid_uids:
            picks.append({"uid": uid, "reason": rec.get("reason") or ""})
    return picks[:top_n]


async def analyze_skill_gap(
    *,
    job_title: str | None,
    target_role: str,
    current_skills: list[str],
    professional_summary: str | None,
) -> dict | None:
    """US-075/US-100: Gemini identifies missing skills + readiness — no course
    links here, those are attached afterward from the real MS Learn catalog."""
    prompt = f"""You are a career-readiness analyst for an internal talent platform.
Employee:
- Current job title: {job_title or "Unknown"}
- Target role: {target_role}
- Current skills: {", ".join(current_skills) or "None recorded"}
- Resume summary: {(professional_summary or "Not available")[:800]}

Compare the employee's current skills against what is typically required for the
target role. Return JSON only, no markdown, no extra text:
{{
  "missing_skills": ["<ordered list, most foundational/important first, 3-8 items, short skill names suitable as a search keyword e.g. 'Docker', 'Azure Functions', 'CI/CD'>"],
  "matched_skills": ["<skills the employee already has that ARE relevant to the target role>"],
  "readiness_percentage": <integer 0-100, overall readiness for the target role>,
  "summary": "<2-3 sentence plain-language assessment>"
}}
"""
    result = await _call_gemini_json(prompt)
    if not result:
        return None
    result["missing_skills"] = [str(s) for s in (result.get("missing_skills") or [])][:8]
    result["matched_skills"] = [str(s) for s in (result.get("matched_skills") or [])][:20]
    try:
        result["readiness_percentage"] = max(0, min(100, int(result.get("readiness_percentage") or 0)))
    except (TypeError, ValueError):
        result["readiness_percentage"] = 0
    result["summary"] = str(result.get("summary") or "")
    return result

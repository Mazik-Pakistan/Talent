"""Lightweight OpenRouter briefs for the Recruiter Mascot speech bubble.

Uses the shared llm_service — never a separate AI client. Returns None when
LLM is unavailable so the mascot falls back to rule-based insights.
"""

from __future__ import annotations

import json

from app.services.llm_service import call_llm_json, llm_configured


async def generate_mascot_brief(payload: dict) -> dict | None:
    if not llm_configured():
        return None

    page = payload.get("page") or "overview"
    pending = int(payload.get("pending_approvals") or 0)
    ready = int(payload.get("ready_to_activate") or 0)
    offers = int(payload.get("pending_offers") or 0)
    onboarding = int(payload.get("onboarding_in_progress") or 0)
    active = int(payload.get("active_employees") or 0)
    first_name = (payload.get("first_name") or "").strip()
    recent_names = [n for n in (payload.get("recent_names") or []) if n][:2]

    if pending + ready + offers + onboarding == 0:
        return None

    names_block = ", ".join(recent_names) if recent_names else "none listed"
    prompt = f"""You write ONE short recruiter assistant message for a floating mascot speech bubble.
Rules:
- Max 120 characters.
- Be specific with counts and names when provided.
- Encouraging, professional tone.
- No markdown, no quotes, no emojis.
- Do not invent people or numbers.

Recruiter page: {page}
First name (optional greeting): {first_name or "unknown"}
Pending onboarding approvals: {pending}
Ready to activate (signed offers): {ready}
Pending offer reviews: {offers}
Candidates mid-onboarding: {onboarding}
Active employees: {active}
Recent approval names: {names_block}

Return JSON only: {{"message": "<your one sentence>"}}"""

    result = await call_llm_json(prompt, max_tokens=96, timeout=25.0)
    if not result or not result.get("message"):
        return None

    message = str(result["message"]).strip().replace("\n", " ")
    if len(message) > 140:
        message = message[:137].rstrip() + "..."
    return {"message": message, "source": "ai"}

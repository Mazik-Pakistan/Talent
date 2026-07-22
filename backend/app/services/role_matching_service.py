"""Deterministic employee ↔ organization role matching.

Computes skill/cert match percentages, missing items, readiness, and learning
priority without calling an LLM. AI is only used later for natural-language
summaries when needed.
"""

from __future__ import annotations

from typing import Any


def _norm(value: str) -> str:
    return " ".join((value or "").strip().lower().split())


def _skill_set(skills: list[str] | list[dict]) -> set[str]:
    out: set[str] = set()
    for item in skills or []:
        if isinstance(item, str):
            n = _norm(item)
            if n:
                out.add(n)
        elif isinstance(item, dict):
            n = _norm(item.get("skill_name") or item.get("skill") or item.get("title") or "")
            if n:
                out.add(n)
    return out


def _cert_set(certs: list[str] | list[dict]) -> set[str]:
    out: set[str] = set()
    for item in certs or []:
        if isinstance(item, str):
            n = _norm(item)
            if n:
                out.add(n)
        elif isinstance(item, dict):
            n = _norm(item.get("title") or item.get("course_title") or item.get("name") or "")
            if n:
                out.add(n)
    return out


def match_percentage(have: set[str], required: set[str]) -> float:
    if not required:
        return 100.0
    hit = len(have & required)
    return round(100.0 * hit / len(required), 1)


def learning_priority(readiness: float, missing_skills: int, missing_certs: int) -> str:
    if readiness >= 85 and missing_skills == 0 and missing_certs <= 1:
        return "low"
    if readiness >= 70:
        return "medium"
    if readiness >= 45:
        return "immediate"
    return "critical"


def match_employee_to_role(
    *,
    employee_skills: list[str] | list[dict],
    employee_certifications: list[str] | list[dict],
    role: dict,
) -> dict[str, Any]:
    """Compare one employee profile against one org role definition."""
    required_skills = _skill_set(role.get("required_skills") or [])
    required_certs = _cert_set(role.get("required_certifications") or role.get("certifications") or [])
    have_skills = _skill_set(employee_skills)
    have_certs = _cert_set(employee_certifications)

    skill_match = match_percentage(have_skills, required_skills)
    cert_match = match_percentage(have_certs, required_certs)

    missing_skill_norms = required_skills - have_skills
    missing_cert_norms = required_certs - have_certs

    # Map back to display names from role definition
    skill_display = {}
    for s in role.get("required_skills") or []:
        name = s if isinstance(s, str) else (s.get("skill_name") or s.get("skill") or "")
        skill_display[_norm(name)] = name.strip() if isinstance(name, str) else str(name)

    cert_display = {}
    for c in role.get("required_certifications") or role.get("certifications") or []:
        if isinstance(c, str):
            cert_display[_norm(c)] = c.strip()
        elif isinstance(c, dict):
            title = (c.get("title") or c.get("name") or "").strip()
            cert_display[_norm(title)] = {**c, "title": title}

    missing_skills = [skill_display.get(n, n) for n in sorted(missing_skill_norms)]
    missing_certs: list[Any] = []
    for n in sorted(missing_cert_norms):
        disp = cert_display.get(n, n)
        missing_certs.append(disp)

    # Weight skills higher than certs when both exist; otherwise use whichever is defined.
    if required_skills and required_certs:
        readiness = round(0.7 * skill_match + 0.3 * cert_match, 1)
    elif required_skills:
        readiness = skill_match
    elif required_certs:
        readiness = cert_match
    else:
        readiness = 0.0

    priority = learning_priority(readiness, len(missing_skills), len(missing_certs))

    return {
        "role_id": str(role.get("_id") or role.get("id") or ""),
        "role": role.get("title") or role.get("role") or "",
        "description": role.get("description") or "",
        "skill_match_percent": skill_match,
        "certification_match_percent": cert_match,
        "missing_skills": missing_skills,
        "missing_certifications": missing_certs,
        "readiness_score": readiness,
        "learning_priority": priority,
        "required_skills": list(skill_display.values()) or sorted(required_skills),
        "required_certifications": [
            cert_display.get(n, n) if n in cert_display else n for n in sorted(required_certs)
        ]
        if required_certs
        else [],
    }


def match_employee_to_roles(
    *,
    employee_skills: list[str] | list[dict],
    employee_certifications: list[str] | list[dict],
    roles: list[dict],
) -> list[dict]:
    results = [
        match_employee_to_role(
            employee_skills=employee_skills,
            employee_certifications=employee_certifications,
            role=role,
        )
        for role in roles or []
    ]
    results.sort(key=lambda r: (-r["readiness_score"], r.get("role") or ""))
    return results


def deterministic_skill_gap(
    *,
    current_skills: list[str],
    target_role: str,
    role_def: dict | None = None,
) -> dict:
    """Build a skill-gap payload without LLM when a KB role definition exists.

    If no role_def, returns a thin structure callers can enrich with AI summary only.
    """
    if role_def:
        match = match_employee_to_role(
            employee_skills=current_skills,
            employee_certifications=[],
            role=role_def,
        )
        missing = match["missing_skills"]
        priority = match["learning_priority"]
        gaps = [{"skill": s, "priority": priority, "reason": f"Required for {target_role}"} for s in missing]
        matched = [s for s in current_skills if _norm(s) in _skill_set(role_def.get("required_skills") or [])]
        return {
            "target_role": target_role,
            "current_skills": current_skills,
            "missing_skills": missing,
            "skill_gaps": gaps,
            "matched_skills": matched,
            "readiness_percentage": int(round(match["readiness_score"])),
            "summary": None,  # filled by AI only when needed
            "deterministic": True,
            "missing_certifications": match["missing_certifications"],
            "skill_match_percent": match["skill_match_percent"],
            "certification_match_percent": match["certification_match_percent"],
            "learning_priority": priority,
        }

    return {
        "target_role": target_role,
        "current_skills": current_skills,
        "missing_skills": [],
        "skill_gaps": [],
        "matched_skills": current_skills[:],
        "readiness_percentage": None,
        "summary": None,
        "deterministic": False,
    }

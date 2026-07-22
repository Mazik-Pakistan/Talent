"""Merge skills from resume OCR, certificates, and manual entries."""

from __future__ import annotations

from typing import Any


def _norm(name: str) -> str:
    return " ".join((name or "").strip().lower().split())


def merge_skill_sources(
    *,
    manual_skills: list[dict],
    resume_fields: dict | None = None,
    certificate_skills: list[dict] | None = None,
    ai_assessment_skills: list[dict] | None = None,
) -> list[dict]:
    """Deduplicate skills across sources; prefer higher proficiency / confidence.

    Returns a list of public-shaped skill dicts (may lack Mongo id for inferred ones).
    """
    by_key: dict[str, dict] = {}

    def upsert(entry: dict) -> None:
        name = (entry.get("skill_name") or "").strip()
        if not name:
            return
        key = _norm(name)
        existing = by_key.get(key)
        if not existing:
            by_key[key] = entry
            return
        # Prefer verified / manual / course over inferred; keep higher confidence.
        rank = {"manual": 3, "course": 3, "ai_resume": 2, "resume": 2, "certificate": 2, "inferred": 1}
        e_src = entry.get("source") or "inferred"
        x_src = existing.get("source") or "inferred"
        e_conf = int(entry.get("confidence") or 0)
        x_conf = int(existing.get("confidence") or 0)
        if rank.get(e_src, 0) > rank.get(x_src, 0) or (
            rank.get(e_src, 0) == rank.get(x_src, 0) and e_conf > x_conf
        ):
            merged = {**existing, **entry}
            # Keep id if existing had one
            if existing.get("id") and not entry.get("id"):
                merged["id"] = existing["id"]
            by_key[key] = merged
        else:
            # Enrich confidence if missing
            if not existing.get("confidence") and entry.get("confidence"):
                existing["confidence"] = entry["confidence"]

    for s in manual_skills or []:
        upsert(
            {
                "id": str(s["_id"]) if s.get("_id") else s.get("id"),
                "skill_name": s.get("skill_name"),
                "category": s.get("category") or "Other",
                "proficiency": s.get("proficiency") or "Beginner",
                "years_experience": s.get("years_experience"),
                "source": s.get("source") or "manual",
                "verification_status": s.get("verification_status") or "unverified",
                "confidence": s.get("confidence"),
            }
        )

    resume_fields = resume_fields or {}
    for key in ("technical_skills", "soft_skills", "skills"):
        category = "Soft Skills" if key == "soft_skills" else "Other"
        for value in resume_fields.get(key) or []:
            if isinstance(value, str) and value.strip():
                upsert(
                    {
                        "skill_name": value.strip(),
                        "category": category,
                        "proficiency": "Intermediate",
                        "source": "resume",
                        "verification_status": "unverified",
                        "confidence": 75,
                    }
                )

    for s in certificate_skills or []:
        upsert(
            {
                "skill_name": s.get("skill_name"),
                "category": s.get("category") or "Other",
                "proficiency": s.get("proficiency") or "Intermediate",
                "source": "certificate",
                "verification_status": "verified",
                "confidence": s.get("confidence") or 80,
            }
        )

    for s in ai_assessment_skills or []:
        upsert(
            {
                "skill_name": s.get("skill_name"),
                "category": s.get("category") or "Other",
                "proficiency": s.get("proficiency") or "Beginner",
                "years_experience": s.get("years_experience"),
                "source": "ai_resume",
                "verification_status": "unverified",
                "confidence": s.get("confidence") or 70,
            }
        )

    return sorted(by_key.values(), key=lambda x: (x.get("skill_name") or "").lower())


def extract_certificate_skill_list(certificates: list[dict]) -> list[dict]:
    """Flatten skills_awarded from verified certificate docs."""
    out: list[dict] = []
    for cert in certificates or []:
        for skill in cert.get("skills_awarded") or []:
            if isinstance(skill, str):
                out.append({"skill_name": skill, "category": "Other", "proficiency": "Intermediate", "confidence": 80})
            elif isinstance(skill, dict):
                out.append(skill)
    return out


def skill_name_set(merged: list[dict]) -> list[str]:
    names = { (s.get("skill_name") or "").strip() for s in merged if s.get("skill_name") }
    return sorted(names, key=str.lower)

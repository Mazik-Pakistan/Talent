"""Build ordered career learning paths from catalog + recruiter KB."""

from __future__ import annotations

from typing import Any


DIFFICULTY_ORDER = {"beginner": 0, "fundamental": 0, "intermediate": 1, "advanced": 2, "expert": 3}


def _difficulty_rank(value: str | None) -> int:
    if not value:
        return 1
    return DIFFICULTY_ORDER.get(str(value).strip().lower(), 1)


def _hours(item: dict) -> float:
    if item.get("estimated_hours") is not None:
        try:
            return float(item["estimated_hours"])
        except (TypeError, ValueError):
            pass
    mins = item.get("duration_minutes")
    if mins:
        try:
            return round(float(mins) / 60, 1)
        except (TypeError, ValueError):
            pass
    return 0.0


def build_learning_path(
    *,
    target_role: str,
    missing_skills: list[str],
    missing_certifications: list[Any],
    catalog_courses: list[dict],
    kb_certifications: list[dict] | None = None,
    existing_certifications: list[str] | None = None,
    completed_uids: set[str] | None = None,
) -> dict:
    """Arrange learning steps: foundations → skills → certifications.

    Sources: Microsoft Learn, Coursera, Recruiter Knowledge Base.
    """
    completed_uids = completed_uids or set()
    existing = {(c or "").strip().lower() for c in (existing_certifications or []) if c}
    steps: list[dict] = []
    used_uids: set[str] = set()

    # Index catalog by rough keyword match
    def find_course_for(keyword: str) -> dict | None:
        kw = (keyword or "").lower()
        for course in catalog_courses:
            uid = course.get("uid")
            if not uid or uid in used_uids:
                continue
            hay = " ".join(
                [
                    course.get("title") or "",
                    course.get("summary") or "",
                    " ".join(course.get("products") or []),
                    " ".join(course.get("subjects") or []),
                ]
            ).lower()
            if kw and kw in hay:
                return course
        return None

    # Step group 1: courses for missing skills (easier first)
    skill_courses = []
    for skill in missing_skills or []:
        course = find_course_for(skill)
        if course:
            skill_courses.append((skill, course))
            used_uids.add(course["uid"])

    skill_courses.sort(key=lambda pair: _difficulty_rank((pair[1].get("levels") or ["intermediate"])[0]))

    for skill, course in skill_courses:
        steps.append(
            {
                "skill": skill,
                "title": course.get("title"),
                "type": course.get("type") or "module",
                "source": course.get("source") or "microsoft_learn",
                "url": course.get("url"),
                "uid": course.get("uid"),
                "duration_minutes": course.get("duration_minutes"),
                "estimated_hours": _hours(course),
                "difficulty": (course.get("levels") or [None])[0],
                "completed": course.get("uid") in completed_uids,
                "kind": "skill",
            }
        )

    # Step group 2: missing certifications from KB + catalog
    cert_steps: list[dict] = []
    kb_by_title = {}
    for cert in kb_certifications or []:
        title = (cert.get("title") or "").strip()
        if title:
            kb_by_title[title.lower()] = cert

    for missing in missing_certifications or []:
        if isinstance(missing, dict):
            title = (missing.get("title") or missing.get("name") or "").strip()
            meta = missing
        else:
            title = str(missing).strip()
            meta = kb_by_title.get(title.lower()) or {"title": title}

        if title.lower() in existing:
            continue

        # Prefer KB official URL / metadata
        course = find_course_for(title)
        cert_steps.append(
            {
                "skill": title,
                "title": meta.get("title") or title,
                "type": "certification",
                "source": meta.get("provider") or (course or {}).get("source") or "recruiter_kb",
                "url": meta.get("official_url") or meta.get("url") or (course or {}).get("url"),
                "uid": (course or {}).get("uid") or f"kb-cert:{(meta.get('id') or title)}",
                "duration_minutes": int(float(meta.get("estimated_hours") or 0) * 60) or (course or {}).get("duration_minutes"),
                "estimated_hours": float(meta.get("estimated_hours") or _hours(course or {})),
                "difficulty": meta.get("difficulty") or (course or {}).get("levels", [None])[0],
                "provider": meta.get("provider"),
                "description": meta.get("description"),
                "skills_covered": meta.get("skills_covered") or [],
                "completed": (
                    ((course or {}).get("uid") in completed_uids)
                    or title.lower() in existing
                ),
                "kind": "certification",
            }
        )
        if course:
            used_uids.add(course["uid"])

    cert_steps.sort(key=lambda s: (_difficulty_rank(s.get("difficulty")), s.get("estimated_hours") or 0))
    steps.extend(cert_steps)

    # Number steps
    for idx, step in enumerate(steps, start=1):
        step["step"] = idx

    total = len(steps) or 1
    done = sum(1 for s in steps if s.get("completed"))
    progress_percent = round(100.0 * done / total) if steps else 0
    total_hours = round(sum(s.get("estimated_hours") or 0 for s in steps), 1)

    return {
        "target_role": target_role,
        "path": steps,
        "progress_percent": progress_percent,
        "completed_steps": done,
        "total_steps": len(steps),
        "estimated_total_hours": total_hours,
        "existing_certifications": list(existing_certifications or []),
    }

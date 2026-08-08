"""Bidirectional course sync between org_framework_courses and learning_courses.

When a course is created/updated/deleted in either catalog, the sync service
mirrors the change to the other catalog so every module sees a unified view.

Loop safety: sync functions write directly to the other collection via
database; they never re-enter the originating service.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from bson import ObjectId

from app.core.database import database

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(UTC)


def _normalize(value: str | None) -> str:
    return " ".join((value or "").strip().lower().split())


def _learning_course_key(provider: str, title: str, url: str | None) -> str:
    return "|".join([_normalize(provider), _normalize(title), _normalize(url)])


def _safe_int(value, default: int = 0) -> int:
    try:
        return int(float(str(value)))
    except (TypeError, ValueError):
        return default


# ─── Org-framework → Learning courses ─────────────────────────────────────


async def sync_to_learning(org_id: str, course_doc: dict) -> str | None:
    """Upsert an org_framework_courses doc into learning_courses.

    Returns the learning_courses _id (as str) or None on failure.
    """
    try:
        provider = (course_doc.get("provider") or "Managed Learning").strip()
        title = (course_doc.get("name") or "").strip()
        if not title:
            return None

        course_key = _learning_course_key(provider, title, course_doc.get("url"))
        now = _now()
        duration_minutes = _safe_int(course_doc.get("duration_hours")) * 60

        update_doc = {
            "title": title,
            "provider": provider,
            "designation": course_doc.get("category") or "",
            "learning_month": "",
            "category": course_doc.get("category") or "",
            "competency": "",
            "url": course_doc.get("url") or None,
            "duration_minutes": duration_minutes if duration_minutes else None,
            "description": (course_doc.get("description") or "").strip(),
            "archived": False,
            "source_kind": "org_framework",
            "course_key": course_key,
            "organization_id": org_id,
            "org_framework_course_id": course_doc.get("course_id"),
            "difficulty": (course_doc.get("difficulty") or "Beginner").strip(),
            "hierarchy_path": [course_doc.get("category") or ""],
            "hierarchy_key": _normalize(course_doc.get("category") or ""),
            "updated_at": now,
        }

        existing = await database.learning_courses.find_one(
            {"org_framework_course_id": course_doc.get("course_id"), "organization_id": org_id}
        )
        if existing:
            merged = {**existing, **update_doc}
            await database.learning_courses.update_one(
                {"_id": existing["_id"]}, {"$set": merged}
            )
            return str(existing["_id"])

        update_doc["created_at"] = now
        result = await database.learning_courses.insert_one(update_doc)
        return str(result.inserted_id)

    except Exception:
        logger.debug("sync_to_learning failed for course_id=%s", course_doc.get("course_id"))
        return None


async def sync_delete_from_learning(org_id: str, course_id: str) -> bool:
    """Delete the learning_courses mirror of an org_framework_courses doc."""
    try:
        result = await database.learning_courses.delete_many(
            {"org_framework_course_id": course_id, "organization_id": org_id}
        )
        return result.deleted_count > 0
    except Exception:
        logger.debug("sync_delete_from_learning failed for course_id=%s", course_id)
        return False


# ─── Learning courses → Org-framework ──────────────────────────────────────


async def sync_to_framework(org_id: str, learning_doc: dict) -> str | None:
    """Upsert a learning_courses doc into org_framework_courses.

    Returns the org_framework_courses course_id or None on failure.
    """
    try:
        title = (learning_doc.get("title") or "").strip()
        if not title:
            return None

        org_framework_course_id = learning_doc.get("org_framework_course_id")
        now = _now()

        update_doc = {
            "name": title,
            "provider": (learning_doc.get("provider") or "").strip(),
            "category": (learning_doc.get("category") or learning_doc.get("designation") or "").strip(),
            "duration_hours": round((learning_doc.get("duration_minutes") or 0) / 60, 1) if learning_doc.get("duration_minutes") else None,
            "difficulty": (learning_doc.get("difficulty") or "Beginner").strip(),
            "url": learning_doc.get("url") or None,
            "description": (learning_doc.get("description") or "").strip(),
            "organization_id": org_id,
            "learning_course_id": str(learning_doc["_id"]) if learning_doc.get("_id") else None,
            "updated_at": now,
        }

        if org_framework_course_id:
            existing = await database.org_framework_courses.find_one(
                {"course_id": org_framework_course_id, "organization_id": org_id}
            )
            if existing:
                await database.org_framework_courses.update_one(
                    {"course_id": org_framework_course_id, "organization_id": org_id},
                    {"$set": update_doc},
                )
                return org_framework_course_id

        course_id = org_framework_course_id or f"ORG-{now.strftime('%Y%m%d%H%M%S')}-{title[:20].upper().replace(' ', '-')}"
        update_doc["course_id"] = course_id
        update_doc["created_at"] = now
        await database.org_framework_courses.insert_one(update_doc)
        return course_id

    except Exception:
        logger.debug("sync_to_framework failed for learning_course_id=%s", learning_doc.get("_id"))
        return None


async def sync_delete_from_framework(org_id: str, learning_course_id: str) -> bool:
    """Delete the org_framework_courses mirror of a learning_courses doc."""
    try:
        result = await database.org_framework_courses.delete_many(
            {"learning_course_id": learning_course_id, "organization_id": org_id}
        )
        return result.deleted_count > 0
    except Exception:
        logger.debug("sync_delete_from_framework failed for learning_course_id=%s", learning_course_id)
        return False

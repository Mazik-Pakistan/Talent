"""Hash-based caching for AI learning analyses.

AI results are reused until inputs change (resume, skills, certifications,
recruiter knowledge base version) or an explicit refresh is requested.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import Any

from app.core.database import database


def _now() -> datetime:
    return datetime.now(UTC)


def _stable_hash(payload: Any) -> str:
    raw = json.dumps(payload, sort_keys=True, default=str, ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


async def compute_resume_hash(user_id: str) -> str:
    doc = await database.documents.find_one(
        {"owner_id": user_id, "doc_type": "resume", "is_active": True},
        sort=[("created_at", -1)],
        projection={"updated_at": 1, "created_at": 1, "raw_extracted_text": 1, "ocr_result.fields": 1},
    )
    if not doc:
        return _stable_hash({"resume": None})
    fields = (doc.get("ocr_result") or {}).get("fields") or {}
    return _stable_hash(
        {
            "updated_at": doc.get("updated_at") or doc.get("created_at"),
            "text_len": len(doc.get("raw_extracted_text") or ""),
            "technical_skills": fields.get("technical_skills") or fields.get("skills") or [],
            "soft_skills": fields.get("soft_skills") or [],
            "summary": (fields.get("professional_summary") or "")[:400],
        }
    )


async def compute_skills_hash(user_id: str) -> str:
    docs = await database.employee_skills.find(
        {"user_id": user_id},
        projection={"skill_name": 1, "category": 1, "proficiency": 1, "years_experience": 1, "source": 1},
    ).sort("skill_name", 1).to_list(length=500)
    payload = [
        {
            "n": d.get("skill_name"),
            "c": d.get("category"),
            "p": d.get("proficiency"),
            "y": d.get("years_experience"),
            "s": d.get("source"),
        }
        for d in docs
    ]
    return _stable_hash(payload)


async def compute_certifications_hash(user_id: str) -> str:
    docs = await database.learning_certificates.find(
        {"user_id": user_id, "verification_status": "verified"},
        projection={"course_title": 1, "course_uid": 1, "skills_awarded": 1, "updated_at": 1, "created_at": 1},
    ).sort("created_at", 1).to_list(length=300)
    payload = [
        {
            "t": d.get("course_title"),
            "u": d.get("course_uid"),
            "skills": d.get("skills_awarded") or [],
            "at": d.get("updated_at") or d.get("created_at"),
        }
        for d in docs
    ]
    return _stable_hash(payload)


async def get_knowledge_base_version(recruiter_id: str | None = None) -> str:
    """Monotonic version for recruiter role/cert knowledge base."""
    query: dict[str, Any] = {}
    if recruiter_id:
        query["recruiter_id"] = recruiter_id
    meta = await database.recruiter_kb_meta.find_one(query or {"_id": "global"})
    if meta and meta.get("version") is not None:
        return str(meta["version"])
    # Fallback: hash latest role/cert update timestamps
    roles = await database.recruiter_kb_roles.find(query).sort("updated_at", -1).limit(1).to_list(length=1)
    certs = await database.recruiter_kb_certifications.find(query).sort("updated_at", -1).limit(1).to_list(length=1)
    stamp = None
    for docs in (roles, certs):
        if docs:
            stamp = max(filter(None, [stamp, docs[0].get("updated_at")]))
    return _stable_hash({"kb": stamp.isoformat() if stamp else "empty"})


async def bump_knowledge_base_version(recruiter_id: str) -> str:
    now = _now()
    await database.recruiter_kb_meta.update_one(
        {"recruiter_id": recruiter_id},
        {
            "$inc": {"version": 1},
            "$set": {"updated_at": now},
            "$setOnInsert": {"recruiter_id": recruiter_id, "created_at": now},
        },
        upsert=True,
    )
    doc = await database.recruiter_kb_meta.find_one({"recruiter_id": recruiter_id})
    return str((doc or {}).get("version") or 1)


async def compute_input_hashes(user_id: str, recruiter_id: str | None = None) -> dict[str, str]:
    resume_hash, skills_hash, certifications_hash = (
        await compute_resume_hash(user_id),
        await compute_skills_hash(user_id),
        await compute_certifications_hash(user_id),
    )
    kb_version = await get_knowledge_base_version(recruiter_id)
    return {
        "resumeHash": resume_hash,
        "skillsHash": skills_hash,
        "certificationsHash": certifications_hash,
        "knowledgeBaseVersion": kb_version,
    }


def hashes_match(cached: dict | None, current: dict) -> bool:
    if not cached:
        return False
    for key in ("resumeHash", "skillsHash", "certificationsHash", "knowledgeBaseVersion"):
        if cached.get(key) != current.get(key):
            return False
    return True


async def get_cached_assessment(user_id: str, current_hashes: dict) -> dict | None:
    cached = await database.learning_skill_assessments.find_one({"user_id": user_id})
    if not cached:
        return None
    if not hashes_match(cached.get("cache_meta") or {}, current_hashes):
        return None
    return {
        "assessment": cached.get("assessment"),
        "cache_meta": {
            **(cached.get("cache_meta") or {}),
            "lastAnalyzedAt": cached.get("generated_at"),
            "cached": True,
        },
        "generated_at": cached.get("generated_at"),
    }


async def store_assessment(user_id: str, assessment: dict, hashes: dict) -> None:
    now = _now()
    meta = {
        **hashes,
        "lastAnalyzedAt": now,
    }
    await database.learning_skill_assessments.update_one(
        {"user_id": user_id},
        {
            "$set": {
                "user_id": user_id,
                "assessment": assessment,
                "generated_at": now,
                "cache_meta": meta,
            }
        },
        upsert=True,
    )


async def get_cached_skill_gap(user_id: str, target_role: str, current_hashes: dict) -> dict | None:
    cached = await database.learning_skill_gaps.find_one({"user_id": user_id, "target_role": target_role})
    if not cached:
        return None
    if not hashes_match(cached.get("cache_meta") or {}, current_hashes):
        return None
    payload = dict(cached.get("result") or {})
    payload["cached"] = True
    payload["lastAnalyzedAt"] = cached.get("generated_at")
    return payload


async def store_skill_gap(user_id: str, target_role: str, result: dict, hashes: dict) -> None:
    now = _now()
    await database.learning_skill_gaps.update_one(
        {"user_id": user_id, "target_role": target_role},
        {
            "$set": {
                "user_id": user_id,
                "target_role": target_role,
                "result": result,
                "generated_at": now,
                "cache_meta": {**hashes, "lastAnalyzedAt": now},
            }
        },
        upsert=True,
    )


async def get_cached_role_matches(user_id: str, current_hashes: dict) -> dict | None:
    cached = await database.learning_role_matches.find_one({"user_id": user_id})
    if not cached:
        return None
    if not hashes_match(cached.get("cache_meta") or {}, current_hashes):
        return None
    return {
        "roles": cached.get("roles") or [],
        "generated_at": cached.get("generated_at"),
        "cached": True,
        "cache_meta": cached.get("cache_meta"),
    }


async def store_role_matches(user_id: str, roles: list[dict], hashes: dict) -> None:
    now = _now()
    await database.learning_role_matches.update_one(
        {"user_id": user_id},
        {
            "$set": {
                "user_id": user_id,
                "roles": roles,
                "generated_at": now,
                "cache_meta": {**hashes, "lastAnalyzedAt": now},
            }
        },
        upsert=True,
    )


async def invalidate_user_ai_caches(user_id: str) -> None:
    """Drop all AI-derived learning caches for a user."""
    await database.learning_ai_recommendations.delete_one({"user_id": user_id})
    await database.learning_skill_assessments.delete_one({"user_id": user_id})
    await database.learning_skill_gaps.delete_many({"user_id": user_id})
    await database.learning_role_matches.delete_one({"user_id": user_id})
    await database.learning_recruiter_profile_cache.delete_one({"user_id": user_id})
    await database.learning_career_goals.update_one(
        {"user_id": user_id},
        {"$set": {"ai_path": None, "skill_matrix": None}},
    )

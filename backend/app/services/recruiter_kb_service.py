"""Recruiter-managed Learning Knowledge Base (roles + certifications).

Separate from the (removed) AI Coach RAG policy store. This KB drives
deterministic role matching, learning paths, and course catalog entries.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from fastapi import HTTPException, status

from app.core.database import database
from app.core.rbac import CurrentUser
from app.services import learning_cache_service


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(value: Any) -> Any:
    return value.isoformat() if hasattr(value, "isoformat") else value


def _public_cert(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "title": doc.get("title"),
        "provider": doc.get("provider"),
        "official_url": doc.get("official_url"),
        "description": doc.get("description"),
        "skills_covered": doc.get("skills_covered") or [],
        "estimated_hours": doc.get("estimated_hours"),
        "difficulty": doc.get("difficulty") or "Intermediate",
        "priority": doc.get("priority") or "medium",
        "role_ids": [str(r) for r in (doc.get("role_ids") or [])],
        "created_at": _iso(doc.get("created_at")),
        "updated_at": _iso(doc.get("updated_at")),
    }


def _public_role(doc: dict, certs: list[dict] | None = None) -> dict:
    return {
        "id": str(doc["_id"]),
        "title": doc.get("title"),
        "description": doc.get("description"),
        "required_skills": doc.get("required_skills") or [],
        "required_certifications": doc.get("required_certifications") or [],
        "certifications": certs if certs is not None else [],
        "difficulty": doc.get("difficulty"),
        "priority": doc.get("priority") or "medium",
        "created_at": _iso(doc.get("created_at")),
        "updated_at": _iso(doc.get("updated_at")),
    }


class RecruiterKnowledgeBaseService:
    async def _bump(self, recruiter_id: str) -> None:
        await learning_cache_service.bump_knowledge_base_version(recruiter_id)

    async def list_roles(self, current_user: CurrentUser) -> dict:
        query = {} if current_user.role == "super_admin" else {"recruiter_id": current_user.id}
        docs = await database.recruiter_kb_roles.find(query).sort("title", 1).to_list(length=500)
        roles = []
        for doc in docs:
            cert_ids = doc.get("certification_ids") or []
            certs = []
            if cert_ids:
                oids = [ObjectId(c) for c in cert_ids if ObjectId.is_valid(str(c))]
                if oids:
                    cert_docs = await database.recruiter_kb_certifications.find({"_id": {"$in": oids}}).to_list(
                        length=100
                    )
                    certs = [_public_cert(c) for c in cert_docs]
            # Also resolve by title references in required_certifications
            roles.append(_public_role(doc, certs))
        return {"roles": roles}

    async def create_role(self, current_user: CurrentUser, payload: dict) -> dict:
        now = _now()
        title = (payload.get("title") or "").strip()
        if not title:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Role title is required.")
        doc = {
            "recruiter_id": current_user.id,
            "title": title,
            "description": (payload.get("description") or "").strip(),
            "required_skills": payload.get("required_skills") or [],
            "required_certifications": payload.get("required_certifications") or [],
            "certification_ids": payload.get("certification_ids") or [],
            "difficulty": payload.get("difficulty"),
            "priority": payload.get("priority") or "medium",
            "created_at": now,
            "updated_at": now,
        }
        result = await database.recruiter_kb_roles.insert_one(doc)
        doc["_id"] = result.inserted_id
        await self._bump(current_user.id)
        return {"role": _public_role(doc, [])}

    async def update_role(self, current_user: CurrentUser, role_id: str, payload: dict) -> dict:
        if not ObjectId.is_valid(role_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found.")
        query: dict[str, Any] = {"_id": ObjectId(role_id)}
        if current_user.role != "super_admin":
            query["recruiter_id"] = current_user.id
        existing = await database.recruiter_kb_roles.find_one(query)
        if not existing:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found.")

        updates: dict[str, Any] = {"updated_at": _now()}
        for key in (
            "title",
            "description",
            "required_skills",
            "required_certifications",
            "certification_ids",
            "difficulty",
            "priority",
        ):
            if key in payload and payload[key] is not None:
                updates[key] = payload[key]
        if "title" in updates:
            updates["title"] = str(updates["title"]).strip()

        await database.recruiter_kb_roles.update_one({"_id": existing["_id"]}, {"$set": updates})
        await self._bump(existing.get("recruiter_id") or current_user.id)
        doc = await database.recruiter_kb_roles.find_one({"_id": existing["_id"]})
        return {"role": _public_role(doc, [])}

    async def delete_role(self, current_user: CurrentUser, role_id: str) -> dict:
        if not ObjectId.is_valid(role_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found.")
        query: dict[str, Any] = {"_id": ObjectId(role_id)}
        if current_user.role != "super_admin":
            query["recruiter_id"] = current_user.id
        result = await database.recruiter_kb_roles.delete_one(query)
        if result.deleted_count == 0:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found.")
        await self._bump(current_user.id)
        return {"deleted": True}

    async def list_certifications(self, current_user: CurrentUser) -> dict:
        query = {} if current_user.role == "super_admin" else {"recruiter_id": current_user.id}
        docs = await database.recruiter_kb_certifications.find(query).sort("title", 1).to_list(length=500)
        return {"certifications": [_public_cert(d) for d in docs]}

    async def create_certification(self, current_user: CurrentUser, payload: dict) -> dict:
        now = _now()
        title = (payload.get("title") or "").strip()
        if not title:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Certification title is required.")
        doc = {
            "recruiter_id": current_user.id,
            "title": title,
            "provider": (payload.get("provider") or "").strip(),
            "official_url": (payload.get("official_url") or payload.get("url") or "").strip(),
            "description": (payload.get("description") or "").strip(),
            "skills_covered": payload.get("skills_covered") or [],
            "estimated_hours": payload.get("estimated_hours"),
            "difficulty": payload.get("difficulty") or "Intermediate",
            "priority": payload.get("priority") or "medium",
            "role_ids": payload.get("role_ids") or [],
            "created_at": now,
            "updated_at": now,
        }
        result = await database.recruiter_kb_certifications.insert_one(doc)
        doc["_id"] = result.inserted_id
        await self._bump(current_user.id)
        return {"certification": _public_cert(doc)}

    async def update_certification(self, current_user: CurrentUser, cert_id: str, payload: dict) -> dict:
        if not ObjectId.is_valid(cert_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Certification not found.")
        query: dict[str, Any] = {"_id": ObjectId(cert_id)}
        if current_user.role != "super_admin":
            query["recruiter_id"] = current_user.id
        existing = await database.recruiter_kb_certifications.find_one(query)
        if not existing:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Certification not found.")

        updates: dict[str, Any] = {"updated_at": _now()}
        mapping = {
            "title": "title",
            "provider": "provider",
            "official_url": "official_url",
            "url": "official_url",
            "description": "description",
            "skills_covered": "skills_covered",
            "estimated_hours": "estimated_hours",
            "difficulty": "difficulty",
            "priority": "priority",
            "role_ids": "role_ids",
        }
        for src, dest in mapping.items():
            if src in payload and payload[src] is not None:
                updates[dest] = payload[src]
        if "title" in updates:
            updates["title"] = str(updates["title"]).strip()

        await database.recruiter_kb_certifications.update_one({"_id": existing["_id"]}, {"$set": updates})
        await self._bump(existing.get("recruiter_id") or current_user.id)
        doc = await database.recruiter_kb_certifications.find_one({"_id": existing["_id"]})
        return {"certification": _public_cert(doc)}

    async def delete_certification(self, current_user: CurrentUser, cert_id: str) -> dict:
        if not ObjectId.is_valid(cert_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Certification not found.")
        query: dict[str, Any] = {"_id": ObjectId(cert_id)}
        if current_user.role != "super_admin":
            query["recruiter_id"] = current_user.id
        result = await database.recruiter_kb_certifications.delete_one(query)
        if result.deleted_count == 0:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Certification not found.")
        await self._bump(current_user.id)
        return {"deleted": True}

    async def get_roles_for_matching(self, recruiter_id: str | None = None) -> list[dict]:
        query: dict[str, Any] = {}
        if recruiter_id:
            query["recruiter_id"] = recruiter_id
        roles = await database.recruiter_kb_roles.find(query).sort("title", 1).to_list(length=500)
        # Attach certification docs by id and by title
        all_certs = await database.recruiter_kb_certifications.find(query).to_list(length=500)
        by_id = {str(c["_id"]): c for c in all_certs}
        by_title = {(c.get("title") or "").strip().lower(): c for c in all_certs}

        enriched = []
        for role in roles:
            certs = []
            for cid in role.get("certification_ids") or []:
                c = by_id.get(str(cid))
                if c:
                    certs.append(c)
            for ref in role.get("required_certifications") or []:
                title = ref if isinstance(ref, str) else (ref.get("title") or "")
                c = by_title.get((title or "").strip().lower())
                if c and c not in certs:
                    certs.append(c)
            role = dict(role)
            role["certifications"] = [_public_cert(c) for c in certs]
            # Prefer structured cert titles for matching
            if certs and not role.get("required_certifications"):
                role["required_certifications"] = [c.get("title") for c in certs if c.get("title")]
            enriched.append(role)
        return enriched

    async def list_as_catalog_courses(self, recruiter_id: str | None = None) -> list[dict]:
        """Expose KB certifications as catalog-shaped course objects."""
        query: dict[str, Any] = {}
        if recruiter_id:
            query["recruiter_id"] = recruiter_id
        docs = await database.recruiter_kb_certifications.find(query).sort("title", 1).to_list(length=500)
        courses = []
        for doc in docs:
            hours = doc.get("estimated_hours")
            minutes = int(float(hours) * 60) if hours else None
            courses.append(
                {
                    "uid": f"recruiter_kb:{doc['_id']}",
                    "type": "certification",
                    "source": "recruiter_kb",
                    "category": "Recruiter",
                    "title": doc.get("title"),
                    "summary": doc.get("description") or "",
                    "url": doc.get("official_url") or "",
                    "duration_minutes": minutes,
                    "levels": [str(doc.get("difficulty") or "Intermediate").lower()],
                    "roles": [],
                    "products": doc.get("skills_covered") or [],
                    "subjects": doc.get("skills_covered") or [],
                    "provider": doc.get("provider"),
                    "estimated_hours": hours,
                    "priority": doc.get("priority"),
                    "icon_url": None,
                    "last_modified": _iso(doc.get("updated_at")),
                }
            )
        return courses

    async def find_role_by_title(self, title: str, recruiter_id: str | None = None) -> dict | None:
        if not title:
            return None
        query: dict[str, Any] = {"title": {"$regex": f"^{title.strip()}$", "$options": "i"}}
        if recruiter_id:
            query["recruiter_id"] = recruiter_id
        roles = await self.get_roles_for_matching(recruiter_id)
        needle = title.strip().lower()
        for role in roles:
            if (role.get("title") or "").strip().lower() == needle:
                return role
        # Fuzzy contains
        for role in roles:
            rt = (role.get("title") or "").strip().lower()
            if needle in rt or rt in needle:
                return role
        return None


recruiter_kb_service = RecruiterKnowledgeBaseService()

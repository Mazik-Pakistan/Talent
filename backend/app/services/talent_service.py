"""Talent Management module — Phase 3, Epic 8 (US-090 through US-104).

Deliberately reuses everything Learning already built rather than
duplicating it:
  - Skills + categories (US-090/US-091)      -> app/services/learning_service.py
  - AI career path / skill gap (US-097/098)  -> learning_service + learning_path_service
  - Recommendations                          -> learning_service.get_recommendations

Everything below is new: career progression ladder, employee journey
timeline, internal opportunities, competency evaluation, talent search,
achievements, recruiter talent metrics, the recruiter-editable development
plan, and the aggregated 360 profile.

Nothing here calls an LLM. Every score/ranking is deterministic (reuses
role_matching_service, same as the rest of Phase 3), so none of this needs
caching/hash-invalidation the way the Gemini-backed endpoints do — it's
always cheap to compute from what's already in Mongo.
"""

from __future__ import annotations

import asyncio
import re
from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from fastapi import HTTPException, status

from app.core.database import database
from app.core.rbac import CurrentUser
from app.services import role_matching_service


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    if not na or not nb:
        return 0.0
    return dot / (na * nb)

def _now() -> datetime:
    return datetime.now(UTC)


def _iso(value: Any) -> str | None:
    if not value:
        return None
    if isinstance(value, str):
        return value
    return value.isoformat()


def _oid(value: str, field: str = "id") -> ObjectId:
    if not ObjectId.is_valid(value):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid {field}.")
    return ObjectId(value)


class TalentService:
    # ------------------------------------------------------------------ #
    # Shared helpers
    # ------------------------------------------------------------------ #
    async def _get_employee(self, current_user: CurrentUser) -> dict:
        employee = await database.employees.find_one(
            {"$or": [{"user_id": current_user.id}, {"email": current_user.email}], "status": "active"}
        )
        if not employee:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee profile not found.")
        return employee

    async def get_current_employee(self, current_user: CurrentUser) -> dict:
        return await self._get_employee(current_user)

    async def _get_employee_by_id(self, employee_id: str) -> dict:
        employee = await database.employees.find_one({"employee_id": employee_id})
        if not employee:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")
        return employee

    def _recruiter_id(self, employee: dict) -> str | None:
        rid = employee.get("recruiter_id")
        return str(rid) if rid else None

    async def _assert_recruiter_owns(self, current_user: CurrentUser, employee: dict) -> None:
        if current_user.role == "super_admin":
            return
        rid = self._recruiter_id(employee)
        if rid != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this employee.")

    async def _employee_skills(self, user_id: str) -> list[dict]:
        return await database.employee_skills.find({"user_id": user_id}).sort("skill_name", 1).to_list(length=500)

    async def _resume_fields_for_user(self, user_id: str) -> dict:
        if not user_id:
            return {}
        doc = await database.documents.find_one(
            {"owner_id": user_id, "doc_type": "resume", "is_active": True},
            sort=[("created_at", -1)],
        )
        if not doc:
            return {}
        return (doc.get("ocr_result") or {}).get("fields") or {}

    @staticmethod
    def _combine_skill_fields(resume_fields: dict | None, onboarding_skills: dict | None) -> dict:
        """Merge resume OCR + onboarding skills into the shape merge_skill_sources expects."""
        resume_fields = resume_fields or {}
        onboarding_skills = onboarding_skills or {}
        merged_fields = {
            "technical_skills": list(resume_fields.get("technical_skills") or [])
            + list(onboarding_skills.get("technical_skills") or []),
            "soft_skills": list(resume_fields.get("soft_skills") or [])
            + list(onboarding_skills.get("soft_skills") or []),
            "skills": list(resume_fields.get("skills") or []) + list(onboarding_skills.get("skills") or []),
        }
        for key in ("technical_skills", "soft_skills", "skills"):
            values = merged_fields[key]
            normalized: list[str] = []
            for value in values:
                if isinstance(value, str) and "," in value and len(value) > 40:
                    normalized.extend(part.strip() for part in value.split(",") if part.strip())
                elif isinstance(value, str) and value.strip():
                    normalized.append(value.strip())
                elif isinstance(value, dict):
                    label = (value.get("skill_name") or value.get("name") or "").strip()
                    if label:
                        normalized.append(label)
            merged_fields[key] = normalized
        return merged_fields

    async def _merged_skills_for_employee(self, employee: dict) -> list[dict]:
        """employee_skills + resume OCR + onboarding profile skills (same merge Learning uses)."""
        from app.services import resume_analysis_service

        user_id = employee.get("user_id") or ""
        manual = await self._employee_skills(user_id) if user_id else []
        resume_fields = await self._resume_fields_for_user(user_id)
        onboarding_skills = (employee.get("onboarding") or {}).get("skills") or {}
        certs = await self._employee_cert_docs(user_id) if user_id else []
        return resume_analysis_service.merge_skill_sources(
            manual_skills=manual,
            resume_fields=self._combine_skill_fields(resume_fields, onboarding_skills),
            certificate_skills=resume_analysis_service.extract_certificate_skill_list(certs),
        )

    async def _batch_merged_skills(self, employees: list[dict]) -> dict[str, list[dict]]:
        """Batch-load merged skills for many employees (search / metrics)."""
        from app.services import resume_analysis_service

        user_ids = [e.get("user_id") for e in employees if e.get("user_id")]
        if not user_ids:
            return {}

        skill_docs = await database.employee_skills.find({"user_id": {"$in": user_ids}}).to_list(length=20000)
        manual_by_user: dict[str, list[dict]] = {}
        for s in skill_docs:
            manual_by_user.setdefault(s["user_id"], []).append(s)

        resume_docs = await database.documents.find(
            {"owner_id": {"$in": user_ids}, "doc_type": "resume", "is_active": True},
            {"owner_id": 1, "ocr_result.fields": 1, "created_at": 1},
        ).sort("created_at", -1).to_list(length=5000)
        resume_by_user: dict[str, dict] = {}
        for doc in resume_docs:
            uid = doc.get("owner_id")
            if uid and uid not in resume_by_user:
                resume_by_user[uid] = (doc.get("ocr_result") or {}).get("fields") or {}

        cert_docs = await database.learning_certificates.find(
            {"user_id": {"$in": user_ids}, "verification_status": "verified"}
        ).to_list(length=20000)
        certs_by_user: dict[str, list[dict]] = {}
        for c in cert_docs:
            certs_by_user.setdefault(c["user_id"], []).append(c)

        out: dict[str, list[dict]] = {}
        for emp in employees:
            uid = emp.get("user_id")
            if not uid or uid in out:
                continue
            onboarding_skills = (emp.get("onboarding") or {}).get("skills") or {}
            out[uid] = resume_analysis_service.merge_skill_sources(
                manual_skills=manual_by_user.get(uid, []),
                resume_fields=self._combine_skill_fields(resume_by_user.get(uid, {}), onboarding_skills),
                certificate_skills=resume_analysis_service.extract_certificate_skill_list(
                    certs_by_user.get(uid, [])
                ),
            )
        return out

    async def _employee_cert_docs(self, user_id: str, *, verified_only: bool = True) -> list[dict]:
        query: dict[str, Any] = {"user_id": user_id}
        if verified_only:
            query["verification_status"] = "verified"
        return await database.learning_certificates.find(query).sort("created_at", 1).to_list(length=300)

    # ------------------------------------------------------------------ #
    # US-090 / US-091: Skill matrix (view over existing skills + categories)
    # ------------------------------------------------------------------ #
    async def _owned_skills_for_matrix(self, employee: dict) -> list[dict]:
        """Skills the employee has (manual, resume, and course/cert-earned profile skills)."""
        from app.services import resume_analysis_service

        user_id = employee.get("user_id") or ""
        # Includes source=course skills written after certificate verify / course completion.
        manual = await self._employee_skills(user_id) if user_id else []
        resume_fields = await self._resume_fields_for_user(user_id)
        onboarding_skills = (employee.get("onboarding") or {}).get("skills") or {}
        return resume_analysis_service.merge_skill_sources(
            manual_skills=manual,
            resume_fields=self._combine_skill_fields(resume_fields, onboarding_skills),
            certificate_skills=[],
        )

    async def skill_matrix(
        self, employee: dict, *, merged_skills: list[dict] | None = None
    ) -> dict:
        from app.schemas.learning import SKILL_CATEGORIES

        # Prefer owned-skill merge (no course/cert enrollment rows). Callers may still pass
        # a precomputed list; we still drop enrollment-shaped entries.
        skills = merged_skills if merged_skills is not None else await self._owned_skills_for_matrix(employee)
        cleaned: list[dict] = []
        for s in skills:
            name = (s.get("skill_name") or s.get("name") or s.get("skill") or "").strip()
            if not name:
                continue
            # Skip enrollment-shaped rows that are not real skill profile entries.
            if s.get("enrollment_id") or s.get("assignment_id"):
                continue
            if s.get("course_uid") and not name:
                continue
            source = (s.get("source") or "manual").lower()
            # Keep skills earned from verified courses/certs (source=course) on the matrix.
            if source in {"enrollment", "assignment"}:
                continue
            cleaned.append(s)

        by_category: dict[str, list[dict]] = {c: [] for c in SKILL_CATEGORIES}
        for s in cleaned:
            entry = {
                "id": s.get("id"),
                "skill_name": s.get("skill_name") or s.get("name") or s.get("skill"),
                "category": s.get("category") or "Other",
                "proficiency": s.get("proficiency"),
                "years_experience": s.get("years_experience"),
                "last_used_date": s.get("updated_at") if isinstance(s.get("updated_at"), str) else _iso(s.get("updated_at")),
                "verification_status": s.get("verification_status", "unverified"),
                "source": s.get("source", "manual"),
            }
            by_category.setdefault(entry["category"], []).append(entry)
        return {
            "categories": [
                {"category": cat, "skills": items, "count": len(items)}
                for cat, items in by_category.items()
                if items or cat in SKILL_CATEGORIES
            ],
            "total_skills": len(cleaned),
            "verified_count": len([s for s in cleaned if s.get("verification_status") == "verified"]),
        }

    # ------------------------------------------------------------------ #
    # US-093: Career progression roadmap
    # ------------------------------------------------------------------ #
    async def career_progression(
        self,
        employee: dict,
        *,
        merged_skills: list[dict] | None = None,
        certs: list[dict] | None = None,
    ) -> dict:
        skills = merged_skills if merged_skills is not None else await self._merged_skills_for_employee(employee)
        skill_names = [s.get("skill_name") for s in skills if s.get("skill_name")]
        cert_docs = certs if certs is not None else await self._employee_cert_docs(employee.get("user_id") or "")
        cert_titles = [c.get("course_title") for c in cert_docs if c.get("course_title")]

        # Prefer Organization Setup role ladders (same source as My Career).
        org_ladder = await self._org_framework_career_ladder(employee, skill_names, cert_titles)
        if org_ladder and org_ladder.get("ladder"):
            return org_ladder

        return {
            "current_title": employee.get("job_title"),
            "current_department": employee.get("department"),
            "ladder": [],
            "message": "No role ladder found for your department yet. Ask your recruiter to add your job title under Organization Setup → Role ladders.",
            "source": "none",
        }

    async def _org_framework_career_ladder(
        self,
        employee: dict,
        skill_names: list[str],
        cert_titles: list[str],
    ) -> dict | None:
        """Build a progression ladder from Organization Setup roles in the employee's dept."""
        org_id = employee.get("organization_id")
        if not org_id:
            return None

        roles = await database.org_framework_roles.find({"organization_id": org_id}).to_list(length=200)
        if not roles:
            return None

        department = (employee.get("department") or "").strip()
        if department:
            dept_roles = [
                r
                for r in roles
                if (r.get("department") or "").strip().lower() == department.lower()
            ]
            if dept_roles:
                roles = dept_roles

        if not roles:
            return None

        roles_sorted = sorted(roles, key=lambda r: (int(r.get("level_number") or 0), (r.get("name") or "").lower()))
        job_title = (employee.get("job_title") or "").strip().lower()
        current_role = next(
            (r for r in roles_sorted if (r.get("name") or "").strip().lower() == job_title),
            None,
        )
        next_role_name = ((current_role or {}).get("next_role") or "").strip().lower() or None

        # Pull readiness from active career assignment (same source as Promotion checklist).
        assignment = None
        if employee.get("employee_id"):
            assignment = await database.employee_career_assignments.find_one(
                {"employee_id": employee["employee_id"], "status": "active"}
            )
        # Refresh from verified certs / skills so ladder % matches the checklist ring.
        if assignment and employee.get("user_id"):
            try:
                from app.services.learning_service import learning_service as _learning

                await _learning._sync_career_assignment_progress(
                    user_id=employee["user_id"],
                    employee_id=employee.get("employee_id"),
                )
                assignment = await database.employee_career_assignments.find_one(
                    {"_id": assignment["_id"]}
                ) or assignment
            except Exception:
                pass

        assignment_readiness = (assignment or {}).get("overall_progress_percent")
        if assignment_readiness is None:
            assignment_readiness = (assignment or {}).get("readiness_score")
        try:
            assignment_readiness = (
                int(round(float(assignment_readiness)))
                if assignment_readiness is not None
                else None
            )
        except (TypeError, ValueError):
            assignment_readiness = None
        assignment_target = ((assignment or {}).get("target_role_title") or "").strip().lower()

        ladder = []
        for role in roles_sorted:
            name = (role.get("name") or "").strip()
            if not name:
                continue
            skill_docs = await database.org_framework_skills.find(
                {"organization_id": org_id, "role_name": name}
            ).to_list(length=100)
            cert_docs = await database.org_framework_certifications.find(
                {"organization_id": org_id, "role_name": name}
            ).to_list(length=100)
            required_skills = [s.get("skill_name") for s in skill_docs if s.get("skill_name")]
            required_certs = [c.get("certification_name") for c in cert_docs if c.get("certification_name")]
            role_def = {
                "title": name,
                "required_skills": required_skills,
                "required_certifications": required_certs,
            }
            match = role_matching_service.match_employee_to_role(
                employee_skills=skill_names,
                employee_certifications=cert_titles,
                role=role_def,
            )
            name_l = name.lower()
            is_current = name_l == job_title
            is_next = bool(next_role_name and name_l == next_role_name) or (
                bool(assignment_target) and name_l == assignment_target and not is_current
            )
            # Prefer career-path checklist progress over raw skill-name matching
            # (org skills tables are often empty → match returns 0% while checklist is 43%).
            progress = match["readiness_score"]
            if is_current:
                # Already in this role — show full readiness for the current rung.
                progress = 100
            elif is_next and assignment_readiness is not None:
                progress = assignment_readiness

            ladder.append(
                {
                    "title": name,
                    "description": role.get("description"),
                    "seniority_rank": int(role.get("level_number") or 0),
                    "is_current": is_current,
                    "is_next_step": is_next,
                    "required_skills": required_skills,
                    "required_certifications": required_certs,
                    "missing_skills": match["missing_skills"],
                    "missing_certifications": match["missing_certifications"],
                    "progress_percentage": progress,
                    "skill_match_percent": match["skill_match_percent"],
                    "certification_match_percent": match["certification_match_percent"],
                }
            )

        if not ladder:
            return None

        return {
            "current_title": employee.get("job_title"),
            "current_department": employee.get("department"),
            "ladder": ladder,
            "next_step": next((r for r in ladder if r["is_next_step"]), None),
            "source": "org_framework",
        }

    # ------------------------------------------------------------------ #
    # US-094: Chronological employee journey timeline
    # ------------------------------------------------------------------ #
    async def journey_timeline(self, employee: dict, *, event_types: list[str] | None = None) -> dict:
        events: list[dict] = []

        joined_at = employee.get("start_date") or employee.get("created_at")
        if joined_at:
            events.append(
                {
                    "type": "joined",
                    "title": "Joined the organization",
                    "detail": employee.get("job_title"),
                    "date": _iso(joined_at),
                }
            )

        career_events = await database.employee_career_events.find(
            {"employee_id": employee.get("employee_id")}
        ).sort("effective_date", 1).to_list(length=500)
        for ev in career_events:
            title_map = {
                "promoted": "Promotion",
                "title_change": "Title change",
                "department_change": "Department change",
                "manager_change": "Manager change",
                "status_change": "Status change",
            }
            events.append(
                {
                    "type": ev.get("event_type") or "career_event",
                    "title": title_map.get(ev.get("event_type"), "Career update"),
                    "detail": " → ".join(
                        [v for v in [ev.get("from_title") or ev.get("from_department"), ev.get("to_title") or ev.get("to_department")] if v]
                    )
                    or ev.get("note"),
                    "date": _iso(ev.get("effective_date")),
                }
            )

        certs = await self._employee_cert_docs(employee.get("user_id") or "")
        for c in certs:
            events.append(
                {
                    "type": "certification",
                    "title": f"Earned certification: {c.get('course_title')}",
                    "detail": c.get("issuing_organization"),
                    "date": _iso(c.get("verified_at") or c.get("created_at")),
                }
            )

        enrollments = await database.learning_enrollments.find(
            {"user_id": employee.get("user_id"), "status": "completed"}
        ).to_list(length=500)
        for e in enrollments:
            events.append(
                {
                    "type": "course_completed",
                    "title": f"Completed: {e.get('course_title')}",
                    "detail": None,
                    "date": _iso(e.get("completed_at") or e.get("updated_at")),
                }
            )

        # Include skills earned/upgraded from courses & certs (source often "course").
        skill_events = await database.employee_skills.find(
            {
                "user_id": employee.get("user_id"),
                "source": {"$in": ["ai_resume", "certificate", "course", "manual"]},
            }
        ).to_list(length=300)
        for s in skill_events:
            source = (s.get("source") or "manual").lower()
            if source == "manual" and (s.get("verification_status") or "").lower() != "verified":
                continue
            events.append(
                {
                    "type": "skill_improvement",
                    "title": f"Skill updated: {s.get('skill_name')}",
                    "detail": (
                        f"{s.get('proficiency') or 'Beginner'}"
                        + (f" · via {source}" if source in {"course", "certificate", "ai_resume"} else "")
                    ),
                    "date": _iso(s.get("updated_at") or s.get("created_at")),
                }
            )

        # Performance reviews intentionally omitted until KPI/performance
        # evaluation (US-081) ships — see US-094 acceptance note.

        events = [e for e in events if e.get("date")]
        if event_types:
            wanted = set(event_types)
            events = [e for e in events if e["type"] in wanted]
        events.sort(key=lambda e: e["date"])
        return {"timeline": events, "total": len(events)}

    # ------------------------------------------------------------------ #
    # US-101: Achievements
    # ------------------------------------------------------------------ #
    async def achievements(self, employee: dict) -> dict:
        certs = await self._employee_cert_docs(employee.get("user_id") or "")
        cert_items = [
            {
                "type": "certification",
                "title": c.get("course_title"),
                "issuer": c.get("issuing_organization"),
                "date": _iso(c.get("created_at")),
            }
            for c in certs
        ]

        enrollments = await database.learning_enrollments.find(
            {"user_id": employee.get("user_id"), "status": "completed"}
        ).to_list(length=500)
        course_items = [
            {
                "type": "learning_milestone",
                "title": f"Completed {e.get('course_title')}",
                "issuer": e.get("course_source"),
                "date": _iso(e.get("completed_at") or e.get("updated_at")),
            }
            for e in enrollments
        ]

        # Awards and performance-based achievements will populate once
        # Performance Management (US-081, Epic 7) is implemented; the
        # section is included empty rather than omitted so the frontend
        # doesn't need a schema change later.
        items = cert_items + course_items
        items = [i for i in items if i.get("date")]
        items.sort(key=lambda i: i["date"], reverse=True)
        return {
            "achievements": items,
            "awards": [],
            "total_certifications": len(cert_items),
            "total_completed_courses": len(course_items),
        }

    # ------------------------------------------------------------------ #
    # US-095: Internal opportunities
    # ------------------------------------------------------------------ #
    async def create_opportunity(self, current_user: CurrentUser, request: Any) -> dict:
        now = _now()
        doc = {
            **request.model_dump(exclude_none=False),
            "status": "open",
            "posted_by": current_user.id,
            "created_at": now,
            "updated_at": now,
        }
        result = await database.internal_opportunities.insert_one(doc)
        doc["_id"] = result.inserted_id
        return self._public_opportunity(doc)

    async def update_opportunity(self, current_user: CurrentUser, opportunity_id: str, request: Any) -> dict:
        oid = _oid(opportunity_id, "opportunity_id")
        existing = await database.internal_opportunities.find_one({"_id": oid})
        if not existing:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Opportunity not found.")
        if current_user.role != "super_admin" and existing.get("posted_by") != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized.")
        updates = {k: v for k, v in request.model_dump(exclude_unset=True).items() if v is not None}
        if updates:
            updates["updated_at"] = _now()
            await database.internal_opportunities.update_one({"_id": oid}, {"$set": updates})
        doc = await database.internal_opportunities.find_one({"_id": oid})
        return self._public_opportunity(doc)

    async def list_opportunities(
        self,
        current_user: CurrentUser,
        *,
        q: str | None = None,
        opp_type: str | None = None,
        department: str | None = None,
        status_filter: str = "open",
        page: int = 1,
        page_size: int = 20,
        for_employee: bool = False,
    ) -> dict:
        query: dict[str, Any] = {}
        if status_filter and status_filter != "all":
            query["status"] = status_filter
        if opp_type:
            query["type"] = opp_type
        if department:
            query["department"] = department
        if q and q.strip():
            term = re.escape(q.strip())
            query["$or"] = [
                {"title": {"$regex": term, "$options": "i"}},
                {"description": {"$regex": term, "$options": "i"}},
                {"required_skills": {"$regex": term, "$options": "i"}},
            ]

        total = await database.internal_opportunities.count_documents(query)
        cursor = (
            database.internal_opportunities.find(query)
            .sort("created_at", -1)
            .skip((page - 1) * page_size)
            .limit(page_size)
        )
        docs = await cursor.to_list(length=page_size)

        applied_ids: set[str] = set()
        if for_employee:
            apps = await database.internal_opportunity_applications.find(
                {"employee_id": current_user.id}
            ).to_list(length=500)
            applied_ids = {a["opportunity_id"] for a in apps}

        items = []
        for doc in docs:
            public = self._public_opportunity(doc)
            public["already_applied"] = str(doc["_id"]) in applied_ids
            items.append(public)

        pages = max(1, (total + page_size - 1) // page_size) if total else 1
        return {"opportunities": items, "total": total, "page": page, "page_size": page_size, "pages": pages}

    async def apply_to_opportunity(self, current_user: CurrentUser, opportunity_id: str) -> dict:
        oid = _oid(opportunity_id, "opportunity_id")
        opp = await database.internal_opportunities.find_one({"_id": oid})
        if not opp or opp.get("status") != "open":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Opportunity not open.")
        employee = await self._get_employee(current_user)

        existing = await database.internal_opportunity_applications.find_one(
            {"opportunity_id": opportunity_id, "employee_id": current_user.id}
        )
        if existing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Already applied.")

        # Eligibility check (US-095 AC: "Eligibility validated"): department
        # match OR at least one required skill already on the employee's
        # profile (tracked matrix + resume/onboarding). Not a hard block —
        # flagged so the employee can see why.
        merged = await self._merged_skills_for_employee(employee)
        skills = {s.lower() for s in [sk.get("skill_name") for sk in merged if sk.get("skill_name")]}
        required = {s.lower() for s in (opp.get("required_skills") or [])}
        eligible = (not required) or bool(skills & required) or (employee.get("department") == opp.get("department"))

        now = _now()
        doc = {
            "opportunity_id": opportunity_id,
            "employee_id": current_user.id,
            "employee_name": employee.get("full_name"),
            "eligible": eligible,
            "status": "applied",
            "applied_at": now,
        }
        await database.internal_opportunity_applications.insert_one(doc)
        return {"applied": True, "eligible": eligible, "applied_at": _iso(now)}

    async def list_opportunity_applicants(self, current_user: CurrentUser, opportunity_id: str) -> dict:
        oid = _oid(opportunity_id, "opportunity_id")
        opp = await database.internal_opportunities.find_one({"_id": oid})
        if not opp:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Opportunity not found.")
        apps = await database.internal_opportunity_applications.find(
            {"opportunity_id": opportunity_id}
        ).sort("applied_at", -1).to_list(length=500)
        return {
            "applicants": [
                {
                    "employee_id": a["employee_id"],
                    "employee_name": a.get("employee_name"),
                    "eligible": a.get("eligible"),
                    "status": a.get("status"),
                    "applied_at": _iso(a.get("applied_at")),
                }
                for a in apps
            ],
            "total": len(apps),
        }

    def _public_opportunity(self, doc: dict) -> dict:
        return {
            "id": str(doc["_id"]),
            "title": doc.get("title"),
            "type": doc.get("type"),
            "department": doc.get("department"),
            "description": doc.get("description"),
            "required_skills": doc.get("required_skills") or [],
            "location": doc.get("location"),
            "commitment": doc.get("commitment"),
            "status": doc.get("status"),
            "closes_at": _iso(doc.get("closes_at")),
            "created_at": _iso(doc.get("created_at")),
        }

    # ------------------------------------------------------------------ #
    # US-099: Competency evaluation
    # ------------------------------------------------------------------ #
    async def submit_competency_evaluation(self, current_user: CurrentUser, employee_id: str, request: Any) -> dict:
        employee = await self._get_employee_by_id(employee_id)
        await self._assert_recruiter_owns(current_user, employee)

        data = request.model_dump()
        comments = data.pop("comments", None)
        overall = round(sum(data.values()) / len(data), 2)

        now = _now()
        doc = {
            "employee_id": employee_id,
            "evaluator_id": current_user.id,
            "scores": data,
            "overall_score": overall,
            "comments": comments,
            "evaluated_at": now,
        }
        result = await database.talent_competency_evaluations.insert_one(doc)
        doc["_id"] = result.inserted_id
        return self._public_competency(doc)

    async def get_competency_history(self, current_user: CurrentUser, employee_id: str) -> dict:
        employee = await self._get_employee_by_id(employee_id)
        if current_user.role == "employee" and employee.get("user_id") != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized.")
        elif current_user.role == "recruiter":
            await self._assert_recruiter_owns(current_user, employee)

        docs = await database.talent_competency_evaluations.find(
            {"employee_id": employee_id}
        ).sort("evaluated_at", -1).to_list(length=100)
        evaluations = [self._public_competency(d) for d in docs]
        latest = evaluations[0] if evaluations else None
        trend = None
        if len(evaluations) >= 2:
            trend = round(evaluations[0]["overall_score"] - evaluations[1]["overall_score"], 2)
        return {"evaluations": evaluations, "latest": latest, "trend": trend}

    def _public_competency(self, doc: dict) -> dict:
        return {
            "id": str(doc["_id"]),
            "evaluator_id": doc.get("evaluator_id"),
            "scores": doc.get("scores"),
            "overall_score": doc.get("overall_score"),
            "comments": doc.get("comments"),
            "evaluated_at": _iso(doc.get("evaluated_at")),
        }

    # ------------------------------------------------------------------ #
    # US-100: Talent search
    # ------------------------------------------------------------------ #
    async def search_talent(self, current_user: CurrentUser, request: Any) -> dict:
        query: dict[str, Any] = {"status": "active"}
        if current_user.role != "super_admin":
            query["recruiter_id"] = current_user.id
        if request.department:
            query["department"] = request.department

        candidates = await database.employees.find(query).to_list(length=2000)

        user_ids = [c.get("user_id") for c in candidates if c.get("user_id")]
        emp_ids = [c.get("employee_id") for c in candidates if c.get("employee_id")]

        merged_skills_by_user = await self._batch_merged_skills(candidates)
        skills_by_user: dict[str, list[str]] = {
            uid: [s.get("skill_name") for s in skills if s.get("skill_name")]
            for uid, skills in merged_skills_by_user.items()
        }

        certs_by_user: dict[str, list[str]] = {}
        if user_ids:
            cert_docs = await database.learning_certificates.find(
                {"user_id": {"$in": user_ids}, "verification_status": "verified"}
            ).to_list(length=10000)
            for c in cert_docs:
                certs_by_user.setdefault(c["user_id"], []).append(c.get("course_title") or "")

        progress_by_emp: dict[str, float] = {}
        if emp_ids:
            assignments = await database.learning_assignments.find(
                {"employee_id": {"$in": emp_ids}}
            ).to_list(length=10000)
            grouped: dict[str, list[dict]] = {}
            for a in assignments:
                grouped.setdefault(a["employee_id"], []).append(a)
            for eid, items in grouped.items():
                done = len([i for i in items if i.get("status") == "completed"])
                progress_by_emp[eid] = round(100 * done / len(items), 1) if items else 0.0

        competency_by_emp: dict[str, float] = {}
        if emp_ids:
            eval_docs = await database.talent_competency_evaluations.find(
                {"employee_id": {"$in": emp_ids}}
            ).sort("evaluated_at", -1).to_list(length=5000)
            for ev in eval_docs:
                eid = ev.get("employee_id")
                if eid and eid not in competency_by_emp:
                    competency_by_emp[eid] = float(ev.get("overall_score") or 0)

        # Optional semantic boost via BGE-M3 resume embeddings (candidates collection).
        semantic_scores: dict[str, float] = {}
        search_mode = "keyword"
        q_lower = (request.q or "").strip().lower()
        use_semantic = bool(getattr(request, "semantic", False) and q_lower)
        if use_semantic:
            try:
                from app.services.embedding_service import embeddings_available, generate_embedding

                if embeddings_available():
                    query_emb = await generate_embedding(request.q.strip())
                    if query_emb and query_emb.get("vector"):
                        emb_docs = await database.candidates.find(
                            {
                                "user_id": {"$in": user_ids},
                                "resume_embedding.vector": {"$exists": True},
                            },
                            {"user_id": 1, "resume_embedding": 1},
                        ).to_list(length=2000)
                        for doc in emb_docs:
                            vec = (doc.get("resume_embedding") or {}).get("vector")
                            uid = doc.get("user_id")
                            if uid and vec:
                                semantic_scores[uid] = _cosine(query_emb["vector"], vec)
                        if semantic_scores:
                            search_mode = "hybrid"
            except Exception:
                search_mode = "keyword"

        wanted_skills = {s.lower() for s in request.skills}
        wanted_certs = {c.lower() for c in request.certifications}

        results = []
        for c in candidates:
            uid = c.get("user_id") or ""
            eid = c.get("employee_id") or ""
            emp_skills = [s for s in skills_by_user.get(uid, []) if s]
            emp_certs = [s for s in certs_by_user.get(uid, []) if s]
            learning_progress = progress_by_emp.get(eid, 0.0)
            performance_rating = c.get("performance_rating")  # populated once KPI ships
            years_experience = c.get("years_experience")
            competency_score = competency_by_emp.get(eid)

            if wanted_skills and not (wanted_skills & {s.lower() for s in emp_skills}):
                continue
            if wanted_certs and not (wanted_certs & {s.lower() for s in emp_certs}):
                continue
            if request.min_learning_progress is not None and learning_progress < request.min_learning_progress:
                continue
            if request.min_experience_years is not None and (years_experience or 0) < request.min_experience_years:
                continue
            if (
                request.min_performance_rating is not None
                and performance_rating is not None
                and performance_rating < request.min_performance_rating
            ):
                continue
            if (
                request.min_competency_score is not None
                and (competency_score is None or competency_score < request.min_competency_score)
            ):
                continue

            haystack = " ".join(
                [
                    c.get("full_name") or "",
                    c.get("job_title") or "",
                    c.get("department") or "",
                    " ".join(emp_skills),
                    " ".join(emp_certs),
                ]
            ).lower()
            score = 1.0
            keyword_hit = True
            if q_lower:
                keyword_hit = q_lower in haystack
                if keyword_hit:
                    score = 2.0 if q_lower in (c.get("full_name") or "").lower() else 1.0
                elif search_mode != "hybrid" or uid not in semantic_scores:
                    continue
                else:
                    score = 0.5
            score += 0.1 * len(wanted_skills & {s.lower() for s in emp_skills})
            if uid in semantic_scores:
                score += max(0.0, semantic_scores[uid]) * 3.0

            results.append(
                {
                    "employee_id": eid,
                    "full_name": c.get("full_name"),
                    "job_title": c.get("job_title"),
                    "department": c.get("department"),
                    "skills": emp_skills[:12],
                    "certifications": emp_certs[:8],
                    "years_experience": years_experience,
                    "performance_rating": performance_rating,
                    "learning_progress": learning_progress,
                    "competency_score": competency_score,
                    "_score": score,
                }
            )

        results.sort(key=lambda r: -r["_score"])
        total = len(results)
        start = (request.page - 1) * request.page_size
        page_items = results[start : start + request.page_size]
        for r in page_items:
            r.pop("_score", None)

        pages = max(1, (total + request.page_size - 1) // request.page_size) if total else 1
        return {
            "employees": page_items,
            "total": total,
            "page": request.page,
            "page_size": request.page_size,
            "pages": pages,
            "search_mode": search_mode,
        }

    # ------------------------------------------------------------------ #
    # US-102: Recruiter talent metrics dashboard
    # ------------------------------------------------------------------ #
    async def talent_metrics(self, current_user: CurrentUser, *, department: str | None = None) -> dict:
        query: dict[str, Any] = {"status": "active"}
        if current_user.role != "super_admin":
            query["recruiter_id"] = current_user.id
        if department:
            query["department"] = department

        employees = await database.employees.find(query).to_list(length=5000)
        user_ids = [e.get("user_id") for e in employees if e.get("user_id")]
        emp_ids = [e.get("employee_id") for e in employees if e.get("employee_id")]

        merged_by_user = await self._batch_merged_skills(employees)
        skill_distribution: dict[str, int] = {}
        skills_per_user: dict[str, int] = {}
        for uid, skills in merged_by_user.items():
            skills_per_user[uid] = len(skills)
            for s in skills:
                cat = s.get("category") or "Other"
                skill_distribution[cat] = skill_distribution.get(cat, 0) + 1

        certs = (
            await database.learning_certificates.find({"user_id": {"$in": user_ids}}).to_list(length=20000)
            if user_ids
            else []
        )
        verified_certs = [c for c in certs if c.get("verification_status") == "verified"]
        certification_stats = {
            "total_certificates": len(certs),
            "verified": len(verified_certs),
            "pending": len([c for c in certs if c.get("verification_status") == "pending"]),
            "certification_rate": round(100 * len(verified_certs) / len(certs), 1) if certs else 0.0,
        }

        assignments = (
            await database.learning_assignments.find({"employee_id": {"$in": emp_ids}}).to_list(length=20000)
            if emp_ids
            else []
        )
        completed = len([a for a in assignments if a.get("status") == "completed"])
        learning_completion = round(100 * completed / len(assignments), 1) if assignments else 0.0

        # High potential / promotion readiness: employees with a verified
        # certificate AND at least 5 tracked skills (matrix + resume/onboarding),
        # deterministic proxy until Performance Management (US-081) supplies a rating.
        verified_by_user: dict[str, int] = {}
        for c in verified_certs:
            verified_by_user[c["user_id"]] = verified_by_user.get(c["user_id"], 0) + 1

        high_potential = []
        for e in employees:
            uid = e.get("user_id") or ""
            skill_count = skills_per_user.get(uid, 0)
            cert_count = verified_by_user.get(uid, 0)
            if skill_count >= 5 and cert_count >= 1:
                high_potential.append(
                    {
                        "employee_id": e.get("employee_id"),
                        "full_name": e.get("full_name"),
                        "job_title": e.get("job_title"),
                        "department": e.get("department"),
                        "skill_count": skill_count,
                        "verified_certifications": cert_count,
                    }
                )
        high_potential.sort(key=lambda h: (-h["verified_certifications"], -h["skill_count"]))

        dept_stats: dict[str, dict[str, int]] = {}
        for e in employees:
            dept = e.get("department") or "Unassigned"
            uid = e.get("user_id") or ""
            bucket = dept_stats.setdefault(dept, {"headcount": 0, "skills_tracked": 0})
            bucket["headcount"] += 1
            bucket["skills_tracked"] += skills_per_user.get(uid, 0)

        return {
            "headcount": len(employees),
            "skill_distribution": [{"category": k, "count": v} for k, v in sorted(skill_distribution.items(), key=lambda kv: -kv[1])],
            "high_potential_employees": high_potential[:20],
            "certification_stats": certification_stats,
            "promotion_readiness_count": len(high_potential),
            "learning_completion_rate": learning_completion,
            "department_skill_analysis": [
                {"department": dept, **stats} for dept, stats in sorted(dept_stats.items())
            ],
        }

    # ------------------------------------------------------------------ #
    # US-103: Development plan (recruiter-editable overlay on the
    # employee's existing AI-generated career path)
    # ------------------------------------------------------------------ #
    async def get_development_plan(self, current_user: CurrentUser, employee_id: str) -> dict:
        employee = await self._get_employee_by_id(employee_id)
        if current_user.role == "employee" and employee.get("user_id") != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized.")
        elif current_user.role == "recruiter":
            await self._assert_recruiter_owns(current_user, employee)

        goal = await database.learning_career_goals.find_one({"user_id": employee.get("user_id")})
        ai_path = (goal or {}).get("ai_path") or {}
        overlay = await database.talent_development_plans.find_one({"employee_id": employee_id})

        milestones = []
        overlay_by_id = {m["id"]: m for m in (overlay or {}).get("milestones", [])}
        for step in ai_path.get("path") or []:
            step_id = str(step.get("course", {}).get("uid") or step.get("step"))
            saved = overlay_by_id.get(step_id, {})
            milestones.append(
                {
                    "id": step_id,
                    "title": step.get("course", {}).get("title") or step.get("skill"),
                    "kind": step.get("kind"),
                    "skill": step.get("skill"),
                    "estimated_hours": step.get("estimated_hours"),
                    "completed": step.get("completed", False),
                    "status": saved.get("status") or ("completed" if step.get("completed") else "pending"),
                    "due_date": _iso(saved.get("due_date")),
                    "note": saved.get("note"),
                }
            )

        done = len([m for m in milestones if m["status"] == "completed"])
        progress_percentage = round(100 * done / len(milestones), 1) if milestones else 0.0

        return {
            "employee_id": employee_id,
            "target_role": (goal or {}).get("target_role"),
            "required_skills": ai_path.get("missing_skills") or [],
            "milestones": milestones,
            "target_timeline": (overlay or {}).get("target_timeline") or ai_path.get("summary"),
            "recruiter_note": (overlay or {}).get("recruiter_note"),
            "progress_percentage": progress_percentage,
            "readiness_percentage": ai_path.get("readiness_percentage"),
            "last_updated": _iso((overlay or {}).get("updated_at") or ai_path.get("generated_at")),
        }

    async def update_development_plan(self, current_user: CurrentUser, employee_id: str, request: Any) -> dict:
        employee = await self._get_employee_by_id(employee_id)
        await self._assert_recruiter_owns(current_user, employee)

        milestones = [m.model_dump(exclude_none=True) for m in request.milestones]
        now = _now()
        await database.talent_development_plans.update_one(
            {"employee_id": employee_id},
            {
                "$set": {
                    "employee_id": employee_id,
                    "milestones": milestones,
                    "target_timeline": request.target_timeline,
                    "recruiter_note": request.recruiter_note,
                    "updated_by": current_user.id,
                    "updated_at": now,
                },
                "$setOnInsert": {"created_at": now},
            },
            upsert=True,
        )
        return await self.get_development_plan(current_user, employee_id)

    # ------------------------------------------------------------------ #
    # US-104: Aggregated 360 profile
    # ------------------------------------------------------------------ #
    async def get_talent_profile(self, current_user: CurrentUser, employee_id: str) -> dict:
        employee = await self._get_employee_by_id(employee_id)
        if current_user.role == "employee" and employee.get("user_id") != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized.")
        elif current_user.role == "recruiter":
            await self._assert_recruiter_owns(current_user, employee)

        emp_id = employee.get("employee_id")
        user_id = employee.get("user_id")

        # Owned skills for matrix; fuller merge (incl. cert-derived) for role matching only.
        owned_skills, merged_skills, certs = await asyncio.gather(
            self._owned_skills_for_matrix(employee),
            self._merged_skills_for_employee(employee),
            self._employee_cert_docs(user_id or ""),
        )

        (
            skill_matrix,
            journey,
            achievements,
            progression,
            competency,
            dev_plan,
            goal,
            recommendations,
            assignments,
            enrollments,
        ) = await asyncio.gather(
            self.skill_matrix(employee, merged_skills=owned_skills),
            self.journey_timeline(employee),
            self.achievements(employee),
            self.career_progression(employee, merged_skills=merged_skills, certs=certs),
            self.get_competency_history(current_user, employee_id),
            self.get_development_plan(current_user, employee_id),
            database.learning_career_goals.find_one({"user_id": user_id}) if user_id else asyncio.sleep(0, result=None),
            database.learning_ai_recommendations.find_one({"user_id": user_id}) if user_id else asyncio.sleep(0, result=None),
            (
                database.learning_assignments.find({"employee_id": emp_id}).sort("created_at", -1).to_list(length=100)
                if emp_id
                else asyncio.sleep(0, result=[])
            ),
            (
                database.learning_enrollments.find({"user_id": user_id}).sort("updated_at", -1).to_list(length=100)
                if user_id
                else asyncio.sleep(0, result=[])
            ),
        )

        completed_assignments = [a for a in assignments if a.get("status") == "completed"]
        mandatory_open = [
            a for a in assignments if a.get("mandatory") and a.get("status") != "completed"
        ]

        return {
            "personal_profile": {
                "employee_id": employee.get("employee_id"),
                "full_name": employee.get("full_name"),
                "email": employee.get("email"),
                "job_title": employee.get("job_title"),
                "department": employee.get("department"),
                "status": employee.get("status"),
                "start_date": _iso(employee.get("start_date")),
            },
            "skills": skill_matrix,
            "learning_history": {
                "certificates_earned": len(certs),
                "assignments_total": len(assignments),
                "assignments_completed": len(completed_assignments),
                "enrollments_total": len(enrollments),
                "mandatory_outstanding": len(mandatory_open),
                "recent_assignments": [
                    {
                        "course_title": a.get("course_title"),
                        "status": a.get("status"),
                        "due_date": _iso(a.get("due_date")),
                        "mandatory": bool(a.get("mandatory")),
                    }
                    for a in assignments[:8]
                ],
                "recent_enrollments": [
                    {
                        "course_title": e.get("course_title"),
                        "progress_percent": e.get("progress_percent"),
                        "status": e.get("status"),
                    }
                    for e in enrollments[:8]
                ],
            },
            "certifications": [
                {"title": c.get("course_title"), "issuer": c.get("issuing_organization"), "date": _iso(c.get("created_at"))}
                for c in certs
            ],
            "performance_ratings": {
                "note": "Populated once Performance Management / KPI evaluation is implemented.",
            },
            "goals": {"target_role": (goal or {}).get("target_role")},
            "promotion_readiness": progression.get("next_step"),
            "ai_insights": {
                "recommendations": (recommendations or {}).get("recommendations") or [],
                "career_path_readiness": (goal or {}).get("ai_path", {}).get("readiness_percentage"),
            },
            "career_timeline": journey,
            "achievements": achievements,
            "competency_evaluations": competency,
            "development_plan": dev_plan,
            "career_progression": progression,
            "generated_at": _iso(_now()),
        }

    # ------------------------------------------------------------------ #
    # Requirements not fulfilled (Talent Progress CIC)
    # ------------------------------------------------------------------ #
    # Only actionable verification failures — not generic "pending" / OCR-in-progress.
    _PROBLEM_DOC_STATUSES = {
        "pending_verification",
        "reupload_required",
        "rejected",
        "mismatch",
    }

    _PROFILE_LABELS = {
        "emergency": "Emergency contact",
        "employment": "Bank & payroll details",
        "references": "Professional references",
        "documents": "Company policy acknowledgements",
        "nda": "Self Declaration (NDA)",
    }

    def _requirement_item(
        self,
        *,
        category: str,
        code: str,
        label: str,
        status: str,
        severity: str,
        source: str,
        action_hint: str,
    ) -> dict:
        return {
            "category": category,
            "code": code,
            "label": label,
            "status": status,
            "severity": severity,
            "source": source,
            "actionHint": action_hint,
        }

    def _profile_missing_keys(self, employee: dict) -> list[str]:
        onboarding = employee.get("onboarding") or {}
        keys = ["emergency", "employment", "references", "documents", "nda"]
        if not bool(employee.get("is_remote")):
            keys = [k for k in keys if k != "employment"]
        return [k for k in keys if not onboarding.get(k)]

    async def _build_employee_requirements(
        self,
        employee: dict,
        *,
        docs_by_owner: dict[str, list[dict]] | None = None,
        assignment_by_emp: dict[str, dict] | None = None,
        skill_count_by_user: dict[str, int] | None = None,
        enroll_count_by_user: dict[str, int] | None = None,
        cert_count_by_user: dict[str, int] | None = None,
    ) -> dict:
        employee_id = employee.get("employee_id") or ""
        user_id = employee.get("user_id") or ""
        onboarding = employee.get("onboarding") or {}
        items: list[dict] = []

        # Post-hire profile — trust explicit complete status (matches Employees UI).
        profile_status = (employee.get("profile_status") or "").strip().lower()
        if profile_status != "complete":
            for key in self._profile_missing_keys(employee):
                items.append(
                    self._requirement_item(
                        category="profile",
                        code=f"profile_{key}",
                        label=self._PROFILE_LABELS.get(key, key.replace("_", " ").title()),
                        status="missing",
                        severity="high",
                        source="employee.profile_status",
                        action_hint="Complete post-hire profile steps on the employee profile page.",
                    )
                )

        # CV / resume
        resume_ob = onboarding.get("resume") or {}
        has_resume_ob = bool(resume_ob.get("file_url") or resume_ob.get("file_name"))
        owner_docs = (docs_by_owner or {}).get(user_id, [])
        resume_docs = [d for d in owner_docs if (d.get("doc_type") or "").lower() == "resume"]
        has_resume_doc = bool(resume_docs)
        if not has_resume_ob and not has_resume_doc:
            items.append(
                self._requirement_item(
                    category="cv_resume",
                    code="resume_missing",
                    label="CV / resume not on file",
                    status="missing",
                    severity="high",
                    source="onboarding.resume|documents",
                    action_hint="Ask the employee to upload a resume, or attach one in Documents.",
                )
            )
        else:
            bad_resume = [
                d
                for d in resume_docs
                if (d.get("status") or d.get("verification_status") or "").lower() in self._PROBLEM_DOC_STATUSES
            ]
            if bad_resume:
                items.append(
                    self._requirement_item(
                        category="cv_resume",
                        code="resume_unverified",
                        label="CV / resume needs verification or reupload",
                        status=(bad_resume[0].get("status") or bad_resume[0].get("verification_status") or "pending"),
                        severity="high",
                        source="documents",
                        action_hint="Review the resume in Document verification.",
                    )
                )

        # Identity / government docs — only flag true gaps or verification failures.
        gov = onboarding.get("government_docs") or {}
        gov_list = gov.get("documents") or []
        identity_docs = [
            d
            for d in owner_docs
            if (d.get("doc_type") or "").lower()
            in {"cnic", "national_id", "passport", "government_id", "id_card", "nic"}
            or (d.get("category") or "").lower() in {"identity", "government"}
        ]
        identity_ids = {str(d.get("_id") or d.get("id") or id(d)) for d in identity_docs}

        def _doc_problem(d: dict) -> bool:
            st = (d.get("status") or "").lower()
            vs = (d.get("verification_status") or "").lower()
            return st in self._PROBLEM_DOC_STATUSES or vs in self._PROBLEM_DOC_STATUSES

        if not gov_list and not identity_docs:
            items.append(
                self._requirement_item(
                    category="identity_docs",
                    code="identity_missing",
                    label="Identity / government documents missing",
                    status="missing",
                    severity="high",
                    source="onboarding.government_docs|documents",
                    action_hint="Collect identity documents and verify them on the employee Documents tab.",
                )
            )
        else:
            problem_ids = [d for d in identity_docs if _doc_problem(d)]
            if problem_ids:
                items.append(
                    self._requirement_item(
                        category="identity_docs",
                        code="identity_pending",
                        label="Identity documents need verification or reupload",
                        status="pending_verification",
                        severity="high",
                        source="documents",
                        action_hint="Open the employee Documents tab to verify or request reupload.",
                    )
                )

        # Other problem documents (exclude resume + identity already covered)
        other_problems = [
            d
            for d in owner_docs
            if (d.get("doc_type") or "").lower() != "resume"
            and str(d.get("_id") or d.get("id") or id(d)) not in identity_ids
            and _doc_problem(d)
        ]
        if other_problems:
            items.append(
                self._requirement_item(
                    category="identity_docs",
                    code="docs_attention",
                    label=f"{len(other_problems)} document(s) need attention",
                    status="pending_verification",
                    severity="high",
                    source="documents",
                    action_hint="Open the employee Documents tab to clear rejected/reupload items.",
                )
            )

        # Career path — missing path is incomplete setup; readiness % is NOT a "requirement".
        assignment = (assignment_by_emp or {}).get(employee_id)
        has_target = bool(
            assignment
            and (assignment.get("target_level_id") or assignment.get("target_role_title") or assignment.get("target_role"))
        )
        if not has_target:
            items.append(
                self._requirement_item(
                    category="career_path",
                    code="career_path_missing",
                    label="No career path / promotion target assigned",
                    status="missing",
                    severity="medium",
                    source="employee_career_assignments",
                    action_hint="Add this job title to Organization Setup → Role ladders, or assign a target from the Promotion Pipeline.",
                )
            )
        else:
            def _named_open(entries, *, done_statuses):
                open_items = []
                for entry in entries or []:
                    if isinstance(entry, str):
                        if entry.strip():
                            open_items.append(entry)
                        continue
                    if not isinstance(entry, dict):
                        continue
                    label = (entry.get("skill") or entry.get("name") or entry.get("certification") or entry.get("title") or "").strip()
                    status_val = (entry.get("current_status") or entry.get("status") or "not_started").lower()
                    if label and status_val not in done_statuses:
                        open_items.append(label)
                return open_items

            open_skills = _named_open(
                assignment.get("skills_to_acquire") or assignment.get("missing_skills") or [],
                done_statuses={"acquired", "earned", "completed"},
            )
            open_certs = _named_open(
                assignment.get("certifications_to_earn") or assignment.get("missing_certifications") or [],
                done_statuses={"earned", "completed", "acquired"},
            )
            if open_skills:
                items.append(
                    self._requirement_item(
                        category="roadmap_gaps",
                        code="skills_gap",
                        label=f"{len(open_skills)} skill gap(s) for promotion target",
                        status="incomplete",
                        severity="medium",
                        source="career_assignment",
                        action_hint="Review Skills and assign learning to close gaps.",
                    )
                )
            if open_certs:
                items.append(
                    self._requirement_item(
                        category="roadmap_gaps",
                        code="certs_gap",
                        label=f"{len(open_certs)} certification gap(s) for promotion target",
                        status="incomplete",
                        severity="medium",
                        source="career_assignment",
                        action_hint="Track certifications on the Progress tab.",
                    )
                )

        # Learning / skill matrix empty
        skill_n = (skill_count_by_user or {}).get(user_id, 0)
        enroll_n = (enroll_count_by_user or {}).get(user_id, 0)
        cert_n = (cert_count_by_user or {}).get(user_id, 0)
        onboarding_skills = onboarding.get("skills") or {}
        has_onboarding_skills = bool(
            onboarding_skills.get("technical_skills")
            or onboarding_skills.get("soft_skills")
            or onboarding_skills.get("skills")
        )
        if skill_n == 0 and not has_onboarding_skills:
            items.append(
                self._requirement_item(
                    category="learning_empty",
                    code="skills_not_assessed",
                    label="Skill matrix not assessed / no skills data yet",
                    status="empty",
                    severity="low",
                    source="employee_skills",
                    action_hint="Run skill assessment from Learning after a resume is on file.",
                )
            )
        if enroll_n == 0 and cert_n == 0:
            items.append(
                self._requirement_item(
                    category="learning_empty",
                    code="learning_not_started",
                    label="No learning enrollments or certificates yet",
                    status="empty",
                    severity="low",
                    source="learning",
                    action_hint="Assign courses from Learning or the promotion path.",
                )
            )

        open_high = len([i for i in items if i["severity"] == "high"])
        open_total = len(items)
        by_category: dict[str, int] = {}
        for i in items:
            by_category[i["category"]] = by_category.get(i["category"], 0) + 1

        return {
            "employee_id": employee_id,
            "full_name": employee.get("full_name") or "—",
            "job_title": employee.get("job_title") or "—",
            "department": employee.get("department") or "—",
            "profile_status": employee.get("profile_status")
            or ("incomplete" if self._profile_missing_keys(employee) else "complete"),
            "open_high": open_high,
            "open_total": open_total,
            "top_codes": [i["code"] for i in items[:5]],
            "by_category": by_category,
            "items": items,
            "all_met": open_total == 0,
        }

    async def requirements_status(
        self,
        current_user: CurrentUser,
        *,
        department: str | None = None,
        role: str | None = None,
        employee_id: str | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> dict:
        if employee_id:
            employee = await self._get_employee_by_id(employee_id)
            await self._assert_recruiter_owns(current_user, employee)
            user_id = employee.get("user_id") or ""
            docs = (
                await database.documents.find({"owner_id": user_id, "is_active": True}).to_list(length=200)
                if user_id
                else []
            )
            assignment = await database.employee_career_assignments.find_one(
                {"employee_id": employee_id, "status": "active"}
            )
            if not assignment:
                try:
                    from app.services.career_framework_service import career_framework_service

                    ensured = await career_framework_service.ensure_org_career_assignment(employee)
                    if ensured:
                        assignment = await database.employee_career_assignments.find_one(
                            {"employee_id": employee_id, "status": "active"}
                        )
                except Exception:
                    pass
            skill_n = (
                await database.employee_skills.count_documents({"user_id": user_id}) if user_id else 0
            )
            enroll_n = (
                await database.learning_enrollments.count_documents({"user_id": user_id}) if user_id else 0
            )
            cert_n = (
                await database.learning_certificates.count_documents({"user_id": user_id}) if user_id else 0
            )
            detail = await self._build_employee_requirements(
                employee,
                docs_by_owner={user_id: docs} if user_id else {},
                assignment_by_emp={employee_id: assignment} if assignment else {},
                skill_count_by_user={user_id: skill_n} if user_id else {},
                enroll_count_by_user={user_id: enroll_n} if user_id else {},
                cert_count_by_user={user_id: cert_n} if user_id else {},
            )
            return {
                "mode": "employee",
                "employee": detail,
                "items": detail["items"],
                "all_met": detail["all_met"],
                "open_high": detail["open_high"],
                "open_total": detail["open_total"],
                "by_category": detail["by_category"],
            }

        query: dict[str, Any] = {"status": {"$in": ["active", "inactive", "on_leave"]}}
        if current_user.role != "super_admin":
            query["recruiter_id"] = current_user.id
        if department:
            query["department"] = department

        employees = await database.employees.find(query).sort("full_name", 1).to_list(length=500)
        if role:
            role_key = role.strip().lower()
            employees = [
                e for e in employees if (e.get("job_title") or "").strip().lower() == role_key
            ]

        user_ids = [e.get("user_id") for e in employees if e.get("user_id")]
        emp_ids = [e.get("employee_id") for e in employees if e.get("employee_id")]

        docs = (
            await database.documents.find(
                {"owner_id": {"$in": user_ids}, "is_active": True}
            ).to_list(length=10000)
            if user_ids
            else []
        )
        docs_by_owner: dict[str, list[dict]] = {}
        for d in docs:
            docs_by_owner.setdefault(d.get("owner_id") or "", []).append(d)

        assignments = (
            await database.employee_career_assignments.find(
                {"employee_id": {"$in": emp_ids}, "status": "active"}
            ).to_list(length=2000)
            if emp_ids
            else []
        )
        assignment_by_emp = {a.get("employee_id"): a for a in assignments if a.get("employee_id")}

        skill_counts: dict[str, int] = {}
        enroll_counts: dict[str, int] = {}
        cert_counts: dict[str, int] = {}
        if user_ids:
            async for row in database.employee_skills.aggregate(
                [{"$match": {"user_id": {"$in": user_ids}}}, {"$group": {"_id": "$user_id", "n": {"$sum": 1}}}]
            ):
                skill_counts[row["_id"]] = row["n"]
            async for row in database.learning_enrollments.aggregate(
                [{"$match": {"user_id": {"$in": user_ids}}}, {"$group": {"_id": "$user_id", "n": {"$sum": 1}}}]
            ):
                enroll_counts[row["_id"]] = row["n"]
            async for row in database.learning_certificates.aggregate(
                [{"$match": {"user_id": {"$in": user_ids}}}, {"$group": {"_id": "$user_id", "n": {"$sum": 1}}}]
            ):
                cert_counts[row["_id"]] = row["n"]

        rows = []
        for emp in employees:
            detail = await self._build_employee_requirements(
                emp,
                docs_by_owner=docs_by_owner,
                assignment_by_emp=assignment_by_emp,
                skill_count_by_user=skill_counts,
                enroll_count_by_user=enroll_counts,
                cert_count_by_user=cert_counts,
            )
            rows.append(detail)

        incomplete_rows = [r for r in rows if r["open_total"] > 0]
        by_category: dict[str, int] = {}
        for r in incomplete_rows:
            for cat, n in (r.get("by_category") or {}).items():
                by_category[cat] = by_category.get(cat, 0) + n

        by_department: dict[str, dict] = {}
        for r in rows:
            dept = r.get("department") or "Unassigned"
            bucket = by_department.setdefault(
                dept,
                {
                    "department": dept,
                    "employee_count": 0,
                    "incomplete_count": 0,
                    "incomplete_high": 0,
                },
            )
            bucket["employee_count"] += 1
            if r["open_total"] > 0:
                bucket["incomplete_count"] += 1
            if r["open_high"] > 0:
                bucket["incomplete_high"] += 1

        # Prefer people with open high-severity items first
        incomplete_rows.sort(key=lambda r: (-r["open_high"], -r["open_total"], r["full_name"] or ""))
        total = len(incomplete_rows)
        start = max(0, (page - 1) * page_size)
        page_rows = incomplete_rows[start : start + page_size]

        return {
            "mode": "scope",
            "department": department,
            "role": role,
            "incomplete_count": total,
            "incomplete_high_count": len([r for r in incomplete_rows if r["open_high"] > 0]),
            "employee_count": len(rows),
            "by_category": by_category,
            "by_department": sorted(by_department.values(), key=lambda d: d["department"]),
            "employees": [
                {
                    "employee_id": r["employee_id"],
                    "full_name": r["full_name"],
                    "job_title": r["job_title"],
                    "department": r["department"],
                    "open_high": r["open_high"],
                    "open_total": r["open_total"],
                    "top_codes": r["top_codes"],
                    "by_category": r["by_category"],
                }
                for r in page_rows
            ],
            "page": page,
            "page_size": page_size,
            "pages": max(1, (total + page_size - 1) // page_size) if page_size else 1,
            "total": total,
        }


talent_service = TalentService()

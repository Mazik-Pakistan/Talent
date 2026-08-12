"""Phase 3 — Epic 6 Learning Management + Epic 8 skill/career slice.

Flow implemented end-to-end:
  Learning Page -> Course Catalog (Microsoft Learn technical courses + Coursera
  industry soft-skills courses, both live + cached, never stored) -> employee
  clicks a course -> redirected to the provider's site -> completes course ->
  returns -> uploads certificate -> recruiter verifies -> skill matrix updates.

AI (Gemini) is used for course recommendations and skill-gap/career-path
analysis, always grounded in real, live catalog data merged from every
connected provider (see catalog_service.py) — never invented course titles or
URLs (see learning_ai_service.py for the no-hallucination design).
"""

from __future__ import annotations

import asyncio
import logging
import random
from datetime import UTC, date, datetime, timedelta
from typing import Any

from bson import ObjectId
from fastapi import HTTPException, status

logger = logging.getLogger(__name__)

from app.core.database import database
from app.core.rbac import CurrentUser
from app.schemas.learning import (
    SKILL_CATEGORIES,
    BookmarkRequest,
    CareerGoalRequest,
    CertificateVerifyRequest,
    CourseAssignRequest,
    EnrollmentProgressRequest,
    SkillUpsertRequest,
)
from app.services import (
    catalog_service,
    coursera_service,
    learning_ai_service,
    learning_cache_service,
    learning_path_service,
    resume_analysis_service,
    role_matching_service,
    storage_service,
)
from app.services.managed_learning_service import MANAGED_SOURCE, managed_learning_service
from app.services.dashboard_service import create_notification
from app.services.organization_service import recruiter_scope


def _iso(value: Any) -> Any:
    return value.isoformat() if hasattr(value, "isoformat") else value


def _now() -> datetime:
    return datetime.now(UTC)


class LearningService:
    # ------------------------------------------------------------------ #
    # Internal helpers
    # ------------------------------------------------------------------ #
    async def _get_employee(self, current_user: CurrentUser) -> dict:
        employee = await database.employees.find_one(
            {"$or": [{"user_id": current_user.id}, {"email": current_user.email}], "status": "active"}
        )
        if not employee:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee profile not found.")
        return employee

    async def _get_employee_by_id(self, employee_id: str) -> dict:
        employee = await database.employees.find_one({"employee_id": employee_id})
        if not employee:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")
        return employee

    async def _assert_recruiter_owns(self, current_user: CurrentUser, employee: dict) -> None:
        if current_user.role == "super_admin":
            return
        owner = str(employee.get("recruiter_id") or "")
        if owner and owner != str(current_user.id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed.")

    async def _get_resume_doc(self, user_id: str) -> dict | None:
        return await database.documents.find_one(
            {"owner_id": user_id, "doc_type": "resume", "is_active": True},
            sort=[("created_at", -1)],
        )

    async def _get_resume_fields(self, user_id: str) -> dict:
        doc = await self._get_resume_doc(user_id)
        if not doc:
            return {}
        ocr = doc.get("ocr_result") or {}
        return ocr.get("fields") or {}

    async def _get_resume_text(self, user_id: str) -> str:
        doc = await self._get_resume_doc(user_id)
        if not doc:
            return ""
        return (doc.get("raw_extracted_text") or (doc.get("ocr_result") or {}).get("raw_text") or "")[:8000]

    async def _invalidate_ai_caches(self, user_id: str) -> None:
        await learning_cache_service.invalidate_user_ai_caches(user_id)

    def _employee_recruiter_id(self, employee: dict) -> str | None:
        rid = employee.get("recruiter_id")
        return str(rid) if rid else None

    async def _merged_skills_for_user(self, user_id: str, resume_fields: dict | None = None) -> list[dict]:
        manual = await database.employee_skills.find({"user_id": user_id}).to_list(length=300)
        resume_fields = resume_fields if resume_fields is not None else await self._get_resume_fields(user_id)
        certs = await database.learning_certificates.find(
            {"user_id": user_id, "verification_status": "verified"}
        ).to_list(length=300)
        cert_skills = resume_analysis_service.extract_certificate_skill_list(certs)
        return resume_analysis_service.merge_skill_sources(
            manual_skills=manual,
            resume_fields=resume_fields,
            certificate_skills=cert_skills,
        )

    def _public_skill(self, doc: dict) -> dict:
        return {
            "id": str(doc["_id"]),
            "skill_name": doc.get("skill_name"),
            "category": doc.get("category"),
            "proficiency": doc.get("proficiency"),
            "years_experience": doc.get("years_experience"),
            "source": doc.get("source", "manual"),
            "verification_status": doc.get("verification_status", "unverified"),
            "updated_at": _iso(doc.get("updated_at")),
        }

    async def _current_skill_names(self, user_id: str, resume_fields: dict | None = None) -> list[str]:
        merged = await self._merged_skills_for_user(user_id, resume_fields)
        return resume_analysis_service.skill_name_set(merged)

    async def _employee_cert_titles(self, user_id: str) -> list[str]:
        certs = await database.learning_certificates.find(
            {"user_id": user_id, "verification_status": "verified"}
        ).to_list(length=300)
        titles = []
        for c in certs:
            if c.get("course_title"):
                titles.append(c["course_title"])
        return titles

    def _public_course(self, item: dict) -> dict:
        """Normalize any catalog provider into a shared public course shape.

        Skills / certifications are derived from whatever metadata that provider
        actually stores — same logic for Microsoft Learn, Coursera, managed
        providers (LinkedIn Learning, Skillsoft, Company Academy, …), and the
        organization framework. We never invent outcomes that are not present
        in the catalog item.
        """
        competency = (item.get("competency") or "").strip() or None
        category = (item.get("category") or "").strip() or None
        subjects = [s for s in (item.get("subjects") or []) if s]
        products = [p for p in (item.get("products") or []) if p]

        skills: list[str] = []

        def _push(value) -> None:
            if value is None:
                return
            if isinstance(value, (list, tuple, set)):
                for entry in value:
                    _push(entry)
                return
            text = str(value).strip()
            if text and text not in skills:
                skills.append(text)

        # Provider-agnostic skill fields (order = preference).
        _push(item.get("skills"))
        _push(item.get("skills_covered"))
        _push(item.get("tags"))
        _push(competency)
        _push(subjects)
        _push(products)
        # Topic-level fallback when a provider only has category metadata.
        if not skills:
            _push(category)

        course_type = str(item.get("type") or "").lower()
        certifications: list[str] = []

        def _push_cert(value) -> None:
            if value is None:
                return
            if isinstance(value, (list, tuple, set)):
                for entry in value:
                    _push_cert(entry)
                return
            text = str(value).strip()
            if text and text not in certifications:
                certifications.append(text)

        _push_cert(item.get("certifications"))
        _push_cert(item.get("required_certifications"))
        if item.get("certification_type") and item.get("title"):
            _push_cert(item.get("title"))
        if "cert" in course_type and item.get("title"):
            _push_cert(item.get("title"))

        return {
            "uid": item.get("uid"),
            "type": item.get("type"),
            "source": item.get("source", "microsoft_learn"),
            "provider": item.get("provider"),
            "category": category,
            "competency": competency,
            "designation": item.get("designation"),
            "title": item.get("title"),
            "summary": item.get("summary"),
            "url": item.get("url"),
            "duration_minutes": item.get("duration_minutes"),
            "levels": item.get("levels"),
            "roles": item.get("roles"),
            "products": products,
            "subjects": subjects,
            "skills": skills[:12],
            "certifications": certifications[:8],
            "icon_url": item.get("icon_url"),
            "last_modified": item.get("last_modified"),
            "ai_recommended": bool(item.get("_ai_recommended")),
        }

    # ------------------------------------------------------------------ #
    # US-065 / US-066 / US-072: Catalog browse / detail / search
    # ------------------------------------------------------------------ #
    async def browse_catalog(
        self,
        current_user: CurrentUser,
        *,
        q: str | None,
        role: str | None,
        level: str | None,
        product: str | None,
        course_type: str | None,
        page: int,
        page_size: int,
        bookmarked_only: bool = False,
        source: str = "microsoft_learn",
        category: str | None = None,
        provider: str | None = None,
        designation: str | None = None,
        learning_month: str | None = None,
        competency: str | None = None,
        archived: bool | None = None,
        sort_by: str | None = "newest",
    ) -> dict:
        if bookmarked_only:
            bookmarks = await database.learning_bookmarks.find({"user_id": current_user.id}).sort(
                "created_at", -1
            ).to_list(length=500)
            courses = []
            for b in bookmarks:
                item = await catalog_service.get_course_by_uid(b["course_uid"])
                if item:
                    public = self._public_course(item)
                else:
                    public = {
                        "uid": b.get("course_uid"),
                        "type": b.get("course_type"),
                        "source": catalog_service.source_of(b.get("course_uid") or ""),
                        "category": None,
                        "title": b.get("course_title"),
                        "summary": None,
                        "url": b.get("course_url"),
                        "duration_minutes": b.get("duration_minutes"),
                        "levels": [b["level"]] if b.get("level") else [],
                        "roles": [],
                        "products": [],
                        "subjects": [],
                        "icon_url": None,
                        "last_modified": None,
                    }
                # Apply lightweight client-side filters when browsing bookmarks.
                if course_type and public.get("type") != course_type:
                    continue
                if level and level.lower() not in [str(x).lower() for x in (public.get("levels") or [])]:
                    continue
                if role and role.lower() not in [str(x).lower() for x in (public.get("roles") or [])]:
                    continue
                if source and public.get("source") != source:
                    continue
                courses.append(public)
            if q and q.strip():
                from app.services.search_taxonomy import search_and_rank_items_async

                courses = await search_and_rank_items_async(courses, q.strip())
            total = len(courses)
            start = (page - 1) * page_size
            page_items = courses[start : start + page_size]
            uids = [c["uid"] for c in page_items if c.get("uid")]
            status_map = await self._status_map(current_user.id, uids)
            enriched = []
            for item in page_items:
                public = dict(item)
                public.update(status_map.get(item["uid"], {"enrolled": False, "bookmarked": True, "assigned": False}))
                public["bookmarked"] = True
                enriched.append(public)
            pages = max(1, (total + page_size - 1) // page_size) if total else 1
            return {"courses": enriched, "total": total, "page": page, "page_size": page_size, "pages": pages}

        if source == "coursera":
            # Cheap, non-blocking: ensures the cache is warm even if this is
            # the very first request this process has seen for Coursera
            # (e.g. a deep link straight into the catalog tab).
            coursera_service.start_post_login_course_loading()

        # AI-recommendation-first ordering: for a default browse (no active
        # search text), surface courses the cached recommendation engine
        # already identified as top-fit for this employee before everything
        # else. This reads the existing cached recommendation record only —
        # it never triggers a new AI call, matching the "only run AI when
        # something changed" pattern used everywhere else in this module.
        apply_ranking = source in ("microsoft_learn", "coursera") and not (q and q.strip())
        fetch_page, fetch_page_size = page, page_size
        if apply_ranking:
            # Pull a wider pool once so ranking can reorder across the pages
            # the employee is likely to see, then paginate locally.
            fetch_page = 1
            fetch_page_size = max(page_size * page, 200)

        result = await catalog_service.search_catalog(
            source=source,
            q=q,
            role=role,
            level=level,
            product=product,
            course_type=course_type,
            category=category,
            provider=provider,
            designation=designation,
            learning_month=learning_month,
            competency=competency,
            archived=archived,
            sort_by=sort_by,
            page=fetch_page,
            page_size=fetch_page_size,
        )

        if apply_ranking:
            ranked = await self._rank_by_cached_recommendations(current_user, result["courses"])
            total = result["total"]
            start = (page - 1) * page_size
            result["courses"] = ranked[start : start + page_size]
            result["page"] = page
            result["page_size"] = page_size
            result["pages"] = max(1, (total + page_size - 1) // page_size) if total else 1

        uids = [c["uid"] for c in result["courses"]]
        status_map = await self._status_map(current_user.id, uids)
        courses = []
        for item in result["courses"]:
            public = self._public_course(item)
            public.update(status_map.get(item["uid"], {"enrolled": False, "bookmarked": False, "assigned": False}))
            courses.append(public)
        result["courses"] = courses
        return result

    async def _rank_by_cached_recommendations(self, current_user: CurrentUser, courses: list[dict]) -> list[dict]:
        """Reorders catalog results so courses already flagged by the cached
        AI recommendation record (see get_recommendations()) float to the
        top, ordered by priority (critical > immediate > medium > low),
        preserving the original relative order for everything else. Only
        applies for employees who have a cached recommendation record —
        recruiters browsing the catalog to assign courses see the normal
        order. Never calls the AI itself."""
        if current_user.role not in ("employee", "super_admin"):
            return courses
        cached = await database.learning_ai_recommendations.find_one({"user_id": current_user.id})
        recommendations = (cached or {}).get("recommendations") or []
        if not recommendations:
            return courses

        priority_rank = {"critical": 0, "immediate": 1, "medium": 2, "low": 3}
        rec_rank: dict[str, int] = {}
        for idx, rec in enumerate(recommendations):
            uid = rec.get("uid")
            if uid and uid not in rec_rank:
                rec_rank[uid] = priority_rank.get(rec.get("priority"), 2) * 1000 + idx

        if not rec_rank:
            return courses

        def _key(pair: tuple[int, dict]) -> tuple[int, int]:
            index, item = pair
            uid = item.get("uid")
            if uid in rec_rank:
                return (0, rec_rank[uid])
            return (1, index)

        indexed = sorted(enumerate(courses), key=_key)
        ranked = [item for _, item in indexed]
        for item in ranked:
            if item.get("uid") in rec_rank:
                item["_ai_recommended"] = True
        return ranked

    async def get_facets(self, source: str = "microsoft_learn") -> dict:
        return await catalog_service.get_facets(source)

    async def get_soft_skill_categories(self) -> dict:
        return {"categories": coursera_service.get_categories()}

    async def get_course_detail(self, current_user: CurrentUser, uid: str) -> dict:
        item = await catalog_service.get_course_by_uid(uid)
        if not item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found in the catalog.")
        public = self._public_course(item)
        status_map = await self._status_map(current_user.id, [uid])
        public.update(status_map.get(uid, {"enrolled": False, "bookmarked": False, "assigned": False}))
        enrollment = await database.learning_enrollments.find_one({"user_id": current_user.id, "course_uid": uid})
        public["enrollment"] = self._public_enrollment(enrollment) if enrollment else None
        return public

    async def _status_map(self, user_id: str, uids: list[str]) -> dict[str, dict]:
        if not uids:
            return {}
        enrollments = await database.learning_enrollments.find(
            {"user_id": user_id, "course_uid": {"$in": uids}}
        ).to_list(length=len(uids))
        bookmarks = await database.learning_bookmarks.find(
            {"user_id": user_id, "course_uid": {"$in": uids}}
        ).to_list(length=len(uids))
        assignments = await database.learning_assignments.find(
            {"user_id": user_id, "course_uid": {"$in": uids}}
        ).to_list(length=len(uids))
        enrolled_map = {e["course_uid"]: e.get("status", "in_progress") for e in enrollments}
        bookmarked = {b["course_uid"] for b in bookmarks}
        assigned = {a["course_uid"] for a in assignments}
        out: dict[str, dict] = {}
        for uid in uids:
            out[uid] = {
                "enrolled": uid in enrolled_map,
                "enrollment_status": enrolled_map.get(uid),
                "bookmarked": uid in bookmarked,
                "assigned": uid in assigned,
            }
        return out

    # ------------------------------------------------------------------ #
    # Enrollment tracking — "click course -> register -> track completion"
    # ------------------------------------------------------------------ #
    def _public_enrollment(self, doc: dict) -> dict:
        return {
            "id": str(doc["_id"]),
            "course_uid": doc.get("course_uid"),
            "course_title": doc.get("course_title"),
            "course_url": doc.get("course_url"),
            "course_type": doc.get("course_type"),
            "status": doc.get("status"),
            "progress_percent": doc.get("progress_percent", 0),
            "started_at": _iso(doc.get("started_at")),
            "completed_at": _iso(doc.get("completed_at")),
            "assigned": bool(doc.get("assignment_id")),
            "due_date": _iso(doc.get("due_date")),
        }

    async def start_course(self, current_user: CurrentUser, uid: str) -> dict:
        item = await catalog_service.get_course_by_uid(uid)
        employee = await self._get_employee(current_user)
        now = _now()
        assignment = await database.learning_assignments.find_one(
            {"user_id": current_user.id, "course_uid": uid}
        )
        # Career-path / org courses may not be in the live catalog — still allow open via stored URL.
        if not item:
            fallback_url = await self._resolve_course_url(
                course_uid=uid,
                course_title=(assignment or {}).get("course_title"),
                existing_url=(assignment or {}).get("course_url"),
                user_id=current_user.id,
            )
            if not fallback_url:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Course not found in the catalog and no course link is saved. Ask your recruiter to add the URL.",
                )
            item = {
                "title": (assignment or {}).get("course_title") or uid,
                "url": fallback_url,
                "type": (assignment or {}).get("course_type") or "course",
                "duration_minutes": (assignment or {}).get("duration_minutes"),
            }

        existing = await database.learning_enrollments.find_one({"user_id": current_user.id, "course_uid": uid})
        if existing:
            redirect = item.get("url") or existing.get("course_url")
            if redirect and not (existing.get("course_url") or "").strip():
                await database.learning_enrollments.update_one(
                    {"_id": existing["_id"]},
                    {"$set": {"course_url": redirect, "updated_at": now}},
                )
                existing["course_url"] = redirect
            return {"enrollment": self._public_enrollment(existing), "redirect_url": redirect}

        doc = {
            "user_id": current_user.id,
            "employee_id": employee.get("employee_id"),
            "course_uid": uid,
            "course_title": item.get("title") or (assignment or {}).get("course_title") or uid,
            "course_url": item.get("url") or (assignment or {}).get("course_url") or "",
            "course_type": item.get("type") or (assignment or {}).get("course_type"),
            "duration_minutes": item.get("duration_minutes"),
            "status": "in_progress",
            "progress_percent": 0,
            "started_at": now,
            "completed_at": None,
            "assignment_id": str(assignment["_id"]) if assignment else None,
            "due_date": assignment.get("due_date") if assignment else None,
            "created_at": now,
            "updated_at": now,
        }
        result = await database.learning_enrollments.insert_one(doc)
        doc["_id"] = result.inserted_id
        if assignment:
            await database.learning_assignments.update_one(
                {"_id": assignment["_id"]}, {"$set": {"status": "in_progress", "updated_at": now}}
            )
        return {"enrollment": self._public_enrollment(doc), "redirect_url": doc.get("course_url") or item.get("url")}

    async def update_progress(self, current_user: CurrentUser, uid: str, request: EnrollmentProgressRequest) -> dict:
        enrollment = await database.learning_enrollments.find_one({"user_id": current_user.id, "course_uid": uid})
        if not enrollment:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="You have not started this course yet.")
        now = _now()
        updates: dict[str, Any] = {"progress_percent": request.progress_percent, "updated_at": now}
        target_status = request.status
        if request.progress_percent >= 100 or target_status == "completed":
            updates["status"] = "completed"
            updates["progress_percent"] = 100
            updates["completed_at"] = now
        elif target_status:
            updates["status"] = target_status
        await database.learning_enrollments.update_one({"_id": enrollment["_id"]}, {"$set": updates})
        if updates.get("status") == "completed":
            if enrollment.get("assignment_id"):
                try:
                    await database.learning_assignments.update_one(
                        {"_id": ObjectId(enrollment["assignment_id"])},
                        {"$set": {"status": "completed", "updated_at": now}},
                    )
                except Exception:
                    pass
            # Credit AI career-path skill (gap analysis). Roadmap skills/certs
            # are awarded only after recruiter verifies the uploaded certificate.
            await self._credit_skill_from_completed_course(current_user, uid, enrollment)

        updated = await database.learning_enrollments.find_one({"_id": enrollment["_id"]})
        return {"enrollment": self._public_enrollment(updated)}

    async def _collect_outcomes_for_course(
        self,
        *,
        course_uid: str | None,
        organization_id: str | None = None,
        course_title: str | None = None,
        employee_id: str | None = None,
        user_id: str | None = None,
    ) -> dict[str, list[str]]:
        """Skills / certifications attached to a catalog item via Career Roadmaps or catalog metadata."""
        skills: list[str] = []
        certifications: list[str] = []

        def _push(bucket: list[str], value) -> None:
            if value is None:
                return
            if isinstance(value, (list, tuple, set)):
                for entry in value:
                    _push(bucket, entry)
                return
            if isinstance(value, dict):
                _push(bucket, value.get("skill") or value.get("certification") or value.get("name"))
                return
            text = str(value).strip()
            if text and text not in bucket:
                bucket.append(text)

        if course_uid:
            roadmap_q: dict[str, Any] = {"course_id": course_uid}
            if organization_id:
                roadmap_q["organization_id"] = organization_id
            roadmap_rows = await database.org_framework_roadmaps.find(roadmap_q).to_list(length=50)
            for row in roadmap_rows:
                _push(skills, row.get("skills"))
                _push(skills, row.get("competency"))
                _push(certifications, row.get("certifications"))
                catalog_type = str(row.get("catalog_type") or "").lower()
                name = (row.get("course_name") or course_title or "").strip()
                if "cert" in catalog_type and name:
                    _push(certifications, name)

            item = await catalog_service.get_course_by_uid(course_uid)
            if item:
                public = self._public_course(item)
                _push(skills, public.get("skills"))
                _push(certifications, public.get("certifications"))

        # Fall back to org roadmap match by course title (career-path / LinkedIn title keys).
        if course_title and (not skills or not certifications):
            title_q: dict[str, Any] = {
                "course_name": {
                    "$regex": f"^{_escape_regex(course_title.strip())}$",
                    "$options": "i",
                }
            }
            if organization_id:
                title_q["organization_id"] = organization_id
            title_rows = await database.org_framework_roadmaps.find(title_q).to_list(length=50)
            for row in title_rows:
                _push(skills, row.get("skills"))
                _push(skills, row.get("competency"))
                _push(certifications, row.get("certifications"))

        # Career-path nested skills/certs for this course (works for assigned + self-enroll matches).
        if employee_id or user_id:
            career_q: dict[str, Any] = {"status": "active"}
            if employee_id:
                career_q["employee_id"] = employee_id
            else:
                career_q["user_id"] = user_id
            career = await database.employee_career_assignments.find_one(career_q)
            uid_l = (course_uid or "").strip().lower()
            title_l = (course_title or "").strip().lower()
            for path_course in (career or {}).get("assigned_learning_path") or []:
                p_uid = (path_course.get("course_uid") or "").strip().lower()
                p_title = (path_course.get("course_title") or "").strip().lower()
                if (uid_l and p_uid == uid_l) or (title_l and p_title == title_l):
                    _push(skills, path_course.get("skills"))
                    _push(certifications, path_course.get("certifications"))

        return {"skills": skills[:12], "certifications": certifications[:8]}

    async def _upsert_profile_certification(
        self,
        *,
        user_id: str,
        employee_id: str | None,
        organization_id: str | None,
        recruiter_id: str | None,
        title: str,
        course_uid: str | None,
        source: str = "org_roadmap",
    ) -> None:
        """Ensure a verified certification appears on the employee profile."""
        title = (title or "").strip()
        if not title:
            return
        existing = await database.learning_certificates.find_one(
            {
                "user_id": user_id,
                "course_title": {"$regex": f"^{_escape_regex(title)}$", "$options": "i"},
                "verification_status": "verified",
            }
        )
        if existing:
            return
        now = _now()
        await database.learning_certificates.insert_one(
            {
                "user_id": user_id,
                "employee_id": employee_id,
                "organization_id": organization_id,
                "recruiter_id": recruiter_id,
                "course_uid": course_uid,
                "course_title": title,
                "file_name": None,
                "file_url": None,
                "source_url": None,
                "learning_hours": None,
                "completion_date": now.date().isoformat(),
                "verification_status": "verified",
                "verified_by": "Career Roadmap",
                "verified_at": now,
                "skills_awarded": [],
                "source": source,
                "created_at": now,
                "updated_at": now,
            }
        )

    _PROF_RANK = {"Beginner": 1, "Intermediate": 2, "Advanced": 3, "Expert": 4}

    def _proficiency_rank(self, value: str | None) -> int:
        return self._PROF_RANK.get(self._normalize_proficiency(value), 1)

    def _normalize_proficiency(self, value: str | None) -> str:
        raw = (value or "").strip().lower()
        if raw in {"beginner", "fundamental", "fundamentals", "intro", "introduction"}:
            return "Beginner"
        if raw in {"intermediate", "mid", "medium"}:
            return "Intermediate"
        if raw in {"advanced", "proficient"}:
            return "Advanced"
        if raw in {"expert", "master"}:
            return "Expert"
        titled = (value or "").strip().capitalize()
        if titled in self._PROF_RANK:
            return titled
        return "Intermediate"

    def _proficiency_from_difficulty(self, value: Any) -> str:
        """Map course difficulty/level labels to a skill proficiency (single ladder)."""
        if isinstance(value, (list, tuple)):
            best = "Beginner"
            for item in value:
                cand = self._normalize_proficiency(str(item) if item is not None else "")
                if self._proficiency_rank(cand) > self._proficiency_rank(best):
                    best = cand
            return best if value else "Intermediate"
        return self._normalize_proficiency(str(value) if value is not None else "Intermediate")

    async def _resolve_course_proficiency(
        self, course_uid: str | None, course_title: str | None = None
    ) -> str:
        """Highest difficulty on the catalog course → proficiency used to polish skills."""
        if not course_uid:
            return "Intermediate"
        try:
            course = await catalog_service.get_course_by_uid(course_uid)
        except Exception:
            course = None
        if not course:
            return "Intermediate"
        levels: list[Any] = list(course.get("levels") or [])
        if course.get("difficulty"):
            levels.append(course.get("difficulty"))
        if course.get("level"):
            levels.append(course.get("level"))
        if not levels and course_title:
            # Title hints e.g. "Python Intermediate"
            title_l = course_title.lower()
            for token, prof in (
                ("expert", "Expert"),
                ("advanced", "Advanced"),
                ("intermediate", "Intermediate"),
                ("beginner", "Beginner"),
                ("fundamentals", "Beginner"),
            ):
                if token in title_l:
                    return prof
        return self._proficiency_from_difficulty(levels) if levels else "Intermediate"

    async def _award_course_outcomes_to_profile(
        self,
        *,
        user_id: str,
        employee_id: str | None,
        organization_id: str | None,
        course_uid: str | None,
        course_title: str | None = None,
        source: str = "course",
        award_certifications: bool = True,
        recruiter_id: str | None = None,
        proficiency: str | None = None,
    ) -> dict[str, list[str]]:
        """Write Career Roadmap / catalog skills (and optional certs) onto the employee profile."""
        outcomes = await self._collect_outcomes_for_course(
            course_uid=course_uid,
            organization_id=organization_id,
            course_title=course_title,
            employee_id=employee_id,
            user_id=user_id,
        )
        skill_prof = self._normalize_proficiency(
            proficiency or await self._resolve_course_proficiency(course_uid, course_title)
        )
        for skill_name in outcomes["skills"]:
            await self._upsert_verified_skill(
                user_id=user_id,
                employee_id=employee_id,
                skill_name=skill_name,
                category="Other",
                proficiency=skill_prof,
                source=source,
            )
        if award_certifications:
            for cert_title in outcomes["certifications"]:
                # Skip duplicating the certificate the employee just uploaded/verified.
                if course_title and cert_title.strip().lower() == course_title.strip().lower():
                    continue
                await self._upsert_profile_certification(
                    user_id=user_id,
                    employee_id=employee_id,
                    organization_id=organization_id,
                    recruiter_id=recruiter_id,
                    title=cert_title,
                    course_uid=course_uid,
                    source="org_roadmap",
                )
        if outcomes["skills"] or (award_certifications and outcomes["certifications"]):
            await self._invalidate_ai_caches(user_id)
        return outcomes

    async def _credit_skill_from_completed_course(
        self, current_user: CurrentUser, course_uid: str, enrollment: dict
    ) -> None:
        """When a learning-path course is finished, add/upgrade the gap skill (one row, higher level wins)."""
        goal = await database.learning_career_goals.find_one({"user_id": current_user.id})
        path = (goal or {}).get("ai_path") or {}
        matched_skill = None
        step_difficulty = None
        for step in path.get("path") or []:
            step_uid = (step.get("course") or {}).get("uid") or step.get("uid")
            if step_uid == course_uid and step.get("kind") != "certification":
                matched_skill = (step.get("skill") or "").strip()
                step_difficulty = step.get("difficulty") or (step.get("course") or {}).get("difficulty")
                break
        if not matched_skill:
            return
        employee = await self._get_employee(current_user)
        proficiency = (
            self._proficiency_from_difficulty(step_difficulty)
            if step_difficulty
            else await self._resolve_course_proficiency(course_uid, enrollment.get("course_title"))
        )
        # Upgrade in place — never create a second Python/Beginner + Python/Intermediate row.
        await self._upsert_verified_skill(
            user_id=current_user.id,
            employee_id=employee.get("employee_id"),
            skill_name=matched_skill,
            category="Other",
            proficiency=proficiency,
            source="course",
            verification_status="unverified",
        )
        await learning_cache_service.invalidate_user_ai_caches(current_user.id)
        try:
            await self._sync_career_assignment_progress(
                user_id=current_user.id,
                employee_id=employee.get("employee_id"),
            )
        except Exception:
            logger.exception("Career path sync failed after course completion for %s", current_user.id)

    def _assignment_as_my_course(self, doc: dict) -> dict:
        """Pending recruiter assignment shown in My Learning before the employee starts it."""
        return {
            "id": f"assignment:{doc['_id']}",
            "course_uid": doc.get("course_uid"),
            "course_title": doc.get("course_title"),
            "course_url": doc.get("course_url"),
            "course_type": doc.get("course_type"),
            "status": "assigned",
            "progress_percent": 0,
            "started_at": None,
            "completed_at": None,
            "assigned": True,
            "due_date": _iso(doc.get("due_date")),
        }

    async def _resolve_course_url(
        self,
        *,
        course_uid: str | None,
        course_title: str | None = None,
        existing_url: str | None = None,
        user_id: str | None = None,
    ) -> str | None:
        """Best-effort provider URL for Open course (catalog → assignment → roadmap)."""
        cleaned = (existing_url or "").strip()
        if cleaned.startswith("http://") or cleaned.startswith("https://"):
            return cleaned

        uid = (course_uid or "").strip()
        if uid:
            try:
                item = await catalog_service.get_course_by_uid(uid)
                url = ((item or {}).get("url") or (item or {}).get("course_url") or "").strip()
                if url.startswith("http://") or url.startswith("https://"):
                    return url
            except Exception:
                pass

        if user_id and uid:
            assignment = await database.learning_assignments.find_one(
                {"user_id": user_id, "course_uid": uid}
            )
            aurl = ((assignment or {}).get("course_url") or "").strip()
            if aurl.startswith("http://") or aurl.startswith("https://"):
                return aurl

        title = (course_title or "").strip()
        if title:
            row = await database.org_framework_roadmaps.find_one(
                {
                    "course_name": {
                        "$regex": f"^{_escape_regex(title)}$",
                        "$options": "i",
                    }
                }
            )
            if row:
                rurl = (row.get("course_url") or row.get("url") or "").strip()
                if rurl.startswith("http://") or rurl.startswith("https://"):
                    return rurl
            if user_id:
                assignment = await database.learning_assignments.find_one(
                    {
                        "user_id": user_id,
                        "course_title": {
                            "$regex": f"^{_escape_regex(title)}$",
                            "$options": "i",
                        },
                    }
                )
                aurl = ((assignment or {}).get("course_url") or "").strip()
                if aurl.startswith("http://") or aurl.startswith("https://"):
                    return aurl
        return None

    async def _enrich_course_url(self, doc: dict, *, user_id: str | None = None) -> dict:
        """Attach a working course_url onto a public enrollment/assignment row."""
        public = dict(doc)
        url = await self._resolve_course_url(
            course_uid=public.get("course_uid"),
            course_title=public.get("course_title"),
            existing_url=public.get("course_url"),
            user_id=user_id,
        )
        if url:
            public["course_url"] = url
        return public

    async def list_my_courses(self, current_user: CurrentUser, status_filter: str | None) -> dict:
        """Return started enrollments plus open recruiter assignments not yet started.

        UI copy promises “started or been assigned”; previously only enrollments
        were returned, so assigned courses were invisible until the employee
        started them from the catalog.
        """
        status_filter = (status_filter or "").strip().lower() or None

        # Heal: if a certificate is still pending, the course must not show as completed.
        pending_certs = await database.learning_certificates.find(
            {"user_id": current_user.id, "verification_status": "pending"}
        ).to_list(length=300)
        pending_uids = {c.get("course_uid") for c in pending_certs if c.get("course_uid")}
        pending_titles = {
            (c.get("course_title") or "").strip().lower()
            for c in pending_certs
            if (c.get("course_title") or "").strip()
        }
        if pending_uids or pending_titles:
            heal_or: list[dict] = []
            if pending_uids:
                heal_or.append({"course_uid": {"$in": list(pending_uids)}})
            if pending_titles:
                heal_or.append(
                    {
                        "course_title": {
                            "$regex": f"^({'|'.join(_escape_regex(t) for t in pending_titles)})$",
                            "$options": "i",
                        }
                    }
                )
            await database.learning_enrollments.update_many(
                {
                    "user_id": current_user.id,
                    "status": "completed",
                    "$or": heal_or,
                },
                {
                    "$set": {
                        "status": "in_progress",
                        "progress_percent": 90,
                        "completed_at": None,
                        "certificate_pending": True,
                        "updated_at": _now(),
                    }
                },
            )

        enrollment_query: dict[str, Any] = {"user_id": current_user.id}
        if status_filter in ("in_progress", "completed"):
            enrollment_query["status"] = status_filter
        enroll_docs = await database.learning_enrollments.find(enrollment_query).sort(
            "updated_at", -1
        ).to_list(length=300)
        enrollments: list[dict] = []
        for d in enroll_docs:
            public = self._public_enrollment(d)
            enriched = await self._enrich_course_url(public, user_id=current_user.id)
            # Persist resolved URL so Open course keeps working offline from catalog cache.
            resolved = (enriched.get("course_url") or "").strip()
            stored = (d.get("course_url") or "").strip()
            if resolved and resolved != stored and d.get("_id"):
                await database.learning_enrollments.update_one(
                    {"_id": d["_id"]},
                    {"$set": {"course_url": resolved, "updated_at": _now()}},
                )
            enrollments.append(enriched)

        # Exclude any enrollment for this user so we don't duplicate an assignment
        # that was already started (even if the status filter hides that enrollment).
        all_enrolled_uids = {
            d["course_uid"]
            for d in await database.learning_enrollments.find(
                {"user_id": current_user.id}, {"course_uid": 1}
            ).to_list(length=500)
            if d.get("course_uid")
        }

        pending: list[dict] = []
        if status_filter in (None, "assigned"):
            assignments = await database.learning_assignments.find(
                {"user_id": current_user.id, "status": {"$nin": ["completed"]}}
            ).sort("created_at", -1).to_list(length=300)
            seen_uids: set[str] = set()
            for assignment in assignments:
                uid = assignment.get("course_uid")
                if not uid or uid in all_enrolled_uids or uid in seen_uids:
                    continue
                seen_uids.add(uid)
                row = self._assignment_as_my_course(assignment)
                enriched = await self._enrich_course_url(row, user_id=current_user.id)
                resolved = (enriched.get("course_url") or "").strip()
                stored = (assignment.get("course_url") or "").strip()
                if resolved and resolved != stored and assignment.get("_id"):
                    await database.learning_assignments.update_one(
                        {"_id": assignment["_id"]},
                        {"$set": {"course_url": resolved, "updated_at": _now()}},
                    )
                pending.append(enriched)

        if status_filter == "assigned":
            return {"enrollments": pending}
        if status_filter in ("in_progress", "completed"):
            return {"enrollments": enrollments}
        return {"enrollments": pending + enrollments}

    # ------------------------------------------------------------------ #
    # US-069: My Learning dashboard
    # ------------------------------------------------------------------ #
    async def get_learning_dashboard(self, current_user: CurrentUser) -> dict:
        coursera_service.start_post_login_course_loading()
        employee = await self._get_employee(current_user)
        enrollments = await database.learning_enrollments.find({"user_id": current_user.id}).to_list(length=500)
        assignments = await database.learning_assignments.find({"user_id": current_user.id}).to_list(length=500)
        certificates = await database.learning_certificates.find({"user_id": current_user.id}).to_list(length=500)

        completed = [e for e in enrollments if e.get("status") == "completed"]
        in_progress = [e for e in enrollments if e.get("status") == "in_progress"]
        assigned_open = [
            a for a in assignments if a.get("status") not in ("completed",)
        ]
        certs_earned = [c for c in certificates if c.get("verification_status") == "verified"]
        total_learning_hours = round(
            sum((c.get("learning_hours") or 0) for c in certs_earned)
            + sum((e.get("duration_minutes") or 0) for e in completed) / 60,
            1,
        )
        overall_progress = 0
        if enrollments:
            overall_progress = round(sum(e.get("progress_percent", 0) for e in enrollments) / len(enrollments))

        # Prefer not-yet-started assignments; include ones without a due date
        # (previously only due-dated rows appeared, so Assigned: N looked wrong).
        enrolled_uids = {e.get("course_uid") for e in enrollments if e.get("course_uid")}
        pending_assigned = [
            a for a in assigned_open if a.get("course_uid") and a.get("course_uid") not in enrolled_uids
        ]

        def _due_sort_key(assignment: dict):
            due = assignment.get("due_date")
            return (due is None, due or "")

        pending_sorted = sorted(pending_assigned, key=_due_sort_key)
        deduped_due: list[dict] = []
        seen_uids: set[str] = set()
        for assignment in pending_sorted:
            uid = assignment.get("course_uid")
            if not uid or uid in seen_uids:
                continue
            seen_uids.add(uid)
            deduped_due.append(assignment)
            if len(deduped_due) >= 8:
                break

        pending_unique = len({a.get("course_uid") for a in pending_assigned if a.get("course_uid")})
        unique_assigned_all = len({a.get("course_uid") for a in assignments if a.get("course_uid")})

        return {
            "employee": {
                "employee_id": employee.get("employee_id"),
                "full_name": employee.get("full_name"),
                "job_title": employee.get("job_title"),
                "department": employee.get("department"),
            },
            "summary": {
                # "Assigned" on Overview = waiting to start (not yet enrolled)
                "assigned_count": pending_unique,
                "assigned_total_count": unique_assigned_all,
                "enrolled_count": len(enrollments),
                "in_progress_count": len(in_progress),
                "completed_count": len(completed),
                "certificates_earned": len(certs_earned),
                "certificates_pending": len([c for c in certificates if c.get("verification_status") == "pending"]),
                "overall_progress_percent": overall_progress,
                "total_learning_hours": total_learning_hours,
            },
            "recent_enrollments": [self._public_enrollment(e) for e in sorted(
                enrollments, key=lambda e: e.get("updated_at") or e.get("created_at"), reverse=True
            )[:6]],
            "upcoming_due": [
                {
                    "id": str(a["_id"]),
                    "course_title": a.get("course_title"),
                    "course_uid": a.get("course_uid"),
                    "course_url": a.get("course_url"),
                    "due_date": _iso(a.get("due_date")),
                    "status": a.get("status") or "assigned",
                }
                for a in deduped_due
            ],
        }

    # ------------------------------------------------------------------ #
    # US-073: Bookmarks
    # ------------------------------------------------------------------ #
    async def add_bookmark(self, current_user: CurrentUser, request: BookmarkRequest) -> dict:
        now = _now()
        await database.learning_bookmarks.update_one(
            {"user_id": current_user.id, "course_uid": request.course_uid},
            {
                "$set": {
                    "user_id": current_user.id,
                    "course_uid": request.course_uid,
                    "course_title": request.course_title,
                    "course_url": request.course_url,
                    "course_type": request.course_type,
                    "duration_minutes": request.duration_minutes,
                    "level": request.level,
                    "updated_at": now,
                },
                "$setOnInsert": {"created_at": now},
            },
            upsert=True,
        )
        return {"bookmarked": True}

    async def remove_bookmark(self, current_user: CurrentUser, uid: str) -> dict:
        await database.learning_bookmarks.delete_one({"user_id": current_user.id, "course_uid": uid})
        return {"bookmarked": False}

    async def list_bookmarks(self, current_user: CurrentUser) -> dict:
        docs = await database.learning_bookmarks.find({"user_id": current_user.id}).sort("created_at", -1).to_list(length=200)
        return {
            "bookmarks": [
                {
                    "course_uid": d.get("course_uid"),
                    "course_title": d.get("course_title"),
                    "course_url": d.get("course_url"),
                    "course_type": d.get("course_type"),
                    "duration_minutes": d.get("duration_minutes"),
                    "level": d.get("level"),
                }
                for d in docs
            ]
        }

    # ------------------------------------------------------------------ #
    # Certificates — upload (employee) + verify (recruiter)
    # ------------------------------------------------------------------ #
    def _public_certificate(self, doc: dict) -> dict:
        file_url = doc.get("file_url")
        source_url = doc.get("source_url") or doc.get("certificate_url")
        return {
            "id": str(doc["_id"]),
            "employee_id": doc.get("employee_id"),
            "employee_name": doc.get("employee_name"),
            "course_uid": doc.get("course_uid"),
            "course_title": doc.get("course_title"),
            "file_name": doc.get("file_name"),
            "file_url": file_url,
            "source_url": source_url,
            "certificate_url": file_url or source_url,
            "learning_hours": doc.get("learning_hours"),
            "completion_date": _iso(doc.get("completion_date")),
            "verification_status": doc.get("verification_status", "pending"),
            "verified_by": doc.get("verified_by"),
            "verified_at": _iso(doc.get("verified_at")),
            "rejection_reason": doc.get("rejection_reason"),
            "skills_awarded": doc.get("skills_awarded") or [],
            "certifications_awarded": doc.get("certifications_awarded") or [],
            "proficiency_awarded": doc.get("proficiency_awarded"),
            "created_at": _iso(doc.get("created_at")),
        }

    async def upload_certificate(
        self,
        current_user: CurrentUser,
        *,
        course_uid: str | None,
        course_title: str,
        completion_date: date | None,
        learning_hours: float | None,
        filename: str | None,
        content: bytes | None,
        source_url: str | None = None,
    ) -> dict:
        employee = await self._get_employee(current_user)
        cleaned_source = (source_url or "").strip() or None
        if not cleaned_source:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Certificate link is required so your recruiter can verify it.",
            )

        now = _now()
        file_url = None
        object_path = None
        file_name = None
        if filename and content:
            upload = await storage_service.save_file(current_user.id, "certificates", filename, content)
            file_url = upload.get("file_url")
            object_path = upload.get("object_path")
            file_name = filename

        doc = {
            "user_id": current_user.id,
            "employee_id": employee.get("employee_id"),
            "employee_name": employee.get("full_name"),
            "recruiter_id": employee.get("recruiter_id"),
            "course_uid": course_uid,
            "course_title": course_title,
            "file_name": file_name,
            "file_url": file_url,
            "source_url": cleaned_source,
            "object_path": object_path,
            "learning_hours": learning_hours,
            "completion_date": completion_date.isoformat() if completion_date else None,
            "verification_status": "pending",
            "created_at": now,
            "updated_at": now,
        }
        result = await database.learning_certificates.insert_one(doc)
        doc["_id"] = result.inserted_id

        # Keep course in progress until the recruiter verifies the certificate.
        if course_uid:
            enrollment = await database.learning_enrollments.find_one(
                {"user_id": current_user.id, "course_uid": course_uid}
            )
            if enrollment and enrollment.get("status") != "completed":
                await database.learning_enrollments.update_one(
                    {"_id": enrollment["_id"]},
                    {
                        "$set": {
                            "status": "in_progress",
                            "certificate_pending": True,
                            "updated_at": now,
                        }
                    },
                )
            elif not enrollment:
                await database.learning_enrollments.insert_one(
                    {
                        "user_id": current_user.id,
                        "employee_id": employee.get("employee_id"),
                        "course_uid": course_uid,
                        "course_title": course_title,
                        "course_url": "",
                        "course_type": "course",
                        "status": "in_progress",
                        "progress_percent": 0,
                        "started_at": now,
                        "completed_at": None,
                        "certificate_pending": True,
                        "created_at": now,
                        "updated_at": now,
                    }
                )
            await database.learning_assignments.update_many(
                {
                    "user_id": current_user.id,
                    "$or": [
                        {"course_uid": course_uid},
                        {
                            "course_title": {
                                "$regex": f"^{_escape_regex(course_title)}$",
                                "$options": "i",
                            }
                        },
                    ],
                    "status": {"$nin": ["completed"]},
                },
                {"$set": {"status": "in_progress", "updated_at": now}},
            )

        # Mark career-path course as awaiting recruiter verification.
        try:
            await self._sync_career_assignment_progress(
                user_id=current_user.id,
                employee_id=employee.get("employee_id"),
            )
        except Exception:
            logger.exception("Career path sync failed after certificate upload")

        if employee.get("recruiter_id"):
            await create_notification(
                recipient_id=str(employee["recruiter_id"]),
                recipient_role="recruiter",
                notif_type="certificate_uploaded",
                title="Certificate submitted for review",
                message=(
                    f"{employee.get('full_name')} submitted a certificate for \"{course_title}\". "
                    f"Review link: {cleaned_source}"
                ),
                link="/dashboard/recruiter/learning",
                related_id=str(doc["_id"]),
            )
        return {"certificate": self._public_certificate(doc)}

    async def list_my_certificates(self, current_user: CurrentUser) -> dict:
        docs = await database.learning_certificates.find({"user_id": current_user.id}).sort("created_at", -1).to_list(length=200)
        return {"certificates": [self._public_certificate(d) for d in docs]}

    async def list_pending_certificates(self, current_user: CurrentUser) -> dict:
        query: dict[str, Any] = {"verification_status": "pending"}
        docs = await database.learning_certificates.find(query).sort("created_at", 1).to_list(length=300)
        if current_user.role != "super_admin":
            org_cache: dict[str, str | None] = {}

            async def _cert_org(cert: dict) -> str | None:
                org = cert.get("organization_id")
                if org:
                    return org
                uid = cert.get("user_id")
                if not uid:
                    return None
                if uid not in org_cache:
                    owner = await database.employees.find_one(
                        {
                            "$or": [
                                {"user_id": uid},
                                {"employee_id": cert.get("employee_id")},
                            ]
                        }
                    ) or await database.candidates.find_one({"user_id": uid})
                    org_cache[uid] = (owner or {}).get("organization_id")
                return org_cache[uid]

            scoped = []
            for cert in docs:
                if current_user.organization_id:
                    if await _cert_org(cert) == current_user.organization_id:
                        scoped.append(cert)
                elif cert.get("recruiter_id") == current_user.id:
                    scoped.append(cert)
            docs = scoped
        return {"certificates": [self._public_certificate(d) for d in docs]}

    async def _complete_course_after_certificate_verify(self, *, cert: dict, now: datetime) -> None:
        """Mark enrollment + assignment completed only after recruiter verifies the certificate."""
        user_id = cert.get("user_id")
        if not user_id:
            return
        course_uid = (cert.get("course_uid") or "").strip() or None
        course_title = (cert.get("course_title") or "").strip() or None
        if not course_uid and not course_title:
            return

        enrollment = None
        if course_uid:
            enrollment = await database.learning_enrollments.find_one(
                {"user_id": user_id, "course_uid": course_uid}
            )
        if not enrollment and course_title:
            enrollment = await database.learning_enrollments.find_one(
                {
                    "user_id": user_id,
                    "course_title": {
                        "$regex": f"^{_escape_regex(course_title)}$",
                        "$options": "i",
                    },
                }
            )

        enrollment_fields = {
            "status": "completed",
            "progress_percent": 100,
            "completed_at": now,
            "updated_at": now,
            "certificate_pending": False,
        }
        if enrollment:
            await database.learning_enrollments.update_one(
                {"_id": enrollment["_id"]},
                {"$set": enrollment_fields},
            )
        else:
            employee = None
            if cert.get("employee_id"):
                employee = await database.employees.find_one({"employee_id": cert["employee_id"]})
            if not employee:
                employee = await database.employees.find_one({"user_id": user_id})
            course_url = ""
            if course_uid:
                try:
                    item = await catalog_service.get_course_by_uid(course_uid)
                    course_url = (item or {}).get("url") or ""
                except Exception:
                    course_url = ""
            await database.learning_enrollments.insert_one(
                {
                    "user_id": user_id,
                    "employee_id": cert.get("employee_id") or (employee or {}).get("employee_id"),
                    "course_uid": course_uid or course_title,
                    "course_title": course_title or course_uid,
                    "course_url": course_url,
                    "course_type": "course",
                    "status": "completed",
                    "progress_percent": 100,
                    "started_at": now,
                    "completed_at": now,
                    "certificate_pending": False,
                    "created_at": now,
                    "updated_at": now,
                }
            )

        assignment_or: list[dict] = []
        if course_uid:
            assignment_or.append({"course_uid": course_uid})
        if course_title:
            assignment_or.append(
                {
                    "course_title": {
                        "$regex": f"^{_escape_regex(course_title)}$",
                        "$options": "i",
                    }
                }
            )
        if assignment_or:
            await database.learning_assignments.update_many(
                {"user_id": user_id, "$or": assignment_or},
                {"$set": {"status": "completed", "updated_at": now}},
            )

    async def verify_certificate(self, current_user: CurrentUser, certificate_id: str, request: CertificateVerifyRequest) -> dict:
        if not ObjectId.is_valid(certificate_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Certificate not found.")
        cert = await database.learning_certificates.find_one({"_id": ObjectId(certificate_id)})
        if not cert:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Certificate not found.")
        if current_user.role != "super_admin":
            if current_user.organization_id:
                cert_org = cert.get("organization_id")
                if not cert_org:
                    cert_owner = await database.employees.find_one(
                        {
                            "$or": [
                                {"user_id": cert.get("user_id")},
                                {"employee_id": cert.get("employee_id")},
                            ]
                        }
                    ) or await database.candidates.find_one({"user_id": cert.get("user_id")})
                    cert_org = (cert_owner or {}).get("organization_id")
                if cert_org != current_user.organization_id:
                    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed.")
            elif cert.get("recruiter_id") != current_user.id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed.")

        now = _now()

        if not request.approve:
            await database.learning_certificates.update_one(
                {"_id": cert["_id"]},
                {
                    "$set": {
                        "verification_status": "rejected",
                        "verified_by": current_user.full_name,
                        "verified_at": now,
                        "rejection_reason": request.note or "Certificate rejected.",
                        "updated_at": now,
                    }
                },
            )
            await create_notification(
                recipient_id=cert["user_id"],
                recipient_role="employee",
                notif_type="certificate_rejected",
                title="Certificate needs attention",
                message=(
                    f"Your certificate for \"{cert.get('course_title')}\" was rejected: {request.note or 'see recruiter notes'}."
                ),
                link="/dashboard/employee/learning",
                related_id=str(cert["_id"]),
            )
            try:
                goal = await database.learning_career_goals.find_one({"user_id": cert["user_id"]})
                if goal and goal.get("target_role"):
                    await self._recalculate_designation_readiness(cert["user_id"], cert.get("employee_id"), goal["target_role"])
            except Exception:
                pass
            updated = await database.learning_certificates.find_one({"_id": cert["_id"]})
            return {"certificate": self._public_certificate(updated)}

        if not cert.get("course_title"):
            await database.learning_certificates.update_one(
                {"_id": cert["_id"]},
                {
                    "$set": {
                        "verification_status": "verified",
                        "verified_by": current_user.full_name,
                        "verified_at": now,
                        "rejection_reason": None,
                        "updated_at": now,
                    }
                },
            )
            await self._award_verified_certificate_outcomes(
                cert=cert,
                verifier=current_user,
            )
            try:
                await self._complete_course_after_certificate_verify(cert=cert, now=now)
            except Exception:
                logger.exception("Failed to mark course completed after certificate verify %s", cert.get("_id"))
            try:
                await self._sync_career_assignment_progress(
                    user_id=cert["user_id"],
                    employee_id=cert.get("employee_id"),
                )
            except Exception:
                logger.exception("Career path sync failed after certificate verify %s", cert.get("_id"))
            await create_notification(
                recipient_id=cert["user_id"],
                recipient_role="employee",
                notif_type="certificate_verified",
                title="Certificate verified",
                message=(
                    f"Your certificate for \"{cert.get('course_title')}\" was verified. "
                    "The course is marked completed and skills were added to your profile."
                ),
                link="/dashboard/employee/learning?tab=my-courses",
                related_id=str(cert["_id"]),
            )
            try:
                goal = await database.learning_career_goals.find_one({"user_id": cert["user_id"]})
                if goal and goal.get("target_role"):
                    await self._recalculate_designation_readiness(cert["user_id"], cert.get("employee_id"), goal["target_role"])
            except Exception:
                pass
            updated = await database.learning_certificates.find_one({"_id": cert["_id"]})
            return {"certificate": self._public_certificate(updated)}

        # 1) Always award Career Roadmap / catalog skills + cert labels first
        #    (these are the chips on the roadmap — e.g. Accountability).
        # 2) Best-effort AI extraction from the certificate file as extra skills.
        # Verification succeeds even if AI extraction fails.
        employee = None
        if cert.get("employee_id"):
            employee = await database.employees.find_one({"employee_id": cert["employee_id"]})
        if not employee and cert.get("user_id"):
            employee = await database.employees.find_one({"user_id": cert["user_id"]})
        org_id = (
            (employee or {}).get("organization_id")
            or cert.get("organization_id")
            or current_user.organization_id
        )

        skill_names: list[str] = []
        roadmap_outcomes: dict[str, list[str]] = {"skills": [], "certifications": []}
        course_proficiency = await self._resolve_course_proficiency(
            cert.get("course_uid"), cert.get("course_title")
        )
        try:
            roadmap_outcomes = await self._award_course_outcomes_to_profile(
                user_id=cert["user_id"],
                employee_id=cert.get("employee_id"),
                organization_id=org_id,
                course_uid=cert.get("course_uid"),
                course_title=cert.get("course_title"),
                source="course",
                award_certifications=True,
                recruiter_id=cert.get("recruiter_id") or current_user.id,
                proficiency=course_proficiency,
            )
            skill_names.extend(roadmap_outcomes.get("skills") or [])

            course_summary = None
            if cert.get("course_uid"):
                course = await catalog_service.get_course_by_uid(cert["course_uid"])
                course_summary = (course or {}).get("summary")

            try:
                cert_text = await self._extract_certificate_text(cert)
                skills = await learning_ai_service.extract_skills_from_certificate(
                    course_title=cert["course_title"],
                    certificate_text=cert_text,
                    course_summary=course_summary,
                )
                for skill in skills:
                    name = (skill.get("skill_name") or "").strip()
                    if not name:
                        continue
                    # Take the higher of AI-suggested proficiency and course difficulty.
                    ai_prof = self._normalize_proficiency(skill.get("proficiency") or "Intermediate")
                    proficiency = (
                        ai_prof
                        if self._proficiency_rank(ai_prof) >= self._proficiency_rank(course_proficiency)
                        else course_proficiency
                    )
                    await self._upsert_verified_skill(
                        user_id=cert["user_id"],
                        employee_id=cert.get("employee_id"),
                        skill_name=name,
                        category=skill.get("category") or "Other",
                        proficiency=proficiency,
                        source="course",
                    )
                    if name not in skill_names:
                        skill_names.append(name)
            except Exception as ai_exc:
                logger.warning(
                    "AI skill extraction failed for certificate %s (roadmap skills still awarded): %s",
                    cert.get("_id"),
                    ai_exc,
                )

            await self._invalidate_ai_caches(cert["user_id"])

            await database.learning_certificates.update_one(
                {"_id": cert["_id"]},
                {
                    "$set": {
                        "verification_status": "verified",
                        "verified_by": current_user.full_name,
                        "verified_at": now,
                        "rejection_reason": None,
                        "skills_awarded": skill_names,
                        "certifications_awarded": roadmap_outcomes.get("certifications") or [],
                        "proficiency_awarded": course_proficiency,
                        "updated_at": now,
                    }
                },
            )

            # Persist the verified course title as a profile certification too.
            try:
                await self._upsert_profile_certification(
                    user_id=cert["user_id"],
                    employee_id=cert.get("employee_id"),
                    organization_id=org_id,
                    recruiter_id=cert.get("recruiter_id") or current_user.id,
                    title=cert.get("course_title") or "",
                    course_uid=cert.get("course_uid"),
                    source="verified_certificate",
                )
            except Exception:
                logger.exception("Failed to mirror verified cert title onto profile for %s", cert.get("_id"))

            try:
                await self._complete_course_after_certificate_verify(cert=cert, now=now)
            except Exception:
                logger.exception("Failed to mark course completed after certificate verify %s", cert.get("_id"))

            try:
                await self._sync_career_assignment_progress(
                    user_id=cert["user_id"],
                    employee_id=cert.get("employee_id"),
                )
            except Exception:
                logger.exception(
                    "Career path sync failed after certificate verify %s",
                    cert.get("_id"),
                )
        except Exception as exc:
            await database.learning_certificates.update_one(
                {"_id": cert["_id"]},
                {
                    "$set": {
                        "verification_status": "rejected",
                        "rejection_reason": f"Automated verification failed: {exc}",
                        "updated_at": now,
                    }
                },
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Certificate verification failed: {exc}",
            ) from exc

        await create_notification(
            recipient_id=cert["user_id"],
            recipient_role="employee",
            notif_type="certificate_verified",
            title="Certificate verified",
            message=(
                f"Your certificate for \"{cert.get('course_title')}\" was verified. "
                "The course is marked completed and skills were added to your profile."
            ),
            link="/dashboard/employee/learning?tab=my-courses",
            related_id=str(cert["_id"]),
        )
        try:
            goal = await database.learning_career_goals.find_one({"user_id": cert["user_id"]})
            if goal and goal.get("target_role"):
                await self._recalculate_designation_readiness(cert["user_id"], cert.get("employee_id"), goal["target_role"])
        except Exception:
            pass
        updated = await database.learning_certificates.find_one({"_id": cert["_id"]})
        return {"certificate": self._public_certificate(updated)}

    async def _award_verified_certificate_outcomes(
        self, *, cert: dict, verifier: CurrentUser
    ) -> dict[str, list[str]]:
        """After recruiter approval, write roadmap/catalog skills (+ extra cert labels) to the profile."""
        employee = None
        if cert.get("employee_id"):
            employee = await database.employees.find_one({"employee_id": cert["employee_id"]})
        if not employee and cert.get("user_id"):
            employee = await database.employees.find_one({"user_id": cert["user_id"]})
        org_id = (
            (employee or {}).get("organization_id")
            or cert.get("organization_id")
            or verifier.organization_id
        )
        return await self._award_course_outcomes_to_profile(
            user_id=cert["user_id"],
            employee_id=cert.get("employee_id"),
            organization_id=org_id,
            course_uid=cert.get("course_uid"),
            course_title=cert.get("course_title"),
            source="course",
            award_certifications=True,
            recruiter_id=cert.get("recruiter_id") or verifier.id,
        )

    async def delete_certificate(self, current_user: CurrentUser, certificate_id: str) -> dict:
        if not ObjectId.is_valid(certificate_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Certificate not found.")
        cert = await database.learning_certificates.find_one({"_id": ObjectId(certificate_id), "user_id": current_user.id})
        if not cert:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Certificate not found.")
        # Only allow deletion if not verified (employees can only delete pending/rejected)
        if cert.get("verification_status") == "verified":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot delete verified certificates.")
        await database.learning_certificates.delete_one({"_id": cert["_id"]})
        await self._invalidate_ai_caches(current_user.id)
        return {"message": "Certificate deleted."}

    async def update_certificate(
        self,
        current_user: CurrentUser,
        certificate_id: str,
        course_title: str | None = None,
        completion_date: date | None = None,
        learning_hours: float | None = None,
    ) -> dict:
        if not ObjectId.is_valid(certificate_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Certificate not found.")
        cert = await database.learning_certificates.find_one({"_id": ObjectId(certificate_id), "user_id": current_user.id})
        if not cert:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Certificate not found.")
        if cert.get("verification_status") == "verified":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot edit verified certificates.")
        now = _now()
        updates = {"updated_at": now}
        if course_title is not None:
            updates["course_title"] = course_title.strip()
        if completion_date is not None:
            updates["completion_date"] = (
                datetime.combine(completion_date, datetime.min.time())
                if not isinstance(completion_date, datetime)
                else completion_date
            )
        if learning_hours is not None:
            updates["learning_hours"] = learning_hours

        previous_status = cert.get("verification_status", "pending")
        if previous_status in ("pending", "rejected"):
            updates["verification_status"] = "pending"
            updates["verified_by"] = None
            updates["verified_at"] = None
            updates["rejection_reason"] = None

        await database.learning_certificates.update_one({"_id": cert["_id"]}, {"$set": updates})

        if previous_status == "rejected":
            employee_name = cert.get("employee_name") or "An employee"
            updated_course_title = course_title or cert.get("course_title") or "a course"
            if cert.get("recruiter_id"):
                await create_notification(
                    recipient_id=str(cert["recruiter_id"]),
                    recipient_role="recruiter",
                    notif_type="certificate_uploaded",
                    title="Certificate re-submitted for review",
                    message=f"{employee_name} re-submitted their certificate for \"{updated_course_title}\" after revisions.",
                    link="/dashboard/recruiter/learning",
                    related_id=str(cert["_id"]),
                )

        updated = await database.learning_certificates.find_one({"_id": cert["_id"]})
        result = {"certificate": self._public_certificate(updated)}
        return result

    # ------------------------------------------------------------------ #
    # Designation requirements & readiness (extends existing Career Path)
    # ------------------------------------------------------------------ #

    async def get_designation_requirements(self, current_user: CurrentUser, target_role: str) -> dict:
        """Return the learning requirements for a target designation using existing
        Career Framework / Organization Framework data.

        Looks up the matching career level (from career_levels) and/or org framework
        role to gather required courses, skills, and certifications.
        """
        target_role = " ".join(target_role.split())
        if not target_role:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Target role is required.")

        employee = await self._get_employee(current_user)
        department = employee.get("department")

        # Prefer the employee's active career assignment path (Organization Setup roadmap).
        assignment = await database.employee_career_assignments.find_one(
            {"employee_id": employee.get("employee_id"), "status": "active"}
        )
        if assignment:
            assign_target = (assignment.get("target_role_title") or "").strip()
            assign_current = (assignment.get("current_role_title") or "").strip()
            target_l = target_role.lower()
            if target_l in {assign_target.lower(), assign_current.lower()} or (
                not assign_target and target_l == (employee.get("job_title") or "").strip().lower()
            ):
                path = assignment.get("assigned_learning_path") or []
                required_courses = []
                for course in path:
                    title = course.get("course_title") or course.get("course_uid")
                    if not title:
                        continue
                    required_courses.append({
                        "course_uid": course.get("course_uid") or title,
                        "course_title": title,
                        "source": course.get("source") or "org_framework",
                        "mandatory": course.get("mandatory", True),
                        "order": course.get("order"),
                    })
                required_skills = [
                    s.get("skill") for s in (assignment.get("skills_to_acquire") or []) if s.get("skill")
                ]
                required_certifications = [
                    c.get("certification")
                    for c in (assignment.get("certifications_to_earn") or [])
                    if c.get("certification")
                ]
                if required_courses or required_skills or required_certifications:
                    return {
                        "target_role": assign_target or target_role,
                        "department": assignment.get("current_department") or department,
                        "required_courses": required_courses,
                        "required_skills": required_skills,
                        "required_certifications": required_certifications,
                        "source": "career_assignment",
                    }

        # Career Framework levels (career_levels)
        level = await database.career_levels.find_one({
            "role_title": {"$regex": f"^{_escape_regex(target_role)}$", "$options": "i"},
            "is_active": True,
        })

        if level:
            learning_path = level.get("learning_path") or []
            required_courses = []
            for course in learning_path:
                required_courses.append({
                    "course_uid": course.get("course_uid"),
                    "course_title": course.get("course_title"),
                    "source": course.get("source", "microsoft_learn"),
                    "mandatory": course.get("mandatory", True),
                    "order": course.get("order"),
                })
            required_skills = [s.get("skill") for s in (level.get("required_skills") or []) if s.get("skill")]
            required_certifications = [c.get("certification") for c in (level.get("required_certifications") or []) if c.get("certification")]
            if required_courses or required_skills or required_certifications:
                return {
                    "target_role": target_role,
                    "department": level.get("department"),
                    "required_courses": required_courses,
                    "required_skills": required_skills,
                    "required_certifications": required_certifications,
                    "source": "career_framework",
                }

        # Fallback: Organization Framework roles
        org_role_q: dict[str, Any] = {
            "name": {"$regex": f"^{_escape_regex(target_role)}$", "$options": "i"},
        }
        if employee.get("organization_id"):
            org_role_q["organization_id"] = employee["organization_id"]
        org_role = await database.org_framework_roles.find_one(org_role_q)

        if org_role:
            # Career Roadmaps are the single source of truth: one ordered list of
            # catalog items (modules, paths, and certifications). Cert-type items
            # stay in required_courses — readiness already treats verified
            # certificates as completion for those entries.
            org_id = org_role.get("organization_id")
            roadmap_q: dict = {"role_name": org_role.get("name") or target_role}
            if org_id:
                roadmap_q["organization_id"] = org_id
            roadmap_docs = await database.org_framework_roadmaps.find(roadmap_q).sort(
                "order", 1
            ).to_list(length=200)
            required_courses = []
            for course in roadmap_docs:
                required_courses.append({
                    "course_uid": course.get("course_id"),
                    "course_title": course.get("course_name") or course.get("course_id"),
                    "source": "org_framework",
                    "mandatory": course.get("mandatory", True),
                    "order": course.get("order"),
                    "catalog_type": course.get("catalog_type"),
                })
            if required_courses:
                return {
                    "target_role": target_role,
                    "department": org_role.get("department"),
                    "required_courses": required_courses,
                    "required_skills": [],
                    "required_certifications": [],
                    "source": "org_framework",
                }
            # Legacy fallback: older frameworks stored skills/certs separately.
            skill_docs = await database.org_framework_skills.find(
                {"organization_id": org_id, "role_name": target_role} if org_id else {"role_name": target_role}
            ).to_list(length=100)
            cert_docs = await database.org_framework_certifications.find(
                {"organization_id": org_id, "role_name": target_role} if org_id else {"role_name": target_role}
            ).to_list(length=100)
            required_skills = [s.get("skill_name") for s in skill_docs if s.get("skill_name")]
            required_certifications = [c.get("certification_name") for c in cert_docs if c.get("certification_name")]
            return {
                "target_role": target_role,
                "department": org_role.get("department"),
                "required_courses": [],
                "required_skills": required_skills,
                "required_certifications": required_certifications,
                "source": "org_framework",
            }

        return {
            "target_role": target_role,
            "department": department,
            "required_courses": [],
            "required_skills": [],
            "required_certifications": [],
            "source": "unknown",
        }

    async def get_designation_readiness(self, current_user: CurrentUser, target_role: str | None = None) -> dict:
        """Calculate an employee's readiness and eligibility for a target designation.

        Deterministic backend calculation — no AI. Queries actual:
          - learning_assignments (assigned / in_progress / completed courses)
          - learning_enrollments (started courses with progress)
          - learning_certificates (verified certificates)
          - employee_skills (acquired skills)
        against the target role's requirements from Career Framework / Org Framework.
        """
        employee = await self._get_employee(current_user)
        user_id = current_user.id
        employee_id = employee.get("employee_id")

        # Prefer official career-path next role over a free-form / stale goal.
        assignment = await database.employee_career_assignments.find_one(
            {"employee_id": employee_id, "status": "active"}
        )
        org_target = (assignment or {}).get("target_role_title") or (assignment or {}).get("current_role_title")

        resolved_role = target_role
        if not resolved_role:
            resolved_role = org_target
        if not resolved_role:
            goal = await database.learning_career_goals.find_one({"user_id": user_id})
            resolved_role = (goal or {}).get("target_role")
        if not resolved_role:
            resolved_role = employee.get("job_title")
        if not resolved_role:
            return {
                "target_role": None,
                "readiness_percent": 0,
                "eligible": False,
                "requirements": [],
                "missing_count": 0,
                "message": "No career path is assigned for your role yet.",
            }

        requirements = await self.get_designation_requirements(current_user, resolved_role)
        req_courses = requirements.get("required_courses") or []
        req_skills = requirements.get("required_skills") or []
        req_certs = requirements.get("required_certifications") or []

        # All learning assignments (career path + recruiter) — not only designation-flagged rows.
        assigned_courses = await database.learning_assignments.find({
            "employee_id": employee_id,
        }).to_list(length=500)

        enrollments = await database.learning_enrollments.find({"user_id": user_id}).to_list(length=500)
        enroll_by_uid = {e.get("course_uid"): e for e in enrollments if e.get("course_uid")}

        verified_certs = await database.learning_certificates.find({
            "user_id": user_id,
            "verification_status": "verified",
        }).to_list(length=200)
        cert_titles = {c.get("course_title", "").lower() for c in verified_certs if c.get("course_title")}
        cert_uids = {c.get("course_uid") for c in verified_certs if c.get("course_uid")}

        employee_skills = await database.employee_skills.find({"user_id": user_id}).to_list(length=200)
        emp_skill_names = {s.get("skill_name", "").lower() for s in employee_skills if s.get("skill_name")}

        # Build requirement statuses
        requirement_items = []
        total_weight = 0
        completed_weight = 0

        for course in req_courses:
            uid = course.get("course_uid") or ""
            title = course.get("course_title") or ""
            is_cert_required = not uid.startswith("kb-cert:")
            mandatory = course.get("mandatory", True)

            assignment = next((a for a in assigned_courses if a.get("course_uid") == uid or a.get("course_title", "").lower() == title.lower()), None)
            enrollment = enroll_by_uid.get(uid)
            has_verified_cert = uid in cert_uids or title.lower() in cert_titles

            if has_verified_cert:
                status = "verified"
            elif enrollment and enrollment.get("status") == "completed":
                status = "completed" if not is_cert_required else "certificate_pending"
            elif assignment:
                status = "in_progress" if enrollment and enrollment.get("status") == "in_progress" else "assigned"
            else:
                status = "not_started"

            weight = 10 if mandatory else 5
            total_weight += weight
            if status in ("completed", "verified"):
                completed_weight += weight

            requirement_items.append({
                "type": "course",
                "title": title,
                "course_uid": uid,
                "mandatory": mandatory,
                "status": status,
                "source": course.get("source"),
            })

        for skill in req_skills:
            skill_lower = skill.lower()
            acquired = skill_lower in emp_skill_names
            status = "acquired" if acquired else "missing"
            weight = 8
            total_weight += weight
            if acquired:
                completed_weight += weight
            requirement_items.append({
                "type": "skill",
                "title": skill,
                "mandatory": True,
                "status": status,
            })

        for cert in req_certs:
            cert_lower = cert.lower()
            has_cert = cert_lower in cert_titles
            status = "verified" if has_cert else "missing"
            weight = 12
            total_weight += weight
            if has_cert:
                completed_weight += weight
            requirement_items.append({
                "type": "certification",
                "title": cert,
                "mandatory": True,
                "status": status,
            })

        if not requirement_items:
            return {
                "target_role": resolved_role,
                "readiness_percent": 0,
                "eligible": False,
                "requirements": [],
                "missing_count": 0,
                "completed_count": 0,
                "total_count": 0,
                "source": requirements.get("source") or "unknown",
                "message": (
                    f"No formal course/skill checklist is configured for “{resolved_role}” yet. "
                    "Ask your recruiter to add Career Roadmap items under Organization Setup."
                ),
            }

        readiness_pct = round(completed_weight / total_weight * 100) if total_weight else 0

        # Eligibility: all mandatory items must be completed/verified/acquired
        mandatory_incomplete = any(
            item for item in requirement_items
            if item.get("mandatory") and item.get("status") not in ("completed", "verified", "acquired")
        )
        eligible = not mandatory_incomplete and readiness_pct >= 100

        return {
            "target_role": resolved_role,
            "readiness_percent": readiness_pct,
            "eligible": eligible,
            "requirements": requirement_items,
            "missing_count": sum(1 for item in requirement_items if item.get("status") in ("not_started", "missing", "assigned", "in_progress", "certificate_pending")),
            "completed_count": sum(1 for item in requirement_items if item.get("status") in ("completed", "verified", "acquired")),
            "total_count": len(requirement_items),
            "source": requirements.get("source"),
        }

    async def _recalculate_designation_readiness(self, user_id: str, employee_id: str, target_role: str) -> dict:
        """Internal recalculation triggered by certificate verification or course completion."""
        current_user = CurrentUser(id=user_id, role="employee", email="")
        return await self.get_designation_readiness(current_user, target_role)

    async def get_employee_designation_readiness(self, current_user: CurrentUser, employee_id: str, target_role: str | None = None) -> dict:
        """Recruiter view: get an employee's designation readiness."""
        employee = await self._get_employee_by_id(employee_id)
        await self._assert_recruiter_owns(current_user, employee)

        resolved_role = target_role
        if not resolved_role:
            goal = await database.learning_career_goals.find_one({"employee_id": employee_id})
            resolved_role = (goal or {}).get("target_role")
        if not resolved_role:
            resolved_role = employee.get("job_title")
        if not resolved_role:
            return {
                "employee_id": employee_id,
                "employee_name": employee.get("full_name"),
                "target_role": None,
                "readiness_percent": 0,
                "eligible": False,
                "requirements": [],
                "message": "Employee has no target designation set.",
            }

        # Use a synthetic current_user for the calculation
        synth = CurrentUser(id=employee.get("user_id", ""), role="employee", email=employee.get("email", ""))
        readiness = await self.get_designation_readiness(synth, resolved_role)
        return {
            "employee_id": employee_id,
            "employee_name": employee.get("full_name"),
            "current_designation": employee.get("job_title"),
            **readiness,
        }

    async def _extract_certificate_text(self, cert: dict) -> str | None:
        """Best-effort OCR of an uploaded certificate for skill extraction."""
        file_url = cert.get("file_url")
        if not file_url:
            return None
        try:
            import tempfile
            from pathlib import Path

            import httpx

            from app.services.document_extraction_service import document_extraction_service

            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(file_url)
                if response.status_code != 200:
                    return None
                content = response.content
            suffix = Path(cert.get("file_name") or "certificate.pdf").suffix or ".pdf"
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                tmp.write(content)
                tmp_path = tmp.name
            try:
                text = await __import__("asyncio").to_thread(
                    document_extraction_service.extract_text, tmp_path
                )
                return (text or "")[:4000]
            finally:
                Path(tmp_path).unlink(missing_ok=True)
        except Exception:
            return None

    async def _upsert_verified_skill(
        self,
        *,
        user_id: str,
        employee_id: str | None,
        skill_name: str,
        category: str,
        proficiency: str,
        source: str,
        verification_status: str = "verified",
    ) -> None:
        """Upsert one skill row per name — higher proficiency wins (Beginner→Intermediate upgrades in place)."""
        now = _now()
        name = (skill_name or "").strip()
        if not name:
            return
        new_prof = self._normalize_proficiency(proficiency)
        existing = await database.employee_skills.find_one(
            {"user_id": user_id, "skill_name": {"$regex": f"^{_escape_regex(name)}$", "$options": "i"}}
        )
        if existing:
            current = self._normalize_proficiency(existing.get("proficiency") or "Beginner")
            kept_prof = new_prof if self._proficiency_rank(new_prof) >= self._proficiency_rank(current) else current
            prev_status = (existing.get("verification_status") or "unverified").lower()
            kept_status = (
                "verified"
                if verification_status == "verified" or prev_status == "verified"
                else (verification_status or prev_status or "unverified")
            )
            await database.employee_skills.update_one(
                {"_id": existing["_id"]},
                {
                    "$set": {
                        "skill_name": existing.get("skill_name") or name,
                        "proficiency": kept_prof,
                        "category": category if category in SKILL_CATEGORIES else existing.get("category") or "Other",
                        "source": source or existing.get("source") or "course",
                        "verification_status": kept_status,
                        "updated_at": now,
                    }
                },
            )
            return
        await database.employee_skills.insert_one(
            {
                "user_id": user_id,
                "employee_id": employee_id,
                "skill_name": name,
                "category": category if category in SKILL_CATEGORIES else "Other",
                "proficiency": new_prof,
                "years_experience": None,
                "source": source,
                "verification_status": verification_status or "verified",
                "created_at": now,
                "updated_at": now,
            }
        )

    async def _sync_career_assignment_progress(
        self, *, user_id: str, employee_id: str | None = None
    ) -> None:
        """Refresh active career-path checklist from enrollments, skills, and verified certs."""
        eid = employee_id
        if not eid:
            emp = await database.employees.find_one({"user_id": user_id, "status": "active"})
            eid = (emp or {}).get("employee_id")
        if not eid:
            return
        doc = await database.employee_career_assignments.find_one(
            {"employee_id": eid, "status": "active"}
        )
        if not doc:
            return

        now = _now()
        path = list(doc.get("assigned_learning_path") or [])
        enrollments = await database.learning_enrollments.find({"user_id": user_id}).to_list(length=500)
        enrollment_map = {e.get("course_uid"): e for e in enrollments if e.get("course_uid")}
        for course in path:
            uid = course.get("course_uid")
            enrollment = enrollment_map.get(uid) if uid else None
            if not enrollment:
                continue
            st = (enrollment.get("status") or "").lower()
            if st == "completed":
                course["status"] = "completed"
                course["progress_percent"] = 100
                course["completed_at"] = _iso(enrollment.get("completed_at") or now)
            elif st in {"in_progress", "enrolled", "assigned"}:
                if course.get("status") != "completed":
                    course["status"] = "in_progress"
                    course["progress_percent"] = enrollment.get("progress_percent") or 0

        owned = await database.employee_skills.find({"user_id": user_id}).to_list(length=500)
        owned_map = {
            (s.get("skill_name") or "").strip().lower(): s
            for s in owned
            if (s.get("skill_name") or "").strip()
        }
        skills_to_acquire = list(doc.get("skills_to_acquire") or [])
        for skill in skills_to_acquire:
            key = (skill.get("skill") or skill.get("name") or "").strip().lower()
            match = owned_map.get(key)
            if not match:
                continue
            current_prof = self._normalize_proficiency(match.get("proficiency") or "Beginner")
            target_prof = self._normalize_proficiency(skill.get("target_proficiency") or "Intermediate")
            skill["current_proficiency"] = current_prof
            if self._proficiency_rank(current_prof) >= self._proficiency_rank(target_prof):
                skill["current_status"] = "acquired"

        cert_docs = await database.learning_certificates.find(
            {"user_id": user_id, "verification_status": "verified"}
        ).to_list(length=300)
        cert_titles = {
            (c.get("course_title") or c.get("title") or "").strip().lower()
            for c in cert_docs
            if (c.get("course_title") or c.get("title") or "").strip()
        }
        certifications_to_earn = list(doc.get("certifications_to_earn") or [])
        for cert in certifications_to_earn:
            name = (cert.get("certification") or cert.get("name") or "").strip().lower()
            if not name:
                continue
            if any(name == t or name in t or t in name for t in cert_titles):
                cert["status"] = "earned"
                cert["earned_at"] = cert.get("earned_at") or _iso(now)

        # Pending / verified cert submissions tied to path courses.
        pending_certs = await database.learning_certificates.find(
            {"user_id": user_id, "verification_status": {"$in": ["pending", "verified", "rejected"]}}
        ).to_list(length=300)
        pending_by_uid = {}
        pending_by_title = {}
        for c in pending_certs:
            if c.get("course_uid"):
                pending_by_uid[c["course_uid"]] = c
            title_key = (c.get("course_title") or "").strip().lower()
            if title_key:
                pending_by_title[title_key] = c

        for course in path:
            uid = course.get("course_uid")
            title_key = (course.get("course_title") or "").strip().lower()
            cert_doc = (pending_by_uid.get(uid) if uid else None) or pending_by_title.get(title_key)
            if cert_doc:
                course["certificate_status"] = cert_doc.get("verification_status")
                course["certificate_id"] = str(cert_doc.get("_id"))
                if cert_doc.get("verification_status") == "verified":
                    course["status"] = "completed"
                    course["progress_percent"] = 100
            # Mark nested skills/certs complete when profile has them.
            nested_skills = []
            for skill_name in course.get("skills") or []:
                if isinstance(skill_name, dict):
                    skill_name = skill_name.get("skill") or skill_name.get("name")
                key = (skill_name or "").strip().lower()
                match = owned_map.get(key)
                nested_skills.append({
                    "skill": skill_name,
                    "status": (
                        "acquired"
                        if match and self._proficiency_rank(self._normalize_proficiency(match.get("proficiency") or "Beginner"))
                        >= self._proficiency_rank("Intermediate")
                        else "pending"
                    ),
                })
            if nested_skills:
                course["skill_progress"] = nested_skills
            nested_certs = []
            for cert_name in course.get("certifications") or []:
                if isinstance(cert_name, dict):
                    cert_name = cert_name.get("certification") or cert_name.get("name")
                key = (cert_name or "").strip().lower()
                earned = any(key == t or key in t or t in key for t in cert_titles)
                nested_certs.append({
                    "certification": cert_name,
                    "status": "earned" if earned else "pending",
                })
            if nested_certs:
                course["certification_progress"] = nested_certs

        total = 0
        done = 0
        for course in path:
            total += 1
            if course.get("status") == "completed":
                done += 1
        for skill in skills_to_acquire:
            total += 1
            if skill.get("current_status") == "acquired":
                done += 1
        for cert in certifications_to_earn:
            total += 1
            if cert.get("status") == "earned":
                done += 1
        score = round(100 * done / total) if total else int(doc.get("readiness_score") or 0)

        await database.employee_career_assignments.update_one(
            {"_id": doc["_id"]},
            {
                "$set": {
                    "assigned_learning_path": path,
                    "skills_to_acquire": skills_to_acquire,
                    "certifications_to_earn": certifications_to_earn,
                    "overall_progress_percent": score,
                    "readiness_score": score,
                    "updated_at": now,
                }
            },
        )

    # ------------------------------------------------------------------ #
    # US-092 / US-093 / US-094: Skill matrix
    # ------------------------------------------------------------------ #
    async def get_skill_categories(self) -> dict:
        return {"categories": SKILL_CATEGORIES}

    async def list_skills(self, current_user: CurrentUser) -> dict:
        """Return skills saved on the employee profile only (not live resume OCR merge).

        Resume skills are written into employee_skills when the resume is uploaded/updated
        on Profile / onboarding. Verified courses add skills here too.
        """
        docs = await database.employee_skills.find({"user_id": current_user.id}).sort(
            "skill_name", 1
        ).to_list(length=300)
        return {"skills": [self._public_skill(d) for d in docs]}

    async def upsert_skill(self, current_user: CurrentUser, request: SkillUpsertRequest) -> dict:
        employee = await self._get_employee(current_user)
        now = _now()
        existing = await database.employee_skills.find_one(
            {"user_id": current_user.id, "skill_name": {"$regex": f"^{_escape_regex(request.skill_name)}$", "$options": "i"}}
        )
        if existing:
            await database.employee_skills.update_one(
                {"_id": existing["_id"]},
                {
                    "$set": {
                        "category": request.category,
                        "proficiency": request.proficiency,
                        "years_experience": request.years_experience,
                        "updated_at": now,
                    }
                },
            )
            doc = await database.employee_skills.find_one({"_id": existing["_id"]})
        else:
            doc = {
                "user_id": current_user.id,
                "employee_id": employee.get("employee_id"),
                "skill_name": request.skill_name,
                "category": request.category,
                "proficiency": request.proficiency,
                "years_experience": request.years_experience,
                "source": "manual",
                "verification_status": "unverified",
                "created_at": now,
                "updated_at": now,
            }
            result = await database.employee_skills.insert_one(doc)
            doc["_id"] = result.inserted_id
        await self._invalidate_ai_caches(current_user.id)
        return {"skill": self._public_skill(doc)}

    async def delete_skill(self, current_user: CurrentUser, skill_id: str) -> dict:
        if not ObjectId.is_valid(skill_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill not found.")
        result = await database.employee_skills.delete_one({"_id": ObjectId(skill_id), "user_id": current_user.id})
        if result.deleted_count == 0:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill not found.")
        await self._invalidate_ai_caches(current_user.id)
        return {"deleted": True, "cache_invalidated": True}

    # ------------------------------------------------------------------ #
    # US-095 / US-099 (lite): Career goal + AI path
    # ------------------------------------------------------------------ #
    async def set_career_goal(self, current_user: CurrentUser, request: CareerGoalRequest) -> dict:
        employee = await self._get_employee(current_user)
        now = _now()
        await database.learning_career_goals.update_one(
            {"user_id": current_user.id},
            {
                "$set": {
                    "user_id": current_user.id,
                    "employee_id": employee.get("employee_id"),
                    "target_role": request.target_role,
                    "updated_at": now,
                    "ai_path": None,  # invalidate cached path so it regenerates for the new goal
                },
                "$setOnInsert": {"created_at": now},
            },
            upsert=True,
        )
        return await self.get_career_path(current_user, refresh=True)

    async def get_career_goal(self, current_user: CurrentUser) -> dict:
        doc = await database.learning_career_goals.find_one({"user_id": current_user.id})
        if not doc:
            return {"target_role": None}
        return {"target_role": doc.get("target_role")}

    async def get_skill_gap(
        self, current_user: CurrentUser, target_role: str | None, *, refresh: bool = False
    ) -> dict:
        """Skill gap — prefer Organization Setup career assignment; else KB; else AI."""
        employee = await self._get_employee(current_user)
        resolved_role = target_role
        if not resolved_role:
            goal = await database.learning_career_goals.find_one({"user_id": current_user.id})
            resolved_role = (goal or {}).get("target_role") or employee.get("job_title")
        if not resolved_role:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Set a career goal or target role first.",
            )

        # Official org career path beats free-form / AI invented gaps.
        org_gap = await self._skill_gap_from_career_assignment(employee, resolved_role)
        if org_gap:
            return org_gap

        recruiter_id = self._employee_recruiter_id(employee)
        hashes = await learning_cache_service.compute_input_hashes(current_user.id, recruiter_id)
        # Include target role in effective cache identity via collection key
        if not refresh:
            cached = await learning_cache_service.get_cached_skill_gap(current_user.id, resolved_role, hashes)
            if cached:
                return cached

        resume_fields = await self._get_resume_fields(current_user.id)
        current_skills = await self._current_skill_names(current_user.id, resume_fields)
        employee_certs = await self._employee_cert_titles(current_user.id)

        # No recruiter KB roles anymore — skill gaps are AI-analyzed and
        # cached by input hashes below.
        analysis: dict | None = None

        # Fall back to AI gap analysis (cached by hashes)
        ai = await learning_ai_service.analyze_skill_gap(
            job_title=employee.get("job_title"),
            department=employee.get("department"),
            target_role=resolved_role,
            current_skills=current_skills,
            professional_summary=resume_fields.get("professional_summary"),
        )
        if not ai:
            analysis = {
                "target_role": resolved_role,
                "current_skills": current_skills,
                "missing_skills": [],
                "skill_gaps": [],
                "matched_skills": [],
                "readiness_percentage": None,
                "summary": "AI analysis is temporarily unavailable. Please try again shortly.",
                "recommended_courses": [],
                "missing_certifications": [],
            }
        else:
            analysis = {
                "target_role": resolved_role,
                "current_skills": current_skills,
                "missing_skills": [m["skill"] for m in ai["missing_skills"]],
                "skill_gaps": ai["missing_skills"],
                "matched_skills": ai["matched_skills"],
                "readiness_percentage": ai["readiness_percentage"],
                "summary": ai["summary"],
                "missing_certifications": [],
                "deterministic": False,
            }

        missing_objs = analysis.get("skill_gaps") or []
        priority_order = {"critical": 0, "immediate": 1, "medium": 2, "low": 3}
        missing_objs = sorted(missing_objs, key=lambda m: priority_order.get(m.get("priority"), 2))
        missing_names = [m["skill"] for m in missing_objs] if missing_objs else (analysis.get("missing_skills") or [])

        recommended_courses = []
        if missing_names:
            candidates = await catalog_service.find_courses_for_keywords(
                missing_names, per_keyword=3, limit=len(missing_names) * 3
            )
            for gap in missing_objs or [{"skill": n, "priority": "medium", "reason": ""} for n in missing_names]:
                skill = gap["skill"] if isinstance(gap, dict) else gap
                priority = gap.get("priority", "medium") if isinstance(gap, dict) else "medium"
                reason = gap.get("reason", "") if isinstance(gap, dict) else ""
                match = next(
                    (
                        c
                        for c in candidates
                        if skill.lower() in (c.get("title") or "").lower()
                        or skill.lower() in " ".join(c.get("products") or []).lower()
                    ),
                    None,
                )
                if not match and candidates:
                    match = candidates[0]
                if match:
                    recommended_courses.append(
                        {
                            "skill": skill,
                            "priority": priority,
                            "reason": reason,
                            "course": self._public_course(match),
                        }
                    )
                    candidates = [c for c in candidates if c["uid"] != match["uid"]]

        payload = {
            "target_role": resolved_role,
            "current_skills": current_skills,
            "missing_skills": missing_names,
            "skill_gaps": missing_objs,
            "matched_skills": analysis.get("matched_skills") or [],
            "readiness_percentage": analysis.get("readiness_percentage"),
            "summary": analysis.get("summary"),
            "recommended_courses": recommended_courses,
            "missing_certifications": analysis.get("missing_certifications") or [],
            "skill_match_percent": analysis.get("skill_match_percent"),
            "certification_match_percent": analysis.get("certification_match_percent"),
            "learning_priority": analysis.get("learning_priority"),
            "source": "ai",
            "cached": False,
            "lastAnalyzedAt": _now().isoformat(),
            **{k: hashes[k] for k in hashes},
        }
        await learning_cache_service.store_skill_gap(current_user.id, resolved_role, payload, hashes)
        return payload

    async def _skill_gap_from_career_assignment(self, employee: dict, resolved_role: str) -> dict | None:
        """Build skill gap only from Organization Setup career-path skills/certs."""
        if not employee or not resolved_role:
            return None
        assignment = await database.employee_career_assignments.find_one(
            {"employee_id": employee.get("employee_id"), "status": "active"}
        )
        if not assignment:
            return None
        target = (assignment.get("target_role_title") or "").strip()
        current = (assignment.get("current_role_title") or "").strip()
        role_l = resolved_role.strip().lower()
        if role_l not in {target.lower(), current.lower()}:
            return None

        skills = assignment.get("skills_to_acquire") or []
        certs = assignment.get("certifications_to_earn") or []
        matched = [
            s.get("skill")
            for s in skills
            if s.get("skill") and s.get("current_status") == "acquired"
        ]
        skill_gaps = [
            {
                "skill": s.get("skill"),
                "priority": "immediate",
                "reason": f"Listed on your Career Roadmap toward {target or resolved_role}",
            }
            for s in skills
            if s.get("skill") and s.get("current_status") != "acquired"
        ]
        missing_certs = [
            c.get("certification")
            for c in certs
            if c.get("certification") and c.get("status") != "earned"
        ]
        total = len(skills) + len(certs)
        done = len(matched) + sum(1 for c in certs if c.get("status") == "earned")
        readiness = assignment.get("readiness_score")
        if readiness is None:
            readiness = round(done / total * 100) if total else 0
        skill_match = round(len(matched) / len(skills) * 100) if skills else 100
        cert_match = (
            round(sum(1 for c in certs if c.get("status") == "earned") / len(certs) * 100)
            if certs
            else 100
        )
        focus = target or resolved_role
        if skill_gaps or missing_certs:
            summary = (
                f"Only skills and certifications from your Organization Setup Career Roadmap "
                f"toward {focus} are listed here — not generic market suggestions. "
                f"Finish the remaining roadmap courses in My Learning to close these gaps."
            )
        else:
            unfinished = [
                c.get("course_title")
                for c in (assignment.get("assigned_learning_path") or [])
                if c.get("status") != "completed"
            ]
            if unfinished:
                summary = (
                    f"You already meet the roadmap skill checklist for {focus}. "
                    f"Complete the remaining courses on your Career Roadmap "
                    f"({len(unfinished)} left) and get certificates verified."
                )
            else:
                summary = f"You have completed the Career Roadmap skill and course checklist toward {focus}."

        return {
            "target_role": focus,
            "current_skills": matched,
            "missing_skills": [g["skill"] for g in skill_gaps],
            "skill_gaps": skill_gaps,
            "matched_skills": matched,
            "readiness_percentage": int(round(readiness)),
            "summary": summary,
            "recommended_courses": [],
            "missing_certifications": missing_certs,
            "skill_match_percent": skill_match,
            "certification_match_percent": cert_match,
            "learning_priority": "immediate" if skill_gaps or missing_certs else "low",
            "source": "career_assignment",
            "deterministic": True,
            "cached": False,
            "lastAnalyzedAt": _now().isoformat(),
        }

    async def get_career_path(self, current_user: CurrentUser, *, refresh: bool = False) -> dict:
        goal = await database.learning_career_goals.find_one({"user_id": current_user.id})
        if not goal or not goal.get("target_role"):
            return {"target_role": None, "path": [], "readiness_percentage": None, "summary": None}

        employee = await self._get_employee(current_user)
        org_path = await self._career_path_from_assignment(employee, goal["target_role"])
        if org_path:
            return org_path

        cached = goal.get("ai_path")
        if cached and not refresh and cached.get("source") != "career_assignment":
            hashes = await learning_cache_service.compute_input_hashes(
                current_user.id, self._employee_recruiter_id(employee)
            )
            if learning_cache_service.hashes_match(cached.get("cache_meta") or {}, hashes):
                return await self._refresh_path_completion_flags(cached, current_user.id)

        gap = await self.get_skill_gap(current_user, goal["target_role"], refresh=refresh)
        # If gap came from career assignment, path builder above should have returned — safety net.
        if gap.get("source") == "career_assignment":
            org_path = await self._career_path_from_assignment(employee, goal["target_role"])
            if org_path:
                return org_path

        recruiter_id = self._employee_recruiter_id(employee)

        keywords = list(gap.get("missing_skills") or []) + [goal["target_role"]]
        catalog_courses = await catalog_service.find_courses_for_keywords(keywords, per_keyword=4, limit=40)

        existing_certs = await self._employee_cert_titles(current_user.id)
        enrollments = await database.learning_enrollments.find(
            {"user_id": current_user.id, "status": "completed"}
        ).to_list(length=300)
        completed_uids = {e["course_uid"] for e in enrollments if e.get("course_uid")}

        path_payload = learning_path_service.build_learning_path(
            target_role=goal["target_role"],
            missing_skills=gap.get("missing_skills") or [],
            missing_certifications=gap.get("missing_certifications") or [],
            catalog_courses=catalog_courses,
            existing_certifications=existing_certs,
            completed_uids=completed_uids,
        )

        hashes = await learning_cache_service.compute_input_hashes(current_user.id, recruiter_id)
        payload = {
            **path_payload,
            "certification": path_payload["path"][-1] if path_payload["path"] and path_payload["path"][-1].get("kind") == "certification" else None,
            "readiness_percentage": gap.get("readiness_percentage"),
            "summary": gap.get("summary"),
            "skill_match_percent": gap.get("skill_match_percent"),
            "certification_match_percent": gap.get("certification_match_percent"),
            "generated_at": _now().isoformat(),
            "cache_meta": hashes,
            "source": "ai_catalog",
        }
        ui_path = []
        for step in path_payload.get("path") or []:
            ui_path.append(
                {
                    "step": step["step"],
                    "skill": step.get("skill"),
                    "course": {
                        "uid": step.get("uid"),
                        "title": step.get("title"),
                        "url": step.get("url"),
                        "type": step.get("type"),
                        "source": step.get("source"),
                        "duration_minutes": step.get("duration_minutes"),
                        "provider": step.get("provider"),
                    },
                    "kind": step.get("kind"),
                    "completed": step.get("completed"),
                    "estimated_hours": step.get("estimated_hours"),
                    "difficulty": step.get("difficulty"),
                }
            )
        payload["path"] = ui_path

        await database.learning_career_goals.update_one({"_id": goal["_id"]}, {"$set": {"ai_path": payload}})
        return payload

    async def _career_path_from_assignment(self, employee: dict, target_role: str) -> dict | None:
        """Official Career Roadmap courses for the employee's org assignment."""
        if not employee or not target_role:
            return None
        assignment = await database.employee_career_assignments.find_one(
            {"employee_id": employee.get("employee_id"), "status": "active"}
        )
        if not assignment:
            return None
        assign_target = (assignment.get("target_role_title") or "").strip()
        assign_current = (assignment.get("current_role_title") or "").strip()
        role_l = target_role.strip().lower()
        if role_l not in {assign_target.lower(), assign_current.lower()}:
            return None

        learning_path = list(assignment.get("assigned_learning_path") or [])
        if employee.get("user_id") and learning_path:
            try:
                from app.services.career_framework_service import career_framework_service

                learning_path = await career_framework_service._enrich_learning_path(
                    employee["user_id"], learning_path
                )
            except Exception:
                pass

        if not learning_path:
            return None

        ui_path = []
        for index, course in enumerate(learning_path, start=1):
            uid = course.get("course_uid") or course.get("course_title")
            title = course.get("course_title") or uid
            skills = course.get("skills") or []
            skill_label = ", ".join(skills[:3]) if skills else "Roadmap course"
            certs = course.get("certifications") or []
            status = (course.get("status") or "").lower()
            cert_status = (course.get("certificate_status") or "").lower()
            completed = status == "completed" or cert_status == "verified"
            kind = "certification" if (course.get("catalog_type") or "").lower() in {
                "certification",
                "certificate",
            } or certs else "course"
            ui_path.append(
                {
                    "step": index,
                    "skill": skill_label,
                    "course": {
                        "uid": uid,
                        "title": title,
                        "url": course.get("course_url") or course.get("url"),
                        "type": course.get("catalog_type") or course.get("source") or "course",
                        "source": course.get("source") or "org_framework",
                        "duration_minutes": course.get("duration_minutes"),
                        "provider": course.get("source") or "Career Roadmap",
                    },
                    "kind": kind,
                    "completed": completed,
                    "estimated_hours": None,
                    "difficulty": course.get("skills_award_level"),
                }
            )

        progress = assignment.get("overall_progress_percent")
        if progress is None:
            done = sum(1 for s in ui_path if s.get("completed"))
            progress = round(done / len(ui_path) * 100) if ui_path else 0

        focus = assign_target or target_role
        return {
            "target_role": focus,
            "path": ui_path,
            "progress_percent": progress,
            "readiness_percentage": assignment.get("readiness_score") or progress,
            "summary": (
                f"Courses from your Organization Setup Career Roadmap toward {focus}. "
                "These are the same items as your promotion checklist and My Learning."
            ),
            "estimated_total_hours": None,
            "source": "career_assignment",
            "generated_at": _now().isoformat(),
        }
    async def _refresh_path_completion_flags(self, payload: dict, user_id: str) -> dict:
        """Update completed flags on a cached path from live enrollments + certificates."""
        enrollments = await database.learning_enrollments.find(
            {"user_id": user_id, "status": "completed"}, {"course_uid": 1}
        ).to_list(length=300)
        completed_uids = {e["course_uid"] for e in enrollments if e.get("course_uid")}
        existing_certs = {(c or "").strip().lower() for c in await self._employee_cert_titles(user_id)}

        steps = list(payload.get("path") or [])
        for step in steps:
            course = step.get("course") or {}
            uid = course.get("uid") or step.get("uid")
            skill = (step.get("skill") or "").strip().lower()
            title = (course.get("title") or "").strip().lower()
            done = bool(uid and uid in completed_uids)
            if step.get("kind") == "certification":
                done = done or (skill in existing_certs) or (title in existing_certs)
            step["completed"] = done

        done_count = sum(1 for s in steps if s.get("completed"))
        total = len(steps)
        payload = {**payload, "path": steps}
        payload["completed_steps"] = done_count
        payload["total_steps"] = total
        payload["progress_percent"] = round(100.0 * done_count / total) if total else 0
        return payload

    async def get_role_matches(self, current_user: CurrentUser, *, refresh: bool = False) -> dict:
        """Career matching now comes from Organization Setup role ladders.

        The recruiter Knowledge Base was removed, so this endpoint returns an
        empty match list. It is kept for API compatibility only.
        """
        employee = await self._get_employee(current_user)
        recruiter_id = self._employee_recruiter_id(employee)
        hashes = await learning_cache_service.compute_input_hashes(current_user.id, recruiter_id)
        matches: list[dict] = []
        await learning_cache_service.store_role_matches(current_user.id, matches, hashes)
        return {
            "roles": matches,
            "generated_at": _now().isoformat(),
            "cached": False,
            "cache_meta": hashes,
        }

    # ------------------------------------------------------------------ #
    # US-074: AI course recommendations
    # ------------------------------------------------------------------ #
    _NEXT_PROFICIENCY = {
        "Beginner": "Intermediate",
        "Intermediate": "Advanced",
        "Advanced": "Expert",
        "Expert": "Expert",
    }

    async def get_recommendations(self, current_user: CurrentUser, *, refresh: bool = False) -> dict:
        """Recommend courses aligned to role + profile skills, aimed at raising proficiency.

        Cache-first: any saved recommendations for this employee are returned until
        the user explicitly refreshes (refresh=True). Tab open never forces a regen.
        """
        employee = await self._get_employee(current_user)
        user_id = current_user.id

        cached = await database.learning_ai_recommendations.find_one({"user_id": user_id})
        if cached and not refresh and (cached.get("recommendations") is not None):
            # Persist until manual Refresh — do not auto-expire on TTL.
            return {
                "recommendations": cached.get("recommendations") or [],
                "generated_at": _iso(cached.get("generated_at")),
                "stale": False,
                "cached": True,
                "source": cached.get("source") or "skill_role_aligned",
                "basis": cached.get("basis")
                or "Matched to your role and skills to raise proficiency.",
            }

        assignment = await database.employee_career_assignments.find_one(
            {"employee_id": employee.get("employee_id"), "status": "active"}
        )
        org_goal = (assignment or {}).get("target_role_title")
        goal_doc = await database.learning_career_goals.find_one({"user_id": user_id})
        career_goal = org_goal or (goal_doc or {}).get("target_role")

        resume_fields = await self._get_resume_fields(user_id)
        current_skills = await self._current_skill_names(user_id, resume_fields)
        skill_docs = await database.employee_skills.find({"user_id": user_id}).to_list(length=300)

        proficiency_targets: list[dict] = []
        level_up_skills: list[str] = []
        for doc in skill_docs:
            name = (doc.get("skill_name") or "").strip()
            if not name:
                continue
            current = self._normalize_proficiency(doc.get("proficiency") or "Beginner")
            if self._proficiency_rank(current) >= self._proficiency_rank("Expert"):
                continue
            target = self._NEXT_PROFICIENCY.get(current, "Advanced")
            proficiency_targets.append({"skill": name, "current": current, "target": target})
            level_up_skills.append(name)

        skill_gaps: list[dict] = []
        try:
            gap = await self.get_skill_gap(current_user, career_goal or employee.get("job_title"))
            skill_gaps = gap.get("skill_gaps") or []
        except HTTPException:
            skill_gaps = []

        # Skip anything already in My Learning (assigned or enrolled — any status).
        already_have: set[str] = set()
        enrollments = await database.learning_enrollments.find(
            {"user_id": user_id}, {"course_uid": 1, "course_title": 1}
        ).to_list(length=1000)
        for e in enrollments:
            if e.get("course_uid"):
                already_have.add(e["course_uid"])
            title = (e.get("course_title") or "").strip().lower()
            if title:
                already_have.add(f"title:{title}")
        assigned_docs = await database.learning_assignments.find(
            {"user_id": user_id}, {"course_uid": 1, "course_title": 1}
        ).to_list(length=1000)
        for a in assigned_docs:
            if a.get("course_uid"):
                already_have.add(a["course_uid"])
            title = (a.get("course_title") or "").strip().lower()
            if title:
                already_have.add(f"title:{title}")
        # Career roadmap courses already live under checklist / My Learning — don't re-recommend.
        for course in (assignment or {}).get("assigned_learning_path") or []:
            uid = course.get("course_uid")
            if uid:
                already_have.add(uid)
            title = (course.get("course_title") or "").strip().lower()
            if title:
                already_have.add(f"title:{title}")
        verified = await database.learning_certificates.find(
            {"user_id": user_id},
            {"course_uid": 1, "course_title": 1},
        ).to_list(length=500)
        for c in verified:
            if c.get("course_uid"):
                already_have.add(c["course_uid"])
            title = (c.get("course_title") or "").strip().lower()
            if title:
                already_have.add(f"title:{title}")

        recommendations: list[dict] = []
        seen: set[str] = set()

        def _already(uid: str | None, title: str | None = None) -> bool:
            if uid and uid in already_have:
                return True
            if uid and uid in seen:
                return True
            t = (title or "").strip().lower()
            if t and f"title:{t}" in already_have:
                return True
            return False

        def _add(entry: dict, *, priority: str = "medium") -> None:
            uid = entry.get("uid")
            if not uid or _already(uid, entry.get("title")):
                return
            if not entry.get("provider"):
                entry["provider"] = self._display_provider_name(entry)
            seen.add(uid)
            already_have.add(uid)
            entry.setdefault("priority", priority)
            recommendations.append(entry)

        # Catalog courses that raise proficiency on profile skills (not already enrolled).
        priority_order = {"critical": 0, "immediate": 1, "medium": 2, "low": 3}
        gap_skills = sorted(skill_gaps, key=lambda g: priority_order.get(g.get("priority"), 2))
        search_keywords: list[str] = []
        # Prefer technical profile skills so soft-skill LinkedIn rows don't flood every slot.
        soft_skill_hints = {
            "communication", "active listening", "self-motivation", "time management",
            "prioritization", "goal setting", "feedback", "decision making", "presentation",
            "listening", "motivation", "leadership", "mentoring",
        }

        def _is_soft(name: str) -> bool:
            n = (name or "").strip().lower()
            return any(h in n for h in soft_skill_hints)

        tech_level_up = [s for s in level_up_skills if not _is_soft(s)]
        soft_level_up = [s for s in level_up_skills if _is_soft(s)]
        tech_gaps = [g["skill"] for g in gap_skills if g.get("skill") and not _is_soft(g["skill"])]
        soft_gaps = [g["skill"] for g in gap_skills if g.get("skill") and _is_soft(g["skill"])]

        search_keywords: list[str] = []
        search_keywords.extend(tech_level_up[:10])
        search_keywords.extend(tech_gaps[:4])
        if employee.get("job_title"):
            search_keywords.append(employee["job_title"])
        if career_goal:
            search_keywords.append(career_goal)
        if employee.get("department"):
            search_keywords.append(str(employee["department"]))
        # Keep a couple soft-skill keywords only (roadmap), not the whole list.
        search_keywords.extend(soft_gaps[:2])
        search_keywords.extend(soft_level_up[:2])
        for hint in current_skills:
            if hint and not _is_soft(hint) and hint not in search_keywords:
                search_keywords.append(hint)
            if len(search_keywords) >= 20:
                break
        if not search_keywords:
            search_keywords = [employee.get("job_title") or "fundamentals"]

        keywords = list(dict.fromkeys(search_keywords))[:20]
        # LinkedIn / managed catalogs are often soft-skill heavy — give that bucket extra soft keywords.
        managed_keywords = list(
            dict.fromkeys(
                keywords
                + soft_gaps[:4]
                + soft_level_up[:4]
                + ([employee.get("job_title")] if employee.get("job_title") else [])
            )
        )[:20]
        target_count = 10

        # Fetch separately per provider so LinkedIn cannot crowd out MS Learn / Coursera.
        provider_sources: list[tuple[str, tuple[str, ...], list[str]]] = [
            ("Microsoft Learn", ("microsoft_learn",), keywords),
            ("Coursera", ("coursera",), keywords),
            ("LinkedIn Learning", (MANAGED_SOURCE,), managed_keywords),
        ]
        buckets: dict[str, list[dict]] = {}
        for label, sources, kw in provider_sources:
            try:
                found = await catalog_service.find_courses_for_keywords(
                    kw,
                    per_keyword=4,
                    limit=30,
                    sources=sources,
                )
            except Exception:
                found = []
            cleaned = [
                c for c in found
                if c.get("uid") and not _already(c.get("uid"), c.get("title"))
            ]
            # Rank within this provider by skill/role fit.
            cleaned = self._rank_candidates_for_skills(
                cleaned, proficiency_targets, skill_gaps, employee, career_goal
            )
            if cleaned:
                buckets[label] = cleaned

        # Quotas: e.g. 3 providers → 4, 3, 3 (user request).
        quotas = self._provider_slot_quotas(target_count, len(buckets) or 1)
        labels = list(buckets.keys())
        # Prefer giving the larger quota to tech providers when present.
        preferred = ["Microsoft Learn", "Coursera", "LinkedIn Learning"]
        labels.sort(key=lambda L: preferred.index(L) if L in preferred else 99)

        # Optional AI ranking inside each provider bucket (keeps provider mix).
        # Only call the LLM on explicit Refresh — tab-open / cold miss stays deterministic
        # so the section never hangs on OpenRouter/Gemini.
        for label, quota in zip(labels, quotas):
            pool = buckets.get(label) or []
            if not pool or quota <= 0:
                continue
            shortlist = pool[: min(16, len(pool))]
            picks: list[dict] = []
            if refresh:
                try:
                    picks = await learning_ai_service.rank_recommended_courses(
                        job_title=employee.get("job_title"),
                        department=employee.get("department"),
                        current_skills=current_skills,
                        career_goal=career_goal,
                        skill_gaps=skill_gaps,
                        candidates=shortlist,
                        top_n=quota,
                        proficiency_targets=proficiency_targets[:15],
                    )
                except Exception:
                    picks = []
            by_uid = {c["uid"]: c for c in shortlist}
            taken = 0
            for pick in picks:
                if taken >= quota:
                    break
                course = by_uid.get(pick["uid"])
                if not course:
                    continue
                entry = self._public_course(course)
                if not entry.get("provider"):
                    entry["provider"] = label
                else:
                    # Normalize managed → LinkedIn Learning when that is the org provider name.
                    if label == "LinkedIn Learning" and (
                        not entry.get("provider")
                        or str(entry.get("provider")).lower() in {"managed learning", "managed_learning"}
                    ):
                        entry["provider"] = "LinkedIn Learning"
                entry["reason"] = pick.get("reason") or self._default_recommendation_reason(
                    course, proficiency_targets, skill_gaps, employee, career_goal
                )
                entry["priority"] = pick.get("priority") or "medium"
                entry["recommendation_kind"] = "skill_level_up"
                before = len(recommendations)
                _add(entry, priority=entry["priority"])
                if len(recommendations) > before:
                    taken += 1
            # Deterministic fill for this provider if AI returned fewer than quota
            # (or when refresh=False and we skipped the LLM entirely).
            if taken < quota:
                for course in pool:
                    if taken >= quota:
                        break
                    if _already(course.get("uid"), course.get("title")):
                        continue
                    entry = self._public_course(course)
                    entry["provider"] = entry.get("provider") or label
                    if label == "LinkedIn Learning" and str(entry.get("provider") or "").lower() in {
                        "managed learning",
                        "managed_learning",
                    }:
                        entry["provider"] = "LinkedIn Learning"
                    entry["reason"] = self._default_recommendation_reason(
                        course, proficiency_targets, skill_gaps, employee, career_goal
                    )
                    entry["priority"] = "medium"
                    entry["recommendation_kind"] = "skill_level_up"
                    before = len(recommendations)
                    _add(entry)
                    if len(recommendations) > before:
                        taken += 1

        # If a provider had no matches, redistribute leftover slots from others.
        if len(recommendations) < target_count:
            leftovers: list[dict] = []
            for label in labels:
                for course in buckets.get(label) or []:
                    if _already(course.get("uid"), course.get("title")):
                        continue
                    entry = self._public_course(course)
                    entry["provider"] = entry.get("provider") or label
                    entry["reason"] = self._default_recommendation_reason(
                        course, proficiency_targets, skill_gaps, employee, career_goal
                    )
                    entry["priority"] = "medium"
                    entry["recommendation_kind"] = "skill_level_up"
                    leftovers.append(entry)
            for entry in self._mix_courses_by_provider(leftovers, limit=target_count):
                if len(recommendations) >= target_count:
                    break
                _add(entry)

        recommendations = recommendations[:target_count]
        # Interleave so the UI doesn't show 4 LinkedIn cards in a row first.
        recommendations = self._mix_courses_by_provider(recommendations, limit=target_count)

        now = _now()
        providers_shown = sorted(
            {
                (r.get("provider") or r.get("source") or "catalog")
                for r in recommendations
                if r.get("uid")
            }
        )
        provider_note = f" ({', '.join(providers_shown)})" if providers_shown else ""
        quota_note = ""
        if labels and quotas:
            parts = [f"{q} {lab}" for lab, q in zip(labels, quotas) if q]
            if parts:
                quota_note = f" Target mix: {', '.join(parts)}."
        rank_note = " AI-ranked." if refresh else " Cached for this employee until you refresh."
        basis = (
            f"{len(recommendations)} courses across providers{provider_note}.{quota_note}"
            f"{rank_note} "
            f"Matched to your skills and role ({employee.get('job_title') or 'current'}"
            f"{f' → {career_goal}' if career_goal else ''}) to raise proficiency."
        )
        await database.learning_ai_recommendations.update_one(
            {"user_id": user_id},
            {
                "$set": {
                    "user_id": user_id,
                    "recommendations": recommendations,
                    "generated_at": now,
                    "source": "skill_role_aligned",
                    "basis": basis,
                    "ai_ranked": bool(refresh),
                }
            },
            upsert=True,
        )
        return {
            "recommendations": recommendations,
            "generated_at": now.isoformat(),
            "stale": False,
            "cached": False,
            "source": "skill_role_aligned",
            "basis": basis,
        }

    @staticmethod
    def _provider_slot_quotas(total: int, provider_count: int) -> list[int]:
        """Split slots across providers — e.g. 10 across 3 → [4, 3, 3]."""
        if provider_count <= 0:
            return []
        if provider_count == 1:
            return [total]
        base = total // provider_count
        rem = total % provider_count
        # First provider(s) get the remainder so 10/3 → 4,3,3
        return [base + (1 if i < rem else 0) for i in range(provider_count)]

    def _provider_key(self, course: dict) -> str:
        return (
            (course.get("provider") or "").strip()
            or (course.get("source") or "").strip()
            or "catalog"
        ).lower()

    def _display_provider_name(self, course: dict) -> str:
        provider = (course.get("provider") or "").strip()
        if provider:
            return provider
        source = (course.get("source") or "").strip().lower()
        mapping = {
            "microsoft_learn": "Microsoft Learn",
            "coursera": "Coursera",
            "managed_learning": "LinkedIn Learning",
            "org_framework": "Career Roadmap",
            "linkedin": "LinkedIn Learning",
            "linkedin_learning": "LinkedIn Learning",
        }
        if source in mapping:
            return mapping[source]
        if source.startswith("provider:"):
            return source.split(":", 1)[1].replace("_", " ").title()
        return source.replace("_", " ").title() if source else "Catalog"

    def _mix_courses_by_provider(self, courses: list[dict], *, limit: int) -> list[dict]:
        """Round-robin across providers so the list is a mix, not one source only."""
        if not courses:
            return []
        buckets: dict[str, list[dict]] = {}
        for course in courses:
            key = self._provider_key(course)
            buckets.setdefault(key, []).append(course)
        # Shuffle within each provider for variety on refresh.
        seed = sum(ord(c) for c in (courses[0].get("uid") or "x")[:12])
        rng = random.Random(seed ^ limit ^ len(courses))
        for key in buckets:
            rng.shuffle(buckets[key])

        mixed: list[dict] = []
        seen: set[str] = set()
        keys = list(buckets.keys())
        rng.shuffle(keys)
        while len(mixed) < limit and any(buckets.values()):
            progress = False
            for key in keys:
                if len(mixed) >= limit:
                    break
                bucket = buckets.get(key) or []
                while bucket:
                    course = bucket.pop(0)
                    uid = course.get("uid")
                    if not uid or uid in seen:
                        continue
                    seen.add(uid)
                    mixed.append(course)
                    progress = True
                    break
            if not progress:
                break
        return mixed

    def _shuffle_preserving_provider_spread(self, courses: list[dict]) -> list[dict]:
        """Keep provider mix but vary order slightly between refreshes."""
        if len(courses) <= 2:
            return courses
        return self._mix_courses_by_provider(courses, limit=len(courses))

    def _default_recommendation_reason(
        self,
        course: dict,
        proficiency_targets: list[dict],
        skill_gaps: list[dict],
        employee: dict,
        career_goal: str | None,
    ) -> str:
        title = (course.get("title") or "").lower()
        products = " ".join(course.get("products") or []).lower()
        hay = f"{title} {products}"
        for item in proficiency_targets:
            skill = (item.get("skill") or "").strip()
            if skill and skill.lower() in hay:
                return (
                    f"Builds on your {skill} ({item.get('current')}) — "
                    f"completing it can raise you toward {item.get('target')}."
                )
        for gap in skill_gaps:
            skill = (gap.get("skill") or "").strip()
            if skill and skill.lower() in hay:
                return f"Helps close roadmap skill gap: {skill}."
        role = career_goal or employee.get("job_title") or "your role"
        return f"Aligned with your work as {employee.get('job_title') or 'your designation'} toward {role}."

    def _rank_candidates_for_skills(
        self,
        candidates: list[dict],
        proficiency_targets: list[dict],
        skill_gaps: list[dict],
        employee: dict,
        career_goal: str | None,
    ) -> list[dict]:
        skill_weights = {
            (item.get("skill") or "").lower(): 3
            for item in proficiency_targets
            if item.get("skill")
        }
        for gap in skill_gaps:
            name = (gap.get("skill") or "").lower()
            if name:
                skill_weights[name] = max(skill_weights.get(name, 0), 4)
        role_tokens = [
            t.lower()
            for t in " ".join(
                filter(None, [employee.get("job_title"), career_goal, employee.get("department")])
            ).split()
            if len(t) > 3
        ]

        def score(course: dict) -> int:
            title = (course.get("title") or "").lower()
            products = " ".join(course.get("products") or []).lower()
            subjects = " ".join(course.get("subjects") or []).lower()
            hay = f"{title} {products} {subjects}"
            total = 0
            for skill, weight in skill_weights.items():
                if skill and skill in hay:
                    total += weight
            for token in role_tokens:
                if token in hay:
                    total += 1
            return total

        return sorted(candidates, key=score, reverse=True)

    # ------------------------------------------------------------------ #
    # Recruiter: assign courses (US-068), analytics (US-076), oversight
    # ------------------------------------------------------------------ #
    @staticmethod
    def _auto_due_date(*, duration_minutes: int | None) -> date:
        """Generate a due date when the recruiter does not supply one.

        Uses course duration when available (roughly 2 calendar days per learning
        hour, floored at 14 days), otherwise a 30-day default.
        """
        if duration_minutes and duration_minutes > 0:
            hours = max(1, duration_minutes / 60)
            days = max(14, min(90, int(round(hours * 2))))
        else:
            days = 30
        return (datetime.now(UTC) + timedelta(days=days)).date()

    async def assign_courses(self, current_user: CurrentUser, request: CourseAssignRequest) -> dict:
        assigned = []
        skipped = []
        errors = []
        now = _now()
        due_date = request.due_date or self._auto_due_date(duration_minutes=request.duration_minutes)

        target_ids = list(request.employee_ids)
        needs_filter = bool(request.department or request.job_title or request.required_skills or not target_ids)
        if needs_filter:
            query: dict[str, Any] = {"status": "active"}
            if current_user.role != "super_admin":
                scope = recruiter_scope(current_user)
                if scope:
                    query.update(scope)
            if request.department:
                query["department"] = {"$regex": f"^{_escape_regex(request.department)}$", "$options": "i"}
            if request.job_title:
                query["job_title"] = {"$regex": f"^{_escape_regex(request.job_title)}$", "$options": "i"}
            matches = await database.employees.find(
                query, {"employee_id": 1, "user_id": 1}
            ).to_list(length=2000)

            if request.required_skills:
                wanted = {s.lower() for s in request.required_skills}
                user_ids = [m.get("user_id") for m in matches if m.get("user_id")]
                skilled_users: set[str] = set()
                if user_ids:
                    skill_docs = await database.employee_skills.find(
                        {"user_id": {"$in": user_ids}},
                        {"user_id": 1, "skill_name": 1},
                    ).to_list(length=20000)
                    by_user: dict[str, set[str]] = {}
                    for s in skill_docs:
                        name = (s.get("skill_name") or "").lower()
                        if name:
                            by_user.setdefault(s["user_id"], set()).add(name)
                    for uid, names in by_user.items():
                        if wanted & names:
                            skilled_users.add(uid)
                matches = [m for m in matches if m.get("user_id") in skilled_users]

            matched_ids = [m["employee_id"] for m in matches if m.get("employee_id")]
            if target_ids and (request.department or request.job_title or request.required_skills):
                target_ids = [eid for eid in target_ids if eid in set(matched_ids)]
            elif not target_ids:
                target_ids = matched_ids

        if not target_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No matching employees found for the selected filters.",
            )

        for employee_id in target_ids:
            employee = await database.employees.find_one({"employee_id": employee_id, "status": "active"})
            if not employee:
                errors.append({"employee_id": employee_id, "error": "Employee not found."})
                continue
            await self._assert_recruiter_owns(current_user, employee)

            existing = await database.learning_assignments.find_one(
                {
                    "employee_id": employee_id,
                    "$or": [
                        {"course_uid": request.course_uid},
                        {
                            "course_title": {
                                "$regex": f"^{_escape_regex(request.course_title.strip())}$",
                                "$options": "i",
                            }
                        },
                    ],
                }
            )
            if existing:
                skipped.append(
                    {
                        "employee_id": employee_id,
                        "employee_name": employee.get("full_name"),
                        "reason": "Course already assigned to this employee.",
                    }
                )
                continue

            doc = {
                "employee_id": employee_id,
                "user_id": employee.get("user_id"),
                "employee_name": employee.get("full_name"),
                "department": employee.get("department"),
                "job_title": employee.get("job_title"),
                "course_uid": request.course_uid,
                "course_title": request.course_title,
                "course_url": request.course_url,
                "course_type": request.course_type,
                "duration_minutes": request.duration_minutes,
                "assigned_by": current_user.full_name,
                "assigned_by_id": current_user.id,
                "due_date": due_date.isoformat(),
                "mandatory": bool(request.mandatory),
                "note": request.note,
                "status": "assigned",
                "target_designation": request.target_designation or None,
                "is_designation_requirement": bool(request.is_designation_requirement),
                "created_at": now,
                "updated_at": now,
            }
            try:
                result = await database.learning_assignments.insert_one(doc)
            except Exception as exc:
                # Race / unique index: treat as already assigned.
                if "duplicate" in str(exc).lower() or getattr(exc, "code", None) == 11000:
                    skipped.append(
                        {
                            "employee_id": employee_id,
                            "employee_name": employee.get("full_name"),
                            "reason": "Course already assigned to this employee.",
                        }
                    )
                    continue
                raise
            doc["_id"] = result.inserted_id
            assigned.append(self._public_assignment(doc))

            if employee.get("user_id"):
                kind = "mandatory course" if request.mandatory else "course"
                note_suffix = f" Note: {request.note}" if request.note else ""
                await create_notification(
                    recipient_id=employee["user_id"],
                    recipient_role="employee",
                    notif_type="course_assigned",
                    title="New course assigned",
                    message=(
                        f"\"{request.course_title}\" ({kind}) was assigned to you, due {due_date}."
                        f"{note_suffix}"
                    ),
                    link="/dashboard/employee/learning",
                    related_id=str(doc["_id"]),
                )
                try:
                    from app.core.config import settings
                    from app.services.email_service import email_service

                    to_email = employee.get("email")
                    if to_email:
                        email_service.send_custom_reminder(
                            to_email,
                            employee.get("full_name") or "there",
                            title="New course assigned",
                            body_text=(
                                f'"{request.course_title}" ({kind}) was assigned to you.\n'
                                f"Due date: {due_date}."
                            ),
                            cta_link=f"{settings.frontend_base_url}/dashboard/employee/learning",
                            cta_label="Open Learning",
                            recruiter_note=request.note,
                            eyebrow="Learning",
                            organization_id=employee.get("organization_id"),
                        )
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Course assignment email failed: %s", exc, exc_info=True)
        return {"assigned": assigned, "skipped": skipped, "errors": errors, "due_date": due_date.isoformat()}

    def _public_assignment(self, doc: dict, provider: str | None = None) -> dict:
        return {
            "id": str(doc["_id"]),
            "employee_id": doc.get("employee_id"),
            "employee_name": doc.get("employee_name"),
            "department": doc.get("department"),
            "job_title": doc.get("job_title"),
            "course_uid": doc.get("course_uid"),
            "course_title": doc.get("course_title"),
            "course_url": doc.get("course_url"),
            "course_type": doc.get("course_type"),
            "provider": provider,
            "due_date": _iso(doc.get("due_date")),
            "mandatory": bool(doc.get("mandatory")),
            "note": doc.get("note"),
            "status": doc.get("status"),
            "assigned_by": doc.get("assigned_by"),
            "created_at": _iso(doc.get("created_at")),
            "target_designation": doc.get("target_designation"),
            "is_designation_requirement": bool(doc.get("is_designation_requirement")),
        }

    @staticmethod
    def _assignment_keep_score(doc: dict) -> tuple:
        """Prefer progressed assignments, then newer ones, when collapsing duplicates."""
        status_rank = {"completed": 3, "in_progress": 2, "assigned": 1}.get(doc.get("status") or "", 0)
        created = doc.get("created_at") or datetime.min.replace(tzinfo=UTC)
        return (status_rank, created)

    @staticmethod
    def _normalize_course_title(title: str | None) -> str:
        return " ".join(str(title or "").lower().split())

    def _dedupe_assignment_docs(self, docs: list[dict]) -> list[dict]:
        """One assignment per employee+course_uid (and per normalized title).

        Older data may contain duplicates from before the unique index existed,
        or two near-identical Generative AI catalog rows assigned separately.
        """
        by_uid: dict[tuple[str, str], dict] = {}
        for doc in docs:
            eid = str(doc.get("employee_id") or "")
            uid = str(doc.get("course_uid") or "")
            if not eid or not uid:
                continue
            key = (eid, uid)
            prev = by_uid.get(key)
            if prev is None or self._assignment_keep_score(doc) > self._assignment_keep_score(prev):
                by_uid[key] = doc

        by_title: dict[tuple[str, str], dict] = {}
        for doc in by_uid.values():
            eid = str(doc.get("employee_id") or "")
            title_key = self._normalize_course_title(doc.get("course_title"))
            key = (eid, title_key or str(doc.get("course_uid") or ""))
            prev = by_title.get(key)
            if prev is None or self._assignment_keep_score(doc) > self._assignment_keep_score(prev):
                by_title[key] = doc

        deduped = list(by_title.values())
        deduped.sort(key=lambda d: d.get("created_at") or datetime.min.replace(tzinfo=UTC), reverse=True)
        return deduped

    async def _purge_duplicate_assignments(self, docs: list[dict]) -> None:
        """Delete older duplicate rows for the same employee + course_uid."""
        winners: dict[tuple[str, str], dict] = {}
        losers: list[Any] = []
        for doc in docs:
            eid = str(doc.get("employee_id") or "")
            uid = str(doc.get("course_uid") or "")
            if not eid or not uid or not doc.get("_id"):
                continue
            key = (eid, uid)
            prev = winners.get(key)
            if prev is None:
                winners[key] = doc
                continue
            if self._assignment_keep_score(doc) > self._assignment_keep_score(prev):
                losers.append(prev["_id"])
                winners[key] = doc
            else:
                losers.append(doc["_id"])
        if losers:
            await database.learning_assignments.delete_many({"_id": {"$in": losers}})

    async def list_assignments(
        self,
        current_user: CurrentUser,
        *,
        employee_id: str | None,
        status_filter: str | None,
        mandatory_only: bool | None = None,
    ) -> dict:
        query: dict[str, Any] = {}
        if current_user.role != "super_admin":
            query["assigned_by_id"] = current_user.id
        if employee_id:
            query["employee_id"] = employee_id
        if status_filter:
            query["status"] = status_filter
        if mandatory_only is True:
            query["mandatory"] = True
        docs = await database.learning_assignments.find(query).sort("created_at", -1).to_list(length=500)
        deduped = self._dedupe_assignment_docs(docs)

        provider_map: dict[str, str] = {}
        unique_uids = list({d.get("course_uid") for d in deduped if d.get("course_uid")})
        if unique_uids:
            async def _resolve(uid: str) -> tuple[str, str | None]:
                try:
                    item = await catalog_service.get_course_by_uid(uid)
                    if item:
                        provider = item.get("provider")
                        if provider:
                            return uid, provider
                        source = item.get("source") or catalog_service.source_of(uid)
                        if source == "coursera":
                            return uid, "Coursera"
                        if source == "microsoft_learn":
                            return uid, "Microsoft Learn"
                        if source == MANAGED_SOURCE:
                            return uid, item.get("provider") or "Managed Learning"
                        if source.startswith("provider:"):
                            return uid, source.split(":", 1)[1]
                except Exception:
                    pass
                return uid, None

            resolved = await asyncio.gather(*[_resolve(uid) for uid in unique_uids])
            for uid, provider in resolved:
                if provider:
                    provider_map[uid] = provider

        return {"assignments": [self._public_assignment(d, provider_map.get(d.get("course_uid"))) for d in deduped]}

    async def get_employee_learning_profile(
        self, current_user: CurrentUser, employee_id: str, *, refresh_ai: bool = False
    ) -> dict:
        employee = await self._get_employee_by_id(employee_id)
        await self._assert_recruiter_owns(current_user, employee)
        user_id = employee.get("user_id")
        enrollments = await database.learning_enrollments.find({"user_id": user_id}).sort("updated_at", -1).to_list(length=300)
        assignment_docs = await database.learning_assignments.find({"employee_id": employee_id}).sort("created_at", -1).to_list(length=300)
        assignments = self._dedupe_assignment_docs(assignment_docs)
        certificates = await database.learning_certificates.find({"user_id": user_id}).sort("created_at", -1).to_list(length=300)
        skills = await database.employee_skills.find({"user_id": user_id}).sort("skill_name", 1).to_list(length=300)

        completed = [e for e in enrollments if e.get("status") == "completed"]
        certs_earned = [c for c in certificates if c.get("verification_status") == "verified"]
        learning_summary = {
            "assigned_count": len(assignments),
            "enrolled_count": len(enrollments),
            "completed_count": len(completed),
            "certificates_earned": len(certs_earned),
            "overall_progress_percent": (
                round(sum(e.get("progress_percent", 0) for e in enrollments) / len(enrollments)) if enrollments else 0
            ),
            "total_learning_hours": round(
                sum((c.get("learning_hours") or 0) for c in certs_earned)
                + sum((e.get("duration_minutes") or 0) for e in completed) / 60,
                1,
            ),
        }

        resume_fields = await self._get_resume_fields(user_id) if user_id else {}
        merged_skills = (
            await self._merged_skills_for_user(user_id, resume_fields) if user_id else []
        )
        current_skills = resume_analysis_service.skill_name_set(merged_skills) if merged_skills else []
        goal = await database.learning_career_goals.find_one({"user_id": user_id}) if user_id else None
        target_role = (goal or {}).get("target_role")

        assessment = None
        recommendations = []
        promotion = None
        skill_gaps: list[dict] = []
        role_matches: list[dict] = []

        if user_id:
            recruiter_id = self._employee_recruiter_id(employee) or current_user.id
            hashes = await learning_cache_service.compute_input_hashes(user_id, recruiter_id)

            # Fast path: never block the Learning tab on OpenRouter/Gemini unless
            # the recruiter explicitly clicks Refresh AI.
            if refresh_ai:
                assessment = await self._get_or_build_skill_assessment(
                    employee=employee,
                    user_id=user_id,
                    resume_fields=resume_fields,
                    existing_skills=skills,
                    refresh=True,
                )
            else:
                cached_assessment = await learning_cache_service.get_cached_assessment(user_id, hashes)
                if cached_assessment:
                    assessment = cached_assessment.get("assessment")
                else:
                    legacy = await database.learning_skill_assessments.find_one({"user_id": user_id})
                    assessment = (legacy or {}).get("assessment")
                    if not assessment:
                        assessment = self._deterministic_assessment_from_skills(
                            employee=employee,
                            merged_skills=merged_skills,
                        )

            skill_gaps = (assessment or {}).get("gaps") or []

            # Cache recruiter AI extras (recs + promotion) on the assessment doc side-car
            profile_cache = await database.learning_recruiter_profile_cache.find_one({"user_id": user_id})
            cache_ok = (
                profile_cache
                and not refresh_ai
                and learning_cache_service.hashes_match(profile_cache.get("cache_meta") or {}, hashes)
            )
            if cache_ok:
                recommendations = profile_cache.get("recommendations") or []
                promotion = profile_cache.get("promotion")
            else:
                # Cap keywords — each one previously could trigger an LLM expand.
                keywords = list(current_skills)[:8] + [g.get("skill") for g in skill_gaps if g.get("skill")][:4]
                if employee.get("job_title"):
                    keywords.append(employee["job_title"])
                if employee.get("department"):
                    keywords.append(employee["department"])
                keywords = [k for k in keywords if k] or ["fundamentals"]
                keywords = list(dict.fromkeys(keywords))[:10]
                candidates = await catalog_service.find_courses_for_keywords(
                    keywords,
                    per_keyword=3,
                    limit=24,
                    use_ai=False,
                    # Skip Coursera on tab open — cold fetch of ~20k courses blocks the UI.
                    # Refresh AI includes Coursera again.
                    sources=("microsoft_learn",)
                    if not refresh_ai
                    else catalog_service.SOURCES,
                )
                existing_uids = {
                    a["course_uid"] for a in assignments if a.get("course_uid")
                } | {e["course_uid"] for e in enrollments if e.get("course_uid")}
                candidates = [c for c in candidates if c.get("uid") not in existing_uids]

                if refresh_ai:
                    picks = await learning_ai_service.rank_recommended_courses(
                        job_title=employee.get("job_title"),
                        department=employee.get("department"),
                        current_skills=current_skills,
                        career_goal=target_role,
                        skill_gaps=skill_gaps,
                        candidates=candidates,
                        top_n=6,
                    )
                    by_uid = {c["uid"]: c for c in candidates}
                    for pick in picks:
                        course = by_uid.get(pick["uid"])
                        if course:
                            entry = self._public_course(course)
                            entry["reason"] = pick["reason"]
                            entry["priority"] = pick.get("priority") or "medium"
                            recommendations.append(entry)
                else:
                    # Fast deterministic recommendations — no LLM ranking on tab open.
                    for course in candidates[:6]:
                        entry = self._public_course(course)
                        entry["reason"] = "Matched to current skills / role"
                        entry["priority"] = "medium"
                        recommendations.append(entry)

                # Prefer deterministic readiness from top role match; AI only on Refresh.
                top = role_matches[0] if role_matches else None
                if top:
                    promotion = {
                        "promotion_ready": top["readiness_score"] >= 80,
                        "readiness_score": int(round(top["readiness_score"])),
                        "recommended_next_title": top.get("role") or target_role,
                        "reasons": [
                            f"Skill match {top['skill_match_percent']}%",
                            f"Certification match {top['certification_match_percent']}%",
                        ],
                        "recommended_actions": [
                            f"Close gap: {s}" for s in (top.get("missing_skills") or [])[:3]
                        ],
                        "timeline": "Ready now" if top["readiness_score"] >= 80 else "3-6 months",
                        "summary": (
                            f"Deterministic readiness for {top.get('role')}: "
                            f"{top['readiness_score']}% (priority: {top.get('learning_priority')})."
                        ),
                        "deterministic": True,
                    }
                elif refresh_ai:
                    promotion = await learning_ai_service.predict_promotion_readiness(
                        job_title=employee.get("job_title"),
                        department=employee.get("department"),
                        target_role=target_role,
                        current_skills=current_skills,
                        skill_gaps=skill_gaps,
                        learning_summary=learning_summary,
                        professional_summary=resume_fields.get("professional_summary"),
                    )
                else:
                    promotion = {
                        "promotion_ready": False,
                        "readiness_score": 0,
                        "recommended_next_title": target_role,
                        "reasons": ["No matching org role yet — configure roles in Organization Setup → Role ladders."],
                        "recommended_actions": [],
                        "timeline": None,
                        "summary": "Open Refresh AI after org roles are configured for a fuller readiness score.",
                        "deterministic": True,
                    }

                await database.learning_recruiter_profile_cache.update_one(
                    {"user_id": user_id},
                    {
                        "$set": {
                            "user_id": user_id,
                            "recommendations": recommendations,
                            "promotion": promotion,
                            "generated_at": _now(),
                            "cache_meta": hashes,
                        }
                    },
                    upsert=True,
                )

        return {
            "employee": {
                "employee_id": employee.get("employee_id"),
                "full_name": employee.get("full_name"),
                "job_title": employee.get("job_title"),
                "department": employee.get("department"),
            },
            "summary": learning_summary,
            "enrollments": [self._public_enrollment(e) for e in enrollments],
            "assignments": [self._public_assignment(a) for a in assignments],
            "certificates": [self._public_certificate(c) for c in certificates],
            "skills": [
                {
                    "id": s.get("id"),
                    "skill_name": s.get("skill_name"),
                    "category": s.get("category"),
                    "proficiency": s.get("proficiency"),
                    "years_experience": s.get("years_experience"),
                    "source": s.get("source", "manual"),
                    "verification_status": s.get("verification_status", "unverified"),
                    "confidence": s.get("confidence"),
                }
                for s in merged_skills
            ]
            or [self._public_skill(s) for s in skills],
            "skill_assessment": assessment,
            "skill_gaps": skill_gaps,
            "recommendations": recommendations,
            "promotion": promotion,
            "career_goal": target_role,
            "role_matches": role_matches,
        }

    def _deterministic_assessment_from_skills(
        self, *, employee: dict, merged_skills: list[dict]
    ) -> dict:
        """Build a lightweight skill matrix without calling an LLM (fast tab open)."""
        skills_out = []
        for s in merged_skills[:24]:
            name = (s.get("skill_name") or "").strip()
            if not name:
                continue
            skills_out.append(
                {
                    "skill_name": name,
                    "category": s.get("category") or "Other",
                    "proficiency": s.get("proficiency") or "Intermediate",
                    "confidence": s.get("confidence") or 70,
                    "years_experience": s.get("years_experience"),
                    "source": s.get("source") or "resume",
                }
            )
        return {
            "skills": skills_out,
            "gaps": [],
            "role_fit_percentage": None,
            "summary": (
                f"Showing {len(skills_out)} skills from resume/profile for "
                f"{employee.get('job_title') or 'this role'}. "
                "Click Refresh AI for a full Gemini assessment and gap analysis."
            ),
            "deterministic": True,
        }

    async def _get_or_build_skill_assessment(
        self,
        *,
        employee: dict,
        user_id: str,
        resume_fields: dict,
        existing_skills: list[dict],
        refresh: bool = False,
    ) -> dict | None:
        recruiter_id = self._employee_recruiter_id(employee)
        hashes = await learning_cache_service.compute_input_hashes(user_id, recruiter_id)

        if not refresh:
            cached = await learning_cache_service.get_cached_assessment(user_id, hashes)
            if cached:
                return cached.get("assessment")

        # Also try legacy TTL cache document if hashes missing (migration)
        legacy = await database.learning_skill_assessments.find_one({"user_id": user_id})
        if legacy and not refresh and legacy.get("cache_meta") and learning_cache_service.hashes_match(
            legacy.get("cache_meta") or {}, hashes
        ):
            return legacy.get("assessment")

        resume_text = await self._get_resume_text(user_id)
        # Merge resume + cert skills into the assessment input
        merged = resume_analysis_service.merge_skill_sources(
            manual_skills=existing_skills,
            resume_fields=resume_fields,
            certificate_skills=resume_analysis_service.extract_certificate_skill_list(
                await database.learning_certificates.find(
                    {"user_id": user_id, "verification_status": "verified"}
                ).to_list(length=300)
            ),
        )
        existing_public = [
            {
                "skill_name": s.get("skill_name"),
                "category": s.get("category"),
                "proficiency": s.get("proficiency"),
                "confidence": s.get("confidence"),
                "source": s.get("source"),
            }
            for s in merged
        ]

        target_role = None
        promotion_skills: list[str] = []
        promotion_certs: list[str] = []
        eid = employee.get("employee_id")
        if eid:
            career = await database.employee_career_assignments.find_one(
                {"employee_id": eid, "status": "active"}
            )
            if career:
                target_role = (career.get("target_role_title") or "").strip() or None
                for row in career.get("skills_to_acquire") or []:
                    name = (row.get("skill") if isinstance(row, dict) else row) or ""
                    name = str(name).strip()
                    if name:
                        promotion_skills.append(name)
                for row in career.get("certifications_to_earn") or []:
                    name = (row.get("certification") if isinstance(row, dict) else row) or ""
                    name = str(name).strip()
                    if name:
                        promotion_certs.append(name)
                for course in career.get("assigned_learning_path") or []:
                    for name in course.get("skills") or []:
                        if isinstance(name, dict):
                            name = name.get("skill") or name.get("name")
                        name = str(name or "").strip()
                        if name and name not in promotion_skills:
                            promotion_skills.append(name)
                    for name in course.get("certifications") or []:
                        if isinstance(name, dict):
                            name = name.get("certification") or name.get("name")
                        name = str(name or "").strip()
                        if name and name not in promotion_certs:
                            promotion_certs.append(name)

        assessment = await learning_ai_service.build_skill_matrix(
            job_title=employee.get("job_title"),
            department=employee.get("department"),
            resume_fields=resume_fields,
            resume_text=resume_text,
            existing_skills=existing_public,
            target_role=target_role,
            promotion_skills=promotion_skills,
            promotion_certs=promotion_certs,
        )
        if not assessment:
            return legacy.get("assessment") if legacy else None

        # Persist AI skills into the matrix (resume source) without wiping manual entries.
        for skill in assessment.get("skills") or []:
            await self._upsert_ai_skill(
                user_id=user_id,
                employee_id=employee.get("employee_id"),
                skill_name=skill["skill_name"],
                category=skill.get("category") or "Other",
                proficiency=skill.get("proficiency") or "Beginner",
                years_experience=skill.get("years_experience"),
            )

        # Recompute hashes after skill upserts (skillsHash may change)
        hashes = await learning_cache_service.compute_input_hashes(user_id, recruiter_id)
        await learning_cache_service.store_assessment(user_id, assessment, hashes)
        return assessment

    async def _upsert_ai_skill(
        self,
        *,
        user_id: str,
        employee_id: str | None,
        skill_name: str,
        category: str,
        proficiency: str,
        years_experience: float | None,
    ) -> None:
        now = _now()
        existing = await database.employee_skills.find_one(
            {"user_id": user_id, "skill_name": {"$regex": f"^{_escape_regex(skill_name)}$", "$options": "i"}}
        )
        if existing and existing.get("source") in ("manual", "course"):
            return
        if existing:
            await database.employee_skills.update_one(
                {"_id": existing["_id"]},
                {
                    "$set": {
                        "category": category if category in SKILL_CATEGORIES else "Other",
                        "proficiency": proficiency,
                        "years_experience": years_experience,
                        "source": "ai_resume",
                        "updated_at": now,
                    }
                },
            )
            return
        await database.employee_skills.insert_one(
            {
                "user_id": user_id,
                "employee_id": employee_id,
                "skill_name": skill_name,
                "category": category if category in SKILL_CATEGORIES else "Other",
                "proficiency": proficiency,
                "years_experience": years_experience,
                "source": "ai_resume",
                "verification_status": "unverified",
                "created_at": now,
                "updated_at": now,
            }
        )

    async def assess_my_skills(
        self, current_user: CurrentUser, *, refresh: bool = False, lazy: bool = False
    ) -> dict:
        employee = await self._get_employee(current_user)
        resume_fields = await self._get_resume_fields(current_user.id)
        skills = await database.employee_skills.find({"user_id": current_user.id}).to_list(length=300)
        recruiter_id = self._employee_recruiter_id(employee)
        hashes = await learning_cache_service.compute_input_hashes(current_user.id, recruiter_id)

        cached_hit = False
        assessment = None
        if not refresh:
            cached = await learning_cache_service.get_cached_assessment(current_user.id, hashes)
            if cached:
                cached_hit = True
                assessment = cached.get("assessment")
            elif not lazy:
                assessment = await self._get_or_build_skill_assessment(
                    employee=employee,
                    user_id=current_user.id,
                    resume_fields=resume_fields,
                    existing_skills=skills,
                    refresh=False,
                )
        else:
            assessment = await self._get_or_build_skill_assessment(
                employee=employee,
                user_id=current_user.id,
                resume_fields=resume_fields,
                existing_skills=skills,
                refresh=True,
            )

        updated_skills = await self._merged_skills_for_user(current_user.id, resume_fields)
        hashes = await learning_cache_service.compute_input_hashes(current_user.id, recruiter_id)
        meta_doc = await database.learning_skill_assessments.find_one({"user_id": current_user.id})
        return {
            "assessment": assessment,
            "skills": [
                {
                    "id": s.get("id"),
                    "skill_name": s.get("skill_name"),
                    "category": s.get("category"),
                    "proficiency": s.get("proficiency"),
                    "years_experience": s.get("years_experience"),
                    "source": s.get("source", "manual"),
                    "verification_status": s.get("verification_status", "unverified"),
                    "confidence": s.get("confidence"),
                }
                for s in updated_skills
            ],
            "cached": cached_hit,
            "cache_meta": {
                **hashes,
                "lastAnalyzedAt": _iso((meta_doc or {}).get("generated_at")),
            },
        }

    async def get_analytics(self, current_user: CurrentUser, *, department: str | None = None) -> dict:
        """US-073: recruiter learning analytics."""
        employee_query: dict[str, Any] = {}
        if current_user.role != "super_admin":
            scope = recruiter_scope(current_user)
            if scope:
                employee_query.update(scope)
        if department:
            employee_query["department"] = {
                "$regex": f"^{_escape_regex(department)}$",
                "$options": "i",
            }

        employees = await database.employees.find(employee_query).to_list(length=5000)
        employee_ids = [e.get("employee_id") for e in employees if e.get("employee_id")]
        user_ids = [e.get("user_id") for e in employees if e.get("user_id")]

        assignment_docs = (
            await database.learning_assignments.find({"employee_id": {"$in": employee_ids}}).to_list(length=10000)
            if employee_ids
            else []
        )
        assignments = self._dedupe_assignment_docs(assignment_docs)

        certificates = (
            await database.learning_certificates.find({"user_id": {"$in": user_ids}}).to_list(length=10000)
            if user_ids
            else []
        )
        enrollments = (
            await database.learning_enrollments.find({"user_id": {"$in": user_ids}}).to_list(length=10000)
            if user_ids
            else []
        )

        total_assigned = len(assignments)
        completed_assigned = len([a for a in assignments if a.get("status") == "completed"])
        completion_rate = round((completed_assigned / total_assigned) * 100, 1) if total_assigned else 0.0
        mandatory_assigned = len([a for a in assignments if a.get("mandatory")])
        mandatory_completed = len(
            [a for a in assignments if a.get("mandatory") and a.get("status") == "completed"]
        )

        verified_certs = [c for c in certificates if c.get("verification_status") == "verified"]
        pending_certs = [c for c in certificates if c.get("verification_status") == "pending"]
        certification_rate = round((len(verified_certs) / len(certificates)) * 100, 1) if certificates else 0.0
        total_learning_hours = round(
            sum((c.get("learning_hours") or 0) for c in verified_certs)
            + sum((e.get("duration_minutes") or 0) for e in enrollments if e.get("status") == "completed") / 60,
            1,
        )

        popular: dict[str, int] = {}
        popular_basis = "enrollments"
        popular_source = enrollments if enrollments else assignments
        if not enrollments:
            popular_basis = "assignments"
        for row in popular_source:
            title = row.get("course_title") or "Untitled"
            popular[title] = popular.get(title, 0) + 1
        popular_courses = [
            {"title": title, "enrollments": count}
            for title, count in sorted(popular.items(), key=lambda kv: (-kv[1], kv[0].lower()))[:8]
        ]

        dept_stats: dict[str, dict[str, int]] = {}
        for employee in employees:
            dept = employee.get("department") or "Unassigned"
            dept_stats.setdefault(dept, {"employee_count": 0, "assigned": 0, "completed": 0})
            dept_stats[dept]["employee_count"] += 1
        for assignment in assignments:
            dept = assignment.get("department") or "Unassigned"
            bucket = dept_stats.setdefault(dept, {"employee_count": 0, "assigned": 0, "completed": 0})
            bucket["assigned"] += 1
            if assignment.get("status") == "completed":
                bucket["completed"] += 1

        department_comparison = [
            {
                "department": dept,
                "employee_count": stats["employee_count"],
                "assigned": stats["assigned"],
                "completed": stats["completed"],
                "completion_rate": round((stats["completed"] / stats["assigned"]) * 100, 1) if stats["assigned"] else 0.0,
            }
            for dept, stats in sorted(dept_stats.items())
        ]

        unique_courses = {
            str(doc.get("course_uid") or "").strip() or self._normalize_course_title(doc.get("course_title"))
            for doc in assignments
            if doc.get("course_uid") or doc.get("course_title")
        }

        return {
            "department_filter": department,
            "employees_in_scope": len(employees),
            "departments_in_scope": len(department_comparison),
            "total_courses": len(unique_courses),
            "archived_courses": 0,
            "assigned_courses": total_assigned,
            "completed_courses": completed_assigned,
            "pending_certificates": len(pending_certs),
            "learning_hours": total_learning_hours,
            "completion_rate": completion_rate,
            "assignment_completion_rate": completion_rate,
            "certification_rate": certification_rate,
            "total_learning_hours": total_learning_hours,
            "total_assignments": total_assigned,
            "completed_assignments": completed_assigned,
            "mandatory_assignments": mandatory_assigned,
            "mandatory_completed_assignments": mandatory_completed,
            "mandatory_completion_rate": (
                round((mandatory_completed / mandatory_assigned) * 100, 1) if mandatory_assigned else 0.0
            ),
            "total_certificates": len(certificates),
            "verified_certificates": len(verified_certs),
            "popular_courses_basis": popular_basis,
            "popular_courses": popular_courses,
            "department_comparison": department_comparison,
            "most_popular_courses": popular_courses,
            "learning_trend": [],
            "department_progress": department_comparison,
            "designation_progress": [],
            "empty_reason": (
                "No employees in this scope yet."
                if not employees
                else "No learning assignments or enrollments in this scope yet."
                if not assignments and not enrollments
                else None
            ),
        }


def _escape_regex(value: str) -> str:
    import re

    return re.escape(value)


learning_service = LearningService()

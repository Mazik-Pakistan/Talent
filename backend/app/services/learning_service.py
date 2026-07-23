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

from datetime import UTC, date, datetime, timedelta
from typing import Any

from bson import ObjectId
from fastapi import HTTPException, status

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
from app.services.dashboard_service import create_notification
from app.services.recruiter_kb_service import recruiter_kb_service

AI_RECOMMENDATIONS_TTL_HOURS = 24


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
        return {
            "uid": item.get("uid"),
            "type": item.get("type"),
            "source": item.get("source", "microsoft_learn"),
            "category": item.get("category"),
            "title": item.get("title"),
            "summary": item.get("summary"),
            "url": item.get("url"),
            "duration_minutes": item.get("duration_minutes"),
            "levels": item.get("levels"),
            "roles": item.get("roles"),
            "products": item.get("products"),
            "subjects": item.get("subjects"),
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
                if q and q.lower() not in (public.get("title") or "").lower():
                    continue
                if course_type and public.get("type") != course_type:
                    continue
                if level and level.lower() not in [str(x).lower() for x in (public.get("levels") or [])]:
                    continue
                if role and role.lower() not in [str(x).lower() for x in (public.get("roles") or [])]:
                    continue
                if source and public.get("source") != source:
                    continue
                courses.append(public)
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

        if source == "recruiter_kb":
            employee = None
            try:
                employee = await self._get_employee(current_user)
            except HTTPException:
                employee = None
            recruiter_id = None
            if current_user.role in ("recruiter", "super_admin"):
                recruiter_id = current_user.id if current_user.role == "recruiter" else None
            elif employee:
                recruiter_id = self._employee_recruiter_id(employee)
            kb_courses = await recruiter_kb_service.list_as_catalog_courses(recruiter_id)
            if q:
                ql = q.lower()
                kb_courses = [c for c in kb_courses if ql in (c.get("title") or "").lower() or ql in (c.get("summary") or "").lower()]
            if course_type:
                kb_courses = [c for c in kb_courses if c.get("type") == course_type]
            total = len(kb_courses)
            start = (page - 1) * page_size
            page_items = kb_courses[start : start + page_size]
            uids = [c["uid"] for c in page_items]
            status_map = await self._status_map(current_user.id, uids)
            courses = []
            for item in page_items:
                public = self._public_course(item)
                public["provider"] = item.get("provider")
                public["estimated_hours"] = item.get("estimated_hours")
                public.update(status_map.get(item["uid"], {"enrolled": False, "bookmarked": False, "assigned": False}))
                courses.append(public)
            pages = max(1, (total + page_size - 1) // page_size) if total else 1
            return {"courses": courses, "total": total, "page": page, "page_size": page_size, "pages": pages}

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
        if not item and uid.startswith("recruiter_kb:"):
            cert_id = uid.split(":", 1)[1]
            if ObjectId.is_valid(cert_id):
                doc = await database.recruiter_kb_certifications.find_one({"_id": ObjectId(cert_id)})
                if doc:
                    courses = await recruiter_kb_service.list_as_catalog_courses(doc.get("recruiter_id"))
                    item = next((c for c in courses if c["uid"] == uid), None)
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
        if not item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found in the catalog.")
        employee = await self._get_employee(current_user)
        now = _now()
        existing = await database.learning_enrollments.find_one({"user_id": current_user.id, "course_uid": uid})
        if existing:
            return {"enrollment": self._public_enrollment(existing), "redirect_url": item.get("url")}

        assignment = await database.learning_assignments.find_one({"user_id": current_user.id, "course_uid": uid})
        doc = {
            "user_id": current_user.id,
            "employee_id": employee.get("employee_id"),
            "course_uid": uid,
            "course_title": item.get("title"),
            "course_url": item.get("url"),
            "course_type": item.get("type"),
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
        return {"enrollment": self._public_enrollment(doc), "redirect_url": item.get("url")}

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
            # Credit the mapped career-path skill so readiness can improve on re-analyze
            await self._credit_skill_from_completed_course(current_user, uid, enrollment)

        updated = await database.learning_enrollments.find_one({"_id": enrollment["_id"]})
        return {"enrollment": self._public_enrollment(updated)}

    async def _credit_skill_from_completed_course(
        self, current_user: CurrentUser, course_uid: str, enrollment: dict
    ) -> None:
        """When a learning-path course is finished, add/update the gap skill on the profile."""
        goal = await database.learning_career_goals.find_one({"user_id": current_user.id})
        path = (goal or {}).get("ai_path") or {}
        matched_skill = None
        for step in path.get("path") or []:
            step_uid = (step.get("course") or {}).get("uid") or step.get("uid")
            if step_uid == course_uid and step.get("kind") != "certification":
                matched_skill = (step.get("skill") or "").strip()
                break
        if not matched_skill:
            return
        employee = await self._get_employee(current_user)
        await self._upsert_ai_skill(
            user_id=current_user.id,
            employee_id=employee.get("employee_id"),
            skill_name=matched_skill,
            category="Other",
            proficiency="Intermediate",
            years_experience=None,
        )
        await learning_cache_service.invalidate_user_ai_caches(current_user.id)

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

    async def list_my_courses(self, current_user: CurrentUser, status_filter: str | None) -> dict:
        """Return started enrollments plus open recruiter assignments not yet started.

        UI copy promises “started or been assigned”; previously only enrollments
        were returned, so assigned courses were invisible until the employee
        started them from the catalog.
        """
        status_filter = (status_filter or "").strip().lower() or None

        enrollment_query: dict[str, Any] = {"user_id": current_user.id}
        if status_filter in ("in_progress", "completed"):
            enrollment_query["status"] = status_filter
        enroll_docs = await database.learning_enrollments.find(enrollment_query).sort(
            "updated_at", -1
        ).to_list(length=300)
        enrollments = [self._public_enrollment(d) for d in enroll_docs]

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
                pending.append(self._assignment_as_my_course(assignment))

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
        return {
            "id": str(doc["_id"]),
            "employee_id": doc.get("employee_id"),
            "employee_name": doc.get("employee_name"),
            "course_uid": doc.get("course_uid"),
            "course_title": doc.get("course_title"),
            "file_name": doc.get("file_name"),
            "file_url": doc.get("file_url"),
            "learning_hours": doc.get("learning_hours"),
            "completion_date": _iso(doc.get("completion_date")),
            "verification_status": doc.get("verification_status", "pending"),
            "verified_by": doc.get("verified_by"),
            "verified_at": _iso(doc.get("verified_at")),
            "rejection_reason": doc.get("rejection_reason"),
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
        filename: str,
        content: bytes,
    ) -> dict:
        employee = await self._get_employee(current_user)
        upload = await storage_service.save_file(current_user.id, "certificates", filename, content)
        now = _now()
        doc = {
            "user_id": current_user.id,
            "employee_id": employee.get("employee_id"),
            "employee_name": employee.get("full_name"),
            "recruiter_id": employee.get("recruiter_id"),
            "course_uid": course_uid,
            "course_title": course_title,
            "file_name": filename,
            "file_url": upload.get("file_url"),
            "object_path": upload.get("object_path"),
            "learning_hours": learning_hours,
            "completion_date": completion_date.isoformat() if completion_date else None,
            "verification_status": "pending",
            "created_at": now,
            "updated_at": now,
        }
        result = await database.learning_certificates.insert_one(doc)
        doc["_id"] = result.inserted_id

        if course_uid:
            enrollment = await database.learning_enrollments.find_one(
                {"user_id": current_user.id, "course_uid": course_uid}
            )
            if enrollment:
                await database.learning_enrollments.update_one(
                    {"_id": enrollment["_id"]},
                    {"$set": {"status": "completed", "progress_percent": 100, "completed_at": now, "updated_at": now}},
                )

        if employee.get("recruiter_id"):
            await create_notification(
                recipient_id=str(employee["recruiter_id"]),
                recipient_role="recruiter",
                notif_type="certificate_uploaded",
                title="Certificate submitted for review",
                message=f"{employee.get('full_name')} uploaded a certificate for \"{course_title}\".",
                link="/dashboard/recruiter/learning",
                related_id=str(doc["_id"]),
            )
        return {"certificate": self._public_certificate(doc)}

    async def list_my_certificates(self, current_user: CurrentUser) -> dict:
        docs = await database.learning_certificates.find({"user_id": current_user.id}).sort("created_at", -1).to_list(length=200)
        return {"certificates": [self._public_certificate(d) for d in docs]}

    async def list_pending_certificates(self, current_user: CurrentUser) -> dict:
        query: dict[str, Any] = {"verification_status": "pending"}
        if current_user.role != "super_admin":
            query["recruiter_id"] = current_user.id
        docs = await database.learning_certificates.find(query).sort("created_at", 1).to_list(length=300)
        return {"certificates": [self._public_certificate(d) for d in docs]}

    async def verify_certificate(self, current_user: CurrentUser, certificate_id: str, request: CertificateVerifyRequest) -> dict:
        if not ObjectId.is_valid(certificate_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Certificate not found.")
        cert = await database.learning_certificates.find_one({"_id": ObjectId(certificate_id)})
        if not cert:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Certificate not found.")
        if current_user.role != "super_admin" and str(cert.get("recruiter_id") or "") != str(current_user.id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed.")

        now = _now()
        updates = {
            "verification_status": "verified" if request.approve else "rejected",
            "verified_by": current_user.full_name,
            "verified_at": now,
            "rejection_reason": None if request.approve else (request.note or "Certificate rejected."),
            "updated_at": now,
        }
        await database.learning_certificates.update_one({"_id": cert["_id"]}, {"$set": updates})

        if request.approve and cert.get("course_title"):
            course_summary = None
            if cert.get("course_uid"):
                course = await catalog_service.get_course_by_uid(cert["course_uid"])
                course_summary = (course or {}).get("summary")

            cert_text = await self._extract_certificate_text(cert)
            skills = await learning_ai_service.extract_skills_from_certificate(
                course_title=cert["course_title"],
                certificate_text=cert_text,
                course_summary=course_summary,
            )
            for skill in skills:
                await self._upsert_verified_skill(
                    user_id=cert["user_id"],
                    employee_id=cert.get("employee_id"),
                    skill_name=skill["skill_name"],
                    category=skill.get("category") or "Other",
                    proficiency=skill.get("proficiency") or "Intermediate",
                    source="course",
                )
            await self._invalidate_ai_caches(cert["user_id"])
            updates["skills_awarded"] = [s["skill_name"] for s in skills]
            await database.learning_certificates.update_one(
                {"_id": cert["_id"]},
                {"$set": {"skills_awarded": updates["skills_awarded"]}},
            )

        await create_notification(
            recipient_id=cert["user_id"],
            recipient_role="employee",
            notif_type="certificate_verified" if request.approve else "certificate_rejected",
            title="Certificate verified" if request.approve else "Certificate needs attention",
            message=(
                f"Your certificate for \"{cert.get('course_title')}\" was verified."
                if request.approve
                else f"Your certificate for \"{cert.get('course_title')}\" was rejected: {request.note or 'see recruiter notes'}."
            ),
            link="/dashboard/employee/learning",
            related_id=str(cert["_id"]),
        )
        updated = await database.learning_certificates.find_one({"_id": cert["_id"]})
        return {"certificate": self._public_certificate(updated)}

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
    ) -> None:
        now = _now()
        rank = {"Beginner": 1, "Intermediate": 2, "Advanced": 3, "Expert": 4}
        existing = await database.employee_skills.find_one(
            {"user_id": user_id, "skill_name": {"$regex": f"^{_escape_regex(skill_name)}$", "$options": "i"}}
        )
        if existing:
            current = existing.get("proficiency") or "Beginner"
            new_prof = proficiency if rank.get(proficiency, 0) >= rank.get(current, 0) else current
            await database.employee_skills.update_one(
                {"_id": existing["_id"]},
                {
                    "$set": {
                        "proficiency": new_prof,
                        "category": category if category in SKILL_CATEGORIES else existing.get("category") or "Other",
                        "source": source,
                        "verification_status": "verified",
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
                "years_experience": None,
                "source": source,
                "verification_status": "verified",
                "created_at": now,
                "updated_at": now,
            }
        )

    # ------------------------------------------------------------------ #
    # US-092 / US-093 / US-094: Skill matrix
    # ------------------------------------------------------------------ #
    async def get_skill_categories(self) -> dict:
        return {"categories": SKILL_CATEGORIES}

    async def list_skills(self, current_user: CurrentUser) -> dict:
        merged = await self._merged_skills_for_user(current_user.id)
        skills = []
        for s in merged:
            skills.append(
                {
                    "id": s.get("id"),
                    "skill_name": s.get("skill_name"),
                    "category": s.get("category"),
                    "proficiency": s.get("proficiency"),
                    "years_experience": s.get("years_experience"),
                    "source": s.get("source", "manual"),
                    "verification_status": s.get("verification_status", "unverified"),
                    "confidence": s.get("confidence"),
                    "updated_at": s.get("updated_at"),
                }
            )
        return {"skills": skills}

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
        """Skill gap dashboard — deterministic when KB role exists; AI summary only when needed."""
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

        role_def = await recruiter_kb_service.find_role_by_title(resolved_role, recruiter_id)
        analysis: dict | None = None

        if role_def:
            analysis = role_matching_service.deterministic_skill_gap(
                current_skills=current_skills,
                target_role=resolved_role,
                role_def=role_def,
            )
            # Cert matching with employee certs
            cert_match = role_matching_service.match_employee_to_role(
                employee_skills=current_skills,
                employee_certifications=employee_certs,
                role=role_def,
            )
            analysis["missing_certifications"] = cert_match["missing_certifications"]
            analysis["certification_match_percent"] = cert_match["certification_match_percent"]
            analysis["skill_match_percent"] = cert_match["skill_match_percent"]
            analysis["readiness_percentage"] = int(round(cert_match["readiness_score"]))
            analysis["learning_priority"] = cert_match["learning_priority"]
            analysis["summary"] = (
                f"You match {analysis.get('skill_match_percent', 0)}% of required skills "
                f"and {analysis.get('certification_match_percent', 0)}% of certifications "
                f"for {resolved_role}. Priority: {analysis.get('learning_priority')}."
            )
        else:
            # No KB role — fall back to AI gap analysis (cached by hashes)
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
            # Include recruiter KB certs in candidates
            kb_courses = await recruiter_kb_service.list_as_catalog_courses(recruiter_id)
            candidates = candidates + kb_courses
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
            "cached": False,
            "lastAnalyzedAt": _now().isoformat(),
            **{k: hashes[k] for k in hashes},
        }
        await learning_cache_service.store_skill_gap(current_user.id, resolved_role, payload, hashes)
        return payload

    async def get_career_path(self, current_user: CurrentUser, *, refresh: bool = False) -> dict:
        goal = await database.learning_career_goals.find_one({"user_id": current_user.id})
        if not goal or not goal.get("target_role"):
            return {"target_role": None, "path": [], "readiness_percentage": None, "summary": None}

        cached = goal.get("ai_path")
        if cached and not refresh:
            employee = await self._get_employee(current_user)
            hashes = await learning_cache_service.compute_input_hashes(
                current_user.id, self._employee_recruiter_id(employee)
            )
            if learning_cache_service.hashes_match(cached.get("cache_meta") or {}, hashes):
                return await self._refresh_path_completion_flags(cached, current_user.id)

        gap = await self.get_skill_gap(current_user, goal["target_role"], refresh=refresh)
        employee = await self._get_employee(current_user)
        recruiter_id = self._employee_recruiter_id(employee)

        keywords = list(gap.get("missing_skills") or []) + [goal["target_role"]]
        catalog_courses = await catalog_service.find_courses_for_keywords(keywords, per_keyword=4, limit=40)
        kb_certs = []
        role_def = await recruiter_kb_service.find_role_by_title(goal["target_role"], recruiter_id)
        if role_def:
            kb_certs = role_def.get("certifications") or []
        else:
            all_kb = await recruiter_kb_service.list_as_catalog_courses(recruiter_id)
            kb_certs = [
                {
                    "title": c.get("title"),
                    "provider": c.get("provider"),
                    "official_url": c.get("url"),
                    "estimated_hours": c.get("estimated_hours"),
                    "difficulty": (c.get("levels") or [None])[0],
                    "description": c.get("summary"),
                    "skills_covered": c.get("products") or [],
                    "id": c.get("uid"),
                }
                for c in all_kb
            ]

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
            kb_certifications=kb_certs,
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
        """Compare employee profile against all recruiter KB roles (deterministic)."""
        employee = await self._get_employee(current_user)
        recruiter_id = self._employee_recruiter_id(employee)
        hashes = await learning_cache_service.compute_input_hashes(current_user.id, recruiter_id)
        if not refresh:
            cached = await learning_cache_service.get_cached_role_matches(current_user.id, hashes)
            if cached:
                return cached

        resume_fields = await self._get_resume_fields(current_user.id)
        skills = await self._current_skill_names(current_user.id, resume_fields)
        certs = await self._employee_cert_titles(current_user.id)
        roles = await recruiter_kb_service.get_roles_for_matching(recruiter_id)
        matches = role_matching_service.match_employee_to_roles(
            employee_skills=skills,
            employee_certifications=certs,
            roles=roles,
        )
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
    async def get_recommendations(self, current_user: CurrentUser, *, refresh: bool = False) -> dict:
        employee = await self._get_employee(current_user)
        cached = await database.learning_ai_recommendations.find_one({"user_id": current_user.id})
        if cached and not refresh:
            age = _now() - cached["generated_at"]
            if age < timedelta(hours=AI_RECOMMENDATIONS_TTL_HOURS):
                return {
                    "recommendations": cached["recommendations"],
                    "generated_at": _iso(cached["generated_at"]),
                    "stale": False,
                }

        resume_fields = await self._get_resume_fields(current_user.id)
        current_skills = await self._current_skill_names(current_user.id, resume_fields)
        goal_doc = await database.learning_career_goals.find_one({"user_id": current_user.id})
        career_goal = (goal_doc or {}).get("target_role")

        skill_gaps: list[dict] = []
        try:
            gap = await self.get_skill_gap(current_user, career_goal or employee.get("job_title"))
            skill_gaps = gap.get("skill_gaps") or []
        except HTTPException:
            skill_gaps = []

        keywords = list(current_skills)
        for gap_item in skill_gaps:
            if gap_item.get("skill"):
                keywords.append(gap_item["skill"])
        if employee.get("job_title"):
            keywords.append(employee["job_title"])
        if employee.get("department"):
            keywords.append(employee["department"])
        if career_goal:
            keywords.append(career_goal)
        if not keywords:
            keywords = ["fundamentals"]

        # Prefer keywords from critical/immediate gaps first in search ordering.
        priority_order = {"critical": 0, "immediate": 1, "medium": 2, "low": 3}
        gap_skills = sorted(skill_gaps, key=lambda g: priority_order.get(g.get("priority"), 2))
        search_keywords = [g["skill"] for g in gap_skills if g.get("skill")] + keywords

        candidates = await catalog_service.find_courses_for_keywords(
            list(dict.fromkeys(search_keywords))[:20], per_keyword=5, limit=48
        )

        # Prefer courses already on the employee's learning path (gap-closing steps)
        path_courses: list[dict] = []
        goal_path = (goal_doc or {}).get("ai_path") or {}
        for step in goal_path.get("path") or []:
            course = step.get("course") or {}
            uid = course.get("uid")
            if not uid or str(uid).startswith("kb-cert:"):
                continue
            path_courses.append(
                {
                    "uid": uid,
                    "title": course.get("title"),
                    "url": course.get("url"),
                    "type": course.get("type") or "module",
                    "source": course.get("source") or "microsoft_learn",
                    "duration_minutes": course.get("duration_minutes"),
                    "levels": [course.get("difficulty")] if course.get("difficulty") else ["beginner"],
                    "summary": f"Learning path step for {step.get('skill') or career_goal or 'your goal'}",
                    "products": [step.get("skill")] if step.get("skill") else [],
                    "subjects": [],
                    "roles": [career_goal] if career_goal else [],
                }
            )
        if path_courses:
            candidates = path_courses + candidates

        # Deduplicate candidates by uid (path first)
        seen_cand: set[str] = set()
        deduped_cand: list[dict] = []
        for c in candidates:
            uid = c.get("uid")
            if not uid or uid in seen_cand:
                continue
            seen_cand.add(uid)
            deduped_cand.append(c)
        candidates = deduped_cand

        # Never recommend a course already assigned or enrolled.
        existing_uids = set()
        for coll in (database.learning_assignments, database.learning_enrollments):
            docs = await coll.find({"user_id": current_user.id}, {"course_uid": 1}).to_list(length=1000)
            existing_uids.update(d["course_uid"] for d in docs if d.get("course_uid"))
        candidates = [c for c in candidates if c.get("uid") not in existing_uids]

        picks = await learning_ai_service.rank_recommended_courses(
            job_title=employee.get("job_title"),
            department=employee.get("department"),
            current_skills=current_skills,
            career_goal=career_goal,
            skill_gaps=skill_gaps,
            candidates=candidates,
            top_n=8,
            use_llm=False,
        )

        by_uid = {c["uid"]: c for c in candidates}
        recommendations = []
        for pick in picks:
            course = by_uid.get(pick["uid"])
            if course:
                entry = self._public_course(course)
                entry["reason"] = pick["reason"]
                entry["priority"] = pick.get("priority") or "medium"
                recommendations.append(entry)

        if not recommendations and candidates:
            for course in candidates[:6]:
                entry = self._public_course(course)
                gap_hint = next((g.get("skill") for g in skill_gaps if g.get("skill")), None)
                entry["reason"] = (
                    f"Helps close skill gap: {gap_hint}."
                    if gap_hint
                    else f"Toward your goal: {career_goal or employee.get('job_title') or 'your role'}."
                )
                entry["priority"] = "medium"
                recommendations.append(entry)

        now = _now()
        await database.learning_ai_recommendations.update_one(
            {"user_id": current_user.id},
            {"$set": {"user_id": current_user.id, "recommendations": recommendations, "generated_at": now}},
            upsert=True,
        )
        return {"recommendations": recommendations, "generated_at": now.isoformat(), "stale": False}

    # ------------------------------------------------------------------ #
    # Recruiter: assign courses (US-068), analytics (US-076), oversight
    # ------------------------------------------------------------------ #
    async def assign_courses(self, current_user: CurrentUser, request: CourseAssignRequest) -> dict:
        assigned = []
        skipped = []
        errors = []
        now = _now()

        target_ids = list(request.employee_ids)
        if request.department or request.job_title or not target_ids:
            query: dict[str, Any] = {"status": "active"}
            if current_user.role != "super_admin":
                query["recruiter_id"] = current_user.id
            if request.department:
                query["department"] = {"$regex": f"^{_escape_regex(request.department)}$", "$options": "i"}
            if request.job_title:
                query["job_title"] = {"$regex": f"^{_escape_regex(request.job_title)}$", "$options": "i"}
            if request.department or request.job_title:
                matches = await database.employees.find(query, {"employee_id": 1}).to_list(length=2000)
                matched_ids = [m["employee_id"] for m in matches if m.get("employee_id")]
                if target_ids:
                    target_ids = [eid for eid in target_ids if eid in set(matched_ids)]
                else:
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
                {"employee_id": employee_id, "course_uid": request.course_uid}
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
                "due_date": request.due_date.isoformat() if request.due_date else None,
                "note": request.note,
                "status": "assigned",
                "created_at": now,
                "updated_at": now,
            }
            result = await database.learning_assignments.insert_one(doc)
            doc["_id"] = result.inserted_id
            assigned.append(self._public_assignment(doc))

            if employee.get("user_id"):
                await create_notification(
                    recipient_id=employee["user_id"],
                    recipient_role="employee",
                    notif_type="course_assigned",
                    title="New course assigned",
                    message=f"\"{request.course_title}\" was assigned to you"
                    + (f", due {request.due_date}." if request.due_date else "."),
                    link="/dashboard/employee/learning",
                    related_id=str(doc["_id"]),
                )
        return {"assigned": assigned, "skipped": skipped, "errors": errors}

    def _public_assignment(self, doc: dict) -> dict:
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
            "due_date": _iso(doc.get("due_date")),
            "note": doc.get("note"),
            "status": doc.get("status"),
            "assigned_by": doc.get("assigned_by"),
            "created_at": _iso(doc.get("created_at")),
        }

    async def list_assignments(self, current_user: CurrentUser, *, employee_id: str | None, status_filter: str | None) -> dict:
        query: dict[str, Any] = {}
        if current_user.role != "super_admin":
            query["assigned_by_id"] = current_user.id
        if employee_id:
            query["employee_id"] = employee_id
        if status_filter:
            query["status"] = status_filter
        docs = await database.learning_assignments.find(query).sort("created_at", -1).to_list(length=500)
        return {"assignments": [self._public_assignment(d) for d in docs]}

    async def get_employee_learning_profile(
        self, current_user: CurrentUser, employee_id: str, *, refresh_ai: bool = False
    ) -> dict:
        employee = await self._get_employee_by_id(employee_id)
        await self._assert_recruiter_owns(current_user, employee)
        user_id = employee.get("user_id")
        enrollments = await database.learning_enrollments.find({"user_id": user_id}).sort("updated_at", -1).to_list(length=300)
        assignments = await database.learning_assignments.find({"employee_id": employee_id}).sort("created_at", -1).to_list(length=300)
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
        current_skills = await self._current_skill_names(user_id, resume_fields) if user_id else []
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

            assessment = await self._get_or_build_skill_assessment(
                employee=employee,
                user_id=user_id,
                resume_fields=resume_fields,
                existing_skills=skills,
                refresh=refresh_ai,
            )
            skill_gaps = (assessment or {}).get("gaps") or []

            # Deterministic role matches from recruiter KB
            kb_roles = await recruiter_kb_service.get_roles_for_matching(recruiter_id)
            emp_certs = [c.get("course_title") for c in certs_earned if c.get("course_title")]
            role_matches = role_matching_service.match_employee_to_roles(
                employee_skills=current_skills,
                employee_certifications=emp_certs,
                roles=kb_roles,
            )

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
                keywords = list(current_skills) + [g.get("skill") for g in skill_gaps if g.get("skill")]
                if employee.get("job_title"):
                    keywords.append(employee["job_title"])
                if employee.get("department"):
                    keywords.append(employee["department"])
                keywords = [k for k in keywords if k] or ["fundamentals"]
                candidates = await catalog_service.find_courses_for_keywords(
                    list(dict.fromkeys(keywords))[:20], per_keyword=4, limit=36
                )
                kb_courses = await recruiter_kb_service.list_as_catalog_courses(recruiter_id)
                candidates = candidates + kb_courses
                existing_uids = {
                    a["course_uid"] for a in assignments if a.get("course_uid")
                } | {e["course_uid"] for e in enrollments if e.get("course_uid")}
                candidates = [c for c in candidates if c.get("uid") not in existing_uids]
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

                # Prefer deterministic readiness from top role match; AI for NL only
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
                else:
                    promotion = await learning_ai_service.predict_promotion_readiness(
                        job_title=employee.get("job_title"),
                        department=employee.get("department"),
                        target_role=target_role,
                        current_skills=current_skills,
                        skill_gaps=skill_gaps,
                        learning_summary=learning_summary,
                        professional_summary=resume_fields.get("professional_summary"),
                    )

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

        merged_skills = (
            await self._merged_skills_for_user(user_id, resume_fields) if user_id else []
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
        assessment = await learning_ai_service.build_skill_matrix(
            job_title=employee.get("job_title"),
            department=employee.get("department"),
            resume_fields=resume_fields,
            resume_text=resume_text,
            existing_skills=existing_public,
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

    async def get_analytics(self, current_user: CurrentUser) -> dict:
        """US-076: recruiter learning analytics."""
        query: dict[str, Any] = {}
        assignment_query: dict[str, Any] = {}
        if current_user.role != "super_admin":
            query["recruiter_id"] = current_user.id
            assignment_query["assigned_by_id"] = current_user.id

        assignments = await database.learning_assignments.find(assignment_query).to_list(length=5000)
        certificates = await database.learning_certificates.find(query).to_list(length=5000)

        employee_ids = {a["employee_id"] for a in assignments if a.get("employee_id")}
        enrollments: list[dict] = []
        if employee_ids:
            enrollments = await database.learning_enrollments.find(
                {"employee_id": {"$in": list(employee_ids)}}
            ).to_list(length=5000)

        total_assigned = len(assignments)
        completed_assigned = len([a for a in assignments if a.get("status") == "completed"])
        completion_rate = round((completed_assigned / total_assigned) * 100, 1) if total_assigned else 0.0

        verified_certs = [c for c in certificates if c.get("verification_status") == "verified"]
        certification_rate = round((len(verified_certs) / len(certificates)) * 100, 1) if certificates else 0.0
        total_learning_hours = round(sum((c.get("learning_hours") or 0) for c in verified_certs), 1)

        popular: dict[str, int] = {}
        for e in enrollments:
            title = e.get("course_title") or "Untitled"
            popular[title] = popular.get(title, 0) + 1
        popular_courses = sorted(popular.items(), key=lambda kv: -kv[1])[:8]

        dept_stats: dict[str, dict[str, int]] = {}
        for a in assignments:
            dept = a.get("department") or "Unassigned"
            bucket = dept_stats.setdefault(dept, {"assigned": 0, "completed": 0})
            bucket["assigned"] += 1
            if a.get("status") == "completed":
                bucket["completed"] += 1
        department_comparison = [
            {
                "department": dept,
                "assigned": stats["assigned"],
                "completed": stats["completed"],
                "completion_rate": round((stats["completed"] / stats["assigned"]) * 100, 1) if stats["assigned"] else 0,
            }
            for dept, stats in sorted(dept_stats.items())
        ]

        return {
            "completion_rate": completion_rate,
            "certification_rate": certification_rate,
            "total_learning_hours": total_learning_hours,
            "total_assignments": total_assigned,
            "total_certificates": len(certificates),
            "pending_certificates": len([c for c in certificates if c.get("verification_status") == "pending"]),
            "popular_courses": [{"title": t, "enrollments": n} for t, n in popular_courses],
            "department_comparison": department_comparison,
        }


def _escape_regex(value: str) -> str:
    import re

    return re.escape(value)


learning_service = LearningService()

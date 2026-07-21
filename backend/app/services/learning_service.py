"""Phase 3 — Epic 6 Learning Management + Epic 8 skill/career slice.

Flow implemented end-to-end:
  Learning Page -> Course Catalog (Microsoft Learn, live + cached) -> employee
  clicks a course -> redirected to learn.microsoft.com -> completes course ->
  returns -> uploads certificate -> recruiter verifies -> skill matrix updates.

AI (Gemini) is used for course recommendations and skill-gap/career-path
analysis, always grounded in the real Microsoft Learn catalog (see
learning_ai_service.py for the no-hallucination design).
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
from app.services import learning_ai_service, ms_learn_service, storage_service
from app.services.dashboard_service import create_notification

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
        await database.learning_ai_recommendations.delete_one({"user_id": user_id})
        await database.learning_career_goals.update_one(
            {"user_id": user_id}, {"$set": {"ai_path": None, "skill_matrix": None}}
        )
        await database.learning_skill_assessments.delete_one({"user_id": user_id})

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
        manual = await database.employee_skills.find({"user_id": user_id}).to_list(length=300)
        names = {d["skill_name"].strip() for d in manual if d.get("skill_name")}
        resume_fields = resume_fields if resume_fields is not None else await self._get_resume_fields(user_id)
        for key in ("technical_skills", "soft_skills", "skills"):
            for value in resume_fields.get(key) or []:
                if isinstance(value, str) and value.strip():
                    names.add(value.strip())
        return sorted(names, key=str.lower)

    def _public_course(self, item: dict) -> dict:
        return {
            "uid": item.get("uid"),
            "type": item.get("type"),
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
    ) -> dict:
        if bookmarked_only:
            bookmarks = await database.learning_bookmarks.find({"user_id": current_user.id}).sort(
                "created_at", -1
            ).to_list(length=500)
            courses = []
            for b in bookmarks:
                item = await ms_learn_service.get_course_by_uid(b["course_uid"])
                if item:
                    public = self._public_course(item)
                else:
                    public = {
                        "uid": b.get("course_uid"),
                        "type": b.get("course_type"),
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

        result = await ms_learn_service.search_catalog(
            q=q, role=role, level=level, product=product, course_type=course_type, page=page, page_size=page_size
        )
        uids = [c["uid"] for c in result["courses"]]
        status_map = await self._status_map(current_user.id, uids)
        courses = []
        for item in result["courses"]:
            public = self._public_course(item)
            public.update(status_map.get(item["uid"], {"enrolled": False, "bookmarked": False, "assigned": False}))
            courses.append(public)
        result["courses"] = courses
        return result

    async def get_facets(self) -> dict:
        return await ms_learn_service.get_facets()

    async def get_course_detail(self, current_user: CurrentUser, uid: str) -> dict:
        item = await ms_learn_service.get_course_by_uid(uid)
        if not item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found in Microsoft Learn catalog.")
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
        item = await ms_learn_service.get_course_by_uid(uid)
        if not item:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found in Microsoft Learn catalog.")
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
        if enrollment.get("assignment_id") and updates.get("status") == "completed":
            await database.learning_assignments.update_one(
                {"_id": ObjectId(enrollment["assignment_id"])}, {"$set": {"status": "completed", "updated_at": now}}
            )
        updated = await database.learning_enrollments.find_one({"_id": enrollment["_id"]})
        return {"enrollment": self._public_enrollment(updated)}

    async def list_my_courses(self, current_user: CurrentUser, status_filter: str | None) -> dict:
        query: dict[str, Any] = {"user_id": current_user.id}
        if status_filter:
            query["status"] = status_filter
        docs = await database.learning_enrollments.find(query).sort("updated_at", -1).to_list(length=300)
        return {"enrollments": [self._public_enrollment(d) for d in docs]}

    # ------------------------------------------------------------------ #
    # US-069: My Learning dashboard
    # ------------------------------------------------------------------ #
    async def get_learning_dashboard(self, current_user: CurrentUser) -> dict:
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

        upcoming_due = sorted(
            [a for a in assigned_open if a.get("due_date")],
            key=lambda a: a["due_date"],
        )[:5]

        return {
            "employee": {
                "employee_id": employee.get("employee_id"),
                "full_name": employee.get("full_name"),
                "job_title": employee.get("job_title"),
                "department": employee.get("department"),
            },
            "summary": {
                "assigned_count": len(assignments),
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
                    "course_title": a.get("course_title"),
                    "course_uid": a.get("course_uid"),
                    "due_date": _iso(a.get("due_date")),
                    "status": a.get("status"),
                }
                for a in upcoming_due
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
                course = await ms_learn_service.get_course_by_uid(cert["course_uid"])
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
        docs = await database.employee_skills.find({"user_id": current_user.id}).sort("skill_name", 1).to_list(length=300)
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
        return {"skill": self._public_skill(doc)}

    async def delete_skill(self, current_user: CurrentUser, skill_id: str) -> dict:
        if not ObjectId.is_valid(skill_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill not found.")
        result = await database.employee_skills.delete_one({"_id": ObjectId(skill_id), "user_id": current_user.id})
        if result.deleted_count == 0:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill not found.")
        return {"deleted": True}

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

    async def get_skill_gap(self, current_user: CurrentUser, target_role: str | None) -> dict:
        """US-075 / US-100: skill gap dashboard, grounded with real MS Learn courses."""
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

        resume_fields = await self._get_resume_fields(current_user.id)
        current_skills = await self._current_skill_names(current_user.id, resume_fields)

        analysis = await learning_ai_service.analyze_skill_gap(
            job_title=employee.get("job_title"),
            department=employee.get("department"),
            target_role=resolved_role,
            current_skills=current_skills,
            professional_summary=resume_fields.get("professional_summary"),
        )
        if not analysis:
            return {
                "target_role": resolved_role,
                "current_skills": current_skills,
                "missing_skills": [],
                "skill_gaps": [],
                "matched_skills": [],
                "readiness_percentage": None,
                "summary": "AI analysis is temporarily unavailable. Please try again shortly.",
                "recommended_courses": [],
            }

        missing_objs = analysis["missing_skills"]
        missing_names = [m["skill"] for m in missing_objs]
        # Critical / immediate first for course attachment.
        priority_order = {"critical": 0, "immediate": 1, "medium": 2, "low": 3}
        missing_objs = sorted(missing_objs, key=lambda m: priority_order.get(m.get("priority"), 2))

        recommended_courses = []
        if missing_names:
            candidates = await ms_learn_service.find_courses_for_keywords(
                missing_names, per_keyword=2, limit=len(missing_names) * 2
            )
            for gap in missing_objs:
                skill = gap["skill"]
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
                            "priority": gap.get("priority", "medium"),
                            "reason": gap.get("reason", ""),
                            "course": self._public_course(match),
                        }
                    )
                    candidates = [c for c in candidates if c["uid"] != match["uid"]]

        return {
            "target_role": resolved_role,
            "current_skills": current_skills,
            "missing_skills": missing_names,
            "skill_gaps": missing_objs,
            "matched_skills": analysis["matched_skills"],
            "readiness_percentage": analysis["readiness_percentage"],
            "summary": analysis["summary"],
            "recommended_courses": recommended_courses,
        }

    async def get_career_path(self, current_user: CurrentUser, *, refresh: bool = False) -> dict:
        goal = await database.learning_career_goals.find_one({"user_id": current_user.id})
        if not goal or not goal.get("target_role"):
            return {"target_role": None, "path": [], "readiness_percentage": None, "summary": None}

        cached = goal.get("ai_path")
        if cached and not refresh:
            return cached

        gap = await self.get_skill_gap(current_user, goal["target_role"])
        path = []
        for idx, item in enumerate(gap.get("recommended_courses") or [], start=1):
            path.append({"step": idx, "skill": item["skill"], "course": item["course"]})

        # Suggest a matching certification as the path's capstone, if one exists.
        certification = None
        certs = await ms_learn_service.find_courses_for_keywords([goal["target_role"]], per_keyword=3, limit=3)
        certs = [c for c in certs if c.get("type") == "certification"]
        if certs:
            certification = self._public_course(certs[0])

        payload = {
            "target_role": goal["target_role"],
            "path": path,
            "certification": certification,
            "readiness_percentage": gap.get("readiness_percentage"),
            "summary": gap.get("summary"),
            "generated_at": _now().isoformat(),
        }
        await database.learning_career_goals.update_one({"_id": goal["_id"]}, {"$set": {"ai_path": payload}})
        return payload

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

        candidates = await ms_learn_service.find_courses_for_keywords(
            list(dict.fromkeys(search_keywords))[:20], per_keyword=5, limit=40
        )

        # Never recommend a course already assigned or completed.
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
            for course in sorted(candidates, key=lambda c: -(c.get("popularity") or 0))[:6]:
                entry = self._public_course(course)
                entry["reason"] = "Popular course matching your current skills and role."
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

        if user_id:
            assessment = await self._get_or_build_skill_assessment(
                employee=employee,
                user_id=user_id,
                resume_fields=resume_fields,
                existing_skills=skills,
                refresh=refresh_ai,
            )
            skill_gaps = (assessment or {}).get("gaps") or []

            # Recommendations for this employee (recruiter view) — reuse ranking pipeline.
            keywords = list(current_skills) + [g.get("skill") for g in skill_gaps if g.get("skill")]
            if employee.get("job_title"):
                keywords.append(employee["job_title"])
            if employee.get("department"):
                keywords.append(employee["department"])
            keywords = [k for k in keywords if k]
            if not keywords:
                keywords = ["fundamentals"]
            candidates = await ms_learn_service.find_courses_for_keywords(
                list(dict.fromkeys(keywords))[:20], per_keyword=4, limit=30
            )
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

            promotion = await learning_ai_service.predict_promotion_readiness(
                job_title=employee.get("job_title"),
                department=employee.get("department"),
                target_role=target_role,
                current_skills=current_skills,
                skill_gaps=skill_gaps,
                learning_summary=learning_summary,
                professional_summary=resume_fields.get("professional_summary"),
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
            "skills": [self._public_skill(s) for s in skills],
            "skill_assessment": assessment,
            "skill_gaps": skill_gaps,
            "recommendations": recommendations,
            "promotion": promotion,
            "career_goal": target_role,
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
        cached = await database.learning_skill_assessments.find_one({"user_id": user_id})
        if cached and not refresh:
            age = _now() - cached["generated_at"]
            if age < timedelta(hours=AI_RECOMMENDATIONS_TTL_HOURS):
                return cached.get("assessment")

        resume_text = await self._get_resume_text(user_id)
        existing_public = [
            {
                "skill_name": s.get("skill_name"),
                "category": s.get("category"),
                "proficiency": s.get("proficiency"),
            }
            for s in existing_skills
        ]
        assessment = await learning_ai_service.build_skill_matrix(
            job_title=employee.get("job_title"),
            department=employee.get("department"),
            resume_fields=resume_fields,
            resume_text=resume_text,
            existing_skills=existing_public,
        )
        if not assessment:
            return cached.get("assessment") if cached else None

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

        now = _now()
        await database.learning_skill_assessments.update_one(
            {"user_id": user_id},
            {"$set": {"user_id": user_id, "assessment": assessment, "generated_at": now}},
            upsert=True,
        )
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
            # Don't overwrite human/course-verified proficiency downward.
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

    async def assess_my_skills(self, current_user: CurrentUser, *, refresh: bool = False) -> dict:
        employee = await self._get_employee(current_user)
        resume_fields = await self._get_resume_fields(current_user.id)
        skills = await database.employee_skills.find({"user_id": current_user.id}).to_list(length=300)
        assessment = await self._get_or_build_skill_assessment(
            employee=employee,
            user_id=current_user.id,
            resume_fields=resume_fields,
            existing_skills=skills,
            refresh=refresh,
        )
        updated_skills = await database.employee_skills.find({"user_id": current_user.id}).sort("skill_name", 1).to_list(
            length=300
        )
        return {
            "assessment": assessment,
            "skills": [self._public_skill(s) for s in updated_skills],
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

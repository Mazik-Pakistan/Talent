import re
from datetime import UTC, date, datetime, timedelta

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException, status

from app.core.database import database
from app.core.rbac import CurrentUser
from app.schemas.dashboard import (
    CreateAnnouncementRequest,
    MarkNotificationsReadRequest,
    UpdateAnnouncementRequest,
    UpdateRecruiterProfileRequest,
)
from app.services.email_service import email_service

UPCOMING_JOINING_WINDOW_DAYS = 30
RECENT_ACTIVITY_LIMIT_DEFAULT = 20
RECENT_ACTIVITY_LIMIT_MAX = 100
REQUIRED_ONBOARDING_FIELDS = ("personal", "education", "skills", "government_docs", "resume")
DECLINED_OFFER_STATUSES = {"declined", "expired", "withdrawn"}

# US-016 / US-034: friendly labels for business-facing activity timeline.
ACTIVITY_LABELS: dict[str, str] = {
    "candidate_registered": "Candidate Created",
    "candidate_email_verified": "Candidate verified their email",
    "invitation_created": "Invitation sent to candidate",
    "intake_submitted": "Onboarding submitted",
    "onboarding_submitted": "Onboarding submitted",
    "offer_sent": "Offer Sent",
    "offer_signed": "Offer Accepted",
    "offer_approved": "Offer Approved",
    "document_uploaded": "Documents Uploaded",
    "ocr_completed": "OCR Verified",
    "ocr_failed": "OCR Failed",
    "candidate_converted_to_employee": "Employee Created",
    "career_joined": "Employee Joined",
    "career_promoted": "Employee Promoted",
    "career_title_change": "Title Changed",
    "career_department_change": "Department Changed",
    "career_manager_change": "Manager Changed",
    "career_status_change": "Employment Status Changed",
    "recruiter_registered": "Recruiter account created",
    "recruiter_email_verified": "Recruiter verified their email",
    "super_admin_email_verified": "Super admin verified their email",
    "announcement_published": "Announcement published",
    "announcement_updated": "Announcement updated",
    "announcement_deleted": "Announcement deleted",
    "profile_emergency_saved": "Employee emergency contact saved",
    "profile_employment_saved": "Employee banking details saved",
    "profile_references_saved": "Employee references saved",
    "profile_documents_saved": "Employee policies acknowledged",
    "profile_nda_saved": "Employee NDA signed",
    "employee_profile_completed": "Employee profile completed",
    "profile_completion_reminder": "Profile completion reminder sent",
}


async def create_notification(
    *,
    recipient_id: str,
    recipient_role: str,
    notif_type: str,
    title: str,
    message: str,
    link: str | None = None,
    related_id: str | None = None,
) -> str | None:
    """Shared helper — other services call this when a notify-worthy event happens (US-014).

    Returns the inserted notification id as a string, or None if skipped.
    """
    if not recipient_id:
        return None
    result = await database.notifications.insert_one(
        {
            "recipient_id": str(recipient_id),
            "recipient_role": recipient_role,
            "type": notif_type,
            "title": title,
            "message": message,
            "link": link,
            "related_id": related_id,
            "read": False,
            "created_at": datetime.now(UTC),
        }
    )
    return str(result.inserted_id)


def _parse_start_date(value) -> date | None:
    if not value:
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


class DashboardService:
    @staticmethod
    def _candidate_id(candidate: dict) -> str:
        return candidate.get("user_id") or str(candidate.get("_id") or "")

    @staticmethod
    def _missing_onboarding_fields(onboarding: dict | None) -> list[str]:
        onboarding = onboarding or {}
        return [field for field in REQUIRED_ONBOARDING_FIELDS if not onboarding.get(field)]

    @classmethod
    def _is_offer_declined(cls, candidate: dict, offer_status_by_candidate: dict[str, str] | None = None) -> bool:
        offer_status_by_candidate = offer_status_by_candidate or {}
        candidate_id = cls._candidate_id(candidate)
        if candidate.get("conversion_status") in {"offer_declined", "declined"}:
            return True
        return offer_status_by_candidate.get(candidate_id) in DECLINED_OFFER_STATUSES

    @classmethod
    def _candidate_identifiers(cls, candidate: dict) -> set[str]:
        identifiers = set()
        candidate_id = cls._candidate_id(candidate)
        if candidate_id:
            identifiers.add(candidate_id)
        if email := candidate.get("email"):
            identifiers.add(email)
        if _id := candidate.get("_id"):
            identifiers.add(str(_id))
        return identifiers

    @classmethod
    def _has_existing_offer(cls, candidate: dict, offer_candidate_ids: set[str]) -> bool:
        return bool(cls._candidate_identifiers(candidate) & offer_candidate_ids)

    # ------------------------------------------------------------------
    # US-013: Recruiter's Dashboard Overview
    # ------------------------------------------------------------------
    async def get_summary(self, current_user: CurrentUser) -> dict:
        candidate_filter = self._scope_filter(current_user)
        employee_filter = self._scope_filter(current_user)

        candidates = await database.candidates.find(candidate_filter).to_list(length=None)
        employees = await database.employees.find(employee_filter).to_list(length=None)

        candidate_identifiers: set[str] = set()
        for candidate in candidates:
            candidate_identifiers.update(self._candidate_identifiers(candidate))

        offer_candidate_ids: set[str] = set()
        offer_status_by_candidate: dict[str, str] = {}
        if candidate_identifiers:
            offers = await database.offer_letters.find({"candidate_id": {"$in": list(candidate_identifiers)}}).to_list(length=None)
            for offer in offers:
                candidate_id = offer.get("candidate_id")
                if candidate_id:
                    offer_candidate_ids.add(candidate_id)
                    if offer.get("status") in DECLINED_OFFER_STATUSES:
                        offer_status_by_candidate[candidate_id] = offer.get("status")

        active_employees = sum(1 for e in employees if e.get("status") == "active")
        pending_review_candidates = [
            c
            for c in candidates
            if c.get("status") not in {"converted", "declined", "offer_declined"}
            and (c.get("conversion_status") in {"intake_submitted", None, "offer_sent"})
            and (c.get("onboarding") or {}).get("status") == "submitted"
            and not self._is_offer_declined(c, offer_status_by_candidate)
            and not self._has_existing_offer(c, offer_candidate_ids)
        ]

        pending_onboarding = len(pending_review_candidates)
        documents_pending = len(pending_review_candidates)

        today = datetime.now(UTC).date()
        window_end = today + timedelta(days=UPCOMING_JOINING_WINDOW_DAYS)
        upcoming = []

        signed_candidates = [
            c
            for c in candidates
            if c.get("conversion_status") == "offer_signed"
            and c.get("status") not in {"converted", "declined", "offer_declined"}
        ]

        for record in (*employees, *signed_candidates):
            start = _parse_start_date(record.get("start_date"))
            if start and today <= start <= window_end:
                upcoming.append(
                    {
                        "full_name": record.get("full_name"),
                        "department": record.get("department"),
                        "job_title": record.get("job_title"),
                        "start_date": start.isoformat(),
                    }
                )
        upcoming.sort(key=lambda item: item["start_date"])

        recent_employees = sorted(employees, key=lambda e: e.get("created_at") or datetime.min, reverse=True)[:5]
        recent_employees_out = [
            {
                "full_name": e.get("full_name"),
                "email": e.get("email"),
                "job_title": e.get("job_title"),
                "department": e.get("department"),
                "created_at": _iso(e.get("created_at")),
            }
            for e in recent_employees
        ]

        seven_days_ago = datetime.now(UTC) - timedelta(days=7)
        pending_approvals = [
            {
                "full_name": c.get("full_name"),
                "email": c.get("email"),
                "job_title": c.get("job_title"),
                "department": c.get("department"),
                "submitted_at": _iso((c.get("onboarding") or {}).get("submitted_at")),
            }
            for c in candidates
            if (
                not self._is_offer_declined(c, offer_status_by_candidate)
                and (c.get("onboarding") or {}).get("status") == "submitted"
                and c.get("conversion_status") != "converted"
                and (c.get("onboarding") or {}).get("submitted_at")
                and _as_aware(c["onboarding"]["submitted_at"]) >= seven_days_ago
)
        ]
        pending_approvals.sort(key=lambda item: item["submitted_at"] or "", reverse=True)

        unread_count = await database.notifications.count_documents(
            {"recipient_id": current_user.id, "read": False}
        )

        return {
            "kpis": {
                "active_employees": active_employees,
                "pending_onboarding": pending_onboarding,
                "documents_pending": documents_pending,
                "upcoming_joinings": len(upcoming),
            },
            "recent_employees": recent_employees_out,
            "pending_approvals": pending_approvals[:10],
            "upcoming_joining_dates": upcoming[:10],
            "notifications_unread_count": unread_count,
        }

    # ------------------------------------------------------------------
    # US-016: Activity Timeline
    # ------------------------------------------------------------------
    async def get_activity(self, current_user: CurrentUser, limit: int = RECENT_ACTIVITY_LIMIT_DEFAULT) -> dict:
        limit = max(1, min(limit, RECENT_ACTIVITY_LIMIT_MAX))
        query: dict = {"action": {"$in": list(ACTIVITY_LABELS.keys())}}

        if current_user.role != "super_admin":
            candidate_emails = await self._scoped_candidate_emails(current_user)
            query["$or"] = [
                {"user_id": current_user.id},
                {"recruiter_id": current_user.id},
                {"email": {"$in": candidate_emails}},
            ]

        cursor = database.audit_logs.find(query).sort("created_at", -1).limit(limit)
        entries = await cursor.to_list(length=limit)

        activities = [
            {
                "action": entry.get("action"),
                "label": ACTIVITY_LABELS.get(entry.get("action"), entry.get("action")),
                "email": entry.get("email"),
                "actor_email": entry.get("actor_email") or entry.get("email"),
                "outcome": entry.get("outcome"),
                "created_at": _iso(entry.get("created_at")),
            }
            for entry in entries
        ]
        return {"activities": activities}

    # ------------------------------------------------------------------
    # US-014: Dashboard Notifications
    # ------------------------------------------------------------------
    async def get_notifications(self, current_user: CurrentUser, limit: int = 30) -> dict:
        limit = max(1, min(limit, 100))
        cursor = (
            database.notifications.find({"recipient_id": current_user.id})
            .sort("created_at", -1)
            .limit(limit)
        )
        entries = await cursor.to_list(length=limit)
        unread_count = await database.notifications.count_documents(
            {"recipient_id": current_user.id, "read": False}
        )
        return {
            "notifications": [
                {
                    "id": str(entry["_id"]),
                    "type": entry.get("type"),
                    "title": entry.get("title"),
                    "message": entry.get("message"),
                    "link": entry.get("link"),
                    "read": entry.get("read", False),
                    "created_at": _iso(entry.get("created_at")),
                }
                for entry in entries
            ],
            "unread_count": unread_count,
        }

    async def mark_notifications_read(self, current_user: CurrentUser, request: MarkNotificationsReadRequest) -> dict:
        query: dict = {"recipient_id": current_user.id}
        if not request.all:
            object_ids = []
            for raw_id in request.ids:
                try:
                    object_ids.append(ObjectId(raw_id))
                except (InvalidId, TypeError):
                    continue
            if not object_ids:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No valid notification ids provided.")
            query["_id"] = {"$in": object_ids}

        result = await database.notifications.update_many(query, {"$set": {"read": True}})
        return {"message": "Notifications updated.", "updated": result.modified_count}

    # ------------------------------------------------------------------
    # US-017: Global Search
    # ------------------------------------------------------------------
    async def search(self, current_user: CurrentUser, query_text: str) -> dict:
        query_text = query_text.strip()
        if len(query_text) < 2:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Enter at least 2 characters to search.",
            )

        pattern = re.compile(re.escape(query_text), re.IGNORECASE)
        text_filter = {
            "$or": [
                {"full_name": pattern},
                {"email": pattern},
                {"phone": pattern},
                {"department": pattern},
                {"job_title": pattern},
                {"user_id": pattern},
                {"supabase_user_id": pattern},
            ]
        }

        scope = self._scope_filter(current_user)
        candidate_query = {**scope, **text_filter} if scope else text_filter
        employee_query = {**scope, **text_filter} if scope else text_filter

        candidates = await database.candidates.find(candidate_query).limit(15).to_list(length=15)
        employees = await database.employees.find(employee_query).limit(15).to_list(length=15)

        def _record_id(doc: dict) -> str:
            return str(doc.get("user_id") or doc.get("supabase_user_id") or doc.get("_id"))

        results = [
            {
                "type": "employee",
                "id": _record_id(e),
                "full_name": e.get("full_name"),
                "email": e.get("email"),
                "department": e.get("department"),
                "job_title": e.get("job_title"),
                "status": e.get("status"),
            }
            for e in employees
        ]
        seen_ids = {r["id"] for r in results}
        seen_emails = {r["email"] for r in results if r.get("email")}
        for c in candidates:
            rid = _record_id(c)
            if rid in seen_ids or c.get("email") in seen_emails:
                continue
            results.append(
                {
                    "type": "candidate",
                    "id": rid,
                    "full_name": c.get("full_name"),
                    "email": c.get("email"),
                    "department": c.get("department"),
                    "job_title": c.get("job_title"),
                    "status": (c.get("onboarding") or {}).get("status", "not_started"),
                }
            )

        return {"results": results, "count": len(results)}

    # ------------------------------------------------------------------
    # US-020: Announcements (CRUD + notify + email)
    # ------------------------------------------------------------------
    def _public_announcement(self, entry: dict) -> dict:
        return {
            "id": str(entry["_id"]),
            "title": entry.get("title"),
            "body": entry.get("body"),
            "audience": entry.get("audience") or "both",
            "target_departments": entry.get("target_departments") or [],
            "target_designations": entry.get("target_designations") or [],
            "target_employee_ids": entry.get("target_employee_ids") or [],
            "created_by": entry.get("created_by"),
            "created_by_name": entry.get("created_by_name"),
            "created_at": _iso(entry.get("created_at")),
            "updated_at": _iso(entry.get("updated_at")),
        }

    async def list_announcements(
        self,
        current_user: CurrentUser,
        limit: int = 20,
        audience: str | None = None,
    ) -> dict:
        limit = max(1, min(limit, 50))
        query: dict = {}
        role = current_user.role
        if role == "candidate":
            query["$or"] = [
                {"audience": {"$in": ["candidates", "both"]}},
                {"audience": {"$exists": False}},
            ]
        elif role == "employee":
            employee = await database.employees.find_one(
                {**self._scope_filter(current_user), "user_id": current_user.id},
                {"department": 1, "job_title": 1},
            ) or {}
            recipient_filters = [{"target_employee_ids": current_user.id}]
            if employee.get("department"):
                recipient_filters.append({"target_departments": employee["department"]})
            if employee.get("job_title"):
                recipient_filters.append({"target_designations": employee["job_title"]})
            query["$and"] = [
                {"$or": [{"audience": {"$in": ["employees", "both"]}}, {"audience": {"$exists": False}}]},
                {
                    "$or": [
                        {
                            "$and": [
                                {"$or": [{"target_departments": {"$exists": False}}, {"target_departments": {"$size": 0}}]},
                                {"$or": [{"target_designations": {"$exists": False}}, {"target_designations": {"$size": 0}}]},
                                {"$or": [{"target_employee_ids": {"$exists": False}}, {"target_employee_ids": {"$size": 0}}]},
                            ]
                        },
                        {"$or": recipient_filters},
                    ]
                },
            ]
        elif audience in ("candidates", "employees", "both"):
            query["audience"] = audience

        cursor = database.announcements.find(query).sort("created_at", -1).limit(limit)
        entries = await cursor.to_list(length=limit)
        return {"announcements": [self._public_announcement(entry) for entry in entries]}

    async def create_announcement(self, current_user: CurrentUser, request: CreateAnnouncementRequest) -> dict:
        now = datetime.now(UTC)
        document = {
            "title": request.title,
            "body": request.body,
            "audience": request.audience,
            "target_departments": request.target_departments,
            "target_designations": request.target_designations,
            "target_employee_ids": request.target_employee_ids,
            "created_by": current_user.id,
            "created_by_name": current_user.full_name,
            "created_at": now,
            "updated_at": now,
        }
        result = await database.announcements.insert_one(document)
        document["_id"] = result.inserted_id
        notified, emailed = await self._fanout_announcement(
            current_user, document, send_email=request.send_email, notify=True
        )
        await database.audit_logs.insert_one(
            {
                "user_id": current_user.id,
                "actor_email": current_user.email,
                "email": current_user.email,
                "module": "announcements",
                "action": "announcement_published",
                "outcome": "success",
                "related_id": str(result.inserted_id),
                "created_at": now,
            }
        )
        suffix = f", emailed {emailed}" if request.send_email else ""
        return {
            "message": f"Announcement published. Notified {notified} people{suffix}.",
            "announcement": self._public_announcement(document),
            "notified": notified,
            "emailed": emailed,
        }

    async def update_announcement(
        self, current_user: CurrentUser, announcement_id: str, request: UpdateAnnouncementRequest
    ) -> dict:
        entry = await self._require_announcement(announcement_id, current_user)
        now = datetime.now(UTC)
        updates: dict = {"updated_at": now}
        if request.title is not None:
            updates["title"] = request.title
        if request.body is not None:
            updates["body"] = request.body
        if request.audience is not None:
            updates["audience"] = request.audience
        for field_name in ("target_departments", "target_designations", "target_employee_ids"):
            value = getattr(request, field_name)
            if value is not None:
                updates[field_name] = value
        effective_audience = updates.get("audience", entry.get("audience") or "both")
        has_targets = any(updates.get(field_name, entry.get(field_name) or []) for field_name in ("target_departments", "target_designations", "target_employee_ids"))
        if has_targets and effective_audience != "employees":
            raise HTTPException(status_code=422, detail="Targeted announcements must use the employees audience.")
        await database.announcements.update_one({"_id": entry["_id"]}, {"$set": updates})
        refreshed = await database.announcements.find_one({"_id": entry["_id"]})
        notified, emailed = 0, 0
        if request.notify_again or request.send_email:
            notified, emailed = await self._fanout_announcement(
                current_user, refreshed, send_email=request.send_email, notify=request.notify_again
            )
        await database.audit_logs.insert_one(
            {
                "user_id": current_user.id,
                "actor_email": current_user.email,
                "email": current_user.email,
                "module": "announcements",
                "action": "announcement_updated",
                "outcome": "success",
                "related_id": announcement_id,
                "created_at": now,
            }
        )
        return {
            "message": "Announcement updated.",
            "announcement": self._public_announcement(refreshed),
            "notified": notified,
            "emailed": emailed,
        }

    async def delete_announcement(self, current_user: CurrentUser, announcement_id: str) -> dict:
        entry = await self._require_announcement(announcement_id, current_user)
        await database.announcements.delete_one({"_id": entry["_id"]})
        await database.audit_logs.insert_one(
            {
                "user_id": current_user.id,
                "actor_email": current_user.email,
                "email": current_user.email,
                "module": "announcements",
                "action": "announcement_deleted",
                "outcome": "success",
                "related_id": announcement_id,
                "created_at": datetime.now(UTC),
            }
        )
        return {"message": "Announcement deleted.", "id": announcement_id}

    async def _require_announcement(self, announcement_id: str, current_user: CurrentUser) -> dict:
        try:
            object_id = ObjectId(announcement_id)
        except (InvalidId, TypeError) as exc:
            raise HTTPException(status_code=404, detail="Announcement not found.") from exc
        entry = await database.announcements.find_one({"_id": object_id})
        if not entry:
            raise HTTPException(status_code=404, detail="Announcement not found.")
        if current_user.role != "super_admin" and entry.get("created_by") != current_user.id:
            raise HTTPException(status_code=403, detail="You can only manage your own announcements.")
        return entry

    async def _fanout_announcement(
        self, current_user: CurrentUser, announcement: dict, *, send_email: bool, notify: bool
    ) -> tuple[int, int]:
        audience = announcement.get("audience") or "both"
        recipients: list[dict] = []
        scope = self._scope_filter(current_user)

        if audience in ("candidates", "both"):
            candidates = await database.candidates.find(
                {**scope, "status": {"$ne": "converted"}},
                {"user_id": 1, "email": 1, "full_name": 1},
            ).to_list(length=None)
            for doc in candidates:
                if doc.get("user_id") or doc.get("email"):
                    recipients.append(
                        {
                            "id": doc.get("user_id") or str(doc.get("_id")),
                            "role": "candidate",
                            "email": doc.get("email"),
                            "full_name": doc.get("full_name") or "there",
                            "link": "/dashboard/candidate",
                        }
                    )

        if audience in ("employees", "both"):
            employee_filters: list[dict] = []
            if announcement.get("target_departments"):
                employee_filters.append({"department": {"$in": announcement["target_departments"]}})
            if announcement.get("target_designations"):
                employee_filters.append({"job_title": {"$in": announcement["target_designations"]}})
            if announcement.get("target_employee_ids"):
                employee_filters.append({"user_id": {"$in": announcement["target_employee_ids"]}})
            employees = await database.employees.find(
                {**scope, "status": "active", **({"$or": employee_filters} if employee_filters else {})},
                {"user_id": 1, "email": 1, "company_email": 1, "full_name": 1},
            ).to_list(length=None)
            for doc in employees:
                recipients.append(
                    {
                        "id": doc.get("user_id") or str(doc.get("_id")),
                        "role": "employee",
                        "email": doc.get("company_email") or doc.get("email"),
                        "full_name": doc.get("full_name") or "there",
                        "link": "/dashboard/employee",
                    }
                )

        seen: set[str] = set()
        unique: list[dict] = []
        for item in recipients:
            rid = str(item["id"])
            if not rid or rid in seen:
                continue
            seen.add(rid)
            unique.append(item)

        notified = 0
        emailed = 0
        title = announcement.get("title") or "Announcement"
        body = announcement.get("body") or ""
        related_id = str(announcement.get("_id"))

        for person in unique:
            if notify and person.get("id"):
                await create_notification(
                    recipient_id=str(person["id"]),
                    recipient_role=person["role"],
                    notif_type="announcement",
                    title=title,
                    message=body[:240],
                    link=person["link"],
                    related_id=related_id,
                )
                notified += 1
            if send_email and person.get("email"):
                try:
                    email_service.send_announcement(
                        person["email"],
                        person["full_name"],
                        title,
                        body,
                        dashboard_url=person["link"],
                    )
                    emailed += 1
                except Exception:
                    continue
        return notified, emailed

    async def get_recruiter_profile(self, current_user: CurrentUser) -> dict:
        collection = database.super_admins if current_user.role == "super_admin" else database.recruiters
        doc = await collection.find_one({"$or": [{"user_id": current_user.id}, {"email": current_user.email}]})
        if not doc:
            return {
                "profile": {
                    "id": current_user.id,
                    "full_name": current_user.full_name,
                    "email": current_user.email,
                    "phone": getattr(current_user, "phone", None),
                    "role": current_user.role,
                    "department": None,
                    "job_title": None,
                    "office_location": None,
                    "profile_picture": None,
                }
            }
        return {
            "profile": {
                "id": doc.get("user_id") or str(doc.get("_id")),
                "full_name": doc.get("full_name") or current_user.full_name,
                "email": doc.get("email") or current_user.email,
                "phone": doc.get("phone"),
                "role": current_user.role,
                "department": doc.get("department"),
                "job_title": doc.get("job_title"),
                "office_location": doc.get("office_location"),
                "profile_picture": doc.get("profile_picture"),
                "created_at": _iso(doc.get("created_at")),
            }
        }

    async def update_recruiter_profile(self, current_user: CurrentUser, request: UpdateRecruiterProfileRequest) -> dict:
        collection = database.super_admins if current_user.role == "super_admin" else database.recruiters
        updates = {
            "full_name": request.full_name,
            "phone": request.phone,
            "department": request.department,
            "job_title": request.job_title,
            "office_location": request.office_location,
            "updated_at": datetime.now(UTC),
        }
        result = await collection.update_one(
            {"$or": [{"user_id": current_user.id}, {"email": current_user.email}]},
            {"$set": updates},
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Recruiter profile not found.")
        return await self.get_recruiter_profile(current_user)

    async def upload_recruiter_photo(self, current_user: CurrentUser, file) -> dict:
        from app.services.profile_photo_service import save_profile_photo

        collection = database.super_admins if current_user.role == "super_admin" else database.recruiters
        doc = await collection.find_one({"$or": [{"user_id": current_user.id}, {"email": current_user.email}]})
        if not doc:
            raise HTTPException(status_code=404, detail="Recruiter profile not found.")

        photo_fields = await save_profile_photo(
            current_user.id,
            file,
            previous_meta=doc.get("profile_picture_meta"),
        )
        await collection.update_one(
            {"_id": doc["_id"]},
            {"$set": {**photo_fields, "updated_at": datetime.now(UTC)}},
        )
        return await self.get_recruiter_profile(current_user)

    async def remove_recruiter_photo(self, current_user: CurrentUser) -> dict:
        from app.services.profile_photo_service import remove_profile_photo

        collection = database.super_admins if current_user.role == "super_admin" else database.recruiters
        doc = await collection.find_one({"$or": [{"user_id": current_user.id}, {"email": current_user.email}]})
        if not doc:
            raise HTTPException(status_code=404, detail="Recruiter profile not found.")

        photo_fields = await remove_profile_photo(doc.get("profile_picture_meta"))
        await collection.update_one(
            {"_id": doc["_id"]},
            {"$set": {**photo_fields, "updated_at": datetime.now(UTC)}},
        )
        return await self.get_recruiter_profile(current_user)

    # ------------------------------------------------------------------
    # Scoping helpers
    # ------------------------------------------------------------------
    def _scope_filter(self, current_user: CurrentUser) -> dict:
        if current_user.role == "super_admin":
            return {}
        return {"recruiter_id": current_user.id}

    async def _scoped_candidate_emails(self, current_user: CurrentUser) -> list[str]:
        scope = self._scope_filter(current_user)
        cursor = database.candidates.find(scope, {"email": 1})
        docs = await cursor.to_list(length=None)
        return [doc["email"] for doc in docs if doc.get("email")]


def _iso(value) -> str | None:
    if not value:
        return None
    if isinstance(value, str):
        return value
    return value.isoformat()


def _as_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value

import re
from datetime import UTC, date, datetime, timedelta

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException, status

from app.core.database import database
from app.core.rbac import CurrentUser
from app.schemas.dashboard import CreateAnnouncementRequest, MarkNotificationsReadRequest

UPCOMING_JOINING_WINDOW_DAYS = 30
RECENT_ACTIVITY_LIMIT_DEFAULT = 20
RECENT_ACTIVITY_LIMIT_MAX = 100
REQUIRED_ONBOARDING_FIELDS = ("personal", "education", "government_docs", "resume")
DECLINED_OFFER_STATUSES = {"declined", "expired", "withdrawn"}

# US-016: friendly labels for the subset of audit-log actions that make up
# the business-facing activity timeline (internal/security events are excluded).
ACTIVITY_LABELS: dict[str, str] = {
    "candidate_registered": "Candidate registered",
    "candidate_email_verified": "Candidate verified their email",
    "invitation_created": "Invitation sent to candidate",
    "onboarding_submitted": "Onboarding submitted",
    "candidate_converted_to_employee": "Candidate converted to employee",
    "recruiter_registered": "Recruiter account created",
    "recruiter_email_verified": "Recruiter verified their email",
    "super_admin_email_verified": "Super admin verified their email",
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
) -> None:
    """Shared helper — other services call this when a notify-worthy event happens (US-014)."""
    await database.notifications.insert_one(
        {
            "recipient_id": recipient_id,
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
    # US-020: Announcements
    # ------------------------------------------------------------------
    async def list_announcements(self, limit: int = 20) -> dict:
        limit = max(1, min(limit, 50))
        cursor = database.announcements.find({}).sort("created_at", -1).limit(limit)
        entries = await cursor.to_list(length=limit)
        return {
            "announcements": [
                {
                    "id": str(entry["_id"]),
                    "title": entry.get("title"),
                    "body": entry.get("body"),
                    "created_by_name": entry.get("created_by_name"),
                    "created_at": _iso(entry.get("created_at")),
                }
                for entry in entries
            ]
        }

    async def create_announcement(self, current_user: CurrentUser, request: CreateAnnouncementRequest) -> dict:
        now = datetime.now(UTC)
        document = {
            "title": request.title,
            "body": request.body,
            "created_by": current_user.id,
            "created_by_name": current_user.full_name,
            "created_at": now,
            "updated_at": now,
        }
        result = await database.announcements.insert_one(document)
        return {
            "message": "Announcement published.",
            "announcement": {
                "id": str(result.inserted_id),
                "title": document["title"],
                "body": document["body"],
                "created_by_name": document["created_by_name"],
                "created_at": _iso(now),
            },
        }

    # ------------------------------------------------------------------
    # Scoping helpers
    # ------------------------------------------------------------------
    def _scope_filter(self, current_user: CurrentUser) -> dict:
        """Recruiters only see their own candidates/employees; Super Admin sees everyone."""
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
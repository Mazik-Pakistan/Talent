"""US-023 / US-024: Convert candidate → employee and generate Employee IDs.
Also owns the post-hire 'complete your profile' flow (US-025..US-033 subset
that moved to the employee side of the offer-letter flow)."""

import logging
from datetime import UTC, datetime

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException, status

logger = logging.getLogger(__name__)

from app.core.config import settings
from app.core.crypto import decrypt_banking_payload, decrypt_text, encrypt_banking_payload, iban_fingerprint
from app.core.database import database, _db_kwargs, try_transaction
from app.core.rbac import CurrentUser
from app.core.security import hash_password
from app.schemas.auth import names_match
from app.services.candidate_service import CandidateService, onboarding_missing_keys
from app.services.dashboard_service import DashboardService, create_notification
from app.services.email_service import email_service
from app.services.organization_service import recruiter_scope
from app.services.people_history import (
    ACTIVE_EMPLOYEE_STATUSES,
    HISTORICAL_EMPLOYEE_STATUSES,
    archive_user_login,
    cycle_group_key,
    lookup_history_by_email,
    mark_employee_historical_fields,
)

EMPLOYEE_ID_PREFIX = "EMP"
EMPLOYEE_ID_COUNTER = "employee_id"

# Post-hire profile completion — the flow the user lands on right after
# their Employee ID is issued ("profile incomplete" banner on the dashboard).
PROFILE_TASK_DEFS = [
    {"id": "emergency", "label": "Add emergency contact", "step": "emergency"},
    {"id": "employment", "label": "Complete bank & payroll details", "step": "employment"},
    {"id": "references", "label": "Provide professional references", "step": "references"},
    {"id": "documents", "label": "Acknowledge company policies", "step": "documents"},
    {"id": "nda", "label": "Sign the Self Declaration", "step": "nda"},
]
PROFILE_REQUIRED_KEYS = ["emergency", "employment", "references", "documents", "nda"]
PROFILE_STEP_FLOW = {
    "emergency": "employment",
    "employment": "references",
    "references": "documents",
    "documents": "nda",
    "nda": "submit",
}


def _employee_is_remote(employee: dict | None) -> bool:
    return bool((employee or {}).get("is_remote"))


def _profile_task_defs_for(employee: dict | None) -> list[dict]:
    if _employee_is_remote(employee):
        return list(PROFILE_TASK_DEFS)
    return [task for task in PROFILE_TASK_DEFS if task["step"] != "employment"]


def _profile_required_keys_for(employee: dict | None) -> list[str]:
    if _employee_is_remote(employee):
        return list(PROFILE_REQUIRED_KEYS)
    return [key for key in PROFILE_REQUIRED_KEYS if key != "employment"]


class EmployeeService:
    async def generate_employee_id(self, year: int | None = None, *, allocate: bool = False) -> dict:
        """US-024: Unique Employee ID in format EMP-000001.

        By default returns a preview of the next ID without consuming the counter.
        Pass allocate=True to reserve the ID (used during conversion).
        `year` is accepted for API compatibility but ignored (IDs are global).
        """
        from pymongo import ReturnDocument

        _ = year  # legacy param — format is no longer year-scoped
        prefix = f"{EMPLOYEE_ID_PREFIX}-"
        counter_id = EMPLOYEE_ID_COUNTER

        if allocate:
            while True:
                counter = await database.counters.find_one_and_update(
                    {"_id": counter_id},
                    {"$inc": {"seq": 1}, "$set": {"updated_at": datetime.now(UTC)}},
                    upsert=True,
                    return_document=ReturnDocument.AFTER,
                )
                next_seq = int((counter or {}).get("seq") or 1)
                employee_id = f"{prefix}{next_seq:06d}"
                if not await database.employees.find_one({"employee_id": employee_id}):
                    break
        else:
            counter = await database.counters.find_one({"_id": counter_id})
            next_seq = int((counter or {}).get("seq") or 0) + 1
            employee_id = f"{prefix}{next_seq:06d}"

        return {
            "employee_id": employee_id,
            "sequence": next_seq,
            "allocated": allocate,
        }

    @staticmethod
    def _assert_org_or_owner(current_user: CurrentUser, record: dict, detail: str = "Not allowed.") -> None:
        if current_user.role == "super_admin":
            return
        record_org = record.get("organization_id")
        if record_org and current_user.organization_id:
            if record_org != current_user.organization_id:
                raise HTTPException(status_code=403, detail=detail)
        elif record.get("recruiter_id") != current_user.id:
            raise HTTPException(status_code=403, detail=detail)

    async def list_pending_review(self, current_user: CurrentUser) -> dict:
        """Candidates who signed and submitted docs — ready for IT (formerly pending offer)."""
        query: dict = {
            "onboarding.status": "submitted",
            "status": {"$ne": "converted"},
            "conversion_status": {"$in": ["intake_submitted", "offer_signed"]},
        }
        scope = recruiter_scope(current_user)
        if scope:
            query.update(scope)

        docs = await database.candidates.find(query).sort("onboarding.submitted_at", -1).to_list(length=100)
        pending = []
        for candidate in docs:
            candidate_id = candidate.get("user_id") or str(candidate["_id"])
            if candidate.get("conversion_status") in {"offer_declined", "declined", "converted"}:
                continue

            offer = await database.offer_letters.find_one(
                {
                    "$or": [
                        {"candidate_id": candidate_id},
                        {"candidate_email": candidate.get("email")},
                    ],
                    "status": "signed",
                },
                sort=[("version", -1), ("created_at", -1)],
            )
            if not offer:
                continue

            # Exclude those already in ready-for-conversion list (signed is enough; IT handled there)
            pending.append(
                {
                    "id": candidate_id,
                    "full_name": candidate.get("full_name"),
                    "email": candidate.get("email"),
                    "job_title": candidate.get("job_title"),
                    "department": candidate.get("department"),
                    "offer_id": str(offer["_id"]),
                    "offer_signed_at": (
                        offer.get("signed_at").isoformat()
                        if hasattr(offer.get("signed_at"), "isoformat")
                        else offer.get("signed_at")
                    ),
                    "submitted_at": (
                        candidate.get("onboarding", {}).get("submitted_at").isoformat()
                        if hasattr(candidate.get("onboarding", {}).get("submitted_at"), "isoformat")
                        else candidate.get("onboarding", {}).get("submitted_at")
                    ),
                    "stage": "ready_for_it",
                }
            )
        return {"candidates": pending, "count": len(pending)}

    async def list_onboarding_in_progress(self, current_user: CurrentUser) -> dict:
        """Candidates who signed the offer but have not finished documents yet."""
        query: dict = {
            "status": "active",
            "role": "candidate",
            "onboarding.status": {"$in": ["in_progress", "not_started", None]},
            "conversion_status": {"$in": ["offer_signed", "offer_sent"]},
        }
        scope = recruiter_scope(current_user)
        if scope:
            query.update(scope)

        docs = await database.candidates.find(query).sort("created_at", -1).to_list(length=100)
        in_progress = []
        candidate_service = CandidateService()
        for candidate in docs:
            if candidate.get("conversion_status") in {"converted", "offer_declined", "declined"}:
                continue

            candidate_id = candidate.get("user_id") or str(candidate["_id"])
            offer = await database.offer_letters.find_one(
                {
                    "$or": [
                        {"candidate_id": candidate_id},
                        {"candidate_email": candidate.get("email")},
                    ],
                    "status": {"$in": ["sent", "viewed", "signed"]},
                },
                sort=[("version", -1), ("created_at", -1)],
            )
            onboarding = candidate.get("onboarding") or {}
            progress = candidate_service._progress_payload(candidate)
            in_progress.append(
                {
                    "id": candidate_id,
                    "full_name": candidate.get("full_name"),
                    "email": candidate.get("email"),
                    "job_title": candidate.get("job_title"),
                    "department": candidate.get("department"),
                    "current_step": onboarding.get("current_step") or "personal",
                    "onboarding_status": onboarding.get("status") or "not_started",
                    "progress": progress,
                    "offer_status": (offer or {}).get("status"),
                    "offer_id": str(offer["_id"]) if offer else None,
                    "created_at": (
                        candidate.get("created_at").isoformat()
                        if hasattr(candidate.get("created_at"), "isoformat")
                        else candidate.get("created_at")
                    ),
                }
            )
        return {"candidates": in_progress, "count": len(in_progress)}

    async def list_candidates(
        self,
        current_user: CurrentUser,
        *,
        q: str | None = None,
        status: str | None = None,
        profile_status: str | None = None,
        progress_min: int | None = None,
        progress_max: int | None = None,
        joined_from: str | None = None,
        joined_to: str | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> dict:
        """Recruiter candidate directory, using the canonical onboarding progress payload."""
        query: dict = {
            "status": "active",
            "role": "candidate",
            "conversion_status": {"$ne": "converted"},
            "onboarding.status": {"$ne": "submitted"},
        }
        scope = recruiter_scope(current_user)
        if scope:
            query.update(scope)
        if q and q.strip():
            term = q.strip()
            query["$or"] = [
                {"full_name": {"$regex": term, "$options": "i"}},
                {"user_id": {"$regex": term, "$options": "i"}},
                {"email": {"$regex": term, "$options": "i"}},
                {"job_title": {"$regex": term, "$options": "i"}},
            ]
        if joined_from or joined_to:
            created_filter: dict = {}
            try:
                if joined_from:
                    created_filter["$gte"] = datetime.fromisoformat(f"{joined_from}T00:00:00+00:00")
                if joined_to:
                    created_filter["$lt"] = datetime.fromisoformat(f"{joined_to}T00:00:00+00:00").replace(hour=23, minute=59, second=59, microsecond=999999)
            except ValueError:
                raise HTTPException(status_code=400, detail="Joined dates must use YYYY-MM-DD.")
            if created_filter:
                query["created_at"] = created_filter

        page = max(1, page)
        page_size = max(1, min(page_size, 100))
        docs = await database.candidates.find(query).sort("created_at", -1).to_list(length=2000)
        candidates = []
        for candidate in docs:
            progress = CandidateService()._progress_payload(candidate)
            if progress["status"] == "submitted" or candidate.get("conversion_status") == "converted":
                continue
            completion_status = "complete" if progress["percentage"] == 100 else "incomplete"
            if profile_status and completion_status != profile_status.strip().lower():
                continue
            if progress_min is not None and progress["percentage"] < progress_min:
                continue
            if progress_max is not None and progress["percentage"] > progress_max:
                continue
            candidates.append(self._public_candidate(candidate, progress))

        total = len(candidates)
        start = (page - 1) * page_size
        return {
            "candidates": candidates[start : start + page_size],
            "count": len(candidates[start : start + page_size]),
            "total": total,
            "page": page,
            "page_size": page_size,
            "pages": max(1, (total + page_size - 1) // page_size),
        }

    async def remind_candidate_onboarding(
        self, current_user: CurrentUser, candidate_id: str, note: str | None = None, *, force: bool = False
    ) -> dict:
        candidate = await self._find_candidate(candidate_id)
        if not candidate:
            raise HTTPException(status_code=404, detail="Candidate not found.")
        self._assert_org_or_owner(current_user, candidate)

        progress = CandidateService()._progress_payload(candidate)
        if progress["status"] == "submitted" or candidate.get("conversion_status") == "converted" or candidate.get("status") == "converted":
            raise HTTPException(status_code=400, detail="This candidate has already completed onboarding.")
        now = datetime.now(UTC)
        last_sent = candidate.get("onboarding_reminder_sent_at")
        if last_sent and not force:
            last_dt = last_sent if isinstance(last_sent, datetime) else None
            if last_dt and last_dt.tzinfo is None:
                last_dt = last_dt.replace(tzinfo=UTC)
            if last_dt and (now - last_dt).total_seconds() < 3600:
                raise HTTPException(status_code=429, detail="A reminder was already sent within the last hour.")

        labels = {
            "personal": "Personal information and ID document",
            "education": "Education history",
            "skills": "Skills and certifications",
            "government_docs": "Government ID document",
            "resume": "Resume / CV",
        }
        missing_labels = [labels.get(key, key.replace("_", " ").title()) for key in progress["missing_fields"]]
        note_text = (note or "").strip() or None
        recipient_id = candidate.get("user_id")
        if not recipient_id:
            user = await database.users.find_one({"email": (candidate.get("email") or "").lower()})
            recipient_id = str(user["_id"]) if user else None
        reminder = await DashboardService().upsert_candidate_onboarding_reminder(current_user, candidate, progress, note_text)
        notification_sent = bool(reminder["notified"]) or reminder["updated"]
        email_sent = False
        email_error = None
        try:
            email_service.send_candidate_onboarding_reminder(
                candidate.get("email"), candidate.get("full_name") or "there", missing_labels,
                f"{settings.frontend_base_url}/onboarding", note_text,
                organization_id=candidate.get("organization_id"),
            )
            email_sent = True
        except Exception as exc:  # noqa: BLE001
            email_error = str(exc)
        await database.candidates.update_one(
            {"_id": candidate["_id"]},
            {"$set": {"onboarding_reminder_sent_at": now, "onboarding_reminder_sent_by": current_user.id, "updated_at": now}},
        )
        await database.audit_logs.insert_one({
            "user_id": current_user.id, "recruiter_id": current_user.id,
            "candidate_id": candidate.get("user_id") or str(candidate["_id"]), "email": candidate.get("email"),
            "actor_email": current_user.email, "module": "onboarding", "action": "candidate_onboarding_reminder",
            "outcome": "success" if email_sent and notification_sent else "partial", "created_at": now,
        })
        refreshed = await database.candidates.find_one({"_id": candidate["_id"]})
        if not email_sent or not notification_sent:
            failures = []
            if not email_sent:
                failures.append(f"email failed ({email_error})" if email_error else "email failed")
            if not notification_sent:
                failures.append("dashboard notification failed")
            raise HTTPException(status_code=502, detail=f"Reminder saved, but {' and '.join(failures)}.")
        return {
            "message": "Reminder has been sent via email and dashboard.",
            "email_sent": email_sent, "notification_sent": notification_sent, "email_error": email_error,
            "announcement": reminder["announcement"],
            "candidate": self._public_candidate(refreshed or candidate, CandidateService()._progress_payload(refreshed or candidate)),
        }

    async def list_ready_for_conversion(self, current_user: CurrentUser) -> dict:
        """Candidates whose offer has been signed and is awaiting HR approval/activation."""
        from app.services.it_provisioning_service import it_provisioning_service

        query: dict = {"status": {"$in": ["signed", "expired"]}}
        scope = recruiter_scope(current_user)
        if scope:
            query.update(scope)

        offers = await database.offer_letters.find(query).sort("signed_at", -1).to_list(length=100)
        ready = []
        now = datetime.now(UTC)
        for offer in offers:
            candidate = await self._find_candidate(offer["candidate_id"])
            if not candidate or candidate.get("status") == "converted":
                continue
            onboarding = candidate.get("onboarding") or {}
            if onboarding.get("status") != "submitted":
                continue
            it_status = await it_provisioning_service.get_for_offer(str(offer["_id"]))
            expires_at = offer.get("expires_at")
            if expires_at and expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=UTC)
            status = (offer.get("status") or "").lower()
            is_signed = status == "signed" or bool(offer.get("signed_at"))
            # Calendar validity matters only for unsigned offers. Signed = accepted.
            past_validity = bool(expires_at and expires_at < now)
            docs_complete = True
            ready.append(
                {
                    "id": candidate.get("user_id") or str(candidate["_id"]),
                    "offer_id": str(offer["_id"]),
                    "full_name": candidate.get("full_name"),
                    "email": candidate.get("email"),
                    "job_title": offer.get("job_title") or candidate.get("job_title"),
                    "department": offer.get("department") or candidate.get("department"),
                    "office_location": offer.get("office_location") or candidate.get("office_location"),
                    "start_date": offer.get("start_date") or candidate.get("start_date"),
                    "expires_at": expires_at.isoformat() if hasattr(expires_at, "isoformat") else expires_at,
                    "is_expired": past_validity and not is_signed,
                    "signed_at": offer.get("signed_at").isoformat() if hasattr(offer.get("signed_at"), "isoformat") else offer.get("signed_at"),
                    "monthly_salary": offer.get("monthly_salary"),
                    "reporting_manager": offer.get("reporting_manager"),
                    "docs_complete": docs_complete,
                    "it_provisioning": it_status,
                    "can_activate": bool(it_status and it_status.get("is_complete")),
                }
            )
        return {"candidates": ready, "count": len(ready)}

    async def _apply_first_time_password(self, it_doc: dict, user_id: str | None, now: datetime, session=None) -> str | None:
        """Apply the IT-set first-time password to the single account at activation.

        Returns the plaintext temporary password (for emailing it to the
        employee) or None when there is nothing to apply. The employee uses it
        once; `must_change_password` forces them to set their own password on
        first sign-in (that new password then covers both login emails).
        """
        kwargs = _db_kwargs(session)
        temp_password = None
        if it_doc.get("temporary_password_encrypted") and user_id:
            try:
                temp_password = decrypt_text(it_doc["temporary_password_encrypted"])
            except Exception:
                temp_password = None
        if temp_password and user_id:
            await database.users.update_one(
                {"_id": ObjectId(user_id) if ObjectId.is_valid(user_id) else user_id},
                {
                    "$set": {
                        "password_hash": hash_password(temp_password),
                        "must_change_password": True,
                        "temporary_password_set_at": now,
                        "updated_at": now,
                    }
                },
                **kwargs
            )
        return temp_password

    async def create_from_candidate(self, current_user: CurrentUser, candidate_id: str, *, allow_unsigned: bool = False) -> dict:
        """US-023: Convert a fully onboarded candidate into an employee (once)."""
        candidate = await self._find_candidate(candidate_id)
        if not candidate:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found.")

        self._assert_org_or_owner(
            current_user, candidate, detail="You can only convert candidates assigned to you."
        )

        if candidate.get("status") == "converted" or candidate.get("conversion_status") == "converted":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This candidate has already been converted to an employee.",
            )

        existing_employee = await database.employees.find_one(
            {
                "status": {"$in": list(ACTIVE_EMPLOYEE_STATUSES)},
                "$or": [
                    {"user_id": candidate.get("user_id")},
                    {"email": candidate.get("email")},
                    {"candidate_id": candidate.get("user_id") or str(candidate["_id"])},
                ],
            }
        )
        if existing_employee:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An active employee record already exists for this candidate.",
            )

        email_key = cycle_group_key(candidate.get("email"))
        prior_employee = await database.employees.find_one(
            {
                "email": email_key,
                "$or": [
                    {"history_bucket": "historical"},
                    {"status": {"$in": list(HISTORICAL_EMPLOYEE_STATUSES)}},
                ],
            },
            sort=[("created_at", -1)],
        )

        onboarding = candidate.get("onboarding") or {}
        missing = onboarding_missing_keys(onboarding)
        if onboarding.get("status") != "submitted" or missing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Candidate's pre-offer profile is incomplete. Missing: "
                    + (", ".join(missing) if missing else "final submission")
                    + "."
                ),
            )

        offer_query = {"candidate_id": candidate.get("user_id") or str(candidate["_id"])}
        if not allow_unsigned:
            offer_query["status"] = "signed"
        else:
            offer_query["status"] = {"$in": ["signed", "expired"]}
            offer_query["signed_at"] = {"$ne": None}

        offer = await database.offer_letters.find_one(offer_query, sort=[("version", -1), ("created_at", -1)])

        if not offer:
            detail = "This candidate does not have a signed offer letter yet. Send and get the offer signed before activation."
            if allow_unsigned:
                detail = "No signed offer letter found for this candidate to force-approve."
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)

        from app.services.it_provisioning_service import it_provisioning_service

        it_doc = await it_provisioning_service.require_submitted_for_candidate(
            candidate.get("user_id") or str(candidate["_id"]),
            offer_id=str(offer["_id"]),
        )

        id_payload = await self.generate_employee_id(allocate=True)
        employee_id = id_payload["employee_id"]
        now = datetime.now(UTC)
        user_id = candidate.get("user_id")

        it_assets = list(it_doc.get("assets") or [])
        it_licenses = list(it_doc.get("licenses") or [])
        company_email = (it_doc.get("company_email") or "").strip().lower() or None

        employee_doc = {
            "user_id": user_id,
            "employee_id": employee_id,
            "full_name": candidate["full_name"],
            "email": candidate["email"],
            "phone": candidate.get("phone"),
            "role": "employee",
            "status": "active",
            "history_bucket": "active",
            "cycle_group_key": email_key,
            "previous_employee_id": (prior_employee or {}).get("employee_id"),
            "job_title": offer.get("job_title") or candidate.get("job_title"),
            "department": offer.get("department") or candidate.get("department"),
            "employment_type": offer.get("employment_type"),
            "office_location": offer.get("office_location") or candidate.get("office_location"),
            "is_remote": bool(offer.get("is_remote") if "is_remote" in offer else candidate.get("is_remote")),
            "start_date": offer.get("start_date") or candidate.get("start_date"),
            "reporting_manager": offer.get("reporting_manager"),
            "monthly_salary": offer.get("monthly_salary"),
            "currency": offer.get("currency"),
            "recruiter_id": candidate.get("recruiter_id"),
            "recruiter_email": candidate.get("recruiter_email"),
            "organization_id": candidate.get("organization_id"),
            "candidate_id": user_id or str(candidate["_id"]),
            "invitation_token": candidate.get("invitation_token"),
            "offer_id": str(offer["_id"]),
            "company_email": company_email,
            "company_email_assigned_at": it_doc.get("submitted_at") or now,
            "company_email_assigned_by": "it",
            "has_company_email_password": bool(it_doc.get("company_email_password_encrypted")),
            "assets": it_assets,
            "licenses": it_licenses,
            "it_provisioning_id": str(it_doc.get("_id")),
            "it_notes": it_doc.get("it_notes"),
            "onboarding": onboarding,
            "profile_status": "incomplete",
            "profile_completed_at": None,
            "converted_at": now,
            "converted_by": current_user.id,
            "converted_by_email": current_user.email,
            "created_at": now,
            "updated_at": now,
        }

        temp_password_container = [None]

        async def _persist(session):
            kwargs = _db_kwargs(session)
            await database.employees.insert_one(employee_doc, **kwargs)
            temp_password_container[0] = await self._apply_first_time_password(it_doc, user_id, now, session=session)
            await database.offer_letters.update_one(
                {"_id": offer["_id"]},
                {"$set": {"status": "approved", "approved_at": now, "approved_by": current_user.id}},
                **kwargs
            )
            await database.candidates.update_one(
                {"_id": candidate["_id"]},
                {
                    "$set": {
                        "status": "converted",
                        "conversion_status": "converted",
                        "lifecycle_state": "converted",
                        "history_bucket": "converted",
                        "converted_at": now,
                        "employee_id": employee_id,
                        "cycle_group_key": email_key,
                        "updated_at": now,
                    }
                },
                **kwargs
            )
            if user_id:
                await database.users.update_one(
                    {"_id": ObjectId(user_id) if ObjectId.is_valid(user_id) else user_id},
                    {"$set": {"role": "employee", "updated_at": now}},
                    **kwargs
                )
            else:
                await database.users.update_one(
                    {"email": candidate["email"]},
                    {"$set": {"role": "employee", "updated_at": now}},
                    **kwargs
                )
            await database.audit_logs.insert_one(
                {
                    "user_id": current_user.id,
                    "recruiter_id": current_user.id,
                    "candidate_id": user_id or str(candidate["_id"]),
                    "employee_id": employee_id,
                    "email": candidate["email"],
                    "actor_email": current_user.email,
                    "role": current_user.role,
                    "module": "employees",
                    "action": "candidate_converted_to_employee",
                    "outcome": "success",
                    "created_at": now,
                },
                **kwargs
            )
            await database.employee_career_events.insert_one(
                {
                    "employee_id": employee_id,
                    "employee_user_id": user_id,
                    "event_type": "joined",
                    "effective_date": employee_doc.get("start_date") or now.date().isoformat(),
                    "to_title": employee_doc.get("job_title"),
                    "to_department": employee_doc.get("department"),
                    "to_manager": employee_doc.get("reporting_manager"),
                    "to_status": "active",
                    "note": "Employee record created from signed offer.",
                    "actor_id": current_user.id,
                    "actor_email": current_user.email,
                    "created_at": now,
                },
                **kwargs
            )
            await database.it_provisioning_requests.update_one(
                {"_id": it_doc["_id"]},
                {
                    "$set": {
                        "status": "applied",
                        "applied_employee_id": employee_id,
                        "applied_at": now,
                        "updated_at": now,
                    }
                },
                **kwargs
            )

        await try_transaction(_persist)
        temp_password = temp_password_container[0]

        if company_email:
            # Notify the new employee that their company email is live and
            # that the first-time password is ready.
            try:
                await self._notify_employee(
                    employee_doc,
                    notif_type="company_email_assigned",
                    title="Company email assigned",
                    message=(
                        f"Your company email is {company_email}. Sign in with your personal "
                        "or company email using the first-time password sent to you — "
                        "you'll create your own password on first sign-in."
                    ),
                    link="/dashboard/employee/profile",
                )
            except Exception as exc:
                logger.warning("Company email notification failed: %s", exc, exc_info=True)
            try:
                email_service.send_to_both(
                    employee_doc.get("email"),
                    company_email,
                    email_service.send_company_email_assigned,
                    employee_doc.get("full_name") or "Team member",
                    company_email,
                    organization_id=employee_doc.get("organization_id"),
                )
            except Exception as exc:
                logger.warning("Company email send failed: %s", exc, exc_info=True)
            if temp_password:
                try:
                    email_service.send_to_both(
                        employee_doc.get("email"),
                        company_email,
                        email_service.send_first_time_password,
                        employee_doc.get("full_name") or "Team member",
                        temp_password,
                        organization_id=employee_doc.get("organization_id"),
                    )
                except Exception as exc:
                    logger.warning("First-time password email send failed: %s", exc, exc_info=True)

        await it_provisioning_service.mark_applied(it_doc["_id"], employee_id)

        email_sent = False
        try:
            email_service.send_employee_welcome(
                to_email=candidate["email"],
                full_name=candidate["full_name"],
                employee_id=employee_id,
                job_title=employee_doc.get("job_title") or "Team Member",
                department=employee_doc.get("department") or "—",
                organization_id=candidate.get("organization_id"),
            )
            email_sent = True
        except Exception as exc:
            logger.warning("Employee welcome email failed: %s", exc, exc_info=True)
            email_sent = False

        await create_notification(
            recipient_id=current_user.id,
            recipient_role=current_user.role if current_user.role in ("recruiter", "super_admin") else "recruiter",
            notif_type="employee_created",
            title="Candidate converted",
            message=f"{candidate['full_name']} is now employee {employee_id}.",
            link="/dashboard/recruiter#employees-section",
            related_id=employee_id,
        )

        # On-site hires: recruiter must add banking; nudge immediately after activation.
        if not employee_doc.get("is_remote"):
            banking_recipient = employee_doc.get("recruiter_id") or current_user.id
            await create_notification(
                recipient_id=banking_recipient,
                recipient_role="recruiter",
                notif_type="banking_required",
                title="Banking details needed",
                message=(
                    f"Add payroll banking details for {candidate['full_name']} "
                    f"({employee_id}) — on-site employees cannot enter this themselves."
                ),
                link=f"/dashboard/recruiter/employees/{employee_id}",
                related_id=employee_id,
            )

        return {
            "message": "Candidate converted to employee successfully.",
            "email_sent": email_sent,
            "employee": self._public_employee(employee_doc),
            "redirect_hint": "Ask the new hire to sign in with the Employee role.",
        }

    def _directory_query(
        self,
        current_user: CurrentUser,
        *,
        q: str | None = None,
        employee_id: str | None = None,
        department: str | None = None,
        job_title: str | None = None,
        status: str | None = None,
        profile_status: str | None = None,
        joining_from: str | None = None,
        joining_to: str | None = None,
        history_bucket: str | None = None,
    ) -> dict:
        query: dict = {}
        scope = recruiter_scope(current_user)
        if scope:
            query.update(scope)
        bucket = (history_bucket or "").strip().lower()
        if bucket == "historical":
            query["$or"] = [
                {"history_bucket": "historical"},
                {"status": {"$in": list(HISTORICAL_EMPLOYEE_STATUSES)}},
            ]
            if status:
                query["status"] = status
        elif bucket == "all":
            if status:
                query["status"] = status
        elif status:
            query["status"] = status
        else:
            query["status"] = {"$in": list(ACTIVE_EMPLOYEE_STATUSES)}
        if profile_status:
            query["profile_status"] = profile_status.strip().lower()
        if employee_id:
            query["employee_id"] = {"$regex": employee_id.strip(), "$options": "i"}
        if department:
            query["department"] = {"$regex": department.strip(), "$options": "i"}
        if job_title:
            query["job_title"] = {"$regex": job_title.strip(), "$options": "i"}
        if joining_from or joining_to:
            date_filter: dict = {}
            if joining_from:
                date_filter["$gte"] = joining_from
            if joining_to:
                date_filter["$lte"] = joining_to
            query["start_date"] = date_filter
        if q and q.strip():
            term = q.strip()
            text_or = [
                {"full_name": {"$regex": term, "$options": "i"}},
                {"email": {"$regex": term, "$options": "i"}},
                {"employee_id": {"$regex": term, "$options": "i"}},
                {"department": {"$regex": term, "$options": "i"}},
                {"job_title": {"$regex": term, "$options": "i"}},
            ]
            # When historical query already uses $or for status, combine with $and.
            if "$or" in query and bucket == "historical":
                status_or = query.pop("$or")
                and_clauses = [{"$or": status_or}, {"$or": text_or}]
                if status:
                    and_clauses.append({"status": query.pop("status")})
                query["$and"] = and_clauses
            else:
                query["$or"] = text_or
        return query

    async def _active_employee_emails(self, current_user: CurrentUser) -> set[str]:
        """Emails that currently have an active/inactive/on_leave employee tenure."""
        scope: dict = {
            "status": {"$in": list(ACTIVE_EMPLOYEE_STATUSES)},
            "$or": [
                {"history_bucket": {"$exists": False}},
                {"history_bucket": "active"},
            ],
        }
        if current_user.role != "super_admin":
            scope["recruiter_id"] = current_user.id
        emails = await database.employees.distinct("email", scope)
        return {cycle_group_key(e) for e in emails if e}

    async def list_employees(
        self,
        current_user: CurrentUser,
        *,
        q: str | None = None,
        employee_id: str | None = None,
        department: str | None = None,
        job_title: str | None = None,
        status: str | None = None,
        profile_status: str | None = None,
        joining_from: str | None = None,
        joining_to: str | None = None,
        history_bucket: str | None = None,
        sort: str = "created_at",
        page: int = 1,
        page_size: int = 20,
    ) -> dict:
        page = max(1, page)
        page_size = max(1, min(page_size, 100))
        query = self._directory_query(
            current_user,
            q=q,
            employee_id=employee_id,
            department=department,
            job_title=job_title,
            status=status,
            profile_status=profile_status,
            joining_from=joining_from,
            joining_to=joining_to,
            history_bucket=history_bucket,
        )
        # Rehired people stay on Active only — prior exited tenures belong in career timeline.
        if (history_bucket or "").strip().lower() == "historical":
            active_emails = await self._active_employee_emails(current_user)
            if active_emails:
                email_clause = {"email": {"$nin": sorted(active_emails)}}
                if "$and" in query:
                    query["$and"].append(email_clause)
                else:
                    query = {"$and": [query, email_clause]} if query else email_clause
        sort_field = sort.lstrip("-") if sort else "created_at"
        if sort_field not in {"created_at", "full_name", "employee_id", "department", "job_title", "start_date"}:
            sort_field = "created_at"
        sort_dir = -1 if (sort or "").startswith("-") or sort_field == "created_at" else 1
        if sort == "full_name" or sort == "employee_id":
            sort_dir = 1
        if sort and sort.startswith("-"):
            sort_dir = -1
        elif sort in {"full_name", "employee_id", "department", "job_title", "start_date"}:
            sort_dir = 1

        total = await database.employees.count_documents(query)
        skip = (page - 1) * page_size
        docs = (
            await database.employees.find(query)
            .sort(sort_field, sort_dir)
            .skip(skip)
            .limit(page_size)
            .to_list(length=page_size)
        )
        return {
            "employees": [self._public_employee(doc) for doc in docs],
            "count": len(docs),
            "total": total,
            "page": page,
            "page_size": page_size,
            "pages": max(1, (total + page_size - 1) // page_size),
        }

    async def export_employees_csv(self, current_user: CurrentUser, **filters) -> str:
        filters.pop("page", None)
        filters.pop("page_size", None)
        result = await self.list_employees(current_user, page=1, page_size=5000, **filters)
        import csv
        import io

        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(
            [
                "employee_id",
                "full_name",
                "email",
                "phone",
                "job_title",
                "department",
                "office_location",
                "reporting_manager",
                "start_date",
                "status",
                "profile_status",
            ]
        )
        for emp in result["employees"]:
            writer.writerow(
                [
                    emp.get("employee_id") or "",
                    emp.get("full_name") or "",
                    emp.get("email") or "",
                    emp.get("phone") or "",
                    emp.get("job_title") or "",
                    emp.get("department") or "",
                    emp.get("office_location") or "",
                    emp.get("reporting_manager") or "",
                    emp.get("start_date") or "",
                    emp.get("status") or "",
                    emp.get("profile_status") or "",
                ]
            )
        return buffer.getvalue()

    async def get_employee_profile(self, current_user: CurrentUser, employee_id: str, *, reveal_banking: bool = False) -> dict:
        key = (employee_id or "").strip()
        if not key:
            raise HTTPException(status_code=404, detail="Employee not found.")

        query_or: list[dict] = [
            {"employee_id": key},
            {"legacy_employee_id": key},
            {"user_id": key},
            {"email": key.lower()},
            {"candidate_id": key},
        ]
        if ObjectId.is_valid(key):
            query_or.append({"_id": ObjectId(key)})

        employee = await database.employees.find_one({"$or": query_or})
        if not employee:
            raise HTTPException(status_code=404, detail="Employee not found.")
        if current_user.role != "super_admin":
            owner = str(employee.get("recruiter_id") or "")
            if owner and owner != str(current_user.id):
                raise HTTPException(status_code=403, detail="Not allowed.")
        # Recruiters manage on-site banking, so reveal full values for those employees.
        # Remote employee banking stays masked on the recruiter view.
        should_reveal = reveal_banking or not _employee_is_remote(employee)
        payload = self._public_employee(employee, include_onboarding=True)
        onboarding = dict(payload.get("onboarding") or {})
        banking = onboarding.get("employment")
        onboarding["employment"] = decrypt_banking_payload(banking, mask=not should_reveal)
        payload["onboarding"] = onboarding
        progress = self._profile_progress(employee)
        payload["profile_progress"] = progress
        payload["offers"] = await self._list_related_offers(
            candidate_id=employee.get("candidate_id"),
            candidate_email=employee.get("email"),
            offer_id=employee.get("offer_id"),
        )
        payload["current_offer"] = payload["offers"][0] if payload["offers"] else None
        if employee.get("profile_reminder_sent_at"):
            sent_at = employee["profile_reminder_sent_at"]
            payload["profile_reminder_sent_at"] = (
                sent_at.isoformat() if hasattr(sent_at, "isoformat") else sent_at
            )
        career = await self.list_career_events(employee.get("employee_id") or key)
        payload["career"] = career["events"]
        payload["career_timeline"] = await self.build_career_timeline(
            employee.get("email") or "",
            primary_employee_id=employee.get("employee_id"),
        )
        payload["person_history"] = await lookup_history_by_email(
            employee.get("email") or "",
            recruiter_id=None if current_user.role == "super_admin" else current_user.id,
            is_super_admin=current_user.role == "super_admin",
        )
        return {"employee": payload}

    async def build_career_timeline(
        self,
        email: str,
        *,
        primary_employee_id: str | None = None,
    ) -> list[dict]:
        """Unified timeline across all tenures for an email (hire, promo, resign, rehire)."""
        email = cycle_group_key(email)
        if not email:
            return []

        tenures = (
            await database.employees.find({"email": email})
            .sort([("created_at", 1), ("_id", 1)])
            .to_list(length=100)
        )
        employee_ids = [t.get("employee_id") for t in tenures if t.get("employee_id")]

        timeline: list[dict] = []
        career_docs = []
        if employee_ids:
            career_docs = await database.employee_career_events.find(
                {"employee_id": {"$in": employee_ids}}
            ).to_list(length=500)

        for doc in career_docs:
            timeline.append(
                {
                    "id": str(doc["_id"]),
                    "employee_id": doc.get("employee_id"),
                    "event_type": doc.get("event_type"),
                    "effective_date": doc.get("effective_date"),
                    "from_title": doc.get("from_title"),
                    "to_title": doc.get("to_title"),
                    "from_department": doc.get("from_department"),
                    "to_department": doc.get("to_department"),
                    "from_manager": doc.get("from_manager"),
                    "to_manager": doc.get("to_manager"),
                    "from_status": doc.get("from_status"),
                    "to_status": doc.get("to_status"),
                    "note": doc.get("note"),
                    "actor_email": doc.get("actor_email"),
                    "source": "career_event",
                    "created_at": doc.get("created_at").isoformat()
                    if hasattr(doc.get("created_at"), "isoformat")
                    else doc.get("created_at"),
                }
            )

        # Tenure markers so prior resigned cycles appear on the active profile timeline.
        seen_exits = {
            (e.get("employee_id"), str(e.get("to_status") or e.get("event_type") or "").lower(), str(e.get("effective_date") or "")[:10])
            for e in timeline
        }
        for tenure in tenures:
            eid = tenure.get("employee_id")
            start_raw = tenure.get("start_date") or tenure.get("converted_at") or tenure.get("created_at")
            start_date = start_raw.isoformat() if hasattr(start_raw, "isoformat") else start_raw
            if isinstance(start_date, str) and "T" in start_date:
                start_date = start_date[:10]
            timeline.append(
                {
                    "id": f"tenure-hired-{eid}",
                    "employee_id": eid,
                    "event_type": "hired",
                    "effective_date": start_date,
                    "to_title": tenure.get("job_title"),
                    "to_department": tenure.get("department"),
                    "to_manager": tenure.get("reporting_manager"),
                    "note": f"Employee ID {eid} issued"
                    + (
                        f" (current)"
                        if eid and primary_employee_id and eid == primary_employee_id
                        else " (prior tenure)"
                        if eid and primary_employee_id and eid != primary_employee_id
                        else ""
                    ),
                    "source": "tenure",
                    "history_bucket": tenure.get("history_bucket")
                    or ("historical" if tenure.get("status") in HISTORICAL_EMPLOYEE_STATUSES else "active"),
                }
            )
            exit_type = (tenure.get("exit_type") or tenure.get("status") or "").lower()
            if exit_type in HISTORICAL_EMPLOYEE_STATUSES or tenure.get("history_bucket") == "historical":
                exit_date = tenure.get("exit_date") or tenure.get("historical_at")
                exit_date = exit_date.isoformat() if hasattr(exit_date, "isoformat") else exit_date
                if isinstance(exit_date, str) and "T" in exit_date:
                    exit_date = exit_date[:10]
                key = (eid, exit_type, str(exit_date or "")[:10])
                if key not in seen_exits:
                    timeline.append(
                        {
                            "id": f"tenure-exit-{eid}",
                            "employee_id": eid,
                            "event_type": exit_type or "exited",
                            "effective_date": exit_date,
                            "from_status": "active",
                            "to_status": exit_type,
                            "to_title": tenure.get("job_title"),
                            "to_department": tenure.get("department"),
                            "note": tenure.get("exit_reason") or f"Tenure ended ({exit_type}).",
                            "source": "tenure_exit",
                            "history_bucket": "historical",
                        }
                    )

        def _sort_key(item: dict):
            raw = str(item.get("effective_date") or item.get("created_at") or "")
            return raw

        timeline.sort(key=_sort_key, reverse=True)
        return timeline

    async def list_career_events(self, employee_id: str) -> dict:
        docs = (
            await database.employee_career_events.find({"employee_id": employee_id})
            .sort("effective_date", -1)
            .to_list(length=200)
        )
        events = []
        for doc in docs:
            events.append(
                {
                    "id": str(doc["_id"]),
                    "employee_id": doc.get("employee_id"),
                    "event_type": doc.get("event_type"),
                    "effective_date": doc.get("effective_date"),
                    "from_title": doc.get("from_title"),
                    "to_title": doc.get("to_title"),
                    "from_department": doc.get("from_department"),
                    "to_department": doc.get("to_department"),
                    "from_manager": doc.get("from_manager"),
                    "to_manager": doc.get("to_manager"),
                    "from_status": doc.get("from_status"),
                    "to_status": doc.get("to_status"),
                    "note": doc.get("note"),
                    "actor_email": doc.get("actor_email"),
                    "created_at": doc.get("created_at").isoformat()
                    if hasattr(doc.get("created_at"), "isoformat")
                    else doc.get("created_at"),
                }
            )
        return {"events": events}

    async def add_career_event(self, current_user: CurrentUser, employee_id: str, request) -> dict:
        employee = await database.employees.find_one({"employee_id": employee_id})
        if not employee:
            raise HTTPException(status_code=404, detail="Employee not found.")
        self._assert_org_or_owner(current_user, employee)

        now = datetime.now(UTC)
        data = request.model_dump(mode="json")
        event_doc = {
            "employee_id": employee_id,
            "employee_user_id": employee.get("user_id"),
            **data,
            "actor_id": current_user.id,
            "actor_email": current_user.email,
            "created_at": now,
        }
        result = await database.employee_career_events.insert_one(event_doc)
        event_doc["_id"] = result.inserted_id

        # Mirror key changes onto the employee record
        emp_updates: dict = {"updated_at": now}
        if data.get("to_title"):
            emp_updates["job_title"] = data["to_title"]
        if data.get("to_department"):
            emp_updates["department"] = data["to_department"]
        if data.get("to_manager"):
            emp_updates["reporting_manager"] = data["to_manager"]
        if data.get("to_status"):
            emp_updates["status"] = data["to_status"]
        if len(emp_updates) > 1:
            await database.employees.update_one({"_id": employee["_id"]}, {"$set": emp_updates})

        await database.audit_logs.insert_one(
            {
                "user_id": current_user.id,
                "recruiter_id": current_user.id,
                "employee_id": employee_id,
                "email": employee.get("email"),
                "actor_email": current_user.email,
                "module": "employees",
                "action": f"career_{data['event_type']}",
                "outcome": "success",
                "created_at": now,
            }
        )
        # Role changes invalidate AI learning caches for this employee.
        if employee.get("user_id") and (data.get("to_title") or data.get("to_department")):
            from app.services.learning_service import learning_service

            await learning_service._invalidate_ai_caches(employee["user_id"])
        return await self.list_career_events(employee_id)

    async def mark_employee_exit(self, current_user: CurrentUser, employee_id: str, request) -> dict:
        """Move an employee into historical status: resigned, terminated, or exited."""
        employee = await self._resolve_employee_for_recruiter(current_user, employee_id)
        current_status = (employee.get("status") or "active").lower()
        if current_status in HISTORICAL_EMPLOYEE_STATUSES or employee.get("history_bucket") == "historical":
            raise HTTPException(status_code=409, detail="This employee is already marked historical.")

        exit_type = request.exit_type
        now = datetime.now(UTC)
        exit_date = request.exit_date.isoformat() if getattr(request, "exit_date", None) else now.date().isoformat()
        fields = mark_employee_historical_fields(
            exit_type=exit_type,
            exit_reason=request.exit_reason or request.note,
            exit_date=exit_date,
            when=now,
        )
        if request.lock_profile:
            fields["profile_locked"] = True
        fields["cycle_group_key"] = employee.get("cycle_group_key") or cycle_group_key(employee.get("email"))

        await database.employees.update_one({"_id": employee["_id"]}, {"$set": fields})

        await database.employee_career_events.insert_one(
            {
                "employee_id": employee.get("employee_id"),
                "employee_user_id": employee.get("user_id"),
                "event_type": exit_type,
                "effective_date": exit_date,
                "from_status": current_status,
                "to_status": exit_type,
                "note": request.note or request.exit_reason or f"Employee marked as {exit_type}.",
                "actor_id": current_user.id,
                "actor_email": current_user.email,
                "created_at": now,
            }
        )

        await archive_user_login(employee.get("email") or "", reason=f"employee_{exit_type}")

        await database.audit_logs.insert_one(
            {
                "user_id": current_user.id,
                "recruiter_id": current_user.id,
                "employee_id": employee.get("employee_id"),
                "email": employee.get("email"),
                "actor_email": current_user.email,
                "module": "employees",
                "action": f"employee_{exit_type}",
                "outcome": "success",
                "created_at": now,
            }
        )

        refreshed = await database.employees.find_one({"_id": employee["_id"]})
        return {
            "message": f"Employee marked as {exit_type}.",
            "employee": self._public_employee(refreshed or {**employee, **fields}),
        }

    async def list_historical_candidates(
        self,
        current_user: CurrentUser,
        *,
        q: str | None = None,
        reason: str | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> dict:
        page = max(1, page)
        page_size = max(1, min(page_size, 100))
        query: dict = {
            "$and": [
                {
                    "$or": [
                        {"history_bucket": "historical"},
                        {"status": {"$in": ["historical", "declined", "offer_declined"]}},
                        {"conversion_status": {"$in": ["offer_declined", "declined"]}},
                    ]
                },
                # Converted people are employees (active or former), not historical candidates.
                {"status": {"$ne": "converted"}},
                {"conversion_status": {"$ne": "converted"}},
                {"history_bucket": {"$ne": "converted"}},
            ]
        }
        scope = recruiter_scope(current_user)
        if scope:
            query.update(scope)
        if reason:
            query["historical_reason"] = reason.strip().lower()
        if q and q.strip():
            term = q.strip()
            query = {
                "$and": [
                    query,
                    {
                        "$or": [
                            {"full_name": {"$regex": term, "$options": "i"}},
                            {"email": {"$regex": term, "$options": "i"}},
                            {"job_title": {"$regex": term, "$options": "i"}},
                            {"department": {"$regex": term, "$options": "i"}},
                            {"user_id": {"$regex": term, "$options": "i"}},
                        ]
                    },
                ]
            }

        # Active (rehired) employees keep prior candidate cycles on career timeline only.
        active_emails = await self._active_employee_emails(current_user)
        if active_emails:
            email_clause = {"email": {"$nin": sorted(active_emails)}}
            query = {"$and": [query, email_clause]}

        total = await database.candidates.count_documents(query)
        docs = (
            await database.candidates.find(query)
            .sort("updated_at", -1)
            .skip((page - 1) * page_size)
            .limit(page_size)
            .to_list(length=page_size)
        )
        candidate_service = CandidateService()
        items = []
        for doc in docs:
            progress = candidate_service._progress_payload(doc)
            payload = self._public_candidate(doc, progress)
            payload["historical_reason"] = doc.get("historical_reason") or doc.get("conversion_status")
            payload["lifecycle_state"] = doc.get("lifecycle_state")
            payload["history_bucket"] = doc.get("history_bucket") or "historical"
            payload["employee_id"] = doc.get("employee_id")
            items.append(payload)
        return {
            "candidates": items,
            "count": len(items),
            "total": total,
            "page": page,
            "page_size": page_size,
            "pages": max(1, (total + page_size - 1) // page_size),
        }

    async def lookup_person_history(self, current_user: CurrentUser, email: str) -> dict:
        return await lookup_history_by_email(
            email,
            recruiter_id=None if current_user.role == "super_admin" else current_user.id,
            is_super_admin=current_user.role == "super_admin",
        )

    async def assign_role(self, current_user: CurrentUser, employee_id: str, request) -> dict:
        """Assign designation + department via a career event (promotion / title / dept change)."""
        from datetime import date as date_cls

        from app.schemas.career import CareerEventCreateRequest

        employee = await database.employees.find_one({"employee_id": employee_id})
        if not employee:
            raise HTTPException(status_code=404, detail="Employee not found.")
        self._assert_org_or_owner(current_user, employee)

        event_type = request.event_type
        if request.job_title != employee.get("job_title") and request.department != employee.get("department"):
            # Prefer explicit type; default to promoted when both change and client said so.
            pass
        elif request.job_title != employee.get("job_title") and event_type == "department_change":
            event_type = "title_change"
        elif request.department != employee.get("department") and event_type == "title_change":
            event_type = "department_change"

        career_req = CareerEventCreateRequest(
            event_type=event_type,
            effective_date=request.effective_date or date_cls.today(),
            from_title=employee.get("job_title"),
            to_title=request.job_title,
            from_department=employee.get("department"),
            to_department=request.department,
            note=request.note or "Role assigned by recruiter",
        )
        events = await self.add_career_event(current_user, employee_id, career_req)
        profile = await self.get_employee_profile(current_user, employee_id, reveal_banking=False)
        return {"employee": profile["employee"], "events": events.get("events") if isinstance(events, dict) else events}

    async def get_my_profile(self, current_user: CurrentUser) -> dict:
        employee = await database.employees.find_one(
            {
                "$or": [
                    {"user_id": current_user.id},
                    {"email": current_user.email},
                ],
                "status": "active",
            }
        )
        if not employee:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee profile not found.")
        payload = self._public_employee(employee, include_onboarding=True)
        # A legacy recruiter may be migrated while already signed in. Their
        # browser session will still contain the old one-role user payload,
        # so expose the server-truth here for the EmployeeShell to show the
        # Recruiter switch control without requiring a second login.
        recruiter_profile = await database.recruiters.find_one(
            {
                "$or": [
                    {"user_id": current_user.id},
                    {"email": current_user.email},
                ],
                "status": "active",
            }
        )
        payload["can_switch_to_recruiter"] = bool(recruiter_profile)
        onboarding = dict(payload.get("onboarding") or {})
        onboarding["employment"] = decrypt_banking_payload(onboarding.get("employment"), mask=False)
        payload["onboarding"] = onboarding
        return {
            "employee": payload,
        }

    async def upload_my_photo(self, current_user: CurrentUser, file) -> dict:
        from app.services.profile_photo_service import save_profile_photo

        employee = await database.employees.find_one(
            {
                "$or": [
                    {"user_id": current_user.id},
                    {"email": current_user.email},
                ],
                "status": "active",
            }
        )
        if not employee:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee profile not found.")

        photo_fields = await save_profile_photo(
            current_user.id,
            file,
            previous_meta=employee.get("profile_picture_meta"),
        )
        await database.employees.update_one(
            {"_id": employee["_id"]},
            {"$set": {**photo_fields, "updated_at": datetime.now(UTC)}},
        )
        # A dual-role account must show the same photo in both dashboards.
        from app.services.profile_sync_service import mirror_profile_fields

        await mirror_profile_fields(
            current_user.id, "employee", ("profile_picture", "profile_picture_meta")
        )
        return await self.get_my_profile(current_user)

    async def remove_my_photo(self, current_user: CurrentUser) -> dict:
        from app.services.profile_photo_service import remove_profile_photo

        employee = await database.employees.find_one(
            {
                "$or": [
                    {"user_id": current_user.id},
                    {"email": current_user.email},
                ],
                "status": "active",
            }
        )
        if not employee:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee profile not found.")

        photo_fields = await remove_profile_photo(employee.get("profile_picture_meta"))
        await database.employees.update_one(
            {"_id": employee["_id"]},
            {"$set": {**photo_fields, "updated_at": datetime.now(UTC)}},
        )
        # A dual-role account must show the same photo in both dashboards.
        from app.services.profile_sync_service import mirror_profile_fields

        await mirror_profile_fields(
            current_user.id, "employee", ("profile_picture", "profile_picture_meta")
        )
        return await self.get_my_profile(current_user)

    async def get_candidate_detail(self, current_user: CurrentUser, candidate_id: str) -> dict:
        candidate = await self._find_candidate(candidate_id)
        if not candidate:
            raise HTTPException(status_code=404, detail="Candidate not found.")
        self._assert_org_or_owner(current_user, candidate)
        payload = self._public_candidate(candidate, CandidateService()._progress_payload(candidate), include_onboarding=True)
        payload["offers"] = await self._list_related_offers(
            candidate_id=candidate.get("user_id") or str(candidate.get("_id") or ""),
            candidate_email=candidate.get("email"),
        )
        payload["current_offer"] = payload["offers"][0] if payload["offers"] else None
        history = await lookup_history_by_email(
            candidate.get("email") or "",
            recruiter_id=None if current_user.role == "super_admin" else current_user.id,
            is_super_admin=current_user.role == "super_admin",
        )
        payload["person_history"] = history
        return {"candidate": payload}

    @staticmethod
    def _public_candidate(doc: dict, progress: dict, *, include_onboarding: bool = False) -> dict:
        payload = {
            "id": doc.get("user_id") or str(doc.get("_id", "")),
            "full_name": doc.get("full_name"), "email": doc.get("email"), "phone": doc.get("phone"),
            "job_title": doc.get("job_title"), "department": doc.get("department"),
            "office_location": doc.get("office_location"), "start_date": doc.get("start_date"),
            "status": doc.get("status"), "conversion_status": doc.get("conversion_status"),
            "history_bucket": doc.get("history_bucket")
            or (
                "converted"
                if doc.get("status") == "converted" or doc.get("conversion_status") == "converted"
                else (
                    "historical"
                    if doc.get("status") in {"historical", "declined", "offer_declined"}
                    or doc.get("conversion_status") in {"offer_declined", "declined"}
                    else "active"
                )
            ),
            "historical_reason": doc.get("historical_reason"),
            "lifecycle_state": doc.get("lifecycle_state"),
            "cycle_group_key": doc.get("cycle_group_key") or cycle_group_key(doc.get("email")),
            "employee_id": doc.get("employee_id"),
            "created_at": doc.get("created_at").isoformat() if hasattr(doc.get("created_at"), "isoformat") else doc.get("created_at"),
            "progress": progress,
            "onboarding_reminder_sent_at": doc.get("onboarding_reminder_sent_at").isoformat() if hasattr(doc.get("onboarding_reminder_sent_at"), "isoformat") else doc.get("onboarding_reminder_sent_at"),
        }
        if include_onboarding:
            payload["onboarding"] = doc.get("onboarding") or {}
        return payload

    async def _list_related_offers(
        self,
        *,
        candidate_id: str | None = None,
        candidate_email: str | None = None,
        offer_id: str | None = None,
    ) -> list[dict]:
        query_or: list[dict] = []
        if candidate_id:
            query_or.append({"candidate_id": candidate_id})
        if candidate_email:
            query_or.append({"candidate_email": candidate_email.lower().strip()})
        if offer_id and ObjectId.is_valid(offer_id):
            query_or.append({"_id": ObjectId(offer_id)})
        if not query_or:
            return []
        docs = (
            await database.offer_letters.find({"$or": query_or})
            .sort([("version", -1), ("created_at", -1)])
            .to_list(length=20)
        )
        return [self._public_offer_summary(doc) for doc in docs]

    @staticmethod
    def _public_offer_summary(doc: dict) -> dict:
        def _iso(value):
            return value.isoformat() if hasattr(value, "isoformat") else value

        negotiation = dict(doc.get("negotiation") or {})
        if negotiation.get("requested_at"):
            negotiation["requested_at"] = _iso(negotiation.get("requested_at"))
        if negotiation.get("responded_at"):
            negotiation["responded_at"] = _iso(negotiation.get("responded_at"))
        history = []
        for entry in doc.get("negotiation_history") or []:
            history.append({**entry, "created_at": _iso(entry.get("created_at"))})

        return {
            "id": str(doc.get("_id", "")),
            "candidate_id": doc.get("candidate_id"),
            "candidate_name": doc.get("candidate_name"),
            "candidate_email": doc.get("candidate_email"),
            "job_title": doc.get("job_title"),
            "department": doc.get("department"),
            "employment_type": doc.get("employment_type"),
            "office_location": doc.get("office_location"),
            "reporting_manager": doc.get("reporting_manager"),
            "start_date": doc.get("start_date"),
            "monthly_salary": doc.get("monthly_salary"),
            "currency": doc.get("currency"),
            "salary_breakdown": doc.get("salary_breakdown") or [],
            "benefits": doc.get("benefits") or [],
            "terms": doc.get("terms"),
            "message_to_candidate": doc.get("message_to_candidate"),
            "status": doc.get("status"),
            "version": doc.get("version") or 1,
            "parent_offer_id": doc.get("parent_offer_id"),
            "negotiation_used": bool(doc.get("negotiation_used")),
            "negotiation_rounds_used": int(doc.get("negotiation_rounds_used") or 0),
            "negotiation_max_rounds": int(doc.get("negotiation_max_rounds") or 3),
            "negotiation": negotiation,
            "negotiation_history": history,
            "recruiter_id": doc.get("recruiter_id"),
            "recruiter_name": doc.get("recruiter_name"),
            "sent_at": _iso(doc.get("sent_at")),
            "expires_at": _iso(doc.get("expires_at")),
            "viewed_at": _iso(doc.get("viewed_at")),
            "signed_at": _iso(doc.get("signed_at")),
            "signature": doc.get("signature"),
            "declined_reason": doc.get("declined_reason"),
            "approved_at": _iso(doc.get("approved_at")),
        }

    async def attach_uploaded_file(
        self,
        current_user: CurrentUser,
        *,
        purpose: str,
        file_name: str,
        file_url: str,
        doc_type: str | None = None,
        index: int = 0,
    ) -> dict:
        """Keep the employee profile's denormalized onboarding data in sync."""
        employee = await self._require_employee(current_user)
        onboarding = dict(employee.get("onboarding") or {})
        now = datetime.now(UTC)

        if purpose == "resume":
            resume = dict(onboarding.get("resume") or {})
            resume.update({"file_name": file_name, "file_url": file_url})
            if not resume.get("summary"):
                resume["summary"] = ""
            onboarding["resume"] = resume
        elif purpose == "government_doc":
            government = dict(onboarding.get("government_docs") or {})
            documents = list(government.get("documents") or [])
            target_type = doc_type if doc_type in {"cnic", "passport"} else None
            updated = False
            if target_type:
                for item in documents:
                    if item.get("doc_type") == target_type and not item.get("file_url"):
                        item["file_name"] = file_name
                        item["file_url"] = file_url
                        updated = True
                        break
                if not updated:
                    for item in documents:
                        if item.get("doc_type") == target_type:
                            item["file_name"] = file_name
                            item["file_url"] = file_url
                            updated = True
                            break
            if not updated:
                documents.append(
                    {
                        "doc_type": target_type or "cnic",
                        "document_number": "pending",
                        "file_name": file_name,
                        "file_url": file_url,
                    }
                )
            government["documents"] = documents
            onboarding["government_docs"] = government
        elif purpose == "education_cert":
            education = dict(onboarding.get("education") or {})
            entries = list(education.get("entries") or [])
            while len(entries) <= index:
                entries.append(
                    {
                        "institution": "",
                        "board_university": "",
                        "degree": "",
                        "field_of_study": "",
                        "year_completed": "",
                        "cgpa_or_percentage": "",
                        "certificate_file": None,
                    }
                )
            entries[index]["certificate_file"] = file_url
            education["entries"] = entries
            onboarding["education"] = education
        elif purpose == "skill_cert":
            skills = dict(onboarding.get("skills") or {})
            certifications = list(skills.get("certifications") or [])
            while len(certifications) <= index:
                certifications.append({"name": "", "document_url": None, "expiry_date": ""})
            entry = dict(certifications[index] or {})
            entry["document_url"] = file_url
            entry.setdefault("name", "")
            entry.setdefault("expiry_date", "")
            certifications[index] = entry
            skills["certifications"] = certifications
            skills.setdefault("technical_skills", [])
            skills.setdefault("soft_skills", [])
            skills.setdefault("languages", [])
            onboarding["skills"] = skills
        else:
            return {
                "message": "File uploaded.",
                "file_name": file_name,
                "file_url": file_url,
                "onboarding": onboarding,
                "doc_type": doc_type,
            }

        await database.employees.update_one(
            {"_id": employee["_id"]},
            {"$set": {"onboarding": onboarding, "updated_at": now}},
        )
        refreshed = await database.employees.find_one({"_id": employee["_id"]})
        return {
            "message": (
                "Certificate uploaded. Recruiters can open the document URL to review it."
                if purpose == "skill_cert"
                else "File uploaded."
            ),
            "file_name": file_name,
            "file_url": file_url,
            "document_url": file_url if purpose == "skill_cert" else None,
            "onboarding": refreshed.get("onboarding"),
        }

    async def clear_uploaded_file(
        self,
        current_user: CurrentUser,
        *,
        purpose: str,
        index: int = 0,
    ) -> dict:
        """Remove an onboarding file slot and deactivate matching active documents."""
        employee = await self._require_employee(current_user)
        onboarding = dict(employee.get("onboarding") or {})
        now = datetime.now(UTC)
        doc_types: list[str] = []

        if purpose == "resume":
            resume = dict(onboarding.get("resume") or {})
            resume["file_name"] = None
            resume["file_url"] = None
            onboarding["resume"] = resume
            doc_types = ["resume"]
        elif purpose == "government_doc":
            government = dict(onboarding.get("government_docs") or {})
            documents = list(government.get("documents") or [])
            if 0 <= index < len(documents):
                documents[index]["file_name"] = None
                documents[index]["file_url"] = None
                documents[index]["document_number"] = documents[index].get("document_number") or "pending"
            government["documents"] = documents
            onboarding["government_docs"] = government
            doc_types = ["cnic", "passport"]
        elif purpose == "education_cert":
            education = dict(onboarding.get("education") or {})
            entries = list(education.get("entries") or [])
            if 0 <= index < len(entries):
                entries[index]["certificate_file"] = None
            education["entries"] = entries
            onboarding["education"] = education
            doc_types = ["transcript", "certificate", "degree"]
        elif purpose == "skill_cert":
            skills = dict(onboarding.get("skills") or {})
            certifications = list(skills.get("certifications") or [])
            if 0 <= index < len(certifications):
                certifications[index] = {**certifications[index], "document_url": None}
            skills["certifications"] = certifications
            onboarding["skills"] = skills
            doc_types = []
        else:
            raise HTTPException(status_code=400, detail="Unsupported upload purpose.")

        if doc_types:
            await database.documents.update_many(
                {
                    "owner_id": current_user.id,
                    "doc_type": {"$in": doc_types},
                    "is_active": True,
                },
                {
                    "$set": {
                        "is_active": False,
                        "status": "removed_by_candidate",
                        "updated_at": now,
                    }
                },
            )

        await database.employees.update_one(
            {"_id": employee["_id"]},
            {"$set": {"onboarding": onboarding, "updated_at": now}},
        )
        refreshed = await database.employees.find_one({"_id": employee["_id"]})
        return {"message": "Document removed.", "onboarding": refreshed.get("onboarding")}

    async def _find_candidate(self, candidate_id: str) -> dict | None:
        query_or = [{"user_id": candidate_id}, {"email": candidate_id}]
        if ObjectId.is_valid(candidate_id):
            query_or.append({"_id": ObjectId(candidate_id)})
        return await database.candidates.find_one({"$or": query_or})

    # ------------------------------------------------------------------
    # Post-hire "complete your profile" flow (Profile Incomplete banner)
    # ------------------------------------------------------------------
    async def _require_employee(self, current_user: CurrentUser) -> dict:
        employee = await database.employees.find_one(
            {
                "$or": [{"user_id": current_user.id}, {"email": current_user.email}],
                "status": "active",
            }
        )
        if not employee:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee profile not found.")
        return employee

    def _profile_progress(self, employee: dict) -> dict:
        onboarding = employee.get("onboarding") or {}
        tasks = []
        for task_def in _profile_task_defs_for(employee):
            completed = bool(onboarding.get(task_def["step"]))
            tasks.append({**task_def, "completed": completed})
        completed_count = sum(1 for t in tasks if t["completed"])
        percentage = round((completed_count / len(tasks)) * 100) if tasks else 100
        missing_fields = [t["step"] for t in tasks if not t["completed"]]
        return {
            "profile_status": employee.get("profile_status", "complete"),
            "percentage": percentage,
            "missing_fields": missing_fields,
            "tasks": tasks,
            "current_step": next((t["step"] for t in tasks if not t["completed"]), "submit"),
            "is_remote": _employee_is_remote(employee),
            "banking_managed_by": "employee" if _employee_is_remote(employee) else "recruiter",
        }

    async def get_profile_completion(self, current_user: CurrentUser) -> dict:
        employee = await self._require_employee(current_user)
        onboarding = dict(employee.get("onboarding") or {})
        onboarding["employment"] = decrypt_banking_payload(onboarding.get("employment"), mask=False)
        return {
            "employee": self._public_employee(employee),
            "onboarding": onboarding,
            "progress": self._profile_progress(employee),
        }

    async def save_profile_completion(self, current_user: CurrentUser, request) -> dict:
        employee = await self._require_employee(current_user)
        onboarding = employee.get("onboarding") or {}
        now = datetime.now(UTC)
        updates: dict = {"updated_at": now}
        is_remote = _employee_is_remote(employee)

        step_handlers = {
            "personal": ("personal", request.personal, "Personal information is required."),
            "education": ("education", request.education, "Education history is required."),
            "emergency": ("emergency", request.emergency, "Emergency contact is required."),
            "employment": ("employment", request.employment, "Banking information is required."),
            "references": ("references", request.references, "At least two references are required."),
            "documents": ("documents", request.documents, "Policy acknowledgements are required."),
            "nda": ("nda", request.nda, "Self Declaration signature is required."),
        }

        if request.step in step_handlers:
            field, payload, error = step_handlers[request.step]
            if request.step == "employment" and not is_remote:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=(
                        "Banking details for on-site employees are managed by your recruiter. "
                        "You can view them on your profile once they are added."
                    ),
                )
            if not payload:
                raise HTTPException(status_code=400, detail=error)
            data = payload.model_dump(mode="json")
            if request.step == "nda":
                expected_name = employee.get("full_name") or current_user.full_name
                if not names_match(data.get("full_legal_name"), expected_name):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Self Declaration full legal name must match your registered name: {expected_name}",
                    )
                data["full_legal_name"] = " ".join((expected_name or data.get("full_legal_name") or "").split())
                if not data.get("signed_at"):
                    data["signed_at"] = now.isoformat()
            if request.step == "employment":
                iban_hash = iban_fingerprint(data["iban"])
                duplicate = await database.employees.find_one(
                    {
                        "onboarding.employment.iban_hash": iban_hash,
                        "_id": {"$ne": employee["_id"]},
                        "status": {"$nin": list(HISTORICAL_EMPLOYEE_STATUSES)},
                    }
                )
                if duplicate:
                    other_id = duplicate.get("employee_id") or "another employee"
                    other_name = duplicate.get("full_name") or "another employee"
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=(
                            f"This IBAN is already registered to {other_name} ({other_id}). "
                            "Enter a different IBAN."
                        ),
                    )
                data = encrypt_banking_payload(data)
            if request.step == "personal":
                updates["full_name"] = " ".join(
                    part for part in (data.get("first_name"), data.get("last_name")) if part
                )
            updates[f"onboarding.{field}"] = data
            await database.audit_logs.insert_one(
                {
                    "user_id": current_user.id,
                    "employee_id": employee.get("employee_id"),
                    "email": employee.get("email"),
                    "actor_email": current_user.email,
                    "module": "employees",
                    "action": f"profile_{field}_saved",
                    "outcome": "success",
                    "created_at": now,
                }
            )
        elif request.step == "submit":
            missing = [k for k in _profile_required_keys_for(employee) if not onboarding.get(k)]
            if missing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Complete these sections first: {', '.join(missing)}.",
                )
            updates["profile_status"] = "complete"
            updates["profile_completed_at"] = now
            await create_notification(
                recipient_id=employee.get("recruiter_id"),
                recipient_role="recruiter",
                notif_type="employee_profile_completed",
                title="Employee profile completed",
                message=f"{employee['full_name']} finished their post-hire profile checklist.",
                link="/dashboard/recruiter#employees-section",
                related_id=employee.get("employee_id"),
            ) if employee.get("recruiter_id") else None
        else:
            raise HTTPException(status_code=400, detail="Unknown profile step.")

        await database.employees.update_one({"_id": employee["_id"]}, {"$set": updates})
        # A dual-role account (employee + recruiter) must show the same
        # personal details in both dashboards.
        if request.step == "personal":
            from app.services.profile_sync_service import mirror_profile_fields

            await mirror_profile_fields(current_user.id, "employee", ("full_name",))
        refreshed = await database.employees.find_one({"_id": employee["_id"]})
        response_onboarding = dict(refreshed.get("onboarding") or {})
        # On-site employees may view recruiter-entered banking read-only; remote see their own.
        response_onboarding["employment"] = decrypt_banking_payload(
            response_onboarding.get("employment"), mask=False
        )
        return {
            "message": "Profile saved." if request.step != "submit" else "Profile completed — welcome aboard!",
            "employee": self._public_employee(refreshed),
            "onboarding": response_onboarding,
            "progress": self._profile_progress(refreshed),
        }

    @staticmethod
    def _public_employee(doc: dict, include_onboarding: bool = False) -> dict:
        payload = {
            "id": doc.get("user_id") or str(doc.get("_id", "")),
            "employee_id": doc.get("employee_id"),
            "full_name": doc.get("full_name"),
            "email": doc.get("email"),
            "company_email": doc.get("company_email"),
            "has_company_email_password": bool(
                doc.get("has_company_email_password") or doc.get("company_email_password_encrypted")
            ),
            "phone": doc.get("phone"),
            "job_title": doc.get("job_title"),
            "department": doc.get("department"),
            "employment_type": doc.get("employment_type"),
            "office_location": doc.get("office_location"),
            "is_remote": bool(doc.get("is_remote")),
            "start_date": doc.get("start_date"),
            "reporting_manager": doc.get("reporting_manager"),
            "profile_status": doc.get("profile_status", "complete"),
            "status": doc.get("status"),
            "history_bucket": doc.get("history_bucket")
            or ("historical" if doc.get("status") in HISTORICAL_EMPLOYEE_STATUSES else "active"),
            "exit_type": doc.get("exit_type"),
            "exit_reason": doc.get("exit_reason"),
            "exit_date": doc.get("exit_date").isoformat()
            if hasattr(doc.get("exit_date"), "isoformat")
            else doc.get("exit_date"),
            "historical_at": doc.get("historical_at").isoformat()
            if hasattr(doc.get("historical_at"), "isoformat")
            else doc.get("historical_at"),
            "cycle_group_key": doc.get("cycle_group_key") or cycle_group_key(doc.get("email")),
            "previous_employee_id": doc.get("previous_employee_id"),
            "legacy_employee_id": doc.get("legacy_employee_id"),
            "profile_locked": bool(doc.get("profile_locked")),
            "converted_at": doc.get("converted_at").isoformat()
            if hasattr(doc.get("converted_at"), "isoformat")
            else doc.get("converted_at"),
            "candidate_id": doc.get("candidate_id"),
            "assets": doc.get("assets") or [],
            "licenses": doc.get("licenses") or [],
            "it_notes": doc.get("it_notes"),
            "orientation": doc.get("orientation"),
            "profile_picture": doc.get("profile_picture"),
            "banking_managed_by": "employee" if bool(doc.get("is_remote")) else "recruiter",
            "has_banking": bool((doc.get("onboarding") or {}).get("employment")),
        }
        if include_onboarding:
            payload["onboarding"] = doc.get("onboarding")
        return payload

    async def _resolve_employee_for_recruiter(self, current_user: CurrentUser, employee_id: str) -> dict:
        key = (employee_id or "").strip()
        if not key:
            raise HTTPException(status_code=404, detail="Employee not found.")
        query_or: list[dict] = [
            {"employee_id": key},
            {"legacy_employee_id": key},
            {"user_id": key},
            {"email": key.lower()},
            {"candidate_id": key},
        ]
        if ObjectId.is_valid(key):
            query_or.append({"_id": ObjectId(key)})
        employee = await database.employees.find_one({"$or": query_or})
        if not employee:
            raise HTTPException(status_code=404, detail="Employee not found.")
        if current_user.role != "super_admin":
            owner = str(employee.get("recruiter_id") or "")
            if owner and owner != str(current_user.id):
                raise HTTPException(status_code=403, detail="Not allowed.")
        return employee

    async def update_employee_banking(self, current_user: CurrentUser, employee_id: str, request) -> dict:
        """Recruiter-managed banking for on-site / office-based employees."""
        employee = await self._resolve_employee_for_recruiter(current_user, employee_id)
        if _employee_is_remote(employee):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Remote employees enter and manage their own banking details in Complete Profile.",
            )

        data = request.model_dump(mode="json") if hasattr(request, "model_dump") else dict(request)
        iban_hash = iban_fingerprint(data["iban"])
        duplicate = await database.employees.find_one(
            {
                "onboarding.employment.iban_hash": iban_hash,
                "_id": {"$ne": employee["_id"]},
                "status": {"$nin": list(HISTORICAL_EMPLOYEE_STATUSES)},
            }
        )
        if duplicate:
            other_id = duplicate.get("employee_id") or "another employee"
            other_name = duplicate.get("full_name") or "another employee"
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"This IBAN is already registered to {other_name} ({other_id}). "
                    "Enter a different IBAN for this employee."
                ),
            )

        now = datetime.now(UTC)
        had_banking = bool((employee.get("onboarding") or {}).get("employment"))
        encrypted = encrypt_banking_payload(data)
        encrypted["updated_by"] = "recruiter"
        encrypted["updated_by_id"] = current_user.id
        encrypted["updated_at"] = now.isoformat()

        await database.employees.update_one(
            {"_id": employee["_id"]},
            {
                "$set": {
                    "onboarding.employment": encrypted,
                    "updated_at": now,
                }
            },
        )
        await database.audit_logs.insert_one(
            {
                "user_id": current_user.id,
                "employee_id": employee.get("employee_id"),
                "email": employee.get("email"),
                "actor_email": current_user.email,
                "module": "employees",
                "action": "recruiter_banking_updated" if had_banking else "recruiter_banking_added",
                "outcome": "success",
                "created_at": now,
            }
        )

        await self._notify_employee(
            employee,
            notif_type="banking_updated" if had_banking else "banking_added",
            title="Banking details updated" if had_banking else "Banking details added",
            message=(
                "Your recruiter updated your salary bank account details. "
                "Open your profile to review them (view only)."
                if had_banking
                else "Your recruiter added your salary bank account details. "
                "Open your profile to review them (view only)."
            ),
            link="/dashboard/employee/profile#sec-banking",
            related_id=employee.get("employee_id"),
        )

        try:
            to_email = (employee.get("email") or "").strip()
            if to_email:
                email_service.send_banking_details_notice(
                    to_email=to_email,
                    full_name=employee.get("full_name") or "Employee",
                    bank_name=data.get("bank_name") or "",
                    account_holder_name=data.get("account_holder_name") or "",
                    iban=data.get("iban") or "",
                    is_update=had_banking,
                    organization_id=employee.get("organization_id"),
                )
        except Exception as exc:
            logger.warning("Banking details notice email failed: %s", exc, exc_info=True)

        refreshed = await database.employees.find_one({"_id": employee["_id"]})
        profile = await self.get_employee_profile(
            current_user,
            refreshed.get("employee_id") or employee_id,
            reveal_banking=True,
        )
        return {
            "message": (
                "Banking details updated. The employee has been notified."
                if had_banking
                else "Banking details saved. The employee has been notified."
            ),
            "employee": profile["employee"],
        }

    async def _notify_employee(
        self,
        employee: dict,
        *,
        notif_type: str,
        title: str,
        message: str,
        link: str = "/dashboard/employee",
        related_id: str | None = None,
    ) -> str | None:
        recipient_id = employee.get("user_id")
        if not recipient_id:
            # Resolve from users collection by email so reminders still land.
            user = await database.users.find_one({"email": (employee.get("email") or "").lower()})
            if user:
                recipient_id = str(user["_id"])
                if not employee.get("user_id"):
                    await database.employees.update_one(
                        {"_id": employee["_id"]},
                        {"$set": {"user_id": recipient_id}},
                    )
                    employee["user_id"] = recipient_id
        if not recipient_id:
            return None
        return await create_notification(
            recipient_id=str(recipient_id),
            recipient_role="employee",
            notif_type=notif_type,
            title=title,
            message=message,
            link=link,
            related_id=related_id or employee.get("employee_id"),
        )

    async def remind_profile_completion(
        self,
        current_user: CurrentUser,
        employee_id: str,
        note: str | None = None,
        *,
        force: bool = False,
    ) -> dict:
        """Recruiter nudge for employees who have not finished Complete Profile."""
        from app.core.config import settings

        employee = await self._resolve_employee_for_recruiter(current_user, employee_id)
        progress = self._profile_progress(employee)
        if progress.get("profile_status") == "complete" or not progress.get("missing_fields"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This employee has already completed their post-hire profile.",
            )

        now = datetime.now(UTC)
        last_sent = employee.get("profile_reminder_sent_at")
        if last_sent and not force:
            last_dt = last_sent if isinstance(last_sent, datetime) else None
            if last_dt and last_dt.tzinfo is None:
                last_dt = last_dt.replace(tzinfo=UTC)
            if last_dt and (now - last_dt).total_seconds() < 3600:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="A reminder was already sent within the last hour. Try again later, or resend with force=true.",
                )

        label_by_step = {t["step"]: t["label"] for t in PROFILE_TASK_DEFS}
        missing_labels = [label_by_step.get(step, step) for step in progress["missing_fields"]]
        note_text = (note or "").strip() or None
        profile_link = f"{settings.frontend_base_url}/dashboard/employee/complete-profile"
        to_email = employee.get("email")

        notification_id = await self._notify_employee(
            employee,
            notif_type="profile_completion_reminder",
            title="Please complete your profile",
            message=(
                f"Your recruiter asked you to finish your post-hire profile. "
                f"Still needed: {', '.join(missing_labels)}."
                + (f" Note: {note_text}" if note_text else "")
            ),
            link="/dashboard/employee/complete-profile",
        )
        notification_sent = bool(notification_id)

        email_sent = False
        email_error = None
        if not to_email:
            email_error = "Employee has no email address on file."
        else:
            try:
                email_service.send_profile_completion_reminder(
                    to_email=to_email,
                    full_name=employee.get("full_name") or "there",
                    employee_id=employee.get("employee_id") or "",
                    missing_labels=missing_labels,
                    dashboard_link=profile_link,
                    recruiter_note=note_text,
                    organization_id=employee.get("organization_id"),
                )
                email_sent = True
            except Exception as exc:  # noqa: BLE001
                email_error = str(exc)

        await database.employees.update_one(
            {"_id": employee["_id"]},
            {
                "$set": {
                    "profile_reminder_sent_at": now,
                    "profile_reminder_sent_by": current_user.id,
                    "updated_at": now,
                }
            },
        )
        await database.audit_logs.insert_one(
            {
                "user_id": current_user.id,
                "recruiter_id": current_user.id,
                "employee_id": employee.get("employee_id"),
                "email": employee.get("email"),
                "actor_email": current_user.email,
                "module": "employees",
                "action": "profile_completion_reminder",
                "outcome": "success" if email_sent and notification_sent else "partial",
                "created_at": now,
            }
        )

        refreshed = await database.employees.find_one({"_id": employee["_id"]})
        profile = await self.get_employee_profile(
            current_user, employee.get("employee_id") or employee_id, reveal_banking=False
        )
        if not email_sent or not notification_sent:
            failures = []
            if not email_sent:
                failures.append(f"email failed ({email_error})" if email_error else "email failed")
            if not notification_sent:
                failures.append("dashboard notification failed")
            raise HTTPException(status_code=502, detail=f"Reminder saved, but {' and '.join(failures)}.")
        parts = []
        if notification_sent:
            parts.append("dashboard notification created")
        else:
            parts.append("dashboard notification failed (no user id)")
        if email_sent:
            parts.append(f"email sent to {to_email}")
        elif email_error:
            parts.append(f"email not sent ({email_error})")
        else:
            parts.append("email not sent")
        return {
            "message": "Reminder has been sent via email and dashboard.",
            "email_sent": email_sent,
            "notification_sent": notification_sent,
            "notification_id": notification_id,
            "email_to": to_email,
            "email_error": email_error,
            "missing_steps": missing_labels,
            "progress": self._profile_progress(refreshed or employee),
            "employee": profile["employee"],
        }

    async def set_company_email(self, current_user: CurrentUser, employee_id: str, company_email: str) -> dict:
        employee = await self._resolve_employee_for_recruiter(current_user, employee_id)
        email = company_email.strip().lower()
        now = datetime.now(UTC)
        await database.employees.update_one(
            {"_id": employee["_id"]},
            {
                "$set": {
                    "company_email": email,
                    "company_email_assigned_at": now,
                    "company_email_assigned_by": current_user.id,
                    "updated_at": now,
                }
            },
        )
        employee["company_email"] = email

        await self._notify_employee(
            employee,
            notif_type="company_email_assigned",
            title="Company email assigned",
            message=f"Your official company email has been set to {email}.",
            link="/dashboard/employee",
        )
        try:
            email_service.send_to_both(
                employee.get("email") or email,
                email,
                email_service.send_company_email_assigned,
                employee.get("full_name") or "Team member",
                email,
                organization_id=employee.get("organization_id"),
            )
        except Exception as exc:
            logger.warning("Company email assigned send failed: %s", exc, exc_info=True)

        await database.audit_logs.insert_one(
            {
                "user_id": current_user.id,
                "email": current_user.email,
                "actor_email": current_user.email,
                "module": "employees",
                "action": "company_email_assigned",
                "employee_id": employee.get("employee_id"),
                "company_email": email,
                "outcome": "success",
                "created_at": now,
            }
        )
        return {"message": "Company email saved.", "employee": self._public_employee(employee)}

    async def assign_asset(self, current_user: CurrentUser, employee_id: str, request) -> dict:
        employee = await self._resolve_employee_for_recruiter(current_user, employee_id)
        now = datetime.now(UTC)
        data = request.model_dump(mode="json")
        asset = {
            "id": str(ObjectId()),
            "name": data["name"],
            "asset_type": data.get("asset_type") or "other",
            "serial_number": data.get("serial_number"),
            "notes": data.get("notes"),
            "status": "assigned",
            "assigned_at": now.isoformat(),
            "assigned_by": current_user.id,
            "assigned_by_email": current_user.email,
        }
        await database.employees.update_one(
            {"_id": employee["_id"]},
            {"$push": {"assets": asset}, "$set": {"updated_at": now}},
        )
        assets = list(employee.get("assets") or [])
        assets.append(asset)
        employee["assets"] = assets

        await self._notify_employee(
            employee,
            notif_type="asset_assigned",
            title="Company asset assigned",
            message=f"You have been assigned: {asset['name']}.",
            related_id=asset["id"],
        )
        try:
            email_service.send_asset_assigned(
                to_email=employee.get("company_email") or employee.get("email"),
                full_name=employee.get("full_name") or "Team member",
                asset_name=asset["name"],
                asset_type=asset["asset_type"],
                serial_number=asset.get("serial_number"),
                organization_id=employee.get("organization_id"),
            )
        except Exception as exc:
            logger.warning("Asset assigned email failed: %s", exc, exc_info=True)

        return {"message": "Asset assigned.", "asset": asset, "employee": self._public_employee(employee)}

    async def update_asset(
        self, current_user: CurrentUser, employee_id: str, asset_id: str, request
    ) -> dict:
        employee = await self._resolve_employee_for_recruiter(current_user, employee_id)
        assets = list(employee.get("assets") or [])
        target = next((a for a in assets if a.get("id") == asset_id), None)
        if not target:
            raise HTTPException(status_code=404, detail="Asset not found.")
        data = {k: v for k, v in request.model_dump(mode="json", exclude_none=True).items()}
        now = datetime.now(UTC)
        target.update(data)
        target["updated_at"] = now.isoformat()
        await database.employees.update_one(
            {"_id": employee["_id"]},
            {"$set": {"assets": assets, "updated_at": now}},
        )
        employee["assets"] = assets
        return {"message": "Asset updated.", "asset": target, "employee": self._public_employee(employee)}

    async def remove_asset(self, current_user: CurrentUser, employee_id: str, asset_id: str) -> dict:
        employee = await self._resolve_employee_for_recruiter(current_user, employee_id)
        assets = [a for a in (employee.get("assets") or []) if a.get("id") != asset_id]
        if len(assets) == len(employee.get("assets") or []):
            raise HTTPException(status_code=404, detail="Asset not found.")
        now = datetime.now(UTC)
        await database.employees.update_one(
            {"_id": employee["_id"]},
            {"$set": {"assets": assets, "updated_at": now}},
        )
        employee["assets"] = assets
        return {"message": "Asset removed.", "employee": self._public_employee(employee)}

    async def schedule_orientation(self, current_user: CurrentUser, employee_id: str, request) -> dict:
        employee = await self._resolve_employee_for_recruiter(current_user, employee_id)
        now = datetime.now(UTC)
        data = request.model_dump(mode="json")
        previous = employee.get("orientation")
        orientation = {
            **data,
            "scheduled_at": now.isoformat(),
            "scheduled_by": current_user.id,
            "scheduled_by_email": current_user.email,
            "status": "scheduled",
        }
        await database.employees.update_one(
            {"_id": employee["_id"]},
            {"$set": {"orientation": orientation, "updated_at": now}},
        )
        employee["orientation"] = orientation

        is_update = bool(previous)
        notif_type = "orientation_updated" if is_update else "orientation_scheduled"
        title = "Orientation session updated" if is_update else "Orientation session scheduled"
        message = (
            f"Your orientation is on {orientation['date']} at {orientation['time']} "
            f"with {orientation['trainer']}."
        )
        await self._notify_employee(
            employee,
            notif_type=notif_type,
            title=title,
            message=message,
            link="/dashboard/employee",
        )
        try:
            email_service.send_orientation_scheduled(
                to_email=employee.get("company_email") or employee.get("email"),
                full_name=employee.get("full_name") or "Team member",
                date=orientation["date"],
                time=orientation["time"],
                meeting_link=orientation.get("meeting_link"),
                trainer=orientation["trainer"],
                agenda=orientation["agenda"],
                is_update=is_update,
                organization_id=employee.get("organization_id"),
            )
        except Exception as exc:
            logger.warning("Orientation scheduled email failed: %s", exc, exc_info=True)

        return {
            "message": "Orientation updated." if is_update else "Orientation scheduled.",
            "orientation": orientation,
            "employee": self._public_employee(employee),
        }

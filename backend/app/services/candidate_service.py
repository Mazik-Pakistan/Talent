from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status

from app.core.config import settings
from app.core.database import database
from app.core.rbac import CurrentUser
from app.core.security import hash_password
from app.schemas.invitation import CandidateRegisterRequest, OnboardingSaveRequest
from app.services.dashboard_service import create_notification
from app.services.email_service import email_service
from app.services.invitation_service import InvitationService

# Full onboarding checklist for US-021 / US-023 prerequisites.
ONBOARDING_TASK_DEFS = [
    {"id": "personal", "label": "Complete personal information", "step": "personal", "available": True},
    {"id": "emergency", "label": "Add emergency contact", "step": "emergency", "available": True},
    {"id": "employment", "label": "Complete bank & payroll details", "step": "employment", "available": True},
    {"id": "education", "label": "Add education history", "step": "education", "available": True},
    {"id": "government_docs", "label": "Upload government ID documents", "step": "government_docs", "available": True},
    {"id": "references", "label": "Provide professional references", "step": "references", "available": True},
    {"id": "documents", "label": "Acknowledge company policies", "step": "documents", "available": True},
    {"id": "nda", "label": "Sign NDA", "step": "nda", "available": True},
    {"id": "contract", "label": "Sign employment contract", "step": "contract", "available": True},
    {"id": "resume", "label": "Upload resume", "step": "resume", "available": True},
    {"id": "submit", "label": "Submit onboarding for recruiter review", "step": "submit", "available": True},
    {"id": "learning", "label": "Complete assigned learning", "step": None, "available": False},
]

REQUIRED_ONBOARDING_KEYS = [
    "personal",
    "emergency",
    "employment",
    "education",
    "government_docs",
    "references",
    "documents",
    "nda",
    "contract",
    "resume",
]

STEP_FLOW = {
    "personal": "emergency",
    "emergency": "employment",
    "employment": "education",
    "education": "government_docs",
    "government_docs": "references",
    "references": "documents",
    "documents": "nda",
    "nda": "contract",
    "contract": "resume",
    "resume": "submit",
}


EMPTY_ONBOARDING = {
    "status": "not_started",
    "current_step": "personal",
    "personal": None,
    "emergency": None,
    "employment": None,
    "education": None,
    "government_docs": None,
    "references": None,
    "documents": None,
    "nda": None,
    "contract": None,
    "resume": None,
    "submitted_at": None,
}


def _generate_otp() -> str:
    import random

    return str(random.SystemRandom().randint(100000, 999999))


def onboarding_missing_keys(onboarding: dict | None) -> list[str]:
    onboarding = onboarding or {}
    return [key for key in REQUIRED_ONBOARDING_KEYS if not onboarding.get(key)]


def is_onboarding_complete(onboarding: dict | None) -> bool:
    onboarding = onboarding or {}
    return onboarding.get("status") == "submitted" and not onboarding_missing_keys(onboarding)


class CandidateService:
    def __init__(self) -> None:
        self.invitation_service = InvitationService()

    async def register(self, request: CandidateRegisterRequest) -> dict:
        """
        Candidate invite accept → pending_users + SMTP OTP (same path as recruiters).
        Invitation stays pending until OTP verification succeeds.
        """
        invitation = await self.invitation_service._get_valid_invitation(request.invitation_token)
        email = request.email.lower().strip()

        if email != invitation["email"].lower():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Use the email address that received this invitation.",
            )

        if await database.users.find_one({"email": email}):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account already exists for this email address.",
            )
        if await database.candidates.find_one({"email": email, "status": "active"}):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account already exists for this email address.",
            )
        if await database.recruiters.find_one({"email": email}):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account already exists for this email address.",
            )

        otp = _generate_otp()
        now = datetime.now(UTC)
        otp_expires_at = now + timedelta(minutes=settings.OTP_EXPIRE_MINUTES)
        pending_expires_at = now + timedelta(minutes=30)

        await database.pending_users.replace_one(
            {"email": email},
            {
                "email": email,
                "full_name": request.full_name,
                "phone": request.phone,
                "password_hash": hash_password(request.password),
                "role": "candidate",
                "otp": otp,
                "otp_expires_at": otp_expires_at,
                "expires_at": pending_expires_at,
                "created_at": now,
                "extra_data": {
                    "invitation_token": invitation["token"],
                    "job_title": invitation["job_title"],
                    "department": invitation["department"],
                    "office_location": invitation.get("office_location"),
                    "start_date": invitation.get("start_date"),
                    "recruiter_id": invitation["recruiter_id"],
                    "recruiter_email": invitation.get("recruiter_email"),
                    "onboarding": dict(EMPTY_ONBOARDING),
                },
            },
            upsert=True,
        )

        try:
            email_service.send_signup_otp(email, request.full_name, otp)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="We could not send the verification email. Please try again.",
            ) from exc

        await database.audit_logs.insert_one(
            {
                "email": email,
                "recruiter_id": invitation["recruiter_id"],
                "module": "authentication",
                "action": "candidate_registered",
                "outcome": "success",
                "created_at": now,
            }
        )

        return {
            "message": "Registration successful. A 6-digit verification code has been sent to your email.",
            "role": "candidate",
            "redirect_to": "/verify-email",
        }

    async def get_onboarding(self, current_user: CurrentUser) -> dict:
        candidate = await self._require_active_candidate(current_user)
        return {
            "candidate": self._public_user(candidate),
            "onboarding": candidate.get("onboarding") or dict(EMPTY_ONBOARDING),
            "progress": self._progress_payload(candidate),
        }

    async def save_onboarding(self, current_user: CurrentUser, request: OnboardingSaveRequest) -> dict:
        candidate = await self._require_active_candidate(current_user)
        onboarding = candidate.get("onboarding") or {}

        if onboarding.get("status") == "submitted":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Onboarding has already been submitted.",
            )

        updates: dict = {"updated_at": datetime.now(UTC)}
        candidate_id = candidate.get("user_id") or str(candidate["_id"])
        now = datetime.now(UTC)

        step_handlers = {
            "personal": ("personal", request.personal, "Personal information is required."),
            "emergency": ("emergency", request.emergency, "Emergency contact is required."),
            "employment": ("employment", request.employment, "Employment information is required."),
            "education": ("education", request.education, "Education history is required."),
            "government_docs": ("government_docs", request.government_docs, "Government documents are required."),
            "references": ("references", request.references, "At least two references are required."),
            "documents": ("documents", request.documents, "Document acknowledgements are required."),
            "nda": ("nda", request.nda, "NDA signature is required."),
            "contract": ("contract", request.contract, "Contract signature is required."),
            "resume": ("resume", request.resume, "Resume upload is required."),
        }

        if request.step in step_handlers:
            field, payload, error = step_handlers[request.step]
            if not payload:
                raise HTTPException(status_code=400, detail=error)
            data = payload.model_dump(mode="json")
            if request.step in ("nda", "contract") and not data.get("signed_at"):
                data["signed_at"] = now.isoformat()
            updates[f"onboarding.{field}"] = data
            updates["onboarding.current_step"] = STEP_FLOW[request.step]
            updates["onboarding.status"] = "in_progress"
        elif request.step == "submit":
            missing = onboarding_missing_keys(onboarding)
            if missing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Complete these steps before submitting: {', '.join(missing)}.",
                )
            updates["onboarding.status"] = "submitted"
            updates["onboarding.current_step"] = "complete"
            updates["onboarding.submitted_at"] = now
            updates["conversion_status"] = "ready"
            await database.audit_logs.insert_one(
                {
                    "candidate_id": candidate_id,
                    "user_id": candidate_id,
                    "email": candidate["email"],
                    "recruiter_id": candidate.get("recruiter_id"),
                    "module": "onboarding",
                    "action": "onboarding_submitted",
                    "outcome": "success",
                    "created_at": now,
                }
            )
            if candidate.get("recruiter_id"):
                await create_notification(
                    recipient_id=candidate["recruiter_id"],
                    recipient_role="recruiter",
                    notif_type="onboarding_submitted",
                    title="Onboarding ready for conversion",
                    message=(
                        f"{candidate['full_name']} completed 100% of onboarding. "
                        "Review and convert them to an employee."
                    ),
                    link="/dashboard/recruiter#conversion-section",
                    related_id=candidate_id,
                )
        else:
            raise HTTPException(status_code=400, detail="Unknown onboarding step.")

        await database.candidates.update_one({"_id": candidate["_id"]}, {"$set": updates})
        refreshed = await database.candidates.find_one({"_id": candidate["_id"]})
        return {
            "message": "Onboarding progress saved."
            if request.step != "submit"
            else "Onboarding submitted successfully. A recruiter will review and convert your profile.",
            "onboarding": refreshed.get("onboarding"),
            "candidate": self._public_user(refreshed),
            "progress": self._progress_payload(refreshed),
        }

    async def attach_uploaded_file(
        self,
        current_user: CurrentUser,
        *,
        purpose: str,
        file_name: str,
        file_url: str,
        doc_type: str | None = None,
    ) -> dict:
        """Store uploaded file path on the candidate draft (or return URL for the wizard)."""
        candidate = await self._require_active_candidate(current_user)
        onboarding = candidate.get("onboarding") or {}
        now = datetime.now(UTC)

        if purpose == "resume":
            resume = dict(onboarding.get("resume") or {})
            resume.update({"file_name": file_name, "file_url": file_url})
            if not resume.get("summary"):
                resume["summary"] = ""
            await database.candidates.update_one(
                {"_id": candidate["_id"]},
                {"$set": {"onboarding.resume": resume, "updated_at": now}},
            )
            refreshed = await database.candidates.find_one({"_id": candidate["_id"]})
            return {
                "message": "File uploaded.",
                "file_name": file_name,
                "file_url": file_url,
                "onboarding": refreshed.get("onboarding"),
            }

        # For government/education certificates the wizard attaches the URL in the
        # subsequent save step — avoid creating incomplete draft documents here.
        return {
            "message": "File uploaded.",
            "file_name": file_name,
            "file_url": file_url,
            "onboarding": onboarding,
            "doc_type": doc_type,
        }

    async def _require_active_candidate(self, current_user: CurrentUser) -> dict:
        candidate = await database.candidates.find_one(
            {
                "$or": [
                    {"user_id": current_user.id},
                    {"email": current_user.email},
                ],
                "status": "active",
            }
        )
        if not candidate:
            converted = await database.candidates.find_one(
                {
                    "$or": [
                        {"user_id": current_user.id},
                        {"email": current_user.email},
                    ],
                    "status": "converted",
                }
            )
            if converted:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="This candidate has already been converted to an employee. Sign in as Employee.",
                )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only verified candidates can access onboarding.",
            )
        return candidate

    # ------------------------------------------------------------------
    # US-019: Onboarding Progress Tracker
    # ------------------------------------------------------------------
    async def get_progress(self, current_user: CurrentUser) -> dict:
        candidate = await self._require_active_candidate(current_user)
        return self._progress_payload(candidate)

    def _progress_payload(self, candidate: dict) -> dict:
        onboarding = candidate.get("onboarding") or {}
        steps = self._task_list(onboarding)
        available_steps = [s for s in steps if s["available"]]
        completed = sum(1 for s in available_steps if s["completed"])
        percentage = round((completed / len(available_steps)) * 100) if available_steps else 0
        return {
            "status": onboarding.get("status", "not_started"),
            "current_step": onboarding.get("current_step", "personal"),
            "percentage": percentage,
            "ready_for_conversion": is_onboarding_complete(onboarding)
            and candidate.get("status") == "active"
            and candidate.get("conversion_status") != "converted",
            "steps": steps,
        }

    def _task_list(self, onboarding: dict) -> list[dict]:
        """US-021: candidate task list, sorted with actionable tasks first."""
        submitted = onboarding.get("status") == "submitted"
        tasks = []
        for task_def in ONBOARDING_TASK_DEFS:
            if task_def["step"] is None:
                completed = False
            elif task_def["step"] == "submit":
                completed = submitted
            else:
                completed = bool(onboarding.get(task_def["step"]))
            tasks.append(
                {
                    "id": task_def["id"],
                    "label": task_def["label"],
                    "completed": completed,
                    "available": task_def["available"],
                    "action_step": task_def["step"] if task_def["available"] and not completed else None,
                }
            )
        tasks.sort(key=lambda t: (t["completed"], not t["available"]))
        return tasks

    # ------------------------------------------------------------------
    # US-018 / US-022: Candidate Dashboard + personalization
    # ------------------------------------------------------------------
    async def get_dashboard(self, current_user: CurrentUser) -> dict:
        candidate = await self._require_active_candidate(current_user)
        onboarding = candidate.get("onboarding") or {}

        recruiter_contact = None
        recruiter_id = candidate.get("recruiter_id")
        if recruiter_id:
            recruiter = await database.recruiters.find_one(
                {
                    "$or": [
                        {"user_id": recruiter_id},
                        {"supabase_user_id": recruiter_id},
                    ]
                }
            )
            if recruiter:
                recruiter_contact = {
                    "full_name": recruiter.get("full_name"),
                    "email": recruiter.get("email"),
                    "phone": recruiter.get("phone"),
                }
            elif candidate.get("recruiter_email"):
                recruiter_contact = {"full_name": None, "email": candidate["recruiter_email"], "phone": None}

        announcements = await database.announcements.find({}).sort("created_at", -1).limit(3).to_list(length=3)

        return {
            "profile": {
                "full_name": candidate.get("full_name"),
                "email": candidate.get("email"),
                "job_title": candidate.get("job_title"),
                "department": candidate.get("department"),
                "office_location": candidate.get("office_location"),
                "start_date": candidate.get("start_date"),
                "initials": self._initials(candidate.get("full_name")),
                "recruiter": recruiter_contact,
                "conversion_status": candidate.get("conversion_status", "pending"),
            },
            "progress": self._progress_payload(candidate),
            "tasks": self._task_list(onboarding),
            "announcements": [
                {
                    "id": str(a["_id"]),
                    "title": a.get("title"),
                    "body": a.get("body"),
                    "created_by_name": a.get("created_by_name"),
                    "created_at": a.get("created_at").isoformat() if a.get("created_at") else None,
                }
                for a in announcements
            ],
        }

    @staticmethod
    def _initials(full_name: str | None) -> str:
        if not full_name:
            return "?"
        parts = [p for p in full_name.split() if p]
        if not parts:
            return "?"
        if len(parts) == 1:
            return parts[0][:2].upper()
        return (parts[0][0] + parts[-1][0]).upper()

    @staticmethod
    def _public_user(candidate: dict) -> dict:
        return {
            "id": candidate.get("user_id") or str(candidate.get("_id", "")),
            "full_name": candidate["full_name"],
            "email": candidate["email"],
            "phone": candidate.get("phone"),
            "role": candidate["role"],
            "job_title": candidate.get("job_title"),
            "department": candidate.get("department"),
            "office_location": candidate.get("office_location"),
            "start_date": candidate.get("start_date"),
            "conversion_status": candidate.get("conversion_status"),
        }

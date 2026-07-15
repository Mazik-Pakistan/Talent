from datetime import UTC, datetime

from fastapi import HTTPException, status
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.core.database import database, supabase
from app.schemas.invitation import CandidateRegisterRequest, OnboardingSaveRequest
from app.services.dashboard_service import create_notification
from app.services.invitation_service import InvitationService

# US-021: candidate-facing onboarding task checklist. The "document_upload" and
# "learning" tasks map to Epic 4 / Epic 5, which are not built yet — they show
# as upcoming instead of pretending to be interactive.
ONBOARDING_TASK_DEFS = [
    {"id": "personal", "label": "Complete personal information", "step": "personal", "available": True},
    {"id": "emergency", "label": "Add emergency contact", "step": "emergency", "available": True},
    {"id": "employment", "label": "Complete bank & payroll details", "step": "employment", "available": True},
    {"id": "documents", "label": "Acknowledge company policies", "step": "documents", "available": True},
    {"id": "submit", "label": "Submit onboarding for review", "step": "submit", "available": True},
    {"id": "document_upload", "label": "Upload identity & education documents", "step": None, "available": False},
    {"id": "learning", "label": "Complete assigned learning", "step": None, "available": False},
]


class CandidateService:
    def __init__(self) -> None:
        self.invitation_service = InvitationService()

    async def register(self, request: CandidateRegisterRequest) -> dict:
        invitation = await self.invitation_service._get_valid_invitation(request.invitation_token)

        if request.email.lower() != invitation["email"].lower():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Use the email address that received this invitation.",
            )

        existing_candidate = await database.candidates.find_one({"email": request.email})
        if existing_candidate:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account already exists for this email address.",
            )

        existing_recruiter = await database.recruiters.find_one({"email": request.email})
        if existing_recruiter:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account already exists for this email address.",
            )

        try:
            response = await run_in_threadpool(
                supabase.auth.sign_up,
                {
                    "email": request.email,
                    "password": request.password,
                    "options": {
                        "data": {
                            "full_name": request.full_name,
                            "phone": request.phone,
                            "role": "candidate",
                            "invitation_token": request.invitation_token,
                        },
                        "email_redirect_to": settings.verification_redirect_url,
                    },
                },
            )
        except Exception as error:
            message = str(error).lower()
            if "already" in message or "registered" in message or "duplicate" in message:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="An account already exists for this email address.",
                ) from error
            if "rate limit" in message:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Email sending is temporarily rate-limited by Supabase. Wait a few minutes, then try again (or use a different email).",
                ) from error
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="We could not create your account. Please try again.",
            ) from error

        if not response.user:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="We could not create your account. Please try again.",
            )

        if response.user.identities == []:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account already exists for this email address.",
            )

        now = datetime.now(UTC)
        candidate = {
            "supabase_user_id": response.user.id,
            "full_name": request.full_name,
            "email": request.email,
            "phone": request.phone,
            "role": "candidate",
            "status": "pending_verification",
            "email_verified_at": None,
            "invitation_token": invitation["token"],
            "job_title": invitation["job_title"],
            "department": invitation["department"],
            "office_location": invitation.get("office_location"),
            "start_date": invitation.get("start_date"),
            "recruiter_id": invitation["recruiter_id"],
            "recruiter_email": invitation.get("recruiter_email"),
            "onboarding": {
                "status": "not_started",
                "current_step": "personal",
                "personal": None,
                "emergency": None,
                "employment": None,
                "documents": None,
                "submitted_at": None,
            },
            "created_at": now,
            "updated_at": now,
        }

        try:
            await database.candidates.insert_one(candidate)
        except Exception as error:
            if "duplicate key" in str(error).lower():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="An account already exists for this email address.",
                ) from error
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Your account could not be saved. Please contact support if this continues.",
            ) from error

        await database.invitations.update_one(
            {"_id": invitation["_id"]},
            {"$set": {"status": "accepted", "updated_at": now}},
        )

        await database.audit_logs.insert_one(
            {
                "candidate_id": response.user.id,
                "email": request.email,
                "module": "authentication",
                "action": "candidate_registered",
                "outcome": "success",
                "created_at": now,
            }
        )

        await create_notification(
            recipient_id=invitation["recruiter_id"],
            recipient_role="recruiter",
            notif_type="candidate_registered",
            title="Candidate registered",
            message=f"{request.full_name} registered and started onboarding.",
            link="/dashboard/recruiter",
            related_id=response.user.id,
        )

        return {
            "message": "Registration successful. Check your inbox to verify your email address.",
            "role": "candidate",
            "redirect_to": "/verify-email",
        }

    async def activate_from_token(self, access_token: str) -> dict | None:
        """Activate a candidate after email verification. Returns None if not a candidate."""
        try:
            response = await run_in_threadpool(supabase.auth.get_user, access_token)
            user = response.user
        except Exception as error:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Your verification session is invalid or has expired.",
            ) from error

        if not user or not user.email_confirmed_at:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Verify your email from the link in your inbox before continuing.",
            )

        candidate = await database.candidates.find_one({"supabase_user_id": user.id})
        if not candidate:
            return None

        if candidate["status"] == "active":
            onboarding_status = (candidate.get("onboarding") or {}).get("status")
            return {
                "message": "Your email has already been verified.",
                "already_verified": True,
                "role": "candidate",
                "redirect_to": "/dashboard/candidate" if onboarding_status == "submitted" else "/onboarding",
                "user": self._public_user(candidate),
            }

        verified_at = datetime.now(UTC)
        await database.candidates.update_one(
            {"_id": candidate["_id"], "status": "pending_verification"},
            {
                "$set": {
                    "status": "active",
                    "email_verified_at": verified_at,
                    "updated_at": verified_at,
                    "onboarding.status": "in_progress",
                }
            },
        )

        if candidate.get("invitation_token"):
            await database.invitations.update_one(
                {"token": candidate["invitation_token"]},
                {"$set": {"status": "used", "used_at": verified_at, "updated_at": verified_at}},
            )

        await database.audit_logs.insert_one(
            {
                "candidate_id": user.id,
                "email": candidate["email"],
                "module": "authentication",
                "action": "candidate_email_verified",
                "outcome": "success",
                "created_at": verified_at,
            }
        )

        candidate["status"] = "active"
        return {
            "message": "Your email has been verified. Continue to onboarding.",
            "already_verified": False,
            "role": "candidate",
            "redirect_to": "/onboarding",
            "user": self._public_user(candidate),
        }

    async def get_onboarding(self, access_token: str) -> dict:
        candidate = await self._require_active_candidate(access_token)
        return {
            "candidate": self._public_user(candidate),
            "onboarding": candidate.get("onboarding")
            or {
                "status": "not_started",
                "current_step": "personal",
                "personal": None,
                "emergency": None,
                "employment": None,
                "documents": None,
                "submitted_at": None,
            },
        }

    async def save_onboarding(self, access_token: str, request: OnboardingSaveRequest) -> dict:
        candidate = await self._require_active_candidate(access_token)
        onboarding = candidate.get("onboarding") or {}

        if onboarding.get("status") == "submitted":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Onboarding has already been submitted.",
            )

        updates: dict = {"updated_at": datetime.now(UTC)}

        if request.step == "personal":
            if not request.personal:
                raise HTTPException(status_code=400, detail="Personal information is required.")
            updates["onboarding.personal"] = request.personal.model_dump(mode="json")
            updates["onboarding.current_step"] = "emergency"
            updates["onboarding.status"] = "in_progress"
        elif request.step == "emergency":
            if not request.emergency:
                raise HTTPException(status_code=400, detail="Emergency contact is required.")
            updates["onboarding.emergency"] = request.emergency.model_dump(mode="json")
            updates["onboarding.current_step"] = "employment"
            updates["onboarding.status"] = "in_progress"
        elif request.step == "employment":
            if not request.employment:
                raise HTTPException(status_code=400, detail="Employment information is required.")
            updates["onboarding.employment"] = request.employment.model_dump(mode="json")
            updates["onboarding.current_step"] = "documents"
            updates["onboarding.status"] = "in_progress"
        elif request.step == "documents":
            if not request.documents:
                raise HTTPException(status_code=400, detail="Document acknowledgements are required.")
            updates["onboarding.documents"] = request.documents.model_dump(mode="json")
            updates["onboarding.current_step"] = "submit"
            updates["onboarding.status"] = "in_progress"
        elif request.step == "submit":
            required = ["personal", "emergency", "employment", "documents"]
            missing = [key for key in required if not onboarding.get(key)]
            if missing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Complete these steps before submitting: {', '.join(missing)}.",
                )
            submitted_at = datetime.now(UTC)
            updates["onboarding.status"] = "submitted"
            updates["onboarding.current_step"] = "complete"
            updates["onboarding.submitted_at"] = submitted_at
            await database.audit_logs.insert_one(
                {
                    "candidate_id": candidate["supabase_user_id"],
                    "email": candidate["email"],
                    "module": "onboarding",
                    "action": "onboarding_submitted",
                    "outcome": "success",
                    "created_at": submitted_at,
                }
            )
            if candidate.get("recruiter_id"):
                await create_notification(
                    recipient_id=candidate["recruiter_id"],
                    recipient_role="recruiter",
                    notif_type="onboarding_submitted",
                    title="Onboarding submitted",
                    message=f"{candidate['full_name']} completed onboarding and is now an employee.",
                    link="/dashboard/recruiter",
                    related_id=candidate["supabase_user_id"],
                )
            await self._ensure_employee_profile(candidate, submitted_at)

        await database.candidates.update_one({"_id": candidate["_id"]}, {"$set": updates})
        refreshed = await database.candidates.find_one({"_id": candidate["_id"]})
        return {
            "message": "Onboarding progress saved."
            if request.step != "submit"
            else "Onboarding submitted successfully.",
            "onboarding": refreshed.get("onboarding"),
            "candidate": self._public_user(refreshed),
        }

    async def _ensure_employee_profile(self, candidate: dict, now: datetime) -> None:
        """After onboarding, create an employee profile so they can sign in as Employee."""
        existing = await database.employees.find_one({"supabase_user_id": candidate["supabase_user_id"]})
        if existing:
            return
        await database.employees.insert_one(
            {
                "supabase_user_id": candidate["supabase_user_id"],
                "full_name": candidate["full_name"],
                "email": candidate["email"],
                "phone": candidate.get("phone"),
                "role": "employee",
                "status": "active",
                "job_title": candidate.get("job_title"),
                "department": candidate.get("department"),
                "office_location": candidate.get("office_location"),
                "start_date": candidate.get("start_date"),
                "recruiter_id": candidate.get("recruiter_id"),
                "candidate_id": candidate["supabase_user_id"],
                "created_at": now,
                "updated_at": now,
            }
        )

    async def _require_active_candidate(self, access_token: str) -> dict:
        try:
            response = await run_in_threadpool(supabase.auth.get_user, access_token)
            user = response.user
        except Exception as error:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required.",
            ) from error

        if not user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")

        candidate = await database.candidates.find_one({"supabase_user_id": user.id})
        if not candidate or candidate["status"] != "active":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only verified candidates can access onboarding.",
            )
        return candidate

    # ------------------------------------------------------------------
    # US-019: Onboarding Progress Tracker
    # ------------------------------------------------------------------
    async def get_progress(self, access_token: str) -> dict:
        candidate = await self._require_active_candidate(access_token)
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
    async def get_dashboard(self, access_token: str) -> dict:
        candidate = await self._require_active_candidate(access_token)
        onboarding = candidate.get("onboarding") or {}

        recruiter_contact = None
        recruiter_id = candidate.get("recruiter_id")
        if recruiter_id:
            recruiter = await database.recruiters.find_one({"supabase_user_id": recruiter_id})
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
            "id": candidate["supabase_user_id"],
            "full_name": candidate["full_name"],
            "email": candidate["email"],
            "phone": candidate["phone"],
            "role": candidate["role"],
            "job_title": candidate.get("job_title"),
            "department": candidate.get("department"),
            "office_location": candidate.get("office_location"),
            "start_date": candidate.get("start_date"),
        }
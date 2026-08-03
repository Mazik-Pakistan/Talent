from datetime import UTC, datetime, timedelta

from bson import ObjectId
from fastapi import HTTPException, status

from app.core.config import settings
from app.core.database import database
from app.core.rbac import CurrentUser
from app.core.security import hash_password
from app.schemas.invitation import CandidateRegisterRequest, OnboardingSaveRequest
from app.services.dashboard_service import create_notification
from app.services.email_service import email_service
from app.services.invitation_service import InvitationService
from app.services import storage_service

# ------------------------------------------------------------------------
# PHASE 2 FLOW: pre-offer INTAKE = personal/contact, education, skills,
# government ID, resume. Post-hire (EmployeeService): emergency, banking,
# references, Self Declaration, policies. Internal career history is recruiter-managed.
# ------------------------------------------------------------------------
ONBOARDING_TASK_DEFS = [
    {
        "id": "personal",
        "label": "Upload ID and complete personal information",
        "step": "personal",
        "requires": ("personal", "government_docs"),
        "available": True,
    },
    {
        "id": "education",
        "label": "Upload transcript and add education history",
        "step": "education",
        "requires": ("education",),
        "available": True,
    },
    {
        "id": "skills",
        "label": "Upload resume and confirm skills",
        "step": "skills",
        "requires": ("skills", "resume"),
        "available": True,
    },
    {
        "id": "submit",
        "label": "Submit profile for HR review",
        "step": "submit",
        "requires": (),
        "available": True,
    },
]

REQUIRED_ONBOARDING_KEYS = [
    "personal",
    "education",
    "skills",
    "government_docs",
    "resume",
]

STEP_FLOW = {
    "personal": "education",
    "education": "skills",
    "skills": "submit",
    # Backward-compatible hidden steps for older clients.
    "government_docs": "resume",
    "resume": "submit",
}


def _announcement_visibility_filter(user_created_at) -> dict | None:
    if not user_created_at:
        return None
    if isinstance(user_created_at, datetime) and user_created_at.tzinfo is None:
        user_created_at = user_created_at.replace(tzinfo=UTC)
    return {"created_at": {"$gte": user_created_at}}


EMPTY_ONBOARDING = {
    "status": "not_started",
    "current_step": "personal",
    "personal": None,
    "emergency": None,
    "employment": None,
    "education": None,
    "skills": None,
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

        offer_for_invite = await database.offer_letters.find_one(
            {"invitation_token": invitation["token"]},
            sort=[("version", -1), ("created_at", -1)],
        )
        is_remote = bool(invitation.get("is_remote") or (offer_for_invite or {}).get("is_remote"))

        from app.services.people_history import (
            find_active_candidate,
            find_active_employee,
            find_active_user,
            prepare_email_for_reinvite,
        )

        await prepare_email_for_reinvite(email)

        active_user = await find_active_user(email)
        if active_user:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account already exists for this email address.",
            )
        if await find_active_candidate(email):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account already exists for this email address.",
            )
        if await find_active_employee(email):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An active employee already exists for this email address.",
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
                    "is_remote": is_remote,
                    "start_date": invitation.get("start_date"),
                    "organization_id": invitation.get("organization_id"),
                    "recruiter_id": invitation["recruiter_id"],
                    "recruiter_email": invitation.get("recruiter_email"),
                    "onboarding": dict(EMPTY_ONBOARDING),
                    "history_bucket": "active",
                    "lifecycle_state": "invited",
                    "cycle_group_key": email,
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
        from app.services.offer_service import offer_service

        offer_signed = await offer_service.has_signed_offer(
            candidate.get("user_id") or str(candidate["_id"]),
            candidate.get("email"),
        )
        onboarding = await self._backfill_onboarding_files(current_user, candidate)
        return {
            "candidate": self._public_user(candidate),
            "onboarding": onboarding,
            "progress": self._progress_payload({**candidate, "onboarding": onboarding}),
            "offer_signed": offer_signed,
        }

    async def _backfill_onboarding_files(self, current_user: CurrentUser, candidate: dict) -> dict:
        """Restore file URLs from active documents when onboarding form slots are blank.

        Happens when a candidate uploaded a transcript/resume/CNIC then logged out
        without saving the step — the file lives in `documents` but the form looked empty.
        """
        onboarding = dict(candidate.get("onboarding") or EMPTY_ONBOARDING)
        docs = (
            await database.documents.find(
                {
                    "owner_id": current_user.id,
                    "is_active": True,
                    "doc_type": {"$in": ["transcript", "certificate", "degree", "resume", "cnic", "passport"]},
                }
            )
            .sort("created_at", -1)
            .to_list(40)
        )
        if not docs:
            return onboarding

        changed = False
        now = datetime.now(UTC)

        edu_docs = [d for d in docs if d.get("doc_type") in ("transcript", "certificate", "degree")]
        if edu_docs:
            education = dict(onboarding.get("education") or {})
            entries = list(education.get("entries") or [])
            if not entries:
                entries = [
                    {
                        "institution": "",
                        "city": "",
                        "board_university": "",
                        "degree": "",
                        "field_of_study": "",
                        "year_completed": "",
                        "cgpa_or_percentage": "",
                        "certificate_file": edu_docs[0].get("file_url"),
                    }
                ]
                changed = True
            elif not entries[0].get("certificate_file"):
                entries[0]["certificate_file"] = edu_docs[0].get("file_url")
                changed = True
            education["entries"] = entries
            onboarding["education"] = education

        resume_doc = next((d for d in docs if d.get("doc_type") == "resume"), None)
        if resume_doc:
            resume = dict(onboarding.get("resume") or {})
            if not resume.get("file_url"):
                resume["file_url"] = resume_doc.get("file_url")
                resume["file_name"] = resume_doc.get("file_name") or resume.get("file_name")
                if resume.get("summary") is None:
                    resume["summary"] = ""
                onboarding["resume"] = resume
                changed = True

        id_doc = next((d for d in docs if d.get("doc_type") in ("cnic", "passport")), None)
        if id_doc:
            government = dict(onboarding.get("government_docs") or {})
            documents = list(government.get("documents") or [])
            if not documents:
                documents = [
                    {
                        "doc_type": id_doc.get("doc_type") or "cnic",
                        "document_number": "pending",
                        "file_name": id_doc.get("file_name"),
                        "file_url": id_doc.get("file_url"),
                    }
                ]
                changed = True
            elif not documents[0].get("file_url"):
                documents[0]["file_url"] = id_doc.get("file_url")
                documents[0]["file_name"] = id_doc.get("file_name") or documents[0].get("file_name")
                changed = True
            government["documents"] = documents
            onboarding["government_docs"] = government

        if changed:
            await database.candidates.update_one(
                {"_id": candidate["_id"]},
                {"$set": {"onboarding": onboarding, "updated_at": now}},
            )
        return onboarding

    async def save_onboarding(self, current_user: CurrentUser, request: OnboardingSaveRequest) -> dict:
        candidate = await self._require_active_candidate(current_user)
        onboarding = candidate.get("onboarding") or {}

        from app.services.offer_service import offer_service

        candidate_id_early = candidate.get("user_id") or str(candidate["_id"])
        if not await offer_service.has_signed_offer(candidate_id_early, candidate.get("email")):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Sign your offer letter before uploading documents and completing your profile.",
            )

        # ✅ MODIFIED: Only block if already submitted AND trying to resubmit
        if onboarding.get("status") == "submitted" and request.step == "submit":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Onboarding has already been submitted. You cannot resubmit, but you can edit your information.",
            )

        updates: dict = {"updated_at": datetime.now(UTC)}
        candidate_id = candidate.get("user_id") or str(candidate["_id"])
        now = datetime.now(UTC)

        step_handlers = {
            "personal": (
                ("personal", request.personal, "Personal information is required."),
                ("government_docs", request.government_docs, "Upload a National ID or Passport before continuing."),
            ),
            "education": (
                ("education", request.education, "Education history is required."),
            ),
            "skills": (
                ("skills", request.skills, "Skills & certifications are required."),
                ("resume", request.resume, "Upload a Resume/CV before continuing."),
            ),
            # Backward-compatible endpoints for older clients.
            "government_docs": (
                ("government_docs", request.government_docs, "Government documents are required."),
            ),
            "resume": (
                ("resume", request.resume, "Resume upload is required."),
            ),
        }

        if request.step in step_handlers:
            saved_fields = []
            for field, payload, error in step_handlers[request.step]:
                if not payload:
                    raise HTTPException(status_code=400, detail=error)
                data = payload.model_dump(mode="json")
                if field == "education":
                    entries = data.get("entries") or []
                    if not entries:
                        raise HTTPException(status_code=400, detail="Add at least one education entry.")
                    # Transcripts are optional — file can be uploaded later or replaced anytime.
                updates[f"onboarding.{field}"] = data
                saved_fields.append(field)
            updates["onboarding.current_step"] = STEP_FLOW[request.step]
            if onboarding.get("status") != "submitted":
                updates["onboarding.status"] = "in_progress"
            await database.audit_logs.insert_one(
                {
                    "candidate_id": candidate_id,
                    "user_id": candidate_id,
                    "email": candidate["email"],
                    "recruiter_id": candidate.get("recruiter_id"),
                    "module": "onboarding",
                    "action": f"onboarding_{'_and_'.join(saved_fields)}_saved",
                    "outcome": "success",
                    "actor_email": current_user.email,
                    "created_at": now,
                }
            )
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
            updates["conversion_status"] = "intake_submitted"
            await database.audit_logs.insert_one(
                {
                    "candidate_id": candidate_id,
                    "user_id": candidate_id,
                    "email": candidate["email"],
                    "recruiter_id": candidate.get("recruiter_id"),
                    "module": "onboarding",
                    "action": "intake_submitted",
                    "outcome": "success",
                    "actor_email": current_user.email,
                    "created_at": now,
                }
            )
            if candidate.get("recruiter_id"):
                await create_notification(
                    recipient_id=candidate["recruiter_id"],
                    recipient_role="recruiter",
                    notif_type="intake_submitted",
                    title="Candidate ready for IT provisioning",
                    message=(
                        f"{candidate['full_name']} completed their profile and documents. "
                        "Send IT provisioning, then activate their employee account."
                    ),
                    link="/dashboard/recruiter/candidates",
                    related_id=candidate_id,
                )
                recruiter = await database.recruiters.find_one({"user_id": candidate["recruiter_id"]}) or {}
                to_email = recruiter.get("email")
                if to_email:
                    try:
                        email_service.send_profile_complete_for_it(
                            to_email=to_email,
                            recruiter_name=recruiter.get("full_name") or "Recruiter",
                            candidate_name=candidate.get("full_name") or "Candidate",
                            candidate_email=candidate.get("email") or "",
                            job_title=candidate.get("job_title") or "",
                        )
                    except Exception:
                        pass
        else:
            raise HTTPException(status_code=400, detail="Unknown onboarding step.")

        await database.candidates.update_one({"_id": candidate["_id"]}, {"$set": updates})
        refreshed = await database.candidates.find_one({"_id": candidate["_id"]})
        return {
            "message": "Onboarding progress saved."
            if request.step != "submit"
            else "Profile submitted. Your recruiter has been notified to start IT provisioning.",
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
        index: int = 0,
    ) -> dict:
        """Store uploaded file path on the candidate draft (or return URL for the wizard)."""
        candidate = await self._require_active_candidate(current_user)
        from app.services.offer_service import offer_service

        if not await offer_service.has_signed_offer(
            candidate.get("user_id") or str(candidate["_id"]),
            candidate.get("email"),
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Sign your offer letter before uploading documents.",
            )
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

        if purpose == "government_doc":
            government = dict(onboarding.get("government_docs") or {})
            documents = list(government.get("documents") or [])
            target_type = doc_type if doc_type in ("cnic", "passport") else "cnic"
            updated = False
            for item in documents:
                if item.get("doc_type") == target_type:
                    item["file_name"] = file_name
                    item["file_url"] = file_url
                    updated = True
                    break
            if not updated:
                documents.append(
                    {
                        "doc_type": target_type,
                        "document_number": "pending",
                        "file_name": file_name,
                        "file_url": file_url,
                    }
                )
            government["documents"] = documents
            await database.candidates.update_one(
                {"_id": candidate["_id"]},
                {"$set": {"onboarding.government_docs": government, "updated_at": now}},
            )
            refreshed = await database.candidates.find_one({"_id": candidate["_id"]})
            return {
                "message": "File uploaded.",
                "file_name": file_name,
                "file_url": file_url,
                "onboarding": refreshed.get("onboarding"),
            }

        if purpose == "education_cert":
            education = dict(onboarding.get("education") or {})
            entries = list(education.get("entries") or [])
            while len(entries) <= index:
                entries.append(
                    {
                        "institution": "",
                        "city": "",
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
            await database.candidates.update_one(
                {"_id": candidate["_id"]},
                {"$set": {"onboarding.education": education, "updated_at": now}},
            )
            refreshed = await database.candidates.find_one({"_id": candidate["_id"]})
            return {
                "message": "File uploaded.",
                "file_name": file_name,
                "file_url": file_url,
                "onboarding": refreshed.get("onboarding"),
            }

        if purpose == "skill_cert":
            skills = dict(onboarding.get("skills") or {})
            certifications = list(skills.get("certifications") or [])
            while len(certifications) <= index:
                certifications.append({"name": "", "document_url": None, "expiry_date": ""})
            entry = dict(certifications[index] or {})
            entry["document_url"] = file_url
            if not entry.get("name"):
                entry["name"] = ""
            if "expiry_date" not in entry:
                entry["expiry_date"] = ""
            certifications[index] = entry
            skills["certifications"] = certifications
            skills.setdefault("technical_skills", [])
            skills.setdefault("soft_skills", [])
            skills.setdefault("languages", [])
            await database.candidates.update_one(
                {"_id": candidate["_id"]},
                {"$set": {"onboarding.skills": skills, "updated_at": now}},
            )
            refreshed = await database.candidates.find_one({"_id": candidate["_id"]})
            return {
                "message": "Certificate uploaded. Recruiters can open the document URL to review it.",
                "file_name": file_name,
                "file_url": file_url,
                "document_url": file_url,
                "onboarding": refreshed.get("onboarding"),
            }

        # Preserve the existing return shape for any other wizard attachments.
        return {
            "message": "File uploaded.",
            "file_name": file_name,
            "file_url": file_url,
            "onboarding": onboarding,
            "doc_type": doc_type,
        }

    async def clear_uploaded_file(
        self,
        current_user: CurrentUser,
        *,
        purpose: str,
        index: int = 0,
    ) -> dict:
        """Remove an onboarding file slot and deactivate matching active documents."""
        candidate = await self._require_active_candidate(current_user)
        onboarding = dict(candidate.get("onboarding") or {})
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
            active_docs = await database.documents.find(
                {
                    "owner_id": current_user.id,
                    "doc_type": {"$in": doc_types},
                    "is_active": True,
                }
            ).to_list(length=50)
            for doc in active_docs:
                await storage_service.delete_file(doc)
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

        await database.candidates.update_one(
            {"_id": candidate["_id"]},
            {"$set": {"onboarding": onboarding, "updated_at": now}},
        )
        refreshed = await database.candidates.find_one({"_id": candidate["_id"]})
        return {"message": "Document removed.", "onboarding": refreshed.get("onboarding")}

    # Allowed scalar fields that the AI assistant may update individually without
    # requiring a full step save (which needs all co-fields like government_docs).
    _PERSONAL_SCALAR_FIELDS = frozenset(
        {
            "first_name",
            "last_name",
            "date_of_birth",
            "gender",
            "nationality",
            "marital_status",
            "blood_group",
            "father_name",
            "alternate_phone",
            "current_address",
            "permanent_address",
            "same_as_current",
            "city",
            "state",
            "postal_code",
            "country",
        }
    )

    async def partial_update_personal(
        self,
        current_user: CurrentUser,
        fields: dict,
    ) -> dict:
        """Persist a subset of personal-info fields supplied by the AI assistant.

        This is intentionally a *merge* — it touches only the keys in ``fields``
        and leaves every other ``onboarding.personal`` field untouched.  It does
        NOT run the full step-save validation pipeline (which requires a signed
        offer and a government ID doc to be present), so the candidate can tell
        the assistant their name or gender before they have uploaded their CNIC.

        Only keys in ``_PERSONAL_SCALAR_FIELDS`` are accepted; unknown keys are
        silently dropped so the LLM cannot accidentally overwrite sensitive data.
        """
        candidate = await self._require_active_candidate(current_user)
        safe_fields = {
            k: v for k, v in fields.items()
            if k in self._PERSONAL_SCALAR_FIELDS and v not in (None, "")
        }
        if not safe_fields:
            return {"message": "No recognised personal fields to update.", "updated": {}}

        # Start from whatever is already saved so we merge, not overwrite.
        onboarding = candidate.get("onboarding") or {}
        existing_personal = dict(onboarding.get("personal") or {})
        existing_personal.update(safe_fields)

        now = datetime.now(UTC)
        await database.candidates.update_one(
            {"_id": candidate["_id"]},
            {
                "$set": {
                    "onboarding.personal": existing_personal,
                    "updated_at": now,
                }
            },
        )
        return {"message": "Profile updated.", "updated": safe_fields}

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
        missing_fields = onboarding_missing_keys(onboarding)
        return {
            "status": onboarding.get("status", "not_started"),
            "current_step": onboarding.get("current_step", "personal"),
            "percentage": percentage,
            "missing_fields": missing_fields,
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
                required_sections = task_def.get("requires") or (task_def["step"],)
                completed = all(bool(onboarding.get(section)) for section in required_sections)
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

        candidate_id = candidate.get("user_id") or str(candidate.get("_id") or "")
        announcement_query = {"$and": [
            {"$or": [{"audience": {"$in": ["candidates", "both"]}}, {"audience": {"$exists": False}}]},
            {"$or": [
                {"target_candidate_ids": {"$exists": False}},
                {"target_candidate_ids": {"$size": 0}},
                {"target_candidate_ids": candidate_id},
            ]},
        ]}
        visibility_cutoff = candidate.get("created_at")
        if not visibility_cutoff and ObjectId.is_valid(current_user.id):
            user_doc = await database.users.find_one({"_id": ObjectId(current_user.id)}, {"created_at": 1})
            visibility_cutoff = user_doc.get("created_at") if user_doc else None
        visibility_filter = _announcement_visibility_filter(visibility_cutoff)
        if visibility_filter:
            announcement_query["$and"].append(visibility_filter)
        announcements = (
            await database.announcements.find(
                announcement_query
            )
            .sort("created_at", -1)
            .limit(3)
            .to_list(length=3)
        )

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

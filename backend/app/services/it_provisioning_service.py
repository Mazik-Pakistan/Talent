"""IT provisioning — recruiter requests IT setup before employee activation.

Flow: signed offer → recruiter emails IT public link → IT submits email/assets
→ recruiter may Approve & activate. Password is stored encrypted (Fernet).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from secrets import token_urlsafe, randbelow
from uuid import uuid4

from bson import ObjectId
from fastapi import HTTPException, status

from app.core.config import settings
from app.core.crypto import decrypt_text, encrypt_text
from app.core.database import database
from app.core.rbac import CurrentUser
from app.schemas.it_provisioning import (
    BulkRemindItProvisioningRequest,
    BulkSendItProvisioningRequest,
    ItProvisioningSubmitRequest,
    RemindItProvisioningRequest,
    SendItProvisioningRequest,
)
from app.services.dashboard_service import create_notification
from app.services.email_service import email_service


def _generate_otp() -> str:
    return f"{randbelow(1_000_000):06d}"


def _iso(value):
    return value.isoformat() if hasattr(value, "isoformat") else value


class ItProvisioningService:
    async def send_request(self, current_user: CurrentUser, request: SendItProvisioningRequest) -> dict:
        offer = await self._find_offer(request.offer_id)
        self._assert_recruiter_owns_offer(current_user, offer)
        if offer.get("status") != "signed":
            raise HTTPException(
                status_code=409,
                detail=f"Offer must be signed before requesting IT setup (status: {offer.get('status')}).",
            )

        candidate = await self._find_candidate(offer["candidate_id"])
        if not candidate:
            raise HTTPException(status_code=404, detail="Candidate not found.")
        if candidate.get("status") == "converted":
            raise HTTPException(status_code=409, detail="This candidate is already an employee.")

        it_email = (str(request.it_manager_email or settings.IT_MANAGER_EMAIL or "")).strip().lower()
        if not it_email:
            raise HTTPException(
                status_code=400,
                detail="Provide an IT manager email, or set IT_MANAGER_EMAIL in the server configuration.",
            )

        now = datetime.now(UTC)
        existing = await database.it_provisioning_requests.find_one(
            {
                "offer_id": str(offer["_id"]),
                "status": {"$in": ["pending", "submitted"]},
            }
        )

        snapshot = self._employee_snapshot(candidate, offer)
        expires_at = now + timedelta(days=settings.IT_PROVISIONING_EXPIRE_DAYS)

        if existing and existing.get("status") == "submitted":
            raise HTTPException(
                status_code=409,
                detail="IT has already submitted provisioning for this offer. You can activate the employee.",
            )

        if existing:
            token = existing["token"]
            await database.it_provisioning_requests.update_one(
                {"_id": existing["_id"]},
                {
                    "$set": {
                        "it_manager_email": it_email,
                        "employee_snapshot": snapshot,
                        "recruiter_note": request.note,
                        "expires_at": expires_at,
                        "updated_at": now,
                        "last_sent_at": now,
                    },
                    "$inc": {"send_count": 1},
                },
            )
            doc = {**existing, "it_manager_email": it_email, "token": token}
        else:
            token = token_urlsafe(32)
            doc = {
                "token": token,
                "offer_id": str(offer["_id"]),
                "candidate_id": offer["candidate_id"],
                "candidate_email": candidate.get("email"),
                "recruiter_id": current_user.id,
                "recruiter_email": current_user.email,
                "recruiter_name": current_user.full_name,
                "recruiter_note": request.note,
                "it_manager_email": it_email,
                "status": "pending",
                "employee_snapshot": snapshot,
                "company_email": None,
                "company_email_password_encrypted": None,
                "assets": [],
                "licenses": [],
                "it_notes": None,
                "submitted_by_name": None,
                "submitted_at": None,
                "send_count": 1,
                "remind_count": 0,
                "last_sent_at": now,
                "last_reminded_at": None,
                "expires_at": expires_at,
                "created_at": now,
                "updated_at": now,
            }
            await database.it_provisioning_requests.insert_one(doc)

        link = settings.it_provisioning_link(token)
        email_sent = False
        email_error = None
        try:
            email_service.send_it_provisioning_request(
                to_email=it_email,
                recruiter_name=current_user.full_name,
                employee=snapshot,
                form_link=link,
                expires_at=expires_at.strftime("%B %d, %Y at %H:%M UTC"),
                note=request.note,
                is_reminder=False,
            )
            email_sent = True
        except Exception as exc:
            email_error = str(exc)

        await create_notification(
            recipient_id=current_user.id,
            recipient_role=current_user.role if current_user.role in ("recruiter", "super_admin") else "recruiter",
            notif_type="it_provisioning_sent",
            title="IT provisioning requested",
            message=f"IT setup request for {snapshot.get('full_name')} sent to {it_email}.",
            link="/dashboard/recruiter/candidates",
            related_id=str(offer["_id"]),
        )

        await database.audit_logs.insert_one(
            {
                "user_id": current_user.id,
                "candidate_id": offer["candidate_id"],
                "email": current_user.email,
                "actor_email": current_user.email,
                "module": "it_provisioning",
                "action": "it_provisioning_sent",
                "outcome": "success" if email_sent else "partial",
                "created_at": now,
            }
        )

        message = (
            f"IT provisioning request emailed to {it_email}."
            if email_sent
            else f"Request created, but email to {it_email} failed. Copy the link to share manually."
        )
        return {
            "message": message,
            "email_sent": email_sent,
            "email_error": email_error,
            "provisioning": self._public_status(doc if existing else {**doc, "token": token}),
            "form_link": link,
        }

    async def bulk_send(self, current_user: CurrentUser, request: BulkSendItProvisioningRequest) -> dict:
        sent: list[dict] = []
        failed: list[dict] = []
        for offer_id in request.offer_ids:
            try:
                result = await self.send_request(
                    current_user,
                    SendItProvisioningRequest(
                        offer_id=offer_id,
                        it_manager_email=request.it_manager_email,
                        note=request.note,
                    ),
                )
                sent.append(
                    {
                        "offer_id": offer_id,
                        "email_sent": result.get("email_sent", False),
                        "form_link": result.get("form_link"),
                        "message": result.get("message"),
                        "employee_name": ((result.get("provisioning") or {}).get("employee_name")),
                        "it_manager_email": ((result.get("provisioning") or {}).get("it_manager_email")),
                    }
                )
            except HTTPException as exc:
                failed.append({"offer_id": offer_id, "error": str(exc.detail)})
            except Exception as exc:  # noqa: BLE001
                failed.append({"offer_id": offer_id, "error": str(exc)})

        return {
            "message": f"Bulk IT send finished — sent {len(sent)}, failed {len(failed)}.",
            "sent": sent,
            "failed": failed,
            "summary": {"sent": len(sent), "failed": len(failed)},
        }

    async def bulk_remind(self, current_user: CurrentUser, request: BulkRemindItProvisioningRequest) -> dict:
        sent: list[dict] = []
        failed: list[dict] = []
        for offer_id in request.offer_ids:
            try:
                result = await self.remind(
                    current_user,
                    RemindItProvisioningRequest(offer_id=offer_id, note=request.note),
                )
                sent.append(
                    {
                        "offer_id": offer_id,
                        "email_sent": result.get("email_sent", False),
                        "form_link": result.get("form_link"),
                        "message": result.get("message"),
                    }
                )
            except HTTPException as exc:
                failed.append({"offer_id": offer_id, "error": str(exc.detail)})
            except Exception as exc:  # noqa: BLE001
                failed.append({"offer_id": offer_id, "error": str(exc)})

        return {
            "message": f"Bulk IT follow-up finished — sent {len(sent)}, failed {len(failed)}.",
            "sent": sent,
            "failed": failed,
            "summary": {"sent": len(sent), "failed": len(failed)},
        }

    async def remind(self, current_user: CurrentUser, request: RemindItProvisioningRequest) -> dict:
        offer = await self._find_offer(request.offer_id)
        self._assert_recruiter_owns_offer(current_user, offer)

        doc = await database.it_provisioning_requests.find_one(
            {"offer_id": str(offer["_id"]), "status": {"$in": ["pending", "submitted"]}}
        )
        if not doc:
            raise HTTPException(
                status_code=404,
                detail="No IT provisioning request found. Send the IT email first.",
            )
        if doc.get("status") == "submitted":
            raise HTTPException(status_code=409, detail="IT has already submitted this form.")

        now = datetime.now(UTC)
        if doc.get("expires_at"):
            expires = doc["expires_at"]
            if getattr(expires, "tzinfo", None) is None:
                expires = expires.replace(tzinfo=UTC)
            if now > expires:
                raise HTTPException(status_code=410, detail="This IT provisioning link has expired. Send a new request.")

        link = settings.it_provisioning_link(doc["token"])
        snapshot = doc.get("employee_snapshot") or self._employee_snapshot(
            await self._find_candidate(offer["candidate_id"]) or {},
            offer,
        )
        it_email = doc.get("it_manager_email")
        email_sent = False
        email_error = None
        try:
            email_service.send_it_provisioning_request(
                to_email=it_email,
                recruiter_name=current_user.full_name,
                employee=snapshot,
                form_link=link,
                expires_at=_iso(doc.get("expires_at")),
                note=request.note,
                is_reminder=True,
            )
            email_sent = True
        except Exception as exc:
            email_error = str(exc)

        await database.it_provisioning_requests.update_one(
            {"_id": doc["_id"]},
            {
                "$set": {"last_reminded_at": now, "updated_at": now, "recruiter_note": request.note},
                "$inc": {"remind_count": 1},
            },
        )

        return {
            "message": (
                f"Follow-up emailed to {it_email}."
                if email_sent
                else f"Could not send follow-up email to {it_email}."
            ),
            "email_sent": email_sent,
            "email_error": email_error,
            "provisioning": self._public_status({**doc, "remind_count": (doc.get("remind_count") or 0) + 1}),
            "form_link": link,
        }

    async def get_public(self, token: str) -> dict:
        doc = await self._find_by_token(token)
        now = datetime.now(UTC)
        expires = doc.get("expires_at")
        if expires:
            if getattr(expires, "tzinfo", None) is None:
                expires = expires.replace(tzinfo=UTC)
            if now > expires and doc.get("status") != "submitted":
                raise HTTPException(status_code=410, detail="This IT provisioning link has expired.")

        snapshot = doc.get("employee_snapshot") or {}
        return {
            "status": doc.get("status"),
            "already_submitted": doc.get("status") == "submitted",
            "expires_at": _iso(doc.get("expires_at")),
            "employee": {
                "full_name": snapshot.get("full_name"),
                "personal_email": snapshot.get("email"),
                "job_title": snapshot.get("job_title"),
                "department": snapshot.get("department"),
                "office_location": snapshot.get("office_location"),
                "start_date": snapshot.get("start_date"),
                "reporting_manager": snapshot.get("reporting_manager"),
                "employment_type": snapshot.get("employment_type"),
                "phone": snapshot.get("phone"),
            },
            "recruiter_name": doc.get("recruiter_name"),
            "recruiter_note": doc.get("recruiter_note"),
            "submitted_summary": (
                {
                    "company_email": doc.get("company_email"),
                    "assets_count": len(doc.get("assets") or []),
                    "licenses_count": len(doc.get("licenses") or []),
                    "asset_names": [a.get("name") for a in (doc.get("assets") or []) if a.get("name")],
                    "license_names": [l.get("name") for l in (doc.get("licenses") or []) if l.get("name")],
                    "submitted_at": _iso(doc.get("submitted_at")),
                    "submitted_by_name": doc.get("submitted_by_name"),
                }
                if doc.get("status") == "submitted"
                else None
            ),
        }

    async def submit_public(self, token: str, request: ItProvisioningSubmitRequest) -> dict:
        doc = await self._find_by_token(token)
        if doc.get("status") == "submitted":
            raise HTTPException(status_code=409, detail="This form has already been submitted.")
        if doc.get("status") not in (None, "pending"):
            raise HTTPException(status_code=409, detail="This provisioning request is no longer open.")

        now = datetime.now(UTC)
        expires = doc.get("expires_at")
        if expires:
            if getattr(expires, "tzinfo", None) is None:
                expires = expires.replace(tzinfo=UTC)
            if now > expires:
                raise HTTPException(status_code=410, detail="This IT provisioning link has expired.")

        assets = []
        for item in request.assets:
            assets.append(
                {
                    "id": str(uuid4()),
                    "name": item.name,
                    "asset_type": item.asset_type,
                    "serial_number": item.serial_number,
                    "notes": item.notes,
                    "status": "assigned",
                    "assigned_at": now,
                    "assigned_by": "it",
                    "assigned_by_email": doc.get("it_manager_email"),
                }
            )

        licenses = [
            {
                "id": str(uuid4()),
                "name": lic.name,
                "vendor": lic.vendor,
                "notes": lic.notes,
            }
            for lic in request.licenses
        ]

        company_email = str(request.company_email).strip().lower()
        encrypted_password = encrypt_text(request.company_email_password)

        await database.it_provisioning_requests.update_one(
            {"_id": doc["_id"]},
            {
                "$set": {
                    "status": "submitted",
                    "company_email": company_email,
                    "company_email_password_encrypted": encrypted_password,
                    "assets": assets,
                    "licenses": licenses,
                    "it_notes": request.it_notes,
                    "submitted_by_name": request.submitted_by_name,
                    "submitted_at": now,
                    "updated_at": now,
                }
            },
        )

        snapshot = doc.get("employee_snapshot") or {}
        recruiter_id = doc.get("recruiter_id")
        if recruiter_id:
            await create_notification(
                recipient_id=recruiter_id,
                recipient_role="recruiter",
                notif_type="it_provisioning_submitted",
                title="IT provisioning complete",
                message=(
                    f"IT submitted company email and assets for {snapshot.get('full_name')}. "
                    "You can now Approve & activate."
                ),
                link="/dashboard/recruiter/candidates",
                related_id=doc.get("offer_id"),
            )

        try:
            if doc.get("recruiter_email"):
                email_service.send_it_provisioning_complete(
                    to_email=doc["recruiter_email"],
                    employee_name=snapshot.get("full_name") or "the candidate",
                    company_email=company_email,
                    assets_count=len(assets),
                    licenses_count=len(licenses),
                )
        except Exception:
            pass

        await database.audit_logs.insert_one(
            {
                "candidate_id": doc.get("candidate_id"),
                "email": doc.get("it_manager_email"),
                "module": "it_provisioning",
                "action": "it_provisioning_submitted",
                "outcome": "success",
                "created_at": now,
            }
        )

        return {
            "message": "IT provisioning submitted. The recruiter can now activate the employee account.",
            "company_email": company_email,
            "assets_count": len(assets),
            "licenses_count": len(licenses),
            "asset_names": [a.get("name") for a in assets if a.get("name")],
            "license_names": [l.get("name") for l in licenses if l.get("name")],
            "employee_name": (doc.get("employee_snapshot") or {}).get("full_name"),
            "submitted_by_name": request.submitted_by_name,
        }

    async def get_for_offer(self, offer_id: str) -> dict | None:
        doc = await database.it_provisioning_requests.find_one(
            {"offer_id": str(offer_id), "status": {"$in": ["pending", "submitted", "applied"]}},
            sort=[("created_at", -1)],
        )
        if not doc:
            return None
        return self._public_status(doc)

    async def require_submitted_for_candidate(self, candidate_id: str, offer_id: str | None = None) -> dict:
        """Used by activation — returns submitted provisioning or raises 400."""
        if offer_id:
            doc = await database.it_provisioning_requests.find_one(
                {"offer_id": str(offer_id), "status": "submitted"},
                sort=[("submitted_at", -1)],
            )
            if doc:
                return doc

        doc = await database.it_provisioning_requests.find_one(
            {
                "candidate_id": candidate_id,
                "status": "submitted",
            },
            sort=[("submitted_at", -1)],
        )
        if not doc:
            # Also allow lookup by alternate candidate id forms
            query_or = [{"candidate_id": candidate_id}]
            candidate = await self._find_candidate(candidate_id)
            if candidate:
                alt = candidate.get("user_id") or str(candidate.get("_id", ""))
                if alt and alt != candidate_id:
                    query_or.append({"candidate_id": alt})
                if candidate.get("email"):
                    query_or.append({"candidate_email": candidate["email"].lower()})
            doc = await database.it_provisioning_requests.find_one(
                {"$or": query_or, "status": "submitted"},
                sort=[("submitted_at", -1)],
            )
        if not doc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "IT must assign a company email and assets before activation. "
                    "Send the IT provisioning request and wait for their form submission."
                ),
            )
        return doc

    async def mark_applied(self, provisioning_id, employee_id: str) -> None:
        await database.it_provisioning_requests.update_one(
            {"_id": provisioning_id},
            {
                "$set": {
                    "status": "applied",
                    "applied_employee_id": employee_id,
                    "applied_at": datetime.now(UTC),
                    "updated_at": datetime.now(UTC),
                }
            },
        )

    async def request_password_otp(self, current_user: CurrentUser) -> dict:
        employee = await self._find_employee_for_user(current_user)
        if not employee.get("company_email_password_encrypted"):
            raise HTTPException(
                status_code=404,
                detail="No company email password is on file for your account.",
            )

        personal_email = (employee.get("email") or current_user.email or "").lower()
        if not personal_email:
            raise HTTPException(status_code=400, detail="Personal email is required to verify OTP.")

        otp = _generate_otp()
        now = datetime.now(UTC)
        expires_at = now + timedelta(minutes=settings.OTP_EXPIRE_MINUTES)

        await database.company_email_password_otps.replace_one(
            {"user_id": current_user.id},
            {
                "user_id": current_user.id,
                "employee_id": employee.get("employee_id"),
                "email": personal_email,
                "otp": otp,
                "otp_expires_at": expires_at,
                "created_at": now,
            },
            upsert=True,
        )

        try:
            email_service.send_company_email_password_otp(
                to_email=personal_email,
                full_name=employee.get("full_name") or current_user.full_name or "there",
                otp=otp,
            )
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Could not send OTP email: {exc}",
            ) from exc

        return {
            "message": f"A verification code was sent to {personal_email}.",
            "email_hint": self._mask_email(personal_email),
            "expires_in_minutes": settings.OTP_EXPIRE_MINUTES,
        }

    async def reveal_password(self, current_user: CurrentUser, otp: str) -> dict:
        employee = await self._find_employee_for_user(current_user)
        encrypted = employee.get("company_email_password_encrypted")
        if not encrypted:
            raise HTTPException(status_code=404, detail="No company email password is on file.")

        pending = await database.company_email_password_otps.find_one({"user_id": current_user.id})
        if not pending:
            raise HTTPException(status_code=400, detail="Request a verification code first.")

        expires = pending.get("otp_expires_at")
        if expires and getattr(expires, "tzinfo", None) is None:
            expires = expires.replace(tzinfo=UTC)
        if not expires or datetime.now(UTC) > expires:
            raise HTTPException(status_code=400, detail="Verification code expired. Request a new one.")

        if str(pending.get("otp") or "") != otp.strip():
            raise HTTPException(status_code=400, detail="Invalid verification code.")

        await database.company_email_password_otps.delete_one({"user_id": current_user.id})

        password = decrypt_text(encrypted)
        return {
            "company_email": employee.get("company_email"),
            "password": password,
            "message": "Password revealed. Store it securely — it will not stay visible.",
        }

    def _public_status(self, doc: dict) -> dict:
        return {
            "status": doc.get("status") or "pending",
            "it_manager_email": doc.get("it_manager_email"),
            "sent_at": _iso(doc.get("last_sent_at") or doc.get("created_at")),
            "last_reminded_at": _iso(doc.get("last_reminded_at")),
            "remind_count": doc.get("remind_count") or 0,
            "send_count": doc.get("send_count") or 1,
            "submitted_at": _iso(doc.get("submitted_at")),
            "company_email": doc.get("company_email") if doc.get("status") in ("submitted", "applied") else None,
            "assets_count": len(doc.get("assets") or []) if doc.get("status") in ("submitted", "applied") else 0,
            "licenses_count": len(doc.get("licenses") or []) if doc.get("status") in ("submitted", "applied") else 0,
            "expires_at": _iso(doc.get("expires_at")),
            "form_link": settings.it_provisioning_link(doc["token"]) if doc.get("token") else None,
            "is_complete": doc.get("status") in ("submitted", "applied"),
        }

    @staticmethod
    def _employee_snapshot(candidate: dict, offer: dict) -> dict:
        return {
            "full_name": candidate.get("full_name") or offer.get("candidate_name"),
            "email": candidate.get("email") or offer.get("candidate_email"),
            "phone": candidate.get("phone"),
            "job_title": offer.get("job_title") or candidate.get("job_title"),
            "department": offer.get("department") or candidate.get("department"),
            "office_location": offer.get("office_location") or candidate.get("office_location"),
            "start_date": offer.get("start_date") or candidate.get("start_date"),
            "reporting_manager": offer.get("reporting_manager"),
            "employment_type": offer.get("employment_type"),
        }

    @staticmethod
    def _mask_email(email: str) -> str:
        try:
            local, domain = email.split("@", 1)
            if len(local) <= 2:
                masked = local[0] + "*"
            else:
                masked = local[0] + "***" + local[-1]
            return f"{masked}@{domain}"
        except Exception:
            return "***"

    async def _find_offer(self, offer_id: str) -> dict:
        query_or = []
        if ObjectId.is_valid(offer_id):
            query_or.append({"_id": ObjectId(offer_id)})
        offer = await database.offer_letters.find_one({"$or": query_or}) if query_or else None
        if not offer:
            raise HTTPException(status_code=404, detail="Offer letter not found.")
        return offer

    async def _find_candidate(self, candidate_id: str) -> dict | None:
        if not candidate_id:
            return None
        query_or = [{"user_id": candidate_id}, {"email": candidate_id}]
        if ObjectId.is_valid(candidate_id):
            query_or.append({"_id": ObjectId(candidate_id)})
        return await database.candidates.find_one({"$or": query_or})

    async def _find_by_token(self, token: str) -> dict:
        doc = await database.it_provisioning_requests.find_one({"token": (token or "").strip()})
        if not doc:
            raise HTTPException(status_code=404, detail="Invalid or unknown IT provisioning link.")
        return doc

    async def _find_employee_for_user(self, current_user: CurrentUser) -> dict:
        employee = await database.employees.find_one(
            {
                "$or": [
                    {"user_id": current_user.id},
                    {"email": (current_user.email or "").lower()},
                ]
            }
        )
        if not employee:
            raise HTTPException(status_code=404, detail="Employee record not found.")
        return employee

    @staticmethod
    def _assert_recruiter_owns_offer(current_user: CurrentUser, offer: dict) -> None:
        if current_user.role == "super_admin":
            return
        if offer.get("recruiter_id") != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized for this offer.")


it_provisioning_service = ItProvisioningService()

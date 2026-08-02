"""IT provisioning — recruiter requests IT setup before employee activation.

Flow: signed offer → recruiter emails IT public link → IT submits email/assets
→ recruiter may Approve & activate. Password is stored encrypted (Fernet).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from secrets import choice, randbelow, token_urlsafe
from uuid import uuid4

from bson import ObjectId
from fastapi import HTTPException, status
from pymongo import ReturnDocument

from app.core.config import settings
from app.core.crypto import decrypt_text, encrypt_text
from app.core.database import database
from app.core.rbac import CurrentUser
from app.core.security import hash_password
from app.schemas.it_provisioning import (
    BulkRemindItProvisioningRequest,
    BulkSendItProvisioningRequest,
    ItProvisioningBatchSubmitRequest,
    ItProvisioningSubmitRequest,
    RemindItProvisioningRequest,
    SendItProvisioningRequest,
)
from app.services.dashboard_service import create_notification
from app.services.email_service import email_service


def _generate_otp() -> str:
    return f"{randbelow(1_000_000):06d}"


_TEMP_PASSWORD_ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*"


def _generate_temp_password() -> str:
    """12-character temporary password meeting the account policy
    (uppercase, lowercase, digit, special character)."""
    while True:
        pwd = "".join(choice(_TEMP_PASSWORD_ALPHABET) for _ in range(12))
        if (
            any(c.isupper() for c in pwd)
            and any(c.islower() for c in pwd)
            and any(c.isdigit() for c in pwd)
            and any(c in "!@#$%&*" for c in pwd)
        ):
            return pwd


def _iso(value):
    return value.isoformat() if hasattr(value, "isoformat") else value


class ItProvisioningService:
    async def send_request(
        self, current_user: CurrentUser, request: SendItProvisioningRequest, *, send_email: bool = True
    ) -> dict:
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
        if send_email:
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
                title="IT provisioning requested" if email_sent else "IT request created (email failed)",
                message=(
                    f"IT setup request for {snapshot.get('full_name')} emailed to {it_email}."
                    if email_sent
                    else (
                        f"IT setup for {snapshot.get('full_name')} was saved, but the email to {it_email} failed"
                        + (f": {email_error}" if email_error else ".")
                        + " Use Follow up IT or share the form link manually."
                    )
                ),
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

        if send_email:
            message = (
                f"IT provisioning request emailed to {it_email}."
                if email_sent
                else f"Request created, but email to {it_email} failed. Copy the link to share manually."
            )
        else:
            message = f"IT provisioning request created for {snapshot.get('full_name')} — included in the batch email."
        return {
            "message": message,
            "email_sent": email_sent,
            "email_error": email_error,
            "provisioning": self._public_status(doc if existing else {**doc, "token": token}),
            "form_link": link,
            "employee_name": snapshot.get("full_name"),
            "job_title": snapshot.get("job_title"),
            "department": snapshot.get("department"),
            "start_date": snapshot.get("start_date"),
            "employee_email": snapshot.get("email"),
        }

    async def bulk_send(self, current_user: CurrentUser, request: BulkSendItProvisioningRequest) -> dict:
        sent: list[dict] = []
        failed: list[dict] = []
        entries: list[dict] = []
        batch_form = bool(request.batch_form)
        batch_email = bool(request.batch_email) and not batch_form
        use_one_email = batch_email or batch_form
        it_email = ""
        if use_one_email:
            it_email = (str(request.it_manager_email or settings.IT_MANAGER_EMAIL or "")).strip().lower()
            if not it_email:
                raise HTTPException(
                    status_code=400,
                    detail="Provide an IT manager email, or set IT_MANAGER_EMAIL in the server configuration.",
                )

        offer_ids_created: list[str] = []
        for offer_id in request.offer_ids:
            try:
                result = await self.send_request(
                    current_user,
                    SendItProvisioningRequest(
                        offer_id=offer_id,
                        it_manager_email=request.it_manager_email,
                        note=request.note,
                    ),
                    send_email=not use_one_email,
                )
                row = {
                    "offer_id": offer_id,
                    "email_sent": result.get("email_sent", False),
                    "form_link": result.get("form_link"),
                    "message": result.get("message"),
                    "employee_name": result.get("employee_name"),
                    "it_manager_email": ((result.get("provisioning") or {}).get("it_manager_email")),
                }
                sent.append(row)
                offer_ids_created.append(offer_id)
                if batch_email:
                    entries.append(
                        {
                            "offer_id": offer_id,
                            "full_name": result.get("employee_name"),
                            "job_title": result.get("job_title"),
                            "department": result.get("department"),
                            "start_date": result.get("start_date"),
                            "email": result.get("employee_email"),
                            "form_link": result.get("form_link"),
                            "expires_at": ((result.get("provisioning") or {}).get("expires_at")),
                        }
                    )
            except HTTPException as exc:
                failed.append({"offer_id": offer_id, "error": str(exc.detail)})
            except Exception as exc:  # noqa: BLE001
                failed.append({"offer_id": offer_id, "error": str(exc)})

        batch_email_sent = False
        batch_email_error = None
        batch_link = None
        batch_id = None

        if batch_form and offer_ids_created:
            try:
                batch = await self.create_batch(current_user, offer_ids_created, it_email, request.note)
                batch_id = str(batch["_id"])
                batch_link = settings.it_provisioning_batch_link(batch["token"])
                batch_email_sent = await self._send_batch_form_email(batch)
                if not batch_email_sent:
                    batch_email_error = "The batch form email could not be sent (mail provider error)."
            except Exception as exc:  # noqa: BLE001
                batch_email_error = str(exc)
            await create_notification(
                recipient_id=current_user.id,
                recipient_role=current_user.role if current_user.role in ("recruiter", "super_admin") else "recruiter",
                notif_type="it_provisioning_sent",
                title="Bulk IT form requested" if batch_email_sent else "Bulk IT form created (email failed)",
                message=(
                    f"Bulk IT form for {len(offer_ids_created)} candidate(s) emailed to {it_email} — "
                    "IT provisions everyone from one form."
                    if batch_email_sent
                    else (
                        f"Bulk IT form for {len(offer_ids_created)} candidate(s) was saved, but the email to {it_email} failed"
                        + (f": {batch_email_error}" if batch_email_error else ".")
                        + " Use Follow up IT or share the batch link manually."
                    )
                ),
                link="/dashboard/recruiter/candidates",
            )
        elif batch_email and entries:
            try:
                first_expiry = next((e.get("expires_at") for e in entries if e.get("expires_at")), "")
                email_service.send_it_provisioning_batch_request(
                    to_email=it_email,
                    recruiter_name=current_user.full_name or current_user.email,
                    entries=entries,
                    expires_at=first_expiry or "",
                    note=request.note,
                )
                batch_email_sent = True
            except Exception as exc:  # noqa: BLE001
                batch_email_error = str(exc)
            await create_notification(
                recipient_id=current_user.id,
                recipient_role=current_user.role if current_user.role in ("recruiter", "super_admin") else "recruiter",
                notif_type="it_provisioning_sent",
                title="Batch IT provisioning requested" if batch_email_sent else "Batch IT request created (email failed)",
                message=(
                    f"Batch IT setup request for {len(entries)} candidate(s) emailed to {it_email}."
                    if batch_email_sent
                    else (
                        f"Batch IT setup request for {len(entries)} candidate(s) was saved, but the email to {it_email} failed"
                        + (f": {batch_email_error}" if batch_email_error else ".")
                        + " Use Follow up IT or share the form links manually."
                    )
                ),
                link="/dashboard/recruiter/candidates",
            )
        elif use_one_email and not offer_ids_created:
            batch_email_error = "No candidate records could be created for this batch."

        if batch_form:
            if batch_email_sent:
                message = (
                    f"Bulk IT form emailed to {it_email} for {len(offer_ids_created)} candidate(s) — "
                    "IT provisions everyone from one form."
                )
            else:
                message = f"Bulk IT form created, but the email to {it_email} failed: {batch_email_error}"
        elif batch_email and entries and batch_email_sent:
            message = f"Batch IT email sent to {it_email} for {len(entries)} candidate(s)."
        elif batch_email and entries and not batch_email_sent:
            message = f"Batch IT request created, but the email to {it_email} failed: {batch_email_error}"
        else:
            message = f"Bulk IT send finished — sent {len(sent)}, failed {len(failed)}."

        return {
            "message": message,
            "sent": sent,
            "failed": failed,
            "summary": {"sent": len(sent), "failed": len(failed)},
            "batch_email": batch_email,
            "batch_email_sent": batch_email_sent,
            "batch_email_error": batch_email_error,
            "batch_form": batch_form,
            "batch_link": batch_link,
            "batch_id": batch_id,
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
        batch_link = None
        batch = None
        batch_id = doc.get("batch_id")
        if batch_id:
            batch = await database.it_provisioning_batches.find_one({"_id": ObjectId(batch_id)})
            if batch:
                batch_link = settings.it_provisioning_batch_link(batch["token"])
        try:
            if batch_link:
                email_sent = await self._send_batch_form_email(batch)
                if not email_sent:
                    email_error = "The batch form email could not be sent (mail provider error)."
            if not batch_link or not email_sent:
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
            "company_email": doc.get("company_email") if doc.get("status") in ("submitted", "applied") else None,
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
                    "assets": [
                        {
                            "name": a.get("name"),
                            "asset_type": a.get("asset_type"),
                            "serial_number": a.get("serial_number"),
                            "notes": a.get("notes"),
                        }
                        for a in (doc.get("assets") or [])
                    ],
                    "licenses": [
                        {
                            "name": l.get("name"),
                            "vendor": l.get("vendor"),
                            "notes": l.get("notes"),
                        }
                        for l in (doc.get("licenses") or [])
                    ],
                    "it_notes": doc.get("it_notes"),
                    "submitted_at": _iso(doc.get("submitted_at")),
                    "submitted_by_name": doc.get("submitted_by_name"),
                    "has_temporary_password": bool(doc.get("has_temporary_password")),
                }
                if doc.get("status") == "submitted"
                else None
            ),
        }

    def _build_assets_licenses(self, doc: dict, assets_raw: list, licenses_raw: list, now: datetime) -> tuple:
        """Normalize IT-entered assets + licenses into stored records."""
        assets = []
        for item in assets_raw:
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
            for lic in licenses_raw
        ]
        return assets, licenses

    async def _apply_submission(
        self,
        doc: dict,
        *,
        company_email: str,
        assets_raw: list,
        licenses_raw: list,
        it_notes: str | None,
        submitted_by_name: str | None,
        temporary_password: str | None,
        now: datetime,
    ) -> dict:
        """Atomically mark one provisioning doc as submitted (shared by single + batch forms).

        IT assigns the company email, assets, and a FIRST-TIME temporary
        password. The temporary password (encrypted on the request, applied to
        the user's account at activation) is used once — the employee is then
        forced to set their own password, which covers both the personal and
        company email login.
        """
        assets, licenses = self._build_assets_licenses(doc, assets_raw, licenses_raw, now)
        company_email = company_email.strip().lower()

        # First-time password: use what IT provided, otherwise auto-generate.
        # Always stored Fernet-encrypted (plaintext needed once at activation
        # to email it and set the account hash).
        temp_password = (temporary_password or "").strip() or _generate_temp_password()
        temp_password_encrypted = encrypt_text(temp_password)

        # Company email must be unique across open provisioning requests AND
        # across existing employee records (active tenures keep their mailbox).
        dup = await database.it_provisioning_requests.find_one(
            {
                "_id": {"$ne": doc["_id"]},
                "company_email": company_email,
                "status": {"$in": ["pending", "submitted", "applied"]},
            },
            {"employee_snapshot": 1},
        )
        if dup:
            owner = (dup.get("employee_snapshot") or {}).get("full_name") or "another employee"
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Company email {company_email} is already assigned to {owner}. Use a different mailbox.",
            )
        existing_employee = await database.employees.find_one(
            {"company_email": company_email},
            {"full_name": 1, "status": 1},
        )
        if existing_employee:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Company email {company_email} is already assigned to "
                    f"{existing_employee.get('full_name') or 'an existing employee'}. Use a different mailbox."
                ),
            )

        updated = await database.it_provisioning_requests.find_one_and_update(
            {"_id": doc["_id"], "status": {"$in": [None, "pending"]}},
            {
                "$set": {
                    "status": "submitted",
                    "company_email": company_email,
                    "assets": assets,
                    "licenses": licenses,
                    "it_notes": it_notes,
                    "submitted_by_name": submitted_by_name,
                    "temporary_password_encrypted": temp_password_encrypted,
                    "has_temporary_password": True,
                    "submitted_at": now,
                    "updated_at": now,
                },
                "$unset": {"company_email_password_encrypted": "", "has_company_email_password": ""},
            },
            return_document=ReturnDocument.AFTER,
        )
        if not updated:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This form has already been submitted.",
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
            "employee_name": snapshot.get("full_name"),
            "submitted_by_name": submitted_by_name,
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

        return await self._apply_submission(
            doc,
            company_email=request.company_email,
            assets_raw=request.assets,
            licenses_raw=request.licenses,
            it_notes=request.it_notes,
            submitted_by_name=request.submitted_by_name,
            temporary_password=request.temporary_password,
            now=now,
        )

    async def edit_public(self, token: str, request: ItProvisioningSubmitRequest) -> dict:
        """Public: IT corrects a submitted provisioning request before the
        recruiter activates the employee. After activation the record is
        locked and can no longer be edited."""
        doc = await self._find_by_token(token)
        if doc.get("status") != "submitted":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Only submitted provisioning can be edited before activation.",
            )

        now = datetime.now(UTC)
        expires = doc.get("expires_at")
        if expires:
            if getattr(expires, "tzinfo", None) is None:
                expires = expires.replace(tzinfo=UTC)
            if now > expires:
                raise HTTPException(status_code=410, detail="This IT provisioning link has expired.")

        assets, licenses = self._build_assets_licenses(doc, request.assets, request.licenses, now)
        company_email = request.company_email.strip().lower()

        # Re-check uniqueness (excluding this request itself), including
        # existing employee records — same rules as the original submit.
        dup = await database.it_provisioning_requests.find_one(
            {
                "_id": {"$ne": doc["_id"]},
                "company_email": company_email,
                "status": {"$in": ["pending", "submitted", "applied"]},
            },
            {"employee_snapshot": 1},
        )
        if dup:
            owner = (dup.get("employee_snapshot") or {}).get("full_name") or "another employee"
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Company email {company_email} is already assigned to {owner}. Use a different mailbox.",
            )
        existing_employee = await database.employees.find_one(
            {"company_email": company_email},
            {"full_name": 1, "status": 1},
        )
        if existing_employee:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Company email {company_email} is already assigned to "
                    f"{existing_employee.get('full_name') or 'an existing employee'}. Use a different mailbox."
                ),
            )

        set_fields = {
            "status": "submitted",
            "company_email": company_email,
            "assets": assets,
            "licenses": licenses,
            "it_notes": request.it_notes,
            "submitted_by_name": request.submitted_by_name,
            "edited_at": now,
            "updated_at": now,
        }
        # A new first-time password on edit replaces the stored one; leaving it
        # blank keeps the previously submitted password.
        if (request.temporary_password or "").strip():
            set_fields["temporary_password_encrypted"] = encrypt_text(request.temporary_password.strip())
            set_fields["has_temporary_password"] = True

        updated = await database.it_provisioning_requests.find_one_and_update(
            {"_id": doc["_id"], "status": "submitted"},
            {"$set": set_fields},
            return_document=ReturnDocument.AFTER,
        )
        if not updated:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This provisioning request has already been applied and can no longer be edited.",
            )

        snapshot = doc.get("employee_snapshot") or {}
        recruiter_id = doc.get("recruiter_id")
        if recruiter_id:
            await create_notification(
                recipient_id=recruiter_id,
                recipient_role="recruiter",
                notif_type="it_provisioning_edited",
                title="IT provisioning updated",
                message=(
                    f"IT updated the company email or assets for {snapshot.get('full_name')}. "
                    "Review the latest details before activating."
                ),
                link="/dashboard/recruiter/candidates",
                related_id=doc.get("offer_id"),
            )
        try:
            if doc.get("recruiter_email"):
                email_service.send_it_provisioning_edited(
                    to_email=doc["recruiter_email"],
                    employee_name=snapshot.get("full_name") or "the candidate",
                    company_email=company_email,
                    assets_count=len(assets),
                    licenses_count=len(licenses),
                )
        except Exception:
            pass  # Best-effort

        await database.audit_logs.insert_one(
            {
                "candidate_id": doc.get("candidate_id"),
                "email": doc.get("it_manager_email"),
                "module": "it_provisioning",
                "action": "it_provisioning_edited",
                "outcome": "success",
                "created_at": now,
            }
        )

        return {
            "message": "Provisioning updated. The recruiter will see the latest details before activation.",
            "company_email": company_email,
            "assets_count": len(assets),
            "licenses_count": len(licenses),
            "asset_names": [a.get("name") for a in assets if a.get("name")],
            "license_names": [l.get("name") for l in licenses if l.get("name")],
        }

    async def reset_password_public(self, token: str) -> dict:
        """Public: IT resets the linked employee's account password using the
        provisioning link. There is ONE password per account — both the
        personal and company email logins immediately use the new temporary
        password. The temporary password is returned once and emailed to both
        addresses."""
        doc = await self._find_by_token(token)
        now = datetime.now(UTC)
        expires = doc.get("expires_at")
        if expires:
            if getattr(expires, "tzinfo", None) is None:
                expires = expires.replace(tzinfo=UTC)
            if now > expires:
                raise HTTPException(status_code=410, detail="This IT provisioning link has expired.")

        if doc.get("status") not in ("submitted", "applied"):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="IT must submit provisioning before the employee password can be reset.",
            )

        user_doc = await self._resolve_user_for_provisioning(doc)
        if not user_doc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No account is linked to this provisioning request yet.",
            )

        temp_password = _generate_temp_password()
        await database.users.update_one(
            {"_id": user_doc["_id"]},
            {
                "$set": {
                    "password_hash": hash_password(temp_password),
                    "must_change_password": True,
                    "updated_at": now,
                }
            },
        )
        # Force re-login everywhere: both personal and company email logins.
        await database.refresh_tokens.delete_many({"user_id": str(user_doc["_id"])})

        snapshot = doc.get("employee_snapshot") or {}
        personal_email = (snapshot.get("email") or user_doc.get("email") or "").strip().lower()
        company_email = doc.get("company_email")

        try:
            await create_notification(
                recipient_id=str(user_doc["_id"]),
                recipient_role=user_doc.get("role") or "employee",
                notif_type="password_reset_by_it",
                title="Password reset by IT",
                message=(
                    "Your password was reset by IT. A temporary password was sent to your "
                    "personal and company email — use it once, then you'll set your own."
                ),
                link="/login",
            )
        except Exception:
            pass  # Best-effort

        try:
            email_service.send_to_both(
                personal_email,
                company_email,
                email_service.send_it_password_reset,
                snapshot.get("full_name") or user_doc.get("full_name"),
                temp_password,
            )
        except Exception:
            pass  # Best-effort

        await database.audit_logs.insert_one(
            {
                "user_id": str(user_doc["_id"]),
                "email": doc.get("it_manager_email"),
                "module": "it_provisioning",
                "action": "employee_password_reset_by_it",
                "outcome": "success",
                "created_at": now,
            }
        )

        return {
            "message": "Password reset. The employee received a temporary password by email (personal + company) — they'll set their own on next sign-in.",
            "temporary_password": temp_password,
            "company_email": company_email,
            "personal_email": personal_email,
            "full_name": snapshot.get("full_name") or user_doc.get("full_name"),
        }

    async def _resolve_user_for_provisioning(self, doc: dict) -> dict | None:
        """Resolve the single users document linked to a provisioning request
        (works both before and after activation — it is the same account)."""
        user_id = None
        candidate = await self._find_candidate(doc.get("candidate_id") or "")
        if candidate and candidate.get("user_id"):
            user_id = candidate["user_id"]
        elif doc.get("employee_id"):
            employee = await database.employees.find_one(
                {"_id": ObjectId(doc["employee_id"]) if ObjectId.is_valid(doc["employee_id"]) else doc["employee_id"]},
                {"user_id": 1},
            )
            if employee and employee.get("user_id"):
                user_id = employee["user_id"]
        if not user_id:
            return None
        if ObjectId.is_valid(user_id):
            return await database.users.find_one({"_id": ObjectId(user_id)})
        return await database.users.find_one({"email": user_id})

    async def _find_batch_by_token(self, token: str) -> dict:
        if not token:
            raise HTTPException(status_code=404, detail="Provisioning batch not found.")
        batch = await database.it_provisioning_batches.find_one({"token": token})
        if not batch:
            raise HTTPException(status_code=404, detail="Provisioning batch not found.")
        return batch

    def _check_batch_expiry(self, batch: dict, now: datetime) -> None:
        expires = batch.get("expires_at")
        if expires:
            if getattr(expires, "tzinfo", None) is None:
                expires = expires.replace(tzinfo=UTC)
            if now > expires and batch.get("status") != "submitted":
                raise HTTPException(status_code=410, detail="This IT provisioning batch link has expired.")

    async def _batch_public_view(self, batch: dict) -> dict:
        offer_ids = batch.get("offer_ids") or []
        docs = await database.it_provisioning_requests.find(
            {"offer_id": {"$in": offer_ids}},
            {"employee_snapshot": 1, "status": 1, "company_email": 1},
        ).to_list(length=100)
        docs_by_offer = {str(d.get("offer_id")): d for d in docs}
        rows = []
        for offer_id in offer_ids:
            doc = docs_by_offer.get(offer_id) or {}
            snap = doc.get("employee_snapshot") or {}
            rows.append(
                {
                    "offer_id": offer_id,
                    "full_name": snap.get("full_name"),
                    "personal_email": snap.get("email"),
                    "job_title": snap.get("job_title"),
                    "department": snap.get("department"),
                    "start_date": snap.get("start_date"),
                    "status": doc.get("status") or "pending",
                    "already_submitted": doc.get("status") == "submitted",
                    "company_email": doc.get("company_email"),
                }
            )
        kits_docs = await database.it_kits.find({}).sort("name", 1).to_list(length=200)
        kits = [
            {
                "kit_id": str(k["_id"]),
                "name": k.get("name"),
                "description": k.get("description"),
                "assets": k.get("assets") or [],
                "licenses": k.get("licenses") or [],
                "roles": k.get("roles") or [],
                "is_default": bool(k.get("is_default")),
            }
            for k in kits_docs
        ]
        return {
            "batch_id": str(batch["_id"]),
            "it_manager_email": batch.get("it_manager_email"),
            "recruiter_name": batch.get("recruiter_name"),
            "note": batch.get("note"),
            "status": batch.get("status"),
            "expires_at": _iso(batch.get("expires_at")),
            "entries": rows,
            "kits": kits,
            "submitted_count": sum(1 for r in rows if r["already_submitted"]),
        }

    async def get_batch_public(self, token: str) -> dict:
        batch = await self._find_batch_by_token(token)
        self._check_batch_expiry(batch, datetime.now(UTC))
        return await self._batch_public_view(batch)

    async def submit_batch_public(self, token: str, request: ItProvisioningBatchSubmitRequest) -> dict:
        batch = await self._find_batch_by_token(token)
        now = datetime.now(UTC)
        self._check_batch_expiry(batch, now)

        offer_ids = set(batch.get("offer_ids") or [])
        submitted: list[dict] = []
        failed: list[dict] = []
        for entry in request.entries:
            if entry.offer_id not in offer_ids:
                failed.append({"offer_id": entry.offer_id, "error": "This person is not part of the batch."})
                continue
            try:
                doc = await database.it_provisioning_requests.find_one(
                    {"offer_id": entry.offer_id, "status": {"$in": [None, "pending"]}},
                    sort=[("created_at", -1)],
                )
                if not doc:
                    failed.append(
                        {"offer_id": entry.offer_id, "error": "No open provisioning request for this person."}
                    )
                    continue
                result = await self._apply_submission(
                    doc,
                    company_email=entry.company_email,
                    assets_raw=request.assets,
                    licenses_raw=request.licenses,
                    it_notes=request.it_notes,
                    submitted_by_name=request.submitted_by_name,
                    temporary_password=entry.temporary_password,
                    now=now,
                )
                submitted.append({"offer_id": entry.offer_id, **result})
            except HTTPException as exc:
                failed.append({"offer_id": entry.offer_id, "error": str(exc.detail)})
            except Exception as exc:  # noqa: BLE001
                failed.append({"offer_id": entry.offer_id, "error": str(exc)})

        if submitted:
            remaining = await database.it_provisioning_requests.count_documents(
                {"offer_id": {"$in": list(offer_ids)}, "status": {"$in": [None, "pending"]}}
            )
            if remaining == 0:
                await database.it_provisioning_batches.update_one(
                    {"_id": batch["_id"]},
                    {"$set": {"status": "submitted", "submitted_at": now, "updated_at": now}},
                )
            else:
                await database.it_provisioning_batches.update_one(
                    {"_id": batch["_id"]}, {"$set": {"updated_at": now}}
                )

        message = (
            f"Batch provisioning submitted — {len(submitted)} saved, {len(failed)} failed."
            if failed
            else f"Batch provisioning submitted for {len(submitted)} new hire(s)."
        )
        return {
            "message": message,
            "submitted": submitted,
            "failed": failed,
            "summary": {"submitted": len(submitted), "failed": len(failed)},
        }

    async def create_batch(
        self, current_user: CurrentUser, offer_ids: list[str], it_email: str, note: str | None
    ) -> dict:
        now = datetime.now(UTC)
        token = token_urlsafe(32)
        batch = {
            "token": token,
            "it_manager_email": it_email,
            "offer_ids": offer_ids,
            "recruiter_id": current_user.id,
            "recruiter_name": current_user.full_name,
            "recruiter_email": current_user.email,
            "note": note,
            "status": "pending",
            "submitted_at": None,
            "expires_at": now + timedelta(days=settings.IT_PROVISIONING_EXPIRE_DAYS),
            "created_at": now,
            "updated_at": now,
        }
        result = await database.it_provisioning_batches.insert_one(batch)
        batch["_id"] = result.inserted_id
        await database.it_provisioning_requests.update_many(
            {"offer_id": {"$in": offer_ids}, "status": {"$in": [None, "pending"]}},
            {"$set": {"batch_id": str(result.inserted_id), "batch_token": token}},
        )
        return batch

    async def _batch_entries(self, batch: dict) -> list[dict]:
        docs = await database.it_provisioning_requests.find(
            {"offer_id": {"$in": batch.get("offer_ids") or []}}, {"employee_snapshot": 1}
        ).to_list(length=100)
        by_offer = {str(d.get("offer_id")): d for d in docs}
        entries = []
        for offer_id in batch.get("offer_ids") or []:
            snap = (by_offer.get(offer_id) or {}).get("employee_snapshot") or {}
            entries.append(
                {
                    "full_name": snap.get("full_name"),
                    "job_title": snap.get("job_title"),
                    "department": snap.get("department"),
                    "start_date": snap.get("start_date"),
                    "email": snap.get("email"),
                }
            )
        return entries

    async def _send_batch_form_email(self, batch: dict, *, is_reminder: bool = False) -> bool:
        try:
            entries = await self._batch_entries(batch)
            email_service.send_it_provisioning_batch_form_request(
                to_email=batch["it_manager_email"],
                recruiter_name=batch.get("recruiter_name") or "a recruiter",
                entries=entries,
                form_link=settings.it_provisioning_batch_link(batch["token"]),
                expires_at=batch["expires_at"].strftime("%B %d, %Y at %H:%M UTC"),
                note=batch.get("note"),
            )
            return True
        except Exception:
            return False

    async def get_for_offer(self, offer_id: str) -> dict | None:
        doc = await database.it_provisioning_requests.find_one(
            {"offer_id": str(offer_id), "status": {"$in": ["pending", "submitted", "applied"]}},
            sort=[("created_at", -1)],
        )
        if not doc:
            return None
        return self._public_status(doc)

    async def get_for_candidate(self, candidate_id: str) -> dict | None:
        """Recruiter-facing provisioning history for one candidate (for the candidate profile)."""
        query_or = [{"candidate_id": candidate_id}]
        candidate = await self._find_candidate(candidate_id)
        if candidate:
            alt = candidate.get("user_id") or str(candidate.get("_id", ""))
            if alt and alt != candidate_id:
                query_or.append({"candidate_id": alt})
            if candidate.get("email"):
                query_or.append({"candidate_email": candidate["email"].lower()})
        docs = (
            await database.it_provisioning_requests.find(
                {"$or": query_or, "status": {"$in": ["pending", "submitted", "applied"]}},
                sort=[("created_at", -1)],
            )
            .to_list(length=10)
        )
        if not docs:
            return None
        latest = docs[0]
        view = self._public_status(latest)
        view["it_manager_email"] = latest.get("it_manager_email")
        view["form_link"] = settings.it_provisioning_link(latest["token"])
        view["history"] = [self._public_status(d) for d in docs]
        return view

    async def _submitted_candidate_docs(self, candidate_id: str) -> list[dict]:
        """All submitted provisioning docs for a candidate (any id form)."""
        query_or = [{"candidate_id": candidate_id}]
        candidate = await self._find_candidate(candidate_id)
        if candidate:
            alt = candidate.get("user_id") or str(candidate.get("_id", ""))
            if alt and alt != candidate_id:
                query_or.append({"candidate_id": alt})
            if candidate.get("email"):
                query_or.append({"candidate_email": candidate["email"].lower()})
        cursor = database.it_provisioning_requests.find(
            {"$or": query_or, "status": "submitted"},
            sort=[("submitted_at", -1)],
        )
        return [doc async for doc in cursor]

    async def require_submitted_for_candidate(self, candidate_id: str, offer_id: str | None = None) -> dict:
        """Used by activation — returns the offer-scoped submitted provisioning or raises 400.

        Prefers the exact offer so activation never consumes another offer's IT setup
        (e.g. after a reinvite). Falls back to a candidate-level submission only when
        it is unambiguous (exactly one record).
        """
        if offer_id:
            doc = await database.it_provisioning_requests.find_one(
                {"offer_id": str(offer_id), "status": "submitted"},
                sort=[("submitted_at", -1)],
            )
            if doc:
                return doc
            docs = await self._submitted_candidate_docs(candidate_id)
            if len(docs) == 1:
                return docs[0]
            if len(docs) > 1:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        "Multiple IT provisioning records exist for this candidate. "
                        "Send IT provisioning for this offer and wait for IT to submit, then activate."
                    ),
                )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "IT must assign a company email and assets before activation. "
                    "Send the IT provisioning request and wait for their form submission."
                ),
            )
        docs = await self._submitted_candidate_docs(candidate_id)
        if not docs:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "IT must assign a company email and assets before activation. "
                    "Send the IT provisioning request and wait for their form submission."
                ),
            )
        return docs[0]

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
            "assets": (doc.get("assets") or []) if doc.get("status") in ("submitted", "applied") else [],
            "licenses": (doc.get("licenses") or []) if doc.get("status") in ("submitted", "applied") else [],
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

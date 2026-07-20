"""Epic 4: Document Management & Verification (US-036 .. US-050).

Upload → extract → classify → validate purpose → store → cross-match.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from pathlib import Path

from bson import ObjectId
from fastapi import HTTPException, UploadFile, status

from app.core.config import settings
from app.core.rbac import CurrentUser
from app.core.database import database
from app.services import embedding_service, ocr_service, storage_service
from app.services.document_extraction_service import document_extraction_service
from app.services.document_matching_service import compare_extractions
from app.services.dashboard_service import create_notification
from app.services.email_service import email_service

MAX_UPLOAD_BYTES = settings.MAX_DOCUMENT_MB * 1024 * 1024

STRICT_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png"}
RESUME_EXTENSIONS = STRICT_EXTENSIONS | {".doc", ".docx"}

DOCUMENT_LABELS = {
    "cnic": "National ID (CNIC/NIC)",
    "passport": "Passport",
    "transcript": "Academic Transcript",
    "degree": "Academic Transcript",
    "resume": "Resume/CV",
}


def _should_run_ocr(*, doc_type: str, purpose: str | None = None) -> bool:
    """OCR runs only for CNIC to keep compute costs low.

    Other document types are stored for verification without extraction.
    """
    if not settings.ENABLE_OCR:
        return False
    normalized = (doc_type or "").strip().lower()
    if normalized == "cnic":
        return True
    # Legacy uploads sometimes omit doc_type but mark purpose as government_doc
    # with an implicit CNIC — still require explicit cnic to avoid passport OCR.
    return False


def _extensions_for(category: str, doc_type: str) -> set[str]:
    if doc_type == "resume" or category == "other":
        return RESUME_EXTENSIONS
    return STRICT_EXTENSIONS


class DocumentService:
    async def upload(
        self,
        current_user: CurrentUser,
        *,
        file: UploadFile,
        category: str,
        doc_type: str,
        purpose: str | None = None,
    ) -> dict:
        original = file.filename or "upload.bin"
        ext = Path(original).suffix.lower()
        allowed = _extensions_for(category, doc_type)
        if ext not in allowed:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported file type for {category}. Allowed: {', '.join(sorted(allowed))}.",
            )

        content = await file.read()
        if not content:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty.")
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File is too large (max {settings.MAX_DOCUMENT_MB} MB).",
            )

        document_hash = hashlib.sha256(content).hexdigest()
        duplicate = await database.documents.find_one(
            {
                "owner_id": current_user.id,
                "doc_type": doc_type,
                "document_hash": document_hash,
                "is_active": True,
            }
        )
        if duplicate:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This exact document is already uploaded.",
            )

        try:
            stored = await storage_service.save_file(current_user.id, category, original, content)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Could not store the uploaded document.",
            ) from exc
        now = datetime.now(UTC)

        previous = await database.documents.find_one(
            {"owner_id": current_user.id, "doc_type": doc_type, "is_active": True}
        )
        version = 1
        if previous:
            version = int(previous.get("version", 1)) + 1
        requested_reupload = bool(
            previous
            and (
                previous.get("status") == "reupload_required"
                or previous.get("reupload_request_status") == "pending"
            )
        )

        needs_ocr = _should_run_ocr(doc_type=doc_type, purpose=purpose)
        expected = document_extraction_service.resolve_expected_categories(
            purpose=purpose, doc_type=doc_type, category=category
        )

        doc = {
            "owner_id": current_user.id,
            "owner_role": current_user.role,
            "owner_email": current_user.email,
            "owner_name": current_user.full_name,
            "category": category,
            "doc_type": doc_type,
            "purpose": purpose,
            "file_name": original,
            "storage_backend": stored["backend"],
            "object_path": stored["object_path"],
            "resource_type": stored.get("resource_type"),
            "file_url": stored["file_url"],
            "document_hash": document_hash,
            "version": version,
            "previous_version_id": str(previous["_id"]) if previous else None,
            "reupload_request_id": str(previous["_id"]) if requested_reupload else None,
            "is_active": True,
            "status": "processing" if needs_ocr else "pending_verification",
            "ocr_result": None,
            "raw_extracted_text": None,
            "original_extraction": None,
            "verification_status": "pending",
            "mismatch_reasons": [],
            "profile_verification": None,
            "verified_by": None,
            "verified_at": None,
            "rejection_reason": None,
            "rejection_note": None,
            "uploaded_at": now,
            "updated_at": now,
            "extraction_timestamp": None,
        }
        result = await database.documents.insert_one(doc)
        doc["_id"] = result.inserted_id

        if needs_ocr:
            import asyncio

            temp_local_path: str | None = None
            try:
                def _run_extraction():
                    return document_extraction_service.extract_text(temp_local_path or "")

                temp_local_path = await storage_service.materialize_local_file(
                    {
                        "storage_backend": stored["backend"],
                        "file_url": stored["file_url"],
                        "object_path": stored["object_path"],
                        "resource_type": stored.get("resource_type"),
                    }
                )
                raw_text = await asyncio.to_thread(_run_extraction)
                parsed = await document_extraction_service.parse_structured_data(raw_text)
                validation = document_extraction_service.validate_classification(
                    parsed,
                    expected,
                    purpose=purpose,
                    doc_type=doc_type,
                )

                extraction_confidence = float(parsed.get("extraction_confidence") or 0.0)
                classification_confidence = float(
                    validation.get("classification_confidence")
                    or parsed.get("classification_confidence")
                    or 0.0
                )

                if not raw_text.strip():
                    ocr_result = {
                        "status": "failed",
                        "confidence": 0.0,
                        "extraction_confidence": 0.0,
                        "classification_confidence": 0.0,
                        "matching_confidence": None,
                        "raw_text": "",
                        "category": "unknown",
                        "fields": {},
                        "engine": "document_extraction_service",
                        "accepted": False,
                        "rejection_message": "Could not read text from this document. Please upload a clearer scan.",
                    }
                    doc_status = "reupload_required"
                    verification_status = "reupload_required"
                    mismatch_reasons: list = []
                elif not validation["accepted"]:
                    ocr_result = {
                        "status": "rejected_type",
                        "confidence": classification_confidence,
                        "extraction_confidence": extraction_confidence,
                        "classification_confidence": classification_confidence,
                        "matching_confidence": None,
                        "raw_text": raw_text,
                        "category": validation["category"],
                        "fields": {},
                        "engine": "document_extraction_service",
                        "accepted": False,
                        "rejection_message": validation["rejection_message"],
                    }
                    doc_status = "reupload_required"
                    verification_status = "rejected"
                    mismatch_reasons = []
                else:
                    fields = parsed.get("fields") or {}
                    low_quality = extraction_confidence < 0.2
                    ocr_result = {
                        "status": "completed",
                        "confidence": extraction_confidence or classification_confidence or 0.8,
                        "extraction_confidence": extraction_confidence,
                        "classification_confidence": classification_confidence,
                        "matching_confidence": None,
                        "raw_text": raw_text,
                        "category": validation["category"],
                        "fields": fields,
                        "engine": "document_extraction_service",
                        "accepted": True,
                        "rejection_message": None,
                        "low_quality": low_quality,
                        "quality_warning": (
                            "Only a small amount of reliable information was extracted. "
                            "Please review every auto-filled value."
                            if low_quality
                            else None
                        ),
                    }
                    doc_status = "pending_verification"
                    verification_status = "pending"
                    mismatch_reasons = []

            except Exception as exc:
                raw_text = ""
                ocr_result = {
                    "status": "failed",
                    "confidence": 0.0,
                    "extraction_confidence": 0.0,
                    "classification_confidence": 0.0,
                    "matching_confidence": None,
                    "raw_text": "",
                    "category": "unknown",
                    "fields": {},
                    "engine": "document_extraction_service",
                    "accepted": False,
                    "rejection_message": "Extraction failed. Please try again or fill fields manually.",
                    "error": str(exc),
                }
                doc_status = "reupload_required"
                verification_status = "reupload_required"
                mismatch_reasons = []
            finally:
                if temp_local_path:
                    try:
                        Path(temp_local_path).unlink(missing_ok=True)
                    except OSError:
                        pass

            update = {
                "ocr_result": ocr_result,
                "raw_extracted_text": raw_text,
                "original_extraction": {
                    "category": ocr_result.get("category"),
                    "fields": ocr_result.get("fields") or {},
                    "raw_text": raw_text,
                    "extracted_at": datetime.now(UTC).isoformat(),
                },
                "status": doc_status,
                "verification_status": verification_status,
                "mismatch_reasons": mismatch_reasons,
                "extraction_timestamp": datetime.now(UTC),
                "updated_at": datetime.now(UTC),
            }
            await database.documents.update_one({"_id": doc["_id"]}, {"$set": update})
            doc.update(update)

            # A failed/wrong replacement must not hide the last valid document.
            if ocr_result.get("status") == "completed":
                if previous:
                    previous_update = {
                        "is_active": False,
                        "updated_at": datetime.now(UTC),
                    }
                    if requested_reupload:
                        previous_update.update(
                            {
                                "reupload_request_status": "fulfilled",
                                "reupload_fulfilled_at": datetime.now(UTC),
                                "reupload_replacement_id": str(doc["_id"]),
                            }
                        )
                    await database.documents.update_one(
                        {"_id": previous["_id"]},
                        {"$set": previous_update},
                    )
            else:
                await database.documents.update_one(
                    {"_id": doc["_id"]},
                    {"$set": {"is_active": False, "updated_at": datetime.now(UTC)}},
                )
                doc["is_active"] = False

            await database.audit_logs.insert_one(
                {
                    "user_id": current_user.id,
                    "email": current_user.email,
                    "actor_email": current_user.email,
                    "module": "documents",
                    "action": (
                        "ocr_rejected_type"
                        if ocr_result.get("status") == "rejected_type"
                        else "ocr_completed"
                        if ocr_result.get("status") == "completed"
                        else "ocr_failed"
                    ),
                    "doc_type": doc_type,
                    "category": category,
                    "outcome": "success" if ocr_result.get("status") == "completed" else "failed",
                    "created_at": datetime.now(UTC),
                }
            )

            if (
                (doc_type == "resume" or ocr_result.get("category") == "resume")
                and settings.ENABLE_EMBEDDINGS
                and raw_text
                and ocr_result.get("accepted")
            ):
                try:
                    await self.generate_resume_embedding(current_user, raw_text)
                except Exception:
                    pass

            # Cross-document matching after a successful extraction
            if ocr_result.get("status") == "completed":
                profile_verification = await self._run_cross_document_match(current_user.id)
                ocr_result["matching_confidence"] = profile_verification.get("matching_confidence")
                update_match = {
                    "ocr_result": ocr_result,
                    "profile_verification": profile_verification,
                    "mismatch_reasons": profile_verification.get("mismatches") or [],
                    "verification_status": (
                        "mismatch"
                        if profile_verification.get("verification_status") == "mismatch"
                        else doc.get("verification_status", "pending")
                    ),
                    "updated_at": datetime.now(UTC),
                }
                if profile_verification.get("verification_status") == "mismatch":
                    update_match["status"] = "mismatch"
                await database.documents.update_one({"_id": doc["_id"]}, {"$set": update_match})
                doc.update(update_match)
        elif previous:
            previous_update = {"is_active": False, "updated_at": datetime.now(UTC)}
            if requested_reupload:
                previous_update.update(
                    {
                        "reupload_request_status": "fulfilled",
                        "reupload_fulfilled_at": datetime.now(UTC),
                        "reupload_replacement_id": str(doc["_id"]),
                    }
                )
            await database.documents.update_one(
                {"_id": previous["_id"]},
                {"$set": previous_update},
            )

        await self._notify_recruiter_owner(
            current_user,
            doc_type,
            category,
            requested_reupload=requested_reupload
            and (not needs_ocr or (doc.get("ocr_result") or {}).get("status") == "completed"),
            document_id=str(doc["_id"]),
        )
        await database.audit_logs.insert_one(
            {
                "user_id": current_user.id,
                "email": current_user.email,
                "actor_email": current_user.email,
                "module": "documents",
                "action": "document_uploaded",
                "doc_type": doc_type,
                "category": category,
                "outcome": "success",
                "created_at": now,
            }
        )

        return {"message": "Document uploaded.", "document": self._public(doc)}

    async def _run_cross_document_match(self, owner_id: str) -> dict:
        docs = await database.documents.find({"owner_id": owner_id, "is_active": True}).to_list(length=50)
        result = compare_extractions(docs)

        # Persist summary on candidate/employee for recruiter + candidate UI
        await database.candidates.update_one(
            {"$or": [{"user_id": owner_id}, {"email": owner_id}]},
            {
                "$set": {
                    "document_verification": result,
                    "document_verification_updated_at": datetime.now(UTC),
                }
            },
        )
        await database.employees.update_one(
            {"$or": [{"user_id": owner_id}, {"email": owner_id}]},
            {
                "$set": {
                    "document_verification": result,
                    "document_verification_updated_at": datetime.now(UTC),
                }
            },
        )

        # Keep every active document synchronized, including clearing stale flags.
        completed_docs = await database.documents.find(
            {"owner_id": owner_id, "is_active": True, "ocr_result.status": "completed"}
        ).to_list(length=50)
        for doc in completed_docs:
            is_verified = doc.get("verification_status") == "verified"
            has_mismatch = result.get("verification_status") == "mismatch"
            update = {
                "profile_verification": result,
                "mismatch_reasons": result.get("mismatches") or [],
                "updated_at": datetime.now(UTC),
            }
            if not is_verified:
                update["verification_status"] = "mismatch" if has_mismatch else "pending"
                update["status"] = "mismatch" if has_mismatch else "pending_verification"
            await database.documents.update_one({"_id": doc["_id"]}, {"$set": update})
        return result

    async def _notify_recruiter_owner(
        self,
        current_user: CurrentUser,
        doc_type: str,
        category: str,
        *,
        requested_reupload: bool = False,
        document_id: str | None = None,
    ) -> None:
        owner = await database.candidates.find_one(
            {"$or": [{"user_id": current_user.id}, {"email": current_user.email}]}
        ) or await database.employees.find_one(
            {"$or": [{"user_id": current_user.id}, {"email": current_user.email}]}
        )
        recruiter_id = owner.get("recruiter_id") if owner else None
        if not recruiter_id:
            return
        await create_notification(
            recipient_id=recruiter_id,
            recipient_role="recruiter",
            notif_type="document_reuploaded" if requested_reupload else "document_uploaded",
            title="Requested document re-uploaded" if requested_reupload else "Document uploaded",
            message=(
                f"{current_user.full_name} uploaded a replacement "
                f"{DOCUMENT_LABELS.get(doc_type, doc_type.replace('_', ' '))} for review."
                if requested_reupload
                else f"{current_user.full_name} uploaded a {doc_type.replace('_', ' ')} document for review."
            ),
            link="/dashboard/recruiter#documents-section",
            related_id=document_id or current_user.id,
        )

    async def list_mine(self, current_user: CurrentUser) -> dict:
        docs = (
            await database.documents.find({"owner_id": current_user.id, "is_active": True})
            .sort("uploaded_at", -1)
            .to_list(length=100)
        )
        owner = await database.candidates.find_one(
            {"$or": [{"user_id": current_user.id}, {"email": current_user.email}]}
        ) or await database.employees.find_one(
            {"$or": [{"user_id": current_user.id}, {"email": current_user.email}]}
        )
        return {
            "documents": [self._public(d) for d in docs],
            "document_verification": (owner or {}).get("document_verification"),
        }

    async def list_for_owner(self, current_user: CurrentUser, owner_id: str) -> dict:
        self._assert_recruiter(current_user)
        docs = (
            await database.documents.find({"owner_id": owner_id, "is_active": True})
            .sort("uploaded_at", -1)
            .to_list(length=100)
        )
        profile = await self._resolve_profile_fields(owner_id)
        owner = await database.candidates.find_one(
            {"$or": [{"user_id": owner_id}, {"email": owner_id}]}
        ) or await database.employees.find_one({"$or": [{"user_id": owner_id}, {"email": owner_id}]})
        cross = (owner or {}).get("document_verification") or compare_extractions(docs)

        enriched = []
        for d in docs:
            payload = self._public(d)
            ocr_fields = (d.get("ocr_result") or {}).get("fields") or {}
            profile_mismatches = []
            if ocr_fields:
                # Map common field aliases for profile compare
                mapped = dict(ocr_fields)
                if "name" in mapped and "full_name" not in mapped:
                    mapped["full_name"] = mapped["name"]
                if "cnic_number" in mapped:
                    mapped["cnic_number"] = mapped["cnic_number"]
                profile_mismatches = ocr_service.compare_with_profile(mapped, profile)
            payload["mismatches"] = profile_mismatches
            payload["cross_document_mismatches"] = d.get("mismatch_reasons") or cross.get("mismatches") or []
            enriched.append(payload)

        return {
            "documents": enriched,
            "document_verification": cross,
        }

    async def verify(self, current_user: CurrentUser, document_id: str, payload) -> dict:
        self._assert_recruiter(current_user)
        doc = await self._find(document_id)
        if payload.status not in ("verified", "rejected", "reupload_required", "mismatch"):
            raise HTTPException(status_code=400, detail="Invalid verification status.")
        if payload.status in ("rejected", "reupload_required") and not payload.rejection_reason:
            raise HTTPException(status_code=400, detail="A rejection reason is required.")

        now = datetime.now(UTC)
        approve_despite = bool(getattr(payload, "approve_despite_mismatch", False))

        update = {
            "status": "verified" if (payload.status == "verified" or approve_despite) else payload.status,
            "verification_status": "verified" if (payload.status == "verified" or approve_despite) else payload.status,
            "verified_by": current_user.id,
            "verified_at": now,
            "rejection_reason": payload.rejection_reason,
            "rejection_note": payload.note,
            "updated_at": now,
        }
        if payload.status == "reupload_required":
            update.update(
                {
                    "reupload_request_status": "pending",
                    "reupload_requested_by": current_user.id,
                    "reupload_requested_at": now,
                    "reupload_request_reason": payload.rejection_reason,
                    "reupload_request_note": payload.note,
                }
            )
        if approve_despite or payload.status == "verified":
            update["mismatch_approved"] = True
            update["mismatch_approved_by"] = current_user.id
            update["mismatch_approved_at"] = now
            update["mismatch_approval_note"] = payload.note

        await database.documents.update_one({"_id": doc["_id"]}, {"$set": update})

        # If recruiter approves despite mismatch, clear profile-level mismatch flag
        if approve_despite or payload.status == "verified":
            if approve_despite:
                await database.documents.update_many(
                    {
                        "owner_id": doc["owner_id"],
                        "is_active": True,
                        "ocr_result.status": "completed",
                    },
                    {
                        "$set": {
                            "status": "verified",
                            "verification_status": "verified",
                            "mismatch_approved": True,
                            "mismatch_approved_by": current_user.id,
                            "mismatch_approved_at": now,
                            "mismatch_approval_note": payload.note,
                            "updated_at": now,
                        }
                    },
                )
            await database.candidates.update_one(
                {"$or": [{"user_id": doc["owner_id"]}, {"email": doc.get("owner_email")}]},
                {
                    "$set": {
                        "document_verification.verification_status": "verified",
                        "document_verification.recruiter_override": True,
                        "document_verification.recruiter_override_by": current_user.id,
                        "document_verification.recruiter_override_at": now,
                        "document_verification.summary": None,
                    }
                },
            )
            await database.employees.update_one(
                {"$or": [{"user_id": doc["owner_id"]}, {"email": doc.get("owner_email")}]},
                {
                    "$set": {
                        "document_verification.verification_status": "verified",
                        "document_verification.recruiter_override": True,
                        "document_verification.recruiter_override_by": current_user.id,
                        "document_verification.recruiter_override_at": now,
                        "document_verification.summary": None,
                    }
                },
            )

        document_label = DOCUMENT_LABELS.get(doc["doc_type"], doc["doc_type"].replace("_", " ").title())
        candidate_link = "/documents"
        if payload.status == "reupload_required":
            reason_label = (payload.rejection_reason or "other").replace("_", " ")
            notification_title = f"Re-upload required: {document_label}"
            notification_message = f"Your recruiter requested a new {document_label}. Reason: {reason_label}."
            if payload.note:
                notification_message += f" Note: {payload.note}"
            notification_type = "document_reupload_required"
        else:
            notification_title = f"Document {update['status'].replace('_', ' ')}"
            notification_message = (
                f"Your {document_label} was marked {update['status'].replace('_', ' ')}."
            )
            notification_type = f"document_{update['status']}"

        await create_notification(
            recipient_id=doc["owner_id"],
            recipient_role=doc["owner_role"],
            notif_type=notification_type,
            title=notification_title,
            message=notification_message,
            link=candidate_link,
            related_id=str(doc["_id"]),
        )

        email_sent = None
        email_error = None
        if doc.get("owner_email"):
            import asyncio

            dashboard_link = f"{settings.FRONTEND_URL.rstrip('/')}{candidate_link}"
            try:
                if payload.status == "reupload_required":
                    await asyncio.to_thread(
                        email_service.send_document_reupload_request,
                        doc["owner_email"],
                        doc.get("owner_name") or "Candidate",
                        document_label,
                        (payload.rejection_reason or "other").replace("_", " "),
                        payload.note,
                        dashboard_link,
                    )
                else:
                    await asyncio.to_thread(
                        email_service.send_document_status_update,
                        doc["owner_email"],
                        doc.get("owner_name") or "Candidate",
                        document_label,
                        update["status"].replace("_", " "),
                        dashboard_link,
                        payload.note,
                    )
                email_sent = True
            except Exception as exc:
                # The in-app request is authoritative; SMTP failure must not undo it.
                email_sent = False
                email_error = str(exc)

        await database.audit_logs.insert_one(
            {
                "user_id": current_user.id,
                "actor_email": current_user.email,
                "module": "documents",
                "action": (
                    "document_reupload_requested"
                    if payload.status == "reupload_required"
                    else f"document_{update['status']}"
                ),
                "document_id": str(doc["_id"]),
                "owner_id": doc["owner_id"],
                "doc_type": doc["doc_type"],
                "reason": payload.rejection_reason,
                "note": payload.note,
                "email_sent": email_sent,
                "email_error": email_error,
                "outcome": "success",
                "created_at": now,
            }
        )
        doc.update(update)
        return {
            "message": (
                "Re-upload request sent to the candidate."
                if payload.status == "reupload_required"
                else "Document verification updated."
            ),
            "email_sent": email_sent,
            "document": self._public(doc),
        }

    async def reextract(self, current_user: CurrentUser, document_id: str) -> dict:
        """Re-run extraction on the stored file while retaining the original audit copy."""
        doc = await self._find(document_id)
        self._assert_document_access(current_user, doc)
        if doc.get("deleted_at"):
            raise HTTPException(status_code=404, detail="Document has been deleted.")

        if not _should_run_ocr(doc_type=doc.get("doc_type") or "", purpose=doc.get("purpose")):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="OCR re-extraction is only available for National ID (CNIC) documents.",
            )

        try:
            local_path = await storage_service.materialize_local_file(doc)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

        import asyncio

        try:
            raw_text = await asyncio.to_thread(document_extraction_service.extract_text, local_path)
        finally:
            if doc.get("storage_backend") in {"cloudinary", "supabase"}:
                try:
                    Path(local_path).unlink(missing_ok=True)
                except OSError:
                    pass
        parsed = await document_extraction_service.parse_structured_data(raw_text)
        expected = document_extraction_service.resolve_expected_categories(
            purpose=doc.get("purpose"),
            doc_type=doc.get("doc_type"),
            category=doc.get("category"),
        )
        validation = document_extraction_service.validate_classification(
            parsed,
            expected,
            purpose=doc.get("purpose"),
            doc_type=doc.get("doc_type"),
        )

        extraction_confidence = float(parsed.get("extraction_confidence") or 0.0)
        classification_confidence = float(
            validation.get("classification_confidence")
            or parsed.get("classification_confidence")
            or 0.0
        )
        accepted = bool(raw_text.strip()) and validation["accepted"]
        low_quality = accepted and extraction_confidence < 0.2

        if not raw_text.strip():
            extraction_status = "failed"
            rejection_message = "Could not read text from this document. Please upload a clearer scan."
        elif not validation["accepted"]:
            extraction_status = "rejected_type"
            rejection_message = validation["rejection_message"]
        else:
            extraction_status = "completed"
            rejection_message = None

        ocr_result = {
            "status": extraction_status,
            "confidence": extraction_confidence or classification_confidence,
            "extraction_confidence": extraction_confidence,
            "classification_confidence": classification_confidence,
            "matching_confidence": None,
            "raw_text": raw_text,
            "category": validation["category"],
            "fields": parsed.get("fields") or {} if accepted else {},
            "engine": "document_extraction_service",
            "accepted": accepted,
            "rejection_message": rejection_message,
            "low_quality": low_quality,
            "quality_warning": (
                "Only a small amount of reliable information was extracted. "
                "Please review every auto-filled value."
                if low_quality
                else None
            ),
        }
        now = datetime.now(UTC)
        previous_snapshot = {
            "ocr_result": doc.get("ocr_result"),
            "extraction_timestamp": (
                doc.get("extraction_timestamp").isoformat()
                if hasattr(doc.get("extraction_timestamp"), "isoformat")
                else doc.get("extraction_timestamp")
            ),
            "reextracted_at": now.isoformat(),
        }
        update = {
            "ocr_result": ocr_result,
            "raw_extracted_text": raw_text,
            "extraction_timestamp": now,
            "status": "pending_verification" if accepted else "reupload_required",
            "verification_status": "pending" if accepted else "rejected",
            "verified_by": None,
            "verified_at": None,
            "updated_at": now,
        }
        await database.documents.update_one(
            {"_id": doc["_id"]},
            {"$set": update, "$push": {"extraction_history": previous_snapshot}},
        )
        doc.update(update)

        if accepted and doc.get("is_active"):
            profile_verification = await self._run_cross_document_match(doc["owner_id"])
            ocr_result["matching_confidence"] = profile_verification.get("matching_confidence")
            doc["profile_verification"] = profile_verification
            doc["mismatch_reasons"] = profile_verification.get("mismatches") or []
            await database.documents.update_one(
                {"_id": doc["_id"]},
                {
                    "$set": {
                        "ocr_result": ocr_result,
                        "profile_verification": profile_verification,
                        "mismatch_reasons": doc["mismatch_reasons"],
                    }
                },
            )

        await database.audit_logs.insert_one(
            {
                "user_id": current_user.id,
                "actor_email": current_user.email,
                "module": "documents",
                "action": "document_reextracted",
                "document_id": str(doc["_id"]),
                "outcome": "success" if accepted else "failed",
                "created_at": now,
            }
        )
        return {"message": "Document extraction completed.", "document": self._public(doc)}

    async def delete(self, current_user: CurrentUser, document_id: str) -> dict:
        """Soft-delete metadata, remove stored bytes, and rerun consistency checks."""
        doc = await self._find(document_id)
        if current_user.role != "super_admin" and doc.get("owner_id") != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized to delete this document.")
        if doc.get("deleted_at"):
            return {"message": "Document already deleted."}

        now = datetime.now(UTC)
        await database.documents.update_one(
            {"_id": doc["_id"]},
            {
                "$set": {
                    "is_active": False,
                    "status": "deleted",
                    "deleted_at": now,
                    "deleted_by": current_user.id,
                    "updated_at": now,
                }
            },
        )
        await storage_service.delete_file(doc)
        await self._clear_profile_document_reference(doc)

        profile_verification = await self._run_cross_document_match(doc["owner_id"])
        await database.audit_logs.insert_one(
            {
                "user_id": current_user.id,
                "actor_email": current_user.email,
                "module": "documents",
                "action": "document_deleted",
                "document_id": str(doc["_id"]),
                "outcome": "success",
                "created_at": now,
            }
        )
        return {
            "message": "Document deleted.",
            "document_verification": profile_verification,
        }

    async def _clear_profile_document_reference(self, doc: dict) -> None:
        for collection in (database.candidates, database.employees):
            owner = await collection.find_one(
                {
                    "$or": [
                        {"user_id": doc["owner_id"]},
                        {"email": doc.get("owner_email")},
                    ]
                }
            )
            if not owner:
                continue
            onboarding = dict(owner.get("onboarding") or {})
            changed = False
            file_url = doc.get("file_url")
            if doc.get("doc_type") == "resume":
                resume = dict(onboarding.get("resume") or {})
                if not file_url or resume.get("file_url") == file_url:
                    resume.update({"file_name": None, "file_url": None})
                    onboarding["resume"] = resume
                    changed = True
            elif doc.get("doc_type") in ("cnic", "passport"):
                government = dict(onboarding.get("government_docs") or {})
                documents = list(government.get("documents") or [])
                filtered = [
                    item
                    for item in documents
                    if item.get("file_url") != file_url
                ]
                if len(filtered) != len(documents):
                    government["documents"] = filtered
                    onboarding["government_docs"] = government
                    changed = True
            elif doc.get("doc_type") == "transcript":
                education = dict(onboarding.get("education") or {})
                entries = list(education.get("entries") or [])
                for entry in entries:
                    if entry.get("certificate_file") == file_url:
                        entry["certificate_file"] = None
                        changed = True
                if changed:
                    education["entries"] = entries
                    onboarding["education"] = education
            if changed:
                await collection.update_one(
                    {"_id": owner["_id"]},
                    {"$set": {"onboarding": onboarding, "updated_at": datetime.now(UTC)}},
                )

    @staticmethod
    def _assert_document_access(current_user: CurrentUser, doc: dict) -> None:
        if current_user.role not in ("recruiter", "super_admin") and doc.get("owner_id") != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized to access this document.")

    async def get_signed_url(self, current_user: CurrentUser, document_id: str, request) -> dict:
        doc = await self._find(document_id)
        if current_user.role not in ("recruiter", "super_admin") and doc["owner_id"] != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized to view this document.")
        url = await storage_service.get_signed_url(doc)
        await database.audit_logs.insert_one(
            {
                "user_id": current_user.id,
                "module": "documents",
                "action": "document_download",
                "document_id": str(doc["_id"]),
                "outcome": "success" if url else "failed",
                "created_at": datetime.now(UTC),
            }
        )
        if not url:
            raise HTTPException(status_code=404, detail="File not available.")
        return {"url": url, "expires_in": settings.SIGNED_URL_EXPIRE_SECONDS}

    async def generate_resume_embedding(self, current_user: CurrentUser, resume_text: str) -> None:
        embedding = await embedding_service.generate_embedding(resume_text)
        if not embedding:
            return
        await database.candidates.update_one(
            {"$or": [{"user_id": current_user.id}, {"email": current_user.email}]},
            {"$set": {"resume_embedding": embedding, "resume_embedding_updated_at": datetime.now(UTC)}},
        )

    async def _resolve_profile_fields(self, owner_id: str) -> dict:
        owner = await database.candidates.find_one(
            {"$or": [{"user_id": owner_id}, {"email": owner_id}]}
        ) or await database.employees.find_one({"$or": [{"user_id": owner_id}, {"email": owner_id}]})
        if not owner:
            return {}
        personal = (owner.get("onboarding") or {}).get("personal") or {}
        full_name = owner.get("full_name")
        if not full_name:
            parts = [personal.get("first_name") or "", personal.get("last_name") or ""]
            full_name = " ".join(p for p in parts if p).strip() or None
        return {
            "full_name": full_name,
            "cnic_number": personal.get("national_id"),
            "date_of_birth": str(personal.get("date_of_birth") or "") or None,
        }

    def _assert_recruiter(self, current_user: CurrentUser) -> None:
        if current_user.role not in ("recruiter", "super_admin"):
            raise HTTPException(status_code=403, detail="Not authorized.")

    async def _find(self, document_id: str) -> dict:
        query_or = [{"object_path": document_id}]
        if ObjectId.is_valid(document_id):
            query_or.append({"_id": ObjectId(document_id)})
        doc = await database.documents.find_one({"$or": query_or})
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found.")
        return doc

    @staticmethod
    def _public(doc: dict) -> dict:
        return {
            "id": str(doc.get("_id", "")),
            "owner_id": doc.get("owner_id"),
            "owner_name": doc.get("owner_name"),
            "category": doc.get("category"),
            "doc_type": doc.get("doc_type"),
            "purpose": doc.get("purpose"),
            "file_name": doc.get("file_name"),
            "file_url": doc.get("file_url"),
            "status": doc.get("status"),
            "version": doc.get("version"),
            "document_hash": doc.get("document_hash"),
            "verification_status": doc.get("verification_status"),
            "verified_by": doc.get("verified_by"),
            "verified_at": doc.get("verified_at").isoformat()
            if hasattr(doc.get("verified_at"), "isoformat")
            else doc.get("verified_at"),
            "rejection_reason": doc.get("rejection_reason"),
            "rejection_note": doc.get("rejection_note"),
            "reupload_request_status": doc.get("reupload_request_status"),
            "reupload_requested_by": doc.get("reupload_requested_by"),
            "reupload_requested_at": doc.get("reupload_requested_at").isoformat()
            if hasattr(doc.get("reupload_requested_at"), "isoformat")
            else doc.get("reupload_requested_at"),
            "reupload_request_reason": doc.get("reupload_request_reason"),
            "reupload_request_note": doc.get("reupload_request_note"),
            "reupload_request_id": doc.get("reupload_request_id"),
            "mismatch_reasons": doc.get("mismatch_reasons") or [],
            "mismatch_approved": doc.get("mismatch_approved"),
            "profile_verification": doc.get("profile_verification"),
            "ocr_result": doc.get("ocr_result"),
            "raw_extracted_text": doc.get("raw_extracted_text"),
            "extraction_timestamp": doc.get("extraction_timestamp").isoformat()
            if hasattr(doc.get("extraction_timestamp"), "isoformat")
            else doc.get("extraction_timestamp"),
            "uploaded_at": doc.get("uploaded_at").isoformat()
            if hasattr(doc.get("uploaded_at"), "isoformat")
            else doc.get("uploaded_at"),
        }


document_service = DocumentService()

"""Epic 4: Document Management & Verification (US-036 .. US-050)."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from bson import ObjectId
from fastapi import HTTPException, UploadFile, status

from app.core.config import settings
from app.core.rbac import CurrentUser
from app.core.database import database
from app.services import embedding_service, ocr_service, storage_service
from app.services.document_extraction_service import document_extraction_service
from app.services.dashboard_service import create_notification

MAX_UPLOAD_BYTES = settings.MAX_DOCUMENT_MB * 1024 * 1024

# US-040: strict allow-list. Resumes additionally accept Word docs.
STRICT_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png"}
RESUME_EXTENSIONS = STRICT_EXTENSIONS | {".doc", ".docx"}

OCR_ELIGIBLE_CATEGORIES = {"identity", "education"}


def _extensions_for(category: str) -> set[str]:
    return RESUME_EXTENSIONS if category == "other" else STRICT_EXTENSIONS


class DocumentService:
    async def upload(
        self,
        current_user: CurrentUser,
        *,
        file: UploadFile,
        category: str,
        doc_type: str,
    ) -> dict:
        original = file.filename or "upload.bin"
        ext = Path(original).suffix.lower()
        allowed = _extensions_for(category)
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

        stored = await storage_service.save_file(current_user.id, category, original, content)
        now = datetime.now(UTC)

        # US-039/US-047: one *active* document per (owner, doc_type); older upload
        # becomes a version in history rather than being deleted.
        previous = await database.documents.find_one(
            {"owner_id": current_user.id, "doc_type": doc_type, "is_active": True}
        )
        version = 1
        if previous:
            version = int(previous.get("version", 1)) + 1
            await database.documents.update_one({"_id": previous["_id"]}, {"$set": {"is_active": False}})

        needs_ocr = settings.ENABLE_OCR

        doc = {
            "owner_id": current_user.id,
            "owner_role": current_user.role,
            "owner_email": current_user.email,
            "owner_name": current_user.full_name,
            "category": category,
            "doc_type": doc_type,
            "file_name": original,
            "storage_backend": stored["backend"],
            "object_path": stored["object_path"],
            "file_url": stored["file_url"],
            "version": version,
            "previous_version_id": str(previous["_id"]) if previous else None,
            "is_active": True,
            "status": "processing" if needs_ocr else "pending_verification",
            "ocr_result": None,
            "raw_extracted_text": None,
            "verification_status": "pending",
            "verified_by": None,
            "verified_at": None,
            "rejection_reason": None,
            "rejection_note": None,
            "uploaded_at": now,
            "updated_at": now,
        }
        result = await database.documents.insert_one(doc)
        doc["_id"] = result.inserted_id

        if needs_ocr:
            import asyncio
            try:
                def _run_extraction():
                    return document_extraction_service.extract_text(stored["local_path"])
                
                raw_text = await asyncio.to_thread(_run_extraction)
                parsed = await document_extraction_service.parse_structured_data(raw_text)
                
                ocr_result = {
                    "status": "completed" if raw_text.strip() else "failed",
                    "confidence": 1.0 if raw_text.strip() else 0.0,
                    "raw_text": raw_text,
                    "category": parsed.get("category", "unknown"),
                    "fields": parsed.get("fields", {}),
                    "engine": "document_extraction_service"
                }
            except Exception as exc:
                raw_text = ""
                ocr_result = {
                    "status": "failed",
                    "confidence": 0.0,
                    "raw_text": "",
                    "category": "unknown",
                    "fields": {},
                    "engine": "document_extraction_service",
                    "error": str(exc),
                }

            update = {
                "ocr_result": ocr_result,
                "raw_extracted_text": raw_text,
                "status": "pending_verification" if ocr_result["status"] == "completed" else "reupload_required"
                if ocr_result["status"] == "failed"
                else "pending_verification",
                "updated_at": datetime.now(UTC),
            }
            await database.documents.update_one({"_id": doc["_id"]}, {"$set": update})
            doc.update(update)

            # Generate resume embeddings for Phase 3 prep if enabled
            if (doc_type == "resume" or ocr_result.get("category") == "resume") and settings.ENABLE_EMBEDDINGS and raw_text:
                try:
                    await self.generate_resume_embedding(current_user, raw_text)
                except Exception:
                    pass

        await self._notify_recruiter_owner(current_user, doc_type, category)
        await database.audit_logs.insert_one(
            {
                "user_id": current_user.id,
                "email": current_user.email,
                "module": "documents",
                "action": "document_uploaded",
                "doc_type": doc_type,
                "category": category,
                "outcome": "success",
                "created_at": now,
            }
        )

        return {"message": "Document uploaded.", "document": self._public(doc)}

    async def _notify_recruiter_owner(self, current_user: CurrentUser, doc_type: str, category: str) -> None:
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
            notif_type="document_uploaded",
            title="Document uploaded",
            message=f"{current_user.full_name} uploaded a {doc_type.replace('_', ' ')} document for review.",
            link="/dashboard/recruiter#documents-section",
            related_id=current_user.id,
        )

    async def list_mine(self, current_user: CurrentUser) -> dict:
        docs = (
            await database.documents.find({"owner_id": current_user.id, "is_active": True})
            .sort("uploaded_at", -1)
            .to_list(length=100)
        )
        return {"documents": [self._public(d) for d in docs]}

    async def list_for_owner(self, current_user: CurrentUser, owner_id: str) -> dict:
        self._assert_recruiter(current_user)
        docs = (
            await database.documents.find({"owner_id": owner_id, "is_active": True})
            .sort("uploaded_at", -1)
            .to_list(length=100)
        )
        profile = await self._resolve_profile_fields(owner_id)
        enriched = []
        for d in docs:
            payload = self._public(d)
            ocr_fields = (d.get("ocr_result") or {}).get("fields") or {}
            if ocr_fields:
                payload["mismatches"] = ocr_service.compare_with_profile(ocr_fields, profile)
            enriched.append(payload)
        return {"documents": enriched}

    async def verify(self, current_user: CurrentUser, document_id: str, payload) -> dict:
        self._assert_recruiter(current_user)
        doc = await self._find(document_id)
        if payload.status not in ("verified", "rejected", "reupload_required"):
            raise HTTPException(status_code=400, detail="Invalid verification status.")
        if payload.status in ("rejected", "reupload_required") and not payload.rejection_reason:
            raise HTTPException(status_code=400, detail="A rejection reason is required.")

        now = datetime.now(UTC)
        update = {
            "status": payload.status,
            "verification_status": payload.status,
            "verified_by": current_user.id,
            "verified_at": now,
            "rejection_reason": payload.rejection_reason,
            "rejection_note": payload.note,
            "updated_at": now,
        }
        await database.documents.update_one({"_id": doc["_id"]}, {"$set": update})

        await create_notification(
            recipient_id=doc["owner_id"],
            recipient_role=doc["owner_role"],
            notif_type=f"document_{payload.status}",
            title=f"Document {payload.status.replace('_', ' ')}",
            message=f"Your {doc['doc_type'].replace('_', ' ')} document was marked {payload.status.replace('_', ' ')}.",
            link="/dashboard/candidate#documents-section"
            if doc["owner_role"] == "candidate"
            else "/dashboard/employee#documents-section",
            related_id=str(doc["_id"]),
        )
        doc.update(update)
        return {"message": "Document verification updated.", "document": self._public(doc)}

    async def get_signed_url(self, current_user: CurrentUser, document_id: str) -> dict:
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
        """Phase-3 prep only — no-op unless settings.ENABLE_EMBEDDINGS is set."""
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
        return {
            "full_name": owner.get("full_name"),
            "cnic_number": personal.get("national_id"),
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
            "file_name": doc.get("file_name"),
            "status": doc.get("status"),
            "version": doc.get("version"),
            "verification_status": doc.get("verification_status"),
            "verified_by": doc.get("verified_by"),
            "verified_at": doc.get("verified_at").isoformat() if hasattr(doc.get("verified_at"), "isoformat") else doc.get("verified_at"),
            "rejection_reason": doc.get("rejection_reason"),
            "rejection_note": doc.get("rejection_note"),
            "ocr_result": doc.get("ocr_result"),
            "raw_extracted_text": doc.get("raw_extracted_text"),
            "uploaded_at": doc.get("uploaded_at").isoformat() if hasattr(doc.get("uploaded_at"), "isoformat") else doc.get("uploaded_at"),
        }


document_service = DocumentService()

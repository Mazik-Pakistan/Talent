from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile

from app.core.rbac import CurrentUser
from app.core.security import RequireUser, require_roles
from app.schemas.document import DOCUMENT_CATEGORIES, DocumentVerifyRequest
from app.services.document_service import document_service

router = APIRouter(prefix="/api/documents", tags=["Documents"])

RequireRecruiter = Annotated[CurrentUser, Depends(require_roles("recruiter", "super_admin"))]
RequireSelf = Annotated[CurrentUser, Depends(require_roles("candidate", "employee", "super_admin"))]


@router.post("/upload")
async def upload_document(
    current_user: RequireSelf,
    file: UploadFile = File(...),
    category: str = Form(...),
    doc_type: str = Form(...),
    purpose: str | None = Form(default=None),
):
    """US-036/US-037/US-038: upload + classify + validate + OCR for identity/education/resume docs."""
    if category not in DOCUMENT_CATEGORIES:
        category = "other"
    # Identity uploads are restricted to CNIC or Passport.
    if category == "identity" and doc_type not in ("cnic", "passport"):
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail="Identity document must be a National ID (CNIC/NIC) or Passport.")
    if doc_type == "transcript":
        category = "education"
    return await document_service.upload(
        current_user, file=file, category=category, doc_type=doc_type, purpose=purpose
    )


@router.get("/me")
async def list_my_documents(current_user: RequireSelf):
    """US-049: candidate/employee's own document list with live status."""
    return await document_service.list_mine(current_user)


@router.get("/owner/{owner_id}")
async def list_owner_documents(owner_id: str, current_user: RequireRecruiter):
    """US-042: recruiter review view — includes OCR result + mismatches vs profile."""
    return await document_service.list_for_owner(current_user, owner_id)


@router.put("/{document_id}/verify")
async def verify_document(document_id: str, payload: DocumentVerifyRequest, current_user: RequireRecruiter):
    """US-042/US-043: approve, reject (with reason), or request re-upload."""
    return await document_service.verify(current_user, document_id, payload)


@router.get("/{document_id}/download")
async def download_document(document_id: str, request: Request, current_user: RequireUser):
    """US-048/US-050: authenticated, authorized, signed-URL download."""
    return await document_service.get_signed_url(current_user, document_id, request)

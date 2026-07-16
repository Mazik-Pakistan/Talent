import uuid
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from app.core.rbac import CurrentUser
from app.core.security import require_permissions, require_roles
from app.schemas.employee import CreateFromCandidateRequest, GenerateEmployeeIdRequest
from app.services import storage_service
from app.services.candidate_service import CandidateService
from app.services.document_service import document_service
from app.services.employee_service import EmployeeService

router = APIRouter(prefix="/api/employees", tags=["Employees"])
service = EmployeeService()
candidate_service = CandidateService()

RequireRecruiter = Annotated[CurrentUser, Depends(require_roles("recruiter", "super_admin"))]
RequireEmployee = Annotated[CurrentUser, Depends(require_roles("employee", "super_admin"))]
RequireCandidate = Annotated[CurrentUser, Depends(require_permissions("onboarding.self"))]

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".doc", ".docx"}

PURPOSE_TO_CATEGORY = {
    "resume": "other",
    "government_doc": "identity",
    "education_cert": "education",
}
PURPOSE_TO_DEFAULT_DOC_TYPE = {
    "resume": "resume",
    "government_doc": "cnic",
    "education_cert": "degree",
}


@router.post("/generate-id")
async def generate_employee_id(
    current_user: RequireRecruiter,
    request: GenerateEmployeeIdRequest = GenerateEmployeeIdRequest(),
):
    """US-024: Preview / allocate a unique Employee ID (MZK-YYYY-000123)."""
    return await service.generate_employee_id(request.year)


@router.post("/create-from-candidate", status_code=201)
async def create_from_candidate(request: CreateFromCandidateRequest, current_user: RequireRecruiter):
    """US-023: Activate an employee for a candidate whose offer has been signed & approved.

    NOTE: as of the offer-letter flow, this is normally called internally by
    OfferService.approve(). It stays exposed for recruiters recovering from a
    failed auto-activation, but still enforces the same offer-signed gate.
    """
    return await service.create_from_candidate(current_user, request.candidate_id)


@router.get("/pending-review")
async def list_pending_review(current_user: RequireRecruiter):
    """Candidates who submitted their intake and are awaiting an offer letter."""
    return await service.list_pending_review(current_user)


@router.get("/ready-for-conversion")
async def list_ready_for_conversion(current_user: RequireRecruiter):
    """Candidates whose offer has been signed and is awaiting HR approval/activation."""
    return await service.list_ready_for_conversion(current_user)


@router.get("")
async def list_employees(current_user: RequireRecruiter):
    return await service.list_employees(current_user)


@router.get("/me")
async def get_my_employee_profile(current_user: RequireEmployee):
    return await service.get_my_profile(current_user)


@router.get("/profile-completion")
async def get_profile_completion(current_user: RequireEmployee):
    """Post-hire 'complete your profile' checklist (emergency, banking, references, NDA, policies)."""
    return await service.get_profile_completion(current_user)


@router.put("/profile-completion")
async def save_profile_completion(payload: dict, current_user: RequireEmployee):
    from app.schemas.employee_profile import EmployeeProfileSaveRequest

    request = EmployeeProfileSaveRequest.model_validate(payload)
    return await service.save_profile_completion(current_user, request)


@router.get("/candidates/{candidate_id}")
async def get_candidate_detail(candidate_id: str, current_user: RequireRecruiter):
    return await service.get_candidate_detail(current_user, candidate_id)


@router.post("/upload")
async def upload_onboarding_file(
    current_user: RequireCandidate,
    file: UploadFile = File(...),
    purpose: Literal["resume", "government_doc", "education_cert"] = Form(...),
    doc_type: str | None = Form(default=None),
):
    """US-036/037: candidate intake upload — stored via storage_service and tracked as a
    Document (with OCR auto-triggered for identity/education categories), then reflected
    into the onboarding wizard's local draft state."""
    if current_user.role not in ("candidate", "super_admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only candidates can upload onboarding files.")

    original = file.filename or "upload.bin"
    ext = Path(original).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}")

    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="File is too large (max 10 MB).")
    await file.seek(0)

    category = PURPOSE_TO_CATEGORY.get(purpose, "other")
    resolved_doc_type = doc_type or PURPOSE_TO_DEFAULT_DOC_TYPE.get(purpose, "other")

    stored = await storage_service.save_file(current_user.id, category, original, content)
    file_url = stored["file_url"] or f"/api/documents/{stored['object_path']}/download"

    # Track as a first-class Document (drives OCR + recruiter review UI).
    class _FakeUpload:
        filename = original

        async def read(self_inner):
            return content

    try:
        await document_service.upload(current_user, file=_FakeUpload(), category=category, doc_type=resolved_doc_type)
    except HTTPException:
        raise
    except Exception:
        pass  # Document tracking is best-effort; the wizard attachment below always succeeds.

    return await candidate_service.attach_uploaded_file(
        current_user,
        purpose=purpose,
        file_name=original,
        file_url=file_url,
        doc_type=doc_type,
    )

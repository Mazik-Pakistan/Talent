import os
import uuid
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, UploadFile

from app.core.rbac import CurrentUser
from app.core.security import require_permissions, require_roles
from app.schemas.employee import CreateFromCandidateRequest, GenerateEmployeeIdRequest
from app.services.candidate_service import CandidateService
from app.services.employee_service import EmployeeService

router = APIRouter(prefix="/api/employees", tags=["Employees"])
service = EmployeeService()
candidate_service = CandidateService()

RequireRecruiter = Annotated[CurrentUser, Depends(require_roles("recruiter", "super_admin"))]
RequireEmployee = Annotated[CurrentUser, Depends(require_roles("employee", "super_admin"))]
RequireCandidate = Annotated[CurrentUser, Depends(require_permissions("onboarding.self"))]

UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "uploads"
ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".doc", ".docx"}
MAX_UPLOAD_BYTES = 8 * 1024 * 1024


@router.post("/generate-id")
async def generate_employee_id(
    current_user: RequireRecruiter,
    request: GenerateEmployeeIdRequest = GenerateEmployeeIdRequest(),
):
    """US-024: Preview / allocate a unique Employee ID (MZK-YYYY-000123)."""
    return await service.generate_employee_id(request.year)


@router.post("/create-from-candidate", status_code=201)
async def create_from_candidate(request: CreateFromCandidateRequest, current_user: RequireRecruiter):
    """US-023: Convert a fully onboarded candidate into an employee."""
    return await service.create_from_candidate(current_user, request.candidate_id)


@router.get("/ready-for-conversion")
async def list_ready_for_conversion(current_user: RequireRecruiter):
    return await service.list_ready_for_conversion(current_user)


@router.get("")
async def list_employees(current_user: RequireRecruiter):
    return await service.list_employees(current_user)


@router.get("/me")
async def get_my_employee_profile(current_user: RequireEmployee):
    return await service.get_my_profile(current_user)


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
    """Store an onboarding document for the current candidate."""
    if current_user.role not in ("candidate", "super_admin"):
        from fastapi import HTTPException, status

        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only candidates can upload onboarding files.")

    original = file.filename or "upload.bin"
    ext = Path(original).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail=f"Unsupported file type. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}")

    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail="File is too large (max 8 MB).")

    folder = UPLOAD_ROOT / current_user.id
    folder.mkdir(parents=True, exist_ok=True)
    stored_name = f"{purpose}_{uuid.uuid4().hex}{ext}"
    dest = folder / stored_name
    dest.write_bytes(content)

    # Public-ish path served via /uploads static mount
    file_url = f"/uploads/{current_user.id}/{stored_name}"
    return await candidate_service.attach_uploaded_file(
        current_user,
        purpose=purpose,
        file_name=original,
        file_url=file_url,
        doc_type=doc_type,
    )

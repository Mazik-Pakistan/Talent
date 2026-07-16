from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status

from app.core.rbac import CurrentUser
from app.core.security import require_permissions, require_roles
from app.schemas.career import CareerEventCreateRequest
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
    "certification": "other",
}
PURPOSE_TO_DEFAULT_DOC_TYPE = {
    "resume": "resume",
    "government_doc": "cnic",
    "education_cert": "degree",
    "certification": "certificate",
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
    return await service.create_from_candidate(current_user, request.candidate_id)


@router.get("/pending-review")
async def list_pending_review(current_user: RequireRecruiter):
    return await service.list_pending_review(current_user)


@router.get("/ready-for-conversion")
async def list_ready_for_conversion(current_user: RequireRecruiter):
    return await service.list_ready_for_conversion(current_user)


@router.get("/export.csv")
async def export_employees_csv(
    current_user: RequireRecruiter,
    q: str | None = None,
    employee_id: str | None = None,
    department: str | None = None,
    job_title: str | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    joining_from: str | None = None,
    joining_to: str | None = None,
    sort: str = "created_at",
):
    """US-035: CSV export of employee directory with the same filters as list."""
    content = await service.export_employees_csv(
        current_user,
        q=q,
        employee_id=employee_id,
        department=department,
        job_title=job_title,
        status=status_filter,
        joining_from=joining_from,
        joining_to=joining_to,
        sort=sort,
    )
    return Response(
        content=content,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=employees.csv"},
    )


@router.get("")
async def list_employees(
    current_user: RequireRecruiter,
    q: str | None = None,
    employee_id: str | None = None,
    department: str | None = None,
    job_title: str | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    joining_from: str | None = None,
    joining_to: str | None = None,
    sort: str = "created_at",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    """US-035: searchable, filterable, paginated employee directory."""
    return await service.list_employees(
        current_user,
        q=q,
        employee_id=employee_id,
        department=department,
        job_title=job_title,
        status=status_filter,
        joining_from=joining_from,
        joining_to=joining_to,
        sort=sort,
        page=page,
        page_size=page_size,
    )


@router.get("/me")
async def get_my_employee_profile(current_user: RequireEmployee):
    return await service.get_my_profile(current_user)


@router.get("/profile-completion")
async def get_profile_completion(current_user: RequireEmployee):
    return await service.get_profile_completion(current_user)


@router.put("/profile-completion")
async def save_profile_completion(payload: dict, current_user: RequireEmployee):
    from app.schemas.employee_profile import EmployeeProfileSaveRequest

    request = EmployeeProfileSaveRequest.model_validate(payload)
    return await service.save_profile_completion(current_user, request)


@router.get("/candidates/{candidate_id}")
async def get_candidate_detail(candidate_id: str, current_user: RequireRecruiter):
    return await service.get_candidate_detail(current_user, candidate_id)


@router.get("/detail/{employee_id}")
async def get_employee_detail(employee_id: str, current_user: RequireRecruiter):
    """US-035: open full employee profile from the directory.

    Dedicated path (not /{employee_id}) so IDs like MZK-2026-000123 never collide
    with static routes such as /me, /upload, or /export.csv.
    """
    return await service.get_employee_profile(current_user, employee_id, reveal_banking=False)


@router.get("/{employee_id}/career")
async def list_career(employee_id: str, current_user: RequireRecruiter):
    employee = await service.get_employee_profile(current_user, employee_id)
    return {"events": employee["employee"].get("career") or []}


@router.post("/{employee_id}/career", status_code=201)
async def add_career(
    employee_id: str,
    request: CareerEventCreateRequest,
    current_user: RequireRecruiter,
):
    return await service.add_career_event(current_user, employee_id, request)


@router.get("/{employee_id}")
async def get_employee_detail_legacy(employee_id: str, current_user: RequireRecruiter):
    """Backward-compatible alias for /detail/{employee_id}."""
    return await service.get_employee_profile(current_user, employee_id, reveal_banking=False)


@router.post("/upload")
async def upload_onboarding_file(
    current_user: RequireCandidate,
    file: UploadFile = File(...),
    purpose: Literal["resume", "government_doc", "education_cert", "certification"] = Form(...),
    doc_type: str | None = Form(default=None),
):
    if current_user.role not in ("candidate", "employee", "super_admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only candidates/employees can upload files.")

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

    class _FakeUpload:
        filename = original

        async def read(self_inner):
            return content

    ocr_result = None
    try:
        doc_res = await document_service.upload(current_user, file=_FakeUpload(), category=category, doc_type=resolved_doc_type)
        if doc_res and "document" in doc_res:
            ocr_result = doc_res["document"].get("ocr_result")
    except HTTPException:
        raise
    except Exception:
        pass

    if current_user.role == "candidate":
        resp = await candidate_service.attach_uploaded_file(
            current_user,
            purpose=purpose if purpose != "certification" else "education_cert",
            file_name=original,
            file_url=file_url,
            doc_type=doc_type,
        )
    else:
        resp = {"file_name": original, "file_url": file_url, "purpose": purpose}
    if ocr_result:
        resp["ocr_result"] = ocr_result
    return resp

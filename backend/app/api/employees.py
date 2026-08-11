from pathlib import Path
from typing import Literal, Annotated

from fastapi import APIRouter, Body, File, Form, HTTPException, Query, Response, UploadFile, status, Depends

from app.core.rbac import CurrentUser
from app.core.security import RequireOnboardingSelf as RequireCandidate
from app.core.security import RequireEmployee, RequireRecruiter, require_capabilities, require_roles
from app.schemas.career import CareerEventCreateRequest, RoleAssignRequest
from app.schemas.employee import CreateFromCandidateRequest, GenerateEmployeeIdRequest
from app.schemas.employee_exit import EmployeeExitRequest
from app.schemas.onboarding_assignment import (
    AssetAssignRequest,
    AssetUpdateRequest,
    CompanyEmailRequest,
    OrientationScheduleRequest,
)
from app.services.candidate_service import CandidateService
from app.services.document_service import document_service
from app.services.employee_service import EmployeeService

router = APIRouter(prefix="/api/employees", tags=["Employees"])
service = EmployeeService()
candidate_service = CandidateService()

RequireRecruiterWithEmployees = Annotated[
    CurrentUser,
    Depends(require_roles("recruiter", "super_admin")),
    Depends(require_capabilities("employees")),
]
RequireRecruiterWithCandidates = Annotated[
    CurrentUser,
    Depends(require_roles("recruiter", "super_admin")),
    Depends(require_capabilities("candidates")),
]

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".doc", ".docx"}

PURPOSE_TO_CATEGORY = {
    "resume": "other",
    "government_doc": "identity",
    "education_cert": "education",
    "skill_cert": "other",
}
PURPOSE_TO_DEFAULT_DOC_TYPE = {
    "resume": "resume",
    "government_doc": "cnic",
    "education_cert": "transcript",
    "skill_cert": "other",
}
IDENTITY_DOC_TYPES = {"cnic"}


@router.post("/generate-id")
async def generate_employee_id(
    current_user: RequireRecruiterWithEmployees,
    request: GenerateEmployeeIdRequest = GenerateEmployeeIdRequest(),
):
    """US-024: Preview / allocate a unique Employee ID (EMP-000001)."""
    return await service.generate_employee_id(request.year)


@router.post("/create-from-candidate", status_code=201)
async def create_from_candidate(request: CreateFromCandidateRequest, current_user: RequireRecruiterWithEmployees):
    return await service.create_from_candidate(current_user, request.candidate_id)


@router.get("/historical-candidates")
async def list_historical_candidates(
    current_user: RequireRecruiterWithCandidates,
    q: str | None = None,
    reason: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    return await service.list_historical_candidates(
        current_user, q=q, reason=reason, page=page, page_size=page_size
    )


@router.get("/person-history")
async def lookup_person_history(current_user: RequireRecruiterWithCandidates, email: str = Query(..., min_length=3)):
    """Return all historical candidate cycles + employee tenures for an email (invite AI suggestions)."""
    return await service.lookup_person_history(current_user, email)


@router.get("/pending-review")
async def list_pending_review(current_user: RequireRecruiterWithCandidates):
    return await service.list_pending_review(current_user)


@router.get("/onboarding-in-progress")
async def list_onboarding_in_progress(current_user: RequireRecruiterWithCandidates):
    return await service.list_onboarding_in_progress(current_user)


@router.get("/candidates")
async def list_candidates(
    current_user: RequireRecruiterWithCandidates,
    q: str | None = None,
    status: str | None = None,
    profile_status: str | None = None,
    progress_min: int | None = Query(default=None, ge=0, le=100),
    progress_max: int | None = Query(default=None, ge=0, le=100),
    joined_from: str | None = None,
    joined_to: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    return await service.list_candidates(current_user, q=q, status=status, profile_status=profile_status,
                                         progress_min=progress_min, progress_max=progress_max,
                                         joined_from=joined_from, joined_to=joined_to, page=page, page_size=page_size)


@router.get("/ready-for-conversion")
async def list_ready_for_conversion(current_user: RequireRecruiterWithEmployees):
    return await service.list_ready_for_conversion(current_user)


@router.get("/export.csv")
async def export_employees_csv(
    current_user: RequireRecruiterWithEmployees,
    q: str | None = None,
    employee_id: str | None = None,
    department: str | None = None,
    job_title: str | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    profile_status: str | None = None,
    joining_from: str | None = None,
    joining_to: str | None = None,
    history_bucket: str | None = Query(default=None, pattern="^(active|historical|all)$"),
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
        profile_status=profile_status,
        joining_from=joining_from,
        joining_to=joining_to,
        history_bucket=history_bucket,
        sort=sort,
    )
    return Response(
        content=content,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=employees.csv"},
    )


@router.get("")
async def list_employees(
    current_user: RequireRecruiterWithEmployees,
    q: str | None = None,
    employee_id: str | None = None,
    department: str | None = None,
    job_title: str | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    profile_status: str | None = None,
    joining_from: str | None = None,
    joining_to: str | None = None,
    history_bucket: str | None = Query(default=None, pattern="^(active|historical|all)$"),
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
        profile_status=profile_status,
        joining_from=joining_from,
        joining_to=joining_to,
        history_bucket=history_bucket,
        sort=sort,
        page=page,
        page_size=page_size,
    )


@router.get("/me")
async def get_my_employee_profile(current_user: RequireEmployee):
    return await service.get_my_profile(current_user)


@router.post("/me/company-email-password/request-otp")
async def request_company_email_password_otp(current_user: RequireEmployee):
    """Send OTP to the employee's personal email to unlock company email password."""
    from app.services.it_provisioning_service import it_provisioning_service

    return await it_provisioning_service.request_password_otp(current_user)


@router.post("/me/company-email-password/reveal")
async def reveal_company_email_password(
    payload: dict,
    current_user: RequireEmployee,
):
    """Reveal encrypted company email password after OTP verification."""
    from app.schemas.it_provisioning import RevealCompanyEmailPasswordRequest
    from app.services.it_provisioning_service import it_provisioning_service

    request = RevealCompanyEmailPasswordRequest.model_validate(payload)
    return await it_provisioning_service.reveal_password(current_user, request.otp)


@router.post("/me/photo")
async def upload_my_employee_photo(
    current_user: RequireEmployee,
    file: UploadFile = File(...),
):
    return await service.upload_my_photo(current_user, file)


@router.delete("/me/photo")
async def remove_my_employee_photo(current_user: RequireEmployee):
    return await service.remove_my_photo(current_user)


@router.get("/profile-completion")
async def get_profile_completion(current_user: RequireEmployee):
    return await service.get_profile_completion(current_user)


@router.put("/profile-completion")
async def save_profile_completion(payload: dict, current_user: RequireEmployee):
    from app.schemas.employee_profile import EmployeeProfileSaveRequest
    from pydantic import ValidationError as PydanticValidationError

    try:
        request = EmployeeProfileSaveRequest.model_validate(payload)
    except PydanticValidationError as exc:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.errors(),
        )
    return await service.save_profile_completion(current_user, request)


@router.get("/candidates/{candidate_id}")
async def get_candidate_detail(candidate_id: str, current_user: RequireRecruiterWithCandidates):
    return await service.get_candidate_detail(current_user, candidate_id)


@router.post("/candidates/{candidate_id}/remind")
async def remind_candidate(
    candidate_id: str, current_user: RequireRecruiterWithCandidates, payload: dict | None = Body(default=None)
):
    """Send onboarding / reupload / general reminder (email + notification)."""
    from app.services.reminder_service import reminder_service

    body = payload if isinstance(payload, dict) else {}
    kind = (body.get("kind") or "onboarding").strip().lower()
    return await reminder_service.send_candidate_reminder(
        current_user,
        candidate_id,
        kind=kind,
        note=body.get("note"),
        force=bool(body.get("force") or body.get("resend")),
    )


@router.get("/detail/{employee_id}")
async def get_employee_detail(employee_id: str, current_user: RequireRecruiterWithEmployees):
    """US-035: open full employee profile from the directory.

    Dedicated path (not /{employee_id}) so IDs like EMP-000123 never collide
    with static routes such as /me, /upload, or /export.csv.
    """
    return await service.get_employee_profile(current_user, employee_id, reveal_banking=False)


@router.put("/detail/{employee_id}/company-email")
async def set_company_email(
    employee_id: str,
    request: CompanyEmailRequest,
    current_user: RequireRecruiterWithEmployees,
):
    """Record the employee's official company email for organizational communications."""
    return await service.set_company_email(current_user, employee_id, str(request.company_email))


@router.post("/detail/{employee_id}/assets", status_code=201)
async def assign_asset(
    employee_id: str,
    request: AssetAssignRequest,
    current_user: RequireRecruiterWithEmployees,
):
    """Assign a company asset to the employee from Day 1."""
    return await service.assign_asset(current_user, employee_id, request)


@router.put("/detail/{employee_id}/assets/{asset_id}")
async def update_asset(
    employee_id: str,
    asset_id: str,
    request: AssetUpdateRequest,
    current_user: RequireRecruiterWithEmployees,
):
    return await service.update_asset(current_user, employee_id, asset_id, request)


@router.delete("/detail/{employee_id}/assets/{asset_id}")
async def remove_asset(employee_id: str, asset_id: str, current_user: RequireRecruiterWithEmployees):
    return await service.remove_asset(current_user, employee_id, asset_id)


@router.put("/detail/{employee_id}/orientation")
async def schedule_orientation(
    employee_id: str,
    request: OrientationScheduleRequest,
    current_user: RequireRecruiterWithEmployees,
):
    """Schedule or update the employee's orientation session."""
    return await service.schedule_orientation(current_user, employee_id, request)


@router.put("/detail/{employee_id}/banking")
async def update_employee_banking(
    employee_id: str,
    payload: dict,
    current_user: RequireRecruiterWithEmployees,
):
    """Add or update payroll banking for on-site employees (recruiter-managed)."""
    from app.schemas.invitation import OnboardingEmploymentInfo

    request = OnboardingEmploymentInfo.model_validate(payload)
    return await service.update_employee_banking(current_user, employee_id, request)


@router.post("/detail/{employee_id}/remind-profile")
async def remind_profile_completion(
    employee_id: str,
    current_user: RequireRecruiterWithEmployees,
    payload: dict | None = Body(default=None),
):
    """Send an in-app + email reminder to finish Complete Profile."""
    body = payload if isinstance(payload, dict) else {}
    note = body.get("note")
    force = bool(body.get("force") or body.get("resend"))
    return await service.remind_profile_completion(current_user, employee_id, note, force=force)


@router.post("/detail/{employee_id}/remind")
async def remind_employee(
    employee_id: str,
    current_user: RequireRecruiterWithEmployees,
    payload: dict | None = Body(default=None),
):
    """Unified employee reminder: profile | reupload | course | general."""
    from app.services.reminder_service import reminder_service

    body = payload if isinstance(payload, dict) else {}
    kind = (body.get("kind") or "general").strip().lower()
    return await reminder_service.send_employee_reminder(
        current_user,
        employee_id,
        kind=kind,
        note=body.get("note"),
        force=bool(body.get("force") or body.get("resend")),
    )


@router.post("/{employee_id}/exit")
async def mark_employee_exit(
    employee_id: str,
    request: EmployeeExitRequest,
    current_user: RequireRecruiterWithEmployees,
):
    """Mark employee as resigned, terminated, or exited (moves to historical)."""
    return await service.mark_employee_exit(current_user, employee_id, request)


@router.get("/{employee_id}/career")
async def list_career(employee_id: str, current_user: RequireRecruiterWithEmployees):
    employee = await service.get_employee_profile(current_user, employee_id)
    return {"events": employee["employee"].get("career") or []}


@router.post("/{employee_id}/career", status_code=201)
async def add_career(
    employee_id: str,
    request: CareerEventCreateRequest,
    current_user: RequireRecruiterWithEmployees,
):
    return await service.add_career_event(current_user, employee_id, request)


@router.put("/detail/{employee_id}/role")
async def assign_employee_role(
    employee_id: str,
    request: RoleAssignRequest,
    current_user: RequireRecruiterWithEmployees,
):
    """Assign or change designation + department (from org taxonomy lists)."""
    return await service.assign_role(current_user, employee_id, request)


@router.get("/{employee_id}")
async def get_employee_detail_legacy(employee_id: str, current_user: RequireRecruiterWithEmployees):
    """Backward-compatible alias for /detail/{employee_id}."""
    return await service.get_employee_profile(current_user, employee_id, reveal_banking=False)


@router.post("/upload")
async def upload_onboarding_file(
    current_user: RequireCandidate,
    file: UploadFile = File(...),
    purpose: Literal["resume", "government_doc", "education_cert", "skill_cert"] = Form(...),
    doc_type: str | None = Form(default=None),
    index: int = Form(default=0),
):
    if current_user.role not in ("candidate", "employee", "super_admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only candidates/employees can upload files.")

    if current_user.role == "candidate":
        from app.services.offer_service import offer_service

        await offer_service.require_signed_offer_for_candidate(current_user)

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

    if purpose == "government_doc":
        if resolved_doc_type not in IDENTITY_DOC_TYPES:
            raise HTTPException(
                status_code=400,
                detail="Identity document must be a National ID (CNIC/NIC).",
            )
    if purpose == "education_cert":
        resolved_doc_type = "transcript"
    if purpose == "resume":
        resolved_doc_type = "resume"
    if purpose == "skill_cert":
        resolved_doc_type = "other"

    class _FakeUpload:
        filename = original

        async def read(self_inner):
            return content

    # Single storage write via document_service (avoids duplicate uploads).
    ocr_result = None
    document = None
    try:
        doc_res = await document_service.upload(
            current_user,
            file=_FakeUpload(),
            category=category,
            doc_type=resolved_doc_type,
            purpose=purpose,
        )
        document = doc_res.get("document") if doc_res else None
        if document:
            ocr_result = document.get("ocr_result")
    except HTTPException:
        raise

    file_url = (document or {}).get("file_url") or ""
    file_name = (document or {}).get("file_name") or original

    # Identity docs must match type and be readable. Education/resume uploads stay
    # attached even when OCR is uncertain — recruiters verify them manually.
    ocr_failed = ocr_result and ocr_result.get("accepted") is False
    hard_reject = purpose == "government_doc" and ocr_failed
    if hard_reject:
        return {
            "file_name": file_name,
            "file_url": file_url,
            "purpose": purpose,
            "ocr_result": ocr_result,
            "message": (ocr_result or {}).get("rejection_message") or "Document type rejected.",
        }

    slot = max(0, index)
    if current_user.role == "candidate":
        try:
            resp = await candidate_service.attach_uploaded_file(
                current_user,
                purpose=purpose,
                file_name=file_name,
                file_url=file_url,
                doc_type=resolved_doc_type if purpose == "government_doc" else doc_type,
                index=slot,
            )
        except HTTPException:
            raise
        except Exception:
            resp = {"file_name": file_name, "file_url": file_url, "purpose": purpose}
    elif current_user.role == "employee":
        try:
            resp = await service.attach_uploaded_file(
                current_user,
                purpose=purpose,
                file_name=file_name,
                file_url=file_url,
                doc_type=resolved_doc_type if purpose == "government_doc" else doc_type,
                index=slot,
            )
        except HTTPException:
            raise
        except Exception:
            resp = {"file_name": file_name, "file_url": file_url, "purpose": purpose}
    else:
        resp = {"file_name": file_name, "file_url": file_url, "purpose": purpose}

    if ocr_result:
        resp["ocr_result"] = ocr_result
    if document and document.get("profile_verification"):
        resp["document_verification"] = document.get("profile_verification")
    elif document and document.get("mismatch_reasons"):
        resp["document_verification"] = {
            "verification_status": document.get("verification_status"),
            "mismatches": document.get("mismatch_reasons"),
        }
    return resp


@router.delete("/upload")
async def clear_onboarding_file(
    current_user: RequireCandidate,
    purpose: Literal["resume", "government_doc", "education_cert", "skill_cert"] = Query(...),
    index: int = Query(default=0, ge=0),
):
    """Remove an onboarding file (transcript / resume / CNIC) so the candidate can replace it."""
    if current_user.role == "candidate":
        from app.services.offer_service import offer_service

        await offer_service.require_signed_offer_for_candidate(current_user)
        return await candidate_service.clear_uploaded_file(current_user, purpose=purpose, index=index)
    if current_user.role == "employee":
        return await service.clear_uploaded_file(current_user, purpose=purpose, index=index)
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only candidates/employees can remove uploads.")

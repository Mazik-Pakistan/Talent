from datetime import date
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, Depends

from app.core.security import RequireAny, RequireEmployee, RequireRecruiter, require_capabilities, get_current_user
from app.core.rbac import CurrentUser
from app.schemas.learning import (
    BookmarkRequest,
    CareerGoalRequest,
    CertificateUpdateRequest,
    CertificateVerifyRequest,
    CourseAssignRequest,
    EnrollmentProgressRequest,
    ManagedLearningCourseCreateRequest,
    ManagedLearningCourseUpdateRequest,
    SkillUpsertRequest,
)
from app.schemas.provider import (
    LearningProviderCreate,
    LearningProviderUpdate,
)
from app.services.learning_service import learning_service
from app.services.managed_learning_service import managed_learning_service
from app.services.provider_service import provider_service
from app.services.import_engine_service import import_engine_service

router = APIRouter(prefix="/api/learning", tags=["Learning"])

MAX_CERT_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_CERT_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg"}

# Recruiter dependency with learning capability check
RequireRecruiterWithLearning = Annotated[CurrentUser, Depends(require_capabilities("learning"))]


# ---------------------------------------------------------------------- #
# Catalog (US-065, US-066, US-072)
# ---------------------------------------------------------------------- #
@router.get("/catalog")
async def browse_catalog(
    current_user: RequireAny,
    _capability: Annotated[CurrentUser, Depends(require_capabilities("learning"))],
    q: str | None = None,
    role: str | None = None,
    level: str | None = None,
    product: str | None = None,
    type: str | None = Query(default=None, alias="type"),
    source: str = Query(default="microsoft_learn", description="'microsoft_learn', 'coursera', or 'recruiter_kb'"),
    category: str | None = Query(default=None, description="Soft-skill category (source=coursera only)"),
    provider: str | None = None,
    designation: str | None = None,
    learning_month: str | None = None,
    competency: str | None = None,
    archived: bool | None = None,
    sort_by: str | None = Query(default="newest", description="newest|oldest|updated|title_asc|title_desc|duration|provider"),
    bookmarked_only: bool = False,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=60),
):
    return await learning_service.browse_catalog(
        current_user,
        q=q,
        role=role,
        level=level,
        product=product,
        course_type=type,
        page=page,
        page_size=page_size,
        bookmarked_only=bookmarked_only,
        source=source,
        category=category,
        provider=provider,
        designation=designation,
        learning_month=learning_month,
        competency=competency,
        archived=archived,
        sort_by=sort_by,
    )


@router.get("/catalog/facets")
async def catalog_facets(
    current_user: RequireAny,
    _capability: Annotated[CurrentUser, Depends(require_capabilities("learning"))],
    source: str = Query(default="microsoft_learn"),
):
    return await learning_service.get_facets(source)


@router.get("/catalog/sources")
async def catalog_sources(
    current_user: RequireAny,
    _capability: Annotated[CurrentUser, Depends(require_capabilities("learning"))],
):
    """All available catalog sources (managed providers + external API providers).

    Provider-agnostic: generated from the learning_providers collection, never
    hardcoded. Used by recruiter and employee catalogs to build dynamic tabs.
    """
    from app.services.catalog_service import get_catalog_sources

    return {"sources": await get_catalog_sources()}


@router.get("/catalog/soft-skills/categories")
async def soft_skill_categories(
    current_user: RequireAny,
    _capability: Annotated[CurrentUser, Depends(require_capabilities("learning"))],
):
    """Industry soft-skill categories, sourced live from Coursera — used to
    power the 'Soft Skills' tab's category filter."""
    return await learning_service.get_soft_skill_categories()


@router.get("/catalog/{uid}")
async def course_detail(
    uid: str,
    current_user: RequireAny,
    _capability: Annotated[CurrentUser, Depends(require_capabilities("learning"))],
):
    return await learning_service.get_course_detail(current_user, uid)


@router.post("/catalog/{uid}/start")
async def start_course(uid: str, current_user: RequireEmployee):
    return await learning_service.start_course(current_user, uid)


@router.put("/catalog/{uid}/progress")
async def update_progress(uid: str, request: EnrollmentProgressRequest, current_user: RequireEmployee):
    return await learning_service.update_progress(current_user, uid, request)


# ---------------------------------------------------------------------- #
# My learning (US-069)
# ---------------------------------------------------------------------- #
@router.get("/my/dashboard")
async def my_dashboard(current_user: RequireEmployee):
    return await learning_service.get_learning_dashboard(current_user)


@router.get("/my/courses")
async def my_courses(current_user: RequireEmployee, status_filter: str | None = Query(default=None, alias="status")):
    return await learning_service.list_my_courses(current_user, status_filter)


# ---------------------------------------------------------------------- #
# Bookmarks (US-073)
# ---------------------------------------------------------------------- #
@router.get("/bookmarks")
async def list_bookmarks(current_user: RequireEmployee):
    return await learning_service.list_bookmarks(current_user)


@router.post("/bookmarks", status_code=201)
async def add_bookmark(request: BookmarkRequest, current_user: RequireEmployee):
    return await learning_service.add_bookmark(current_user, request)


@router.delete("/bookmarks/{uid}")
async def remove_bookmark(uid: str, current_user: RequireEmployee):
    return await learning_service.remove_bookmark(current_user, uid)


# ---------------------------------------------------------------------- #
# Certificates
# ---------------------------------------------------------------------- #
@router.post("/certificates", status_code=201)
async def upload_certificate(
    current_user: RequireEmployee,
    file: UploadFile | None = File(default=None),
    course_uid: str | None = Form(default=None),
    course_title: str = Form(...),
    completion_date: date | None = Form(default=None),
    learning_hours: float | None = Form(default=None),
    source_url: str | None = Form(default=None),
):
    cleaned_source = (source_url or "").strip() or None
    if not cleaned_source:
        raise HTTPException(
            status_code=400,
            detail="Certificate link is required so your recruiter can verify it.",
        )
    if cleaned_source and not (
        cleaned_source.startswith("http://") or cleaned_source.startswith("https://")
    ):
        raise HTTPException(status_code=400, detail="Certificate link must start with http:// or https://.")

    original = None
    content = b""
    if file is not None and (file.filename or "").strip():
        original = file.filename or "certificate.pdf"
        ext = Path(original).suffix.lower()
        if ext not in ALLOWED_CERT_EXTENSIONS:
            raise HTTPException(status_code=400, detail="Unsupported file type. Allowed: PDF, PNG, JPG.")
        content = await file.read()
        if len(content) > MAX_CERT_UPLOAD_BYTES:
            raise HTTPException(status_code=400, detail="File is too large (max 10 MB).")

    return await learning_service.upload_certificate(
        current_user,
        course_uid=course_uid,
        course_title=course_title,
        completion_date=completion_date,
        learning_hours=learning_hours,
        filename=original,
        content=content,
        source_url=cleaned_source,
    )


@router.get("/certificates")
async def list_my_certificates(current_user: RequireEmployee):
    return await learning_service.list_my_certificates(current_user)


@router.get("/certificates/pending")
async def list_pending_certificates(current_user: RequireRecruiterWithLearning):
    return await learning_service.list_pending_certificates(current_user)


@router.put("/certificates/{certificate_id}/verify")
async def verify_certificate(certificate_id: str, request: CertificateVerifyRequest, current_user: RequireRecruiterWithLearning):
    return await learning_service.verify_certificate(current_user, certificate_id, request)


@router.delete("/certificates/{certificate_id}")
async def delete_certificate(certificate_id: str, current_user: RequireEmployee):
    return await learning_service.delete_certificate(current_user, certificate_id)


@router.put("/certificates/{certificate_id}")
async def update_certificate(
    certificate_id: str,
    request: CertificateUpdateRequest,
    current_user: RequireEmployee,
):
    return await learning_service.update_certificate(
        current_user,
        certificate_id,
        course_title=request.course_title,
        completion_date=request.completion_date,
        learning_hours=request.learning_hours,
    )


# ---------------------------------------------------------------------- #
# Designation requirements & readiness
# ---------------------------------------------------------------------- #
@router.get("/designation/requirements")
async def designation_requirements(
    current_user: RequireEmployee,
    target_role: str = Query(..., min_length=2, max_length=150),
):
    """Return the learning requirements (courses, skills, certifications) for a target designation."""
    return await learning_service.get_designation_requirements(current_user, target_role)


@router.get("/designation/readiness")
async def designation_readiness(
    current_user: RequireEmployee,
    target_role: str | None = Query(default=None, max_length=150),
):
    """Return the employee's readiness percentage and eligibility for a target designation."""
    return await learning_service.get_designation_readiness(current_user, target_role)


@router.get("/employees/{employee_id}/designation-readiness")
async def employee_designation_readiness(
    employee_id: str,
    current_user: RequireRecruiterWithLearning,
    target_role: str | None = Query(default=None, max_length=150),
):
    """Recruiter view: employee's designation readiness and eligibility."""
    return await learning_service.get_employee_designation_readiness(current_user, employee_id, target_role)


# ---------------------------------------------------------------------- #
# Skill matrix (US-092, US-093, US-094)
# ---------------------------------------------------------------------- #
@router.get("/skills/categories")
async def skill_categories(
    current_user: RequireAny,
    _capability: Annotated[CurrentUser, Depends(require_capabilities("learning"))],
):
    return await learning_service.get_skill_categories()


@router.get("/skills")
async def list_skills(current_user: RequireEmployee):
    return await learning_service.list_skills(current_user)


@router.post("/skills/assess")
async def assess_skills(
    current_user: RequireEmployee,
    refresh: bool = False,
    lazy: bool = Query(default=False, description="If true, return cache only — never invoke AI"),
):
    """Build / refresh skill matrix. With lazy=true, only return cached analysis."""
    return await learning_service.assess_my_skills(current_user, refresh=refresh, lazy=lazy)


@router.post("/skills", status_code=201)
async def upsert_skill(request: SkillUpsertRequest, current_user: RequireEmployee):
    return await learning_service.upsert_skill(current_user, request)


@router.delete("/skills/{skill_id}")
async def delete_skill(skill_id: str, current_user: RequireEmployee):
    return await learning_service.delete_skill(current_user, skill_id)


# ---------------------------------------------------------------------- #
# Skill gap + career path (US-075, US-095, US-099, US-100)
# ---------------------------------------------------------------------- #
@router.get("/skill-gap")
async def skill_gap(
    current_user: RequireEmployee,
    target_role: str | None = None,
    refresh: bool = False,
):
    return await learning_service.get_skill_gap(current_user, target_role, refresh=refresh)


@router.get("/career-goal")
async def get_career_goal(current_user: RequireEmployee):
    return await learning_service.get_career_goal(current_user)


@router.post("/career-goal")
async def set_career_goal(request: CareerGoalRequest, current_user: RequireEmployee):
    return await learning_service.set_career_goal(current_user, request)


@router.get("/career-path")
async def get_career_path(current_user: RequireEmployee, refresh: bool = False):
    return await learning_service.get_career_path(current_user, refresh=refresh)


@router.get("/role-matches")
async def role_matches(current_user: RequireEmployee, refresh: bool = False):
    """Deterministic match of employee profile against recruiter KB roles."""
    return await learning_service.get_role_matches(current_user, refresh=refresh)


# ---------------------------------------------------------------------- #
# AI recommendations (US-074)
# ---------------------------------------------------------------------- #
@router.get("/recommendations")
async def recommendations(current_user: RequireEmployee, refresh: bool = False):
    return await learning_service.get_recommendations(current_user, refresh=refresh)


# ---------------------------------------------------------------------- #
# Recruiter Knowledge Base (roles + certifications)
# ---------------------------------------------------------------------- #
@router.get("/knowledge-base/roles")
async def kb_list_roles(current_user: RequireRecruiterWithLearning):
    from app.services.recruiter_kb_service import recruiter_kb_service

    return await recruiter_kb_service.list_roles(current_user)


@router.post("/knowledge-base/roles", status_code=201)
async def kb_create_role(request: dict, current_user: RequireRecruiterWithLearning):
    from app.schemas.recruiter_kb import KbRoleCreate
    from app.services.recruiter_kb_service import recruiter_kb_service

    payload = KbRoleCreate(**request)
    return await recruiter_kb_service.create_role(current_user, payload.model_dump())


@router.put("/knowledge-base/roles/{role_id}")
async def kb_update_role(role_id: str, request: dict, current_user: RequireRecruiterWithLearning):
    from app.schemas.recruiter_kb import KbRoleUpdate
    from app.services.recruiter_kb_service import recruiter_kb_service

    payload = KbRoleUpdate(**request)
    return await recruiter_kb_service.update_role(
        current_user, role_id, payload.model_dump(exclude_unset=True)
    )


@router.delete("/knowledge-base/roles/{role_id}")
async def kb_delete_role(role_id: str, current_user: RequireRecruiterWithLearning):
    from app.services.recruiter_kb_service import recruiter_kb_service

    return await recruiter_kb_service.delete_role(current_user, role_id)


@router.get("/knowledge-base/certifications")
async def kb_list_certs(current_user: RequireRecruiterWithLearning):
    from app.services.recruiter_kb_service import recruiter_kb_service

    return await recruiter_kb_service.list_certifications(current_user)


@router.post("/knowledge-base/certifications", status_code=201)
async def kb_create_cert(request: dict, current_user: RequireRecruiterWithLearning):
    from app.schemas.recruiter_kb import KbCertificationCreate
    from app.services.recruiter_kb_service import recruiter_kb_service

    payload = KbCertificationCreate(**request)
    return await recruiter_kb_service.create_certification(current_user, payload.model_dump())


@router.put("/knowledge-base/certifications/{cert_id}")
async def kb_update_cert(cert_id: str, request: dict, current_user: RequireRecruiterWithLearning):
    from app.schemas.recruiter_kb import KbCertificationUpdate
    from app.services.recruiter_kb_service import recruiter_kb_service

    payload = KbCertificationUpdate(**request)
    return await recruiter_kb_service.update_certification(
        current_user, cert_id, payload.model_dump(exclude_unset=True)
    )


@router.delete("/knowledge-base/certifications/{cert_id}")
async def kb_delete_cert(cert_id: str, current_user: RequireRecruiterWithLearning):
    from app.services.recruiter_kb_service import recruiter_kb_service

    return await recruiter_kb_service.delete_certification(current_user, cert_id)


# ---------------------------------------------------------------------- #
# Recruiter: assign, oversight, analytics (US-068, US-076)
# ---------------------------------------------------------------------- #
@router.post("/assignments", status_code=201)
async def assign_courses(request: CourseAssignRequest, current_user: RequireRecruiterWithLearning):
    return await learning_service.assign_courses(current_user, request)


@router.post("/assignments/remind")
async def remind_course_assignments(payload: dict, current_user: RequireRecruiterWithLearning):
    """Nudge an employee about open course assignments (email + notification)."""
    from app.services.reminder_service import reminder_service

    body = payload if isinstance(payload, dict) else {}
    return await reminder_service.remind_courses(
        current_user,
        employee_id=body.get("employee_id"),
        email=body.get("email"),
        note=body.get("note"),
        force=bool(body.get("force") or body.get("resend")),
    )


@router.get("/assignments")
async def list_assignments(
    current_user: RequireRecruiterWithLearning,
    employee_id: str | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    mandatory: bool | None = None,
):
    return await learning_service.list_assignments(
        current_user,
        employee_id=employee_id,
        status_filter=status_filter,
        mandatory_only=mandatory,
    )


@router.get("/employees/{employee_id}/profile")
async def employee_learning_profile(
    employee_id: str,
    current_user: RequireRecruiterWithLearning,
    refresh: bool = False,
):
    return await learning_service.get_employee_learning_profile(
        current_user, employee_id, refresh_ai=refresh
    )


@router.get("/analytics")
async def analytics(current_user: RequireRecruiterWithLearning, department: str | None = None):
    return await learning_service.get_analytics(current_user, department=department)


# ---------------------------------------------------------------------- #
# Managed roadmap courses (managed-learning module)
# ---------------------------------------------------------------------- #
@router.get("/managed/courses")
async def list_managed_courses(
    current_user: RequireRecruiterWithLearning,
    q: str | None = None,
    provider: str | None = None,
    designation: str | None = None,
    learning_month: str | None = None,
    category: str | None = None,
    competency: str | None = None,
    archived: bool | None = None,
    sort_by: str | None = Query(default="newest", description="newest|oldest|updated|title_asc|title_desc|duration|provider"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    return await managed_learning_service.list_courses(
        q=q,
        provider=provider,
        designation=designation,
        learning_month=learning_month,
        category=category,
        competency=competency,
        archived=archived,
        sort_by=sort_by,
        page=page,
        page_size=page_size,
        organization_id=current_user.organization_id,
    )


@router.get("/managed/providers")
async def list_managed_providers(current_user: RequireRecruiterWithLearning):
    return {"providers": await managed_learning_service.list_providers()}


@router.post("/managed/providers", status_code=201)
async def create_managed_provider(request: dict, current_user: RequireRecruiterWithLearning):
    name = (request.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Provider name is required.")
    return await managed_learning_service.create_provider(current_user, name)


@router.get("/managed/facets")
async def managed_facets(current_user: RequireRecruiterWithLearning):
    return await managed_learning_service.list_facets(organization_id=current_user.organization_id)


@router.post("/managed/courses", status_code=201)
async def create_managed_course(request: ManagedLearningCourseCreateRequest, current_user: RequireRecruiterWithLearning):
    return await managed_learning_service.create_course(current_user, request)


@router.put("/managed/courses/{course_id}")
async def update_managed_course(
    course_id: str,
    request: ManagedLearningCourseUpdateRequest,
    current_user: RequireRecruiterWithLearning,
):
    return await managed_learning_service.update_course(current_user, course_id, request)


@router.post("/managed/courses/{course_id}/archive")
async def archive_managed_course(course_id: str, current_user: RequireRecruiterWithLearning):
    return await managed_learning_service.archive_course(current_user, course_id, archived=True)


@router.post("/managed/courses/{course_id}/restore")
async def restore_managed_course(course_id: str, current_user: RequireRecruiterWithLearning):
    return await managed_learning_service.archive_course(current_user, course_id, archived=False)


@router.delete("/managed/courses/{course_id}")
async def delete_managed_course(course_id: str, current_user: RequireRecruiterWithLearning):
    return await managed_learning_service.delete_course(current_user, course_id)


@router.post("/managed/courses-bulk/action")
async def bulk_managed_course_action(
    payload: dict,
    current_user: RequireRecruiterWithLearning,
):
    """Bulk archive / restore / delete managed courses (Phase 3)."""
    course_ids = payload.get("course_ids") or []
    action = (payload.get("action") or "").strip().lower()
    return await managed_learning_service.bulk_course_action(current_user, course_ids, action)


@router.post("/managed/import/preview")
async def preview_managed_import(
    current_user: RequireRecruiterWithLearning,
    file: UploadFile = File(...),
    provider: str | None = Form(default=None),
):
    return await managed_learning_service.preview_import(current_user, file, provider_name=provider)


@router.post("/managed/import/commit")
async def commit_managed_import(
    current_user: RequireRecruiterWithLearning,
    file: UploadFile = File(...),
    provider: str | None = Form(default=None),
):
    return await managed_learning_service.import_file(current_user, file, provider_name=provider)


@router.get("/org-taxonomy")
async def org_taxonomy(current_user: RequireAny):
    """Selectable designations + departments for invite, role assign, and filters."""
    from app.services.org_taxonomy_service import get_org_taxonomy

    return await get_org_taxonomy()


@router.post("/org-taxonomy/departments", status_code=201)
async def create_department(request: dict, current_user: RequireRecruiterWithLearning):
    """Add a new department to the org taxonomy."""
    from app.services.org_taxonomy_service import add_department

    name = (request.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Department name is required.")
    try:
        return await add_department(name)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.put("/org-taxonomy/departments")
async def rename_department(request: dict, current_user: RequireRecruiterWithLearning):
    """Rename an existing department."""
    from app.services.org_taxonomy_service import update_department

    old_name = (request.get("old_name") or "").strip()
    new_name = (request.get("new_name") or "").strip()
    if not old_name or not new_name:
        raise HTTPException(status_code=422, detail="Both old_name and new_name are required.")
    try:
        return await update_department(old_name, new_name)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.delete("/org-taxonomy/departments/{name}")
async def remove_department(name: str, current_user: RequireRecruiterWithLearning):
    """Remove a department from the org taxonomy."""
    from app.services.org_taxonomy_service import delete_department

    if not name.strip():
        raise HTTPException(status_code=422, detail="Department name is required.")
    try:
        return await delete_department(name)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ========================================================================== #
# PROVIDER MANAGEMENT (Generic Learning Provider Framework)
# ========================================================================== #
@router.get("/providers")
async def list_providers(
    current_user: RequireRecruiterWithLearning,
    include_inactive: bool = Query(default=False),
    provider_type: str | None = Query(default=None),
    search: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
):
    """List all learning providers with filtering and pagination."""
    return await provider_service.list_providers(
        include_inactive=include_inactive,
        provider_type=provider_type,
        search=search,
        page=page,
        page_size=page_size,
    )


@router.get("/providers/{provider_id}")
async def get_provider(
    provider_id: str,
    current_user: RequireRecruiterWithLearning,
):
    """Get a specific learning provider by ID."""
    return await provider_service.get_provider(provider_id)


@router.post("/providers", status_code=201)
async def create_provider(
    current_user: RequireRecruiterWithLearning,
    payload: LearningProviderCreate,
):
    """Create a new learning provider."""
    return await provider_service.create_provider(current_user, payload)


@router.put("/providers/{provider_id}")
async def update_provider(
    provider_id: str,
    current_user: RequireRecruiterWithLearning,
    payload: LearningProviderUpdate,
):
    """Update an existing learning provider."""
    return await provider_service.update_provider(current_user, provider_id, payload)


@router.delete("/providers/{provider_id}")
async def delete_provider(
    provider_id: str,
    current_user: RequireRecruiterWithLearning,
    force: bool = Query(default=False),
):
    """Delete a learning provider (archives courses when force=true)."""
    return await provider_service.delete_provider(current_user, provider_id, force=force)


@router.post("/providers/{provider_id}/activate")
async def activate_provider(
    provider_id: str,
    current_user: RequireRecruiterWithLearning,
):
    """Activate a learning provider."""
    return await provider_service.activate_provider(current_user, provider_id)


@router.post("/providers/{provider_id}/deactivate")
async def deactivate_provider(
    provider_id: str,
    current_user: RequireRecruiterWithLearning,
):
    """Deactivate a learning provider."""
    return await provider_service.deactivate_provider(current_user, provider_id)


# ========================================================================== #
# UNIVERSAL IMPORT ENGINE (Phase 2)
# ========================================================================== #
@router.post("/import/preview")
async def import_preview(
    current_user: RequireRecruiterWithLearning,
    file: UploadFile = File(...),
    provider_id: str | None = Form(default=None),
    provider_name: str | None = Form(default=None),
):
    """Validate an upload and produce a full import preview (never writes data)."""
    return await import_engine_service.preview_import(
        current_user, file, provider_id=provider_id, provider_name=provider_name
    )


@router.post("/import/commit")
async def import_commit(
    current_user: RequireRecruiterWithLearning,
    file: UploadFile = File(...),
    provider_id: str | None = Form(default=None),
    provider_name: str | None = Form(default=None),
    missing_action: str = Form(default="keep"),
):
    """Validate + import courses in one shot, recording import history."""
    return await import_engine_service.commit_import(
        current_user,
        file,
        provider_id=provider_id,
        provider_name=provider_name,
        missing_action=missing_action,
    )


@router.post("/import/{history_id}/rollback")
async def import_rollback(
    history_id: str,
    current_user: RequireRecruiterWithLearning,
):
    """Roll back a completed import."""
    return await import_engine_service.rollback_import(current_user, history_id)


@router.get("/import/history")
async def import_history(
    current_user: RequireRecruiterWithLearning,
    provider_id: str | None = Query(default=None),
    import_type: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    return await import_engine_service.list_import_history(
        current_user,
        provider_id=provider_id,
        import_type=import_type,
        page=page,
        page_size=page_size,
    )


@router.get("/import/history/{history_id}")
async def import_history_detail(
    history_id: str,
    current_user: RequireRecruiterWithLearning,
):
    return await import_engine_service.get_import_history(history_id)


@router.get("/import/history/{history_id}/report")
async def import_history_report(
    history_id: str,
    current_user: RequireRecruiterWithLearning,
):
    """Download a CSV validation/import report."""
    from fastapi.responses import PlainTextResponse

    csv_data = await import_engine_service.import_report_csv(history_id)
    return PlainTextResponse(
        csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="import-report-{history_id}.csv"'},
    )


@router.post("/import/providers/{provider_id}/sync")
async def import_sync_from_api(
    provider_id: str,
    current_user: RequireRecruiterWithLearning,
    missing_action: str = Form(default="keep"),
):
    """Run an API synchronization for an API provider (same engine as Excel)."""
    return await import_engine_service.sync_from_api(
        current_user, provider_id, missing_action=missing_action
    )

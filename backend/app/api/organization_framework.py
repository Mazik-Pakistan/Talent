"""Organization Framework API — CRUD endpoints for career structure management."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from app.core.security import require_capabilities, require_roles
from app.core.rbac import CurrentUser

router = APIRouter(prefix="/api/org-framework", tags=["Organization Framework"])

RequireRecruiterLearning = Annotated[CurrentUser, Depends(require_capabilities("learning"))]

# Write access is restricted to recruiters (and super admins). Read-only
# endpoints stay open to every org-bound role (recruiter, employee, candidate)
# so dashboards, forms and AI assistants can read the org's framework.
RequireRecruiterLearningWrite = Annotated[
    CurrentUser,
    Depends(require_capabilities("learning")),
]
RequireFrameworkWriteRole = Annotated[
    CurrentUser,
    Depends(require_roles("recruiter", "super_admin")),
]


async def _framework_write_user(
    current_user: RequireRecruiterLearning,
    role_user: RequireFrameworkWriteRole,
) -> CurrentUser:
    """Write access = learning capability + recruiter/super_admin role."""
    return current_user


RequireRecruiterLearningWrite = Annotated[
    CurrentUser,
    Depends(_framework_write_user),
]


def _org_id(user: CurrentUser) -> str:
    if not user.organization_id:
        raise HTTPException(status_code=400, detail="No organization bound to your account.")
    return user.organization_id


# ═══════════════════════════════════════════════════════════════════════════════ //
#   Dashboard Summary
# ═══════════════════════════════════════════════════════════════════════════════ //

@router.get("/summary")
async def summary(current_user: RequireRecruiterLearning):
    from app.services.organization_framework_service import get_framework_summary
    return await get_framework_summary(_org_id(current_user))


@router.get("/options")
async def org_structure_options(current_user: RequireRecruiterLearning):
    """Org-scoped option sets (departments, roles, skills, certifications).

    The single source of truth for every module's dropdowns and for AI
    assistants validating user selections against the organization.
    """
    from app.services.organization_framework_service import get_org_structure_options
    return await get_org_structure_options(_org_id(current_user))


# ═══════════════════════════════════════════════════════════════════════════════ //
#   Departments
# ═══════════════════════════════════════════════════════════════════════════════ //

@router.get("/departments")
async def list_departments(current_user: RequireRecruiterLearning):
    from app.services.organization_framework_service import list_departments
    return await list_departments(_org_id(current_user))


@router.post("/departments", status_code=201)
async def create_department(request: dict, current_user: RequireRecruiterLearningWrite):
    from app.services.organization_framework_service import create_department
    try:
        return await create_department(_org_id(current_user), request)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.put("/departments/{name}")
async def update_department(name: str, request: dict, current_user: RequireRecruiterLearningWrite):
    from app.services.organization_framework_service import update_department
    try:
        return await update_department(_org_id(current_user), name, request)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/departments/{name}")
async def delete_department(name: str, current_user: RequireRecruiterLearningWrite):
    from app.services.organization_framework_service import delete_department
    ok = await delete_department(_org_id(current_user), name)
    if not ok:
        raise HTTPException(status_code=404, detail="Department not found.")
    return {"deleted": True}


# ═══════════════════════════════════════════════════════════════════════════════ //
#   Roles
# ═══════════════════════════════════════════════════════════════════════════════ //

@router.get("/roles")
async def list_roles(current_user: RequireRecruiterLearning, department: str | None = None):
    from app.services.organization_framework_service import list_roles
    return await list_roles(_org_id(current_user), department)


@router.get("/roles/{role_id}")
async def get_role(role_id: str, current_user: RequireRecruiterLearning):
    from app.services.organization_framework_service import get_role
    role = await get_role(_org_id(current_user), role_id)
    if not role:
        raise HTTPException(status_code=404, detail="Role not found.")
    return role


@router.post("/roles", status_code=201)
async def create_role(request: dict, current_user: RequireRecruiterLearningWrite):
    from app.services.organization_framework_service import create_role
    try:
        return await create_role(_org_id(current_user), request)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.put("/roles/{role_id}")
async def update_role(role_id: str, request: dict, current_user: RequireRecruiterLearningWrite):
    from app.services.organization_framework_service import update_role
    try:
        return await update_role(_org_id(current_user), role_id, request)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/roles/{role_id}")
async def delete_role(role_id: str, current_user: RequireRecruiterLearningWrite):
    from app.services.organization_framework_service import delete_role
    ok = await delete_role(_org_id(current_user), role_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Role not found.")
    return {"deleted": True}


# ═══════════════════════════════════════════════════════════════════════════════ //
#   Skills
# ═══════════════════════════════════════════════════════════════════════════════ //

@router.get("/skills")
async def list_skills(current_user: RequireRecruiterLearning, role_name: str | None = None):
    from app.services.organization_framework_service import list_skills
    return await list_skills(_org_id(current_user), role_name=role_name)


@router.post("/skills", status_code=201)
async def create_skill(request: dict, current_user: RequireRecruiterLearningWrite):
    from app.services.organization_framework_service import create_skill
    try:
        return await create_skill(_org_id(current_user), request)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.put("/skills/{skill_id}")
async def update_skill(skill_id: str, request: dict, current_user: RequireRecruiterLearningWrite):
    from app.services.organization_framework_service import update_skill
    try:
        return await update_skill(_org_id(current_user), skill_id, request)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/skills/{skill_id}")
async def delete_skill(skill_id: str, current_user: RequireRecruiterLearningWrite):
    from app.services.organization_framework_service import delete_skill
    ok = await delete_skill(_org_id(current_user), skill_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Skill not found.")
    return {"deleted": True}


# ═══════════════════════════════════════════════════════════════════════════════ //
#   Certifications
# ═══════════════════════════════════════════════════════════════════════════════ //

@router.get("/certifications")
async def list_certifications(current_user: RequireRecruiterLearning, role_name: str | None = None):
    from app.services.organization_framework_service import list_certifications
    return await list_certifications(_org_id(current_user), role_name)


@router.post("/certifications", status_code=201)
async def create_certification(request: dict, current_user: RequireRecruiterLearningWrite):
    from app.services.organization_framework_service import create_certification
    try:
        return await create_certification(_org_id(current_user), request)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.put("/certifications/{cert_id}")
async def update_certification(cert_id: str, request: dict, current_user: RequireRecruiterLearningWrite):
    from app.services.organization_framework_service import update_certification
    try:
        return await update_certification(_org_id(current_user), cert_id, request)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/certifications/{cert_id}")
async def delete_certification(cert_id: str, current_user: RequireRecruiterLearningWrite):
    from app.services.organization_framework_service import delete_certification
    ok = await delete_certification(_org_id(current_user), cert_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Certification not found.")
    return {"deleted": True}


# ═══════════════════════════════════════════════════════════════════════════════ //
#   Courses
# ═══════════════════════════════════════════════════════════════════════════════ //

@router.get("/courses")
async def list_courses(current_user: RequireRecruiterLearning):
    from app.services.organization_framework_service import list_courses
    return await list_courses(_org_id(current_user))


@router.post("/courses", status_code=201)
async def create_course(request: dict, current_user: RequireRecruiterLearningWrite):
    from app.services.organization_framework_service import create_course
    try:
        return await create_course(_org_id(current_user), request)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.put("/courses/{course_id}")
async def update_course(course_id: str, request: dict, current_user: RequireRecruiterLearningWrite):
    from app.services.organization_framework_service import update_course
    try:
        return await update_course(_org_id(current_user), course_id, request)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/courses/{course_id}")
async def delete_course(course_id: str, current_user: RequireRecruiterLearningWrite):
    from app.services.organization_framework_service import delete_course
    ok = await delete_course(_org_id(current_user), course_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Course not found.")
    return {"deleted": True}


# ═══════════════════════════════════════════════════════════════════════════════ //
#   Learning Roadmap
# ═══════════════════════════════════════════════════════════════════════════════ //

@router.get("/roadmaps")
async def list_roadmaps(current_user: RequireRecruiterLearning, role_name: str | None = None):
    from app.services.organization_framework_service import list_roadmaps
    return await list_roadmaps(_org_id(current_user), role_name)


@router.put("/roadmaps/reorder")
async def reorder_roadmaps(request: dict, current_user: RequireRecruiterLearningWrite):
    """Reorder a role's roadmap entries (recommended order)."""
    from app.services.organization_framework_service import reorder_roadmap
    role_name = (request.get("role_name") or "").strip()
    ordered_ids = request.get("ordered_ids") or []
    if not role_name:
        raise HTTPException(status_code=422, detail="role_name is required.")
    if not isinstance(ordered_ids, list):
        raise HTTPException(status_code=422, detail="ordered_ids must be a list.")
    try:
        return await reorder_roadmap(_org_id(current_user), role_name, ordered_ids)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.post("/roadmaps", status_code=201)
async def create_roadmap(request: dict, current_user: RequireRecruiterLearningWrite):
    from app.services.organization_framework_service import create_roadmap
    try:
        return await create_roadmap(_org_id(current_user), request)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.put("/roadmaps/{roadmap_id}")
async def update_roadmap(roadmap_id: str, request: dict, current_user: RequireRecruiterLearningWrite):
    from app.services.organization_framework_service import update_roadmap
    try:
        return await update_roadmap(_org_id(current_user), roadmap_id, request)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/roadmaps/{roadmap_id}")
async def delete_roadmap(roadmap_id: str, current_user: RequireRecruiterLearningWrite):
    from app.services.organization_framework_service import delete_roadmap
    ok = await delete_roadmap(_org_id(current_user), roadmap_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Roadmap entry not found.")
    return {"deleted": True}


# ═══════════════════════════════════════════════════════════════════════════════ //
#   Promotion Rules
# ═══════════════════════════════════════════════════════════════════════════════ //

@router.get("/promotion-rules")
async def list_promotion_rules(current_user: RequireRecruiterLearning):
    from app.services.organization_framework_service import list_promotion_rules
    return await list_promotion_rules(_org_id(current_user))


@router.post("/promotion-rules", status_code=201)
async def upsert_promotion_rule(request: dict, current_user: RequireRecruiterLearningWrite):
    from app.services.organization_framework_service import upsert_promotion_rule
    try:
        return await upsert_promotion_rule(_org_id(current_user), request)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.delete("/promotion-rules/{role_name}")
async def delete_promotion_rule(role_name: str, current_user: RequireRecruiterLearningWrite):
    from app.services.organization_framework_service import delete_promotion_rule
    ok = await delete_promotion_rule(_org_id(current_user), role_name)
    if not ok:
        raise HTTPException(status_code=404, detail="Promotion rule not found.")
    return {"deleted": True}


# ═══════════════════════════════════════════════════════════════════════════════ //
#   Version History
# ═══════════════════════════════════════════════════════════════════════════════ //

@router.get("/versions")
async def list_versions(current_user: RequireRecruiterLearning):
    from app.services.organization_framework_service import list_versions
    return await list_versions(_org_id(current_user))


@router.post("/versions", status_code=201)
async def create_version(request: dict, current_user: RequireRecruiterLearningWrite):
    from app.services.organization_framework_service import create_version_snapshot
    return await create_version_snapshot(
        _org_id(current_user),
        request.get("label") or "Snapshot",
    )


# ═══════════════════════════════════════════════════════════════════════════════ //
#   Excel Export / Import
# ═══════════════════════════════════════════════════════════════════════════════ //

@router.get("/export")
async def export_workbook(current_user: RequireRecruiterLearning):
    """Download the full organization framework as an Excel workbook."""
    from app.services.organization_framework_service import build_export_workbook

    buf = await build_export_workbook(_org_id(current_user))
    filename = f"organization_framework_{_org_id(current_user)[:12]}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import/validate")
async def validate_import(current_user: RequireRecruiterLearning, file: UploadFile = File(...)):
    """Parse an uploaded workbook, validate it, and return a validation report."""
    from app.services.organization_framework_service import parse_import_workbook, validate_import_data

    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(
            status_code=422,
            detail="Unsupported file type. Please upload an .xlsx workbook exported from the Organization Framework template.",
        )
    content = await file.read()
    if not content:
        raise HTTPException(status_code=422, detail="Empty file.")
    try:
        data = parse_import_workbook(content)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not parse workbook: {e}")
    report = validate_import_data(data)
    report["data"] = data
    return report

@router.post("/import/apply")
async def apply_import(request: dict, current_user: RequireRecruiterLearningWrite):
    """Apply a validated import payload (clears current framework, imports fresh)."""
    from app.services.organization_framework_service import apply_import_data

    data = request.get("data") or {}
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail="Invalid import payload.")
    try:
        counts = await apply_import_data(_org_id(current_user), data)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return {"applied": True, "counts": counts}

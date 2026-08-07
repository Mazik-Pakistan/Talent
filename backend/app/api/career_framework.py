"""Career Framework API Routes.

Provides endpoints for:
- Career track management (recruiter)
- Career level management (recruiter)
- Employee career assignment (recruiter)
- Employee self-service (view my career)
- Reports (promotion readiness, progress)
- CSV import/export
"""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import PlainTextResponse

from app.core.rbac import CurrentUser
from app.core.security import (
    RequireAny,
    RequireEmployee,
    RequireRecruiter,
    get_current_user,
    require_any_capability,
)
from app.schemas.career_framework import (
    BulkCareerAssignRequest,
    CareerDiscussionRequest,
    CareerLevelCreate,
    CareerLevelUpdate,
    CareerTrackCreate,
    CareerTrackUpdate,
    EmployeeCareerAssignRequest,
    EmployeeCareerUpdateRequest,
)
from app.services.career_framework_service import career_framework_service

router = APIRouter(prefix="/api/career-framework", tags=["Career Framework"])

# Talent Management owns career framework; Learning retains access for legacy/shared use.
RequireRecruiterWithTalentOrLearning = Annotated[
    CurrentUser, Depends(require_any_capability("talent", "learning"))
]


# --------------------------------------------------------------------------- #
# Career Tracks
# --------------------------------------------------------------------------- #


@router.post("/tracks")
async def create_track(
    current_user: RequireRecruiterWithTalentOrLearning,
    body: CareerTrackCreate,
):
    """Create a new career track for a department."""
    return await career_framework_service.create_track(
        current_user=current_user,
        department=body.department,
        track_name=body.track_name,
        description=body.description,
    )


@router.get("/tracks")
async def list_tracks(
    current_user: RequireRecruiterWithTalentOrLearning,
    department: str | None = Query(default=None, description="Filter by department"),
):
    """List all career tracks."""
    return await career_framework_service.list_tracks(department=department)


@router.get("/tracks/{track_id}")
async def get_track(
    current_user: RequireRecruiterWithTalentOrLearning,
    track_id: str,
):
    """Get a career track by ID."""
    return await career_framework_service.get_track(track_id)


@router.put("/tracks/{track_id}")
async def update_track(
    current_user: RequireRecruiterWithTalentOrLearning,
    track_id: str,
    body: CareerTrackUpdate,
):
    """Update a career track."""
    updates = body.model_dump(exclude_unset=True)
    return await career_framework_service.update_track(track_id, updates)


@router.delete("/tracks/{track_id}")
async def delete_track(
    current_user: RequireRecruiterWithTalentOrLearning,
    track_id: str,
):
    """Delete a career track (soft delete)."""
    return await career_framework_service.delete_track(track_id)


# --------------------------------------------------------------------------- #
# Career Levels
# --------------------------------------------------------------------------- #


@router.post("/levels")
async def create_level(
    current_user: RequireRecruiterWithTalentOrLearning,
    body: CareerLevelCreate,
):
    """Create a new career level."""
    return await career_framework_service.create_level(
        current_user=current_user,
        department=body.department,
        track_name=body.track_name,
        level_number=body.level_number,
        role_title=body.role_title,
        required_skills=[s.model_dump() for s in body.required_skills],
        required_certifications=[c.model_dump() for c in body.required_certifications],
        learning_path=[c.model_dump() for c in body.learning_path],
        competencies=[c.model_dump() for c in body.competencies],
        min_experience_years=body.min_experience_years,
        min_time_in_current_role_months=body.min_time_in_current_role_months,
        manager_approval_required=body.manager_approval_required,
        description=body.description,
    )


@router.get("/levels")
async def list_levels(
    current_user: RequireRecruiterWithTalentOrLearning,
    department: str | None = Query(default=None, description="Filter by department"),
    track_id: str | None = Query(default=None, description="Filter by track ID"),
):
    """List all career levels."""
    return await career_framework_service.list_levels(department=department, track_id=track_id)


@router.get("/levels/{level_id}")
async def get_level(
    current_user: RequireRecruiterWithTalentOrLearning,
    level_id: str,
):
    """Get a career level by ID."""
    return await career_framework_service.get_level(level_id)


@router.put("/levels/{level_id}")
async def update_level(
    current_user: RequireRecruiterWithTalentOrLearning,
    level_id: str,
    body: CareerLevelUpdate,
):
    """Update a career level."""
    updates = body.model_dump(exclude_unset=True)
    return await career_framework_service.update_level(level_id, updates)


@router.delete("/levels/{level_id}")
async def delete_level(
    current_user: RequireRecruiterWithTalentOrLearning,
    level_id: str,
):
    """Delete a career level (soft delete)."""
    return await career_framework_service.delete_level(level_id)


# --------------------------------------------------------------------------- #
# Employee Career Assignment (Recruiter)
# --------------------------------------------------------------------------- #


@router.post("/employees/{employee_id}/assign")
async def assign_employee_career(
    current_user: RequireRecruiterWithTalentOrLearning,
    employee_id: str,
    body: EmployeeCareerAssignRequest,
):
    """Assign a career path to an employee."""
    return await career_framework_service.assign_career(
        current_user=current_user,
        employee_id=employee_id,
        target_level_id=body.target_level_id,
        target_date=body.target_date,
    )


@router.get("/employees/{employee_id}")
async def get_employee_career(
    current_user: RequireRecruiterWithTalentOrLearning,
    employee_id: str,
):
    """Get an employee's career assignment."""
    return await career_framework_service.get_employee_career(employee_id)


@router.put("/employees/{employee_id}")
async def update_employee_career(
    current_user: RequireRecruiterWithTalentOrLearning,
    employee_id: str,
    body: EmployeeCareerUpdateRequest,
):
    """Update an employee's career assignment."""
    updates = body.model_dump(exclude_unset=True)
    return await career_framework_service.update_employee_career(employee_id, updates)


@router.post("/employees/{employee_id}/discussion")
async def log_career_discussion(
    current_user: RequireRecruiterWithTalentOrLearning,
    employee_id: str,
    body: CareerDiscussionRequest,
):
    """Log a career discussion with an employee."""
    return await career_framework_service.log_career_discussion(
        employee_id=employee_id,
        current_user=current_user,
        discussion_date=body.discussion_date,
        notes=body.notes,
        action_items=body.action_items,
    )


@router.post("/bulk-assign")
async def bulk_assign_career(
    current_user: RequireRecruiterWithTalentOrLearning,
    body: BulkCareerAssignRequest,
):
    """Assign career paths to multiple employees."""
    return await career_framework_service.bulk_assign(
        current_user=current_user,
        employee_ids=body.employee_ids,
        target_level_id=body.target_level_id,
        target_date=body.target_date,
    )


@router.get("/assignments")
async def list_all_assignments(
    current_user: RequireRecruiterWithTalentOrLearning,
    department: str | None = Query(default=None),
    status: str | None = Query(default=None),
):
    """List all career assignments."""
    return await career_framework_service.list_all_assignments(
        current_user=current_user,
        department=department,
        status_filter=status,
    )


# --------------------------------------------------------------------------- #
# Employee Self-Service
# --------------------------------------------------------------------------- #


@router.get("/my-career")
async def get_my_career(current_user: RequireEmployee):
    """Get my career path (employee self-service)."""
    return await career_framework_service.get_my_career(current_user)


@router.get("/my-career/progress")
async def get_my_career_progress(current_user: RequireEmployee):
    """Get my career progress with enriched learning path status."""
    return await career_framework_service.get_my_career_progress(current_user)


# --------------------------------------------------------------------------- #
# Reports
# --------------------------------------------------------------------------- #


@router.get("/reports/promotion-readiness")
async def get_promotion_readiness(
    current_user: RequireRecruiterWithTalentOrLearning,
    department: str | None = Query(default=None),
):
    """Get promotion readiness report."""
    return await career_framework_service.get_promotion_readiness(
        current_user=current_user,
        department=department,
    )


@router.get("/reports/career-progress")
async def get_career_progress_report(current_user: RequireRecruiterWithTalentOrLearning):
    """Get career progress report by department."""
    return await career_framework_service.get_career_progress_report(current_user)


# --------------------------------------------------------------------------- #
# CSV Import / Export
# --------------------------------------------------------------------------- #


@router.get("/export", response_class=PlainTextResponse)
async def export_framework(current_user: RequireRecruiterWithTalentOrLearning):
    """Export career framework as CSV."""
    csv_content = await career_framework_service.export_framework_csv()
    return PlainTextResponse(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=career_framework.csv"},
    )


@router.post("/import")
async def import_framework(
    current_user: RequireRecruiterWithTalentOrLearning,
    file: UploadFile = File(...),
):
    """Import career framework from CSV file."""
    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Please upload a CSV file.")

    content = await file.read()
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    return await career_framework_service.import_framework_csv(current_user, text)


@router.get("/template", response_class=PlainTextResponse)
async def download_template():
    """Download CSV template for career framework."""
    template = """Department,Track Name,Level,Role Title,Required Skills,Required Certifications,Learning Path Courses,Competencies,Min Experience (Years),Min Time in Role (Months),Manager Approval Required,Description
MBS,MBS Career Path,1,Junior Solution Engineer/System Analyst,Python (Intermediate); SQL (Beginner),,Python Basics; SQL Fundamentals,Problem Solving (30%); Communication (20%),0,0,No,Entry-level position
MBS,MBS Career Path,2,Solution Engineer/System Analyst,Python (Advanced); SQL (Intermediate); AWS (Beginner),AWS Cloud Practitioner,Advanced Python; SQL Deep Dive; AWS Fundamentals,Problem Solving (30%); Technical Design (25%),2,12,Yes,Mid-level position
AI,AI Career Path,1,Junior Solution Engineer/System Analyst,Python (Intermediate); Machine Learning (Beginner),,Python for Data Science; ML Basics,Data Analysis (30%); Python (20%),0,0,No,Entry-level AI position
AI,AI Career Path,2,Solution Engineer/System Analyst,Python (Advanced); Machine Learning (Intermediate); TensorFlow (Beginner),,Advanced Python; ML Deep Dive; TensorFlow Basics,Model Development (30%); Data Pipelines (25%),2,12,Yes,Mid-level AI position
QA,QA Career Path,1,Junior Solution Engineer/System Analyst,Testing (Beginner); Python (Beginner),,Testing Fundamentals; Python Basics,Attention to Detail (30%); Documentation (20%),0,0,No,Entry-level QA position
"""
    return PlainTextResponse(
        content=template,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=career_framework_template.csv"},
    )

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.core.rbac import CurrentUser
from app.core.security import require_roles
from app.schemas.talent import (
    CompetencyEvaluationRequest,
    DevelopmentPlanUpdateRequest,
    InternalOpportunityCreateRequest,
    InternalOpportunityUpdateRequest,
    TalentSearchRequest,
)
from app.services.talent_service import talent_service

router = APIRouter(prefix="/api/talent", tags=["Talent Management"])

RequireRecruiter = Annotated[CurrentUser, Depends(require_roles("recruiter", "super_admin"))]
RequireEmployee = Annotated[CurrentUser, Depends(require_roles("employee", "super_admin"))]
RequireAny = Annotated[CurrentUser, Depends(require_roles("employee", "recruiter", "super_admin"))]


# ---------------------------------------------------------------------- #
# US-090 / US-091: Skill matrix (self-service view)
# ---------------------------------------------------------------------- #
@router.get("/skill-matrix")
async def my_skill_matrix(current_user: RequireEmployee):
    employee = await talent_service.get_current_employee(current_user)
    return await talent_service.skill_matrix(employee)


# ---------------------------------------------------------------------- #
# US-093: Career progression
# ---------------------------------------------------------------------- #
@router.get("/career-progression")
async def my_career_progression(current_user: RequireEmployee):
    employee = await talent_service.get_current_employee(current_user)
    return await talent_service.career_progression(employee)


# ---------------------------------------------------------------------- #
# US-094: Journey timeline
# ---------------------------------------------------------------------- #
@router.get("/journey")
async def my_journey(current_user: RequireEmployee, types: str | None = Query(default=None)):
    employee = await talent_service.get_current_employee(current_user)
    event_types = [t.strip() for t in types.split(",")] if types else None
    return await talent_service.journey_timeline(employee, event_types=event_types)


# ---------------------------------------------------------------------- #
# US-101: Achievements
# ---------------------------------------------------------------------- #
@router.get("/achievements")
async def my_achievements(current_user: RequireEmployee):
    employee = await talent_service.get_current_employee(current_user)
    return await talent_service.achievements(employee)


# ---------------------------------------------------------------------- #
# US-095: Internal opportunities
# ---------------------------------------------------------------------- #
@router.get("/opportunities")
async def browse_opportunities(
    current_user: RequireAny,
    q: str | None = None,
    type: str | None = Query(default=None, alias="type"),
    department: str | None = None,
    status: str = Query(default="open"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=60),
):
    return await talent_service.list_opportunities(
        current_user,
        q=q,
        opp_type=type,
        department=department,
        status_filter=status,
        page=page,
        page_size=page_size,
        for_employee=current_user.role == "employee",
    )


@router.post("/opportunities", status_code=201)
async def post_opportunity(request: InternalOpportunityCreateRequest, current_user: RequireRecruiter):
    return await talent_service.create_opportunity(current_user, request)


@router.put("/opportunities/{opportunity_id}")
async def edit_opportunity(
    opportunity_id: str, request: InternalOpportunityUpdateRequest, current_user: RequireRecruiter
):
    return await talent_service.update_opportunity(current_user, opportunity_id, request)


@router.post("/opportunities/{opportunity_id}/apply", status_code=201)
async def apply_opportunity(opportunity_id: str, current_user: RequireEmployee):
    return await talent_service.apply_to_opportunity(current_user, opportunity_id)


@router.get("/opportunities/{opportunity_id}/applicants")
async def opportunity_applicants(opportunity_id: str, current_user: RequireRecruiter):
    return await talent_service.list_opportunity_applicants(current_user, opportunity_id)


# ---------------------------------------------------------------------- #
# US-099: Competency evaluation
# ---------------------------------------------------------------------- #
@router.post("/competency/{employee_id}", status_code=201)
async def submit_competency(employee_id: str, request: CompetencyEvaluationRequest, current_user: RequireRecruiter):
    return await talent_service.submit_competency_evaluation(current_user, employee_id, request)


@router.get("/competency/{employee_id}")
async def competency_history(employee_id: str, current_user: RequireAny):
    return await talent_service.get_competency_history(current_user, employee_id)


# ---------------------------------------------------------------------- #
# US-100: Talent search
# ---------------------------------------------------------------------- #
@router.post("/search")
async def search_talent(request: TalentSearchRequest, current_user: RequireRecruiter):
    return await talent_service.search_talent(current_user, request)


# ---------------------------------------------------------------------- #
# US-102: Recruiter talent metrics dashboard
# ---------------------------------------------------------------------- #
@router.get("/metrics")
async def talent_metrics(current_user: RequireRecruiter, department: str | None = None):
    return await talent_service.talent_metrics(current_user, department=department)


# ---------------------------------------------------------------------- #
# US-103: Development plan
# ---------------------------------------------------------------------- #
@router.get("/development-plan/{employee_id}")
async def development_plan(employee_id: str, current_user: RequireAny):
    return await talent_service.get_development_plan(current_user, employee_id)


@router.put("/development-plan/{employee_id}")
async def edit_development_plan(
    employee_id: str, request: DevelopmentPlanUpdateRequest, current_user: RequireRecruiter
):
    return await talent_service.update_development_plan(current_user, employee_id, request)


# ---------------------------------------------------------------------- #
# US-104: Aggregated 360 profile
# ---------------------------------------------------------------------- #
@router.get("/profile/{employee_id}")
async def talent_profile(employee_id: str, current_user: RequireAny):
    return await talent_service.get_talent_profile(current_user, employee_id)

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.core.rbac import CurrentUser
from app.core.security import RequireUser, require_permissions, require_roles
from app.schemas.dashboard import CreateAnnouncementRequest, MarkNotificationsReadRequest
from app.services.candidate_service import CandidateService
from app.services.dashboard_service import DashboardService

router = APIRouter(tags=["Dashboard"])
service = DashboardService()
candidate_service = CandidateService()

RequireRecruiter = Annotated[CurrentUser, Depends(require_roles("recruiter", "super_admin"))]
RequireOnboardingSelf = Annotated[CurrentUser, Depends(require_permissions("onboarding.self"))]


# ----- US-013 -----
@router.get("/api/dashboard/summary")
async def get_dashboard_summary(current_user: RequireRecruiter):
    return await service.get_summary(current_user)


# ----- US-013 / US-016 -----
@router.get("/api/dashboard/activity")
async def get_dashboard_activity(
    current_user: RequireRecruiter,
    limit: int = Query(default=20, ge=1, le=100),
):
    return await service.get_activity(current_user, limit)


# ----- US-018 / US-019 / US-021 / US-022 -----
@router.get("/api/dashboard/candidate")
async def get_candidate_dashboard(current_user: RequireOnboardingSelf):
    return await candidate_service.get_dashboard(current_user)


# ----- US-014 -----
@router.get("/api/notifications")
async def get_notifications(current_user: RequireRecruiter, limit: int = Query(default=30, ge=1, le=100)):
    return await service.get_notifications(current_user, limit)


@router.put("/api/notifications/read")
async def mark_notifications_read(request: MarkNotificationsReadRequest, current_user: RequireRecruiter):
    return await service.mark_notifications_read(current_user, request)


# ----- US-017 -----
@router.get("/api/search")
async def global_search(current_user: RequireRecruiter, q: str = Query(min_length=1, max_length=120)):
    return await service.search(current_user, q)


# ----- US-020 -----
@router.get("/api/announcements")
async def list_announcements(_current_user: RequireUser, limit: int = Query(default=20, ge=1, le=50)):
    return await service.list_announcements(limit)


@router.post("/api/announcements", status_code=201)
async def create_announcement(request: CreateAnnouncementRequest, current_user: RequireRecruiter):
    return await service.create_announcement(current_user, request)
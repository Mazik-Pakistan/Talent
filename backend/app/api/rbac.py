from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.rbac import CurrentUser, PERMISSIONS, ROLE_PERMISSIONS, ROLE_HOME
from app.core.security import get_current_user

router = APIRouter(prefix="/api/rbac", tags=["RBAC"])


@router.get("/me")
async def get_my_access(current_user: Annotated[CurrentUser, Depends(get_current_user)]):
    """Return the authenticated user's role and permissions (US-012)."""
    permissions = sorted(ROLE_PERMISSIONS.get(current_user.role, frozenset()))
    return {
        "user": {
            "id": current_user.id,
            "email": current_user.email,
            "full_name": current_user.full_name,
            "role": current_user.role,
            "job_title": current_user.job_title,
            "department": current_user.department,
        },
        "permissions": permissions,
        "home": ROLE_HOME.get(current_user.role, "/login"),
        "modules": {
            "recruitment": current_user.has_any(["recruitment.view", "recruitment.invite"]),
            "onboarding": current_user.has_any(["onboarding.self", "onboarding.manage"]),
            "learning": current_user.has_permission("learning.access"),
            "ai": current_user.has_any(["ai.access", "ai.coach"]),
            "reporting": current_user.has_permission("reporting.view"),
            "profile": current_user.has_permission("profile.view"),
            "admin": current_user.has_permission("admin.access"),
        },
    }


@router.get("/catalog")
async def get_rbac_catalog():
    """Public catalog of roles/permissions definitions (no secrets)."""
    return {
        "permissions": PERMISSIONS,
        "roles": {role: sorted(perms) for role, perms in ROLE_PERMISSIONS.items()},
    }

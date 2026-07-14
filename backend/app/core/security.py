"""US-012: Auth + permission dependencies for protected API endpoints."""

from datetime import UTC, datetime
from typing import Annotated, Callable

from fastapi import Depends, Header, HTTPException, status
from starlette.concurrency import run_in_threadpool

from app.core.database import database, supabase
from app.core.rbac import CurrentUser


def extract_bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )
    return token


async def get_current_user(authorization: str | None = Header(default=None)) -> CurrentUser:
    access_token = extract_bearer_token(authorization)

    try:
        response = await run_in_threadpool(supabase.auth.get_user, access_token)
        auth_user = response.user
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        ) from error

    if not auth_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")

    profile, role = await _resolve_active_profile(auth_user.id)
    if not profile or not role:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No active role profile found for this account.",
        )

    return CurrentUser(
        id=profile["supabase_user_id"],
        email=profile["email"],
        full_name=profile["full_name"],
        role=role,
        access_token=access_token,
        phone=profile.get("phone"),
        job_title=profile.get("job_title"),
        department=profile.get("department"),
    )


async def _resolve_active_profile(supabase_user_id: str) -> tuple[dict | None, str | None]:
    lookups = (
        ("super_admin", database.super_admins),
        ("recruiter", database.recruiters),
        ("employee", database.employees),
        ("candidate", database.candidates),
    )
    for role, collection in lookups:
        profile = await collection.find_one({"supabase_user_id": supabase_user_id, "status": "active"})
        if profile:
            return profile, role
    return None, None


async def _audit_denied(user: CurrentUser | None, permission: str, detail: str) -> None:
    await database.audit_logs.insert_one(
        {
            "user_id": user.id if user else None,
            "email": user.email if user else None,
            "role": user.role if user else None,
            "module": "rbac",
            "action": "access_denied",
            "permission": permission,
            "outcome": "denied",
            "detail": detail,
            "created_at": datetime.now(UTC),
        }
    )


def require_permissions(*permissions: str) -> Callable:
    """FastAPI dependency factory — unauthorized roles receive HTTP 403."""

    async def dependency(user: Annotated[CurrentUser, Depends(get_current_user)]) -> CurrentUser:
        missing = [p for p in permissions if not user.has_permission(p)]
        if missing:
            detail = "You do not have permission to access this resource."
            await _audit_denied(user, ",".join(missing), detail)
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)
        return user

    return dependency


def require_roles(*roles: str) -> Callable:
    async def dependency(user: Annotated[CurrentUser, Depends(get_current_user)]) -> CurrentUser:
        if user.role not in roles:
            detail = "You do not have permission to access this resource."
            await _audit_denied(user, f"roles:{','.join(roles)}", detail)
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)
        return user

    return dependency


RequireUser = Annotated[CurrentUser, Depends(get_current_user)]

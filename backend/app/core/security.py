"""US-012: Auth + permission dependencies for protected API endpoints."""

from datetime import UTC, datetime, timedelta
from typing import Annotated, Callable

from fastapi import Depends, Header, HTTPException, status
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings
from app.core.database import database
from app.core.rbac import CurrentUser

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(UTC) + expires_delta
    else:
        expire = datetime.now(UTC) + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(data: dict, expires_days: int = 7) -> str:
    to_encode = data.copy()
    expire = datetime.now(UTC) + timedelta(days=expires_days)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


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
        payload = jwt.decode(access_token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        user_id: str = payload.get("user_id")
        email: str = payload.get("email")
        role: str = payload.get("role")
        if not user_id or not email or not role:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required.",
            )
    except JWTError as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        ) from error

    profile, active_role = await _resolve_active_profile(user_id)
    if not profile or not active_role:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No active role profile found for this account.",
        )

    # Return the user_id or supabase_user_id as ID
    resolved_id = profile.get("user_id") or profile.get("supabase_user_id") or user_id

    return CurrentUser(
        id=resolved_id,
        email=profile["email"],
        full_name=profile["full_name"],
        role=active_role,
        access_token=access_token,
        phone=profile.get("phone"),
        job_title=profile.get("job_title"),
        department=profile.get("department"),
    )


async def _resolve_active_profile(user_id: str) -> tuple[dict | None, str | None]:
    lookups = (
        ("super_admin", database.super_admins),
        ("recruiter", database.recruiters),
        ("employee", database.employees),
        ("candidate", database.candidates),
    )
    for role, collection in lookups:
        profile = await collection.find_one({
            "$or": [
                {"user_id": user_id},
                {"supabase_user_id": user_id}
            ],
            "status": "active"
        })
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


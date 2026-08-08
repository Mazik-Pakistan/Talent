"""Email Templates API — org-scoped CRUD for recruiter email customization."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.core.rbac import CurrentUser
from app.core.security import require_any_capability, require_roles

router = APIRouter(prefix="/api/email-templates", tags=["Email Templates"])

RequireRecruiterOrgConfig = Annotated[
    CurrentUser, Depends(require_any_capability("org_config", "learning"))
]
RequireWriteRole = Annotated[
    CurrentUser, Depends(require_roles("recruiter", "super_admin")),
]


def _org_id(user: CurrentUser) -> str:
    if not user.organization_id:
        raise HTTPException(status_code=400, detail="No organization bound to your account.")
    return user.organization_id


# ── Registry ─────────────────────────────────────────────────────────────────

@router.get("/registry")
async def get_registry():
    from app.services.email_template_service import EMAIL_TEMPLATES
    return {
        "templates": [
            {
                "key": key,
                "name": meta["name"],
                "description": meta["description"],
                "category": meta["category"],
                "variables": meta["variables"],
                "default_subject": meta["default_subject"],
                "default_body": meta["default_body"],
            }
            for key, meta in EMAIL_TEMPLATES.items()
        ]
    }


# ── List all (merged defaults + overrides) ───────────────────────────────────

@router.get("")
async def list_email_templates(current_user: RequireRecruiterOrgConfig):
    from app.services.email_template_service import list_templates
    return await list_templates(_org_id(current_user))


# ── Get one ──────────────────────────────────────────────────────────────────

@router.get("/{key}")
async def get_email_template(key: str, current_user: RequireRecruiterOrgConfig):
    from app.services.email_template_service import get_template
    tpl = await get_template(_org_id(current_user), key)
    if not tpl:
        raise HTTPException(status_code=404, detail=f"Unknown template: {key}")
    return tpl


# ── Save (upsert) ────────────────────────────────────────────────────────────

@router.put("/{key}")
async def save_email_template(
    key: str,
    payload: dict,
    current_user: RequireRecruiterOrgConfig,
    _role_user: RequireWriteRole,
):
    from app.services.email_template_service import upsert_template
    subject = (payload.get("subject") or "").strip()
    body_html = (payload.get("body_html") or "").strip()
    if not subject:
        raise HTTPException(status_code=422, detail="Subject cannot be empty.")
    try:
        result = await upsert_template(
            _org_id(current_user), key, subject, body_html, current_user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return result


# ── Reset to default (delete override) ───────────────────────────────────────

@router.delete("/{key}")
async def reset_email_template(
    key: str,
    current_user: RequireRecruiterOrgConfig,
    _role_user: RequireWriteRole,
):
    from app.services.email_template_service import delete_template
    await delete_template(_org_id(current_user), key)
    return {"deleted": True}

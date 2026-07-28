"""AI Agent API — conversational hiring & onboarding automation.

Available to recruiters (invitations / offers / joining letters) and to
candidates/employees (self-service onboarding). Everything the agent does
goes through the same permission-checked service methods used by the
regular UI, so the agent can never do more than the signed-in user could
already do by hand.
"""

from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, Query, UploadFile

from app.core.database import database
from app.core.rbac import CurrentUser
from app.core.security import RequireUser
from app.schemas.agent import AgentChatRequest, AgentResetRequest
from app.services import agent_tools
from app.services.agent_service import _load_or_create_session, _now_iso, _save_messages, agent_service

router = APIRouter(prefix="/api/agent", tags=["AI Agent"])

ALLOWED_ROLES = ("candidate", "employee", "recruiter", "super_admin")


def _assert_agent_role(user: CurrentUser) -> None:
    if user.role not in ALLOWED_ROLES:
        raise HTTPException(status_code=403, detail="The AI agent is not available for this account type.")


@router.post("/chat")
async def chat(request: AgentChatRequest, current_user: RequireUser):
    """Send a message to the role-appropriate agent (recruiter or onboarding)."""
    _assert_agent_role(current_user)
    if not request.message and not request.session_id:
        raise HTTPException(status_code=400, detail="A message is required to start a conversation.")
    context = request.context.model_dump(exclude_none=True) if hasattr(request.context, "model_dump") else request.context
    return await agent_service.chat(current_user, request.message, request.session_id, context)


@router.get("/sessions")
async def list_sessions(current_user: RequireUser):
    _assert_agent_role(current_user)
    return await agent_service.list_sessions(current_user)


@router.get("/history")
async def get_history(session_id: str, current_user: RequireUser):
    _assert_agent_role(current_user)
    return await agent_service.get_history(current_user, session_id)


@router.post("/reset")
async def reset_session(request: AgentResetRequest, current_user: RequireUser):
    _assert_agent_role(current_user)
    if request.session_id:
        await database.agent_conversations.delete_one({"session_id": request.session_id, "user_id": current_user.id})
    return {"message": "Conversation cleared."}


@router.post("/recruiter/bulk-invite")
async def bulk_invite_from_spreadsheet(
    current_user: RequireUser,
    file: UploadFile = File(...),
    session_id: str | None = Query(None),
):
    """Parse an uploaded .xlsx / .csv roster and invite every valid row (with offer).

    Prefer the Invite page bulk flow for review + history; this endpoint still
    validates offer fields then sends. Required columns match the bulk template.
    """
    if current_user.role not in ("recruiter", "super_admin"):
        raise HTTPException(status_code=403, detail="Only recruiters can bulk-invite candidates.")

    from app.services.bulk_invite_service import bulk_invite_service

    resolved_session = session_id

    async def _report(message: str, *, ok: bool, extra: dict | None = None) -> dict:
        payload = {"session_id": None, "message": message, "ok": ok, "sent": [], "failed": [], **(extra or {})}
        convo = await _load_or_create_session(current_user, resolved_session)
        await _save_messages(
            convo["session_id"],
            current_user.id,
            [
                {"role": "user", "content": f"[Uploaded spreadsheet: {file.filename}]", "created_at": _now_iso()},
                {"role": "assistant", "content": message, "created_at": _now_iso(), "meta": {"validation": extra or {}}},
            ],
        )
        payload["session_id"] = convo["session_id"]
        return payload

    preview = await bulk_invite_service.preview(file, current_user)
    if not preview.get("ok"):
        missing = preview.get("missing_headers") or []
        found = ", ".join(preview.get("found_headers") or []) or "(none)"
        message = (
            f"I checked `{file.filename}` before sending any invites — it's missing required columns:\n"
            f"• Missing: {', '.join(missing)}\n"
            f"• Found headers: {found}\n\n"
            "Required: email, full_name, job_title, department, reporting_manager, start_date, monthly_salary.\n"
            "Download the template from Invite → Bulk Excel, then upload again. No invitations were sent."
        )
        return await _report(message, ok=False, extra=preview)

    rows = preview.get("rows") or []
    invalid = [r for r in rows if not r.get("valid")]
    blocked = [r for r in rows if r.get("valid") and not r.get("can_send")]
    sendable = [r for r in rows if r.get("can_send")]

    if invalid and not sendable:
        issue_lines = "; ".join(
            f"row {x.get('row')}" + (f" ({x.get('email')})" if x.get("email") else "")
            + f": missing {', '.join(x.get('missing_fields') or [])}"
            for x in invalid[:8]
        )
        message = (
            f"I checked `{file.filename}` — every data row is missing required offer fields.\n"
            f"Issues: {issue_lines}\n\n"
            "Required per row: email, full_name, job_title, department, reporting_manager, "
            "start_date, monthly_salary. No invitations were sent."
        )
        return await _report(message, ok=False, extra={"row_issues": invalid, "valid_rows": 0})

    if invalid or blocked:
        message = (
            f"I checked `{file.filename}` before inviting anyone.\n"
            f"• Ready to invite: {len(sendable)}\n"
            f"• Incomplete rows: {len(invalid)}\n"
            f"• Blocked (active conflict): {len(blocked)}\n\n"
            "Fix incomplete/blocked rows (or use Invite → Bulk Excel to review history and send "
            "only selected rows). No invitations were sent from this upload."
        )
        return await _report(
            message,
            ok=False,
            extra={
                "row_issues": invalid,
                "blocked_rows": blocked,
                "valid_rows": len(sendable),
                "blocked": True,
            },
        )

    if not sendable:
        return await _report(
            f"`{file.filename}` has headers but no candidate rows ready to invite.",
            ok=False,
            extra={"valid_rows": 0},
        )

    result = await bulk_invite_service.send_rows(current_user, sendable)
    sent = result.get("sent") or []
    failed = result.get("failed") or []
    summary = (
        f"Checked `{file.filename}` — all {len(sendable)} row(s) had required offer fields. "
        f"Invited {len(sent)}, failed {len(failed)}."
    )
    if failed:
        summary += " Failures: " + "; ".join(f"{f.get('email')}: {f.get('error')}" for f in failed[:5])

    convo = await _load_or_create_session(current_user, resolved_session)
    await _save_messages(
        convo["session_id"],
        current_user.id,
        [
            {"role": "user", "content": f"[Uploaded spreadsheet: {file.filename}]", "created_at": _now_iso()},
            {"role": "assistant", "content": summary, "created_at": _now_iso(), "meta": {"tool_data": result}},
        ],
    )

    return {
        "session_id": convo["session_id"],
        "message": summary,
        "ok": True,
        "sent": sent,
        "failed": failed,
    }
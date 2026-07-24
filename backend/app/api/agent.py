"""AI Agent API — conversational hiring & onboarding automation.

Available to recruiters (invitations / offers / joining letters) and to
candidates/employees (self-service onboarding). Everything the agent does
goes through the same permission-checked service methods used by the
regular UI, so the agent can never do more than the signed-in user could
already do by hand.
"""

from __future__ import annotations

import io
from fastapi import APIRouter, File, HTTPException, Query, UploadFile

from app.core.database import database
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
    return await agent_service.chat(current_user, request.message, request.session_id)


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
    """Parse an uploaded .xlsx / .csv roster and send an invitation to every row.

    Expected columns (case-insensitive header row): email, full_name / name,
    job_title / title, department, office_location (optional), start_date
    (optional, YYYY-MM-DD).
    """
    if current_user.role not in ("recruiter", "super_admin"):
        raise HTTPException(status_code=403, detail="Only recruiters can bulk-invite candidates.")

    resolved_session = session_id

    filename = (file.filename or "").lower()
    is_csv = filename.endswith(".csv")
    is_xlsx = filename.endswith(".xlsx") or filename.endswith(".xlsm")
    if not (is_csv or is_xlsx):
        raise HTTPException(status_code=400, detail="Please upload a .xlsx or .csv spreadsheet.")

    raw = await file.read()
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File is too large (5MB limit).")

    try:
        if is_csv:
            import csv

            text = raw.decode("utf-8-sig", errors="replace")
            reader = csv.reader(io.StringIO(text))
            rows = list(reader)
            if not rows:
                raise HTTPException(status_code=400, detail="The CSV file is empty.")
            header = [str(h).strip().lower() if h else "" for h in rows[0]]
            data_rows = rows[1:]
        else:
            from openpyxl import load_workbook

            workbook = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
            sheet = workbook.active
            rows_iter = sheet.iter_rows(values_only=True)
            header = [str(h).strip().lower() if h else "" for h in next(rows_iter, [])]
            data_rows = list(rows_iter)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Could not read the spreadsheet: {exc}") from exc

    def _col(*names: str) -> int | None:
        for name in names:
            if name in header:
                return header.index(name)
        return None

    idx_email = _col("email", "email address")
    idx_name = _col("full_name", "name", "candidate name", "full name")
    idx_title = _col("job_title", "title", "job title", "position")
    idx_dept = _col("department", "dept")
    idx_office = _col("office_location", "office", "location")
    idx_start = _col("start_date", "start date", "joining date")

    if idx_email is None or idx_name is None:
        raise HTTPException(
            status_code=400,
            detail="The spreadsheet needs at least 'email' and 'full_name' columns in the header row.",
        )

    candidates = []
    for row in data_rows:
        if not row or idx_email >= len(row) or not row[idx_email]:
            continue
        candidates.append(
            {
                "email": str(row[idx_email]).strip(),
                "full_name": str(row[idx_name]).strip() if idx_name is not None and idx_name < len(row) and row[idx_name] else "",
                "job_title": str(row[idx_title]).strip() if idx_title is not None and idx_title < len(row) and row[idx_title] else None,
                "department": str(row[idx_dept]).strip() if idx_dept is not None and idx_dept < len(row) and row[idx_dept] else None,
                "office_location": str(row[idx_office]).strip() if idx_office is not None and idx_office < len(row) and row[idx_office] else None,
                "start_date": str(row[idx_start]).strip() if idx_start is not None and idx_start < len(row) and row[idx_start] else None,
            }
        )

    if not candidates:
        raise HTTPException(status_code=400, detail="No candidate rows found below the header.")

    result = await agent_tools.run_tool(current_user, "bulk_invite", {"candidates": candidates})
    if not result.ok:
        raise HTTPException(status_code=400, detail=result.error or "Bulk invite failed.")

    sent = result.data["sent"]
    failed = result.data["failed"]
    summary = f"Processed {result.data['total']} rows from {file.filename}: {len(sent)} invited, {len(failed)} failed."
    if failed:
        summary += " Failures: " + "; ".join(f"{f['email']}: {f['error']}" for f in failed[:5])

    # Fold this into the chat transcript so it's visible in the widget.
    convo = await _load_or_create_session(current_user, resolved_session)
    await _save_messages(
        convo["session_id"],
        current_user.id,
        [
            {"role": "user", "content": f"[Uploaded spreadsheet: {file.filename}]", "created_at": _now_iso()},
            {"role": "assistant", "content": summary, "created_at": _now_iso(), "meta": {"tool_data": result.data}},
        ],
    )

    return {"session_id": convo["session_id"], "message": summary, "sent": sent, "failed": failed}
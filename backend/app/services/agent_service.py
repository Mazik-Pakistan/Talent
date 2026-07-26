"""AI Agent orchestrator — natural-language front end over the hiring &
onboarding services (invitations, offers, candidate intake, employee
profile completion, documents).

The loop is intentionally simple and auditable:
    1. Build a prompt containing: role context, available tools, a fresh
       state snapshot, recent conversation history, and the new message.
    2. Ask the LLM for one strict-JSON action: either call a tool, or reply.
    3. If it calls a tool, execute it against the *existing, permission
       checked* service layer and feed the result back in as an
       observation, then loop (bounded).
    4. Persist the turn and return the reply plus light UI hints.

If no LLM key is configured, a deterministic fallback still answers status
questions so the feature degrades gracefully instead of breaking.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from secrets import token_urlsafe
from typing import Any

from app.core.database import database
from app.core.rbac import CurrentUser
from app.services import agent_tools
from app.services.llm_service import call_llm_json, llm_configured

MAX_TOOL_STEPS = 8
HISTORY_TURNS = 6

RECRUITER_SYSTEM_PROMPT = """You are the TalentAI Hiring Agent for recruiters. You can run almost any \
recruiting or post-hire action the recruiter dashboard supports — for one person or in bulk — via your tools. \
You are precise, proactive, and never invent data you were not given or that a tool did not return.

Greetings & capability talk (critical):
- On hellos / "what can you do?", do NOT list a short fixed menu that makes it sound like you only do a few things.
- Keep greetings open: you help with candidates and employees end-to-end (invite, pipeline, offers, activation, \
documents, joining letters, profile reminders, Day-1 email/assets/orientation, career events, search, activity, \
announcements, Learning catalog/assign/verify certificates, Talent search/opportunities/competency) — \
one person or many at once.
- Prefer asking what they want to do over enumerating features. If they ask for capabilities, give a broad \
overview in one short paragraph, then invite them to name a person, a bulk action, or a goal.

Workflows & confirmation gates (critical):
- Chain tools toward a goal when the recruiter asks (e.g. review docs → verify → create offer → activate). \
Ask only for missing required fields; confirm before destructive/irreversible actions.
- ALWAYS confirm before: reject/delete documents, delete announcements, decline-equivalent irreversible steps, \
approve_offer / bulk_approve when not explicit, role changes, certificate reject.
- When chaining, briefly narrate progress (Found X → listed docs → verified CNIC → …).
- For your own profile photo, set ui_hint {{"type":"upload","doc_type":"photo"}} so the app shows an upload button.

Contextual suggested_replies (critical):
- Always return 3–5 suggested_replies that match the CURRENT topic — not a generic menu.
- If the talk is about a CANDIDATE (or pre-hire): suggest candidate actions only, e.g. check status, remind \
onboarding (remind_candidate), send/resend offer, review documents, verify/reject docs, approve & activate if \
signed, send joining letter, list pipeline. Name the person when known.
- If the talk is about an EMPLOYEE (post-hire): suggest employee actions only, e.g. profile progress, remind \
Complete Profile, set company email, assign asset, schedule orientation, career event, list documents, assign \
course, competency evaluation.
- When looking someone up by name, call get_candidate_status / get_employee_detail with name= (or email=). \
Never say you could not find them if list_pipeline just showed that name — retry with the email from the list.
- When the recruiter asks for a profile, return the tool's profile fields (personal, education, skills, title, \
dept, missing steps) — not only a one-line status.
- When listing documents, always paste each download_url as a plain https link in your reply so it is clickable. \
Chat cannot preview PDFs inside the bubble.
- If the talk is about MANY people / bulk / "all": suggest bulk actions (remind all incomplete, activate all \
signed offers, bulk invite, bulk assign assets, announce to employees).
- If the talk is open/greeting: mix a few broad goals, and never imply those chips are the full feature set.
- Keep each chip short (under ~8 words), actionable, and ready to send as the next user message.

Rules:
- Only use the tools listed. Never fabricate a tool result. If a request matches a tool, use it; if something \
is outside your tools, say so briefly and suggest the closest supported action.
- Ask the recruiter for any required field you don't have yet (e.g. reporting manager, start date, asset name) \
instead of guessing.
- Dates should be confirmed in a clear format before calling a tool that needs one.
- When the user asks to act on everyone / all incomplete / all signed offers / a pasted list, prefer the \
bulk_* tools (bulk_invite, bulk_approve_offers, bulk_remind_profiles, bulk_remind_candidates, \
bulk_assign_assets, bulk_schedule_orientation, bulk_set_company_email, bulk_verify_documents). Cap is handled by tools.
- When a user pastes a list of candidates (from chat or a spreadsheet already parsed for you), use bulk_invite \
only if every person has email, full_name, job_title/designation, and department (same as Create invitation). \
If any required field is missing, do NOT call bulk_invite and do NOT invent values like "Not specified" — \
list what is missing and ask the recruiter to provide designation and department (and name/email if needed).
- For Excel/CSV bulk invite: tell the recruiter to use the paperclip attachment in the chat, OR set \
ui_hint to {{"type": "spreadsheet"}} so the app shows an upload button. NEVER use ui_hint type "upload" \
(that is only for candidates uploading CNIC/resume). Never invent doc_type values like excel/spreadsheet/csv \
under type "upload". Remind them the file needs columns: email, full_name, job_title (or designation), \
department (optional: office_location, start_date). Phone is not used for invitations.
- After a tool call, summarize plainly what happened (who was invited/offered/notified/activated), including \
any failures. For bulk ops, report counts: succeeded / failed / skipped.
- Keep replies concise and action-oriented.
- NEVER say you sent an email, reminder, or notification unless a tool result explicitly has email_sent=true \
or notification_sent=true (or emailed/notified counts > 0 for announcements). If either flag is false, say so \
clearly and include email_error when present.

Profile / onboarding status (critical):
- Pre-hire candidate onboarding (personal, education, skills, government docs, resume) is NOT the same as \
post-hire employee Complete Profile (emergency contact, banking, references, policies, NDA).
- After someone is converted to an employee, always use get_candidate_status, get_employee_detail, or \
list_employees/directory_employees and report post_hire_profile_complete / post_hire_missing / profile_status. \
Never say their profile is complete just because pre-hire fields are on file.
- If profile_status is incomplete or post_hire_missing is non-empty, say clearly that they have NOT finished \
post-hire Complete Profile, and list the missing steps.
- To remind one employee, call remind_employee_profile. To remind everyone incomplete, call \
bulk_remind_profiles. Use force=true only when the recruiter asks to resend.
- To remind a pre-hire candidate, call remind_candidate (not remind_employee_profile).

Pipeline & activation:
- Use list_pipeline (pending_review / onboarding / ready_to_activate) to show hiring stages.
- Use get_dashboard_summary for overview KPIs.
- Use approve_offer for one signed offer, bulk_approve_offers to activate all (or a list).

Document review & verification (hiring workflow):
- If the recruiter asks to see/open/review someone's documents, call list_person_documents (alias: \
list_candidate_documents) — never guess document ids. The app renders returned documents as cards the \
recruiter can open/verify directly, so briefly summarize count and any flagged OCR mismatches instead of \
restating every field.
- To verify, reject, or request re-upload of a specific document, call verify_document with the exact \
document_id from list_person_documents. Rejecting or requesting re-upload requires a rejection_reason — \
ask the recruiter for one if they didn't give it. Use bulk_verify_documents for many docs at once.
- If list_person_documents shows OCR mismatches against the profile, point them out before verifying, and \
only use approve_despite_mismatch=true if the recruiter explicitly says to override it.
- Typical hiring flow: list_candidates / list_pipeline → list_person_documents → verify_document → \
create_offer → approve_offer / send_joining_letter.

Day-1:
- set_company_email / bulk_set_company_email, assign_asset / bulk_assign_assets, \
schedule_orientation / bulk_schedule_orientation. For assign_asset, identify the person by email or \
employee_id — `name` means the asset name.
- update_employee_role changes designation/department.

Learning & Talent:
- browse_learning_catalog → assign_courses; list_learning_assignments; list_pending_certificates → \
verify_certificate (open certificate_url/file_url first); learning_analytics; KB role/cert CRUD tools.
- talent_metrics, search_talent, create/update_opportunity, list_opportunity_applicants, \
submit_competency_evaluation, update_development_plan, get_talent_profile.

Announcements:
- create_announcement / update_announcement / delete_announcement (delete needs confirm=true).
"""

CANDIDATE_SYSTEM_PROMPT = """You are the TalentAI Onboarding Agent for candidates. You help them complete \
pre-hire intake, manage documents, and review/sign or decline their offer letter — using only your tools.

Rules:
- Always check get_status first if you don't already know the current step. Candidate steps: personal, \
education, skills, submit (plus uploaded government_docs / resume).
- Ask only for information still missing — never re-ask for something already saved.
- When the person gives free text, extract fields and call save_step yourself.
- Documents (CNIC, passport, transcripts, resume) must be uploaded as files — include ui_hint type "upload" \
with doc_type/category when needed: cnic/identity, passport/identity, transcript/education, resume/other.
- Skill certifications: set ui_hint {{"type":"upload","doc_type":"skill_certificate","course_title":"<name>"}} \
so the file is stored and its document_url is saved for recruiter review. After upload, call save_step skills \
including certifications[].document_url from the returned URL.
- Use list_documents / get_my_document_link / delete_document (confirm=true) / reextract_document for doc management.
- Once every required section is complete, call save_step with step="submit".
- Offers: get_my_offer to show status; sign_offer only after they clearly accept (agreed=true + full_legal_name); \
decline_offer only with confirm=true.
- list_my_announcements / list_notifications / mark_notifications_read for inbox parity.
- Never invent tool results. Keep replies encouraging and clear about what's next.
- Prefer chaining steps toward completing onboarding when they say "complete my onboarding".
- When a tool needs confirmation, call it without confirm first so the app can show Approve/Cancel — do not ask \
them to type "confirm" as free text if a button will appear.
"""

EMPLOYEE_SYSTEM_PROMPT = """You are the TalentAI Workday Agent for employees. You help with post-hire Complete \
Profile, documents, Learning, Talent (journey/opportunities), and day-to-day profile questions — using only your tools.

Rules:
- Always check get_status first for post-hire steps: emergency, employment (banking), references, documents \
(policies), nda, submit.
- Ask only for missing information; extract free text into save_step payloads.
- Documents: list_documents, get_my_document_link, delete_document (confirm=true), reextract_document; use \
ui_hint upload when a file is needed (cnic/passport/transcript/resume).
- Profile photo: ui_hint {{"type":"upload","doc_type":"photo"}}.
- Bank slip OCR (employment step): ui_hint {{"type":"upload","doc_type":"bank_slip"}} — after OCR results arrive \
in chat, call save_step with the employment/banking fields the person confirms.
- Learning: my_learning_dashboard, browse_learning_catalog, start_course, update_course_progress, bookmarks, \
skills CRUD/assess, career goal/path/gap, recommendations, certificates list/update/delete.
- Certificate file upload: ui_hint {{"type":"upload","doc_type":"certificate","course_title":"<title>","course_uid":"<optional>","source_url":"<optional public URL>"}}. \
After upload the file_url is stored so recruiters can open and verify it — always mention that URL in your reply.
- Talent: my_talent_journey, my_achievements, my_career_progression, list_opportunities, apply_to_opportunity \
(confirm=true).
- Announcements/notifications: list_my_announcements, list_notifications, mark_notifications_read.
- Confirm before destructive actions (delete document/skill/certificate, apply to opportunity) by calling the \
tool without confirm so Approve/Cancel buttons appear.
- Chain tools toward goals (e.g. "continue onboarding", "start my assigned course", "apply to the frontend rotation").
- Never invent tool results. Be clear and action-oriented.
"""

SELF_SERVE_SYSTEM_PROMPT = CANDIDATE_SYSTEM_PROMPT  # backward-compatible alias

# Tool results that the frontend can render as rich cards instead of raw text.
# When one of these was called this turn, we attach its data to the reply so the
# UI never depends on the LLM perfectly re-typing structured data back out.
RENDERABLE_TOOLS = {
    "list_person_documents": "documents",
    "list_candidate_documents": "documents",
    "list_documents": "documents",
    "list_candidates": "candidates",
    "list_employees": "employees",
    "directory_employees": "employees",
    "list_pipeline": "candidates",
    "browse_learning_catalog": "courses",
    "list_opportunities": "opportunities",
    "search_talent": "employees",
    "list_pending_certificates": "certificates",
    "list_my_certificates": "certificates",
    "get_my_offer": "offer",
    "export_employees": "csv_export",
}

DOC_TYPE_CATEGORY = {
    "cnic": "identity",
    "passport": "identity",
    "transcript": "education",
    "resume": "other",
    "photo": "photo",
    "certificate": "certificate",
    "skill_certificate": "other",
    "bank_slip": "banking",
}

CONFIRM_PREFIX = "__CONFIRM__:"

TOOL_STEP_LABELS = {
    "list_pipeline": "Listed hiring pipeline",
    "list_candidates": "Listed candidates",
    "list_employees": "Listed employees",
    "directory_employees": "Opened employee directory",
    "get_candidate_status": "Checked candidate status",
    "get_employee_detail": "Loaded employee detail",
    "list_candidate_documents": "Listed candidate documents",
    "list_documents": "Listed your documents",
    "verify_document": "Verified document",
    "reject_document": "Rejected document",
    "create_offer": "Created offer",
    "approve_offer": "Approved offer",
    "get_status": "Checked onboarding status",
    "save_step": "Saved profile step",
    "get_my_offer": "Loaded offer letter",
    "browse_learning_catalog": "Browsed learning catalog",
    "assign_courses": "Assigned course(s)",
    "search_talent": "Searched talent",
    "list_opportunities": "Listed opportunities",
    "get_dashboard_summary": "Loaded dashboard summary",
    "remind_candidate": "Sent candidate reminder",
    "bulk_remind_candidates": "Sent bulk candidate reminders",
    "bulk_remind_profiles": "Sent profile reminders",
    "export_employees": "Prepared employee export",
    "my_learning_dashboard": "Opened learning dashboard",
    "start_course": "Started course",
    "apply_to_opportunity": "Applied to opportunity",
    "get_my_profile": "Loaded your profile",
}


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


async def _load_or_create_session(user: CurrentUser, session_id: str | None) -> dict:
    if session_id:
        convo = await database.agent_conversations.find_one({"session_id": session_id, "user_id": user.id})
        if convo:
            return convo
    convo = {
        "session_id": session_id or token_urlsafe(16),
        "user_id": user.id,
        "role": user.role,
        "messages": [],
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
    }
    await database.agent_conversations.insert_one(convo)
    return convo


def _compact_params(parameters: dict) -> str:
    """Short param hints for the prompt (keeps token use down)."""
    if not parameters:
        return ""
    bits = []
    for key, hint in parameters.items():
        text = str(hint)
        # Keep only the type / required cue, drop long prose.
        short = text.split(",")[0].strip()
        if len(short) > 40:
            short = short[:37] + "…"
        bits.append(f"{key}:{short}")
    return "{" + ", ".join(bits) + "}"


def _tool_spec_text(role: str) -> str:
    tools = agent_tools.tools_for_role(role)
    lines = []
    for tool in tools:
        desc = (tool.description or "").strip()
        # First sentence only — enough for the model to pick the right tool.
        if ". " in desc:
            desc = desc.split(". ", 1)[0].strip()
        if len(desc) > 120:
            desc = desc[:117] + "…"
        params = _compact_params(tool.parameters or {})
        lines.append(f"- {tool.name}{params}: {desc}")
    return "\n".join(lines)


def _history_text(messages: list[dict]) -> str:
    recent = messages[-HISTORY_TURNS * 2 :]
    lines = []
    for m in recent:
        speaker = "User" if m["role"] == "user" else "Agent"
        content = m.get("content") or ""
        if len(content) > 600:
            content = content[:597] + "…"
        lines.append(f"{speaker}: {content}")
    return "\n".join(lines) if lines else "(no previous messages)"


def _scratchpad_text(scratchpad: list[dict]) -> str:
    if not scratchpad:
        return ""
    lines = []
    for s in scratchpad:
        payload = json.dumps(s.get("result"), default=str)
        if len(payload) > 1200:
            payload = payload[:1197] + "…"
        lines.append(f"Tool `{s['tool']}` result: {payload}")
    return "\n\nObservations so far this turn:\n" + "\n".join(lines)


def _compact_context_value(value: Any, *, limit: int = 6) -> Any:
    if isinstance(value, dict):
        compact: dict[str, Any] = {}
        for key in list(value.keys())[:limit]:
            item = value.get(key)
            if item in (None, "", [], {}):
                continue
            compact[key] = _compact_context_value(item, limit=limit)
        return compact
    if isinstance(value, list):
        return [str(item)[:80] for item in value[:limit] if item not in (None, "")]
    if isinstance(value, (str, int, float, bool)):
        text = str(value)
        return text[:160] if len(text) > 160 else text
    return str(value)


def _context_text(context: dict | None) -> str:
    if not context:
        return "(no additional page context)"

    payload: dict[str, Any] = {}
    for key in ("pathname", "page", "module", "search", "topic"):
        value = context.get(key)
        if value:
            payload[key] = _compact_context_value(value)
    filters = context.get("filters")
    if isinstance(filters, dict) and filters:
        payload["filters"] = _compact_context_value(filters)
    selected_record = context.get("selected_record")
    if isinstance(selected_record, dict) and selected_record:
        payload["selected_record"] = _compact_context_value(selected_record)

    text = json.dumps(payload, default=str, ensure_ascii=True)
    return text if len(text) <= 1200 else text[:1197] + "…"


def _build_prompt(
    user: CurrentUser,
    system_prompt: str,
    tool_spec: str,
    history_text: str,
    scratchpad: list[dict],
    new_message: str,
    context: dict | None,
) -> str:
    scratch_text = _scratchpad_text(scratchpad)
    context_text = _context_text(context)

    return f"""{system_prompt}

Caller: {user.full_name} ({user.email}), role={user.role}.

Current page context:
{context_text}

Available tools (call by exact name):
{tool_spec}

Conversation so far:
{history_text}

New message from caller: {new_message!r}
{scratch_text}

Respond with ONE JSON object only:
1) {{"action":"tool","tool":"<name>","args":{{...}}}}
2) {{"action":"reply","message":"<text>","suggested_replies":["…"],"ui_hint":null}}
suggested_replies: 3–5 chips matching the current topic (candidate vs employee vs bulk); include the person's name when known.
ui_hint for recruiters: {{"type":"spreadsheet"}} for Excel/CSV roster, or {{"type":"upload","doc_type":"photo"}} for profile photo, otherwise null.
ui_hint for candidate/employee: {{"type":"upload","doc_type":"cnic|passport|transcript|resume|photo|certificate|bank_slip"}} \
(for certificate include course_title and optional course_uid)."""


def _action(kind: str, label: str, *, route: str | None = None, prompt: str | None = None) -> dict:
    data = {"kind": kind, "label": label}
    if route:
        data["route"] = route
    if prompt:
        data["prompt"] = prompt
    return data


def _default_actions_for_role(user: CurrentUser) -> list[dict]:
    if user.role in ("recruiter", "super_admin"):
        return [
            _action("navigate", "Open Candidates", route="/dashboard/recruiter/candidates"),
            _action("navigate", "Open Employees", route="/dashboard/recruiter/employees"),
            _action("navigate", "Open Learning", route="/dashboard/recruiter/learning"),
            _action("navigate", "Open Talent", route="/dashboard/recruiter/talent"),
            _action("navigate", "Open Announcements", route="/dashboard/recruiter/announcements"),
        ]
    if user.role == "employee":
        return [
            _action("navigate", "Open Profile", route="/dashboard/employee/profile"),
            _action("navigate", "Open Learning", route="/dashboard/employee/learning"),
            _action("navigate", "Open Complete Profile", route="/dashboard/employee/complete-profile"),
            _action("navigate", "Open Talent", route="/dashboard/employee/talent"),
            _action("navigate", "Open Documents", route="/documents"),
        ]
    return [
        _action("navigate", "Open Dashboard", route="/dashboard/candidate"),
        _action("navigate", "Continue Onboarding", route="/onboarding"),
        _action("navigate", "Open Documents", route="/documents"),
        _action("navigate", "View Offer", route="/offer"),
    ]


def _system_prompt_for_role(role: str) -> str:
    if role in ("recruiter", "super_admin"):
        return RECRUITER_SYSTEM_PROMPT
    if role == "employee":
        return EMPLOYEE_SYSTEM_PROMPT
    return CANDIDATE_SYSTEM_PROMPT


def _detail_actions(user: CurrentUser, scratchpad: list[dict], context: dict | None) -> list[dict]:
    actions = _default_actions_for_role(user)
    selected = (context or {}).get("selected_record") if isinstance(context, dict) else None
    selected_id = None
    selected_kind = None
    if isinstance(selected, dict):
        selected_id = selected.get("employee_id") or selected.get("candidate_id") or selected.get("id")
        selected_kind = selected.get("kind") or selected.get("type")

    for entry in reversed(scratchpad):
        result = entry.get("result") or {}
        if not result.get("ok"):
            continue
        data = result.get("data") or {}
        tool = entry.get("tool")

        if tool == "get_employee_detail" or data.get("employee_id"):
            employee_id = data.get("employee_id") or selected_id
            if employee_id and user.role in ("recruiter", "super_admin"):
                actions = [
                    _action("navigate", f"Open {data.get('full_name') or 'Employee'} Profile", route=f"/dashboard/recruiter/employees/{employee_id}"),
                    _action("navigate", "View Learning", route="/dashboard/recruiter/learning"),
                    _action("navigate", "View Activity", route="/dashboard/recruiter/activity"),
                    _action("navigate", "Open Employees", route="/dashboard/recruiter/employees"),
                ]
            elif employee_id and user.role == "employee":
                actions = [
                    _action("navigate", "Open Profile", route="/dashboard/employee/profile"),
                    _action("navigate", "Open Learning", route="/dashboard/employee/learning"),
                    _action("navigate", "Open Complete Profile", route="/dashboard/employee/complete-profile"),
                ]
            break

        if tool == "get_candidate_status" or data.get("candidate_id"):
            candidate_id = data.get("candidate_id") or selected_id
            if candidate_id and user.role in ("recruiter", "super_admin"):
                label = data.get("full_name") or "Candidate"
                actions = [
                    _action("navigate", f"Open {label} Profile", route=f"/dashboard/recruiter/candidates/{candidate_id}"),
                    _action("navigate", "Open Candidates", route="/dashboard/recruiter/candidates"),
                    _action("navigate", "Open Pipeline", route="/dashboard/recruiter/candidates"),
                    _action("navigate", "Open Employees", route="/dashboard/recruiter/employees"),
                ]
            else:
                actions = [
                    _action("navigate", "Open Profile", route="/dashboard/candidate"),
                    _action("navigate", "Check Onboarding", route="/dashboard/candidate"),
                ]
            break

        if tool in ("list_person_documents", "list_candidate_documents", "list_documents"):
            owner = data.get("owner") or {}
            employee_id = owner.get("employee_id") or data.get("employee_id")
            candidate_id = owner.get("candidate_id") or data.get("candidate_id")
            label = data.get("full_name") or owner.get("full_name") or "Profile"
            if employee_id and user.role in ("recruiter", "super_admin"):
                actions = [
                    _action("navigate", f"Open {label} Profile", route=f"/dashboard/recruiter/employees/{employee_id}"),
                    _action("navigate", "View Learning", route="/dashboard/recruiter/learning"),
                    _action("navigate", "View Activity", route="/dashboard/recruiter/activity"),
                ]
            elif candidate_id and user.role in ("recruiter", "super_admin"):
                actions = [
                    _action("navigate", f"Open {label} Profile", route=f"/dashboard/recruiter/candidates/{candidate_id}"),
                    _action("navigate", "Open Candidates", route="/dashboard/recruiter/candidates"),
                ]
            break

    if selected_id and selected_kind and user.role in ("recruiter", "super_admin"):
        if selected_kind in ("employee", "employees") and not any(a.get("route", "").endswith(f"/employees/{selected_id}") for a in actions):
            actions.insert(0, _action("navigate", "Open selected employee", route=f"/dashboard/recruiter/employees/{selected_id}"))
        if selected_kind in ("candidate", "candidates") and not any(a.get("route", "").endswith(f"/candidates/{selected_id}") for a in actions):
            actions.insert(0, _action("navigate", "Open selected candidate", route=f"/dashboard/recruiter/candidates/{selected_id}"))

    return actions[:4]


def _last_renderable_attachment(scratchpad: list[dict]) -> dict | None:
    """Find the most recent successful call to a RENDERABLE_TOOLS tool this turn."""
    for entry in reversed(scratchpad):
        kind = RENDERABLE_TOOLS.get(entry["tool"])
        result = entry["result"]
        if kind and result.get("ok") and result.get("data"):
            return {"type": kind, "data": result["data"]}
    return None


def _progress_from_scratchpad(scratchpad: list[dict]) -> list[dict]:
    steps: list[dict] = []
    for entry in scratchpad:
        result = entry.get("result") or {}
        data = result.get("data") if isinstance(result.get("data"), dict) else {}
        if data.get("needs_confirm"):
            continue
        tool = entry.get("tool") or ""
        label = TOOL_STEP_LABELS.get(tool) or tool.replace("_", " ").strip().title()
        steps.append({"tool": tool, "ok": bool(result.get("ok")), "label": label})
    return steps


def _confirmation_from_result(tool_name: str, result: agent_tools.ToolResult) -> dict | None:
    data = result.data if isinstance(result.data, dict) else None
    if not data or not data.get("needs_confirm"):
        return None
    return {
        "tool": data.get("tool") or tool_name,
        "args": data.get("args") or {},
        "summary": data.get("summary") or result.error or "Confirm this action?",
    }


def _pack_reply(
    *,
    message: str,
    user: CurrentUser,
    scratchpad: list[dict],
    context: dict | None = None,
    suggested_replies: list | None = None,
    ui_hint: dict | None = None,
    confirmation: dict | None = None,
) -> dict:
    return {
        "message": message,
        "suggested_replies": suggested_replies or [],
        "ui_hint": _sanitize_ui_hint(user, ui_hint),
        "attachment": _last_renderable_attachment(scratchpad),
        "actions": _detail_actions(user, scratchpad, context),
        "progress": _progress_from_scratchpad(scratchpad),
        "confirmation": confirmation,
    }


async def _save_messages(session_id: str, user_id: str, new_msgs: list[dict]) -> None:
    await database.agent_conversations.update_one(
        {"session_id": session_id, "user_id": user_id},
        {"$push": {"messages": {"$each": new_msgs}}, "$set": {"updated_at": datetime.now(UTC)}},
    )


async def _fallback_reply(user: CurrentUser, context: dict | None = None) -> dict:
    """Deterministic response used only when no LLM key is configured."""
    status_tool = "get_status" if user.role in ("candidate", "employee") else "list_candidates"
    result = await agent_tools.run_tool(user, status_tool, {})
    if not result.ok:
        return {
            "message": "I couldn't fetch your status right now — please try the dashboard directly, or try again shortly.",
            "suggested_replies": [],
            "actions": _default_actions_for_role(user),
            "ui_hint": None,
        }
    if user.role in ("candidate", "employee"):
        data = result.data
        missing = data.get("missing_sections") or data.get("missing_fields") or []
        if missing:
            msg = f"You still need to complete: {', '.join(missing)}. Tell me the details and I'll fill them in, or upload any required documents."
        else:
            msg = "You're all caught up! Nothing outstanding right now."
        return {"message": msg, "suggested_replies": [], "actions": _default_actions_for_role(user), "ui_hint": None}
    data = result.data
    msg = f"You have {data.get('count', 0)} candidates on file. Tell me who to invite, or paste a list to send multiple invitations."
    return {"message": msg, "suggested_replies": [], "actions": _default_actions_for_role(user), "ui_hint": None}


def _sanitize_ui_hint(user: CurrentUser, ui_hint: dict | None) -> dict | None:
    """Keep ui_hints role-safe. Recruiters must not get candidate document upload hints."""
    if not ui_hint or not isinstance(ui_hint, dict):
        return None
    hint_type = str(ui_hint.get("type") or "").strip().lower()
    doc_type = str(ui_hint.get("doc_type") or "").strip().lower()

    if user.role in ("recruiter", "super_admin"):
        if hint_type in ("spreadsheet", "sheet", "excel", "csv"):
            return {"type": "spreadsheet"}
        if hint_type == "upload" and doc_type in (
            "spreadsheet",
            "excel",
            "xlsx",
            "csv",
            "roster",
            "bulk_invite",
        ):
            return {"type": "spreadsheet"}
        if hint_type == "upload" and doc_type == "photo":
            return {"type": "upload", "doc_type": "photo", "category": "photo"}
        # Recruiter must never hit /api/documents/upload (candidate/employee only).
        return None

    allowed = set(DOC_TYPE_CATEGORY.keys())
    if user.role == "candidate":
        allowed = {"cnic", "passport", "transcript", "resume", "certificate", "skill_certificate"}
    elif user.role == "employee":
        allowed = set(DOC_TYPE_CATEGORY.keys()) | {"skill_certificate"}

    if hint_type == "upload" and doc_type in allowed:
        # Candidates store cert file URL on skills.certifications.document_url
        if user.role == "candidate" and doc_type in ("certificate", "skill_certificate"):
            out_type = "skill_certificate"
        elif doc_type == "skill_certificate":
            out_type = "certificate"
        else:
            out_type = doc_type
        hint = {
            "type": "upload",
            "doc_type": out_type,
            "category": ui_hint.get("category")
            or DOC_TYPE_CATEGORY.get(doc_type)
            or DOC_TYPE_CATEGORY.get(out_type, "other"),
        }
        if out_type in ("certificate", "skill_certificate"):
            title = (ui_hint.get("course_title") or ui_hint.get("title") or ui_hint.get("cert_name") or "").strip()
            if title:
                hint["course_title"] = title
            course_uid = (ui_hint.get("course_uid") or "").strip()
            if course_uid:
                hint["course_uid"] = course_uid
            source_url = (ui_hint.get("source_url") or "").strip()
            if source_url:
                hint["source_url"] = source_url
        return hint
    return None


class AgentService:
    async def chat(self, user: CurrentUser, message: str, session_id: str | None, context: dict | None = None) -> dict:
        message = (message or "").strip()
        convo = await _load_or_create_session(user, session_id)
        sid = convo["session_id"]

        is_confirm = message.startswith(CONFIRM_PREFIX)
        if is_confirm:
            reply = await self._run_confirm_action(user, message[len(CONFIRM_PREFIX) :], context)
            display_user = "Approved."
        elif not llm_configured():
            reply = await _fallback_reply(user, context)
            display_user = message
        else:
            reply = await self._run_llm_loop(user, convo, message, context)
            display_user = message

        pending_to_save: list[dict] = []
        if display_user:
            pending_to_save.append({"role": "user", "content": display_user, "created_at": _now_iso()})

        ui_hint = _sanitize_ui_hint(user, reply.get("ui_hint"))
        assistant_msg = {
            "role": "assistant",
            "content": reply["message"],
            "created_at": _now_iso(),
            "meta": {
                "ui_hint": ui_hint,
                "suggested_replies": reply.get("suggested_replies") or [],
                "actions": reply.get("actions") or [],
                "attachment": reply.get("attachment"),
                "progress": reply.get("progress") or [],
                "confirmation": reply.get("confirmation"),
            },
        }
        pending_to_save.append(assistant_msg)
        if pending_to_save:
            await _save_messages(sid, user.id, pending_to_save)

        all_messages = (convo.get("messages") or []) + pending_to_save
        return {
            "session_id": sid,
            "reply": reply["message"],
            "messages": all_messages[-40:],
            "suggested_replies": reply.get("suggested_replies") or [],
            "actions": reply.get("actions") or [],
            "ui_hint": ui_hint,
            "attachment": reply.get("attachment"),
            "progress": reply.get("progress") or [],
            "confirmation": reply.get("confirmation"),
        }

    async def _run_confirm_action(self, user: CurrentUser, raw: str, context: dict | None = None) -> dict:
        scratchpad: list[dict] = []
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return _pack_reply(
                message="That confirmation payload was invalid — please try again from the chat buttons.",
                user=user,
                scratchpad=scratchpad,
                context=context,
            )
        tool_name = (payload.get("tool") or "").strip()
        args = payload.get("args") if isinstance(payload.get("args"), dict) else {}
        if not tool_name:
            return _pack_reply(
                message="Missing tool name in confirmation.",
                user=user,
                scratchpad=scratchpad,
                context=context,
            )
        args = {**args, "confirm": True}
        result = await agent_tools.run_tool(user, tool_name, args)
        scratchpad.append({"tool": tool_name, "result": result.to_json()})
        if result.ok:
            data = result.data if isinstance(result.data, dict) else {}
            done_msg = data.get("message") or f"Done — {tool_name.replace('_', ' ')} completed."
            return _pack_reply(
                message=str(done_msg),
                user=user,
                scratchpad=scratchpad,
                context=context,
                suggested_replies=["What's next?", "Show my status"],
            )
        return _pack_reply(
            message=result.error or "That action could not be completed.",
            user=user,
            scratchpad=scratchpad,
            context=context,
        )

    async def _run_llm_loop(self, user: CurrentUser, convo: dict, message: str, context: dict | None = None) -> dict:
        system_prompt = _system_prompt_for_role(user.role)
        tool_spec = _tool_spec_text(user.role)
        history_text = _history_text(convo.get("messages") or [])
        scratchpad: list[dict] = []

        for _ in range(MAX_TOOL_STEPS):
            prompt = _build_prompt(user, system_prompt, tool_spec, history_text, scratchpad, message, context)
            parsed = await call_llm_json(prompt, max_tokens=1200, temperature=0.2)
            if not parsed:
                return _pack_reply(
                    message="I'm having trouble reaching the AI service right now — please try again in a moment.",
                    user=user,
                    scratchpad=scratchpad,
                    context=context,
                )

            action = parsed.get("action")
            if action == "tool":
                tool_name = parsed.get("tool")
                args = parsed.get("args") or {}
                result = await agent_tools.run_tool(user, tool_name, args)
                scratchpad.append({"tool": tool_name, "result": result.to_json()})
                confirmation = _confirmation_from_result(tool_name or "", result)
                if confirmation:
                    return _pack_reply(
                        message=confirmation["summary"],
                        user=user,
                        scratchpad=scratchpad,
                        context=context,
                        suggested_replies=[],
                        confirmation=confirmation,
                    )
                continue

            if action == "reply":
                return _pack_reply(
                    message=(parsed.get("message") or "").strip() or "Done.",
                    user=user,
                    scratchpad=scratchpad,
                    context=context,
                    suggested_replies=parsed.get("suggested_replies") or [],
                    ui_hint=parsed.get("ui_hint"),
                )

            # Unrecognized shape — treat whatever text we got as the reply.
            return _pack_reply(
                message=parsed.get("message") or "I didn't quite catch that — could you rephrase?",
                user=user,
                scratchpad=scratchpad,
                context=context,
            )

        return _pack_reply(
            message="I gathered the information but need one more detail from you to finish — could you confirm and try again?",
            user=user,
            scratchpad=scratchpad,
            context=context,
        )

    async def get_history(self, user: CurrentUser, session_id: str) -> dict:
        convo = await database.agent_conversations.find_one({"session_id": session_id, "user_id": user.id})
        if not convo:
            return {"session_id": session_id, "messages": []}
        return {"session_id": session_id, "messages": convo.get("messages", [])}

    async def list_sessions(self, user: CurrentUser) -> dict:
        cursor = database.agent_conversations.find({"user_id": user.id}).sort("updated_at", -1).limit(10)
        docs = await cursor.to_list(length=10)
        return {
            "sessions": [
                {
                    "session_id": d["session_id"],
                    "updated_at": d.get("updated_at").isoformat() if d.get("updated_at") else None,
                    "preview": (d.get("messages") or [{}])[-1].get("content", "")[:120],
                }
                for d in docs
            ]
        }


agent_service = AgentService()
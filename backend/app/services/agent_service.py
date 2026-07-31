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
import re
from datetime import UTC, datetime
from secrets import token_urlsafe
from typing import Any

from app.core.database import database
from app.core.rbac import CurrentUser
from app.services import agent_tools
from app.services.llm_service import call_llm_json, llm_configured

MAX_TOOL_STEPS = 4
HISTORY_TURNS = 8

# Read-only tools — calling them more than once in a single turn wastes steps.
READONLY_TOOLS = frozenset({
    "get_status",
    "get_my_offer",
    "get_my_profile",
    "list_documents",
    "list_candidate_documents",
    "list_person_documents",
    "list_candidates",
    "list_employees",
    "get_candidate_status",
    "get_employee_detail",
    "get_dashboard_summary",
    "my_learning_dashboard",
    "list_opportunities",
    "list_my_announcements",
    "list_notifications",
    "list_hr_threads",
    "get_my_day1_info",
})

# Shared across every role — keeps behavior consistent without per-role copy/paste.
SHARED_AGENT_RULES = """
Shared behavior (all roles):
- Never re-ask for facts already in Conversation so far or the latest user message — extract them into tool args.
- When a tool returns ok=false, read the error, fix the args from known chat data, and retry. Do not ask the user to repeat the same info.
- Prefer one tool call that saves everything you already have over multiple clarifying questions.
- Only ask for fields that get_status (or the tool error) still lists as missing.
- Keep JSON compact: short message, at most 3 short suggested_replies, ui_hint only when an upload/spreadsheet is needed.
- Never call the same read-only tool (get_status, get_my_offer, list_documents, etc.) more than once per turn — after you have the data, reply or call a write tool.
- Stay in-role: candidates only use candidate tools; employees only employee tools; recruiters only recruiter tools. Never imply verify/reject of someone else's documents unless you are a recruiter.
- When the user uploads a file and the message includes OCR extracted fields JSON, immediately persist them with the right write tool (update_my_profile / save_step / employment fields) — do not ignore OCR data.
- Be context-aware: if they ask about offer/profile/documents/learning/messages, acknowledge the current state from tools. The app attaches one clear button when needed — do not list pages or dump every option.
- Never write raw routes or paths in the message (no /offer, /onboarding, /documents, offer_page=, or "open page offer"). Say natural language only, e.g. "Your offer is already signed — use the button below to view it."
- Never contradict tool data (e.g. if is_signed=true, do not say they still need to sign).
"""

RECRUITER_SYSTEM_PROMPT = """You are the TalentAI Hiring Agent for recruiters. You can run almost any \
recruiting or post-hire action the recruiter dashboard supports — for one person or in bulk — via your tools. \
You are precise, proactive, and never invent data you were not given or that a tool did not return.

Greetings & capability talk (critical):
- On hellos / "what can you do?", do NOT list a short fixed menu that makes it sound like you only do a few things.
- Keep greetings open: you help with candidates and employees end-to-end (invite, pipeline, offers, activation, \
documents, joining letters, profile reminders, Day-1 email/assets/orientation, career events, search, activity, \
announcements, Learning catalog/assign/verify certificates, Talent search/opportunities/competency, \
employee HR messaging) — one person or many at once. Before inviting, use lookup_person_history for emails that may \
belong to prior candidates or exited employees and surface matching historical cycles (resigned tenures + prior \
conversion cycles for rehire; do NOT recommend converted people who are still active employees as new candidates). \
Same-email reinvite starts a new candidate cycle; reconversion always gets a NEW employee_id. Converted candidates \
are employees (active or historical), never historical candidates.
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
- When the recruiter asks to show candidates, show only active candidates; converted people are employees and \
should be shown via list_employees or get_candidate_status instead.
- If the talk is about an EMPLOYEE (post-hire): suggest employee actions only, e.g. profile progress, remind \
Complete Profile, set company email, assign asset, schedule orientation, career event, list documents, assign \
course, competency evaluation, HR message reply.
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
- Dates can be interpreted relatively in plain language (tomorrow, today, next Monday, in 3 days); convert them to a clear YYYY-MM-DD date before calling a tool that needs one.
- When the user asks to act on everyone / all incomplete / all signed offers / a pasted list, prefer the \
bulk_* tools (bulk_invite, bulk_approve_offers, bulk_remind_profiles, bulk_remind_candidates, \
bulk_assign_assets, bulk_schedule_orientation, bulk_set_company_email, bulk_verify_documents). Cap is handled by tools.
- When a user pastes a list of candidates (from chat or a spreadsheet already parsed for you), use bulk_invite \
only if every person has email, full_name, job_title/designation, department, reporting_manager, start_date, \
and monthly_salary (same as Create invitation / Bulk Excel). Prefer directing recruiters to \
/dashboard/recruiter/invite → Bulk Excel for template + history review; bulk_invite without offer fields will fail.
If any required field is missing, do NOT call bulk_invite and do NOT invent values like "Not specified" — \
list what is missing and ask the recruiter to provide the missing offer fields.
- For Excel/CSV bulk invite: prefer /dashboard/recruiter/invite → Bulk Excel (history preview + selective send). \
Chat paperclip still works if every row has full offer columns. ui_hint {{"type": "spreadsheet"}} shows upload. \
NEVER use ui_hint type "upload". Required columns: email, full_name, job_title, department, reporting_manager, \
start_date, monthly_salary (optional: office_location, currency, benefits).
- After a tool call, summarize plainly what happened (who was invited/offered/notified/activated), including \
any failures. For bulk ops, report counts: succeeded / failed / skipped.
- Keep replies concise and action-oriented.
- NEVER say you sent an email, reminder, or notification unless a tool result explicitly has email_sent=true \
or notification_sent=true (or emailed/notified counts > 0 for announcements). If either flag is false, say so \
clearly and include email_error when present.

Profile / onboarding status (critical):
- Pre-hire candidate onboarding (personal, education, skills, government docs, resume) is NOT the same as \
post-hire employee Complete Profile (emergency contact, banking, references, policies, Self Declaration).
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
  Activation requires IT provisioning (company email + assets) to be submitted first; if blocked, tell the recruiter to send/remind IT.

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
- Typical hiring flow: invite candidate WITH offer letter (Invite page) → candidate signs \
(or one-round negotiate → v2) → documents → IT provisioning → approve_offer / activate.
- Do NOT tell recruiters to send a separate offer after documents; invitation includes the offer.
- create_offer is only for resending to an existing candidate who declined/expired.

Day-1:
- Company email and assets are provisioned by IT before activation and shown read-only on Day-1.
  Prefer explaining that status over set_company_email / assign_asset. Use schedule_orientation / \
bulk_schedule_orientation for recruiter orientation. For legacy assign_asset, identify the person by email or \
employee_id — `name` means the asset name.
- update_employee_role changes designation/department.

Learning & Talent:
- browse_learning_catalog → assign_courses; list_learning_assignments; list_pending_certificates → \
verify_certificate (open certificate_url/file_url first); learning_analytics; KB role/cert CRUD tools.
- talent_metrics, search_talent, create/update_opportunity, list_opportunity_applicants, \
submit_competency_evaluation, update_development_plan, get_talent_profile.

Reminders & HR messages:
- send_reminder (kind + note) for employee or candidate nudges (email + notification).
- list_hr_threads / reply_hr_thread / message_employee for the employee ↔ HR inbox \
(replies also email the other side). Prefer list_hr_threads before replying.

Announcements:
- create_announcement / update_announcement / delete_announcement (delete needs confirm=true).
"""

CANDIDATE_SYSTEM_PROMPT = """You are the TalentAI Onboarding Agent for candidates. You help them complete \
pre-hire intake, manage documents, and review/sign or decline their offer letter — using only your tools.

Rules:
- Always check get_status first if you don't already know the current step. Candidate steps: personal, \
education, skills, submit (plus uploaded government_docs / resume).
- Ask only for information still missing — never re-ask for something already saved.
- Profile field updates — CRITICAL routing rule:
  * When the candidate provides ANY personal-info field (first_name, last_name, gender, date_of_birth, \
nationality, marital_status, blood_group, father_name, alternate_phone, current_address, permanent_address, \
same_as_current, city, state, postal_code, country) — even a single field — call update_my_profile \
IMMEDIATELY with only the fields they provided. Never wait to collect all fields before saving.
  * update_my_profile is a safe partial merge: it never overwrites fields the candidate did not mention \
and never requires a government ID or signed offer to be present.
  * Only call save_step for step=personal when you already have ALL of: first_name, last_name, \
date_of_birth, gender, nationality, marital_status, father_name, blood_group (any value including N/A is \
valid — it is required that the user explicitly provide it), national_id, \
current_address, permanent_address (or same_as_current=true), city, state, postal_code, country — AND a \
government_docs upload is on file. If any of those are missing, use update_my_profile to persist what you \
have and ask for the rest. father_name and blood_group are REQUIRED — do not skip them. \
"N/A" is a valid answer for blood_group if the candidate does not know or prefers not to share.
  * For education: call save_step step=education only when at least one complete education entry exists.
  * For skills: call save_step step=skills when you have at least one skill/language/certification AND a \
resume file is on file (resume_file_on_file from get_status). Always include resume.summary or summary with \
≥20 characters of professional summary text taken from the chat (or invent a short dummy only if they \
explicitly asked for a dummy summary). Never invent a separate "summary" step.
  * If resume_summary_ready is false, pass the summary together with skills in the same save_step call — \
do not save skills alone then re-ask for the summary if they already wrote it.
- Document awareness — CRITICAL: get_status returns documents_on_file (list of doc_type strings already \
uploaded by the candidate). Before requesting ANY file upload, check documents_on_file:
  * If a doc_type is already in documents_on_file, acknowledge it ("I can see your CNIC is already on \
file.") and do NOT request another upload for that type.
  * Only request an upload when the doc_type is genuinely absent from documents_on_file.
  * This applies to every doc type: cnic, passport, resume, transcript, certificate, skill_certificate.
  * If the candidate says they already uploaded a document, call get_status to refresh and verify before \
asking again.
- Documents must be uploaded as files — whenever a file is genuinely missing, include ui_hint type "upload" \
with the correct doc_type so the Upload button appears in chat. Use these mappings:
  * CNIC / National ID: {{"type":"upload","doc_type":"cnic"}}
  * Passport: {{"type":"upload","doc_type":"passport"}}
  * Academic Transcript / degree certificate: {{"type":"upload","doc_type":"transcript"}}
  * Resume / CV: {{"type":"upload","doc_type":"resume"}}
  * Skill certificate (for a named course): {{"type":"upload","doc_type":"skill_certificate","course_title":"<name>"}}
  Never ask the candidate to navigate to a different page to upload — always emit the ui_hint so they can \
upload directly in this chat.
- After a resume upload the agent will automatically send "I've uploaded my resume." — no extra action needed.
- After a transcript upload the agent will automatically send "I've uploaded my academic transcript." — no extra action needed.
- After a skill certificate upload the returned document_url is sent back automatically — call save_step skills \
including certifications[].document_url from that URL.
- Use list_documents / get_my_document_link / delete_document (confirm=true) / reextract_document for doc management.
- Candidates never verify/reject documents — that is recruiter-only. If docs show mismatch or reupload_required, \
explain the status and offer a ui_hint upload so they can replace the file.
- Once every required section is complete, call save_step with step="submit".
- Offers: ALWAYS call get_my_offer first when the topic is the offer. Read is_signed / status / guidance.
  * If is_signed=true (or status=signed): say it is already signed, never ask for a signature pad, \
never call sign_offer. Do not paste routes — the offer card/button opens the letter.
  * If not signed: they can review via the offer button, or you may call sign_offer only after they clearly accept \
(agreed=true + full_legal_name). Typed legal name is enough — do NOT invent a signature-pad UI in chat.
  * decline_offer only with confirm=true.
- When discussing profile/onboarding/documents/offer, use plain names ("onboarding form", "documents", "offer letter") — never URLs or /paths.
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
(policies), Self Declaration, submit.
- Ask only for missing information; extract free text into save_step payloads.
- Document awareness — CRITICAL: get_status returns documents_on_file (list of doc_type strings already \
uploaded). Before requesting ANY file upload, check documents_on_file:
  * If a doc_type is already in documents_on_file, acknowledge it ("I can see your CNIC is already on \
file.") and do NOT request another upload for that type.
  * Only request an upload when the doc_type is genuinely absent from documents_on_file.
  * If the employee says they already uploaded a document, call get_status to refresh and verify before \
asking again.
- Banking awareness — CRITICAL: get_status returns is_remote and banking_managed_by.
  * If banking_managed_by is "recruiter" (on-site employee), do NOT ask the employee for banking \
details — they are entered by HR. Explain that their recruiter manages payroll banking.
  * Only guide the employee through the employment (banking) step when banking_managed_by is "employee" \
(remote employee).
- Documents: list_documents (supports optional status/category filters), get_my_document_link, \
delete_document (confirm=true), reextract_document; use ui_hint upload when a file is needed \
(cnic/passport/transcript/resume).
- Profile photo: ui_hint {{"type":"upload","doc_type":"photo"}}.
- Bank slip OCR (employment step, remote employees only): ui_hint {{"type":"upload","doc_type":"bank_slip"}} \
— after OCR results arrive in chat, call save_step with the employment/banking fields the person confirms.
- Learning: my_learning_dashboard, browse_learning_catalog, start_course, update_course_progress, bookmarks, \
skills CRUD/assess, career goal/path/gap, recommendations, certificates list/update/delete.
- Certificate file upload: ui_hint {{"type":"upload","doc_type":"certificate","course_title":"<title>","course_uid":"<optional>","source_url":"<optional public URL>"}}. \
After upload the file_url is stored so recruiters can open and verify it — always mention that URL in your reply.
- Talent: my_talent_journey, my_achievements, my_career_progression, list_opportunities, apply_to_opportunity \
(confirm=true), get_role_matches (shows how employee skills match recruiter KB roles).
- Day-1 info: get_my_day1_info — shows assigned company assets and scheduled orientation. Use this when \
the employee asks about their assets, laptop, badge, orientation, or first day details.
- Message HR: list_hr_threads, message_recruiter (new or continue), reply_hr_thread, \
close_hr_thread (confirm=true) — each message emails HR too.
- Announcements/notifications: list_my_announcements, list_notifications, mark_notifications_read.
- Confirm before destructive actions (delete document/skill/certificate, apply to opportunity, close thread) \
by calling the tool without confirm so Approve/Cancel buttons appear.
- Chain tools toward goals (e.g. "continue onboarding", "start my assigned course", "apply to the frontend rotation", \
"message HR about my documents").
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
    "sign_offer": "offer",
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
    "send_reminder": "Sent reminder",
    "list_hr_threads": "Listed HR message threads",
    "reply_hr_thread": "Replied to HR message",
    "message_recruiter": "Sent message to HR",
    "message_employee": "Sent message to employee",
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
        # Keep enough of user text so skills/summaries aren't lost across turns.
        limit = 500 if m["role"] == "user" else 300
        if len(content) > limit:
            content = content[: limit - 3] + "…"
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
{SHARED_AGENT_RULES}
Caller: {user.full_name} ({user.email}), role={user.role}.

Current page context:
{context_text}

Available tools (call by exact name):
{tool_spec}

Conversation so far:
{history_text}

New message from caller: {new_message!r}
{scratch_text}

Respond with ONE compact JSON object only (no markdown, no prose outside JSON):
1) {{"action":"tool","tool":"<name>","args":{{...}}}}
2) {{"action":"reply","message":"<text>","suggested_replies":["…"],"ui_hint":null}}
Keep message under ~400 chars. suggested_replies: 2–4 short chips. Prefer a tool call over a long reply when saving data.
For save_step: step must be a real step from get_status; put fields under that step key (e.g. personal/education/skills) — never invent a "summary" step.
If the user asks for a "summary" (candidate), pass it as resume.summary / summary with skills on step=skills.
ui_hint for recruiters: {{"type":"spreadsheet"}} for Excel/CSV roster, or {{"type":"upload","doc_type":"photo"}} for profile photo, otherwise null.
ui_hint for candidate/employee: {{"type":"upload","doc_type":"cnic|passport|transcript|resume|photo|certificate|bank_slip"}} \
(for certificate include course_title and optional course_uid).
IMPORTANT: Your entire response must be that JSON object. Do not write analysis or planning text."""


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
            _action("navigate", "Open Messages", route="/dashboard/recruiter/messages"),
        ]
    if user.role == "employee":
        return [
            _action("navigate", "Open Profile", route="/dashboard/employee/profile"),
            _action("navigate", "Complete Profile", route="/dashboard/employee/complete-profile"),
            _action("navigate", "Open Learning", route="/dashboard/employee/learning"),
            _action("navigate", "Message HR", route="/dashboard/employee/messages"),
        ]
    return [
        _action("navigate", "Continue Onboarding", route="/onboarding"),
        _action("navigate", "Open Documents", route="/documents"),
        _action("navigate", "View Offer", route="/offer"),
        _action("navigate", "Open Dashboard", route="/dashboard/candidate"),
    ]


def _topic_text(*parts: str) -> str:
    return " ".join(str(p or "") for p in parts).lower()


def _actions_from_topic(user: CurrentUser, topic: str) -> list[dict] | None:
    """One primary navigate CTA matching the topic — never a full menu of identical pills."""
    t = topic or ""
    if user.role in ("recruiter", "super_admin"):
        if any(k in t for k in ("candidate", "pipeline", "invite", "offer")):
            return [_action("navigate", "Open Candidates", route="/dashboard/recruiter/candidates")]
        if any(k in t for k in ("employee", "day-1", "day1", "joining", "asset")):
            return [_action("navigate", "Open Employees", route="/dashboard/recruiter/employees")]
        if any(k in t for k in ("learning", "course", "certificate")):
            return [_action("navigate", "Open Learning", route="/dashboard/recruiter/learning")]
        if any(k in t for k in ("talent", "opportunity", "competenc")):
            return [_action("navigate", "Open Talent", route="/dashboard/recruiter/talent")]
        if any(k in t for k in ("message", "inbox", "announcement")):
            return [_action("navigate", "Open Messages", route="/dashboard/recruiter/messages")]
        return None

    if user.role == "employee":
        if any(k in t for k in ("learning", "course", "certificate", "skill")):
            return [_action("navigate", "Open Learning", route="/dashboard/employee/learning")]
        if any(k in t for k in ("talent", "opportunity", "career", "rotation")):
            return [_action("navigate", "Open Talent", route="/dashboard/employee/talent")]
        if any(k in t for k in ("message", "hr", "recruiter", "inbox")):
            return [_action("navigate", "Message HR", route="/dashboard/employee/messages")]
        if any(k in t for k in ("document", "upload", "cnic", "resume", "bank")):
            return [_action("navigate", "Open Documents", route="/documents")]
        if any(k in t for k in ("profile", "onboarding", "complete", "emergency", "banking", "reference")):
            return [_action("navigate", "Complete Profile", route="/dashboard/employee/complete-profile")]
        return None

    # candidate — one button for the active topic
    if any(k in t for k in ("offer", "sign", "salary", "letter", "accept", "decline")):
        return [_action("navigate", "View offer", route="/offer")]
    if any(k in t for k in ("document", "upload", "cnic", "resume", "transcript", "passport")):
        return [_action("navigate", "Open documents", route="/documents")]
    if any(k in t for k in ("profile", "onboarding", "personal", "education", "skills", "summary", "fill")):
        return [_action("navigate", "Open onboarding", route="/onboarding")]
    if any(k in t for k in ("message", "hr", "recruiter")):
        return [_action("navigate", "Open dashboard", route="/dashboard/candidate")]
    return None


def _system_prompt_for_role(role: str) -> str:
    if role in ("recruiter", "super_admin"):
        return RECRUITER_SYSTEM_PROMPT
    if role == "employee":
        return EMPLOYEE_SYSTEM_PROMPT
    return CANDIDATE_SYSTEM_PROMPT


def _detail_actions(
    user: CurrentUser,
    scratchpad: list[dict],
    context: dict | None,
    *,
    user_message: str = "",
    reply_message: str = "",
) -> list[dict]:
    """At most one primary navigate CTA for this turn — avoid repeating the same pill row."""
    selected = (context or {}).get("selected_record") if isinstance(context, dict) else None
    selected_id = None
    selected_kind = None
    if isinstance(selected, dict):
        selected_id = selected.get("employee_id") or selected.get("candidate_id") or selected.get("id")
        selected_kind = selected.get("kind") or selected.get("type")

    attachment = _last_renderable_attachment(scratchpad)
    attachment_type = (attachment or {}).get("type") if isinstance(attachment, dict) else None

    for entry in reversed(scratchpad):
        result = entry.get("result") or {}
        if not result.get("ok"):
            continue
        data = result.get("data") or {}
        tool = entry.get("tool")

        if tool in ("get_my_offer", "sign_offer"):
            # Offer card already has "View signed offer" / "Review & sign" — no duplicate chip.
            if attachment_type == "offer":
                return []
            offer = data.get("offer") if isinstance(data.get("offer"), dict) else data
            status = str(data.get("status") or (offer or {}).get("status") or "").lower()
            is_signed = bool(data.get("is_signed") or data.get("already_signed") or status == "signed")
            label = "View signed offer" if is_signed else "Review & sign offer"
            return [_action("navigate", label, route="/offer")]

        if tool in ("get_status", "save_step", "update_my_profile"):
            if user.role == "candidate":
                return [_action("navigate", "Open onboarding", route="/onboarding")]
            if user.role == "employee":
                return [_action("navigate", "Complete Profile", route="/dashboard/employee/complete-profile")]

        if tool == "get_my_profile" and user.role == "employee":
            return [_action("navigate", "Open Profile", route="/dashboard/employee/profile")]

        if tool == "get_employee_detail" or data.get("employee_id"):
            employee_id = data.get("employee_id") or selected_id
            if employee_id and user.role in ("recruiter", "super_admin"):
                return [
                    _action(
                        "navigate",
                        f"Open {data.get('full_name') or 'employee'}",
                        route=f"/dashboard/recruiter/employees/{employee_id}",
                    )
                ]
            if user.role == "employee":
                return [_action("navigate", "Open Profile", route="/dashboard/employee/profile")]

        if tool == "get_candidate_status" or data.get("candidate_id"):
            candidate_id = data.get("candidate_id") or selected_id
            if candidate_id and user.role in ("recruiter", "super_admin"):
                label = data.get("full_name") or "candidate"
                return [
                    _action(
                        "navigate",
                        f"Open {label}",
                        route=f"/dashboard/recruiter/candidates/{candidate_id}",
                    )
                ]
            if user.role == "candidate":
                return [_action("navigate", "Open onboarding", route="/onboarding")]

        if tool in ("list_person_documents", "list_candidate_documents", "list_documents"):
            owner = data.get("owner") or {}
            employee_id = owner.get("employee_id") or data.get("employee_id")
            candidate_id = owner.get("candidate_id") or data.get("candidate_id")
            label = data.get("full_name") or owner.get("full_name") or "profile"
            if employee_id and user.role in ("recruiter", "super_admin"):
                return [
                    _action(
                        "navigate",
                        f"Open {label}",
                        route=f"/dashboard/recruiter/employees/{employee_id}",
                    )
                ]
            if candidate_id and user.role in ("recruiter", "super_admin"):
                return [
                    _action(
                        "navigate",
                        f"Open {label}",
                        route=f"/dashboard/recruiter/candidates/{candidate_id}",
                    )
                ]
            if user.role in ("candidate", "employee"):
                return [_action("navigate", "Open documents", route="/documents")]

        if tool in ("my_learning_dashboard", "browse_learning_catalog", "start_course"):
            if user.role == "employee":
                return [_action("navigate", "Open Learning", route="/dashboard/employee/learning")]
            if user.role in ("recruiter", "super_admin"):
                return [_action("navigate", "Open Learning", route="/dashboard/recruiter/learning")]

    topic = _topic_text(user_message, reply_message)
    topic_actions = _actions_from_topic(user, topic)
    if topic_actions:
        # Avoid duplicating the offer card link.
        if attachment_type == "offer":
            topic_actions = [a for a in topic_actions if a.get("route") != "/offer"]
        return topic_actions[:1]

    # No generic default pill row — empty is better than the same four buttons every turn.
    if selected_id and selected_kind and user.role in ("recruiter", "super_admin"):
        if selected_kind in ("employee", "employees"):
            return [
                _action(
                    "navigate",
                    "Open selected employee",
                    route=f"/dashboard/recruiter/employees/{selected_id}",
                )
            ]
        if selected_kind in ("candidate", "candidates"):
            return [
                _action(
                    "navigate",
                    "Open selected candidate",
                    route=f"/dashboard/recruiter/candidates/{selected_id}",
                )
            ]
    return []


def _sanitize_reply_message(message: str) -> str:
    """Replace raw app routes the model pastes with natural wording."""
    if not message:
        return message
    cleaned = message
    replacements = (
        (r"\s*offer_page\s*=\s*/?offer\b", " the offer letter"),
        (r"\s*\(\s*/offer\s*\)", ""),
        (r"\s*\[\s*/offer\s*\]", ""),
        (r"(?<![A-Za-z0-9])/offer\b", " the offer letter"),
        (r"\s*\(\s*/onboarding\s*\)", ""),
        (r"(?<![A-Za-z0-9])/onboarding\b", " the onboarding form"),
        (r"\s*\(\s*/documents\s*\)", ""),
        (r"(?<![A-Za-z0-9])/documents\b", " the documents page"),
        (r"\s*\(\s*/dashboard/[\w/-]+\s*\)", ""),
        (r"(?<![A-Za-z0-9])/dashboard/[\w/-]+", " the dashboard"),
    )
    for pattern, repl in replacements:
        cleaned = re.sub(pattern, repl, cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r" +\n", "\n", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    cleaned = re.sub(r"\s+([.,!?])", r"\1", cleaned)
    return cleaned.strip()


def _last_renderable_attachment(scratchpad: list[dict]) -> dict | None:
    """Find the most recent successful call to a RENDERABLE_TOOLS tool this turn."""
    for entry in reversed(scratchpad):
        kind = RENDERABLE_TOOLS.get(entry["tool"])
        result = entry["result"]
        if kind and result.get("ok") and result.get("data"):
            return {"type": kind, "data": result["data"]}
    return None


def _progress_from_scratchpad(scratchpad: list[dict]) -> list[dict]:
    """Collapse duplicate tool labels so the UI doesn't show 'Loaded offer' x3."""
    steps: list[dict] = []
    seen_readonly: set[str] = set()
    for entry in scratchpad:
        result = entry.get("result") or {}
        data = result.get("data") if isinstance(result.get("data"), dict) else {}
        if data.get("needs_confirm"):
            continue
        tool = entry.get("tool") or ""
        if tool in READONLY_TOOLS:
            if tool in seen_readonly:
                continue
            seen_readonly.add(tool)
        label = TOOL_STEP_LABELS.get(tool) or tool.replace("_", " ").strip().title()
        steps.append({"tool": tool, "ok": bool(result.get("ok")), "label": label})
    return steps


def _message_from_scratchpad(scratchpad: list[dict]) -> str | None:
    """Build a user-facing summary when the LLM dies after tools already ran."""
    if not scratchpad:
        return None
    lines: list[str] = []
    for entry in scratchpad:
        result = entry.get("result") or {}
        tool = entry.get("tool") or "tool"
        label = TOOL_STEP_LABELS.get(tool) or tool.replace("_", " ")
        data = result.get("data") if isinstance(result.get("data"), dict) else {}
        if result.get("ok"):
            detail = data.get("message") if isinstance(data.get("message"), str) else None
            lines.append(f"✓ {label}" + (f" — {detail}" if detail else ""))
        else:
            err = (result.get("error") or "failed").strip()
            lines.append(f"✗ {label} — {err}")
    if not lines:
        return None
    return (
        "I started this request, but the model stopped before a final reply.\n\n"
        + "\n".join(lines)
        + "\n\nTry again, or tell me the exact step/fields to save (e.g. personal or skills)."
    )


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
    user_message: str = "",
) -> dict:
    clean_message = _sanitize_reply_message(message)
    return {
        "message": clean_message,
        "suggested_replies": suggested_replies or [],
        "ui_hint": _sanitize_ui_hint(user, ui_hint),
        "attachment": _last_renderable_attachment(scratchpad),
        "actions": _detail_actions(
            user,
            scratchpad,
            context,
            user_message=user_message,
            reply_message=clean_message,
        ),
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


async def _quick_offline_reply(user: CurrentUser, context: dict | None = None) -> dict:
    """Fast no-LLM reply used when the model call fails."""
    if user.role in ("recruiter", "super_admin"):
        return {
            "message": (
                "AI is temporarily unavailable, but I can still help fast. "
                "Tell me the person or action, or use the invite form and I’ll work with the fields you enter."
            ),
            "suggested_replies": [
                "Invite one candidate",
                "Show pipeline",
                "Bulk invite",
            ],
            "actions": _default_actions_for_role(user),
            "ui_hint": None,
        }
    if user.role == "employee":
        return {
            "message": "AI is temporarily unavailable, but your dashboard still works. Open Complete Profile, Learning, Talent, or Messages to continue.",
            "suggested_replies": [
                "Open Complete Profile",
                "Open Learning",
                "Message HR",
            ],
            "actions": _default_actions_for_role(user),
            "ui_hint": None,
        }
    return {
        "message": "AI is temporarily unavailable right now. Please try again in a moment.",
        "suggested_replies": [],
        "actions": _default_actions_for_role(user),
        "ui_hint": None,
    }


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
            # Use OPENROUTER_MAX_TOKENS (default 4096) so replies aren't cut mid-JSON.
            # OmniRoute can be slow; timeout covers routing + generation.
            parsed = await call_llm_json(prompt, temperature=0.1, timeout=120.0)
            if not parsed:
                scratch_msg = _message_from_scratchpad(scratchpad)
                offline = await _quick_offline_reply(user, context)
                return _pack_reply(
                    message=scratch_msg or offline["message"],
                    user=user,
                    scratchpad=scratchpad,
                    context=context,
                    suggested_replies=offline.get("suggested_replies") or [],
                    ui_hint=offline.get("ui_hint"),
                    user_message=message,
                )

            action = parsed.get("action")
            if action == "tool":
                tool_name = parsed.get("tool")
                args = parsed.get("args") or {}
                # Skip repeating successful read-only lookups in the same turn.
                if tool_name in READONLY_TOOLS:
                    prior = next(
                        (
                            s
                            for s in scratchpad
                            if s.get("tool") == tool_name
                            and isinstance(s.get("result"), dict)
                            and s["result"].get("ok")
                        ),
                        None,
                    )
                    if prior:
                        scratchpad.append(
                            {
                                "tool": tool_name,
                                "result": {
                                    "ok": True,
                                    "data": {
                                        "message": (
                                            f"{tool_name} was already loaded this turn — "
                                            "reply to the user now (do not call it again)."
                                        ),
                                        **(
                                            prior["result"].get("data")
                                            if isinstance(prior["result"].get("data"), dict)
                                            else {}
                                        ),
                                    },
                                },
                            }
                        )
                        continue
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
                        user_message=message,
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
                    user_message=message,
                )

            # Unrecognized shape — treat whatever text we got as the reply.
            return _pack_reply(
                message=parsed.get("message") or "I didn't quite catch that — could you rephrase?",
                user=user,
                scratchpad=scratchpad,
                context=context,
                user_message=message,
            )

        return _pack_reply(
            message="I gathered the information but need one more detail from you to finish — could you confirm and try again?",
            user=user,
            scratchpad=scratchpad,
            context=context,
            user_message=message,
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

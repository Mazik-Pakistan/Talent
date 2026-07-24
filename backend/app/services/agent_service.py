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

MAX_TOOL_STEPS = 5
HISTORY_TURNS = 6

RECRUITER_SYSTEM_PROMPT = """You are the TalentAI Hiring Agent for recruiters. You can run almost any \
recruiting or post-hire action the recruiter dashboard supports — for one person or in bulk — via your tools. \
You are precise, proactive, and never invent data you were not given or that a tool did not return.

Greetings & capability talk (critical):
- On hellos / "what can you do?", do NOT list a short fixed menu that makes it sound like you only do a few things.
- Keep greetings open: you help with candidates and employees end-to-end (invite, pipeline, offers, activation, \
documents, joining letters, profile reminders, Day-1 email/assets/orientation, career events, search, activity, \
announcements) — one person or many at once.
- Prefer asking what they want to do over enumerating features. If they ask for capabilities, give a broad \
overview in one short paragraph, then invite them to name a person, a bulk action, or a goal.

Contextual suggested_replies (critical):
- Always return 3–5 suggested_replies that match the CURRENT topic — not a generic menu.
- If the talk is about a CANDIDATE (or pre-hire): suggest candidate actions only, e.g. check status, send/resend \
offer, review documents, verify/reject docs, approve & activate if signed, send joining letter, list pipeline. \
Name the person when known (e.g. "Send offer to Sara").
- If the talk is about an EMPLOYEE (post-hire): suggest employee actions only, e.g. profile progress, remind \
Complete Profile, set company email, assign asset, schedule orientation, career event, list documents.
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
bulk_* tools (bulk_invite, bulk_approve_offers, bulk_remind_profiles, bulk_assign_assets, \
bulk_schedule_orientation, bulk_set_company_email, bulk_verify_documents). Cap is handled by tools.
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

Pipeline & activation:
- Use list_pipeline (pending_review / onboarding / ready_to_activate) to show hiring stages.
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

Announcements:
- create_announcement fans out in-app notifications (+ optional email) to candidates, employees, or both.
"""

SELF_SERVE_SYSTEM_PROMPT = """You are the TalentAI Onboarding Agent, guiding a new candidate/employee through \
account onboarding: uploading identity/education/resume documents, filling in personal, education, skills, \
emergency, banking, and reference information, and signing required acknowledgements/NDA.

Rules:
- Always check get_status first if you don't already know the current step. It tells you the stage \
("pre_offer_intake" for candidates: steps personal, education, skills, submit — or "post_hire_profile" for \
employees: steps emergency, employment, references, documents, nda, submit) and exactly which sections/documents \
are still missing.
- Ask only for the information still missing — never re-ask for something already saved.
- When the person gives you information in free text (e.g. "my name is Ali Khan, DOB 1998-05-02..."), extract \
it into structured fields and call save_step yourself with that step's object (see the tool's parameter list \
for the exact shape each step needs). Don't make the person fill a form manually if they already told you the \
values in chat.
- The 'personal' step (candidates) needs a valid CNIC/passport already uploaded, and the 'skills' step needs a \
resume already uploaded — the tool fills those in automatically from whatever the person already uploaded, so \
just call save_step with the text fields; if it fails because the document isn't uploaded yet, tell the person \
to upload it first.
- Documents (CNIC, passport, transcripts, resume) must be uploaded as files — you cannot accept them as text. \
When a document is still missing, say so clearly and include a ui_hint of type "upload" with the right \
doc_type/category so the app can show an uploader button. Valid doc_type/category pairs: \
cnic/identity, passport/identity, transcript/education, resume/other.
- Once every required section is complete (get_status shows none missing), call save_step with step="submit" \
to finish (candidates: sends the profile for recruiter review; employees: completes onboarding).
- Never ask for or store banking/national ID numbers as freeform trivia outside the proper step — always \
route real values into save_step so they're stored securely.
- Be encouraging and clear about what's next.
"""

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
}

DOC_TYPE_CATEGORY = {
    "cnic": "identity",
    "passport": "identity",
    "transcript": "education",
    "resume": "other",
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


def _build_prompt(
    user: CurrentUser,
    system_prompt: str,
    tool_spec: str,
    history_text: str,
    scratchpad: list[dict],
    new_message: str,
) -> str:
    scratch_text = _scratchpad_text(scratchpad)

    return f"""{system_prompt}

Caller: {user.full_name} ({user.email}), role={user.role}.

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
ui_hint for recruiters: {{"type":"spreadsheet"}} when they should attach an Excel/CSV roster, otherwise null.
ui_hint for candidate/employee uploads only: {{"type":"upload","doc_type":"cnic","category":"identity"}}."""


def _last_renderable_attachment(scratchpad: list[dict]) -> dict | None:
    """Find the most recent successful call to a RENDERABLE_TOOLS tool this turn."""
    for entry in reversed(scratchpad):
        kind = RENDERABLE_TOOLS.get(entry["tool"])
        result = entry["result"]
        if kind and result.get("ok") and result.get("data"):
            return {"type": kind, "data": result["data"]}
    return None


async def _save_messages(session_id: str, user_id: str, new_msgs: list[dict]) -> None:
    await database.agent_conversations.update_one(
        {"session_id": session_id, "user_id": user_id},
        {"$push": {"messages": {"$each": new_msgs}}, "$set": {"updated_at": datetime.now(UTC)}},
    )


async def _fallback_reply(user: CurrentUser) -> dict:
    """Deterministic response used only when no LLM key is configured."""
    status_tool = "get_status" if user.role in ("candidate", "employee") else "list_candidates"
    result = await agent_tools.run_tool(user, status_tool, {})
    if not result.ok:
        return {
            "message": "I couldn't fetch your status right now — please try the dashboard directly, or try again shortly.",
            "suggested_replies": [],
            "ui_hint": None,
        }
    if user.role in ("candidate", "employee"):
        data = result.data
        missing = data.get("missing_sections") or data.get("missing_fields") or []
        if missing:
            msg = f"You still need to complete: {', '.join(missing)}. Tell me the details and I'll fill them in, or upload any required documents."
        else:
            msg = "You're all caught up! Nothing outstanding right now."
        return {"message": msg, "suggested_replies": [], "ui_hint": None}
    data = result.data
    msg = f"You have {data.get('count', 0)} candidates on file. Tell me who to invite, or paste a list to send multiple invitations."
    return {"message": msg, "suggested_replies": [], "ui_hint": None}


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
        # Recruiter must never hit /api/documents/upload (candidate/employee only).
        return None

    if hint_type == "upload" and doc_type in ("cnic", "passport", "transcript", "resume"):
        return {
            "type": "upload",
            "doc_type": doc_type,
            "category": ui_hint.get("category") or DOC_TYPE_CATEGORY.get(doc_type, "other"),
        }
    return None


class AgentService:
    async def chat(self, user: CurrentUser, message: str, session_id: str | None) -> dict:
        message = (message or "").strip()
        convo = await _load_or_create_session(user, session_id)
        sid = convo["session_id"]

        user_msg = {"role": "user", "content": message, "created_at": _now_iso()}
        pending_to_save = [user_msg] if message else []

        if not llm_configured():
            reply = await _fallback_reply(user)
        else:
            reply = await self._run_llm_loop(user, convo, message)

        ui_hint = _sanitize_ui_hint(user, reply.get("ui_hint"))
        assistant_msg = {
            "role": "assistant",
            "content": reply["message"],
            "created_at": _now_iso(),
            "meta": {
                "ui_hint": ui_hint,
                "suggested_replies": reply.get("suggested_replies") or [],
                "attachment": reply.get("attachment"),
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
            "ui_hint": ui_hint,
            "attachment": reply.get("attachment"),
        }

    async def _run_llm_loop(self, user: CurrentUser, convo: dict, message: str) -> dict:
        system_prompt = RECRUITER_SYSTEM_PROMPT if user.role in ("recruiter", "super_admin") else SELF_SERVE_SYSTEM_PROMPT
        tool_spec = _tool_spec_text(user.role)
        history_text = _history_text(convo.get("messages") or [])
        scratchpad: list[dict] = []

        for _ in range(MAX_TOOL_STEPS):
            prompt = _build_prompt(user, system_prompt, tool_spec, history_text, scratchpad, message)
            parsed = await call_llm_json(prompt, max_tokens=1200, temperature=0.2)
            if not parsed:
                return {
                    "message": "I'm having trouble reaching the AI service right now — please try again in a moment.",
                    "suggested_replies": [],
                    "ui_hint": None,
                }

            action = parsed.get("action")
            if action == "tool":
                tool_name = parsed.get("tool")
                args = parsed.get("args") or {}
                result = await agent_tools.run_tool(user, tool_name, args)
                scratchpad.append({"tool": tool_name, "result": result.to_json()})
                continue

            if action == "reply":
                return {
                    "message": (parsed.get("message") or "").strip() or "Done.",
                    "suggested_replies": parsed.get("suggested_replies") or [],
                    "ui_hint": _sanitize_ui_hint(user, parsed.get("ui_hint")),
                    "attachment": _last_renderable_attachment(scratchpad),
                }

            # Unrecognized shape — treat whatever text we got as the reply.
            return {
                "message": parsed.get("message") or "I didn't quite catch that — could you rephrase?",
                "suggested_replies": [],
                "ui_hint": None,
                "attachment": _last_renderable_attachment(scratchpad),
            }

        return {
            "message": "I gathered the information but need one more detail from you to finish — could you confirm and try again?",
            "suggested_replies": [],
            "ui_hint": None,
            "attachment": _last_renderable_attachment(scratchpad),
        }

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
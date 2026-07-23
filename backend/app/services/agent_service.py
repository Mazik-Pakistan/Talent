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

MAX_TOOL_STEPS = 4
HISTORY_TURNS = 8

RECRUITER_SYSTEM_PROMPT = """You are the TalentAI Hiring & Onboarding Agent, helping a recruiter automate \
candidate invitations, offer letters, and joining-letter emails. You are precise, proactive, and never \
invent data you were not given or that a tool did not return.

Rules:
- Only use the tools listed. Never fabricate a tool result.
- Ask the recruiter for any required field you don't have yet (e.g. reporting manager, start date) instead \
of guessing.
- Dates should be confirmed in a clear format before calling a tool that needs one.
- When a user pastes a list of candidates (from chat or a spreadsheet already parsed for you), use bulk_invite.
- After a tool call, summarize plainly what happened (who was invited/offered/notified), including any failures.
- Keep replies concise and action-oriented.
- NEVER say you sent an email, reminder, or notification unless a tool result explicitly has email_sent=true \
or notification_sent=true. If either flag is false, say so clearly and include email_error when present.

Profile / onboarding status (critical):
- Pre-hire candidate onboarding (personal, education, skills, government docs, resume) is NOT the same as \
post-hire employee Complete Profile (emergency contact, banking, references, policies, NDA).
- After someone is converted to an employee, always use get_candidate_status or list_employees and report \
post_hire_profile_complete / post_hire_missing / profile_status. Never say their profile is complete just \
because pre-hire fields are on file.
- If profile_status is incomplete or post_hire_missing is non-empty, say clearly that they have NOT finished \
post-hire Complete Profile, and list the missing steps.
- To remind an employee to finish Complete Profile, you MUST call remind_employee_profile. Use force=true \
when the recruiter asks to resend.
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


def _tool_spec_text(role: str) -> str:
    tools = agent_tools.tools_for_role(role)
    lines = []
    for tool in tools:
        lines.append(f"- {tool.name}({json.dumps(tool.parameters)}): {tool.description}")
    return "\n".join(lines)


def _history_text(messages: list[dict]) -> str:
    recent = messages[-HISTORY_TURNS * 2 :]
    lines = []
    for m in recent:
        speaker = "User" if m["role"] == "user" else "Agent"
        lines.append(f"{speaker}: {m['content']}")
    return "\n".join(lines) if lines else "(no previous messages)"


def _build_prompt(
    user: CurrentUser,
    system_prompt: str,
    tool_spec: str,
    history_text: str,
    scratchpad: list[dict],
    new_message: str,
) -> str:
    scratch_text = ""
    if scratchpad:
        scratch_lines = [f"Tool `{s['tool']}` result: {json.dumps(s['result'])}" for s in scratchpad]
        scratch_text = "\n\nObservations so far this turn:\n" + "\n".join(scratch_lines)

    return f"""{system_prompt}

Caller: {user.full_name} ({user.email}), role={user.role}.

Available tools (call by exact name):
{tool_spec}

Conversation so far:
{history_text}

New message from caller: {new_message!r}
{scratch_text}

Respond with a SINGLE JSON object, no markdown fences, matching exactly one of these shapes:
1) To call a tool: {{"action": "tool", "tool": "<tool_name>", "args": {{...}}}}
2) To reply to the caller: {{"action": "reply", "message": "<final reply text>", \
"suggested_replies": ["short quick-reply option", "..."], \
"ui_hint": {{"type": "upload", "doc_type": "cnic", "category": "identity"}} or null}}

Only ever return one JSON object."""


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

        assistant_msg = {
            "role": "assistant",
            "content": reply["message"],
            "created_at": _now_iso(),
            "meta": {"ui_hint": reply.get("ui_hint"), "suggested_replies": reply.get("suggested_replies") or []},
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
            "ui_hint": reply.get("ui_hint"),
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
                    "ui_hint": parsed.get("ui_hint"),
                }

            # Unrecognized shape — treat whatever text we got as the reply.
            return {
                "message": parsed.get("message") or "I didn't quite catch that — could you rephrase?",
                "suggested_replies": [],
                "ui_hint": None,
            }

        return {
            "message": "I gathered the information but need one more detail from you to finish — could you confirm and try again?",
            "suggested_replies": [],
            "ui_hint": None,
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
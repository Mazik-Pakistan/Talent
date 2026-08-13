---
name: ai-agent
description: >-
  TalentAI in-app autonomous agent — tool-calling loop, role tool registries,
  confirm gate, and /api/agent endpoints. Use when changing agent_service,
  agent_tools*, agent chat API, or ai-assistant pages. Distinct from floating mascot.
scope: ai-agent
related_skills:
  - ai-agent/agent-loop
  - ai-agent/tool-registry
  - ai-agent/confirm-gate
  - ai-agent/role-tool-lists
  - ai-frontend/SKILL
  - llm/SKILL
primary_files:
  - backend/app/services/agent_service.py
  - backend/app/services/agent_tools.py
  - backend/app/services/agent_tools_parity.py
  - backend/app/services/agent_tools_super_admin.py
  - backend/app/api/agent.py
  - backend/app/schemas/agent.py
  - frontend/services/agentService.js
---

# AI Agent (overview)

## Purpose

Guide changes to the **autonomous product agent** (tool-calling LLM that runs real workflows). This is **not** the floating mascot/partner UX — see `ai-frontend/`.

## Location

| Layer | Path |
|-------|------|
| Orchestrator | `backend/app/services/agent_service.py` |
| Core tools | `backend/app/services/agent_tools.py` |
| Dashboard-parity tools | `backend/app/services/agent_tools_parity.py` |
| Super Admin tools | `backend/app/services/agent_tools_super_admin.py` |
| Router | `backend/app/api/agent.py` (`prefix=/api/agent`) |
| Schemas | `backend/app/schemas/agent.py` |
| Frontend API | `frontend/services/agentService.js` |
| Agent pages | `frontend/app/dashboard/*/ai-assistant/page.js` |
| Chat UI | `frontend/components/ai/AgentChatCore.js`, `AssistantPageShell.js` |

## Entry Points

1. User opens `/dashboard/{role}/ai-assistant` → `AgentChatCore` → `POST /api/agent/chat`.
2. Sessions/history/reset via `/api/agent/sessions`, `/history`, `/reset`.
3. Recruiter spreadsheet bulk invite: `POST /api/agent/recruiter/bulk-invite`.

## Data Flow

```
AgentChatCore → agentService.sendAgentMessage
  → POST /api/agent/chat (RequireUser + role + recruiter capability "assistant")
  → AgentService.chat
       ├─ __CONFIRM__:… → run tool with confirm=True (no LLM)
       ├─ !llm_configured → _fallback_reply
       └─ _run_llm_loop (≤ MAX_TOOL_STEPS=4)
            → call_llm_json → run_tool → services (RBAC)
```

## Business Rules

- `MAX_TOOL_STEPS = 4`. Read-only tools listed in `READONLY_TOOLS` are not re-executed in the same turn.
- Tools wrap **existing services** — never shortcut DB bypassing RBAC/capabilities.
- Destructive/bulk tools use `confirm_gate` → UI Approve sends `__CONFIRM__:` + JSON.
- Agent prose: natural language only; no raw route strings (`/offer`, `offer_page=`). Navigation via `ui_hint` / actions / confirmation.
- Intentional split: core vs parity vs super_admin tool modules — **do not merge**.

## Permissions

- `ALLOWED_ROLES`: `candidate`, `employee`, `recruiter`, `super_admin`.
- Recruiter needs `has_capability("assistant")` for chat; bulk-invite needs `invite`.
- Recruiter tools further filtered by `RECRUITER_TOOL_CAPABILITIES`.

## APIs (real)

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/agent/chat` | Bearer + role (+ `assistant` for recruiter) |
| GET | `/api/agent/sessions` | same |
| GET | `/api/agent/history?session_id=` | same |
| POST | `/api/agent/reset` | same |
| POST | `/api/agent/recruiter/bulk-invite` | recruiter/super_admin + `invite` |

## Important Files

- `agent_service.py` — prompt, loop, confirm path, fallbacks, Mongo `agent_conversations`
- `agent_tools.py` — `confirm_gate`, `run_tool`, role lists, capability gating
- `llm_service.py` — `llm_configured`, `call_llm_json`

## Modification Guide

1. New tool → correct `agent_tools*.py` → register in role list → add to `READONLY_TOOLS` if read-only → use `confirm_gate` if destructive/bulk.
2. Keep routers thin; business logic stays in services tools already call.
3. Update frontend only if response shape (`confirmation`, `ui_hint`, attachments) changes.

## Do Not Break

- `MAX_TOOL_STEPS = 4` and `READONLY_TOOLS` skip behavior.
- Confirm-gate Approve path (`CONFIRM_PREFIX = "__CONFIRM__:"`).
- No-LLM `_fallback_reply` path.
- Separation of agent pages vs floating mascot.

## Testing

- `python -m py_compile` touched agent/llm files.
- Chat without LLM keys → fallback still answers status-style questions.
- Confirm tool: first call returns `needs_confirm`; Approve re-runs with `confirm: true`.
- Recruiter without `assistant` → 403 on `/api/agent/chat`.

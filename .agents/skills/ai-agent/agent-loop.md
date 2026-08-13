---
name: agent-loop
description: >-
  TalentAI agent LLM tool loop — MAX_TOOL_STEPS=4, prompt composition,
  READONLY_TOOLS skip, confirm interrupt, and no-LLM fallback. Use when
  editing agent_service chat orchestration.
scope: ai-agent
related_skills:
  - ai-agent/SKILL
  - ai-agent/confirm-gate
  - ai-agent/tool-registry
  - llm/openrouter-gemini
primary_files:
  - backend/app/services/agent_service.py
  - backend/app/services/llm_service.py
---

# Agent loop

## Purpose

Change how the agent plans and executes tools without burning steps, looping forever, or dropping the offline fallback.

## Location

- `backend/app/services/agent_service.py` — `AgentService.chat`, `_run_llm_loop`, `_build_prompt`, `_run_confirm_action`, `_fallback_reply`
- LLM: `backend/app/services/llm_service.py` — `call_llm_json`, `llm_configured`

## Entry Points

`AgentService.chat(user, message, session_id, context)` from `POST /api/agent/chat`.

## Data Flow

```
1. Load/create session (agent_conversations, scoped by user_id)
2. If message starts with __CONFIRM__: → _run_confirm_action (skip LLM)
3. Else if not llm_configured() → _fallback_reply
4. Else loop i < MAX_TOOL_STEPS (4):
     _build_prompt → call_llm_json(temperature=0.1, timeout=120)
     action=tool → run_tool; if needs_confirm → return confirmation (stop)
     successful READONLY_TOOLS → skip re-run; inject "already loaded"
     action=reply → pack and exit
5. Max steps with no reply → ask for one more detail
6. Persist user + assistant messages; return session_id, reply, suggestions, ui_hint, confirmation, …
```

## Business Rules

- `MAX_TOOL_STEPS = 4`; `HISTORY_TURNS = 8` (last 16 messages in prompt).
- Prompt = role system prompt + `SHARED_AGENT_RULES` + identity + recruiter restricted modules + optional org-framework rule + page context + tool catalog + history + message + scratchpad.
- LLM must return **one** compact JSON object: `{"action":"tool",...}` or `{"action":"reply",...}`.
- Mid-loop LLM failure → `_quick_offline_reply` (or scratchpad summary if tools already ran).
- Fallback without keys: `get_status` (candidate/employee), `list_candidates` (recruiter), static greeting (super_admin).

## Permissions

Loop itself does not add auth — tools enforce RBAC/capabilities inside `run_tool`.

## APIs (real)

Orchestrated only via `POST /api/agent/chat` (and confirm messages on the same endpoint).

## Important Files

- `agent_service.py` — constants `MAX_TOOL_STEPS`, `READONLY_TOOLS`, `CONFIRM_PREFIX`, `RENDERABLE_TOOLS`
- Role prompts: `RECRUITER_SYSTEM_PROMPT`, `CANDIDATE_SYSTEM_PROMPT`, `EMPLOYEE_SYSTEM_PROMPT`, `SUPER_ADMIN_SYSTEM_PROMPT`

## Modification Guide

1. Changing step budget → update `MAX_TOOL_STEPS` and any UI copy that mentions it.
2. New read-only tool → add name to `READONLY_TOOLS` frozenset.
3. Preserve `__CONFIRM__:` short-circuit before the LLM path.
4. Keep JSON-only contract with `call_llm_json`.

## Do Not Break

- Bounded loop (no unbounded tool recursion).
- Confirm interrupt returns immediately with `confirmation` payload.
- Offline `_fallback_reply` when `llm_configured()` is false.
- Shared rule: never surface raw dashboard paths in agent prose.

## Testing

- With keys: multi-tool turn stops by step 4 or on reply/confirm.
- Without keys: deterministic fallback still responds.
- Repeat same read-only tool in one turn → second call skipped.
- Invalid LLM JSON → degrades gracefully (offline/quick reply).

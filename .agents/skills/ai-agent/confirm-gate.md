---
name: confirm-gate
description: >-
  TalentAI agent confirm_gate for bulk/destructive tools — needs_confirm
  payload, __CONFIRM__: Approve path, and which tools require confirmation.
scope: ai-agent
related_skills:
  - ai-agent/SKILL
  - ai-agent/agent-loop
  - ai-agent/tool-registry
primary_files:
  - backend/app/services/agent_tools.py
  - backend/app/services/agent_service.py
  - frontend/components/ai/AgentChatCore.js
---

# Confirm gate

## Purpose

Require explicit UI Approve before destructive or bulk agent actions. Users must not be asked to type “confirm”.

## Location

- Gate helper: `confirm_gate()` in `backend/app/services/agent_tools.py`
- Loop handling: `_run_llm_loop` + `_run_confirm_action` in `agent_service.py`
- UI: confirmation card in agent chat (`AiConfirmCard` / AgentChatCore)

## Entry Points

1. Tool handler: `if not args.get("confirm"): return confirm_gate(tool, args, summary)`
2. Loop sees `needs_confirm` → returns `confirmation: {tool, args, summary}` (stops loop)
3. UI Approve → message `__CONFIRM__:` + JSON `{tool, args}` → `_run_confirm_action` forces `confirm: True` and `run_tool` (no LLM)

## Data Flow

```
tool(args without confirm)
  → ToolResult(ok=False, data={needs_confirm, tool, args: {**args, confirm:True}, summary})
  → chat response.confirmation
User Approves
  → message "__CONFIRM__:{...}"
  → _run_confirm_action → run_tool(..., confirm=True) → real side effect
```

`CONFIRM_PREFIX = "__CONFIRM__:"`

## Business Rules

- First call without `confirm` must only return the gate — no mutation.
- Bulk IT send/remind gated when targets exist; `BULK_CAP = 100`.
- Cancel is client-side (no server cancel tool required).

### Tools using `confirm_gate` (representative)

| Tool | Role context |
|------|----------------|
| `delete_announcement`, `delete_document`, `decline_offer` | Recruiter / self |
| `delete_skill`, `delete_certificate`, `apply_to_opportunity` | Employee |
| `bulk_send_it_provisioning`, `bulk_remind_it_provisioning`, `delete_it_kit` | Recruiter IT |
| `send_it_service_request`, `cancel_it_service_request` | Recruiter IT |
| `delete_department`, `delete_org_role`, `delete_managed_course` | Recruiter org |
| `close_hr_thread` | Employee/recruiter |
| `delete_organization`, `delete_ticket` | Super Admin |
| `delete_recruiter` | Handler exists; **not** registered in `SUPER_ADMIN_TOOLS` |

## Permissions

Confirm re-run still goes through `run_tool` → same capability/RBAC checks.

## APIs (real)

Same as chat: `POST /api/agent/chat` with `__CONFIRM__:` message body.

## Important Files

- `agent_tools.confirm_gate`
- `agent_service._run_confirm_action`
- Frontend confirmation rendering in agent chat components

## Modification Guide

1. New destructive/bulk tool → gate first; only mutate when `args.get("confirm")`.
2. Summary string must be human-readable for the Approve card.
3. Include `confirm: True` in the args echoed inside `needs_confirm` so Approve is a no-op patch.

## Do Not Break

- Do not mutate on the first (ungated) call.
- Do not require the user to type the word “confirm”.
- Do not skip re-auth/capability checks on the Approve path.

## Testing

- Call gated tool via chat → response has `confirmation`, DB unchanged.
- Approve → side effect applied once.
- Cancel → no second request / no mutation.

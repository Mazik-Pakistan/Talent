---
name: tool-registry
description: >-
  TalentAI agent tool modules — agent_tools vs parity vs super_admin split,
  Tool/ToolResult, run_tool, and capability gating. Use when adding or moving tools.
scope: ai-agent
related_skills:
  - ai-agent/SKILL
  - ai-agent/role-tool-lists
  - ai-agent/confirm-gate
  - authorization/recruiter-capabilities
primary_files:
  - backend/app/services/agent_tools.py
  - backend/app/services/agent_tools_parity.py
  - backend/app/services/agent_tools_super_admin.py
---

# Tool registry

## Purpose

Register and execute agent tools correctly. The three files are an **intentional split**, not duplication.

## Location

| Module | Responsibility |
|--------|----------------|
| `agent_tools.py` | Core hiring/onboarding tools, `confirm_gate`, `BULK_CAP=100`, `run_tool`, role list composition, `RECRUITER_TOOL_CAPABILITIES`, merges parity, lazy-loads super admin |
| `agent_tools_parity.py` | Dashboard-parity extras (learning, talent, IT, offers, docs, HR, announcements CRUD, org framework deletes) — wraps existing services |
| `agent_tools_super_admin.py` | Platform tools (orgs, recruiters, admin tickets, capability templates) |

## Entry Points

- `tools_for_role(role)` / `tools_for_user(user)` — catalog for prompts.
- `run_tool(name, args, user)` — execution from the agent loop.

## Data Flow

```
tools_for_user(user)
  → role list (+ SUPER_ADMIN gets SUPER_ADMIN_TOOLS + RECRUITER_TOOLS)
  → filter by RECRUITER_TOOL_CAPABILITIES ∩ has_capability
run_tool(name, args, user)
  → lookup Tool → handler(args, user) → ToolResult(ok, data/message)
  → handler calls service layer (same as REST)
```

## Business Rules

- Handlers return `ToolResult`; confirm-gated tools return `needs_confirm` when `confirm` missing.
- Candidate onboarding mutations blocked until signed offer (`offer_service.has_signed_offer`).
- Bulk ops capped at `BULK_CAP = 100`.
- Parity tools must not invent new business rules — call services.

## Permissions

Recruiter capability map examples: `invite`, `candidates`, `employees`, `learning`, `talent`, `it`, `messages`, `announcements`, `overview`, `reporting`, `profile`, `support`, `org_config`, `assistant`.

## APIs (real)

No direct HTTP registry — tools run only inside `/api/agent/chat` (and confirm path).

## Important Files

- `agent_tools.py` — `Tool`, `ToolResult`, `confirm_gate`, `run_tool`
- Service callers: `CandidateService`, `EmployeeService`, `offer_service`, `learning_service`, `message_service`, `ticket_service`, `organization_service`, IT services, etc.

## Modification Guide

1. Pick file: core hire/onboard → `agent_tools.py`; dashboard feature parity → `parity`; platform → `super_admin`.
2. Implement handler calling an existing (or newly extended) service.
3. Append to the correct role list constant.
4. If read-only → `READONLY_TOOLS` in `agent_service.py`.
5. If destructive/bulk → `confirm_gate` when `not args.get("confirm")`.

## Do Not Break

- Do not merge parity into core “for cleanup”.
- Do not read Mongo directly from a tool to bypass RBAC.
- Do not register a tool without putting it on a role list.

## Testing

- Tool appears in catalog for intended role only.
- Recruiter with capability off → tool absent / denied.
- Handler failure returns structured `ToolResult` (not uncaught 500).

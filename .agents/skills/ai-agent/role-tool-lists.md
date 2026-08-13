---
name: role-tool-lists
description: >-
  TalentAI agent role tool lists — SELF_SERVE, RECRUITER, CANDIDATE, EMPLOYEE,
  SUPER_ADMIN composition and effective Super Admin catalog.
scope: ai-agent
related_skills:
  - ai-agent/SKILL
  - ai-agent/tool-registry
primary_files:
  - backend/app/services/agent_tools.py
  - backend/app/services/agent_tools_parity.py
  - backend/app/services/agent_tools_super_admin.py
---

# Role tool lists

## Purpose

Know which tools each role receives and how lists are composed when adding or auditing tools.

## Location

Constants and `tools_for_role` / `tools_for_user` in `agent_tools.py`; parity lists in `agent_tools_parity.py`; platform list in `agent_tools_super_admin.py`.

## Entry Points

Prompt catalog built from `tools_for_user(current_user)` inside `_build_prompt`.

## Data Flow

```
SELF_SERVE_TOOLS (get_status, save_step, list_documents)
RECRUITER_TOOLS = core recruiter (~37) + RECRUITER_PARITY_TOOLS (~62)
CANDIDATE_TOOLS = SELF_SERVE + CANDIDATE_PARITY (+ SHARED_SELF_DOCUMENT_TOOLS)
EMPLOYEE_TOOLS  = SELF_SERVE + EMPLOYEE_PARITY (+ shared docs)
SUPER_ADMIN_TOOLS = platform-only (~22)
Super Admin effective = SUPER_ADMIN_TOOLS + RECRUITER_TOOLS
```

Then recruiter (and SA acting as recruiter tools) filtered by capabilities.

## Business Rules

| List | Approx size | Notes |
|------|-------------|--------|
| `SELF_SERVE_TOOLS` | 3 | Shared base |
| `RECRUITER_TOOLS` | ~99 | Core + parity |
| `CANDIDATE_TOOLS` | ~16 | Offer/HR/docs |
| `EMPLOYEE_TOOLS` | ~44 | Learning/talent/IT/HR |
| `SUPER_ADMIN_TOOLS` | 22 | Orgs, recruiters, admin tickets, templates |

**READONLY_TOOLS** (in `agent_service.py`) includes: `get_status`, `get_my_offer`, `get_my_profile`, `list_documents`, `list_candidate_documents`, `list_person_documents`, `list_candidates`, `list_employees`, `get_candidate_status`, `get_employee_detail`, `get_dashboard_summary`, `my_learning_dashboard`, `list_opportunities`, `list_my_announcements`, `list_notifications`, `list_hr_threads`, `get_my_day1_info`.

**Core recruiter (before parity):** invite/bulk, lists, search, offers, docs verify, assets, orientation, career events, support ticket, announcements create/list, etc.

**Candidate parity:** profile, HR threads, offer get/sign/decline, message recruiter.

**Employee parity:** learning, talent apply, Day-1, HR, IT self-serve, role matches.

**Super Admin tools:** overview, invite/list recruiters, org CRUD, admin ticket lifecycle, capability templates / bulk apply.

## Permissions

Recruiter capability filtering via `RECRUITER_TOOL_CAPABILITIES`. Candidates need signed offer for some mutations.

## APIs (real)

Catalog is not a separate HTTP API — exposed only inside agent prompts via `/api/agent/chat`.

## Important Files

- `agent_tools.py` — composition + `tools_for_role`
- `agent_tools_parity.py` — `*_PARITY_TOOLS`, `SHARED_SELF_DOCUMENT_TOOLS`
- `agent_tools_super_admin.py` — `SUPER_ADMIN_TOOLS`

## Modification Guide

1. Add tool to the smallest correct list (prefer parity for dashboard features).
2. Update `READONLY_TOOLS` if read-only.
3. Map recruiter tools to a capability key if gated.
4. Super Admin automatically inherits recruiter tools — avoid duplicating those in `SUPER_ADMIN_TOOLS`.

## Do Not Break

- Super Admin effective catalog includes recruiter tools.
- Do not put platform-only tools on recruiter lists.
- Keep `SELF_SERVE` shared rather than copy-pasting into each role.

## Testing

- Assert tool present/absent per role in a unit or manual chat “what can you do” check.
- Capability-off recruiter loses mapped tools.
- New read-only tool skipped on repeat within one turn.

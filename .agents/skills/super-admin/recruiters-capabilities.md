---
name: recruiters-capabilities
description: >-
  TalentAI super-admin recruiter invite and capability management — defaults,
  templates, bulk apply, org module clamp.
scope: super-admin
related_skills:
  - super-admin/SKILL
  - super-admin/organizations
  - authorization/recruiter-capabilities
primary_files:
  - backend/app/api/super_admin.py
  - backend/app/services/agent_tools_super_admin.py
  - frontend/components/super-admin/SuperAdminShell.js
---

# Recruiters & capabilities

## Purpose

Invite recruiters into orgs and manage per-recruiter capability toggles (intersected with org modules).

## Location

- API examples: `POST /api/super-admin/recruiters/invite`, `GET/PUT/DELETE /recruiters/{id}`, `PUT .../capabilities`, `POST /recruiters/bulk-capabilities`, `GET /capability-templates`
- Defaults: `DEFAULT_RECRUITER_CAPABILITIES`
- Agent: `invite_recruiter`, `list_recruiters`, `get_recruiter_detail`, `list_capability_templates`, `bulk_apply_template`
- Note: `_tool_delete_super_admin_recruiter` + confirm exists but may be **unregistered** in `SUPER_ADMIN_TOOLS`

## Entry Points

Super Admin Recruiters / Invite tabs; SA agent recruiter tools.

## Data Flow

```
Invite → recruiter (+ often dual employee profile) → email invite
Capabilities PUT → store toggles → effective = toggles ∩ org modules
Bulk template apply → many recruiters
```

## Business Rules

- Default caps: overview, candidates, invite, employees, talent, learning, org_config, assistant, messages, announcements, it, reporting, profile, support.
- UI nav and agent tools both honor `has_capability`.
- Invited recruiters often start session as recruiter (dual-role aware).

## Permissions

Super Admin for management APIs. Runtime checks use recruiter JWT + capabilities.

## APIs (real)

| Method | Path (under `/api/super-admin`) |
|--------|----------------------------------|
| POST | `/recruiters/invite` |
| GET/PUT/DELETE | `/recruiters/{id}` |
| PUT | `/recruiters/{id}/capabilities` |
| POST | `/recruiters/bulk-capabilities` |
| GET | `/capability-templates` |

## Important Files

- `super_admin.py`, capability maps
- `authorization` skills for `require_capabilities`
- `frontend/lib/recruiterPageCapabilities.js` page→cap map

## Modification Guide

1. New capability → defaults + org module key + nav + page map + agent `RECRUITER_TOOL_CAPABILITIES`.
2. Templates must only reference known keys.
3. Keep clamp logic when org modules change.

## Do Not Break

- Org module clamp (`effective_capabilities`).
- Assistant capability gating `/api/agent/chat`.
- Dual-role invite side effects (employee profile).

## Testing

- Invite → register → login as recruiter.
- Toggle `learning` off → learning routes 403 / nav hidden.
- Bulk apply template.

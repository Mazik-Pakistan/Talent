---
name: recruitment
description: >-
  TalentAI recruitment overview — candidate invitations, bulk invite, and
  recruiter pipeline/search. Use when changing invite, roster upload, or
  candidate listing flows.
scope: recruitment
related_skills:
  - recruitment/invitations
  - recruitment/bulk-invite
  - recruitment/pipeline-search
  - offers/SKILL
  - candidates/SKILL
primary_files:
  - backend/app/api/invitations.py
  - backend/app/services/invitation_service.py
  - backend/app/services/bulk_invite_service.py
  - backend/app/api/employees.py
  - frontend/app/dashboard/recruiter/invite/page.js
---

# Recruitment (overview)

## Purpose

Hire-side flows: invite candidates (often with offer terms), bulk Excel invite, and pipeline lists/search. Always org-scoped and capability-gated.

## Location

| Area | Path |
|------|------|
| Invitations API | `backend/app/api/invitations.py` (`/api/invitations`) |
| Invite service | `backend/app/services/invitation_service.py` |
| Bulk | `backend/app/services/bulk_invite_service.py`, `spreadsheet_roster.py` |
| Pipeline lists | `backend/app/api/employees.py` candidate endpoints |
| Search | `GET /api/search` in `backend/app/api/dashboard.py` |
| Agent bulk | `POST /api/agent/recruiter/bulk-invite` |
| UI | `frontend/app/dashboard/recruiter/invite/page.js`, `candidates/page.js`, `BulkInvitePanel.js` |

## Entry Points

1. Recruiter Invite page → single `POST /api/invitations` (optional `offer` payload).
2. Bulk Excel → template → preview → send.
3. Candidates directory + global search for pipeline triage.
4. Agent spreadsheet upload (sends only when all sendable; prefer UI review flow).

## Data Flow

```
Recruiter (capability invite/candidates)
  → invitations / employees list APIs
  → Mongo invitations + candidates (+ offer_letters when offer attached)
  → email invite link /frontend/invite/{token}
```

## Business Rules

- Invite requires roles `recruiter|super_admin` + capability `invite`.
- Candidate lists require capability `candidates`.
- Primary invite can embed `OfferTermsPayload` so email includes offer letter.
- Multi-tenant: filter by `organization_id` of current recruiter.

## Permissions

- Role: recruiter or super_admin.
- Capabilities: `invite` (create/bulk), `candidates` (lists/search/history).

## APIs (real)

See child skills. Core:

- `POST /api/invitations`, `GET /api/invitations/{token}`
- `GET /api/invitations/bulk/template`, `POST .../bulk/preview`, `POST .../bulk/send`
- `GET /api/employees/candidates`, `/pending-review`, `/onboarding-in-progress`, `/person-history`, `/historical-candidates`
- `GET /api/search?q=`
- `POST /api/agent/recruiter/bulk-invite`

## Important Files

- `backend/app/schemas/invitation.py` — `CreateInvitationRequest`
- `frontend/services/authService.js` — invite + candidate list wrappers
- `frontend/components/recruiter/BulkInvitePanel.js`

## Modification Guide

1. Extend schemas + `InvitationService` / `bulk_invite_service`.
2. Keep capability gates on router.
3. Mirror frontend service + invite page.
4. Preserve person-history checks on bulk preview.

## Do Not Break

- Public `GET /api/invitations/{token}` must not leak other tenants' data beyond the token.
- Do not send bulk invites without validation (`can_send`).
- Org scoping on all list endpoints.

## Testing

- Single invite with/without offer.
- Bulk preview blocks conflicts; send only selected rows.
- Capability off → 403.
- `py_compile` invitations + bulk_invite + employees router slices.

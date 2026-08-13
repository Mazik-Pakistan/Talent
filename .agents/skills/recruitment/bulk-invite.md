---
name: bulk-invite
description: >-
  Excel/CSV bulk candidate invite template, preview (person-history/conflicts),
  send, and agent bulk-invite endpoint.
scope: recruitment
related_skills:
  - recruitment/SKILL
  - recruitment/invitations
  - candidates/person-history-reinvite
primary_files:
  - backend/app/api/invitations.py
  - backend/app/services/bulk_invite_service.py
  - backend/app/services/spreadsheet_roster.py
  - backend/app/api/agent.py
  - frontend/components/recruiter/BulkInvitePanel.js
---

# Bulk invite

## Purpose

Upload a roster, preview validation + person-history conflicts, then send offer invitations for approved rows — without inventing columns or skipping `can_send` checks.

## Location

- HTTP: `backend/app/api/invitations.py` — `/bulk/template`, `/bulk/preview`, `/bulk/send`
- Service: `backend/app/services/bulk_invite_service.py`
- Template bytes: `backend/app/services/spreadsheet_roster.py` (`build_xlsx_template_bytes`)
- Agent shortcut: `POST /api/agent/recruiter/bulk-invite` in `backend/app/api/agent.py`
- UI: `frontend/components/recruiter/BulkInvitePanel.js`, invite page
- Client: `downloadBulkInviteTemplate`, `previewBulkInvitations`, `sendBulkInvitations` in `authService.js`

## Entry Points

1. Invite → Bulk Excel → download template → upload → preview → select rows → send.
2. Recruiter agent chat file upload → `/api/agent/recruiter/bulk-invite` (auto-sends only when preview allows; otherwise reports issues).

## Data Flow

```
xlsx/csv UploadFile
  → bulk_invite_service.preview (headers, per-row valid/can_send, history)
  → BulkInviteSendRequest { candidates: list[dict] max 200 }
  → bulk_invite_service.send_rows → same path as single invite+offer
```

Agent path: preview → if incomplete/blocked, **send nothing** and return guidance; else send sendable rows.

## Business Rules

- Same `RequireInvite` as single invite (role + `invite` capability).
- Required columns (agent message / template): email, full_name, job_title, department, reporting_manager, start_date, monthly_salary.
- Preview attaches person-history / conflict checks; `can_send` false blocks send.
- Send body max 200 candidates.
- Prefer UI bulk flow for review; agent endpoint documents this preference.

## Permissions

Recruiter/super_admin + capability `invite`. Agent endpoint also checks role and `invite`.

## APIs (real)

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/invitations/bulk/template` | RequireInvite |
| POST | `/api/invitations/bulk/preview` | RequireInvite + multipart file |
| POST | `/api/invitations/bulk/send` | RequireInvite + JSON candidates |
| POST | `/api/agent/recruiter/bulk-invite` | Bearer recruiter/super_admin + invite |

## Important Files

- `backend/app/services/bulk_invite_service.py`
- `backend/app/services/spreadsheet_roster.py`
- `frontend/components/recruiter/BulkInvitePanel.js`

## Modification Guide

1. Update template builder + preview parser together.
2. Keep send using shared invitation/offer creation (no parallel path).
3. Update BulkInvitePanel + authService wrappers.
4. If agent copy lists required columns, keep it accurate.

## Do Not Break

- Preview-before-send contract (no silent partial sends on agent when invalid/blocked present without sendable-only policy as coded).
- Max 200 rows on send schema.
- Person-history conflict surfacing.

## Testing

- Download template opens as xlsx.
- Preview reports missing headers and row issues.
- Send only `can_send` rows.
- Capability off → 403 on all bulk routes.
- `py_compile` invitations + bulk_invite_service + agent bulk handler.

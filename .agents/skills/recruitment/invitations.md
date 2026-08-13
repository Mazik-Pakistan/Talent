---
name: invitations
description: >-
  Single candidate invitation create and public token validation for TalentAI
  registration.
scope: recruitment
related_skills:
  - recruitment/SKILL
  - recruitment/bulk-invite
  - authentication/login-register-otp
  - offers/offer-lifecycle
primary_files:
  - backend/app/api/invitations.py
  - backend/app/services/invitation_service.py
  - backend/app/schemas/invitation.py
  - frontend/app/invite/[token]/page.js
  - frontend/app/dashboard/recruiter/invite/page.js
---

# Invitations (single)

## Purpose

Create one candidate invitation (optionally with offer terms) and validate tokens on the public invite page.

## Location

- Router: `backend/app/api/invitations.py`
- Service: `backend/app/services/invitation_service.py` (`create_invitation`, `get_invitation`)
- Schema: `CreateInvitationRequest` in `backend/app/schemas/invitation.py`
- Frontend: `createInvitation`, `getInvitation` in `authService.js`
- Pages: `frontend/app/dashboard/recruiter/invite/page.js`, `frontend/app/invite/[token]/page.js`
- Composer: `frontend/components/OfferComposerModal.js` (when attaching offer)

## Entry Points

1. Recruiter submits invite form → `POST /api/invitations`.
2. Candidate opens `/invite/{token}` → `GET /api/invitations/{token}` → register.

## Data Flow

```
CreateInvitationRequest
  → RequireInvite (roles + capability invite)
  → InvitationService.create_invitation
  → Mongo invitations (+ offer_letters if offer present)
  → email with /invite/{token}
Public GET by token → status/expiry/payload for registration UI
```

## Business Rules

- Fields: email, full_name, job_title, department, optional office_location, `is_remote`, start_date, expires_in_days (1–365, default 2), optional `offer`.
- Email normalized lowercase; start_date cannot be past.
- `is_remote` affects later banking ownership (remote self-serve vs recruiter-managed).
- Super admin recruiter invites are a **different** flow: `POST /api/super-admin/recruiters/invite` (kind recruiter), not this endpoint.

## Permissions

`RequireInvite`: `require_roles("recruiter", "super_admin")` + `require_capabilities("invite")`.

Token GET is public.

## APIs (real)

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/invitations` | Recruiter+invite |
| GET | `/api/invitations/{token}` | Public |

## Important Files

- `backend/app/api/invitations.py`
- `backend/app/services/invitation_service.py`
- `backend/app/schemas/offer.py` — `OfferTermsPayload` when `offer` set

## Modification Guide

1. Change request validation in `CreateInvitationRequest`.
2. Implement side effects in `InvitationService` (email, offer create, audit).
3. Update invite page + `authService.createInvitation`.
4. Keep token route public in `proxy.js` (`/invite`).

## Do Not Break

- Capability `invite` gate.
- Token expiry / used_at handling.
- Do not confuse candidate invites with super-admin recruiter invites.

## Testing

- Create invite → email/link → GET token → candidate register.
- Missing capability → 403.
- Invalid/expired token → error on GET.
- `py_compile` invitations router + service + schema.

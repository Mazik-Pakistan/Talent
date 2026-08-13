---
name: security
description: >-
  TalentAI security spine — JWT access vs refresh, RBAC deps, Fernet crypto for
  sensitive fields. Use when changing authz or encrypted data handling.
scope: security
related_skills:
  - security/crypto-sensitive-fields
  - authentication/jwt-refresh-session
  - authorization/SKILL
primary_files:
  - backend/app/core/security.py
  - backend/app/core/crypto.py
  - backend/app/core/rbac.py
  - backend/app/core/config.py
---

# Security (overview)

## Purpose

Protect sessions, enforce RBAC/capabilities, and keep sensitive fields encrypted. Never weaken these for convenience.

## Location

| Concern | Path |
|---------|------|
| JWT + Require* | `backend/app/core/security.py` |
| RBAC maps | `backend/app/core/rbac.py` |
| Fernet crypto | `backend/app/core/crypto.py` |
| Secret validation | `backend/app/core/config.py` (`JWT_SECRET` ≥32, reject placeholders) |

## Entry Points

Every protected API via `get_current_user` / `Require*`. Banking/IT secret fields via crypto helpers.

## Data Flow

```
Bearer access (type=access) → CurrentUser(role, capabilities, organization_id)
require_roles / require_permissions / require_capabilities
Sensitive write → Fernet encrypt; read → decrypt only on designated paths
```

## Business Rules

- Access tokens: `type: "access"`; refresh: `type: "refresh"` — never interchange.
- RBAC code is source of truth; Mongo roles seed is mirror.
- Denied authz may write `audit_logs` — keep audit calls.
- CORS wide-open is deployment-stage choice — unrelated PRs must not change it silently.

## Permissions

Shared aliases: `RequireUser`, `RequireRecruiter`, `RequireEmployee`, `RequireAny`, `RequireOnboardingSelf`, `RequireSuperAdmin`.

## APIs (real)

Auth token endpoints under `/api/auth/*`; everything else depends on security deps.

## Important Files

- `security.py`, `rbac.py`, `crypto.py`, `config.py`
- Frontend must not be trusted for authz

## Modification Guide

1. New protected route → pick correct Require* (+ capability).
2. New sensitive field → encrypt at rest; never log plaintext.
3. Keep JWT secret validation strict.

## Do Not Break

- Access/refresh type checks.
- Capability intersection for recruiters.
- Portal path secrecy / no public linking.
- Audit on denials where wired.

## Testing

- Refresh token as Bearer → 401.
- Capability off → 403.
- Banking round-trip encrypt/decrypt tests in `backend/tests/`.

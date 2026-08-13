---
name: services-api-client
description: >-
  TalentAI frontend apiClient axios wrapper and services/*.js backend wrappers —
  Bearer auth, refresh, error helpers.
scope: frontend
related_skills:
  - frontend/SKILL
  - authentication/jwt-refresh-session
  - backend/routers-services-schemas
primary_files:
  - frontend/lib/apiClient.js
  - frontend/services/authService.js
  - frontend/services/agentService.js
---

# Services & API client

## Purpose

All browser→API traffic should go through `apiClient` + domain `services/*.js` so refresh and base URL stay consistent.

## Location

- `frontend/lib/apiClient.js` — axios instance, `NEXT_PUBLIC_API_BASE_URL`, Authorization header, 401→`POST /api/auth/refresh`
- `frontend/services/*.js` — `authService`, `agentService`, `messageService`, `learningService`, `orgFrameworkService`, …
- Tokens persisted via `authService` (`localStorage` + cookie mirror for proxy)

## Entry Points

Any page/hook imports a service function (e.g. `sendAgentMessage`, `globalSearch`).

## Data Flow

```
serviceFn(args)
  → apiClient.request
  → Bearer access_token
  → 401 → refreshSession → retry
  → map errors via getApiErrorMessage patterns
```

## Business Rules

- Contract drift fails at **runtime** (no shared codegen) — update FE when backend schemas change.
- Prefer existing service modules over new one-off clients.
- Rare direct `fetch` (e.g. agent bulk-invite) must still send auth and use same base URL.

## Permissions

Client attaches whatever token is stored; server enforces roles/capabilities.

## APIs (real)

Refresh path: `POST /api/auth/refresh`. All other domain paths as documented in domain skills.

## Important Files

- `apiClient.js`
- `authService.js` (session + many dashboard helpers)
- Domain services co-located under `frontend/services/`

## Modification Guide

1. New endpoint → add named export in the right `services/*.js` file.
2. Response shape change → update all callers in same PR.
3. Keep error toast messages user-safe (no stack traces).

## Do Not Break

- Refresh single-flight / retry behavior in `apiClient`.
- `clearLocalSession` on logout (including mascot keys).
- Base URL env for local vs docker.

## Testing

- Expire access token → refresh recovers session.
- Logout → subsequent API calls unauthenticated.
- `npm run build` after service renames (grep callers).

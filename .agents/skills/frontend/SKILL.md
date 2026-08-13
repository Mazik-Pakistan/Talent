---
name: frontend
description: >-
  TalentAI Next.js frontend patterns — role shells, proxy PUBLIC_PATHS, services
  API client, forms/toasts/hooks. Use when changing app router UI infrastructure.
scope: frontend
related_skills:
  - frontend/shells-nav-proxy
  - frontend/services-api-client
  - frontend/forms-toasts-hooks
  - ai-frontend/SKILL
primary_files:
  - frontend/proxy.js
  - frontend/lib/apiClient.js
  - frontend/services/
  - frontend/hooks/
---

# Frontend (overview)

## Purpose

Shared Next.js 16 / React 19 conventions: shells, cookie gate, axios client, service wrappers, hooks.

## Location

| Area | Path |
|------|------|
| Pages | `frontend/app/` |
| Shells | `components/{recruiter,employee,candidate,super-admin}/*Shell.js` |
| Nav | `recruiterNav.js`, `utils/employeeNav.js`, `utils/candidateNav.js` |
| Proxy | `frontend/proxy.js` |
| API | `lib/apiClient.js` + `services/*.js` |
| Hooks | `frontend/hooks/` |
| Shared CSS | `components/shared/shell/*.module.css` |

## Entry Points

Authenticated dashboards via proxy cookie `access_token`; public paths allowlisted.

## Data Flow

```
Page → services/*.js → apiClient (Bearer + refresh) → FastAPI
proxy.js gates unmatched private routes to /login
```

## Business Rules

- Never raw `axios`/`fetch` to backend from pages (except rare documented cases like agent bulk-invite).
- Recruiter nav items capability-gated.
- New public top-level routes must be added to `PUBLIC_PATHS` / `PUBLIC_EXTENSIONS`.

## Permissions

UI gates via `rbac.js` / `hasCapability` — **backend still authoritative**.

## APIs (real)

All via `NEXT_PUBLIC_API_BASE_URL`. Refresh: `POST /api/auth/refresh`.

## Important Files

- `proxy.js`, `apiClient.js`, `authService.js`
- Shell hooks: `useUserSession`, `useLogout`, `useSidebarCollapse`, `useNotificationsCenter`, `useGlobalSearch`, `useRoleSwitch`

## Modification Guide

1. New page under role dashboard → wire nav + capability if recruiter.
2. New API → add `services/*.js` function first.
3. Shared shell behavior → edit hooks / shared CSS once.

## Do Not Break

- `PUBLIC_PATHS` including `/portal-root-x9f3` and token public flows (`/invite`, `/offer`, `/it-setup`, `/it-support`, …).
- Service-layer indirection.
- CORS note is backend — don’t “fix” casually from FE assumptions.

## Testing

- `npm run lint` / `npm run build`
- Manual: logged-out private route redirects; public routes load.

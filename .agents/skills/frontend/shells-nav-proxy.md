---
name: shells-nav-proxy
description: >-
  TalentAI role shells, nav configs, shared shell CSS, and proxy.js PUBLIC_PATHS
  cookie gate including /portal-root-x9f3.
scope: frontend
related_skills:
  - frontend/SKILL
  - super-admin/portal-login
  - authorization/recruiter-capabilities
primary_files:
  - frontend/proxy.js
  - frontend/components/recruiter/RecruiterShell.js
  - frontend/components/recruiter/recruiterNav.js
  - frontend/components/shared/shell/
---

# Shells, nav & proxy

## Purpose

Keep chrome consistent and auth gating correct when adding routes or nav items.

## Location

| Shell | Path |
|-------|------|
| Recruiter | `RecruiterShell.js` + `recruiterNav.js` |
| Employee | `EmployeeShell.js` + `utils/employeeNav.js` |
| Candidate | `CandidateShell.js` + `utils/candidateNav.js` |
| Super Admin | `SuperAdminShell.js` |
| Shared CSS | `components/shared/shell/*.module.css` (`composes:`) |
| Proxy | `frontend/proxy.js` |

## Entry Points

Every dashboard page wraps its role shell. Proxy runs on matched routes before page render.

## Data Flow

```
Request path
  → if no access_token cookie and path not public → redirect /login
  → else page → Shell → nav filtered by role/capabilities
```

## Business Rules

**`PUBLIC_PATHS` includes:** `/login`, `/register`, `/forgot-password`, `/reset-password`, `/set-password`, `/verify-email`, `/invite`, `/onboarding`, `/documents`, `/offer`, `/it-setup`, `/it-support`, `/portal-root-x9f3`, `/terms`, `/privacy-policy`, `/employee-handbook`, `/_next`, `/favicon.ico` (+ `PUBLIC_EXTENSIONS`).

- Sidebar collapse / session / notifications / logout / recruiter search live in hooks — edit once.
- Do not link Super Admin portal from public nav.

## Permissions

Recruiter nav respects capabilities; page map in `recruiterPageCapabilities.js`.

## APIs (real)

Shells call notifications/search/session endpoints via services/hooks.

## Important Files

- `proxy.js`
- `*Shell.js`, `*Nav.js`
- `hooks/useSidebarCollapse.js`, `useUserSession.js`, `useLogout.js`, `useNotificationsCenter.js`, `useGlobalSearch.js`

## Modification Guide

1. New **public** route → `PUBLIC_PATHS`.
2. New recruiter page → nav item + capability key + page capability map.
3. Identical shell CSS → shared module `composes:` instead of third copy.

## Do Not Break

- Portal path public allowlist.
- Token public flows (`/invite`, `/offer`, `/it-*`).
- Cookie name `access_token` expected by proxy.

## Testing

- Logged-out: each public path loads; private redirects.
- Cap-off recruiter: nav item hidden and direct URL blocked by API.
- Collapse state persists per existing hook behavior.

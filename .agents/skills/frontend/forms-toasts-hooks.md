---
name: forms-toasts-hooks
description: >-
  TalentAI frontend form feedback, react-toastify patterns, and shared dashboard
  hooks. Use when changing validation UX or shell hooks.
scope: frontend
related_skills:
  - frontend/SKILL
  - frontend/shells-nav-proxy
primary_files:
  - frontend/lib/formFeedback.js
  - frontend/hooks/
---

# Forms, toasts & hooks

## Purpose

Keep validation and shell side effects consistent across roles.

## Location

- Field errors: `frontend/lib/formFeedback.js` (`FieldError`)
- Toasts: **react-toastify** (`toast.error`, `toast.success`)
- API errors: `getApiErrorMessage(err, fallback)` pattern in services/pages
- Hooks: `useUserSession`, `useLogout`, `useSidebarCollapse`, `useNotificationsCenter`, `useGlobalSearch`, `useRoleSwitch`, …

## Entry Points

Forms on auth + dashboard pages; shells subscribe to hooks.

## Data Flow

```
Submit → service call
  → success: toast.success only after backend confirms
  → field validation: inline FieldError
  → operation failure: toast.error(getApiErrorMessage(...))
```

## Business Rules

- Prefer inline field errors for input problems; toasts for operation failures.
- Do not toast success before the API succeeds.
- Loading/empty/error states follow each page’s existing pattern (no new design system).

## Permissions

N/A — presentation only.

## APIs (real)

Hooks call existing services (notifications, search, auth).

## Important Files

- `formFeedback.js`
- `frontend/hooks/*.js`
- Toast container setup in layout/shell if present

## Modification Guide

1. New shared shell behavior → one hook, all shells consume.
2. New form → reuse FieldError + existing input styles.
3. Avoid adding `useMemo`/`useCallback` by default; follow repo React Compiler guidance.

## Do Not Break

- Notifications poll cleanup on unmount.
- Logout clears session + mascot keys.
- Shared hook signatures used by multiple shells.

## Testing

- Invalid form shows inline error without success toast.
- Failed API shows toast with backend detail when safe.
- Hook change verified in recruiter + employee shells.

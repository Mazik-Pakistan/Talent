# Backend Refactor — Shared Auth Dependencies

## What changed

Eight routers (`app/api/dashboard.py`, `documents.py`, `employees.py`,
`it_provisioning.py`, `learning.py`, `messages.py`, `offers.py`,
`talent.py`) each independently re-declared the exact same
`Annotated[CurrentUser, Depends(require_roles(...))]` combinations at the
top of the file — verified byte-for-byte identical, not just
similarly-named:

- `RequireRecruiter` — `require_roles("recruiter", "super_admin")` — in all 8 files
- `RequireEmployee` — `require_roles("employee", "super_admin")` — in 5 files
- `RequireAny` — `require_roles("employee", "recruiter", "super_admin")` — in 3 files
- The `onboarding.self`-permission dependency — identical in `dashboard.py`
  (named `RequireOnboardingSelf`) and `employees.py` (named
  `RequireCandidate`)

These are now defined once in `app/core/security.py` (next to the
`require_roles`/`require_permissions` factories and the existing
`RequireUser` alias, so the pattern is consistent), and every router
imports them instead of redeclaring.

## What did NOT get merged, on purpose

Two router-local dependencies are both named `RequireCandidate` but check
**different** things:
- `employees.py`'s `RequireCandidate` = `require_permissions("onboarding.self")`
- `offers.py`'s `RequireCandidate` = `require_roles("candidate", "super_admin")`

Same name, different rule. I did not unify these under one shared name —
that would silently change which check one of the two routers enforces.
`employees.py`'s version is imported from the shared
`RequireOnboardingSelf` (aliased locally back to `RequireCandidate` so call
sites don't change); `offers.py`'s stays as a local declaration with a
comment explaining why, so a future editor doesn't "simplify" it into the
wrong shared one.

Similarly, `documents.py`'s `RequireSelf`
(`require_roles("candidate", "employee", "super_admin")`) is unique to that
router and was left local.

Unused imports (`Annotated`, `Depends`, `CurrentUser`, `require_roles`,
`require_permissions`) were removed from each router only where nothing
else in that file still used them — verified individually per file before
removing, not assumed.

## Verified

- `app.main` imports cleanly end-to-end (all 8 edited routers + everything
  that depends on them).
- Hit `/openapi.json` via `starlette.testclient.TestClient` and confirmed
  all 148 API paths are still registered, including every endpoint in the
  8 edited routers, with the same HTTP methods as before.
- Ran the existing test suite (`tests/`): 16 passed, 1 failed both before
  and after this refactor — the failing test has a hardcoded
  `start_date: "2026-07-31"` that is now in the past relative to today's
  date, unrelated to anything touched here. Confirmed identical failure on
  the untouched original backend, so this refactor introduces zero
  regressions.

## Scope note

`agent_tools.py` / `agent_tools_parity.py` look like a duplication
candidate from the names alone, but `agent_tools_parity.py`'s docstring
says it's intentionally split out ("Additional agent tools for full
dashboard parity (P1–P3) ... Imported and merged by agent_tools.py") — a
deliberate modularization, not redundant code. Left as-is.

The service layer (`app/services/*.py`, ~31.7k lines) is unaudited beyond
the `require_roles`/`require_permissions` scan documented above — that's a
much larger investigation (business logic across candidate/employee/
recruiter services) better scoped as its own pass rather than folded into
this one.

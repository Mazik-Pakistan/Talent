# Frontend architecture

Next.js **App Router** (Next 16) + React 19. Auth is gated by `frontend/proxy.js`; API calls go through axios wrappers, never ad-hoc `fetch` in pages for domain APIs.

```
related_skills: authentication/, frontend-ui/, offers/, learning/
```

## App Router layout

| Area | Path |
|------|------|
| Public / token flows | `frontend/app/login`, `register`, `invite/[token]`, `onboarding`, `documents`, `offer`, `it-setup/...`, `it-support/[token]`, `portal-root-x9f3` |
| Role dashboards | `frontend/app/dashboard/{recruiter\|candidate\|employee\|super-admin}/...` |
| AI assistant pages | `.../ai-assistant/page.js` per role |
| Shared chrome | `frontend/components/{recruiter\|candidate\|employee\|super-admin}/*Shell.js` |

Role home routes match `ROLE_HOME` in `backend/app/core/rbac.py`.

## `proxy.js` auth gate

File: `frontend/proxy.js` (Next middleware-style export `proxy` + `config.matcher`).

**PUBLIC_PATHS** (exact + `prefix/` for most entries):

`/login`, `/register`, `/forgot-password`, `/reset-password`, `/set-password`, `/verify-email`, `/invite`, `/onboarding`, `/documents`, `/offer`, `/it-setup`, `/it-support`, `/portal-root-x9f3`, `/terms`, `/privacy-policy`, `/employee-handbook`, `/_next`, `/favicon.ico`

**PUBLIC_EXTENSIONS**: static assets (`.png`, `.svg`, `.js`, `.css`, fonts, …).

Rule: no `access_token` cookie + non-public path → redirect `/login`.

Adding a new **public** top-level route requires listing it in `PUBLIC_PATHS`. Authenticated dashboard routes are covered by default.

## Services pattern

- Thin wrappers under `frontend/services/`: `authService.js`, `talentService.js`, `learningService.js`, `orgFrameworkService.js`, `careerService.js`, `messageService.js`, `agentService.js`, `rbac.js`.
- HTTP client: `frontend/lib/apiClient.js` — `NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:8000`), Bearer from localStorage, refresh on 401 via `/api/auth/refresh`.
- Pages/components should call services (or shared helpers that use `apiClient`), not invent parallel clients.

There is **no** OpenAPI/type sync with backend — keep request/response shapes aligned manually with `backend/app/schemas/`.

## Shells & navigation

| Shell | File |
|-------|------|
| Recruiter | `components/recruiter/RecruiterShell.js` |
| Employee | `components/employee/EmployeeShell.js` |
| Candidate | `components/candidate/CandidateShell.js` |
| Super admin | `components/super-admin/SuperAdminShell.js` |
| AI page shell | `components/ai/AssistantPageShell.js` |

Shared shell CSS: `components/shared/shell/shell-base.module.css` + `workspace-shell.module.css` via CSS Modules **`composes:`**. Role-specific tokens live in e.g. `recruiter-shell.module.css` (`:root` vars).

Nav helpers: `utils/employeeNav.js`, `utils/candidateNav.js`. Dual-role UI: `components/shared/shell/RoleSwitchButton.js` + `hooks/useRoleSwitch.js`.

## Hooks (centralized shell behavior)

| Hook | Purpose |
|------|---------|
| `useUserSession` | Read `localStorage.user`; optional pathname / event resync |
| `useSidebarCollapse` | Sidebar collapse state |
| `useNotificationsCenter` | Notifications fetch/mark-read |
| `useLogout` | Clear session + cookie |
| `useRoleSwitch` | Call `/api/auth/switch-role`, persist new tokens |
| `useGlobalSearch` | Recruiter global search |
| `useDocumentProcessing` | OCR / document UX |
| `useOrgFrameworkOptions` | Org framework dropdown data |
| `useTalentIntelligenceData` | Talent page data |

Edit hooks once — do not fork per shell.

## `lib/ai` vs product agent

| Surface | Path | Role |
|---------|------|------|
| Context / insights builders | `frontend/lib/ai/*Context.js`, `*Insights.js`, field help, OCR helpers | Feed floating orb / guide UX |
| AI experience components | `frontend/components/ai-experience/` (`AiOrb`, OCR overlays, guides) | In-page UX chrome |
| Full agent chat | `components/ai/AgentChatCore.js` + dashboard `ai-assistant` pages | Calls `/api/agent/*` via `agentService.js` |
| Recruiter mascot brief | Dashboard overview → `POST /api/dashboard/recruiter-mascot/brief` | Short LLM brief, not the tool loop |

Mascot ≠ hiring agent. Do not route mascot calls through the agent tool loop.

## State: localStorage + cookie

Persisted by `authService` (and refresh interceptor):

- `access_token`, `refresh_token`, `token_expires_at`, `user`
- Cookie mirror: `access_token` (and optionally `refresh_token`) for `proxy.js`

Clear via `clearLocalSession` / `useLogout`. Cross-tab sync: `storage` + custom `talent-user-updated` events (see `useUserSession` options).

## Design tokens

Primary dashboard palette: CSS variables in role shell CSS (e.g. `--navy`, `--blue`, `--bg`, `--card`, `--radius`, `--shadow`). AI theme extras: `frontend/app/ai-theme.css` (`--ai-*`). Prefer existing vars over new one-off colors.

## Toast & form patterns

- Toasts: `react-toastify` (`toast.success` / `error` / `warn` / `info`), often with stable `toastId` to avoid duplicates.
- Errors: prefer `getApiErrorMessage(err, fallback)` where already used.
- Forms: controlled inputs in page components; AI-assisted fill helpers in `lib/ai` (`typewriterFill`, `useAutoSave`, `formCoach`) — use existing patterns on onboarding/profile pages.

## Agent checklist

1. New authenticated page → under `app/dashboard/{role}/`, wrap with the role shell.
2. New public page → add to `PUBLIC_PATHS`.
3. New API call → extend the right `services/*.js` file.
4. Shared chrome change → hooks / `shared/shell` CSS, not three copies.

---
name: mascot-insights-context
description: >-
  TalentAI per-role AI context, insights, field help, and memory builders under
  frontend/lib/ai. Use when changing mascot tips or page-aware coaching.
scope: ai-frontend
related_skills:
  - ai-frontend/SKILL
  - ai-frontend/ai-experience-components
primary_files:
  - frontend/lib/ai/recruiterContext.js
  - frontend/lib/ai/recruiterInsights.js
  - frontend/lib/ai/candidateContext.js
  - frontend/lib/ai/candidateInsights.js
  - frontend/lib/ai/employeeInsights.js
  - frontend/lib/ai/superAdminInsights.js
---

# Mascot insights & context

## Purpose

Build page-aware tips and field help for the floating partner. These are **not** agent tools.

## Location

| Role | Context | Insights | Field help | Memory |
|------|---------|----------|------------|--------|
| Recruiter | `recruiterContext.js` | `recruiterInsights.js` → `buildRecruiterInsights` | `recruiterFieldHelp.js` | `recruiterMemory.js` |
| Candidate | `candidateContext.js` | `candidateInsights.js` | `candidateFieldHelp.js` | `candidateMemory.js` |
| Employee | `guideContext.js` | `employeeInsights.js` | `employeeFieldHelp.js`, `fieldHelp.js` | session keys in `guideContext.js` |
| Super Admin | `superAdminContext.js` | `superAdminInsights.js` | `superAdminFieldHelp.js` | in context file |

Shared: `contextScope.js`, `formCoach.js`, `sources.js`, `onboardingPlan.js`, `openAiAssistant.js`, `documentProcessing.js`, `documentStatusInsights.js`.

## Entry Points

Role `*Mascot` components call builders with current route + dashboard props.

## Data Flow

```
Route + fetched dashboard data
  → build*Context / build*Insights / field help maps
  → BaseMascot / role mascot UI
Optional recruiter: POST /api/dashboard/recruiter-mascot/brief → LLM brief
```

## Business Rules

- Insights should cite real page state (counts, missing fields), not invent backend facts.
- `openAiAssistant` only seeds and navigates to `/ai-assistant` — it does not run tools in-place.
- Logout clears `*_mascot_*` session keys via `authService`.

## Permissions

Client-only; any sensitive action must still hit authenticated APIs elsewhere.

## APIs (real)

- Recruiter brief: `POST /api/dashboard/recruiter-mascot/brief` (`recruiter_mascot_service.py`)

## Important Files

- `frontend/lib/ai/*`
- `frontend/components/{role}/*Mascot.js`
- `backend/app/services/recruiter_mascot_service.py`

## Modification Guide

1. Add route scopes in context builders when new pages need tips.
2. Keep insight copy short; prefer linking to the agent page for multi-step work.
3. If a new tool should be reachable from a dashboard assistant, update Context/Insights **and** backend tools.

## Do Not Break

- Do not turn insights into a second tool-calling agent.
- Preserve sessionStorage key names used by memory helpers unless migrating all readers.

## Testing

- Navigate key recruiter/candidate/employee pages — tips match page.
- Field focus shows field help where mapped.
- Logout clears mascot memory keys.

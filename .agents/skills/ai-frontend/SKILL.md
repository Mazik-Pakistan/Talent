---
name: ai-frontend
description: >-
  TalentAI frontend AI UX — floating mascot vs full-page agent, lib/ai context
  and insights, ai-experience components. Use when changing mascots, insights,
  or ai-assistant pages (not backend tool loop).
scope: ai-frontend
related_skills:
  - ai-frontend/mascot-insights-context
  - ai-frontend/ai-experience-components
  - ai-frontend/agent-chat-pages
  - ai-agent/SKILL
  - llm/SKILL
primary_files:
  - frontend/components/ai/Agentchatwidget.js
  - frontend/components/ai/AgentChatCore.js
  - frontend/lib/ai/
  - frontend/components/ai-experience/
  - frontend/app/layout.js
---

# AI Frontend (overview)

## Purpose

Two product AI surfaces on the frontend:

| System | Where | Backend |
|--------|-------|---------|
| **Autonomous agent** | `/dashboard/*/ai-assistant` only | `/api/agent/*` |
| **Floating mascot / partner** | Global FAB via root layout | Mostly client rules; recruiter optional `POST /api/dashboard/recruiter-mascot/brief` |

Mascot ≠ agent. Do not wire tool-calling into the floating widget.

## Location

| Area | Path |
|------|------|
| Mascot router | `frontend/components/ai/Agentchatwidget.js` |
| Agent chat | `frontend/components/ai/AgentChatCore.js`, `AssistantPageShell.js` |
| Context/insights | `frontend/lib/ai/*` |
| Shared chrome | `frontend/components/ai-experience/*` |
| Role mascots | `components/{recruiter,candidate,employee,super-admin}/*Mascot.js` |
| Base | `frontend/components/mascot/BaseMascot.js` |

## Entry Points

1. `app/layout.js` mounts `AgentChatWidget` (hidden on auth pages and `/ai-assistant`).
2. Role dashboard → `*/ai-assistant` pages mount canvas agent chat.
3. `openAiAssistant.js` seeds `sessionStorage` key `ai_assistant_seed_prompt_v1` then navigates.

## Data Flow

```
Floating: page data → lib/ai *Context/*Insights → *Mascot UI (tips/field help)
Agent page: AgentChatCore → agentService → /api/agent/chat → tool loop
```

## Business Rules

- Hide floating widget on `/login`, `/register`, forgot/reset/verify, `/`, and any path containing `/ai-assistant`.
- Agent confirmation/actions UI lives on agent pages, not mascot.
- Insights builders are client-side; do not treat them as security boundaries.

## Permissions

Agent pages respect same session/role as the rest of the dashboard. Recruiter agent requires backend capability `assistant`.

## APIs (real)

| Client | Endpoint |
|--------|----------|
| `agentService.js` | `/api/agent/chat`, `/sessions`, `/history`, `/reset`, `/recruiter/bulk-invite` |
| `authService.getRecruiterMascotBrief` | `POST /api/dashboard/recruiter-mascot/brief` |

## Important Files

- `Agentchatwidget.js` — role mascot switch + hide rules
- `frontend/lib/ai/{recruiter,candidate,employee,superAdmin}{Context,Insights,FieldHelp}.js`
- `frontend/services/agentService.js`

## Modification Guide

1. New insight → role Insights + Context files; keep mascot copy short.
2. New agent UI affordance → `AgentChatCore` + response fields from backend.
3. Never call `/api/agent/chat` from the floating mascot.

## Do Not Break

- Separation of mascot vs autonomous agent.
- Hide-on-`/ai-assistant` rule (avoids double AI UI).
- Seed prompt sessionStorage contract for deep-links into the agent page.

## Testing

- Each role: mascot visible on dashboard, hidden on ai-assistant.
- Agent page: send message, confirm card, session reset.
- `npm run lint` on touched frontend files.

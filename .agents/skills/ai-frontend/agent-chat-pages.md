---
name: agent-chat-pages
description: >-
  TalentAI full-page AI assistant routes — AgentChatCore canvas, session APIs,
  seed prompts, per-role ai-assistant pages. Use when changing agent chat UI.
scope: ai-frontend
related_skills:
  - ai-frontend/SKILL
  - ai-agent/SKILL
  - ai-agent/confirm-gate
primary_files:
  - frontend/app/dashboard/recruiter/ai-assistant/page.js
  - frontend/app/dashboard/candidate/ai-assistant/page.js
  - frontend/app/dashboard/employee/ai-assistant/page.js
  - frontend/app/dashboard/super-admin/ai-assistant/page.js
  - frontend/components/ai/AgentChatCore.js
  - frontend/services/agentService.js
---

# Agent chat pages

## Purpose

Full-page autonomous agent UI (`variant="canvas"`). Only place that should drive the tool-calling backend loop.

## Location

| Route | Page |
|-------|------|
| `/dashboard/recruiter/ai-assistant` | recruiter page |
| `/dashboard/candidate/ai-assistant` | candidate page |
| `/dashboard/employee/ai-assistant` | employee page |
| `/dashboard/super-admin/ai-assistant` | super-admin page |

Shell: `AssistantPageShell` + role shell. Core: `AgentChatCore.js`. API: `frontend/services/agentService.js`.

## Entry Points

1. Nav / mascot “open assistant” → `openAiAssistant.js` sets `ai_assistant_seed_prompt_v1` → navigate.
2. User messages → `sendAgentMessage` → `POST /api/agent/chat`.
3. History/sessions/reset via matching service helpers.

## Data Flow

```
page → AgentChatCore
  → listAgentSessions / getAgentHistory / sendAgentMessage / resetAgentSession
  → render reply, suggested_replies, ui_hint, attachment, confirmation
  → Approve → sendAgentMessage("__CONFIRM__:" + JSON)
```

## Business Rules

- Floating mascot is hidden on these routes.
- Handle `confirmation` with Approve/Cancel UI — do not auto-confirm.
- Recruiter without `assistant` capability should not reach a working chat (backend 403).

## Permissions

Same as `/api/agent/*`. Recruiter: capability `assistant`.

## APIs (real)

| Method | Path | Client helper |
|--------|------|---------------|
| POST | `/api/agent/chat` | `sendAgentMessage` |
| GET | `/api/agent/sessions` | `listAgentSessions` |
| GET | `/api/agent/history` | `getAgentHistory` |
| POST | `/api/agent/reset` | `resetAgentSession` |
| POST | `/api/agent/recruiter/bulk-invite` | `bulkInviteSpreadsheet` |

## Important Files

- `AgentChatCore.js`, `AssistantPageShell.js`
- `frontend/lib/ai/openAiAssistant.js`
- `frontend/services/agentService.js`

## Modification Guide

1. New response fields → update `AgentChatCore` render + types/comments.
2. Keep seed prompt key stable or migrate both writer and reader.
3. Bulk-invite UI stays recruiter-scoped.

## Do Not Break

- Confirm prefix protocol with backend.
- Session scoping by `session_id` + user.
- Do not mount a second agent loop in the floating widget.

## Testing

- Send chat, refresh page, history restores.
- Reset clears session.
- Confirm flow end-to-end on a gated tool.
- Seed from mascot lands with prefilled prompt.

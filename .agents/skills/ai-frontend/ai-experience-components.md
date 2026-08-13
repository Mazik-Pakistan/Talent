---
name: ai-experience-components
description: >-
  TalentAI shared AI experience UI — AiOrb, confirm card, OCR panels, field
  chrome under components/ai-experience. Use when changing AI visual building blocks.
scope: ai-frontend
related_skills:
  - ai-frontend/SKILL
  - ai-frontend/agent-chat-pages
  - ocr-extraction/SKILL
primary_files:
  - frontend/components/ai-experience/index.js
  - frontend/components/ai-experience/AiOrb.js
  - frontend/components/ai-experience/AiConfirmCard.js
---

# AI experience components

## Purpose

Reuse shared visual/UX primitives for agent chat and document AI overlays. Prefer exports from `ai-experience/index.js`.

## Location

`frontend/components/ai-experience/`

**Exports (`index.js`):** `AiOrb`, `AiThinkingDots`, `AiSourceBadge`, `AiField`, `AiCheckRow`, `AiActivityPanel`, `AiConfirmCard`, `AiSaveToast`, `BankSlipScanner`, `DocumentOcrPanel`, `OcrScanOverlay`, `EmployeeAiGuide`

Also: `DocumentProcessingOverlay.js`, `DocumentProcessingActivity.js`, `DocumentProcessingSteps.js`, `AnimatedNumber.js`, `icons.js`, CSS modules.

## Entry Points

Imported by agent chat, onboarding/doc flows, and mascot-adjacent UI. `EmployeeAiGuide` is exported but historically not widely mounted — live floating partner is role `*Mascot` via `AgentChatWidget`.

## Data Flow

```
Parent page/chat
  → ai-experience presentational components
  → callbacks to parent (save, confirm, retry OCR)
```

No direct API calls inside most of these components.

## Business Rules

- Confirm cards display backend `confirmation.summary` — do not invent confirm copy that disagrees with the tool.
- OCR overlays must tolerate `ENABLE_OCR` off / extraction failure (parent handles errors).

## Permissions

N/A (presentational); parents enforce auth.

## APIs (real)

None directly — parents use document/agent services.

## Important Files

- `frontend/components/ai-experience/index.js`
- Consumers: `AgentChatCore.js`, document/onboarding pages

## Modification Guide

1. Add new shared chrome here only if used by 2+ surfaces.
2. Keep CSS modules co-located; match existing motion density (presence, not noise).
3. Export from `index.js` when public.

## Do Not Break

- `AiConfirmCard` contract with agent `confirmation` payload.
- Export names used across onboarding/agent.

## Testing

- Visual: orb/thinking states during agent wait.
- Confirm Approve/Cancel callbacks fire once.
- `npm run lint` on touched components.

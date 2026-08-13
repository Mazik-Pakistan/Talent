# AI systems

Two related but distinct AI surfaces: the **hiring/onboarding agent** (tool loop over services) and **learning / mascot / frontend orb** helpers.

```
related_skills: authentication/, authorization/, learning/, offers/
```

## Product agent loop

Orchestrator: `backend/app/services/agent_service.py`.

1. Build prompt: role system prompt + `SHARED_AGENT_RULES` + tool catalog + state snapshot + last `HISTORY_TURNS` (8) + user message.
2. LLM returns **strict JSON** via `call_llm_json` (`llm_service.py`) — either one tool call or a final reply.
3. Tool executes against **existing permission-checked services** (via `agent_tools`).
4. Loop bounded by **`MAX_TOOL_STEPS = 4`**.
5. Persist turn in `agent_conversations`; return reply + light `ui_hint` / `suggested_replies`.

API: `backend/app/api/agent.py` → `/api/agent/chat`, `/sessions`, `/history`, `/reset`, `/recruiter/bulk-invite`.

### Shared rules (do not weaken)

- No raw routes/paths in prose (`/offer`, `offer_page=`, …).
- Never expose passwords/OTPs.
- Confirm before destructive/irreversible tools.
- Do not re-call the same **read-only** tool twice in one turn.

## Tool file split (intentional)

| File | Contents |
|------|----------|
| `agent_tools.py` | Core tools, `SELF_SERVE_TOOLS`, `RECRUITER_TOOLS` base, role list assembly |
| `agent_tools_parity.py` | Dashboard-parity extras → `RECRUITER_PARITY_TOOLS`, `CANDIDATE_PARITY_TOOLS`, `EMPLOYEE_PARITY_TOOLS` |
| `agent_tools_super_admin.py` | `SUPER_ADMIN_TOOLS` (lazy-loaded) |

Role lists (assembled in `agent_tools.py`):

- `RECRUITER_TOOLS` += parity
- `CANDIDATE_TOOLS` = self-serve + candidate parity
- `EMPLOYEE_TOOLS` = self-serve + employee parity
- Super admin → super-admin tools **plus** recruiter tools

**Do not merge** core and parity modules “for cleanup.”

### Adding a tool

1. Implement calling a real service (extend service if needed).
2. Register on the correct role list.
3. If read-only, add name to **`READONLY_TOOLS`** in `agent_service.py`.
4. Respect the same RBAC the REST endpoint uses.

Current `READONLY_TOOLS` includes: `get_status`, `get_my_offer`, `get_my_profile`, `list_documents`, `list_candidate_documents`, `list_person_documents`, `list_candidates`, `list_employees`, `get_candidate_status`, `get_employee_detail`, `get_dashboard_summary`, `my_learning_dashboard`, `list_opportunities`, `list_my_announcements`, `list_notifications`, `list_hr_threads`, `get_my_day1_info`.

## `llm_service.py`

- Primary: OpenAI-compatible HTTP (`OPENROUTER_*` — OpenRouter **or** OmniRoute by pointing `OPENROUTER_BASE_URL`).
- Fallback: Gemini (`GEMINI_API_KEY`, `GEMINI_MODEL`) if primary fails/missing.
- `llm_configured()` — true if either key present.
- `call_llm_json(prompt)` — parse/salvage JSON; used by agent + other AI features.

## Fallbacks

If no LLM key / LLM fails hard: `_fallback_reply` in `agent_service.py` still answers **status-style** questions deterministically so the feature degrades instead of 500ing. Preserve this path when editing the chat entrypoint.

## Learning AI

`backend/app/services/learning_ai_service.py` (also via learning routes/services):

- `rank_recommended_courses`
- `analyze_skill_gap`
- `build_skill_matrix`
- `extract_skills_from_certificate`
- `predict_promotion_readiness`

Uses the same LLM client. Persisted artifacts: `learning_ai_recommendations`, skill gap/assessment collections, etc.

## Frontend: mascot vs agent pages

| Surface | Where | Backend |
|---------|-------|---------|
| Full agent chat | `app/dashboard/*/ai-assistant/page.js` + `AgentChatCore.js` | `/api/agent/*` |
| Recruiter mascot brief | Recruiter overview | `POST /api/dashboard/recruiter-mascot/brief` → `recruiter_mascot_service.py` |
| Orb / field help / OCR UX | `components/ai-experience/*`, `lib/ai/*` | Often local heuristics + occasional LLM; **not** the tool loop |
| Employee AI guide / coach pages | `ai-coach`, guides | Legacy coach collections still indexed; prefer current learning/agent patterns |

Capability `assistant` gates recruiter assistant module access.

## OCR / embeddings (adjacent)

- `document_extraction_service.py`, `ocr_service.py` — `ENABLE_OCR`
- `embedding_service.py` — `ENABLE_EMBEDDINGS` (default false)
- Lazy imports — do not hard-import heavy libs at module top in `main`.

## Agent checklist

1. New agent capability → service first, then tool, then role list + READONLY if needed.
2. Keep `MAX_TOOL_STEPS = 4` unless product explicitly raises it.
3. Never teach the model to dump raw dashboard paths.
4. Test with LLM keys **unset** to verify fallback still works.

# `.agents/` — TalentAI AI engineering knowledge layer

This directory is the **fine-grained knowledge system** for AI coding agents working in TalentAI.

| Path | Role |
|------|------|
| [`AGENTS.md`](AGENTS.md) | Master instructions (architecture rules, security, AI, validation) |
| [`architecture/`](architecture/) | Cross-cutting architecture (system, API, DB, auth, AI, integrations, dependency map) |
| [`skills/`](skills/) | Module skills — load only what the task needs |
| [`skills/README.md`](skills/README.md) | Skill index / navigation |

Root [`../AGENTS.md`](../AGENTS.md) remains the short workspace field guide and points here for depth.

## How agents should use this

1. Read `AGENTS.md` (or root short guide).
2. Open `skills/README.md` → load matching `SKILL.md` (+ child files).
3. Skim related `architecture/*.md` if the change crosses layers.
4. **Verify against live code** — docs can lag; the repository wins.
5. Implement the smallest correct change; validate; do not weaken auth/tenancy.

## Non-goals

- This is documentation for coding agents — not application runtime config.
- Do not invent APIs, collections, or permissions here; update docs when code changes.

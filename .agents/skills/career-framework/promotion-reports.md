---
name: career-framework-promotion-reports
description: >-
  Promotion readiness and career progress reports plus CSV import/export under
  /api/career-framework/reports* and /export|/import|/template.
---

# Career Framework — Promotion Reports & CSV

## Purpose

Recruiter reports for promotion readiness and career progress; CSV template/export/import of the framework.

## Location

- Reports: `get_promotion_readiness`, `get_career_progress_report` in `career_framework_service.py`
- CSV: `export_framework_csv`, `import_framework_csv`
- Routes in `backend/app/api/career_framework.py`
- Frontend: `careerService.js`, recruiter career/talent promotion UIs

## Entry Points

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/career-framework/reports/promotion-readiness` | Recruiter talent\|learning |
| GET | `/api/career-framework/reports/career-progress` | Recruiter |
| GET | `/api/career-framework/export` | Recruiter — PlainText CSV |
| POST | `/api/career-framework/import` | Recruiter — multipart/CSV |
| GET | `/api/career-framework/template` | **No auth** (current code) |

## Data Flow

```
Assignments + level requirements + skills/certs/learning
  → promotion-readiness / career-progress reports
export → CSV of tracks/levels
import → parse CSV → upsert tracks/levels (org scoped)
template → static CSV header row for recruiters
```

## Business Rules

- Reports org-scoped only.
- Import must not write into another organization’s tracks.
- Template columns must match import parser (see template string in router).
- Unauthenticated template download is current behavior — changing auth is a product decision.

## Permissions

- Reports/export/import: `RequireRecruiterWithTalentOrLearning`
- Template: currently open

## Real APIs

See Entry Points.

## Important Files

- `backend/app/api/career_framework.py` (template CSV string)
- `backend/app/services/career_framework_service.py`
- `frontend/services/careerService.js`
- `backend/tests/test_career_framework.py`

## Modification Guide

1. Add CSV columns: update template string, export, import parser, and level schema together.
2. Promotion readiness inputs: reuse designation/learning evidence where already integrated.
3. If protecting `/template`, update frontend download call accordingly.

## Do Not Break

- Org-scoped import/export
- Report authorization
- Column compatibility with existing exported files
- Soft-deleted tracks excluded appropriately

## Testing

- Export → import round-trip
- Promotion readiness for assigned employees
- Template downloads
- `test_career_framework.py`

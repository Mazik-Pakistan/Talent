# Database

Motor async MongoDB. Client and DB handle: `backend/app/core/database.py`. **There is no in-memory/mock DB mode** — `MONGODB_URI` + `DATABASE_NAME` are required for boot.

```
related_skills: multi-tenancy/, authentication/, offers/, learning/
```

## Clients

- `mongo_client` / `database` — always initialized from settings.
- `supabase` — optional; only if `SUPABASE_URL` and `SUPABASE_KEY` are set. App file storage is **Cloudinary**-primary (`storage_service.py`).
- `mongodb+srv://` → DNS resolver forced to `8.8.8.8` / `1.1.1.1` to avoid home-router SRV timeouts.
- Transactions: `with_transaction` / `try_transaction` (falls back when replica-set transactions unsupported).

## Index helper

```python
async def _ensure_index(collection, keys, **kwargs) -> None:
    # Ignores Atlas race / conflict codes: 68, 85, 86, 276
```

Always use `_ensure_index` inside `create_database_indexes()` — never raw `create_index` that can abort startup. Partial unique indexes (e.g. learning courses `external_id`+`provider_id`) drop-and-recreate quietly when migrating sparse → partial.

## Tenant field

Most people/ops collections carry **`organization_id`**. Indexes exist on:

`recruiters`, `candidates`, `employees`, `invitations`, plus learning courses, career/org-framework collections, tickets, announcements, etc.

Queries that **list** tenant data must filter by org (or `recruiter_people_scope`) — treat a missing filter like a security bug. See `multi-tenancy.md`.

## Indexed collections by domain

### Identity & auth

| Collection | Notable indexes |
|------------|-----------------|
| `users` | unique `email`, `original_email`, `status` |
| `recruiters` | unique `email`, sparse unique `supabase_user_id`, `organization_id` |
| `candidates` | `email`, `organization_id`, `recruiter_id`, sparse unique `user_id` / `invitation_token` / `supabase_user_id`, conversion/history keys |
| `employees` | `email`, `organization_id`, unique sparse `employee_id`, `iban_hash`, dept/status, `job_title` |
| `super_admins` | unique `email`, sparse unique `supabase_user_id` |
| `organizations` | unique `name`, `slug`, status+created |
| `login_attempts` | unique `email` |
| `pending_users` | (used in purge; OTP signup) |
| `refresh_tokens` | (used in auth/purge) |

### Hiring lifecycle

| Collection | Notable indexes |
|------------|-----------------|
| `invitations` | unique `token`, email+status, recruiter+created, `expires_at`, `organization_id` |
| `offer_letters` | `candidate_id`, status+recruiter, email, invitation_token, negotiation status |
| `audit_logs` | created_at, recruiter+created |
| `documents` | owner+active, owner+doc_type, status |

### IT

| Collection | Notable indexes |
|------------|-----------------|
| `it_provisioning_requests` | unique `token`, offer/candidate+status, `expires_at`, sparse `batch_id` |
| `it_provisioning_batches` | unique `token`, expires, recruiter+created |
| `it_kits` | unique `name` |
| `it_service_requests` | unique `token`, recruiter/employee+status |
| `company_email_password_otps` | unique `user_id`, `otp_expires_at` |

### Learning & skills

| Collection | Notable indexes |
|------------|-----------------|
| `learning_courses` | unique `course_key`, provider/org/archived composites, partial unique external_id+provider_id |
| `learning_providers` | unique name/slug |
| `learning_enrollments` / `learning_assignments` / `learning_certificates` | user/employee/status composites |
| `learning_import_history` | provider/importer/status |
| `learning_career_goals`, `learning_ai_recommendations`, `learning_skill_*`, `learning_role_matches`, `learning_recruiter_profile_cache` | per-user uniques |
| `learning_catalog_cache` | `_id` |
| `employee_skills` | unique user+skill_name |

### Talent & career

| Collection | Notable indexes |
|------------|-----------------|
| `internal_opportunities` / `internal_opportunity_applications` | status, unique opportunity+employee |
| `talent_competency_evaluations`, `talent_development_plans` | employee |
| `career_tracks`, `career_levels`, `employee_career_assignments` | dept/track + `organization_id` |
| `employee_career_events` | employee+effective_date |

### Org framework (per-org SoT)

`org_framework_departments`, `_roles`, `_skills`, `_certifications`, `_courses`, `_roadmaps`, `_promotion_rules`, `_versions` — all keyed by `organization_id` with unique name/id constraints.

### Comms, agent, tickets, misc

| Collection | Notable indexes |
|------------|-----------------|
| `notifications` | recipient+created/read |
| `announcements` | created, org+created |
| `hr_threads` | recruiter/employee + status pair |
| `agent_conversations` | unique `session_id`, user+updated |
| `tickets`, `ticket_replies`, `ticket_activity`, `ticket_audit_logs` | ticket_id unique, org, status… |
| `universities` | unique `normalised_name`, name/country/city |
| `org_email_templates` | org+template_key |
| `kb_chunks`, `ai_coach_*` | legacy AI Coach (router removed; indexes retained) |

## Encryption at rest

`backend/app/core/crypto.py`:

- Fernet via `BANKING_ENCRYPTION_KEY`, or deterministic derive from `SECRET_KEY` if unset.
- `SENSITIVE_BANKING_FIELDS`: `account_number`, `iban`, `swift_code`.
- `iban_hash` (SHA-256 fingerprint) for uniqueness — indexed at `employees.onboarding.employment.iban_hash`.
- Also used for IT temp passwords / provider API secrets (`*_enc` fields).

Never log or return decrypted banking fields outside the designated decrypt/mask paths.

## Agent checklist

1. New collection → add `_ensure_index` entries in `create_database_indexes()`.
2. Tenant data → index + query by `organization_id`.
3. Do not assume empty DB for tests without a live Mongo.

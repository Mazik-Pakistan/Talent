from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo.errors import OperationFailure
from supabase import Client, create_client

from app.core.config import settings

mongo_client = AsyncIOMotorClient(settings.MONGODB_URI)
database: AsyncIOMotorDatabase = mongo_client[settings.DATABASE_NAME]


async def with_transaction(callback):
    session = await mongo_client.start_session()
    try:
        await session.start_transaction()
        await callback(session)
        await session.commit_transaction()
    except OperationFailure:
        await session.abort_transaction()
        raise
    finally:
        await session.end_session()


async def try_transaction(callback):
    try:
        await with_transaction(callback)
    except OperationFailure as exc:
        msg = str(exc).lower()
        if "transaction" in msg or "not supported" in msg or "replica" in msg:
            await callback(None)
        else:
            raise


def _db_kwargs(session):
    return {"session": session} if session is not None else {}

# Optional — app storage uses Cloudinary; only wire Supabase when configured.
supabase: Client | None = None
if settings.SUPABASE_URL and settings.SUPABASE_KEY:
    supabase = create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)

# Index already exists / option conflict / aborted by concurrent drop — do not abort startup.
# 85/86: IndexOptionsConflict / IndexKeySpecsConflict
# 68: IndexAlreadyExists
# 276: IndexBuildAborted (e.g. dropIndexes raced an in-progress create on Atlas)
_INDEX_IGNORE_CODES = {68, 85, 86, 276}


async def _ensure_index(collection, keys, **kwargs) -> None:
    try:
        await collection.create_index(keys, **kwargs)
    except OperationFailure as exc:
        if exc.code in _INDEX_IGNORE_CODES:
            return
        # Atlas sometimes wraps abort reasons without a stable top-level code.
        errmsg = (exc.details or {}).get("errmsg") or str(exc)
        if "IndexBuildAborted" in errmsg or "dropIndexes" in errmsg:
            return
        raise


async def _index_names(collection) -> set[str]:
    try:
        info = await collection.index_information()
        return set(info.keys())
    except Exception:
        return set()


async def _drop_index_quiet(collection, name: str) -> None:
    """Best-effort drop; never fails startup (Atlas races are common)."""
    try:
        await collection.drop_index(name)
    except Exception:
        return


async def create_database_indexes() -> None:
    await _ensure_index(database.recruiters, "email", unique=True)
    await _ensure_index(database.recruiters, "supabase_user_id", unique=True, sparse=True)
    await _ensure_index(database.audit_logs, [("created_at", -1)])
    await _ensure_index(database.audit_logs, [("recruiter_id", 1), ("created_at", -1)])

    await _ensure_index(database.invitations, "token", unique=True)
    await _ensure_index(database.invitations, [("email", 1), ("status", 1)])
    await _ensure_index(database.invitations, [("recruiter_id", 1), ("created_at", -1)])
    await _ensure_index(database.invitations, "expires_at")

    # Allow multiple historical cycles for the same email; only one active candidate.
    # Drop legacy unique email_1 only while migrating to the partial unique index.
    candidate_indexes = await _index_names(database.candidates)
    if "email_active_unique" not in candidate_indexes and "email_1" in candidate_indexes:
        await _drop_index_quiet(database.candidates, "email_1")
    await _ensure_index(
        database.candidates,
        "email",
        unique=True,
        partialFilterExpression={"status": "active"},
        name="email_active_unique",
    )
    await _ensure_index(database.candidates, "email")
    await _ensure_index(database.candidates, "cycle_group_key")
    await _ensure_index(database.candidates, [("history_bucket", 1), ("recruiter_id", 1)])
    await _ensure_index(database.candidates, "supabase_user_id", unique=True, sparse=True)
    await _ensure_index(database.candidates, "invitation_token", unique=True, sparse=True)
    await _ensure_index(database.candidates, "user_id", unique=True, sparse=True)
    await _ensure_index(database.candidates, [("conversion_status", 1), ("recruiter_id", 1)])
    await _ensure_index(database.candidates, "recruiter_id")

    # Allow multiple exited tenures for the same email; only one active employee.
    employee_indexes = await _index_names(database.employees)
    if "email_active_unique" not in employee_indexes and "email_1" in employee_indexes:
        await _drop_index_quiet(database.employees, "email_1")
    if "user_id_active_unique" not in employee_indexes and "user_id_1" in employee_indexes:
        await _drop_index_quiet(database.employees, "user_id_1")
    await _ensure_index(
        database.employees,
        "email",
        unique=True,
        partialFilterExpression={"status": {"$in": ["active", "inactive", "on_leave"]}},
        name="email_active_unique",
    )
    await _ensure_index(database.employees, "email")
    await _ensure_index(database.employees, "cycle_group_key")
    await _ensure_index(database.employees, [("history_bucket", 1), ("status", 1)])
    await _ensure_index(database.employees, "supabase_user_id", unique=True, sparse=True)
    await _ensure_index(database.employees, "employee_id", unique=True, sparse=True)
    await _ensure_index(database.employees, "legacy_employee_id", sparse=True)
    await _ensure_index(
        database.employees,
        "user_id",
        unique=True,
        partialFilterExpression={
            "user_id": {"$type": "string"},
            "status": {"$in": ["active", "inactive", "on_leave"]},
        },
        name="user_id_active_unique",
    )
    await _ensure_index(database.employees, "recruiter_id")
    await _ensure_index(database.employees, "onboarding.employment.iban_hash", unique=True, sparse=True)
    await _ensure_index(database.employees, [("department", 1), ("status", 1)])
    await _ensure_index(database.employees, [("full_name", 1)])

    # Active login emails stay unique. Archived users rewrite email to archived.<id>.<email>.
    await _ensure_index(database.users, "email", unique=True, name="email_1")
    await _ensure_index(database.users, "original_email")
    await _ensure_index(database.users, "status")

    await _ensure_index(database.employee_career_events, [("employee_id", 1), ("effective_date", -1)])
    await _ensure_index(database.employee_career_events, [("created_at", -1)])

    await _ensure_index(database.super_admins, "email", unique=True)
    await _ensure_index(database.super_admins, "supabase_user_id", unique=True, sparse=True)

    # Organizations (multi-tenancy)
    await _ensure_index(database.organizations, "name", unique=True)
    await _ensure_index(database.organizations, "slug", unique=True)
    await _ensure_index(database.organizations, [("status", 1), ("created_at", -1)])
    await _ensure_index(database.recruiters, "organization_id")
    await _ensure_index(database.candidates, "organization_id")
    await _ensure_index(database.employees, "organization_id")
    await _ensure_index(database.invitations, "organization_id")

    await _ensure_index(database.login_attempts, "email", unique=True)

    await _ensure_index(database.notifications, [("recipient_id", 1), ("created_at", -1)])
    await _ensure_index(database.notifications, [("recipient_id", 1), ("read", 1)])

    await _ensure_index(database.announcements, [("created_at", -1)])

    await _ensure_index(database.offer_letters, "candidate_id")
    await _ensure_index(database.offer_letters, [("status", 1), ("recruiter_id", 1)])
    await _ensure_index(database.offer_letters, "candidate_email")
    await _ensure_index(database.offer_letters, "invitation_token")
    await _ensure_index(database.offer_letters, [("negotiation.status", 1), ("recruiter_id", 1)])
    await _ensure_index(database.offer_letters, [("version", -1), ("created_at", -1)])

    # IT provisioning (pre-activation company email + assets)
    await _ensure_index(database.it_provisioning_requests, "token", unique=True)
    await _ensure_index(database.it_provisioning_requests, [("offer_id", 1), ("status", 1)])
    await _ensure_index(database.it_provisioning_requests, [("candidate_id", 1), ("status", 1)])
    await _ensure_index(database.it_provisioning_requests, "expires_at")
    await _ensure_index(database.it_kits, "name", unique=True)
    await _ensure_index(database.it_kits, [("created_at", -1)])
    await _ensure_index(database.it_provisioning_batches, "token", unique=True)
    await _ensure_index(database.it_provisioning_batches, [("expires_at", 1)])
    await _ensure_index(database.it_provisioning_batches, [("recruiter_id", 1), ("created_at", -1)])
    await _ensure_index(database.it_provisioning_requests, "batch_id", sparse=True)
    await _ensure_index(database.it_service_requests, "token", unique=True)
    await _ensure_index(database.it_service_requests, [("recruiter_id", 1), ("status", 1), ("created_at", -1)])
    await _ensure_index(database.it_service_requests, [("employee_id", 1), ("status", 1)])
    await _ensure_index(database.it_service_requests, "it_manager_email", sparse=True)
    await _ensure_index(database.company_email_password_otps, "user_id", unique=True)
    await _ensure_index(database.company_email_password_otps, "otp_expires_at")

    await _ensure_index(database.documents, [("owner_id", 1), ("is_active", 1)])
    await _ensure_index(database.documents, [("owner_id", 1), ("doc_type", 1)])
    await _ensure_index(database.documents, [("status", 1)])

    # ── Phase 3: Learning Management (Epic 6) + skill/career slice (Epic 8) ──
    await _ensure_index(
        database.learning_enrollments,
        [("user_id", 1), ("course_uid", 1)],
        unique=True,
        name="learning_enrollments_user_course_unique",
    )
    await _ensure_index(database.learning_enrollments, [("employee_id", 1), ("status", 1)])
    await _ensure_index(database.learning_enrollments, [("user_id", 1), ("status", 1)])

    await _ensure_index(database.learning_assignments, [("employee_id", 1), ("created_at", -1)])
    await _ensure_index(database.learning_assignments, [("user_id", 1), ("status", 1)])
    await _ensure_index(database.learning_assignments, [("assigned_by_id", 1), ("created_at", -1)])
    # Prevent duplicate course assignment to the same employee (future inserts).
    # Duplicate rows may block unique index — app still enforces in assign_courses.
    try:
        await database.learning_assignments.create_index(
            [("employee_id", 1), ("course_uid", 1)], unique=True
        )
    except Exception:
        pass

    await _ensure_index(
        database.learning_bookmarks,
        [("user_id", 1), ("course_uid", 1)],
        unique=True,
        name="learning_bookmarks_user_course_unique",
    )

    await _ensure_index(database.learning_certificates, [("user_id", 1), ("created_at", -1)])
    await _ensure_index(database.learning_certificates, [("recruiter_id", 1), ("verification_status", 1)])

    # Learning Providers (Phase 1: Generic provider framework)
    await _ensure_index(database.learning_providers, "name", unique=True, name="learning_providers_name_unique")
    await _ensure_index(database.learning_providers, "slug", unique=True, name="learning_providers_slug_unique")
    await _ensure_index(database.learning_providers, [("active", 1), ("created_at", -1)])
    await _ensure_index(database.learning_providers, [("provider_type", 1), ("active", 1)])

    # Learning Provider Import History (Phase 2: Universal import engine)
    await _ensure_index(database.learning_import_history, [("provider_id", 1), ("created_at", -1)])
    await _ensure_index(database.learning_import_history, [("imported_by_id", 1), ("created_at", -1)])
    await _ensure_index(database.learning_import_history, [("status", 1), ("created_at", -1)])

    # Managed roadmap courses (configured providers such as LinkedIn Learning, Microsoft Learn, Coursera, and more).
    await _ensure_index(database.learning_courses, "course_key", unique=True, name="learning_courses_course_key_unique")
    await _ensure_index(database.learning_courses, [("designation", 1), ("learning_month", 1), ("category", 1), ("competency", 1)])
    await _ensure_index(database.learning_courses, [("provider", 1), ("archived", 1)])
    await _ensure_index(database.learning_courses, [("provider_id", 1), ("archived", 1)])
    await _ensure_index(database.learning_courses, [("archived", 1), ("updated_at", -1)])
    await _ensure_index(database.learning_courses, [("created_at", -1)])
    await _ensure_index(database.learning_courses, [("external_id", 1), ("provider_id", 1)], unique=True, sparse=True, name="learning_courses_external_id_provider_unique")

    await _ensure_index(database.employee_skills, [("user_id", 1), ("skill_name", 1)], unique=True)
    await _ensure_index(database.employee_skills, [("employee_id", 1)])

    await _ensure_index(database.learning_career_goals, "user_id", unique=True)
    await _ensure_index(database.learning_ai_recommendations, "user_id", unique=True)

    # Talent Management (Epic 8: US-090 - US-104)
    await _ensure_index(database.internal_opportunities, [("status", 1), ("created_at", -1)])
    await _ensure_index(database.internal_opportunities, [("department", 1)])
    await _ensure_index(
        database.internal_opportunity_applications,
        [("opportunity_id", 1), ("employee_id", 1)],
        unique=True,
    )
    await _ensure_index(database.internal_opportunity_applications, "employee_id")
    await _ensure_index(database.talent_competency_evaluations, [("employee_id", 1), ("evaluated_at", -1)])
    await _ensure_index(database.talent_development_plans, "employee_id", unique=True)
    await _ensure_index(database.learning_catalog_cache, "_id")
    await _ensure_index(database.learning_skill_assessments, "user_id", unique=True)
    await _ensure_index(database.learning_skill_gaps, [("user_id", 1), ("target_role", 1)], unique=True)
    await _ensure_index(database.learning_role_matches, "user_id", unique=True)
    await _ensure_index(database.learning_recruiter_profile_cache, "user_id", unique=True)
    await _ensure_index(database.employees, [("job_title", 1), ("status", 1)])

    # Recruiter Learning Knowledge Base
    await _ensure_index(database.recruiter_kb_roles, [("recruiter_id", 1), ("title", 1)])
    await _ensure_index(database.recruiter_kb_certifications, [("recruiter_id", 1), ("title", 1)])
    await _ensure_index(database.recruiter_kb_meta, "recruiter_id", unique=True)

    # Legacy AI Coach collections kept for historical data only (router removed).
    await _ensure_index(database.kb_chunks, [("namespace", 1), ("role_scope", 1)])
    await _ensure_index(database.kb_chunks, [("namespace", 1), ("owner_id", 1), ("title", 1)])
    await _ensure_index(database.kb_chunks, [("title", "text"), ("text", "text")], name="kb_text_search")

    await _ensure_index(database.ai_coach_messages, [("user_id", 1), ("created_at", 1)])
    await _ensure_index(database.ai_coach_knowledge_docs, "title", unique=True)

    # AI Agent (hiring/onboarding automation) conversations
    await _ensure_index(database.agent_conversations, "session_id", unique=True)
    await _ensure_index(database.agent_conversations, [("user_id", 1), ("updated_at", -1)])

    await _ensure_index(database.hr_threads, [("recruiter_id", 1), ("updated_at", -1)])
    await _ensure_index(database.hr_threads, [("employee_user_id", 1), ("updated_at", -1)])
    await _ensure_index(database.hr_threads, [("employee_id", 1), ("status", 1)])
    await _ensure_index(
        database.hr_threads,
        [("employee_user_id", 1), ("recruiter_id", 1), ("status", 1)],
        name="hr_thread_open_pair",
    )

    # ── Universities (Candidate Onboarding — Education autocomplete) ─────────
    # Unique upsert key used by the seed service.
    await _ensure_index(database.universities, "normalised_name", unique=True)
    # Search indexes: name prefix/contains, country filter, city filter.
    await _ensure_index(database.universities, "name")
    await _ensure_index(database.universities, "country")
    await _ensure_index(database.universities, "city")

    # Support tickets
    await _ensure_index(database.tickets, [("created_by", 1), ("created_at", -1)])
    await _ensure_index(database.tickets, [("assignee_id", 1), ("status", 1)])
    await _ensure_index(database.tickets, [("ticket_id", 1)], unique=True)
    await _ensure_index(database.tickets, [("status", 1)])
    await _ensure_index(database.tickets, [("category", 1)])
    await _ensure_index(database.tickets, [("priority", 1)])
    await _ensure_index(database.tickets, [("organization_id", 1)])
    await _ensure_index(database.tickets, [("subject", 1)])
    await _ensure_index(database.ticket_replies, [("ticket_id", 1), ("created_at", 1)])
    await _ensure_index(database.ticket_activity, [("ticket_id", 1), ("created_at", -1)])
    await _ensure_index(database.ticket_audit_logs, [("ticket_id", 1), ("created_at", -1)])

    # Career Framework
    await _ensure_index(database.career_tracks, [("department", 1), ("track_name", 1)])
    await _ensure_index(database.career_tracks, [("department", 1), ("is_active", 1)])
    await _ensure_index(database.career_levels, [("track_id", 1), ("level_number", 1)])
    await _ensure_index(database.career_levels, [("department", 1), ("level_number", 1)])
    await _ensure_index(database.career_levels, [("role_title", 1), ("is_active", 1)])
    await _ensure_index(database.employee_career_assignments, [("employee_id", 1), ("status", 1)])
    await _ensure_index(database.employee_career_assignments, [("target_level_id", 1), ("status", 1)])
    await _ensure_index(database.employee_career_assignments, [("current_department", 1), ("status", 1)])
    await _ensure_index(database.employee_career_assignments, [("assigned_by", 1), ("status", 1)])

    # Organization Framework (single source of truth per org)
    await _ensure_index(database.org_framework_departments, [("organization_id", 1), ("name", 1)], unique=True)
    await _ensure_index(database.org_framework_roles, [("organization_id", 1), ("role_id", 1)], unique=True)
    await _ensure_index(database.org_framework_roles, [("organization_id", 1), ("department", 1), ("name", 1)])
    await _ensure_index(database.org_framework_skills, [("organization_id", 1), ("skill_id", 1)], unique=True)
    await _ensure_index(database.org_framework_skills, [("organization_id", 1), ("role_name", 1)])
    await _ensure_index(database.org_framework_certifications, [("organization_id", 1), ("cert_id", 1)], unique=True)
    await _ensure_index(database.org_framework_certifications, [("organization_id", 1), ("role_name", 1)])
    await _ensure_index(database.org_framework_courses, [("organization_id", 1), ("course_id", 1)], unique=True)
    await _ensure_index(database.org_framework_roadmaps, [("organization_id", 1), ("roadmap_id", 1)], unique=True)
    await _ensure_index(database.org_framework_roadmaps, [("organization_id", 1), ("role_name", 1), ("course_id", 1)])
    await _ensure_index(database.org_framework_promotion_rules, [("organization_id", 1), ("role_name", 1)], unique=True)
    await _ensure_index(database.org_framework_versions, [("organization_id", 1), ("created_at", -1)])
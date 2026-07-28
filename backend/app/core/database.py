from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo.errors import OperationFailure
from supabase import Client, create_client

from app.core.config import settings

mongo_client = AsyncIOMotorClient(settings.MONGODB_URI)
database: AsyncIOMotorDatabase = mongo_client[settings.DATABASE_NAME]

supabase: Client = create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)

# Index already exists under another name / with conflicting options — do not abort startup.
_INDEX_CONFLICT_CODES = {85, 86}


async def _ensure_index(collection, keys, **kwargs) -> None:
    try:
        await collection.create_index(keys, **kwargs)
    except OperationFailure as exc:
        if exc.code in _INDEX_CONFLICT_CODES:
            return
        raise


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
    try:
        await database.candidates.drop_index("email_1")
    except Exception:
        pass
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
    try:
        await database.employees.drop_index("email_1")
    except Exception:
        pass
    try:
        await database.employees.drop_index("user_id_1")
    except Exception:
        pass
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
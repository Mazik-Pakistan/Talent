from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from supabase import Client, create_client

from app.core.config import settings

mongo_client = AsyncIOMotorClient(settings.MONGODB_URI)
database: AsyncIOMotorDatabase = mongo_client[settings.DATABASE_NAME]

supabase: Client = create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)


async def create_database_indexes() -> None:
    await database.recruiters.create_index("email", unique=True)
    await database.recruiters.create_index("supabase_user_id", unique=True, sparse=True)
    await database.audit_logs.create_index([("created_at", -1)])
    await database.audit_logs.create_index([("recruiter_id", 1), ("created_at", -1)])

    await database.invitations.create_index("token", unique=True)
    await database.invitations.create_index([("email", 1), ("status", 1)])
    await database.invitations.create_index([("recruiter_id", 1), ("created_at", -1)])
    await database.invitations.create_index("expires_at")

    await database.candidates.create_index("email", unique=True)
    await database.candidates.create_index("supabase_user_id", unique=True, sparse=True)
    await database.candidates.create_index("invitation_token", unique=True, sparse=True)
    await database.candidates.create_index("user_id", unique=True, sparse=True)
    await database.candidates.create_index([("conversion_status", 1), ("recruiter_id", 1)])
    await database.candidates.create_index("recruiter_id")

    await database.employees.create_index("email", unique=True)
    await database.employees.create_index("supabase_user_id", unique=True, sparse=True)
    await database.employees.create_index("employee_id", unique=True, sparse=True)
    await database.employees.create_index("user_id", unique=True, sparse=True)
    await database.employees.create_index("recruiter_id")
    await database.employees.create_index("onboarding.employment.iban_hash", unique=True, sparse=True)
    await database.employees.create_index([("department", 1), ("status", 1)])
    await database.employees.create_index([("full_name", 1)])

    await database.employee_career_events.create_index([("employee_id", 1), ("effective_date", -1)])
    await database.employee_career_events.create_index([("created_at", -1)])

    await database.super_admins.create_index("email", unique=True)
    await database.super_admins.create_index("supabase_user_id", unique=True, sparse=True)

    await database.login_attempts.create_index("email", unique=True)

    await database.notifications.create_index([("recipient_id", 1), ("created_at", -1)])
    await database.notifications.create_index([("recipient_id", 1), ("read", 1)])

    await database.announcements.create_index([("created_at", -1)])

    await database.offer_letters.create_index("candidate_id")
    await database.offer_letters.create_index([("status", 1), ("recruiter_id", 1)])
    await database.offer_letters.create_index("candidate_email")

    await database.documents.create_index([("owner_id", 1), ("is_active", 1)])
    await database.documents.create_index([("owner_id", 1), ("doc_type", 1)])
    await database.documents.create_index([("status", 1)])

    # ── Phase 3: Learning Management (Epic 6) + skill/career slice (Epic 8) ──
    await database.learning_enrollments.create_index([("user_id", 1), ("course_uid", 1)], unique=True)
    await database.learning_enrollments.create_index([("employee_id", 1), ("status", 1)])
    await database.learning_enrollments.create_index([("user_id", 1), ("status", 1)])

    await database.learning_assignments.create_index([("employee_id", 1), ("created_at", -1)])
    await database.learning_assignments.create_index([("user_id", 1), ("status", 1)])
    await database.learning_assignments.create_index([("assigned_by_id", 1), ("created_at", -1)])
    # Prevent duplicate course assignment to the same employee (future inserts).
    try:
        await database.learning_assignments.create_index(
            [("employee_id", 1), ("course_uid", 1)], unique=True
        )
    except Exception:
        # Existing duplicate rows block unique index — app still enforces in assign_courses.
        pass

    await database.learning_bookmarks.create_index([("user_id", 1), ("course_uid", 1)], unique=True)

    await database.learning_certificates.create_index([("user_id", 1), ("created_at", -1)])
    await database.learning_certificates.create_index([("recruiter_id", 1), ("verification_status", 1)])

    await database.employee_skills.create_index([("user_id", 1), ("skill_name", 1)], unique=True)
    await database.employee_skills.create_index([("employee_id", 1)])

    await database.learning_career_goals.create_index("user_id", unique=True)
    await database.learning_ai_recommendations.create_index("user_id", unique=True)

    # Talent Management (Epic 8: US-090 - US-104)
    await database.internal_opportunities.create_index([("status", 1), ("created_at", -1)])
    await database.internal_opportunities.create_index([("department", 1)])
    await database.internal_opportunity_applications.create_index(
        [("opportunity_id", 1), ("employee_id", 1)], unique=True
    )
    await database.internal_opportunity_applications.create_index("employee_id")
    await database.talent_competency_evaluations.create_index([("employee_id", 1), ("evaluated_at", -1)])
    await database.talent_development_plans.create_index("employee_id", unique=True)
    await database.learning_catalog_cache.create_index("_id")
    await database.learning_skill_assessments.create_index("user_id", unique=True)
    await database.learning_skill_gaps.create_index([("user_id", 1), ("target_role", 1)], unique=True)
    await database.learning_role_matches.create_index("user_id", unique=True)
    await database.learning_recruiter_profile_cache.create_index("user_id", unique=True)
    await database.employees.create_index([("job_title", 1), ("status", 1)])

    # Recruiter Learning Knowledge Base
    await database.recruiter_kb_roles.create_index([("recruiter_id", 1), ("title", 1)])
    await database.recruiter_kb_certifications.create_index([("recruiter_id", 1), ("title", 1)])
    await database.recruiter_kb_meta.create_index("recruiter_id", unique=True)

    # Legacy AI Coach collections kept for historical data only (router removed).
    await database.kb_chunks.create_index([("namespace", 1), ("role_scope", 1)])
    await database.kb_chunks.create_index([("namespace", 1), ("owner_id", 1), ("title", 1)])
    try:
        await database.kb_chunks.create_index([("title", "text"), ("text", "text")], name="kb_text_search")
    except Exception:
        pass

    await database.ai_coach_messages.create_index([("user_id", 1), ("created_at", 1)])
    await database.ai_coach_knowledge_docs.create_index("title", unique=True)

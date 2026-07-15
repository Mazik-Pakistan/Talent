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

    await database.super_admins.create_index("email", unique=True)
    await database.super_admins.create_index("supabase_user_id", unique=True, sparse=True)

    await database.login_attempts.create_index("email", unique=True)

    await database.notifications.create_index([("recipient_id", 1), ("created_at", -1)])
    await database.notifications.create_index([("recipient_id", 1), ("read", 1)])

    await database.announcements.create_index([("created_at", -1)])

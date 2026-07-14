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

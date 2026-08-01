"""
One-time provisioning script for the platform's super admin account.

Creates the super admin directly in the database (users + super_admins
collections), bypassing the OTP signup flow entirely — the account is
active immediately.

Usage:
    python -m scripts.seed_super_admin

Credentials come from environment variables so they never live in source
control. If not set, the defaults below are used (change the password
immediately after first login via Settings > Change Password).

    SUPER_ADMIN_EMAIL       (default: superadmin@talenthcm.com)
    SUPER_ADMIN_PASSWORD    (default: TalentHCM#2026!Root)
    SUPER_ADMIN_FULL_NAME   (default: Platform Super Admin)
    SUPER_ADMIN_PHONE       (default: +923000000000)

Run this once against each environment (local / staging / production).
Re-running is safe — it will refuse to create a duplicate and tell you
one already exists.
"""

import asyncio
import os
import sys
from datetime import UTC, datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import database  # noqa: E402
from app.core.security import hash_password  # noqa: E402

DEFAULT_EMAIL = "superadmin@talenthcm.com"
DEFAULT_PASSWORD = "TalentHCM#2026!Root"
DEFAULT_FULL_NAME = "Platform Super Admin"
DEFAULT_PHONE = "+923000000000"


async def main() -> None:
    email = os.environ.get("SUPER_ADMIN_EMAIL", DEFAULT_EMAIL).lower().strip()
    password = os.environ.get("SUPER_ADMIN_PASSWORD", DEFAULT_PASSWORD)
    full_name = os.environ.get("SUPER_ADMIN_FULL_NAME", DEFAULT_FULL_NAME)
    phone = os.environ.get("SUPER_ADMIN_PHONE", DEFAULT_PHONE)

    existing_count = await database.super_admins.count_documents({})
    if existing_count > 0:
        print(f"A super admin already exists ({existing_count} found). Aborting — nothing created.")
        return

    if await database.users.find_one({"email": email}):
        print(f"An account already exists for {email}. Aborting — nothing created.")
        return

    now = datetime.now(UTC)

    user_doc = {
        "email": email,
        "password_hash": hash_password(password),
        "role": "super_admin",
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }
    result = await database.users.insert_one(user_doc)
    user_id = str(result.inserted_id)

    profile_doc = {
        "user_id": user_id,
        "full_name": full_name,
        "email": email,
        "phone": phone,
        "role": "super_admin",
        "status": "active",
        "email_verified_at": now,
        "created_at": now,
        "updated_at": now,
    }
    await database.super_admins.insert_one(profile_doc)

    print("Super admin created successfully.")
    print(f"  Email:    {email}")
    print(f"  Password: {password}")
    print("Sign in at the private super-admin login route and change this password immediately.")


if __name__ == "__main__":
    asyncio.run(main())

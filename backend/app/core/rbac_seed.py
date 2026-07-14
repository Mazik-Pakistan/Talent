"""Seed Roles / Permissions collections for US-012 (code remains source of truth)."""

from datetime import UTC, datetime

from app.core.database import database
from app.core.rbac import PERMISSIONS, ROLE_PERMISSIONS


async def seed_rbac_collections() -> None:
    now = datetime.now(UTC)

    for code, description in PERMISSIONS.items():
        module = code.split(".", 1)[0]
        await database.permissions.update_one(
            {"code": code},
            {
                "$set": {
                    "code": code,
                    "description": description,
                    "module": module,
                    "updated_at": now,
                },
                "$setOnInsert": {"created_at": now},
            },
            upsert=True,
        )

    for role_code, permission_set in ROLE_PERMISSIONS.items():
        await database.roles.update_one(
            {"code": role_code},
            {
                "$set": {
                    "code": role_code,
                    "name": role_code.replace("_", " ").title(),
                    "permissions": sorted(permission_set),
                    "updated_at": now,
                },
                "$setOnInsert": {"created_at": now},
            },
            upsert=True,
        )

    await database.permissions.create_index("code", unique=True)
    await database.roles.create_index("code", unique=True)

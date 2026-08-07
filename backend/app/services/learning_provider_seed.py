"""Automatic seeding of the existing default Learning Providers.

Phase 1 requirement: "The existing providers Coursera, Microsoft Learn, and
LinkedIn Learning must automatically become provider records."
"""

from __future__ import annotations

import re
from datetime import UTC, datetime

from app.core.database import database


def _now() -> datetime:
    return datetime.now(UTC)


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")


DEFAULT_PROVIDERS = [
    {
        "name": "LinkedIn Learning",
        "provider_type": "api",
        "import_method": "api",
        "description": "Professional skills courses from the LinkedIn Learning platform.",
        "default": True,
    },
    {
        "name": "Microsoft Learn",
        "provider_type": "api",
        "import_method": "api",
        "description": "Free technical learning paths, modules, and certifications from Microsoft Learn.",
        "default": True,
    },
    {
        "name": "Coursera",
        "provider_type": "api",
        "import_method": "api",
        "description": "Online courses, professional certificates, and degrees from top universities.",
        "default": True,
    },
]

# Legacy provider field values that map to each default provider.
LEGACY_NAMES = {
    "LinkedIn Learning": ["linkedin_learning", "linkedin learning", "linkedin"],
    "Microsoft Learn": ["microsoft_learn", "microsoft learn", "microsoft"],
    "Coursera": ["coursera"],
}


async def seed_learning_providers() -> None:
    """Create the default provider records if missing, and backfill provider_id
    on existing courses. Idempotent and safe to run on every startup."""
    for definition in DEFAULT_PROVIDERS:
        name = definition["name"]
        slug = _slug(name)

        existing = await database.learning_providers.find_one(
            {"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}
        ) or await database.learning_providers.find_one({"slug": slug})

        if existing:
            provider_id = str(existing["_id"])
        else:
            # Make slug unique if a collision exists.
            candidate_slug = slug
            counter = 1
            while await database.learning_providers.find_one({"slug": candidate_slug}):
                counter += 1
                candidate_slug = f"{slug}-{counter}"

            now = _now()
            doc = {
                "name": name,
                "slug": candidate_slug,
                "provider_type": definition["provider_type"],
                "import_method": definition["import_method"],
                "description": definition["description"],
                "logo_url": None,
                "active": True,
                "is_default": True,
                "created_at": now,
                "updated_at": now,
                "created_by_id": "system",
                "created_by_name": "System",
            }
            result = await database.learning_providers.insert_one(doc)
            provider_id = str(result.inserted_id)

        # Backfill provider_id on existing courses that match this provider by
        # their legacy provider-name field, so migration is automatic.
        legacy_names = LEGACY_NAMES.get(name, [name.lower()])
        await database.learning_courses.update_many(
            {
                "provider": {"$in": legacy_names},
                "$or": [{"provider_id": {"$exists": False}}, {"provider_id": None}],
            },
            {"$set": {"provider_id": provider_id, "updated_at": _now()}},
        )
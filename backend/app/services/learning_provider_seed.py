"""Automatic seeding of the existing default Learning Providers.

Phase 1 requirement: "The existing providers Coursera, Microsoft Learn, and
LinkedIn Learning must automatically become provider records."

Coursera and Microsoft Learn use built-in connectors (pagination / multi-type
catalog fetches cannot be expressed as a single generic GET + field mapping).
Their ``api_config`` is still stored so the Providers Edit UI shows real
endpoint/auth/mapping values instead of an empty form, with
``api_connector`` marking them as connector-managed.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime

from app.core.database import database


def _now() -> datetime:
    return datetime.now(UTC)


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")


# Representative configs shown in the UI. Sync for these providers uses the
# matching built-in connector (see api_connectors.py), not the generic importer.
COURSERA_API_CONFIG = {
    "endpoint": "https://api.coursera.org/api/courses.v1",
    "auth": {"type": "none"},
    "headers": {"Accept": "application/json"},
    "mapping": {
        "external_id": "elements[].slug",
        "title": "elements[].name",
        "description": "elements[].description",
        "url": "elements[].slug",
        "image": "elements[].photoUrl",
        "language": "elements[].primaryLanguages",
        "duration_minutes": "elements[].workload",
    },
}

MICROSOFT_LEARN_API_CONFIG = {
    "endpoint": "https://learn.microsoft.com/api/catalog/?type=learningPaths&locale=en-us",
    "auth": {"type": "none"},
    "headers": {"Accept": "application/json"},
    "mapping": {
        "external_id": "learningPaths[].uid",
        "title": "learningPaths[].title",
        "description": "learningPaths[].summary",
        "url": "learningPaths[].url",
        "duration_minutes": "learningPaths[].duration_in_minutes",
        "skills": "learningPaths[].subjects",
        "level": "learningPaths[].levels",
        "image": "learningPaths[].icon_url",
    },
}

DEFAULT_PROVIDERS = [
    {
        "name": "LinkedIn Learning",
        "provider_type": "manual",
        "import_method": "excel",
        "description": "Professional skills courses from the LinkedIn Learning platform.",
        "default": True,
        "api_connector": None,
        "api_config": None,
    },
    {
        "name": "Microsoft Learn",
        "provider_type": "api",
        "import_method": "api",
        "description": "Free technical learning paths, modules, and certifications from Microsoft Learn.",
        "default": True,
        "api_connector": "microsoft-learn",
        "api_config": MICROSOFT_LEARN_API_CONFIG,
    },
    {
        "name": "Coursera",
        "provider_type": "api",
        "import_method": "api",
        "description": "Online courses, professional certificates, and degrees from top universities.",
        "default": True,
        "api_connector": "coursera",
        "api_config": COURSERA_API_CONFIG,
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
            # Backfill connector metadata / api_config when missing so Edit UI
            # is never blank for built-in API providers.
            backfill: dict = {"updated_at": _now()}
            if definition.get("api_connector") and not existing.get("api_connector"):
                backfill["api_connector"] = definition["api_connector"]
            existing_cfg = existing.get("api_config") or {}
            if definition.get("api_config") and not (existing_cfg.get("endpoint") or "").strip():
                backfill["api_config"] = definition["api_config"]
            # LinkedIn (and similar) should be Excel/manual for recruiters — not
            # a half-configured API provider without a connector.
            if (
                definition.get("api_connector") is None
                and definition.get("import_method") in ("excel", "manual")
                and existing.get("import_method") == "api"
                and not existing.get("api_connector")
            ):
                backfill["provider_type"] = definition["provider_type"]
                backfill["import_method"] = definition["import_method"]
                if existing_cfg and not definition.get("api_config"):
                    backfill["api_config"] = None
            if len(backfill) > 1:
                await database.learning_providers.update_one(
                    {"_id": existing["_id"]},
                    {"$set": backfill},
                )
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
                "api_connector": definition.get("api_connector"),
                "api_config": definition.get("api_config"),
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

    # Catch-all for any remaining courses missing provider_id (Managed form,
    # Excel imports under custom provider names, casing mismatches with
    # LEGACY_NAMES, etc.). Uses the same slug/name resolution as
    # managed_learning_service._ensure_provider.
    from app.services.managed_learning_service import managed_learning_service

    await managed_learning_service.backfill_missing_provider_ids()

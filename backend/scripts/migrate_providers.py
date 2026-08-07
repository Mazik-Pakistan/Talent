"""Migration script for existing learning providers to new generic provider model.

This script migrates:
- LinkedIn Learning courses to LinkedIn Learning provider
- Microsoft Learn courses to Microsoft Learn provider  
- Coursera courses to Coursera provider
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

from bson import ObjectId

from app.core.database import database
from app.services.provider_service import _now, _slug, _normalize_provider_name


def _now() -> datetime:
    return datetime.now(UTC)


async def migrate_existing_providers() -> dict:
    """
    Migrate existing courses from hardcoded providers to generic provider model.
    
    This will:
    1. Create provider records for LinkedIn Learning, Microsoft Learn, Coursera
    2. Update all existing courses with provider_id references
    3. Preserve all existing course data
    """
    
    # Define the providers to migrate
    provider_definitions = [
        {
            "name": "LinkedIn Learning",
            "provider_type": "api",
            "import_method": "api",
            "description": "Professional development courses from LinkedIn Learning platform"
        },
        {
            "name": "Microsoft Learn", 
            "provider_type": "api",
            "import_method": "api",
            "description": "Free technical learning platform from Microsoft"
        },
        {
            "name": "Coursera",
            "provider_type": "api", 
            "import_method": "api",
            "description": "Online courses, certificates, and degrees from top universities"
        }
    ]
    
    created_providers = {}
    migrated_courses = 0
    
    print("Starting provider migration...")
    
    # Step 1: Create provider records
    for provider_def in provider_definitions:
        name = provider_def["name"]
        
        # Check if provider already exists
        existing_provider = await database.learning_providers.find_one(
            {"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}
        )
        
        if existing_provider:
            print(f"Provider '{name}' already exists, skipping creation")
            provider_id = str(existing_provider["_id"])
        else:
            # Create new provider
            slug = _slug(name)
            
            # Handle potential slug conflicts
            counter = 1
            original_slug = slug
            while await database.learning_providers.find_one({"slug": slug}):
                counter += 1
                slug = f"{original_slug}-{counter}"
            
            now = _now()
            provider_doc = {
                "name": name,
                "slug": slug,
                "provider_type": provider_def["provider_type"],
                "import_method": provider_def["import_method"],
                "description": provider_def["description"],
                "active": True,
                "created_at": now,
                "updated_at": now,
                "created_by_id": "system_migration",
                "created_by_name": "System Migration",
            }
            
            result = await database.learning_providers.insert_one(provider_doc)
            provider_id = str(result.inserted_id)
            print(f"Created provider '{name}' with ID: {provider_id}")
        
        created_providers[name] = provider_id
    
    # Step 2: Update existing courses with provider_id references
    print("Updating existing courses with provider references...")
    
    for provider_name, provider_id in created_providers.items():
        # Map old provider values to new provider_id
        old_provider_mapping = {
            "LinkedIn Learning": ["linkedin_learn", "linkedin learning", "LinkedIn Learning"],
            "Microsoft Learn": ["microsoft_learn", "microsoft learn", "Microsoft Learn"], 
            "Coursera": ["coursera", "Coursera"]
        }
        
        old_values = old_provider_mapping.get(provider_name, [provider_name.lower()])
        
        # Update courses that have these old provider values
        update_result = await database.learning_courses.update_many(
            {
                "provider": {"$in": old_values},
                "$or": [
                    {"provider_id": {"$exists": False}},
                    {"provider_id": None}
                ]
            },
            {
                "$set": {
                    "provider_id": provider_id,
                    "updated_at": _now()
                }
            }
        )
        
        migrated_courses += update_result.modified_count
        print(f"Updated {update_result.modified_count} courses for provider '{provider_name}'")
    
    # Step 3: Update any remaining courses that might have missing provider references
    print("Checking for courses without provider references...")
    
    orphaned_courses = await database.learning_courses.count_documents({
        "$or": [
            {"provider_id": {"$exists": False}},
            {"provider_id": None}
        ]
    })
    
    if orphaned_courses > 0:
        print(f"Found {orphaned_courses} courses without provider references")
        # Assign these to a default provider or handle appropriately
        # For now, we'll log them but not automatically assign
        
        # Sample a few to see what providers they have
        sample_courses = await database.learning_courses.find({
            "$or": [
                {"provider_id": {"$exists": False}},
                {"provider_id": None}
            ]
        }).limit(5).to_list(length=5)
        
        for course in sample_courses:
            print(f"  Sample orphaned course: provider='{course.get('provider')}', title='{course.get('name', 'Unknown')[:50]}...'")
    
    # Step 4: Create indexes for performance
    print("Ensuring indexes are properly set...")
    await _ensure_provider_indexes()
    
    result = {
        "providers_created": len(created_providers),
        "providers": created_providers,
        "courses_migrated": migrated_courses,
        "orphaned_courses_found": orphaned_courses,
        "completed_at": _now().isoformat()
    }
    
    print("Migration completed successfully!")
    print(f"Summary: {result}")
    
    return result


async def _ensure_provider_indexes():
    """Ensure provider-related indexes exist."""
    # Provider indexes
    await database.learning_providers.create_index(
        "name", unique=True, name="learning_providers_name_unique"
    )
    await database.learning_providers.create_index(
        "slug", unique=True, name="learning_providers_slug_unique"
    )
    await database.learning_providers.create_index(
        [("active", 1), ("created_at", -1)]
    )
    await database.learning_providers.create_index(
        [("provider_type", 1), ("active", 1)]
    )
    
    # Course indexes for provider queries
    await database.learning_courses.create_index(
        [("provider_id", 1), ("archived", 1)]
    )
    await database.learning_courses.create_index(
        [("archived", 1), ("updated_at", -1)]
    )
    await database.learning_courses.create_index(
        [("created_at", -1)]
    )
    await database.learning_courses.create_index(
        [("external_id", 1), ("provider_id", 1)], 
        unique=True, 
        sparse=True, 
        name="learning_courses_external_id_provider_unique"
    )


if __name__ == "__main__":
    import asyncio

    # Run the migration
    result = asyncio.run(migrate_existing_providers())
    print("\nMigration Result:")
    print(f"Providers migrated: {result['providers_created']}")
    print(f"Courses updated: {result['courses_migrated']}")
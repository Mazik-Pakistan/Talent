"""One-time migration: MZK-YYYY-###### → EMP-###### for all employees."""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime

from app.core.database import database

logger = logging.getLogger(__name__)

MIGRATION_ID = "employee_id_mzk_to_emp_v1"
EMP_PREFIX = "EMP-"
LEGACY_PREFIX_RE = re.compile(r"^MZK-\d{4}-(\d+)$", re.IGNORECASE)

# Collections / fields that store employee_id as a foreign key.
RELATED_UPDATES: list[tuple[str, str]] = [
    ("candidates", "employee_id"),
    ("employee_career_events", "employee_id"),
    ("learning_enrollments", "employee_id"),
    ("learning_assignments", "employee_id"),
    ("learning_certificates", "employee_id"),
    ("employee_skills", "employee_id"),
    ("internal_opportunity_applications", "employee_id"),
    ("talent_competency_evaluations", "employee_id"),
    ("talent_development_plans", "employee_id"),
    ("hr_threads", "employee_id"),
    ("it_provisioning", "employee_id"),
    ("it_provisioning", "applied_employee_id"),
    ("audit_logs", "employee_id"),
    ("audit_logs", "related_id"),
    ("notifications", "related_id"),
    ("employees", "previous_employee_id"),
]


async def migrate_employee_ids_to_emp_format() -> dict:
    """Rename every legacy MZK-* employee_id to EMP-000001 style.

    Safe to call on every startup — runs once, tracked in `migrations`.
    """
    existing = await database.migrations.find_one({"_id": MIGRATION_ID})
    if existing and existing.get("status") == "completed":
        return {"skipped": True, "reason": "already_completed"}

    legacy_employees = (
        await database.employees.find({"employee_id": {"$regex": r"^MZK-", "$options": "i"}})
        .sort([("created_at", 1), ("_id", 1)])
        .to_list(length=10000)
    )

    if not legacy_employees:
        # Still seed the global EMP counter from any existing EMP-* rows.
        max_seq = await _max_emp_sequence()
        await database.counters.update_one(
            {"_id": "employee_id"},
            {"$set": {"seq": max_seq}, "$setOnInsert": {"updated_at": datetime.now(UTC)}},
            upsert=True,
        )
        await database.migrations.update_one(
            {"_id": MIGRATION_ID},
            {
                "$set": {
                    "status": "completed",
                    "completed_at": datetime.now(UTC),
                    "renamed": 0,
                    "note": "no legacy MZK ids found",
                }
            },
            upsert=True,
        )
        return {"skipped": False, "renamed": 0}

    # Start after any EMP ids already present so we never collide.
    next_seq = (await _max_emp_sequence()) + 1
    mapping: dict[str, str] = {}

    for emp in legacy_employees:
        old_id = emp.get("employee_id")
        if not old_id or old_id in mapping:
            continue
        # Prefer preserving the numeric tail when possible (MZK-2026-000026 → EMP-000026)
        # only if that EMP id is free; otherwise allocate next free sequence.
        match = LEGACY_PREFIX_RE.match(str(old_id))
        preferred = None
        if match:
            preferred = f"{EMP_PREFIX}{int(match.group(1)):06d}"
            if preferred in mapping.values() or await database.employees.find_one({"employee_id": preferred}):
                preferred = None
        if preferred:
            new_id = preferred
            next_seq = max(next_seq, int(match.group(1)) + 1)
        else:
            new_id = f"{EMP_PREFIX}{next_seq:06d}"
            while new_id in mapping.values() or await database.employees.find_one({"employee_id": new_id}):
                next_seq += 1
                new_id = f"{EMP_PREFIX}{next_seq:06d}"
            next_seq += 1
        mapping[str(old_id)] = new_id

    now = datetime.now(UTC)
    for old_id, new_id in mapping.items():
        await database.employees.update_one(
            {"employee_id": old_id},
            {
                "$set": {
                    "employee_id": new_id,
                    "legacy_employee_id": old_id,
                    "employee_id_migrated_at": now,
                    "updated_at": now,
                }
            },
        )
        for collection_name, field_name in RELATED_UPDATES:
            collection = getattr(database, collection_name)
            await collection.update_many({field_name: old_id}, {"$set": {field_name: new_id}})

    max_seq = await _max_emp_sequence()
    await database.counters.update_one(
        {"_id": "employee_id"},
        {"$set": {"seq": max_seq, "updated_at": now}},
        upsert=True,
    )

    await database.migrations.update_one(
        {"_id": MIGRATION_ID},
        {
            "$set": {
                "status": "completed",
                "completed_at": now,
                "renamed": len(mapping),
                "mapping_sample": dict(list(mapping.items())[:20]),
            }
        },
        upsert=True,
    )
    logger.info("Migrated %s employee IDs from MZK-* to EMP-*", len(mapping))
    return {"skipped": False, "renamed": len(mapping), "mapping": mapping}


async def _max_emp_sequence() -> int:
    docs = await database.employees.find(
        {"employee_id": {"$regex": r"^EMP-\d+$", "$options": "i"}}
    ).to_list(length=10000)
    max_seq = 0
    for doc in docs:
        eid = str(doc.get("employee_id") or "")
        parts = eid.split("-")
        if len(parts) == 2 and parts[1].isdigit():
            max_seq = max(max_seq, int(parts[1]))
    return max_seq

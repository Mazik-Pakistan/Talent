"""Keep a dual-role account's profile identical across role documents.

One login (one ``users`` record) can own two separate profile documents —
one in ``recruiters`` and one in ``employees`` (and optionally
``super_admins``) — joined by the same ``user_id``.  When the person edits
their profile while acting in one role, the shared personal fields must be
mirrored to the counterpart document(s), otherwise the same human ends up
with two different names, phones, photos, or departments in the database.

The runtime ``mirror_profile_fields`` helper is called from every profile
update/photo endpoint.  ``reconcile_dual_role_profiles`` is used by the
migration script to heal documents that already drifted before syncing
existed.
"""

from datetime import UTC, datetime

from app.core.database import database

# Personal fields that exist in BOTH the recruiter and the employee document
# and therefore must never diverge for the same account.
SHARED_PROFILE_FIELDS = (
    "full_name",
    "phone",
    "profile_picture",
    "profile_picture_meta",
    "department",
    "job_title",
    "office_location",
)

# Which collections to mirror into for a given source role. A recruiter or
# employee mirrors into the other; a super admin mirrors into both so their
# personal details stay consistent everywhere.
_SOURCE_TO_TARGETS = {
    "recruiter": ("employees",),
    "employee": ("recruiters",),
    "super_admin": ("recruiters", "employees"),
}

_ROLE_COLLECTIONS = {
    "recruiter": "recruiters",
    "employee": "employees",
    "super_admin": "super_admins",
}


def _collection_for_role(role: str) -> str:
    return _ROLE_COLLECTIONS.get(role, "recruiters")


async def mirror_profile_fields(
    user_id: str,
    source_role: str,
    fields: tuple[str, ...] | None = None,
) -> None:
    """Mirror shared profile fields from ``source_role``'s document to the
    counterpart role document(s) owned by the same account.

    ``fields`` defaults to the full shared set; pass a subset to mirror only
    specific fields (e.g. ``("profile_picture", "profile_picture_meta")``
    after a photo upload).  Missing counterpart documents are a no-op, so
    single-role accounts are never touched.
    """
    if not user_id:
        return

    source = getattr(database, _collection_for_role(source_role), None)
    if source is None:
        return
    source_doc = await source.find_one({"user_id": user_id})
    if not source_doc:
        return

    keys = list(fields) if fields is not None else list(SHARED_PROFILE_FIELDS)
    updates = {
        key: source_doc.get(key) for key in keys if key in source_doc
    }
    if not updates:
        return
    updates["updated_at"] = datetime.now(UTC)

    for target_name in _SOURCE_TO_TARGETS.get(source_role, ()):
        target = getattr(database, target_name, None)
        if target is None:
            continue
        target_doc = await target.find_one({"user_id": user_id})
        if target_doc:
            await target.update_one({"_id": target_doc["_id"]}, {"$set": updates})


async def reconcile_dual_role_profiles(*, dry_run: bool = False) -> dict:
    """Heal profile documents that drifted before syncing existed.

    For every active recruiter that also owns an active employee document
    (same ``user_id``), copy shared fields that are missing or null on one
    side from the side that holds them.  Genuine conflicts (both sides set to
    different non-null values) are reported but left untouched so no real
    data is silently destroyed.
    """
    stats = {"scanned": 0, "filled": 0, "conflicts": 0, "conflict_fields": []}
    recruiters = await database.recruiters.find({"status": "active"}).to_list(length=None)
    for recruiter in recruiters:
        user_id = recruiter.get("user_id")
        if not user_id:
            continue
        employee = await database.employees.find_one(
            {"user_id": user_id, "status": "active"}
        )
        if not employee:
            continue
        stats["scanned"] += 1
        conflicts: list[str] = []
        recruiter_to_employee: dict = {}
        employee_to_recruiter: dict = {}
        for key in SHARED_PROFILE_FIELDS:
            recruiter_value = recruiter.get(key)
            employee_value = employee.get(key)
            if recruiter_value is not None and employee_value is not None and recruiter_value != employee_value:
                conflicts.append(key)
                continue
            if recruiter_value is not None and employee_value is None:
                recruiter_to_employee[key] = recruiter_value
            elif employee_value is not None and recruiter_value is None:
                employee_to_recruiter[key] = employee_value

        if conflicts:
            stats["conflicts"] += 1
            stats["conflict_fields"].append(
                {"email": recruiter.get("email"), "fields": conflicts}
            )

        if (recruiter_to_employee or employee_to_recruiter) and not dry_run:
            now = datetime.now(UTC)
            if recruiter_to_employee:
                await database.employees.update_one(
                    {"_id": employee["_id"]},
                    {"$set": {**recruiter_to_employee, "updated_at": now}},
                )
            if employee_to_recruiter:
                await database.recruiters.update_one(
                    {"_id": recruiter["_id"]},
                    {"$set": {**employee_to_recruiter, "updated_at": now}},
                )
        if recruiter_to_employee or employee_to_recruiter:
            stats["filled"] += 1

    return stats

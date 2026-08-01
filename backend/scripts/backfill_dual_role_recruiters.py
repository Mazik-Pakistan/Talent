"""Backfill employee profiles for legacy recruiter accounts.

Recruiters now sign in through the Employee entry point.  A recruiter needs
both an employee and a recruiter profile with the same ``user_id`` to land on
the employee dashboard and use the in-app role switcher.

This migration intentionally leaves recruiter records and login credentials
untouched.  It is safe to run more than once: a recruiter that already has an
employee profile is skipped.

Usage (run from the ``backend`` directory)::

    python -m scripts.backfill_dual_role_recruiters --dry-run
    python -m scripts.backfill_dual_role_recruiters
"""

import argparse
import asyncio
import os
import sys
from datetime import UTC, datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import database  # noqa: E402
from app.services.employee_service import EmployeeService  # noqa: E402


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report the employee profiles that would be created without writing data.",
    )
    return parser.parse_args()


async def main() -> None:
    args = _arguments()
    recruiters = await database.recruiters.find({"status": "active"}).to_list(length=None)
    employee_service = EmployeeService()
    created = 0
    skipped = 0
    invalid = 0

    for recruiter in recruiters:
        user_id = recruiter.get("user_id")
        email = (recruiter.get("email") or "").lower().strip()
        name = (recruiter.get("full_name") or "").strip()

        # The role switcher joins profiles by user_id. Do not create an
        # unusable employee record when a legacy recruiter has no login link.
        if not user_id or not email or not name:
            invalid += 1
            print(
                "SKIP invalid recruiter profile "
                f"{recruiter.get('_id', '<unknown>')}: user_id, email, and full_name are required."
            )
            continue

        existing = await database.employees.find_one({"user_id": user_id})
        if existing:
            skipped += 1
            print(f"SKIP {email}: employee profile already exists ({existing.get('employee_id', 'no ID')}).")
            continue

        if args.dry_run:
            created += 1
            print(f"DRY RUN {email}: would create an employee profile.")
            continue

        employee_id = (await employee_service.generate_employee_id(allocate=True))["employee_id"]
        now = datetime.now(UTC)
        await database.employees.insert_one(
            {
                "user_id": user_id,
                "employee_id": employee_id,
                "full_name": name,
                "email": email,
                "phone": recruiter.get("phone"),
                "role": "employee",
                "status": "active",
                "history_bucket": "active",
                "cycle_group_key": email,
                "job_title": recruiter.get("job_title"),
                "department": recruiter.get("department"),
                "onboarding": {},
                "profile_status": "incomplete",
                "profile_completed_at": None,
                "dual_role_migrated_at": now,
                "dual_role_migrated_from": "recruiter",
                "created_at": now,
                "updated_at": now,
            }
        )
        # ``users.role`` is only a default/legacy marker (the active JWT role
        # controls authorization), but make Employee the default there too so
        # the credentials record accurately reflects the new login journey.
        users = getattr(database, "users", None)
        if users is not None:
            await users.update_one(
                {"email": email},
                {"$set": {"role": "employee", "updated_at": now}},
            )
        created += 1
        print(f"CREATED {email}: employee profile {employee_id}.")

    mode = "Dry run" if args.dry_run else "Migration"
    print(f"{mode} complete: {created} to create/created, {skipped} already dual-role, {invalid} invalid.")


if __name__ == "__main__":
    asyncio.run(main())

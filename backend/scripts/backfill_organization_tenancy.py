"""Backfill organization_id for legacy records (pre-multi-tenancy).

Assigns an organization to every recruiter, candidate invitation, candidate,
employee, and offer letter that was created before organizations existed.
Records that already carry an organization_id are skipped.

Target organization resolution order:
    1. --organization-id flag (must exist)
    2. The "Default Organization" if it exists
    3. Create "Default Organization" and use it

Candidates/employees/offers are first mapped through their owning recruiter
(recruiter_id -> recruiter's org); only when that fails do they fall back to
the target org. This preserves per-company grouping when multiple orgs exist.

Usage (run from the ``backend`` directory)::

    python -m scripts.backfill_organization_tenancy --dry-run
    python -m scripts.backfill_organization_tenancy
    python -m scripts.backfill_organization_tenancy --organization-id 66...
"""

import argparse
import asyncio
import os
import sys
from datetime import UTC, datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import database  # noqa: E402
from app.services.organization_service import (  # noqa: E402
    create_organization,
    get_organization,
    list_organizations,
)

COLLECTIONS = ("recruiters", "invitations", "candidates", "employees", "offer_letters")


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--organization-id",
        default=None,
        help="Organization to assign legacy records to (default: Default Organization).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would change without writing any data.",
    )
    return parser.parse_args()


async def _resolve_target_org(organization_id: str | None) -> dict:
    if organization_id:
        org = await get_organization(organization_id)
        if not org:
            raise SystemExit(f"Organization not found: {organization_id}")
        return org

    result = await list_organizations(page=1, page_size=100)
    orgs = result.get("organizations") or []
    default = next((o for o in orgs if o["name"] == "Default Organization"), None)
    if default:
        return default
    if orgs:
        return orgs[0]
    return await create_organization(name="Default Organization")


async def _recruiter_org_map() -> dict[str, str]:
    """Map recruiter user_id -> organization_id for legacy cross-referencing."""
    mapping: dict[str, str] = {}
    recruiters = await database.recruiters.find({"organization_id": {"$exists": True, "$ne": None}}).to_list(length=None)
    for recruiter in recruiters:
        user_id = recruiter.get("user_id")
        org_id = recruiter.get("organization_id")
        if user_id and org_id:
            mapping[str(user_id)] = org_id
    return mapping


async def _backfill_recruiters(org_id: str, dry_run: bool) -> int:
    missing = await database.recruiters.count_documents(
        {"$or": [{"organization_id": {"$exists": False}}, {"organization_id": None}]}
    )
    if dry_run:
        print(f"  DRY RUN recruiters: {missing} would get organization_id={org_id}")
        return missing
    result = await database.recruiters.update_many(
        {"$or": [{"organization_id": {"$exists": False}}, {"organization_id": None}]},
        {"$set": {"organization_id": org_id, "updated_at": datetime.now(UTC)}},
    )
    print(f"  recruiters updated: {result.modified_count}")
    return result.modified_count


async def _backfill_invitations(org_id: str, recruiter_map: dict[str, str], dry_run: bool) -> int:
    missing = await database.invitations.find(
        {"$or": [{"organization_id": {"$exists": False}}, {"organization_id": None}]}
    ).to_list(length=None)
    if dry_run:
        print(f"  DRY RUN invitations: {len(missing)} would be backfilled")
        return len(missing)

    updated = 0
    for inv in missing:
        resolved = recruiter_map.get(str(inv.get("recruiter_id"))) or org_id
        await database.invitations.update_one(
            {"_id": inv["_id"]},
            {"$set": {"organization_id": resolved, "updated_at": datetime.now(UTC)}},
        )
        updated += 1
    print(f"  invitations updated: {updated}")
    return updated


async def _backfill_people(
    collection,
    label: str,
    org_id: str,
    recruiter_map: dict[str, str],
    dry_run: bool,
) -> int:
    missing = await collection.find(
        {"$or": [{"organization_id": {"$exists": False}}, {"organization_id": None}]}
    ).to_list(length=None)
    if dry_run:
        print(f"  DRY RUN {label}: {len(missing)} would be backfilled")
        return len(missing)

    updated = 0
    for doc in missing:
        resolved = recruiter_map.get(str(doc.get("recruiter_id"))) or org_id
        await collection.update_one(
            {"_id": doc["_id"]},
            {"$set": {"organization_id": resolved, "updated_at": datetime.now(UTC)}},
        )
        updated += 1
    print(f"  {label} updated: {updated}")
    return updated


async def main() -> None:
    args = _arguments()
    target = await _resolve_target_org(args.organization_id)
    org_id = target["id"]
    print(f"Target organization: {target['name']} ({org_id})")

    recruiter_map = await _recruiter_org_map()
    print(f"Recruiter->org map size: {len(recruiter_map)}")

    totals = {}
    totals["recruiters"] = await _backfill_recruiters(org_id, args.dry_run)
    totals["invitations"] = await _backfill_invitations(org_id, recruiter_map, args.dry_run)
    totals["candidates"] = await _backfill_people(
        database.candidates, "candidates", org_id, recruiter_map, args.dry_run
    )
    totals["employees"] = await _backfill_people(
        database.employees, "employees", org_id, recruiter_map, args.dry_run
    )
    totals["offer_letters"] = await _backfill_people(
        database.offer_letters, "offer_letters", org_id, recruiter_map, args.dry_run
    )

    mode = "Dry run" if args.dry_run else "Backfill"
    print(f"{mode} complete: " + ", ".join(f"{k}={v}" for k, v in totals.items()))


if __name__ == "__main__":
    asyncio.run(main())

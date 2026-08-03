"""Heal dual-role profile documents that drifted before profile syncing existed.

A recruiter who is also an employee owns two documents (``recruiters`` and
``employees``) joined by the same ``user_id``.  Before the sync was wired
into the profile endpoints, edits made in one role were never mirrored to the
other, so the same person could have different names, phones, photos, or
departments in the two documents.

This script fills one-sided gaps (a field missing on one side is copied from
the side that has it) and reports genuine conflicts (both sides set to
different non-null values) without touching them.

Usage (run from the ``backend`` directory)::

    python -m scripts.reconcile_dual_role_profiles --dry-run
    python -m scripts.reconcile_dual_role_profiles
"""

import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.profile_sync_service import reconcile_dual_role_profiles  # noqa: E402


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report drift without writing any data.",
    )
    return parser.parse_args()


async def main() -> None:
    args = _arguments()
    stats = await reconcile_dual_role_profiles(dry_run=args.dry_run)
    mode = "Dry run" if args.dry_run else "Reconcile"
    print(f"{mode}: scanned {stats['scanned']} dual-role accounts.")
    print(f"{mode}: filled missing fields on {stats['filled']} account(s).")
    print(f"{mode}: {stats['conflicts']} account(s) with conflicting values (left untouched):")
    for item in stats["conflict_fields"]:
        print(f"  - {item['email'] or '<no email>'}: {', '.join(item['fields'])}")


if __name__ == "__main__":
    asyncio.run(main())

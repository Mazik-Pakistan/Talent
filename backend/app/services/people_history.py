"""Shared helpers for historical candidates / employees and same-email reinvite cycles."""

from __future__ import annotations

from datetime import UTC, datetime

from bson import ObjectId

from app.core.database import database

ACTIVE_EMPLOYEE_STATUSES = ("active", "inactive", "on_leave")
HISTORICAL_EMPLOYEE_STATUSES = ("resigned", "terminated", "exited")
EXIT_TYPES = ("resigned", "terminated", "exited")

HISTORICAL_CANDIDATE_REASONS = (
    "offer_declined",
    "invite_expired",
    "offer_expired",
    "withdrawn",
    "abandoned",
    "reinvited",
)


def cycle_group_key(email: str | None) -> str:
    return (email or "").lower().strip()


def _iso(value):
    return value.isoformat() if hasattr(value, "isoformat") else value


async def archive_user_login(email: str, *, reason: str) -> dict | None:
    """Detach an active login so the same email can register a fresh account."""
    email = cycle_group_key(email)
    if not email:
        return None
    user = await database.users.find_one({"email": email})
    if not user:
        return None
    if user.get("status") == "archived":
        return user

    now = datetime.now(UTC)
    archived_email = f"archived.{user['_id']}.{email}"
    await database.users.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "email": archived_email,
                "original_email": email,
                "status": "archived",
                "archived_at": now,
                "archive_reason": reason,
                "updated_at": now,
            }
        },
    )
    user["email"] = archived_email
    user["original_email"] = email
    user["status"] = "archived"
    return user


async def find_active_user(email: str) -> dict | None:
    email = cycle_group_key(email)
    if not email:
        return None
    return await database.users.find_one({"email": email, "status": {"$ne": "archived"}})


async def find_active_candidate(email: str) -> dict | None:
    email = cycle_group_key(email)
    if not email:
        return None
    return await database.candidates.find_one(
        {
            "email": email,
            "status": "active",
            "$or": [
                {"history_bucket": {"$exists": False}},
                {"history_bucket": "active"},
            ],
        }
    )


async def find_active_employee(email: str) -> dict | None:
    email = cycle_group_key(email)
    if not email:
        return None
    return await database.employees.find_one(
        {
            "email": email,
            "status": {"$in": list(ACTIVE_EMPLOYEE_STATUSES)},
            "$or": [
                {"history_bucket": {"$exists": False}},
                {"history_bucket": "active"},
            ],
        }
    )


def mark_candidate_historical_fields(
    *,
    reason: str,
    lifecycle_state: str | None = None,
    when: datetime | None = None,
) -> dict:
    """Mark a non-converted candidate as historical (declined / expired / withdrawn / etc.).

    Converted candidates are NOT historical candidates — they live as employees
    (active or former). Do not call this helper for conversion.
    """
    now = when or datetime.now(UTC)
    return {
        "history_bucket": "historical",
        "historical_reason": reason,
        "historical_at": now,
        "lifecycle_state": lifecycle_state or reason,
        "status": "historical",
        "updated_at": now,
    }


def mark_employee_historical_fields(
    *,
    exit_type: str,
    exit_reason: str | None = None,
    exit_date: str | None = None,
    when: datetime | None = None,
) -> dict:
    now = when or datetime.now(UTC)
    return {
        "status": exit_type,
        "history_bucket": "historical",
        "exit_type": exit_type,
        "exit_reason": exit_reason,
        "exit_date": exit_date or now.date().isoformat(),
        "historical_at": now,
        "updated_at": now,
    }


def public_history_match(*, record_type: str, doc: dict) -> dict:
    email = cycle_group_key(doc.get("email") or doc.get("original_email"))
    if record_type == "employee":
        record_id = doc.get("employee_id") or doc.get("user_id") or str(doc.get("_id", ""))
        outcome = doc.get("exit_type") or doc.get("status") or "historical"
        href = f"/dashboard/recruiter/employees/{record_id}?bucket=historical"
        match_type = "historical_employee"
        history_bucket = doc.get("history_bucket") or "historical"
    elif record_type == "converted_candidate":
        # Prior hire cycle — shown for rehire history only, never as a historical candidate.
        record_id = doc.get("user_id") or str(doc.get("_id", ""))
        outcome = "converted"
        href = f"/dashboard/recruiter/candidates/{record_id}"
        match_type = "converted_candidate"
        history_bucket = "converted"
        record_type = "candidate"
    else:
        record_id = doc.get("user_id") or str(doc.get("_id", ""))
        outcome = doc.get("historical_reason") or doc.get("conversion_status") or doc.get("status") or "historical"
        href = f"/dashboard/recruiter/candidates/{record_id}?bucket=historical"
        match_type = "historical_candidate"
        history_bucket = doc.get("history_bucket") or "historical"

    return {
        "type": match_type,
        "record_type": record_type,
        "id": record_id,
        "full_name": doc.get("full_name"),
        "email": email,
        "department": doc.get("department"),
        "job_title": doc.get("job_title"),
        "status": doc.get("status"),
        "outcome": outcome,
        "employee_id": doc.get("employee_id"),
        "history_bucket": history_bucket,
        "historical_reason": doc.get("historical_reason"),
        "exit_type": doc.get("exit_type"),
        "exit_date": _iso(doc.get("exit_date") or doc.get("historical_at")),
        "cycle_group_key": doc.get("cycle_group_key") or email,
        "href": href,
        "created_at": _iso(doc.get("created_at")),
        "invitation_token": doc.get("invitation_token"),
    }


async def lookup_history_by_email(email: str, *, recruiter_id: str | None = None, is_super_admin: bool = False) -> dict:
    """Return prior candidate cycles and employee tenures for an email.

    Rules:
    - Historical employees (resigned/terminated/exited) always appear.
    - Non-converted historical candidates (declined/expired/etc.) always appear.
    - Converted candidates are NOT historical candidates. They appear in invite
      rehire suggestions only when there is no active employee (alongside prior
      resigned tenures), so recruiters see both the conversion cycle and exit.
    - Active employees block reinvite; their converted/used-invite cycles are
      not recommended as new candidate history.
    """
    email = cycle_group_key(email)
    if not email:
        return {
            "email": email,
            "active_conflict": None,
            "matches": [],
            "candidate_matches": [],
            "employee_matches": [],
            "converted_matches": [],
            "can_reinvite": False,
            "suggestion_summary": "No email provided.",
        }

    active_candidate = await find_active_candidate(email)
    active_employee = await find_active_employee(email)
    active_user = await find_active_user(email)

    scope: dict = {}
    if recruiter_id and not is_super_admin:
        scope["recruiter_id"] = recruiter_id

    # Declined / expired / withdrawn — true historical candidates.
    candidate_query = {
        "email": email,
        **scope,
        "$and": [
            {
                "$or": [
                    {"history_bucket": "historical"},
                    {"status": {"$in": ["historical", "declined", "offer_declined"]}},
                    {"conversion_status": {"$in": ["offer_declined", "declined"]}},
                ]
            },
            {"status": {"$ne": "converted"}},
            {"conversion_status": {"$ne": "converted"}},
            {"history_bucket": {"$ne": "converted"}},
        ],
    }
    employee_query = {
        "email": email,
        **scope,
        "$or": [
            {"history_bucket": "historical"},
            {"status": {"$in": list(HISTORICAL_EMPLOYEE_STATUSES)}},
        ],
    }
    converted_query = {
        "email": email,
        **scope,
        "$or": [
            {"status": "converted"},
            {"conversion_status": "converted"},
            {"history_bucket": "converted"},
        ],
    }

    candidates = await database.candidates.find(candidate_query).sort("created_at", -1).to_list(length=50)
    employees = await database.employees.find(employee_query).sort("created_at", -1).to_list(length=50)
    converted_docs = await database.candidates.find(converted_query).sort("created_at", -1).to_list(length=50)

    invite_query = {
        "email": email,
        "status": {"$in": ["expired", "used"]},
        **({"recruiter_id": recruiter_id} if recruiter_id and not is_super_admin else {}),
    }
    invitations = await database.invitations.find(invite_query).sort("created_at", -1).to_list(length=20)

    candidate_matches = [public_history_match(record_type="candidate", doc=doc) for doc in candidates]
    employee_matches = [public_history_match(record_type="employee", doc=doc) for doc in employees]

    # Converted cycles only for rehire context (no active employee). Keep them
    # alongside resigned tenures; never recommend while the person is employed.
    converted_matches = []
    if not active_employee:
        converted_matches = [
            public_history_match(record_type="converted_candidate", doc=doc) for doc in converted_docs
        ]

    converted_tokens = {
        doc.get("invitation_token") for doc in converted_docs if doc.get("invitation_token")
    }
    historical_tokens = {
        doc.get("invitation_token") for doc in candidates if doc.get("invitation_token")
    }

    invite_matches = []
    for inv in invitations:
        token = inv.get("token")
        # Prefer candidate / converted rows over a raw invitation card.
        if token and (token in converted_tokens or token in historical_tokens):
            continue
        # Active employees are not invite suggestions — block via active_conflict only.
        if inv.get("status") == "used" and active_employee:
            continue
        # Used invite already covered by converted_matches for resigned rehire.
        if inv.get("status") == "used" and converted_matches:
            continue

        invite_matches.append(
            {
                "type": "historical_invitation",
                "record_type": "invitation",
                "id": token or str(inv.get("_id", "")),
                "full_name": inv.get("full_name"),
                "email": email,
                "department": inv.get("department"),
                "job_title": inv.get("job_title"),
                "status": inv.get("status"),
                "outcome": inv.get("status"),
                "employee_id": None,
                "history_bucket": "historical",
                "historical_reason": "invite_expired" if inv.get("status") == "expired" else "invite_used",
                "href": "/dashboard/recruiter/candidates?bucket=historical",
                "cycle_group_key": email,
                "created_at": _iso(inv.get("created_at")),
            }
        )

    # Employee tenures first, then conversion cycles, then other candidate/invite history.
    matches = employee_matches + converted_matches + candidate_matches + invite_matches
    active_conflict = None
    if active_employee:
        active_conflict = {
            "type": "active_employee",
            "id": active_employee.get("employee_id") or active_employee.get("user_id"),
            "full_name": active_employee.get("full_name"),
            "email": email,
            "status": active_employee.get("status"),
            "message": "An active employee already exists for this email.",
        }
    elif active_candidate:
        active_conflict = {
            "type": "active_candidate",
            "id": active_candidate.get("user_id") or str(active_candidate.get("_id", "")),
            "full_name": active_candidate.get("full_name"),
            "email": email,
            "status": active_candidate.get("status"),
            "message": "An active candidate already exists for this email.",
        }
    elif active_user and active_user.get("role") in ("recruiter", "super_admin"):
        active_conflict = {
            "type": "active_staff",
            "id": str(active_user.get("_id", "")),
            "full_name": None,
            "email": email,
            "status": active_user.get("role"),
            "message": "This email belongs to a staff account and cannot be invited as a candidate.",
        }

    can_reinvite = active_conflict is None
    parts = []
    if employee_matches:
        parts.append(f"{len(employee_matches)} prior employee tenure(s)")
    if converted_matches:
        parts.append(f"{len(converted_matches)} prior conversion cycle(s)")
    if candidate_matches:
        parts.append(f"{len(candidate_matches)} prior candidate cycle(s)")
    if invite_matches:
        parts.append(f"{len(invite_matches)} prior invitation(s)")
    if active_conflict:
        suggestion_summary = active_conflict["message"]
    elif parts:
        suggestion_summary = (
            f"This email has {' and '.join(parts)}. "
            "Open any historical record, or start a new candidate invitation with the same email."
        )
    else:
        suggestion_summary = "No historical records found for this email."

    return {
        "email": email,
        "active_conflict": active_conflict,
        "matches": matches,
        "candidate_matches": candidate_matches,
        "employee_matches": employee_matches,
        "converted_matches": converted_matches,
        "invitation_matches": invite_matches,
        "can_reinvite": can_reinvite,
        "suggestion_summary": suggestion_summary,
    }


async def prepare_email_for_reinvite(email: str) -> None:
    """Archive leftover login so registration can create a fresh account for the same email."""
    email = cycle_group_key(email)
    if await find_active_candidate(email) or await find_active_employee(email):
        return
    await archive_user_login(email, reason="reinvite_same_email")


def candidate_is_historical(doc: dict) -> bool:
    """True only for non-hired candidate outcomes (declined/expired/etc.).

    Converted people are employees (active or historical employees), never historical candidates.
    """
    if doc.get("status") == "converted" or doc.get("conversion_status") == "converted":
        return False
    if doc.get("history_bucket") == "converted":
        return False
    if doc.get("history_bucket") == "historical":
        return True
    if doc.get("status") in {"historical", "declined", "offer_declined"}:
        return True
    if doc.get("conversion_status") in {"offer_declined", "declined"}:
        return True
    return False


def employee_is_historical(doc: dict) -> bool:
    if doc.get("history_bucket") == "historical":
        return True
    return doc.get("status") in HISTORICAL_EMPLOYEE_STATUSES

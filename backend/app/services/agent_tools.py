"""AI Agent tool registry.

Every tool wraps an *already validated* service call (invitation, offer,
onboarding, employee profile, document, email). The agent never talks to the
database directly for writes — it only orchestrates existing, permission
-checked service methods so behaviour stays identical to using the UI by
hand. Tools return small JSON-serialisable dicts that get fed back to the
LLM as "observations".
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Awaitable, Callable

from fastapi import HTTPException
from pydantic import ValidationError

from app.core.database import database
from app.core.rbac import CurrentUser
from app.schemas.career import CareerEventCreateRequest
from app.schemas.dashboard import CreateAnnouncementRequest
from app.schemas.document import DocumentVerifyRequest
from app.schemas.employee_profile import EmployeeProfileSaveRequest
from app.schemas.invitation import CreateInvitationRequest, OnboardingSaveRequest
from app.schemas.offer import OfferTermsPayload
from app.schemas.offer import OfferApproveRequest, OfferCreateRequest
from app.schemas.onboarding_assignment import (
    AssetAssignRequest,
    AssetUpdateRequest,
    CompanyEmailRequest,
    OrientationScheduleRequest,
)
from app.services.candidate_service import CandidateService
from app.services.dashboard_service import DashboardService
from app.services.document_service import document_service
from app.services.email_service import email_service
from app.services.employee_service import EmployeeService
from app.services.invitation_service import InvitationService
from app.services.offer_service import offer_service

candidate_service = CandidateService()
employee_service = EmployeeService()
invitation_service = InvitationService()
dashboard_service = DashboardService()

BULK_CAP = 100

DEFAULT_JOINING_DOCUMENTS = [
    "3 CNIC copies",
    "Passport copy, if available",
    "2 recent photographs (white background)",
    "Last month's salary slip",
    "Educational certificates (Matric to highest)",
    "Experience certificates",
    "Training certificates",
    "Blood group details",
    "Resume",
]


@dataclass
class ToolResult:
    ok: bool
    data: Any = None
    error: str | None = None

    def to_json(self) -> dict:
        return {"ok": self.ok, "data": self.data, "error": self.error}


def confirm_gate(tool: str, args: dict, summary: str) -> ToolResult:
    """Return a structured confirmation request the chat UI can Approve/Cancel."""
    pending = {**(args or {}), "confirm": True}
    return ToolResult(
        ok=False,
        error=f"Confirmation required: {summary}",
        data={
            "needs_confirm": True,
            "tool": tool,
            "args": pending,
            "summary": summary,
        },
    )


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict  # lightweight JSON-schema-like description for the prompt
    handler: Callable[[CurrentUser, dict], Awaitable[ToolResult]]
    roles: tuple[str, ...] = field(default_factory=tuple)


def _err(exc: Exception) -> ToolResult:
    if isinstance(exc, HTTPException):
        return ToolResult(ok=False, error=str(exc.detail))
    if isinstance(exc, ValidationError):
        problems = "; ".join(
            f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()
        )
        return ToolResult(ok=False, error=f"Validation failed — {problems}")
    return ToolResult(ok=False, error=str(exc))


async def _find_candidate_by_email(email: str) -> dict | None:
    return await database.candidates.find_one({"email": email.lower().strip()})


async def _find_employee_by_email(email: str) -> dict | None:
    return await database.employees.find_one({"email": email.lower().strip()})


def _escape_regex(term: str) -> str:
    return re.escape(term or "")


def _name_match_clauses(term: str) -> list[dict]:
    """Match full or partial names so 'Omer Shamsi' / 'omer' both resolve."""
    cleaned = " ".join((term or "").split())
    if not cleaned:
        return []
    clauses: list[dict] = [
        {"full_name": {"$regex": _escape_regex(cleaned), "$options": "i"}},
        {"email": {"$regex": _escape_regex(cleaned), "$options": "i"}},
    ]
    tokens = [t for t in cleaned.split(" ") if len(t) >= 2]
    if len(tokens) >= 2:
        clauses.append(
            {
                "$and": [
                    {"full_name": {"$regex": _escape_regex(tok), "$options": "i"}} for tok in tokens
                ]
            }
        )
    return clauses


def _recruiter_scope(user: CurrentUser) -> str | None:
    return None if user.role == "super_admin" else user.id


async def _find_employee_by_query(q: str, *, recruiter_id: str | None = None) -> dict | None:
    term = (q or "").strip()
    if not term:
        return None
    if "@" in term:
        emp = await _find_employee_by_email(term)
        if emp and recruiter_id and emp.get("recruiter_id") != recruiter_id:
            return None
        return emp
    query: dict = {
        "$or": [
            *_name_match_clauses(term),
            {"employee_id": {"$regex": _escape_regex(term), "$options": "i"}},
        ]
    }
    if recruiter_id:
        query = {"$and": [{"recruiter_id": recruiter_id}, query]}
    return await database.employees.find_one(query)


async def _find_candidate_by_query(q: str, *, recruiter_id: str | None = None) -> dict | None:
    term = (q or "").strip()
    if not term:
        return None
    if "@" in term:
        cand = await _find_candidate_by_email(term)
        if cand and recruiter_id and cand.get("recruiter_id") != recruiter_id:
            return None
        return cand
    query: dict = {"$or": _name_match_clauses(term)}
    if recruiter_id:
        query = {"$and": [{"recruiter_id": recruiter_id}, query]}
    return await database.candidates.find_one(query)


POST_HIRE_PROFILE_KEYS = ("emergency", "employment", "references", "documents", "nda")
PRE_HIRE_ONBOARDING_KEYS = ("personal", "education", "skills", "government_docs", "resume")


def _candidate_profile_summary(candidate: dict) -> dict:
    """Compact profile for chat — overview fields a recruiter expects to see."""
    onboarding = candidate.get("onboarding") or {}
    personal = onboarding.get("personal") or {}
    education = onboarding.get("education") or {}
    skills = onboarding.get("skills") or {}
    return {
        "full_name": candidate.get("full_name"),
        "email": candidate.get("email"),
        "phone": candidate.get("phone"),
        "job_title": candidate.get("job_title"),
        "department": candidate.get("department"),
        "office_location": candidate.get("office_location"),
        "start_date": candidate.get("start_date"),
        "status": candidate.get("status"),
        "conversion_status": candidate.get("conversion_status"),
        "onboarding_status": onboarding.get("status") or "not_started",
        "current_step": onboarding.get("current_step"),
        "personal": {
            "first_name": personal.get("first_name"),
            "last_name": personal.get("last_name"),
            "date_of_birth": personal.get("date_of_birth"),
            "gender": personal.get("gender"),
            "nationality": personal.get("nationality"),
            "city": personal.get("city"),
            "country": personal.get("country"),
        }
        if personal
        else None,
        "education_entries": (education.get("entries") or [])[:5] if education else [],
        "skills": {
            "technical_skills": (skills.get("technical_skills") or [])[:20],
            "soft_skills": (skills.get("soft_skills") or [])[:20],
            "languages": (skills.get("languages") or [])[:10],
            "certifications": (skills.get("certifications") or [])[:10],
        }
        if skills
        else None,
        "has_resume": bool(
            (onboarding.get("resume") or {}).get("file_url")
            or (onboarding.get("resume") or {}).get("file_name")
        ),
        "has_government_docs": bool((onboarding.get("government_docs") or {}).get("documents")),
        "pre_hire_missing": [k for k in PRE_HIRE_ONBOARDING_KEYS if not onboarding.get(k)],
    }


def _employee_status_payload(employee: dict) -> dict:
    onboarding = employee.get("onboarding") or {}
    missing = [k for k in POST_HIRE_PROFILE_KEYS if not onboarding.get(k)]
    profile_status = employee.get("profile_status") or ("incomplete" if missing else "complete")
    return {
        "found_as": "employee",
        "employee_id": employee.get("employee_id"),
        "full_name": employee.get("full_name"),
        "email": employee.get("email"),
        "job_title": employee.get("job_title"),
        "department": employee.get("department"),
        # Post-hire Complete Profile (emergency, banking, references, policies, Self Declaration)
        "profile_status": profile_status,
        "post_hire_profile_complete": profile_status == "complete" and not missing,
        "post_hire_missing": missing,
        "post_hire_completed": [k for k in POST_HIRE_PROFILE_KEYS if onboarding.get(k)],
        # Candidate-phase fields that already carried over (not the post-hire checklist)
        "pre_hire_on_file": [k for k in PRE_HIRE_ONBOARDING_KEYS if onboarding.get(k)],
    }


async def _tool_list_candidates(user: CurrentUser, args: dict) -> ToolResult:
    query: dict = {}
    if user.role != "super_admin":
        query["recruiter_id"] = user.id
    status_filter = args.get("status")
    if status_filter:
        query["conversion_status"] = status_filter
    docs = await database.candidates.find(query).sort("created_at", -1).to_list(length=50)
    active_docs = [
        d
        for d in docs
        if (d.get("conversion_status") or "").strip().lower() != "converted"
        and (d.get("status") or "").strip().lower() != "converted"
    ]
    items = [
        {
            "candidate_id": d.get("user_id") or str(d.get("_id")),
            "email": d.get("email"),
            "full_name": d.get("full_name"),
            "job_title": d.get("job_title"),
            "conversion_status": d.get("conversion_status"),
            "onboarding_status": (d.get("onboarding") or {}).get("status", "not_started"),
            "note": (
                "Converted to employee — use get_candidate_status for post-hire profile progress."
                if d.get("conversion_status") == "converted" or d.get("status") == "converted"
                else None
            ),
        }
        for d in active_docs
    ]
    return ToolResult(ok=True, data={"candidates": items, "count": len(items)})


async def _tool_list_employees(user: CurrentUser, args: dict) -> ToolResult:
    query: dict = {"status": {"$in": ["active", "inactive", "on_leave"]}}
    if user.role != "super_admin":
        query["recruiter_id"] = user.id
    profile_status = (args.get("profile_status") or "").strip().lower()
    if profile_status in ("incomplete", "complete"):
        query["profile_status"] = profile_status
    docs = await database.employees.find(query).sort("converted_at", -1).to_list(length=50)
    items = []
    for d in docs:
        onboarding = d.get("onboarding") or {}
        missing = [k for k in POST_HIRE_PROFILE_KEYS if not onboarding.get(k)]
        status = d.get("profile_status") or ("incomplete" if missing else "complete")
        items.append(
            {
                "email": d.get("email"),
                "full_name": d.get("full_name"),
                "employee_id": d.get("employee_id"),
                "job_title": d.get("job_title"),
                "profile_status": status,
                "post_hire_profile_complete": status == "complete" and not missing,
                "post_hire_missing": missing,
            }
        )
    return ToolResult(ok=True, data={"employees": items, "count": len(items)})


async def _tool_get_candidate_status(user: CurrentUser, args: dict) -> ToolResult:
    """Prefer the employee record when someone has already been converted.

    Converted people still have a candidate row whose pre-hire onboarding looks
    complete — that must not be reported as post-hire profile completion.
    """
    email = (args.get("email") or "").strip()
    name = (args.get("name") or args.get("full_name") or "").strip()
    # If the model puts a person's name into `email`, treat it as a name search.
    if email and "@" not in email and not name:
        name, email = email, ""
    query = email or name
    if not query:
        return ToolResult(ok=False, error="An email or name is required.")

    scope = _recruiter_scope(user)
    employee = await _find_employee_by_query(query, recruiter_id=scope)
    candidate = await _find_candidate_by_query(query, recruiter_id=scope)

    if employee:
        payload = _employee_status_payload(employee)
        if candidate:
            cand_onboarding = candidate.get("onboarding") or {}
            payload["also_found_as"] = "converted_candidate"
            payload["pre_hire_onboarding_status"] = cand_onboarding.get("status", "not_started")
            payload["conversion_status"] = candidate.get("conversion_status")
            payload["profile"] = _candidate_profile_summary(candidate)
        return ToolResult(ok=True, data=payload)

    if candidate:
        onboarding = candidate.get("onboarding") or {}
        conversion = candidate.get("conversion_status")
        missing = [k for k in PRE_HIRE_ONBOARDING_KEYS if not onboarding.get(k)]
        profile = _candidate_profile_summary(candidate)
        # Converted but employee row somehow missing — still warn clearly.
        if conversion == "converted" or candidate.get("status") == "converted":
            return ToolResult(
                ok=True,
                data={
                    "found_as": "converted_candidate_without_employee_row",
                    "candidate_id": candidate.get("user_id") or str(candidate.get("_id")),
                    "full_name": candidate.get("full_name"),
                    "email": candidate.get("email"),
                    "conversion_status": conversion,
                    "pre_hire_onboarding_status": onboarding.get("status", "not_started"),
                    "pre_hire_missing": missing,
                    "post_hire_profile_complete": False,
                    "profile": profile,
                    "warning": (
                        "This person was converted, but no employee profile row was found. "
                        "Do not treat pre-hire onboarding as post-hire profile completion."
                    ),
                },
            )
        offer = await database.offer_letters.find_one(
            {"candidate_email": (candidate.get("email") or "").lower()},
            sort=[("created_at", -1)],
        )
        return ToolResult(
            ok=True,
            data={
                "found_as": "candidate",
                "candidate_id": candidate.get("user_id") or str(candidate.get("_id")),
                "full_name": candidate.get("full_name"),
                "email": candidate.get("email"),
                "conversion_status": conversion,
                "onboarding_status": onboarding.get("status", "not_started"),
                "pre_hire_missing": missing,
                "pre_hire_complete": not missing,
                "offer_status": (offer or {}).get("status"),
                "offer_id": str(offer["_id"]) if offer else None,
                "profile": profile,
                "note": (
                    "profile includes personal/education/skills when filled. "
                    "Use list_person_documents for uploaded files with download links."
                ),
            },
        )

    return ToolResult(ok=False, error=f"No candidate or employee found for {query}.")


async def _tool_send_invitation(user: CurrentUser, args: dict) -> ToolResult:
    try:
        offer_kwargs = {
            "job_title": args["job_title"],
            "department": args["department"],
            "employment_type": args.get("employment_type") or "Full-time",
            "office_location": args.get("office_location"),
            "is_remote": bool(args.get("is_remote")),
            "reporting_manager": args["reporting_manager"],
            "start_date": args.get("start_date") or None,
            "monthly_salary": args["monthly_salary"],
            "currency": args.get("currency") or "PKR",
            "allowances": args.get("allowances") or args.get("salary_breakdown") or [],
            "benefits": args.get("benefits") or [],
            "offer_expiry_days": args.get("offer_expiry_days"),
            "message_to_candidate": args.get("message_to_candidate"),
        }
        if args.get("terms"):
            offer_kwargs["terms"] = args["terms"]

        payload = CreateInvitationRequest(
            email=args["email"],
            full_name=args["full_name"],
            job_title=args["job_title"],
            department=args["department"],
            office_location=args.get("office_location"),
            is_remote=bool(args.get("is_remote")),
            start_date=args.get("start_date") or None,
            offer=OfferTermsPayload(**offer_kwargs),
            expires_in_days=365,
        )
        result = await invitation_service.create_invitation(payload, user)
        return ToolResult(
            ok=True,
            data={
                **(result if isinstance(result, dict) else {"result": result}),
                "message": f"Invitation sent to {payload.email}.",
            },
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_bulk_invite(user: CurrentUser, args: dict) -> ToolResult:
    """Bulk invite with offer — prefer /dashboard/recruiter/invite bulk Excel for full UX."""
    from app.services.bulk_invite_service import bulk_invite_service

    rows = args.get("candidates") or []
    if not isinstance(rows, list) or not rows:
        return ToolResult(ok=False, error="No candidates provided.")

    normalized = []
    for row in rows[:200]:
        email = (row.get("email") or "").strip()
        full_name = (row.get("full_name") or row.get("name") or "").strip()
        job_title = (row.get("job_title") or row.get("designation") or "").strip()
        department = (row.get("department") or "").strip()
        reporting_manager = (row.get("reporting_manager") or row.get("manager") or "").strip()
        start_date = (row.get("start_date") or "").strip()
        salary_raw = row.get("monthly_salary") if row.get("monthly_salary") is not None else row.get("salary")
        try:
            monthly_salary = float(salary_raw) if salary_raw is not None and str(salary_raw).strip() != "" else None
        except (TypeError, ValueError):
            monthly_salary = None
        missing = [
            label
            for label, value in (
                ("email", email),
                ("full_name", full_name),
                ("job_title", job_title),
                ("department", department),
                ("reporting_manager", reporting_manager),
                ("start_date", start_date),
                ("monthly_salary", monthly_salary),
            )
            if value is None or value == ""
        ]
        benefits = row.get("benefits")
        if isinstance(benefits, str):
            benefits = [b.strip() for b in benefits.split(",") if b.strip()]
        normalized.append(
            {
                **row,
                "email": email or None,
                "full_name": full_name or None,
                "job_title": job_title or None,
                "department": department or None,
                "reporting_manager": reporting_manager or None,
                "start_date": start_date or None,
                "monthly_salary": monthly_salary,
                "office_location": row.get("office_location") or None,
                "employment_type": row.get("employment_type") or "Full-time",
                "currency": (row.get("currency") or "PKR"),
                "expires_in_days": 365,
                "offer_expiry_days": int(row.get("offer_expiry_days") or 14),
                "message_to_candidate": row.get("message_to_candidate"),
                "benefits": benefits if isinstance(benefits, list) else [],
                "missing_fields": missing,
                "valid": not missing,
                "selected": not missing,
            }
        )

    try:
        result = await bulk_invite_service.send_rows(user, normalized)
        return ToolResult(
            ok=True,
            data={
                "sent": result.get("sent") or [],
                "failed": result.get("failed") or [],
                "skipped": result.get("skipped") or [],
                "total": len(rows),
            },
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_create_offer(user: CurrentUser, args: dict) -> ToolResult:
    email = (args.get("candidate_email") or "").lower().strip()
    candidate = await _find_candidate_by_email(email)
    if not candidate:
        return ToolResult(ok=False, error=f"No candidate found with email {email}.")
    candidate_id = candidate.get("user_id") or str(candidate["_id"])
    try:
        payload = OfferCreateRequest(
            candidate_id=candidate_id,
            job_title=args["job_title"],
            department=args["department"],
            employment_type=args.get("employment_type") or "Full-time",
            office_location=args.get("office_location"),
            reporting_manager=args["reporting_manager"],
            start_date=args["start_date"],
            monthly_salary=args.get("monthly_salary"),
            currency=args.get("currency") or "PKR",
            offer_expiry_days=args.get("offer_expiry_days"),
            message_to_candidate=args.get("message_to_candidate"),
        )
        result = await offer_service.create_and_send(user, payload)
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_send_joining_letter(user: CurrentUser, args: dict) -> ToolResult:
    email = (args.get("candidate_email") or "").lower().strip()
    if not email:
        return ToolResult(ok=False, error="A candidate/employee email is required.")

    target = await _find_candidate_by_email(email) or await _find_employee_by_email(email)
    if not target:
        return ToolResult(ok=False, error=f"No candidate or employee found for {email}.")

    join_date = args.get("join_date")
    join_time = args.get("join_time")
    office_address = args.get("office_address")
    if not (join_date and join_time and office_address):
        return ToolResult(ok=False, error="join_date, join_time, and office_address are all required.")

    documents_required = args.get("documents_required") or DEFAULT_JOINING_DOCUMENTS
    try:
        email_service.send_joining_letter(
            to_email=target.get("email"),
            full_name=target.get("full_name") or "there",
            job_title=target.get("job_title") or "Team Member",
            join_date=join_date,
            join_time=join_time,
            office_address=office_address,
            documents_required=documents_required,
            map_link=args.get("map_link"),
            extra_notes=args.get("extra_notes"),
        )
    except Exception as exc:  # noqa: BLE001
        return ToolResult(ok=False, error=f"Could not send email: {exc}")

    await database.audit_logs.insert_one(
        {
            "user_id": user.id,
            "email": target.get("email"),
            "role": user.role,
            "module": "recruitment",
            "action": "joining_letter_sent",
            "outcome": "success",
            "created_at": datetime.now(UTC),
        }
    )
    return ToolResult(
        ok=True,
        data={
            "message": f"Joining letter emailed to {target.get('email')}.",
            "join_date": join_date,
            "join_time": join_time,
            "documents_required": documents_required,
        },
    )


async def _tool_remind_employee_profile(user: CurrentUser, args: dict) -> ToolResult:
    """Send post-hire Complete Profile reminder email + in-app notification."""
    email = (args.get("email") or "").strip()
    name = (args.get("name") or args.get("full_name") or "").strip()
    employee_id = (args.get("employee_id") or "").strip()
    note = args.get("note")
    force = bool(args.get("force") or args.get("resend"))

    employee = None
    if employee_id:
        try:
            employee = await employee_service._resolve_employee_for_recruiter(user, employee_id)
        except Exception as exc:  # noqa: BLE001
            return _err(exc)
    else:
        query = email or name
        if not query:
            return ToolResult(ok=False, error="Provide email, name, or employee_id.")
        employee = await _find_employee_by_query(query, recruiter_id=_recruiter_scope(user))
        if not employee:
            return ToolResult(ok=False, error=f"No employee found for {query}.")

    try:
        result = await employee_service.remind_profile_completion(
            user,
            employee.get("employee_id") or str(employee.get("_id")),
            note,
            force=force,
        )
        return ToolResult(
            ok=True,
            data={
                "message": result.get("message"),
                "email_sent": result.get("email_sent"),
                "notification_sent": result.get("notification_sent", False),
                "notification_id": result.get("notification_id"),
                "email_to": result.get("email_to"),
                "email_error": result.get("email_error"),
                "missing_steps": result.get("missing_steps"),
                "employee_id": employee.get("employee_id"),
                "full_name": employee.get("full_name"),
            },
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


def _doc_summary(doc: dict) -> dict:
    """Normalize document fields for LLM replies and rich chat attachment cards."""
    doc_id = doc.get("id") or doc.get("document_id") or str(doc.get("_id") or "")
    file_url = doc.get("file_url") or doc.get("download_url")
    return {
        # `id` is what the frontend document cards / verify API expect.
        "id": doc_id,
        "document_id": doc_id,
        "doc_type": doc.get("doc_type"),
        "category": doc.get("category"),
        "file_name": doc.get("file_name"),
        "file_url": file_url,
        "status": doc.get("status") or doc.get("verification_status"),
        "verification_status": doc.get("verification_status"),
        "rejection_reason": doc.get("rejection_reason"),
        "mismatches": (doc.get("mismatches") or doc.get("profile_mismatches") or [])[:3],
        "cross_document_mismatches": (doc.get("cross_document_mismatches") or [])[:3],
        "uploaded_at": doc.get("uploaded_at"),
    }


async def _resolve_employee(user: CurrentUser, args: dict) -> tuple[dict | None, str | None]:
    """Resolve an employee from email/name/employee_id. Returns (employee, error)."""
    employee_id = (args.get("employee_id") or "").strip()
    email = (args.get("email") or "").strip()
    name = (args.get("name") or args.get("full_name") or "").strip()
    if email and "@" not in email and not name:
        name, email = email, ""
    try:
        if employee_id:
            return await employee_service._resolve_employee_for_recruiter(user, employee_id), None
        query = email or name
        if not query:
            return None, "Provide email, name, or employee_id."
        employee = await _find_employee_by_query(query, recruiter_id=_recruiter_scope(user))
        if not employee:
            return None, f"No employee found for {query}."
        # Enforce recruiter ownership via service resolver.
        resolved = await employee_service._resolve_employee_for_recruiter(
            user, employee.get("employee_id") or str(employee.get("_id"))
        )
        return resolved, None
    except Exception as exc:  # noqa: BLE001
        if isinstance(exc, HTTPException):
            return None, str(exc.detail)
        return None, str(exc)


async def _resolve_candidate(user: CurrentUser, args: dict) -> tuple[dict | None, str | None]:
    from bson import ObjectId

    email = (args.get("email") or args.get("candidate_email") or "").strip()
    name = (args.get("name") or args.get("full_name") or "").strip()
    candidate_id = (args.get("candidate_id") or "").strip()
    if email and "@" not in email and not name:
        name, email = email, ""
    if candidate_id:
        query: dict = {"$or": [{"user_id": candidate_id}]}
        if ObjectId.is_valid(candidate_id):
            query["$or"].append({"_id": ObjectId(candidate_id)})
        scope = _recruiter_scope(user)
        if scope:
            query = {"$and": [query, {"recruiter_id": scope}]}
        doc = await database.candidates.find_one(query)
        return (doc, None) if doc else (None, f"No candidate found for id {candidate_id}.")
    query_text = email or name
    if not query_text:
        return None, "Provide email, name, or candidate_id."
    doc = await _find_candidate_by_query(query_text, recruiter_id=_recruiter_scope(user))
    if not doc:
        return None, f"No candidate found for {query_text}."
    return doc, None


def _owner_id_from_person(person: dict) -> str | None:
    return person.get("user_id") or (str(person["_id"]) if person.get("_id") else None)


async def _tool_list_pipeline(user: CurrentUser, args: dict) -> ToolResult:
    """List candidates in a pipeline bucket: pending_review | onboarding | ready_to_activate | all."""
    bucket = (args.get("bucket") or args.get("status") or "all").strip().lower()
    try:
        if bucket in ("pending_review", "pending", "submitted"):
            data = await employee_service.list_pending_review(user)
            return ToolResult(ok=True, data={"bucket": "pending_review", **data})
        if bucket in ("onboarding", "in_progress", "new_signups"):
            data = await employee_service.list_onboarding_in_progress(user)
            return ToolResult(ok=True, data={"bucket": "onboarding_in_progress", **data})
        if bucket in ("ready_to_activate", "ready", "signed", "ready_for_conversion"):
            data = await employee_service.list_ready_for_conversion(user)
            return ToolResult(ok=True, data={"bucket": "ready_to_activate", **data})
        # all three buckets
        pending = await employee_service.list_pending_review(user)
        onboarding = await employee_service.list_onboarding_in_progress(user)
        ready = await employee_service.list_ready_for_conversion(user)
        return ToolResult(
            ok=True,
            data={
                "bucket": "all",
                "pending_review": pending,
                "onboarding_in_progress": onboarding,
                "ready_to_activate": ready,
            },
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_approve_offer(user: CurrentUser, args: dict) -> ToolResult:
    offer_id = (args.get("offer_id") or "").strip()
    email = (args.get("email") or args.get("candidate_email") or "").strip()
    name = (args.get("name") or "").strip()
    note = args.get("note")

    try:
        if not offer_id:
            # Resolve from ready-to-activate list by email/name
            ready = await employee_service.list_ready_for_conversion(user)
            candidates = ready.get("candidates") or []
            match = None
            for c in candidates:
                if email and (c.get("email") or "").lower() == email.lower():
                    match = c
                    break
                if name and name.lower() in (c.get("full_name") or "").lower():
                    match = c
                    break
            if not match:
                return ToolResult(
                    ok=False,
                    error="No signed offer found. Provide offer_id or email of someone in ready_to_activate.",
                )
            offer_id = match.get("offer_id")
            if not offer_id:
                return ToolResult(ok=False, error="Matched candidate has no offer_id.")

        payload = OfferApproveRequest(note=note)
        result = await offer_service.approve(user, offer_id, payload)
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_bulk_approve_offers(user: CurrentUser, args: dict) -> ToolResult:
    """Approve all (or listed) signed offers and convert to employees."""
    emails = [e.lower().strip() for e in (args.get("emails") or []) if e]
    note = args.get("note")
    try:
        ready = await employee_service.list_ready_for_conversion(user)
        targets = ready.get("candidates") or []
        if emails:
            targets = [c for c in targets if (c.get("email") or "").lower() in emails]
        if not targets:
            return ToolResult(ok=True, data={"approved": [], "failed": [], "message": "No signed offers to approve."})

        approved, failed = [], []
        for c in targets[:BULK_CAP]:
            offer_id = c.get("offer_id")
            if not offer_id:
                failed.append({"email": c.get("email"), "error": "Missing offer_id"})
                continue
            try:
                result = await offer_service.approve(user, offer_id, OfferApproveRequest(note=note))
                approved.append(
                    {
                        "email": c.get("email"),
                        "full_name": c.get("full_name"),
                        "offer_id": offer_id,
                        "employee_id": (result.get("employee") or {}).get("employee_id"),
                    }
                )
            except Exception as exc:  # noqa: BLE001
                detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
                failed.append({"email": c.get("email"), "error": str(detail)})
        return ToolResult(ok=True, data={"approved": approved, "failed": failed, "total": len(targets)})
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_list_person_documents(user: CurrentUser, args: dict) -> ToolResult:
    """List documents for a candidate or employee (by email/name/id)."""
    person = None
    err = None
    # Prefer employee, then candidate
    emp, emp_err = await _resolve_employee(user, args)
    if emp:
        person = emp
    else:
        cand, cand_err = await _resolve_candidate(user, args)
        if cand:
            person = cand
        else:
            err = emp_err or cand_err or "Person not found."
    if not person:
        return ToolResult(ok=False, error=err)

    owner_id = _owner_id_from_person(person)
    if not owner_id:
        return ToolResult(ok=False, error="Could not resolve owner_id for this person.")
    try:
        result = await document_service.list_for_owner(user, owner_id)
        docs = []
        for d in result.get("documents") or []:
            summary = _doc_summary(d)
            doc_id = summary.get("document_id")
            if doc_id:
                try:
                    link = await document_service.get_signed_url(user, doc_id, None)
                    signed = link.get("url")
                    summary["download_url"] = signed
                    summary["file_url"] = signed or summary.get("file_url")
                    summary["download_expires_in"] = link.get("expires_in")
                except Exception:  # noqa: BLE001
                    summary["download_url"] = summary.get("file_url")
            docs.append(summary)
        return ToolResult(
            ok=True,
            data={
                # Top-level fields keep document attachment cards working.
                "owner_id": owner_id,
                "full_name": person.get("full_name"),
                "email": person.get("email"),
                "owner": {
                    "full_name": person.get("full_name"),
                    "email": person.get("email"),
                    "employee_id": person.get("employee_id"),
                    "owner_id": owner_id,
                },
                "documents": docs,
                "count": len(docs),
                "document_verification": result.get("document_verification"),
                "note": (
                    "Documents are also shown as interactive cards in chat. Briefly summarize "
                    "count and any OCR mismatches; include download_url links when helpful."
                ),
            },
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_verify_document(user: CurrentUser, args: dict) -> ToolResult:
    document_id = (args.get("document_id") or "").strip()
    if not document_id:
        return ToolResult(ok=False, error="document_id is required.")
    status = (args.get("status") or "").strip()
    if status not in ("verified", "rejected", "reupload_required", "mismatch"):
        return ToolResult(
            ok=False,
            error="status must be verified | rejected | reupload_required | mismatch.",
        )
    try:
        payload = DocumentVerifyRequest(
            status=status,
            rejection_reason=args.get("rejection_reason"),
            note=args.get("note"),
            approve_despite_mismatch=bool(args.get("approve_despite_mismatch")),
        )
        result = await document_service.verify(user, document_id, payload)
        return ToolResult(
            ok=True,
            data={
                "message": result.get("message"),
                "email_sent": result.get("email_sent"),
                "document": _doc_summary(result.get("document") or {}),
            },
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_bulk_verify_documents(user: CurrentUser, args: dict) -> ToolResult:
    """Verify/reject/request-reupload for many documents at once."""
    items = args.get("documents") or args.get("items") or []
    if not isinstance(items, list) or not items:
        return ToolResult(ok=False, error="Provide documents: [{document_id, status, ...}, ...].")
    done, failed = [], []
    for row in items[:BULK_CAP]:
        try:
            result = await _tool_verify_document(user, row)
            if result.ok:
                done.append(result.data)
            else:
                failed.append({"document_id": row.get("document_id"), "error": result.error})
        except Exception as exc:  # noqa: BLE001
            failed.append({"document_id": row.get("document_id"), "error": str(exc)})
    return ToolResult(ok=True, data={"updated": done, "failed": failed, "total": len(items)})


async def _tool_get_document_link(user: CurrentUser, args: dict) -> ToolResult:
    document_id = (args.get("document_id") or "").strip()
    if not document_id:
        return ToolResult(ok=False, error="document_id is required.")
    try:
        result = await document_service.get_signed_url(user, document_id, None)
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_search_people(user: CurrentUser, args: dict) -> ToolResult:
    q = (args.get("query") or args.get("q") or "").strip()
    if len(q) < 2:
        return ToolResult(ok=False, error="Search query must be at least 2 characters.")
    try:
        result = await dashboard_service.search(user, q)
        # If query looks like an email, also attach full multi-cycle history.
        history = None
        if "@" in q:
            history = await employee_service.lookup_person_history(user, q)
            result = {
                **result,
                "person_history": history,
                "suggestion_summary": (history or {}).get("suggestion_summary"),
            }
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_lookup_person_history(user: CurrentUser, args: dict) -> ToolResult:
    email = (args.get("email") or "").strip()
    if "@" not in email:
        return ToolResult(ok=False, error="Provide a valid email to look up historical records.")
    try:
        result = await employee_service.lookup_person_history(user, email)
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_mark_employee_exit(user: CurrentUser, args: dict) -> ToolResult:
    employee_id = (args.get("employee_id") or "").strip()
    exit_type = (args.get("exit_type") or "").strip().lower()
    if not employee_id:
        return ToolResult(ok=False, error="employee_id is required.")
    if exit_type not in {"resigned", "terminated", "exited"}:
        return ToolResult(ok=False, error="exit_type must be resigned, terminated, or exited.")
    try:
        from app.schemas.employee_exit import EmployeeExitRequest

        request = EmployeeExitRequest(
            exit_type=exit_type,
            exit_reason=args.get("exit_reason") or args.get("reason"),
            note=args.get("note"),
            lock_profile=bool(args.get("lock_profile", True)),
        )
        result = await employee_service.mark_employee_exit(user, employee_id, request)
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_get_activity(user: CurrentUser, args: dict) -> ToolResult:
    try:
        limit = int(args.get("limit") or 20)
        result = await dashboard_service.get_activity(user, limit=limit)
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_directory_employees(user: CurrentUser, args: dict) -> ToolResult:
    try:
        result = await employee_service.list_employees(
            user,
            q=args.get("q") or args.get("query"),
            employee_id=args.get("employee_id"),
            department=args.get("department"),
            job_title=args.get("job_title"),
            status=args.get("status"),
            profile_status=args.get("profile_status"),
            joining_from=args.get("joining_from"),
            joining_to=args.get("joining_to"),
            history_bucket=args.get("history_bucket"),
            sort=args.get("sort") or "created_at",
            page=int(args.get("page") or 1),
            page_size=min(int(args.get("page_size") or 20), 100),
        )
        # Slim payload for LLM
        employees = []
        for e in result.get("employees") or []:
            employees.append(
                {
                    "employee_id": e.get("employee_id"),
                    "full_name": e.get("full_name"),
                    "email": e.get("email"),
                    "job_title": e.get("job_title"),
                    "department": e.get("department"),
                    "status": e.get("status"),
                    "profile_status": e.get("profile_status"),
                    "company_email": e.get("company_email"),
                    "office_location": e.get("office_location"),
                }
            )
        return ToolResult(
            ok=True,
            data={
                "employees": employees,
                "count": result.get("count"),
                "total": result.get("total"),
                "page": result.get("page"),
                "pages": result.get("pages"),
            },
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_export_employees(user: CurrentUser, args: dict) -> ToolResult:
    try:
        csv_text = await employee_service.export_employees_csv(
            user,
            q=args.get("q") or args.get("query"),
            employee_id=args.get("employee_id"),
            department=args.get("department"),
            job_title=args.get("job_title"),
            status=args.get("status"),
            profile_status=args.get("profile_status"),
            joining_from=args.get("joining_from"),
            joining_to=args.get("joining_to"),
        )
        lines = (csv_text or "").splitlines()
        preview = "\n".join(lines[:12])
        return ToolResult(
            ok=True,
            data={
                "row_count": max(0, len(lines) - 1),
                "preview_csv": preview,
                "csv": csv_text,
                "filename": "employees_export.csv",
                "mime_type": "text/csv",
                "message": (
                    f"Export ready with {max(0, len(lines) - 1)} employee row(s). "
                    "The full CSV is in the `csv` field — share a downloadable preview of the first rows "
                    "and tell the recruiter they can copy the CSV or use the Employees page Export button."
                ),
            },
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_get_employee_detail(user: CurrentUser, args: dict) -> ToolResult:
    employee, err = await _resolve_employee(user, args)
    if not employee:
        return ToolResult(ok=False, error=err)
    try:
        result = await employee_service.get_employee_profile(
            user,
            employee.get("employee_id") or str(employee.get("_id")),
            reveal_banking=False,
        )
        emp = result.get("employee") or {}
        progress = emp.get("profile_progress") or {}
        assets = emp.get("assets") or []
        orientation = emp.get("orientation")
        onboarding = emp.get("onboarding") or {}
        personal = onboarding.get("personal") or {}
        education = onboarding.get("education") or {}
        skills = onboarding.get("skills") or {}
        return ToolResult(
            ok=True,
            data={
                "employee_id": emp.get("employee_id"),
                "full_name": emp.get("full_name"),
                "email": emp.get("email"),
                "phone": emp.get("phone"),
                "company_email": emp.get("company_email"),
                "job_title": emp.get("job_title"),
                "department": emp.get("department"),
                "status": emp.get("status"),
                "office_location": emp.get("office_location"),
                "profile_progress": progress,
                "personal": {
                    "first_name": personal.get("first_name"),
                    "last_name": personal.get("last_name"),
                    "date_of_birth": personal.get("date_of_birth"),
                    "gender": personal.get("gender"),
                    "city": personal.get("city"),
                    "country": personal.get("country"),
                }
                if personal
                else None,
                "education_entries": (education.get("entries") or [])[:5] if education else [],
                "skills": {
                    "technical_skills": (skills.get("technical_skills") or [])[:20],
                    "soft_skills": (skills.get("soft_skills") or [])[:20],
                    "languages": (skills.get("languages") or [])[:10],
                }
                if skills
                else None,
                "post_hire_sections_on_file": [
                    k for k in POST_HIRE_PROFILE_KEYS if onboarding.get(k)
                ],
                "assets": [
                    {
                        "asset_id": a.get("id") or a.get("asset_id"),
                        "name": a.get("name"),
                        "asset_type": a.get("asset_type"),
                        "serial_number": a.get("serial_number"),
                        "status": a.get("status"),
                    }
                    for a in assets
                ],
                "orientation": orientation,
                "career_event_count": len(emp.get("career_events") or emp.get("career") or []),
                "note": (
                    "Banking details stay masked in chat. Use list_person_documents for files with download links, "
                    "and list_career_events for the career timeline."
                ),
            },
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_bulk_remind_profiles(user: CurrentUser, args: dict) -> ToolResult:
    """Remind all (or listed) employees with incomplete post-hire profiles."""
    force = bool(args.get("force") or args.get("resend"))
    note = args.get("note")
    emails = [e.lower().strip() for e in (args.get("emails") or []) if e]
    try:
        # Collect incomplete employees (paginate)
        targets = []
        page = 1
        while page <= 20:
            batch = await employee_service.list_employees(
                user, profile_status="incomplete", page=page, page_size=100
            )
            targets.extend(batch.get("employees") or [])
            if page >= (batch.get("pages") or 1):
                break
            page += 1

        if emails:
            targets = [e for e in targets if (e.get("email") or "").lower() in emails]

        sent, failed, skipped = [], [], []
        for e in targets[:BULK_CAP]:
            eid = e.get("employee_id")
            try:
                result = await employee_service.remind_profile_completion(user, eid, note, force=force)
                sent.append(
                    {
                        "employee_id": eid,
                        "email": e.get("email"),
                        "email_sent": result.get("email_sent"),
                        "notification_sent": result.get("notification_sent"),
                    }
                )
            except HTTPException as exc:
                if exc.status_code == 429:
                    skipped.append({"employee_id": eid, "email": e.get("email"), "reason": str(exc.detail)})
                else:
                    failed.append({"employee_id": eid, "email": e.get("email"), "error": str(exc.detail)})
            except Exception as exc:  # noqa: BLE001
                failed.append({"employee_id": eid, "email": e.get("email"), "error": str(exc)})

        return ToolResult(
            ok=True,
            data={
                "sent": sent,
                "failed": failed,
                "skipped": skipped,
                "total_targeted": len(targets),
                "message": f"Reminded {len(sent)} employee(s); {len(failed)} failed; {len(skipped)} skipped (recently reminded).",
            },
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_set_company_email(user: CurrentUser, args: dict) -> ToolResult:
    employee, err = await _resolve_employee(user, args)
    if not employee:
        return ToolResult(ok=False, error=err)
    company_email = (args.get("company_email") or "").strip()
    if not company_email:
        return ToolResult(ok=False, error="company_email is required.")
    try:
        payload = CompanyEmailRequest(company_email=company_email)
        # set_company_email expects string; validate via model first
        result = await employee_service.set_company_email(
            user,
            employee.get("employee_id") or str(employee.get("_id")),
            str(payload.company_email),
        )
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_bulk_set_company_email(user: CurrentUser, args: dict) -> ToolResult:
    rows = args.get("assignments") or args.get("employees") or []
    if not isinstance(rows, list) or not rows:
        return ToolResult(
            ok=False,
            error="Provide assignments: [{email|employee_id, company_email}, ...].",
        )
    done, failed = [], []
    for row in rows[:BULK_CAP]:
        result = await _tool_set_company_email(user, row)
        if result.ok:
            done.append({"email": row.get("email"), "company_email": row.get("company_email"), **(result.data or {})})
        else:
            failed.append({"email": row.get("email") or row.get("employee_id"), "error": result.error})
    return ToolResult(ok=True, data={"updated": done, "failed": failed, "total": len(rows)})


async def _tool_assign_asset(user: CurrentUser, args: dict) -> ToolResult:
    # `name` is the asset name — resolve person by email/employee_id only.
    person_args = {
        "email": args.get("email"),
        "employee_id": args.get("employee_id"),
        "full_name": args.get("person_name") or args.get("employee_name"),
    }
    employee, err = await _resolve_employee(user, person_args)
    if not employee:
        return ToolResult(ok=False, error=err)
    asset_name = (args.get("name") or args.get("asset_name") or "").strip()
    if not asset_name:
        return ToolResult(ok=False, error="Asset name is required.")
    try:
        payload = AssetAssignRequest(
            name=asset_name,
            asset_type=args.get("asset_type") or "other",
            serial_number=args.get("serial_number"),
            notes=args.get("notes"),
        )
        result = await employee_service.assign_asset(
            user, employee.get("employee_id") or str(employee.get("_id")), payload
        )
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_bulk_assign_assets(user: CurrentUser, args: dict) -> ToolResult:
    """Assign the same asset (or per-row assets) to many employees."""
    rows = args.get("assignments") or []
    # Shorthand: same asset for many emails
    emails = args.get("emails") or []
    shared_name = args.get("name")
    if emails and shared_name:
        rows = [
            {
                "email": e,
                "name": shared_name,
                "asset_type": args.get("asset_type") or "other",
                "serial_number": args.get("serial_number"),
                "notes": args.get("notes"),
            }
            for e in emails
        ]
    if not isinstance(rows, list) or not rows:
        return ToolResult(
            ok=False,
            error="Provide assignments: [{email, name, asset_type?}] or emails[] + name.",
        )
    done, failed = [], []
    for row in rows[:BULK_CAP]:
        result = await _tool_assign_asset(user, row)
        if result.ok:
            done.append({"email": row.get("email") or row.get("employee_id"), "name": row.get("name")})
        else:
            failed.append({"email": row.get("email") or row.get("employee_id"), "error": result.error})
    return ToolResult(ok=True, data={"assigned": done, "failed": failed, "total": len(rows)})


async def _tool_update_asset(user: CurrentUser, args: dict) -> ToolResult:
    person_args = {
        "email": args.get("email"),
        "employee_id": args.get("employee_id"),
        "full_name": args.get("person_name") or args.get("employee_name"),
    }
    employee, err = await _resolve_employee(user, person_args)
    if not employee:
        return ToolResult(ok=False, error=err)
    asset_id = (args.get("asset_id") or "").strip()
    if not asset_id:
        return ToolResult(ok=False, error="asset_id is required.")
    try:
        payload = AssetUpdateRequest(
            name=args.get("name") or args.get("asset_name"),
            asset_type=args.get("asset_type"),
            serial_number=args.get("serial_number"),
            notes=args.get("notes"),
            status=args.get("status"),
        )
        result = await employee_service.update_asset(
            user, employee.get("employee_id") or str(employee.get("_id")), asset_id, payload
        )
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_remove_asset(user: CurrentUser, args: dict) -> ToolResult:
    employee, err = await _resolve_employee(user, args)
    if not employee:
        return ToolResult(ok=False, error=err)
    asset_id = (args.get("asset_id") or "").strip()
    if not asset_id:
        return ToolResult(ok=False, error="asset_id is required.")
    try:
        result = await employee_service.remove_asset(
            user, employee.get("employee_id") or str(employee.get("_id")), asset_id
        )
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_schedule_orientation(user: CurrentUser, args: dict) -> ToolResult:
    employee, err = await _resolve_employee(user, args)
    if not employee:
        return ToolResult(ok=False, error=err)
    try:
        payload = OrientationScheduleRequest(
            date=args["date"],
            time=args["time"],
            meeting_link=args.get("meeting_link"),
            trainer=args["trainer"],
            agenda=args["agenda"],
        )
        result = await employee_service.schedule_orientation(
            user, employee.get("employee_id") or str(employee.get("_id")), payload
        )
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_bulk_schedule_orientation(user: CurrentUser, args: dict) -> ToolResult:
    """Schedule the same orientation for many employees (or per-row schedules)."""
    rows = args.get("assignments") or []
    emails = args.get("emails") or []
    if emails and args.get("date") and args.get("time") and args.get("trainer") and args.get("agenda"):
        rows = [
            {
                "email": e,
                "date": args["date"],
                "time": args["time"],
                "meeting_link": args.get("meeting_link"),
                "trainer": args["trainer"],
                "agenda": args["agenda"],
            }
            for e in emails
        ]
    if not isinstance(rows, list) or not rows:
        return ToolResult(
            ok=False,
            error="Provide emails[] + date/time/trainer/agenda, or assignments[{email, date, time, trainer, agenda}].",
        )
    done, failed = [], []
    for row in rows[:BULK_CAP]:
        result = await _tool_schedule_orientation(user, row)
        if result.ok:
            done.append({"email": row.get("email") or row.get("employee_id")})
        else:
            failed.append({"email": row.get("email") or row.get("employee_id"), "error": result.error})
    return ToolResult(ok=True, data={"scheduled": done, "failed": failed, "total": len(rows)})


async def _tool_list_career(user: CurrentUser, args: dict) -> ToolResult:
    employee, err = await _resolve_employee(user, args)
    if not employee:
        return ToolResult(ok=False, error=err)
    try:
        # Ownership already checked via _resolve_employee
        result = await employee_service.list_career_events(
            employee.get("employee_id") or str(employee.get("_id"))
        )
        return ToolResult(
            ok=True,
            data={
                "employee_id": employee.get("employee_id"),
                "full_name": employee.get("full_name"),
                "events": result.get("events") or [],
            },
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_add_career_event(user: CurrentUser, args: dict) -> ToolResult:
    employee, err = await _resolve_employee(user, args)
    if not employee:
        return ToolResult(ok=False, error=err)
    try:
        payload = CareerEventCreateRequest(
            event_type=args["event_type"],
            effective_date=args["effective_date"],
            from_title=args.get("from_title"),
            to_title=args.get("to_title"),
            from_department=args.get("from_department"),
            to_department=args.get("to_department"),
            from_manager=args.get("from_manager"),
            to_manager=args.get("to_manager"),
            from_status=args.get("from_status"),
            to_status=args.get("to_status"),
            note=args.get("note"),
        )
        result = await employee_service.add_career_event(
            user, employee.get("employee_id") or str(employee.get("_id")), payload
        )
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_list_announcements(user: CurrentUser, args: dict) -> ToolResult:
    try:
        result = await dashboard_service.list_announcements(
            user,
            limit=int(args.get("limit") or 20),
            audience=args.get("audience"),
        )
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_create_announcement(user: CurrentUser, args: dict) -> ToolResult:
    try:
        payload = CreateAnnouncementRequest(
            title=args["title"],
            body=args["body"],
            audience=args.get("audience") or "both",
            target_departments=args.get("target_departments") or [],
            target_designations=args.get("target_designations") or [],
            target_employee_ids=args.get("target_employee_ids") or [],
            send_email=bool(args.get("send_email", True)),
        )
        result = await dashboard_service.create_announcement(user, payload)
        return ToolResult(
            ok=True,
            data={
                "message": result.get("message"),
                "notified": result.get("notified"),
                "emailed": result.get("emailed"),
                "announcement": result.get("announcement"),
            },
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


RECRUITER_TOOLS: list[Tool] = [
    Tool(
        name="send_invitation",
        description="Invite a single candidate with a full offer letter so they can create an account and start onboarding.",
        parameters={
            "email": "string, required",
            "full_name": "string, required",
            "job_title": "string, required",
            "department": "string, required",
            "reporting_manager": "string, required",
            "monthly_salary": "number, required",
            "currency": "string, optional, default PKR",
            "employment_type": "string, optional, default Full-time",
            "office_location": "string, optional",
            "is_remote": "boolean, optional, true if remote employee (self-manages banking)",
            "start_date": "string YYYY-MM-DD or relative text like 'tomorrow', optional",
            "offer_expiry_days": "integer, optional",
            "allowances": "array of {label, amount}, optional",
            "benefits": "array of strings, optional",
            "terms": "string, optional",
            "message_to_candidate": "string, optional",
        },
        handler=_tool_send_invitation,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="bulk_invite",
        description=(
            "Invite many candidates at once WITH offer letters. Each row MUST include email, "
            "full_name, job_title, department, reporting_manager, start_date, monthly_salary — "
            "relative dates like 'tomorrow' are accepted and normalized — "
            "same as Create invitation / bulk Excel template. Prefer directing recruiters to "
            "/dashboard/recruiter/invite bulk Excel for history review. Never invent missing fields."
        ),
        parameters={
            "candidates": (
                "array of {email, full_name, job_title, department, reporting_manager, "
                "start_date, monthly_salary, office_location?, currency?, benefits?}"
            )
        },
        handler=_tool_bulk_invite,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="list_candidates",
        description=(
            "List active candidates only. Converted people are employees; use list_employees or get_candidate_status "
            "to see post-hire Complete Profile progress."
        ),
        parameters={"status": "optional conversion_status filter"},
        handler=_tool_list_candidates,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="list_pipeline",
        description=(
            "List candidates in a hiring pipeline bucket. "
            "bucket=pending_review (intake submitted), onboarding (in progress), ready_to_activate (signed offer), or all."
        ),
        parameters={"bucket": "pending_review | onboarding | ready_to_activate | all"},
        handler=_tool_list_pipeline,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="list_employees",
        description=(
            "Quick list of employees and post-hire Complete Profile status. "
            "For filters (department, title, status, pagination) prefer directory_employees."
        ),
        parameters={"profile_status": "optional: incomplete|complete"},
        handler=_tool_list_employees,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="directory_employees",
        description="Search/filter the employee directory (q, department, job_title, status, profile_status, pagination).",
        parameters={
            "q": "string, optional",
            "department": "string, optional",
            "job_title": "string, optional",
            "status": "active|inactive|on_leave, optional",
            "profile_status": "incomplete|complete, optional",
            "employee_id": "string, optional",
            "page": "integer, optional",
            "page_size": "integer, optional max 100",
        },
        handler=_tool_directory_employees,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="export_employees",
        description="Export filtered employees as full CSV (same filters as directory). Returns csv text + preview for download in chat.",
        parameters={
            "q": "string, optional",
            "department": "string, optional",
            "job_title": "string, optional",
            "status": "string, optional",
            "profile_status": "incomplete|complete, optional",
        },
        handler=_tool_export_employees,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="get_candidate_status",
        description=(
            "Look up one person by email or name. Returns status plus a profile summary "
            "(personal/education/skills for candidates; post-hire progress for employees). "
            "If they are an employee (converted), report post_hire_* fields — NOT only pre-hire onboarding."
        ),
        parameters={
            "email": "string, preferred when known",
            "name": "string, optional alternative to email (full or partial name)",
        },
        handler=_tool_get_candidate_status,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="get_employee_detail",
        description="Full employee overview: profile progress, company email, assets, orientation summary.",
        parameters={
            "email": "string, optional",
            "name": "string, optional",
            "employee_id": "string, optional e.g. EMP-000022",
        },
        handler=_tool_get_employee_detail,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="search_people",
        description="Global search across candidates and employees by name, email, phone, department, title, or IDs. Includes historical matches.",
        parameters={"query": "string, required, min 2 chars"},
        handler=_tool_search_people,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="lookup_person_history",
        description=(
            "Look up ALL prior candidate cycles and employee tenures for an email. "
            "Use before inviting someone who may have been a prior candidate or exited employee. "
            "Returns suggestion_summary, can_reinvite, and hrefs to historical records."
        ),
        parameters={"email": "string, required"},
        handler=_tool_lookup_person_history,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="mark_employee_exit",
        description=(
            "Mark an active employee as resigned, terminated, or exited. "
            "Moves them to historical employees and archives their login so the same email can be reinvited as a candidate."
        ),
        parameters={
            "employee_id": "string, required e.g. EMP-000022",
            "exit_type": "resigned | terminated | exited",
            "exit_reason": "string, optional",
            "note": "string, optional",
            "lock_profile": "boolean, optional default true",
        },
        handler=_tool_mark_employee_exit,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="get_activity",
        description="Recent recruiting activity feed (offers, docs, onboarding events).",
        parameters={"limit": "integer 1-100, optional default 20"},
        handler=_tool_get_activity,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="remind_employee_profile",
        description=(
            "Actually send a post-hire Complete Profile reminder: real SMTP email + in-app dashboard "
            "notification. Use when the recruiter asks to remind/nudge/resend. "
            "Set force=true if they ask to resend within an hour. "
            "ONLY claim email was sent when the tool result has email_sent=true."
        ),
        parameters={
            "email": "string, preferred",
            "name": "string, optional",
            "employee_id": "string, optional e.g. EMP-000022",
            "note": "string, optional message for the employee",
            "force": "boolean, optional — set true to resend even if a reminder was sent recently",
        },
        handler=_tool_remind_employee_profile,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="bulk_remind_profiles",
        description=(
            "Remind ALL employees with incomplete post-hire profiles (email + in-app), or only those in emails[]. "
            "Use force=true only when recruiter explicitly asks to resend recently reminded people."
        ),
        parameters={
            "emails": "optional array — limit to these emails",
            "note": "optional string",
            "force": "boolean, optional",
        },
        handler=_tool_bulk_remind_profiles,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="create_offer",
        description="Create and send an offer letter to a candidate who has already submitted their pre-offer intake.",
        parameters={
            "candidate_email": "string, required",
            "job_title": "string, required",
            "department": "string, required",
            "employment_type": "string, optional, default Full-time",
            "office_location": "string, optional",
            "reporting_manager": "string, required",
            "start_date": "string, required; relative dates like 'tomorrow' are accepted and normalized",
            "monthly_salary": "number, optional",
            "currency": "string, optional, default PKR",
            "offer_expiry_days": "integer, optional",
            "message_to_candidate": "string, optional",
        },
        handler=_tool_create_offer,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="approve_offer",
        description=(
            "Approve a signed offer and convert that candidate into an employee. "
            "Provide offer_id or email/name of someone in ready_to_activate."
        ),
        parameters={
            "offer_id": "string, optional if email/name given",
            "email": "string, optional",
            "name": "string, optional",
            "note": "string, optional",
        },
        handler=_tool_approve_offer,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="bulk_approve_offers",
        description="Approve all signed offers (ready_to_activate) and convert them to employees, or only emails[].",
        parameters={"emails": "optional array of candidate emails", "note": "optional string"},
        handler=_tool_bulk_approve_offers,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="send_joining_letter",
        description=(
            "Email a joining letter with the office address, reporting date/time, and the checklist of "
            "physical documents to bring on the joining date. Use after an offer has been signed/approved."
        ),
        parameters={
            "candidate_email": "string, required",
            "join_date": "string, required, e.g. 'Wednesday, July 15, 2026'",
            "join_time": "string, required, e.g. '12:00 PM'",
            "office_address": "string, required",
            "documents_required": "array of strings, optional (sensible default checklist used if omitted)",
            "map_link": "string url, optional",
            "extra_notes": "string, optional",
        },
        handler=_tool_send_joining_letter,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="list_person_documents",
        description=(
            "List every document a candidate/employee has uploaded (CNIC, passport, transcripts, resume) "
            "so the recruiter can open and review them, including OCR mismatches vs. their profile. "
            "Always call this before verify_document — you need the document id values it returns. "
            "The app also renders these as interactive cards in chat."
        ),
        parameters={
            "email": "string, optional",
            "name": "string, optional",
            "employee_id": "string, optional",
            "candidate_id": "string, optional",
        },
        handler=_tool_list_person_documents,
        roles=("recruiter", "super_admin"),
    ),
    # Alias kept for prompts / older sessions that still say list_candidate_documents.
    Tool(
        name="list_candidate_documents",
        description=(
            "Alias of list_person_documents. Prefer list_person_documents. Lists uploaded documents "
            "for a candidate/employee so the recruiter can review and verify them."
        ),
        parameters={"email": "string, preferred", "name": "string, optional alternative to email"},
        handler=_tool_list_person_documents,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="verify_document",
        description=(
            "Approve, reject, or request re-upload for one document by its id (from list_person_documents — "
            "never invent one). rejected/reupload_required require rejection_reason: "
            "blurry_or_unreadable|wrong_document_type|expired_document|information_mismatch|"
            "incomplete_document|other. Sends email + in-app notification to the owner. "
            "Set approve_despite_mismatch=true only when the recruiter explicitly overrides an OCR flag."
        ),
        parameters={
            "document_id": "string, required — from list_person_documents",
            "status": "verified|rejected|reupload_required|mismatch",
            "rejection_reason": "string, required for rejected/reupload_required",
            "note": "string, optional",
            "approve_despite_mismatch": "boolean, optional",
        },
        handler=_tool_verify_document,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="bulk_verify_documents",
        description="Apply document verification decisions to many documents at once.",
        parameters={
            "documents": "array of {document_id, status, rejection_reason?, note?, approve_despite_mismatch?}",
        },
        handler=_tool_bulk_verify_documents,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="get_document_link",
        description="Get a time-limited signed download URL for a document.",
        parameters={"document_id": "string, required"},
        handler=_tool_get_document_link,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="set_company_email",
        description="Set/update an employee's company email (Day-1). Notifies + emails the employee.",
        parameters={
            "email": "string, optional personal email",
            "employee_id": "string, optional",
            "name": "string, optional",
            "company_email": "string, required",
        },
        handler=_tool_set_company_email,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="bulk_set_company_email",
        description="Set company emails for many employees at once.",
        parameters={"assignments": "array of {email|employee_id, company_email}"},
        handler=_tool_bulk_set_company_email,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="assign_asset",
        description="Assign a company asset (laptop, phone, badge, etc.) to one employee. Notifies + emails.",
        parameters={
            "email": "string, optional",
            "employee_id": "string, optional",
            "name": "string, required asset name",
            "asset_type": "string, optional default other",
            "serial_number": "string, optional",
            "notes": "string, optional",
        },
        handler=_tool_assign_asset,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="bulk_assign_assets",
        description="Assign assets to many employees. Use emails[]+name for the same asset, or assignments[{email,name,...}].",
        parameters={
            "emails": "optional array with shared name/asset_type",
            "name": "optional shared asset name",
            "asset_type": "optional",
            "assignments": "optional array of {email, name, asset_type?, serial_number?, notes?}",
        },
        handler=_tool_bulk_assign_assets,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="update_asset",
        description="Update an assigned asset (name/type/serial/notes/status: assigned|returned|lost|retired).",
        parameters={
            "email": "string, optional",
            "employee_id": "string, optional",
            "asset_id": "string, required",
            "name": "string, optional",
            "asset_type": "string, optional",
            "serial_number": "string, optional",
            "notes": "string, optional",
            "status": "assigned|returned|lost|retired, optional",
        },
        handler=_tool_update_asset,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="remove_asset",
        description="Remove an asset assignment from an employee.",
        parameters={
            "email": "string, optional",
            "employee_id": "string, optional",
            "asset_id": "string, required",
        },
        handler=_tool_remove_asset,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="schedule_orientation",
        description="Schedule or update Day-1 orientation for one employee (notifies + emails).",
        parameters={
            "email": "string, optional",
            "employee_id": "string, optional",
            "date": "YYYY-MM-DD, required",
            "time": "HH:MM, required",
            "trainer": "string, required",
            "agenda": "string, required",
            "meeting_link": "string, optional",
        },
        handler=_tool_schedule_orientation,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="bulk_schedule_orientation",
        description="Schedule the same orientation for many employees (emails[] + date/time/trainer/agenda) or per-row assignments.",
        parameters={
            "emails": "optional array",
            "date": "YYYY-MM-DD",
            "time": "HH:MM",
            "trainer": "string",
            "agenda": "string",
            "meeting_link": "optional",
            "assignments": "optional array of per-employee schedules",
        },
        handler=_tool_bulk_schedule_orientation,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="list_career_events",
        description="List career timeline events for one employee.",
        parameters={"email": "string, optional", "employee_id": "string, optional", "name": "string, optional"},
        handler=_tool_list_career,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="add_career_event",
        description=(
            "Add a career event for one employee: joined|promoted|title_change|department_change|"
            "manager_change|status_change."
        ),
        parameters={
            "email": "string, optional",
            "employee_id": "string, optional",
            "event_type": "required",
            "effective_date": "YYYY-MM-DD, required",
            "to_title": "optional",
            "to_department": "optional",
            "to_manager": "optional",
            "to_status": "optional",
            "note": "optional",
        },
        handler=_tool_add_career_event,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="list_announcements",
        description="List recent announcements (optional audience filter: candidates|employees|both).",
        parameters={"limit": "integer, optional", "audience": "candidates|employees|both, optional"},
        handler=_tool_list_announcements,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="create_announcement",
        description=(
            "Publish an announcement with in-app notifications and optional email to candidates, employees, or both. "
            "Can target departments, designations, or employee_ids (audience must be employees when targeting)."
        ),
        parameters={
            "title": "string, required",
            "body": "string, required",
            "audience": "candidates|employees|both, default both",
            "target_departments": "array of strings, optional",
            "target_designations": "array of strings, optional",
            "target_employee_ids": "array of strings, optional",
            "send_email": "boolean, default true",
        },
        handler=_tool_create_announcement,
        roles=("recruiter", "super_admin"),
    ),
]


# ─────────────────────────────────────────────────────────────────────────
# Candidate / Employee (self-service onboarding) tools
# ─────────────────────────────────────────────────────────────────────────


async def _tool_get_status(user: CurrentUser, args: dict) -> ToolResult:
    try:
        if user.role == "employee":
            profile = await employee_service.get_profile_completion(user)
            progress = profile.get("progress") or {}
            docs = await document_service.list_mine(user)
            return ToolResult(
                ok=True,
                data={
                    "stage": "post_hire_profile",
                    "profile_status": progress.get("profile_status", "in_progress"),
                    "current_step": progress.get("current_step"),
                    "percentage": progress.get("percentage"),
                    "missing_sections": progress.get("missing_fields", []),
                    "documents_on_file": [d.get("doc_type") for d in docs.get("documents", [])],
                    # Remote employees enter their own banking; on-site banking is managed by recruiter.
                    "is_remote": bool(progress.get("is_remote")),
                    "banking_managed_by": progress.get("banking_managed_by", "recruiter"),
                },
            )
        # candidate
        onboarding = await candidate_service.get_onboarding(user)
        progress = await candidate_service.get_progress(user)
        docs = await document_service.list_mine(user)
        ob = onboarding.get("onboarding") or {}
        resume = ob.get("resume") or {}
        summary = (resume.get("summary") or "").strip()
        return ToolResult(
            ok=True,
            data={
                "stage": "pre_offer_intake",
                "status": progress.get("status"),
                "current_step": progress.get("current_step"),
                "percentage": progress.get("percentage"),
                "missing_fields": progress.get("missing_fields"),
                "steps": progress.get("steps"),
                "documents_on_file": [d.get("doc_type") for d in docs.get("documents", [])],
                "resume_file_on_file": bool(resume.get("file_url") or resume.get("file_name")),
                "resume_summary_ready": len(summary) >= 20,
                "resume_summary_length": len(summary),
            },
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


EMPLOYEE_STEP_FIELDS = ("personal", "education", "emergency", "employment", "references", "documents", "nda")
CANDIDATE_STEP_FIELDS = ("personal", "education", "skills", "government_docs", "resume")


def _extract_resume_summary(args: dict) -> str | None:
    """Accept summary from common places the model might put it."""
    for key in ("summary", "resume_summary"):
        val = args.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    resume_arg = args.get("resume")
    if isinstance(resume_arg, dict):
        val = resume_arg.get("summary")
        if isinstance(val, str) and val.strip():
            return val.strip()
    skills_arg = args.get("skills")
    if isinstance(skills_arg, dict):
        val = skills_arg.get("summary")
        if isinstance(val, str) and val.strip():
            return val.strip()
    return None


def _merge_candidate_resume(existing: dict | None, args: dict, incoming: dict | None) -> dict:
    """Merge uploaded resume file metadata with any summary provided in this turn."""
    resume = dict(existing or {})
    if isinstance(incoming, dict):
        for key in ("file_url", "file_name", "summary"):
            if incoming.get(key) is not None and str(incoming.get(key)).strip() != "":
                resume[key] = incoming[key]
    summary = _extract_resume_summary(args)
    if summary:
        resume["summary"] = summary
    return resume


async def _tool_save_step(user: CurrentUser, args: dict) -> ToolResult:
    step = args.get("step")
    if not step:
        return ToolResult(ok=False, error="`step` is required.")
    try:
        if user.role == "employee":
            payload_dict: dict = {"step": step}
            for key in EMPLOYEE_STEP_FIELDS:
                if args.get(key) is not None:
                    payload_dict[key] = args[key]
            payload = EmployeeProfileSaveRequest.model_validate(payload_dict)
            result = await employee_service.save_profile_completion(user, payload)
        else:
            payload_dict = {"step": step}
            for key in CANDIDATE_STEP_FIELDS:
                if args.get(key) is not None:
                    # Don't copy a nested skills.summary into the skills schema.
                    if key == "skills" and isinstance(args.get(key), dict):
                        skills = {k: v for k, v in args[key].items() if k != "summary"}
                        payload_dict[key] = skills
                    else:
                        payload_dict[key] = args[key]
            # `personal` and `skills` must include identity / resume file metadata already on file.
            if step in ("personal", "skills", "resume"):
                existing = await candidate_service.get_onboarding(user)
                existing_onboarding = existing.get("onboarding") or {}
                if step == "personal" and "government_docs" not in payload_dict and existing_onboarding.get("government_docs"):
                    payload_dict["government_docs"] = existing_onboarding["government_docs"]
                if step in ("skills", "resume"):
                    resume = _merge_candidate_resume(
                        existing_onboarding.get("resume"),
                        args,
                        payload_dict.get("resume") if isinstance(payload_dict.get("resume"), dict) else None,
                    )
                    has_file = bool(resume.get("file_url") or resume.get("file_name"))
                    summary = (resume.get("summary") or "").strip()
                    if step == "skills" and not has_file:
                        return ToolResult(
                            ok=False,
                            error=(
                                "Resume file is missing. Ask for an upload with "
                                'ui_hint {"type":"upload","doc_type":"resume"} — do not invent file URLs.'
                            ),
                        )
                    if has_file and len(summary) < 20:
                        return ToolResult(
                            ok=False,
                            error=(
                                "Resume summary must be at least 20 characters. "
                                'Retry save_step with resume: {"summary": "<text from the user chat>"} '
                                "(include skills: {...} when step=skills). "
                                "If the user already wrote a summary in this conversation, use that text — do not ask again."
                            ),
                        )
                    if has_file:
                        payload_dict["resume"] = {**resume, "summary": summary}
            payload = OnboardingSaveRequest.model_validate(payload_dict)
            result = await candidate_service.save_onboarding(user, payload)
        return ToolResult(ok=True, data={"message": result.get("message", "Saved.")})
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_list_documents(user: CurrentUser, args: dict) -> ToolResult:
    try:
        result = await document_service.list_mine(user)
        status_filter = (args.get("status") or "").strip().lower() or None
        category_filter = (args.get("category") or "").strip().lower() or None
        docs = []
        for d in result.get("documents", []):
            doc_status = (d.get("status") or "").lower()
            doc_category = (d.get("category") or "").lower()
            if status_filter and doc_status != status_filter:
                continue
            if category_filter and doc_category != category_filter:
                continue
            docs.append(
                {
                    "id": d.get("id") or d.get("document_id"),
                    "doc_type": d.get("doc_type"),
                    "category": d.get("category"),
                    "status": d.get("status"),
                    "file_name": d.get("file_name"),
                    "rejection_reason": d.get("rejection_reason"),
                }
            )
        return ToolResult(ok=True, data={"documents": docs, "count": len(docs)})
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


SELF_SERVE_TOOLS: list[Tool] = [
    Tool(
        name="get_status",
        description="Fetch the caller's current onboarding/profile-completion progress, including which sections and documents are still missing.",
        parameters={},
        handler=_tool_get_status,
        roles=("candidate", "employee"),
    ),
    Tool(
        name="save_step",
        description=(
            "Save one onboarding/profile step; for candidate skills pass skills plus resume.summary (≥20 chars). "
            "`step` must be one of the step names returned by get_status (e.g. personal, education, skills, "
            "emergency, employment, references, documents, nda, submit). Put the step's data directly under a "
            "key matching the step name, e.g. {\"step\": \"personal\", \"personal\": {...fields...}}. Only "
            "'personal' and 'skills' steps need identity-document / resume file metadata too, but you never have to "
            "supply file URLs yourself — they're filled in automatically from whatever the person already uploaded. "
            "For candidate skills: also pass resume.summary (or top-level summary) with ≥20 characters of "
            "professional summary text from the chat, together with skills: {technical_skills, soft_skills, "
            "languages, certifications}. For step 'submit', pass no extra keys."
        ),
        parameters={
            "step": "string, required",
            "personal": "object, for step=personal — first_name, last_name, date_of_birth (YYYY-MM-DD), gender, nationality, marital_status, national_id, current_address, permanent_address, city, state, postal_code, country",
            "education": "object {entries: [{institution, degree, field_of_study, year_completed, board_university?, cgpa_or_percentage?}]}, for step=education",
            "skills": "object {technical_skills: [], soft_skills: [], languages: [], certifications: []}, for step=skills",
            "resume": "object {summary: string ≥20 chars}, for candidate step=skills or step=resume — file_url is auto-filled from upload",
            "summary": "optional alias for resume.summary (≥20 chars) when saving skills/resume",
            "emergency": "object {name, relationship, phone}, for step=emergency (employee only)",
            "employment": "object {bank_name, account_holder_name, account_number, iban, branch, branch_code}, for step=employment (employee only)",
            "references": "object {references: [{full_name, relationship, email, phone, company}, ...]} (min 2), for step=references (employee only)",
            "documents": "object {accepted_privacy_policy: true, accepted_employee_handbook: true}, for step=documents (employee only)",
            "nda": "object {full_legal_name, agreed: true}, for step=nda (Self Declaration in the UI)",
        },
        handler=_tool_save_step,
        roles=("candidate", "employee"),
    ),
    Tool(
        name="list_documents",
        description=(
            "List documents the caller has already uploaded, with id/type/category/verification status. "
            "Optionally filter by status (pending|verified|rejected|reupload_required) or category "
            "(identity|education|banking|certificate|photo|other)."
        ),
        parameters={
            "status": "optional: pending|verified|rejected|reupload_required",
            "category": "optional: identity|education|banking|certificate|photo|other",
        },
        handler=_tool_list_documents,
        roles=("candidate", "employee"),
    ),
]


# Extended parity tools (Learning, Talent, offers, docs, etc.) — imported after base tools exist.
from app.services.agent_tools_parity import (  # noqa: E402
    CANDIDATE_PARITY_TOOLS,
    EMPLOYEE_PARITY_TOOLS,
    RECRUITER_PARITY_TOOLS,
)

RECRUITER_TOOLS.extend(RECRUITER_PARITY_TOOLS)
CANDIDATE_TOOLS: list[Tool] = [*SELF_SERVE_TOOLS, *CANDIDATE_PARITY_TOOLS]
EMPLOYEE_TOOLS: list[Tool] = [*SELF_SERVE_TOOLS, *EMPLOYEE_PARITY_TOOLS]

# Recruiter tool → module capability. The agent only exposes a tool when the
# recruiter's effective capabilities (org modules ∩ personal toggles) allow it,
# so AI access always mirrors the sidebar / API permissions. A tuple means the
# tool is available when ANY of those capabilities is enabled. Tools not listed
# stay available to every recruiter (e.g. session housekeeping).
RECRUITER_TOOL_CAPABILITIES: dict[str, str | tuple[str, ...]] = {
    # Invite & offer
    "send_invitation": "invite",
    "bulk_invite": "invite",
    "create_offer": "invite",
    "approve_offer": "invite",
    "bulk_approve_offers": "invite",
    "send_joining_letter": "invite",
    # Candidates / pipeline / documents
    "list_candidates": "candidates",
    "list_pipeline": "candidates",
    "get_candidate_status": "candidates",
    "list_person_documents": "candidates",
    "list_candidate_documents": "candidates",
    "verify_document": "candidates",
    "bulk_verify_documents": "candidates",
    "get_document_link": "candidates",
    "remind_candidate": "candidates",
    "bulk_remind_candidates": "candidates",
    "search_people": "candidates",
    "lookup_person_history": "candidates",
    # Employees
    "list_employees": "employees",
    "directory_employees": "employees",
    "export_employees": "employees",
    "get_employee_detail": "employees",
    "remind_employee_profile": "employees",
    "bulk_remind_profiles": "employees",
    "mark_employee_exit": "employees",
    "set_company_email": "employees",
    "bulk_set_company_email": "employees",
    "assign_asset": "employees",
    "bulk_assign_assets": "employees",
    "update_asset": "employees",
    "remove_asset": "employees",
    "schedule_orientation": "employees",
    "bulk_schedule_orientation": "employees",
    "list_career_events": "employees",
    "add_career_event": "employees",
    "update_employee_role": "employees",
    "send_reminder": ("employees", "candidates"),
    # Learning
    "browse_learning_catalog": "learning",
    "assign_courses": "learning",
    "list_learning_assignments": "learning",
    "list_pending_certificates": "learning",
    "verify_certificate": "learning",
    "learning_analytics": "learning",
    "get_employee_learning_profile": "learning",
    "kb_list_roles": "learning",
    "kb_create_role": "learning",
    "kb_delete_role": "learning",
    "kb_list_certifications": "learning",
    "kb_create_certification": "learning",
    "kb_delete_certification": "learning",
    # Talent
    "talent_metrics": "talent",
    "search_talent": "talent",
    "list_opportunities": "talent",
    "create_opportunity": "talent",
    "update_opportunity": "talent",
    "list_opportunity_applicants": "talent",
    "submit_competency_evaluation": "talent",
    "update_development_plan": "talent",
    "get_talent_profile": "talent",
    # IT & support
    "send_it_provisioning": "it",
    "remind_it_provisioning": "it",
    "bulk_send_it_provisioning": "it",
    "bulk_remind_it_provisioning": "it",
    "list_it_kits": "it",
    "create_it_kit": "it",
    "update_it_kit": "it",
    "delete_it_kit": "it",
    "list_it_officers": "it",
    "list_it_service_requests": "it",
    "create_it_service_request": "it",
    "send_it_service_request": "it",
    "cancel_it_service_request": "it",
    # Messages
    "list_hr_threads": "messages",
    "message_employee": "messages",
    "reply_hr_thread": "messages",
    # Announcements
    "list_announcements": "announcements",
    "create_announcement": "announcements",
    "update_announcement": "announcements",
    "delete_announcement": "announcements",
    # Overview / reporting / profile
    "get_dashboard_summary": "overview",
    "get_activity": "reporting",
    "get_recruiter_profile": "profile",
    "update_recruiter_profile": "profile",
}


def _tool_required_capabilities(name: str) -> tuple[str, ...] | None:
    """Capability keys gating a recruiter tool (None = always allowed)."""
    value = RECRUITER_TOOL_CAPABILITIES.get(name)
    if not value:
        return None
    return (value,) if isinstance(value, str) else tuple(value)


def _tool_allowed_for(user: CurrentUser, tool: Tool) -> bool:
    """A recruiter may call the tool only when at least one of its required
    capabilities is enabled. Super admins and non-recruiter roles are never
    restricted here — their access is governed by role permissions."""
    if user.role != "recruiter":
        return True
    required = _tool_required_capabilities(tool.name)
    if not required:
        return True
    return any(user.has_capability(cap) for cap in required)


def tools_for_role(role: str) -> list[Tool]:
    if role in ("recruiter", "super_admin"):
        return RECRUITER_TOOLS
    if role == "candidate":
        return CANDIDATE_TOOLS
    if role == "employee":
        return EMPLOYEE_TOOLS
    return []


def tools_for_user(user: CurrentUser) -> list[Tool]:
    """Tools exposed to a specific user, filtered by recruiter capabilities so
    the AI never sees (or suggests) tools for modules the recruiter lacks."""
    return [tool for tool in tools_for_role(user.role) if _tool_allowed_for(user, tool)]


def find_tool(role: str, name: str) -> Tool | None:
    for tool in tools_for_role(role):
        if tool.name == name:
            return tool
    return None


async def run_tool(user: CurrentUser, name: str, args: dict) -> ToolResult:
    tool = find_tool(user.role, name)
    if not tool:
        return ToolResult(ok=False, error=f"Unknown tool '{name}' for role {user.role}.")
    if not _tool_allowed_for(user, tool):
        # Defense in depth: even if the model hallucinates a disabled tool,
        # never execute it — explain the module access instead.
        return ToolResult(
            ok=False,
            error=(
                "This module is not available for your account, so I can't help with "
                "that action. Contact the Super Admin to request access."
            ),
        )
    try:
        return await tool.handler(user, args or {})
    except Exception as exc:  # noqa: BLE001
        return _err(exc)

"""AI Agent tool registry.

Every tool wraps an *already validated* service call (invitation, offer,
onboarding, employee profile, document, email). The agent never talks to the
database directly for writes — it only orchestrates existing, permission
-checked service methods so behaviour stays identical to using the UI by
hand. Tools return small JSON-serialisable dicts that get fed back to the
LLM as "observations".
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Awaitable, Callable

from fastapi import HTTPException
from pydantic import ValidationError

from app.core.database import database
from app.core.rbac import CurrentUser
from app.schemas.employee_profile import EmployeeProfileSaveRequest
from app.schemas.invitation import CreateInvitationRequest, OnboardingSaveRequest
from app.schemas.offer import OfferCreateRequest
from app.services.candidate_service import CandidateService
from app.services.document_service import document_service
from app.services.email_service import email_service
from app.services.employee_service import EmployeeService
from app.services.invitation_service import InvitationService
from app.services.offer_service import offer_service

candidate_service = CandidateService()
employee_service = EmployeeService()
invitation_service = InvitationService()

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


# ─────────────────────────────────────────────────────────────────────────
# Recruiter tools
# ─────────────────────────────────────────────────────────────────────────


async def _tool_send_invitation(user: CurrentUser, args: dict) -> ToolResult:
    try:
        payload = CreateInvitationRequest(
            email=args["email"],
            full_name=args["full_name"],
            job_title=args["job_title"],
            department=args["department"],
            office_location=args.get("office_location"),
            start_date=args.get("start_date") or None,
            expires_in_days=int(args.get("expires_in_days") or 7),
        )
        result = await invitation_service.create_invitation(payload, user)
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_bulk_invite(user: CurrentUser, args: dict) -> ToolResult:
    rows = args.get("candidates") or []
    if not isinstance(rows, list) or not rows:
        return ToolResult(ok=False, error="No candidates provided.")
    sent, failed = [], []
    for row in rows[:200]:
        try:
            payload = CreateInvitationRequest(
                email=row["email"],
                full_name=row["full_name"],
                job_title=row.get("job_title") or "Not specified",
                department=row.get("department") or "Not specified",
                office_location=row.get("office_location"),
                start_date=row.get("start_date") or None,
                expires_in_days=int(row.get("expires_in_days") or 7),
            )
            result = await invitation_service.create_invitation(payload, user)
            sent.append({"email": payload.email, "email_sent": result.get("email_sent", False)})
        except Exception as exc:  # noqa: BLE001
            detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
            failed.append({"email": row.get("email"), "error": str(detail)})
    return ToolResult(ok=True, data={"sent": sent, "failed": failed, "total": len(rows)})


async def _tool_list_candidates(user: CurrentUser, args: dict) -> ToolResult:
    query: dict = {}
    if user.role != "super_admin":
        query["recruiter_id"] = user.id
    status_filter = args.get("status")
    if status_filter:
        query["conversion_status"] = status_filter
    docs = await database.candidates.find(query).sort("created_at", -1).to_list(length=50)
    items = [
        {
            "email": d.get("email"),
            "full_name": d.get("full_name"),
            "job_title": d.get("job_title"),
            "conversion_status": d.get("conversion_status"),
            "onboarding_status": (d.get("onboarding") or {}).get("status", "not_started"),
        }
        for d in docs
    ]
    return ToolResult(ok=True, data={"candidates": items, "count": len(items)})


async def _tool_get_candidate_status(user: CurrentUser, args: dict) -> ToolResult:
    email = (args.get("email") or "").lower().strip()
    if not email:
        return ToolResult(ok=False, error="An email address is required.")
    candidate = await _find_candidate_by_email(email)
    if candidate:
        onboarding = candidate.get("onboarding") or {}
        offer = await database.offer_letters.find_one(
            {"candidate_email": email}, sort=[("created_at", -1)]
        )
        return ToolResult(
            ok=True,
            data={
                "found_as": "candidate",
                "full_name": candidate.get("full_name"),
                "conversion_status": candidate.get("conversion_status"),
                "onboarding_status": onboarding.get("status", "not_started"),
                "onboarding_missing": [k for k in ("personal", "education", "skills", "government_docs", "resume") if not onboarding.get(k)],
                "offer_status": (offer or {}).get("status"),
                "offer_id": str(offer["_id"]) if offer else None,
            },
        )
    employee = await _find_employee_by_email(email)
    if employee:
        onboarding = employee.get("onboarding") or {}
        return ToolResult(
            ok=True,
            data={
                "found_as": "employee",
                "employee_id": employee.get("employee_id"),
                "full_name": employee.get("full_name"),
                "profile_status": employee.get("profile_status", "in_progress"),
                "profile_missing": [k for k in ("emergency", "employment", "references", "documents", "nda") if not onboarding.get(k)],
            },
        )
    return ToolResult(ok=False, error=f"No candidate or employee found for {email}.")


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


RECRUITER_TOOLS: list[Tool] = [
    Tool(
        name="send_invitation",
        description="Invite a single candidate by email so they can create an account and start onboarding.",
        parameters={
            "email": "string, required",
            "full_name": "string, required",
            "job_title": "string, required",
            "department": "string, required",
            "office_location": "string, optional",
            "start_date": "string YYYY-MM-DD, optional",
            "expires_in_days": "integer 1-30, optional, default 7",
        },
        handler=_tool_send_invitation,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="bulk_invite",
        description="Invite many candidates at once. `candidates` is a list of objects each with email, full_name, job_title, department, and optionally office_location/start_date.",
        parameters={"candidates": "array of {email, full_name, job_title, department, office_location?, start_date?}"},
        handler=_tool_bulk_invite,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="list_candidates",
        description="List the recruiter's own candidates and their onboarding/conversion status.",
        parameters={"status": "optional conversion_status filter"},
        handler=_tool_list_candidates,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="get_candidate_status",
        description="Look up a single candidate or employee's current status by email.",
        parameters={"email": "string, required"},
        handler=_tool_get_candidate_status,
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
            "start_date": "string, required",
            "monthly_salary": "number, optional",
            "currency": "string, optional, default PKR",
            "offer_expiry_days": "integer, optional",
            "message_to_candidate": "string, optional",
        },
        handler=_tool_create_offer,
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
                },
            )
        # candidate
        onboarding = await candidate_service.get_onboarding(user)
        progress = await candidate_service.get_progress(user)
        docs = await document_service.list_mine(user)
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
            },
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


EMPLOYEE_STEP_FIELDS = ("personal", "education", "emergency", "employment", "references", "documents", "nda")
CANDIDATE_STEP_FIELDS = ("personal", "education", "skills", "government_docs", "resume")


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
                    payload_dict[key] = args[key]
            # `personal` and `skills` steps must be submitted together with the identity
            # document / resume metadata. Those are written directly onto the candidate
            # record when a file is uploaded (see attach_uploaded_file) — reuse whatever
            # is already on file instead of asking the LLM to invent file URLs.
            if step in ("personal", "skills"):
                existing = await candidate_service.get_onboarding(user)
                existing_onboarding = existing.get("onboarding") or {}
                if step == "personal" and "government_docs" not in payload_dict and existing_onboarding.get("government_docs"):
                    payload_dict["government_docs"] = existing_onboarding["government_docs"]
                if step == "skills" and "resume" not in payload_dict and existing_onboarding.get("resume"):
                    payload_dict["resume"] = existing_onboarding["resume"]
            payload = OnboardingSaveRequest.model_validate(payload_dict)
            result = await candidate_service.save_onboarding(user, payload)
        return ToolResult(ok=True, data={"message": result.get("message", "Saved.")})
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_list_documents(user: CurrentUser, args: dict) -> ToolResult:
    try:
        result = await document_service.list_mine(user)
        docs = [
            {"doc_type": d.get("doc_type"), "category": d.get("category"), "status": d.get("status")}
            for d in result.get("documents", [])
        ]
        return ToolResult(ok=True, data={"documents": docs})
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
            "Save one onboarding/profile step from structured fields extracted out of the conversation. "
            "`step` must be one of the step names returned by get_status (e.g. personal, education, skills, "
            "emergency, employment, references, documents, nda, submit). Put the step's data directly under a "
            "key matching the step name, e.g. {\"step\": \"personal\", \"personal\": {...fields...}}. Only "
            "'personal' and 'skills' steps need identity-document / resume metadata too, but you never have to "
            "supply that yourself — it's filled in automatically from whatever the person already uploaded. "
            "For step 'submit', pass no extra keys."
        ),
        parameters={
            "step": "string, required",
            "personal": "object, for step=personal — first_name, last_name, date_of_birth (YYYY-MM-DD), gender, nationality, marital_status, national_id, current_address, permanent_address, city, state, postal_code, country",
            "education": "object {entries: [{institution, degree, field_of_study, year_completed, board_university?, cgpa_or_percentage?}]}, for step=education",
            "skills": "object {technical_skills: [], soft_skills: [], languages: [], certifications: []}, for step=skills",
            "emergency": "object {name, relationship, phone}, for step=emergency (employee only)",
            "employment": "object {bank_name, account_holder_name, account_number, tax_id, iban, branch, branch_code}, for step=employment (employee only)",
            "references": "object {references: [{full_name, relationship, email, phone, company}, ...]} (min 2), for step=references (employee only)",
            "documents": "object {accepted_code_of_conduct: true, accepted_privacy_policy: true, accepted_employee_handbook: true}, for step=documents (employee only)",
            "nda": "object {full_legal_name, agreed: true}, for step=nda",
        },
        handler=_tool_save_step,
        roles=("candidate", "employee"),
    ),
    Tool(
        name="list_documents",
        description="List documents the caller has already uploaded, with type/category/verification status.",
        parameters={},
        handler=_tool_list_documents,
        roles=("candidate", "employee"),
    ),
]


def tools_for_role(role: str) -> list[Tool]:
    if role in ("recruiter", "super_admin"):
        return RECRUITER_TOOLS
    if role in ("candidate", "employee"):
        return SELF_SERVE_TOOLS
    return []


def find_tool(role: str, name: str) -> Tool | None:
    for tool in tools_for_role(role):
        if tool.name == name:
            return tool
    return None


async def run_tool(user: CurrentUser, name: str, args: dict) -> ToolResult:
    tool = find_tool(user.role, name)
    if not tool:
        return ToolResult(ok=False, error=f"Unknown tool '{name}' for role {user.role}.")
    try:
        return await tool.handler(user, args or {})
    except Exception as exc:  # noqa: BLE001
        return _err(exc)
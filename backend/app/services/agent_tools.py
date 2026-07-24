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
from app.schemas.career import CareerEventCreateRequest
from app.schemas.dashboard import CreateAnnouncementRequest
from app.schemas.document import DocumentVerifyRequest
from app.schemas.employee_profile import EmployeeProfileSaveRequest
from app.schemas.invitation import CreateInvitationRequest, OnboardingSaveRequest
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


async def _find_employee_by_query(q: str) -> dict | None:
    term = (q or "").strip()
    if not term:
        return None
    if "@" in term:
        return await _find_employee_by_email(term)
    return await database.employees.find_one(
        {
            "$or": [
                {"full_name": {"$regex": term, "$options": "i"}},
                {"employee_id": {"$regex": term, "$options": "i"}},
                {"email": {"$regex": term, "$options": "i"}},
            ]
        }
    )


async def _find_candidate_by_query(q: str) -> dict | None:
    term = (q or "").strip()
    if not term:
        return None
    if "@" in term:
        return await _find_candidate_by_email(term)
    return await database.candidates.find_one(
        {
            "$or": [
                {"full_name": {"$regex": term, "$options": "i"}},
                {"email": {"$regex": term, "$options": "i"}},
            ]
        }
    )


POST_HIRE_PROFILE_KEYS = ("emergency", "employment", "references", "documents", "nda")
PRE_HIRE_ONBOARDING_KEYS = ("personal", "education", "skills", "government_docs", "resume")


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
        # Post-hire Complete Profile (emergency, banking, references, policies, NDA)
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
    items = [
        {
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
        for d in docs
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
    query = email or name
    if not query:
        return ToolResult(ok=False, error="An email or name is required.")

    employee = await _find_employee_by_query(query)
    candidate = await _find_candidate_by_query(query)

    if employee:
        payload = _employee_status_payload(employee)
        if candidate:
            cand_onboarding = candidate.get("onboarding") or {}
            payload["also_found_as"] = "converted_candidate"
            payload["pre_hire_onboarding_status"] = cand_onboarding.get("status", "not_started")
            payload["conversion_status"] = candidate.get("conversion_status")
        return ToolResult(ok=True, data=payload)

    if candidate:
        onboarding = candidate.get("onboarding") or {}
        conversion = candidate.get("conversion_status")
        missing = [k for k in PRE_HIRE_ONBOARDING_KEYS if not onboarding.get(k)]
        # Converted but employee row somehow missing — still warn clearly.
        if conversion == "converted" or candidate.get("status") == "converted":
            return ToolResult(
                ok=True,
                data={
                    "found_as": "converted_candidate_without_employee_row",
                    "full_name": candidate.get("full_name"),
                    "email": candidate.get("email"),
                    "conversion_status": conversion,
                    "pre_hire_onboarding_status": onboarding.get("status", "not_started"),
                    "pre_hire_missing": missing,
                    "post_hire_profile_complete": False,
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
                "full_name": candidate.get("full_name"),
                "email": candidate.get("email"),
                "conversion_status": conversion,
                "onboarding_status": onboarding.get("status", "not_started"),
                "pre_hire_missing": missing,
                "pre_hire_complete": not missing,
                "offer_status": (offer or {}).get("status"),
                "offer_id": str(offer["_id"]) if offer else None,
                "note": (
                    "This is pre-hire candidate onboarding only "
                    "(personal/education/skills/docs/resume). "
                    "Post-hire Complete Profile applies after conversion to employee."
                ),
            },
        )

    return ToolResult(ok=False, error=f"No candidate or employee found for {query}.")


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
        employee = await _find_employee_by_query(query)
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
    return {
        "document_id": doc.get("id") or doc.get("document_id") or str(doc.get("_id") or ""),
        "doc_type": doc.get("doc_type"),
        "category": doc.get("category"),
        "file_name": doc.get("file_name"),
        "status": doc.get("status") or doc.get("verification_status"),
        "verification_status": doc.get("verification_status"),
        "rejection_reason": doc.get("rejection_reason"),
        "mismatches": doc.get("mismatches") or doc.get("profile_mismatches") or [],
        "cross_document_mismatches": doc.get("cross_document_mismatches") or [],
    }


async def _resolve_employee(user: CurrentUser, args: dict) -> tuple[dict | None, str | None]:
    """Resolve an employee from email/name/employee_id. Returns (employee, error)."""
    employee_id = (args.get("employee_id") or "").strip()
    email = (args.get("email") or "").strip()
    name = (args.get("name") or args.get("full_name") or "").strip()
    try:
        if employee_id:
            return await employee_service._resolve_employee_for_recruiter(user, employee_id), None
        query = email or name
        if not query:
            return None, "Provide email, name, or employee_id."
        employee = await _find_employee_by_query(query)
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


async def _resolve_candidate(args: dict) -> tuple[dict | None, str | None]:
    from bson import ObjectId

    email = (args.get("email") or args.get("candidate_email") or "").strip()
    name = (args.get("name") or args.get("full_name") or "").strip()
    candidate_id = (args.get("candidate_id") or "").strip()
    if candidate_id:
        query: dict = {"$or": [{"user_id": candidate_id}]}
        if ObjectId.is_valid(candidate_id):
            query["$or"].append({"_id": ObjectId(candidate_id)})
        doc = await database.candidates.find_one(query)
        return (doc, None) if doc else (None, f"No candidate found for id {candidate_id}.")
    query_text = email or name
    if not query_text:
        return None, "Provide email, name, or candidate_id."
    doc = await _find_candidate_by_query(query_text)
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
        cand, cand_err = await _resolve_candidate(args)
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
        docs = [_doc_summary(d) for d in (result.get("documents") or [])]
        return ToolResult(
            ok=True,
            data={
                "owner": {
                    "full_name": person.get("full_name"),
                    "email": person.get("email"),
                    "employee_id": person.get("employee_id"),
                    "owner_id": owner_id,
                },
                "documents": docs,
                "count": len(docs),
                "document_verification": result.get("document_verification"),
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
                "message": (
                    f"Export ready with {max(0, len(lines) - 1)} employee row(s). "
                    "Full CSV is available from the Employees page Export button; "
                    "preview above shows the first rows."
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
        return ToolResult(
            ok=True,
            data={
                "employee_id": emp.get("employee_id"),
                "full_name": emp.get("full_name"),
                "email": emp.get("email"),
                "company_email": emp.get("company_email"),
                "job_title": emp.get("job_title"),
                "department": emp.get("department"),
                "status": emp.get("status"),
                "office_location": emp.get("office_location"),
                "profile_progress": progress,
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
        description=(
            "List candidates and their pre-hire onboarding/conversion status. "
            "For converted people, use list_employees or get_candidate_status to see post-hire Complete Profile progress."
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
        description="Export filtered employees as CSV preview + row count (same filters as directory).",
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
            "Look up one person by email or name. If they are an employee (converted), returns "
            "post_hire_profile_complete / post_hire_missing — NOT pre-hire candidate onboarding. "
            "Pre-hire fields on file (personal/education/resume) do not mean the post-hire profile is done."
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
            "employee_id": "string, optional e.g. MZK-2026-000022",
        },
        handler=_tool_get_employee_detail,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="search_people",
        description="Global search across candidates and employees by name, email, phone, department, title, or IDs.",
        parameters={"query": "string, required, min 2 chars"},
        handler=_tool_search_people,
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
            "employee_id": "string, optional e.g. MZK-2026-000022",
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
        description="List documents for one candidate or employee (by email/name/employee_id) with verification status and mismatches.",
        parameters={
            "email": "string, optional",
            "name": "string, optional",
            "employee_id": "string, optional",
            "candidate_id": "string, optional",
        },
        handler=_tool_list_person_documents,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="verify_document",
        description=(
            "Verify, reject, or request re-upload for one document. "
            "rejected/reupload_required require rejection_reason: blurry_or_unreadable|wrong_document_type|"
            "expired_document|information_mismatch|incomplete_document|other. "
            "Sends email + in-app notification to the owner."
        ),
        parameters={
            "document_id": "string, required",
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
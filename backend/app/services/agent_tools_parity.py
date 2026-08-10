"""Additional agent tools for full dashboard parity (P1–P3).

Handlers wrap existing permission-checked services only — no new business logic.
Imported and merged by agent_tools.py into role tool lists.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from app.core.rbac import CurrentUser
from app.schemas.career import RoleAssignRequest
from app.schemas.dashboard import (
    MarkNotificationsReadRequest,
    UpdateAnnouncementRequest,
    UpdateRecruiterProfileRequest,
)
from app.schemas.invitation import OnboardingEmploymentInfo
from app.schemas.learning import (
    BookmarkRequest,
    CareerGoalRequest,
    CertificateVerifyRequest,
    CourseAssignRequest,
    EnrollmentProgressRequest,
    ManagedLearningCourseCreateRequest,
    SkillUpsertRequest,
)
from app.schemas.offer import OfferDeclineRequest, OfferSignRequest
from app.schemas.talent import (
    CompetencyEvaluationRequest,
    DevelopmentPlanUpdateRequest,
    DevelopmentMilestoneUpdate,
    InternalOpportunityCreateRequest,
    InternalOpportunityUpdateRequest,
    TalentSearchRequest,
)
from app.services.career_framework_service import career_framework_service
from app.services.dashboard_service import DashboardService
from app.services.document_service import document_service
from app.services.employee_service import EmployeeService
from app.services.learning_service import learning_service
from app.services.managed_learning_service import managed_learning_service
from app.services.message_service import message_service
from app.services.offer_service import offer_service
from app.services.talent_service import talent_service
from app.services.ticket_service import ticket_service
from app.schemas.date_utils import parse_natural_date

# Imported late-safe symbols from agent_tools (loaded after base helpers exist).
from app.services.agent_tools import (  # noqa: E402
    BULK_CAP,
    Tool,
    ToolResult,
    _err,
    _resolve_candidate,
    _resolve_employee,
    _tool_list_documents,
    confirm_gate,
)

dashboard_service = DashboardService()
employee_service = EmployeeService()


def _parse_date(value: Any) -> date | None:
    return parse_natural_date(value)


# ─────────────────────────────────────────────────────────────────────────
# Recruiter P1
# ─────────────────────────────────────────────────────────────────────────


async def _tool_remind_candidate(user: CurrentUser, args: dict) -> ToolResult:
    try:
        from app.services.reminder_service import reminder_service

        candidate, err = await _resolve_candidate(user, args)
        if not candidate:
            return ToolResult(ok=False, error=err or "Candidate not found.")
        cid = str(candidate.get("_id") or candidate.get("id") or "")
        result = await reminder_service.send_candidate_reminder(
            user,
            cid,
            kind=(args.get("kind") or "onboarding"),
            note=(args.get("note") or None),
            force=bool(args.get("force")),
        )
        return ToolResult(
            ok=True,
            data={
                "message": result.get("message"),
                "email_sent": result.get("email_sent"),
                "notification_sent": result.get("notification_sent"),
                "candidate": {
                    "email": (result.get("candidate") or {}).get("email") or candidate.get("email"),
                    "full_name": (result.get("candidate") or {}).get("full_name") or candidate.get("full_name"),
                },
            },
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_bulk_remind_candidates(user: CurrentUser, args: dict) -> ToolResult:
    emails = args.get("emails") or []
    note = args.get("note")
    force = bool(args.get("force"))
    sent: list[dict] = []
    failed: list[dict] = []
    try:
        if emails:
            targets = []
            for email in emails[:BULK_CAP]:
                person, err = await _resolve_candidate(user, {"email": email})
                if not person:
                    failed.append({"email": email, "error": err or "not found"})
                else:
                    targets.append(person)
        else:
            pipeline = await employee_service.list_onboarding_in_progress(user)
            targets = (pipeline.get("candidates") or [])[:BULK_CAP]
        for person in targets:
            cid = str(person.get("id") or person.get("_id") or "")
            email = person.get("email")
            try:
                result = await employee_service.remind_candidate_onboarding(
                    user, cid, note=note, force=force
                )
                sent.append({"email": email, "email_sent": result.get("email_sent")})
            except Exception as exc:  # noqa: BLE001
                failed.append({"email": email, "error": str(exc)})
        return ToolResult(
            ok=True,
            data={
                "message": f"Reminded {len(sent)} candidate(s); {len(failed)} failed.",
                "sent": sent,
                "failed": failed,
            },
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_get_dashboard_summary(user: CurrentUser, args: dict) -> ToolResult:
    try:
        result = await dashboard_service.get_summary(user)
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_update_announcement(user: CurrentUser, args: dict) -> ToolResult:
    announcement_id = (args.get("announcement_id") or args.get("id") or "").strip()
    if not announcement_id:
        return ToolResult(ok=False, error="announcement_id is required.")
    try:
        payload = UpdateAnnouncementRequest(
            title=args.get("title"),
            body=args.get("body"),
            audience=args.get("audience"),
            target_departments=args.get("target_departments"),
            target_designations=args.get("target_designations"),
            target_employee_ids=args.get("target_employee_ids"),
            send_email=bool(args.get("send_email", False)),
            notify_again=bool(args.get("notify_again", False)),
        )
        result = await dashboard_service.update_announcement(user, announcement_id, payload)
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_delete_announcement(user: CurrentUser, args: dict) -> ToolResult:
    announcement_id = (args.get("announcement_id") or args.get("id") or "").strip()
    if not announcement_id:
        return ToolResult(ok=False, error="announcement_id is required. Confirm with the recruiter before deleting.")
    if not args.get("confirm"):
        return confirm_gate(
            "delete_announcement",
            {"announcement_id": announcement_id},
            f"Delete announcement {announcement_id}?",
        )
    try:
        result = await dashboard_service.delete_announcement(user, announcement_id)
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_update_employee_role(user: CurrentUser, args: dict) -> ToolResult:
    employee, err = await _resolve_employee(user, args)
    if not employee:
        return ToolResult(ok=False, error=err or "Employee not found.")
    job_title = (args.get("job_title") or args.get("to_title") or "").strip()
    department = (args.get("department") or args.get("to_department") or "").strip()
    if not job_title or not department:
        return ToolResult(ok=False, error="job_title and department are required.")
    try:
        payload = RoleAssignRequest(
            job_title=job_title,
            department=department,
            event_type=args.get("event_type") or "title_change",
            effective_date=_parse_date(args.get("effective_date")),
            note=args.get("note"),
        )
        result = await employee_service.assign_role(
            user, employee.get("employee_id") or str(employee.get("_id")), payload
        )
        emp = result.get("employee") or {}
        return ToolResult(
            ok=True,
            data={
                "message": "Role updated.",
                "employee_id": emp.get("employee_id"),
                "full_name": emp.get("full_name"),
                "job_title": emp.get("job_title"),
                "department": emp.get("department"),
            },
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_get_recruiter_profile(user: CurrentUser, args: dict) -> ToolResult:
    try:
        result = await dashboard_service.get_recruiter_profile(user)
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_update_recruiter_profile(user: CurrentUser, args: dict) -> ToolResult:
    try:
        existing = await dashboard_service.get_recruiter_profile(user)
        profile = existing.get("profile") or existing or {}
        payload = UpdateRecruiterProfileRequest(
            full_name=args.get("full_name") or profile.get("full_name") or user.full_name or "Recruiter",
            phone=args.get("phone") if "phone" in args else profile.get("phone"),
            department=args.get("department") if "department" in args else profile.get("department"),
            job_title=args.get("job_title") if "job_title" in args else profile.get("job_title"),
            office_location=args.get("office_location")
            if "office_location" in args
            else profile.get("office_location"),
        )
        result = await dashboard_service.update_recruiter_profile(user, payload)
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


# ─────────────────────────────────────────────────────────────────────────
# Candidate / Employee shared document + notifications
# ─────────────────────────────────────────────────────────────────────────


async def _tool_get_my_document_link(user: CurrentUser, args: dict) -> ToolResult:
    document_id = (args.get("document_id") or "").strip()
    if not document_id:
        # Allow lookup by doc_type
        doc_type = (args.get("doc_type") or "").strip().lower()
        if not doc_type:
            return ToolResult(ok=False, error="document_id or doc_type is required.")
        listed = await document_service.list_mine(user)
        match = next(
            (d for d in listed.get("documents", []) if (d.get("doc_type") or "").lower() == doc_type),
            None,
        )
        if not match:
            return ToolResult(ok=False, error=f"No uploaded document of type '{doc_type}'.")
        document_id = match.get("id") or match.get("document_id")
    try:
        result = await document_service.get_signed_url(user, document_id, None)
        return ToolResult(ok=True, data={"document_id": document_id, **result})
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_delete_my_document(user: CurrentUser, args: dict) -> ToolResult:
    document_id = (args.get("document_id") or "").strip()
    if not document_id:
        return ToolResult(ok=False, error="document_id is required.")
    if not args.get("confirm"):
        return confirm_gate(
            "delete_document",
            {"document_id": document_id},
            f"Delete document {document_id}?",
        )
    try:
        result = await document_service.delete(user, document_id)
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_reextract_document(user: CurrentUser, args: dict) -> ToolResult:
    document_id = (args.get("document_id") or "").strip()
    if not document_id:
        return ToolResult(ok=False, error="document_id is required.")
    try:
        result = await document_service.reextract(user, document_id)
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_list_my_announcements(user: CurrentUser, args: dict) -> ToolResult:
    try:
        limit = int(args.get("limit") or 20)
        result = await dashboard_service.list_announcements(user, limit=limit)
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_list_notifications(user: CurrentUser, args: dict) -> ToolResult:
    try:
        limit = int(args.get("limit") or 20)
        result = await dashboard_service.get_notifications(user, limit=limit)
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_mark_notifications_read(user: CurrentUser, args: dict) -> ToolResult:
    try:
        payload = MarkNotificationsReadRequest(
            ids=args.get("ids") or [],
            all=bool(args.get("all", False)),
        )
        result = await dashboard_service.mark_notifications_read(user, payload)
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


# ─────────────────────────────────────────────────────────────────────────
# Candidate offer tools
# ─────────────────────────────────────────────────────────────────────────


async def _tool_get_my_offer(user: CurrentUser, args: dict) -> ToolResult:
    try:
        result = await offer_service.get_mine(user)
        offer = result.get("offer") if isinstance(result, dict) else None
        if not offer:
            return ToolResult(
                ok=True,
                data={
                    "offer": None,
                    "is_signed": False,
                    "status": None,
                    "offer_page": "/offer",
                    "guidance": "No offer letter on file yet.",
                },
            )
        status = (offer.get("status") or "").lower()
        is_signed = status == "signed" or bool(offer.get("signed_at"))
        return ToolResult(
            ok=True,
            data={
                "offer": offer,
                "is_signed": is_signed,
                "status": status,
                "offer_page": "/offer",
                "job_title": offer.get("job_title") or offer.get("title"),
                "guidance": (
                    "Offer is ALREADY SIGNED. Tell them clearly it is signed. "
                    "Do NOT ask them to sign or look for a signature pad. "
                    "Do NOT write /offer or offer_page in your message — the UI shows a View signed offer link."
                    if is_signed
                    else "Offer is not signed yet. Tell them they can review it from the offer button, "
                    "or call sign_offer only after they clearly accept "
                    "(agreed=true + full_legal_name). Typed name is enough — no signature pad. "
                    "Do NOT write /offer in your message."
                ),
            },
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_sign_offer(user: CurrentUser, args: dict) -> ToolResult:
    try:
        offer_wrap = await offer_service.get_mine(user)
        offer_obj = (offer_wrap.get("offer") if isinstance(offer_wrap, dict) else None) or {}
        status = (offer_obj.get("status") or "").lower()
        if status == "signed" or offer_obj.get("signed_at"):
            return ToolResult(
                ok=True,
                data={
                    "message": "Your offer letter is already signed — nothing more to sign.",
                    "already_signed": True,
                    "is_signed": True,
                    "status": "signed",
                    "offer": offer_obj,
                    "offer_page": "/offer",
                },
            )

        if not args.get("agreed"):
            return ToolResult(
                ok=False,
                error="agreed must be true. Confirm the candidate accepts the offer terms before signing.",
            )
        offer_id = (args.get("offer_id") or offer_obj.get("id") or "").strip()
        if not offer_id:
            return ToolResult(ok=False, error="No offer found to sign.")
        full_legal_name = (args.get("full_legal_name") or user.full_name or "").strip()
        if len(full_legal_name) < 2:
            return ToolResult(ok=False, error="full_legal_name is required to sign.")
        payload = OfferSignRequest(
            full_legal_name=full_legal_name,
            signature_data_url=args.get("signature_data_url"),
            agreed=True,
        )
        result = await offer_service.sign(user, offer_id, payload)
        if isinstance(result, dict):
            result.setdefault("offer_page", "/offer")
            result.setdefault("is_signed", True)
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_decline_offer(user: CurrentUser, args: dict) -> ToolResult:
    if not args.get("confirm"):
        pending = {"reason": args.get("reason"), "offer_id": args.get("offer_id")}
        pending = {k: v for k, v in pending.items() if v is not None and v != ""}
        return confirm_gate("decline_offer", pending, "Decline your offer letter?")
    try:
        offer = await offer_service.get_mine(user)
        offer_obj = offer.get("offer") or offer
        offer_id = (args.get("offer_id") or offer_obj.get("id") or "").strip()
        if not offer_id:
            return ToolResult(ok=False, error="No offer found to decline.")
        payload = OfferDeclineRequest(reason=args.get("reason"))
        result = await offer_service.decline(user, offer_id, payload)
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


# ─────────────────────────────────────────────────────────────────────────
# Employee profile tools
# ─────────────────────────────────────────────────────────────────────────


async def _tool_get_my_profile(user: CurrentUser, args: dict) -> ToolResult:
    try:
        result = await employee_service.get_my_profile(user)
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


# ─────────────────────────────────────────────────────────────────────────
# Learning — recruiter + employee
# ─────────────────────────────────────────────────────────────────────────


async def _tool_browse_catalog(user: CurrentUser, args: dict) -> ToolResult:
    try:
        result = await learning_service.browse_catalog(
            user,
            q=args.get("q") or args.get("query"),
            role=args.get("role"),
            level=args.get("level"),
            product=args.get("product"),
            course_type=args.get("type") or args.get("course_type"),
            page=int(args.get("page") or 1),
            page_size=min(int(args.get("page_size") or 20), 60),
            bookmarked_only=bool(args.get("bookmarked_only")),
            source=args.get("source") or "microsoft_learn",
            category=args.get("category"),
        )
        courses = []
        for c in (result.get("courses") or result.get("items") or [])[:30]:
            courses.append(
                {
                    "uid": c.get("uid") or c.get("id"),
                    "title": c.get("title"),
                    "url": c.get("url") or c.get("course_url"),
                    "type": c.get("type") or c.get("course_type"),
                    "level": c.get("level"),
                    "duration_minutes": c.get("duration_minutes"),
                    "source": c.get("source"),
                }
            )
        return ToolResult(
            ok=True,
            data={
                "courses": courses,
                "total": result.get("total"),
                "page": result.get("page"),
                "pages": result.get("pages"),
                "source": args.get("source") or "microsoft_learn",
            },
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_assign_courses(user: CurrentUser, args: dict) -> ToolResult:
    try:
        payload = CourseAssignRequest(
            employee_ids=args.get("employee_ids") or [],
            department=args.get("department"),
            job_title=args.get("job_title") or args.get("joining_role"),
            joining_role=args.get("joining_role"),
            required_skills=args.get("required_skills") or [],
            course_uid=args["course_uid"],
            course_title=args["course_title"],
            course_url=args["course_url"],
            course_type=args.get("course_type") or "learningPath",
            duration_minutes=args.get("duration_minutes"),
            due_date=_parse_date(args.get("due_date")),
            mandatory=bool(args.get("mandatory")),
            note=args.get("note"),
        )
        result = await learning_service.assign_courses(user, payload)
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_list_assignments(user: CurrentUser, args: dict) -> ToolResult:
    try:
        result = await learning_service.list_assignments(
            user,
            employee_id=args.get("employee_id"),
            status_filter=args.get("status"),
            mandatory_only=args.get("mandatory"),
        )
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_list_pending_certificates(user: CurrentUser, args: dict) -> ToolResult:
    try:
        result = await learning_service.list_pending_certificates(user)
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_verify_certificate(user: CurrentUser, args: dict) -> ToolResult:
    certificate_id = (args.get("certificate_id") or "").strip()
    if not certificate_id:
        return ToolResult(ok=False, error="certificate_id is required.")
    if "approve" not in args:
        return ToolResult(ok=False, error="approve=true|false is required.")
    try:
        payload = CertificateVerifyRequest(approve=bool(args.get("approve")), note=args.get("note"))
        result = await learning_service.verify_certificate(user, certificate_id, payload)
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_learning_analytics(user: CurrentUser, args: dict) -> ToolResult:
    try:
        result = await learning_service.get_analytics(user, department=args.get("department"))
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_employee_learning_profile(user: CurrentUser, args: dict) -> ToolResult:
    employee, err = await _resolve_employee(user, args)
    if not employee:
        return ToolResult(ok=False, error=err or "Employee not found.")
    try:
        result = await learning_service.get_employee_learning_profile(
            user,
            employee.get("employee_id") or str(employee.get("_id")),
            refresh_ai=bool(args.get("refresh")),
        )
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_kb_list_roles(user: CurrentUser, args: dict) -> ToolResult:
    return ToolResult(ok=False, error="The recruiter Knowledge Base has been removed. Use Organization Setup → Role ladders and Career Roadmap instead.")


async def _tool_kb_create_role(user: CurrentUser, args: dict) -> ToolResult:
    return ToolResult(ok=False, error="The recruiter Knowledge Base has been removed. Use Organization Setup → Role ladders and Career Roadmap instead.")


async def _tool_kb_delete_role(user: CurrentUser, args: dict) -> ToolResult:
    return ToolResult(ok=False, error="The recruiter Knowledge Base has been removed. Use Organization Setup → Role ladders and Career Roadmap instead.")


async def _tool_kb_list_certs(user: CurrentUser, args: dict) -> ToolResult:
    return ToolResult(ok=False, error="The recruiter Knowledge Base has been removed. Use Organization Setup → Career Roadmap and the managed course catalog instead.")


async def _tool_kb_create_cert(user: CurrentUser, args: dict) -> ToolResult:
    return ToolResult(ok=False, error="The recruiter Knowledge Base has been removed. Use Organization Setup → Career Roadmap and the managed course catalog instead.")


async def _tool_kb_delete_cert(user: CurrentUser, args: dict) -> ToolResult:
    return ToolResult(ok=False, error="The recruiter Knowledge Base has been removed. Use Organization Setup → Career Roadmap and the managed course catalog instead.")


# Employee learning


async def _tool_my_learning_dashboard(user: CurrentUser, args: dict) -> ToolResult:
    try:
        return ToolResult(ok=True, data=await learning_service.get_learning_dashboard(user))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_my_courses(user: CurrentUser, args: dict) -> ToolResult:
    try:
        return ToolResult(
            ok=True,
            data=await learning_service.list_my_courses(user, args.get("status")),
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_start_course(user: CurrentUser, args: dict) -> ToolResult:
    uid = (args.get("course_uid") or args.get("uid") or "").strip()
    if not uid:
        return ToolResult(ok=False, error="course_uid is required.")
    try:
        return ToolResult(ok=True, data=await learning_service.start_course(user, uid))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_update_course_progress(user: CurrentUser, args: dict) -> ToolResult:
    uid = (args.get("course_uid") or args.get("uid") or "").strip()
    if not uid:
        return ToolResult(ok=False, error="course_uid is required.")
    try:
        payload = EnrollmentProgressRequest(
            progress_percent=int(args.get("progress_percent") or 0),
            status=args.get("status"),
        )
        return ToolResult(ok=True, data=await learning_service.update_progress(user, uid, payload))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_list_bookmarks(user: CurrentUser, args: dict) -> ToolResult:
    try:
        return ToolResult(ok=True, data=await learning_service.list_bookmarks(user))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_add_bookmark(user: CurrentUser, args: dict) -> ToolResult:
    try:
        payload = BookmarkRequest(
            course_uid=args["course_uid"],
            course_title=args["course_title"],
            course_url=args["course_url"],
            course_type=args.get("course_type") or "learningPath",
            duration_minutes=args.get("duration_minutes"),
            level=args.get("level"),
        )
        return ToolResult(ok=True, data=await learning_service.add_bookmark(user, payload))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_remove_bookmark(user: CurrentUser, args: dict) -> ToolResult:
    uid = (args.get("course_uid") or args.get("uid") or "").strip()
    if not uid:
        return ToolResult(ok=False, error="course_uid is required.")
    try:
        return ToolResult(ok=True, data=await learning_service.remove_bookmark(user, uid))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_list_skills(user: CurrentUser, args: dict) -> ToolResult:
    try:
        return ToolResult(ok=True, data=await learning_service.list_skills(user))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_upsert_skill(user: CurrentUser, args: dict) -> ToolResult:
    try:
        payload = SkillUpsertRequest(
            skill_name=args["skill_name"],
            category=args.get("category") or "Other",
            proficiency=args.get("proficiency") or "Beginner",
            years_experience=args.get("years_experience"),
        )
        return ToolResult(ok=True, data=await learning_service.upsert_skill(user, payload))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_delete_skill(user: CurrentUser, args: dict) -> ToolResult:
    skill_id = (args.get("skill_id") or "").strip()
    if not skill_id:
        return ToolResult(ok=False, error="skill_id is required.")
    if not args.get("confirm"):
        return confirm_gate("delete_skill", {"skill_id": skill_id}, f"Delete skill {skill_id}?")
    try:
        return ToolResult(ok=True, data=await learning_service.delete_skill(user, skill_id))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_assess_skills(user: CurrentUser, args: dict) -> ToolResult:
    try:
        return ToolResult(
            ok=True,
            data=await learning_service.assess_my_skills(
                user, refresh=bool(args.get("refresh")), lazy=bool(args.get("lazy"))
            ),
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_get_career_goal(user: CurrentUser, args: dict) -> ToolResult:
    try:
        return ToolResult(ok=True, data=await learning_service.get_career_goal(user))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_set_career_goal(user: CurrentUser, args: dict) -> ToolResult:
    try:
        payload = CareerGoalRequest(target_role=args["target_role"])
        return ToolResult(ok=True, data=await learning_service.set_career_goal(user, payload))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_skill_gap(user: CurrentUser, args: dict) -> ToolResult:
    try:
        return ToolResult(
            ok=True,
            data=await learning_service.get_skill_gap(
                user,
                args.get("target_role"),
                refresh=bool(args.get("refresh")),
            ),
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_career_path(user: CurrentUser, args: dict) -> ToolResult:
    try:
        return ToolResult(
            ok=True,
            data=await learning_service.get_career_path(user, refresh=bool(args.get("refresh"))),
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_learning_recommendations(user: CurrentUser, args: dict) -> ToolResult:
    try:
        return ToolResult(
            ok=True,
            data=await learning_service.get_recommendations(user, refresh=bool(args.get("refresh"))),
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_list_my_certificates(user: CurrentUser, args: dict) -> ToolResult:
    try:
        return ToolResult(ok=True, data=await learning_service.list_my_certificates(user))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_delete_certificate(user: CurrentUser, args: dict) -> ToolResult:
    certificate_id = (args.get("certificate_id") or "").strip()
    if not certificate_id:
        return ToolResult(ok=False, error="certificate_id is required.")
    if not args.get("confirm"):
        return confirm_gate(
            "delete_certificate",
            {"certificate_id": certificate_id},
            f"Delete certificate {certificate_id}?",
        )
    try:
        return ToolResult(ok=True, data=await learning_service.delete_certificate(user, certificate_id))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_update_certificate(user: CurrentUser, args: dict) -> ToolResult:
    certificate_id = (args.get("certificate_id") or "").strip()
    if not certificate_id:
        return ToolResult(ok=False, error="certificate_id is required.")
    try:
        return ToolResult(
            ok=True,
            data=await learning_service.update_certificate(
                user,
                certificate_id,
                course_title=args.get("course_title"),
                completion_date=_parse_date(args.get("completion_date")),
                learning_hours=args.get("learning_hours"),
            ),
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


# ─────────────────────────────────────────────────────────────────────────
# Talent — recruiter + employee
# ─────────────────────────────────────────────────────────────────────────


async def _tool_talent_metrics(user: CurrentUser, args: dict) -> ToolResult:
    try:
        return ToolResult(
            ok=True,
            data=await talent_service.talent_metrics(user, department=args.get("department")),
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_search_talent(user: CurrentUser, args: dict) -> ToolResult:
    try:
        payload = TalentSearchRequest(
            q=args.get("q") or args.get("query"),
            skills=args.get("skills") or [],
            certifications=args.get("certifications") or [],
            department=args.get("department"),
            min_experience_years=args.get("min_experience_years"),
            min_performance_rating=args.get("min_performance_rating"),
            min_learning_progress=args.get("min_learning_progress"),
            min_competency_score=args.get("min_competency_score"),
            semantic=bool(args.get("semantic")),
            page=int(args.get("page") or 1),
            page_size=min(int(args.get("page_size") or 20), 60),
        )
        result = await talent_service.search_talent(user, payload)
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_list_opportunities(user: CurrentUser, args: dict) -> ToolResult:
    try:
        result = await talent_service.list_opportunities(
            user,
            q=args.get("q") or args.get("query"),
            opp_type=args.get("type"),
            department=args.get("department"),
            status_filter=args.get("status") or "open",
            page=int(args.get("page") or 1),
            page_size=min(int(args.get("page_size") or 20), 60),
            for_employee=user.role == "employee",
        )
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_create_opportunity(user: CurrentUser, args: dict) -> ToolResult:
    try:
        payload = InternalOpportunityCreateRequest(
            title=args["title"],
            type=args.get("type") or "open_position",
            department=args["department"],
            description=args["description"],
            required_skills=args.get("required_skills") or [],
            location=args.get("location"),
            commitment=args.get("commitment"),
            closes_at=_parse_date(args.get("closes_at")),
        )
        return ToolResult(ok=True, data=await talent_service.create_opportunity(user, payload))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_update_opportunity(user: CurrentUser, args: dict) -> ToolResult:
    opportunity_id = (args.get("opportunity_id") or args.get("id") or "").strip()
    if not opportunity_id:
        return ToolResult(ok=False, error="opportunity_id is required.")
    try:
        payload = InternalOpportunityUpdateRequest(
            title=args.get("title"),
            description=args.get("description"),
            required_skills=args.get("required_skills"),
            status=args.get("status"),
            closes_at=_parse_date(args.get("closes_at")),
        )
        return ToolResult(
            ok=True,
            data=await talent_service.update_opportunity(user, opportunity_id, payload),
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_list_applicants(user: CurrentUser, args: dict) -> ToolResult:
    opportunity_id = (args.get("opportunity_id") or args.get("id") or "").strip()
    if not opportunity_id:
        return ToolResult(ok=False, error="opportunity_id is required.")
    try:
        return ToolResult(
            ok=True,
            data=await talent_service.list_opportunity_applicants(user, opportunity_id),
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_submit_competency(user: CurrentUser, args: dict) -> ToolResult:
    employee, err = await _resolve_employee(user, args)
    if not employee:
        return ToolResult(ok=False, error=err or "Employee not found.")
    try:
        payload = CompetencyEvaluationRequest(
            technical=int(args.get("technical") or 3),
            leadership=int(args.get("leadership") or 3),
            communication=int(args.get("communication") or 3),
            collaboration=int(args.get("collaboration") or 3),
            problem_solving=int(args.get("problem_solving") or 3),
            innovation=int(args.get("innovation") or 3),
            comments=args.get("comments"),
        )
        eid = employee.get("employee_id") or str(employee.get("_id"))
        return ToolResult(
            ok=True,
            data=await talent_service.submit_competency_evaluation(user, eid, payload),
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_update_development_plan(user: CurrentUser, args: dict) -> ToolResult:
    employee, err = await _resolve_employee(user, args)
    if not employee:
        return ToolResult(ok=False, error=err or "Employee not found.")
    try:
        milestones = []
        for m in args.get("milestones") or []:
            milestones.append(
                DevelopmentMilestoneUpdate(
                    id=m["id"],
                    status=m.get("status"),
                    due_date=_parse_date(m.get("due_date")),
                    note=m.get("note"),
                )
            )
        payload = DevelopmentPlanUpdateRequest(
            target_timeline=args.get("target_timeline"),
            milestones=milestones,
            recruiter_note=args.get("recruiter_note"),
        )
        eid = employee.get("employee_id") or str(employee.get("_id"))
        return ToolResult(
            ok=True,
            data=await talent_service.update_development_plan(user, eid, payload),
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_get_talent_profile(user: CurrentUser, args: dict) -> ToolResult:
    employee, err = await _resolve_employee(user, args)
    if not employee:
        return ToolResult(ok=False, error=err or "Employee not found.")
    try:
        eid = employee.get("employee_id") or str(employee.get("_id"))
        return ToolResult(ok=True, data=await talent_service.get_talent_profile(user, eid))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_apply_opportunity(user: CurrentUser, args: dict) -> ToolResult:
    opportunity_id = (args.get("opportunity_id") or args.get("id") or "").strip()
    if not opportunity_id:
        return ToolResult(ok=False, error="opportunity_id is required.")
    if not args.get("confirm"):
        return confirm_gate(
            "apply_to_opportunity",
            {"opportunity_id": opportunity_id},
            f"Apply to opportunity {opportunity_id}?",
        )
    try:
        return ToolResult(
            ok=True,
            data=await talent_service.apply_to_opportunity(user, opportunity_id),
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_my_journey(user: CurrentUser, args: dict) -> ToolResult:
    try:
        employee = await talent_service.get_current_employee(user)
        types = args.get("types")
        event_types = [t.strip() for t in types.split(",")] if isinstance(types, str) and types else args.get("event_types")
        return ToolResult(
            ok=True,
            data=await talent_service.journey_timeline(employee, event_types=event_types),
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_my_achievements(user: CurrentUser, args: dict) -> ToolResult:
    try:
        employee = await talent_service.get_current_employee(user)
        return ToolResult(ok=True, data=await talent_service.achievements(employee))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_my_career_progression(user: CurrentUser, args: dict) -> ToolResult:
    try:
        employee = await talent_service.get_current_employee(user)
        return ToolResult(ok=True, data=await talent_service.career_progression(employee))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_send_reminder(user: CurrentUser, args: dict) -> ToolResult:
    """Unified reminder for employees (and candidates via target_role)."""
    try:
        from app.services.reminder_service import reminder_service

        target_role = (args.get("target_role") or "employee").strip().lower()
        kind = (args.get("kind") or ("onboarding" if target_role == "candidate" else "general")).strip().lower()
        note = args.get("note")
        force = bool(args.get("force"))
        if target_role == "candidate":
            candidate, err = await _resolve_candidate(user, args)
            if not candidate:
                return ToolResult(ok=False, error=err or "Candidate not found.")
            cid = str(candidate.get("_id") or candidate.get("id") or "")
            result = await reminder_service.send_candidate_reminder(
                user, cid, kind=kind, note=note, force=force
            )
        else:
            employee, err = await _resolve_employee(user, args)
            if not employee:
                return ToolResult(ok=False, error=err or "Employee not found.")
            eid = employee.get("employee_id") or str(employee.get("_id") or "")
            result = await reminder_service.send_employee_reminder(
                user, eid, kind=kind, note=note, force=force
            )
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_list_hr_threads(user: CurrentUser, args: dict) -> ToolResult:
    try:
        from app.services.message_service import message_service

        if user.role in ("recruiter", "super_admin"):
            return ToolResult(ok=True, data=await message_service.list_threads_for_recruiter(user))
        if user.role == "candidate":
            return ToolResult(ok=True, data=await message_service.list_threads_for_candidate(user))
        return ToolResult(ok=True, data=await message_service.list_threads_for_employee(user))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_message_recruiter(user: CurrentUser, args: dict) -> ToolResult:
    try:
        from app.services.message_service import message_service

        body = (args.get("body") or args.get("message") or "").strip()
        if not body:
            return ToolResult(ok=False, error="body is required.")
        if user.role == "candidate":
            result = await message_service.candidate_send(
                user,
                body=body,
                subject=args.get("subject"),
                thread_id=args.get("thread_id"),
            )
        else:
            result = await message_service.employee_send(
                user,
                body=body,
                subject=args.get("subject"),
                thread_id=args.get("thread_id"),
            )
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_message_employee(user: CurrentUser, args: dict) -> ToolResult:
    try:
        from app.services.message_service import message_service

        body = (args.get("body") or args.get("message") or "").strip()
        employee_id = (args.get("employee_id") or "").strip()
        if not body:
            return ToolResult(ok=False, error="body is required.")
        if not employee_id and args.get("email"):
            # Resolve employee_id from email when possible
            from app.core.database import database

            emp = await database.employees.find_one({"email": str(args.get("email")).strip().lower()})
            if emp:
                employee_id = emp.get("employee_id") or str(emp.get("_id"))
        if not employee_id:
            return ToolResult(ok=False, error="employee_id (or email of an employee) is required.")
        result = await message_service.recruiter_start(
            user,
            employee_id=employee_id,
            body=body,
            subject=args.get("subject"),
        )
        return ToolResult(ok=True, data={**(result if isinstance(result, dict) else {}), "message": "Message sent to employee."})
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_reply_hr_thread(user: CurrentUser, args: dict) -> ToolResult:
    try:
        from app.services.message_service import message_service

        thread_id = (args.get("thread_id") or "").strip()
        body = (args.get("body") or args.get("message") or "").strip()
        if not thread_id or not body:
            return ToolResult(ok=False, error="thread_id and body are required.")
        if user.role in ("recruiter", "super_admin"):
            result = await message_service.recruiter_reply(user, thread_id, body=body)
        elif user.role == "candidate":
            result = await message_service.candidate_send(user, body=body, thread_id=thread_id)
        else:
            result = await message_service.employee_send(user, body=body, thread_id=thread_id)
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


# ─────────────────────────────────────────────────────────────────────────
# IT provisioning (pre-activation company email + assets)
# ─────────────────────────────────────────────────────────────────────────


async def _resolve_it_provisioning_offer(
    user: CurrentUser, args: dict
) -> tuple[str | None, dict | None, str | None]:
    """Resolve a signed offer id for IT provisioning from email/name/offer_id.

    Returns (offer_id, person, error). `person` is the ready-list candidate row
    (has email/full_name/offer_id) used for messaging.
    """
    offer_id = (args.get("offer_id") or "").strip()
    email = (args.get("email") or args.get("candidate_email") or "").strip()
    name = (args.get("name") or args.get("full_name") or "").strip()
    if not offer_id and email and "@" not in email and not name:
        name, email = email, ""
    try:
        ready = await employee_service.list_ready_for_conversion(user)
    except Exception as exc:  # noqa: BLE001
        return None, None, f"Could not load ready-to-activate candidates: {_err(exc).error}"
    candidates = ready.get("candidates") or []
    if offer_id:
        return offer_id, None, None
    if email:
        for c in candidates:
            if (c.get("email") or "").lower() == email.lower():
                return c.get("offer_id"), c, None
        return None, None, await _it_eligibility_reason(user, email=email, name=None)
    if name:
        for c in candidates:
            if name.lower() in (c.get("full_name") or "").lower():
                return c.get("offer_id"), c, None
        return None, None, await _it_eligibility_reason(user, email=None, name=name)
    return None, None, "Provide offer_id, email, or name of a candidate with a signed offer."


async def _it_eligibility_reason(user: CurrentUser, *, email: str | None, name: str | None) -> str:
    """Tailored message when a person is not in the ready-to-activate list."""
    lookup = {"email": email} if email else ({"name": name} if name else {})
    if not lookup:
        return "No signed candidate found."
    emp, _ = await _resolve_employee(user, lookup)
    if emp:
        who = email or name
        return f"{who} is already an employee — IT provisioning only applies to signed candidates before activation."
    cand, _ = await _resolve_candidate(user, lookup)
    who = email or name
    if cand:
        signed = (cand.get("status") or "").lower() == "signed"
        onboarding_submitted = ((cand.get("onboarding") or {}).get("status") or "") == "submitted"
        if not signed:
            return f"{who} has no signed offer yet — IT provisioning starts after the candidate signs the offer."
        if not onboarding_submitted:
            return (
                f"{who} signed but hasn't finished onboarding intake yet. "
                "Complete onboarding first, then send IT provisioning."
            )
        return f"{who} isn't in the ready-to-activate list yet."
    return f"No candidate found for {who}."


def _it_person(c: dict) -> dict:
    return {
        "email": c.get("email"),
        "full_name": c.get("full_name"),
        "offer_id": c.get("offer_id"),
    }


async def _it_provisioning_targets(
    user: CurrentUser, args: dict, *, mode: str
) -> tuple[list[dict], list[str], list[dict]]:
    """Classify ready-to-activate candidates for bulk IT send/remind.

    mode "send" → not yet requested (never emailed IT); mode "remind" → pending only.
    Returns (targets, not_found, skipped) where targets are candidate rows and
    not_found are requested emails that don't match anyone at the IT-ready stage.
    """
    emails = [e.lower().strip() for e in (args.get("emails") or []) if e]
    offer_ids_arg = [str(o).strip() for o in (args.get("offer_ids") or []) if o]
    ready = await employee_service.list_ready_for_conversion(user)
    candidates = ready.get("candidates") or []
    selected = [
        c
        for c in candidates
        if c.get("offer_id")
        and (not emails or (c.get("email") or "").lower() in emails)
        and (not offer_ids_arg or c.get("offer_id") in offer_ids_arg)
    ]
    not_found: list[str] = []
    if emails:
        found = {(c.get("email") or "").lower() for c in candidates}
        not_found = [e for e in emails if e not in found]

    targets: list[dict] = []
    skipped: list[dict] = []
    for c in selected:
        if c.get("can_activate"):
            skipped.append({**_it_person(c), "reason": "already_submitted"})
            continue
        status = (c.get("it_provisioning") or {}).get("status")
        if mode == "send":
            if status == "pending":
                skipped.append({**_it_person(c), "reason": "already_pending"})
            else:
                targets.append(c)
        else:  # remind
            if status == "pending":
                targets.append(c)
            else:
                skipped.append({**_it_person(c), "reason": "not_sent_yet"})
    return targets[:BULK_CAP], not_found, skipped


async def _tool_send_it_provisioning(user: CurrentUser, args: dict) -> ToolResult:
    from app.schemas.it_provisioning import SendItProvisioningRequest
    from app.services.it_provisioning_service import it_provisioning_service

    offer_id, person, err = await _resolve_it_provisioning_offer(user, args)
    if err:
        return ToolResult(ok=False, error=err)
    who = (person or {}).get("full_name") or (person or {}).get("email") or offer_id
    try:
        existing = await it_provisioning_service.get_for_offer(offer_id, user)
        if existing and existing.get("status") in ("submitted", "applied"):
            return ToolResult(
                ok=False,
                error=(
                    f"IT has already submitted provisioning for {who}. "
                    "You can activate the employee instead (approve_offer)."
                ),
            )
        if existing and existing.get("status") == "pending" and not args.get("resend"):
            return ToolResult(
                ok=False,
                error=(
                    f"IT provisioning for {who} is already pending (sent to "
                    f"{existing.get('it_manager_email')}). Use remind_it_provisioning to follow up, "
                    "or call this tool with resend=true to email IT a fresh request."
                ),
            )
        result = await it_provisioning_service.send_request(
            user,
            SendItProvisioningRequest(
                offer_id=offer_id,
                it_manager_email=args.get("it_manager_email"),
                note=args.get("note"),
            ),
        )
        return ToolResult(
            ok=True,
            data={
                "message": result.get("message"),
                "email_sent": result.get("email_sent"),
                "email_error": result.get("email_error"),
                "form_link": result.get("form_link"),
                "provisioning": result.get("provisioning"),
            },
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_remind_it_provisioning(user: CurrentUser, args: dict) -> ToolResult:
    from app.schemas.it_provisioning import RemindItProvisioningRequest
    from app.services.it_provisioning_service import it_provisioning_service

    offer_id, person, err = await _resolve_it_provisioning_offer(user, args)
    if err:
        return ToolResult(ok=False, error=err)
    who = (person or {}).get("full_name") or (person or {}).get("email") or offer_id
    try:
        existing = await it_provisioning_service.get_for_offer(offer_id, user)
        if not existing:
            return ToolResult(
                ok=False,
                error=(
                    f"No IT provisioning request exists for {who} yet. "
                    "Send the IT email first (send_it_provisioning)."
                ),
            )
        if existing.get("status") in ("submitted", "applied"):
            return ToolResult(
                ok=False,
                error=(
                    f"IT already submitted provisioning for {who}. "
                    "You can activate the employee instead (approve_offer)."
                ),
            )
        result = await it_provisioning_service.remind(
            user,
            RemindItProvisioningRequest(offer_id=offer_id, note=args.get("note")),
        )
        return ToolResult(
            ok=True,
            data={
                "message": result.get("message"),
                "email_sent": result.get("email_sent"),
                "email_error": result.get("email_error"),
                "form_link": result.get("form_link"),
                "provisioning": result.get("provisioning"),
            },
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_bulk_send_it_provisioning(user: CurrentUser, args: dict) -> ToolResult:
    from app.schemas.it_provisioning import BulkSendItProvisioningRequest
    from app.services.it_provisioning_service import it_provisioning_service

    try:
        targets, not_found, skipped = await _it_provisioning_targets(user, args, mode="send")
        if targets and not args.get("confirm"):
            return confirm_gate(
                "bulk_send_it_provisioning",
                {
                    "emails": args.get("emails"),
                    "offer_ids": args.get("offer_ids"),
                    "it_manager_email": args.get("it_manager_email"),
                    "note": args.get("note"),
                    "batch_email": bool(args.get("batch_email")),
                    "batch_form": bool(args.get("batch_form")),
                },
                f"Email IT to provision {len(targets)} candidate(s)?",
            )
        if not targets:
            return ToolResult(
                ok=True,
                data={
                    "message": "No candidates are ready for a fresh IT email right now.",
                    "sent": [],
                    "failed": [],
                    "not_found": not_found,
                    "skipped": skipped,
                    "summary": {"sent": 0, "failed": 0},
                },
            )
        result = await it_provisioning_service.bulk_send(
            user,
            BulkSendItProvisioningRequest(
                offer_ids=[c["offer_id"] for c in targets],
                it_manager_email=args.get("it_manager_email"),
                note=args.get("note"),
                batch_email=bool(args.get("batch_email")),
                batch_form=bool(args.get("batch_form")),
            ),
        )
        data = result if isinstance(result, dict) else {"message": str(result)}
        data["not_found"] = not_found
        data["skipped"] = skipped
        data["targeted"] = [_it_person(c) for c in targets]
        return ToolResult(ok=True, data=data)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_bulk_remind_it_provisioning(user: CurrentUser, args: dict) -> ToolResult:
    from app.schemas.it_provisioning import BulkRemindItProvisioningRequest
    from app.services.it_provisioning_service import it_provisioning_service

    try:
        targets, not_found, skipped = await _it_provisioning_targets(user, args, mode="remind")
        if targets and not args.get("confirm"):
            return confirm_gate(
                "bulk_remind_it_provisioning",
                {
                    "emails": args.get("emails"),
                    "offer_ids": args.get("offer_ids"),
                    "note": args.get("note"),
                },
                f"Send IT follow-up emails for {len(targets)} pending request(s)?",
            )
        if not targets:
            return ToolResult(
                ok=True,
                data={
                    "message": "No pending IT provisioning requests to remind about.",
                    "sent": [],
                    "failed": [],
                    "not_found": not_found,
                    "skipped": skipped,
                    "summary": {"sent": 0, "failed": 0},
                },
            )
        result = await it_provisioning_service.bulk_remind(
            user,
            BulkRemindItProvisioningRequest(offer_ids=[c["offer_id"] for c in targets], note=args.get("note")),
        )
        data = result if isinstance(result, dict) else {"message": str(result)}
        data["not_found"] = not_found
        data["skipped"] = skipped
        data["targeted"] = [_it_person(c) for c in targets]
        return ToolResult(ok=True, data=data)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_list_it_kits(user: CurrentUser, args: dict) -> ToolResult:
    from app.services.it_kit_service import it_kit_service

    try:
        return ToolResult(ok=True, data=await it_kit_service.list_kits(user))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_create_it_kit(user: CurrentUser, args: dict) -> ToolResult:
    from app.schemas.it_provisioning import ItKitCreateRequest
    from app.services.it_kit_service import it_kit_service

    try:
        result = await it_kit_service.create_kit(
            user,
            ItKitCreateRequest(
                name=args.get("name"),
                description=args.get("description"),
                assets=args.get("assets") or [],
                licenses=args.get("licenses") or [],
                roles=args.get("roles") or [],
                is_default=bool(args.get("is_default")),
            ),
        )
        return ToolResult(
            ok=True,
            data={**result, "message": f"IT kit '{result.get('name')}' created with {len(result.get('assets') or [])} asset(s) and {len(result.get('licenses') or [])} license(s)."},
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_update_it_kit(user: CurrentUser, args: dict) -> ToolResult:
    from app.schemas.it_provisioning import ItKitUpdateRequest
    from app.services.it_kit_service import it_kit_service

    try:
        result = await it_kit_service.update_kit(
            user,
            args.get("kit_id"),
            ItKitUpdateRequest(
                name=args.get("name"),
                description=args.get("description"),
                assets=args.get("assets"),
                licenses=args.get("licenses"),
                roles=args.get("roles"),
                is_default=args.get("is_default"),
            ),
        )
        return ToolResult(ok=True, data={**result, "message": f"IT kit '{result.get('name')}' updated."})
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_delete_it_kit(user: CurrentUser, args: dict) -> ToolResult:
    from app.services.it_kit_service import it_kit_service

    try:
        if not args.get("confirm"):
            return confirm_gate(
                "delete_it_kit",
                {"kit_id": args.get("kit_id")},
                f"Delete the IT kit '{args.get('name') or args.get('kit_id')}'? This removes the template.",
            )
        result = await it_kit_service.delete_kit(user, args.get("kit_id"))
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_list_it_officers(user: CurrentUser, args: dict) -> ToolResult:
    from app.services.it_service_request_service import it_service_request_service

    try:
        return ToolResult(ok=True, data=await it_service_request_service.officers_overview(user))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_list_it_service_requests(user: CurrentUser, args: dict) -> ToolResult:
    from app.services.it_service_request_service import it_service_request_service

    try:
        return ToolResult(
            ok=True,
            data=await it_service_request_service.list_recruiter(user, args.get("status")),
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_create_it_service_request(user: CurrentUser, args: dict) -> ToolResult:
    from app.schemas.it_service_request import ItServiceRequestCreate
    from app.services.it_service_request_service import it_service_request_service

    try:
        result = await it_service_request_service.create_for_employee(
            user,
            ItServiceRequestCreate(
                employee_id=args.get("employee_id"),
                request_type=args.get("request_type") or "other",
                title=args.get("title"),
                description=args.get("description"),
                it_manager_email=args.get("it_manager_email"),
                note=args.get("note"),
            ),
        )
        message = (
            f"IT request sent to {result.get('it_manager_email')} for {result.get('employee_name')}."
            if result.get("status") == "sent"
            else f"IT request draft created for {result.get('employee_name')} — send it to an IT officer to email them."
        )
        return ToolResult(ok=True, data={**result, "message": message})
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_send_it_service_request(user: CurrentUser, args: dict) -> ToolResult:
    from app.schemas.it_service_request import ItServiceRequestSendRequest
    from app.services.it_service_request_service import it_service_request_service

    try:
        if not args.get("confirm"):
            return confirm_gate(
                "send_it_service_request",
                {
                    "request_id": args.get("request_id"),
                    "it_manager_email": args.get("it_manager_email"),
                    "note": args.get("note"),
                },
                f"Send IT request '{args.get('title') or args.get('request_id')}' to {args.get('it_manager_email')}?",
            )
        result = await it_service_request_service.send_to_it(
            user,
            ItServiceRequestSendRequest(
                request_id=args.get("request_id"),
                it_manager_email=args.get("it_manager_email"),
                note=args.get("note"),
            ),
        )
        return ToolResult(
            ok=True,
            data={**result, "message": f"IT request sent to {result.get('it_manager_email')}."},
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_cancel_it_service_request(user: CurrentUser, args: dict) -> ToolResult:
    from app.services.it_service_request_service import it_service_request_service

    try:
        if not args.get("confirm"):
            return confirm_gate(
                "cancel_it_service_request",
                {"request_id": args.get("request_id"), "reason": args.get("reason")},
                f"Cancel IT request '{args.get('title') or args.get('request_id')}'?",
            )
        return ToolResult(
            ok=True,
            data=await it_service_request_service.cancel(user, args.get("request_id"), args.get("reason")),
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_list_my_it_requests(user: CurrentUser, args: dict) -> ToolResult:
    from app.services.it_service_request_service import it_service_request_service

    try:
        return ToolResult(ok=True, data=await it_service_request_service.list_employee(user))
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_create_my_it_request(user: CurrentUser, args: dict) -> ToolResult:
    from app.schemas.it_service_request import ItServiceRequestEmployeeCreate
    from app.services.it_service_request_service import it_service_request_service

    try:
        result = await it_service_request_service.create_employee_draft(
            user,
            ItServiceRequestEmployeeCreate(
                request_type=args.get("request_type") or "other",
                title=args.get("title"),
                description=args.get("description"),
            ),
        )
        return ToolResult(
            ok=True,
            data={
                **result,
                "message": (
                    "Your IT request has been sent to HR. "
                    "They will review it and forward it to IT. "
                    "You can check progress on the IT support page."
                ),
            },
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_close_my_it_request(user: CurrentUser, args: dict) -> ToolResult:
    from app.services.it_service_request_service import it_service_request_service

    try:
        return ToolResult(
            ok=True,
            data=await it_service_request_service.close_by_employee(user, args.get("request_id")),
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


# ─────────────────────────────────────────────────────────────────────────
# Tool registrations
# ─────────────────────────────────────────────────────────────────────────

# ── Support ticket tools (recruiter) ──────────────────────────────────────


async def _tool_list_my_support_tickets(user: CurrentUser, args: dict) -> ToolResult:
    """List the recruiter's own support tickets with optional filters."""
    try:
        result = await ticket_service.list_my_tickets(
            user,
            status=(args.get("status") or None),
            priority=(args.get("priority") or None),
            category=(args.get("category") or None),
            search=(args.get("search") or None),
            page=int(args.get("page") or 1),
            page_size=min(int(args.get("page_size") or 20), 50),
        )
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_my_ticket_stats(user: CurrentUser, args: dict) -> ToolResult:
    """Get the recruiter's own ticket stats (open, resolved, total, by priority)."""
    try:
        stats = await ticket_service.my_ticket_stats(user)
        return ToolResult(ok=True, data=stats)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_view_support_ticket(user: CurrentUser, args: dict) -> ToolResult:
    """View a single support ticket with its full conversation thread."""
    ticket_id = (args.get("ticket_id") or args.get("id") or "").strip()
    if not ticket_id:
        return ToolResult(ok=False, error="ticket_id is required.")
    try:
        result = await ticket_service.get_ticket(user, ticket_id)
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_reply_support_ticket(user: CurrentUser, args: dict) -> ToolResult:
    """Reply to an existing support ticket."""
    ticket_id = (args.get("ticket_id") or args.get("id") or "").strip()
    message = (args.get("message") or "").strip()
    if not ticket_id:
        return ToolResult(ok=False, error="ticket_id is required.")
    if not message:
        return ToolResult(ok=False, error="message is required.")
    try:
        from app.schemas.ticket import TicketReplyRequest

        request = TicketReplyRequest(message=message)
        result = await ticket_service.reply_to_ticket(user, ticket_id, request)
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_close_support_ticket(user: CurrentUser, args: dict) -> ToolResult:
    """Close one of the recruiter's support tickets."""
    ticket_id = (args.get("ticket_id") or args.get("id") or "").strip()
    if not ticket_id:
        return ToolResult(ok=False, error="ticket_id is required.")
    try:
        result = await ticket_service.close_ticket(user, ticket_id)
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


# ── Employee banking tool ─────────────────────────────────────────────────


async def _tool_update_employee_banking(user: CurrentUser, args: dict) -> ToolResult:
    """Update an employee's payroll banking details (recruiter-managed)."""
    employee, err = await _resolve_employee(user, args)
    if not employee:
        return ToolResult(ok=False, error=err or "Employee not found.")
    required = ("bank_name", "account_holder_name", "account_number", "iban", "branch", "branch_code")
    missing = [k for k in required if not (args.get(k) or "").strip()]
    if missing:
        return ToolResult(ok=False, error=f"Missing required banking fields: {', '.join(missing)}")
    try:
        payload = OnboardingEmploymentInfo(
            bank_name=args.get("bank_name").strip(),
            account_holder_name=args.get("account_holder_name").strip(),
            account_number=args.get("account_number").strip(),
            iban=args.get("iban").strip(),
            branch=args.get("branch").strip(),
            branch_code=args.get("branch_code").strip(),
            swift_code=(args.get("swift_code") or "").strip() or None,
        )
        result = await employee_service.update_employee_banking(
            user, employee.get("employee_id") or str(employee.get("_id")), payload
        )
        return ToolResult(ok=True, data={"message": "Banking details updated.", "employee": result})
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


# ── HR message tools (recruiter) ──────────────────────────────────────────


async def _tool_close_hr_thread_recruiter(user: CurrentUser, args: dict) -> ToolResult:
    """Close an HR message thread by thread_id (recruiter-side)."""
    thread_id = (args.get("thread_id") or args.get("id") or "").strip()
    if not thread_id:
        return ToolResult(ok=False, error="thread_id is required.")
    try:
        result = await message_service.close_thread(user, thread_id)
        return ToolResult(ok=True, data={"message": "Conversation closed.", "thread": result.get("thread")})
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


# ── Organization framework tools (org_config) ─────────────────────────────


def _org_id(user: CurrentUser) -> str:
    if not user.organization_id:
        raise ValueError("No organization bound to your account.")
    return user.organization_id


async def _tool_create_department(user: CurrentUser, args: dict) -> ToolResult:
    """Create a department in the organization framework."""
    from app.services.organization_framework_service import create_department

    name = (args.get("name") or "").strip()
    if not name:
        return ToolResult(ok=False, error="Department name is required.")
    try:
        result = await create_department(_org_id(user), {"name": name, "description": (args.get("description") or "")})
        return ToolResult(ok=True, data={"message": f"Department '{name}' created.", "department": result})
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_delete_department(user: CurrentUser, args: dict) -> ToolResult:
    """Delete a department from the organization framework (requires confirm=true)."""
    from app.services.organization_framework_service import delete_department

    name = (args.get("name") or "").strip()
    if not name:
        return ToolResult(ok=False, error="Department name is required.")
    if not args.get("confirm"):
        return confirm_gate("delete_department", args, f"Permanently delete department '{name}'?")
    try:
        ok = await delete_department(_org_id(user), name)
        if not ok:
            return ToolResult(ok=False, error="Department not found.")
        return ToolResult(ok=True, data={"message": f"Department '{name}' deleted."})
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_create_org_role(user: CurrentUser, args: dict) -> ToolResult:
    """Create a career role in a department of the organization framework."""
    from app.services.organization_framework_service import create_role

    name = (args.get("name") or "").strip()
    department = (args.get("department") or "").strip()
    if not name or not department:
        return ToolResult(ok=False, error="Role name and department are required.")
    try:
        payload = {"name": name, "department": department}
        if (args.get("level_number") or 1) is not None:
            payload["level_number"] = int(float(str(args.get("level_number") or 1)))
        if args.get("next_role"):
            payload["next_role"] = (args.get("next_role") or "").strip()
        if args.get("description"):
            payload["description"] = (args.get("description") or "").strip()
        result = await create_role(_org_id(user), payload)
        return ToolResult(ok=True, data={"message": f"Role '{name}' created in {department}.", "role": result})
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_delete_org_role(user: CurrentUser, args: dict) -> ToolResult:
    """Delete a career role from the organization framework (requires confirm=true)."""
    from app.services.organization_framework_service import delete_role

    role_id = (args.get("role_id") or args.get("id") or "").strip()
    if not role_id:
        return ToolResult(ok=False, error="role_id is required.")
    if not args.get("confirm"):
        return confirm_gate("delete_org_role", args, f"Permanently delete role {role_id}?")
    try:
        ok = await delete_role(_org_id(user), role_id)
        if not ok:
            return ToolResult(ok=False, error="Role not found.")
        return ToolResult(ok=True, data={"message": f"Role {role_id} deleted."})
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_create_career_track(user: CurrentUser, args: dict) -> ToolResult:
    """Create a career track within a department."""
    department = (args.get("department") or "").strip()
    track_name = (args.get("track_name") or args.get("name") or "").strip()
    if not department or not track_name:
        return ToolResult(ok=False, error="department and track_name are required.")
    try:
        result = await career_framework_service.create_track(
            user,
            department=department,
            track_name=track_name,
            description=(args.get("description") or None),
            organization_id=_org_id(user),
        )
        return ToolResult(ok=True, data={"message": f"Career track '{track_name}' created.", "track": result})
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


# ── Profile photo tools ───────────────────────────────────────────────────


async def _tool_remove_recruiter_photo(user: CurrentUser, args: dict) -> ToolResult:
    """Remove the signed-in recruiter's profile photo."""
    try:
        result = await dashboard_service.remove_recruiter_photo(user)
        return ToolResult(ok=True, data={"message": "Profile photo removed.", **result})
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


# ── Managed learning course tools ─────────────────────────────────────────


async def _tool_create_managed_course(user: CurrentUser, args: dict) -> ToolResult:
    """Create a manual managed-learning course in the catalog."""
    title = (args.get("title") or "").strip()
    if not title:
        return ToolResult(ok=False, error="Course title is required.")
    try:
        payload = ManagedLearningCourseCreateRequest(
            title=title,
            url=(args.get("url") or None),
            provider=(args.get("provider") or "Managed Learning"),
            designation=(args.get("designation") or ""),
            learning_month=(args.get("learning_month") or ""),
            category=(args.get("category") or ""),
            competency=(args.get("competency") or ""),
            description=(args.get("description") or None),
            duration_minutes=int(args["duration_minutes"]) if args.get("duration_minutes") else None,
        )
        result = await managed_learning_service.create_course(user, payload)
        return ToolResult(ok=True, data={"message": "Course created.", "course": result.get("course")})
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_delete_managed_course(user: CurrentUser, args: dict) -> ToolResult:
    """Delete a managed-learning course (requires confirm=true)."""
    course_id = (args.get("course_id") or args.get("id") or "").strip()
    if not course_id:
        return ToolResult(ok=False, error="course_id is required.")
    if not args.get("confirm"):
        return confirm_gate("delete_managed_course", args, f"Permanently delete course {course_id}?")
    try:
        result = await managed_learning_service.delete_course(user, course_id)
        return ToolResult(ok=True, data={"message": "Course deleted.", **result})
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


RECRUITER_PARITY_TOOLS: list[Tool] = [
    Tool(
        name="remind_candidate",
        description=(
            "Send a reminder to a candidate via email + in-app notification. "
            "kind=onboarding|reupload|general. Include note when helpful."
        ),
        parameters={
            "email": "string, preferred",
            "name": "string, optional",
            "kind": "onboarding|reupload|general, default onboarding",
            "note": "string, optional (required for general)",
            "force": "boolean, optional — resend within an hour",
        },
        handler=_tool_remind_candidate,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="bulk_remind_candidates",
        description="Remind all (or listed) candidates still in onboarding to finish intake.",
        parameters={"emails": "optional array", "note": "optional", "force": "boolean, optional"},
        handler=_tool_bulk_remind_candidates,
        roles=("recruiter", "super_admin"),
    ),
    # IT provisioning (pre-activation company email + assets)
    Tool(
        name="send_it_provisioning",
        description=(
            "Email the IT manager a secure form link so IT can provision a signed candidate's company "
            "email and assets before activation. Resolve the person by email/name or pass offer_id. "
            "Optional it_manager_email overrides the default IT inbox; note is included in the email. "
            "If a request is already pending, the tool returns an error — prefer remind_it_provisioning, "
            "or pass resend=true to email IT a fresh request. Never invent an it_manager_email."
        ),
        parameters={
            "email": "string, optional",
            "name": "string, optional",
            "offer_id": "string, optional",
            "it_manager_email": "string, optional",
            "note": "string, optional",
            "resend": "boolean, optional — resend a fresh email when a request is already pending",
        },
        handler=_tool_send_it_provisioning,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="remind_it_provisioning",
        description=(
            "Send a follow-up email to IT for an already-sent provisioning request that is still "
            "pending. Resolve the person by email/name or pass offer_id."
        ),
        parameters={
            "email": "string, optional",
            "name": "string, optional",
            "offer_id": "string, optional",
            "note": "string, optional",
        },
        handler=_tool_remind_it_provisioning,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="bulk_send_it_provisioning",
        description=(
            "Send IT provisioning requests for many signed candidates at once. Only emails candidates "
            "who have never been sent one — anyone already pending is reported as skipped. Defaults "
            "to every ready-to-activate candidate; narrow with emails[] or offer_ids[]. "
            "Modes: batch_form=true sends IT ONE bulk form link covering everyone (IT assigns emails, "
            "passwords, assets, and licenses for all of them in a single form — best when they need "
            "the same resources); batch_email=true sends ONE roster email with each person's own link; "
            "otherwise one email per candidate. Requires confirmation (call without confirm first so "
            "Approve/Cancel appears). Optional shared it_manager_email and note. "
            "Never invent an it_manager_email."
        ),
        parameters={
            "emails": "optional array",
            "offer_ids": "optional array",
            "it_manager_email": "string, optional",
            "note": "string, optional",
            "batch_email": "boolean, optional — one roster email to IT instead of one email per candidate",
            "batch_form": "boolean, optional — ONE bulk form link where IT provisions everyone at once",
            "confirm": "boolean, required for the action to run",
        },
        handler=_tool_bulk_send_it_provisioning,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="bulk_remind_it_provisioning",
        description=(
            "Send follow-up emails to IT for all (or listed) pending provisioning requests that "
            "are still awaiting submission. Requires confirmation (call without confirm first so "
            "Approve/Cancel appears)."
        ),
        parameters={
            "emails": "optional array",
            "offer_ids": "optional array",
            "note": "string, optional",
            "confirm": "boolean, required for the action to run",
        },
        handler=_tool_bulk_remind_it_provisioning,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="list_it_kits",
        description=(
            "List the reusable IT kits (standard asset + software license setups) available for "
            "provisioning new hires. Use these when IT needs a standard setup."
        ),
        parameters={},
        handler=_tool_list_it_kits,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="create_it_kit",
        description=(
            "Create a reusable IT kit: name, optional description, assets (each with name, "
            "asset_type laptop|monitor|phone|headset|badge|license|other, optional serial_number "
            "and notes), licenses (name, vendor, notes), and optional applicable roles. "
            "At least one asset or license is required."
        ),
        parameters={
            "name": "string, required",
            "description": "string, optional",
            "assets": "optional array of {name, asset_type, serial_number?, notes?}",
            "licenses": "optional array of {name, vendor?, notes?}",
            "roles": "optional array of role titles",
            "is_default": "boolean, optional",
        },
        handler=_tool_create_it_kit,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="update_it_kit",
        description="Edit an existing IT kit (name, description, assets, licenses, roles).",
        parameters={
            "kit_id": "string, required",
            "name": "optional",
            "description": "optional",
            "assets": "optional array",
            "licenses": "optional array",
            "roles": "optional array",
            "is_default": "boolean, optional",
        },
        handler=_tool_update_it_kit,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="delete_it_kit",
        description="Delete an IT kit template. Requires confirmation (call without confirm first).",
        parameters={
            "kit_id": "string, required",
            "name": "string, optional (for the confirm message)",
            "confirm": "boolean, required for the action to run",
        },
        handler=_tool_delete_it_kit,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="list_it_officers",
        description=(
            "Show every IT officer this recruiter has worked with, their workload (pending/submitted "
            "provisioning, open/fulfilled service requests), and the employees each one provisioned."
        ),
        parameters={},
        handler=_tool_list_it_officers,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="list_it_service_requests",
        description=(
            "List IT service requests (post-activation help like replacement laptops). "
            "Filter by status: draft|reviewing|sent|fulfilled|closed|cancelled."
        ),
        parameters={"status": "string, optional: draft|reviewing|sent|fulfilled|closed|cancelled"},
        handler=_tool_list_it_service_requests,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="create_it_service_request",
        description=(
            "Raise an IT help request for an existing employee (e.g. 'new laptop — current one broke'). "
            "Provide employee_id (EMP...), request_type new_asset|replacement|license|access|other, title, "
            "optional description, and an it_manager_email to send it immediately (otherwise it stays a "
            "draft until sent with send_it_service_request). Never invent an it_manager_email."
        ),
        parameters={
            "employee_id": "string, required (e.g. EMP-0001)",
            "request_type": "new_asset|replacement|license|access|other",
            "title": "string, required",
            "description": "string, optional",
            "it_manager_email": "string, optional",
            "note": "string, optional",
        },
        handler=_tool_create_it_service_request,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="send_it_service_request",
        description=(
            "Send a draft IT service request to an IT officer by email (they fulfill it from a link). "
            "Requires confirmation (call without confirm first so Approve/Cancel appears)."
        ),
        parameters={
            "request_id": "string, required",
            "it_manager_email": "string, required",
            "note": "string, optional",
            "title": "string, optional (for the confirm message)",
            "confirm": "boolean, required for the action to run",
        },
        handler=_tool_send_it_service_request,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="cancel_it_service_request",
        description=(
            "Cancel an IT service request that is still a draft or in progress. "
            "Requires confirmation (call without confirm first)."
        ),
        parameters={
            "request_id": "string, required",
            "reason": "string, optional",
            "title": "string, optional (for the confirm message)",
            "confirm": "boolean, required for the action to run",
        },
        handler=_tool_cancel_it_service_request,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="get_dashboard_summary",
        description="Recruiter overview KPIs: pipeline counts, upcoming joinings, and related summary stats.",
        parameters={},
        handler=_tool_get_dashboard_summary,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="update_announcement",
        description="Edit an existing announcement; optionally re-notify and/or re-email the audience.",
        parameters={
            "announcement_id": "string, required",
            "title": "optional",
            "body": "optional",
            "audience": "optional",
            "send_email": "boolean, default false",
            "notify_again": "boolean, default false",
        },
        handler=_tool_update_announcement,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="delete_announcement",
        description="Delete an announcement. Requires confirm=true after explicit recruiter approval.",
        parameters={"announcement_id": "string, required", "confirm": "boolean, required true"},
        handler=_tool_delete_announcement,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="update_employee_role",
        description="Change an employee's designation (job_title) and department via a career event.",
        parameters={
            "email": "optional",
            "employee_id": "optional",
            "name": "optional",
            "job_title": "string, required",
            "department": "string, required",
            "event_type": "promoted|title_change|department_change",
            "effective_date": "YYYY-MM-DD optional",
            "note": "optional",
        },
        handler=_tool_update_employee_role,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="get_recruiter_profile",
        description="Fetch the signed-in recruiter's own profile.",
        parameters={},
        handler=_tool_get_recruiter_profile,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="update_recruiter_profile",
        description="Update the signed-in recruiter's name, phone, title, department, or office.",
        parameters={
            "full_name": "optional",
            "phone": "optional",
            "job_title": "optional",
            "department": "optional",
            "office_location": "optional",
        },
        handler=_tool_update_recruiter_profile,
        roles=("recruiter", "super_admin"),
    ),
    # Learning
    Tool(
        name="browse_learning_catalog",
        description="Search/browse the learning catalog (microsoft_learn, coursera, or managed providers).",
        parameters={
            "q": "optional search",
            "source": "microsoft_learn|coursera",
            "type": "optional",
            "level": "optional",
            "role": "optional",
            "category": "optional (coursera)",
            "page": "optional",
        },
        handler=_tool_browse_catalog,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="assign_courses",
        description="Assign a course to employees by ids and/or department and/or joining role and/or skills.",
        parameters={
            "course_uid": "required",
            "course_title": "required",
            "course_url": "required",
            "employee_ids": "optional array",
            "department": "optional",
            "job_title": "optional joining role",
            "required_skills": "optional array",
            "due_date": "optional YYYY-MM-DD",
            "mandatory": "boolean",
            "note": "optional",
        },
        handler=_tool_assign_courses,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="list_learning_assignments",
        description="Track course assignment progress across employees.",
        parameters={"employee_id": "optional", "status": "optional", "mandatory": "optional bool"},
        handler=_tool_list_assignments,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="list_pending_certificates",
        description="List employee-uploaded certificates awaiting recruiter verification (includes file_url / certificate_url to open).",
        parameters={},
        handler=_tool_list_pending_certificates,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="verify_certificate",
        description="Approve or reject an employee learning certificate.",
        parameters={"certificate_id": "required", "approve": "boolean required", "note": "optional"},
        handler=_tool_verify_certificate,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="learning_analytics",
        description="Recruiter learning analytics summary (optionally by department).",
        parameters={"department": "optional"},
        handler=_tool_learning_analytics,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="get_employee_learning_profile",
        description="Learning profile and AI course recommendations for one employee.",
        parameters={"email": "optional", "employee_id": "optional", "name": "optional", "refresh": "bool"},
        handler=_tool_employee_learning_profile,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="kb_list_roles",
        description="Removed — recruiter Knowledge Base no longer exists. Role ladders now live in Organization Setup.",
        parameters={},
        handler=_tool_kb_list_roles,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="kb_create_role",
        description="Removed — recruiter Knowledge Base no longer exists. Use Organization Setup → Role ladders.",
        parameters={},
        handler=_tool_kb_create_role,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="kb_delete_role",
        description="Removed — recruiter Knowledge Base no longer exists.",
        parameters={},
        handler=_tool_kb_delete_role,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="kb_list_certifications",
        description="Removed — recruiter Knowledge Base no longer exists. Use the managed course catalog instead.",
        parameters={},
        handler=_tool_kb_list_certs,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="kb_create_certification",
        description="Removed — recruiter Knowledge Base no longer exists. Use the managed course catalog instead.",
        parameters={},
        handler=_tool_kb_create_cert,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="kb_delete_certification",
        description="Removed — recruiter Knowledge Base no longer exists.",
        parameters={},
        handler=_tool_kb_delete_cert,
        roles=("recruiter", "super_admin"),
    ),
    # Talent
    Tool(
        name="talent_metrics",
        description="Org talent metrics dashboard (skill distribution, high potential, etc.).",
        parameters={"department": "optional"},
        handler=_tool_talent_metrics,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="search_talent",
        description="Search employees by skills, certs, department, progress, competency; optional semantic search.",
        parameters={
            "q": "optional",
            "skills": "optional array",
            "certifications": "optional array",
            "department": "optional",
            "min_learning_progress": "optional",
            "min_competency_score": "optional",
            "semantic": "boolean",
        },
        handler=_tool_search_talent,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="list_opportunities",
        description="List internal opportunities.",
        parameters={"q": "optional", "type": "optional", "department": "optional", "status": "open|closed"},
        handler=_tool_list_opportunities,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="create_opportunity",
        description="Post an internal opportunity.",
        parameters={
            "title": "required",
            "type": "internal_project|cross_functional|temporary_assignment|open_position",
            "department": "required",
            "description": "required",
            "required_skills": "optional",
            "location": "optional",
            "commitment": "optional",
        },
        handler=_tool_create_opportunity,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="update_opportunity",
        description="Update or close/reopen an internal opportunity (set status open|closed).",
        parameters={"opportunity_id": "required", "status": "optional", "title": "optional", "description": "optional"},
        handler=_tool_update_opportunity,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="list_opportunity_applicants",
        description="List applicants for an internal opportunity.",
        parameters={"opportunity_id": "required"},
        handler=_tool_list_applicants,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="submit_competency_evaluation",
        description="Submit a 1–5 competency evaluation for an employee across six dimensions.",
        parameters={
            "email": "optional",
            "employee_id": "optional",
            "technical": "1-5",
            "leadership": "1-5",
            "communication": "1-5",
            "collaboration": "1-5",
            "problem_solving": "1-5",
            "innovation": "1-5",
            "comments": "optional",
        },
        handler=_tool_submit_competency,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="update_development_plan",
        description="Update an employee's development plan milestones / timeline / note.",
        parameters={
            "email": "optional",
            "employee_id": "optional",
            "target_timeline": "optional",
            "milestones": "optional array of {id, status, due_date, note}",
            "recruiter_note": "optional",
        },
        handler=_tool_update_development_plan,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="get_talent_profile",
        description="Aggregated 360 talent profile for an employee.",
        parameters={"email": "optional", "employee_id": "optional", "name": "optional"},
        handler=_tool_get_talent_profile,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="send_reminder",
        description=(
            "Send a typed reminder (email + notification) to an employee or candidate. "
            "Employee kinds: profile|reupload|course|general. Candidate kinds: onboarding|reupload|general."
        ),
        parameters={
            "target_role": "employee|candidate, default employee",
            "email": "optional",
            "employee_id": "optional",
            "name": "optional",
            "kind": "string, required for clarity",
            "note": "optional note (required for general)",
            "force": "boolean optional",
        },
        handler=_tool_send_reminder,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="list_hr_threads",
        description="List HR ↔ employee message threads for the signed-in recruiter.",
        parameters={},
        handler=_tool_list_hr_threads,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="message_employee",
        description="Start or continue an HR message thread with an employee (email + notification).",
        parameters={
            "employee_id": "preferred",
            "email": "optional alternative to locate the employee",
            "body": "required",
            "subject": "optional for a new thread",
        },
        handler=_tool_message_employee,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="reply_hr_thread",
        description="Reply to an HR message thread by thread_id.",
        parameters={"thread_id": "required", "body": "required"},
        handler=_tool_reply_hr_thread,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="close_hr_thread",
        description="Close an HR message thread by thread_id.",
        parameters={"thread_id": "required"},
        handler=_tool_close_hr_thread_recruiter,
        roles=("recruiter", "super_admin"),
    ),
    # ── Support ticket tools (recruiter) ────────────────────────────────
    Tool(
        name="list_my_support_tickets",
        description=(
            "List your own support tickets with optional filters "
            "(status, priority, category, search). Returns tickets with subject, "
            "status, priority, category, and created/updated dates."
        ),
        parameters={
            "status": "string, optional: open|in_progress|waiting|resolved|closed",
            "priority": "string, optional: low|medium|high|critical",
            "category": "string, optional",
            "search": "string, optional",
            "page": "integer, optional, default 1",
            "page_size": "integer, optional, max 50",
        },
        handler=_tool_list_my_support_tickets,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="my_ticket_stats",
        description="Get your own support ticket stats: total, open, resolved, closed, by priority.",
        parameters={},
        handler=_tool_my_ticket_stats,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="view_support_ticket",
        description="View a single support ticket with its full conversation thread.",
        parameters={
            "ticket_id": "string, required — the ticket ID (e.g. TKT-0001)",
        },
        handler=_tool_view_support_ticket,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="reply_support_ticket",
        description="Reply to an existing support ticket.",
        parameters={
            "ticket_id": "string, required",
            "message": "string, required — your reply message",
        },
        handler=_tool_reply_support_ticket,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="close_support_ticket",
        description="Close one of your support tickets.",
        parameters={
            "ticket_id": "string, required",
        },
        handler=_tool_close_support_ticket,
        roles=("recruiter", "super_admin"),
    ),
    # ── Employee banking ─────────────────────────────────────────────────
    Tool(
        name="update_employee_banking",
        description=(
            "Update an employee's payroll banking details. Required: bank_name, "
            "account_holder_name, account_number, iban, branch, branch_code. "
            "Optional: swift_code."
        ),
        parameters={
            "employee_id": "string, preferred",
            "email": "string, optional alternative to locate the employee",
            "bank_name": "string, required",
            "account_holder_name": "string, required",
            "account_number": "string, required",
            "iban": "string, required (PK format)",
            "branch": "string, required",
            "branch_code": "string, required",
            "swift_code": "string, optional",
        },
        handler=_tool_update_employee_banking,
        roles=("recruiter", "super_admin"),
    ),
    # ── Organization framework (org_config) ─────────────────────────────
    Tool(
        name="create_department",
        description="Create a department in the organization framework.",
        parameters={
            "name": "string, required",
            "description": "string, optional",
        },
        handler=_tool_create_department,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="delete_department",
        description="Delete a department from the organization framework. Requires confirm=true.",
        parameters={
            "name": "string, required",
            "confirm": "boolean, set true to proceed",
        },
        handler=_tool_delete_department,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="create_org_role",
        description="Create a career role within a department of the organization framework.",
        parameters={
            "name": "string, required",
            "department": "string, required",
            "level_number": "integer, optional, default 1",
            "next_role": "string, optional",
            "description": "string, optional",
        },
        handler=_tool_create_org_role,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="delete_org_role",
        description="Delete a career role from the organization framework. Requires confirm=true.",
        parameters={
            "role_id": "string, required",
            "confirm": "boolean, set true to proceed",
        },
        handler=_tool_delete_org_role,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="create_career_track",
        description="Create a career track within a department.",
        parameters={
            "department": "string, required",
            "track_name": "string, required — e.g. 'Software Engineering'",
            "description": "string, optional",
        },
        handler=_tool_create_career_track,
        roles=("recruiter", "super_admin"),
    ),
    # ── Profile photo ────────────────────────────────────────────────────
    Tool(
        name="remove_recruiter_photo",
        description="Remove the signed-in recruiter's profile photo.",
        parameters={},
        handler=_tool_remove_recruiter_photo,
        roles=("recruiter", "super_admin"),
    ),
    # ── Managed learning courses ─────────────────────────────────────────
    Tool(
        name="create_managed_course",
        description=(
            "Create a manual managed-learning course in the catalog. "
            "Required: title. Optional: url, provider, designation, learning_month, "
            "category, competency, description, duration_minutes."
        ),
        parameters={
            "title": "string, required",
            "url": "string, optional",
            "provider": "string, optional",
            "designation": "string, optional",
            "learning_month": "string, optional",
            "category": "string, optional",
            "competency": "string, optional",
            "description": "string, optional",
            "duration_minutes": "integer, optional",
        },
        handler=_tool_create_managed_course,
        roles=("recruiter", "super_admin"),
    ),
    Tool(
        name="delete_managed_course",
        description="Delete a managed-learning course. Requires confirm=true.",
        parameters={
            "course_id": "string, required",
            "confirm": "boolean, set true to proceed",
        },
        handler=_tool_delete_managed_course,
        roles=("recruiter", "super_admin"),
    ),
]




# ─────────────────────────────────────────────────────────────────────────
# Employee-only tools: Day-1 info, close HR thread, role matches
# ─────────────────────────────────────────────────────────────────────────


async def _tool_get_my_day1_info(user: CurrentUser, args: dict) -> ToolResult:
    """Return the employee's assigned assets and scheduled orientation from their profile.

    Reuses employee_service.get_my_profile — no new DB queries needed.
    """
    try:
        result = await employee_service.get_my_profile(user)
        emp = result.get("employee") or {}
        assets = emp.get("assets") or []
        orientation = emp.get("orientation")
        company_email = emp.get("company_email")
        return ToolResult(
            ok=True,
            data={
                "company_email": company_email,
                "assets": [
                    {
                        "asset_id": a.get("id") or a.get("asset_id"),
                        "name": a.get("name"),
                        "asset_type": a.get("asset_type"),
                        "serial_number": a.get("serial_number"),
                        "status": a.get("status"),
                        "assigned_at": a.get("assigned_at"),
                    }
                    for a in assets
                ],
                "orientation": orientation,
                "has_assets": len(assets) > 0,
                "has_orientation": orientation is not None,
            },
        )
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_close_hr_thread(user: CurrentUser, args: dict) -> ToolResult:
    """Close an HR message thread by thread_id. Reuses message_service.close_thread."""
    thread_id = (args.get("thread_id") or "").strip()
    if not thread_id:
        return ToolResult(ok=False, error="thread_id is required.")
    if not args.get("confirm"):
        return confirm_gate(
            "close_hr_thread",
            {"thread_id": thread_id},
            f"Close HR thread {thread_id}?",
        )
    try:
        from app.services.message_service import message_service

        result = await message_service.close_thread(user, thread_id)
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


async def _tool_get_role_matches(user: CurrentUser, args: dict) -> ToolResult:
    """Match employee profile against recruiter KB roles. Reuses learning_service.get_role_matches."""
    try:
        result = await learning_service.get_role_matches(user, refresh=bool(args.get("refresh")))
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


SHARED_SELF_DOCUMENT_TOOLS: list[Tool] = [
    Tool(
        name="get_my_document_link",
        description="Get a time-limited signed download URL for one of the caller's documents (by id or doc_type).",
        parameters={"document_id": "optional", "doc_type": "optional e.g. cnic|resume|transcript"},
        handler=_tool_get_my_document_link,
        roles=("candidate", "employee"),
    ),
    Tool(
        name="delete_document",
        description="Delete one of the caller's uploaded documents. Requires confirm=true.",
        parameters={"document_id": "required", "confirm": "boolean required"},
        handler=_tool_delete_my_document,
        roles=("candidate", "employee"),
    ),
    Tool(
        name="reextract_document",
        description="Re-run OCR extraction on an uploaded document (typically CNIC).",
        parameters={"document_id": "required"},
        handler=_tool_reextract_document,
        roles=("candidate", "employee"),
    ),
    Tool(
        name="list_my_announcements",
        description="List announcements visible to the caller.",
        parameters={"limit": "optional"},
        handler=_tool_list_my_announcements,
        roles=("candidate", "employee"),
    ),
    Tool(
        name="list_notifications",
        description="List the caller's in-app notifications.",
        parameters={"limit": "optional"},
        handler=_tool_list_notifications,
        roles=("candidate", "employee"),
    ),
    Tool(
        name="mark_notifications_read",
        description="Mark notifications read by ids, or all=true.",
        parameters={"ids": "optional array", "all": "boolean"},
        handler=_tool_mark_notifications_read,
        roles=("candidate", "employee"),
    ),
]


async def _tool_update_my_profile(user: CurrentUser, args: dict) -> ToolResult:
    """Persist individual personal-info fields into the candidate's profile.

    Uses CandidateService.partial_update_personal which merges only the supplied
    fields without requiring a signed offer or government ID co-field.  This is
    the right call whenever the candidate provides isolated facts (name, gender,
    city, …) during conversation — use save_step only when *all* required fields
    for a complete step are available.
    """
    from app.services.candidate_service import CandidateService

    personal_fields = {
        k: v
        for k, v in args.items()
        if k
        not in ("step", "confirm")  # strip meta-keys the LLM might accidentally send
        and v not in (None, "")
    }
    if not personal_fields:
        return ToolResult(ok=False, error="Provide at least one personal field to update (e.g. first_name, gender).")
    try:
        svc = CandidateService()
        result = await svc.partial_update_personal(user, personal_fields)
        return ToolResult(ok=True, data=result)
    except Exception as exc:  # noqa: BLE001
        return _err(exc)


CANDIDATE_PARITY_TOOLS: list[Tool] = [
    *SHARED_SELF_DOCUMENT_TOOLS,
    Tool(
        name="update_my_profile",
        description=(
            "Persist one or more personal-info fields the candidate just provided "
            "(first_name, last_name, date_of_birth YYYY-MM-DD, gender, nationality, "
            "marital_status, blood_group, father_name, alternate_phone, current_address, "
            "permanent_address, same_as_current, city, state, postal_code, country). "
            "Use this whenever the candidate tells you individual facts about themselves — "
            "it merges only the supplied fields. Requires a signed offer letter first; "
            "if unsigned, tell them to sign before updating profile fields. "
            "Use save_step only when ALL required fields for a complete step are available."
        ),
        parameters={
            "first_name": "string, optional",
            "last_name": "string, optional",
            "date_of_birth": "string YYYY-MM-DD, optional",
            "gender": "male|female|other|prefer_not_to_say, optional",
            "nationality": "string, optional",
            "marital_status": "single|married|divorced|widowed|other, optional",
            "blood_group": "A+|A-|B+|B-|AB+|AB-|O+|O-, optional",
            "father_name": "string, optional",
            "alternate_phone": "string, optional",
            "current_address": "string, optional",
            "permanent_address": "string, optional",
            "same_as_current": "boolean, optional",
            "city": "string, optional",
            "state": "string, optional",
            "postal_code": "string, optional",
            "country": "string, optional",
        },
        handler=_tool_update_my_profile,
        roles=("candidate",),
    ),
    Tool(
        name="list_hr_threads",
        description="List the candidate's conversations with HR/recruiter.",
        parameters={},
        handler=_tool_list_hr_threads,
        roles=("candidate",),
    ),
    Tool(
        name="get_my_offer",
        description=(
            "Fetch the candidate's current offer letter and status. "
            "Response includes is_signed, status, offer_page (/offer), and guidance — "
            "if is_signed=true do not ask them to sign again."
        ),
        parameters={},
        handler=_tool_get_my_offer,
        roles=("candidate",),
    ),
    Tool(
        name="message_recruiter",
        description="Send a message to the assigned recruiter/HR (starts or continues a thread).",
        parameters={"body": "required", "subject": "optional for new thread", "thread_id": "optional to reply"},
        handler=_tool_message_recruiter,
        roles=("candidate",),
    ),
    Tool(
        name="sign_offer",
        description=(
            "Digitally sign the candidate's offer. Requires agreed=true and full_legal_name. "
            "Only call after the candidate clearly confirms they accept the terms AND get_my_offer "
            "shows is_signed=false. Typed full_legal_name is enough — no signature pad is required. "
            "If already signed, the tool returns already_signed=true (do not keep asking)."
        ),
        parameters={
            "agreed": "boolean, must be true",
            "full_legal_name": "string, required",
            "offer_id": "optional if only one offer",
        },
        handler=_tool_sign_offer,
        roles=("candidate",),
    ),
    Tool(
        name="decline_offer",
        description="Decline the candidate's offer. Requires confirm=true. Optional reason.",
        parameters={"confirm": "boolean required", "reason": "optional", "offer_id": "optional"},
        handler=_tool_decline_offer,
        roles=("candidate",),
    ),
    Tool(
        name="reply_hr_thread",
        description="Reply in an existing HR conversation by thread_id.",
        parameters={"thread_id": "required", "body": "required"},
        handler=_tool_reply_hr_thread,
        roles=("candidate",),
    ),
]


EMPLOYEE_PARITY_TOOLS: list[Tool] = [
    *SHARED_SELF_DOCUMENT_TOOLS,
    Tool(
        name="get_my_profile",
        description="Fetch the signed-in employee's full profile record.",
        parameters={},
        handler=_tool_get_my_profile,
        roles=("employee",),
    ),
    Tool(
        name="browse_learning_catalog",
        description="Search/browse learning catalog for the employee.",
        parameters={
            "q": "optional",
            "source": "microsoft_learn|coursera",
            "type": "optional",
            "level": "optional",
            "bookmarked_only": "bool",
            "page": "optional",
        },
        handler=_tool_browse_catalog,
        roles=("employee",),
    ),
    Tool(
        name="my_learning_dashboard",
        description="Employee learning overview: assigned courses, progress, recommendations summary.",
        parameters={},
        handler=_tool_my_learning_dashboard,
        roles=("employee",),
    ),
    Tool(
        name="my_courses",
        description="List the employee's enrollments; optional status filter.",
        parameters={"status": "optional assigned|in_progress|completed"},
        handler=_tool_my_courses,
        roles=("employee",),
    ),
    Tool(
        name="start_course",
        description="Start/enroll in a catalog course and return the provider URL.",
        parameters={"course_uid": "required"},
        handler=_tool_start_course,
        roles=("employee",),
    ),
    Tool(
        name="update_course_progress",
        description="Update self-reported progress percent on a started course.",
        parameters={"course_uid": "required", "progress_percent": "0-100", "status": "optional"},
        handler=_tool_update_course_progress,
        roles=("employee",),
    ),
    Tool(
        name="list_bookmarks",
        description="List bookmarked courses.",
        parameters={},
        handler=_tool_list_bookmarks,
        roles=("employee",),
    ),
    Tool(
        name="add_bookmark",
        description="Bookmark a course.",
        parameters={"course_uid": "required", "course_title": "required", "course_url": "required"},
        handler=_tool_add_bookmark,
        roles=("employee",),
    ),
    Tool(
        name="remove_bookmark",
        description="Remove a course bookmark.",
        parameters={"course_uid": "required"},
        handler=_tool_remove_bookmark,
        roles=("employee",),
    ),
    Tool(
        name="list_skills",
        description="List the employee's skill matrix entries.",
        parameters={},
        handler=_tool_list_skills,
        roles=("employee",),
    ),
    Tool(
        name="upsert_skill",
        description="Add or update a skill on the employee's profile.",
        parameters={
            "skill_name": "required",
            "category": "optional",
            "proficiency": "Beginner|Intermediate|Advanced|Expert",
            "years_experience": "optional",
        },
        handler=_tool_upsert_skill,
        roles=("employee",),
    ),
    Tool(
        name="delete_skill",
        description="Delete a skill. Requires confirm=true.",
        parameters={"skill_id": "required", "confirm": "boolean"},
        handler=_tool_delete_skill,
        roles=("employee",),
    ),
    Tool(
        name="assess_skills",
        description="Run or refresh AI skill assessment for the employee.",
        parameters={"refresh": "bool", "lazy": "bool"},
        handler=_tool_assess_skills,
        roles=("employee",),
    ),
    Tool(
        name="get_career_goal",
        description="Get the employee's saved career goal.",
        parameters={},
        handler=_tool_get_career_goal,
        roles=("employee",),
    ),
    Tool(
        name="set_career_goal",
        description="Set the employee's target career role for path/gap guidance.",
        parameters={"target_role": "required"},
        handler=_tool_set_career_goal,
        roles=("employee",),
    ),
    Tool(
        name="get_skill_gap",
        description="Skill-gap analysis vs career goal.",
        parameters={"refresh": "bool"},
        handler=_tool_skill_gap,
        roles=("employee",),
    ),
    Tool(
        name="get_career_path",
        description="AI learning path toward the career goal.",
        parameters={"refresh": "bool"},
        handler=_tool_career_path,
        roles=("employee",),
    ),
    Tool(
        name="get_learning_recommendations",
        description="Personalized course recommendations.",
        parameters={"refresh": "bool"},
        handler=_tool_learning_recommendations,
        roles=("employee",),
    ),
    Tool(
        name="list_my_certificates",
        description="List certificates the employee has uploaded (includes file_url for viewing).",
        parameters={},
        handler=_tool_list_my_certificates,
        roles=("employee",),
    ),
    Tool(
        name="update_certificate",
        description="Edit metadata on an unverified certificate.",
        parameters={
            "certificate_id": "required",
            "course_title": "optional",
            "completion_date": "optional",
            "learning_hours": "optional",
        },
        handler=_tool_update_certificate,
        roles=("employee",),
    ),
    Tool(
        name="delete_certificate",
        description="Delete a certificate upload. Requires confirm=true.",
        parameters={"certificate_id": "required", "confirm": "boolean"},
        handler=_tool_delete_certificate,
        roles=("employee",),
    ),
    Tool(
        name="list_opportunities",
        description="Browse open internal opportunities.",
        parameters={"q": "optional", "type": "optional", "department": "optional"},
        handler=_tool_list_opportunities,
        roles=("employee",),
    ),
    Tool(
        name="apply_to_opportunity",
        description="Apply to an internal opportunity. Requires confirm=true.",
        parameters={"opportunity_id": "required", "confirm": "boolean"},
        handler=_tool_apply_opportunity,
        roles=("employee",),
    ),
    Tool(
        name="my_talent_journey",
        description="Employee career/learning journey timeline.",
        parameters={"types": "optional comma list Career,Certifications,Courses,Skills"},
        handler=_tool_my_journey,
        roles=("employee",),
    ),
    Tool(
        name="my_achievements",
        description="Employee achievements grid.",
        parameters={},
        handler=_tool_my_achievements,
        roles=("employee",),
    ),
    Tool(
        name="my_career_progression",
        description="Career progression ladder for the employee.",
        parameters={},
        handler=_tool_my_career_progression,
        roles=("employee",),
    ),
    Tool(
        name="list_hr_threads",
        description="List the employee's conversations with HR/recruiter.",
        parameters={},
        handler=_tool_list_hr_threads,
        roles=("employee",),
    ),
    Tool(
        name="message_recruiter",
        description="Send a message to the assigned recruiter/HR (starts or continues a thread).",
        parameters={"body": "required", "subject": "optional for new thread", "thread_id": "optional to reply"},
        handler=_tool_message_recruiter,
        roles=("employee",),
    ),
    Tool(
        name="reply_hr_thread",
        description="Reply in an existing HR conversation by thread_id.",
        parameters={"thread_id": "required", "body": "required"},
        handler=_tool_reply_hr_thread,
        roles=("employee",),
    ),
    Tool(
        name="get_my_day1_info",
        description=(
            "Show the employee's Day-1 information: assigned company assets (laptop, phone, badge, etc.) "
            "and scheduled orientation details. Reuses data already on the employee profile."
        ),
        parameters={},
        handler=_tool_get_my_day1_info,
        roles=("employee",),
    ),
    Tool(
        name="close_hr_thread",
        description="Close (resolve) an HR message thread. Requires confirm=true.",
        parameters={"thread_id": "required", "confirm": "boolean required"},
        handler=_tool_close_hr_thread,
        roles=("employee",),
    ),
    Tool(
        name="get_role_matches",
        description=(
            "Compare the employee's skills and certifications against Organization Setup role ladders "
            "to see which roles they match and by how much. Optionally refresh=true to bypass cache."
        ),
        parameters={"refresh": "boolean, optional — force fresh calculation"},
        handler=_tool_get_role_matches,
        roles=("employee",),
    ),
    Tool(
        name="list_my_it_requests",
        description=(
            "Show all the employee's IT support requests — drafts waiting for HR, "
            "ones sent to IT, awaiting employee confirm (fulfilled), closed, and cancelled. "
            "Use this when the employee asks 'what happened to my laptop request' or "
            "'check my IT ticket status'."
        ),
        parameters={},
        handler=_tool_list_my_it_requests,
        roles=("employee",),
    ),
    Tool(
        name="create_my_it_request",
        description=(
            "Raise an IT help request on behalf of the employee. HR is notified immediately "
            "and will forward it to IT. Use this when the employee says things like "
            "'my laptop is not working', 'I need a new monitor', 'I don't have access to Jira', "
            "'can you get me a replacement keyboard', etc. "
            "request_type must be: new_asset | replacement | license | access | other. "
            "Always confirm the title back to the employee before submitting."
        ),
        parameters={
            "request_type": "new_asset | replacement | license | access | other",
            "title": "string, required — short description e.g. 'Laptop not turning on, need replacement'",
            "description": "string, optional — extra detail for HR and IT",
        },
        handler=_tool_create_my_it_request,
        roles=("employee",),
    ),
    Tool(
        name="close_my_it_request",
        description=(
            "Employee confirms IT resolved the issue and closes the ticket. "
            "Only works when status is fulfilled (IT marked resolved, awaiting employee). "
            "Use after list_my_it_requests when the employee says the fix worked / close my ticket. "
            "Confirm with the employee before calling."
        ),
        parameters={
            "request_id": "string, required — from list_my_it_requests",
        },
        handler=_tool_close_my_it_request,
        roles=("employee",),
    ),
]

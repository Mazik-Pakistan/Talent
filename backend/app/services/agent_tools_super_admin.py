"""Super Admin AI Agent tools — platform-level management tools.

These tools give the super admin AI assistant the ability to manage
recruiters, organizations, and platform-level operations through the
same permission-checked service layer used by the Super Admin dashboard.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from secrets import token_urlsafe

from bson import ObjectId

from app.core.config import settings
from app.core.database import database
from app.core.rbac import CurrentUser
from app.services.agent_tools import Tool, ToolResult, confirm_gate, _err
from app.services.email_service import email_service
from app.services.organization_service import (
    ORG_MODULE_KEYS,
    create_organization,
    delete_organization,
    get_organization,
    list_organizations,
    update_organization,
)
from app.services.ticket_service import ticket_service


async def _tool_get_super_admin_overview(user: CurrentUser, args: dict) -> ToolResult:
    """Platform overview matching the Super Admin dashboard stats."""
    try:
        total_recruiters = await database.recruiters.count_documents({})
        all_recruiters = await database.recruiters.find().to_list(length=2000)
        active_recruiters = sum(
            1 for r in all_recruiters
            if (r.get("status") or "active").strip().lower() == "active"
        )
        invitations = await database.invitations.find({"kind": "recruiter"}).to_list(length=2000)
        pending_invitations = sum(
            1 for inv in invitations
            if (inv.get("status") or "pending").strip().lower() == "pending"
        )
        org_count = await database.organizations.count_documents({})

        per_recruiter = []
        for r in all_recruiters:
            uid = r.get("user_id")
            if not uid:
                continue
            employees_managed = await database.employees.count_documents({"recruiter_id": uid})
            candidates_managed = await database.candidates.count_documents({"recruiter_id": uid})
            offers_created = await database.offer_letters.count_documents({"recruiter_id": uid})
            per_recruiter.append({
                "email": r.get("email"),
                "full_name": r.get("full_name"),
                "status": (r.get("status") or "active").strip().lower(),
                "organization_id": str(r.get("organization_id")) if r.get("organization_id") else None,
                "employees_managed": employees_managed,
                "candidates_managed": candidates_managed,
                "offers_created": offers_created,
            })

        return ToolResult(
            ok=True,
            data={
                "total_recruiters": total_recruiters,
                "active_recruiters": active_recruiters,
                "pending_invitations": pending_invitations,
                "total_organizations": org_count,
                "recruiters": per_recruiter,
            },
        )
    except Exception as exc:
        return _err(exc)


async def _tool_invite_recruiter(user: CurrentUser, args: dict) -> ToolResult:
    """Invite a new recruiter — creates invitation + sends email."""
    full_name = (args.get("full_name") or "").strip()
    email = (args.get("email") or "").strip().lower()
    job_title = (args.get("job_title") or "").strip()
    department = (args.get("department") or "").strip()
    office_location = (args.get("office_location") or "").strip() or None
    is_remote = bool(args.get("is_remote", False))
    organization_id = (args.get("organization_id") or "").strip() or None

    if not full_name or not email or not job_title or not department:
        return ToolResult(
            ok=False,
            error="full_name, email, job_title, and department are all required.",
        )

    if not email or "@" not in email:
        return ToolResult(ok=False, error="A valid email address is required.")

    existing_user = await database.users.find_one({"email": email})
    if existing_user:
        return ToolResult(ok=False, error=f"An account already exists for {email}.")
    existing_emp = await database.employees.find_one({"email": email, "status": "active"})
    if existing_emp:
        return ToolResult(ok=False, error=f"An active employee already exists for {email}.")
    existing_rec = await database.recruiters.find_one({"email": email})
    if existing_rec:
        return ToolResult(ok=False, error=f"A recruiter account already exists for {email}.")
    existing_pending = await database.pending_users.find_one({"email": email})
    if existing_pending:
        return ToolResult(ok=False, error=f"A pending registration already exists for {email}.")

    from app.services.people_history import prepare_email_for_reinvite
    await prepare_email_for_reinvite(email)

    now = datetime.now(UTC)
    token = token_urlsafe(32)
    expires_at = now + timedelta(days=365)

    if organization_id:
        org = await get_organization(organization_id)
        if not org:
            return ToolResult(ok=False, error="Organization not found.")
        organization_id = org["id"]
    else:
        first_org = await list_organizations(page=1, page_size=1)
        organizations = first_org.get("organizations") or []
        if not organizations:
            await create_organization(name="Default Organization")
            first_org = await list_organizations(page=1, page_size=1)
            organizations = first_org.get("organizations") or []
        organization_id = organizations[0]["id"] if organizations else None

    from app.api.super_admin import DEFAULT_RECRUITER_CAPABILITIES
    from app.services.organization_service import resolve_org_modules

    capabilities = {**DEFAULT_RECRUITER_CAPABILITIES}
    org_modules = await resolve_org_modules(organization_id)
    for key in DEFAULT_RECRUITER_CAPABILITIES:
        if org_modules.get(key, True) is False:
            capabilities[key] = False

    invitation = {
        "token": token,
        "email": email,
        "full_name": full_name,
        "job_title": job_title,
        "department": department,
        "office_location": office_location,
        "is_remote": is_remote,
        "organization_id": organization_id,
        "recruiter_id": user.id,
        "recruiter_email": user.email,
        "created_by_role": "super_admin",
        "kind": "recruiter",
        "capabilities": capabilities,
        "status": "pending",
        "expires_at": expires_at,
        "used_at": None,
        "created_at": now,
        "updated_at": now,
        "has_offer": False,
    }
    await database.invitations.insert_one(invitation)

    invite_link = f"{(settings.FRONTEND_URL or settings.frontend_base_url).rstrip('/')}/invite/{token}"
    expires_display = expires_at.strftime("%B %d, %Y at %H:%M UTC")

    email_sent = False
    email_error = None
    try:
        email_service.send_recruiter_invitation_email(
            to_email=email,
            full_name=full_name,
            job_title=job_title,
            department=department,
            invite_link=invite_link,
            expires_at=expires_display,
        )
        email_sent = True
    except Exception as exc:
        email_error = str(exc)

    await database.audit_logs.insert_one({
        "user_id": user.id,
        "email": email,
        "role": "super_admin",
        "module": "recruitment",
        "action": "recruiter_invitation_created",
        "outcome": "success" if email_sent else "partial",
        "created_at": now,
    })

    message = (
        f"Recruiter invitation sent to {email}."
        if email_sent
        else f"Recruiter invitation created for {email}, but the email could not be sent."
    )
    return ToolResult(
        ok=True,
        data={
            "message": message,
            "email_sent": email_sent,
            "email_error": email_error,
            "full_name": full_name,
            "email": email,
            "job_title": job_title,
            "department": department,
        },
    )


async def _tool_list_super_admin_recruiters(user: CurrentUser, args: dict) -> ToolResult:
    """List all recruiters with stats."""
    try:
        status_filter = (args.get("status") or "").strip().lower() or None
        all_recruiters = await database.recruiters.find().sort("created_at", -1).to_list(length=2000)
        invitations = await database.invitations.find({"kind": "recruiter"}).to_list(length=2000)
        invitation_map = {inv.get("email", "").lower(): inv for inv in invitations}

        results = []
        for r in all_recruiters:
            email = (r.get("email") or "").strip().lower()
            inv = invitation_map.get(email)
            status = (r.get("status") or "active").strip().lower()
            if status not in ("active", "inactive"):
                status = "active"
            if inv and not r.get("user_id"):
                status = "pending"

            if status_filter and status != status_filter:
                continue

            uid = r.get("user_id")
            employees_managed = await database.employees.count_documents({"recruiter_id": uid}) if uid else 0
            candidates_managed = await database.candidates.count_documents({"recruiter_id": uid}) if uid else 0

            results.append({
                "email": email,
                "full_name": r.get("full_name"),
                "job_title": r.get("job_title"),
                "department": r.get("department"),
                "status": status,
                "organization_id": str(r.get("organization_id")) if r.get("organization_id") else None,
                "employees_managed": employees_managed,
                "candidates_managed": candidates_managed,
                "created_at": r["created_at"].isoformat() if r.get("created_at") else None,
            })

        for inv in invitations:
            email = (inv.get("email") or "").strip().lower()
            if any(r["email"] == email for r in results):
                continue
            inv_status = (inv.get("status") or "pending").strip().lower()
            if status_filter and inv_status != status_filter:
                continue
            results.append({
                "email": email,
                "full_name": inv.get("full_name"),
                "job_title": inv.get("job_title"),
                "department": inv.get("department"),
                "status": inv_status,
                "organization_id": str(inv.get("organization_id")) if inv.get("organization_id") else None,
                "employees_managed": 0,
                "candidates_managed": 0,
                "created_at": inv["created_at"].isoformat() if inv.get("created_at") else None,
            })

        return ToolResult(ok=True, data={"recruiters": results, "total": len(results)})
    except Exception as exc:
        return _err(exc)


async def _tool_get_recruiter_detail(user: CurrentUser, args: dict) -> ToolResult:
    """Get detailed recruiter stats — employees managed, candidates managed, etc."""
    email = (args.get("email") or "").strip().lower()
    name = (args.get("name") or args.get("full_name") or "").strip()
    recruiter_id = (args.get("recruiter_id") or "").strip()

    if not email and not name and not recruiter_id:
        return ToolResult(ok=False, error="Provide email, name, or recruiter_id.")

    query = {}
    if recruiter_id and ObjectId.is_valid(recruiter_id):
        query = {"_id": ObjectId(recruiter_id)}
    elif email:
        query = {"email": email}
    elif name:
        query = {"full_name": {"$regex": name, "$options": "i"}}

    recruiter = await database.recruiters.find_one(query)
    if not recruiter:
        return ToolResult(ok=False, error=f"No recruiter found for {email or name or recruiter_id}.")

    uid = recruiter.get("user_id")
    stats = {"employees_managed": 0, "candidates_managed": 0, "offers_created": 0}
    if uid:
        stats = {
            "employees_managed": await database.employees.count_documents({"recruiter_id": uid}),
            "candidates_managed": await database.candidates.count_documents({"recruiter_id": uid}),
            "offers_created": await database.offer_letters.count_documents({"recruiter_id": uid}),
        }

    return ToolResult(
        ok=True,
        data={
            "email": recruiter.get("email"),
            "full_name": recruiter.get("full_name"),
            "job_title": recruiter.get("job_title"),
            "department": recruiter.get("department"),
            "status": (recruiter.get("status") or "active").strip().lower(),
            "organization_id": str(recruiter.get("organization_id")) if recruiter.get("organization_id") else None,
            "capabilities": recruiter.get("capabilities") or {},
            "statistics": stats,
        },
    )


async def _tool_list_super_admin_organizations(user: CurrentUser, args: dict) -> ToolResult:
    """List all organizations with recruiter counts."""
    try:
        org_result = await list_organizations(page=1, page_size=200)
        orgs = org_result.get("organizations") or []

        enriched = []
        for org in orgs:
            org_id = org.get("id")
            recruiter_count = await database.recruiters.count_documents(
                {"organization_id": org_id}
            ) if org_id else 0
            employee_count = await database.employees.count_documents(
                {"organization_id": org_id}
            ) if org_id else 0
            enriched.append({
                **org,
                "recruiter_count": recruiter_count,
                "employee_count": employee_count,
            })

        return ToolResult(
            ok=True,
            data={"organizations": enriched, "total": len(enriched)},
        )
    except Exception as exc:
        return _err(exc)


async def _tool_create_super_admin_organization(user: CurrentUser, args: dict) -> ToolResult:
    """Create a new organization."""
    name = (args.get("name") or "").strip()
    if not name:
        return ToolResult(ok=False, error="Organization name is required.")
    try:
        org = await create_organization(
            name=name,
            contact_email=(args.get("contact_email") or "").strip() or None,
            description=(args.get("description") or "").strip() or None,
        )
        return ToolResult(ok=True, data={"message": f"Organization '{org.get('name')}' created.", "organization": org})
    except Exception as exc:
        return _err(exc)


async def _tool_delete_super_admin_recruiter(user: CurrentUser, args: dict) -> ToolResult:
    """Delete a recruiter and their associated data (with confirm gate)."""
    email = (args.get("email") or "").strip().lower()
    recruiter_id = (args.get("recruiter_id") or "").strip()
    if not email and not recruiter_id:
        return ToolResult(ok=False, error="Provide email or recruiter_id.")

    if not args.get("confirm"):
        target = email or recruiter_id
        return confirm_gate(
            "delete_recruiter",
            args,
            f"Permanently delete recruiter {target} and all associated data?",
        )

    query = {}
    if recruiter_id and ObjectId.is_valid(recruiter_id):
        query = {"_id": ObjectId(recruiter_id)}
    elif email:
        query = {"email": email}

    recruiter = await database.recruiters.find_one(query)
    if not recruiter:
        return ToolResult(ok=False, error=f"No recruiter found for {email or recruiter_id}.")

    user_id = recruiter.get("user_id")
    deleted = []

    await database.recruiters.delete_one({"_id": recruiter["_id"]})
    deleted.append("recruiter_profile")

    inv = await database.invitations.find_one({"kind": "recruiter", "email": (recruiter.get("email") or "").lower()})
    if inv:
        await database.invitations.delete_one({"_id": inv["_id"]})
        deleted.append("invitation")

    if user_id and ObjectId.is_valid(user_id):
        await database.users.delete_one({"_id": ObjectId(user_id)})
        await database.refresh_tokens.delete_many({"user_id": user_id})
        await database.notifications.delete_many({"recipient_id": user_id})
        await database.agent_conversations.delete_many({"user_id": user_id})
        deleted.append("user_account")

        await database.candidates.update_many({"recruiter_id": user_id}, {"$unset": {"recruiter_id": ""}})
        await database.employees.update_many({"recruiter_id": user_id}, {"$unset": {"recruiter_id": ""}})
        await database.announcements.delete_many({"created_by": user_id})
        deleted.append("recruiter_data")

    await database.audit_logs.insert_one({
        "user_id": user.id,
        "email": user.email,
        "role": "super_admin",
        "module": "rbac",
        "action": "recruiter_deleted",
        "outcome": "success",
        "created_at": datetime.now(UTC),
    })

    return ToolResult(
        ok=True,
        data={"message": f"Recruiter {recruiter.get('email')} permanently deleted.", "deleted": deleted},
    )


async def _tool_update_super_admin_recruiter(user: CurrentUser, args: dict) -> ToolResult:
    """Update recruiter details (job_title, department, status)."""
    email = (args.get("email") or "").strip().lower()
    recruiter_id = (args.get("recruiter_id") or "").strip()
    if not email and not recruiter_id:
        return ToolResult(ok=False, error="Provide email or recruiter_id.")

    query = {}
    if recruiter_id and ObjectId.is_valid(recruiter_id):
        query = {"_id": ObjectId(recruiter_id)}
    elif email:
        query = {"email": email}

    recruiter = await database.recruiters.find_one(query)
    if not recruiter:
        return ToolResult(ok=False, error=f"No recruiter found for {email or recruiter_id}.")

    now = datetime.now(UTC)
    updates = {}
    for key in ("job_title", "department", "office_location"):
        val = (args.get(key) or "").strip() or None
        if val:
            updates[key] = val
    status_val = (args.get("status") or "").strip().lower()
    if status_val in ("active", "inactive"):
        updates["status"] = status_val

    if not updates:
        return ToolResult(ok=False, error="No valid fields to update.")

    await database.recruiters.update_one(
        {"_id": recruiter["_id"]},
        {"$set": {**updates, "updated_at": now}},
    )

    return ToolResult(
        ok=True,
        data={"message": f"Recruiter {recruiter.get('email')} updated.", "updated": updates},
    )


async def _tool_update_super_admin_recruiter_capabilities(user: CurrentUser, args: dict) -> ToolResult:
    """Update a recruiter's module capabilities."""
    email = (args.get("email") or "").strip().lower()
    recruiter_id = (args.get("recruiter_id") or "").strip()
    capabilities = args.get("capabilities") or {}
    if not capabilities:
        return ToolResult(ok=False, error="Provide capabilities dict to update.")
    if not email and not recruiter_id:
        return ToolResult(ok=False, error="Provide email or recruiter_id.")

    query = {}
    if recruiter_id and ObjectId.is_valid(recruiter_id):
        query = {"_id": ObjectId(recruiter_id)}
    elif email:
        query = {"email": email}

    recruiter = await database.recruiters.find_one(query)
    if not recruiter:
        return ToolResult(ok=False, error=f"No recruiter found for {email or recruiter_id}.")

    now = datetime.now(UTC)
    existing = recruiter.get("capabilities") or {}
    updated = {**existing, **capabilities}

    await database.recruiters.update_one(
        {"_id": recruiter["_id"]},
        {"$set": {"capabilities": updated, "updated_at": now}},
    )

    inv = await database.invitations.find_one({"kind": "recruiter", "email": (recruiter.get("email") or "").lower()})
    if inv:
        await database.invitations.update_one(
            {"_id": inv["_id"]},
            {"$set": {"capabilities": updated, "updated_at": now}},
        )

    return ToolResult(
        ok=True,
        data={"message": f"Capabilities updated for {recruiter.get('email')}.", "capabilities": updated},
    )


# ── Organization management tools ─────────────────────────────────────────


async def _tool_create_organization_with_modules(user: CurrentUser, args: dict) -> ToolResult:
    """Create a new organization with optional module toggles."""
    name = (args.get("name") or "").strip()
    if not name:
        return ToolResult(ok=False, error="Organization name is required.")
    try:
        modules = args.get("modules")
        if isinstance(modules, dict) and modules:
            filtered = {k: bool(v) for k, v in modules.items() if k in ORG_MODULE_KEYS}
            modules = filtered if filtered else None
        org = await create_organization(
            name=name,
            modules=modules,
            contact_email=(args.get("contact_email") or "").strip() or None,
            description=(args.get("description") or "").strip() or None,
        )
        return ToolResult(ok=True, data={"message": f"Organization '{org.get('name')}' created.", "organization": org})
    except Exception as exc:
        return _err(exc)


async def _tool_update_organization(user: CurrentUser, args: dict) -> ToolResult:
    """Update an organization's name, contact_email, description, status, or modules."""
    org_id = (args.get("organization_id") or args.get("org_id") or "").strip()
    if not org_id:
        return ToolResult(ok=False, error="organization_id is required.")

    existing = await get_organization(org_id)
    if not existing:
        return ToolResult(ok=False, error="Organization not found.")

    kwargs: dict = {}
    for key in ("name", "contact_email", "description"):
        val = (args.get(key) or "").strip() or None
        if val:
            kwargs[key] = val
    status_val = (args.get("status") or "").strip().lower()
    if status_val in ("active", "inactive"):
        kwargs["status"] = status_val

    modules = args.get("modules")
    if isinstance(modules, dict) and modules:
        kwargs["modules"] = {k: bool(v) for k, v in modules.items() if k in ORG_MODULE_KEYS}

    if not kwargs:
        return ToolResult(ok=False, error="No valid fields to update. Provide name, contact_email, description, status, or modules.")

    try:
        updated = await update_organization(org_id, **kwargs)
        return ToolResult(ok=True, data={"message": f"Organization '{existing.get('name')}' updated.", "organization": updated})
    except Exception as exc:
        return _err(exc)


async def _tool_delete_organization(user: CurrentUser, args: dict) -> ToolResult:
    """Delete an organization and unlink its recruiters (requires confirm=true)."""
    org_id = (args.get("organization_id") or args.get("org_id") or "").strip()
    if not org_id:
        return ToolResult(ok=False, error="organization_id is required.")

    existing = await get_organization(org_id)
    if not existing:
        return ToolResult(ok=False, error="Organization not found.")

    if not args.get("confirm"):
        return confirm_gate("delete_organization", args, f"Permanently delete organization '{existing.get('name')}' and unlink all its recruiters?")

    try:
        deleted = await delete_organization(org_id)
        if deleted:
            return ToolResult(ok=True, data={"message": f"Organization '{existing.get('name')}' deleted."})
        return ToolResult(ok=False, error="Delete failed.")
    except Exception as exc:
        return _err(exc)


# ── Support ticket management tools ───────────────────────────────────────


async def _tool_list_admin_tickets(user: CurrentUser, args: dict) -> ToolResult:
    """List all support tickets with optional filters."""
    try:
        result = await ticket_service.list_all_tickets(
            user,
            status=(args.get("status") or None),
            priority=(args.get("priority") or None),
            category=(args.get("category") or None),
            search=(args.get("search") or None),
            page=int(args.get("page") or 1),
            page_size=min(int(args.get("page_size") or 20), 50),
        )
        return ToolResult(ok=True, data=result)
    except Exception as exc:
        return _err(exc)


async def _tool_get_ticket_stats(user: CurrentUser, args: dict) -> ToolResult:
    """Get platform-wide support ticket stats (total, open, resolved, by priority)."""
    try:
        stats = await ticket_service.get_ticket_stats(user)
        return ToolResult(ok=True, data=stats)
    except Exception as exc:
        return _err(exc)


async def _tool_get_admin_ticket(user: CurrentUser, args: dict) -> ToolResult:
    """Get a specific ticket with its full conversation thread."""
    ticket_id = (args.get("ticket_id") or args.get("id") or "").strip()
    if not ticket_id:
        return ToolResult(ok=False, error="ticket_id is required.")
    try:
        result = await ticket_service.get_ticket_admin(user, ticket_id)
        return ToolResult(ok=True, data=result)
    except Exception as exc:
        return _err(exc)


async def _tool_assign_ticket(user: CurrentUser, args: dict) -> ToolResult:
    """Assign a support ticket to an admin."""
    ticket_id = (args.get("ticket_id") or args.get("id") or "").strip()
    assignee_email = (args.get("assignee_email") or args.get("email") or "").strip()
    if not ticket_id:
        return ToolResult(ok=False, error="ticket_id is required.")
    if not assignee_email:
        return ToolResult(ok=False, error="assignee_email is required.")
    try:
        from app.schemas.ticket import TicketAssignRequest
        request = TicketAssignRequest(assignee_email=assignee_email)
        result = await ticket_service.assign_ticket(user, ticket_id, request)
        return ToolResult(ok=True, data=result)
    except Exception as exc:
        return _err(exc)


async def _tool_reply_to_admin_ticket(user: CurrentUser, args: dict) -> ToolResult:
    """Reply to a support ticket as admin."""
    ticket_id = (args.get("ticket_id") or args.get("id") or "").strip()
    message = (args.get("message") or "").strip()
    if not ticket_id:
        return ToolResult(ok=False, error="ticket_id is required.")
    if not message:
        return ToolResult(ok=False, error="message is required.")
    try:
        from app.schemas.ticket import TicketReplyRequest
        request = TicketReplyRequest(message=message)
        result = await ticket_service.reply_to_ticket_admin(user, ticket_id, request)
        return ToolResult(ok=True, data=result)
    except Exception as exc:
        return _err(exc)


async def _tool_update_ticket_status(user: CurrentUser, args: dict) -> ToolResult:
    """Update a ticket's status (open, in_progress, waiting, resolved, closed)."""
    ticket_id = (args.get("ticket_id") or args.get("id") or "").strip()
    status = (args.get("status") or "").strip()
    if not ticket_id or not status:
        return ToolResult(ok=False, error="ticket_id and status are required.")
    valid = {"open", "in_progress", "waiting", "resolved", "closed"}
    if status not in valid:
        return ToolResult(ok=False, error=f"Invalid status. Must be one of: {', '.join(sorted(valid))}")
    try:
        from app.schemas.ticket import TicketStatusUpdateRequest
        request = TicketStatusUpdateRequest(status=status)
        result = await ticket_service.update_status(user, ticket_id, request)
        return ToolResult(ok=True, data=result)
    except Exception as exc:
        return _err(exc)


async def _tool_update_ticket_priority(user: CurrentUser, args: dict) -> ToolResult:
    """Update a ticket's priority (low, medium, high, critical)."""
    ticket_id = (args.get("ticket_id") or args.get("id") or "").strip()
    priority = (args.get("priority") or "").strip()
    if not ticket_id or not priority:
        return ToolResult(ok=False, error="ticket_id and priority are required.")
    valid = {"low", "medium", "high", "critical"}
    if priority not in valid:
        return ToolResult(ok=False, error=f"Invalid priority. Must be one of: {', '.join(sorted(valid))}")
    try:
        from app.schemas.ticket import TicketPriorityUpdateRequest
        request = TicketPriorityUpdateRequest(priority=priority)
        result = await ticket_service.update_priority(user, ticket_id, request)
        return ToolResult(ok=True, data=result)
    except Exception as exc:
        return _err(exc)


async def _tool_resolve_ticket(user: CurrentUser, args: dict) -> ToolResult:
    """Resolve a support ticket (marks as resolved)."""
    ticket_id = (args.get("ticket_id") or args.get("id") or "").strip()
    if not ticket_id:
        return ToolResult(ok=False, error="ticket_id is required.")
    try:
        result = await ticket_service.resolve_ticket(user, ticket_id)
        return ToolResult(ok=True, data=result)
    except Exception as exc:
        return _err(exc)


async def _tool_close_admin_ticket(user: CurrentUser, args: dict) -> ToolResult:
    """Close a support ticket."""
    ticket_id = (args.get("ticket_id") or args.get("id") or "").strip()
    if not ticket_id:
        return ToolResult(ok=False, error="ticket_id is required.")
    try:
        result = await ticket_service.close_ticket_admin(user, ticket_id)
        return ToolResult(ok=True, data=result)
    except Exception as exc:
        return _err(exc)


async def _tool_reopen_ticket(user: CurrentUser, args: dict) -> ToolResult:
    """Reopen a closed/resolved support ticket."""
    ticket_id = (args.get("ticket_id") or args.get("id") or "").strip()
    if not ticket_id:
        return ToolResult(ok=False, error="ticket_id is required.")
    try:
        result = await ticket_service.reopen_ticket(user, ticket_id)
        return ToolResult(ok=True, data=result)
    except Exception as exc:
        return _err(exc)


async def _tool_delete_admin_ticket(user: CurrentUser, args: dict) -> ToolResult:
    """Delete a support ticket (requires confirm=true)."""
    ticket_id = (args.get("ticket_id") or args.get("id") or "").strip()
    if not ticket_id:
        return ToolResult(ok=False, error="ticket_id is required.")
    if not args.get("confirm"):
        return confirm_gate("delete_ticket", args, f"Permanently delete ticket {ticket_id}?")
    try:
        result = await ticket_service.delete_ticket(user, ticket_id)
        return ToolResult(ok=True, data=result)
    except Exception as exc:
        return _err(exc)


async def _tool_get_ticket_activity(user: CurrentUser, args: dict) -> ToolResult:
    """Get activity/audit logs for a support ticket."""
    ticket_id = (args.get("ticket_id") or args.get("id") or "").strip()
    if not ticket_id:
        return ToolResult(ok=False, error="ticket_id is required.")
    try:
        result = await ticket_service.get_activity(user, ticket_id)
        return ToolResult(ok=True, data=result)
    except Exception as exc:
        return _err(exc)


# ── Bulk capability template tools ────────────────────────────────────────


async def _tool_list_capability_templates(user: CurrentUser, args: dict) -> ToolResult:
    """List available capability templates with their descriptions."""
    from app.api.super_admin import CAPABILITY_TEMPLATES
    descriptions = {
        "standard_recruiter": "Full access to all modules — the default for most recruiters.",
        "hiring_only": "Recruitment-focused: candidates, invite, overview, assistant. No employee/learning/IT access.",
        "people_ops": "People operations: employees, talent, learning, messages, announcements. No direct hiring.",
        "it_admin": "IT provisioning and support: employees, IT, messages, announcements. No recruitment.",
        "viewer": "Read-only: overview, candidates, employees, talent, reporting. Cannot invite or manage.",
    }
    result = {}
    for key, caps in CAPABILITY_TEMPLATES.items():
        enabled = sum(1 for v in caps.values() if v)
        result[key] = {
            "name": key.replace("_", " ").title(),
            "description": descriptions.get(key, ""),
            "enabled_count": enabled,
            "total_count": len(caps),
            "capabilities": caps,
        }
    return ToolResult(ok=True, data={"templates": result})


async def _tool_bulk_apply_template(user: CurrentUser, args: dict) -> ToolResult:
    """Apply a capability template to multiple recruiters at once."""
    template_name = (args.get("template") or "").strip().lower()
    recruiter_emails = args.get("recruiter_emails") or args.get("emails") or []

    if not template_name:
        return ToolResult(ok=False, error="template is required (standard_recruiter, hiring_only, people_ops, it_admin, viewer).")
    if not recruiter_emails or not isinstance(recruiter_emails, list):
        return ToolResult(ok=False, error="recruiter_emails must be a list of email addresses.")

    from app.api.super_admin import CAPABILITY_TEMPLATES
    template = CAPABILITY_TEMPLATES.get(template_name)
    if not template:
        return ToolResult(ok=False, error=f"Unknown template: {template_name}. Available: {', '.join(CAPABILITY_TEMPLATES.keys())}")

    now = datetime.now(UTC)
    updated = []
    not_found = []

    for email in recruiter_emails:
        email_str = (email or "").strip().lower()
        if not email_str:
            continue

        recruiter = await database.recruiters.find_one({"email": email_str})
        if not recruiter:
            not_found.append(email_str)
            continue

        merged = {**template}
        existing = recruiter.get("capabilities") or {}

        await database.recruiters.update_one(
            {"_id": recruiter["_id"]},
            {"$set": {"capabilities": merged, "updated_at": now}},
        )

        inv = await database.invitations.find_one({"kind": "recruiter", "email": email_str})
        if inv:
            await database.invitations.update_one(
                {"_id": inv["_id"]},
                {"$set": {"capabilities": merged, "updated_at": now}},
            )

        updated.append(email_str)

    return ToolResult(
        ok=True,
        data={
            "message": f"Template '{template_name}' applied to {len(updated)} recruiter(s).",
            "template": template_name,
            "updated": updated,
            "not_found": not_found,
        },
    )


SUPER_ADMIN_TOOLS: list[Tool] = [
    Tool(
        name="get_super_admin_overview",
        description=(
            "Platform overview dashboard stats: total recruiters, active recruiters, "
            "pending invitations, total organizations, and per-recruiter employee/candidate counts. "
            "Use when the super admin asks for a summary or report of the platform."
        ),
        parameters={},
        handler=_tool_get_super_admin_overview,
        roles=("super_admin",),
    ),
    Tool(
        name="invite_recruiter",
        description=(
            "Invite a new recruiter to the platform. Sends an email with a sign-up link. "
            "Required fields: full_name, email, job_title, department. "
            "Optional: office_location, is_remote, organization_id."
        ),
        parameters={
            "full_name": "string, required",
            "email": "string, required",
            "job_title": "string, required",
            "department": "string, required",
            "office_location": "string, optional",
            "is_remote": "boolean, optional, default false",
            "organization_id": "string, optional — bind to an organization",
        },
        handler=_tool_invite_recruiter,
        roles=("super_admin",),
    ),
    Tool(
        name="list_recruiters",
        description=(
            "List all recruiters on the platform with their employee/candidate counts, "
            "status, and organization binding. Optional status filter: active|pending|inactive."
        ),
        parameters={
            "status": "string, optional filter: active|pending|inactive",
        },
        handler=_tool_list_super_admin_recruiters,
        roles=("super_admin",),
    ),
    Tool(
        name="get_recruiter_detail",
        description=(
            "Get detailed information about a specific recruiter: "
            "employees managed, candidates managed, offers created, capabilities."
        ),
        parameters={
            "email": "string, optional",
            "name": "string, optional",
            "recruiter_id": "string, optional",
        },
        handler=_tool_get_recruiter_detail,
        roles=("super_admin",),
    ),
    Tool(
        name="list_organizations",
        description=(
            "List all organizations with their module access, recruiter count, and employee count."
        ),
        parameters={},
        handler=_tool_list_super_admin_organizations,
        roles=("super_admin",),
    ),
    Tool(
        name="create_organization",
        description=(
            "Create a new organization with optional module access. "
            "Modules control what features recruiters in this org can access."
        ),
        parameters={
            "name": "string, required",
            "contact_email": "string, optional",
            "description": "string, optional",
            "modules": "object, optional — key-value pairs of module: true/false (overview, candidates, invite, employees, talent, learning, org_config, assistant, messages, announcements, it, reporting, profile, support)",
        },
        handler=_tool_create_organization_with_modules,
        roles=("super_admin",),
    ),
    Tool(
        name="update_organization",
        description="Update an organization's name, contact email, description, status, or module access.",
        parameters={
            "organization_id": "string, required",
            "name": "string, optional",
            "contact_email": "string, optional",
            "description": "string, optional",
            "status": "string, optional: active|inactive",
            "modules": "object, optional — key-value pairs of module: true/false",
        },
        handler=_tool_update_organization,
        roles=("super_admin",),
    ),
    Tool(
        name="delete_organization",
        description="Delete an organization and unlink its recruiters. Requires confirm=true.",
        parameters={
            "organization_id": "string, required",
            "confirm": "boolean, set true to proceed",
        },
        handler=_tool_delete_organization,
        roles=("super_admin",),
    ),
    # ── Support ticket tools ─────────────────────────────────────────────
    Tool(
        name="list_admin_tickets",
        description=(
            "List all support tickets across the platform with optional filters. "
            "Returns ticket list with subject, status, priority, category, assignee, and dates."
        ),
        parameters={
            "status": "string, optional: open|in_progress|waiting|resolved|closed",
            "priority": "string, optional: low|medium|high|critical",
            "category": "string, optional",
            "search": "string, optional — search by subject",
            "page": "integer, optional, default 1",
            "page_size": "integer, optional, max 50",
        },
        handler=_tool_list_admin_tickets,
        roles=("super_admin",),
    ),
    Tool(
        name="get_ticket_stats",
        description="Get platform-wide support ticket stats: total, open, in-progress, resolved, closed, by-priority, by-category.",
        parameters={},
        handler=_tool_get_ticket_stats,
        roles=("super_admin",),
    ),
    Tool(
        name="get_admin_ticket",
        description="Get a specific support ticket with its full conversation thread and details.",
        parameters={
            "ticket_id": "string, required — the ticket ID (e.g. TKT-0001)",
        },
        handler=_tool_get_admin_ticket,
        roles=("super_admin",),
    ),
    Tool(
        name="assign_ticket",
        description="Assign a support ticket to an admin by email.",
        parameters={
            "ticket_id": "string, required",
            "assignee_email": "string, required — admin email to assign to",
        },
        handler=_tool_assign_ticket,
        roles=("super_admin",),
    ),
    Tool(
        name="reply_to_ticket",
        description="Reply to a support ticket as admin. The reply appears in the ticket thread.",
        parameters={
            "ticket_id": "string, required",
            "message": "string, required — your reply message",
        },
        handler=_tool_reply_to_admin_ticket,
        roles=("super_admin",),
    ),
    Tool(
        name="update_ticket_status",
        description="Update a ticket's status. Valid: open, in_progress, waiting, resolved, closed.",
        parameters={
            "ticket_id": "string, required",
            "status": "string, required: open|in_progress|waiting|resolved|closed",
        },
        handler=_tool_update_ticket_status,
        roles=("super_admin",),
    ),
    Tool(
        name="update_ticket_priority",
        description="Update a ticket's priority. Valid: low, medium, high, critical.",
        parameters={
            "ticket_id": "string, required",
            "priority": "string, required: low|medium|high|critical",
        },
        handler=_tool_update_ticket_priority,
        roles=("super_admin",),
    ),
    Tool(
        name="resolve_ticket",
        description="Mark a support ticket as resolved.",
        parameters={
            "ticket_id": "string, required",
        },
        handler=_tool_resolve_ticket,
        roles=("super_admin",),
    ),
    Tool(
        name="close_ticket",
        description="Close a support ticket.",
        parameters={
            "ticket_id": "string, required",
        },
        handler=_tool_close_admin_ticket,
        roles=("super_admin",),
    ),
    Tool(
        name="reopen_ticket",
        description="Reopen a closed or resolved support ticket.",
        parameters={
            "ticket_id": "string, required",
        },
        handler=_tool_reopen_ticket,
        roles=("super_admin",),
    ),
    Tool(
        name="delete_ticket",
        description="Permanently delete a support ticket. Requires confirm=true.",
        parameters={
            "ticket_id": "string, required",
            "confirm": "boolean, set true to proceed",
        },
        handler=_tool_delete_admin_ticket,
        roles=("super_admin",),
    ),
    Tool(
        name="get_ticket_activity",
        description="Get the activity and audit log for a support ticket.",
        parameters={
            "ticket_id": "string, required",
        },
        handler=_tool_get_ticket_activity,
        roles=("super_admin",),
    ),
    # ── Bulk capability template tools ───────────────────────────────────
    Tool(
        name="list_capability_templates",
        description="List all available capability templates with descriptions and which modules each enables.",
        parameters={},
        handler=_tool_list_capability_templates,
        roles=("super_admin",),
    ),
    Tool(
        name="bulk_apply_template",
        description=(
            "Apply a capability template to multiple recruiters at once. "
            "Available templates: standard_recruiter, hiring_only, people_ops, it_admin, viewer."
        ),
        parameters={
            "template": "string, required — one of: standard_recruiter, hiring_only, people_ops, it_admin, viewer",
            "recruiter_emails": "array of strings — emails of recruiters to apply the template to",
        },
        handler=_tool_bulk_apply_template,
        roles=("super_admin",),
    ),
]

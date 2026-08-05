"""Support ticket service — recruitment/employee issue tickets raised by users and triaged by super admins."""

from __future__ import annotations

import csv
import re
from datetime import UTC, datetime, timedelta
from io import StringIO
from pathlib import Path

from bson import ObjectId
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from app.core.database import database
from app.core.rbac import CurrentUser
from app.schemas.ticket import (
    TICKET_CATEGORIES,
    TICKET_MODULES,
    TICKET_PRIORITIES,
    TICKET_STATUSES,
    TicketCreateRequest,
    TicketUpdateRequest,
)
from app.services.dashboard_service import create_notification
from app.services.storage_service import save_file as _storage_save_file

CREATOR_TICKETS_LINK = "/dashboard/recruiter/support"
ADMIN_TICKETS_LINK = "/dashboard/super-admin/tickets"

ALLOWED_ATTACHMENT_EXTENSIONS = {
    ".pdf", ".jpg", ".jpeg", ".png", ".doc", ".docx",
    ".xls", ".xlsx", ".txt", ".csv", ".zip", ".mp4",
}
MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

SORTABLE_FIELDS = {"created_at", "updated_at", "subject", "status", "priority", "category"}


def _iso(value):
    return value.isoformat() if hasattr(value, "isoformat") else value


def _out(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "ticket_id": doc.get("ticket_id"),
        "subject": doc.get("subject"),
        "description": doc.get("description"),
        "category": doc.get("category"),
        "priority": doc.get("priority"),
        "affected_module": doc.get("affected_module"),
        "browser": doc.get("browser"),
        "os": doc.get("os"),
        "steps_to_reproduce": doc.get("steps_to_reproduce"),
        "expected_behaviour": doc.get("expected_behaviour"),
        "actual_behaviour": doc.get("actual_behaviour"),
        "additional_notes": doc.get("additional_notes"),
        "status": doc.get("status"),
        "created_by": doc.get("created_by"),
        "created_by_name": doc.get("created_by_name"),
        "created_by_email": doc.get("created_by_email"),
        "created_by_role": doc.get("created_by_role"),
        "organization_id": doc.get("organization_id"),
        "organization_name": doc.get("organization_name"),
        "assignee_id": doc.get("assignee_id"),
        "assignee_name": doc.get("assignee_name"),
        "assignee_email": doc.get("assignee_email"),
        "attachments": doc.get("attachments") or [],
        "read_by_creator": doc.get("read_by_creator"),
        "read_by_admin": doc.get("read_by_admin"),
        "merge_count": doc.get("merge_count") or 0,
        "merged_into": doc.get("merged_into"),
        "merged_from": doc.get("merged_from") or [],
        "created_at": _iso(doc.get("created_at")),
        "updated_at": _iso(doc.get("updated_at")),
        "resolved_at": _iso(doc.get("resolved_at")),
        "closed_at": _iso(doc.get("closed_at")),
        "deleted_at": _iso(doc.get("deleted_at")),
    }


def _reply_out(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "ticket_id": str(doc.get("ticket_id")) if doc.get("ticket_id") else None,
        "message": doc.get("message"),
        "sender_id": doc.get("sender_id"),
        "sender_name": doc.get("sender_name"),
        "sender_email": doc.get("sender_email"),
        "sender_role": doc.get("sender_role"),
        "is_admin": doc.get("is_admin"),
        "attachments": doc.get("attachments") or [],
        "created_at": _iso(doc.get("created_at")),
    }


def _activity_out(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "ticket_id": str(doc.get("ticket_id")) if doc.get("ticket_id") else None,
        "actor_id": doc.get("actor_id"),
        "actor_email": doc.get("actor_email"),
        "action": doc.get("action"),
        "description": doc.get("description"),
        "metadata": doc.get("metadata") or {},
        "old_value": doc.get("old_value"),
        "new_value": doc.get("new_value"),
        "created_at": _iso(doc.get("created_at")),
    }


def _audit_out(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "ticket_id": str(doc.get("ticket_id")) if doc.get("ticket_id") else None,
        "actor_id": doc.get("actor_id"),
        "actor_email": doc.get("actor_email"),
        "action": doc.get("action"),
        "old_value": doc.get("old_value"),
        "new_value": doc.get("new_value"),
        "ip": doc.get("ip"),
        "created_at": _iso(doc.get("created_at")),
    }


class TicketService:
    async def _generate_ticket_id(self) -> str:
        count = await database.tickets.count_documents({})
        return f"TKT-{count + 1:06d}"

    async def _resolve_ticket_ref(self, ref: str) -> dict:
        if not ref:
            raise HTTPException(status_code=404, detail="Ticket not found.")
        query: dict = {"deleted_at": None}
        if ObjectId.is_valid(ref):
            query["$or"] = [{"_id": ObjectId(ref)}, {"ticket_id": ref}]
        else:
            query["ticket_id"] = ref
        doc = await database.tickets.find_one(query)
        if not doc:
            raise HTTPException(status_code=404, detail="Ticket not found.")
        return doc

    async def _find_ticket(self, ticket_id: str) -> dict:
        return await self._resolve_ticket_ref(ticket_id)

    async def _find_owned(self, ticket_id: str, current_user: CurrentUser) -> dict:
        doc = await self._find_ticket(ticket_id)
        if str(doc.get("created_by")) != str(current_user.id):
            raise HTTPException(status_code=404, detail="Ticket not found.")
        return doc

    async def _super_admin_profiles(self) -> list[dict]:
        return await database.super_admins.find({}, {"user_id": 1, "supabase_user_id": 1, "email": 1, "full_name": 1}).to_list(length=100)

    async def _notify_super_admins(self, *, notif_type: str, title: str, message: str, link: str, related_id: str) -> None:
        for admin in await self._super_admin_profiles():
            recipient_id = admin.get("user_id") or admin.get("supabase_user_id") or str(admin.get("_id"))
            await create_notification(
                recipient_id=str(recipient_id),
                recipient_role="super_admin",
                notif_type=notif_type,
                title=title,
                message=message,
                link=link,
                related_id=related_id,
            )

    async def _notify_creator(self, doc: dict, *, notif_type: str, title: str, message: str, link: str) -> None:
        created_by = doc.get("created_by")
        if not created_by:
            return
        await create_notification(
            recipient_id=str(created_by),
            recipient_role=doc.get("created_by_role") or "recruiter",
            notif_type=notif_type,
            title=title,
            message=message,
            link=link,
            related_id=str(doc["_id"]),
        )

    async def _notify_assignee_or_admins(self, doc: dict, *, notif_type: str, title: str, message: str, link: str) -> None:
        assignee_id = doc.get("assignee_id")
        if assignee_id:
            await create_notification(
                recipient_id=str(assignee_id),
                recipient_role="super_admin",
                notif_type=notif_type,
                title=title,
                message=message,
                link=link,
                related_id=str(doc["_id"]),
            )
        else:
            await self._notify_super_admins(
                notif_type=notif_type, title=title, message=message, link=link, related_id=str(doc["_id"])
            )

    async def _log_activity(
        self,
        ticket_id: str,
        actor_id: str,
        actor_email: str,
        action: str,
        description: str,
        metadata: dict | None = None,
        old_value=None,
        new_value=None,
    ) -> None:
        await database.ticket_activity.insert_one(
            {
                "ticket_id": ObjectId(ticket_id),
                "actor_id": actor_id,
                "actor_email": actor_email,
                "action": action,
                "description": description,
                "metadata": metadata or {},
                "old_value": old_value,
                "new_value": new_value,
                "created_at": datetime.now(UTC),
            }
        )

    async def _log_audit(
        self,
        ticket_id: str,
        actor_id: str,
        actor_email: str,
        action: str,
        old_value=None,
        new_value=None,
        ip: str | None = None,
    ) -> None:
        await database.ticket_audit_logs.insert_one(
            {
                "ticket_id": ObjectId(ticket_id),
                "actor_id": actor_id,
                "actor_email": actor_email,
                "action": action,
                "old_value": old_value,
                "new_value": new_value,
                "ip": ip,
                "created_at": datetime.now(UTC),
            }
        )

    async def create_ticket(self, current_user: CurrentUser, request: TicketCreateRequest) -> dict:
        now = datetime.now(UTC)
        for _ in range(5):
            ticket_id = await self._generate_ticket_id()
            doc = {
                "ticket_id": ticket_id,
                "subject": request.subject,
                "description": request.description,
                "category": request.category,
                "priority": request.priority,
                "affected_module": request.affected_module,
                "browser": request.browser,
                "os": request.os,
                "steps_to_reproduce": request.steps_to_reproduce,
                "expected_behaviour": request.expected_behaviour,
                "actual_behaviour": request.actual_behaviour,
                "additional_notes": request.additional_notes,
                "status": "open",
                "created_by": current_user.id,
                "created_by_name": current_user.full_name,
                "created_by_email": current_user.email,
                "created_by_role": current_user.role,
                "organization_id": current_user.organization_id,
                "organization_name": current_user.organization_name,
                "assignee_id": None,
                "assignee_name": None,
                "assignee_email": None,
                "attachments": [],
                "read_by_creator": True,
                "read_by_admin": False,
                "merge_count": 0,
                "merged_into": None,
                "merged_from": [],
                "created_at": now,
                "updated_at": now,
                "resolved_at": None,
                "closed_at": None,
                "deleted_at": None,
            }
            try:
                result = await database.tickets.insert_one(doc)
            except DuplicateKeyError:
                continue
            doc["_id"] = result.inserted_id
            await self._log_activity(
                str(doc["_id"]),
                current_user.id,
                current_user.email,
                "ticket_created",
                f"Ticket {ticket_id} created.",
                metadata={
                    "category": request.category,
                    "priority": request.priority,
                    "affected_module": request.affected_module,
                },
                new_value="open",
            )
            await self._log_audit(
                str(doc["_id"]),
                current_user.id,
                current_user.email,
                "ticket_created",
                old_value=None,
                new_value={"ticket_id": ticket_id, "status": "open"},
            )
            await self._notify_super_admins(
                notif_type="ticket_created",
                title="New support ticket",
                message=f"New support ticket {ticket_id}: {request.subject}",
                link=ADMIN_TICKETS_LINK,
                related_id=str(doc["_id"]),
            )
            return _out(doc)
        raise HTTPException(status_code=409, detail="Could not generate a unique ticket number. Please retry.")

    async def list_my_tickets(
        self,
        current_user: CurrentUser,
        status: str | None = None,
        priority: str | None = None,
        category: str | None = None,
        page: int = 1,
        page_size: int = 20,
        search: str | None = None,
    ) -> dict:
        query: dict = {"created_by": current_user.id, "deleted_at": None}
        if status:
            query["status"] = status
        if priority:
            query["priority"] = priority
        if category:
            query["category"] = category
        if search:
            query["subject"] = {"$regex": re.escape(search), "$options": "i"}
        skip = (page - 1) * page_size
        total = await database.tickets.count_documents(query)
        docs = (
            await database.tickets.find(query)
            .sort("created_at", -1)
            .skip(skip)
            .limit(page_size)
            .to_list(length=page_size)
        )
        return {"tickets": [_out(d) for d in docs], "total": total, "page": page, "page_size": page_size}

    async def get_ticket(self, current_user: CurrentUser, ticket_id: str) -> dict:
        doc = await self._find_owned(ticket_id, current_user)
        if not doc.get("read_by_creator"):
            await database.tickets.update_one(
                {"_id": doc["_id"]}, {"$set": {"read_by_creator": True, "updated_at": datetime.now(UTC)}}
            )
        replies = (
            await database.ticket_replies.find({"ticket_id": doc["_id"]})
            .sort("created_at", 1)
            .to_list(length=500)
        )
        return {"ticket": _out(doc), "replies": [_reply_out(r) for r in replies]}

    async def reply_to_ticket(self, current_user: CurrentUser, ticket_id: str, request) -> dict:
        doc = await self._find_owned(ticket_id, current_user)
        now = datetime.now(UTC)
        reply = {
            "ticket_id": doc["_id"],
            "message": request.message,
            "sender_id": current_user.id,
            "sender_name": current_user.full_name,
            "sender_email": current_user.email,
            "sender_role": current_user.role,
            "is_admin": False,
            "attachments": [],
            "created_at": now,
        }
        result = await database.ticket_replies.insert_one(reply)
        reply["_id"] = result.inserted_id
        await database.tickets.update_one(
            {"_id": doc["_id"]}, {"$set": {"read_by_admin": False, "updated_at": now}}
        )
        await self._log_activity(
            str(doc["_id"]),
            current_user.id,
            current_user.email,
            "ticket_replied",
            f"{current_user.full_name} replied to {doc.get('ticket_id')}.",
            new_value=request.message[:200],
        )
        await self._log_audit(
            str(doc["_id"]),
            current_user.id,
            current_user.email,
            "ticket_replied",
            old_value=None,
            new_value={"reply_id": str(result.inserted_id), "is_admin": False},
        )
        await self._notify_assignee_or_admins(
            doc,
            notif_type="ticket_replied",
            title=f"New reply on {doc.get('ticket_id')}",
            message=f"{current_user.full_name} replied to {doc.get('ticket_id')}: {request.message[:200]}",
            link=ADMIN_TICKETS_LINK,
        )
        return {"message": "Reply sent.", "reply": _reply_out(reply)}

    async def close_ticket(self, current_user: CurrentUser, ticket_id: str) -> dict:
        doc = await self._find_owned(ticket_id, current_user)
        if doc.get("status") == "closed":
            return {"message": "Ticket already closed.", "ticket": _out(doc)}
        now = datetime.now(UTC)
        await database.tickets.update_one(
            {"_id": doc["_id"]},
            {"$set": {"status": "closed", "closed_at": now, "updated_at": now}},
        )
        doc["status"] = "closed"
        doc["closed_at"] = now
        await self._log_activity(
            str(doc["_id"]),
            current_user.id,
            current_user.email,
            "ticket_closed",
            f"{current_user.full_name} closed {doc.get('ticket_id')}.",
            old_value="open",
            new_value="closed",
        )
        await self._log_audit(
            str(doc["_id"]),
            current_user.id,
            current_user.email,
            "ticket_closed",
            old_value=None,
            new_value="closed",
        )
        await self._notify_assignee_or_admins(
            doc,
            notif_type="ticket_closed",
            title=f"Ticket {doc.get('ticket_id')} closed",
            message=f"{current_user.full_name} closed {doc.get('ticket_id')}.",
            link=ADMIN_TICKETS_LINK,
        )
        return {"message": "Ticket closed.", "ticket": _out(doc)}

    async def my_ticket_stats(self, current_user: CurrentUser) -> dict:
        base: dict = {"created_by": current_user.id, "deleted_at": None}
        now = datetime.now(UTC)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        week_start = today_start - timedelta(days=today_start.weekday())
        by_status = {s: await database.tickets.count_documents({**base, "status": s}) for s in TICKET_STATUSES}
        by_priority = {p: await database.tickets.count_documents({**base, "priority": p}) for p in TICKET_PRIORITIES}
        return {
            "total": sum(by_status.values()),
            "open": sum(by_status[s] for s in ("open", "in_progress", "waiting")),
            "resolved": by_status["resolved"],
            "closed": by_status["closed"],
            "by_status": by_status,
            "by_priority": by_priority,
            "created_today": await database.tickets.count_documents({**base, "created_at": {"$gte": today_start}}),
            "created_this_week": await database.tickets.count_documents({**base, "created_at": {"$gte": week_start}}),
        }

    async def list_all_tickets(
        self,
        current_user: CurrentUser,
        status: str | None = None,
        priority: str | None = None,
        category: str | None = None,
        assigned_to: str | None = None,
        organization_id: str | None = None,
        page: int = 1,
        page_size: int = 20,
        search: str | None = None,
        sort: str = "-created_at",
    ) -> dict:
        query: dict = {"deleted_at": None}
        if status:
            query["status"] = status
        if priority:
            query["priority"] = priority
        if category:
            query["category"] = category
        if assigned_to:
            query["assignee_id"] = assigned_to
        if organization_id:
            query["organization_id"] = organization_id
        if search:
            query["subject"] = {"$regex": re.escape(search), "$options": "i"}
        sort_field = sort.lstrip("-") if sort else "created_at"
        if sort_field not in SORTABLE_FIELDS:
            sort_field = "created_at"
        sort_direction = -1 if sort and sort.startswith("-") else 1
        skip = (page - 1) * page_size
        total = await database.tickets.count_documents(query)
        docs = (
            await database.tickets.find(query)
            .sort(sort_field, sort_direction)
            .skip(skip)
            .limit(page_size)
            .to_list(length=page_size)
        )
        return {"tickets": [_out(d) for d in docs], "total": total, "page": page, "page_size": page_size}

    async def get_ticket_admin(self, current_user: CurrentUser, ticket_id: str) -> dict:
        doc = await self._find_ticket(ticket_id)
        if not doc.get("read_by_admin"):
            await database.tickets.update_one(
                {"_id": doc["_id"]}, {"$set": {"read_by_admin": True, "updated_at": datetime.now(UTC)}}
            )
        replies = (
            await database.ticket_replies.find({"ticket_id": doc["_id"]})
            .sort("created_at", 1)
            .to_list(length=500)
        )
        return {"ticket": _out(doc), "replies": [_reply_out(r) for r in replies]}

    async def update_ticket(
        self, current_user: CurrentUser, ticket_id: str, request: TicketUpdateRequest, is_admin: bool = False
    ) -> dict:
        doc = await self._find_ticket(ticket_id) if is_admin else await self._find_owned(ticket_id, current_user)
        now = datetime.now(UTC)
        updates: dict = {}
        changes = []
        fields = (
            "subject", "description", "category", "priority", "affected_module",
            "browser", "os", "steps_to_reproduce", "expected_behaviour",
            "actual_behaviour", "additional_notes",
        )
        for field in fields:
            value = getattr(request, field)
            if value is not None and value != doc.get(field):
                updates[field] = value
                changes.append((field, doc.get(field), value))
        if not updates:
            return {"message": "No changes to apply.", "ticket": _out(doc)}
        updates["updated_at"] = now
        await database.tickets.update_one({"_id": doc["_id"]}, {"$set": updates})
        for field, old, new in changes:
            await self._log_activity(
                str(doc["_id"]),
                current_user.id,
                current_user.email,
                f"ticket_{field}_updated",
                f"{field.replace('_', ' ')} updated.",
                old_value=old,
                new_value=new,
            )
        await self._log_audit(
            str(doc["_id"]),
            current_user.id,
            current_user.email,
            "ticket_updated",
            old_value={f: doc.get(f) for f, _, _ in changes},
            new_value={f: v for f, _, v in changes},
        )
        if str(doc.get("created_by")) != str(current_user.id):
            await self._notify_creator(
                doc,
                notif_type="ticket_updated",
                title=f"Ticket {doc.get('ticket_id')} updated",
                message=f"{current_user.full_name} updated your ticket {doc.get('ticket_id')}.",
                link=CREATOR_TICKETS_LINK,
            )
        updated = await self._find_ticket(str(doc["_id"]))
        return {"message": "Ticket updated.", "ticket": _out(updated)}

    async def assign_ticket(self, current_user: CurrentUser, ticket_id: str, request) -> dict:
        doc = await self._find_ticket(ticket_id)
        if doc.get("status") in ("closed", "resolved"):
            raise HTTPException(status_code=409, detail="You cannot assign a closed or resolved ticket.")
        conditions = [{"user_id": request.assignee_id}, {"supabase_user_id": request.assignee_id}]
        if ObjectId.is_valid(request.assignee_id):
            conditions.append({"_id": ObjectId(request.assignee_id)})
        assignee = await database.super_admins.find_one({"$or": conditions, "status": "active"})
        if not assignee:
            raise HTTPException(status_code=400, detail="Assignee not found.")
        now = datetime.now(UTC)
        old = doc.get("assignee_id")
        await database.tickets.update_one(
            {"_id": doc["_id"]},
            {
                "$set": {
                    "assignee_id": request.assignee_id,
                    "assignee_name": assignee.get("full_name"),
                    "assignee_email": assignee.get("email"),
                    "updated_at": now,
                }
            },
        )
        await self._log_activity(
            str(doc["_id"]),
            current_user.id,
            current_user.email,
            "ticket_assigned",
            f"Ticket {doc.get('ticket_id')} assigned to {assignee.get('full_name')}.",
            old_value=old,
            new_value=request.assignee_id,
        )
        await self._log_audit(
            str(doc["_id"]),
            current_user.id,
            current_user.email,
            "ticket_assigned",
            old_value=old,
            new_value=request.assignee_id,
        )
        await create_notification(
            recipient_id=request.assignee_id,
            recipient_role="super_admin",
            notif_type="ticket_assigned",
            title="Ticket assigned to you",
            message=f"{current_user.full_name} assigned {doc.get('ticket_id')} to you: {doc.get('subject')}",
            link=ADMIN_TICKETS_LINK,
            related_id=str(doc["_id"]),
        )
        updated = await self._find_ticket(str(doc["_id"]))
        return {"message": "Ticket assigned.", "ticket": _out(updated)}

    async def update_status(self, current_user: CurrentUser, ticket_id: str, request) -> dict:
        doc = await self._find_ticket(ticket_id)
        new_status = request.status
        old_status = doc.get("status")
        if new_status == old_status:
            return {"message": f"Ticket status is already {old_status}.", "ticket": _out(doc)}
        now = datetime.now(UTC)
        updates: dict = {"status": new_status, "updated_at": now}
        if new_status == "resolved":
            updates["resolved_at"] = now
            updates["closed_at"] = None
        elif new_status == "closed":
            updates["closed_at"] = now
        else:
            updates["resolved_at"] = None
            updates["closed_at"] = None
        await database.tickets.update_one({"_id": doc["_id"]}, {"$set": updates})
        await self._log_activity(
            str(doc["_id"]),
            current_user.id,
            current_user.email,
            "ticket_status_updated",
            f"Status changed from {old_status} to {new_status}.",
            old_value=old_status,
            new_value=new_status,
        )
        await self._log_audit(
            str(doc["_id"]),
            current_user.id,
            current_user.email,
            "ticket_status_updated",
            old_value=old_status,
            new_value=new_status,
        )
        await self._notify_creator(
            doc,
            notif_type="ticket_status_updated",
            title=f"Ticket {doc.get('ticket_id')} status changed",
            message=f"Your ticket {doc.get('ticket_id')} is now {new_status}.",
            link=CREATOR_TICKETS_LINK,
        )
        updated = await self._find_ticket(str(doc["_id"]))
        return {"message": "Ticket status updated.", "ticket": _out(updated)}

    async def update_priority(self, current_user: CurrentUser, ticket_id: str, request) -> dict:
        doc = await self._find_ticket(ticket_id)
        new_priority = request.priority
        old_priority = doc.get("priority")
        if new_priority == old_priority:
            return {"message": f"Ticket priority is already {old_priority}.", "ticket": _out(doc)}
        now = datetime.now(UTC)
        await database.tickets.update_one(
            {"_id": doc["_id"]}, {"$set": {"priority": new_priority, "updated_at": now}}
        )
        await self._log_activity(
            str(doc["_id"]),
            current_user.id,
            current_user.email,
            "ticket_priority_updated",
            f"Priority changed from {old_priority} to {new_priority}.",
            old_value=old_priority,
            new_value=new_priority,
        )
        await self._log_audit(
            str(doc["_id"]),
            current_user.id,
            current_user.email,
            "ticket_priority_updated",
            old_value=old_priority,
            new_value=new_priority,
        )
        await self._notify_creator(
            doc,
            notif_type="ticket_priority_updated",
            title=f"Ticket {doc.get('ticket_id')} priority changed",
            message=f"Your ticket {doc.get('ticket_id')} priority is now {new_priority}.",
            link=CREATOR_TICKETS_LINK,
        )
        updated = await self._find_ticket(str(doc["_id"]))
        return {"message": "Ticket priority updated.", "ticket": _out(updated)}

    async def reply_to_ticket_admin(self, current_user: CurrentUser, ticket_id: str, request) -> dict:
        doc = await self._find_ticket(ticket_id)
        now = datetime.now(UTC)
        reply = {
            "ticket_id": doc["_id"],
            "message": request.message,
            "sender_id": current_user.id,
            "sender_name": current_user.full_name,
            "sender_email": current_user.email,
            "sender_role": current_user.role,
            "is_admin": True,
            "attachments": [],
            "created_at": now,
        }
        result = await database.ticket_replies.insert_one(reply)
        reply["_id"] = result.inserted_id
        await database.tickets.update_one(
            {"_id": doc["_id"]}, {"$set": {"read_by_creator": False, "updated_at": now}}
        )
        await self._log_activity(
            str(doc["_id"]),
            current_user.id,
            current_user.email,
            "ticket_replied",
            f"{current_user.full_name} replied to {doc.get('ticket_id')}.",
            new_value=request.message[:200],
        )
        await self._log_audit(
            str(doc["_id"]),
            current_user.id,
            current_user.email,
            "ticket_replied",
            old_value=None,
            new_value={"reply_id": str(result.inserted_id), "is_admin": True},
        )
        await self._notify_creator(
            doc,
            notif_type="ticket_replied",
            title=f"New reply on {doc.get('ticket_id')}",
            message=f"{current_user.full_name} replied to your ticket {doc.get('ticket_id')}: {request.message[:200]}",
            link=CREATOR_TICKETS_LINK,
        )
        return {"message": "Reply sent.", "reply": _reply_out(reply)}

    async def close_ticket_admin(self, current_user: CurrentUser, ticket_id: str) -> dict:
        doc = await self._find_ticket(ticket_id)
        if doc.get("status") == "closed":
            return {"message": "Ticket already closed.", "ticket": _out(doc)}
        now = datetime.now(UTC)
        await database.tickets.update_one(
            {"_id": doc["_id"]},
            {"$set": {"status": "closed", "closed_at": now, "updated_at": now}},
        )
        await self._log_activity(
            str(doc["_id"]),
            current_user.id,
            current_user.email,
            "ticket_closed",
            f"{current_user.full_name} closed {doc.get('ticket_id')}.",
            old_value=doc.get("status"),
            new_value="closed",
        )
        await self._log_audit(
            str(doc["_id"]),
            current_user.id,
            current_user.email,
            "ticket_closed",
            old_value=doc.get("status"),
            new_value="closed",
        )
        await self._notify_creator(
            doc,
            notif_type="ticket_closed",
            title=f"Ticket {doc.get('ticket_id')} closed",
            message=f"Your ticket {doc.get('ticket_id')} has been closed.",
            link=CREATOR_TICKETS_LINK,
        )
        updated = await self._find_ticket(str(doc["_id"]))
        return {"message": "Ticket closed.", "ticket": _out(updated)}

    async def resolve_ticket(self, current_user: CurrentUser, ticket_id: str) -> dict:
        doc = await self._find_ticket(ticket_id)
        if doc.get("status") == "resolved":
            return {"message": "Ticket already resolved.", "ticket": _out(doc)}
        now = datetime.now(UTC)
        await database.tickets.update_one(
            {"_id": doc["_id"]},
            {"$set": {"status": "resolved", "resolved_at": now, "closed_at": None, "updated_at": now}},
        )
        await self._log_activity(
            str(doc["_id"]),
            current_user.id,
            current_user.email,
            "ticket_resolved",
            f"{current_user.full_name} resolved {doc.get('ticket_id')}.",
            old_value=doc.get("status"),
            new_value="resolved",
        )
        await self._log_audit(
            str(doc["_id"]),
            current_user.id,
            current_user.email,
            "ticket_resolved",
            old_value=doc.get("status"),
            new_value="resolved",
        )
        await self._notify_creator(
            doc,
            notif_type="ticket_resolved",
            title=f"Ticket {doc.get('ticket_id')} resolved",
            message=f"Your ticket {doc.get('ticket_id')} has been resolved.",
            link=CREATOR_TICKETS_LINK,
        )
        updated = await self._find_ticket(str(doc["_id"]))
        return {"message": "Ticket resolved.", "ticket": _out(updated)}

    async def reopen_ticket(self, current_user: CurrentUser, ticket_id: str) -> dict:
        doc = await self._find_ticket(ticket_id)
        if doc.get("status") not in ("closed", "resolved"):
            raise HTTPException(status_code=409, detail="Only closed or resolved tickets can be reopened.")
        now = datetime.now(UTC)
        await database.tickets.update_one(
            {"_id": doc["_id"]},
            {"$set": {"status": "open", "resolved_at": None, "closed_at": None, "updated_at": now}},
        )
        await self._log_activity(
            str(doc["_id"]),
            current_user.id,
            current_user.email,
            "ticket_reopened",
            f"{current_user.full_name} reopened {doc.get('ticket_id')}.",
            old_value=doc.get("status"),
            new_value="open",
        )
        await self._log_audit(
            str(doc["_id"]),
            current_user.id,
            current_user.email,
            "ticket_reopened",
            old_value=doc.get("status"),
            new_value="open",
        )
        await self._notify_creator(
            doc,
            notif_type="ticket_reopened",
            title=f"Ticket {doc.get('ticket_id')} reopened",
            message=f"Your ticket {doc.get('ticket_id')} has been reopened.",
            link=CREATOR_TICKETS_LINK,
        )
        updated = await self._find_ticket(str(doc["_id"]))
        return {"message": "Ticket reopened.", "ticket": _out(updated)}

    async def delete_ticket(self, current_user: CurrentUser, ticket_id: str) -> dict:
        doc = await self._find_ticket(ticket_id)
        now = datetime.now(UTC)
        await database.tickets.update_one(
            {"_id": doc["_id"]},
            {"$set": {"deleted_at": now, "status": "closed", "closed_at": now, "updated_at": now}},
        )
        await self._log_activity(
            str(doc["_id"]),
            current_user.id,
            current_user.email,
            "ticket_deleted",
            f"{current_user.full_name} deleted {doc.get('ticket_id')}.",
        )
        await self._log_audit(
            str(doc["_id"]),
            current_user.id,
            current_user.email,
            "ticket_deleted",
            old_value=doc.get("status"),
            new_value="deleted",
        )
        return {"message": f"Ticket {doc.get('ticket_id')} deleted.", "ticket_id": str(doc["_id"])}

    async def merge_tickets(self, current_user: CurrentUser, ticket_id: str, request) -> dict:
        source = await self._find_ticket(ticket_id)
        target = await self._find_ticket(request.target_ticket_id)
        if str(source["_id"]) == str(target["_id"]):
            raise HTTPException(status_code=400, detail="A ticket cannot be merged into itself.")
        if source.get("merged_into"):
            raise HTTPException(
                status_code=409, detail=f"Ticket {source.get('ticket_id')} has already been merged."
            )
        now = datetime.now(UTC)
        await database.tickets.update_one(
            {"_id": source["_id"]},
            {
                "$set": {
                    "status": "closed",
                    "closed_at": now,
                    "deleted_at": now,
                    "merged_into": target.get("ticket_id"),
                    "updated_at": now,
                }
            },
        )
        merged_from = target.get("merged_from") or []
        await database.tickets.update_one(
            {"_id": target["_id"]},
            {
                "$set": {
                    "merged_from": [*merged_from, source.get("ticket_id")],
                    "merge_count": len(merged_from) + 1,
                    "updated_at": now,
                }
            },
        )
        await self._log_activity(
            str(source["_id"]),
            current_user.id,
            current_user.email,
            "ticket_merged",
            f"{source.get('ticket_id')} merged into {target.get('ticket_id')}.",
            new_value=target.get("ticket_id"),
        )
        await self._log_activity(
            str(target["_id"]),
            current_user.id,
            current_user.email,
            "ticket_merged",
            f"{source.get('ticket_id')} merged into this ticket.",
            new_value=source.get("ticket_id"),
        )
        await self._log_audit(
            str(source["_id"]),
            current_user.id,
            current_user.email,
            "ticket_merged",
            old_value=source.get("status"),
            new_value={"target": target.get("ticket_id"), "status": "closed"},
        )
        await self._notify_creator(
            source,
            notif_type="ticket_merged",
            title="Your ticket was merged",
            message=f"Your ticket {source.get('ticket_id')} was merged into {target.get('ticket_id')}.",
            link=CREATOR_TICKETS_LINK,
        )
        if str(target.get("created_by")) != str(source.get("created_by")):
            await self._notify_creator(
                target,
                notif_type="ticket_merged",
                title="Ticket merged into your ticket",
                message=f"{source.get('ticket_id')} was merged into {target.get('ticket_id')}.",
                link=CREATOR_TICKETS_LINK,
            )
        updated_target = await self._find_ticket(str(target["_id"]))
        return {
            "message": f"Ticket {source.get('ticket_id')} merged into {target.get('ticket_id')}.",
            "ticket": _out(updated_target),
        }

    async def get_activity(self, current_user: CurrentUser, ticket_id: str) -> dict:
        doc = await self._find_ticket(ticket_id)
        items = (
            await database.ticket_activity.find({"ticket_id": doc["_id"]})
            .sort("created_at", -1)
            .to_list(length=500)
        )
        return {
            "ticket_id": str(doc["_id"]),
            "activity": [_activity_out(a) for a in items],
            "count": len(items),
        }

    async def get_audit_logs(self, current_user: CurrentUser, ticket_id: str) -> dict:
        doc = await self._find_ticket(ticket_id)
        items = (
            await database.ticket_audit_logs.find({"ticket_id": doc["_id"]})
            .sort("created_at", -1)
            .to_list(length=500)
        )
        return {
            "ticket_id": str(doc["_id"]),
            "audit_logs": [_audit_out(a) for a in items],
            "count": len(items),
        }

    async def get_ticket_stats(self, current_user: CurrentUser) -> dict:
        now = datetime.now(UTC)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        week_start = today_start - timedelta(days=today_start.weekday())
        month_start = today_start.replace(day=1)
        base: dict = {"deleted_at": None}
        by_status = {s: await database.tickets.count_documents({**base, "status": s}) for s in TICKET_STATUSES}
        by_priority = {p: await database.tickets.count_documents({**base, "priority": p}) for p in TICKET_PRIORITIES}
        by_category = {c: await database.tickets.count_documents({**base, "category": c}) for c in sorted(TICKET_CATEGORIES)}
        by_module = {m: await database.tickets.count_documents({**base, "affected_module": m}) for m in sorted(TICKET_MODULES)}
        open_statuses = list({"open", "in_progress", "waiting"})
        avg_pipeline = [
            {
                "$match": {
                    **base,
                    "status": {"$in": ["resolved", "closed"]},
                    "resolved_at": {"$ne": None},
                }
            },
            {
                "$project": {
                    "hours": {"$divide": [{"$subtract": ["$resolved_at", "$created_at"]}, 3600000]}
                }
            },
            {"$group": {"_id": None, "avg_hours": {"$avg": "$hours"}, "count": {"$sum": 1}}},
        ]
        agg = await database.tickets.aggregate(avg_pipeline).to_list(length=1)
        avg_hours = agg[0]["avg_hours"] if agg else None
        return {
            "total": sum(by_status.values()),
            "by_status": by_status,
            "by_priority": by_priority,
            "by_category": by_category,
            "by_module": by_module,
            "open": sum(by_status[s] for s in open_statuses),
            "resolved": by_status["resolved"],
            "closed": by_status["closed"],
            "unassigned": await database.tickets.count_documents(
                {**base, "assignee_id": None, "status": {"$in": open_statuses}}
            ),
            "assigned": await database.tickets.count_documents(
                {**base, "assignee_id": {"$ne": None}, "status": {"$in": open_statuses}}
            ),
            "created_today": await database.tickets.count_documents({**base, "created_at": {"$gte": today_start}}),
            "created_this_week": await database.tickets.count_documents({**base, "created_at": {"$gte": week_start}}),
            "created_this_month": await database.tickets.count_documents({**base, "created_at": {"$gte": month_start}}),
            "average_resolution_time_hours": round(avg_hours, 2) if avg_hours is not None else None,
        }

    async def export_tickets(
        self,
        current_user: CurrentUser,
        format: str = "csv",
        status: str | None = None,
        priority: str | None = None,
    ) -> dict:
        if format != "csv":
            raise HTTPException(status_code=400, detail="Unsupported export format. Use 'csv'.")
        query: dict = {"deleted_at": None}
        if status:
            query["status"] = status
        if priority:
            query["priority"] = priority
        docs = await database.tickets.find(query).sort("created_at", -1).to_list(length=5000)
        rows = [
            {
                "ticket_id": d.get("ticket_id"),
                "subject": d.get("subject"),
                "status": d.get("status"),
                "priority": d.get("priority"),
                "category": d.get("category"),
                "affected_module": d.get("affected_module"),
                "created_by_name": d.get("created_by_name"),
                "created_by_email": d.get("created_by_email"),
                "organization_name": d.get("organization_name"),
                "assignee_name": d.get("assignee_name"),
                "assignee_email": d.get("assignee_email"),
                "created_at": _iso(d.get("created_at")),
                "updated_at": _iso(d.get("updated_at")),
                "resolved_at": _iso(d.get("resolved_at")),
                "closed_at": _iso(d.get("closed_at")),
            }
            for d in docs
        ]
        output = StringIO()
        fieldnames = [
            "ticket_id", "subject", "status", "priority", "category", "affected_module",
            "created_by_name", "created_by_email", "organization_name", "assignee_name",
            "assignee_email", "created_at", "updated_at", "resolved_at", "closed_at",
        ]
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
        filename = f"tickets_{datetime.now(UTC).strftime('%Y%m%d_%H%M%S')}.csv"
        return {"filename": filename, "content": output.getvalue(), "count": len(rows)}

    async def upload_attachment(
        self,
        current_user: CurrentUser,
        ticket_id: str,
        *,
        filename: str,
        content: bytes,
        is_admin: bool = False,
    ) -> dict:
        doc = await self._find_ticket(ticket_id) if is_admin else await self._find_owned(ticket_id, current_user)
        original = (filename or "attachment").strip()
        ext = Path(original).suffix.lower()
        if ext not in ALLOWED_ATTACHMENT_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail="File type not allowed. Supported: .pdf, .jpg, .jpeg, .png, .doc, .docx, .xls, .xlsx, .txt, .csv, .zip, .mp4.",
            )
        if not content:
            raise HTTPException(status_code=400, detail="The selected file is empty.")
        if len(content) > MAX_ATTACHMENT_BYTES:
            raise HTTPException(status_code=400, detail="File is too large (max 20 MB).")
        now = datetime.now(UTC)
        try:
            stored = await _storage_save_file(current_user.id, "ticket_attachments", original, content)
        except RuntimeError as exc:
            raise HTTPException(
                status_code=503,
                detail="Attachment storage is temporarily unavailable. Please try again shortly.",
            ) from exc
        attachment = {
            "file_name": original,
            "file_url": stored.get("file_url"),
            "object_path": stored.get("object_path"),
            "backend": stored.get("backend"),
            "resource_type": stored.get("resource_type") or "raw",
            "size_bytes": len(content),
            "uploaded_by": current_user.id,
            "uploaded_by_name": current_user.full_name,
            "uploaded_by_role": current_user.role,
            "uploaded_at": now,
        }
        attachments = doc.get("attachments") or []
        await database.tickets.update_one(
            {"_id": doc["_id"]},
            {"$set": {"attachments": [*attachments, attachment], "updated_at": now}},
        )
        await self._log_activity(
            str(doc["_id"]),
            current_user.id,
            current_user.email,
            "ticket_attachment_uploaded",
            f"Attachment '{original}' uploaded to {doc.get('ticket_id')}.",
        )
        await self._log_audit(
            str(doc["_id"]),
            current_user.id,
            current_user.email,
            "ticket_attachment_uploaded",
            old_value=None,
            new_value=original,
        )
        return {
            "message": "Attachment uploaded.",
            "ticket_id": str(doc["_id"]),
            "attachment": {
                **attachment,
                "uploaded_at": _iso(attachment["uploaded_at"]),
            },
        }


ticket_service = TicketService()

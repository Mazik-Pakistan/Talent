"""Employee ↔ recruiter (HR) messaging threads.

One open thread per employee–recruiter pair. Each message fans out to
in-app notification + email (email soft-fails).
"""

from __future__ import annotations

from datetime import UTC, datetime
from secrets import token_urlsafe
from typing import Any

from bson import ObjectId
from fastapi import HTTPException, status

from app.core.config import settings
from app.core.database import database
from app.core.rbac import CurrentUser
from app.services.dashboard_service import create_notification
from app.services.email_service import email_service


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


class MessageService:
    def _public_thread(self, doc: dict, *, include_messages: bool = True) -> dict:
        messages = doc.get("messages") or []
        last = messages[-1] if messages else None
        payload = {
            "id": str(doc["_id"]),
            "employee_user_id": doc.get("employee_user_id"),
            "employee_id": doc.get("employee_id"),
            "employee_name": doc.get("employee_name"),
            "employee_email": doc.get("employee_email"),
            "candidate_user_id": doc.get("candidate_user_id"),
            "candidate_id": doc.get("candidate_id"),
            "candidate_name": doc.get("candidate_name"),
            "candidate_email": doc.get("candidate_email"),
            "recruiter_id": doc.get("recruiter_id"),
            "recruiter_name": doc.get("recruiter_name"),
            "subject": doc.get("subject"),
            "status": doc.get("status") or "open",
            "updated_at": _iso(doc.get("updated_at")),
            "created_at": _iso(doc.get("created_at")),
            "message_count": len(messages),
            "last_message": (
                {
                    "sender_role": last.get("sender_role"),
                    "body": (last.get("body") or "")[:200],
                    "created_at": _iso(last.get("created_at")),
                }
                if last
                else None
            ),
        }
        if include_messages:
            payload["messages"] = [
                {
                    "id": m.get("id"),
                    "sender_role": m.get("sender_role"),
                    "sender_user_id": m.get("sender_user_id"),
                    "sender_name": m.get("sender_name"),
                    "body": m.get("body"),
                    "created_at": _iso(m.get("created_at")),
                    "email_sent": bool(m.get("email_sent")),
                }
                for m in messages
            ]
        return payload

    async def _get_employee_for_user(self, user: CurrentUser) -> dict:
        employee = await database.employees.find_one(
            {"$or": [{"user_id": user.id}, {"email": (user.email or "").lower()}]}
        )
        if not employee:
            raise HTTPException(status_code=404, detail="Employee profile not found.")
        return employee

    async def _get_candidate_for_user(self, user: CurrentUser) -> dict:
        candidate = await database.candidates.find_one(
            {
                "$or": [{"user_id": user.id}, {"email": (user.email or "").lower()}],
                "status": "active",
            }
        )
        if not candidate:
            converted = await database.candidates.find_one(
                {
                    "$or": [{"user_id": user.id}, {"email": (user.email or "").lower()}],
                    "status": "converted",
                }
            )
            if converted:
                raise HTTPException(
                    status_code=403,
                    detail="This candidate has already been converted to an employee. Sign in as Employee.",
                )
            raise HTTPException(status_code=404, detail="Candidate profile not found.")
        return candidate

    async def _get_recruiter_name(self, recruiter_id: str) -> str:
        if not recruiter_id:
            return "HR"
        doc = await database.recruiters.find_one({"$or": [{"user_id": recruiter_id}, {"_id": recruiter_id}]})
        if not doc and ObjectId.is_valid(recruiter_id):
            doc = await database.recruiters.find_one({"_id": ObjectId(recruiter_id)})
        if not doc:
            doc = await database.super_admins.find_one({"user_id": recruiter_id})
        return (doc or {}).get("full_name") or "HR"

    async def list_threads_for_employee(self, user: CurrentUser) -> dict:
        employee = await self._get_employee_for_user(user)
        docs = (
            await database.hr_threads.find({"employee_user_id": user.id})
            .sort("updated_at", -1)
            .to_list(length=50)
        )
        if not docs:
            docs = (
                await database.hr_threads.find({"employee_id": employee.get("employee_id")})
                .sort("updated_at", -1)
                .to_list(length=50)
            )
        return {"threads": [self._public_thread(d, include_messages=False) for d in docs]}

    async def list_threads_for_candidate(self, user: CurrentUser) -> dict:
        candidate = await self._get_candidate_for_user(user)
        candidate_user_id = candidate.get("user_id") or user.id
        docs = (
            await database.hr_threads.find({"candidate_user_id": candidate_user_id})
            .sort("updated_at", -1)
            .to_list(length=50)
        )
        if not docs:
            docs = (
                await database.hr_threads.find({"candidate_id": candidate.get("candidate_id")})
                .sort("updated_at", -1)
                .to_list(length=50)
            )
        return {"threads": [self._public_thread(d, include_messages=False) for d in docs]}

    async def list_threads_for_recruiter(self, user: CurrentUser) -> dict:
        query: dict = {}
        if user.role != "super_admin":
            query["recruiter_id"] = user.id
        docs = await database.hr_threads.find(query).sort("updated_at", -1).to_list(length=200)
        return {"threads": [self._public_thread(d, include_messages=False) for d in docs]}

    async def get_thread(self, user: CurrentUser, thread_id: str) -> dict:
        thread = await self._load_thread(thread_id)
        self._assert_access(user, thread)
        return {"thread": self._public_thread(thread, include_messages=True)}

    async def employee_send(
        self,
        user: CurrentUser,
        *,
        body: str,
        subject: str | None = None,
        thread_id: str | None = None,
    ) -> dict:
        text = (body or "").strip()
        if not text:
            raise HTTPException(status_code=400, detail="Message body is required.")
        employee = await self._get_employee_for_user(user)
        recruiter_id = employee.get("recruiter_id")
        if not recruiter_id:
            raise HTTPException(status_code=400, detail="No recruiter is assigned to your profile yet.")

        thread = None
        if thread_id:
            thread = await self._load_thread(thread_id)
            self._assert_access(user, thread)
            if thread.get("status") == "closed":
                raise HTTPException(status_code=400, detail="This conversation is closed.")
        else:
            thread = await database.hr_threads.find_one(
                {
                    "employee_user_id": user.id,
                    "recruiter_id": recruiter_id,
                    "status": "open",
                }
            )

        now = _now()
        msg = {
            "id": token_urlsafe(10),
            "sender_role": "employee",
            "sender_user_id": user.id,
            "sender_name": employee.get("full_name") or user.full_name,
            "body": text,
            "created_at": now,
            "email_sent": False,
        }

        if thread:
            await database.hr_threads.update_one(
                {"_id": thread["_id"]},
                {
                    "$push": {"messages": msg},
                    "$set": {"updated_at": now, "subject": thread.get("subject") or (subject or "HR conversation")},
                },
            )
            thread = await database.hr_threads.find_one({"_id": thread["_id"]})
        else:
            recruiter_name = await self._get_recruiter_name(str(recruiter_id))
            doc = {
                "employee_user_id": user.id,
                "employee_id": employee.get("employee_id"),
                "employee_name": employee.get("full_name") or user.full_name,
                "employee_email": employee.get("email") or user.email,
                "recruiter_id": recruiter_id,
                "recruiter_name": recruiter_name,
                "subject": (subject or "").strip() or "Message to HR",
                "status": "open",
                "messages": [msg],
                "created_at": now,
                "updated_at": now,
            }
            result = await database.hr_threads.insert_one(doc)
            doc["_id"] = result.inserted_id
            thread = doc

        email_sent = await self._notify_counterpart(
            thread=thread,
            message=msg,
            recipient_user_id=str(recruiter_id),
            recipient_role="recruiter",
            recipient_email=await self._recruiter_email(str(recruiter_id)),
            recipient_name=thread.get("recruiter_name") or "HR",
            sender_label=thread.get("employee_name") or "Employee",
            link=f"/dashboard/recruiter/messages?thread={thread['_id']}",
            organization_id=employee.get("organization_id"),
        )
        await database.hr_threads.update_one(
            {"_id": thread["_id"], "messages.id": msg["id"]},
            {"$set": {"messages.$.email_sent": email_sent}},
        )
        refreshed = await database.hr_threads.find_one({"_id": thread["_id"]})
        return {"thread": self._public_thread(refreshed or thread)}

    async def candidate_send(
        self,
        user: CurrentUser,
        *,
        body: str,
        subject: str | None = None,
        thread_id: str | None = None,
    ) -> dict:
        text = (body or "").strip()
        if not text:
            raise HTTPException(status_code=400, detail="Message body is required.")
        candidate = await self._get_candidate_for_user(user)
        recruiter_id = candidate.get("recruiter_id")
        if not recruiter_id:
            raise HTTPException(status_code=400, detail="No recruiter is assigned to your profile yet.")

        thread = None
        if thread_id:
            thread = await self._load_thread(thread_id)
            self._assert_access(user, thread)
            if thread.get("status") == "closed":
                raise HTTPException(status_code=400, detail="This conversation is closed.")
        else:
            thread = await database.hr_threads.find_one(
                {
                    "candidate_user_id": user.id,
                    "recruiter_id": recruiter_id,
                    "status": "open",
                }
            )

        now = _now()
        msg = {
            "id": token_urlsafe(10),
            "sender_role": "candidate",
            "sender_user_id": user.id,
            "sender_name": candidate.get("full_name") or user.full_name,
            "body": text,
            "created_at": now,
            "email_sent": False,
        }

        if thread:
            await database.hr_threads.update_one(
                {"_id": thread["_id"]},
                {
                    "$push": {"messages": msg},
                    "$set": {"updated_at": now, "subject": thread.get("subject") or (subject or "HR conversation")},
                },
            )
            thread = await database.hr_threads.find_one({"_id": thread["_id"]})
        else:
            recruiter_name = await self._get_recruiter_name(str(recruiter_id))
            doc = {
                "candidate_user_id": user.id,
                "candidate_id": candidate.get("candidate_id") or candidate.get("user_id") or str(candidate.get("_id")),
                "candidate_name": candidate.get("full_name") or user.full_name,
                "candidate_email": candidate.get("email") or user.email,
                "recruiter_id": recruiter_id,
                "recruiter_name": recruiter_name,
                "subject": (subject or "").strip() or "Message to HR",
                "status": "open",
                "messages": [msg],
                "created_at": now,
                "updated_at": now,
            }
            result = await database.hr_threads.insert_one(doc)
            doc["_id"] = result.inserted_id
            thread = doc

        email_sent = await self._notify_counterpart(
            thread=thread,
            message=msg,
            recipient_user_id=str(recruiter_id),
            recipient_role="recruiter",
            recipient_email=await self._recruiter_email(str(recruiter_id)),
            recipient_name=thread.get("recruiter_name") or "HR",
            sender_label=thread.get("candidate_name") or "Candidate",
            link=f"/dashboard/recruiter/messages?thread={thread['_id']}",
            organization_id=candidate.get("organization_id"),
        )
        await database.hr_threads.update_one(
            {"_id": thread["_id"], "messages.id": msg["id"]},
            {"$set": {"messages.$.email_sent": email_sent}},
        )
        refreshed = await database.hr_threads.find_one({"_id": thread["_id"]})
        return {"thread": self._public_thread(refreshed or thread)}

    async def recruiter_reply(self, user: CurrentUser, thread_id: str, *, body: str) -> dict:
        text = (body or "").strip()
        if not text:
            raise HTTPException(status_code=400, detail="Message body is required.")
        thread = await self._load_thread(thread_id)
        self._assert_access(user, thread)
        if thread.get("status") == "closed":
            raise HTTPException(status_code=400, detail="This conversation is closed.")

        now = _now()
        msg = {
            "id": token_urlsafe(10),
            "sender_role": "recruiter",
            "sender_user_id": user.id,
            "sender_name": user.full_name or "HR",
            "body": text,
            "created_at": now,
            "email_sent": False,
        }
        await database.hr_threads.update_one(
            {"_id": thread["_id"]},
            {"$push": {"messages": msg}, "$set": {"updated_at": now}},
        )
        thread = await database.hr_threads.find_one({"_id": thread["_id"]})

        recipient_user_id = str(thread.get("employee_user_id") or thread.get("candidate_user_id") or "")
        recipient_role = "employee" if thread.get("employee_user_id") else "candidate"
        recipient_email = thread.get("employee_email") or thread.get("candidate_email")
        recipient_name = thread.get("employee_name") or thread.get("candidate_name") or "there"
        email_sent = await self._notify_counterpart(
            thread=thread,
            message=msg,
            recipient_user_id=recipient_user_id,
            recipient_role=recipient_role,
            recipient_email=recipient_email,
            recipient_name=recipient_name,
            sender_label=user.full_name or "HR",
            link=(
                f"/dashboard/employee/messages?thread={thread['_id']}"
                if recipient_role == "employee"
                else f"/dashboard/candidate/ai-assistant?thread={thread['_id']}"
            ),
            organization_id=getattr(user, "organization_id", None),
        )
        await database.hr_threads.update_one(
            {"_id": thread["_id"], "messages.id": msg["id"]},
            {"$set": {"messages.$.email_sent": email_sent}},
        )
        refreshed = await database.hr_threads.find_one({"_id": thread["_id"]})
        return {"thread": self._public_thread(refreshed or thread)}

    async def recruiter_start(
        self,
        user: CurrentUser,
        *,
        employee_id: str,
        body: str,
        subject: str | None = None,
    ) -> dict:
        """Recruiter opens or continues a thread with an employee."""
        text = (body or "").strip()
        if not text:
            raise HTTPException(status_code=400, detail="Message body is required.")
        emp_key = (employee_id or "").strip()
        if not emp_key:
            raise HTTPException(status_code=400, detail="employee_id is required.")

        employee = None
        if ObjectId.is_valid(emp_key):
            employee = await database.employees.find_one({"_id": ObjectId(emp_key)})
        if not employee:
            employee = await database.employees.find_one({"employee_id": emp_key})
        if not employee:
            raise HTTPException(status_code=404, detail="Employee not found.")
        if user.role != "super_admin":
            if employee.get("recruiter_id") != user.id:
                raise HTTPException(status_code=403, detail="Employee is not assigned to you.")

        employee_user_id = employee.get("user_id")
        if not employee_user_id:
            raise HTTPException(status_code=400, detail="Employee has no linked user account yet.")

        thread = await database.hr_threads.find_one(
            {
                "employee_user_id": employee_user_id,
                "recruiter_id": user.id,
                "status": "open",
            }
        )
        if thread:
            return await self.recruiter_reply(user, str(thread["_id"]), body=text)

        now = _now()
        msg = {
            "id": token_urlsafe(10),
            "sender_role": "recruiter",
            "sender_user_id": user.id,
            "sender_name": user.full_name or "HR",
            "body": text,
            "created_at": now,
            "email_sent": False,
        }
        doc = {
            "employee_user_id": employee_user_id,
            "employee_id": employee.get("employee_id"),
            "employee_name": employee.get("full_name") or "Employee",
            "employee_email": employee.get("email"),
            "recruiter_id": user.id,
            "recruiter_name": user.full_name or "HR",
            "subject": (subject or "").strip() or "Message from HR",
            "status": "open",
            "messages": [msg],
            "created_at": now,
            "updated_at": now,
        }
        result = await database.hr_threads.insert_one(doc)
        doc["_id"] = result.inserted_id
        thread = doc

        email_sent = await self._notify_counterpart(
            thread=thread,
            message=msg,
            recipient_user_id=str(employee_user_id),
            recipient_role="employee",
            recipient_email=thread.get("employee_email"),
            recipient_name=thread.get("employee_name") or "there",
            sender_label=user.full_name or "HR",
            link=f"/dashboard/employee/messages?thread={thread['_id']}",
            organization_id=employee.get("organization_id"),
        )
        await database.hr_threads.update_one(
            {"_id": thread["_id"], "messages.id": msg["id"]},
            {"$set": {"messages.$.email_sent": email_sent}},
        )
        refreshed = await database.hr_threads.find_one({"_id": thread["_id"]})
        return {"thread": self._public_thread(refreshed or thread)}

    async def close_thread(self, user: CurrentUser, thread_id: str) -> dict:
        thread = await self._load_thread(thread_id)
        self._assert_access(user, thread)
        await database.hr_threads.update_one(
            {"_id": thread["_id"]},
            {"$set": {"status": "closed", "updated_at": _now()}},
        )
        refreshed = await database.hr_threads.find_one({"_id": thread["_id"]})
        return {"thread": self._public_thread(refreshed or thread)}

    async def _load_thread(self, thread_id: str) -> dict:
        if not ObjectId.is_valid(thread_id):
            raise HTTPException(status_code=404, detail="Conversation not found.")
        thread = await database.hr_threads.find_one({"_id": ObjectId(thread_id)})
        if not thread:
            raise HTTPException(status_code=404, detail="Conversation not found.")
        return thread

    def _assert_access(self, user: CurrentUser, thread: dict) -> None:
        if user.role in ("recruiter", "super_admin"):
            if user.role != "super_admin" and thread.get("recruiter_id") != user.id:
                raise HTTPException(status_code=403, detail="Not allowed.")
            return
        if user.role == "employee":
            if thread.get("employee_user_id") != user.id:
                raise HTTPException(status_code=403, detail="Not allowed.")
            return
        if user.role == "candidate":
            if thread.get("candidate_user_id") != user.id:
                raise HTTPException(status_code=403, detail="Not allowed.")
            return
        raise HTTPException(status_code=403, detail="Not allowed.")

    async def _recruiter_email(self, recruiter_id: str) -> str | None:
        doc = await database.recruiters.find_one({"user_id": recruiter_id})
        if not doc and ObjectId.is_valid(recruiter_id):
            doc = await database.recruiters.find_one({"_id": ObjectId(recruiter_id)})
        if not doc:
            doc = await database.super_admins.find_one({"user_id": recruiter_id})
        if not doc:
            user = await database.users.find_one({"_id": recruiter_id}) if not ObjectId.is_valid(recruiter_id) else None
            if not user and ObjectId.is_valid(recruiter_id):
                user = await database.users.find_one({"_id": ObjectId(recruiter_id)})
            return (user or {}).get("email")
        return doc.get("email")

    async def _notify_counterpart(
        self,
        *,
        thread: dict,
        message: dict,
        recipient_user_id: str,
        recipient_role: str,
        recipient_email: str | None,
        recipient_name: str,
        sender_label: str,
        link: str,
        organization_id: str | None = None,
    ) -> bool:
        subject = thread.get("subject") or "HR conversation"
        preview = (message.get("body") or "")[:160]
        if recipient_user_id:
            await create_notification(
                recipient_id=recipient_user_id,
                recipient_role=recipient_role,
                notif_type="hr_message",
                title=f"New message: {subject}",
                message=f"{sender_label}: {preview}",
                link=link,
                related_id=str(thread["_id"]),
            )

        email_sent = False
        if recipient_email:
            try:
                email_service.send_hr_message(
                    recipient_email,
                    recipient_name,
                    subject_line=subject,
                    body_text=message.get("body") or "",
                    sender_label=sender_label,
                    cta_link=f"{settings.frontend_base_url}{link}",
                    organization_id=organization_id,
                )
                email_sent = True
            except Exception:  # noqa: BLE001
                email_sent = False
        return email_sent


message_service = MessageService()

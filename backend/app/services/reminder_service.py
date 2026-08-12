"""Unified recruiter reminders (email + in-app notification).

Kinds: onboarding | profile | reupload | course | general.
Onboarding/profile delegate to existing employee_service methods.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import HTTPException, status

from app.core.config import settings
from app.core.database import database
from app.core.rbac import CurrentUser
from app.services.dashboard_service import create_notification
from app.services.email_service import email_service
from app.services.employee_service import EmployeeService
from app.services.organization_service import recruiter_can_access_record

REMINDER_KINDS = frozenset({"onboarding", "profile", "reupload", "course", "general"})
THROTTLE_SECONDS = 3600


class ReminderService:
    def __init__(self) -> None:
        self.employees = EmployeeService()

    async def send_employee_reminder(
        self,
        current_user: CurrentUser,
        employee_id: str,
        *,
        kind: str = "general",
        note: str | None = None,
        force: bool = False,
    ) -> dict:
        kind = (kind or "general").strip().lower()
        if kind not in REMINDER_KINDS:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid kind. Use one of: {', '.join(sorted(REMINDER_KINDS))}.",
            )
        if kind == "onboarding":
            raise HTTPException(status_code=400, detail="Use candidate remind for onboarding reminders.")
        if kind == "profile":
            return await self.employees.remind_profile_completion(
                current_user, employee_id, note, force=force
            )

        employee = await self.employees._resolve_employee_for_recruiter(current_user, employee_id)
        note_text = (note or "").strip() or None
        await self._throttle(employee, field="person_reminder_sent_at", force=force)

        if kind == "reupload":
            return await self._remind_reupload(current_user, employee, note_text)
        if kind == "course":
            return await self._remind_course(current_user, employee, note_text)
        return await self._remind_general(current_user, employee, note_text, role="employee")

    async def send_candidate_reminder(
        self,
        current_user: CurrentUser,
        candidate_id: str,
        *,
        kind: str = "onboarding",
        note: str | None = None,
        force: bool = False,
    ) -> dict:
        kind = (kind or "onboarding").strip().lower()
        if kind not in REMINDER_KINDS - {"profile", "course"}:
            # Candidates: onboarding, reupload, general
            if kind in ("profile", "course"):
                raise HTTPException(status_code=400, detail=f"kind={kind} is only for employees.")
            raise HTTPException(
                status_code=400,
                detail="Invalid kind. Use onboarding, reupload, or general for candidates.",
            )
        if kind == "onboarding":
            return await self.employees.remind_candidate_onboarding(
                current_user, candidate_id, note, force=force
            )

        candidate = await self.employees._find_candidate(candidate_id)
        if not candidate:
            raise HTTPException(status_code=404, detail="Candidate not found.")
        if current_user.role != "super_admin":
            if not await recruiter_can_access_record(current_user, candidate):
                raise HTTPException(status_code=403, detail="Not allowed.")

        note_text = (note or "").strip() or None
        await self._throttle(candidate, field="person_reminder_sent_at", force=force, collection="candidates")

        if kind == "reupload":
            return await self._remind_candidate_reupload(current_user, candidate, note_text)
        return await self._remind_general(current_user, candidate, note_text, role="candidate")

    async def remind_courses(
        self,
        current_user: CurrentUser,
        *,
        employee_id: str | None = None,
        email: str | None = None,
        note: str | None = None,
        force: bool = False,
    ) -> dict:
        target = employee_id or email
        if not target:
            raise HTTPException(status_code=400, detail="employee_id or email is required.")
        employee = await self.employees._resolve_employee_for_recruiter(current_user, str(target))
        note_text = (note or "").strip() or None
        await self._throttle(employee, field="course_reminder_sent_at", force=force)
        return await self._remind_course(current_user, employee, note_text)

    async def _throttle(
        self,
        person: dict,
        *,
        field: str,
        force: bool,
        collection: str = "employees",
    ) -> None:
        if force:
            return
        last_sent = person.get(field)
        if not last_sent:
            return
        last_dt = last_sent if isinstance(last_sent, datetime) else None
        if last_dt and last_dt.tzinfo is None:
            last_dt = last_dt.replace(tzinfo=UTC)
        if last_dt and (datetime.now(UTC) - last_dt).total_seconds() < THROTTLE_SECONDS:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="A reminder was already sent within the last hour. Resend with force=true to bypass.",
            )
        _ = collection  # reserved for future per-collection throttle keys

    async def _stamp(self, person: dict, *, field: str, collection: str, recruiter_id: str) -> None:
        now = datetime.now(UTC)
        await database[collection].update_one(
            {"_id": person["_id"]},
            {"$set": {field: now, f"{field}_by": recruiter_id, "updated_at": now}},
        )

    async def _remind_reupload(self, current_user: CurrentUser, employee: dict, note_text: str | None) -> dict:
        owner_id = employee.get("user_id") or str(employee.get("_id"))
        docs = await database.documents.find(
            {
                "owner_id": owner_id,
                "is_active": True,
                "status": {"$in": ["pending", "uploaded", "reupload_required", "rejected", "mismatch"]},
            }
        ).to_list(length=50)
        labels = []
        for d in docs:
            label = (d.get("doc_type") or "document").replace("_", " ")
            st = d.get("status") or "pending"
            labels.append(f"{label} ({st})")
        if not labels:
            labels = ["Please review and re-upload any requested documents"]

        title = "Document re-upload reminder"
        body = "Your recruiter needs updated documents from you.\n" + "\n".join(f"• {x}" for x in labels)
        link = "/documents"
        return await self._deliver(
            current_user,
            person=employee,
            role="employee",
            collection="employees",
            stamp_field="person_reminder_sent_at",
            notif_type="document_reupload_reminder",
            title=title,
            message=body + (f" Note: {note_text}" if note_text else ""),
            link=link,
            email_title=title,
            email_body=body,
            cta_link=f"{settings.frontend_base_url}/documents",
            cta_label="Open documents",
            note_text=note_text,
        )

    async def _remind_candidate_reupload(
        self, current_user: CurrentUser, candidate: dict, note_text: str | None
    ) -> dict:
        owner_id = candidate.get("user_id") or str(candidate.get("_id"))
        docs = await database.documents.find(
            {
                "owner_id": owner_id,
                "is_active": True,
                "status": {"$in": ["pending", "uploaded", "reupload_required", "rejected", "mismatch"]},
            }
        ).to_list(length=50)
        labels = [
            f"{(d.get('doc_type') or 'document').replace('_', ' ')} ({d.get('status') or 'pending'})"
            for d in docs
        ] or ["Please re-upload any documents your recruiter requested"]

        title = "Document re-upload reminder"
        body = "Your recruiter needs updated documents from you.\n" + "\n".join(f"• {x}" for x in labels)
        return await self._deliver(
            current_user,
            person=candidate,
            role="candidate",
            collection="candidates",
            stamp_field="person_reminder_sent_at",
            notif_type="document_reupload_reminder",
            title=title,
            message=body + (f" Note: {note_text}" if note_text else ""),
            link="/documents",
            email_title=title,
            email_body=body,
            cta_link=f"{settings.frontend_base_url}/documents",
            cta_label="Open documents",
            note_text=note_text,
        )

    async def _remind_course(self, current_user: CurrentUser, employee: dict, note_text: str | None) -> dict:
        eid = employee.get("employee_id")
        uid = employee.get("user_id")
        query: dict = {"status": {"$in": ["assigned", "in_progress"]}}
        if eid:
            query["employee_id"] = eid
        elif uid:
            query["user_id"] = uid
        else:
            raise HTTPException(status_code=400, detail="Employee has no id for course lookup.")

        assignments = await database.learning_assignments.find(query).sort("created_at", -1).to_list(length=30)
        if not assignments:
            raise HTTPException(status_code=400, detail="This employee has no open course assignments.")

        titles = [a.get("course_title") or a.get("course_uid") or "Course" for a in assignments[:8]]
        title = "Course reminder"
        body = "Please complete your assigned learning:\n" + "\n".join(f"• {t}" for t in titles)
        return await self._deliver(
            current_user,
            person=employee,
            role="employee",
            collection="employees",
            stamp_field="course_reminder_sent_at",
            notif_type="course_reminder",
            title=title,
            message=body + (f" Note: {note_text}" if note_text else ""),
            link="/dashboard/employee/learning",
            email_title=title,
            email_body=body,
            cta_link=f"{settings.frontend_base_url}/dashboard/employee/learning",
            cta_label="Open Learning",
            note_text=note_text,
        )

    async def _remind_general(
        self,
        current_user: CurrentUser,
        person: dict,
        note_text: str | None,
        *,
        role: str,
    ) -> dict:
        if not note_text:
            raise HTTPException(status_code=400, detail="A note is required for general reminders.")
        title = "Message from your recruiter"
        body = note_text
        if role == "employee":
            link = "/dashboard/employee"
            cta = f"{settings.frontend_base_url}/dashboard/employee"
            collection = "employees"
        else:
            link = "/dashboard/candidate"
            cta = f"{settings.frontend_base_url}/dashboard/candidate"
            collection = "candidates"
        return await self._deliver(
            current_user,
            person=person,
            role=role,
            collection=collection,
            stamp_field="person_reminder_sent_at",
            notif_type="general_reminder",
            title=title,
            message=body,
            link=link,
            email_title=title,
            email_body=body,
            cta_link=cta,
            cta_label="Open dashboard",
            note_text=None,  # note already is the body
        )

    async def _deliver(
        self,
        current_user: CurrentUser,
        *,
        person: dict,
        role: str,
        collection: str,
        stamp_field: str,
        notif_type: str,
        title: str,
        message: str,
        link: str,
        email_title: str,
        email_body: str,
        cta_link: str,
        cta_label: str,
        note_text: str | None,
    ) -> dict:
        recipient_id = person.get("user_id")
        if not recipient_id:
            user = await database.users.find_one({"email": (person.get("email") or "").lower()})
            if user:
                recipient_id = str(user["_id"])

        notification_sent = False
        if recipient_id:
            nid = await create_notification(
                recipient_id=str(recipient_id),
                recipient_role=role,
                notif_type=notif_type,
                title=title,
                message=message,
                link=link,
                related_id=person.get("employee_id") or person.get("user_id") or str(person.get("_id")),
            )
            notification_sent = bool(nid)

        email_sent = False
        email_error = None
        to_email = person.get("email")
        if not to_email:
            email_error = "No email address on file."
        else:
            try:
                email_service.send_custom_reminder(
                    to_email,
                    person.get("full_name") or "there",
                    title=email_title,
                    body_text=email_body,
                    cta_link=cta_link,
                    cta_label=cta_label,
                    recruiter_note=note_text,
                    organization_id=getattr(current_user, "organization_id", None),
                )
                email_sent = True
            except Exception as exc:  # noqa: BLE001
                email_error = str(exc)

        await self._stamp(person, field=stamp_field, collection=collection, recruiter_id=current_user.id)

        if not email_sent and not notification_sent:
            raise HTTPException(
                status_code=502,
                detail=f"Reminder failed: {email_error or 'could not notify recipient'}.",
            )

        return {
            "message": "Reminder sent.",
            "email_sent": email_sent,
            "notification_sent": notification_sent,
            "email_error": email_error,
            "kind": notif_type,
        }


reminder_service = ReminderService()

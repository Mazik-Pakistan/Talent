"""IT service requests — post-activation IT help (e.g. replacement laptop).

Flow: recruiter/HR raises a request for an existing employee (optionally the
employee creates a draft first) → recruiter sends it to an IT officer by email
→ IT opens the fulfillment link and marks it fulfilled → recruiter and employee
are notified.
"""

from __future__ import annotations

from datetime import UTC, datetime
from secrets import token_urlsafe

from fastapi import HTTPException

from app.core.config import settings
from app.core.database import database
from app.core.rbac import CurrentUser
from app.schemas.it_service_request import (
    ItServiceRequestCancelRequest,
    ItServiceRequestCreate,
    ItServiceRequestEmployeeCreate,
    ItServiceRequestFulfillRequest,
    ItServiceRequestSendRequest,
)
from app.services.dashboard_service import create_notification
from app.services.email_service import email_service


def _iso(value):
    return value.isoformat() if hasattr(value, "isoformat") else value


def _out(doc: dict) -> dict:
    return {
        "request_id": str(doc["_id"]),
        "employee_id": doc.get("employee_id"),
        "employee_name": doc.get("employee_name"),
        "employee_email": doc.get("employee_email"),
        "job_title": doc.get("job_title"),
        "department": doc.get("department"),
        "request_type": doc.get("request_type"),
        "title": doc.get("title"),
        "description": doc.get("description"),
        "it_manager_email": doc.get("it_manager_email"),
        "status": doc.get("status"),
        "note": doc.get("note"),
        "fulfillment_note": doc.get("fulfillment_note"),
        "serial_number": doc.get("serial_number"),
        "items": doc.get("items") or [],
        "created_by": doc.get("created_by"),
        "requested_by_name": doc.get("requested_by_name"),
        "created_at": _iso(doc.get("created_at")),
        "sent_at": _iso(doc.get("sent_at")),
        "fulfilled_at": _iso(doc.get("fulfilled_at")),
        "fulfilled_by_name": doc.get("fulfilled_by_name"),
    }


class ItServiceRequestService:
    async def _employee_by_user(self, current_user: CurrentUser) -> dict:
        emp = await database.employees.find_one(
            {
                "$or": [
                    {"user_id": current_user.id},
                    {"user_id": str(current_user.id)},
                    {"email": current_user.email},
                ]
            }
        )
        if not emp:
            raise HTTPException(status_code=404, detail="Employee profile not found.")
        return emp

    async def _find_employee(self, employee_id: str) -> dict:
        emp = await database.employees.find_one({"employee_id": employee_id})
        if not emp:
            raise HTTPException(status_code=404, detail="Employee not found.")
        return emp

    async def _get_owned(self, request_id: str, current_user: CurrentUser) -> dict:
        if not request_id:
            raise HTTPException(status_code=404, detail="IT request not found.")
        try:
            from bson import ObjectId

            oid = ObjectId(request_id)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=404, detail="IT request not found.") from exc
        doc = await database.it_service_requests.find_one({"_id": oid})
        if not doc or str(doc.get("recruiter_id")) != str(current_user.id):
            raise HTTPException(status_code=404, detail="IT request not found.")
        return doc

    def _employee_payload(self, emp: dict, request: ItServiceRequestCreate) -> dict:
        return {
            "employee_id": emp.get("employee_id"),
            "employee_user_id": str(emp.get("user_id")) if emp.get("user_id") else None,
            "employee_name": emp.get("full_name"),
            "employee_email": emp.get("email"),
            "job_title": emp.get("job_title"),
            "department": emp.get("department"),
            "request_type": request.request_type,
            "title": request.title,
            "description": request.description,
        }

    async def list_recruiter(self, current_user: CurrentUser, status_filter: str | None = None) -> dict:
        query: dict = {"recruiter_id": current_user.id}
        if status_filter:
            query["status"] = status_filter
        docs = await database.it_service_requests.find(query).sort("created_at", -1).to_list(length=200)
        return {"requests": [_out(d) for d in docs], "count": len(docs)}

    async def list_employee(self, current_user: CurrentUser) -> dict:
        emp = await self._employee_by_user(current_user)
        docs = (
            await database.it_service_requests.find({"employee_id": emp.get("employee_id")})
            .sort("created_at", -1)
            .to_list(length=100)
        )
        return {"requests": [_out(d) for d in docs], "count": len(docs)}

    async def create_for_employee(self, current_user: CurrentUser, request: ItServiceRequestCreate) -> dict:
        emp = await self._find_employee(request.employee_id)
        now = datetime.now(UTC)
        doc = {
            "token": token_urlsafe(32),
            **self._employee_payload(emp, request),
            "recruiter_id": current_user.id,
            "recruiter_name": current_user.full_name,
            "recruiter_email": current_user.email,
            "it_manager_email": None,
            "status": "draft",
            "note": request.note,
            "created_by": "recruiter",
            "requested_by_name": current_user.full_name,
            "created_at": now,
            "updated_at": now,
        }
        result = await database.it_service_requests.insert_one(doc)
        doc["_id"] = result.inserted_id
        if request.it_manager_email:
            await self._send_to_it_doc(doc, str(request.it_manager_email).strip().lower(), request.note, now)
        return _out(doc)

    async def create_employee_draft(self, current_user: CurrentUser, request: ItServiceRequestEmployeeCreate) -> dict:
        emp = await self._employee_by_user(current_user)
        now = datetime.now(UTC)
        doc = {
            "token": token_urlsafe(32),
            "employee_id": emp.get("employee_id"),
            "employee_user_id": str(emp.get("user_id")) if emp.get("user_id") else None,
            "employee_name": emp.get("full_name"),
            "employee_email": emp.get("email"),
            "job_title": emp.get("job_title"),
            "department": emp.get("department"),
            "request_type": request.request_type,
            "title": request.title,
            "description": request.description,
            "recruiter_id": str(emp.get("recruiter_id")) if emp.get("recruiter_id") else None,
            "recruiter_name": None,
            "recruiter_email": None,
            "it_manager_email": None,
            "status": "draft",
            "note": None,
            "created_by": "employee",
            "requested_by_name": emp.get("full_name"),
            "created_at": now,
            "updated_at": now,
        }
        result = await database.it_service_requests.insert_one(doc)
        doc["_id"] = result.inserted_id
        if doc.get("recruiter_id"):
            await create_notification(
                recipient_id=doc["recruiter_id"],
                recipient_role="recruiter",
                notif_type="it_service_request_draft",
                title="IT support request from employee",
                message=f"{emp.get('full_name')} needs IT help: {request.title}.",
                link="/dashboard/recruiter/it",
                related_id=str(doc["_id"]),
            )
        return _out(doc)

    async def send_to_it(self, current_user: CurrentUser, request: ItServiceRequestSendRequest) -> dict:
        doc = await self._get_owned(request.request_id, current_user)
        if doc.get("status") in ("fulfilled", "cancelled"):
            raise HTTPException(status_code=409, detail="This request is already closed.")
        await self._send_to_it_doc(doc, str(request.it_manager_email).strip().lower(), request.note, datetime.now(UTC))
        return _out(doc)

    async def _send_to_it_doc(self, doc: dict, it_email: str, note: str | None, now: datetime) -> None:
        await database.it_service_requests.update_one(
            {"_id": doc["_id"], "status": {"$in": ["draft", "sent"]}},
            {
                "$set": {
                    "it_manager_email": it_email,
                    "status": "sent",
                    "sent_at": now,
                    "note": note,
                    "updated_at": now,
                }
            },
        )
        doc["it_manager_email"] = it_email
        doc["status"] = "sent"
        doc["sent_at"] = now
        doc["note"] = note
        try:
            email_service.send_it_service_request(
                to_email=it_email,
                recruiter_name=doc.get("recruiter_name") or "HR",
                employee_name=doc.get("employee_name") or "an employee",
                employee_email=doc.get("employee_email") or "",
                job_title=doc.get("job_title"),
                department=doc.get("department"),
                request_type=doc.get("request_type") or "other",
                title=doc.get("title") or "IT help request",
                description=doc.get("description"),
                note=doc.get("note"),
                fulfill_link=settings.it_service_request_link(doc["token"]),
                created_at=doc.get("created_at"),
            )
        except Exception:
            pass
        if doc.get("employee_user_id"):
            await create_notification(
                recipient_id=doc["employee_user_id"],
                recipient_role="employee",
                notif_type="it_service_request_sent",
                title="IT request sent",
                message=f"Your IT request '{doc.get('title')}' was sent to IT.",
                link="/dashboard/employee/it-support",
                related_id=str(doc["_id"]),
            )

    async def cancel(self, current_user: CurrentUser, request_id: str, reason: str | None = None) -> dict:
        doc = await self._get_owned(request_id, current_user)
        if doc.get("status") in ("fulfilled", "cancelled"):
            raise HTTPException(status_code=409, detail="This request is already closed.")
        now = datetime.now(UTC)
        await database.it_service_requests.update_one(
            {"_id": doc["_id"]},
            {"$set": {"status": "cancelled", "cancel_reason": reason, "updated_at": now}},
        )
        if doc.get("employee_user_id"):
            await create_notification(
                recipient_id=doc["employee_user_id"],
                recipient_role="employee",
                notif_type="it_service_request_cancelled",
                title="IT request cancelled",
                message=f"Your IT request '{doc.get('title')}' was cancelled by HR.",
                link="/dashboard/employee/it-support",
                related_id=str(doc["_id"]),
            )
        return {"message": "IT request cancelled.", "request_id": request_id}

    async def get_public(self, token: str) -> dict:
        doc = await self._find_by_token(token)
        return _out(doc)

    async def fulfill_public(self, token: str, request: ItServiceRequestFulfillRequest) -> dict:
        doc = await self._find_by_token(token)
        if doc.get("status") in ("fulfilled", "cancelled"):
            raise HTTPException(status_code=409, detail="This request is already closed.")
        if doc.get("status") != "sent":
            raise HTTPException(status_code=409, detail="This request has not been sent to IT yet.")
        now = datetime.now(UTC)
        items = [a.model_dump() for a in request.items]
        updated = await database.it_service_requests.find_one_and_update(
            {"_id": doc["_id"], "status": "sent"},
            {
                "$set": {
                    "status": "fulfilled",
                    "fulfillment_note": request.fulfillment_note,
                    "serial_number": request.serial_number,
                    "items": items,
                    "fulfilled_at": now,
                    "updated_at": now,
                }
            },
        )
        if not updated:
            raise HTTPException(status_code=409, detail="This request is already closed.")
        doc["status"] = "fulfilled"
        doc["fulfillment_note"] = request.fulfillment_note
        doc["serial_number"] = request.serial_number
        doc["items"] = items
        doc["fulfilled_at"] = now

        if doc.get("recruiter_id"):
            await create_notification(
                recipient_id=str(doc["recruiter_id"]),
                recipient_role="recruiter",
                notif_type="it_service_request_fulfilled",
                title="IT request fulfilled",
                message=(
                    f"IT fulfilled the request for {doc.get('employee_name')}: "
                    f"{doc.get('title')}."
                ),
                link="/dashboard/recruiter/it",
                related_id=str(doc["_id"]),
            )
        if doc.get("employee_user_id"):
            await create_notification(
                recipient_id=doc["employee_user_id"],
                recipient_role="employee",
                notif_type="it_service_request_fulfilled",
                title="IT request fulfilled",
                message=f"IT fulfilled your request: {doc.get('title')}.",
                link="/dashboard/employee/it-support",
                related_id=str(doc["_id"]),
            )
        return _out(doc)

    async def _find_by_token(self, token: str) -> dict:
        if not token:
            raise HTTPException(status_code=404, detail="IT request not found.")
        doc = await database.it_service_requests.find_one({"token": token})
        if not doc:
            raise HTTPException(status_code=404, detail="IT request not found.")
        return doc

    async def officers_overview(self, current_user: CurrentUser) -> dict:
        """All IT officers this recruiter has worked with + who they provisioned."""
        provisioning = await database.it_provisioning_requests.find(
            {"recruiter_id": current_user.id}
        ).to_list(length=500)
        service = await database.it_service_requests.find(
            {"recruiter_id": current_user.id}
        ).to_list(length=300)

        by_email: dict[str, dict] = {}

        def ensure(email: str | None) -> dict | None:
            cleaned = (email or "").strip().lower()
            if not cleaned:
                return None
            info = by_email.get(cleaned)
            if info is None:
                info = {
                    "email": cleaned,
                    "provisioning_total": 0,
                    "provisioning_pending": 0,
                    "provisioning_submitted": 0,
                    "provisioning_applied": 0,
                    "service_total": 0,
                    "service_open": 0,
                    "service_fulfilled": 0,
                    "provisioned_people": [],
                    "service_requests": [],
                }
                by_email[cleaned] = info
            return info

        for doc in provisioning:
            info = ensure(doc.get("it_manager_email"))
            if not info:
                continue
            status = doc.get("status") or "pending"
            info["provisioning_total"] += 1
            if status == "pending":
                info["provisioning_pending"] += 1
            elif status == "submitted":
                info["provisioning_submitted"] += 1
            elif status == "applied":
                info["provisioning_applied"] += 1
            if status in ("submitted", "applied"):
                snap = doc.get("employee_snapshot") or {}
                info["provisioned_people"].append(
                    {
                        "full_name": snap.get("full_name"),
                        "company_email": doc.get("company_email"),
                        "job_title": snap.get("job_title"),
                        "department": snap.get("department"),
                        "status": status,
                        "submitted_at": _iso(doc.get("submitted_at")),
                    }
                )

        for doc in service:
            info = ensure(doc.get("it_manager_email"))
            if not info:
                continue
            status = doc.get("status")
            info["service_total"] += 1
            if status in ("draft", "sent"):
                info["service_open"] += 1
            elif status == "fulfilled":
                info["service_fulfilled"] += 1
            info["service_requests"].append(_out(doc))

        officers = sorted(
            by_email.values(),
            key=lambda o: -(o["provisioning_total"] + o["service_total"]),
        )
        return {"officers": officers, "count": len(officers)}


it_service_request_service = ItServiceRequestService()

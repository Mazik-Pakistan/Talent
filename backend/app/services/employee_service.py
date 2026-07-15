"""US-023 / US-024: Convert candidate → employee and generate Employee IDs."""

from datetime import UTC, datetime

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException, status

from app.core.database import database
from app.core.rbac import CurrentUser
from app.services.candidate_service import CandidateService, is_onboarding_complete, onboarding_missing_keys
from app.services.dashboard_service import create_notification
from app.services.email_service import email_service

EMPLOYEE_ID_PREFIX = "MZK"


class EmployeeService:
    async def generate_employee_id(self, year: int | None = None, *, allocate: bool = False) -> dict:
        """US-024: Unique Employee ID in format MZK-YYYY-000123.

        By default returns a preview of the next ID without consuming the counter.
        Pass allocate=True to reserve the ID (used during conversion).
        """
        from pymongo import ReturnDocument

        now = datetime.now(UTC)
        use_year = year or now.year
        prefix = f"{EMPLOYEE_ID_PREFIX}-{use_year}-"
        counter_id = f"employee_id_{use_year}"

        if allocate:
            counter = await database.counters.find_one_and_update(
                {"_id": counter_id},
                {"$inc": {"seq": 1}},
                upsert=True,
                return_document=ReturnDocument.AFTER,
            )
            next_seq = int((counter or {}).get("seq") or 1)
        else:
            counter = await database.counters.find_one({"_id": counter_id})
            next_seq = int((counter or {}).get("seq") or 0) + 1

        employee_id = f"{prefix}{next_seq:06d}"

        while await database.employees.find_one({"employee_id": employee_id}):
            next_seq += 1
            employee_id = f"{prefix}{next_seq:06d}"
            if allocate:
                await database.counters.update_one(
                    {"_id": counter_id},
                    {"$set": {"seq": next_seq}},
                    upsert=True,
                )

        return {
            "employee_id": employee_id,
            "year": use_year,
            "sequence": next_seq,
            "allocated": allocate,
        }

    async def list_ready_for_conversion(self, current_user: CurrentUser) -> dict:
        """Candidates with 100% onboarding ready for recruiter conversion."""
        query: dict = {
            "status": "active",
            "onboarding.status": "submitted",
            "conversion_status": {"$ne": "converted"},
        }
        if current_user.role != "super_admin":
            query["recruiter_id"] = current_user.id

        docs = await database.candidates.find(query).sort("onboarding.submitted_at", -1).to_list(length=100)
        ready = []
        for candidate in docs:
            onboarding = candidate.get("onboarding") or {}
            if not is_onboarding_complete(onboarding):
                continue
            progress = CandidateService()._progress_payload(candidate)
            ready.append(
                {
                    "id": candidate.get("user_id") or str(candidate["_id"]),
                    "full_name": candidate.get("full_name"),
                    "email": candidate.get("email"),
                    "job_title": candidate.get("job_title"),
                    "department": candidate.get("department"),
                    "office_location": candidate.get("office_location"),
                    "start_date": candidate.get("start_date"),
                    "submitted_at": (
                        onboarding.get("submitted_at").isoformat()
                        if hasattr(onboarding.get("submitted_at"), "isoformat")
                        else onboarding.get("submitted_at")
                    ),
                    "progress_percentage": progress["percentage"],
                    "onboarding": onboarding,
                }
            )
        return {"candidates": ready, "count": len(ready)}

    async def create_from_candidate(self, current_user: CurrentUser, candidate_id: str) -> dict:
        """US-023: Convert a fully onboarded candidate into an employee (once)."""
        candidate = await self._find_candidate(candidate_id)
        if not candidate:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found.")

        if current_user.role != "super_admin" and candidate.get("recruiter_id") != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only convert candidates assigned to you.",
            )

        if candidate.get("status") == "converted" or candidate.get("conversion_status") == "converted":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This candidate has already been converted to an employee.",
            )

        existing_employee = await database.employees.find_one(
            {
                "$or": [
                    {"user_id": candidate.get("user_id")},
                    {"email": candidate.get("email")},
                    {"candidate_id": candidate.get("user_id") or str(candidate["_id"])},
                ]
            }
        )
        if existing_employee:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An employee record already exists for this candidate.",
            )

        onboarding = candidate.get("onboarding") or {}
        missing = onboarding_missing_keys(onboarding)
        if onboarding.get("status") != "submitted" or missing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Candidate onboarding is incomplete. Missing: "
                    + (", ".join(missing) if missing else "final submission")
                    + "."
                ),
            )

        id_payload = await self.generate_employee_id(allocate=True)
        employee_id = id_payload["employee_id"]
        now = datetime.now(UTC)
        user_id = candidate.get("user_id")

        employee_doc = {
            "user_id": user_id,
            "employee_id": employee_id,
            "full_name": candidate["full_name"],
            "email": candidate["email"],
            "phone": candidate.get("phone"),
            "role": "employee",
            "status": "active",
            "job_title": candidate.get("job_title"),
            "department": candidate.get("department"),
            "office_location": candidate.get("office_location"),
            "start_date": candidate.get("start_date"),
            "recruiter_id": candidate.get("recruiter_id"),
            "recruiter_email": candidate.get("recruiter_email"),
            "candidate_id": user_id or str(candidate["_id"]),
            "invitation_token": candidate.get("invitation_token"),
            "onboarding": onboarding,
            "converted_at": now,
            "converted_by": current_user.id,
            "converted_by_email": current_user.email,
            "created_at": now,
            "updated_at": now,
        }
        await database.employees.insert_one(employee_doc)

        await database.candidates.update_one(
            {"_id": candidate["_id"]},
            {
                "$set": {
                    "status": "converted",
                    "conversion_status": "converted",
                    "converted_at": now,
                    "employee_id": employee_id,
                    "updated_at": now,
                }
            },
        )

        if user_id:
            await database.users.update_one(
                {"_id": ObjectId(user_id)} if ObjectId.is_valid(user_id) else {"email": candidate["email"]},
                {"$set": {"role": "employee", "updated_at": now}},
            )
        else:
            await database.users.update_one(
                {"email": candidate["email"]},
                {"$set": {"role": "employee", "updated_at": now}},
            )

        await database.audit_logs.insert_one(
            {
                "user_id": current_user.id,
                "recruiter_id": current_user.id,
                "candidate_id": user_id or str(candidate["_id"]),
                "employee_id": employee_id,
                "email": candidate["email"],
                "role": current_user.role,
                "module": "employees",
                "action": "candidate_converted_to_employee",
                "outcome": "success",
                "created_at": now,
            }
        )

        email_sent = False
        try:
            email_service.send_employee_welcome(
                to_email=candidate["email"],
                full_name=candidate["full_name"],
                employee_id=employee_id,
                job_title=candidate.get("job_title") or "Team Member",
                department=candidate.get("department") or "—",
            )
            email_sent = True
        except Exception:
            email_sent = False

        await create_notification(
            recipient_id=current_user.id,
            recipient_role=current_user.role if current_user.role in ("recruiter", "super_admin") else "recruiter",
            notif_type="employee_created",
            title="Candidate converted",
            message=f"{candidate['full_name']} is now employee {employee_id}.",
            link="/dashboard/recruiter#employees-section",
            related_id=employee_id,
        )

        return {
            "message": "Candidate converted to employee successfully.",
            "email_sent": email_sent,
            "employee": self._public_employee(employee_doc),
            "redirect_hint": "Ask the new hire to sign in with the Employee role.",
        }

    async def list_employees(self, current_user: CurrentUser) -> dict:
        query: dict = {"status": "active"}
        if current_user.role != "super_admin":
            query["recruiter_id"] = current_user.id
        docs = await database.employees.find(query).sort("created_at", -1).to_list(length=200)
        return {
            "employees": [self._public_employee(doc) for doc in docs],
            "count": len(docs),
        }

    async def get_my_profile(self, current_user: CurrentUser) -> dict:
        employee = await database.employees.find_one(
            {
                "$or": [
                    {"user_id": current_user.id},
                    {"email": current_user.email},
                ],
                "status": "active",
            }
        )
        if not employee:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee profile not found.")
        return {
            "employee": self._public_employee(employee, include_onboarding=True),
        }

    async def get_candidate_detail(self, current_user: CurrentUser, candidate_id: str) -> dict:
        candidate = await self._find_candidate(candidate_id)
        if not candidate:
            raise HTTPException(status_code=404, detail="Candidate not found.")
        if current_user.role != "super_admin" and candidate.get("recruiter_id") != current_user.id:
            raise HTTPException(status_code=403, detail="Not allowed.")
        progress = CandidateService()._progress_payload(candidate)
        return {
            "candidate": {
                "id": candidate.get("user_id") or str(candidate["_id"]),
                "full_name": candidate.get("full_name"),
                "email": candidate.get("email"),
                "phone": candidate.get("phone"),
                "job_title": candidate.get("job_title"),
                "department": candidate.get("department"),
                "office_location": candidate.get("office_location"),
                "start_date": candidate.get("start_date"),
                "status": candidate.get("status"),
                "conversion_status": candidate.get("conversion_status"),
                "employee_id": candidate.get("employee_id"),
                "onboarding": candidate.get("onboarding"),
                "progress": progress,
            }
        }

    async def _find_candidate(self, candidate_id: str) -> dict | None:
        query_or = [{"user_id": candidate_id}, {"email": candidate_id}]
        if ObjectId.is_valid(candidate_id):
            query_or.append({"_id": ObjectId(candidate_id)})
        return await database.candidates.find_one({"$or": query_or})

    @staticmethod
    def _public_employee(doc: dict, include_onboarding: bool = False) -> dict:
        payload = {
            "id": doc.get("user_id") or str(doc.get("_id", "")),
            "employee_id": doc.get("employee_id"),
            "full_name": doc.get("full_name"),
            "email": doc.get("email"),
            "phone": doc.get("phone"),
            "job_title": doc.get("job_title"),
            "department": doc.get("department"),
            "office_location": doc.get("office_location"),
            "start_date": doc.get("start_date"),
            "status": doc.get("status"),
            "converted_at": doc.get("converted_at").isoformat()
            if hasattr(doc.get("converted_at"), "isoformat")
            else doc.get("converted_at"),
            "candidate_id": doc.get("candidate_id"),
        }
        if include_onboarding:
            payload["onboarding"] = doc.get("onboarding")
        return payload

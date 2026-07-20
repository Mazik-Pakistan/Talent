"""US-023 / US-024: Convert candidate → employee and generate Employee IDs.
Also owns the post-hire 'complete your profile' flow (US-025..US-033 subset
that moved to the employee side of the offer-letter flow)."""

from datetime import UTC, datetime

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException, status

from app.core.crypto import decrypt_banking_payload, encrypt_banking_payload, iban_fingerprint
from app.core.database import database
from app.core.rbac import CurrentUser
from app.services.candidate_service import CandidateService, onboarding_missing_keys
from app.services.dashboard_service import create_notification
from app.services.email_service import email_service

EMPLOYEE_ID_PREFIX = "MZK"

# Post-hire profile completion — the flow the user lands on right after
# their Employee ID is issued ("profile incomplete" banner on the dashboard).
PROFILE_TASK_DEFS = [
    {"id": "emergency", "label": "Add emergency contact", "step": "emergency"},
    {"id": "employment", "label": "Complete bank & payroll details", "step": "employment"},
    {"id": "references", "label": "Provide professional references", "step": "references"},
    {"id": "documents", "label": "Acknowledge company policies", "step": "documents"},
    {"id": "nda", "label": "Sign the NDA", "step": "nda"},
]
PROFILE_REQUIRED_KEYS = ["emergency", "employment", "references", "documents", "nda"]
PROFILE_STEP_FLOW = {
    "emergency": "employment",
    "employment": "references",
    "references": "documents",
    "documents": "nda",
    "nda": "submit",
}


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

    async def list_pending_review(self, current_user: CurrentUser) -> dict:
        """Candidates who submitted their intake and are awaiting an offer letter."""
        query: dict = {
            "onboarding.status": "submitted",
            "status": {"$ne": "converted"},
            "conversion_status": {"$in": ["intake_submitted", None, "offer_sent"]},
        }
        if current_user.role != "super_admin":
            query["recruiter_id"] = current_user.id

        docs = await database.candidates.find(query).sort("onboarding.submitted_at", -1).to_list(length=100)
        pending = []
        for candidate in docs:
            candidate_id = candidate.get("user_id") or str(candidate["_id"])
            if candidate.get("conversion_status") in {"offer_declined", "declined"}:
                continue

            offer_query = {
                "candidate_id": {
                    "$in": [candidate_id, candidate.get("email"), str(candidate.get("_id"))]
                },
                "status": {"$in": ["sent", "viewed", "signed", "approved", "declined", "expired", "withdrawn"]},
            }
            offer = await database.offer_letters.find_one(offer_query)
            if offer:
                continue

            pending.append(
                {
                    "id": candidate_id,
                    "full_name": candidate.get("full_name"),
                    "email": candidate.get("email"),
                    "job_title": candidate.get("job_title"),
                    "department": candidate.get("department"),
                    "submitted_at": (
                        candidate.get("onboarding", {}).get("submitted_at").isoformat()
                        if hasattr(candidate.get("onboarding", {}).get("submitted_at"), "isoformat")
                        else candidate.get("onboarding", {}).get("submitted_at")
                    ),
                }
            )
        return {"candidates": pending, "count": len(pending)}

    async def list_ready_for_conversion(self, current_user: CurrentUser) -> dict:
        """Candidates whose offer has been signed and is awaiting HR approval/activation."""
        query: dict = {"status": "signed"}
        if current_user.role != "super_admin":
            query["recruiter_id"] = current_user.id

        offers = await database.offer_letters.find(query).sort("signed_at", -1).to_list(length=100)
        ready = []
        for offer in offers:
            candidate = await self._find_candidate(offer["candidate_id"])
            if not candidate or candidate.get("status") == "converted":
                continue
            ready.append(
                {
                    "id": candidate.get("user_id") or str(candidate["_id"]),
                    "offer_id": str(offer["_id"]),
                    "full_name": candidate.get("full_name"),
                    "email": candidate.get("email"),
                    "job_title": offer.get("job_title") or candidate.get("job_title"),
                    "department": offer.get("department") or candidate.get("department"),
                    "office_location": offer.get("office_location") or candidate.get("office_location"),
                    "start_date": offer.get("start_date") or candidate.get("start_date"),
                    "signed_at": offer.get("signed_at").isoformat() if hasattr(offer.get("signed_at"), "isoformat") else offer.get("signed_at"),
                    "monthly_salary": offer.get("monthly_salary"),
                    "reporting_manager": offer.get("reporting_manager"),
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
                    "Candidate's pre-offer profile is incomplete. Missing: "
                    + (", ".join(missing) if missing else "final submission")
                    + "."
                ),
            )

        offer = await database.offer_letters.find_one(
            {"candidate_id": candidate.get("user_id") or str(candidate["_id"]), "status": "signed"}
        )
        if not offer:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This candidate does not have a signed offer letter yet. Send and get the offer signed before activation.",
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
            "job_title": offer.get("job_title") or candidate.get("job_title"),
            "department": offer.get("department") or candidate.get("department"),
            "employment_type": offer.get("employment_type"),
            "office_location": offer.get("office_location") or candidate.get("office_location"),
            "start_date": offer.get("start_date") or candidate.get("start_date"),
            "reporting_manager": offer.get("reporting_manager"),
            "monthly_salary": offer.get("monthly_salary"),
            "currency": offer.get("currency"),
            "recruiter_id": candidate.get("recruiter_id"),
            "recruiter_email": candidate.get("recruiter_email"),
            "candidate_id": user_id or str(candidate["_id"]),
            "invitation_token": candidate.get("invitation_token"),
            "offer_id": str(offer["_id"]),
            # Intake fields carry over as-is; post-hire fields start empty and
            # drive the "Profile incomplete" banner until completed.
            "onboarding": onboarding,
            "profile_status": "incomplete",
            "profile_completed_at": None,
            "converted_at": now,
            "converted_by": current_user.id,
            "converted_by_email": current_user.email,
            "created_at": now,
            "updated_at": now,
        }
        await database.employees.insert_one(employee_doc)

        await database.offer_letters.update_one(
            {"_id": offer["_id"]}, {"$set": {"status": "approved", "approved_at": now, "approved_by": current_user.id}}
        )

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
                "actor_email": current_user.email,
                "role": current_user.role,
                "module": "employees",
                "action": "candidate_converted_to_employee",
                "outcome": "success",
                "created_at": now,
            }
        )

        await database.employee_career_events.insert_one(
            {
                "employee_id": employee_id,
                "employee_user_id": user_id,
                "event_type": "joined",
                "effective_date": employee_doc.get("start_date") or now.date().isoformat(),
                "to_title": employee_doc.get("job_title"),
                "to_department": employee_doc.get("department"),
                "to_manager": employee_doc.get("reporting_manager"),
                "to_status": "active",
                "note": "Employee record created from signed offer.",
                "actor_id": current_user.id,
                "actor_email": current_user.email,
                "created_at": now,
            }
        )

        email_sent = False
        try:
            email_service.send_employee_welcome(
                to_email=candidate["email"],
                full_name=candidate["full_name"],
                employee_id=employee_id,
                job_title=employee_doc.get("job_title") or "Team Member",
                department=employee_doc.get("department") or "—",
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

    def _directory_query(
        self,
        current_user: CurrentUser,
        *,
        q: str | None = None,
        employee_id: str | None = None,
        department: str | None = None,
        job_title: str | None = None,
        status: str | None = None,
        joining_from: str | None = None,
        joining_to: str | None = None,
    ) -> dict:
        query: dict = {}
        if current_user.role != "super_admin":
            query["recruiter_id"] = current_user.id
        if status:
            query["status"] = status
        else:
            query["status"] = {"$in": ["active", "inactive", "on_leave"]}
        if employee_id:
            query["employee_id"] = {"$regex": employee_id.strip(), "$options": "i"}
        if department:
            query["department"] = {"$regex": department.strip(), "$options": "i"}
        if job_title:
            query["job_title"] = {"$regex": job_title.strip(), "$options": "i"}
        if joining_from or joining_to:
            date_filter: dict = {}
            if joining_from:
                date_filter["$gte"] = joining_from
            if joining_to:
                date_filter["$lte"] = joining_to
            query["start_date"] = date_filter
        if q and q.strip():
            term = q.strip()
            query["$or"] = [
                {"full_name": {"$regex": term, "$options": "i"}},
                {"email": {"$regex": term, "$options": "i"}},
                {"employee_id": {"$regex": term, "$options": "i"}},
                {"department": {"$regex": term, "$options": "i"}},
                {"job_title": {"$regex": term, "$options": "i"}},
            ]
        return query

    async def list_employees(
        self,
        current_user: CurrentUser,
        *,
        q: str | None = None,
        employee_id: str | None = None,
        department: str | None = None,
        job_title: str | None = None,
        status: str | None = None,
        joining_from: str | None = None,
        joining_to: str | None = None,
        sort: str = "created_at",
        page: int = 1,
        page_size: int = 20,
    ) -> dict:
        page = max(1, page)
        page_size = max(1, min(page_size, 100))
        query = self._directory_query(
            current_user,
            q=q,
            employee_id=employee_id,
            department=department,
            job_title=job_title,
            status=status,
            joining_from=joining_from,
            joining_to=joining_to,
        )
        sort_field = sort.lstrip("-") if sort else "created_at"
        if sort_field not in {"created_at", "full_name", "employee_id", "department", "job_title", "start_date"}:
            sort_field = "created_at"
        sort_dir = -1 if (sort or "").startswith("-") or sort_field == "created_at" else 1
        if sort == "full_name" or sort == "employee_id":
            sort_dir = 1
        if sort and sort.startswith("-"):
            sort_dir = -1
        elif sort in {"full_name", "employee_id", "department", "job_title", "start_date"}:
            sort_dir = 1

        total = await database.employees.count_documents(query)
        skip = (page - 1) * page_size
        docs = (
            await database.employees.find(query)
            .sort(sort_field, sort_dir)
            .skip(skip)
            .limit(page_size)
            .to_list(length=page_size)
        )
        return {
            "employees": [self._public_employee(doc) for doc in docs],
            "count": len(docs),
            "total": total,
            "page": page,
            "page_size": page_size,
            "pages": max(1, (total + page_size - 1) // page_size),
        }

    async def export_employees_csv(self, current_user: CurrentUser, **filters) -> str:
        filters.pop("page", None)
        filters.pop("page_size", None)
        result = await self.list_employees(current_user, page=1, page_size=5000, **filters)
        import csv
        import io

        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(
            [
                "employee_id",
                "full_name",
                "email",
                "phone",
                "job_title",
                "department",
                "office_location",
                "reporting_manager",
                "start_date",
                "status",
                "profile_status",
            ]
        )
        for emp in result["employees"]:
            writer.writerow(
                [
                    emp.get("employee_id") or "",
                    emp.get("full_name") or "",
                    emp.get("email") or "",
                    emp.get("phone") or "",
                    emp.get("job_title") or "",
                    emp.get("department") or "",
                    emp.get("office_location") or "",
                    emp.get("reporting_manager") or "",
                    emp.get("start_date") or "",
                    emp.get("status") or "",
                    emp.get("profile_status") or "",
                ]
            )
        return buffer.getvalue()

    async def get_employee_profile(self, current_user: CurrentUser, employee_id: str, *, reveal_banking: bool = False) -> dict:
        key = (employee_id or "").strip()
        if not key:
            raise HTTPException(status_code=404, detail="Employee not found.")

        query_or: list[dict] = [
            {"employee_id": key},
            {"user_id": key},
            {"email": key.lower()},
            {"candidate_id": key},
        ]
        if ObjectId.is_valid(key):
            query_or.append({"_id": ObjectId(key)})

        employee = await database.employees.find_one({"$or": query_or})
        if not employee:
            raise HTTPException(status_code=404, detail="Employee not found.")
        if current_user.role != "super_admin":
            owner = str(employee.get("recruiter_id") or "")
            if owner and owner != str(current_user.id):
                raise HTTPException(status_code=403, detail="Not allowed.")
        payload = self._public_employee(employee, include_onboarding=True)
        onboarding = dict(payload.get("onboarding") or {})
        banking = onboarding.get("employment")
        onboarding["employment"] = decrypt_banking_payload(banking, mask=not reveal_banking)
        payload["onboarding"] = onboarding
        career = await self.list_career_events(employee.get("employee_id") or key)
        payload["career"] = career["events"]
        return {"employee": payload}

    async def list_career_events(self, employee_id: str) -> dict:
        docs = (
            await database.employee_career_events.find({"employee_id": employee_id})
            .sort("effective_date", -1)
            .to_list(length=200)
        )
        events = []
        for doc in docs:
            events.append(
                {
                    "id": str(doc["_id"]),
                    "employee_id": doc.get("employee_id"),
                    "event_type": doc.get("event_type"),
                    "effective_date": doc.get("effective_date"),
                    "from_title": doc.get("from_title"),
                    "to_title": doc.get("to_title"),
                    "from_department": doc.get("from_department"),
                    "to_department": doc.get("to_department"),
                    "from_manager": doc.get("from_manager"),
                    "to_manager": doc.get("to_manager"),
                    "from_status": doc.get("from_status"),
                    "to_status": doc.get("to_status"),
                    "note": doc.get("note"),
                    "actor_email": doc.get("actor_email"),
                    "created_at": doc.get("created_at").isoformat()
                    if hasattr(doc.get("created_at"), "isoformat")
                    else doc.get("created_at"),
                }
            )
        return {"events": events}

    async def add_career_event(self, current_user: CurrentUser, employee_id: str, request) -> dict:
        employee = await database.employees.find_one({"employee_id": employee_id})
        if not employee:
            raise HTTPException(status_code=404, detail="Employee not found.")
        if current_user.role != "super_admin" and employee.get("recruiter_id") != current_user.id:
            raise HTTPException(status_code=403, detail="Not allowed.")

        now = datetime.now(UTC)
        data = request.model_dump(mode="json")
        event_doc = {
            "employee_id": employee_id,
            "employee_user_id": employee.get("user_id"),
            **data,
            "actor_id": current_user.id,
            "actor_email": current_user.email,
            "created_at": now,
        }
        result = await database.employee_career_events.insert_one(event_doc)
        event_doc["_id"] = result.inserted_id

        # Mirror key changes onto the employee record
        emp_updates: dict = {"updated_at": now}
        if data.get("to_title"):
            emp_updates["job_title"] = data["to_title"]
        if data.get("to_department"):
            emp_updates["department"] = data["to_department"]
        if data.get("to_manager"):
            emp_updates["reporting_manager"] = data["to_manager"]
        if data.get("to_status"):
            emp_updates["status"] = data["to_status"]
        if len(emp_updates) > 1:
            await database.employees.update_one({"_id": employee["_id"]}, {"$set": emp_updates})

        await database.audit_logs.insert_one(
            {
                "user_id": current_user.id,
                "recruiter_id": current_user.id,
                "employee_id": employee_id,
                "email": employee.get("email"),
                "actor_email": current_user.email,
                "module": "employees",
                "action": f"career_{data['event_type']}",
                "outcome": "success",
                "created_at": now,
            }
        )
        return await self.list_career_events(employee_id)

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
        payload = self._public_employee(employee, include_onboarding=True)
        onboarding = dict(payload.get("onboarding") or {})
        onboarding["employment"] = decrypt_banking_payload(onboarding.get("employment"), mask=False)
        payload["onboarding"] = onboarding
        return {
            "employee": payload,
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

    async def attach_uploaded_file(
        self,
        current_user: CurrentUser,
        *,
        purpose: str,
        file_name: str,
        file_url: str,
        doc_type: str | None = None,
    ) -> dict:
        """Keep the employee profile's denormalized onboarding data in sync."""
        employee = await self._require_employee(current_user)
        onboarding = dict(employee.get("onboarding") or {})
        now = datetime.now(UTC)

        if purpose == "resume":
            resume = dict(onboarding.get("resume") or {})
            resume.update({"file_name": file_name, "file_url": file_url})
            if not resume.get("summary"):
                resume["summary"] = ""
            onboarding["resume"] = resume
        elif purpose == "government_doc":
            government = dict(onboarding.get("government_docs") or {})
            documents = list(government.get("documents") or [])
            target_type = doc_type if doc_type in {"cnic", "passport"} else None
            updated = False
            if target_type:
                for item in documents:
                    if item.get("doc_type") == target_type and not item.get("file_url"):
                        item["file_name"] = file_name
                        item["file_url"] = file_url
                        updated = True
                        break
                if not updated:
                    for item in documents:
                        if item.get("doc_type") == target_type:
                            item["file_name"] = file_name
                            item["file_url"] = file_url
                            updated = True
                            break
            if not updated:
                documents.append(
                    {
                        "doc_type": target_type or "cnic",
                        "document_number": "pending",
                        "file_name": file_name,
                        "file_url": file_url,
                    }
                )
            government["documents"] = documents
            onboarding["government_docs"] = government
        elif purpose == "education_cert":
            education = dict(onboarding.get("education") or {})
            entries = list(education.get("entries") or [])
            if entries:
                target_entry = next((entry for entry in entries if not entry.get("certificate_file")), entries[0])
                target_entry["certificate_file"] = file_url
                education["entries"] = entries
                onboarding["education"] = education
        else:
            return {
                "message": "File uploaded.",
                "file_name": file_name,
                "file_url": file_url,
                "onboarding": onboarding,
                "doc_type": doc_type,
            }

        await database.employees.update_one(
            {"_id": employee["_id"]},
            {"$set": {"onboarding": onboarding, "updated_at": now}},
        )
        refreshed = await database.employees.find_one({"_id": employee["_id"]})
        return {
            "message": "File uploaded.",
            "file_name": file_name,
            "file_url": file_url,
            "onboarding": refreshed.get("onboarding"),
        }

    async def _find_candidate(self, candidate_id: str) -> dict | None:
        query_or = [{"user_id": candidate_id}, {"email": candidate_id}]
        if ObjectId.is_valid(candidate_id):
            query_or.append({"_id": ObjectId(candidate_id)})
        return await database.candidates.find_one({"$or": query_or})

    # ------------------------------------------------------------------
    # Post-hire "complete your profile" flow (Profile Incomplete banner)
    # ------------------------------------------------------------------
    async def _require_employee(self, current_user: CurrentUser) -> dict:
        employee = await database.employees.find_one(
            {
                "$or": [{"user_id": current_user.id}, {"email": current_user.email}],
                "status": "active",
            }
        )
        if not employee:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee profile not found.")
        return employee

    def _profile_progress(self, employee: dict) -> dict:
        onboarding = employee.get("onboarding") or {}
        tasks = []
        for task_def in PROFILE_TASK_DEFS:
            completed = bool(onboarding.get(task_def["step"]))
            tasks.append({**task_def, "completed": completed})
        completed_count = sum(1 for t in tasks if t["completed"])
        percentage = round((completed_count / len(tasks)) * 100) if tasks else 100
        missing_fields = [t["step"] for t in tasks if not t["completed"]]
        return {
            "profile_status": employee.get("profile_status", "complete"),
            "percentage": percentage,
            "missing_fields": missing_fields,
            "tasks": tasks,
            "current_step": next((t["step"] for t in tasks if not t["completed"]), "submit"),
        }

    async def get_profile_completion(self, current_user: CurrentUser) -> dict:
        employee = await self._require_employee(current_user)
        onboarding = dict(employee.get("onboarding") or {})
        onboarding["employment"] = decrypt_banking_payload(onboarding.get("employment"), mask=False)
        return {
            "employee": self._public_employee(employee),
            "onboarding": onboarding,
            "progress": self._profile_progress(employee),
        }

    async def save_profile_completion(self, current_user: CurrentUser, request) -> dict:
        employee = await self._require_employee(current_user)
        onboarding = employee.get("onboarding") or {}
        now = datetime.now(UTC)
        updates: dict = {"updated_at": now}

        step_handlers = {
            "emergency": ("emergency", request.emergency, "Emergency contact is required."),
            "employment": ("employment", request.employment, "Banking information is required."),
            "references": ("references", request.references, "At least two references are required."),
            "documents": ("documents", request.documents, "Policy acknowledgements are required."),
            "nda": ("nda", request.nda, "NDA signature is required."),
        }

        if request.step in step_handlers:
            field, payload, error = step_handlers[request.step]
            if not payload:
                raise HTTPException(status_code=400, detail=error)
            data = payload.model_dump(mode="json")
            if request.step == "nda" and not data.get("signed_at"):
                data["signed_at"] = now.isoformat()
            if request.step == "employment":
                iban_hash = iban_fingerprint(data["iban"])
                duplicate = await database.employees.find_one(
                    {
                        "onboarding.employment.iban_hash": iban_hash,
                        "_id": {"$ne": employee["_id"]},
                    }
                )
                if duplicate:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="This IBAN is already registered to another employee.",
                    )
                data = encrypt_banking_payload(data)
            updates[f"onboarding.{field}"] = data
            await database.audit_logs.insert_one(
                {
                    "user_id": current_user.id,
                    "employee_id": employee.get("employee_id"),
                    "email": employee.get("email"),
                    "actor_email": current_user.email,
                    "module": "employees",
                    "action": f"profile_{field}_saved",
                    "outcome": "success",
                    "created_at": now,
                }
            )
        elif request.step == "submit":
            missing = [k for k in PROFILE_REQUIRED_KEYS if not onboarding.get(k)]
            if missing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Complete these sections first: {', '.join(missing)}.",
                )
            updates["profile_status"] = "complete"
            updates["profile_completed_at"] = now
            await create_notification(
                recipient_id=employee.get("recruiter_id"),
                recipient_role="recruiter",
                notif_type="employee_profile_completed",
                title="Employee profile completed",
                message=f"{employee['full_name']} finished their post-hire profile checklist.",
                link="/dashboard/recruiter#employees-section",
                related_id=employee.get("employee_id"),
            ) if employee.get("recruiter_id") else None
        else:
            raise HTTPException(status_code=400, detail="Unknown profile step.")

        await database.employees.update_one({"_id": employee["_id"]}, {"$set": updates})
        refreshed = await database.employees.find_one({"_id": employee["_id"]})
        response_onboarding = dict(refreshed.get("onboarding") or {})
        response_onboarding["employment"] = decrypt_banking_payload(
            response_onboarding.get("employment"), mask=False
        )
        return {
            "message": "Profile saved." if request.step != "submit" else "Profile completed — welcome aboard!",
            "employee": self._public_employee(refreshed),
            "onboarding": response_onboarding,
            "progress": self._profile_progress(refreshed),
        }

    @staticmethod
    def _public_employee(doc: dict, include_onboarding: bool = False) -> dict:
        payload = {
            "id": doc.get("user_id") or str(doc.get("_id", "")),
            "employee_id": doc.get("employee_id"),
            "full_name": doc.get("full_name"),
            "email": doc.get("email"),
            "company_email": doc.get("company_email"),
            "phone": doc.get("phone"),
            "job_title": doc.get("job_title"),
            "department": doc.get("department"),
            "employment_type": doc.get("employment_type"),
            "office_location": doc.get("office_location"),
            "start_date": doc.get("start_date"),
            "reporting_manager": doc.get("reporting_manager"),
            "profile_status": doc.get("profile_status", "complete"),
            "status": doc.get("status"),
            "converted_at": doc.get("converted_at").isoformat()
            if hasattr(doc.get("converted_at"), "isoformat")
            else doc.get("converted_at"),
            "candidate_id": doc.get("candidate_id"),
            "assets": doc.get("assets") or [],
            "orientation": doc.get("orientation"),
        }
        if include_onboarding:
            payload["onboarding"] = doc.get("onboarding")
        return payload

    async def _resolve_employee_for_recruiter(self, current_user: CurrentUser, employee_id: str) -> dict:
        key = (employee_id or "").strip()
        if not key:
            raise HTTPException(status_code=404, detail="Employee not found.")
        query_or: list[dict] = [
            {"employee_id": key},
            {"user_id": key},
            {"email": key.lower()},
            {"candidate_id": key},
        ]
        if ObjectId.is_valid(key):
            query_or.append({"_id": ObjectId(key)})
        employee = await database.employees.find_one({"$or": query_or})
        if not employee:
            raise HTTPException(status_code=404, detail="Employee not found.")
        if current_user.role != "super_admin":
            owner = str(employee.get("recruiter_id") or "")
            if owner and owner != str(current_user.id):
                raise HTTPException(status_code=403, detail="Not allowed.")
        return employee

    async def _notify_employee(
        self,
        employee: dict,
        *,
        notif_type: str,
        title: str,
        message: str,
        link: str = "/dashboard/employee",
        related_id: str | None = None,
    ) -> None:
        recipient_id = employee.get("user_id") or str(employee.get("_id", ""))
        if not recipient_id:
            return
        await create_notification(
            recipient_id=recipient_id,
            recipient_role="employee",
            notif_type=notif_type,
            title=title,
            message=message,
            link=link,
            related_id=related_id or employee.get("employee_id"),
        )

    async def set_company_email(self, current_user: CurrentUser, employee_id: str, company_email: str) -> dict:
        employee = await self._resolve_employee_for_recruiter(current_user, employee_id)
        email = company_email.strip().lower()
        now = datetime.now(UTC)
        await database.employees.update_one(
            {"_id": employee["_id"]},
            {
                "$set": {
                    "company_email": email,
                    "company_email_assigned_at": now,
                    "company_email_assigned_by": current_user.id,
                    "updated_at": now,
                }
            },
        )
        employee["company_email"] = email

        await self._notify_employee(
            employee,
            notif_type="company_email_assigned",
            title="Company email assigned",
            message=f"Your official company email has been set to {email}.",
            link="/dashboard/employee",
        )
        try:
            email_service.send_company_email_assigned(
                to_email=employee.get("email") or email,
                full_name=employee.get("full_name") or "Team member",
                company_email=email,
            )
        except Exception:
            pass

        await database.audit_logs.insert_one(
            {
                "user_id": current_user.id,
                "email": current_user.email,
                "actor_email": current_user.email,
                "module": "employees",
                "action": "company_email_assigned",
                "employee_id": employee.get("employee_id"),
                "company_email": email,
                "outcome": "success",
                "created_at": now,
            }
        )
        return {"message": "Company email saved.", "employee": self._public_employee(employee)}

    async def assign_asset(self, current_user: CurrentUser, employee_id: str, request) -> dict:
        employee = await self._resolve_employee_for_recruiter(current_user, employee_id)
        now = datetime.now(UTC)
        data = request.model_dump(mode="json")
        asset = {
            "id": str(ObjectId()),
            "name": data["name"],
            "asset_type": data.get("asset_type") or "other",
            "serial_number": data.get("serial_number"),
            "notes": data.get("notes"),
            "status": "assigned",
            "assigned_at": now.isoformat(),
            "assigned_by": current_user.id,
            "assigned_by_email": current_user.email,
        }
        await database.employees.update_one(
            {"_id": employee["_id"]},
            {"$push": {"assets": asset}, "$set": {"updated_at": now}},
        )
        assets = list(employee.get("assets") or [])
        assets.append(asset)
        employee["assets"] = assets

        await self._notify_employee(
            employee,
            notif_type="asset_assigned",
            title="Company asset assigned",
            message=f"You have been assigned: {asset['name']}.",
            related_id=asset["id"],
        )
        try:
            email_service.send_asset_assigned(
                to_email=employee.get("company_email") or employee.get("email"),
                full_name=employee.get("full_name") or "Team member",
                asset_name=asset["name"],
                asset_type=asset["asset_type"],
                serial_number=asset.get("serial_number"),
            )
        except Exception:
            pass

        return {"message": "Asset assigned.", "asset": asset, "employee": self._public_employee(employee)}

    async def update_asset(
        self, current_user: CurrentUser, employee_id: str, asset_id: str, request
    ) -> dict:
        employee = await self._resolve_employee_for_recruiter(current_user, employee_id)
        assets = list(employee.get("assets") or [])
        target = next((a for a in assets if a.get("id") == asset_id), None)
        if not target:
            raise HTTPException(status_code=404, detail="Asset not found.")
        data = {k: v for k, v in request.model_dump(mode="json", exclude_none=True).items()}
        now = datetime.now(UTC)
        target.update(data)
        target["updated_at"] = now.isoformat()
        await database.employees.update_one(
            {"_id": employee["_id"]},
            {"$set": {"assets": assets, "updated_at": now}},
        )
        employee["assets"] = assets
        return {"message": "Asset updated.", "asset": target, "employee": self._public_employee(employee)}

    async def remove_asset(self, current_user: CurrentUser, employee_id: str, asset_id: str) -> dict:
        employee = await self._resolve_employee_for_recruiter(current_user, employee_id)
        assets = [a for a in (employee.get("assets") or []) if a.get("id") != asset_id]
        if len(assets) == len(employee.get("assets") or []):
            raise HTTPException(status_code=404, detail="Asset not found.")
        now = datetime.now(UTC)
        await database.employees.update_one(
            {"_id": employee["_id"]},
            {"$set": {"assets": assets, "updated_at": now}},
        )
        employee["assets"] = assets
        return {"message": "Asset removed.", "employee": self._public_employee(employee)}

    async def schedule_orientation(self, current_user: CurrentUser, employee_id: str, request) -> dict:
        employee = await self._resolve_employee_for_recruiter(current_user, employee_id)
        now = datetime.now(UTC)
        data = request.model_dump(mode="json")
        previous = employee.get("orientation")
        orientation = {
            **data,
            "scheduled_at": now.isoformat(),
            "scheduled_by": current_user.id,
            "scheduled_by_email": current_user.email,
            "status": "scheduled",
        }
        await database.employees.update_one(
            {"_id": employee["_id"]},
            {"$set": {"orientation": orientation, "updated_at": now}},
        )
        employee["orientation"] = orientation

        is_update = bool(previous)
        notif_type = "orientation_updated" if is_update else "orientation_scheduled"
        title = "Orientation session updated" if is_update else "Orientation session scheduled"
        message = (
            f"Your orientation is on {orientation['date']} at {orientation['time']} "
            f"with {orientation['trainer']}."
        )
        await self._notify_employee(
            employee,
            notif_type=notif_type,
            title=title,
            message=message,
            link="/dashboard/employee",
        )
        try:
            email_service.send_orientation_scheduled(
                to_email=employee.get("company_email") or employee.get("email"),
                full_name=employee.get("full_name") or "Team member",
                date=orientation["date"],
                time=orientation["time"],
                meeting_link=orientation.get("meeting_link"),
                trainer=orientation["trainer"],
                agenda=orientation["agenda"],
                is_update=is_update,
            )
        except Exception:
            pass

        return {
            "message": "Orientation updated." if is_update else "Orientation scheduled.",
            "orientation": orientation,
            "employee": self._public_employee(employee),
        }

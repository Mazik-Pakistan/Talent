"""Career Framework Service - Organization-Wide Career Progression Management.

Handles:
- Career track CRUD (department-level career paths)
- Career level CRUD (individual levels with requirements)
- Employee career assignment (recruiter assigns career paths)
- Progress tracking (automatic as employees complete courses/skills)
- Excel import/export (bulk career framework setup)
- Reports (promotion readiness, department progress)
"""

from __future__ import annotations

import csv
import io
from datetime import UTC, date, datetime
from typing import Any

from bson import ObjectId
from fastapi import HTTPException, status

from app.core.database import database, _db_kwargs, try_transaction
from app.core.rbac import CurrentUser


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(value: Any) -> Any:
    return value.isoformat() if hasattr(value, "isoformat") else value


class CareerFrameworkService:
    """Service for managing organization-wide career frameworks."""

    @staticmethod
    def _org_filter(organization_id: str | None) -> dict:
        if organization_id:
            return {"$or": [{"organization_id": organization_id}, {"organization_id": {"$exists": False}}]}
        return {}

    # ------------------------------------------------------------------ #
    # Career Tracks (department-level career paths)
    # ------------------------------------------------------------------ #

    async def create_track(
        self, current_user: CurrentUser, department: str, track_name: str, description: str | None = None,
        organization_id: str | None = None,
    ) -> dict:
        now = _now()

        # Check if track already exists for this department+name
        existing = await database.career_tracks.find_one(
            {"department": {"$regex": f"^{department}$", "$options": "i"}, "track_name": {"$regex": f"^{track_name}$", "$options": "i"}}
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Career track '{track_name}' already exists for department '{department}'.",
            )

        doc = {
            "department": department,
            "track_name": track_name,
            "description": description,
            "levels": [],
            "is_active": True,
            "created_by": current_user.id,
            "created_at": now,
            "updated_at": now,
            "organization_id": organization_id,
        }
        result = await database.career_tracks.insert_one(doc)
        doc["_id"] = result.inserted_id
        return self._public_track(doc)

    async def list_tracks(self, department: str | None = None, organization_id: str | None = None) -> dict:
        query: dict[str, Any] = {"is_active": True}
        if department:
            query["department"] = {"$regex": f"^{department}$", "$options": "i"}
        org_filter = self._org_filter(organization_id)
        if org_filter:
            query = {"$and": [query, org_filter]}
        docs = await database.career_tracks.find(query).sort([("department", 1), ("track_name", 1)]).to_list(length=200)
        return {"tracks": [self._public_track(d) for d in docs]}

    async def get_track(self, track_id: str, organization_id: str | None = None) -> dict:
        if not ObjectId.is_valid(track_id):
            raise HTTPException(status_code=404, detail="Career track not found.")
        doc = await database.career_tracks.find_one({"_id": ObjectId(track_id)})
        if not doc:
            raise HTTPException(status_code=404, detail="Career track not found.")
        if organization_id:
            doc_org = doc.get("organization_id")
            if doc_org and doc_org != organization_id:
                raise HTTPException(status_code=404, detail="Career track not found.")
        return self._public_track(doc)

    async def update_track(self, track_id: str, updates: dict, organization_id: str | None = None) -> dict:
        if not ObjectId.is_valid(track_id):
            raise HTTPException(status_code=404, detail="Career track not found.")
        doc = await database.career_tracks.find_one({"_id": ObjectId(track_id)})
        if not doc:
            raise HTTPException(status_code=404, detail="Career track not found.")
        if organization_id:
            doc_org = doc.get("organization_id")
            if doc_org and doc_org != organization_id:
                raise HTTPException(status_code=404, detail="Career track not found.")

        now = _now()
        update_fields = {"updated_at": now}
        for key in ("track_name", "description", "is_active"):
            if key in updates and updates[key] is not None:
                update_fields[key] = updates[key]
        await database.career_tracks.update_one({"_id": ObjectId(track_id)}, {"$set": update_fields})
        updated = await database.career_tracks.find_one({"_id": ObjectId(track_id)})
        return self._public_track(updated)

    async def delete_track(self, track_id: str, organization_id: str | None = None) -> dict:
        if not ObjectId.is_valid(track_id):
            raise HTTPException(status_code=404, detail="Career track not found.")
        doc = await database.career_tracks.find_one({"_id": ObjectId(track_id)})
        if not doc:
            raise HTTPException(status_code=404, detail="Career track not found.")
        if organization_id:
            doc_org = doc.get("organization_id")
            if doc_org and doc_org != organization_id:
                raise HTTPException(status_code=404, detail="Career track not found.")

        # Check if any employees are assigned to this track
        assigned = await database.employee_career_assignments.count_documents({"current_track_id": track_id, "status": "active"})
        if assigned > 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot delete: {assigned} employee(s) are assigned to this track.",
            )

        # Soft delete
        await database.career_tracks.update_one(
            {"_id": ObjectId(track_id)},
            {"$set": {"is_active": False, "updated_at": _now()}},
        )
        # Also deactivate all levels
        await database.career_levels.update_many(
            {"track_id": track_id},
            {"$set": {"is_active": False, "updated_at": _now()}},
        )
        return {"message": "Career track deleted."}

    def _public_track(self, doc: dict) -> dict:
        return {
            "id": str(doc["_id"]),
            "department": doc.get("department"),
            "track_name": doc.get("track_name"),
            "description": doc.get("description"),
            "levels": [
                {
                    "level_number": l.get("level_number"),
                    "role_title": l.get("role_title"),
                    "career_level_id": str(l.get("career_level_id", "")) if l.get("career_level_id") else None,
                }
                for l in (doc.get("levels") or [])
            ],
            "is_active": doc.get("is_active", True),
            "created_by": doc.get("created_by"),
            "created_at": _iso(doc.get("created_at")),
            "updated_at": _iso(doc.get("updated_at")),
        }

    # ------------------------------------------------------------------ #
    # Career Levels (individual levels with requirements)
    # ------------------------------------------------------------------ #

    async def create_level(
        self,
        current_user: CurrentUser,
        *,
        department: str,
        track_name: str,
        level_number: int,
        role_title: str,
        required_skills: list[dict] | None = None,
        required_certifications: list[dict] | None = None,
        learning_path: list[dict] | None = None,
        competencies: list[dict] | None = None,
        min_experience_years: float = 0,
        min_time_in_current_role_months: int = 0,
        manager_approval_required: bool = False,
        description: str | None = None,
        organization_id: str | None = None,
    ) -> dict:
        now = _now()

        # Get or create the parent track
        track_query: dict[str, Any] = {
            "department": {"$regex": f"^{department}$", "$options": "i"},
            "track_name": {"$regex": f"^{track_name}$", "$options": "i"},
            "is_active": True,
        }
        org_filter = self._org_filter(organization_id)
        if org_filter:
            track_query = {"$and": [track_query, org_filter]}
        track = await database.career_tracks.find_one(track_query)
        if not track:
            # Auto-create the track
            track_doc = {
                "department": department,
                "track_name": track_name,
                "description": None,
                "levels": [],
                "is_active": True,
                "created_by": current_user.id,
                "created_at": now,
                "updated_at": now,
                "organization_id": organization_id,
            }
            result = await database.career_tracks.insert_one(track_doc)
            track = await database.career_tracks.find_one({"_id": result.inserted_id})

        # Check duplicate level number in this track
        existing_level = await database.career_levels.find_one(
            {"track_id": str(track["_id"]), "level_number": level_number, "is_active": True}
        )
        if existing_level:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Level {level_number} already exists in track '{track_name}'.",
            )

        level_doc = {
            "track_id": str(track["_id"]),
            "department": department,
            "track_name": track_name,
            "level_number": level_number,
            "role_title": role_title,
            "required_skills": required_skills or [],
            "required_certifications": required_certifications or [],
            "learning_path": learning_path or [],
            "competencies": competencies or [],
            "min_experience_years": min_experience_years,
            "min_time_in_current_role_months": min_time_in_current_role_months,
            "manager_approval_required": manager_approval_required,
            "description": description,
            "is_active": True,
            "created_by": current_user.id,
            "created_at": now,
            "updated_at": now,
            "organization_id": organization_id,
        }
        result = await database.career_levels.insert_one(level_doc)
        level_doc["_id"] = result.inserted_id

        # Update the track's levels array
        level_summary = {
            "level_number": level_number,
            "role_title": role_title,
            "career_level_id": str(result.inserted_id),
        }
        await database.career_tracks.update_one(
            {"_id": track["_id"]},
            {"$push": {"levels": level_summary}, "$set": {"updated_at": now}},
        )
        # Sort levels array by level_number
        track_doc = await database.career_tracks.find_one({"_id": track["_id"]})
        sorted_levels = sorted(track_doc.get("levels", []), key=lambda x: x.get("level_number", 0))
        await database.career_tracks.update_one(
            {"_id": track["_id"]},
            {"$set": {"levels": sorted_levels}},
        )

        return self._public_level(level_doc)

    async def list_levels(self, department: str | None = None, track_id: str | None = None, organization_id: str | None = None) -> dict:
        query: dict[str, Any] = {"is_active": True}
        if track_id:
            query["track_id"] = track_id
        if department:
            query["department"] = {"$regex": f"^{department}$", "$options": "i"}
        org_filter = self._org_filter(organization_id)
        if org_filter:
            query = {"$and": [query, org_filter]}
        docs = await database.career_levels.find(query).sort([("department", 1), ("level_number", 1)]).to_list(length=200)
        return {"levels": [self._public_level(d) for d in docs]}

    async def get_level(self, level_id: str, organization_id: str | None = None) -> dict:
        if not ObjectId.is_valid(level_id):
            raise HTTPException(status_code=404, detail="Career level not found.")
        doc = await database.career_levels.find_one({"_id": ObjectId(level_id)})
        if not doc:
            raise HTTPException(status_code=404, detail="Career level not found.")
        if organization_id:
            doc_org = doc.get("organization_id")
            if doc_org and doc_org != organization_id:
                raise HTTPException(status_code=404, detail="Career level not found.")
        return self._public_level(doc)

    async def update_level(self, level_id: str, updates: dict, organization_id: str | None = None) -> dict:
        if not ObjectId.is_valid(level_id):
            raise HTTPException(status_code=404, detail="Career level not found.")
        doc = await database.career_levels.find_one({"_id": ObjectId(level_id)})
        if not doc:
            raise HTTPException(status_code=404, detail="Career level not found.")
        if organization_id:
            doc_org = doc.get("organization_id")
            if doc_org and doc_org != organization_id:
                raise HTTPException(status_code=404, detail="Career level not found.")

        now = _now()
        update_fields = {"updated_at": now}
        allowed_keys = {
            "role_title", "required_skills", "required_certifications",
            "learning_path", "competencies", "min_experience_years",
            "min_time_in_current_role_months", "manager_approval_required",
            "description", "is_active",
        }
        for key in allowed_keys:
            if key in updates and updates[key] is not None:
                update_fields[key] = updates[key]

        await database.career_levels.update_one({"_id": ObjectId(level_id)}, {"$set": update_fields})

        # Also update the track's levels summary if title changed
        if "role_title" in update_fields:
            track_id = doc.get("track_id")
            if track_id:
                track = await database.career_tracks.find_one({"_id": ObjectId(track_id)})
                if track:
                    levels = track.get("levels", [])
                    for lvl in levels:
                        if lvl.get("career_level_id") == level_id:
                            lvl["role_title"] = update_fields["role_title"]
                    await database.career_tracks.update_one(
                        {"_id": ObjectId(track_id)},
                        {"$set": {"levels": levels, "updated_at": now}},
                    )

        updated = await database.career_levels.find_one({"_id": ObjectId(level_id)})
        return self._public_level(updated)

    async def delete_level(self, level_id: str, organization_id: str | None = None) -> dict:
        if not ObjectId.is_valid(level_id):
            raise HTTPException(status_code=404, detail="Career level not found.")
        doc = await database.career_levels.find_one({"_id": ObjectId(level_id)})
        if not doc:
            raise HTTPException(status_code=404, detail="Career level not found.")
        if organization_id:
            doc_org = doc.get("organization_id")
            if doc_org and doc_org != organization_id:
                raise HTTPException(status_code=404, detail="Career level not found.")

        # Check if any employees have this as their target
        assigned = await database.employee_career_assignments.count_documents(
            {"target_level_id": level_id, "status": "active"}
        )
        if assigned > 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot delete: {assigned} employee(s) are targeting this level.",
            )

        now = _now()
        await database.career_levels.update_one(
            {"_id": ObjectId(level_id)},
            {"$set": {"is_active": False, "updated_at": now}},
        )

        # Remove from track's levels array
        track_id = doc.get("track_id")
        if track_id:
            track = await database.career_tracks.find_one({"_id": ObjectId(track_id)})
            if track:
                levels = [l for l in track.get("levels", []) if l.get("career_level_id") != level_id]
                await database.career_tracks.update_one(
                    {"_id": ObjectId(track_id)},
                    {"$set": {"levels": levels, "updated_at": now}},
                )

        return {"message": "Career level deleted."}

    def _public_level(self, doc: dict) -> dict:
        return {
            "id": str(doc["_id"]),
            "track_id": doc.get("track_id"),
            "department": doc.get("department"),
            "track_name": doc.get("track_name"),
            "level_number": doc.get("level_number"),
            "role_title": doc.get("role_title"),
            "required_skills": doc.get("required_skills") or [],
            "required_certifications": doc.get("required_certifications") or [],
            "learning_path": doc.get("learning_path") or [],
            "competencies": doc.get("competencies") or [],
            "min_experience_years": doc.get("min_experience_years", 0),
            "min_time_in_current_role_months": doc.get("min_time_in_current_role_months", 0),
            "manager_approval_required": doc.get("manager_approval_required", False),
            "description": doc.get("description"),
            "is_active": doc.get("is_active", True),
            "created_by": doc.get("created_by"),
            "created_at": _iso(doc.get("created_at")),
            "updated_at": _iso(doc.get("updated_at")),
        }

    # ------------------------------------------------------------------ #
    # Employee Career Assignment
    # ------------------------------------------------------------------ #

    async def assign_career(
        self,
        current_user: CurrentUser,
        employee_id: str,
        target_level_id: str,
        target_date: date | None = None,
        organization_id: str | None = None,
    ) -> dict:
        now = _now()

        # Find employee
        employee = await database.employees.find_one({"employee_id": employee_id, "status": "active"})
        if not employee:
            raise HTTPException(status_code=404, detail="Employee not found.")

        # Find target level
        target_level = await database.career_levels.find_one({"_id": ObjectId(target_level_id), "is_active": True})
        if not target_level:
            raise HTTPException(status_code=404, detail="Target career level not found.")
        if organization_id:
            level_org = target_level.get("organization_id")
            if level_org and level_org != organization_id:
                raise HTTPException(status_code=404, detail="Target career level not found.")

        # Check if employee already has an active assignment
        existing = await database.employee_career_assignments.find_one(
            {"employee_id": employee_id, "status": "active"}
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Employee already has an active career assignment. Update or complete it first.",
            )

        # Find current level based on employee's job title
        current_level = await self._find_level_by_title(employee.get("job_title"), employee.get("department"), organization_id)
        current_level_number = current_level.get("level_number", 0) if current_level else 0
        current_role_title = current_level.get("role_title", employee.get("job_title", "")) if current_level else employee.get("job_title", "")

        # Build learning path from target level
        assigned_learning_path = []
        for course in (target_level.get("learning_path") or []):
            assigned_learning_path.append({
                "course_uid": course.get("course_uid"),
                "course_title": course.get("course_title"),
                "source": course.get("source", "microsoft_learn"),
                "mandatory": course.get("mandatory", True),
                "order": course.get("order", 1),
                "status": "not_started",
                "progress_percent": 0,
                "started_at": None,
                "completed_at": None,
            })

        # Build skills to acquire
        current_skills = await self._get_employee_skill_names(employee.get("user_id"))
        skills_to_acquire = []
        for skill_req in (target_level.get("required_skills") or []):
            skill_name = skill_req.get("skill", "")
            current_prof = self._find_skill_proficiency(current_skills, skill_name)
            skills_to_acquire.append({
                "skill": skill_name,
                "current_proficiency": current_prof,
                "target_proficiency": skill_req.get("proficiency", "Intermediate"),
                "current_status": "acquired" if current_prof and self._proficiency_rank(current_prof) >= self._proficiency_rank(skill_req.get("proficiency", "Intermediate")) else "not_started",
            })

        # Build certifications to earn
        existing_certs = await self._get_employee_cert_titles(employee.get("user_id"))
        certifications_to_earn = []
        for cert_req in (target_level.get("required_certifications") or []):
            cert_name = cert_req.get("certification", "")
            has_cert = any(cert_name.lower() in c.lower() for c in existing_certs)
            certifications_to_earn.append({
                "certification": cert_name,
                "mandatory": cert_req.get("mandatory", True),
                "status": "earned" if has_cert else "not_started",
                "earned_at": None,
            })

        # Calculate initial progress
        progress = self._calculate_progress(assigned_learning_path, skills_to_acquire, certifications_to_earn)

        assignment_doc = {
            "employee_id": employee_id,
            "user_id": employee.get("user_id"),
            "employee_name": employee.get("full_name"),

            # Current position
            "current_department": employee.get("department"),
            "current_track_id": target_level.get("track_id"),
            "current_track_name": target_level.get("track_name"),
            "current_level_number": current_level_number,
            "current_role_title": current_role_title,

            # Target position
            "target_level_id": target_level_id,
            "target_level_number": target_level.get("level_number"),
            "target_role_title": target_level.get("role_title"),
            "target_date": target_date.isoformat() if target_date else None,

            # Requirements
            "assigned_learning_path": assigned_learning_path,
            "skills_to_acquire": skills_to_acquire,
            "certifications_to_earn": certifications_to_earn,

            # Progress
            "overall_progress_percent": progress["overall_progress_percent"],
            "readiness_score": progress["readiness_score"],

            # Discussions
            "discussions": [],

            # Status
            "status": "active",
            "promoted_at": None,
            "promoted_by": None,

            "assigned_by": current_user.id,
            "assigned_at": now,
            "updated_at": now,
            "organization_id": organization_id,
        }

        result = await database.employee_career_assignments.insert_one(assignment_doc)
        assignment_doc["_id"] = result.inserted_id

        # Also create/update the legacy career goal for backward compatibility
        if employee.get("user_id"):
            await database.learning_career_goals.update_one(
                {"user_id": employee["user_id"]},
                {
                    "$set": {
                        "target_role": target_level.get("role_title"),
                        "updated_at": now,
                        "ai_path": None,  # Will be rebuilt from framework
                    },
                    "$setOnInsert": {"created_at": now, "user_id": employee["user_id"], "employee_id": employee_id},
                },
                upsert=True,
            )

        return self._public_assignment(assignment_doc)

    async def get_employee_career(self, employee_id: str, organization_id: str | None = None) -> dict:
        query: dict[str, Any] = {"employee_id": employee_id, "status": "active"}
        org_filter = self._org_filter(organization_id)
        if org_filter:
            query = {"$and": [query, org_filter]}
        doc = await database.employee_career_assignments.find_one(query)
        if not doc:
            return {"assignment": None}
        return {"assignment": self._public_assignment(doc)}

    async def update_employee_career(self, employee_id: str, updates: dict, organization_id: str | None = None) -> dict:
        query: dict[str, Any] = {"employee_id": employee_id, "status": "active"}
        org_filter = self._org_filter(organization_id)
        if org_filter:
            query = {"$and": [query, org_filter]}
        doc = await database.employee_career_assignments.find_one(query)
        if not doc:
            raise HTTPException(status_code=404, detail="No active career assignment found.")

        now = _now()
        update_fields = {"updated_at": now}

        if "target_level_id" in updates and updates["target_level_id"]:
            target_level = await database.career_levels.find_one(
                {"_id": ObjectId(updates["target_level_id"]), "is_active": True}
            )
            if not target_level:
                raise HTTPException(status_code=404, detail="Target career level not found.")
            if organization_id:
                level_org = target_level.get("organization_id")
                if level_org and level_org != organization_id:
                    raise HTTPException(status_code=404, detail="Target career level not found.")
            update_fields["target_level_id"] = updates["target_level_id"]
            update_fields["target_level_number"] = target_level.get("level_number")
            update_fields["target_role_title"] = target_level.get("role_title")
            # Rebuild learning path from new target
            new_path = []
            for course in (target_level.get("learning_path") or []):
                new_path.append({
                    "course_uid": course.get("course_uid"),
                    "course_title": course.get("course_title"),
                    "source": course.get("source", "microsoft_learn"),
                    "mandatory": course.get("mandatory", True),
                    "order": course.get("order", 1),
                    "status": "not_started",
                    "progress_percent": 0,
                    "started_at": None,
                    "completed_at": None,
                })
            update_fields["assigned_learning_path"] = new_path

        if "target_date" in updates:
            update_fields["target_date"] = updates["target_date"].isoformat() if isinstance(updates["target_date"], date) and not isinstance(updates["target_date"], datetime) else updates["target_date"]

        if "status" in updates:
            update_fields["status"] = updates["status"]
            if updates["status"] == "completed":
                update_fields["promoted_at"] = now
                update_fields["promoted_by"] = None  # Will be set by recruiter

        await database.employee_career_assignments.update_one(
            {"_id": doc["_id"]},
            {"$set": update_fields},
        )
        updated = await database.employee_career_assignments.find_one({"_id": doc["_id"]})
        return self._public_assignment(updated)

    async def log_career_discussion(
        self,
        employee_id: str,
        current_user: CurrentUser,
        discussion_date: date,
        notes: str | None = None,
        action_items: list[str] | None = None,
        organization_id: str | None = None,
    ) -> dict:
        query: dict[str, Any] = {"employee_id": employee_id, "status": "active"}
        org_filter = self._org_filter(organization_id)
        if org_filter:
            query = {"$and": [query, org_filter]}
        doc = await database.employee_career_assignments.find_one(query)
        if not doc:
            raise HTTPException(status_code=404, detail="No active career assignment found.")

        now = _now()
        discussion = {
            "discussion_date": discussion_date.isoformat(),
            "discussed_by": current_user.id,
            "discussed_by_name": current_user.full_name,
            "notes": notes,
            "action_items": action_items or [],
        }
        await database.employee_career_assignments.update_one(
            {"_id": doc["_id"]},
            {"$push": {"discussions": discussion}, "$set": {"updated_at": now}},
        )
        updated = await database.employee_career_assignments.find_one({"_id": doc["_id"]})
        return self._public_assignment(updated)

    async def bulk_assign(self, current_user: CurrentUser, employee_ids: list[str], target_level_id: str, target_date: date | None = None, organization_id: str | None = None) -> dict:
        assigned = []
        skipped = []
        errors = []

        for eid in employee_ids:
            try:
                result = await self.assign_career(current_user, eid, target_level_id, target_date, organization_id)
                assigned.append(result)
            except HTTPException as e:
                if e.status_code == 409:
                    skipped.append({"employee_id": eid, "reason": str(e.detail)})
                else:
                    errors.append({"employee_id": eid, "error": str(e.detail)})
            except Exception as e:
                errors.append({"employee_id": eid, "error": str(e)})

        return {"assigned": assigned, "skipped": skipped, "errors": errors}

    # ------------------------------------------------------------------ #
    # Employee self-service: View my career path
    # ------------------------------------------------------------------ #

    async def get_my_career(self, current_user: CurrentUser, organization_id: str | None = None) -> dict:
        """Get career assignment for the logged-in employee."""
        employee = await database.employees.find_one(
            {"$or": [{"user_id": current_user.id}, {"email": current_user.email}], "status": "active"}
        )
        if not employee:
            return {"assignment": None}

        query: dict[str, Any] = {"employee_id": employee.get("employee_id"), "status": "active"}
        org_filter = self._org_filter(organization_id)
        if org_filter:
            query = {"$and": [query, org_filter]}
        doc = await database.employee_career_assignments.find_one(query)
        if not doc:
            return {"assignment": None, "message": "No career path assigned yet. Your recruiter will set this up."}

        return {"assignment": self._public_assignment(doc)}

    async def get_my_career_progress(self, current_user: CurrentUser, organization_id: str | None = None) -> dict:
        """Get detailed career progress for the logged-in employee."""
        employee = await database.employees.find_one(
            {"$or": [{"user_id": current_user.id}, {"email": current_user.email}], "status": "active"}
        )
        if not employee:
            return {"progress": None}

        query: dict[str, Any] = {"employee_id": employee.get("employee_id"), "status": "active"}
        org_filter = self._org_filter(organization_id)
        if org_filter:
            query = {"$and": [query, org_filter]}
        doc = await database.employee_career_assignments.find_one(query)
        if not doc:
            return {"progress": None}

        # Enrich learning path with enrollment status
        if employee.get("user_id") and doc.get("assigned_learning_path"):
            enriched_path = await self._enrich_learning_path(employee["user_id"], doc["assigned_learning_path"])
            doc["assigned_learning_path"] = enriched_path
            # Recalculate progress
            progress = self._calculate_progress(
                doc.get("assigned_learning_path", []),
                doc.get("skills_to_acquire", []),
                doc.get("certifications_to_earn", []),
            )
            doc["overall_progress_percent"] = progress["overall_progress_percent"]
            doc["readiness_score"] = progress["readiness_score"]

        return {"assignment": self._public_assignment(doc)}

    # ------------------------------------------------------------------ #
    # Reports
    # ------------------------------------------------------------------ #

    async def get_promotion_readiness(self, current_user: CurrentUser, department: str | None = None, organization_id: str | None = None) -> dict:
        query: dict[str, Any] = {"status": "active"}
        if department:
            query["current_department"] = {"$regex": f"^{department}$", "$options": "i"}
        if current_user.role != "super_admin":
            query["assigned_by"] = current_user.id
        org_filter = self._org_filter(organization_id)
        if org_filter:
            query = {"$and": [query, org_filter]}

        docs = await database.employee_career_assignments.find(query).to_list(length=500)

        ready = []
        almost_ready = []
        behind = []

        for doc in docs:
            item = {
                "employee_id": doc.get("employee_id"),
                "employee_name": doc.get("employee_name"),
                "department": doc.get("current_department"),
                "current_role": doc.get("current_role_title"),
                "target_role": doc.get("target_role_title"),
                "progress_percent": doc.get("overall_progress_percent", 0),
                "readiness_score": doc.get("readiness_score", 0),
                "target_date": doc.get("target_date"),
                "status": doc.get("status"),
            }

            score = item["readiness_score"]
            if score >= 80:
                ready.append(item)
            elif score >= 50:
                almost_ready.append(item)
            else:
                behind.append(item)

        ready.sort(key=lambda x: x["readiness_score"], reverse=True)
        almost_ready.sort(key=lambda x: x["readiness_score"], reverse=True)
        behind.sort(key=lambda x: x["readiness_score"])

        return {
            "ready": ready,
            "almost_ready": almost_ready,
            "behind": behind,
            "total_count": len(docs),
        }

    async def get_career_progress_report(self, current_user: CurrentUser, organization_id: str | None = None) -> dict:
        query: dict[str, Any] = {"status": "active"}
        if current_user.role != "super_admin":
            query["assigned_by"] = current_user.id
        org_filter = self._org_filter(organization_id)
        if org_filter:
            query = {"$and": [query, org_filter]}

        docs = await database.employee_career_assignments.find(query).to_list(length=500)

        by_department: dict[str, dict] = {}
        for doc in docs:
            dept = doc.get("current_department") or "Unassigned"
            if dept not in by_department:
                by_department[dept] = {
                    "department": dept,
                    "total_employees": 0,
                    "on_track_count": 0,
                    "behind_count": 0,
                    "total_progress": 0,
                    "total_readiness": 0,
                }
            stats = by_department[dept]
            stats["total_employees"] += 1
            score = doc.get("readiness_score", 0)
            progress = doc.get("overall_progress_percent", 0)
            stats["total_progress"] += progress
            stats["total_readiness"] += score
            if score >= 50:
                stats["on_track_count"] += 1
            else:
                stats["behind_count"] += 1

        result = []
        total_all = 0
        total_on_track = 0
        total_behind = 0
        for dept, stats in sorted(by_department.items()):
            count = stats["total_employees"]
            avg_progress = round(stats["total_progress"] / count) if count else 0
            avg_readiness = round(stats["total_readiness"] / count) if count else 0
            result.append({
                "department": dept,
                "total_employees": count,
                "on_track_count": stats["on_track_count"],
                "behind_count": stats["behind_count"],
                "avg_progress_percent": avg_progress,
                "avg_readiness_score": avg_readiness,
            })
            total_all += count
            total_on_track += stats["on_track_count"]
            total_behind += stats["behind_count"]

        return {
            "by_department": result,
            "total_employees": total_all,
            "total_on_track": total_on_track,
            "total_behind": total_behind,
        }

    async def list_all_assignments(self, current_user: CurrentUser, department: str | None = None, status_filter: str | None = None, organization_id: str | None = None) -> dict:
        query: dict[str, Any] = {}
        if current_user.role != "super_admin":
            query["assigned_by"] = current_user.id
        if department:
            query["current_department"] = {"$regex": f"^{department}$", "$options": "i"}
        if status_filter:
            query["status"] = status_filter
        else:
            query["status"] = {"$in": ["active", "paused"]}
        org_filter = self._org_filter(organization_id)
        if org_filter:
            query = {"$and": [query, org_filter]}

        docs = await database.employee_career_assignments.find(query).sort("updated_at", -1).to_list(length=500)
        return {"assignments": [self._public_assignment(d) for d in docs]}

    # ------------------------------------------------------------------ #
    # Excel Import / Export
    # ------------------------------------------------------------------ #

    async def export_framework_csv(self, organization_id: str | None = None) -> str:
        """Export the entire career framework as CSV."""
        tracks_query: dict[str, Any] = {"is_active": True}
        levels_query: dict[str, Any] = {"is_active": True}
        org_filter = self._org_filter(organization_id)
        if org_filter:
            tracks_query = {"$and": [tracks_query, org_filter]}
            levels_query = {"$and": [levels_query, org_filter]}
        tracks = await database.career_tracks.find(tracks_query).to_list(length=200)
        levels = await database.career_levels.find(levels_query).to_list(length=500)

        levels_by_track: dict[str, list[dict]] = {}
        for level in levels:
            tid = level.get("track_id", "")
            levels_by_track.setdefault(tid, []).append(level)
        for tid in levels_by_track:
            levels_by_track[tid].sort(key=lambda x: x.get("level_number", 0))

        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow([
            "Department",
            "Track Name",
            "Level",
            "Role Title",
            "Required Skills",
            "Required Certifications",
            "Learning Path Courses",
            "Competencies",
            "Min Experience (Years)",
            "Min Time in Role (Months)",
            "Manager Approval Required",
            "Description",
        ])

        for track in tracks:
            tid = str(track["_id"])
            track_levels = levels_by_track.get(tid, [])
            if not track_levels:
                writer.writerow([
                    track.get("department"),
                    track.get("track_name"),
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    track.get("description") or "",
                ])
                continue

            for level in track_levels:
                skills_str = "; ".join(
                    f"{s.get('skill', '')} ({s.get('proficiency', 'Intermediate')})"
                    for s in (level.get("required_skills") or [])
                )
                certs_str = "; ".join(
                    c.get("certification", "") for c in (level.get("required_certifications") or [])
                )
                courses_str = "; ".join(
                    c.get("course_title", "") for c in (level.get("learning_path") or [])
                )
                competencies_str = "; ".join(
                    f"{c.get('name', '')} ({c.get('weight', 10)}%)" for c in (level.get("competencies") or [])
                )
                writer.writerow([
                    level.get("department"),
                    track.get("track_name"),
                    level.get("level_number"),
                    level.get("role_title"),
                    skills_str,
                    certs_str,
                    courses_str,
                    competencies_str,
                    level.get("min_experience_years", 0),
                    level.get("min_time_in_current_role_months", 0),
                    "Yes" if level.get("manager_approval_required") else "No",
                    level.get("description") or "",
                ])

        return buffer.getvalue()

    async def import_framework_csv(self, current_user: CurrentUser, content: str, organization_id: str | None = None) -> dict:
        """Import career framework from CSV content."""
        now = _now()
        reader = csv.DictReader(io.StringIO(content))

        imported = 0
        skipped = 0
        errors = []

        parsed_rows = []
        for row_num, row in enumerate(reader, start=2):
            try:
                department = (row.get("Department") or "").strip()
                track_name = (row.get("Track Name") or "").strip()
                level_num_str = (row.get("Level") or "").strip()
                role_title = (row.get("Role Title") or "").strip()

                if not department or not role_title:
                    skipped += 1
                    continue

                level_number = int(level_num_str) if level_num_str.isdigit() else 1

                required_skills = []
                skills_str = (row.get("Required Skills") or "").strip()
                if skills_str:
                    for skill_part in skills_str.split(";"):
                        skill_part = skill_part.strip()
                        if "(" in skill_part and skill_part.endswith(")"):
                            name = skill_part.rsplit("(", 1)[0].strip()
                            prof = skill_part.rsplit("(", 1)[1].rstrip(")").strip()
                            if prof not in ("Beginner", "Intermediate", "Advanced", "Expert"):
                                prof = "Intermediate"
                        else:
                            name = skill_part
                            prof = "Intermediate"
                        if name:
                            required_skills.append({"skill": name, "proficiency": prof, "weight": 10})

                required_certifications = []
                certs_str = (row.get("Required Certifications") or "").strip()
                if certs_str:
                    for cert in certs_str.split(";"):
                        cert = cert.strip()
                        if cert:
                            required_certifications.append({"certification": cert, "mandatory": True})

                learning_path = []
                courses_str = (row.get("Learning Path Courses") or "").strip()
                if courses_str:
                    for idx, course_title in enumerate(courses_str.split(";"), start=1):
                        course_title = course_title.strip()
                        if course_title:
                            learning_path.append({
                                "course_uid": f"pending:{course_title.lower().replace(' ', '-')}",
                                "course_title": course_title,
                                "source": "microsoft_learn",
                                "mandatory": True,
                                "order": idx,
                            })

                competencies = []
                comp_str = (row.get("Competencies") or "").strip()
                if comp_str:
                    for comp_part in comp_str.split(";"):
                        comp_part = comp_part.strip()
                        if "(" in comp_part and comp_part.endswith(")"):
                            name = comp_part.rsplit("(", 1)[0].strip()
                            weight_str = comp_part.rsplit("(", 1)[1].rstrip(")").replace("%", "").strip()
                            weight = int(weight_str) if weight_str.isdigit() else 10
                        else:
                            name = comp_part
                            weight = 10
                        if name:
                            competencies.append({"name": name, "weight": weight})

                min_exp = float(row.get("Min Experience (Years)") or 0)
                min_months = int(row.get("Min Time in Role (Months)") or 0)
                manager_approval = (row.get("Manager Approval Required") or "").strip().lower() in ("yes", "true", "1")
                description = (row.get("Description") or "").strip() or None

                parsed_rows.append({
                    "row_num": row_num,
                    "department": department,
                    "track_name": track_name,
                    "level_number": level_number,
                    "role_title": role_title,
                    "required_skills": required_skills,
                    "required_certifications": required_certifications,
                    "learning_path": learning_path,
                    "competencies": competencies,
                    "min_experience_years": min_exp,
                    "min_time_in_current_role_months": min_months,
                    "manager_approval_required": manager_approval,
                    "description": description,
                })
            except Exception as e:
                errors.append({"row": row_num, "error": str(e)})
                skipped += 1

        async def _write(session):
            nonlocal imported
            kwargs = _db_kwargs(session)
            org_filter = self._org_filter(organization_id)
            for row_data in parsed_rows:
                department = row_data["department"]
                track_name = row_data["track_name"]
                level_number = row_data["level_number"]
                role_title = row_data["role_title"]

                existing_query: dict[str, Any] = {
                    "department": {"$regex": f"^{department}$", "$options": "i"},
                    "level_number": level_number,
                    "is_active": True,
                }
                if org_filter:
                    existing_query = {"$and": [existing_query, org_filter]}
                existing = await database.career_levels.find_one(existing_query, **kwargs)
                if existing:
                    await database.career_levels.update_one(
                        {"_id": existing["_id"]},
                        {"$set": {
                            "role_title": role_title,
                            "required_skills": row_data["required_skills"],
                            "required_certifications": row_data["required_certifications"],
                            "learning_path": row_data["learning_path"],
                            "competencies": row_data["competencies"],
                            "min_experience_years": row_data["min_experience_years"],
                            "min_time_in_current_role_months": row_data["min_time_in_current_role_months"],
                            "manager_approval_required": row_data["manager_approval_required"],
                            "description": row_data["description"],
                            "updated_at": now,
                        }},
                        **kwargs
                    )
                else:
                    track_id = ""
                    if track_name:
                        track_query: dict[str, Any] = {
                            "department": {"$regex": f"^{department}$", "$options": "i"},
                            "track_name": {"$regex": f"^{track_name}$", "$options": "i"},
                            "is_active": True,
                        }
                        if org_filter:
                            track_query = {"$and": [track_query, org_filter]}
                        track = await database.career_tracks.find_one(track_query, **kwargs)
                        if not track:
                            track_doc = {
                                "department": department,
                                "track_name": track_name,
                                "description": None,
                                "levels": [],
                                "is_active": True,
                                "created_by": current_user.id,
                                "created_at": now,
                                "updated_at": now,
                                "organization_id": organization_id,
                            }
                            res = await database.career_tracks.insert_one(track_doc, **kwargs)
                            track = await database.career_tracks.find_one({"_id": res.inserted_id}, **kwargs)

                        track_id = str(track["_id"])

                    level_doc = {
                        "track_id": track_id,
                        "department": department,
                        "track_name": track_name,
                        "level_number": level_number,
                        "role_title": role_title,
                        "required_skills": row_data["required_skills"],
                        "required_certifications": row_data["required_certifications"],
                        "learning_path": row_data["learning_path"],
                        "competencies": row_data["competencies"],
                        "min_experience_years": row_data["min_experience_years"],
                        "min_time_in_current_role_months": row_data["min_time_in_current_role_months"],
                        "manager_approval_required": row_data["manager_approval_required"],
                        "description": row_data["description"],
                        "is_active": True,
                        "created_by": current_user.id,
                        "created_at": now,
                        "updated_at": now,
                        "organization_id": organization_id,
                    }
                    result = await database.career_levels.insert_one(level_doc, **kwargs)

                    if track_id:
                        level_summary = {
                            "level_number": level_number,
                            "role_title": role_title,
                            "career_level_id": str(result.inserted_id),
                        }
                        await database.career_tracks.update_one(
                            {"_id": ObjectId(track_id)},
                            {"$push": {"levels": level_summary}, "$set": {"updated_at": now}},
                            **kwargs
                        )
                imported += 1

            all_tracks_query: dict[str, Any] = {"is_active": True}
            if org_filter:
                all_tracks_query = {"$and": [all_tracks_query, org_filter]}
            all_tracks = await database.career_tracks.find(all_tracks_query, **kwargs).to_list(length=200)
            for track in all_tracks:
                levels = sorted(track.get("levels", []), key=lambda x: x.get("level_number", 0))
                await database.career_tracks.update_one(
                    {"_id": track["_id"]},
                    {"$set": {"levels": levels}},
                    **kwargs
                )

        await try_transaction(_write)

        return {"imported": imported, "skipped": skipped, "errors": errors}

    # ------------------------------------------------------------------ #
    # Internal helpers
    # ------------------------------------------------------------------ #

    async def _find_level_by_title(self, job_title: str | None, department: str | None, organization_id: str | None = None) -> dict | None:
        if not job_title:
            return None
        query: dict[str, Any] = {
            "role_title": {"$regex": f"^{job_title}$", "$options": "i"},
            "is_active": True,
        }
        if department:
            query["department"] = {"$regex": f"^{department}$", "$options": "i"}
        org_filter = self._org_filter(organization_id)
        if org_filter:
            query = {"$and": [query, org_filter]}
        return await database.career_levels.find_one(query)

    async def _get_employee_skill_names(self, user_id: str | None) -> list[dict]:
        if not user_id:
            return []
        skills = await database.employee_skills.find({"user_id": user_id}).to_list(length=200)
        return [{"skill": s.get("skill_name", ""), "proficiency": s.get("proficiency", "Beginner")} for s in skills]

    def _find_skill_proficiency(self, current_skills: list[dict], skill_name: str) -> str | None:
        for s in current_skills:
            if s.get("skill", "").lower() == skill_name.lower():
                return s.get("proficiency")
        return None

    def _proficiency_rank(self, proficiency: str) -> int:
        return {"Beginner": 1, "Intermediate": 2, "Advanced": 3, "Expert": 4}.get(proficiency, 0)

    async def _get_employee_cert_titles(self, user_id: str | None) -> list[str]:
        if not user_id:
            return []
        certs = await database.learning_certificates.find(
            {"user_id": user_id, "verification_status": "verified"}
        ).to_list(length=100)
        return [c.get("course_title", "") for c in certs if c.get("course_title")]

    def _calculate_progress(
        self,
        learning_path: list[dict],
        skills_to_acquire: list[dict],
        certifications_to_earn: list[dict],
    ) -> dict:
        total_weight = 0
        completed_weight = 0

        for course in learning_path:
            weight = int(course.get("weight") or 10)
            total_weight += weight
            if course.get("status") == "completed":
                completed_weight += weight

        for skill in skills_to_acquire:
            weight = int(skill.get("weight") or 10)
            total_weight += weight
            if skill.get("current_status") == "acquired":
                completed_weight += weight

        for cert in certifications_to_earn:
            weight = int(cert.get("weight") or 10)
            total_weight += weight
            if cert.get("status") == "earned":
                completed_weight += weight

        overall = round(completed_weight / total_weight * 100) if total_weight else 100
        readiness = overall

        return {
            "overall_progress_percent": overall,
            "readiness_score": readiness,
        }

    async def _enrich_learning_path(self, user_id: str, learning_path: list[dict]) -> list[dict]:
        """Enrich the learning path with enrollment status from the learning module."""
        course_uids = [c.get("course_uid") for c in learning_path if c.get("course_uid") and not c.get("course_uid", "").startswith("pending:")]
        if not course_uids:
            return learning_path

        enrollments = await database.learning_enrollments.find(
            {"user_id": user_id, "course_uid": {"$in": course_uids}}
        ).to_list(length=500)
        enrollment_map = {e["course_uid"]: e for e in enrollments}

        for course in learning_path:
            uid = course.get("course_uid", "")
            if uid.startswith("pending:"):
                continue
            enrollment = enrollment_map.get(uid)
            if enrollment:
                status = enrollment.get("status", "in_progress")
                course["status"] = "completed" if status == "completed" else "in_progress"
                course["progress_percent"] = enrollment.get("progress_percent", 0)
                if enrollment.get("started_at"):
                    course["started_at"] = _iso(enrollment["started_at"])
                if enrollment.get("completed_at"):
                    course["completed_at"] = _iso(enrollment["completed_at"])

        return learning_path

    def _public_assignment(self, doc: dict) -> dict:
        discussions = []
        for d in (doc.get("discussions") or []):
            discussions.append({
                "discussion_date": d.get("discussion_date"),
                "discussed_by": d.get("discussed_by"),
                "discussed_by_name": d.get("discussed_by_name"),
                "notes": d.get("notes"),
                "action_items": d.get("action_items") or [],
            })

        return {
            "id": str(doc["_id"]),
            "employee_id": doc.get("employee_id"),
            "employee_name": doc.get("employee_name"),
            "current_department": doc.get("current_department"),
            "current_track_id": doc.get("current_track_id"),
            "current_track_name": doc.get("current_track_name"),
            "current_level_number": doc.get("current_level_number"),
            "current_role_title": doc.get("current_role_title"),
            "target_level_id": doc.get("target_level_id"),
            "target_level_number": doc.get("target_level_number"),
            "target_role_title": doc.get("target_role_title"),
            "target_date": doc.get("target_date"),
            "assigned_learning_path": doc.get("assigned_learning_path") or [],
            "skills_to_acquire": doc.get("skills_to_acquire") or [],
            "certifications_to_earn": doc.get("certifications_to_earn") or [],
            "overall_progress_percent": doc.get("overall_progress_percent", 0),
            "readiness_score": doc.get("readiness_score", 0),
            "discussions": discussions,
            "status": doc.get("status"),
            "promoted_at": _iso(doc.get("promoted_at")),
            "promoted_by": doc.get("promoted_by"),
            "assigned_by": doc.get("assigned_by"),
            "assigned_at": _iso(doc.get("assigned_at")),
            "updated_at": _iso(doc.get("updated_at")),
        }


career_framework_service = CareerFrameworkService()

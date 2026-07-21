"""Phase 3 — Epic 6 (Learning Management) + Epic 8 skill/career slice.

Covers US-065, US-066, US-068, US-069, US-072, US-073, US-074, US-075, US-076
(Learning Management) plus the minimal Epic 8 surface needed to support the
"skill gap -> AI recommendation -> career path" flow: US-092, US-093, US-094,
US-095/US-099 (career goal + AI path), US-100 (skill gap dashboard).
"""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

CourseType = Literal["learningPath", "module", "certification"]
ProficiencyLevel = Literal["Beginner", "Intermediate", "Advanced", "Expert"]

SKILL_CATEGORIES: list[str] = [
    "Programming",
    "Cloud",
    "AI & Machine Learning",
    "Database",
    "Soft Skills",
    "Communication",
    "Leadership",
    "Project Management",
    "Security",
    "DevOps",
    "Other",
]


class CourseAssignRequest(BaseModel):
    """US-068: Assign a course to employees, optionally filtered by department/designation.

    Provide employee_ids and/or department and/or job_title (designation).
    When department/job_title is set without employee_ids, all matching active
    employees under the recruiter are targeted.
    """

    employee_ids: list[str] = Field(default_factory=list)
    department: str | None = Field(default=None, max_length=120)
    job_title: str | None = Field(default=None, max_length=120)
    course_uid: str = Field(min_length=1, max_length=300)
    course_title: str = Field(min_length=1, max_length=300)
    course_url: str = Field(min_length=1, max_length=1000)
    course_type: CourseType = "learningPath"
    duration_minutes: int | None = None
    due_date: date | None = None
    note: str | None = Field(default=None, max_length=1000)

    @field_validator("employee_ids")
    @classmethod
    def dedupe_ids(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(v.strip() for v in value if v and v.strip()))

    @field_validator("department", "job_title")
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    @model_validator(mode="after")
    def require_targets(self):
        if not self.employee_ids and not self.department and not self.job_title:
            raise ValueError("Provide employee_ids and/or department and/or job_title.")
        return self


class BookmarkRequest(BaseModel):
    """US-073."""

    course_uid: str = Field(min_length=1, max_length=300)
    course_title: str = Field(min_length=1, max_length=300)
    course_url: str = Field(min_length=1, max_length=1000)
    course_type: CourseType = "learningPath"
    duration_minutes: int | None = None
    level: str | None = None


class CertificateUploadMeta(BaseModel):
    """Companion metadata sent alongside the multipart certificate file."""

    course_uid: str | None = None
    course_title: str = Field(min_length=1, max_length=300)
    completion_date: date | None = None
    learning_hours: float | None = Field(default=None, ge=0, le=2000)


class CertificateVerifyRequest(BaseModel):
    """Recruiter verifies/rejects an uploaded completion certificate."""

    approve: bool
    note: str | None = Field(default=None, max_length=500)


class SkillUpsertRequest(BaseModel):
    """US-092 / US-094."""

    skill_name: str = Field(min_length=1, max_length=120)
    category: str = Field(default="Other", max_length=60)
    proficiency: ProficiencyLevel = "Beginner"
    years_experience: float | None = Field(default=None, ge=0, le=50)

    @field_validator("skill_name", "category")
    @classmethod
    def normalize(cls, value: str) -> str:
        return " ".join(value.split())

    @field_validator("category")
    @classmethod
    def validate_category(cls, value: str) -> str:
        return value if value in SKILL_CATEGORIES else "Other"


class CareerGoalRequest(BaseModel):
    """US-095 / US-099 (lite): employee selects a target role for AI career-path guidance."""

    target_role: str = Field(min_length=2, max_length=150)

    @model_validator(mode="after")
    def normalize(self):
        self.target_role = " ".join(self.target_role.split())
        return self


class EnrollmentProgressRequest(BaseModel):
    """Employee self-reports progress on a started course."""

    progress_percent: int = Field(ge=0, le=100)
    status: Literal["in_progress", "completed"] | None = None

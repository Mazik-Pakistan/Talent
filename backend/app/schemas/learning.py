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

CourseType = Literal["learningPath", "module", "certification", "course"]
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
    """US-067 / US-068: Assign a course to employees, optionally filtered by
    department, designation (job_title), or required skills.

    Provide employee_ids and/or department and/or job_title and/or required_skills.
    When filters are set without employee_ids, matching active employees under
    the recruiter are targeted. Due dates are auto-generated when omitted.
    """

    employee_ids: list[str] = Field(default_factory=list)
    department: str | None = Field(default=None, max_length=120)
    job_title: str | None = Field(
        default=None,
        max_length=120,
        description="Designation / joining role filter.",
    )
    joining_role: str | None = Field(
        default=None,
        max_length=120,
        description="Alias for job_title (joining role).",
    )
    required_skills: list[str] = Field(
        default_factory=list,
        max_length=20,
        description="When set, only employees who have at least one of these skills are targeted.",
    )
    course_uid: str = Field(min_length=1, max_length=300)
    course_title: str = Field(min_length=1, max_length=300)
    course_url: str = Field(min_length=1, max_length=1000)
    course_type: CourseType = "learningPath"
    duration_minutes: int | None = None
    due_date: date | None = None
    mandatory: bool = False
    note: str | None = Field(default=None, max_length=1000)

    @field_validator("employee_ids")
    @classmethod
    def dedupe_ids(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(v.strip() for v in value if v and v.strip()))

    @field_validator("department", "job_title", "joining_role")
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    @field_validator("required_skills")
    @classmethod
    def clean_skills(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(s.strip() for s in value if s and s.strip()))

    @field_validator("course_url")
    @classmethod
    def validate_course_url(cls, value: str) -> str:
        """Validate course URL format."""
        from app.schemas.auth import validate_url_format
        validated = validate_url_format(value, "course URL")
        if validated is None:
            raise ValueError("Course URL is required.")
        return validated

    @field_validator("department", "job_title", "joining_role", "course_title", "note")
    @classmethod
    def sanitize_text(cls, value: str | None) -> str | None:
        """Basic HTML sanitization for text fields."""
        if value is None:
            return None
        from app.schemas.auth import sanitize_html
        return sanitize_html(value)

    @field_validator("due_date")
    @classmethod
    def validate_due_date(cls, value: date | None) -> date | None:
        """Validate due date is not in the past."""
        if value is None:
            return None
        if value < date.today():
            raise ValueError("Due date cannot be in the past.")
        return value

    @field_validator("duration_minutes")
    @classmethod
    def validate_duration(cls, value: int | None) -> int | None:
        """Validate duration is positive."""
        if value is None:
            return None
        if value <= 0:
            raise ValueError("Duration must be positive.")
        return value

    @model_validator(mode="after")
    def require_targets(self):
        # joining_role is an alias for designation / job_title
        if self.joining_role and not self.job_title:
            self.job_title = self.joining_role
        if (
            not self.employee_ids
            and not self.department
            and not self.job_title
            and not self.required_skills
        ):
            raise ValueError(
                "Provide employee_ids and/or department and/or job_title/joining_role and/or required_skills."
            )
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


class ManagedLearningCourseBase(BaseModel):
    """Managed roadmap course used for imported / manual learning content."""

    title: str = Field(min_length=1, max_length=300)
    url: str | None = Field(default=None, max_length=1000)
    provider: str = Field(default="LinkedIn Learning", max_length=120)
    designation: str = Field(default="", max_length=120)
    learning_month: str = Field(default="", max_length=120)
    category: str = Field(default="", max_length=120)
    competency: str = Field(default="", max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    duration_minutes: int | None = Field(default=None, ge=1, le=20000)
    archived: bool = False

    @field_validator("title", "provider", "designation", "learning_month", "category", "competency")
    @classmethod
    def clean_text(cls, value: str) -> str:
        return " ".join(value.split())

    @field_validator("url")
    @classmethod
    def clean_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        from app.schemas.auth import validate_url_format

        validated = validate_url_format(value, "course URL")
        return validated

    @field_validator("description")
    @classmethod
    def clean_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        from app.schemas.auth import sanitize_html

        return sanitize_html(value)


class ManagedLearningCourseCreateRequest(ManagedLearningCourseBase):
    """Create a single managed learning course manually."""


class ManagedLearningCourseUpdateRequest(BaseModel):
    """Update a managed learning course."""

    title: str | None = Field(default=None, max_length=300)
    url: str | None = Field(default=None, max_length=1000)
    provider: str | None = Field(default=None, max_length=120)
    designation: str | None = Field(default=None, max_length=120)
    learning_month: str | None = Field(default=None, max_length=120)
    category: str | None = Field(default=None, max_length=120)
    competency: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    duration_minutes: int | None = Field(default=None, ge=1, le=20000)
    archived: bool | None = None

    @field_validator("title", "provider", "designation", "learning_month", "category", "competency")
    @classmethod
    def clean_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return " ".join(value.split())

    @field_validator("url")
    @classmethod
    def clean_optional_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        from app.schemas.auth import validate_url_format

        return validate_url_format(value, "course URL")

    @field_validator("description")
    @classmethod
    def clean_optional_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        from app.schemas.auth import sanitize_html

        return sanitize_html(value)


class ManagedLearningImportRow(BaseModel):
    """Preview row for roadmap imports."""

    row: int
    designation: str | None = None
    learning_month: str | None = None
    category: str | None = None
    competency: str | None = None
    title: str | None = None
    url: str | None = None
    duration_minutes: int | None = None
    provider: str | None = None
    description: str | None = None
    status: Literal["new", "updated", "duplicate", "invalid"] = "new"
    issues: list[str] = Field(default_factory=list)
    existing_id: str | None = None


class ManagedLearningImportPreview(BaseModel):
    """Import preview returned before saving managed learning data."""

    filename: str | None = None
    total_rows: int = 0
    new_courses: int = 0
    updated_courses: int = 0
    duplicate_courses: int = 0
    invalid_rows: int = 0
    rows: list[ManagedLearningImportRow] = Field(default_factory=list)

"""Career Framework Schema for Organization-Wide Career Progression.

This module defines the schema for managing career frameworks:
- Career Tracks: Department-specific career paths
- Career Levels: Individual levels within a track (with requirements)
- Employee Career Assignments: Assigning career paths to employees

Design:
- Recruiter defines career framework once for the organization
- Each department has its own career track
- Employees are assigned career paths based on their department/role
- Progress is tracked automatically as employees complete courses/skills
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


# --------------------------------------------------------------------------- #
# Career Level - Individual level within a career track
# --------------------------------------------------------------------------- #

ProficiencyLevel = Literal["Beginner", "Intermediate", "Advanced", "Expert"]


class SkillRequirement(BaseModel):
    """A required skill with target proficiency level."""

    skill: str = Field(min_length=1, max_length=120)
    proficiency: ProficiencyLevel = "Intermediate"
    weight: int = Field(default=10, ge=1, le=100, description="Weight for readiness calculation")

    @field_validator("skill")
    @classmethod
    def normalize_skill(cls, v: str) -> str:
        return " ".join(v.split())


class CertificationRequirement(BaseModel):
    """A required certification for a career level."""

    certification: str = Field(min_length=1, max_length=200)
    mandatory: bool = True
    provider: str | None = Field(default=None, max_length=120)

    @field_validator("certification")
    @classmethod
    def normalize_cert(cls, v: str) -> str:
        return " ".join(v.split())


class CourseInPath(BaseModel):
    """A course in a career level's learning path."""

    course_uid: str = Field(min_length=1, max_length=300)
    course_title: str = Field(min_length=1, max_length=300)
    source: str = Field(default="microsoft_learn", max_length=60)
    mandatory: bool = True
    order: int = Field(default=1, ge=1)

    @field_validator("course_title")
    @classmethod
    def normalize_title(cls, v: str) -> str:
        return " ".join(v.split())


class Competency(BaseModel):
    """A competency to be assessed for promotion."""

    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    weight: int = Field(default=10, ge=1, le=100, description="Weight in readiness calculation")

    @field_validator("name")
    @classmethod
    def normalize_name(cls, v: str) -> str:
        return " ".join(v.split())


class CareerLevelCreate(BaseModel):
    """Create a new career level."""

    department: str = Field(min_length=1, max_length=120)
    track_name: str = Field(default="", max_length=120, description="Career track name, e.g., 'Software Engineering'")
    level_number: int = Field(ge=1, le=20, description="Level number in the career track")
    role_title: str = Field(min_length=1, max_length=120)

    required_skills: list[SkillRequirement] = Field(default_factory=list)
    required_certifications: list[CertificationRequirement] = Field(default_factory=list)
    learning_path: list[CourseInPath] = Field(default_factory=list)
    competencies: list[Competency] = Field(default_factory=list)

    min_experience_years: float = Field(default=0, ge=0, le=50)
    min_time_in_current_role_months: int = Field(default=0, ge=0, le=120)
    manager_approval_required: bool = False

    description: str | None = Field(default=None, max_length=1000)

    @field_validator("role_title", "department", "track_name")
    @classmethod
    def normalize_text(cls, v: str) -> str:
        return " ".join(v.split())

    @field_validator("level_number")
    @classmethod
    def validate_level_number(cls, v: int) -> int:
        if v < 1:
            raise ValueError("Level number must be at least 1")
        return v


class CareerLevelUpdate(BaseModel):
    """Update an existing career level."""

    role_title: str | None = Field(default=None, max_length=120)
    required_skills: list[SkillRequirement] | None = None
    required_certifications: list[CertificationRequirement] | None = None
    learning_path: list[CourseInPath] | None = None
    competencies: list[Competency] | None = None
    min_experience_years: float | None = Field(default=None, ge=0, le=50)
    min_time_in_current_role_months: int | None = Field(default=None, ge=0, le=120)
    manager_approval_required: bool | None = None
    description: str | None = None
    is_active: bool | None = None

    @field_validator("role_title")
    @classmethod
    def normalize_text(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return " ".join(v.split())


class CareerLevelResponse(BaseModel):
    """Response for a career level."""

    id: str
    department: str
    track_name: str
    level_number: int
    role_title: str

    required_skills: list[SkillRequirement]
    required_certifications: list[CertificationRequirement]
    learning_path: list[CourseInPath]
    competencies: list[Competency]

    min_experience_years: float
    min_time_in_current_role_months: int
    manager_approval_required: bool
    description: str | None

    is_active: bool
    created_by: str
    created_at: str
    updated_at: str


# --------------------------------------------------------------------------- #
# Career Track - Collection of levels for a department
# --------------------------------------------------------------------------- #

class CareerTrackCreate(BaseModel):
    """Create a new career track for a department."""

    department: str = Field(min_length=1, max_length=120)
    track_name: str = Field(min_length=1, max_length=120, description="e.g., 'Software Engineering', 'Sales'")
    description: str | None = Field(default=None, max_length=500)

    @field_validator("department", "track_name")
    @classmethod
    def normalize_text(cls, v: str) -> str:
        return " ".join(v.split())


class CareerTrackUpdate(BaseModel):
    """Update a career track."""

    track_name: str | None = Field(default=None, max_length=120)
    description: str | None = None
    is_active: bool | None = None

    @field_validator("track_name")
    @classmethod
    def normalize_text(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return " ".join(v.split())


class LevelSummary(BaseModel):
    """Summary of a level within a track."""

    level_number: int
    role_title: str
    career_level_id: str


class CareerTrackResponse(BaseModel):
    """Response for a career track with all levels."""

    id: str
    department: str
    track_name: str
    description: str | None
    levels: list[LevelSummary]
    is_active: bool
    created_by: str
    created_at: str
    updated_at: str


# --------------------------------------------------------------------------- #
# Employee Career Assignment
# --------------------------------------------------------------------------- #

class AssignedCourse(BaseModel):
    """A course assigned to an employee for their career progression."""

    course_uid: str
    course_title: str
    source: str
    mandatory: bool
    order: int
    status: Literal["not_started", "in_progress", "completed"] = "not_started"
    progress_percent: int = Field(default=0, ge=0, le=100)
    started_at: str | None = None
    completed_at: str | None = None


class SkillToAcquire(BaseModel):
    """A skill an employee needs to acquire for promotion."""

    skill: str
    current_proficiency: ProficiencyLevel | None = None
    target_proficiency: ProficiencyLevel
    current_status: Literal["not_started", "in_progress", "acquired"] = "not_started"


class CertificationToEarn(BaseModel):
    """A certification an employee needs to earn for promotion."""

    certification: str
    mandatory: bool = True
    status: Literal["not_started", "in_progress", "earned"] = "not_started"
    earned_at: str | None = None


class CareerDiscussion(BaseModel):
    """A career discussion between recruiter and employee."""

    discussion_date: str
    discussed_by: str
    discussed_by_name: str
    notes: str | None = None
    action_items: list[str] = Field(default_factory=list)


class EmployeeCareerAssignRequest(BaseModel):
    """Assign a career path to an employee."""

    employee_id: str = Field(min_length=1, max_length=20)
    target_level_id: str = Field(min_length=1, description="Target career level ID")
    target_date: date | None = Field(default=None, description="Target promotion date")

    @field_validator("target_date")
    @classmethod
    def validate_target_date(cls, v: date | None) -> date | None:
        if v is None:
            return None
        if v < date.today():
            raise ValueError("Target date cannot be in the past")
        return v


class EmployeeCareerUpdateRequest(BaseModel):
    """Update an employee's career assignment."""

    target_level_id: str | None = None
    target_date: date | None = None
    status: Literal["active", "paused", "completed"] | None = None

    @field_validator("target_date")
    @classmethod
    def validate_target_date(cls, v: date | None) -> date | None:
        if v is None:
            return None
        if v < date.today():
            raise ValueError("Target date cannot be in the past")
        return v


class CareerDiscussionRequest(BaseModel):
    """Log a career discussion with an employee."""

    discussion_date: date = Field(default_factory=date.today)
    notes: str | None = Field(default=None, max_length=2000)
    action_items: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("action_items")
    @classmethod
    def validate_action_items(cls, v: list[str]) -> list[str]:
        return [item.strip() for item in v if item and item.strip()]


class EmployeeCareerResponse(BaseModel):
    """Response for an employee's career assignment."""

    id: str
    employee_id: str
    employee_name: str

    # Current position
    current_department: str
    current_track_id: str | None
    current_track_name: str | None
    current_level_number: int
    current_role_title: str

    # Target position
    target_level_id: str
    target_level_number: int
    target_role_title: str
    target_date: str | None

    # Learning path
    assigned_learning_path: list[AssignedCourse]

    # Skills and certifications
    skills_to_acquire: list[SkillToAcquire]
    certifications_to_earn: list[CertificationToEarn]

    # Progress
    overall_progress_percent: int
    readiness_score: int

    # Discussions
    discussions: list[CareerDiscussion]

    # Status
    status: str
    promoted_at: str | None
    promoted_by: str | None

    assigned_by: str
    assigned_at: str
    updated_at: str


# --------------------------------------------------------------------------- #
# Bulk Assignment
# --------------------------------------------------------------------------- #

class BulkCareerAssignRequest(BaseModel):
    """Assign career paths to multiple employees."""

    employee_ids: list[str] = Field(min_length=1, max_length=100)
    target_level_id: str = Field(min_length=1)
    target_date: date | None = None

    @field_validator("employee_ids")
    @classmethod
    def dedupe_ids(cls, v: list[str]) -> list[str]:
        return list(dict.fromkeys(id.strip() for id in v if id and id.strip()))

    @field_validator("target_date")
    @classmethod
    def validate_target_date(cls, v: date | None) -> date | None:
        if v is None:
            return None
        if v < date.today():
            raise ValueError("Target date cannot be in the past")
        return v


class BulkCareerAssignResult(BaseModel):
    """Result of bulk career assignment."""

    assigned: list[dict[str, Any]]
    skipped: list[dict[str, Any]]
    errors: list[dict[str, Any]]


# --------------------------------------------------------------------------- #
# Reports
# --------------------------------------------------------------------------- #

class PromotionReadinessItem(BaseModel):
    """An employee's promotion readiness summary."""

    employee_id: str
    employee_name: str
    department: str
    current_role: str
    target_role: str
    progress_percent: int
    readiness_score: int
    target_date: str | None
    status: str


class PromotionReadinessReport(BaseModel):
    """Report of employees ready for promotion."""

    ready: list[PromotionReadinessItem]
    almost_ready: list[PromotionReadinessItem]
    behind: list[PromotionReadinessItem]
    total_count: int


class CareerProgressByDepartment(BaseModel):
    """Career progress summary by department."""

    department: str
    total_employees: int
    on_track_count: int
    behind_count: int
    avg_progress_percent: float
    avg_readiness_score: float


class CareerProgressReport(BaseModel):
    """Report of career progress across organization."""

    by_department: list[CareerProgressByDepartment]
    total_employees: int
    total_on_track: int
    total_behind: int

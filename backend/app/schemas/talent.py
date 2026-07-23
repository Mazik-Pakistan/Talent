"""Schemas for the Talent Management module (Phase 3, Epic 8: US-090 - US-104).

Skills themselves (US-090/US-091) and AI career-path/skill-gap/role-matches
(US-097/US-098) already live in app/schemas/learning.py and app/api/learning.py
— this module covers everything in Epic 8 that did not exist yet: career
progression ladders, the employee journey timeline, internal opportunities,
competency evaluation, talent search, achievements, recruiter talent metrics,
development plans, and the aggregated 360 profile.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

COMPETENCY_DIMENSIONS: list[str] = [
    "technical",
    "leadership",
    "communication",
    "collaboration",
    "problem_solving",
    "innovation",
]

OpportunityType = Literal["internal_project", "cross_functional", "temporary_assignment", "open_position"]
OpportunityStatus = Literal["open", "closed"]
ApplicationStatus = Literal["applied", "shortlisted", "rejected", "accepted"]


# ---------------------------------------------------------------------- #
# US-095: Internal opportunities
# ---------------------------------------------------------------------- #
class InternalOpportunityCreateRequest(BaseModel):
    title: str = Field(min_length=2, max_length=160)
    type: OpportunityType
    department: str = Field(min_length=2, max_length=120)
    description: str = Field(min_length=5, max_length=4000)
    required_skills: list[str] = Field(default_factory=list, max_length=30)
    location: str | None = Field(default=None, max_length=120)
    commitment: str | None = Field(default=None, max_length=120, description="e.g. 'Full-time', '~5 hrs/week'")
    closes_at: date | None = None

    @field_validator("title", "description")
    @classmethod
    def _strip_required(cls, value: str) -> str:
        return " ".join(value.split())

    @field_validator("required_skills")
    @classmethod
    def _clean_skills(cls, value: list[str]) -> list[str]:
        return [s.strip() for s in value if s and s.strip()]


class InternalOpportunityUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=160)
    description: str | None = Field(default=None, min_length=5, max_length=4000)
    required_skills: list[str] | None = None
    status: OpportunityStatus | None = None
    closes_at: date | None = None


# ---------------------------------------------------------------------- #
# US-099: Competency evaluation
# ---------------------------------------------------------------------- #
class CompetencyEvaluationRequest(BaseModel):
    technical: int = Field(ge=1, le=5)
    leadership: int = Field(ge=1, le=5)
    communication: int = Field(ge=1, le=5)
    collaboration: int = Field(ge=1, le=5)
    problem_solving: int = Field(ge=1, le=5)
    innovation: int = Field(ge=1, le=5)
    comments: str | None = Field(default=None, max_length=2000)

    @field_validator("comments")
    @classmethod
    def _strip_comments(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


# ---------------------------------------------------------------------- #
# US-103: Development plan (recruiter-editable milestones over the
# AI-generated path already produced by learning_path_service).
# ---------------------------------------------------------------------- #
class DevelopmentMilestoneUpdate(BaseModel):
    id: str
    status: Literal["pending", "in_progress", "completed"] | None = None
    due_date: date | None = None
    note: str | None = Field(default=None, max_length=1000)


class DevelopmentPlanUpdateRequest(BaseModel):
    target_timeline: str | None = Field(default=None, max_length=120)
    milestones: list[DevelopmentMilestoneUpdate] = Field(default_factory=list)
    recruiter_note: str | None = Field(default=None, max_length=2000)


# ---------------------------------------------------------------------- #
# US-100: Talent search
# ---------------------------------------------------------------------- #
class TalentSearchRequest(BaseModel):
    q: str | None = None
    skills: list[str] = Field(default_factory=list)
    certifications: list[str] = Field(default_factory=list)
    department: str | None = None
    min_experience_years: float | None = Field(default=None, ge=0)
    min_performance_rating: float | None = Field(default=None, ge=0, le=5)
    min_learning_progress: float | None = Field(default=None, ge=0, le=100)
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=60)

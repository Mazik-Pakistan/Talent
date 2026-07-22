"""Pydantic schemas for recruiter learning knowledge base."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

Difficulty = Literal["Beginner", "Intermediate", "Advanced", "Expert"]
Priority = Literal["critical", "immediate", "medium", "low"]


class KbRoleCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    required_skills: list[str] = Field(default_factory=list)
    required_certifications: list[str] = Field(default_factory=list)
    certification_ids: list[str] = Field(default_factory=list)
    difficulty: str | None = None
    priority: Priority = "medium"

    @field_validator("title")
    @classmethod
    def strip_title(cls, value: str) -> str:
        return " ".join(value.split())

    @field_validator("required_skills", "required_certifications", "certification_ids")
    @classmethod
    def clean_lists(cls, value: list[str]) -> list[str]:
        return [v.strip() for v in value if v and str(v).strip()]


class KbRoleUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    required_skills: list[str] | None = None
    required_certifications: list[str] | None = None
    certification_ids: list[str] | None = None
    difficulty: str | None = None
    priority: Priority | None = None


class KbCertificationCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    provider: str | None = Field(default=None, max_length=120)
    official_url: str | None = Field(default=None, max_length=1000)
    description: str | None = Field(default=None, max_length=4000)
    skills_covered: list[str] = Field(default_factory=list)
    estimated_hours: float | None = Field(default=None, ge=0, le=2000)
    difficulty: str = "Intermediate"
    priority: Priority = "medium"
    role_ids: list[str] = Field(default_factory=list)

    @field_validator("title", "provider")
    @classmethod
    def strip_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return " ".join(value.split())

    @field_validator("skills_covered", "role_ids")
    @classmethod
    def clean_lists(cls, value: list[str]) -> list[str]:
        return [v.strip() for v in value if v and str(v).strip()]


class KbCertificationUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    provider: str | None = Field(default=None, max_length=120)
    official_url: str | None = Field(default=None, max_length=1000)
    url: str | None = Field(default=None, max_length=1000)
    description: str | None = Field(default=None, max_length=4000)
    skills_covered: list[str] | None = None
    estimated_hours: float | None = Field(default=None, ge=0, le=2000)
    difficulty: str | None = None
    priority: Priority | None = None
    role_ids: list[str] | None = None

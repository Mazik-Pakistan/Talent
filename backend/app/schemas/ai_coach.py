"""Phase 4 — AI Coach (employee) / AI Assistant (recruiter) schemas."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)

    @field_validator("message")
    @classmethod
    def strip_message(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Message cannot be empty.")
        return cleaned


class KnowledgeIngestRequest(BaseModel):
    """Recruiter/super-admin uploads a company policy or career-ladder
    document (plain text) into the shared knowledge base."""

    title: str = Field(min_length=3, max_length=200)
    text: str = Field(min_length=20, max_length=200_000)
    role_scope: list[Literal["employee", "recruiter"]] = Field(
        default_factory=lambda: ["employee", "recruiter"]
    )

    @field_validator("title")
    @classmethod
    def strip_title(cls, value: str) -> str:
        return " ".join(value.split())

    @field_validator("text")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

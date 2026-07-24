"""AI Agent (hiring + onboarding automation) — chat request/response schemas."""

from __future__ import annotations

from pydantic import BaseModel, Field


class AgentChatRequest(BaseModel):
    message: str = Field(default="", max_length=4000)
    session_id: str | None = Field(default=None, max_length=64)


class AgentMessage(BaseModel):
    role: str  # "user" | "assistant" | "system"
    content: str
    created_at: str | None = None
    meta: dict | None = None


class AgentChatResponse(BaseModel):
    session_id: str
    reply: str
    messages: list[AgentMessage]
    suggested_replies: list[str] = Field(default_factory=list)
    ui_hint: dict | None = None
    attachment: dict | None = None
    state: dict | None = None


class AgentResetRequest(BaseModel):
    session_id: str | None = None
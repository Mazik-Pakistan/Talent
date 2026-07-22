"""Phase 4 — AI Coach (employee) / AI Assistant (recruiter) endpoints.

Role separation is enforced at three layers:
  1. require_permissions() below — an employee JWT cannot call the recruiter
     knowledge-ingest endpoint and vice versa.
  2. ai_coach_service.chat() picks the prompt/role scope from the *verified*
     current_user.role, never from client input.
  3. rag_store_service queries are filtered by role_scope/owner_id in Mongo,
     so retrieval itself cannot cross scopes even if 1/2 had a bug.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.rbac import CurrentUser
from app.core.security import require_permissions, require_roles
from app.schemas.ai_coach import ChatRequest, KnowledgeIngestRequest
from app.services import ai_coach_service, knowledge_service

router = APIRouter(prefix="/api/ai-coach", tags=["AI Coach"])

RequireEmployeeCoach = Annotated[CurrentUser, Depends(require_permissions("ai.coach"))]
RequireAnyCoach = Annotated[
    CurrentUser, Depends(require_roles("employee", "recruiter", "super_admin"))
]
RequireKnowledgeManage = Annotated[
    CurrentUser, Depends(require_roles("recruiter", "super_admin"))
]


@router.post("/chat")
async def chat(payload: ChatRequest, current_user: RequireAnyCoach):
    try:
        return await ai_coach_service.chat(current_user, payload.message)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/history")
async def history(current_user: RequireAnyCoach, limit: int = 50):
    return await ai_coach_service.get_history(current_user, limit=min(max(limit, 1), 200))


@router.delete("/history")
async def clear_history(current_user: RequireAnyCoach):
    return await ai_coach_service.clear_history(current_user)


# ---------------------------------------------------------------------- #
# Knowledge base management (recruiter / super admin only)
# ---------------------------------------------------------------------- #
@router.post("/knowledge")
async def ingest_knowledge(payload: KnowledgeIngestRequest, current_user: RequireKnowledgeManage):
    return await knowledge_service.ingest_policy_document(
        title=payload.title,
        text=payload.text,
        role_scope=payload.role_scope,
        uploaded_by=current_user.id,
    )


@router.get("/knowledge")
async def list_knowledge(current_user: RequireKnowledgeManage):
    return {"documents": await knowledge_service.list_knowledge_documents()}


@router.delete("/knowledge/{title}")
async def delete_knowledge(title: str, current_user: RequireKnowledgeManage):
    await knowledge_service.delete_policy_document(title)
    return {"deleted": True}

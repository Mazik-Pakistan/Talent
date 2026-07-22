"""Phase 4 — knowledge ingestion for the AI Coach RAG pipeline.

Three kinds of content feed the assistant:

1. Company policy / career-ladder documents — uploaded once by a recruiter
   or super admin, tagged with which role(s) may see them. This is the
   "train it on company policy" piece from the brief.
2. Personal employee profile content (resume, verified skills, certificates,
   career goal) — synced per-employee into chunks that ONLY that employee
   can retrieve (owner_id-scoped). This is what lets the coach answer
   "how do I become a Senior Full Stack Engineer" using the person's own
   background instead of generic advice.
3. Course catalog awareness — we don't embed the whole catalog (it's fetched
   live from providers); instead the coach asks catalog_service for real
   candidates by keyword at answer time, same pattern as learning_ai_service.
"""

from __future__ import annotations

from app.core.database import database
from app.services import rag_store_service

# ---------------------------------------------------------------------- #
# 1. Company policy / role-ladder documents
# ---------------------------------------------------------------------- #

VALID_ROLE_SCOPES = {"employee", "recruiter"}


async def ingest_policy_document(
    *,
    title: str,
    text: str,
    role_scope: list[str],
    uploaded_by: str,
) -> dict:
    scope = [r for r in role_scope if r in VALID_ROLE_SCOPES] or ["employee", "recruiter"]
    count = await rag_store_service.upsert_chunks(
        namespace="policy",
        role_scope=scope,
        source="policy_upload",
        title=title,
        text=text,
        owner_id=None,
        metadata={"uploaded_by": uploaded_by},
    )
    await database.ai_coach_knowledge_docs.update_one(
        {"title": title, "namespace": "policy"},
        {
            "$set": {
                "title": title,
                "namespace": "policy",
                "role_scope": scope,
                "chunk_count": count,
                "uploaded_by": uploaded_by,
            }
        },
        upsert=True,
    )
    return {"title": title, "chunks": count, "role_scope": scope}


async def list_knowledge_documents() -> list[dict]:
    docs = await database.ai_coach_knowledge_docs.find({}).sort("title", 1).to_list(length=200)
    for d in docs:
        d["id"] = str(d.pop("_id"))
    return docs


async def delete_policy_document(title: str) -> None:
    await rag_store_service.delete_namespace_for_owner("policy", None)  # no-op guard; real delete below
    await database.kb_chunks.delete_many({"namespace": "policy", "title": title})
    await database.ai_coach_knowledge_docs.delete_one({"namespace": "policy", "title": title})


# ---------------------------------------------------------------------- #
# 2. Personal employee profile sync (owner-scoped, employee-only)
# ---------------------------------------------------------------------- #


async def _get_resume_doc(user_id: str) -> dict | None:
    return await database.documents.find_one(
        {"owner_id": user_id, "doc_type": "resume", "is_active": True},
        sort=[("created_at", -1)],
    )


async def sync_employee_profile_kb(user_id: str, *, employee: dict | None = None) -> int:
    """(Re)builds the employee's personal, owner-scoped KB chunks from their
    resume, verified skills, certificates, and career goal. Safe to call on
    every chat turn — it's cheap and keeps the coach current after a resume
    re-upload or a new certificate."""
    resume_doc = await _get_resume_doc(user_id)
    ocr = (resume_doc or {}).get("ocr_result") or {}
    fields = ocr.get("fields") or {}
    resume_text = (resume_doc or {}).get("raw_extracted_text") or ocr.get("raw_text") or ""

    skills_docs = await database.employee_skills.find({"user_id": user_id}).to_list(length=300)
    skill_lines = [
        f"- {s.get('skill_name')} ({s.get('proficiency', 'Unknown')}"
        f"{', ' + str(s.get('years_experience')) + ' yrs' if s.get('years_experience') else ''}"
        f", verification: {s.get('verification_status', 'unverified')})"
        for s in skills_docs
        if s.get("skill_name")
    ]

    certs = await database.learning_certificates.find(
        {"user_id": user_id, "verification_status": "verified"}
    ).to_list(length=100)
    cert_lines = [f"- {c.get('course_title') or c.get('title')}" for c in certs if c.get("course_title") or c.get("title")]

    goal_doc = await database.learning_career_goals.find_one({"user_id": user_id}) or {}
    goal_text = goal_doc.get("target_role") or goal_doc.get("career_goal") or ""

    employee = employee or await database.employees.find_one({"user_id": user_id}) or {}
    job_title = employee.get("job_title") or ""
    department = employee.get("department") or ""

    profile_text_parts = [
        f"Current designation: {job_title or 'Unknown'}",
        f"Department: {department or 'Unknown'}",
        f"Stated career goal: {goal_text or 'Not set'}",
        "Resume summary / professional summary: " + (fields.get("professional_summary") or ""),
        "Verified & self-reported skills:\n" + ("\n".join(skill_lines) if skill_lines else "None recorded"),
        "Verified certificates/courses completed:\n" + ("\n".join(cert_lines) if cert_lines else "None yet"),
    ]
    if resume_text:
        profile_text_parts.append("Resume excerpt: " + resume_text[:4000])

    profile_text = "\n\n".join(p for p in profile_text_parts if p.strip())

    return await rag_store_service.upsert_chunks(
        namespace="profile",
        role_scope=["employee"],
        source="profile_sync",
        title=f"profile:{user_id}",
        text=profile_text,
        owner_id=user_id,
    )


# ---------------------------------------------------------------------- #
# 3. Seed a starter set of role-ladder / policy chunks so the coach isn't
#    empty on a fresh install. Recruiters/admins can add real policy docs
#    on top of this via the ingestion endpoint.
# ---------------------------------------------------------------------- #

_SEED_TITLE = "Default Career Progression Guidelines"

_SEED_TEXT = """General engineering career ladder used when no company-specific
policy document has been uploaded yet:

Software Engineer -> Senior Software Engineer: typically 2-4 years of solid
delivery, ownership of medium-complexity features end-to-end, mentoring
juniors informally, strong code review habits.

Senior Software Engineer -> Lead Software Engineer / Principal Engineer:
demonstrated technical leadership across a team or multiple projects,
architecture decisions, cross-team collaboration, ability to break down
ambiguous problems, track record of mentoring and raising the bar on quality.

Principal Consultant / Principal Engineer track (client-facing or deep
technical track): requires broad system design skill, stakeholder
communication, ability to represent technical decisions to non-technical
audiences, and typically 6+ years combined experience with visible impact
across multiple projects or clients.

General guidance for any promotion: consistent delivery at the current
level for the expected tenure, demonstrated skills for the next level (not
just current level), a manager/recruiter conversation about timeline, and
closing any critical skill gaps identified in the skill-gap assessment.
This is general guidance only — always defer to the organization's own
published policy documents when available."""


async def ensure_seed_policy() -> None:
    existing = await database.ai_coach_knowledge_docs.find_one({"title": _SEED_TITLE})
    if existing:
        return
    await ingest_policy_document(
        title=_SEED_TITLE,
        text=_SEED_TEXT,
        role_scope=["employee", "recruiter"],
        uploaded_by="system_seed",
    )

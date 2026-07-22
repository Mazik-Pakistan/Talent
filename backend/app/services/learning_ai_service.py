"""LLM-powered learning intelligence (OpenRouter / Gemini via llm_service).

Design principle: the model never invents course titles/URLs. It only ever
(a) picks/ranks from a real Microsoft Learn candidate pool we already fetched
via ms_learn_service, or (b) names skills/roles in plain text. Any course
attached to a recommendation always comes straight from the MS Learn catalog.
"""

from __future__ import annotations

import json

from app.services.llm_service import call_llm_json

VALID_PRIORITIES = {"critical", "immediate", "medium", "low"}
VALID_PROFICIENCY = {"Beginner", "Intermediate", "Advanced", "Expert"}


async def _call_llm_json(prompt: str, *, timeout: float = 45.0) -> dict | None:
    return await call_llm_json(prompt, timeout=timeout)


def _candidate_brief(candidates: list[dict]) -> str:
    lines = []
    for item in candidates:
        lines.append(
            json.dumps(
                {
                    "uid": item.get("uid"),
                    "title": item.get("title"),
                    "type": item.get("type"),
                    "summary": (item.get("summary") or "")[:220],
                    "level": (item.get("levels") or ["beginner"])[0],
                    "duration_minutes": item.get("duration_minutes"),
                    "roles": item.get("roles"),
                    "products": item.get("products"),
                }
            )
        )
    return "\n".join(lines)


async def rank_recommended_courses(
    *,
    job_title: str | None,
    department: str | None,
    current_skills: list[str],
    career_goal: str | None,
    skill_gaps: list[dict] | None = None,
    candidates: list[dict],
    top_n: int = 8,
) -> list[dict]:
    """US-074: Gemini ranks/selects from a real candidate pool.

    Returns [{"uid": ..., "reason": "...", "priority": "critical|immediate|medium|low"}]
    """
    if not candidates:
        return []

    gap_lines = []
    for gap in skill_gaps or []:
        gap_lines.append(
            f"- {gap.get('skill')} [{gap.get('priority', 'medium')}]: {gap.get('reason', '')}"
        )
    gaps_block = "\n".join(gap_lines) if gap_lines else "None explicitly listed"

    prompt = f"""You are an AI learning coach for an internal talent platform.
Employee profile:
- Designation / job title: {job_title or "Unknown"}
- Department: {department or "Unknown"}
- Current skills: {", ".join(current_skills) or "None recorded"}
- Career goal: {career_goal or "Not specified"}
- Known skill gaps (prioritize critical/immediate first):
{gaps_block}

Below is a JSON-lines list of REAL Microsoft Learn courses (one per line) that are
available right now. You must choose ONLY from this list — never invent a course.

{_candidate_brief(candidates)}

Select and rank the best {top_n} courses for this employee's designation, department,
skill gaps, and career goal. Prefer courses that close critical/immediate gaps first.
Return JSON only, no markdown:
{{"recommendations": [{{"uid": "<uid from the list above, exact match>", "reason": "<one short sentence, specific to this employee>", "priority": "<critical|immediate|medium|low>"}}]}}
"""
    result = await _call_llm_json(prompt)
    if not result or "recommendations" not in result:
        return []

    valid_uids = {c["uid"] for c in candidates}
    picks = []
    for rec in result.get("recommendations") or []:
        uid = rec.get("uid")
        if uid in valid_uids:
            priority = str(rec.get("priority") or "medium").lower()
            if priority not in VALID_PRIORITIES:
                priority = "medium"
            picks.append({"uid": uid, "reason": rec.get("reason") or "", "priority": priority})
    return picks[:top_n]


async def analyze_skill_gap(
    *,
    job_title: str | None,
    department: str | None,
    target_role: str,
    current_skills: list[str],
    professional_summary: str | None,
) -> dict | None:
    """Skill gap with priority levels for learning-path ordering."""
    prompt = f"""You are a career-readiness analyst for an internal talent platform.
Employee:
- Current designation: {job_title or "Unknown"}
- Department: {department or "Unknown"}
- Target role: {target_role}
- Current skills: {", ".join(current_skills) or "None recorded"}
- Resume summary: {(professional_summary or "Not available")[:800]}

Compare the employee's current skills against what is typically required for the
target role AND their current designation/department. Return JSON only:
{{
  "missing_skills": [
    {{"skill": "<short skill name>", "priority": "<critical|immediate|medium|low>", "reason": "<why this gap matters now>"}}
  ],
  "matched_skills": ["<skills the employee already has that ARE relevant>"],
  "readiness_percentage": <integer 0-100>,
  "summary": "<2-3 sentence plain-language assessment>"
}}
Rules for priority:
- critical: blocking current role performance; must close first
- immediate: needed within weeks for role success / upcoming work
- medium: important for growth in 1-3 months
- low: nice-to-have for longer-term career path
Order missing_skills by priority (critical first). 3-8 items.
"""
    result = await _call_llm_json(prompt)
    if not result:
        return None

    missing_raw = result.get("missing_skills") or []
    missing: list[dict] = []
    for item in missing_raw:
        if isinstance(item, str):
            missing.append({"skill": item, "priority": "medium", "reason": ""})
            continue
        if not isinstance(item, dict):
            continue
        skill = str(item.get("skill") or "").strip()
        if not skill:
            continue
        priority = str(item.get("priority") or "medium").lower()
        if priority not in VALID_PRIORITIES:
            priority = "medium"
        missing.append({"skill": skill, "priority": priority, "reason": str(item.get("reason") or "")})
    missing = missing[:8]

    result["missing_skills"] = missing
    result["matched_skills"] = [str(s) for s in (result.get("matched_skills") or [])][:20]
    try:
        result["readiness_percentage"] = max(0, min(100, int(result.get("readiness_percentage") or 0)))
    except (TypeError, ValueError):
        result["readiness_percentage"] = 0
    result["summary"] = str(result.get("summary") or "")
    return result


async def build_skill_matrix(
    *,
    job_title: str | None,
    department: str | None,
    resume_fields: dict,
    resume_text: str | None,
    existing_skills: list[dict],
) -> dict | None:
    """Gemini skill matrix from designation + department + resume OCR."""
    tech = resume_fields.get("technical_skills") or resume_fields.get("skills") or []
    soft = resume_fields.get("soft_skills") or []
    summary = resume_fields.get("professional_summary") or ""
    experience = resume_fields.get("experience") or resume_fields.get("work_experience") or []

    prompt = f"""You are a skills-assessment AI for an internal talent platform.
Assess this employee against their CURRENT designation and department using the resume.

Designation: {job_title or "Unknown"}
Department: {department or "Unknown"}
Resume technical skills (OCR): {json.dumps(tech)[:600]}
Resume soft skills (OCR): {json.dumps(soft)[:400]}
Professional summary: {(summary or "")[:600]}
Experience snippets: {json.dumps(experience)[:800]}
Resume text excerpt: {(resume_text or "")[:2500]}
Already recorded skills: {json.dumps(existing_skills)[:800]}

Produce a skill matrix for the CURRENT role. Return JSON only:
{{
  "skills": [
    {{
      "skill_name": "<canonical short name>",
      "category": "<Programming|Cloud|AI & Machine Learning|Database|Soft Skills|Communication|Leadership|Project Management|Security|DevOps|Other>",
      "proficiency": "<Beginner|Intermediate|Advanced|Expert>",
      "years_experience": <number or null>,
      "confidence": <0-100>,
      "source_hint": "<resume|inferred>"
    }}
  ],
  "role_fit_percentage": <0-100 how ready they are for current designation>,
  "strengths": ["<2-5 strengths>"],
  "gaps": [
    {{"skill": "<skill>", "priority": "<critical|immediate|medium|low>", "reason": "<why>"}}
  ],
  "summary": "<2-3 sentences>"
}}
Include 8-18 skills. Prefer skills evidenced in the resume; mark inferred carefully.
"""
    result = await _call_llm_json(prompt, timeout=60.0)
    if not result:
        return None

    skills_out = []
    for item in result.get("skills") or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("skill_name") or "").strip()
        if not name:
            continue
        proficiency = str(item.get("proficiency") or "Beginner")
        if proficiency not in VALID_PROFICIENCY:
            proficiency = "Beginner"
        skills_out.append(
            {
                "skill_name": name[:120],
                "category": str(item.get("category") or "Other")[:60],
                "proficiency": proficiency,
                "years_experience": item.get("years_experience"),
                "confidence": max(0, min(100, int(item.get("confidence") or 70))),
                "source_hint": str(item.get("source_hint") or "resume"),
            }
        )

    gaps = []
    for item in result.get("gaps") or []:
        if isinstance(item, str):
            gaps.append({"skill": item, "priority": "medium", "reason": ""})
            continue
        if not isinstance(item, dict):
            continue
        skill = str(item.get("skill") or "").strip()
        if not skill:
            continue
        priority = str(item.get("priority") or "medium").lower()
        if priority not in VALID_PRIORITIES:
            priority = "medium"
        gaps.append({"skill": skill, "priority": priority, "reason": str(item.get("reason") or "")})

    try:
        role_fit = max(0, min(100, int(result.get("role_fit_percentage") or 0)))
    except (TypeError, ValueError):
        role_fit = 0

    return {
        "skills": skills_out[:18],
        "role_fit_percentage": role_fit,
        "strengths": [str(s) for s in (result.get("strengths") or [])][:5],
        "gaps": gaps[:8],
        "summary": str(result.get("summary") or ""),
    }


async def extract_skills_from_certificate(
    *,
    course_title: str,
    certificate_text: str | None,
    course_summary: str | None = None,
) -> list[dict]:
    """Infer skills gained from a verified certificate / course content."""
    prompt = f"""You extract skills demonstrated by completing a learning course.
Course title: {course_title}
Course summary: {(course_summary or "")[:500]}
Certificate / document text (OCR): {(certificate_text or "Not available")[:3000]}

Return JSON only:
{{"skills": [{{"skill_name": "<short skill>", "category": "<Programming|Cloud|AI & Machine Learning|Database|Soft Skills|Communication|Leadership|Project Management|Security|DevOps|Other>", "proficiency": "<Beginner|Intermediate|Advanced>", "confidence": <0-100>}}]}}
Return 2-6 concrete skills the learner would have gained. Never invent unrelated skills.
"""
    result = await _call_llm_json(prompt)
    if not result:
        # Fallback: use course title as a single skill signal.
        return [
            {
                "skill_name": course_title[:120],
                "category": "Other",
                "proficiency": "Intermediate",
                "confidence": 60,
            }
        ]
    out = []
    for item in result.get("skills") or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("skill_name") or "").strip()
        if not name:
            continue
        proficiency = str(item.get("proficiency") or "Intermediate")
        if proficiency not in VALID_PROFICIENCY:
            proficiency = "Intermediate"
        out.append(
            {
                "skill_name": name[:120],
                "category": str(item.get("category") or "Other")[:60],
                "proficiency": proficiency,
                "confidence": max(0, min(100, int(item.get("confidence") or 70))),
            }
        )
    return out[:6] or [
        {
            "skill_name": course_title[:120],
            "category": "Other",
            "proficiency": "Intermediate",
            "confidence": 60,
        }
    ]


async def predict_promotion_readiness(
    *,
    job_title: str | None,
    department: str | None,
    target_role: str | None,
    current_skills: list[str],
    skill_gaps: list[dict],
    learning_summary: dict,
    professional_summary: str | None,
) -> dict | None:
    """AI promotion readiness with reasons for recruiter oversight."""
    prompt = f"""You are a talent-development advisor helping a recruiter decide promotion readiness.
Employee:
- Current designation: {job_title or "Unknown"}
- Department: {department or "Unknown"}
- Suggested next role: {target_role or "Next senior level in same track"}
- Skills: {", ".join(current_skills) or "None"}
- Skill gaps: {json.dumps(skill_gaps)[:800]}
- Learning: assigned={learning_summary.get("assigned_count")}, completed={learning_summary.get("completed_count")}, certs={learning_summary.get("certificates_earned")}, hours={learning_summary.get("total_learning_hours")}, progress={learning_summary.get("overall_progress_percent")}%
- Resume summary: {(professional_summary or "")[:600]}

Return JSON only:
{{
  "promotion_ready": <true|false>,
  "readiness_score": <0-100>,
  "recommended_next_title": "<suggested designation>",
  "reasons": ["<2-5 concrete reasons supporting or blocking promotion>"],
  "recommended_actions": ["<2-4 actions: courses, mentoring, projects>"],
  "timeline": "<e.g. Ready now | 3-6 months | 6-12 months>",
  "summary": "<2 sentences for the recruiter>"
}}
Be honest and evidence-based. Do not inflate readiness.
"""
    result = await _call_llm_json(prompt)
    if not result:
        return None
    try:
        result["readiness_score"] = max(0, min(100, int(result.get("readiness_score") or 0)))
    except (TypeError, ValueError):
        result["readiness_score"] = 0
    result["promotion_ready"] = bool(result.get("promotion_ready"))
    result["reasons"] = [str(r) for r in (result.get("reasons") or [])][:5]
    result["recommended_actions"] = [str(r) for r in (result.get("recommended_actions") or [])][:4]
    result["recommended_next_title"] = str(result.get("recommended_next_title") or target_role or "")
    result["timeline"] = str(result.get("timeline") or "")
    result["summary"] = str(result.get("summary") or "")
    return result

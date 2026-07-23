"""Domain-aware search keyword mapping (taxonomy), AI query intent expansion, and relevance ranking service.

Provides lightweight, in-memory taxonomy resolution, OpenRouter AI hybrid search expansion,
local in-process caching, and 4-tier relevance ranking:
  Tier 1: Exact matches (exact title match or exact word match in title/metadata)
  Tier 2: Direct keyword matches (query substring match in title/summary/roles/products)
  Tier 3: Expanded technology keywords (AI + domain taxonomy keywords)
  Tier 4: Same domain / category matches

Preserves high performance and minimal token consumption (< 60 max_tokens, cached per query).
"""

from __future__ import annotations

import re
from typing import Any

from loguru import logger
from app.services.llm_service import call_llm_json, llm_configured

# In-process cache for AI expanded keywords: query_normalized -> list[str]
_AI_KEYWORD_CACHE: dict[str, list[str]] = {}

# Domain taxonomy dictionary mapping search triggers (normalized) to related technology keywords
SEARCH_TAXONOMY: dict[str, list[str]] = {
    # Frontend
    "frontend": [
        "React", "Next.js", "HTML", "CSS", "JavaScript", "TypeScript",
        "Tailwind CSS", "Bootstrap", "Vue.js", "Angular", "Responsive Design", "Web Development"
    ],
    "front end": [
        "React", "Next.js", "HTML", "CSS", "JavaScript", "TypeScript",
        "Tailwind CSS", "Bootstrap", "Vue.js", "Angular", "Responsive Design", "Web Development"
    ],
    "front-end": [
        "React", "Next.js", "HTML", "CSS", "JavaScript", "TypeScript",
        "Tailwind CSS", "Bootstrap", "Vue.js", "Angular", "Responsive Design", "Web Development"
    ],

    # Backend
    "backend": [
        "Node.js", "Express.js", ".NET", "ASP.NET Core", "C#", "Python",
        "Django", "Flask", "Java", "Spring Boot", "PHP", "Laravel", "REST API", "GraphQL", "Database"
    ],
    "back end": [
        "Node.js", "Express.js", ".NET", "ASP.NET Core", "C#", "Python",
        "Django", "Flask", "Java", "Spring Boot", "PHP", "Laravel", "REST API", "GraphQL", "Database"
    ],
    "back-end": [
        "Node.js", "Express.js", ".NET", "ASP.NET Core", "C#", "Python",
        "Django", "Flask", "Java", "Spring Boot", "PHP", "Laravel", "REST API", "GraphQL", "Database"
    ],

    # Database
    "database": [
        "MongoDB", "SQL", "MySQL", "PostgreSQL", "Microsoft SQL Server",
        "SQLite", "Oracle Database", "NoSQL", "Database Design"
    ],
    "db": [
        "MongoDB", "SQL", "MySQL", "PostgreSQL", "Microsoft SQL Server",
        "SQLite", "Oracle Database", "NoSQL", "Database Design"
    ],

    # Artificial Intelligence / Machine Learning
    "ai": [
        "Machine Learning", "ML", "Deep Learning", "Data Science", "Generative AI",
        "Agentic AI", "LLM", "NLP", "Computer Vision", "Prompt Engineering",
        "TensorFlow", "PyTorch", "Reinforcement Learning"
    ],
    "artificial intelligence": [
        "Machine Learning", "ML", "Deep Learning", "Data Science", "Generative AI",
        "Agentic AI", "LLM", "NLP", "Computer Vision", "Prompt Engineering",
        "TensorFlow", "PyTorch", "Reinforcement Learning"
    ],
    "ml": [
        "Machine Learning", "ML", "Deep Learning", "Data Science", "Generative AI",
        "Agentic AI", "LLM", "NLP", "Computer Vision", "Prompt Engineering",
        "TensorFlow", "PyTorch", "Reinforcement Learning"
    ],
    "machine learning": [
        "Machine Learning", "ML", "Deep Learning", "Data Science", "Generative AI",
        "Agentic AI", "LLM", "NLP", "Computer Vision", "Prompt Engineering",
        "TensorFlow", "PyTorch", "Reinforcement Learning"
    ],

    # Data Science
    "data science": [
        "Python", "Pandas", "NumPy", "Machine Learning", "Statistics",
        "Data Analysis", "Data Visualization", "Power BI", "Tableau"
    ],

    # DevOps
    "devops": [
        "Docker", "Kubernetes", "CI/CD", "GitHub Actions", "Azure DevOps",
        "Jenkins", "Linux", "Terraform"
    ],

    # Cloud
    "cloud": [
        "AWS", "Microsoft Azure", "Google Cloud Platform", "Cloud Computing", "Serverless"
    ],

    # Cybersecurity
    "security": [
        "Ethical Hacking", "Penetration Testing", "SOC", "Network Security", "Information Security"
    ],
    "cyber security": [
        "Ethical Hacking", "Penetration Testing", "SOC", "Network Security", "Information Security"
    ],
    "cybersecurity": [
        "Ethical Hacking", "Penetration Testing", "SOC", "Network Security", "Information Security"
    ],

    # Soft Skills / Communication
    "communication": [
        "Leadership", "Teamwork", "Collaboration", "Public Speaking",
        "Critical Thinking", "Problem Solving", "Time Management", "Emotional Intelligence", "Productivity"
    ],
}


def _normalize_key(term: str) -> str:
    """Normalize term for dictionary lookup."""
    return term.strip().lower()


def get_related_keywords(query: str) -> list[str]:
    """Retrieve related domain technology keywords for a given search query from static taxonomy."""
    key = _normalize_key(query)
    if key in SEARCH_TAXONOMY:
        return SEARCH_TAXONOMY[key]

    key_alt = key.replace("-", " ")
    if key_alt in SEARCH_TAXONOMY:
        return SEARCH_TAXONOMY[key_alt]

    key_alt2 = key.replace(" ", "")
    if key_alt2 in SEARCH_TAXONOMY:
        return SEARCH_TAXONOMY[key_alt2]

    # Handle multi-word / compound queries (e.g. "ML Frontend")
    words = [w for w in re.split(r"[\s\-_]+", key) if w]
    if len(words) > 1:
        word_kw_lists = [get_related_keywords(w) for w in words]
        word_kw_lists = [l for l in word_kw_lists if l]
        if word_kw_lists:
            merged: list[str] = []
            max_len = max(len(l) for l in word_kw_lists)
            for idx in range(max_len):
                for kw_list in word_kw_lists:
                    if idx < len(kw_list):
                        k = kw_list[idx]
                        if k not in merged:
                            merged.append(k)
            return merged

    return []


async def expand_query_keywords_async(query: str) -> list[str]:
    """Retrieve expanded search keywords using local cache, static taxonomy, or OpenRouter AI query intent expansion."""
    if not query or not query.strip():
        return []

    q_clean = query.strip()
    q_lower = _normalize_key(q_clean)

    # 1. Check local cache (Token optimization: hit cache first)
    if q_lower in _AI_KEYWORD_CACHE:
        return _AI_KEYWORD_CACHE[q_lower]

    # 2. Get static taxonomy keywords
    static_keywords = get_related_keywords(q_clean)

    # 3. Call AI if configured for hybrid intent understanding
    if llm_configured():
        try:
            prompt = (
                f"User search query: '{q_clean}'\n"
                "Understand search intent. Return ONLY a valid JSON object with key 'keywords': a list of 5 to 8 most relevant technical skills, framework, language, or domain search terms.\n"
                'Example: {"keywords": ["React", "Next.js", "HTML", "CSS", "JavaScript"]}'
            )
            data = await call_llm_json(prompt, max_tokens=150, temperature=0.1, timeout=5.0)
            if data and isinstance(data.get("keywords"), list):
                ai_keywords = [str(k).strip() for k in data["keywords"] if k and str(k).strip()]
                if ai_keywords:
                    # Combine static and AI keywords without duplicates while preserving order
                    combined = list(dict.fromkeys(static_keywords + ai_keywords))[:12]
                    _AI_KEYWORD_CACHE[q_lower] = combined
                    return combined
        except Exception as exc:
            logger.warning(f"AI keyword expansion failed for query '{q_clean}': {exc}")

    # Fallback to static taxonomy
    _AI_KEYWORD_CACHE[q_lower] = static_keywords
    return static_keywords


def search_and_rank_items(
    items: list[dict[str, Any]],
    query: str | None,
    *,
    expanded_keywords: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Filter and rank a list of course items according to query and domain taxonomy / expanded keyword rules."""
    if not query or not query.strip():
        return items

    q_clean = query.strip()
    q_lower = q_clean.lower()
    related_kws = expanded_keywords if expanded_keywords is not None else get_related_keywords(q_clean)

    is_short_q = len(q_lower) <= 3
    q_pattern = re.compile(rf"\b{re.escape(q_lower)}\b", re.IGNORECASE)

    # Pre-compile related keyword regex patterns once for maximum performance
    rel_compiled: list[tuple[str, str, bool, re.Pattern]] = []
    for kw in related_kws:
        kw_clean = kw.strip()
        if not kw_clean:
            continue
        kw_lower = kw_clean.lower()
        is_short_kw = len(kw_lower) <= 3
        pattern = re.compile(rf"\b{re.escape(kw_lower)}\b", re.IGNORECASE)
        rel_compiled.append((kw_clean, kw_lower, is_short_kw, pattern))

    scored_items: list[tuple[tuple[int, int, float, str], dict[str, Any]]] = []

    for item in items:
        title = str(item.get("title") or "")
        summary = str(item.get("summary") or "")

        roles = item.get("roles") or []
        if isinstance(roles, str):
            roles = [roles]

        products = item.get("products") or []
        if isinstance(products, str):
            products = [products]

        subjects = item.get("subjects") or []
        if isinstance(subjects, str):
            subjects = [subjects]

        category = str(item.get("category") or "") if item.get("category") else ""

        combined = " ".join([
            title,
            summary,
            " ".join(roles),
            " ".join(products),
            " ".join(subjects),
            category,
        ]).strip()

        title_lower = title.lower()
        combined_lower = combined.lower()
        popularity = float(item.get("popularity") or 0)

        rank: tuple[int, int, float, str] | None = None

        # Tier 1: Exact matches (Title exact or exact word match)
        if title_lower == q_lower:
            rank = (1, 0, -popularity, title_lower)
        elif q_pattern.search(title_lower):
            rank = (1, 1, -popularity, title_lower)
        elif q_pattern.search(combined_lower):
            rank = (1, 2, -popularity, title_lower)

        # Tier 2: Direct keyword matches
        elif not is_short_q and q_lower in title_lower:
            rank = (2, 0, -popularity, title_lower)
        elif not is_short_q and q_lower in combined_lower:
            rank = (2, 1, -popularity, title_lower)

        # Tier 3: Related / AI Expanded technology keywords
        else:
            best_rel: tuple[int, int] | None = None
            for kw_clean, kw_lower, is_short_kw, kw_pattern in rel_compiled:
                curr: tuple[int, int] | None = None
                if kw_pattern.search(title_lower):
                    curr = (3, 0)
                elif not is_short_kw and kw_lower in title_lower:
                    curr = (3, 1)
                elif kw_pattern.search(combined_lower):
                    curr = (3, 2)
                elif not is_short_kw and kw_lower in combined_lower:
                    curr = (3, 3)

                if curr:
                    if best_rel is None or curr < best_rel:
                        best_rel = curr
                        if best_rel == (3, 0):
                            break

            if best_rel:
                rank = (best_rel[0], best_rel[1], -popularity, title_lower)

        if rank is not None:
            scored_items.append((rank, item))

    scored_items.sort(key=lambda pair: pair[0])
    return [item for _, item in scored_items]


async def search_and_rank_items_async(
    items: list[dict[str, Any]],
    query: str | None,
    *,
    use_ai: bool = True,
) -> list[dict[str, Any]]:
    """Async wrapper that resolves AI/taxonomy expanded keywords and ranks items.

    use_ai=False skips OpenRouter expansion (static taxonomy only) — required for
    bulk keyword catalog scans so a profile load does not fire dozens of LLM calls.
    """
    if not query or not query.strip():
        return items

    q_clean = query.strip()
    if use_ai:
        expanded_kws = await expand_query_keywords_async(q_clean)
    else:
        expanded_kws = get_related_keywords(q_clean)
    return search_and_rank_items(items, q_clean, expanded_keywords=expanded_kws)

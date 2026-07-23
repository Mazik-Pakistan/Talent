"""Domain-aware search keyword mapping (taxonomy) and relevance ranking service.

Provides lightweight, in-memory taxonomy resolution and 4-tier relevance ranking:
  Tier 1: Exact matches (exact title match or exact word match in title/metadata)
  Tier 2: Direct keyword matches (query substring match in title/summary/roles/products)
  Tier 3: Related technology keywords (domain taxonomy mapped keywords)
  Tier 4: Same domain / category matches

Preserves high performance (< 5ms) without external DB/AI calls.
"""

from __future__ import annotations

import re
from typing import Any

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

    # Artificial Intelligence
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
    """Retrieve related domain technology keywords for a given search query."""
    key = _normalize_key(query)
    if key in SEARCH_TAXONOMY:
        return SEARCH_TAXONOMY[key]

    key_alt = key.replace("-", " ")
    if key_alt in SEARCH_TAXONOMY:
        return SEARCH_TAXONOMY[key_alt]

    key_alt2 = key.replace(" ", "")
    if key_alt2 in SEARCH_TAXONOMY:
        return SEARCH_TAXONOMY[key_alt2]

    return []


def search_and_rank_items(items: list[dict[str, Any]], query: str | None) -> list[dict[str, Any]]:
    """Filter and rank a list of course items according to query and domain taxonomy rules."""
    if not query or not query.strip():
        return items

    q_clean = query.strip()
    q_lower = q_clean.lower()
    related_kws = get_related_keywords(q_clean)

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

        # Tier 3: Related technology keywords
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

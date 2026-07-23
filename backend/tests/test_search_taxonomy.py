"""Tests for domain-aware search taxonomy mapping and 4-tier relevance ranking."""

import time
import pytest
from app.services.search_taxonomy import (
    SEARCH_TAXONOMY,
    get_related_keywords,
    search_and_rank_items,
)


def test_taxonomy_keywords_completeness():
    """Verify that all required domain triggers exist in the taxonomy mapping."""
    # Frontend
    assert get_related_keywords("Frontend") == SEARCH_TAXONOMY["frontend"]
    assert get_related_keywords("Front End") == SEARCH_TAXONOMY["front end"]
    assert get_related_keywords("Front-end") == SEARCH_TAXONOMY["front-end"]
    rel_frontend = get_related_keywords("Frontend")
    for kw in ["React", "Next.js", "HTML", "CSS", "JavaScript", "TypeScript", "Tailwind CSS", "Bootstrap", "Vue.js", "Angular", "Responsive Design", "Web Development"]:
        assert kw in rel_frontend

    # Backend
    rel_backend = get_related_keywords("Backend")
    for kw in ["Node.js", "Express.js", ".NET", "ASP.NET Core", "C#", "Python", "Django", "Flask", "Java", "Spring Boot", "PHP", "Laravel", "REST API", "GraphQL", "Database"]:
        assert kw in rel_backend

    # Database
    rel_db = get_related_keywords("Database")
    rel_db_alias = get_related_keywords("DB")
    assert rel_db == rel_db_alias
    for kw in ["MongoDB", "SQL", "MySQL", "PostgreSQL", "Microsoft SQL Server", "SQLite", "Oracle Database", "NoSQL", "Database Design"]:
        assert kw in rel_db

    # Artificial Intelligence
    rel_ai = get_related_keywords("AI")
    rel_ai_full = get_related_keywords("Artificial Intelligence")
    assert rel_ai == rel_ai_full
    for kw in ["Machine Learning", "ML", "Deep Learning", "Data Science", "Generative AI", "Agentic AI", "LLM", "NLP", "Computer Vision", "Prompt Engineering", "TensorFlow", "PyTorch", "Reinforcement Learning"]:
        assert kw in rel_ai

    # Data Science
    rel_ds = get_related_keywords("Data Science")
    for kw in ["Python", "Pandas", "NumPy", "Machine Learning", "Statistics", "Data Analysis", "Data Visualization", "Power BI", "Tableau"]:
        assert kw in rel_ds

    # DevOps
    rel_devops = get_related_keywords("DevOps")
    for kw in ["Docker", "Kubernetes", "CI/CD", "GitHub Actions", "Azure DevOps", "Jenkins", "Linux", "Terraform"]:
        assert kw in rel_devops

    # Cloud
    rel_cloud = get_related_keywords("Cloud")
    for kw in ["AWS", "Microsoft Azure", "Google Cloud Platform", "Cloud Computing", "Serverless"]:
        assert kw in rel_cloud

    # Cybersecurity
    rel_sec = get_related_keywords("Security")
    rel_cyber = get_related_keywords("Cyber Security")
    assert rel_sec == rel_cyber
    for kw in ["Ethical Hacking", "Penetration Testing", "SOC", "Network Security", "Information Security"]:
        assert kw in rel_sec

    # Soft Skills / Communication
    rel_comm = get_related_keywords("Communication")
    for kw in ["Leadership", "Teamwork", "Collaboration", "Public Speaking", "Critical Thinking", "Problem Solving", "Time Management", "Emotional Intelligence", "Productivity"]:
        assert kw in rel_comm


def test_search_frontend_returns_related_technologies():
    mock_catalog = [
        {"uid": "1", "title": "React for Beginners", "summary": "Build UI components"},
        {"uid": "2", "title": "Advanced Next.js Architecture", "summary": "SSR and App router"},
        {"uid": "3", "title": "Modern HTML and CSS", "summary": "Flexbox and Grid"},
        {"uid": "4", "title": "TypeScript Masterclass", "summary": "Type-safe JavaScript"},
        {"uid": "5", "title": "Frontend Development Basics", "summary": "Introduction to Web Development"},
        {"uid": "6", "title": "Python for Data Analysis", "summary": "Pandas and NumPy"},
    ]

    results = search_and_rank_items(mock_catalog, "Frontend")
    titles = [item["title"] for item in results]

    # Exact/direct match should be top
    assert titles[0] == "Frontend Development Basics"
    # Related technologies should all be included
    assert "React for Beginners" in titles
    assert "Advanced Next.js Architecture" in titles
    assert "Modern HTML and CSS" in titles
    assert "TypeScript Masterclass" in titles
    # Unrelated course should be excluded
    assert "Python for Data Analysis" not in titles


def test_search_backend_returns_related_technologies():
    mock_catalog = [
        {"uid": "1", "title": "Backend Engineering Patterns", "summary": "Microservices"},
        {"uid": "2", "title": "Node.js REST API", "summary": "Express framework"},
        {"uid": "3", "title": "ASP.NET Core with C#", "summary": "Enterprise web apps"},
        {"uid": "4", "title": "Python Django Tutorial", "summary": "Full stack backend"},
        {"uid": "5", "title": "React UI Fundamentals", "summary": "Frontend framework"},
    ]

    results = search_and_rank_items(mock_catalog, "Backend")
    titles = [item["title"] for item in results]

    assert titles[0] == "Backend Engineering Patterns"
    assert "Node.js REST API" in titles
    assert "ASP.NET Core with C#" in titles
    assert "Python Django Tutorial" in titles
    assert "React UI Fundamentals" not in titles


def test_search_ai_returns_related_technologies():
    mock_catalog = [
        {"uid": "1", "title": "AI Primer", "summary": "Introductory concepts"},
        {"uid": "2", "title": "Machine Learning in Action", "summary": "Supervised learning"},
        {"uid": "3", "title": "Deep Learning with PyTorch", "summary": "Neural networks"},
        {"uid": "4", "title": "Building Agentic AI Apps", "summary": "LLM agents"},
        {"uid": "5", "title": "Docker Containers", "summary": "DevOps tool"},
    ]

    results = search_and_rank_items(mock_catalog, "AI")
    titles = [item["title"] for item in results]

    assert titles[0] == "AI Primer"
    assert "Machine Learning in Action" in titles
    assert "Deep Learning with PyTorch" in titles
    assert "Building Agentic AI Apps" in titles
    assert "Docker Containers" not in titles


def test_exact_matches_rank_first():
    mock_catalog = [
        {"uid": "1", "title": "Building Web Apps with React", "summary": "Frontend react tutorial", "popularity": 100},
        {"uid": "2", "title": "Frontend", "summary": "Core frontend course", "popularity": 10},
        {"uid": "3", "title": "Frontend Engineering", "summary": "Direct match in title", "popularity": 50},
        {"uid": "4", "title": "Learn HTML & CSS", "summary": "Frontend skills", "popularity": 80},
    ]

    results = search_and_rank_items(mock_catalog, "Frontend")
    # "Frontend" exact match must be first despite lower popularity than React
    assert results[0]["title"] == "Frontend"
    assert results[1]["title"] == "Frontend Engineering"


def test_performance_lightweight():
    # Benchmark against 3000 items
    large_catalog = [
        {
            "uid": f"course_{i}",
            "title": f"Course Title {i} - {'React' if i % 3 == 0 else 'Python' if i % 5 == 0 else 'General'}",
            "summary": "Summary text for benchmarking performance",
            "popularity": i % 100,
        }
        for i in range(3000)
    ]

    start_time = time.perf_counter()
    results = search_and_rank_items(large_catalog, "Frontend")
    elapsed_ms = (time.perf_counter() - start_time) * 1000

    assert len(results) > 0
    # Must complete in under 100ms
    assert elapsed_ms < 100.0


@pytest.mark.asyncio
async def test_ai_query_expansion_caching():
    from app.services.search_taxonomy import expand_query_keywords_async, _AI_KEYWORD_CACHE

    query = "ml frontend test query"
    _AI_KEYWORD_CACHE.pop(query.lower(), None)

    # First call expands and caches
    kw1 = await expand_query_keywords_async(query)
    assert len(kw1) > 0
    assert query.lower() in _AI_KEYWORD_CACHE

    # Second call returns from cache instantly
    kw2 = await expand_query_keywords_async(query)
    assert kw1 == kw2


@pytest.mark.asyncio
async def test_hybrid_search_ml_frontend():
    from app.services.search_taxonomy import search_and_rank_items_async

    mock_catalog = [
        {"uid": "1", "title": "Machine Learning Fundamentals", "summary": "Intro to ML"},
        {"uid": "2", "title": "React and Next.js Masterclass", "summary": "Frontend framework"},
        {"uid": "3", "title": "HTML & CSS Essentials", "summary": "Web design"},
        {"uid": "4", "title": "Unrelated Cooking Course", "summary": "Baking bread"},
    ]

    results = await search_and_rank_items_async(mock_catalog, "ML Frontend")
    titles = [item["title"] for item in results]

    # Both ML and Frontend courses should be returned
    assert "Machine Learning Fundamentals" in titles
    assert "React and Next.js Masterclass" in titles
    assert "HTML & CSS Essentials" in titles
    assert "Unrelated Cooking Course" not in titles

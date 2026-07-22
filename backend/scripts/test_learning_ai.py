import asyncio

from app.services import learning_ai_service


async def main() -> None:
    picks = await learning_ai_service.rank_recommended_courses(
        job_title="Software Engineer",
        department="Engineering",
        current_skills=["Python", "SQL"],
        career_goal="Senior Software Engineer",
        skill_gaps=[{"skill": "Docker", "priority": "critical", "reason": "needed for deploys"}],
        candidates=[
            {
                "uid": "a1",
                "title": "Docker containers",
                "type": "module",
                "summary": "Learn Docker",
                "levels": ["beginner"],
                "duration_minutes": 30,
                "roles": ["developer"],
                "products": ["Docker"],
            },
            {
                "uid": "a2",
                "title": "Azure basics",
                "type": "learningPath",
                "summary": "Cloud intro",
                "levels": ["beginner"],
                "duration_minutes": 60,
                "roles": ["developer"],
                "products": ["Azure"],
            },
        ],
        top_n=2,
    )
    print("picks", picks)
    assert picks and picks[0]["uid"] in {"a1", "a2"}, picks
    print("LEARNING_AI_OK")


if __name__ == "__main__":
    asyncio.run(main())

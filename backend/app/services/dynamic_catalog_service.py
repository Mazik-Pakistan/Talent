"""Dynamic Catalog Service - Provider-Agnostic Course Catalog

Phase 1: Generic Learning Provider Framework
Phase 2: Universal Provider Import Engine  
Phase 3: Catalog Experience, Sorting, Management & Polish

This service dynamically resolves providers from the database instead of 
hardcoded sources, making the system fully provider-agnostic.
"""

from __future__ import annotations

from typing import Any

from app.core.database import database
from app.services import coursera_service, ms_learn_service
from app.services.managed_learning_service import MANAGED_SOURCE, managed_learning_service


class DynamicCatalogService:
    """Provider-agnostic catalog service using dynamic provider resolution."""
    
    async def get_active_providers(self) -> list[dict]:
        """Get all active learning providers from database."""
        providers = await database.learning_providers.find(
            {"active": True}
        ).sort("name", 1).to_list(length=100)
        
        return providers
    
    async def get_provider_sources(self) -> dict[str, str]:
        """Map provider names/slugs to their source handlers."""
        providers = await self.get_active_providers()
        
        # Static external providers (API-based)
        source_mapping = {
            "microsoft_learn": "microsoft_learn",
            "microsoft": "microsoft_learn", 
            "coursera": "coursera",
        }
        
        # Dynamic managed providers
        for provider in providers:
            name = provider.get("name", "").lower()
            slug = provider.get("slug", "")
            
            # Map provider to managed learning source
            if provider.get("provider_type") == "manual":
                source_mapping[f"provider:{provider['name']}"] = MANAGED_SOURCE
                source_mapping[slug] = MANAGED_SOURCE
                
        return source_mapping
    
    def source_of(self, uid: str) -> str:
        """Determine the source of a course UID."""
        if uid.startswith("learning_course:"):
            return MANAGED_SOURCE
        if uid.startswith("coursera:"):
            return "coursera"
        return "microsoft_learn"
    
    async def get_course_by_uid(self, uid: str) -> dict | None:
        """Get a course by UID from appropriate provider."""
        src = self.source_of(uid)
        
        if src == MANAGED_SOURCE:
            return await managed_learning_service.get_course_by_uid(uid)
        elif src == "coursera":
            return await coursera_service.get_course_by_uid(uid)
        else:
            return await ms_learn_service.get_course_by_uid(uid)
    
    async def search_catalog(
        self,
        *,
        source: str = "microsoft_learn",
        provider_id: str | None = None,
        q: str | None = None,
        role: str | None = None,
        level: str | None = None,
        product: str | None = None,
        course_type: str | None = None,
        category: str | None = None,
        provider: str | None = None,
        designation: str | None = None,
        learning_month: str | None = None,
        competency: str | None = None,
        archived: bool | None = None,
        sort_by: str | None = "newest",
        page: int = 1,
        page_size: int = 20,
        organization_id: str | None = None,
    ) -> dict:
        """Search courses from any provider dynamically."""
        
        # Handle provider-specific sources
        if source.startswith("provider:") or provider_id:
            # This is a managed provider
            return await managed_learning_service.list_courses(
                q=q,
                provider=provider or source.replace("provider:", "") if source.startswith("provider:") else None,
                designation=designation,
                learning_month=learning_month,
                category=category,
                competency=competency,
                archived=archived,
                sort_by=sort_by,
                page=page,
                page_size=page_size,
                organization_id=organization_id,
            )
        
        # Handle static external providers
        if source in {MANAGED_SOURCE, "managed_learning"}:
            return await managed_learning_service.list_courses(
                q=q,
                provider=provider,
                designation=designation,
                learning_month=learning_month,
                category=category,
                competency=competency,
                archived=archived,
                sort_by=sort_by,
                page=page,
                page_size=page_size,
                organization_id=organization_id,
            )
        elif source == "coursera":
            return await coursera_service.search_catalog(
                q=q, category=category, page=page, page_size=page_size
            )
        else:
            # Default to Microsoft Learn
            return await ms_learn_service.search_catalog(
                q=q, role=role, level=level, product=product, 
                course_type=course_type, page=page, page_size=page_size
            )
    
    async def get_facets(self, source: str = "microsoft_learn", organization_id: str | None = None) -> dict:
        """Get facets/filters for a specific source."""
        
        if source.startswith("provider:") or source in {MANAGED_SOURCE, "managed_learning"}:
            return await managed_learning_service.list_facets(organization_id=organization_id)
        elif source == "coursera":
            return {"categories": coursera_service.get_categories()}
        else:
            return await ms_learn_service.get_facets()
    
    async def get_catalog_sources(self) -> list[dict]:
        """Get all available catalog sources for the frontend.

        Provider tabs are built from the learning_providers registry so adding a
        new provider (Udemy, Skillsoft, Company Academy, ...) requires zero code
        changes. Microsoft Learn and Coursera are live external API sources and
        are represented by their external tabs (their course data is never
        stored locally).
        """
        # External, live-API sources (never stored locally).
        external_slugs = {"microsoft-learn", "coursera"}

        sources = []

        # Provider tabs from the registry — includes LinkedIn Learning and any
        # newly created provider, active or not (the UI can grey out inactive).
        providers = await database.learning_providers.find({}).sort("name", 1).to_list(length=500)

        # Build managed course counts in one aggregation (non-blocking)
        managed_counts: dict[str, int] = {}
        pipeline = [
            {"$match": {"$or": [{"archived": {"$exists": False}}, {"archived": False}]}},
            {"$group": {"_id": "$provider", "count": {"$sum": 1}}},
        ]
        async for row in database.learning_courses.aggregate(pipeline):
            key = (row.get("_id") or "").strip().lower()
            if key:
                managed_counts[key] = row.get("count", 0)

        # External catalog counts — read directly from in-memory caches (non-blocking).
        ms_count = 0
        coursera_count = 0
        try:
            ms_count = sum(len(e.get("items", [])) for e in ms_learn_service._cache.values())
        except Exception:  # noqa: BLE001
            pass
        try:
            coursera_count = len(coursera_service._cache.get("items") or [])
        except Exception:  # noqa: BLE001
            pass

        for provider in providers:
            name = provider.get("name") or ""
            slug = provider.get("slug") or ""
            if slug in external_slugs:
                continue
            if not name:
                continue
            sources.append({
                "key": f"provider:{name}",
                "label": name,
                "hint": provider.get("description") or f"Managed courses from {name}.",
                "type": "managed",
                "provider_id": str(provider["_id"]),
                "provider_name": name,
                "active": bool(provider.get("active", True)),
                "course_count": managed_counts.get(name.strip().lower(), 0),
            })

        # External API providers (Microsoft Learn, Coursera) — live catalogs.
        sources.extend([
            {
                "key": "microsoft_learn",
                "label": "Microsoft Learn",
                "hint": "Technical learning paths, modules, and certifications from Microsoft Learn (English).",
                "type": "external",
                "course_count": ms_count,
            },
            {
                "key": "coursera",
                "label": "Coursera",
                "hint": "Industry soft-skills courses from Coursera (English) — communication, leadership, and more.",
                "type": "external",
                "course_count": coursera_count,
            },
        ])

        return sources
    
    async def find_courses_for_keywords(
        self,
        keywords: list[str],
        *,
        per_keyword: int = 4,
        limit: int = 40,
        provider_filter: str | None = None,
        use_ai: bool = False,
        sources: tuple[str, ...] | None = None,
    ) -> list[dict]:
        """Find courses across all providers for given keywords."""
        results: list[dict] = []
        # Normalize which sources to search
        if sources is not None:
            search_set = set(sources)
            search_managed = MANAGED_SOURCE in search_set and (
                provider_filter is None or provider_filter in {"managed_learning", MANAGED_SOURCE}
            )
            search_ms = "microsoft_learn" in search_set
            search_coursera = "coursera" in search_set
        else:
            search_managed = not provider_filter or provider_filter in {"managed_learning", MANAGED_SOURCE}
            search_ms = not provider_filter or provider_filter == "microsoft_learn"
            search_coursera = not provider_filter or provider_filter == "coursera"
        
        # Search managed learning courses
        if search_managed:
            managed = await managed_learning_service.list_courses(page=1, page_size=500)
            courses = managed.get("courses") or []
            lowered = [k.lower() for k in keywords if k]
            
            for course in courses:
                hay = " ".join([
                    course.get("title") or "",
                    course.get("designation") or "",
                    course.get("learning_month") or "", 
                    course.get("category") or "",
                    course.get("competency") or "",
                    course.get("provider") or "",
                    course.get("summary") or "",
                ]).lower()
                
                if any(k in hay for k in lowered):
                    results.append(course)
        
        # Search Microsoft Learn
        if search_ms:
            results += await ms_learn_service.find_courses_for_keywords(
                keywords, per_keyword=per_keyword, limit=limit, use_ai=use_ai
            )
        
        # Search Coursera
        if search_coursera:
            results += await coursera_service.find_courses_for_keywords(
                keywords, per_keyword=max(2, per_keyword // 2), limit=limit
            )
        
        # Deduplicate and limit results
        seen: dict[str, dict] = {}
        for course in results:
            seen.setdefault(course["uid"], course)
        
        return list(seen.values())[:limit]


# Global instance
dynamic_catalog_service = DynamicCatalogService()

# Legacy compatibility - gradually migrate to dynamic_catalog_service
async def get_course_by_uid(uid: str) -> dict | None:
    return await dynamic_catalog_service.get_course_by_uid(uid)

async def search_catalog(**kwargs) -> dict:
    return await dynamic_catalog_service.search_catalog(**kwargs)

async def get_facets(source: str = "microsoft_learn", organization_id: str | None = None) -> dict:
    return await dynamic_catalog_service.get_facets(source, organization_id=organization_id)

async def find_courses_for_keywords(keywords: list[str], **kwargs) -> list[dict]:
    return await dynamic_catalog_service.find_courses_for_keywords(keywords, **kwargs)

def source_of(uid: str) -> str:
    return dynamic_catalog_service.source_of(uid)
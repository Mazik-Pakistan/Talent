"""Learning Provider Management Service.

Phase 1: Generic Learning Provider Framework
Phase 2: Universal Provider Import Engine
Phase 3: Provider Management & Catalog Polish

Supports unlimited learning providers without requiring code changes.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from fastapi import HTTPException, status

from app.core.database import database
from app.core.rbac import CurrentUser
from app.schemas.provider import (
    LearningProviderCreate,
    LearningProviderResponse,
    LearningProviderUpdate,
)


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(value: Any) -> Any:
    return value.isoformat() if hasattr(value, "isoformat") else value


def _slug(value: str) -> str:
    """Generate URL-friendly slug from provider name."""
    return re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")


def _normalize_provider_name(value: Any) -> str:
    """Normalize provider name with standard capitalization."""
    if value is None:
        return ""
    text = " ".join(str(value).split())
    if not text:
        return ""
    
    # Standard provider name mappings
    aliases = {
        "linkedin learning": "LinkedIn Learning",
        "linkedin": "LinkedIn Learning",
        "microsoft learn": "Microsoft Learn",
        "microsoft": "Microsoft Learn",
        "coursera": "Coursera",
        "udemy": "Udemy",
        "pluralsight": "Pluralsight",
        "skillsoft": "Skillsoft",
        "datacamp": "DataCamp",
        "edx": "edX",
        "udacity": "Udacity",
        "aws training": "AWS Training",
        "google cloud training": "Google Cloud Training",
        "internal academy": "Internal Academy",
        "company academy": "Company Academy",
    }
    
    lower = text.lower()
    return aliases.get(lower, text)


class ProviderService:
    """Manage learning providers across all phases."""
    
    def _public_provider(self, doc: dict, course_count: int = 0) -> dict:
        """Convert database doc to public provider response."""
        return {
            "id": str(doc["_id"]),
            "name": doc.get("name") or "",
            "slug": doc.get("slug") or "",
            "provider_type": doc.get("provider_type") or "manual",
            "import_method": doc.get("import_method") or "manual",
            "logo_url": doc.get("logo_url"),
            "description": doc.get("description"),
            "active": bool(doc.get("active", True)),
            "course_count": course_count,
            "created_at": _iso(doc.get("created_at")),
            "updated_at": _iso(doc.get("updated_at")),
            "created_by_name": doc.get("created_by_name"),
        }
    
    async def _get_provider_by_id(self, provider_id: str) -> dict:
        """Get provider by ID."""
        if not ObjectId.is_valid(provider_id):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Provider not found."
            )
        
        provider = await database.learning_providers.find_one({"_id": ObjectId(provider_id)})
        if not provider:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Provider not found."
            )
        
        return provider
    
    async def _get_provider_by_slug(self, slug: str) -> dict | None:
        """Get provider by slug."""
        return await database.learning_providers.find_one({"slug": slug})
    
    async def _get_provider_by_name(self, name: str) -> dict | None:
        """Get provider by exact name."""
        return await database.learning_providers.find_one(
            {"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}
        )
    
    async def _count_provider_courses(self, provider_id: str) -> int:
        """Count active courses for a provider."""
        return await database.learning_courses.count_documents({
            "provider_id": provider_id,
            "$or": [{"archived": {"$exists": False}}, {"archived": False}]
        })
    
    async def list_providers(
        self,
        *,
        include_inactive: bool = False,
        provider_type: str | None = None,
        search: str | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> dict:
        """List all learning providers with filtering and pagination."""
        
        # Build query
        query: dict[str, Any] = {}
        
        if not include_inactive:
            query["active"] = True
        
        if provider_type:
            query["provider_type"] = provider_type
        
        if search and search.strip():
            search_pattern = {"$regex": re.escape(search.strip()), "$options": "i"}
            query["$or"] = [
                {"name": search_pattern},
                {"description": search_pattern},
                {"slug": search_pattern},
            ]
        
        # Get total count
        total = await database.learning_providers.count_documents(query)
        
        # Get paginated results
        skip = (page - 1) * page_size
        providers = await database.learning_providers.find(query).sort(
            "name", 1
        ).skip(skip).limit(page_size).to_list(length=page_size)
        
        # Enrich with course counts
        enriched = []
        for provider in providers:
            course_count = await self._count_provider_courses(str(provider["_id"]))
            enriched.append(self._public_provider(provider, course_count))
        
        pages = max(1, (total + page_size - 1) // page_size) if total else 1
        
        return {
            "providers": enriched,
            "total": total,
            "page": page,
            "page_size": page_size,
            "pages": pages,
        }
    
    async def get_provider(self, provider_id: str) -> dict:
        """Get a single provider by ID."""
        provider = await self._get_provider_by_id(provider_id)
        course_count = await self._count_provider_courses(provider_id)
        return {"provider": self._public_provider(provider, course_count)}
    
    async def create_provider(
        self,
        current_user: CurrentUser,
        payload: LearningProviderCreate,
    ) -> dict:
        """Create a new learning provider."""
        
        # Normalize name
        normalized_name = _normalize_provider_name(payload.name)
        if not normalized_name:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Provider name is required."
            )
        
        # Check for duplicate name
        existing = await self._get_provider_by_name(normalized_name)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Provider '{normalized_name}' already exists."
            )
        
        # Generate slug
        slug = _slug(normalized_name)
        
        # Check for duplicate slug
        slug_exists = await self._get_provider_by_slug(slug)
        if slug_exists:
            # Add suffix to make unique
            counter = 1
            while slug_exists:
                counter += 1
                new_slug = f"{slug}-{counter}"
                slug_exists = await self._get_provider_by_slug(new_slug)
            slug = new_slug
        
        now = _now()
        
        # Get creator name
        creator_name = current_user.full_name or current_user.email
        
        doc = {
            "name": normalized_name,
            "slug": slug,
            "provider_type": payload.provider_type,
            "import_method": payload.import_method,
            "logo_url": payload.logo_url,
            "description": payload.description,
            "active": payload.active,
            "created_at": now,
            "updated_at": now,
            "created_by_id": current_user.id,
            "created_by_name": creator_name,
            "updated_by_id": current_user.id,
        }
        
        result = await database.learning_providers.insert_one(doc)
        doc["_id"] = result.inserted_id
        
        # Audit log
        await self._create_audit_log(
            action="provider_created",
            provider_id=str(result.inserted_id),
            provider_name=normalized_name,
            user_id=current_user.id,
            user_name=creator_name,
            details={"provider_type": payload.provider_type},
        )

        await self._notify(
            recipient_id=current_user.id,
            recipient_role="recruiter",
            notif_type="provider_created",
            title="Learning provider created",
            message=f"Provider '{normalized_name}' was created and is now active in every catalog.",
        )

        return {"provider": self._public_provider(doc, 0)}
    
    async def update_provider(
        self,
        current_user: CurrentUser,
        provider_id: str,
        payload: LearningProviderUpdate,
    ) -> dict:
        """Update an existing learning provider."""
        
        provider = await self._get_provider_by_id(provider_id)
        
        updates: dict[str, Any] = {}
        
        # Handle name change
        if payload.name is not None:
            normalized_name = _normalize_provider_name(payload.name)
            if not normalized_name:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Provider name cannot be empty."
                )
            
            # Check for duplicate name (excluding current provider)
            existing = await database.learning_providers.find_one({
                "name": {"$regex": f"^{re.escape(normalized_name)}$", "$options": "i"},
                "_id": {"$ne": provider["_id"]}
            })
            
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Provider '{normalized_name}' already exists."
                )
            
            updates["name"] = normalized_name
            updates["slug"] = _slug(normalized_name)
        
        # Update other fields
        if payload.provider_type is not None:
            updates["provider_type"] = payload.provider_type
        
        if payload.import_method is not None:
            updates["import_method"] = payload.import_method
        
        if payload.logo_url is not None:
            updates["logo_url"] = payload.logo_url
        
        if payload.description is not None:
            updates["description"] = payload.description
        
        if payload.active is not None:
            updates["active"] = payload.active
        
        if not updates:
            # No changes
            course_count = await self._count_provider_courses(provider_id)
            return {"provider": self._public_provider(provider, course_count)}
        
        # Apply updates
        updates["updated_at"] = _now()
        updates["updated_by_id"] = current_user.id
        
        await database.learning_providers.update_one(
            {"_id": provider["_id"]},
            {"$set": updates}
        )
        
        # Get updated provider
        updated_provider = await database.learning_providers.find_one({"_id": provider["_id"]})
        course_count = await self._count_provider_courses(provider_id)
        
# Audit log
        await self._create_audit_log(
            action="provider_updated",
            provider_id=provider_id,
            provider_name=updated_provider.get("name"),
            user_id=current_user.id,
            user_name=current_user.full_name or current_user.email,
            details={"fields_updated": list(updates.keys())},
        )

        await self._notify(
            recipient_id=current_user.id,
            recipient_role="recruiter",
            notif_type="provider_updated",
            title="Learning provider updated",
            message=f"Provider '{updated_provider.get('name')}' was updated.",
        )

        return {"provider": self._public_provider(updated_provider, course_count)}
    
    async def delete_provider(
        self,
        current_user: CurrentUser,
        provider_id: str,
        force: bool = False,
    ) -> dict:
        """Delete a learning provider.
        
        Args:
            current_user: Current user performing the deletion
            provider_id: Provider ID to delete
            force: If True, delete even if courses exist (will archive courses)
        """
        
        provider = await self._get_provider_by_id(provider_id)
        
        # Check for dependent courses
        course_count = await self._count_provider_courses(provider_id)
        
        if course_count > 0 and not force:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot delete provider with {course_count} active course(s). "
                       f"Archive the provider or use force=true to archive all courses."
            )
        
        # If force=true, archive all courses first
        if force and course_count > 0:
            await database.learning_courses.update_many(
                {"provider_id": provider_id},
                {"$set": {"archived": True, "updated_at": _now()}}
            )
        
        # Delete the provider
        await database.learning_providers.delete_one({"_id": provider["_id"]})
        
# Audit log
        await self._create_audit_log(
            action="provider_deleted",
            provider_id=provider_id,
            provider_name=provider.get("name"),
            user_id=current_user.id,
            user_name=current_user.full_name or current_user.email,
            details={"force": force, "courses_affected": course_count},
        )

        await self._notify(
            recipient_id=current_user.id,
            recipient_role="recruiter",
            notif_type="provider_deleted",
            title="Learning provider removed",
            message=f"Provider '{provider.get('name')}' was deleted.",
        )

        return {
            "deleted": True,
            "provider_id": provider_id,
            "courses_archived": course_count if force else 0,
        }
    
    async def activate_provider(
        self,
        current_user: CurrentUser,
        provider_id: str,
    ) -> dict:
        """Activate a provider."""
        provider = await self._get_provider_by_id(provider_id)
        
        await database.learning_providers.update_one(
            {"_id": provider["_id"]},
            {"$set": {"active": True, "updated_at": _now(), "updated_by_id": current_user.id}}
        )
        
        updated = await database.learning_providers.find_one({"_id": provider["_id"]})
        course_count = await self._count_provider_courses(provider_id)
        
# Audit log
        await self._create_audit_log(
            action="provider_activated",
            provider_id=provider_id,
            provider_name=provider.get("name"),
            user_id=current_user.id,
            user_name=current_user.full_name or current_user.email,
        )

        await self._notify(
            recipient_id=current_user.id,
            recipient_role="recruiter",
            notif_type="provider_activated",
            title="Learning provider activated",
            message=f"Provider '{provider.get('name')}' is active again.",
        )

        return {"provider": self._public_provider(updated, course_count)}
    
    async def deactivate_provider(
        self,
        current_user: CurrentUser,
        provider_id: str,
    ) -> dict:
        """Deactivate a provider."""
        provider = await self._get_provider_by_id(provider_id)
        
        await database.learning_providers.update_one(
            {"_id": provider["_id"]},
            {"$set": {"active": False, "updated_at": _now(), "updated_by_id": current_user.id}}
        )
        
        updated = await database.learning_providers.find_one({"_id": provider["_id"]})
        course_count = await self._count_provider_courses(provider_id)
        
# Audit log
        await self._create_audit_log(
            action="provider_deactivated",
            provider_id=provider_id,
            provider_name=provider.get("name"),
            user_id=current_user.id,
            user_name=current_user.full_name or current_user.email,
        )

        await self._notify(
            recipient_id=current_user.id,
            recipient_role="recruiter",
            notif_type="provider_deactivated",
            title="Learning provider deactivated",
            message=f"Provider '{provider.get('name')}' was deactivated and hidden from catalogs.",
        )

        return {"provider": self._public_provider(updated, course_count)}
    
    async def _create_audit_log(
        self,
        *,
        action: str,
        provider_id: str,
        provider_name: str | None,
        user_id: str,
        user_name: str,
        details: dict | None = None,
    ) -> None:
        """Create an audit log entry for provider operations."""
        
        log_entry = {
            "action": action,
            "resource_type": "learning_provider",
            "resource_id": provider_id,
            "resource_name": provider_name,
            "user_id": user_id,
            "user_name": user_name,
            "user_role": "recruiter",  # Only recruiters can manage providers
            "details": details or {},
            "created_at": _now(),
        }
        
        try:
            await database.audit_logs.insert_one(log_entry)
        except Exception:
            # Don't fail the operation if audit logging fails
            pass

    async def _notify(
        self,
        *,
        recipient_id: str,
        recipient_role: str,
        notif_type: str,
        title: str,
        message: str,
        link: str = "/dashboard/recruiter/learning?tab=providers",
    ) -> None:
        """Send an in-app notification (non-blocking)."""
        try:
            from app.services.dashboard_service import create_notification

            await create_notification(
                recipient_id=recipient_id,
                recipient_role=recipient_role,
                notif_type=notif_type,
                title=title,
                message=message,
                link=link,
            )
        except Exception:
            pass


provider_service = ProviderService()

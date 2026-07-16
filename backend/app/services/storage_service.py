"""Cloudinary-backed file storage.

All uploads now flow through Cloudinary. The helper keeps the rest of the
document/onboarding pipeline unchanged while storing only metadata in MongoDB.
"""

from __future__ import annotations

from pathlib import Path

from app.core.config import settings
from app.services.cloudinary_service import cloudinary_service


def _resource_type(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        return "image"
    return "raw"


async def save_file(owner_id: str, category: str, filename: str, content: bytes) -> dict:
    public_id_prefix = f"{owner_id}/{category}"
    resource_type = _resource_type(filename)
    metadata = await cloudinary_service.upload_bytes(
        content=content,
        filename=filename,
        folder=settings.CLOUDINARY_FOLDER,
        public_id_prefix=public_id_prefix,
        resource_type=resource_type,
    )
    metadata["object_path"] = metadata["public_id"]
    metadata["file_url"] = metadata["secure_url"]
    metadata["backend"] = "cloudinary"
    return metadata


async def delete_file(public_id: str, *, resource_type: str = "image") -> bool:
    return await cloudinary_service.delete_asset(public_id, resource_type=resource_type)


async def get_signed_url(document: dict) -> str | None:
    """Return the Cloudinary secure URL for the file, or a legacy fallback."""
    if document.get("secure_url"):
        return document.get("secure_url")
    if document.get("file_url"):
        return document.get("file_url")
    if document.get("storage_backend") == "supabase":
        from app.core.database import supabase

        try:
            bucket = supabase.storage.from_(settings.SUPABASE_BUCKET)
            result = bucket.create_signed_url(document["object_path"], settings.SIGNED_URL_EXPIRE_SECONDS)
            return result.get("signedURL") or result.get("signed_url")
        except Exception:
            return None
    return None

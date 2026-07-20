"""Profile photo uploads to Cloudinary for employees and recruiters."""

from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException, UploadFile, status

from app.services import storage_service

ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
ALLOWED_CONTENT_TYPES = {
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
}
MAX_BYTES = 5 * 1024 * 1024


async def save_profile_photo(owner_id: str, file: UploadFile, previous_meta: dict | None = None) -> dict:
    """Validate and upload a profile photo. Returns fields to persist on the role document."""
    filename = (file.filename or "photo.jpg").strip()
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Profile photo must be a PNG, JPG, or WEBP image.",
        )

    content_type = (file.content_type or "").lower().strip()
    if content_type and content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Profile photo must be a PNG, JPG, or WEBP image.",
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The selected file is empty.")
    if len(content) > MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Profile photo must be 5 MB or smaller.",
        )

    try:
        stored = await storage_service.save_file(owner_id, "profile", filename, content)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Photo storage is temporarily unavailable. Please try again shortly.",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not upload your photo. Please try again.",
        ) from exc

    if previous_meta and previous_meta.get("object_path"):
        await storage_service.delete_file(previous_meta)

    return {
        "profile_picture": stored["file_url"],
        "profile_picture_meta": {
            "backend": stored.get("backend"),
            "object_path": stored.get("object_path"),
            "file_url": stored.get("file_url"),
            "resource_type": stored.get("resource_type") or "image",
        },
    }


async def remove_profile_photo(previous_meta: dict | None = None) -> dict:
    """Clear a stored profile photo from Cloudinary and return empty fields."""
    if previous_meta and previous_meta.get("object_path"):
        await storage_service.delete_file(previous_meta)
    return {
        "profile_picture": None,
        "profile_picture_meta": None,
    }

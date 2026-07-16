from __future__ import annotations

import tempfile
import uuid
from datetime import UTC, datetime
from pathlib import Path

import cloudinary
from cloudinary import uploader

from app.core.config import settings


def _configure_cloudinary() -> None:
    if settings.CLOUDINARY_URL:
        from urllib.parse import urlparse

        parsed = urlparse(settings.CLOUDINARY_URL)
        cloudinary.config(
            secure=True,
            cloud_name=parsed.hostname or settings.CLOUDINARY_CLOUD_NAME,
            api_key=parsed.username or settings.CLOUDINARY_API_KEY,
            api_secret=parsed.password or settings.CLOUDINARY_API_SECRET,
        )
        return

    cloudinary.config(
        secure=True,
        cloud_name=settings.CLOUDINARY_CLOUD_NAME or None,
        api_key=settings.CLOUDINARY_API_KEY or None,
        api_secret=settings.CLOUDINARY_API_SECRET or None,
    )


_configure_cloudinary()


class CloudinaryService:
    async def upload_bytes(
        self,
        *,
        content: bytes,
        filename: str,
        folder: str | None = None,
        public_id_prefix: str | None = None,
        resource_type: str = "auto",
    ) -> dict:
        suffix = Path(filename).suffix.lower()
        temp_path = None
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(content)
            temp_path = Path(tmp.name)

        try:
            upload_kwargs: dict[str, object] = {
                "folder": folder or settings.CLOUDINARY_FOLDER,
                "resource_type": resource_type,
                "overwrite": False,
                "use_filename": False,
                "unique_filename": True,
            }
            if public_id_prefix:
                upload_kwargs["public_id"] = f"{public_id_prefix}/{uuid.uuid4().hex}"

            result = uploader.upload(str(temp_path), **upload_kwargs)
            return {
                "public_id": result.get("public_id"),
                "secure_url": result.get("secure_url") or result.get("url"),
                "original_filename": filename,
                "file_type": self._file_type(filename),
                "mime_type": result.get("mime_type") or self._mime_type(filename),
                "size": int(result.get("bytes") or len(content)),
                "uploaded_at": datetime.now(UTC),
                "resource_type": result.get("resource_type") or resource_type,
            }
        finally:
            if temp_path and temp_path.exists():
                temp_path.unlink(missing_ok=True)

    async def delete_asset(self, public_id: str, *, resource_type: str = "image") -> bool:
        if not public_id:
            return False
        result = uploader.destroy(public_id, resource_type=resource_type, invalidate=True)
        return (result or {}).get("result") in {"ok", "not found"}

    @staticmethod
    def _file_type(filename: str) -> str:
        ext = Path(filename).suffix.lower().lstrip(".")
        return ext or "bin"

    @staticmethod
    def _mime_type(filename: str) -> str:
        ext = Path(filename).suffix.lower()
        return {
            ".pdf": "application/pdf",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".doc": "application/msword",
            ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }.get(ext, "application/octet-stream")


cloudinary_service = CloudinaryService()

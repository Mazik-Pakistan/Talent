"""US-050: Cloud-backed document storage.

All new document uploads go to Cloudinary. Temporary local files are used only
for in-process extraction and are never exposed through the app.
"""

from __future__ import annotations

import hashlib
import tempfile
import uuid
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from app.core.config import settings


def _clean_segment(value: str) -> str:
    return str(value).strip().replace("/", "-")


def _cloudinary_folder(owner_id: str, category: str) -> str:
    base = _clean_segment(settings.CLOUDINARY_FOLDER or "talent")
    owner = _clean_segment(owner_id)
    cat = _clean_segment(category)
    return "/".join(part for part in (base, owner, cat) if part)


def _guess_content_type(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    return {
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".doc": "application/msword",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }.get(ext, "application/octet-stream")


def _require_cloudinary_settings() -> None:
    missing = [
        name
        for name in ("CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET")
        if not getattr(settings, name, "")
    ]
    if missing:
        raise RuntimeError(f"Missing Cloudinary settings: {', '.join(missing)}")


def _signature(payload: dict[str, str]) -> str:
    serialized = "&".join(f"{key}={payload[key]}" for key in sorted(payload) if payload[key] != "")
    digest = hashlib.sha1(f"{serialized}{settings.CLOUDINARY_API_SECRET}".encode("utf-8")).hexdigest()
    return digest


def _cloudinary_base_url() -> str:
    _require_cloudinary_settings()
    return f"https://api.cloudinary.com/v1_1/{settings.CLOUDINARY_CLOUD_NAME}"


async def _download_bytes(url: str) -> bytes:
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.content


def _upload_public_id(owner_id: str, category: str) -> str:
    return f"{_cloudinary_folder(owner_id, category)}/{uuid.uuid4().hex}"


async def save_file(owner_id: str, category: str, filename: str, content: bytes) -> dict:
    """Upload a file to Cloudinary and return the metadata used by MongoDB."""
    _require_cloudinary_settings()
    content_type = _guess_content_type(filename)
    public_id = _upload_public_id(owner_id, category)
    timestamp = str(int(datetime.now(UTC).timestamp()))
    signed_fields = {
        "folder": _cloudinary_folder(owner_id, category),
        "public_id": public_id.split("/")[-1],
        "timestamp": timestamp,
    }
    signature = _signature(signed_fields)

    upload_url = f"{_cloudinary_base_url()}/auto/upload"
    form_data = {
        "api_key": settings.CLOUDINARY_API_KEY,
        "folder": signed_fields["folder"],
        "public_id": signed_fields["public_id"],
        "signature": signature,
        "timestamp": timestamp,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            upload_url,
            data=form_data,
            files={"file": (filename, content, content_type)},
        )
        response.raise_for_status()
        payload = response.json()
        file_url = payload.get("secure_url") or payload.get("url")
        if not file_url:
            raise RuntimeError("Cloudinary upload did not return a file URL.")

    return {
        "backend": "cloudinary",
        "object_path": payload.get("public_id") or public_id,
        "file_url": file_url,
        "resource_type": payload.get("resource_type") or "raw",
    }


async def get_signed_url(document: dict) -> str | None:
    """Return a browser-safe URL for the stored document."""
    file_url = document.get("file_url")
    return file_url


async def materialize_local_file(document: dict) -> str:
    """Return a readable local path for OCR or re-extraction."""
    object_path = document.get("object_path") or ""
    file_url = document.get("file_url") or ""
    if not file_url:
        raise FileNotFoundError("Stored document file is unavailable.")
    content = await _download_bytes(file_url)
    suffix = Path(urlsplit(file_url).path).suffix.lower() or Path(object_path).suffix.lower()
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as scratch_file:
        scratch_file.write(content)
        return scratch_file.name


async def delete_file(document: dict) -> None:
    """Best-effort removal from Cloudinary."""
    object_path = document.get("object_path") or ""
    if not object_path:
        return
    resource_type = document.get("resource_type") or "raw"
    timestamp = str(int(datetime.now(UTC).timestamp()))
    signed_fields = {
        "public_id": object_path,
        "timestamp": timestamp,
    }
    signature = _signature(signed_fields)
    delete_url = f"{_cloudinary_base_url()}/{resource_type}/destroy"
    form_data = {
        "api_key": settings.CLOUDINARY_API_KEY,
        "public_id": object_path,
        "signature": signature,
        "timestamp": timestamp,
        "invalidate": "true",
    }
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(delete_url, data=form_data)
            response.raise_for_status()
    except Exception:
        return

"""US-050: Secure document storage.

Primary path: Supabase Storage, private bucket, accessed only via signed URLs.
Fallback: local disk under /uploads (dev convenience — e.g. Supabase Storage
not provisioned yet). The fallback keeps the rest of the document pipeline
(OCR, verification, downloads) working identically either way.
"""

from __future__ import annotations

import uuid
from pathlib import Path

from app.core.config import settings
from app.core.database import supabase

UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "uploads"
LOCAL_TEMP_ROOT = Path(__file__).resolve().parents[2] / "uploads" / "_ocr_tmp"


def _object_path(owner_id: str, category: str, filename: str) -> str:
    ext = Path(filename).suffix.lower()
    return f"{owner_id}/{category}/{uuid.uuid4().hex}{ext}"


async def save_file(owner_id: str, category: str, filename: str, content: bytes) -> dict:
    """Persist a file, returning storage metadata used by the Documents collection.

    Returns: {backend: "supabase"|"local", object_path, file_url, local_path}
    `local_path` is always populated (even for the supabase backend, via a
    scratch copy) so OCR can read bytes off disk without another round trip.
    """
    object_path = _object_path(owner_id, category, filename)

    LOCAL_TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    scratch_path = LOCAL_TEMP_ROOT / f"{uuid.uuid4().hex}{Path(filename).suffix.lower()}"
    scratch_path.write_bytes(content)

    try:
        bucket = supabase.storage.from_(settings.SUPABASE_BUCKET)
        content_type = _guess_content_type(filename)
        bucket.upload(object_path, content, {"content-type": content_type})
        return {
            "backend": "supabase",
            "object_path": object_path,
            "file_url": None,  # never store a public URL — always mint a signed URL on demand
            "local_path": str(scratch_path),
        }
    except Exception:
        # Supabase Storage not configured / bucket missing — fall back to local disk
        # so onboarding keeps working; document is still tracked identically.
        folder = UPLOAD_ROOT / owner_id / category
        folder.mkdir(parents=True, exist_ok=True)
        dest = folder / Path(object_path).name
        dest.write_bytes(content)
        return {
            "backend": "local",
            "object_path": object_path,
            "file_url": f"/uploads/{owner_id}/{category}/{Path(object_path).name}",
            "local_path": str(dest),
        }


async def get_signed_url(document: dict) -> str | None:
    """US-050: time-limited signed URL for authenticated, authorized access only."""
    if document.get("storage_backend") != "supabase":
        return document.get("file_url")
    try:
        bucket = supabase.storage.from_(settings.SUPABASE_BUCKET)
        result = bucket.create_signed_url(document["object_path"], settings.SIGNED_URL_EXPIRE_SECONDS)
        return result.get("signedURL") or result.get("signed_url")
    except Exception:
        return None


async def materialize_local_file(document: dict) -> str:
    """Return a readable local path for OCR/re-extraction."""
    object_path = document.get("object_path") or ""
    if document.get("storage_backend") != "supabase":
        local_path = UPLOAD_ROOT / object_path
        if not local_path.exists():
            raise FileNotFoundError("Stored document file is unavailable.")
        return str(local_path)

    bucket = supabase.storage.from_(settings.SUPABASE_BUCKET)
    downloaded = bucket.download(object_path)
    content = downloaded
    if not isinstance(content, (bytes, bytearray)):
        content = getattr(downloaded, "content", None) or getattr(downloaded, "data", None)
    if not isinstance(content, (bytes, bytearray)):
        raise FileNotFoundError("Could not download the stored document.")

    LOCAL_TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    suffix = Path(object_path).suffix.lower()
    scratch_path = LOCAL_TEMP_ROOT / f"{uuid.uuid4().hex}{suffix}"
    scratch_path.write_bytes(bytes(content))
    return str(scratch_path)


async def delete_file(document: dict) -> None:
    """Best-effort removal from the configured storage backend."""
    object_path = document.get("object_path") or ""
    if not object_path:
        return
    if document.get("storage_backend") == "supabase":
        try:
            supabase.storage.from_(settings.SUPABASE_BUCKET).remove([object_path])
        except Exception:
            return
    else:
        local_path = UPLOAD_ROOT / object_path
        try:
            local_path.unlink(missing_ok=True)
        except OSError:
            return


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

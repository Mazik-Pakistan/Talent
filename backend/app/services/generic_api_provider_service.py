"""Generic config-driven API learning provider importer (Phase 3).

A single, provider-agnostic pipeline that reads a provider's saved
``api_config`` (endpoint, authentication, custom headers, and response
mapping) and turns API responses into the same normalized course records
the universal import engine already understands.

New API providers are added from the Providers UI — no backend code changes
are required. There is intentionally no provider-specific if/elif chain here.

Pipeline:
    Provider api_config
      -> build request (auth + headers)
      -> HTTP GET
      -> parse JSON
      -> resolve field mappings (supports nested paths like ``data[].id``)
      -> normalized course records -> existing Course Catalog
"""

from __future__ import annotations

import base64
import re
from typing import Any

import httpx
from loguru import logger

from app.core.crypto import decrypt_text

API_TIMEOUT_SECONDS = 30.0
API_MAX_COURSES = 5000
DEFAULT_API_KEY_HEADER = "X-API-Key"

_PATH_SEGMENT_RE = re.compile(r"[^\[\].]+|\[\]")


class ApiImportError(Exception):
    """Friendly, user-safe API import/connection error."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def is_http_url(url: str) -> bool:
    """Validate an http(s) URL (used for endpoint validation)."""
    from urllib.parse import urlparse

    try:
        parts = urlparse((url or "").strip())
    except Exception:  # noqa: BLE001
        return False
    return parts.scheme in ("http", "https") and bool(parts.netloc)


def build_request_headers(api_config: dict) -> dict[str, str]:
    """Build HTTP headers from the stored config (decrypting secrets).

    Accepts both stored provider docs (encrypted ``*_enc`` fields) and
    plaintext configs (e.g. a test-connection payload). Never logs secrets.
    """
    auth = api_config.get("auth") or {}
    headers: dict[str, str] = {}
    for key, value in (api_config.get("headers") or {}).items():
        if key and key.strip() and value is not None:
            headers[str(key).strip()] = str(value)

    auth_type = auth.get("type") or "none"

    if auth_type == "api_key":
        header_name = (auth.get("header_name") or DEFAULT_API_KEY_HEADER).strip() or DEFAULT_API_KEY_HEADER
        key = decrypt_text(auth.get("api_key_enc")) or auth.get("api_key") or ""
        if key:
            headers[header_name] = str(key)

    elif auth_type == "bearer":
        token = decrypt_text(auth.get("bearer_token_enc")) or auth.get("bearer_token") or ""
        if token:
            headers["Authorization"] = f"Bearer {token}"

    elif auth_type == "basic":
        username = auth.get("username") or ""
        password = decrypt_text(auth.get("password_enc")) or auth.get("password") or ""
        if username:
            raw = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
            headers["Authorization"] = f"Basic {raw}"

    return headers


def _evaluate_path(data: Any, path: str) -> list[Any]:
    """Resolve a JSON path that may fan out over arrays.

    Supported syntax: ``data[].id``, ``results[].course.title``, ``id``.
    ``[]`` iterates the current value when it is a list. Missing keys yield
    ``None`` placeholders so records stay index-aligned.
    """
    if not path or not str(path).strip():
        return []
    parts = [p for p in _PATH_SEGMENT_RE.findall(str(path).strip()) if p]
    branches: list[Any] = [data]
    for part in parts:
        if part == "[]":
            next_branches: list[Any] = []
            for branch in branches:
                if isinstance(branch, list):
                    next_branches.extend(branch)
                else:
                    next_branches.append(branch)
            branches = next_branches
            continue
        next_branches = []
        for branch in branches:
            if isinstance(branch, dict) and part in branch:
                next_branches.append(branch[part])
            else:
                next_branches.append(None)
        branches = next_branches
    return branches


def _split_listish(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return [v for v in value if v is not None and str(v).strip()]
    if isinstance(value, str):
        return [part.strip() for part in value.split(",") if part.strip()]
    return [value]


def _apply_mapping(data: Any, mapping: dict) -> list[dict]:
    """Zip mapped fields into index-aligned records.

    Each mapping value is a JSON path. All paths share the same array
    iteration, so ``data[].id`` + ``data[].title`` produce one record per
    item. Fields whose path yields fewer values default to None.
    """
    paths = {
        field: str(path).strip()
        for field, path in (mapping or {}).items()
        if path and str(path).strip()
    }
    if not paths:
        return []

    values: dict[str, list[Any]] = {}
    max_len = 0
    for field, path in paths.items():
        vals = _evaluate_path(data, path)
        values[field] = vals
        max_len = max(max_len, len(vals))

    if max_len == 0:
        return []

    records: list[dict] = []
    for i in range(max_len):
        record: dict[str, Any] = {}
        for field, vals in values.items():
            record[field] = vals[i] if i < len(vals) else None
        records.append(record)
    return records


def _friendly_http_error(status_code: int) -> str:
    code = status_code
    if code == 400:
        return "API connection failed: 400 Bad Request."
    if code == 401:
        return "API connection failed: 401 Unauthorized. Check your credentials."
    if code == 403:
        return "API connection failed: 403 Forbidden. The credentials lack access."
    if code == 404:
        return "API connection failed: 404 Not Found. Check the endpoint URL."
    if code == 408:
        return "API connection failed: 408 Request Timeout."
    if code == 429:
        return "API connection failed: 429 Too Many Requests. Try again later."
    if code == 500:
        return "API connection failed: 500 Internal Server Error."
    if code == 502:
        return "API connection failed: 502 Bad Gateway."
    if code == 503:
        return "API connection failed: 503 Service Unavailable."
    if code == 504:
        return "API connection failed: 504 Gateway Timeout."
    return f"API connection failed: HTTP {code}."


def normalize_course_record(record: dict) -> dict:
    """Convert a mapped record into the course shape the import engine uses."""
    from app.services.managed_learning_service import _parse_duration

    title = record.get("title")
    if title is None:
        title = record.get("name")
    duration_raw = record.get("duration_minutes")
    duration_minutes: int | None = None
    if isinstance(duration_raw, (int, float)) and not isinstance(duration_raw, bool):
        duration_minutes = int(duration_raw) if duration_raw > 0 else None
    elif duration_raw:
        duration_minutes = _parse_duration(str(duration_raw)) or _parse_duration(str(duration_raw), unit="hours")

    def _text(value: Any) -> str:
        if value is None:
            return ""
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return str(value)
        return str(value).strip()

    return {
        "external_id": _text(record.get("external_id")) or None,
        "title": _text(title) or None,
        "url": _text(record.get("url")) or None,
        "description": _text(record.get("description")) or None,
        "duration_minutes": duration_minutes,
        "category": _text(record.get("category")),
        "competency": _text(record.get("competency")),
        "designation": _text(record.get("designation")),
        "learning_month": _text(record.get("learning_month")),
        "instructor": _text(record.get("instructor")) or None,
        "tags": _split_listish(record.get("tags")),
        "skills": _split_listish(record.get("skills")),
        "difficulty": _text(record.get("level") or record.get("difficulty")),
        "language": _text(record.get("language")) or None,
        "image_url": _text(record.get("image")) or None,
    }


async def fetch_courses(api_config: dict, *, max_items: int | None = None) -> list[dict]:
    """Fetch courses from a provider's API using its saved configuration.

    Returns a list of normalized course records (the same shape Excel
    imports produce). Raises :class:`ApiImportError` on any failure with a
    user-friendly message. Secrets are never included in errors or logs.
    """
    endpoint = (api_config.get("endpoint") or "").strip()
    if not endpoint:
        raise ApiImportError("API endpoint is required.")
    if not is_http_url(endpoint):
        raise ApiImportError("API endpoint must be a valid http(s) URL.")

    mapping = api_config.get("mapping") or {}
    if not any(str(p).strip() for p in mapping.values()):
        raise ApiImportError("Course response mapping is not configured.")

    headers = build_request_headers(api_config)

    try:
        async with httpx.AsyncClient(timeout=API_TIMEOUT_SECONDS) as client:
            response = await client.get(endpoint, headers=headers)
    except httpx.TimeoutException:
        logger.warning("API provider request timed out for endpoint host")
        raise ApiImportError("API connection failed: the request timed out.")
    except httpx.ConnectError:
        logger.warning("API provider connect error for endpoint host")
        raise ApiImportError("API connection failed: could not reach the endpoint. Check the URL and network access.")
    except httpx.HTTPError:
        logger.warning("API provider request failed for endpoint host")
        raise ApiImportError("API connection failed: the request could not be completed.")

    if response.status_code != 200:
        logger.warning(f"API provider returned HTTP {response.status_code}")
        raise ApiImportError(_friendly_http_error(response.status_code))

    try:
        data = response.json()
    except (ValueError, httpx.DecodingError):
        raise ApiImportError("API connection failed: the response was not valid JSON.")

    mapped = _apply_mapping(data, mapping)
    if not mapped:
        raise ApiImportError(
            "Connection successful, but the configured course mapping returned no courses. "
            "Check the mapping paths against the API response."
        )

    records = [normalize_course_record(r) for r in mapped]
    records = [r for r in records if r.get("title")]
    if not records:
        raise ApiImportError(
            "Connection successful, but the configured course mapping returned no courses. "
            "Check the mapping paths against the API response (no titles were found)."
        )

    cap = max_items if max_items is not None else API_MAX_COURSES
    if cap and len(records) > cap:
        records = records[:cap]
    return records


async def test_connection(api_config: dict) -> dict:
    """Validate a provider API configuration without persisting anything.

    Success -> {"success": True, "message": "...", "course_count": n}
    Failure -> raises ApiImportError with a user-friendly message.
    """
    records = await fetch_courses(api_config, max_items=50)
    found = len(records)
    return {
        "success": True,
        "message": f"API connection successful. Found {found} course(s).",
        "course_count": found,
    }

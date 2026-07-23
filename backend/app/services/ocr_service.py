"""US-041: OCR extraction using PaddleOCR.

Runs after every identity/education document upload. PaddleOCR is a heavy,
optional dependency (paddlepaddle + paddleocr) — the app must keep working
even before those packages are installed on the machine, so the model is
loaded lazily and every failure degrades to a "manual review" result instead
of crashing the upload endpoint.

Install (CPU):
    pip install paddlepaddle paddleocr

Enable/disable via settings.ENABLE_OCR (see app/core/config.py).
"""

from __future__ import annotations

import re
import threading
from functools import lru_cache

from app.core.config import settings

_OCR_LOCK = threading.Lock()
_OCR_ENGINE = None
_OCR_IMPORT_ERROR: str | None = None

# Field patterns extracted per document type. PaddleOCR returns raw text lines;
# we run light regex/heuristics over the recognized text to pull structured
# fields, matching the "Extracted data" scope from US-041.
CNIC_PATTERN = re.compile(r"\b\d{5}-?\d{7}-?\d{1}\b")
PASSPORT_PATTERN = re.compile(r"\b[A-Z]{1,2}\d{6,8}\b")
DATE_PATTERN = re.compile(r"\b(\d{1,2}[-/ ]\d{1,2}[-/ ]\d{2,4}|\d{4}[-/ ]\d{1,2}[-/ ]\d{1,2})\b")
YEAR_PATTERN = re.compile(r"\b(19|20)\d{2}\b")


def _get_engine():
    """Lazily construct a single shared PaddleOCR instance (expensive to init)."""
    global _OCR_ENGINE, _OCR_IMPORT_ERROR
    if _OCR_ENGINE is not None or _OCR_IMPORT_ERROR is not None:
        return _OCR_ENGINE
    with _OCR_LOCK:
        if _OCR_ENGINE is not None or _OCR_IMPORT_ERROR is not None:
            return _OCR_ENGINE
        try:
            from paddleocr import PaddleOCR  # noqa: PLC0415 (intentionally lazy)

            _OCR_ENGINE = PaddleOCR(
                use_angle_cls=True,
                lang=settings.OCR_LANG,
                use_gpu=settings.OCR_USE_GPU,
                show_log=False,
            )
        except Exception as exc:  # pragma: no cover - depends on optional install
            _OCR_IMPORT_ERROR = str(exc)
            _OCR_ENGINE = None
    return _OCR_ENGINE


def ocr_available() -> bool:
    if not settings.ENABLE_OCR:
        return False
    return _get_engine() is not None


def _extract_lines(image_path: str) -> tuple[list[str], float]:
    """Run PaddleOCR over a single image/PDF page and return (lines, avg_confidence)."""
    engine = _get_engine()
    if engine is None:
        raise RuntimeError(_OCR_IMPORT_ERROR or "OCR engine unavailable")

    result = engine.ocr(image_path, cls=True)
    lines: list[str] = []
    confidences: list[float] = []
    for page in result or []:
        for detection in page or []:
            # detection = [box, (text, confidence)]
            try:
                text, confidence = detection[1]
            except (IndexError, TypeError, ValueError):
                continue
            if text:
                lines.append(text)
                confidences.append(float(confidence))
    avg_confidence = round(sum(confidences) / len(confidences), 4) if confidences else 0.0
    return lines, avg_confidence


def _pdf_to_image(file_path: str) -> str:
    """Rasterize page 1 of a PDF to a temp PNG so PaddleOCR (image-only) can read it."""
    import tempfile

    import fitz  # PyMuPDF — noqa: PLC0415

    doc = fitz.open(file_path)
    page = doc.load_page(0)
    pix = page.get_pixmap(dpi=220)
    tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    pix.save(tmp.name)
    doc.close()
    return tmp.name


def _fields_for_identity(lines: list[str]) -> dict:
    joined = "\n".join(lines)
    cnic = CNIC_PATTERN.search(joined)
    passport = PASSPORT_PATTERN.search(joined)
    dates = DATE_PATTERN.findall(joined)
    # Heuristic: the longest all-letters line is usually the printed full name.
    name_candidates = [ln for ln in lines if re.fullmatch(r"[A-Za-z .'-]{4,60}", ln.strip())]
    full_name = max(name_candidates, key=len) if name_candidates else None
    return {
        "full_name": full_name,
        "cnic_number": cnic.group(0) if cnic else None,
        "passport_number": passport.group(0) if (passport and not cnic) else None,
        "dates_found": dates[:3],
    }


def _fields_for_education(lines: list[str]) -> dict:
    joined = "\n".join(lines)
    years = YEAR_PATTERN.findall(joined)
    degree_keywords = ("bachelor", "master", "bs", "ms", "phd", "diploma", "degree", "bsc", "msc")
    degree_line = next((ln for ln in lines if any(k in ln.lower() for k in degree_keywords)), None)
    institute_keywords = ("university", "institute", "college", "school")
    institute_line = next((ln for ln in lines if any(k in ln.lower() for k in institute_keywords)), None)
    return {
        "degree_name": degree_line,
        "institution": institute_line,
        "graduation_year": years[-1] if years else None,
    }


async def process_document(file_path: str, doc_type: str, category: str) -> dict:
    """Run OCR on an uploaded document and return a structured result.

    Never raises — callers should treat a "failed" status as "needs manual
    review" rather than a hard error, per US-041 acceptance criteria
    ("Failed OCR flagged").
    """
    if not settings.ENABLE_OCR:
        return {"status": "disabled", "fields": {}, "confidence": 0.0, "raw_text": [], "engine": "paddleocr"}

    import asyncio

    def _run() -> dict:
        target_path = file_path
        temp_image = None
        try:
            if file_path.lower().endswith(".pdf"):
                temp_image = _pdf_to_image(file_path)
                target_path = temp_image

            lines, confidence = _extract_lines(target_path)
            if category == "identity":
                fields = _fields_for_identity(lines)
            elif category == "education":
                fields = _fields_for_education(lines)
            else:
                fields = {}

            return {
                "status": "completed",
                "fields": fields,
                "confidence": confidence,
                "raw_text": lines[:40],
                "engine": "paddleocr",
            }
        except Exception as exc:
            return {
                "status": "failed",
                "fields": {},
                "confidence": 0.0,
                "raw_text": [],
                "engine": "paddleocr",
                "error": str(exc),
            }
        finally:
            if temp_image:
                import contextlib
                import os

                with contextlib.suppress(OSError):
                    os.unlink(temp_image)

    return await asyncio.to_thread(_run)


def compare_with_profile(ocr_fields: dict, profile_fields: dict) -> list[dict]:
    """US-042: Flag mismatches between OCR-extracted data and profile data."""
    from app.services.document_matching_service import _norm_date, names_roughly_match

    date_keys = {
        "date_of_birth",
        "issue_date",
        "expiry_date",
        "date_of_issue",
        "date_of_expiry",
        "passing_year",
    }
    name_keys = {"name", "full_name", "candidate_name", "father_name"}

    mismatches = []
    for key, ocr_value in (ocr_fields or {}).items():
        profile_value = profile_fields.get(key)
        if not ocr_value or not profile_value:
            continue
        if key in date_keys:
            if _norm_date(ocr_value) == _norm_date(profile_value):
                continue
        elif key in name_keys:
            if names_roughly_match(str(ocr_value), str(profile_value)):
                continue
        else:
            norm_ocr = re.sub(r"[\s\-_.,/]", "", str(ocr_value)).lower()
            norm_profile = re.sub(r"[\s\-_.,/]", "", str(profile_value)).lower()
            if norm_ocr == norm_profile:
                continue
        mismatches.append({"field": key, "ocr_value": ocr_value, "profile_value": profile_value})
    return mismatches

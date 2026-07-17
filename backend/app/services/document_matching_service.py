"""Cross-document consistency matching for profile verification.

Compares extracted fields across CNIC/Passport, Resume, and Transcript.
Recruiters can approve mismatches based on judgment.
"""

from __future__ import annotations

import re
from typing import Any


def _norm(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip().lower()
    text = re.sub(r"[\s\-_,.]+", "", text)
    return text


def _display(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _norm_date(value: Any) -> str:
    text = _display(value)
    if not text:
        return ""
    parts = re.findall(r"\d+", text)
    if len(parts) != 3:
        return _norm(text)
    if len(parts[0]) == 4:
        year, month, day = parts
    else:
        day, month, year = parts
    return f"{year.zfill(4)}{month.zfill(2)}{day.zfill(2)}"


def _name_from_fields(fields: dict) -> str | None:
    if not fields:
        return None
    for key in ("full_name", "name", "candidate_name"):
        if fields.get(key):
            return _display(fields[key])
    first = fields.get("first_name") or ""
    last = fields.get("last_name") or ""
    combined = f"{first} {last}".strip()
    return combined or None


def _dob_from_fields(fields: dict) -> str | None:
    return _display((fields or {}).get("date_of_birth"))


def _institute_from_fields(fields: dict, category: str) -> str | None:
    if category == "academic_transcript":
        return _display(fields.get("institute"))
    if category == "resume":
        education = fields.get("education")
        if isinstance(education, list) and education:
            first = education[0]
            if isinstance(first, dict):
                return _display(first.get("institute") or first.get("institution"))
            return _display(first)
        return _display(fields.get("institute") or fields.get("institution"))
    return None


def _degree_from_fields(fields: dict, category: str) -> str | None:
    if category == "academic_transcript":
        return _display(fields.get("degree"))
    if category == "resume":
        education = fields.get("education")
        if isinstance(education, list) and education:
            first = education[0]
            if isinstance(first, dict):
                return _display(first.get("degree"))
            return None
        return _display(fields.get("degree"))
    return None


def names_roughly_match(a: str | None, b: str | None) -> bool:
    """Exact normalized match only. Partial overlaps (Hassan Farooqui vs Hassan Ullah Farooqui)
    are treated as mismatches so recruiters can review and approve by judgment."""
    na, nb = _norm(a), _norm(b)
    if not na or not nb:
        return True
    return na == nb


def compare_extractions(docs: list[dict]) -> dict:
    """Compare a list of document records that each have ocr_result.

    Returns:
      {
        verification_status: pending|verified|mismatch,
        matching_confidence: float,
        mismatches: [...],
        summary: str | None,
      }
    """
    by_cat: dict[str, dict] = {}
    for doc in docs:
        ocr = doc.get("ocr_result") or {}
        if ocr.get("status") != "completed":
            continue
        cat = ocr.get("category") or doc.get("doc_type")
        if cat == "certificate":
            cat = "academic_transcript"
        if cat in ("cnic", "passport", "resume", "academic_transcript"):
            by_cat[cat] = {
                "doc_type": doc.get("doc_type"),
                "category": cat,
                "fields": ocr.get("fields") or {},
                "source_label": {
                    "cnic": "National ID",
                    "passport": "Passport",
                    "resume": "Resume",
                    "academic_transcript": "Transcript",
                }.get(cat, cat),
            }

    mismatches: list[dict] = []

    identity = by_cat.get("cnic") or by_cat.get("passport")
    resume = by_cat.get("resume")
    transcript = by_cat.get("academic_transcript")

    # Name: identity vs resume vs transcript
    name_sources = []
    if identity:
        name_sources.append((identity["source_label"], _name_from_fields(identity["fields"])))
    if resume:
        name_sources.append((resume["source_label"], _name_from_fields(resume["fields"])))
    if transcript:
        name_sources.append((transcript["source_label"], _name_from_fields(transcript["fields"])))

    for i in range(len(name_sources)):
        for j in range(i + 1, len(name_sources)):
            src_a, val_a = name_sources[i]
            src_b, val_b = name_sources[j]
            if not val_a or not val_b:
                continue
            if not names_roughly_match(val_a, val_b):
                mismatches.append(
                    {
                        "field": "name",
                        "reason": "Candidate name differs across uploaded documents.",
                        "values": {src_a: val_a, src_b: val_b},
                        "sources": [src_a, src_b],
                    }
                )

    # DOB: identity vs resume
    if identity and resume:
        dob_a = _dob_from_fields(identity["fields"])
        dob_b = _dob_from_fields(resume["fields"])
        if dob_a and dob_b and _norm_date(dob_a) != _norm_date(dob_b):
            mismatches.append(
                {
                    "field": "date_of_birth",
                    "reason": "Date of Birth mismatch.",
                    "values": {identity["source_label"]: dob_a, "Resume": dob_b},
                    "sources": [identity["source_label"], "Resume"],
                }
            )

    # Institute / degree: resume vs transcript
    if resume and transcript:
        inst_a = _institute_from_fields(resume["fields"], "resume")
        inst_b = _institute_from_fields(transcript["fields"], "academic_transcript")
        if inst_a and inst_b and _norm(inst_a) != _norm(inst_b):
            if not names_roughly_match(inst_a, inst_b):
                mismatches.append(
                    {
                        "field": "institute",
                        "reason": "Education details do not match transcript.",
                        "values": {"Resume": inst_a, "Transcript": inst_b},
                        "sources": ["Resume", "Transcript"],
                    }
                )

        deg_a = _degree_from_fields(resume["fields"], "resume")
        deg_b = _degree_from_fields(transcript["fields"], "academic_transcript")
        if deg_a and deg_b and _norm(deg_a) != _norm(deg_b):
            if not names_roughly_match(deg_a, deg_b):
                mismatches.append(
                    {
                        "field": "degree",
                        "reason": "Degree information mismatch.",
                        "values": {"Resume": deg_a, "Transcript": deg_b},
                        "sources": ["Resume", "Transcript"],
                    }
                )

    compared_pairs = max(len(name_sources) - 1, 0)
    if identity and resume and _dob_from_fields(identity["fields"]) and _dob_from_fields(resume["fields"]):
        compared_pairs += 1
    if resume and transcript:
        if _institute_from_fields(resume["fields"], "resume") and _institute_from_fields(
            transcript["fields"], "academic_transcript"
        ):
            compared_pairs += 1
        if _degree_from_fields(resume["fields"], "resume") and _degree_from_fields(
            transcript["fields"], "academic_transcript"
        ):
            compared_pairs += 1

    if compared_pairs == 0:
        matching_confidence = 1.0
        verification_status = "pending"
        summary = None
    elif not mismatches:
        matching_confidence = 1.0
        verification_status = "verified"
        summary = None
    else:
        matching_confidence = round(max(0.0, 1.0 - (len(mismatches) / compared_pairs)), 4)
        verification_status = "mismatch"
        summary = "Some uploaded documents contain inconsistent information. Please review."

    return {
        "verification_status": verification_status,
        "matching_confidence": matching_confidence,
        "mismatches": mismatches,
        "summary": summary,
        "documents_compared": list(by_cat.keys()),
    }

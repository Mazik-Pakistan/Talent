"""Parse recruiter roster spreadsheets (.xlsx / .csv) into row dicts."""

from __future__ import annotations

import csv
import io
from datetime import date, datetime
from typing import Any

from fastapi import HTTPException, UploadFile

BULK_INVITE_MAX_ROWS = 200
BULK_INVITE_MAX_BYTES = 5 * 1024 * 1024

# Canonical column → accepted header aliases (lowercased).
COLUMN_ALIASES: dict[str, tuple[str, ...]] = {
    "email": ("email", "email address", "candidate email"),
    "full_name": ("full_name", "name", "candidate name", "full name"),
    "job_title": ("job_title", "designation", "title", "job title", "position"),
    "department": ("department", "dept"),
    "reporting_manager": ("reporting_manager", "manager", "reporting manager", "manager name"),
    "start_date": ("start_date", "start date", "joining date", "join date"),
    "monthly_salary": ("monthly_salary", "salary", "monthly salary", "gross salary", "ctc"),
    "office_location": ("office_location", "office", "location", "office location"),
    "employment_type": ("employment_type", "employment type", "type"),
    "currency": ("currency", "curr"),
    "expires_in_days": ("expires_in_days", "expires", "expiry days", "invite expiry days"),
    "offer_expiry_days": ("offer_expiry_days", "offer expiry", "offer expiry days"),
    "message_to_candidate": ("message_to_candidate", "message", "candidate message", "note"),
    "benefits": ("benefits", "benefit list"),
}

REQUIRED_COLUMNS = (
    "email",
    "full_name",
    "job_title",
    "department",
    "reporting_manager",
    "start_date",
    "monthly_salary",
)

TEMPLATE_HEADERS = [
    "email",
    "full_name",
    "job_title",
    "department",
    "reporting_manager",
    "start_date",
    "monthly_salary",
    "office_location",
    "employment_type",
    "currency",
    "expires_in_days",
    "offer_expiry_days",
    "message_to_candidate",
    "benefits",
]

TEMPLATE_SAMPLE_ROW = [
    "jane.doe@example.com",
    "Jane Doe",
    "Software Engineer",
    "Engineering",
    "Alex Manager",
    "2026-09-01",
    "150000",
    "Karachi",
    "Full-time",
    "PKR",
    "7",
    "14",
    "Welcome to the team!",
    "Medical insurance, Provident fund, Annual leave",
]


def _cell_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _normalize_start_date(raw: str) -> str:
    text = (raw or "").strip()
    if not text:
        return ""
    # Excel sometimes yields "2026-09-01 00:00:00"
    if " " in text:
        text = text.split(" ", 1)[0]
    if "T" in text:
        text = text.split("T", 1)[0]
    # DD/MM/YYYY or DD-MM-YYYY
    for sep in ("/", "-"):
        parts = text.split(sep)
        if len(parts) == 3 and len(parts[0]) <= 2 and len(parts[2]) == 4:
            try:
                day, month, year = int(parts[0]), int(parts[1]), int(parts[2])
                if day > 31:
                    # already YYYY-MM-DD style with sep -
                    return text if sep == "-" and len(parts[0]) == 4 else text
                if day <= 31 and month <= 12:
                    return f"{year:04d}-{month:02d}-{day:02d}"
            except ValueError:
                pass
    return text


def _parse_salary(raw: str) -> float | None:
    text = (raw or "").strip().replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


async def read_upload_rows(file: UploadFile) -> tuple[list[str], list[tuple[int, list[Any]]]]:
    """Return (header, [(sheet_row_number, cells), ...])."""
    filename = (file.filename or "").lower()
    is_csv = filename.endswith(".csv")
    is_xlsx = filename.endswith(".xlsx") or filename.endswith(".xlsm")
    if not (is_csv or is_xlsx):
        raise HTTPException(status_code=400, detail="Please upload a .xlsx or .csv spreadsheet.")

    raw = await file.read()
    if len(raw) > BULK_INVITE_MAX_BYTES:
        raise HTTPException(status_code=400, detail="File is too large (5MB limit).")

    try:
        if is_csv:
            text = raw.decode("utf-8-sig", errors="replace")
            reader = csv.reader(io.StringIO(text))
            rows = list(reader)
            if not rows:
                raise HTTPException(status_code=400, detail="The CSV file is empty.")
            header = [str(h).strip().lower() if h else "" for h in rows[0]]
            data = [(i, list(row)) for i, row in enumerate(rows[1:], start=2)]
            return header, data

        from openpyxl import load_workbook

        workbook = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
        sheet = workbook.active
        rows_iter = sheet.iter_rows(values_only=True)
        first = next(rows_iter, None)
        if first is None:
            raise HTTPException(status_code=400, detail="The spreadsheet is empty.")
        header = [str(h).strip().lower() if h else "" for h in first]
        data = [(i, list(row)) for i, row in enumerate(rows_iter, start=2)]
        return header, data
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Could not read the spreadsheet: {exc}") from exc


def resolve_column_indexes(header: list[str]) -> dict[str, int | None]:
    indexes: dict[str, int | None] = {}
    for canonical, aliases in COLUMN_ALIASES.items():
        indexes[canonical] = None
        for alias in aliases:
            if alias in header:
                indexes[canonical] = header.index(alias)
                break
    return indexes


def missing_required_headers(indexes: dict[str, int | None]) -> list[str]:
    missing = []
    for col in REQUIRED_COLUMNS:
        if indexes.get(col) is None:
            if col == "full_name":
                missing.append("full_name (or name)")
            elif col == "job_title":
                missing.append("job_title (or designation)")
            elif col == "reporting_manager":
                missing.append("reporting_manager (or manager)")
            elif col == "monthly_salary":
                missing.append("monthly_salary (or salary)")
            else:
                missing.append(col)
    return missing


def row_to_candidate(row: list[Any], indexes: dict[str, int | None], sheet_row: int) -> dict:
    def get(key: str) -> str:
        idx = indexes.get(key)
        if idx is None or idx >= len(row):
            return ""
        return _cell_str(row[idx])

    email = get("email").lower()
    full_name = get("full_name")
    job_title = get("job_title")
    department = get("department")
    reporting_manager = get("reporting_manager")
    start_date = _normalize_start_date(get("start_date"))
    salary_raw = get("monthly_salary")
    monthly_salary = _parse_salary(salary_raw)

    missing_fields: list[str] = []
    for label, value in (
        ("email", email),
        ("full_name", full_name),
        ("job_title", job_title),
        ("department", department),
        ("reporting_manager", reporting_manager),
        ("start_date", start_date),
    ):
        if not value or (label != "email" and len(value) < 2):
            missing_fields.append(label)
    if monthly_salary is None or monthly_salary < 0:
        missing_fields.append("monthly_salary")
    if email and "@" not in email:
        missing_fields.append("email (invalid)")

    expires_raw = get("expires_in_days")
    offer_exp_raw = get("offer_expiry_days")
    benefits_raw = get("benefits")
    benefits = [b.strip() for b in benefits_raw.split(",") if b.strip()] if benefits_raw else []

    return {
        "row": sheet_row,
        "email": email or None,
        "full_name": full_name or None,
        "job_title": job_title or None,
        "department": department or None,
        "reporting_manager": reporting_manager or None,
        "start_date": start_date or None,
        "monthly_salary": monthly_salary,
        "office_location": get("office_location") or None,
        "employment_type": get("employment_type") or "Full-time",
        "currency": (get("currency") or "PKR").upper(),
        "expires_in_days": int(expires_raw) if expires_raw.isdigit() else 7,
        "offer_expiry_days": int(offer_exp_raw) if offer_exp_raw.isdigit() else 14,
        "message_to_candidate": get("message_to_candidate") or None,
        "benefits": benefits,
        "missing_fields": missing_fields,
        "valid": not missing_fields,
    }


def build_xlsx_template_bytes() -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "Bulk invites"
    ws.append(TEMPLATE_HEADERS)
    ws.append(TEMPLATE_SAMPLE_ROW)
    # Instructions sheet
    info = wb.create_sheet("Instructions", 0)
    info.append(["Bulk invite & offer — column guide"])
    info.append([])
    info.append(["Required columns", "Notes"])
    for col in REQUIRED_COLUMNS:
        info.append([col, "Required for every row"])
    info.append([])
    info.append(["Optional columns", "Notes"])
    for col in TEMPLATE_HEADERS:
        if col not in REQUIRED_COLUMNS:
            info.append([col, "Optional"])
    info.append([])
    info.append(["benefits", "Comma-separated labels; defaults applied when blank"])
    info.append(["start_date", "Use YYYY-MM-DD (e.g. 2026-09-01)"])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()

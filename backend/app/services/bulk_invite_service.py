"""Bulk invite + offer from spreadsheet rows (same flow as single invite)."""

from __future__ import annotations

from fastapi import HTTPException, UploadFile
from pydantic import ValidationError

from app.core.rbac import CurrentUser
from app.schemas.date_utils import parse_natural_date
from app.schemas.invitation import CreateInvitationRequest
from app.schemas.offer import DEFAULT_BENEFITS, DEFAULT_OFFER_TERMS, OfferTermsPayload
from app.services.invitation_service import InvitationService
from app.services.people_history import lookup_history_by_email
from app.services.spreadsheet_roster import (
    BULK_INVITE_MAX_ROWS,
    missing_required_headers,
    read_upload_rows,
    resolve_benefit_columns,
    resolve_column_indexes,
    resolve_pay_columns,
    row_to_candidate,
)

invitation_service = InvitationService()


def _slug(label: str) -> str:
    return "".join(ch if ch.isalnum() else "-" for ch in (label or "").lower()).strip("-")


def _benefit_items(row: dict) -> list[dict]:
    """Build offer benefit list from checkbox columns, comma list, or defaults."""
    mode = row.get("benefits_mode") or "default"
    flags = row.get("benefit_flags") or {}
    labels = row.get("benefits")

    if mode == "checkboxes":
        # Include every known benefit with selected from Yes/No; keep any custom Yes labels too.
        items = []
        seen = set()
        for label in DEFAULT_BENEFITS:
            selected = bool(flags.get(label, False))
            items.append({"id": _slug(label), "label": label, "selected": selected})
            seen.add(label.lower())
        for label, selected in flags.items():
            if label.lower() in seen:
                continue
            cleaned = " ".join(str(label).split())
            if cleaned:
                items.append({"id": _slug(cleaned), "label": cleaned, "selected": bool(selected)})
        # If somehow nothing selected, fall back to defaults on so the offer is not empty.
        if not any(i["selected"] for i in items):
            for item in items:
                item["selected"] = True
        return items

    source = labels if labels else list(DEFAULT_BENEFITS)
    items = []
    for label in source:
        cleaned = " ".join(str(label).split())
        if not cleaned:
            continue
        items.append({"id": _slug(cleaned) or f"benefit-{len(items)}", "label": cleaned, "selected": True})
    return items


def candidate_row_to_request(row: dict) -> CreateInvitationRequest:
    """Build a validated CreateInvitationRequest from a parsed roster row."""
    start_raw = str(row.get("start_date") or "").strip()
    start_date = parse_natural_date(start_raw) if start_raw else None

    offer = OfferTermsPayload(
        job_title=row["job_title"],
        department=row["department"],
        employment_type=row.get("employment_type") or "Full-time",
        office_location=row.get("office_location"),
        is_remote=bool(row.get("is_remote")),
        reporting_manager=row["reporting_manager"],
        start_date=(start_date.isoformat() if start_date else start_raw),
        monthly_salary=float(row["monthly_salary"]),
        currency=(row.get("currency") or "PKR").upper(),
        salary_breakdown=row.get("salary_breakdown") or [],
        benefits=_benefit_items(row),
        offer_expiry_days=int(row["offer_expiry_days"]) if str(row.get("offer_expiry_days") or "").strip().isdigit() else None,
        terms=(row.get("terms") or "").strip() or DEFAULT_OFFER_TERMS,
        message_to_candidate=row.get("message_to_candidate"),
    )
    return CreateInvitationRequest(
        email=row["email"],
        full_name=row["full_name"],
        job_title=row["job_title"],
        department=row["department"],
        office_location=row.get("office_location"),
        is_remote=bool(row.get("is_remote")),
        start_date=start_date,
        expires_in_days=2,
        offer=offer,
    )


class BulkInviteService:
    async def parse_file(self, file: UploadFile) -> dict:
        header, data_rows = await read_upload_rows(file)
        indexes = resolve_column_indexes(header)
        missing = missing_required_headers(indexes)
        if missing:
            return {
                "ok": False,
                "filename": file.filename,
                "missing_headers": missing,
                "found_headers": [h for h in header if h],
                "rows": [],
                "summary": {
                    "total": 0,
                    "valid": 0,
                    "invalid": 0,
                    "blocked": 0,
                    "rehire_suggested": 0,
                },
                "message": (
                    "Spreadsheet is missing required columns: "
                    + ", ".join(missing)
                    + ". Download the template and try again."
                ),
            }

        rows: list[dict] = []
        benefit_columns = resolve_benefit_columns(header)
        pay_columns = resolve_pay_columns(header)
        for sheet_row, cells in data_rows:
            if not cells or all(c is None or str(c).strip() == "" for c in cells):
                continue
            parsed = row_to_candidate(
                cells,
                indexes,
                sheet_row,
                benefit_columns=benefit_columns,
                pay_columns=pay_columns,
            )
            if not parsed.get("email") and not parsed.get("full_name"):
                continue
            rows.append(parsed)
            if len(rows) >= BULK_INVITE_MAX_ROWS:
                break

        return {
            "ok": True,
            "filename": file.filename,
            "missing_headers": [],
            "found_headers": [h for h in header if h],
            "benefit_columns": [label for label, _ in benefit_columns],
            "pay_columns": [label for label, _ in pay_columns],
            "rows": rows,
            "summary": {
                "total": len(rows),
                "valid": sum(1 for r in rows if r.get("valid")),
                "invalid": sum(1 for r in rows if not r.get("valid")),
                "blocked": 0,
                "rehire_suggested": 0,
            },
            "message": f"Parsed {len(rows)} row(s) from {file.filename}.",
            "truncated": len(data_rows) > BULK_INVITE_MAX_ROWS,
        }

    async def preview(self, file: UploadFile, current_user: CurrentUser) -> dict:
        parsed = await self.parse_file(file)
        if not parsed.get("ok"):
            return parsed

        enriched: list[dict] = []
        blocked = 0
        rehire = 0
        for row in parsed["rows"]:
            item = {**row, "selected": bool(row.get("valid")), "can_send": False, "block_reason": None}
            if not row.get("valid"):
                item["block_reason"] = "Missing required fields: " + ", ".join(row.get("missing_fields") or [])
                item["person_history"] = None
                enriched.append(item)
                continue

            history = await lookup_history_by_email(
                row["email"],
                organization_id=None if current_user.role == "super_admin" else current_user.organization_id,
                recruiter_id=None if current_user.role == "super_admin" else current_user.id,
                is_super_admin=current_user.role == "super_admin",
            )
            item["person_history"] = {
                "suggestion_summary": history.get("suggestion_summary"),
                "can_reinvite": history.get("can_reinvite"),
                "active_conflict": history.get("active_conflict"),
                "matches": history.get("matches") or [],
                "employee_matches": history.get("employee_matches") or [],
                "converted_matches": history.get("converted_matches") or [],
                "candidate_matches": history.get("candidate_matches") or [],
            }
            conflict = history.get("active_conflict")
            if conflict:
                item["can_send"] = False
                item["selected"] = False
                item["block_reason"] = conflict.get("message") or "Active conflict for this email."
                blocked += 1
            else:
                item["can_send"] = True
                if history.get("matches"):
                    rehire += 1
            enriched.append(item)

        valid = sum(1 for r in enriched if r.get("can_send"))
        return {
            **parsed,
            "rows": enriched,
            "summary": {
                "total": len(enriched),
                "valid": valid,
                "invalid": sum(1 for r in enriched if not r.get("valid")),
                "blocked": blocked,
                "rehire_suggested": rehire,
            },
            "message": (
                f"Reviewed {len(enriched)} row(s): {valid} ready to invite, "
                f"{blocked} blocked by active conflict, "
                f"{sum(1 for r in enriched if not r.get('valid'))} incomplete."
            ),
        }

    async def send_rows(self, current_user: CurrentUser, candidates: list[dict]) -> dict:
        if not candidates:
            raise HTTPException(status_code=400, detail="No candidates provided.")
        if len(candidates) > BULK_INVITE_MAX_ROWS:
            raise HTTPException(
                status_code=400,
                detail=f"Bulk invite is limited to {BULK_INVITE_MAX_ROWS} rows per request.",
            )

        sent: list[dict] = []
        failed: list[dict] = []
        skipped: list[dict] = []

        for raw in candidates:
            email = (raw.get("email") or "").strip().lower()
            if raw.get("selected") is False:
                skipped.append({"email": email or None, "reason": "Deselected by recruiter"})
                continue
            if not raw.get("valid", True) and raw.get("missing_fields"):
                failed.append(
                    {
                        "email": email or None,
                        "row": raw.get("row"),
                        "error": "Missing fields: " + ", ".join(raw["missing_fields"]),
                    }
                )
                continue
            try:
                payload = candidate_row_to_request(raw)
            except (ValidationError, KeyError, TypeError, ValueError) as exc:
                failed.append({"email": email or None, "row": raw.get("row"), "error": str(exc)})
                continue

            try:
                result = await invitation_service.create_invitation(payload, current_user)
                sent.append(
                    {
                        "email": payload.email,
                        "full_name": payload.full_name,
                        "email_sent": result.get("email_sent", False),
                        "invite_link": (result.get("invitation") or {}).get("invite_link"),
                        "reinvite_from_history": result.get("reinvite_from_history", False),
                        "person_history_summary": (result.get("person_history") or {}).get("suggestion_summary"),
                    }
                )
            except HTTPException as exc:
                failed.append({"email": email or payload.email, "row": raw.get("row"), "error": str(exc.detail)})
            except Exception as exc:  # noqa: BLE001
                failed.append({"email": email or None, "row": raw.get("row"), "error": str(exc)})

        return {
            "message": (
                f"Bulk invite finished — sent {len(sent)}, failed {len(failed)}"
                + (f", skipped {len(skipped)}" if skipped else "")
                + "."
            ),
            "sent": sent,
            "failed": failed,
            "skipped": skipped,
            "summary": {
                "sent": len(sent),
                "failed": len(failed),
                "skipped": len(skipped),
            },
        }


bulk_invite_service = BulkInviteService()

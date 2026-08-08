"""Organization-scoped email template service.

Recruiters can customize email subject and body (HTML content) per template key.
Every collection is keyed by organization_id so data never leaks across tenants.
When no override exists, the email_service defaults apply unchanged.
"""

from __future__ import annotations

import re
import time
from datetime import UTC, datetime
from html import escape
from typing import Any

import pymongo as _pj

from app.core.config import settings as _settings
from app.core.database import database

# ─── Template Registry ──────────────────────────────────────────────────────
# Each key maps to: display metadata + allowed variable placeholders.
# default_subject/default_body are the editable baseline shown in the UI.

EMAIL_TEMPLATES: dict[str, dict[str, Any]] = {
    "candidate_invitation": {
        "name": "Candidate Invitation",
        "description": "Sent when a recruiter invites a candidate to register on TalentAI.",
        "category": "Recruitment",
        "variables": [
            {"name": "full_name", "label": "Candidate name"},
            {"name": "job_title", "label": "Job title"},
            {"name": "department", "label": "Department"},
            {"name": "invite_link", "label": "Registration link"},
            {"name": "expires_at", "label": "Expiry date"},
            {"name": "company_name", "label": "Company name"},
        ],
        "default_subject": "You've Been Invited to Join TalentAI",
        "default_body": (
            "<p>You have been invited to join <strong>{{company_name}}</strong> "
            "as a candidate for the position of <strong>{{job_title}}</strong> "
            "in the <strong>{{department}}</strong> department.</p>"
            "<p>Click the button below to complete your registration. "
            "This invitation expires on <strong>{{expires_at}}</strong>.</p>"
        ),
    },
    "offer_invitation": {
        "name": "Offer Invitation",
        "description": "Sent with salary details when inviting a candidate to an offer.",
        "category": "Recruitment",
        "variables": [
            {"name": "full_name", "label": "Candidate name"},
            {"name": "job_title", "label": "Job title"},
            {"name": "department", "label": "Department"},
            {"name": "start_date", "label": "Start date"},
            {"name": "currency", "label": "Currency"},
            {"name": "salary", "label": "Monthly salary"},
            {"name": "invite_link", "label": "Offer link"},
            {"name": "expires_at", "label": "Expiry date"},
            {"name": "company_name", "label": "Company name"},
        ],
        "default_subject": "Your Invitation to Join TalentAI",
        "default_body": (
            "<p>You have been invited to join <strong>{{company_name}}</strong> as a candidate for the position of "
            "<strong>{{job_title}}</strong> in the <strong>{{department}}</strong> department.</p>"
            "<p>Your offer includes <strong>{{currency}} {{salary}}</strong> per month, "
            "with a start date of <strong>{{start_date}}</strong>.</p>"
            "<p>Click the button below to review the offer. This invitation expires on <strong>{{expires_at}}</strong>.</p>"
        ),
    },
    "employee_welcome": {
        "name": "Employee Welcome",
        "description": "Welcome email sent when a candidate becomes an employee.",
        "category": "Onboarding",
        "variables": [
            {"name": "full_name", "label": "Employee name"},
            {"name": "employee_id", "label": "Employee ID"},
            {"name": "job_title", "label": "Job title"},
            {"name": "department", "label": "Department"},
            {"name": "company_name", "label": "Company name"},
        ],
        "default_subject": "Congratulations — Welcome to TalentAI",
        "default_body": (
            "<p>Your onboarding has been approved and you are now an official employee at {{company_name}}.</p>"
            "<p>Sign in to TalentAI and choose the Employee role to open your employee dashboard. "
            "Please complete your post-hire profile so HR can finish your onboarding.</p>"
        ),
    },
    "offer_letter": {
        "name": "Offer Letter",
        "description": "Notifies candidate an offer letter is ready for review and signing.",
        "category": "Offers",
        "variables": [
            {"name": "full_name", "label": "Candidate name"},
            {"name": "job_title", "label": "Job title"},
            {"name": "department", "label": "Department"},
            {"name": "start_date", "label": "Start date"},
            {"name": "company_name", "label": "Company name"},
        ],
        "default_subject": "Your Offer Letter — TalentAI",
        "default_body": (
            "<p>We're delighted to offer you the position below. Sign in to review "
            "the full terms and digitally sign your offer letter.</p>"
            "<p><strong>{{job_title}}</strong> · {{department}} · Starting {{start_date}}</p>"
        ),
    },
    "offer_validity_extended": {
        "name": "Offer Validity Extended",
        "description": "Notifies candidate that an expired offer was reopened.",
        "category": "Offers",
        "variables": [
            {"name": "full_name", "label": "Candidate name"},
            {"name": "job_title", "label": "Job title"},
            {"name": "recruiter_name", "label": "Recruiter name"},
            {"name": "days_label", "label": "Extension period"},
            {"name": "new_expires_at", "label": "New deadline"},
            {"name": "note", "label": "Recruiter note"},
            {"name": "company_name", "label": "Company name"},
        ],
        "default_subject": "Your offer letter was extended",
        "default_body": (
            "<p>{{recruiter_name}} extended the validity of your offer for <strong>{{job_title}}</strong> "
            "by <strong>{{days_label}}</strong>.</p>"
            "<p>Your updated response deadline is <strong>{{new_expires_at}}</strong>. "
            "Review the letter and sign before then.</p>"
        ),
    },
    "offer_clarification_request": {
        "name": "Offer Clarification (to Recruiter)",
        "description": "Alerts recruiter a candidate asked a question about their offer.",
        "category": "Offers",
        "variables": [
            {"name": "recruiter_name", "label": "Recruiter name"},
            {"name": "candidate_name", "label": "Candidate name"},
            {"name": "job_title", "label": "Job title"},
            {"name": "note", "label": "Candidate question"},
            {"name": "company_name", "label": "Company name"},
        ],
        "default_subject": "Offer clarification — TalentAI",
        "default_body": (
            "<p>Hi {{recruiter_name}}, <strong>{{candidate_name}}</strong> requested clarification "
            "on the offer for <strong>{{job_title}}</strong>.</p>"
            "<p>Open the candidate pipeline to reply, or edit and resend an updated offer letter.</p>"
        ),
    },
    "offer_clarification_result": {
        "name": "Offer Clarification Response (to Candidate)",
        "description": "Sends the recruiter's clarification response back to the candidate.",
        "category": "Offers",
        "variables": [
            {"name": "full_name", "label": "Candidate name"},
            {"name": "job_title", "label": "Job title"},
            {"name": "headline", "label": "Response headline"},
            {"name": "recruiter_note", "label": "Recruiter note"},
            {"name": "company_name", "label": "Company name"},
        ],
        "default_subject": "Offer clarification — TalentAI",
        "default_body": (
            "<p>Hi {{full_name}}, {{headline}} for <strong>{{job_title}}</strong>.</p>"
            "<p>Sign in and open My Offer Letter to continue.</p>"
        ),
    },
    "it_service_request": {
        "name": "IT Service Request",
        "description": "Notifies IT manager of a new employee IT support request.",
        "category": "IT",
        "variables": [
            {"name": "recruiter_name", "label": "Requester name"},
            {"name": "employee_name", "label": "Employee name"},
            {"name": "employee_email", "label": "Employee email"},
            {"name": "job_title", "label": "Employee role"},
            {"name": "department", "label": "Employee department"},
            {"name": "request_type", "label": "Request type"},
            {"name": "title", "label": "Request title"},
            {"name": "description", "label": "Description"},
            {"name": "note", "label": "HR note"},
            {"name": "fulfill_link", "label": "Fulfill link"},
            {"name": "company_name", "label": "Company name"},
        ],
        "default_subject": "IT service request — TalentAI",
        "default_body": (
            "<p><strong>{{recruiter_name}}</strong> needs IT help for an existing employee.</p>"
            "<p>Request: <strong>{{title}}</strong><br/>Employee: {{employee_name}} "
            "({{employee_email}}) · Role: {{job_title}} · {{department}}</p>"
            "<p>Click to mark the request as fulfilled.</p>"
        ),
    },
    "document_reupload_request": {
        "name": "Document Re-upload Request",
        "description": "Asks a candidate/employee to re-upload a specific document.",
        "category": "Documents",
        "variables": [
            {"name": "full_name", "label": "Recipient name"},
            {"name": "document_label", "label": "Document name"},
            {"name": "reason", "label": "Reason"},
            {"name": "note", "label": "Recruiter note"},
            {"name": "company_name", "label": "Company name"},
        ],
        "default_subject": "Action required: Re-upload your document — TalentAI",
        "default_body": (
            "<p>Your recruiter has requested a new copy of your <strong>{{document_label}}</strong>. "
            "Only this document needs to be replaced.</p>"
            "<p>Reason: {{reason}}</p>"
        ),
    },
    "document_status_update": {
        "name": "Document Verification Update",
        "description": "Notifies candidate/employee their document was verified.",
        "category": "Documents",
        "variables": [
            {"name": "full_name", "label": "Recipient name"},
            {"name": "document_label", "label": "Document name"},
            {"name": "status_label", "label": "Verification status"},
            {"name": "note", "label": "Note"},
            {"name": "company_name", "label": "Company name"},
        ],
        "default_subject": "Document update — TalentAI",
        "default_body": (
            "<p>Hello {{full_name}}, your <strong>{{document_label}}</strong> was marked "
            "<strong>{{status_label}}</strong>.</p>"
            "<p>Sign in to open your documents page.</p>"
        ),
    },
    "it_provisioning_request": {
        "name": "IT Provisioning Request",
        "description": "Requests IT to set up email, assets, and licenses for a new hire.",
        "category": "IT",
        "variables": [
            {"name": "recruiter_name", "label": "Recruiter name"},
            {"name": "name", "label": "New hire name"},
            {"name": "job_title", "label": "Job title"},
            {"name": "department", "label": "Department"},
            {"name": "start_date", "label": "Start date"},
            {"name": "personal_email", "label": "Personal email"},
            {"name": "note", "label": "Recruiter note"},
            {"name": "expires_at", "label": "Link expiry"},
            {"name": "company_name", "label": "Company name"},
        ],
        "default_subject": "IT provisioning requested — TalentAI",
        "default_body": (
            "<p>Hi, <strong>{{recruiter_name}}</strong> requested IT provisioning for "
            "<strong>{{name}}</strong>.</p>"
            "<p>Role: {{job_title}} · {{department}}<br/>Start date: {{start_date}}<br/>"
            "Personal email: {{personal_email}}</p>"
            "<p>Open the form to assign a company email, password, assets, and licenses. "
            "This link expires on <strong>{{expires_at}}</strong>.</p>"
        ),
    },
    "it_provisioning_complete": {
        "name": "IT Provisioning Complete",
        "description": "Notifies recruiter that IT finished provisioning.",
        "category": "IT",
        "variables": [
            {"name": "employee_name", "label": "Employee name"},
            {"name": "company_email", "label": "Company email"},
            {"name": "company_name", "label": "Company name"},
        ],
        "default_subject": "IT provisioning complete — TalentAI",
        "default_body": (
            "<p>IT finished provisioning for <strong>{{employee_name}}</strong>. You can now approve "
            "and activate the employee from the candidate pipeline.</p>"
        ),
    },
    "it_provisioning_edited": {
        "name": "IT Provisioning Updated",
        "description": "Notifies recruiter that IT updated the provisioning details.",
        "category": "IT",
        "variables": [
            {"name": "employee_name", "label": "Employee name"},
            {"name": "company_email", "label": "Company email"},
            {"name": "company_name", "label": "Company name"},
        ],
        "default_subject": "IT provisioning updated — TalentAI",
        "default_body": (
            "<p>IT updated the provisioning for <strong>{{employee_name}}</strong>. The latest details "
            "below are what will be used when you activate the employee.</p>"
        ),
    },
    "first_time_password": {
        "name": "First-time Password",
        "description": "Shares the temporary password with a new employee.",
        "category": "Onboarding",
        "variables": [
            {"name": "full_name", "label": "Employee name"},
            {"name": "temp_password", "label": "Temporary password"},
            {"name": "company_name", "label": "Company name"},
        ],
        "default_subject": "Your employee account is ready — TalentAI",
        "default_body": (
            "<p>Hello {{full_name}}, your employee account is ready.</p>"
            "<p>Sign in with your personal or company email using this one-time password:</p>"
            "<p><strong>{{temp_password}}</strong></p>"
            "<p>After signing in you will be asked to create your own password.</p>"
        ),
    },
    "banking_details_notice": {
        "name": "Banking Details Notice",
        "description": "Confirms payroll banking details were recorded.",
        "category": "HR",
        "variables": [
            {"name": "full_name", "label": "Employee name"},
            {"name": "bank_name", "label": "Bank name"},
            {"name": "account_holder_name", "label": "Account holder"},
            {"name": "masked_iban", "label": "Masked IBAN"},
            {"name": "company_name", "label": "Company name"},
        ],
        "default_subject": "Banking details updated — TalentAI",
        "default_body": (
            "<p>Hi {{full_name}}, your recruiter added or updated your payroll banking details. "
            "You can review them on your employee profile.</p>"
        ),
    },
    "company_email_assigned": {
        "name": "Company Email Assigned",
        "description": "Notifies employee their company email was recorded.",
        "category": "Onboarding",
        "variables": [
            {"name": "full_name", "label": "Employee name"},
            {"name": "company_email", "label": "Company email"},
            {"name": "company_name", "label": "Company name"},
        ],
        "default_subject": "Your company email has been assigned — TalentAI",
        "default_body": (
            "<p>Hello {{full_name}}, your recruiter has recorded your official company email. "
            "Please use this address for workplace communications going forward.</p>"
            "<p>Company email: <strong>{{company_email}}</strong></p>"
        ),
    },
    "asset_assigned": {
        "name": "Asset Assigned",
        "description": "Notifies employee a company asset was assigned to them.",
        "category": "Onboarding",
        "variables": [
            {"name": "full_name", "label": "Employee name"},
            {"name": "asset_name", "label": "Asset name"},
            {"name": "asset_type", "label": "Asset type"},
            {"name": "serial_number", "label": "Serial number"},
            {"name": "company_name", "label": "Company name"},
        ],
        "default_subject": "Asset assigned — TalentAI",
        "default_body": (
            "<p>Hello {{full_name}}, a company asset has been assigned to you. "
            "Please keep it safe and report any issues to HR.</p>"
            "<p><strong>{{asset_name}}</strong> · {{asset_type}}</p>"
        ),
    },
    "orientation_scheduled": {
        "name": "Orientation Scheduled",
        "description": "Notifies employee about their upcoming orientation session.",
        "category": "Onboarding",
        "variables": [
            {"name": "full_name", "label": "Employee name"},
            {"name": "date", "label": "Session date"},
            {"name": "time", "label": "Session time"},
            {"name": "trainer", "label": "Trainer name"},
            {"name": "agenda", "label": "Agenda"},
            {"name": "meeting_link", "label": "Meeting link"},
            {"name": "company_name", "label": "Company name"},
        ],
        "default_subject": "Your orientation session is scheduled — TalentAI",
        "default_body": (
            "<p>Hello {{full_name}}, your orientation session has been scheduled.</p>"
            "<p>Date: <strong>{{date}}</strong> · Time: <strong>{{time}}</strong> "
            "· Trainer: <strong>{{trainer}}</strong></p>"
            "<p>Agenda: {{agenda}}</p>"
        ),
    },
    "profile_completion_reminder": {
        "name": "Profile Completion Reminder",
        "description": "Reminds an employee to complete their post-hire profile.",
        "category": "Reminders",
        "variables": [
            {"name": "full_name", "label": "Employee name"},
            {"name": "employee_id", "label": "Employee ID"},
            {"name": "missing_items", "label": "Missing items list"},
            {"name": "recruiter_note", "label": "Recruiter note"},
            {"name": "company_name", "label": "Company name"},
        ],
        "default_subject": "Complete your profile — TalentAI",
        "default_body": (
            "<p>Hello {{full_name}}, please complete the remaining steps in your employee profile. "
            "HR needs this information to finalize your onboarding.</p>"
            "<p>Items remaining: {{missing_items}}</p>"
        ),
    },
    "candidate_onboarding_reminder": {
        "name": "Candidate Onboarding Reminder",
        "description": "Reminds a candidate to complete their onboarding steps.",
        "category": "Reminders",
        "variables": [
            {"name": "full_name", "label": "Candidate name"},
            {"name": "missing_items", "label": "Missing items list"},
            {"name": "recruiter_note", "label": "Recruiter note"},
            {"name": "company_name", "label": "Company name"},
        ],
        "default_subject": "Reminder: Complete your onboarding — TalentAI",
        "default_body": (
            "<p>Hello {{full_name}}, please complete the remaining steps in your onboarding "
            "so your recruiter can proceed with your hiring process.</p>"
        ),
    },
    "announcement": {
        "name": "Announcement",
        "description": "Organization-wide announcements to employees/candidates.",
        "category": "Communications",
        "variables": [
            {"name": "full_name", "label": "Recipient name"},
            {"name": "title", "label": "Announcement title"},
            {"name": "body_text", "label": "Announcement body"},
            {"name": "company_name", "label": "Company name"},
        ],
        "default_subject": "Announcement — TalentAI",
        "default_body": (
            "<p>Hi {{full_name}}, you have a new announcement.</p>"
            "<p><strong>{{title}}</strong></p>"
            "<p>{{body_text}}</p>"
        ),
    },
    "custom_reminder": {
        "name": "Custom Reminder",
        "description": "Personalized reminder sent by recruiter to an employee/candidate.",
        "category": "Reminders",
        "variables": [
            {"name": "full_name", "label": "Recipient name"},
            {"name": "title", "label": "Reminder title"},
            {"name": "body_text", "label": "Reminder body"},
            {"name": "cta_label", "label": "Button label"},
            {"name": "recruiter_note", "label": "Recruiter note"},
            {"name": "company_name", "label": "Company name"},
        ],
        "default_subject": "Reminder — TalentAI",
        "default_body": (
            "<p>Hello {{full_name}}, {{title}}.</p>"
            "<p>{{body_text}}</p>"
        ),
    },
    "hr_message": {
        "name": "HR Message",
        "description": "Internal HR message notification to employee/candidate.",
        "category": "Communications",
        "variables": [
            {"name": "full_name", "label": "Recipient name"},
            {"name": "subject_line", "label": "Message subject"},
            {"name": "sender_label", "label": "Sender name"},
            {"name": "body_text", "label": "Message body"},
            {"name": "company_name", "label": "Company name"},
        ],
        "default_subject": "Message — TalentAI",
        "default_body": (
            "<p>Hello {{full_name}}, you have a new message from <strong>{{sender_label}}</strong>.</p>"
            "<p>{{body_text}}</p>"
        ),
    },
}

# Allowlist of all valid variable names across all templates
_ALL_VARIABLES: set[str] = set()
for _tpl in EMAIL_TEMPLATES.values():
    for _var in _tpl["variables"]:
        _ALL_VARIABLES.add(_var["name"])

PLACEHOLDER_RE = re.compile(r"\{\{\s*(\w+)\s*\}\}")


def list_variable_names(key: str) -> list[str]:
    tpl = EMAIL_TEMPLATES.get(key)
    if not tpl:
        return []
    return [v["name"] for v in tpl["variables"]]


def validate_placeholders(text: str, key: str) -> list[str]:
    """Return list of placeholder names used in text that aren't in the allowed set for this key."""
    allowed = set(list_variable_names(key))
    used = set(PLACEHOLDER_RE.findall(text))
    return sorted(used - allowed)


# ─── Template CRUD ──────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(UTC)


def _template_doc_id(organization_id: str, key: str) -> str:
    return f"{organization_id}:{key}"


async def get_org_override(organization_id: str, key: str) -> dict | None:
    return await database.org_email_templates.find_one(
        {"_id": _template_doc_id(organization_id, key), "organization_id": organization_id, "template_key": key},
    )


async def list_templates(organization_id: str) -> list[dict]:
    """Return all templates with org overrides merged. Reads are merged with defaults."""
    overrides = await database.org_email_templates.find(
        {"organization_id": organization_id}, {"_id": 0}
    ).to_list(length=100)
    override_map: dict[str, dict] = {o["template_key"]: o for o in overrides}

    result = []
    for key, meta in EMAIL_TEMPLATES.items():
        ov = override_map.get(key)
        result.append({
            "key": key,
            "name": meta["name"],
            "description": meta["description"],
            "category": meta["category"],
            "variables": meta["variables"],
            "subject": ov["subject"] if ov else meta["default_subject"],
            "body_html": ov["body_html"] if ov else meta["default_body"],
            "is_custom": ov is not None,
            "updated_at": ov["updated_at"].isoformat() if ov else None,
            "updated_by": ov.get("updated_by") if ov else None,
        })
    return result


async def get_template(organization_id: str, key: str) -> dict | None:
    meta = EMAIL_TEMPLATES.get(key)
    if not meta:
        return None
    ov = await get_org_override(organization_id, key)
    return {
        "key": key,
        "name": meta["name"],
        "description": meta["description"],
        "category": meta["category"],
        "variables": meta["variables"],
        "subject": ov["subject"] if ov else meta["default_subject"],
        "body_html": ov["body_html"] if ov else meta["default_body"],
        "is_custom": ov is not None,
        "updated_at": ov["updated_at"].isoformat() if ov else None,
    }


async def upsert_template(
    organization_id: str,
    key: str,
    subject: str,
    body_html: str,
    updated_by: str,
) -> dict:
    meta = EMAIL_TEMPLATES.get(key)
    if not meta:
        raise ValueError(f"Unknown template key: {key}")
    if not subject.strip():
        raise ValueError("Subject cannot be empty.")

    subject_errors = validate_placeholders(subject, key)
    body_errors = validate_placeholders(body_html, key)
    all_errors = subject_errors + body_errors
    if all_errors:
        raise ValueError(f"Unknown variables: {', '.join(all_errors)}. Allowed: {', '.join(list_variable_names(key))}")

    now = _now()
    doc_id = _template_doc_id(organization_id, key)
    await database.org_email_templates.update_one(
        {"_id": doc_id},
        {"$set": {
            "_id": doc_id,
            "organization_id": organization_id,
            "template_key": key,
            "subject": subject.strip(),
            "body_html": body_html.strip(),
            "updated_by": updated_by,
            "updated_at": now,
            "created_at": now,
        }},
        upsert=True,
    )
    invalidate_cache(organization_id)
    return await get_template(organization_id, key)


async def delete_template(organization_id: str, key: str) -> None:
    await database.org_email_templates.delete_one(
        {"_id": _template_doc_id(organization_id, key), "organization_id": organization_id}
    )
    invalidate_cache(organization_id)


# ─── Send-time Resolution (used by EmailService) ──────────────────────────

_CACHE: dict[tuple[str, str], tuple[dict, float]] = {}
_CACHE_TTL = 30


def _cache_key(organization_id: str, key: str) -> tuple[str, str]:
    return (organization_id, key)


def _get_cached(organization_id: str, key: str) -> dict | None | bool:
    """Return cached override dict, None (cached-miss), or True (no override cached)."""
    ck = _cache_key(organization_id, key)
    entry = _CACHE.get(ck)
    if not entry:
        return None
    doc, ts = entry
    if time.monotonic() - ts > _CACHE_TTL:
        _CACHE.pop(ck, None)
        return None
    return doc


def _set_cached(organization_id: str, key: str, doc: dict | None) -> None:
    _CACHE[_cache_key(organization_id, key)] = (doc, time.monotonic())


def invalidate_cache(organization_id: str | None = None) -> None:
    """Clear cache (optionally only for one org)."""
    if organization_id:
        keys_to_remove = [k for k in _CACHE if k[0] == organization_id]
        for k in keys_to_remove:
            _CACHE.pop(k, None)
    else:
        _CACHE.clear()


def render_template(text: str, context: dict) -> str:
    """Replace {{placeholder}} with escaped context values."""
    def replacer(match: re.Match) -> str:
        name = match.group(1)
        value = context.get(name)
        if value is None:
            return match.group(0)
        if isinstance(value, bool):
            value = "yes" if value else "no"
        return escape(str(value))
    return PLACEHOLDER_RE.sub(replacer, text)


def _sync_db():
    """Lazy-init a sync pymongo client for the resolution path (email send methods are sync)."""
    if not hasattr(_sync_db, "_client"):
        _sync_db._client = _pj.MongoClient(_settings.MONGODB_URI)
        _sync_db._coll = _sync_db._client[_settings.DATABASE_NAME]["org_email_templates"]
    return _sync_db._coll


def resolve_template(
    organization_id: str | None,
    key: str,
    default_subject: str,
    default_body: str,
    context: dict,
) -> tuple[str, str]:
    """Resolve subject+body for the given org. Returns (subject, body).

    If no org override exists, returns defaults unchanged (zero disturbance).
    If an override exists, its subject/body are rendered with context placeholders.

    This function is synchronous and uses pymongo (not Motor) because
    email_service.py send methods are sync and run inside background threads.
    """
    if not organization_id:
        return default_subject, default_body

    cached = _get_cached(organization_id, key)
    if cached is True:
        return default_subject, default_body
    if cached is not None:
        rendered_subject = render_template(cached.get("subject", default_subject), context)
        rendered_body = render_template(cached.get("body_html", default_body), context)
        return rendered_subject, rendered_body

    try:
        ov = _sync_db().find_one({
            "organization_id": organization_id,
            "template_key": key,
        })
    except Exception:
        return default_subject, default_body

    if not ov:
        _set_cached(organization_id, key, True)
        return default_subject, default_body

    _set_cached(organization_id, key, ov)
    rendered_subject = render_template(ov.get("subject", default_subject), context)
    rendered_body = render_template(ov.get("body_html", default_body), context)
    return rendered_subject, rendered_body

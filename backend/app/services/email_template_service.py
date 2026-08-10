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
            "<p style=\"margin:0 0 16px;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "You have been invited to join <strong>TalentAI</strong> as a candidate for the position of "
            "<strong>{{job_title}}</strong> in the <strong>{{department}}</strong> department.</p>"
            "<p style=\"margin:0 0 28px;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "Click the button below to complete your registration and begin onboarding. "
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
        "default_subject": "Your Invitation to Join Mazik Global",
        "default_body": (
            "<p style=\"margin:0 0 16px;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "You have been invited to join <strong>Mazik Global</strong> as a candidate for the position of "
            "<strong>{{job_title}}</strong> in the <strong>{{department}}</strong> department.</p>"
            "<p style=\"margin:0 0 12px;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "Your offer includes <strong>{{currency}} {{salary}}</strong> per month, "
            "with a start date of <strong>{{start_date}}</strong>.</p>"
            "<p style=\"margin:0 0 28px;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "Click the button below to review the offer and complete your registration. "
            "This invitation expires on <strong>{{expires_at}}</strong>.</p>"
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
            "<p style=\"margin:0 0 16px;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "Your onboarding has been approved and you are now an official employee "
            "at Mazik Global Pakistan.</p>"
            "<table cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" "
            "style=\"background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;margin:0 0 24px;\">"
            "<tr><td style=\"padding:24px;\">"
            "<p style=\"margin:0 0 6px;color:#6b7a8f;font-size:11px;font-weight:700;"
            "text-transform:uppercase;letter-spacing:1.2px;\">Your Employee ID</p>"
            "<p style=\"margin:0 0 12px;color:#0D5C91;font-size:32px;font-weight:700;"
            "letter-spacing:4px;line-height:1.1;\">{{employee_id}}</p>"
            "<p style=\"margin:0;color:#1a1a2e;font-size:14px;font-weight:600;\">"
            "{{job_title}}&ensp;&middot;&ensp;{{department}}</p>"
            "</td></tr></table>"
            "<p style=\"margin:0 0 12px;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "Sign in to TalentAI and choose the <strong>Employee</strong> role to open "
            "your employee dashboard.</p>"
            "<p style=\"margin:0;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "Please complete your post-hire profile (emergency contact, banking, "
            "references, policies, and Self Declaration) so HR can finish your onboarding.</p>"
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
        "default_subject": "Your Offer Letter for {{job_title}} — Mazik Global",
        "default_body": (
            "<p style=\"margin:0 0 16px;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "We&rsquo;re delighted to offer you the position below. Sign in to review "
            "the full terms and digitally sign your offer letter.</p>"
            "<table cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" "
            "style=\"background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;margin:0 0 24px;\">"
            "<tr><td style=\"padding:24px;\">"
            "<p style=\"margin:0 0 4px;color:#0D5C91;font-size:18px;font-weight:700;\">{{job_title}}</p>"
            "<p style=\"margin:0;color:#6b7a8f;font-size:14px;\">"
            "{{department}}&ensp;&middot;&ensp;Starting {{start_date}}</p>"
            "</td></tr></table>"
            "<p style=\"margin:0;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "Sign in to your candidate dashboard and open <strong>My Offer Letter</strong> "
            "to review and sign.</p>"
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
        "default_subject": "Your offer letter was extended — {{job_title}}",
        "default_body": (
            "<p style=\"margin:0 0 16px;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "{{recruiter_name}} extended the validity of your offer for "
            "<strong>{{job_title}}</strong> by <strong>{{days_label}}</strong>.</p>"
            "<p style=\"margin:0 0 20px;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "Your updated response deadline is <strong>{{new_expires_at}}</strong>. "
            "Review the letter and sign before then.</p>"
            "<p style=\"margin:0 0 20px;color:#1a1a2e;font-size:15px;line-height:1.7;"
            "background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;padding:16px 18px;\">"
            "<strong style=\"display:block;margin-bottom:6px;color:#0D5C91;\">"
            "Message from {{recruiter_name}}</strong>{{note}}</p>"
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
        "default_subject": "Offer clarification from {{candidate_name}} — Mazik Global",
        "default_body": (
            "<p style=\"margin:0 0 16px;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "Hi {{recruiter_name}}, <strong>{{candidate_name}}</strong> requested clarification on the offer "
            "for <strong>{{job_title}}</strong>.</p>"
            "<table cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" "
            "style=\"background:#fff8ef;border:1px solid #f3e0c2;border-radius:12px;margin:0 0 24px;\">"
            "<tr><td style=\"padding:18px 22px;\">"
            "<p style=\"margin:0 0 6px;color:#9a6700;font-size:11px;font-weight:700;"
            "text-transform:uppercase;letter-spacing:1.2px;\">Candidate question</p>"
            "<p style=\"margin:0;color:#1a1a2e;font-size:14px;line-height:1.6;\">{{note}}</p>"
            "</td></tr></table>"
            "<p style=\"margin:0;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "Open the candidate pipeline to reply, or edit and resend an updated offer letter.</p>"
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
        "default_subject": "{{headline}} — {{job_title}} | Mazik Global",
        "default_body": (
            "<p style=\"margin:0 0 16px;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "Hi {{full_name}}, Your recruiter responded to your clarification on "
            "<strong>{{job_title}}</strong>. Open your offer letter to continue.</p>"
            "<table cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" "
            "style=\"background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;margin:16px 0 24px;\">"
            "<tr><td style=\"padding:18px 22px;\">"
            "<p style=\"margin:0 0 6px;color:#0D5C91;font-size:11px;font-weight:700;"
            "text-transform:uppercase;letter-spacing:1.2px;\">Recruiter note</p>"
            "<p style=\"margin:0;color:#1a1a2e;font-size:14px;line-height:1.6;\">{{recruiter_note}}</p>"
            "</td></tr></table>"
            "<p style=\"margin:0;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "Sign in and open <strong>My Offer Letter</strong> to continue.</p>"
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
        "default_subject": "IT request: {{title}} — {{employee_name}}",
        "default_body": (
            "<p style=\"margin:0 0 16px;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "<strong>{{recruiter_name}}</strong> needs IT help for an existing employee.</p>"
            "<table cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" "
            "style=\"background:#ffffff;border:1px solid #e8edf3;border-radius:12px;margin:0 0 24px;\">"
            "<tr><td style=\"padding:18px 22px;\">"
            "<p style=\"margin:0 0 4px;color:#6b7a8f;font-size:11px;text-transform:uppercase;"
            "letter-spacing:0.8px;\">Request</p>"
            "<p style=\"margin:0 0 12px;color:#1a1a2e;font-size:16px;font-weight:700;\">{{title}}</p>"
            "<p style=\"margin:0;color:#6b7a8f;font-size:13px;line-height:1.6;\">"
            "Employee: <strong>{{employee_name}}</strong> ({{employee_email}})<br/>"
            "Role: {{job_title}} · {{department}}<br/>"
            "Type: {{request_type}}</p>"
            "</td></tr></table>"
            "<p style=\"margin:0 0 18px;color:#1a1a2e;font-size:14px;line-height:1.6;"
            "background:#f7f9fc;border:1px solid #e8edf3;border-radius:10px;padding:14px 16px;\">"
            "{{description}}</p>"
            "<table cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" "
            "style=\"background:#fff8ef;border:1px solid #f3e0c2;border-radius:12px;margin:0 0 24px;\">"
            "<tr><td style=\"padding:18px 22px;\">"
            "<p style=\"margin:0 0 6px;color:#9a6700;font-size:11px;font-weight:700;"
            "text-transform:uppercase;letter-spacing:1.2px;\">Note from HR</p>"
            "<p style=\"margin:0;color:#1a1a2e;font-size:14px;line-height:1.6;\">{{note}}</p>"
            "</td></tr></table>"
            "<p style=\"margin:0;color:#6b7a8f;font-size:13px;line-height:1.6;\">"
            "Open the link to mark this request as fulfilled (add serial numbers or notes as needed).</p>"
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
        "default_subject": "Action required: Re-upload your {{document_label}} — TalentAI",
        "default_body": (
            "<p style=\"margin:0 0 20px;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "Your recruiter has requested a new copy of your <strong>{{document_label}}</strong>. "
            "Only this document needs to be replaced.</p>"
            "<table cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" "
            "style=\"background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;margin:0 0 24px;\">"
            "<tr><td style=\"padding:22px;\">"
            "<p style=\"margin:0 0 6px;color:#6b7a8f;font-size:11px;font-weight:700;"
            "text-transform:uppercase;letter-spacing:1.2px;\">Reason</p>"
            "<p style=\"margin:0;color:#1a1a2e;font-size:14px;line-height:1.6;\">{{reason}}</p>"
            "<p style=\"margin:12px 0 0;color:#b45309;font-size:14px;line-height:1.6;\">"
            "<strong>Recruiter note:</strong> {{note}}</p>"
            "</td></tr></table>"
            "<p style=\"margin:0;color:#8a9bb0;font-size:13px;line-height:1.6;\">"
            "The replacement will be validated and sent back to your recruiter automatically.</p>"
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
        "default_subject": "Document update: {{document_label}} — TalentAI",
        "default_body": (
            "<p style=\"margin:0 0 20px;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "Hello {{full_name}}, your <strong>{{document_label}}</strong> was marked "
            "<strong>{{status_label}}</strong>.</p>"
            "<p style=\"margin:12px 0 0;color:#b45309;font-size:14px;line-height:1.6;\">"
            "<strong>Note:</strong> {{note}}</p>"
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
        "default_subject": "IT provisioning for {{name}} — TalentAI",
        "default_body": (
            "<p style=\"margin:0 0 16px;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "Hi, <strong>{{recruiter_name}}</strong> requested IT provisioning "
            "for <strong>{{name}}</strong>.</p>"
            "<table cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" "
            "style=\"background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;margin:0 0 24px;\">"
            "<tr><td style=\"padding:18px 22px;\">"
            "<p style=\"margin:0 0 8px;color:#1a1a2e;font-size:14px;line-height:1.6;\">"
            "<strong>Role:</strong> {{job_title}} · {{department}}</p>"
            "<p style=\"margin:0 0 8px;color:#1a1a2e;font-size:14px;line-height:1.6;\">"
            "<strong>Start date:</strong> {{start_date}}</p>"
            "<p style=\"margin:0;color:#1a1a2e;font-size:14px;line-height:1.6;\">"
            "<strong>Personal email:</strong> {{personal_email}}</p>"
            "</td></tr></table>"
            "<table cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" "
            "style=\"background:#fff8ef;border:1px solid #f3e0c2;border-radius:12px;margin:0 0 24px;\">"
            "<tr><td style=\"padding:18px 22px;\">"
            "<p style=\"margin:0 0 6px;color:#9a6700;font-size:11px;font-weight:700;"
            "text-transform:uppercase;letter-spacing:1.2px;\">Recruiter note</p>"
            "<p style=\"margin:0;color:#1a1a2e;font-size:14px;line-height:1.6;\">{{note}}</p>"
            "</td></tr></table>"
            "<p style=\"margin:0 0 28px;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "Open the form to assign a company email, password, assets, and licenses. "
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
            {"name": "assets_count", "label": "Number of assets"},
            {"name": "licenses_count", "label": "Number of licenses"},
            {"name": "company_name", "label": "Company name"},
        ],
        "default_subject": "IT provisioning complete for {{employee_name}} — TalentAI",
        "default_body": (
            "<p style=\"margin:0 0 16px;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "IT finished provisioning for <strong>{{employee_name}}</strong>. You can now approve and activate "
            "the employee from the candidate pipeline.</p>"
            "<table cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" "
            "style=\"background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;margin:0 0 8px;\">"
            "<tr><td style=\"padding:18px 22px;\">"
            "<p style=\"margin:0 0 8px;color:#1a1a2e;font-size:14px;line-height:1.6;\">"
            "<strong>Company email:</strong> {{company_email}}</p>"
            "<p style=\"margin:0;color:#1a1a2e;font-size:14px;line-height:1.6;\">"
            "<strong>Assets:</strong> {{assets_count}} · <strong>Licenses:</strong> {{licenses_count}}</p>"
            "</td></tr></table>"
        ),
    },
    "it_provisioning_edited": {
        "name": "IT Provisioning Updated",
        "description": "Notifies recruiter that IT updated the provisioning details.",
        "category": "IT",
        "variables": [
            {"name": "employee_name", "label": "Employee name"},
            {"name": "company_email", "label": "Company email"},
            {"name": "assets_count", "label": "Number of assets"},
            {"name": "licenses_count", "label": "Number of licenses"},
            {"name": "company_name", "label": "Company name"},
        ],
        "default_subject": "IT provisioning updated for {{employee_name}} — TalentAI",
        "default_body": (
            "<p style=\"margin:0 0 16px;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "IT updated the provisioning for <strong>{{employee_name}}</strong>. The latest details below "
            "are what will be used when you activate the employee.</p>"
            "<table cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" "
            "style=\"background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;margin:0 0 8px;\">"
            "<tr><td style=\"padding:18px 22px;\">"
            "<p style=\"margin:0 0 8px;color:#1a1a2e;font-size:14px;line-height:1.6;\">"
            "<strong>Company email:</strong> {{company_email}}</p>"
            "<p style=\"margin:0;color:#1a1a2e;font-size:14px;line-height:1.6;\">"
            "<strong>Assets:</strong> {{assets_count}} · <strong>Licenses:</strong> {{licenses_count}}</p>"
            "</td></tr></table>"
        ),
    },
    "first_time_password": {
        "name": "Employee Account Credentials",
        "description": "Sends the new employee their Employee ID, company email, and temporary password in one email.",
        "category": "Onboarding",
        "variables": [
            {"name": "full_name", "label": "Employee name"},
            {"name": "employee_id", "label": "Employee ID"},
            {"name": "company_email", "label": "Company email"},
            {"name": "temp_password", "label": "Temporary password"},
            {"name": "company_name", "label": "Company name"},
        ],
        "default_subject": "Your employee account credentials — TalentAI",
        "default_body": (
            "<p style=\"margin:0 0 16px;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "Hello {{full_name}}, your employee account is ready. Use the credentials below "
            "to access the employee portal.</p>"
            "<table cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" "
            "style=\"background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;margin:0 0 20px;\">"
            "<tr><td style=\"padding:20px 22px;\">"
            "<p style=\"margin:0 0 6px;color:#6b7a8f;font-size:11px;font-weight:700;"
            "text-transform:uppercase;letter-spacing:1.2px;\">Employee ID</p>"
            "<p style=\"margin:0 0 14px;color:#0D5C91;font-size:20px;font-weight:800;letter-spacing:1px;\">"
            "{{employee_id}}</p>"
            "<p style=\"margin:0 0 6px;color:#6b7a8f;font-size:11px;font-weight:700;"
            "text-transform:uppercase;letter-spacing:1.2px;\">Company email</p>"
            "<p style=\"margin:0 0 14px;color:#1a1a2e;font-size:16px;font-weight:700;word-break:break-all;\">"
            "{{company_email}}</p>"
            "<p style=\"margin:0 0 6px;color:#6b7a8f;font-size:11px;font-weight:700;"
            "text-transform:uppercase;letter-spacing:1.2px;\">Temporary password</p>"
            "<p style=\"margin:0;font-size:20px;font-weight:800;color:#1e3a5f;"
            "font-family:Consolas,Menlo,monospace;\">{{temp_password}}</p>"
            "</td></tr></table>"
            "<p style=\"margin:0;color:#8a9bb0;font-size:13px;line-height:1.6;\">"
            "After signing in you will be asked to create your own password. From then on, "
            "that single password covers both your personal and company email logins.</p>"
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
            "<p style=\"margin:0 0 16px;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "Hi {{full_name}}, your recruiter updated your payroll banking details. "
            "You can review them (view only) on your employee profile.</p>"
            "<table cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" "
            "style=\"background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;margin:0 0 24px;\">"
            "<tr><td style=\"padding:18px 22px;\">"
            "<p style=\"margin:0 0 8px;color:#1a1a2e;font-size:14px;line-height:1.6;\">"
            "<strong>Bank:</strong> {{bank_name}}</p>"
            "<p style=\"margin:0 0 8px;color:#1a1a2e;font-size:14px;line-height:1.6;\">"
            "<strong>Account title:</strong> {{account_holder_name}}</p>"
            "<p style=\"margin:0;color:#1a1a2e;font-size:14px;line-height:1.6;\">"
            "<strong>IBAN:</strong> {{masked_iban}}</p>"
            "</td></tr></table>"
            "<p style=\"margin:0;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "Sign in and open <strong>My Profile → Banking</strong> to see the full details.</p>"
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
            "<p style=\"margin:0 0 20px;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "Hello {{full_name}}, your recruiter has recorded your official company email. "
            "Please use this address for workplace communications going forward.</p>"
            "<table cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" "
            "style=\"background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;margin:0 0 8px;\">"
            "<tr><td style=\"padding:24px;\">"
            "<p style=\"margin:0 0 6px;color:#6b7a8f;font-size:11px;font-weight:700;"
            "text-transform:uppercase;letter-spacing:1.2px;\">Company email</p>"
            "<p style=\"margin:0;color:#0D5C91;font-size:24px;font-weight:700;letter-spacing:1px;\">"
            "{{company_email}}</p>"
            "</td></tr></table>"
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
        "default_subject": "Asset assigned: {{asset_name}} — TalentAI",
        "default_body": (
            "<p style=\"margin:0 0 20px;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "Hello {{full_name}}, a company asset has been assigned to you. "
            "Please keep it safe and report any issues to HR.</p>"
            "<table cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" "
            "style=\"background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;\">"
            "<tr><td style=\"padding:24px;\">"
            "<p style=\"margin:0 0 4px;color:#0D5C91;font-size:18px;font-weight:700;\">{{asset_name}}</p>"
            "<p style=\"margin:0;color:#6b7a8f;font-size:14px;\">Type: {{asset_type}}</p>"
            "<p style=\"margin:8px 0 0;color:#475569;font-size:13px;\">"
            "<strong>Serial:</strong> {{serial_number}}</p>"
            "</td></tr></table>"
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
            "<p style=\"margin:0 0 20px;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "Hello {{full_name}}, your onboarding orientation has been scheduled.</p>"
            "<table cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" "
            "style=\"background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;margin:0 0 24px;\">"
            "<tr><td style=\"padding:24px;\">"
            "<p style=\"margin:0 0 4px;color:#0D5C91;font-size:18px;font-weight:700;\">"
            "{{date}}&ensp;&middot;&ensp;{{time}}</p>"
            "<p style=\"margin:0;color:#6b7a8f;font-size:14px;\">"
            "<strong>Trainer:</strong> {{trainer}}</p>"
            "<p style=\"margin:12px 0 0;\">"
            "<a href=\"{{meeting_link}}\" style=\"color:#0D5C91;font-weight:600;text-decoration:none;\">"
            "Join meeting →</a></p>"
            "</td></tr></table>"
            "<p style=\"margin:0 0 6px;color:#6b7a8f;font-size:11px;font-weight:700;"
            "text-transform:uppercase;letter-spacing:0.8px;\">Agenda</p>"
            "<p style=\"margin:0;color:#1a1a2e;font-size:14px;line-height:1.7;white-space:pre-wrap;\">"
            "{{agenda}}</p>"
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
        "default_subject": "Reminder: Complete your employee profile — TalentAI",
        "default_body": (
            "<p style=\"margin:0 0 20px;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "Hello {{full_name}}, your recruiter is waiting on a few post-hire details before "
            "your onboarding is finished. Employee ID <strong>{{employee_id}}</strong>.</p>"
            "<table cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" "
            "style=\"background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;margin:0 0 24px;\">"
            "<tr><td style=\"padding:22px;\">"
            "<p style=\"margin:0 0 10px;color:#6b7a8f;font-size:11px;font-weight:700;"
            "text-transform:uppercase;letter-spacing:1.2px;\">Still needed</p>"
            "<ul style=\"margin:0;padding-left:20px;\">{{missing_items}}</ul>"
            "<p style=\"margin:16px 0 0;color:#1a1a2e;font-size:13px;line-height:1.6;\">"
            "<strong>Note from your recruiter:</strong> {{recruiter_note}}</p>"
            "</td></tr></table>"
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
            "<p style=\"margin:0 0 20px;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "Hello {{full_name}}, your recruiter is waiting for a few onboarding details "
            "before they can review your application.</p>"
            "<table cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" "
            "style=\"background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;margin:0 0 24px;\">"
            "<tr><td style=\"padding:22px;\">"
            "<p style=\"margin:0 0 10px;color:#6b7a8f;font-size:11px;font-weight:700;"
            "text-transform:uppercase;letter-spacing:1.2px;\">Still needed</p>"
            "<ul style=\"margin:0;padding-left:20px;\">{{missing_items}}</ul>"
            "<p style=\"margin:16px 0 0;color:#1a1a2e;font-size:13px;line-height:1.6;\">"
            "<strong>Note from your recruiter:</strong> {{recruiter_note}}</p>"
            "</td></tr></table>"
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
        "default_subject": "Announcement: {{title}} — TalentAI",
        "default_body": (
            "<p style=\"margin:0 0 20px;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "Hello {{full_name}}, your recruiting team shared a new announcement.</p>"
            "<table cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" "
            "style=\"background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;margin:0 0 8px;\">"
            "<tr><td style=\"padding:22px;\">"
            "<p style=\"margin:0;color:#1a1a2e;font-size:15px;line-height:1.7;white-space:pre-wrap;\">"
            "{{body_text}}</p>"
            "</td></tr></table>"
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
        "default_subject": "Reminder: {{title}} — TalentAI",
        "default_body": (
            "<p style=\"margin:0 0 24px;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "Hello {{full_name}}, your recruiter sent you a reminder.</p>"
            "<table cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" "
            "style=\"background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;margin:0 0 28px;\">"
            "<tr><td style=\"padding:22px;\">"
            "<p style=\"margin:0 0 10px;color:#6b7a8f;font-size:11px;font-weight:700;"
            "text-transform:uppercase;letter-spacing:1.2px;\">{{title}}</p>"
            "<p style=\"margin:0;color:#1a1a2e;font-size:14px;line-height:1.7;white-space:pre-wrap;\">"
            "{{body_text}}</p>"
            "<p style=\"margin:16px 0 0;color:#1a1a2e;font-size:13px;line-height:1.6;\">"
            "<strong>Note from your recruiter:</strong> {{recruiter_note}}</p>"
            "</td></tr></table>"
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
        "default_subject": "Message: {{subject_line}} — TalentAI",
        "default_body": (
            "<p style=\"margin:0 0 24px;color:#1a1a2e;font-size:15px;line-height:1.7;\">"
            "Hello {{full_name}}, you have a new message from <strong>{{sender_label}}</strong>.</p>"
            "<table cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" "
            "style=\"background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;margin:0 0 28px;\">"
            "<tr><td style=\"padding:22px;\">"
            "<p style=\"margin:0 0 10px;color:#0D5C91;font-size:18px;font-weight:700;\">"
            "{{subject_line}}</p>"
            "<p style=\"margin:0;color:#1a1a2e;font-size:14px;line-height:1.7;white-space:pre-wrap;\">"
            "{{body_text}}</p>"
            "</td></tr></table>"
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

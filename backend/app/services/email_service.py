"""SMTP-based email service with HTML templates for TalentAI."""

import smtplib
import ssl
import logging
from html import escape
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.core.config import settings

logger = logging.getLogger(__name__)


def _escape_text(value: object, *, quote: bool = False) -> str:
    return escape("" if value is None else str(value), quote=quote)


def unique_emails(*emails) -> list[str]:
    """Deduplicated, lowercased list of non-empty recipient emails."""
    seen: set[str] = set()
    out: list[str] = []
    for email in emails:
        cleaned = (email or "").strip().lower()
        if cleaned and cleaned not in seen:
            seen.add(cleaned)
            out.append(cleaned)
    return out


class EmailService:
    # ============================================================
    #  Logo loaded from Cloudinary CDN
    # ============================================================
    LOGO_SRC = "https://res.cloudinary.com/nujzpfgy/image/upload/v1785235669/logo_g6pe1a.png"

    def _build_message(self, to_email: str, subject: str, html_body: str) -> MIMEMultipart:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_FROM_EMAIL}>"
        msg["To"] = to_email
        msg.attach(MIMEText(html_body, "html"))
        return msg

    def _send(self, to_email: str, subject: str, html_body: str) -> None:
        try:
            msg = self._build_message(to_email, subject, html_body)
            context = ssl.create_default_context()
            if settings.MAIL_USE_SSL:
                with smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, context=context) as server:
                    server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
                    server.sendmail(settings.SMTP_FROM_EMAIL, to_email, msg.as_string())
            else:
                with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
                    server.ehlo()
                    if settings.MAIL_USE_TLS:
                        server.starttls(context=context)
                        server.ehlo()
                    server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
                    server.sendmail(settings.SMTP_FROM_EMAIL, to_email, msg.as_string())
        except Exception as exc:
            logger.error(
                f"SMTP send failed to {to_email} (subject: {subject})",
                exc_info=True
            )
            raise RuntimeError(f"Failed to send email to {to_email}: {exc}") from exc

    def send_to_both(self, primary_email: str, company_email: str | None, send_fn, *args, **kwargs) -> None:
        """Send the same email to the primary (personal) email and, when a
        company email exists, to the company email as well. A failure on one
        recipient never blocks the other."""
        for to_email in unique_emails(primary_email, company_email):
            try:
                send_fn(to_email, *args, **kwargs)
            except Exception as exc:  # noqa: BLE001
                logger.error(f"Email send failed to {to_email}", exc_info=True)
                raise RuntimeError(f"Failed to send email to {to_email}: {exc}") from exc

    # ------------------------------------------------------------------ #
    # Premium branded shell - Modern Clean Design
    # ------------------------------------------------------------------ #
    def _branded_shell(self, eyebrow: str, title: str, body_html: str) -> str:
        logo_src = self.LOGO_SRC
        return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <meta name="color-scheme" content="light only"/>
  <meta name="supported-color-schemes" content="light only"/>
  <title>TalentAI</title>
  <style>
    :root {{
      color-scheme: light only;
      supported-color-schemes: light only;
    }}
    @media only screen and (max-width:600px){{
      .email-card{{width:100%!important;border-radius:0!important;}}
      .email-body{{padding:28px 20px!important;}}
      .email-header{{padding:28px 20px!important;}}
      .email-footer{{padding:18px 20px!important;}}
      .cta-btn{{display:block!important;width:100%!important;text-align:center!important;box-sizing:border-box!important;}}
      .logo-img{{width:160px!important;}}
    }}
    .cta-btn:hover{{
      background:#0D5C91!important;
      box-shadow:0 8px 24px rgba(13,92,145,.3)!important;
      transform:translateY(-1px);
    }}
    [data-ogsc] .email-card, [data-ogsb] .email-card {{ background:#ffffff!important; }}
    [data-ogsc] .email-body p, [data-ogsb] .email-body p {{ color:#1a1a2e!important; }}
    u + .body .email-card {{ background:#ffffff!important; }}
    .logo-img{{
      -webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none;
      -webkit-user-drag:none;-khtml-user-drag:none;-moz-user-drag:none;-o-user-drag:none;user-drag:none;
      -webkit-touch-callout:none;
      pointer-events:none;
      display:block;
      border:0;
      outline:none;
    }}
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f0f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div class="body">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f0f4f8;padding:40px 16px;">
    <tr><td align="center">
      <table class="email-card" width="600" cellpadding="0" cellspacing="0" border="0"
             style="background:#ffffff;border-radius:20px;overflow:hidden;max-width:600px;
                    box-shadow:0 4px 48px rgba(0,0,0,0.06);">
        <tr>
          <td class="email-header" style="background:#ffffff;padding:32px 40px 24px 40px;border-bottom:3px solid #0D5C91;">
            <table cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td align="center">
                  <img class="logo-img" src="{logo_src}" alt="Mazik Global TalentAI"
                       draggable="false" oncontextmenu="return false;"
                       width="180" style="width:180px;max-width:180px;height:auto;
                              display:block;border:0;outline:none;margin:0 auto;"/>
                </td>
              </tr>
              <tr>
                <td style="padding-top:20px;">
                  <table cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr><td style="border-top:2px solid #e8edf3;font-size:0;line-height:0;">&nbsp;</td></tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td class="email-body" style="padding:36px 40px 32px 40px;background:#ffffff;">
            <p style="margin:0 0 4px;color:#6b7a8f;font-size:12px;font-weight:600;
                      text-transform:uppercase;letter-spacing:1.2px;">{_escape_text(eyebrow)}</p>
            <h1 style="margin:0 0 24px;color:#1a1a2e;font-size:28px;font-weight:700;
                       line-height:1.3;letter-spacing:-0.3px;">{_escape_text(title)}</h1>
            {body_html}
          </td>
        </tr>
        <tr>
          <td class="email-footer" style="background:#f8fafc;padding:24px 40px 28px 40px;border-top:1px solid #e8edf3;">
            <table cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td align="center">
                  <p style="margin:0 0 4px;color:#1a1a2e;font-size:14px;font-weight:600;letter-spacing:0.2px;">
                    Mazik Global TalentAI
                  </p>
                  <p style="margin:0 0 12px;color:#8a9bb0;font-size:12px;font-weight:500;">
                    Data-Driven Decisions.
                  </p>
                  <p style="margin:0;color:#9aabb8;font-size:11px;line-height:1.6;">
                    This is an automated email. Please do not reply directly to this message.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
  </div>
</body>
</html>"""

    # ------------------------------------------------------------------ #
    # send_signup_otp
    # ------------------------------------------------------------------ #
    def send_signup_otp(self, to_email: str, full_name: str, otp: str) -> None:
        subject = "Verify Your Email – TalentAI"
        body = f"""
<p style="margin:0 0 20px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Use the one-time code below to verify your email address and activate your
  TalentAI account. This code expires in <strong>10&nbsp;minutes</strong>.
</p>
<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;
              margin:0 0 24px;">
  <tr>
    <td style="padding:24px;text-align:center;">
      <p style="margin:0 0 8px;color:#6b7a8f;font-size:11px;font-weight:700;
                text-transform:uppercase;letter-spacing:1.2px;">
        Your verification code
      </p>
      <p style="margin:0;color:#0D5C91;font-size:42px;font-weight:700;
                letter-spacing:12px;line-height:1.1;">
        {otp}
      </p>
    </td>
  </tr>
</table>
<p style="margin:0;color:#8a9bb0;font-size:13px;line-height:1.6;">
  If you didn&rsquo;t create a TalentAI account, you can safely ignore this email.
</p>
"""
        self._send(
            to_email, subject,
            self._branded_shell("Email Verification", f"Hello, {escape(full_name)} 👋", body)
        )

    # ------------------------------------------------------------------ #
    # send_forgot_password_otp
    # ------------------------------------------------------------------ #
    def send_forgot_password_otp(self, to_email: str, otp: str) -> None:
        subject = "Reset Your Password – TalentAI"
        body = f"""
<p style="margin:0 0 20px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  We received a request to reset your TalentAI password. Use the code below
  to proceed. This code expires in <strong>10&nbsp;minutes</strong>.
</p>
<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;
              margin:0 0 24px;">
  <tr>
    <td style="padding:24px;text-align:center;">
      <p style="margin:0 0 8px;color:#6b7a8f;font-size:11px;font-weight:700;
                text-transform:uppercase;letter-spacing:1.2px;">
        Your password reset code
      </p>
      <p style="margin:0;color:#0D5C91;font-size:42px;font-weight:700;
                letter-spacing:12px;line-height:1.1;">
        {otp}
      </p>
    </td>
  </tr>
</table>
<p style="margin:0;color:#8a9bb0;font-size:13px;line-height:1.6;">
  If you didn&rsquo;t request this, you can safely ignore this email.
  Your password won&rsquo;t change.
</p>
"""
        self._send(
            to_email, subject,
            self._branded_shell("Account Recovery", "Reset Your Password", body)
        )

    # ------------------------------------------------------------------ #
    # send_invitation_email
    # ------------------------------------------------------------------ #
    def send_invitation_email(
        self,
        to_email: str,
        full_name: str,
        job_title: str,
        department: str,
        invite_link: str,
        expires_at: str,
    ) -> None:
        subject = "You've Been Invited to Join TalentAI"
        safe_link = _escape_text(invite_link, quote=True)
        body = f"""
<p style="margin:0 0 16px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  You have been invited to join <strong>TalentAI</strong> as a candidate for the position of
  <strong>{_escape_text(job_title)}</strong> in the <strong>{_escape_text(department)}</strong> department.
</p>
<p style="margin:0 0 28px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Click the button below to complete your registration and begin onboarding.
  This invitation expires on <strong>{_escape_text(expires_at)}</strong>.
</p>
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 28px;">
  <tr>
    <td align="center">
      <a href="{safe_link}" class="cta-btn"
         style="display:inline-block;background:#0D5C91;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:8px;
                font-weight:600;font-size:15px;letter-spacing:0.2px;
                box-shadow:0 4px 16px rgba(13,92,145,.2);
                transition:all 0.2s ease;">
        Accept Invitation
      </a>
    </td>
  </tr>
</table>
<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;">
  <tr>
    <td style="padding:20px;">
      <p style="margin:0 0 4px;color:#6b7a8f;font-size:11px;font-weight:600;
                text-transform:uppercase;letter-spacing:0.8px;">
        Or copy this link into your browser
      </p>
      <p style="margin:0;font-family:monospace;font-size:12px;color:#1a1a2e;
                word-break:break-all;line-height:1.5;">
        {_escape_text(invite_link)}
      </p>
    </td>
  </tr>
</table>
"""
        self._send(
            to_email, subject,
            self._branded_shell("Candidate Invitation", f"Hello, {_escape_text(full_name)} 👋", body)
        )

    # ------------------------------------------------------------------ #
    # send_offer_invitation_email
    # ------------------------------------------------------------------ #
    def send_offer_invitation_email(
        self,
        to_email: str,
        full_name: str,
        job_title: str,
        department: str,
        start_date: str,
        currency: str,
        monthly_salary: float | str,
        invite_link: str,
        expires_at: str,
    ) -> None:
        subject = "Your Invitation to Join TalentAI"
        safe_link = _escape_text(invite_link, quote=True)
        salary_amount = float(monthly_salary)
        salary_value = str(int(salary_amount)) if salary_amount.is_integer() else str(salary_amount)
        body = f"""
<p style="margin:0 0 16px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  You have been invited to join <strong>TalentAI</strong> as a candidate for the position of
  <strong>{_escape_text(job_title)}</strong> in the <strong>{_escape_text(department)}</strong> department.
</p>
<p style="margin:0 0 12px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Your offer includes <strong>{_escape_text(currency)} {_escape_text(salary_value)}</strong> per month,
  with a start date of <strong>{_escape_text(start_date)}</strong>.
</p>
<p style="margin:0 0 28px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Click the button below to review the offer and complete your registration.
  This invitation expires on <strong>{_escape_text(expires_at)}</strong>.
</p>
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 28px;">
  <tr>
    <td align="center">
      <a href="{safe_link}" class="cta-btn"
         style="display:inline-block;background:#0D5C91;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:8px;
                font-weight:600;font-size:15px;letter-spacing:0.2px;
                box-shadow:0 4px 16px rgba(13,92,145,.2);
                transition:all 0.2s ease;">
        Accept Invitation
      </a>
    </td>
  </tr>
</table>
<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;">
  <tr>
    <td style="padding:20px;">
      <p style="margin:0 0 4px;color:#6b7a8f;font-size:11px;font-weight:600;
                text-transform:uppercase;letter-spacing:0.8px;">
        Or copy this link into your browser
      </p>
      <p style="margin:0;font-family:monospace;font-size:12px;color:#1a1a2e;
                word-break:break-all;line-height:1.5;">
        {_escape_text(invite_link)}
      </p>
    </td>
  </tr>
</table>
"""
        self._send(
            to_email, subject,
            self._branded_shell("Candidate Invitation", f"Hello, {_escape_text(full_name)} 👋", body)
        )

    # ------------------------------------------------------------------ #
    # send_employee_welcome
    # ------------------------------------------------------------------ #
    def send_employee_welcome(
        self,
        to_email: str,
        full_name: str,
        employee_id: str,
        job_title: str,
        department: str,
    ) -> None:
        subject = "Congratulations — Welcome to TalentAI"
        body = f"""
<p style="margin:0 0 16px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Your onboarding has been approved and you are now an official employee
  at Mazik Global Pakistan.
</p>
<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;
              margin:0 0 24px;">
  <tr>
    <td style="padding:24px;">
      <p style="margin:0 0 6px;color:#6b7a8f;font-size:11px;font-weight:700;
                text-transform:uppercase;letter-spacing:1.2px;">
        Your Employee ID
      </p>
      <p style="margin:0 0 12px;color:#0D5C91;font-size:32px;font-weight:700;
                letter-spacing:4px;line-height:1.1;">
        {escape(employee_id)}
      </p>
      <p style="margin:0;color:#1a1a2e;font-size:14px;font-weight:600;">
        {escape(job_title)}&ensp;&middot;&ensp;{escape(department)}
      </p>
    </td>
  </tr>
</table>
<p style="margin:0 0 12px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Sign in to TalentAI and choose the <strong>Employee</strong> role to open
  your employee dashboard.
</p>
<p style="margin:0;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Please complete your post-hire profile (emergency contact, banking,
  references, policies, and Self Declaration) so HR can finish your onboarding.
</p>
"""
        self._send(
            to_email, subject,
            self._branded_shell("Congratulations", f"Welcome aboard, {escape(full_name)}!", body)
        )

    # ------------------------------------------------------------------ #
    # send_offer_letter
    # ------------------------------------------------------------------ #
    def send_offer_letter(
        self,
        to_email: str,
        full_name: str,
        job_title: str,
        department: str,
        start_date: str,
    ) -> None:
        subject = f"Your Offer Letter for {job_title} — TalentAI"
        body = f"""
<p style="margin:0 0 16px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  We&rsquo;re delighted to offer you the position below. Sign in to review
  the full terms and digitally sign your offer letter.
</p>
<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;
              margin:0 0 24px;">
  <tr>
    <td style="padding:24px;">
      <p style="margin:0 0 4px;color:#0D5C91;font-size:18px;font-weight:700;">
        {_escape_text(job_title)}
      </p>
      <p style="margin:0;color:#6b7a8f;font-size:14px;">
        {_escape_text(department)}&ensp;&middot;&ensp;Starting {_escape_text(start_date)}
      </p>
    </td>
  </tr>
</table>
<p style="margin:0;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Sign in to your candidate dashboard and open <strong>My Offer Letter</strong>
  to review and sign.
</p>
"""
        self._send(
            to_email, subject,
            self._branded_shell("Offer Letter", f"You&rsquo;ve been offered a role, {_escape_text(full_name)}!", body)
        )

    def send_offer_validity_extended(
        self,
        *,
        to_email: str,
        full_name: str,
        job_title: str,
        recruiter_name: str,
        extra_days: int,
        new_expires_at: str,
        note: str | None = None,
        offer_link: str | None = None,
    ) -> None:
        """Notify candidate that an expired offer was reopened with a new response deadline."""
        days_label = f"{extra_days} day" if extra_days == 1 else f"{extra_days} days"
        safe_link = _escape_text(
            offer_link or f"{settings.frontend_base_url.rstrip('/')}/offer",
            quote=True,
        )
        note_block = ""
        if note and str(note).strip():
            note_block = f"""
<p style="margin:0 0 20px;color:#1a1a2e;font-size:15px;line-height:1.7;
          background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;padding:16px 18px;">
  <strong style="display:block;margin-bottom:6px;color:#0D5C91;">Message from {_escape_text(recruiter_name or 'your recruiter')}</strong>
  {_escape_text(note.strip())}
</p>
"""
        subject = f"Your offer letter was extended — {job_title or 'TalentAI'}"
        body = f"""
<p style="margin:0 0 16px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  {_escape_text(recruiter_name or 'Your recruiter')} extended the validity of your offer for
  <strong>{_escape_text(job_title or 'the role')}</strong> by <strong>{_escape_text(days_label)}</strong>.
</p>
<p style="margin:0 0 20px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Your updated response deadline is <strong>{_escape_text(new_expires_at)}</strong>.
  Review the letter and sign before then.
</p>
{note_block}
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 8px;">
  <tr>
    <td align="center">
      <a href="{safe_link}" class="cta-btn"
         style="display:inline-block;background:#0D5C91;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:8px;
                font-weight:600;font-size:15px;letter-spacing:0.2px;
                box-shadow:0 4px 16px rgba(13,92,145,.2);">
        Review updated offer
      </a>
    </td>
  </tr>
</table>
"""
        self._send(
            to_email,
            subject,
            self._branded_shell(
                "Offer extended",
                f"Good news, {_escape_text(full_name)} — your offer window was extended",
                body,
            ),
        )

    # ------------------------------------------------------------------ #
    # Offer clarification emails
    # ------------------------------------------------------------------ #
    def send_offer_clarification_request(
        self,
        *,
        to_email: str,
        recruiter_name: str,
        candidate_name: str,
        job_title: str,
        note: str | None = None,
    ) -> None:
        safe_recruiter = _escape_text(recruiter_name or "Recruiter")
        safe_candidate = _escape_text(candidate_name or "Candidate")
        safe_title = _escape_text(job_title or "the offered role")
        safe_note = _escape_text(note or "")
        note_html = (
            f"""
<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:#fff8ef;border:1px solid #f3e0c2;border-radius:12px;margin:0 0 24px;">
  <tr>
    <td style="padding:18px 22px;">
      <p style="margin:0 0 6px;color:#9a6700;font-size:11px;font-weight:700;
                text-transform:uppercase;letter-spacing:1.2px;">Candidate question</p>
      <p style="margin:0;color:#1a1a2e;font-size:14px;line-height:1.6;">{safe_note}</p>
    </td>
  </tr>
</table>
"""
            if safe_note
            else ""
        )
        subject = f"Offer clarification from {candidate_name or 'candidate'} — TalentAI"
        body = f"""
<p style="margin:0 0 16px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Hi {safe_recruiter}, <strong>{safe_candidate}</strong> requested clarification on the offer
  for <strong>{safe_title}</strong>.
</p>
{note_html}
<p style="margin:0;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Open the candidate pipeline to reply, or edit and resend an updated offer letter.
</p>
"""
        self._send(
            to_email,
            subject,
            self._branded_shell("IT Provisioning", "IT setup requested for a batch", body),
        )

    def send_it_service_request(
        self,
        *,
        to_email: str,
        recruiter_name: str,
        employee_name: str,
        employee_email: str,
        job_title: str | None,
        department: str | None,
        request_type: str,
        title: str,
        description: str | None,
        note: str | None,
        fulfill_link: str,
        created_at,
    ) -> None:
        """IT help request for an existing employee (e.g. replacement laptop)."""
        safe_note = _escape_text(note or "")
        note_html = (
            f"""
<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:#fff8ef;border:1px solid #f3e0c2;border-radius:12px;margin:0 0 24px;">
  <tr>
    <td style="padding:18px 22px;">
      <p style="margin:0 0 6px;color:#9a6700;font-size:11px;font-weight:700;
                text-transform:uppercase;letter-spacing:1.2px;">Note from HR</p>
      <p style="margin:0;color:#1a1a2e;font-size:14px;line-height:1.6;">{safe_note}</p>
    </td>
  </tr>
</table>
"""
            if safe_note
            else ""
        )
        safe_description = _escape_text(description or "")
        description_html = (
            f"""
<p style="margin:0 0 18px;color:#1a1a2e;font-size:14px;line-height:1.6;
          background:#f7f9fc;border:1px solid #e8edf3;border-radius:10px;padding:14px 16px;">
  {safe_description}
</p>
"""
            if safe_description
            else ""
        )
        safe_link = _escape_text(fulfill_link or "", quote=True)
        subject = f"IT request: {title} — {employee_name}"
        body = f"""
<p style="margin:0 0 16px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  <strong>{_escape_text(recruiter_name or 'HR')}</strong> needs IT help for an existing employee.
</p>
<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:#ffffff;border:1px solid #e8edf3;border-radius:12px;margin:0 0 24px;">
  <tr>
    <td style="padding:18px 22px;">
      <p style="margin:0 0 4px;color:#6b7a8f;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;">Request</p>
      <p style="margin:0 0 12px;color:#1a1a2e;font-size:16px;font-weight:700;">{_escape_text(title)}</p>
      <p style="margin:0;color:#6b7a8f;font-size:13px;line-height:1.6;">
        Employee: <strong>{_escape_text(employee_name)}</strong> ({_escape_text(employee_email)})<br/>
        Role: {_escape_text(job_title or '—')} · {_escape_text(department or '—')}<br/>
        Type: {_escape_text(request_type)}
      </p>
    </td>
  </tr>
</table>
{description_html}
{note_html}
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 28px;">
  <tr>
    <td align="center">
      <a href="{safe_link}" class="cta-btn"
         style="display:inline-block;background:#0D5C91;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:8px;
                font-weight:600;font-size:15px;letter-spacing:0.2px;
                box-shadow:0 4px 16px rgba(13,92,145,.2);">
        Open IT request
      </a>
    </td>
  </tr>
</table>
<p style="margin:0;color:#6b7a8f;font-size:13px;line-height:1.6;">
  Open the link to mark this request as fulfilled (add serial numbers or notes as needed).
</p>
"""
        self._send(
            to_email,
            subject,
            self._branded_shell("IT Support", "New IT help request", body),
        )

    def send_offer_clarification_result(
        self,
        *,
        to_email: str,
        full_name: str,
        job_title: str,
        outcome: str = "resolved",
        recruiter_note: str | None = None,
    ) -> None:
        safe_name = _escape_text(full_name or "Candidate")
        safe_title = _escape_text(job_title or "your offer")
        safe_note = _escape_text(recruiter_note or "")
        outcome_key = (outcome or "resolved").lower()
        if outcome_key in {"closed", "rejected"}:
            headline = "Clarification closed"
            lead = (
                f"Your recruiter closed the clarification request for <strong>{safe_title}</strong>. "
                "You can still review the current offer and continue."
            )
        elif outcome_key in {"updated", "edited", "resent"}:
            headline = "Updated offer ready"
            lead = (
                f"Your recruiter updated the offer letter for <strong>{safe_title}</strong> "
                "after your clarification. Please review and sign when ready."
            )
        else:
            headline = "Clarification response ready"
            lead = (
                f"Your recruiter responded to your clarification on <strong>{safe_title}</strong>. "
                "Open your offer letter to continue."
            )
        note_html = (
            f"""
<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;margin:16px 0 24px;">
  <tr>
    <td style="padding:18px 22px;">
      <p style="margin:0 0 6px;color:#0D5C91;font-size:11px;font-weight:700;
                text-transform:uppercase;letter-spacing:1.2px;">Recruiter note</p>
      <p style="margin:0;color:#1a1a2e;font-size:14px;line-height:1.6;">{safe_note}</p>
    </td>
  </tr>
</table>
"""
            if safe_note
            else ""
        )
        subject = f"{headline} — {job_title or 'Offer letter'} | TalentAI"
        body = f"""
<p style="margin:0 0 16px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Hi {safe_name}, {lead}
</p>
{note_html}
<p style="margin:0;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Sign in and open <strong>My Offer Letter</strong> to continue.
</p>
"""
        self._send(
            to_email,
            subject,
            self._branded_shell("Offer Clarification", headline, body),
        )

    # Backward-compatible aliases used by older offer flows.
    def send_offer_negotiation_request(self, **kwargs) -> None:
        self.send_offer_clarification_request(
            to_email=kwargs.get("to_email"),
            recruiter_name=kwargs.get("recruiter_name") or "Recruiter",
            candidate_name=kwargs.get("candidate_name") or "Candidate",
            job_title=kwargs.get("job_title") or "",
            note=kwargs.get("note"),
        )

    def send_offer_negotiation_result(self, **kwargs) -> None:
        accepted = kwargs.get("accepted")
        outcome = "resolved" if accepted else "closed"
        self.send_offer_clarification_result(
            to_email=kwargs.get("to_email"),
            full_name=kwargs.get("full_name") or "Candidate",
            job_title=kwargs.get("job_title") or "",
            outcome=outcome,
            recruiter_note=kwargs.get("recruiter_note"),
        )

    # ------------------------------------------------------------------ #
    # send_document_reupload_request
    # ------------------------------------------------------------------ #
    def send_document_reupload_request(
        self,
        to_email: str,
        full_name: str,
        document_label: str,
        reason: str,
        note: str | None,
        dashboard_link: str,
    ) -> None:
        safe_name = escape(full_name or "Candidate")
        safe_label = escape(document_label)
        safe_reason = escape(reason)
        safe_note = escape(note or "")
        safe_link = escape(dashboard_link, quote=True)
        note_html = (
            f'<p style="margin:12px 0 0;color:#b45309;font-size:14px;line-height:1.6;">'
            f'<strong>Recruiter note:</strong> {safe_note}</p>'
            if safe_note else ""
        )
        subject = f"Action required: Re-upload your {safe_label} — TalentAI"
        body = f"""
<p style="margin:0 0 20px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Your recruiter has requested a new copy of your <strong>{safe_label}</strong>.
  Only this document needs to be replaced.
</p>
<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;
              margin:0 0 24px;">
  <tr>
    <td style="padding:22px;">
      <p style="margin:0 0 6px;color:#6b7a8f;font-size:11px;font-weight:700;
                text-transform:uppercase;letter-spacing:1.2px;">
        Reason
      </p>
      <p style="margin:0;color:#1a1a2e;font-size:14px;line-height:1.6;">
        {safe_reason}
      </p>
      {note_html}
    </td>
  </tr>
</table>
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 28px;">
  <tr>
    <td align="center">
      <a href="{safe_link}" class="cta-btn"
         style="display:inline-block;background:#0D5C91;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:8px;
                font-weight:600;font-size:15px;letter-spacing:0.2px;
                box-shadow:0 4px 16px rgba(13,92,145,.2);">
        Open dashboard and re-upload
      </a>
    </td>
  </tr>
</table>
<p style="margin:0;color:#8a9bb0;font-size:13px;line-height:1.6;">
  The replacement will be validated and sent back to your recruiter automatically.
</p>
"""
        self._send(
            to_email, subject,
            self._branded_shell("Action required", f"Hello, {safe_name}", body)
        )

    # ------------------------------------------------------------------ #
    # send_document_status_update
    # ------------------------------------------------------------------ #
    def send_document_status_update(
        self,
        to_email: str,
        full_name: str,
        document_label: str,
        status_label: str,
        dashboard_link: str,
        note: str | None = None,
    ) -> None:
        safe_name = escape(full_name or "there")
        safe_label = escape(document_label)
        safe_status = escape(status_label)
        safe_link = escape(dashboard_link, quote=True)
        note_html = (
            f'<p style="margin:12px 0 0;color:#b45309;font-size:14px;line-height:1.6;">'
            f'<strong>Note:</strong> {escape(note)}</p>'
            if note else ""
        )
        subject = f"Document update: {document_label} — TalentAI"
        body = f"""
<p style="margin:0 0 20px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Hello {safe_name}, your <strong>{safe_label}</strong> was marked
  <strong>{safe_status}</strong>.
</p>
{note_html}
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0 0;">
  <tr>
    <td align="center">
      <a href="{safe_link}" class="cta-btn"
         style="display:inline-block;background:#0D5C91;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:8px;
                font-weight:600;font-size:15px;letter-spacing:0.2px;
                box-shadow:0 4px 16px rgba(13,92,145,.2);">
        Open documents
      </a>
    </td>
  </tr>
</table>
"""
        self._send(
            to_email, subject,
            self._branded_shell("Document update", "Verification update", body)
        )

    # ------------------------------------------------------------------ #
    # IT provisioning request (to IT manager)
    # ------------------------------------------------------------------ #
    def send_it_provisioning_request(
        self,
        *,
        to_email: str,
        recruiter_name: str,
        employee: dict | None,
        form_link: str,
        expires_at: str,
        note: str | None = None,
        is_reminder: bool = False,
    ) -> None:
        emp = employee or {}
        name = emp.get("full_name") or "the new hire"
        job_title = emp.get("job_title") or "—"
        department = emp.get("department") or "—"
        start_date = emp.get("start_date") or "—"
        personal_email = emp.get("email") or "—"
        safe_link = _escape_text(form_link, quote=True)
        safe_note = _escape_text(note or "")
        note_html = (
            f"""
<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:#fff8ef;border:1px solid #f3e0c2;border-radius:12px;margin:0 0 24px;">
  <tr>
    <td style="padding:18px 22px;">
      <p style="margin:0 0 6px;color:#9a6700;font-size:11px;font-weight:700;
                text-transform:uppercase;letter-spacing:1.2px;">Recruiter note</p>
      <p style="margin:0;color:#1a1a2e;font-size:14px;line-height:1.6;">{safe_note}</p>
    </td>
  </tr>
</table>
"""
            if safe_note
            else ""
        )
        headline = "Reminder: IT setup needed" if is_reminder else "IT setup requested"
        subject = (
            f"{'Reminder: ' if is_reminder else ''}IT provisioning for {name} — TalentAI"
        )
        body = f"""
<p style="margin:0 0 16px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Hi, <strong>{_escape_text(recruiter_name or 'a recruiter')}</strong> requested IT provisioning
  for <strong>{_escape_text(name)}</strong>.
</p>
<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;margin:0 0 24px;">
  <tr>
    <td style="padding:18px 22px;">
      <p style="margin:0 0 8px;color:#1a1a2e;font-size:14px;line-height:1.6;">
        <strong>Role:</strong> {_escape_text(job_title)} · {_escape_text(department)}
      </p>
      <p style="margin:0 0 8px;color:#1a1a2e;font-size:14px;line-height:1.6;">
        <strong>Start date:</strong> {_escape_text(start_date)}
      </p>
      <p style="margin:0;color:#1a1a2e;font-size:14px;line-height:1.6;">
        <strong>Personal email:</strong> {_escape_text(personal_email)}
      </p>
    </td>
  </tr>
</table>
{note_html}
<p style="margin:0 0 28px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Open the form to assign a company email, password, assets, and licenses.
  This link expires on <strong>{_escape_text(expires_at)}</strong>.
</p>
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 28px;">
  <tr>
    <td align="center">
      <a href="{safe_link}" class="cta-btn"
         style="display:inline-block;background:#0D5C91;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:8px;
                font-weight:600;font-size:15px;letter-spacing:0.2px;
                box-shadow:0 4px 16px rgba(13,92,145,.2);">
        Open IT setup form
      </a>
    </td>
  </tr>
</table>
<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;">
  <tr>
    <td style="padding:20px;">
      <p style="margin:0 0 4px;color:#6b7a8f;font-size:11px;font-weight:600;
                text-transform:uppercase;letter-spacing:0.8px;">
        Or copy this link into your browser
      </p>
      <p style="margin:0;font-family:monospace;font-size:12px;color:#1a1a2e;
                word-break:break-all;line-height:1.5;">
        {_escape_text(form_link)}
      </p>
    </td>
  </tr>
</table>
"""
        self._send(
            to_email,
            subject,
            self._branded_shell("IT Provisioning", headline, body),
        )

    def send_it_provisioning_batch_request(
        self,
        *,
        to_email: str,
        recruiter_name: str,
        entries: list[dict],
        expires_at: str,
        note: str | None = None,
    ) -> None:
        """One consolidated email to IT covering several new hires, each with
        their own secure form link (batch request)."""
        safe_note = _escape_text(note or "")
        note_html = (
            f"""
<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:#fff8ef;border:1px solid #f3e0c2;border-radius:12px;margin:0 0 24px;">
  <tr>
    <td style="padding:18px 22px;">
      <p style="margin:0 0 6px;color:#9a6700;font-size:11px;font-weight:700;
                text-transform:uppercase;letter-spacing:1.2px;">Recruiter note</p>
      <p style="margin:0;color:#1a1a2e;font-size:14px;line-height:1.6;">{safe_note}</p>
    </td>
  </tr>
</table>
"""
            if safe_note
            else ""
        )
        rows = []
        for i, entry in enumerate(entries, start=1):
            name = entry.get("full_name") or "a new hire"
            job_title = entry.get("job_title") or "—"
            department = entry.get("department") or "—"
            start_date = entry.get("start_date") or "—"
            personal_email = entry.get("email") or "—"
            safe_link = _escape_text(entry.get("form_link") or "", quote=True)
            rows.append(
                f"""
<tr>
  <td style="padding:14px 18px;border-bottom:1px solid #e8edf3;vertical-align:top;width:28px;color:#6b7a8f;font-weight:600;font-size:13px;">{i}</td>
  <td style="padding:14px 18px;border-bottom:1px solid #e8edf3;vertical-align:top;">
    <p style="margin:0 0 4px;color:#1a1a2e;font-size:14px;font-weight:700;">{_escape_text(name)}</p>
    <p style="margin:0;color:#6b7a8f;font-size:13px;line-height:1.5;">
      {_escape_text(job_title)} · {_escape_text(department)} · starts {_escape_text(start_date)}
      · {_escape_text(personal_email)}
    </p>
  </td>
  <td style="padding:14px 18px;border-bottom:1px solid #e8edf3;vertical-align:middle;text-align:right;width:150px;">
    <a href="{safe_link}" class="cta-btn"
       style="display:inline-block;background:#0D5C91;color:#ffffff;text-decoration:none;padding:9px 18px;border-radius:8px;font-weight:600;font-size:13px;">
      Open form
    </a>
  </td>
</tr>
"""
            )
        roster = "".join(rows)
        subject = f"IT provisioning for {len(entries)} new hire(s) — TalentAI"
        body = f"""
<p style="margin:0 0 16px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Hi, <strong>{_escape_text(recruiter_name or 'a recruiter')}</strong> requested IT provisioning for
  <strong>{len(entries)} new hire(s)</strong>. Each person has their own secure form below — open each
  form to assign a company email, password, assets, and licenses.
</p>
<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:#ffffff;border:1px solid #e8edf3;border-radius:12px;margin:0 0 24px;">
  <thead>
    <tr style="background:#f7f9fc;">
      <th style="padding:10px 18px;color:#6b7a8f;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;text-align:left;">#</th>
      <th style="padding:10px 18px;color:#6b7a8f;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;text-align:left;">New hire</th>
      <th style="padding:10px 18px;color:#6b7a8f;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;text-align:right;">Form</th>
    </tr>
  </thead>
  <tbody>{roster}</tbody>
</table>
{note_html}
<p style="margin:0 0 28px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  The links expire on <strong>{_escape_text(expires_at)}</strong>. Follow up with the recruiter if any
  form is missing details.
</p>
"""
        self._send(
            to_email,
            subject,
            self._branded_shell("IT Provisioning", "IT setup requested for a batch", body),
        )

    def send_it_provisioning_batch_form_request(
        self,
        *,
        to_email: str,
        recruiter_name: str,
        entries: list[dict],
        form_link: str,
        expires_at: str,
        note: str | None = None,
    ) -> None:
        """One email to IT with a SINGLE bulk form link covering all new hires."""
        safe_note = _escape_text(note or "")
        note_html = (
            f"""
<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:#fff8ef;border:1px solid #f3e0c2;border-radius:12px;margin:0 0 24px;">
  <tr>
    <td style="padding:18px 22px;">
      <p style="margin:0 0 6px;color:#9a6700;font-size:11px;font-weight:700;
                text-transform:uppercase;letter-spacing:1.2px;">Recruiter note</p>
      <p style="margin:0;color:#1a1a2e;font-size:14px;line-height:1.6;">{safe_note}</p>
    </td>
  </tr>
</table>
"""
            if safe_note
            else ""
        )
        rows = []
        for i, entry in enumerate(entries, start=1):
            name = entry.get("full_name") or "a new hire"
            job_title = entry.get("job_title") or "—"
            department = entry.get("department") or "—"
            start_date = entry.get("start_date") or "—"
            personal_email = entry.get("email") or "—"
            rows.append(
                f"""
<tr>
  <td style="padding:10px 18px;border-bottom:1px solid #e8edf3;vertical-align:top;color:#6b7a8f;font-weight:600;font-size:13px;">{i}</td>
  <td style="padding:10px 18px;border-bottom:1px solid #e8edf3;vertical-align:top;">
    <p style="margin:0;color:#1a1a2e;font-size:14px;font-weight:700;">{_escape_text(name)}</p>
    <p style="margin:0;color:#6b7a8f;font-size:13px;line-height:1.5;">
      {_escape_text(job_title)} · {_escape_text(department)} · starts {_escape_text(start_date)}
      · {_escape_text(personal_email)}
    </p>
  </td>
</tr>
"""
            )
        roster = "".join(rows)
        safe_link = _escape_text(form_link or "", quote=True)
        subject = f"IT provisioning for {len(entries)} new hire(s) — one form — TalentAI"
        body = f"""
<p style="margin:0 0 16px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Hi, <strong>{_escape_text(recruiter_name or 'a recruiter')}</strong> requested IT provisioning for
  <strong>{len(entries)} new hire(s)</strong>. Use the single form below to assign company emails,
  passwords, assets, and licenses for everyone on this list at once.
</p>
<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:#ffffff;border:1px solid #e8edf3;border-radius:12px;margin:0 0 24px;">
  <thead>
    <tr style="background:#f7f9fc;">
      <th style="padding:10px 18px;color:#6b7a8f;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;text-align:left;">#</th>
      <th style="padding:10px 18px;color:#6b7a8f;font-size:11px;text-transform:uppercase;letter-spacing:0.8px;text-align:left;">New hire</th>
    </tr>
  </thead>
  <tbody>{roster}</tbody>
</table>
{note_html}
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 28px;">
  <tr>
    <td align="center">
      <a href="{safe_link}" class="cta-btn"
         style="display:inline-block;background:#0D5C91;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:8px;
                font-weight:600;font-size:15px;letter-spacing:0.2px;
                box-shadow:0 4px 16px rgba(13,92,145,.2);">
        Open bulk IT form
      </a>
    </td>
  </tr>
</table>
<p style="margin:0 0 28px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  The link expires on <strong>{_escape_text(expires_at)}</strong>.
</p>
"""
        self._send(
            to_email,
            subject,
            self._branded_shell("IT Provisioning", "IT setup requested for a batch", body),
        )

    def send_it_provisioning_complete(
        self,
        *,
        to_email: str,
        employee_name: str,
        company_email: str,
        assets_count: int = 0,
        licenses_count: int = 0,
    ) -> None:
        safe_name = _escape_text(employee_name or "the candidate")
        subject = f"IT provisioning complete for {employee_name or 'candidate'} — TalentAI"
        body = f"""
<p style="margin:0 0 16px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  IT finished provisioning for <strong>{safe_name}</strong>. You can now approve and activate
  the employee from the candidate pipeline.
</p>
<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;margin:0 0 8px;">
  <tr>
    <td style="padding:18px 22px;">
      <p style="margin:0 0 8px;color:#1a1a2e;font-size:14px;line-height:1.6;">
        <strong>Company email:</strong> {_escape_text(company_email)}
      </p>
      <p style="margin:0;color:#1a1a2e;font-size:14px;line-height:1.6;">
        <strong>Assets:</strong> {int(assets_count)} · <strong>Licenses:</strong> {int(licenses_count)}
      </p>
    </td>
  </tr>
</table>
"""
        self._send(
            to_email,
            subject,
            self._branded_shell("IT Provisioning", "Ready to activate", body),
        )

    # ------------------------------------------------------------------ #
    # IT updated a submitted provisioning request
    # ------------------------------------------------------------------ #
    def send_it_provisioning_edited(
        self,
        *,
        to_email: str,
        employee_name: str,
        company_email: str,
        assets_count: int = 0,
        licenses_count: int = 0,
    ) -> None:
        safe_name = _escape_text(employee_name or "the candidate")
        subject = f"IT provisioning updated for {employee_name or 'candidate'} — TalentAI"
        body = f"""
<p style="margin:0 0 16px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  IT updated the provisioning for <strong>{safe_name}</strong>. The latest details below
  are what will be used when you activate the employee.
</p>
<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;margin:0 0 8px;">
  <tr>
    <td style="padding:18px 22px;">
      <p style="margin:0 0 8px;color:#1a1a2e;font-size:14px;line-height:1.6;">
        <strong>Company email:</strong> {_escape_text(company_email)}
      </p>
      <p style="margin:0;color:#1a1a2e;font-size:14px;line-height:1.6;">
        <strong>Assets:</strong> {int(assets_count)} · <strong>Licenses:</strong> {int(licenses_count)}
      </p>
    </td>
  </tr>
</table>
"""
        self._send(
            to_email,
            subject,
            self._branded_shell("IT Provisioning", "Provisioning updated", body),
        )

    # ------------------------------------------------------------------ #
    # IT reset the employee's account password (emailed to both logins)
    # ------------------------------------------------------------------ #
    def send_it_password_reset(
        self,
        to_email: str,
        full_name: str | None = None,
        temp_password: str | None = None,
    ) -> None:
        subject = "Your password was reset by IT — TalentAI"
        body = f"""
<p style="margin:0 0 16px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Hello {escape(full_name or "there")}, the IT team reset your TalentAI password.
</p>
<p style="margin:0 0 8px;color:#1a1a2e;font-size:14px;line-height:1.6;">
  Your temporary password is:
</p>
<p style="margin:0 0 18px;font-size:20px;font-weight:800;color:#1e3a5f;font-family:Consolas,Menlo,monospace;">
  {escape(temp_password or "")}
</p>
<p style="margin:0;color:#8a9bb0;font-size:13px;line-height:1.6;">
  You can sign in with either your personal or company email using this password.
  Change it anytime from the Security section of your profile.
</p>
"""
        self._send(
            to_email,
            subject,
            self._branded_shell("Account security", "Your password was reset", body),
        )

    # ------------------------------------------------------------------ #
    # First-time password (sent at activation / IT reset)
    # ------------------------------------------------------------------ #
    def send_first_time_password(
        self,
        to_email: str,
        full_name: str | None = None,
        temp_password: str | None = None,
    ) -> None:
        subject = "Your employee account is ready — TalentAI"
        body = f"""
<p style="margin:0 0 16px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Hello {escape(full_name or "there")}, your employee account is ready.
</p>
<p style="margin:0 0 8px;color:#1a1a2e;font-size:14px;line-height:1.6;">
  Sign in with your personal or company email using this one-time password:
</p>
<p style="margin:0 0 18px;font-size:20px;font-weight:800;color:#1e3a5f;font-family:Consolas,Menlo,monospace;">
  {escape(temp_password or "")}
</p>
<p style="margin:0;color:#8a9bb0;font-size:13px;line-height:1.6;">
  After signing in you will be asked to create your own password. From then on,
  that single password covers both your personal and company email logins.
</p>
"""
        self._send(
            to_email,
            subject,
            self._branded_shell("Account ready", "Set your password", body),
        )

    # ------------------------------------------------------------------ #
    # Banking details notice (employee — after recruiter adds/updates)
    # ------------------------------------------------------------------ #
    def send_banking_details_notice(
        self,
        *,
        to_email: str,
        full_name: str,
        bank_name: str,
        account_holder_name: str,
        iban: str,
        is_update: bool = False,
    ) -> None:
        safe_name = _escape_text(full_name or "Employee")
        headline = "Banking details updated" if is_update else "Banking details added"
        subject = f"{headline} — TalentAI"
        masked_iban = iban or ""
        if len(masked_iban) > 8:
            masked_iban = f"{masked_iban[:4]}****{masked_iban[-4:]}"
        body = f"""
<p style="margin:0 0 16px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Hi {safe_name}, your recruiter {"updated" if is_update else "added"} your payroll banking details.
  You can review them (view only) on your employee profile.
</p>
<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;margin:0 0 24px;">
  <tr>
    <td style="padding:18px 22px;">
      <p style="margin:0 0 8px;color:#1a1a2e;font-size:14px;line-height:1.6;">
        <strong>Bank:</strong> {_escape_text(bank_name or "—")}
      </p>
      <p style="margin:0 0 8px;color:#1a1a2e;font-size:14px;line-height:1.6;">
        <strong>Account title:</strong> {_escape_text(account_holder_name or "—")}
      </p>
      <p style="margin:0;color:#1a1a2e;font-size:14px;line-height:1.6;">
        <strong>IBAN:</strong> {_escape_text(masked_iban or "—")}
      </p>
    </td>
  </tr>
</table>
<p style="margin:0;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Sign in and open <strong>My Profile → Banking</strong> to see the full details.
</p>
"""
        self._send(
            to_email,
            subject,
            self._branded_shell("Payroll banking", headline, body),
        )

    # ------------------------------------------------------------------ #
    # send_company_email_assigned
    # ------------------------------------------------------------------ #
    def send_company_email_assigned(self, to_email: str, full_name: str, company_email: str) -> None:
        subject = "Your company email has been assigned — TalentAI"
        body = f"""
<p style="margin:0 0 20px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Hello {escape(full_name)}, your recruiter has recorded your official company email.
  Please use this address for workplace communications going forward.
</p>
<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;
              margin:0 0 8px;">
  <tr>
    <td style="padding:24px;">
      <p style="margin:0 0 6px;color:#6b7a8f;font-size:11px;font-weight:700;
                text-transform:uppercase;letter-spacing:1.2px;">
        Company email
      </p>
      <p style="margin:0;color:#0D5C91;font-size:24px;font-weight:700;letter-spacing:1px;">
        {escape(company_email)}
      </p>
    </td>
  </tr>
</table>
"""
        self._send(
            to_email, subject,
            self._branded_shell("Company credentials", f"Welcome aboard, {escape(full_name)}", body)
        )

    # ------------------------------------------------------------------ #
    # send_asset_assigned
    # ------------------------------------------------------------------ #
    def send_asset_assigned(
        self,
        to_email: str,
        full_name: str,
        asset_name: str,
        asset_type: str,
        serial_number: str | None = None,
    ) -> None:
        subject = f"Asset assigned: {asset_name} — TalentAI"
        serial_html = (
            f'<p style="margin:8px 0 0;color:#475569;font-size:13px;">'
            f'<strong>Serial:</strong> {escape(serial_number)}</p>'
            if serial_number else ""
        )
        body = f"""
<p style="margin:0 0 20px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Hello {escape(full_name)}, a company asset has been assigned to you.
  Please keep it safe and report any issues to HR.
</p>
<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;">
  <tr>
    <td style="padding:24px;">
      <p style="margin:0 0 4px;color:#0D5C91;font-size:18px;font-weight:700;">
        {escape(asset_name)}
      </p>
      <p style="margin:0;color:#6b7a8f;font-size:14px;">
        Type: {escape(asset_type)}
      </p>
      {serial_html}
    </td>
  </tr>
</table>
"""
        self._send(
            to_email, subject,
            self._branded_shell("Company assets", "New asset assigned", body)
        )

    # ------------------------------------------------------------------ #
    # send_orientation_scheduled
    # ------------------------------------------------------------------ #
    def send_orientation_scheduled(
        self,
        to_email: str,
        full_name: str,
        date: str,
        time: str,
        trainer: str,
        agenda: str,
        meeting_link: str | None = None,
        is_update: bool = False,
    ) -> None:
        subject = (
            "Orientation session updated — TalentAI"
            if is_update
            else "Your orientation session is scheduled — TalentAI"
        )
        link_html = ""
        if meeting_link:
            safe_ml = escape(meeting_link, quote=True)
            link_html = (
                f'<p style="margin:12px 0 0;">'
                f'<a href="{safe_ml}" style="color:#0D5C91;font-weight:600;text-decoration:none;">'
                f'Join meeting →</a></p>'
            )
        body = f"""
<p style="margin:0 0 20px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Hello {escape(full_name)},
  {"your orientation details were updated" if is_update else "your onboarding orientation has been scheduled"}.
</p>
<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;
              margin:0 0 24px;">
  <tr>
    <td style="padding:24px;">
      <p style="margin:0 0 4px;color:#0D5C91;font-size:18px;font-weight:700;">
        {escape(date)}&ensp;&middot;&ensp;{escape(time)}
      </p>
      <p style="margin:0;color:#6b7a8f;font-size:14px;">
        <strong>Trainer:</strong> {escape(trainer)}
      </p>
      {link_html}
    </td>
  </tr>
</table>
<p style="margin:0 0 6px;color:#6b7a8f;font-size:11px;font-weight:700;
          text-transform:uppercase;letter-spacing:0.8px;">
  Agenda
</p>
<p style="margin:0;color:#1a1a2e;font-size:14px;line-height:1.7;white-space:pre-wrap;">
  {escape(agenda)}
</p>
"""
        eyebrow = "Orientation update" if is_update else "Orientation session"
        self._send(
            to_email, subject,
            self._branded_shell(eyebrow, "You&rsquo;re invited", body)
        )

    # ------------------------------------------------------------------ #
    # send_profile_completion_reminder
    # ------------------------------------------------------------------ #
    def send_profile_completion_reminder(
        self,
        to_email: str,
        full_name: str,
        employee_id: str,
        missing_labels: list[str],
        dashboard_link: str,
        recruiter_note: str | None = None,
    ) -> None:
        safe_name = escape(full_name or "there")
        safe_id = escape(employee_id or "")
        safe_link = escape(dashboard_link, quote=True)
        missing_items = "".join(
            f'<li style="margin:0 0 6px;color:#1a1a2e;font-size:14px;">{escape(label)}</li>'
            for label in (missing_labels or ["Complete remaining profile steps"])
        )
        note_html = (
            f'<p style="margin:16px 0 0;color:#1a1a2e;font-size:13px;line-height:1.6;">'
            f'<strong>Note from your recruiter:</strong> {escape(recruiter_note)}</p>'
            if recruiter_note else ""
        )
        subject = "Reminder: Complete your employee profile — TalentAI"
        body = f"""
<p style="margin:0 0 20px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Hello {safe_name}, your recruiter is waiting on a few post-hire details before
  your onboarding is finished. Employee ID <strong>{safe_id}</strong>.
</p>
<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;
              margin:0 0 24px;">
  <tr>
    <td style="padding:22px;">
      <p style="margin:0 0 10px;color:#6b7a8f;font-size:11px;font-weight:700;
                text-transform:uppercase;letter-spacing:1.2px;">
        Still needed
      </p>
      <ul style="margin:0;padding-left:20px;">{missing_items}</ul>
      {note_html}
    </td>
  </tr>
</table>
<table cellpadding="0" cellspacing="0" border="0" width="100%">
  <tr>
    <td align="center">
      <a href="{safe_link}" class="cta-btn"
         style="display:inline-block;background:#0D5C91;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:8px;
                font-weight:600;font-size:15px;letter-spacing:0.2px;
                box-shadow:0 4px 16px rgba(13,92,145,.2);">
        Complete your profile
      </a>
    </td>
  </tr>
</table>
"""
        self._send(
            to_email, subject,
            self._branded_shell("Action required", "Complete your profile", body)
        )

    # ------------------------------------------------------------------ #
    # send_candidate_onboarding_reminder
    # ------------------------------------------------------------------ #
    def send_candidate_onboarding_reminder(
        self,
        to_email: str,
        full_name: str,
        missing_labels: list[str],
        dashboard_link: str,
        recruiter_note: str | None = None,
    ) -> None:
        safe_name = escape(full_name or "there")
        safe_link = escape(dashboard_link, quote=True)
        missing_items = "".join(
            f'<li style="margin:0 0 6px;color:#1a1a2e;font-size:14px;">{escape(label)}</li>'
            for label in (missing_labels or ["Complete remaining onboarding steps"])
        )
        note_html = (
            f'<p style="margin:16px 0 0;color:#1a1a2e;font-size:13px;line-height:1.6;">'
            f'<strong>Note from your recruiter:</strong> {escape(recruiter_note)}</p>'
            if recruiter_note else ""
        )
        subject = "Reminder: Complete your onboarding — TalentAI"
        body = f"""
<p style="margin:0 0 20px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Hello {safe_name}, your recruiter is waiting for a few onboarding details
  before they can review your application.
</p>
<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;
              margin:0 0 24px;">
  <tr>
    <td style="padding:22px;">
      <p style="margin:0 0 10px;color:#6b7a8f;font-size:11px;font-weight:700;
                text-transform:uppercase;letter-spacing:1.2px;">
        Still needed
      </p>
      <ul style="margin:0;padding-left:20px;">{missing_items}</ul>
      {note_html}
    </td>
  </tr>
</table>
<table cellpadding="0" cellspacing="0" border="0" width="100%">
  <tr>
    <td align="center">
      <a href="{safe_link}" class="cta-btn"
         style="display:inline-block;background:#0D5C91;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:8px;
                font-weight:600;font-size:15px;letter-spacing:0.2px;
                box-shadow:0 4px 16px rgba(13,92,145,.2);">
        Continue onboarding
      </a>
    </td>
  </tr>
</table>
"""
        self._send(
            to_email, subject,
            self._branded_shell("Action required", "Complete your onboarding", body)
        )

    # ------------------------------------------------------------------ #
    # send_announcement - FIXED (title appears only once)
    # ------------------------------------------------------------------ #
    def send_announcement(
        self,
        to_email: str,
        full_name: str,
        title: str,
        body_text: str,
        dashboard_url: str | None = None,
    ) -> None:
        subject = f"Announcement: {title} — TalentAI"
        link_html = ""
        if dashboard_url:
            safe_url = escape(dashboard_url, quote=True)
            link_html = f"""
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:28px;">
  <tr>
    <td align="center">
      <a href="{safe_url}" class="cta-btn"
         style="display:inline-block;background:#0D5C91;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:8px;
                font-weight:600;font-size:15px;letter-spacing:0.2px;
                box-shadow:0 4px 16px rgba(13,92,145,.2);">
        Open dashboard
      </a>
    </td>
  </tr>
</table>"""
        body = f"""
<p style="margin:0 0 20px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Hello {escape(full_name)}, your recruiting team shared a new announcement.
</p>
<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;
              margin:0 0 8px;">
  <tr>
    <td style="padding:22px;">
      <p style="margin:0;color:#1a1a2e;font-size:15px;line-height:1.7;white-space:pre-wrap;">
        {escape(body_text)}
      </p>
    </td>
  </tr>
</table>
{link_html}
"""
        self._send(
            to_email, subject,
            self._branded_shell("Team announcement", escape(title), body)
        )

    # ------------------------------------------------------------------ #
    # send_custom_reminder
    # ------------------------------------------------------------------ #
    def send_custom_reminder(
        self,
        to_email: str,
        full_name: str,
        *,
        title: str,
        body_text: str,
        cta_link: str,
        cta_label: str = "Open dashboard",
        recruiter_note: str | None = None,
        eyebrow: str = "Reminder",
    ) -> None:
        safe_name = escape(full_name or "there")
        safe_link = escape(cta_link, quote=True)
        note_html = (
            f'<p style="margin:16px 0 0;color:#1a1a2e;font-size:13px;line-height:1.6;">'
            f'<strong>Note from your recruiter:</strong> {escape(recruiter_note)}</p>'
            if recruiter_note else ""
        )
        subject = f"Reminder: {title} — TalentAI"
        body = f"""
<p style="margin:0 0 24px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Hello {safe_name}, your recruiter sent you a reminder.
</p>
<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;
              margin:0 0 28px;">
  <tr>
    <td style="padding:22px;">
      <p style="margin:0 0 10px;color:#6b7a8f;font-size:11px;font-weight:700;
                text-transform:uppercase;letter-spacing:1.2px;">
        {escape(title)}
      </p>
      <p style="margin:0;color:#1a1a2e;font-size:14px;line-height:1.7;white-space:pre-wrap;">
        {escape(body_text)}
      </p>
      {note_html}
    </td>
  </tr>
</table>
<table cellpadding="0" cellspacing="0" border="0" width="100%">
  <tr>
    <td align="center">
      <a href="{safe_link}" class="cta-btn"
         style="display:inline-block;background:#0D5C91;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:8px;
                font-weight:600;font-size:15px;letter-spacing:0.2px;
                box-shadow:0 4px 16px rgba(13,92,145,.2);">
        {escape(cta_label)}
      </a>
    </td>
  </tr>
</table>
"""
        self._send(
            to_email, subject,
            self._branded_shell(eyebrow, title, body)
        )

    # ------------------------------------------------------------------ #
    # send_hr_message
    # ------------------------------------------------------------------ #
    def send_hr_message(
        self,
        to_email: str,
        full_name: str,
        *,
        subject_line: str,
        body_text: str,
        sender_label: str,
        cta_link: str,
        cta_label: str = "Open conversation",
    ) -> None:
        safe_name = escape(full_name or "there")
        safe_link = escape(cta_link, quote=True)
        subject = f"Message: {subject_line} — TalentAI"
        body = f"""
<p style="margin:0 0 24px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Hello {safe_name}, you have a new message from <strong>{escape(sender_label)}</strong>.
</p>
<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:#f7f9fc;border:1px solid #e8edf3;border-radius:12px;
              margin:0 0 28px;">
  <tr>
    <td style="padding:22px;">
      <p style="margin:0 0 10px;color:#0D5C91;font-size:18px;font-weight:700;">
        {escape(subject_line)}
      </p>
      <p style="margin:0;color:#1a1a2e;font-size:14px;line-height:1.7;white-space:pre-wrap;">
        {escape(body_text)}
      </p>
    </td>
  </tr>
</table>
<table cellpadding="0" cellspacing="0" border="0" width="100%">
  <tr>
    <td align="center">
      <a href="{safe_link}" class="cta-btn"
         style="display:inline-block;background:#0D5C91;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:8px;
                font-weight:600;font-size:15px;letter-spacing:0.2px;
                box-shadow:0 4px 16px rgba(13,92,145,.2);">
        {escape(cta_label)}
      </a>
    </td>
  </tr>
</table>
"""
        self._send(
            to_email, subject,
            self._branded_shell("New message", subject_line, body)
        )

    # ------------------------------------------------------------------ #
    # send_password_changed_notification
    # ------------------------------------------------------------------ #
    def send_password_changed_notification(self, to_email: str, full_name: str | None = None) -> None:
        subject = "Your password was changed — TalentAI"
        body = f"""
<p style="margin:0 0 20px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Hello {escape(full_name or "there")}, the password for your TalentAI account was
  recently changed. The new password now applies to <strong>both</strong> your
  personal and company email sign-in.
</p>
<p style="margin:0;color:#8a9bb0;font-size:13px;line-height:1.6;">
  If this wasn&rsquo;t you, use the forgot-password option on the sign-in page to
  recover your account, then contact HR.
</p>
"""
        self._send(
            to_email,
            subject,
            self._branded_shell("Account security", "Your password was changed", body),
        )

    # ------------------------------------------------------------------ #
    # send_password_reset_completed
    # ------------------------------------------------------------------ #
    def send_password_reset_completed(self, to_email: str, full_name: str | None = None) -> None:
        subject = "Your password was reset — TalentAI"
        body = f"""
<p style="margin:0 0 20px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Hello {escape(full_name or "there")}, your TalentAI password was reset using the
  account recovery option. The new password works with <strong>both</strong> your
  personal and company email sign-in.
</p>
<p style="margin:0;color:#8a9bb0;font-size:13px;line-height:1.6;">
  If this wasn&rsquo;t you, contact HR right away.
</p>
"""
        self._send(
            to_email,
            subject,
            self._branded_shell("Account recovery", "Your password was reset", body),
        )


# Singleton instance
email_service = EmailService()

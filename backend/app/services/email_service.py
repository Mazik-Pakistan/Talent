"""SMTP-based email service with HTML templates for TalentAI."""

import smtplib
import ssl
from html import escape
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.core.config import settings


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
        msg = self._build_message(to_email, subject, html_body)
        context = ssl.create_default_context()
        try:
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
                      text-transform:uppercase;letter-spacing:1.2px;">{escape(eyebrow)}</p>
            <h1 style="margin:0 0 24px;color:#1a1a2e;font-size:28px;font-weight:700;
                       line-height:1.3;letter-spacing:-0.3px;">{title}</h1>
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
        safe_link = escape(invite_link, quote=True)
        body = f"""
<p style="margin:0 0 16px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  You have been invited to join <strong>TalentAI</strong> as a candidate for the position of
  <strong>{escape(job_title)}</strong> in the <strong>{escape(department)}</strong> department.
</p>
<p style="margin:0 0 28px;color:#1a1a2e;font-size:15px;line-height:1.7;">
  Click the button below to complete your registration and begin onboarding.
  This invitation expires on <strong>{escape(expires_at)}</strong>.
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
        {escape(invite_link)}
      </p>
    </td>
  </tr>
</table>
"""
        self._send(
            to_email, subject,
            self._branded_shell("Candidate Invitation", f"Hello, {escape(full_name)} 👋", body)
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
  references, policies, and NDA) so HR can finish your onboarding.
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
        {escape(job_title)}
      </p>
      <p style="margin:0;color:#6b7a8f;font-size:14px;">
        {escape(department)}&ensp;&middot;&ensp;Starting {escape(start_date)}
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
            self._branded_shell("Offer Letter", f"You&rsquo;ve been offered a role, {escape(full_name)}!", body)
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
        Still needed      </p>
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

<!-- Announcement card -->
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


# Singleton instance
email_service = EmailService()
"""SMTP-based email service with HTML templates for TalentAI."""

import smtplib
import ssl
from html import escape
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.core.config import settings


class EmailService:
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
    # Templates
    # ------------------------------------------------------------------ #

    def send_signup_otp(self, to_email: str, full_name: str, otp: str) -> None:
        subject = "Verify Your Email – TalentAI"
        html = f"""
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Email Verification – TalentAI</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1e3a5f 0%,#2d6cdf 100%);padding:36px 40px;">
            <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:-0.5px;">TalentAI</h1>
            <p style="margin:4px 0 0;color:rgba(255,255,255,0.75);font-size:13px;">by Mazik Global</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:40px;">
            <p style="margin:0 0 8px;color:#64748b;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;">Email Verification</p>
            <h2 style="margin:0 0 20px;color:#0f172a;font-size:22px;font-weight:700;">Hello, {full_name} 👋</h2>
            <p style="margin:0 0 28px;color:#475569;font-size:15px;line-height:1.6;">
              Use the one-time code below to verify your email address and activate your TalentAI account.
              This code expires in <strong>10 minutes</strong>.
            </p>
            <!-- OTP Box -->
            <div style="background:#f1f5fe;border:2px solid #2d6cdf;border-radius:10px;padding:28px;text-align:center;margin-bottom:28px;">
              <p style="margin:0 0 8px;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Your verification code</p>
              <p style="margin:0;color:#1e3a5f;font-size:42px;font-weight:800;letter-spacing:12px;">{otp}</p>
            </div>
            <p style="margin:0 0 8px;color:#94a3b8;font-size:13px;">
              If you didn't create a TalentAI account, you can safely ignore this email.
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;">
            <p style="margin:0;color:#94a3b8;font-size:12px;">© 2025 Mazik Global – TalentAI. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
"""
        self._send(to_email, subject, html)

    def send_forgot_password_otp(self, to_email: str, otp: str) -> None:
        subject = "Reset Your Password – TalentAI"
        html = f"""
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Password Reset – TalentAI</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#1e3a5f 0%,#2d6cdf 100%);padding:36px 40px;">
            <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:-0.5px;">TalentAI</h1>
            <p style="margin:4px 0 0;color:rgba(255,255,255,0.75);font-size:13px;">by Mazik Global</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <p style="margin:0 0 8px;color:#64748b;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;">Account Recovery</p>
            <h2 style="margin:0 0 20px;color:#0f172a;font-size:22px;font-weight:700;">Reset Your Password</h2>
            <p style="margin:0 0 28px;color:#475569;font-size:15px;line-height:1.6;">
              We received a request to reset your TalentAI password. Use the code below to proceed.
              This code expires in <strong>10 minutes</strong>.
            </p>
            <div style="background:#fff7ed;border:2px solid #f97316;border-radius:10px;padding:28px;text-align:center;margin-bottom:28px;">
              <p style="margin:0 0 8px;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Your password reset code</p>
              <p style="margin:0;color:#9a3412;font-size:42px;font-weight:800;letter-spacing:12px;">{otp}</p>
            </div>
            <p style="margin:0;color:#94a3b8;font-size:13px;">
              If you didn't request this, you can safely ignore this email. Your password won't change.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;">
            <p style="margin:0;color:#94a3b8;font-size:12px;">© 2025 Mazik Global – TalentAI. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
"""
        self._send(to_email, subject, html)

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
        html = f"""
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Invitation – TalentAI</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#1e3a5f 0%,#2d6cdf 100%);padding:36px 40px;">
            <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:-0.5px;">TalentAI</h1>
            <p style="margin:4px 0 0;color:rgba(255,255,255,0.75);font-size:13px;">by Mazik Global</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <p style="margin:0 0 8px;color:#64748b;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;">Candidate Invitation</p>
            <h2 style="margin:0 0 20px;color:#0f172a;font-size:22px;font-weight:700;">Hello, {full_name} 👋</h2>
            <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;">
              You have been invited to join <strong>TalentAI</strong> as a candidate for the position of
              <strong>{job_title}</strong> in the <strong>{department}</strong> department.
            </p>
            <p style="margin:0 0 28px;color:#475569;font-size:15px;line-height:1.6;">
              Click the button below to complete your registration and begin onboarding. 
              This invitation expires on <strong>{expires_at}</strong>.
            </p>
            <div style="text-align:center;margin-bottom:32px;">
              <a href="{invite_link}" style="display:inline-block;background:linear-gradient(135deg,#1e3a5f 0%,#2d6cdf 100%);color:#ffffff;text-decoration:none;padding:16px 40px;border-radius:8px;font-size:16px;font-weight:700;letter-spacing:0.3px;">Accept Invitation</a>
            </div>
            <p style="margin:0 0 8px;color:#94a3b8;font-size:13px;">Or copy this link into your browser:</p>
            <p style="margin:0;background:#f1f5f9;border-radius:6px;padding:10px 14px;font-family:monospace;font-size:12px;color:#475569;word-break:break-all;">{invite_link}</p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;">
            <p style="margin:0;color:#94a3b8;font-size:12px;">© 2025 Mazik Global – TalentAI. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
"""
        self._send(to_email, subject, html)

    def send_employee_welcome(
        self,
        to_email: str,
        full_name: str,
        employee_id: str,
        job_title: str,
        department: str,
    ) -> None:
        subject = "Congratulations — Welcome to TalentAI"
        html = f"""
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Welcome – TalentAI</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#1e3a5f 0%,#2d6cdf 100%);padding:36px 40px;">
            <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:-0.5px;">TalentAI</h1>
            <p style="margin:4px 0 0;color:rgba(255,255,255,0.75);font-size:13px;">by Mazik Global</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <p style="margin:0 0 8px;color:#64748b;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;">Congratulations</p>
            <h2 style="margin:0 0 20px;color:#0f172a;font-size:22px;font-weight:700;">Welcome aboard, {full_name}!</h2>
            <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;">
              Your onboarding has been approved and you are now an official employee at Mazik Global.
            </p>
            <div style="background:#f1f5fe;border:2px solid #2d6cdf;border-radius:10px;padding:20px;margin-bottom:28px;">
              <p style="margin:0 0 8px;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;">Your Employee ID</p>
              <p style="margin:0;color:#1e3a5f;font-size:28px;font-weight:800;letter-spacing:2px;">{employee_id}</p>
              <p style="margin:12px 0 0;color:#475569;font-size:14px;">{job_title} · {department}</p>
            </div>
            <p style="margin:0;color:#475569;font-size:15px;line-height:1.6;">
              Sign in to TalentAI and choose the <strong>Employee</strong> role to open your employee dashboard.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;">
            <p style="margin:0;color:#94a3b8;font-size:12px;">© 2026 Mazik Global – TalentAI. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
"""
        self._send(to_email, subject, html)

    def send_offer_letter(
        self,
        to_email: str,
        full_name: str,
        job_title: str,
        department: str,
        start_date: str,
    ) -> None:
        subject = f"Your Offer Letter for {job_title} — TalentAI"
        html = f"""
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Offer Letter – TalentAI</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#123a63 0%,#32a6ae 100%);padding:36px 40px;">
            <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:-0.5px;">TalentAI</h1>
            <p style="margin:4px 0 0;color:rgba(255,255,255,0.75);font-size:13px;">by Mazik Global</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <p style="margin:0 0 8px;color:#64748b;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;">Offer Letter</p>
            <h2 style="margin:0 0 20px;color:#0f172a;font-size:22px;font-weight:700;">You've been offered a role, {full_name}!</h2>
            <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;">
              We're delighted to offer you the position below. Sign in to review the full terms and digitally sign your offer letter.
            </p>
            <div style="background:#f1f5fe;border:2px solid #32a6ae;border-radius:10px;padding:20px;margin-bottom:28px;">
              <p style="margin:0 0 4px;color:#123a63;font-size:18px;font-weight:800;">{job_title}</p>
              <p style="margin:0;color:#475569;font-size:14px;">{department} · Starting {start_date}</p>
            </div>
            <p style="margin:0;color:#475569;font-size:15px;line-height:1.6;">
              Sign in to your candidate dashboard and open <strong>My Offer Letter</strong> to review and sign.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;">
            <p style="margin:0;color:#94a3b8;font-size:12px;">© 2026 Mazik Global – TalentAI. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
"""
        self._send(to_email, subject, html)

    def send_document_reupload_request(
        self,
        to_email: str,
        full_name: str,
        document_label: str,
        reason: str,
        note: str | None,
        dashboard_link: str,
    ) -> None:
        """Tell a candidate exactly which document must be replaced."""
        safe_name = escape(full_name or "Candidate")
        safe_label = escape(document_label)
        safe_reason = escape(reason)
        safe_note = escape(note or "")
        safe_link = escape(dashboard_link, quote=True)
        note_html = (
            f'<p style="margin:12px 0 0;color:#475569;font-size:14px;"><strong>Recruiter note:</strong> {safe_note}</p>'
            if safe_note
            else ""
        )
        subject = f"Action required: Re-upload your {safe_label} — TalentAI"
        html = f"""
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Document Re-upload Required – TalentAI</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#123a63 0%,#32a6ae 100%);padding:32px 40px;">
            <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;">TalentAI</h1>
            <p style="margin:4px 0 0;color:rgba(255,255,255,0.75);font-size:13px;">Document verification update</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <p style="margin:0 0 8px;color:#b45309;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;">Action required</p>
            <h2 style="margin:0 0 18px;color:#0f172a;font-size:22px;">Hello, {safe_name}</h2>
            <p style="margin:0 0 22px;color:#475569;font-size:15px;line-height:1.6;">
              Your recruiter has requested a new copy of your <strong>{safe_label}</strong>.
              Only this document needs to be replaced.
            </p>
            <div style="background:#fff7ed;border:1px solid #fdba74;border-radius:10px;padding:18px;margin-bottom:26px;">
              <p style="margin:0;color:#9a3412;font-size:14px;"><strong>Reason:</strong> {safe_reason}</p>
              {note_html}
            </div>
            <div style="text-align:center;margin-bottom:24px;">
              <a href="{safe_link}" style="display:inline-block;background:#123a63;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-size:15px;font-weight:700;">Open dashboard and re-upload</a>
            </div>
            <p style="margin:0;color:#64748b;font-size:13px;line-height:1.5;">
              The replacement will be validated and sent back to your recruiter automatically.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
"""
        self._send(to_email, subject, html)

    def _branded_shell(self, eyebrow: str, title: str, body_html: str) -> str:
        return f"""
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>{escape(eyebrow)} – TalentAI</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#123a63 0%,#32a6ae 100%);padding:32px 40px;">
            <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;">TalentAI</h1>
            <p style="margin:4px 0 0;color:rgba(255,255,255,0.75);font-size:13px;">by Mazik Global</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <p style="margin:0 0 8px;color:#64748b;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;">{escape(eyebrow)}</p>
            <h2 style="margin:0 0 18px;color:#0f172a;font-size:22px;font-weight:700;">{title}</h2>
            {body_html}
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;">
            <p style="margin:0;color:#94a3b8;font-size:12px;">© 2026 Mazik Global – TalentAI. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
"""

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
            f'<p style="margin:12px 0 0;color:#475569;font-size:14px;"><strong>Note:</strong> {escape(note)}</p>'
            if note
            else ""
        )
        subject = f"Document update: {document_label} — TalentAI"
        body = f"""
            <p style="margin:0 0 22px;color:#475569;font-size:15px;line-height:1.6;">
              Hello {safe_name}, your <strong>{safe_label}</strong> was marked <strong>{safe_status}</strong>.
            </p>
            {note_html}
            <div style="text-align:center;margin-top:24px;">
              <a href="{safe_link}" style="display:inline-block;background:#123a63;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-size:15px;font-weight:700;">Open documents</a>
            </div>
"""
        self._send(to_email, subject, self._branded_shell("Document update", "Verification update", body))

    def send_company_email_assigned(self, to_email: str, full_name: str, company_email: str) -> None:
        subject = "Your company email has been assigned — TalentAI"
        body = f"""
            <p style="margin:0 0 22px;color:#475569;font-size:15px;line-height:1.6;">
              Hello {escape(full_name)}, your recruiter has recorded your official company email.
              Please use this address for workplace communications going forward.
            </p>
            <div style="background:#f1f5fe;border:2px solid #32a6ae;border-radius:10px;padding:20px;margin-bottom:8px;">
              <p style="margin:0 0 4px;color:#64748b;font-size:12px;font-weight:700;text-transform:uppercase;">Company email</p>
              <p style="margin:0;color:#123a63;font-size:18px;font-weight:800;">{escape(company_email)}</p>
            </div>
"""
        self._send(to_email, subject, self._branded_shell("Company credentials", f"Welcome aboard, {escape(full_name)}", body))

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
            f'<p style="margin:8px 0 0;color:#475569;font-size:14px;"><strong>Serial:</strong> {escape(serial_number)}</p>'
            if serial_number
            else ""
        )
        body = f"""
            <p style="margin:0 0 22px;color:#475569;font-size:15px;line-height:1.6;">
              Hello {escape(full_name)}, a company asset has been assigned to you. Please keep it safe and report any issues to HR.
            </p>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px;">
              <p style="margin:0;color:#123a63;font-size:17px;font-weight:800;">{escape(asset_name)}</p>
              <p style="margin:6px 0 0;color:#475569;font-size:14px;">Type: {escape(asset_type)}</p>
              {serial_html}
            </div>
"""
        self._send(to_email, subject, self._branded_shell("Company assets", "New asset assigned", body))

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
        link_html = (
            f'<p style="margin:12px 0 0;"><a href="{escape(meeting_link, quote=True)}" style="color:#2d6cdf;font-weight:700;">Join meeting</a></p>'
            if meeting_link
            else ""
        )
        body = f"""
            <p style="margin:0 0 22px;color:#475569;font-size:15px;line-height:1.6;">
              Hello {escape(full_name)}, {"your orientation details were updated" if is_update else "your onboarding orientation has been scheduled"}.
            </p>
            <div style="background:#f1f5fe;border:2px solid #32a6ae;border-radius:10px;padding:20px;margin-bottom:18px;">
              <p style="margin:0 0 6px;color:#123a63;font-size:16px;font-weight:800;">{escape(date)} · {escape(time)}</p>
              <p style="margin:0;color:#475569;font-size:14px;"><strong>Trainer:</strong> {escape(trainer)}</p>
              {link_html}
            </div>
            <p style="margin:0 0 6px;color:#64748b;font-size:12px;font-weight:700;text-transform:uppercase;">Agenda</p>
            <p style="margin:0;color:#475569;font-size:15px;line-height:1.6;white-space:pre-wrap;">{escape(agenda)}</p>
"""
        eyebrow = "Orientation update" if is_update else "Orientation session"
        self._send(to_email, subject, self._branded_shell(eyebrow, "You're invited", body))

    def send_announcement(
        self,
        to_email: str,
        full_name: str,
        title: str,
        body_text: str,
        dashboard_url: str | None = None,
    ) -> None:
        subject = f"Announcement: {title} — TalentAI"
        link_html = (
            f'<p style="margin:18px 0 0;"><a href="{escape(dashboard_url, quote=True)}" '
            f'style="display:inline-block;background:#123a63;color:#fff;text-decoration:none;'
            f'padding:12px 18px;border-radius:8px;font-weight:700;">Open dashboard</a></p>'
            if dashboard_url
            else ""
        )
        body = f"""
            <p style="margin:0 0 18px;color:#475569;font-size:15px;line-height:1.6;">
              Hello {escape(full_name)}, your recruiting team shared a new announcement.
            </p>
            <div style="background:#f1f5fe;border:2px solid #32a6ae;border-radius:10px;padding:20px;margin-bottom:8px;">
              <p style="margin:0 0 8px;color:#123a63;font-size:18px;font-weight:800;">{escape(title)}</p>
              <p style="margin:0;color:#475569;font-size:15px;line-height:1.6;white-space:pre-wrap;">{escape(body_text)}</p>
            </div>
            {link_html}
"""
        self._send(to_email, subject, self._branded_shell("Team announcement", title, body))


email_service = EmailService()

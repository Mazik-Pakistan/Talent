"""SMTP-based email service with HTML templates for TalentAI."""

import smtplib
import ssl
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


email_service = EmailService()

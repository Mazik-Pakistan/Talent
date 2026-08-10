"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import AuthAside, { RECOVERY_SLIDES } from "@/components/auth/AuthAside";
import { getApiErrorMessage, resetPassword } from "@/services/authService";
import PasswordToggle from "@/components/PasswordToggle";
import FieldError, { INPUT_ERROR_STYLE } from "@/lib/formFeedback";
import { EMAIL_REGEX, PASSWORD_REGEX, PASSWORD_HINT_TEXT } from "@/utils/validation";
import styles from "@/app/styles/auth.module.css";

const PASSWORD_HINT = PASSWORD_HINT_TEXT;

export default function ResetPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState("");
  const inputRefs = useRef([]);

  useEffect(() => {
    const stored = sessionStorage.getItem("resetEmail");
    if (stored) setEmail(stored);
  }, []);

  function handleOtpChange(index, value) {
    const digit = value.replace(/\D/g, "").slice(-1);
    const updated = [...otp];
    updated[index] = digit;
    setOtp(updated);
    if (fieldErrors.otp) {
      setFieldErrors((current) => ({ ...current, otp: undefined }));
    }
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handleOtpKeyDown(index, e) {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handleOtpPaste(e) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    const updated = [...otp];
    for (let i = 0; i < pasted.length; i++) updated[i] = pasted[i];
    setOtp(updated);
    if (fieldErrors.otp) {
      setFieldErrors((current) => ({ ...current, otp: undefined }));
    }
    const lastIdx = Math.min(pasted.length, 5);
    inputRefs.current[lastIdx]?.focus();
  }

  function validate() {
    const errors = {};
    if (!email.trim()) {
      errors.email = "Please enter your email address.";
    } else if (!EMAIL_REGEX.test(email.trim())) {
      errors.email = "Please enter a valid email address.";
    }
    const code = otp.join("");
    if (code.length !== 6) {
      errors.otp = "Please enter the full 6-digit reset code.";
    }
    if (!password) {
      errors.password = "New password is required.";
    } else if (!PASSWORD_REGEX.test(password)) {
      errors.password = PASSWORD_HINT;
    }
    if (!confirmPassword) {
      errors.confirm_password = "Please confirm your new password.";
    } else if (password && confirmPassword !== password) {
      errors.confirm_password = "Passwords do not match.";
    }
    return errors;
  }

  function clearFieldError(field) {
    setFieldErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setMessage("");

    const validationErrors = validate();
    setFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    setIsSubmitting(true);
    try {
      const data = await resetPassword({
        email: email.trim(),
        otp: otp.join(""),
        password,
        confirm_password: confirmPassword,
      });
      setMessage(data.message);
      sessionStorage.removeItem("resetEmail");
      setTimeout(() => router.push("/login"), 1600);
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not reset password."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={styles.shell}>
      <div className={styles.card}>
        {/* Brand / marketing panel now renders first so it sits on the left */}
        <AuthAside
          slides={RECOVERY_SLIDES}
          ariaLabel="Password reset help"
          mascotMood={message ? "green" : Object.keys(fieldErrors).length ? "red" : error ? "red" : "neutral"}
          mascotMessage={message ? "Password reset — yay! 🎉" : undefined}
        />

        <section
          className={styles.panel}
          aria-labelledby="reset-heading"
          style={{ display: "flex", flexDirection: "column", justifyContent: "flex-start" }}
        >
          <div className={styles.intro}>
            <p className={styles.eyebrow}>Account recovery</p>
            <h1 id="reset-heading" className={styles.heading}>Set a new password</h1>
            <p className={styles.subtext}>Enter the reset code sent to your email and choose a strong new password.</p>
          </div>

          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <label className={styles.field}>
              <span>Email address <span style={{ color: "#b42318", marginLeft: 4 }}>*</span></span>
              <input
                className={styles.input}
                type="email"
                name="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearFieldError("email");
                }}
                autoComplete="email"
                aria-invalid={Boolean(fieldErrors.email)}
                style={fieldErrors.email ? INPUT_ERROR_STYLE : undefined}
                required
              />
              {fieldErrors.email && <FieldError>{fieldErrors.email}</FieldError>}
            </label>

            <div className={styles.otpField}>
              <span className={styles.otpLabel}>Reset code <span style={{ color: "#b42318" }}>*</span></span>
              <div className={styles.otpRow} onPaste={handleOtpPaste}>
                {otp.map((digit, index) => (
                  <input
                    key={index}
                    ref={(el) => {
                      inputRefs.current[index] = el;
                    }}
                    className={`${styles.otpInput} ${digit ? styles.otpInputFilled : ""}`}
                    style={fieldErrors.otp ? INPUT_ERROR_STYLE : undefined}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(index, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(index, e)}
                    aria-label={`Reset code digit ${index + 1}`}
                    aria-invalid={Boolean(fieldErrors.otp)}
                  />
                ))}
              </div>
              {fieldErrors.otp && (
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <FieldError>{fieldErrors.otp}</FieldError>
                </div>
              )}
            </div>

            <label className={styles.field}>
              <span>New password <span style={{ color: "#b42318", marginLeft: 4 }}>*</span></span>
              <span className={styles.passwordControl}>
                <input
                  className={styles.input}
                  type={showNew ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    clearFieldError("password");
                    if (fieldErrors.confirm_password) {
                      setFieldErrors((current) => ({ ...current, confirm_password: undefined }));
                    }
                  }}
                  autoComplete="new-password"
                  aria-invalid={Boolean(fieldErrors.password)}
                  style={fieldErrors.password ? INPUT_ERROR_STYLE : undefined}
                  required
                />
                <PasswordToggle
                  visible={showNew}
                  onToggle={() => setShowNew((v) => !v)}
                  className={styles.toggleButton}
                />
              </span>
              {fieldErrors.password && <FieldError>{fieldErrors.password}</FieldError>}
            </label>

            <label className={styles.field}>
              <span>Confirm password <span style={{ color: "#b42318", marginLeft: 4 }}>*</span></span>
              <span className={styles.passwordControl}>
                <input
                  className={styles.input}
                  type={showConfirm ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    clearFieldError("confirm_password");
                  }}
                  autoComplete="new-password"
                  aria-invalid={Boolean(fieldErrors.confirm_password)}
                  style={fieldErrors.confirm_password ? INPUT_ERROR_STYLE : undefined}
                  required
                />
                <PasswordToggle
                  visible={showConfirm}
                  onToggle={() => setShowConfirm((v) => !v)}
                  className={styles.toggleButton}
                />
              </span>
              {fieldErrors.confirm_password && <FieldError>{fieldErrors.confirm_password}</FieldError>}
            </label>

            {error && <p className={`${styles.formMessage} ${styles.formMessageError}`} role="alert">{error}</p>}
            {message && <p className={`${styles.formMessage} ${styles.formMessageSuccess}`} role="status">{message}</p>}

            <button className={styles.primaryButton} type="submit" disabled={isSubmitting}>
              {isSubmitting && <span className={styles.spinner} />}
              {isSubmitting ? "Updating…" : "Update password"}
            </button>
          </form>

          <div className={styles.footer}>
            <p><Link href="/forgot-password">Request a new code</Link></p>
            <p><Link href="/login">Back to sign in</Link></p>
          </div>
        </section>
      </div>
    </main>
  );
}

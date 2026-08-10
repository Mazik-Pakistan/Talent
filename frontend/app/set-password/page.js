"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import AuthAside, { RECOVERY_SLIDES } from "@/components/auth/AuthAside";
import { changePassword, clearLocalSession, getApiErrorMessage, patchLocalUser } from "@/services/authService";
import PasswordToggle from "@/components/PasswordToggle";
import FieldError, { INPUT_ERROR_STYLE } from "@/lib/formFeedback";
import { parseFieldErrors } from "@/lib/apiFieldErrors";
import { EMAIL_REGEX, PASSWORD_REGEX, PASSWORD_HINT_TEXT } from "@/utils/validation";
import { ROLE_HOME } from "@/services/rbac";
import styles from "@/app/styles/auth.module.css";

const PASSWORD_HINT = PASSWORD_HINT_TEXT;

export default function SetPasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState("");

  function sessionUser() {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      return null;
    }
  }

  // Session gate: only reachable when the account is signed in AND flagged for
  // a forced password change. Anything else bounces to the right place.
  useEffect(() => {
    const accessToken = localStorage.getItem("access_token");
    const user = sessionUser();
    if (!accessToken || !user?.must_change_password) {
      router.replace(user ? ROLE_HOME[user.role] || "/login" : "/login");
    }
  }, [router]);

  function validate() {
    const errors = {};
    if (!currentPassword) {
      errors.current_password = "First-time password is required.";
    }
    if (!newPassword) {
      errors.new_password = "New password is required.";
    } else if (!PASSWORD_REGEX.test(newPassword)) {
      errors.new_password = PASSWORD_HINT;
    } else if (newPassword === currentPassword) {
      errors.new_password = "New password must be different from the current one.";
    }
    if (!confirmPassword) {
      errors.confirm_password = "Please confirm your new password.";
    } else if (newPassword && confirmPassword !== newPassword) {
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

    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) {
      router.replace("/login");
      return;
    }

    setIsSubmitting(true);
    try {
      const data = await changePassword(
        {
          current_password: currentPassword,
          new_password: newPassword,
          confirm_new_password: confirmPassword,
        },
        accessToken
      );
      patchLocalUser({ must_change_password: false });
      setMessage(data.message || "Password updated successfully.");
      const user = sessionUser();
      setTimeout(() => router.replace(user?.role ? ROLE_HOME[user.role] : "/login"), 1200);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 401) {
        clearLocalSession();
        router.replace("/login?reason=session_expired");
        return;
      }
      if (status === 400 || status === 422) {
        const { fieldErrors, general } = parseFieldErrors(err, [
          "current_password",
          "new_password",
          "confirm_password",
        ]);
        if (Object.keys(fieldErrors).length > 0) setFieldErrors(fieldErrors);
        if (general) {
          setError(general);
        } else if (Object.keys(fieldErrors).length === 0) {
          setError(getApiErrorMessage(err, "Could not update your password."));
        }
      } else {
        setError(getApiErrorMessage(err, "Could not update your password."));
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={styles.shell}>
      <div className={styles.card}>
        <AuthAside
          slides={RECOVERY_SLIDES}
          ariaLabel="Set your password"
          mascotMood={message ? "green" : Object.keys(fieldErrors).length ? "red" : error ? "red" : "neutral"}
          mascotMessage={message ? "Password saved — welcome! 🎉" : undefined}
        />

        <section
          className={styles.panel}
          aria-labelledby="set-password-heading"
          style={{ display: "flex", flexDirection: "column", justifyContent: "flex-start" }}
        >
          <div className={styles.intro}>
            <p className={styles.eyebrow}>Account security</p>
            <h1 id="set-password-heading" className={styles.heading}>Set your password</h1>
            <p className={styles.subtext}>
              Welcome! Before you continue, create your own password. It replaces the
              first-time password and covers both your personal and company email sign-in.
            </p>
          </div>

          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <label className={styles.field}>
              <span>First-time password <span style={{ color: "#b42318", marginLeft: 4 }}>*</span></span>
              <span className={styles.passwordControl}>
                <input
                  className={styles.input}
                  type={showCurrent ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => {
                    setCurrentPassword(e.target.value);
                    clearFieldError("current_password");
                  }}
                  autoComplete="current-password"
                  placeholder="The password IT sent you"
                  aria-invalid={Boolean(fieldErrors.current_password)}
                  required
                />
                <PasswordToggle
                  visible={showCurrent}
                  onToggle={() => setShowCurrent((v) => !v)}
                  className={styles.toggleButton}
                />
              </span>
              {fieldErrors.current_password && <FieldError>{fieldErrors.current_password}</FieldError>}
            </label>

            <label className={styles.field}>
              <span>New password <span style={{ color: "#b42318", marginLeft: 4 }}>*</span></span>
              <span className={styles.passwordControl}>
                <input
                  className={styles.input}
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    clearFieldError("new_password");
                    if (fieldErrors.confirm_password) {
                      setFieldErrors((current) => ({ ...current, confirm_password: undefined }));
                    }
                  }}
                  autoComplete="new-password"
                  placeholder="8+ chars with A–Z, a–z, 0–9 and a symbol"
                  aria-invalid={Boolean(fieldErrors.new_password)}
                  required
                />
                <PasswordToggle
                  visible={showNew}
                  onToggle={() => setShowNew((v) => !v)}
                  className={styles.toggleButton}
                />
              </span>
              {fieldErrors.new_password && <FieldError>{fieldErrors.new_password}</FieldError>}
            </label>

            <label className={styles.field}>
              <span>Confirm new password <span style={{ color: "#b42318", marginLeft: 4 }}>*</span></span>
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
                  placeholder="Re-enter the new password"
                  aria-invalid={Boolean(fieldErrors.confirm_password)}
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
              {isSubmitting ? "Saving…" : "Save password"}
            </button>
          </form>

          <div className={styles.footer}>
            <p><Link href="/login">Back to sign in</Link></p>
          </div>
        </section>
      </div>
    </main>
  );
}

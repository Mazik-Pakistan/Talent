"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import AuthAside, { RECOVERY_SLIDES } from "@/components/auth/AuthAside";
import { changePassword, clearLocalSession, getApiErrorMessage, patchLocalUser } from "@/services/authService";
import { ROLE_HOME } from "@/services/rbac";
import styles from "@/app/styles/auth.module.css";

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s])(?!.*\s).{8,}$/;

export default function SetPasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
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
    if (!currentPassword || !newPassword || !confirmPassword) {
      return "All fields are required.";
    }
    if (newPassword !== confirmPassword) {
      return "New password confirmation does not match.";
    }
    if (!PASSWORD_REGEX.test(newPassword)) {
      return "Use 8+ characters with uppercase, lowercase, number, special character, and no spaces.";
    }
    if (newPassword === currentPassword) {
      return "New password must be different from the current one.";
    }
    return null;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setMessage("");

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

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
      setError(getApiErrorMessage(err, "Could not update your password."));
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
          mascotMood={message ? "green" : error ? "red" : "neutral"}
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
                  type={showPassword ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="The password IT sent you"
                  required
                />
                <button
                  type="button"
                  className={styles.toggleButton}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </span>
            </label>

            <label className={styles.field}>
              <span>New password <span style={{ color: "#b42318", marginLeft: 4 }}>*</span></span>
              <input
                className={styles.input}
                type={showPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="8+ chars with A–Z, a–z, 0–9 and a symbol"
                required
              />
            </label>

            <label className={styles.field}>
              <span>Confirm new password <span style={{ color: "#b42318", marginLeft: 4 }}>*</span></span>
              <input
                className={styles.input}
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Re-enter the new password"
                required
              />
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
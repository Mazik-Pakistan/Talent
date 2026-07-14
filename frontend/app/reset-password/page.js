"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { getApiErrorMessage, resetPassword } from "@/services/authService";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [accessToken, setAccessToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [linkError, setLinkError] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const queryParams = new URLSearchParams(window.location.search);
    const token = hashParams.get("access_token") || queryParams.get("access_token") || "";
    const refresh = hashParams.get("refresh_token") || queryParams.get("refresh_token") || "";
    const type = hashParams.get("type") || queryParams.get("type") || "";
    const hashError = hashParams.get("error_description") || queryParams.get("error_description");

    if (hashError) {
      setLinkError(hashError);
      return;
    }
    if (!token || !refresh) {
      setLinkError("This reset link is missing a valid session. Request a new password reset email.");
      return;
    }
    if (type && type !== "recovery") {
      setLinkError("This link is not a password recovery link.");
      return;
    }
    setAccessToken(token);
    setRefreshToken(refresh);
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!accessToken) {
      setError("Reset session is missing. Request a new link.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{8,}$/.test(password)) {
      setError("Use 8+ characters with uppercase, lowercase, number, and special character.");
      return;
    }

    setIsSubmitting(true);
    try {
      const data = await resetPassword({
        access_token: accessToken,
        refresh_token: refreshToken,
        password,
        confirm_password: confirmPassword,
      });
      setMessage(data.message);
      window.history.replaceState(null, "", window.location.pathname);
      setTimeout(() => router.push("/login"), 1600);
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not reset password."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-labelledby="reset-heading">
        <div className="brand-row">
          <Image src="/mazikglobal-logo.png" alt="Mazik Global" width={192} height={52} priority />
          <span className="brand-divider" aria-hidden="true" />
          <span className="product-name">Talent</span>
        </div>

        <div className="auth-intro">
          <p className="eyebrow">Account recovery</p>
          <h1 id="reset-heading">Set a new password</h1>
          <p>Choose a strong password for your Talent account.</p>
        </div>

        {linkError ? (
          <>
            <p className="form-message" role="alert">{linkError}</p>
            <p className="auth-footer">
              <Link href="/forgot-password">Request a new reset link</Link>
            </p>
          </>
        ) : (
          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            <label className="field">
              <span>New password</span>
              <span className="password-control">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
                <button type="button" className="toggle-button" onClick={() => setShowPassword((v) => !v)}>
                  {showPassword ? "Hide" : "Show"}
                </button>
              </span>
            </label>
            <label className="field">
              <span>Confirm password</span>
              <input
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </label>

            {error && <p className="form-message" role="alert">{error}</p>}
            {message && <p className="form-message" role="status">{message}</p>}

            <button className="primary-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Updating…" : "Update password"}
            </button>
          </form>
        )}

        <p className="auth-footer">
          <Link href="/login">Back to sign in</Link>
        </p>
      </section>

      <aside className="auth-aside" aria-label="Password reset help">
        <div>
          <p className="eyebrow">Mazik Global</p>
          <h2>Secure password recovery.</h2>
          <p>Use the link from your email once, then sign in with your new password.</p>
        </div>
      </aside>
    </main>
  );
}

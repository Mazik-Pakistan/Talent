"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { forgotPassword, getApiErrorMessage } from "@/services/authService";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!email) {
      setError("Please enter your email address.");
      return;
    }

    setIsSubmitting(true);
    try {
      const data = await forgotPassword(email.trim());
      setMessage(data.message);
    } catch (err) {
      setError(getApiErrorMessage(err, "Something went wrong. Please try again."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-labelledby="forgot-heading">
        <div className="brand-row">
          <Image src="/mazikglobal-logo.png" alt="Mazik Global" width={192} height={52} priority />
          <span className="brand-divider" aria-hidden="true" />
          <span className="product-name">Talent</span>
        </div>

        <div className="auth-intro">
          <p className="eyebrow">Account recovery</p>
          <h1 id="forgot-heading">Reset your password</h1>
          <p>Enter the email address for your Talent account. We’ll send a one-time reset link.</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <label className="field">
            <span>Company email</span>
            <input
              type="email"
              name="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>

          {error && <p className="form-message error">{error}</p>}
          {message && <p className="form-message success">{message}</p>}

          <button className="primary-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Sending link…" : "Send reset link"}
          </button>
        </form>

        <p className="auth-footer">
          <Link href="/login">Back to sign in</Link>
        </p>
      </section>

      <aside className="auth-aside" aria-label="Talent platform introduction">
        <div>
          <p className="eyebrow">Mazik Global</p>
          <h2>Reset securely.</h2>
          <p>We will email you a one‑time link to set a new password.</p>
        </div>
        <div className="aside-metric">
          <strong>Secure by design</strong>
          <span>Password reset links expire after 24 hours.</span>
        </div>
      </aside>
    </main>
  );
}
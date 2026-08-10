"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "react-toastify";

import { forgotPassword, getApiErrorMessage } from "@/services/authService";
import { LOGO_URL } from "@/lib/logo";
import FieldError from "@/lib/formFeedback";
import styles from "@/app/styles/auth.module.css";
import MascotStatic from "@/components/MascotStatic";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  function validate() {
    const errors = {};
    if (!email.trim()) {
      errors.email = "Please enter your email address.";
    } else if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      errors.email = "Please enter a valid email address.";
    }
    return errors;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");

    const validationErrors = validate();
    setFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    setIsSubmitting(true);
    try {
      const data = await forgotPassword(email.trim());
      setMessage(data.message);
      sessionStorage.setItem("resetEmail", email.trim());
      setTimeout(() => router.push("/reset-password"), 2000);
    } catch (err) {
      if (err?.response?.status === 404) {
        // No account exists for this email — notify the user and stay on
        // this screen instead of proceeding to the reset-code page.
        toast.error("No account exists with this email address.");
      } else {
        toast.error(getApiErrorMessage(err, "Something went wrong. Please try again."));
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={styles.shell}>
      <div className={styles.card}>
        <aside className={styles.aside} aria-label="Password recovery introduction">
          <div className={styles.asideBrandRow}>
            <img src={LOGO_URL} alt="Mazik Global" className={styles.asideLogo} />
          </div>
          <div className={styles.asideContent}>
            <div className={styles.rotatingContent}>
              <span className={styles.asideEyebrow}>✦ Account recovery</span>
              <h2 className={styles.asideHeading}>Reset securely. Get back to <em>Talent.</em></h2>
              <p className={styles.asideText}>We&apos;ll email a one-time reset code so you can safely set a new password.</p>
            </div>
          </div>
          <div className={styles.mascotContainer}>
            <MascotStatic
              mood={message ? "green" : Object.keys(fieldErrors).length ? "red" : "neutral"}
              message={message ? "Code sent — hooray! ✨" : undefined}
            />
          </div>
        </aside>

        <section className={styles.panel} aria-labelledby="forgot-heading">
          <div className={styles.intro}>
            <span className={styles.eyebrow}>Account recovery</span>
            <h1 id="forgot-heading" className={styles.heading}>Reset your password</h1>
            <p className={styles.subtext}>Enter your company email and we&apos;ll send a one-time reset code.</p>
          </div>

          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <label className={`${styles.field} ${styles.animField}`}>
              <span>Company email</span>
              <span className={styles.inputShell}>
                <MailIcon />
                <input
                  className={styles.input}
                  type="email"
                  name="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setFieldErrors((current) => (current.email ? { ...current, email: undefined } : current));
                  }}
                  autoComplete="email"
                  placeholder="you@company.com"
                  aria-invalid={Boolean(fieldErrors.email)}
                  required
                />
              </span>
              {fieldErrors.email && <FieldError>{fieldErrors.email}</FieldError>}
            </label>
            {message && <p className={styles.fieldError} role="status">{message}</p>}
            <button className={styles.primaryButton} type="submit" disabled={isSubmitting}>
              {isSubmitting && <span className={styles.spinner} />}
              {isSubmitting ? "Sending code…" : "Send reset code"}
            </button>
          </form>

          <p className={styles.footer}><Link href="/login">← Back to sign in</Link></p>
        </section>
      </div>
    </main>
  );
}

function MailIcon() {
  return <svg className={styles.inputIcon} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 5.5 10 10l7-4.5M4 4h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" /></svg>;
}

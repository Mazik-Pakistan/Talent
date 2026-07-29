"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";

import { forgotPassword, getApiErrorMessage } from "@/services/authService";
import styles from "@/app/styles/auth.module.css";
import MascotStatic from "@/components/MascotStatic";

export default function ForgotPasswordPage() {
  const router = useRouter();
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
      sessionStorage.setItem("resetEmail", email.trim());
      setTimeout(() => router.push("/reset-password"), 2000);
    } catch (err) {
      setError(getApiErrorMessage(err, "Something went wrong. Please try again."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={styles.shell}>
      <div className={styles.card}>
        <aside className={styles.aside} aria-label="Password recovery introduction">
          <div className={styles.asideBrandRow}>
            <Image src="/talentai-logo.png" alt="Mazik Global" width={192} height={52} className={styles.asideLogo} priority />
          </div>
          <div className={styles.asideContent}>
            <div className={styles.rotatingContent}>
              <span className={styles.asideEyebrow}>✦ Account recovery</span>
              <h2 className={styles.asideHeading}>Reset securely. Get back to <em>Talent.</em></h2>
              <p className={styles.asideText}>We&apos;ll email a one-time reset code so you can safely set a new password.</p>
            </div>
          </div>
          <div className={styles.mascotContainer}>
            <MascotStatic />
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
                <input className={styles.input} type="email" name="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@company.com" required />
              </span>
            </label>
            {error && <p className={styles.fieldError} role="alert">{error}</p>}
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
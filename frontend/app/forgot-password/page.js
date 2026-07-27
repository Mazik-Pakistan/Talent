"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import AuthAside, { RECOVERY_SLIDES } from "@/components/auth/AuthAside";
import { forgotPassword, getApiErrorMessage } from "@/services/authService";
import styles from "@/app/styles/auth.module.css";

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
        <section className={styles.panel} aria-labelledby="forgot-heading">
          <div className={styles.brandRow}>
            <Image src="/mazikglobal-logo.png" alt="Mazik Global" width={192} height={52} priority />
            <span className={styles.brandDivider} aria-hidden="true" />
            <span className={styles.productName}>Talent</span>
          </div>

          <div className={styles.intro}>
            <p className={styles.eyebrow}>Account recovery</p>
            <h1 id="forgot-heading" className={styles.heading}>Reset your password</h1>
            <p className={styles.subtext}>Enter your email address. We&apos;ll send a one-time reset code.</p>
          </div>

          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <label className={styles.field}>
              <span>Company email <span style={{ color: "#b42318", marginLeft: 4 }}>*</span></span>
              <input
                className={styles.input}
                type="email"
                name="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </label>

            {error && <p className={`${styles.formMessage} ${styles.formMessageError}`} role="alert">{error}</p>}
            {message && <p className={`${styles.formMessage} ${styles.formMessageSuccess}`} role="status">{message}</p>}

            <button className={styles.primaryButton} type="submit" disabled={isSubmitting}>
              {isSubmitting && <span className={styles.spinner} />}
              {isSubmitting ? "Sending code…" : "Send reset code"}
            </button>
          </form>

          <div className={styles.footer}>
            <p><Link href="/login">Back to sign in</Link></p>
          </div>
        </section>

        <AuthAside slides={RECOVERY_SLIDES} ariaLabel="Password recovery help" />
      </div>
    </main>
  );
}

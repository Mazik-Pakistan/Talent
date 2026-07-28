"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import AuthAside, { RECOVERY_SLIDES } from "@/components/auth/AuthAside";
import { getApiErrorMessage, resetPassword } from "@/services/authService";
import styles from "@/app/styles/auth.module.css";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
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
    const lastIdx = Math.min(pasted.length, 5);
    inputRefs.current[lastIdx]?.focus();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setMessage("");

    const code = otp.join("");

    if (!email) {
      setError("Please enter your email address.");
      return;
    }
    if (code.length !== 6) {
      setError("Please enter the full 6-digit reset code.");
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
        email: email.trim(),
        otp: code,
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
        <section className={styles.panel} aria-labelledby="reset-heading">
          <div className={styles.brandRow}>
            <Image src="/talentai-logo.png" alt="Mazik Global" width={192} height={52} priority />
            <span className={styles.brandDivider} aria-hidden="true" />
            <span className={styles.productName}>Talent</span>
          </div>

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
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
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
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(index, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(index, e)}
                    aria-label={`Reset code digit ${index + 1}`}
                  />
                ))}
              </div>
            </div>

            <label className={styles.field}>
              <span>New password <span style={{ color: "#b42318", marginLeft: 4 }}>*</span></span>
              <span className={styles.passwordControl}>
                <input
                  className={styles.input}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
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
              <span>Confirm password <span style={{ color: "#b42318", marginLeft: 4 }}>*</span></span>
              <input
                className={styles.input}
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
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

        <AuthAside slides={RECOVERY_SLIDES} ariaLabel="Password reset help" />
      </div>
    </main>
  );
}

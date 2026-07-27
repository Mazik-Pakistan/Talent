"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import AuthAside, { VERIFY_SLIDES } from "@/components/auth/AuthAside";
import { getApiErrorMessage, verifyOtp, resendOtp } from "@/services/authService";
import styles from "@/app/styles/auth.module.css";

export default function VerifyEmailPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [state, setState] = useState({ status: "idle", message: "" });
  const [resendMessage, setResendMessage] = useState("");
  const [resending, setResending] = useState(false);
  const [redirectTo, setRedirectTo] = useState(null);
  const [pendingRole, setPendingRole] = useState(null);
  const inputRefs = useRef([]);

  useEffect(() => {
    const pending = sessionStorage.getItem("pendingEmail");
    if (pending) setEmail(pending);
    setPendingRole(sessionStorage.getItem("pendingRole"));
  }, []);

  useEffect(() => {
    if (state.status !== "success" || !redirectTo) return;
    const timer = setTimeout(() => router.push(redirectTo), 1600);
    return () => clearTimeout(timer);
  }, [state.status, redirectTo, router]);

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
    for (let i = 0; i < pasted.length; i++) {
      updated[i] = pasted[i];
    }
    setOtp(updated);
    const lastIdx = Math.min(pasted.length, 5);
    inputRefs.current[lastIdx]?.focus();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const code = otp.join("");
    if (code.length !== 6) {
      setState({ status: "error", message: "Please enter the full 6-digit verification code." });
      return;
    }
    if (!email) {
      setState({ status: "error", message: "Email address is missing. Please register again." });
      return;
    }

    setState({ status: "loading", message: "Verifying your code…" });
    try {
      const response = await verifyOtp(email, code);
      setState({ status: "success", message: response.message });
      sessionStorage.removeItem("pendingEmail");

      if (response.role === "candidate" && response.session) {
        localStorage.setItem("access_token", response.session.access_token);
        localStorage.setItem("refresh_token", response.session.refresh_token);
        if (response.user) localStorage.setItem("user", JSON.stringify(response.user));
        localStorage.setItem("session_last_active", String(Date.now()));
        sessionStorage.setItem("pendingRole", "candidate");
        setRedirectTo(response.redirect_to || "/onboarding");
      } else {
        sessionStorage.removeItem("pendingRole");
        setRedirectTo(response.redirect_to || "/login");
      }
    } catch (error) {
      setState({ status: "error", message: getApiErrorMessage(error, "We could not verify this code.") });
    }
  }

  const handleResend = useCallback(async () => {
    if (!email) {
      setResendMessage("We couldn't find your email. Please try registering again.");
      return;
    }
    setResending(true);
    setResendMessage("");
    try {
      const data = await resendOtp(email);
      setResendMessage(data.message);
      setOtp(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
    } catch (error) {
      setResendMessage(getApiErrorMessage(error, "Could not resend verification code."));
    } finally {
      setResending(false);
    }
  }, [email]);

  const returnHref = pendingRole === "candidate" ? "/login" : "/register";
  const isSuccess = state.status === "success";

  return (
    <main className={styles.shell}>
      <div className={styles.card}>
        <section className={styles.panel} aria-labelledby="verification-heading">
          <div className={styles.brandRow}>
            <Image src="/mazikglobal-logo.png" alt="Mazik Global" width={192} height={52} priority />
            <span className={styles.brandDivider} aria-hidden="true" />
            <span className={styles.productName}>Talent</span>
          </div>

          <div
            className={`${styles.verifyIcon} ${
              isSuccess ? styles.verifyIconSuccess : state.status === "error" ? styles.verifyIconError : ""
            }`}
            aria-hidden="true"
          >
            {isSuccess ? "✓" : state.status === "error" ? "!" : "✉"}
          </div>

          <div className={styles.intro}>
            <p className={styles.eyebrow}>Email verification</p>
            <h1 id="verification-heading" className={styles.heading}>
              {isSuccess ? "Your account is active" : "Enter verification code"}
            </h1>
            {!isSuccess && (
              <p className={styles.subtext}>
                Check your inbox for a 6-digit code from TalentAI. It expires in about 10 minutes.
              </p>
            )}
          </div>

          {state.message && (
            <p
              className={`${styles.formMessage} ${
                state.status === "error" ? styles.formMessageError : styles.formMessageSuccess
              }`}
              role="status"
            >
              {state.message}
            </p>
          )}

          {isSuccess && redirectTo === "/onboarding" && (
            <p className={`${styles.formMessage} ${styles.formMessageSuccess}`}>Redirecting you to onboarding…</p>
          )}

          {!isSuccess && (
            <form className={styles.form} onSubmit={handleSubmit} noValidate>
              {email && (
                <p className={styles.subtext}>
                  We sent a 6-digit code to <strong>{email}</strong>
                </p>
              )}

              <div className={styles.otpField}>
                <span className={styles.otpLabel}>Verification code</span>
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
                      aria-label={`OTP digit ${index + 1}`}
                    />
                  ))}
                </div>
              </div>

              <button
                className={styles.primaryButton}
                type="submit"
                disabled={state.status === "loading"}
              >
                {state.status === "loading" && <span className={styles.spinner} />}
                {state.status === "loading" ? "Verifying…" : "Verify code"}
              </button>
            </form>
          )}

          {!isSuccess && (
            <div style={{ marginTop: "1rem" }}>
              <p className={styles.subtext} style={{ marginBottom: "0.55rem" }}>
                Didn&apos;t receive the code?
              </p>
              <button
                onClick={handleResend}
                disabled={resending}
                className={styles.secondaryButton}
                type="button"
              >
                {resending ? "Resending…" : "Resend code"}
              </button>
              {resendMessage && (
                <p className={styles.formMessage} role="status" style={{ marginTop: "0.55rem" }}>
                  {resendMessage}
                </p>
              )}
            </div>
          )}

          <div className={styles.footer}>
            {isSuccess && redirectTo ? (
              <p>
                <Link href={redirectTo}>
                  {redirectTo === "/onboarding" ? "Continue to onboarding" : "Continue to sign in"}
                </Link>
              </p>
            ) : (
              <p>
                <Link href={returnHref}>
                  {pendingRole === "candidate" ? "Go to sign in" : "Return to registration"}
                </Link>
              </p>
            )}
          </div>
        </section>

        <AuthAside slides={VERIFY_SLIDES} ariaLabel="Email verification help" />
      </div>
    </main>
  );
}

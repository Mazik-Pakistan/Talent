"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { getApiErrorMessage, verifyOtp, resendOtp } from "@/services/authService";

export default function VerifyEmailPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [state, setState] = useState({ status: "idle", message: "" });
  const [resendMessage, setResendMessage] = useState("");
  const [resending, setResending] = useState(false);
  const [redirectTo, setRedirectTo] = useState(null);
  const inputRefs = useRef([]);

  // Read the pending email from sessionStorage on mount
  useEffect(() => {
    const pending = sessionStorage.getItem("pendingEmail");
    if (pending) setEmail(pending);
  }, []);

  // Auto-redirect after success
  useEffect(() => {
    if (state.status !== "success" || !redirectTo) return;
    const timer = setTimeout(() => router.push(redirectTo), 1600);
    return () => clearTimeout(timer);
  }, [state.status, redirectTo, router]);

  // OTP digit input handlers
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
    // Focus the last filled input
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

      // For candidates: store session and redirect to onboarding
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
      // Reset OTP fields
      setOtp(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
    } catch (error) {
      setResendMessage(getApiErrorMessage(error, "Could not resend verification code."));
    } finally {
      setResending(false);
    }
  }, [email]);

  const pendingRole = typeof window !== "undefined" ? sessionStorage.getItem("pendingRole") : null;
  const returnHref = pendingRole === "candidate" ? "/login" : "/register";
  const isSuccess = state.status === "success";

  return (
    <main className="verification-shell">
      <section className="verification-card" aria-labelledby="verification-heading">
        <Image src="/mazikglobal-logo.png" alt="Mazik Global" width={192} height={52} priority />

        <div className={`verification-icon ${isSuccess ? "success" : state.status === "error" ? "error" : ""}`} aria-hidden="true">
          {isSuccess ? "✓" : state.status === "error" ? "!" : "✉"}
        </div>

        <p className="eyebrow">Email verification</p>
        <h1 id="verification-heading">
          {isSuccess
            ? "Your account is active"
            : "Enter verification code"}
        </h1>
        <p style={{ fontSize: "0.9rem", color: "#64748b", textAlign: "center", marginTop: "-0.5rem", marginBottom: "1rem" }}>
          {isSuccess
            ? null
            : "Check your inbox for a 6-digit code from TalentAI. It expires in about 10 minutes."}
        </p>

        {state.message && (
          <p className="verification-message" role="status">{state.message}</p>
        )}

        {state.status === "loading" && <span className="loading-dot" aria-label="Loading" />}

        {isSuccess && redirectTo === "/onboarding" && (
          <p className="verification-message">Redirecting you to onboarding…</p>
        )}

        {!isSuccess && (
          <form onSubmit={handleSubmit} noValidate style={{ width: "100%" }}>
            {email && (
              <p style={{ fontSize: "0.875rem", color: "#64748b", marginBottom: "1.25rem", textAlign: "center" }}>
                We sent a 6-digit code to <strong>{email}</strong>
              </p>
            )}

            {/* OTP Digit Inputs */}
            <div
              style={{
                display: "flex",
                gap: "10px",
                justifyContent: "center",
                marginBottom: "1.5rem",
              }}
              onPaste={handleOtpPaste}
            >
              {otp.map((digit, index) => (
                <input
                  key={index}
                  ref={(el) => (inputRefs.current[index] = el)}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleOtpChange(index, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(index, e)}
                  aria-label={`OTP digit ${index + 1}`}
                  style={{
                    width: "48px",
                    height: "56px",
                    textAlign: "center",
                    fontSize: "1.5rem",
                    fontWeight: "700",
                    border: `2px solid ${digit ? "#2d6cdf" : "#cbd5e1"}`,
                    borderRadius: "8px",
                    outline: "none",
                    transition: "border-color 0.2s",
                    background: "#fff",
                    color: "#0f172a",
                  }}
                />
              ))}
            </div>

            <button
              className="primary-button"
              type="submit"
              disabled={state.status === "loading"}
              style={{ width: "100%" }}
            >
              {state.status === "loading" ? "Verifying…" : "Verify Code"}
            </button>
          </form>
        )}

        {/* Resend section */}
        {!isSuccess && (
          <div style={{ marginTop: "1.25rem", textAlign: "center" }}>
            <p style={{ fontSize: "0.875rem", color: "#64748b", marginBottom: "0.5rem" }}>
              Didn&apos;t receive the code?
            </p>
            <button
              onClick={handleResend}
              disabled={resending}
              className="secondary-button"
              type="button"
            >
              {resending ? "Resending…" : "Resend code"}
            </button>
            {resendMessage && (
              <p className="form-message" role="status" style={{ marginTop: "0.5rem" }}>
                {resendMessage}
              </p>
            )}
          </div>
        )}

        {isSuccess && redirectTo ? (
          <Link className="secondary-link" href={redirectTo}>
            {redirectTo === "/onboarding" ? "Continue to onboarding" : "Continue to sign in"}
          </Link>
        ) : (
          <Link className="secondary-link" href={returnHref}>
            {pendingRole === "candidate" ? "Go to sign in" : "Return to registration"}
          </Link>
        )}
      </section>
    </main>
  );
}

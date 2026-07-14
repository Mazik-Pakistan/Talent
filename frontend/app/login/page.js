"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { getApiErrorMessage, login } from "@/services/authService";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formMessage, setFormMessage] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setFormMessage("");
    if (!email || !password) {
      setFormMessage("Please enter your email and password.");
      return;
    }

    setIsSubmitting(true);
    try {
      const data = await login({ email: email.trim(), password, remember_me: rememberMe });
      // Store session tokens in localStorage for persistence
      localStorage.setItem("access_token", data.session.access_token);
      localStorage.setItem("refresh_token", data.session.refresh_token);
      localStorage.setItem("user", JSON.stringify(data.user));

      router.push(data.redirect_to || (data.user?.role === "candidate" ? "/onboarding" : "/dashboard"));
    } catch (error) {
      setFormMessage(getApiErrorMessage(error, "Login failed. Please check your credentials."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-labelledby="login-heading">
        <div className="brand-row">
          <Image src="/mazikglobal-logo.png" alt="Mazik Global" width={192} height={52} priority />
          <span className="brand-divider" aria-hidden="true" />
          <span className="product-name">Talent</span>
        </div>

        <div className="auth-intro">
          <p className="eyebrow">Recruiter access</p>
          <h1 id="login-heading">Sign in to Talent</h1>
          <p>Enter your credentials to continue.</p>
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

          <label className="field">
            <span>Password</span>
            <span className="password-control">
              <input
                type={showPassword ? "text" : "password"}
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="toggle-button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </span>
          </label>

          <label className="checkbox-field" style={{ margin: "0.5rem 0" }}>
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
            />
            <span>Remember me</span>
          </label>

          {formMessage && <p className="form-message" role="status">{formMessage}</p>}

          <button className="primary-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            <Link href="/forgot-password">Forgot password?</Link>
          </p>
          <p>
            Don’t have an account? <Link href="/register">Create one</Link>
          </p>
        </div>
      </section>

      <aside className="auth-aside" aria-label="Talent platform introduction">
        <div>
          <p className="eyebrow">Mazik Global</p>
          <h2>Your recruitment dashboard awaits.</h2>
          <p>Access job postings, candidate pipelines, and onboarding tools securely.</p>
        </div>
        <div className="aside-metric">
          <strong>Secure login</strong>
          <span>Persistent sessions with refresh tokens.</span>
        </div>
      </aside>
    </main>
  );
}
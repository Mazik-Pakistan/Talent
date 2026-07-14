"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { getApiErrorMessage, login } from "@/services/authService";

const ROLES = [
  { id: "recruiter", label: "Recruiter", hint: "Hiring & invitations" },
  { id: "candidate", label: "Candidate", hint: "Offer & onboarding" },
  { id: "employee", label: "Employee", hint: "Workplace portal" },
  { id: "super_admin", label: "Super Admin", hint: "Platform control" },
];

export default function LoginPage() {
  return (
    <Suspense fallback={<p style={{ textAlign: "center", marginTop: "2rem" }}>Loading…</p>}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [role, setRole] = useState("recruiter");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formMessage, setFormMessage] = useState("");

  useEffect(() => {
    if (searchParams.get("reason") === "session_timeout") {
      setFormMessage("Your session expired after inactivity. Please sign in again.");
    }
  }, [searchParams]);

  async function handleSubmit(event) {
    event.preventDefault();
    setFormMessage("");
    if (!email || !password) {
      setFormMessage("Please enter your email and password.");
      return;
    }

    setIsSubmitting(true);
    try {
      const data = await login({
        email: email.trim(),
        password,
        role,
        remember_me: rememberMe,
      });
      localStorage.setItem("access_token", data.session.access_token);
      localStorage.setItem("refresh_token", data.session.refresh_token);
      localStorage.setItem("user", JSON.stringify(data.user));
      localStorage.setItem("session_last_active", String(Date.now()));
      router.push(data.redirect_to);
    } catch (error) {
      setFormMessage(getApiErrorMessage(error, "Login failed. Please check your credentials."));
    } finally {
      setIsSubmitting(false);
    }
  }

  const selected = ROLES.find((item) => item.id === role);

  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-labelledby="login-heading">
        <div className="brand-row">
          <Image src="/mazikglobal-logo.png" alt="Mazik Global" width={192} height={52} priority />
          <span className="brand-divider" aria-hidden="true" />
          <span className="product-name">Talent</span>
        </div>

        <div className="auth-intro">
          <p className="eyebrow">Secure access</p>
          <h1 id="login-heading">Sign in to Talent</h1>
          <p>Choose your role, then enter your credentials to open that dashboard.</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <fieldset className="role-picker">
            <legend>Sign in as</legend>
            <div className="role-grid" role="radiogroup" aria-label="Account role">
              {ROLES.map((item) => (
                <label key={item.id} className={`role-option ${role === item.id ? "selected" : ""}`}>
                  <input
                    type="radio"
                    name="role"
                    value={item.id}
                    checked={role === item.id}
                    onChange={() => {
                      setRole(item.id);
                      setFormMessage("");
                    }}
                  />
                  <strong>{item.label}</strong>
                  <span>{item.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="field">
            <span>Email</span>
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
            {isSubmitting ? "Signing in…" : `Sign in as ${selected?.label}`}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            <Link href="/forgot-password">Forgot password?</Link>
          </p>
          <p>
            Recruiter account? <Link href="/register">Create one</Link>
          </p>
        </div>
      </section>

      <aside className="auth-aside" aria-label="Talent platform introduction">
        <div>
          <p className="eyebrow">Mazik Global</p>
          <h2>One platform. Four role-based workspaces.</h2>
          <p>Recruiters, candidates, employees, and admins each land in the dashboard built for their work.</p>
        </div>
        <div className="aside-metric">
          <strong>Role-based access</strong>
          <span>Your selected role must match your account to continue.</span>
        </div>
      </aside>
    </main>
  );
}

"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import { getApiErrorMessage, login } from "@/services/authService";
import styles from "@/app/styles/auth.module.css";

const ROLES = [
  { id: "recruiter", label: "Recruiter", hint: "Hiring & invitations" },
  { id: "candidate", label: "Candidate", hint: "Offer & onboarding" },
  { id: "employee", label: "Employee", hint: "Workplace portal" },
  { id: "super_admin", label: "Super Admin", hint: "Platform control" },
];

const EMAIL_REGEX = /^\S+@\S+\.\S+$/;

function validateForm(values) {
  const errors = {};

  if (!values.email.trim()) {
    errors.email = "Email is required.";
  } else if (!EMAIL_REGEX.test(values.email.trim())) {
    errors.email = "Enter a valid email address.";
  }

  if (!values.password) {
    errors.password = "Password is required.";
  } else if (values.password.length < 8) {
    errors.password = "Password must be at least 8 characters.";
  }

  return errors;
}

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
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});

  useEffect(() => {
    if (searchParams.get("reason") === "session_timeout") {
      toast.info("Your session expired after inactivity. Please sign in again.");
    }
  }, [searchParams]);

  function handleBlur(field) {
    setTouched((current) => ({ ...current, [field]: true }));
    setErrors(validateForm({ email, password }));
  }

  function handleEmailChange(value) {
    setEmail(value);
    if (touched.email) {
      setErrors((current) => ({ ...current, ...validateForm({ email: value, password }) }));
    }
  }

  function handlePasswordChange(value) {
    setPassword(value);
    if (touched.password) {
      setErrors((current) => ({ ...current, ...validateForm({ email, password: value }) }));
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setTouched({ email: true, password: true });

    const validationErrors = validateForm({ email, password });
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length) {
      toast.error("Please fix the errors below and try again.");
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
      toast.success("Signed in successfully. Redirecting…");
      router.push(data.redirect_to);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Login failed. Please check your credentials."));
    } finally {
      setIsSubmitting(false);
    }
  }

  const selected = ROLES.find((item) => item.id === role);

  return (
    <main className={styles.shell}>
      <ToastContainer position="top-right" autoClose={4000} theme="colored" newestOnTop />

      <div className={styles.card}>
        <section className={styles.panel} aria-labelledby="login-heading">
          <div className={styles.brandRow}>
            <Image src="/mazikglobal-logo.png" alt="Mazik Global" width={192} height={52} priority />
            <span className={styles.brandDivider} aria-hidden="true" />
            <span className={styles.productName}>Talent</span>
          </div>

          <div className={styles.intro}>
            <p className={styles.eyebrow}>Secure access</p>
            <h1 id="login-heading" className={styles.heading}>Sign in to Talent</h1>
            <p className={styles.subtext}>Choose your role, then enter your credentials to open that dashboard.</p>
          </div>

          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <fieldset className={styles.rolePicker}>
              <legend>Sign in as</legend>
              <div className={styles.roleGrid} role="radiogroup" aria-label="Account role">
                {ROLES.map((item) => {
                  const isSelected = role === item.id;
                  return (
                    <label
                      key={item.id}
                      className={`${styles.roleOption} ${isSelected ? styles.roleOptionSelected : ""}`}
                    >
                      <input
                        type="radio"
                        name="role"
                        value={item.id}
                        checked={isSelected}
                        onChange={() => setRole(item.id)}
                      />
                      {isSelected && <span className={styles.roleCheck}>✓</span>}
                      <strong>{item.label}</strong>
                      <span>{item.hint}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <label className={`${styles.field} ${styles.animField}`} style={{ animationDelay: "80ms" }}>
              <span>Email</span>
              <input
                className={styles.input}
                type="email"
                name="email"
                value={email}
                onChange={(e) => handleEmailChange(e.target.value)}
                onBlur={() => handleBlur("email")}
                aria-invalid={Boolean(touched.email && errors.email)}
                aria-describedby={touched.email && errors.email ? "email-error" : undefined}
                autoComplete="email"
                placeholder="you@company.com"
                required
              />
              {touched.email && errors.email && (
                <small className={styles.fieldError} id="email-error">⚠ {errors.email}</small>
              )}
            </label>

            <label className={`${styles.field} ${styles.animField}`} style={{ animationDelay: "130ms" }}>
              <span>Password</span>
              <span className={styles.passwordControl}>
                <input
                  className={styles.input}
                  type={showPassword ? "text" : "password"}
                  name="password"
                  value={password}
                  onChange={(e) => handlePasswordChange(e.target.value)}
                  onBlur={() => handleBlur("password")}
                  aria-invalid={Boolean(touched.password && errors.password)}
                  aria-describedby={touched.password && errors.password ? "password-error" : undefined}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  className={styles.toggleButton}
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </span>
              {touched.password && errors.password && (
                <small className={styles.fieldError} id="password-error">⚠ {errors.password}</small>
              )}
            </label>

            <label className={styles.checkboxField} style={{ animationDelay: "170ms" }}>
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              <span>Remember me</span>
            </label>

            <button className={styles.primaryButton} type="submit" disabled={isSubmitting} style={{ animationDelay: "200ms" }}>
              {isSubmitting && <span className={styles.spinner} />}
              {isSubmitting ? "Signing in…" : `Sign in as ${selected?.label}`}
            </button>
          </form>

          <div className={styles.footer}>
            <p><Link href="/forgot-password">Forgot password?</Link></p>
            <p>Recruiter account? <Link href="/register">Create one</Link></p>
          </div>
        </section>

        <aside className={styles.aside} aria-label="Talent platform introduction">
          <span className={`${styles.blob} ${styles.blob1}`} aria-hidden="true" />
          <span className={`${styles.blob} ${styles.blob2}`} aria-hidden="true" />
          <span className={`${styles.blob} ${styles.blob3}`} aria-hidden="true" />

          <div>
            <p className={styles.asideEyebrow}>Mazik Global</p>
            <h2 className={styles.asideHeading}>One platform. Four role-based workspaces.</h2>
            <p className={styles.asideText}>Recruiters, candidates, employees, and admins each land in the dashboard built for their work.</p>
          </div>

          <div>
            <div className={styles.metricCard}>
              <strong>Role-based access</strong>
              <span>Your selected role must match your account to continue.</span>
            </div>
            <div className={styles.dotsRow} aria-hidden="true">
              <span className={`${styles.dot} ${styles.dotActive}`} />
              <span className={styles.dot} />
              <span className={styles.dot} />
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
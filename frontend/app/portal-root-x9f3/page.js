"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import { getApiErrorMessage, login, persistLoginSession } from "@/services/authService";
import { LOGO_URL } from "@/lib/logo";
import PasswordToggle from "@/components/PasswordToggle";
import styles from "@/app/styles/auth.module.css";
import MascotStatic from "@/components/MascotStatic";

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

export default function SuperAdminLoginPage() {
  return <SuperAdminLoginForm />;
}

function SuperAdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [loginFeedback, setLoginFeedback] = useState("idle");

  useEffect(() => {
    const reason = searchParams.get("reason");
    if (reason === "session_timeout") {
      toast.info("Your session expired after inactivity. Please sign in again.");
    } else if (reason === "session_expired") {
      toast.info("Your session expired. Please sign in again.");
    }
  }, [searchParams]);

  function handleBlur(field) {
    setTouched((current) => ({ ...current, [field]: true }));
    setErrors(validateForm({ email, password }));
  }

  function handleEmailChange(value) {
    setEmail(value);
    setLoginFeedback(value ? "typing" : "idle");
    if (touched.email) {
      setErrors((current) => ({ ...current, ...validateForm({ email: value, password }) }));
    }
  }

  function handlePasswordChange(value) {
    setPassword(value);
    setLoginFeedback(value ? "typing" : "idle");
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
      setLoginFeedback("error");
      toast.error("Please fix the errors below and try again.");
      return;
    }

    setLoginFeedback("checking");
    setIsSubmitting(true);
    try {
      const data = await login({
        email: email.trim(),
        password,
        role: "super_admin",
        remember_me: rememberMe,
      });
      persistLoginSession(data.session, data.user, {
        rememberMe,
        email: email.trim(),
      });
      setLoginFeedback("success");
      if (data.user?.must_change_password) {
        toast.info("First-time sign-in. Set your own password to continue.");
        router.push("/set-password");
        return;
      }
      toast.success("Signed in successfully. Redirecting…");
      router.push(data.redirect_to);
    } catch (error) {
      const message = getApiErrorMessage(error, "Login failed. Please check your credentials.");
      setErrors((current) => ({ ...current, password: message }));
      setLoginFeedback("error");
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  const mascotMood = loginFeedback === "success" ? "green" : loginFeedback === "error" ? "red" : password ? "yellow" : "neutral";

  return (
    <main className={styles.shell}>
      <ToastContainer position="top-right" autoClose={4000} theme="colored" newestOnTop />

      <div className={styles.card}>
        <aside className={styles.aside} aria-label="Talent platform introduction">
          <div className={styles.asideBrandRow}>
            <img
               src={LOGO_URL}
              alt="Mazik Global"
              className={styles.asideLogo}
            />
          </div>

          <div className={styles.asideContent}>
            <div className={styles.rotatingContent}>
              <h2 className={styles.asideHeading}>Platform control, in trusted hands.</h2>
              <p className={styles.asideText}>
                This console governs every workspace on Talent. Access is limited to
                verified super administrators only.
              </p>
            </div>
          </div>

          <div className={styles.mascotContainer}>
            <MascotStatic
              mood={mascotMood}
              message={loginFeedback === "success" ? "Welcome back! 🎉" : undefined}
            />
          </div>
        </aside>

        <section className={styles.panel} aria-labelledby="login-heading">
          <div className={styles.intro}>
            <span className={styles.restrictedBadge}>
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <rect x="4" y="9" width="12" height="8" rx="1.5" />
                <path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9" />
              </svg>
              Restricted access
            </span>
            <h1 id="login-heading" className={styles.heading}>Super Admin sign in</h1>
            <p className={styles.subtext}>
              This page isn&apos;t linked from the public site. Enter your super admin credentials to continue.
            </p>
          </div>

          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <label className={`${styles.field} ${styles.animField}`} style={{ animationDelay: "80ms" }}>
              <span>Email</span>
              <span className={styles.inputShell}>
                <FieldIcon type="email" />
                <input
                  className={`${styles.input} ${loginFeedback === "error" ? styles.passwordInvalid : loginFeedback === "success" ? styles.passwordSuccess : ""}`}
                  type="email"
                  name="email"
                  value={email}
                  onChange={(e) => handleEmailChange(e.target.value)}
                  onBlur={() => handleBlur("email")}
                  aria-invalid={Boolean((touched.email && errors.email) || loginFeedback === "error")}
                  aria-describedby={touched.email && errors.email ? "email-error" : undefined}
                  autoComplete="email"
                  placeholder="admin@company.com"
                  required
                />
              </span>
              {touched.email && errors.email && (
                <small className={styles.fieldError} id="email-error">⚠ {errors.email}</small>
              )}
            </label>

            <label className={`${styles.field} ${styles.animField}`} style={{ animationDelay: "130ms" }}>
              <span>Password</span>
              <span className={styles.inputShell}>
                <FieldIcon type="password" />
                <input
                  className={`${styles.input} ${loginFeedback === "error" ? styles.passwordInvalid : loginFeedback === "success" ? styles.passwordSuccess : ""}`}
                  type={showPassword ? "text" : "password"}
                  name="password"
                  value={password}
                  onChange={(e) => handlePasswordChange(e.target.value)}
                  onBlur={() => handleBlur("password")}
                  aria-invalid={loginFeedback === "error"}
                  aria-describedby={touched.password && errors.password ? "password-error" : undefined}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  required
                />
                <PasswordToggle
                  visible={showPassword}
                  onToggle={() => setShowPassword((v) => !v)}
                  className={styles.toggleButton}
                />
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
              {isSubmitting ? "Signing in…" : "Sign in as Super Admin"}
            </button>
          </form>

          <div className={styles.footer}>
            <p>Not a super admin? Use the <a href="/login">standard sign-in</a>.</p>
          </div>
        </section>
      </div>
    </main>
  );
}

function FieldIcon({ type }) {
  const path = type === "email" ? <path d="M3 5.5 10 10l7-4.5M4 4h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" /> : <><rect x="5" y="9" width="10" height="7" rx="1" /><path d="M7.3 9V6.8a2.7 2.7 0 0 1 5.4 0V9" /></>;
  return <svg className={styles.inputIcon} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">{path}</svg>;
}

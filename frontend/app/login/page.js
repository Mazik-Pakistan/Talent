"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import { getApiErrorMessage, login, persistLoginSession } from "@/services/authService";
import { LOGO_URL } from "@/lib/logo";
import styles from "@/app/styles/auth.module.css";
import MascotStatic from "@/components/MascotStatic";

const ROTATING_CONTENT = [
  {
  heading: "One platform for your entire hiring workflow.",
  text: "Post roles, screen candidates, and onboard new hires — all in one connected dashboard.",
  },
  {
    heading: "AI-powered matching for better hires.",
    text: "Our algorithms analyze skills, experience, and culture fit to find your ideal candidates faster.",
  },
  {
    heading: "Seamless onboarding from day one.",
    text: "Move new hires through paperwork, training, and integration without breaking stride.",
  },
  {
    heading: "Data-driven decisions at every step.",
    text: "Real-time analytics help you refine your hiring strategy and reduce time-to-hire.",
  },
  {
    heading: "Sign in with either email.",
    text: "Use your personal or company email — one password covers both. Forgot it? Use the 6-digit code on the sign-in page.",
  },
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
  return <LoginForm />;
}

function LoginForm() {
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
  
  // Auto-rotation state
  const [contentIndex, setContentIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [direction, setDirection] = useState(1); // 1 = right, -1 = left

  useEffect(() => {
    const reason = searchParams.get("reason");
    if (reason === "session_timeout") {
      toast.info("Your session expired after inactivity. Please sign in again.");
    } else if (reason === "session_expired") {
      toast.info("Your session expired. Please sign in again.");
    }
  }, [searchParams]);

  // Auto-rotation effect with left-to-right animation
  useEffect(() => {
    const interval = setInterval(() => {
      setIsTransitioning(true);
      setDirection(1); // Slide right
      setTimeout(() => {
        setContentIndex((prev) => (prev + 1) % ROTATING_CONTENT.length);
        setIsTransitioning(false);
        setDirection(-1); // Slide left for next
      }, 400);
    }, 3000);

    return () => clearInterval(interval);
  }, []);

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
         remember_me: rememberMe,
       });
       
       // Prefer effective caps from RBAC; fall back to login payload.
       let capabilities = data.user?.capabilities || {};
       try {
         const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
         const rbacResponse = await fetch(`${apiBaseUrl}/api/rbac/me`, {
           headers: {
             Authorization: `Bearer ${data.session.access_token}`,
             "ngrok-skip-browser-warning": "true",
           },
         });
         if (rbacResponse.ok) {
           const rbacData = await rbacResponse.json();
           if (rbacData.capabilities && Object.keys(rbacData.capabilities).length) {
             capabilities = rbacData.capabilities;
           }
         }
       } catch (err) {
         console.warn("Could not fetch capabilities:", err);
         // Continue with login-payload capabilities
       }
       
       persistLoginSession(data.session, data.user, {
         rememberMe,
         email: email.trim(),
         capabilities,
       });
       setLoginFeedback("success");
       if (data.user?.must_change_password) {
         toast.info("First-time sign-in — set your own password to continue.");
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
            <Image
              src={LOGO_URL}
              alt="Mazik Global TalentAI"
              className={styles.asideLogo}
              style={{ height: "auto", objectFit: "contain" }}
            />
          </div>

          <div className={styles.asideContent} key={contentIndex}>
            <div className={styles.rotatingContent}>
              <h2 className={`${styles.asideHeading} ${isTransitioning ? styles.slideOut : styles.slideIn}`}>
                {ROTATING_CONTENT[contentIndex].heading}
              </h2>
              <p className={`${styles.asideText} ${isTransitioning ? styles.slideOut : styles.slideIn}`}>
                {ROTATING_CONTENT[contentIndex].text}
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
            <h1 id="login-heading" className={styles.heading}>Sign in to Talent</h1>
            <p className={styles.subtext}>Use your personal or company email — we&apos;ll take you to your dashboard automatically.</p>
          </div>

          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <label className={`${styles.field} ${styles.animField}`} style={{ animationDelay: "80ms" }}>
              <span>Email</span>
              <span className={styles.inputShell}>
                <FieldIcon type="email" />
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
              {isSubmitting ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className={styles.footer}>
            <p><Link href="/forgot-password">Forgot password?</Link></p>
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

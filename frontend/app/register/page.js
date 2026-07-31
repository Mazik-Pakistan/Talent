"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useEffect } from "react";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import { getApiErrorMessage, register } from "@/services/authService";
import {
  formatPkMobileInput,
  isValidPkMobile,
  normalizePkMobile,
  PK_MOBILE_HINT,
  preservePkMobileCaret,
} from "@/utils/phone";
import styles from "@/app/styles/auth.module.css";
import MascotStatic from "@/components/MascotStatic";

const initialForm = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  password: "",
  confirm_password: "",
  terms_accepted: false,
};

// Content variants for auto-rotation
const ROTATING_CONTENT = [
  {
   heading: "Connected people operations.",
  text: "A clear, secure path from candidate selection to successful onboarding.",
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
];

function validateForm(form) {
  const errors = {};

  if (!form.first_name.trim()) {
    errors.first_name = "First name is required.";
  } else if (form.first_name.trim().length < 2) {
    errors.first_name = "First name must be at least 2 characters.";
  }

  if (!form.last_name.trim()) {
    errors.last_name = "Last name is required.";
  } else if (form.last_name.trim().length < 2) {
    errors.last_name = "Last name must be at least 2 characters.";
  }

  if (!form.email.trim()) {
    errors.email = "Email is required.";
  } else if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) {
    errors.email = "Enter a valid email address.";
  }

  if (!form.phone.trim()) {
    errors.phone = "Phone number is required.";
  } else if (!isValidPkMobile(form.phone)) {
    errors.phone = `Enter a valid Pakistani mobile number (${PK_MOBILE_HINT}).`;
  }

  if (!form.password) {
    errors.password = "Password is required.";
  } else if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{8,}$/.test(form.password)) {
    errors.password = "Use 8+ characters with uppercase, lowercase, number, and special character.";
  }

  if (!form.confirm_password) {
    errors.confirm_password = "Please confirm your password.";
  } else if (form.password !== form.confirm_password) {
    errors.confirm_password = "Passwords do not match.";
  }

  if (!form.terms_accepted) errors.terms_accepted = "You must accept the Terms & Conditions.";

  return errors;
}

function getPasswordStrength(password) {
  if (!password) return { score: 0, label: "", color: "var(--border)" };
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^\w\s]/.test(password)) score += 1;

  if (score <= 1) return { score: 25, label: "Weak", color: "#dc2626", tone: "strengthWeak", mood: "red" };
  if (score <= 3) return { score: 60, label: "Getting there", color: "#eab308", tone: "strengthMedium", mood: "yellow" };
  return { score: 100, label: "Strong", color: "#16a34a", tone: "strengthStrong", mood: "green" };
}

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Auto-rotation state
  const [contentIndex, setContentIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const strength = useMemo(() => getPasswordStrength(form.password), [form.password]);

  // Auto-rotation effect with smooth left-to-right transition
  useEffect(() => {
    const interval = setInterval(() => {
      setIsTransitioning(true);
      setTimeout(() => {
        setContentIndex((prev) => (prev + 1) % ROTATING_CONTENT.length);
        setIsTransitioning(false);
      }, 500);
    }, 3500);

    return () => clearInterval(interval);
  }, []);

  function updateField(event) {
    const { checked, name, type, value } = event.target;
    const phoneValue = name === "phone" ? formatPkMobileInput(value) : value;
    const nextForm = { ...form, [name]: type === "checkbox" ? checked : phoneValue };
    setForm(nextForm);
    if (name === "phone") {
      const digitsBeforeCaret = value.slice(0, event.target.selectionStart ?? value.length).replace(/\D/g, "").length;
      preservePkMobileCaret(event.target, digitsBeforeCaret);
    }
    if (touched[name]) {
      setErrors((current) => ({ ...current, ...validateForm(nextForm) }));
    }
  }

  function handleBlur(event) {
    const { name } = event.target;
    setTouched((current) => ({ ...current, [name]: true }));
    setErrors(validateForm(form));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const validationErrors = validateForm(form);
    setErrors(validationErrors);
    setTouched({
      first_name: true,
      last_name: true,
      email: true,
      phone: true,
      password: true,
      confirm_password: true,
      terms_accepted: true,
    });

    if (Object.keys(validationErrors).length) {
      toast.error("Please fix the errors below and try again.");
      return;
    }

    setIsSubmitting(true);
    try {
      const full_name = `${form.first_name.trim()} ${form.last_name.trim()}`;
      const response = await register({ 
        ...form, 
        full_name: full_name,
        email: form.email.trim(), 
        phone: normalizePkMobile(form.phone) 
      });
      sessionStorage.setItem("pendingEmail", form.email.trim());
      toast.success(response.message || "Account created. Check your email to verify.");
      router.push("/verify-email");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Registration failed. Please try again."));
    } finally {
      setIsSubmitting(false);
    }
  }

  const showError = (field) => touched[field] && errors[field];

  return (
    <main className={styles.shell}>
      <ToastContainer position="top-right" autoClose={4000} theme="colored" newestOnTop />

      <div className={styles.card}>
        <aside className={styles.aside} aria-label="Talent platform introduction">
          <div className={styles.asideBrandRow}>
            <Image
              src="/talentai-logo.png"
              alt="Mazik Global"
              width={192}
              height={52}
              className={styles.asideLogo}
              priority
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
              mood={form.password ? strength.mood : "neutral"}
              message={!form.password ? undefined : strength.mood === "red" ? "Let’s make it stronger!" : strength.mood === "yellow" ? "You’re building it!" : "Perfect — nice work!"}
            />
          </div>
        </aside>

        <section className={styles.panel} aria-labelledby="register-heading">
          <div className={styles.intro}>
            <h1 id="register-heading" className={styles.heading}>Create your Talent account</h1>
            <p className={styles.subtext}>Set up secure access to manage your recruitment and onboarding workflows.</p>
          </div>

          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <div className={styles.formRow}>
              <FormField
                delay="60ms"
                label="First name"
                name="first_name"
                value={form.first_name}
                error={showError("first_name") ? errors.first_name : undefined}
                onChange={updateField}
                onBlur={handleBlur}
                autoComplete="given-name"
                placeholder="Jane"
              />
              <FormField
                delay="80ms"
                label="Last name"
                name="last_name"
                value={form.last_name}
                error={showError("last_name") ? errors.last_name : undefined}
                onChange={updateField}
                onBlur={handleBlur}
                autoComplete="family-name"
                placeholder="Doe"
              />
            </div>

            <div className={styles.formRow}>
              <FormField
                delay="100ms"
                label="Company email"
                name="email"
                type="email"
                value={form.email}
                error={showError("email") ? errors.email : undefined}
                onChange={updateField}
                onBlur={handleBlur}
                autoComplete="email"
                hint="Work email"
                placeholder="jane@company.com"
              />
              <FormField
                delay="120ms"
                label="Phone number"
                name="phone"
                type="tel"
                value={form.phone}
                error={showError("phone") ? errors.phone : undefined}
                onChange={updateField}
                onBlur={handleBlur}
                autoComplete="tel"
                hint={PK_MOBILE_HINT}
                placeholder="0300-1234567"
              />
            </div>

            <div className={styles.formRow}>
              <label className={`${styles.field} ${styles.animField}`} style={{ animationDelay: "140ms" }}>
                <span>Password</span>
                <span className={styles.inputShell}>
                  <FieldIcon type="password" />
                  <input
                    className={`${styles.input} ${showError("password") ? styles.passwordInvalid : ""}`}
                    aria-invalid={form.password ? Boolean(showError("password")) : undefined}
                    aria-describedby={showError("password") ? "password-error" : undefined}
                    name="password"
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={updateField}
                    onBlur={handleBlur}
                    autoComplete="new-password"
                    placeholder="••••••••"
                  />
                  <button 
                    type="button" 
                    className={styles.toggleButton} 
                    onClick={() => setShowPassword((v) => !v)} 
                    aria-label={`${showPassword ? "Hide" : "Show"} password`}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </span>
                <div className={styles.strengthTrack} aria-hidden="true">
                  <div className={styles.strengthFill} style={{ width: `${strength.score}%`, background: strength.color }} />
                </div>
                {strength.label && <span className={`${styles.strengthLabel} ${styles[strength.tone]}`}>Password strength: {strength.label}</span>}
                
                <div className={styles.requirementsRow}>
                  <span className={`${styles.reqItem} ${form.password.length >= 8 ? styles.reqMet : ""}`}>
                    <span className={styles.reqCheck}>{form.password.length >= 8 ? "✓" : ""}</span>
                    8+ chars
                  </span>
                  <span className={`${styles.reqItem} ${/[A-Z]/.test(form.password) ? styles.reqMet : ""}`}>
                    <span className={styles.reqCheck}>{/[A-Z]/.test(form.password) ? "✓" : ""}</span>
                    A-Z
                  </span>
                  <span className={`${styles.reqItem} ${/[a-z]/.test(form.password) ? styles.reqMet : ""}`}>
                    <span className={styles.reqCheck}>{/[a-z]/.test(form.password) ? "✓" : ""}</span>
                    a-z
                  </span>
                  <span className={`${styles.reqItem} ${/\d/.test(form.password) ? styles.reqMet : ""}`}>
                    <span className={styles.reqCheck}>{/\d/.test(form.password) ? "✓" : ""}</span>
                    0-9
                  </span>
                  <span className={`${styles.reqItem} ${/[^\w\s]/.test(form.password) ? styles.reqMet : ""}`}>
                    <span className={styles.reqCheck}>{/[^\w\s]/.test(form.password) ? "✓" : ""}</span>
                    !@#
                  </span>
                </div>
                
                {showError("password") && (
                  <small className={styles.fieldError} id="password-error">⚠ {errors.password}</small>
                )}
              </label>

              <label className={`${styles.field} ${styles.animField}`} style={{ animationDelay: "160ms" }}>
                <span>Confirm password</span>
                <span className={styles.inputShell}>
                  <FieldIcon type="confirm_password" />
                  <input
                    className={`${styles.input} ${(form.confirm_password && form.password !== form.confirm_password) || showError("confirm_password") ? styles.passwordInvalid : ""}`}
                    aria-invalid={form.confirm_password ? Boolean(showError("confirm_password")) : undefined}
                    aria-describedby={showError("confirm_password") ? "confirm_password-error" : undefined}
                    name="confirm_password"
                    type={showConfirmPassword ? "text" : "password"}
                    value={form.confirm_password}
                    onChange={updateField}
                    onBlur={handleBlur}
                    autoComplete="new-password"
                    placeholder="••••••••"
                  />
                  <button 
                    type="button" 
                    className={styles.toggleButton} 
                    onClick={() => setShowConfirmPassword((v) => !v)} 
                    aria-label={`${showConfirmPassword ? "Hide" : "Show"} confirm password`}
                  >
                    {showConfirmPassword ? "Hide" : "Show"}
                  </button>
                </span>
                {showError("confirm_password") && (
                  <small className={styles.fieldError} id="confirm_password-error">⚠ {errors.confirm_password}</small>
                )}
              </label>
            </div>

            <label className={styles.checkboxField} style={{ animationDelay: "180ms" }}>
              <input 
                name="terms_accepted" 
                type="checkbox" 
                checked={form.terms_accepted} 
                onChange={updateField} 
                onBlur={handleBlur} 
              />
              <span>I agree to the Terms &amp; Conditions and Privacy Policy.</span>
            </label>
            {showError("terms_accepted") && (
              <p className={styles.fieldError}>⚠ {errors.terms_accepted}</p>
            )}

            <button 
              className={styles.primaryButton} 
              type="submit" 
              disabled={isSubmitting} 
              style={{ animationDelay: "200ms" }}
            >
              {isSubmitting && <span className={styles.spinner} />}
              {isSubmitting ? "Creating account…" : "Create account"}
            </button>
          </form>

          <p className={styles.footer}>Already have an account? <Link href="/login">Sign in</Link></p>
        </section>
      </div>
    </main>
  );
}

function FormField({ 
  label, 
  name, 
  type = "text", 
  value, 
  error, 
  hint, 
  onChange, 
  onBlur, 
  autoComplete, 
  placeholder, 
  delay 
}) {
  const isTouched = value !== "" || error;
  return (
    <label className={`${styles.field} ${styles.animField}`} style={{ animationDelay: delay }}>
      <span>{label}</span>
      <span className={styles.inputShell}>
        <FieldIcon type={name} />
        <input
          className={styles.input}
          aria-invalid={isTouched ? Boolean(error) : undefined}
          aria-describedby={error ? `${name}-error` : undefined}
          name={name}
          type={type}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          autoComplete={autoComplete}
          placeholder={placeholder}
        />
      </span>
      {hint && !error && <small className={styles.hint}>{hint}</small>}
      {error && <small className={styles.fieldError} id={`${name}-error`}>⚠ {error}</small>}
    </label>
  );
}

function FieldIcon({ type }) {
  const path = type === "email" ? <path d="M3 5.5 10 10l7-4.5M4 4h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" /> : type === "phone" ? <path d="M6.2 3.5 8 6.8 6.5 8.1c.9 1.9 2.4 3.4 4.3 4.3l1.3-1.5 3.3 1.8-.5 3.1c-4.8.5-10.8-5.5-10.3-10.3l1.6-2Z" /> : type === "password" || type === "confirm_password" ? <><rect x="5" y="9" width="10" height="7" rx="1" /><path d="M7.3 9V6.8a2.7 2.7 0 0 1 5.4 0V9" /></> : <><circle cx="10" cy="6.3" r="2.8" /><path d="M4.5 16.5c.6-3 2.5-4.6 5.5-4.6s4.9 1.6 5.5 4.6" /></>;
  return <svg className={styles.inputIcon} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">{path}</svg>;
}

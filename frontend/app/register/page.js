"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import { getApiErrorMessage, register } from "@/services/authService";
import styles from "@/app/styles/auth.module.css";

const initialForm = {
  full_name: "",
  email: "",
  phone: "",
  password: "",
  confirm_password: "",
  terms_accepted: false,
};

function validateForm(form) {
  const errors = {};

  if (!form.full_name.trim()) {
    errors.full_name = "Full name is required.";
  } else if (form.full_name.trim().length < 2) {
    errors.full_name = "Full name must be at least 2 characters.";
  }

  if (!form.email.trim()) {
    errors.email = "Email is required.";
  } else if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) {
    errors.email = "Enter a valid email address.";
  }

  if (!form.phone.trim()) {
    errors.phone = "Phone number is required.";
  } else if (!/^[+()\-\s\d]{7,20}$/.test(form.phone.trim())) {
    errors.phone = "Enter a valid phone number.";
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
  if (!password) return { score: 0, label: "", color: "#e5e7eb" };
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^\w\s]/.test(password)) score += 1;

  if (score <= 1) return { score: 20, label: "Weak", color: "#dc2626" };
  if (score <= 3) return { score: 60, label: "Medium", color: "#f59e0b" };
  return { score: 100, label: "Strong", color: "#16a34a" };
}

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const strength = useMemo(() => getPasswordStrength(form.password), [form.password]);

  function updateField(event) {
    const { checked, name, type, value } = event.target;
    const nextForm = { ...form, [name]: type === "checkbox" ? checked : value };
    setForm(nextForm);
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
      full_name: true,
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
      const response = await register({ ...form, full_name: form.full_name.trim(), email: form.email.trim() });
      // Store email so the verification page can offer a resend
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
        <section className={styles.panel} aria-labelledby="register-heading">
          <div className={styles.brandRow}>
            <Image src="/mazikglobal-logo.png" alt="Mazik Global" width={192} height={52} priority />
            <span className={styles.brandDivider} aria-hidden="true" />
            <span className={styles.productName}>Talent</span>
          </div>

          <div className={styles.intro}>
            <p className={styles.eyebrow}>Recruiter access</p>
            <h1 id="register-heading" className={styles.heading}>Create your Talent account</h1>
            <p className={styles.subtext}>Set up secure access to manage your recruitment and onboarding workflows.</p>
          </div>

          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <FormField
              delay="60ms"
              label="Full name"
              name="full_name"
              value={form.full_name}
              error={showError("full_name") ? errors.full_name : undefined}
              onChange={updateField}
              onBlur={handleBlur}
              autoComplete="name"
              placeholder="Jane Doe"
            />
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
              hint="Use your work email address."
              placeholder="jane@company.com"
            />
            <FormField
              delay="140ms"
              label="Phone number"
              name="phone"
              type="tel"
              value={form.phone}
              error={showError("phone") ? errors.phone : undefined}
              onChange={updateField}
              onBlur={handleBlur}
              autoComplete="tel"
              placeholder="+92 300 1234567"
            />

            <label className={`${styles.field} ${styles.animField}`} style={{ animationDelay: "180ms" }}>
              <span>Password</span>
              <span className={styles.passwordControl}>
                <input
                  className={styles.input}
                  aria-invalid={Boolean(showError("password"))}
                  aria-describedby={showError("password") ? "password-error" : undefined}
                  name="password"
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={updateField}
                  onBlur={handleBlur}
                  autoComplete="new-password"
                  placeholder="••••••••"
                />
                <button type="button" className={styles.toggleButton} onClick={() => setShowPassword((v) => !v)} aria-label={`${showPassword ? "Hide" : "Show"} password`}>
                  {showPassword ? "Hide" : "Show"}
                </button>
              </span>
              {form.password && (
                <>
                  <div className={styles.strengthTrack}>
                    <div className={styles.strengthFill} style={{ width: `${strength.score}%`, background: strength.color }} />
                  </div>
                  <small className={styles.strengthLabel} style={{ color: strength.color }}>{strength.label}</small>
                </>
              )}
              {!form.password && <small className={styles.hint}>8+ characters, with uppercase, lowercase, number, and special character.</small>}
              {showError("password") && <small className={styles.fieldError} id="password-error">⚠ {errors.password}</small>}
            </label>

            <FormField
              delay="220ms"
              label="Confirm password"
              name="confirm_password"
              type={showPassword ? "text" : "password"}
              value={form.confirm_password}
              error={showError("confirm_password") ? errors.confirm_password : undefined}
              onChange={updateField}
              onBlur={handleBlur}
              autoComplete="new-password"
              placeholder="••••••••"
            />

            <label className={styles.checkboxField} style={{ animationDelay: "260ms" }}>
              <input name="terms_accepted" type="checkbox" checked={form.terms_accepted} onChange={updateField} onBlur={handleBlur} />
              <span>I agree to the Terms &amp; Conditions.</span>
            </label>
            {showError("terms_accepted") && <p className={styles.fieldError}>⚠ {errors.terms_accepted}</p>}

            <button className={styles.primaryButton} type="submit" disabled={isSubmitting} style={{ animationDelay: "300ms" }}>
              {isSubmitting && <span className={styles.spinner} />}
              {isSubmitting ? "Creating account…" : "Create account"}
            </button>
          </form>

          <p className={styles.footer}>Already have an account? <Link href="/login">Sign in</Link></p>
        </section>

        <aside className={styles.aside} aria-label="Talent platform introduction">
          <span className={`${styles.blob} ${styles.blob1}`} aria-hidden="true" />
          <span className={`${styles.blob} ${styles.blob2}`} aria-hidden="true" />
          <span className={`${styles.blob} ${styles.blob3}`} aria-hidden="true" />

          <div>
            <p className={styles.asideEyebrow}>Mazik Global</p>
            <h2 className={styles.asideHeading}>People operations, made more connected.</h2>
            <p className={styles.asideText}>Talent gives recruitment teams a clear, secure path from candidate selection to successful onboarding.</p>
          </div>

          <div>
            <div className={styles.metricCard}>
              <strong>Secure by design</strong>
              <span>Email verification protects every recruiter account.</span>
            </div>
            <div className={styles.dotsRow} aria-hidden="true">
              <span className={styles.dot} />
              <span className={`${styles.dot} ${styles.dotActive}`} />
              <span className={styles.dot} />
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function FormField({ label, name, type = "text", value, error, hint, onChange, onBlur, autoComplete, placeholder, delay }) {
  return (
    <label className={`${styles.field} ${styles.animField}`} style={{ animationDelay: delay }}>
      <span>{label}</span>
      <input
        className={styles.input}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${name}-error` : undefined}
        name={name}
        type={type}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        autoComplete={autoComplete}
        placeholder={placeholder}
      />
      {hint && !error && <small className={styles.hint}>{hint}</small>}
      {error && <small className={styles.fieldError} id={`${name}-error`}>⚠ {error}</small>}
    </label>
  );
}
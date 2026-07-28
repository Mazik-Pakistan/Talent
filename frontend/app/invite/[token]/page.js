"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { candidateRegister, getApiErrorMessage, getInvitation } from "@/services/authService";
import {
  formatPkMobileInput,
  isValidPkMobile,
  normalizePkMobile,
  PK_MOBILE_HINT,
  preservePkMobileCaret,
} from "@/utils/phone";
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
  if (form.full_name.trim().length < 2) errors.full_name = "Enter your full name.";
  if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) errors.email = "Enter a valid email address.";
  if (!isValidPkMobile(form.phone)) errors.phone = `Enter a valid Pakistani mobile number (${PK_MOBILE_HINT}).`;
  if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{8,}$/.test(form.password)) {
    errors.password = "Use 8+ characters with uppercase, lowercase, number, and special character.";
  }
  if (form.password !== form.confirm_password) errors.confirm_password = "Passwords do not match.";
  if (!form.terms_accepted) errors.terms_accepted = "You must accept the Terms & Conditions.";
  return errors;
}

export default function InviteRegisterPage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token;

  const [inviteState, setInviteState] = useState({ status: "loading", invitation: null, message: "" });
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formMessage, setFormMessage] = useState("");

  useEffect(() => {
    if (!token) return;
    Promise.resolve().then(async () => {
      try {
        const data = await getInvitation(token);
        setInviteState({ status: "ready", invitation: data.invitation, message: "" });
        setForm((current) => ({
          ...current,
          full_name: data.invitation.full_name || "",
          email: data.invitation.email || "",
        }));
      } catch (error) {
        setInviteState({
          status: "error",
          invitation: null,
          message: getApiErrorMessage(error, "This invitation link is invalid or has expired."),
        });
      }
    });
  }, [token]);

  function updateField(event) {
    const { checked, name, type, value } = event.target;
    const phoneValue = name === "phone" ? formatPkMobileInput(value) : value;
    setForm((currentForm) => ({ ...currentForm, [name]: type === "checkbox" ? checked : phoneValue }));
    if (name === "phone") {
      const digitsBeforeCaret = value.slice(0, event.target.selectionStart ?? value.length).replace(/\D/g, "").length;
      preservePkMobileCaret(event.target, digitsBeforeCaret);
    }
    setErrors((currentErrors) => ({ ...currentErrors, [name]: undefined }));
    setFormMessage("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const validationErrors = validateForm(form);
    setErrors(validationErrors);
    setFormMessage("");
    if (Object.keys(validationErrors).length) return;

    setIsSubmitting(true);
    try {
      const response = await candidateRegister({
        invitation_token: token,
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        phone: normalizePkMobile(form.phone),
        password: form.password,
        confirm_password: form.confirm_password,
        terms_accepted: form.terms_accepted,
      });
      sessionStorage.setItem("pendingEmail", form.email.trim());
      sessionStorage.setItem("pendingRole", "candidate");
      setFormMessage(response.message);
      router.push("/verify-email");
    } catch (error) {
      setFormMessage(getApiErrorMessage(error, "Registration failed. Please try again."));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (inviteState.status === "loading") {
    return (
      <main className="verification-shell">
        <section className="verification-card">
          <span className="loading-dot" aria-label="Loading" />
          <p className="verification-message">Validating your invitation…</p>
        </section>
      </main>
    );
  }

  if (inviteState.status === "error") {
    return (
      <main className="verification-shell">
        <section className="verification-card" aria-labelledby="invite-error-heading">
          <Image src="/mazik-logo.png" alt="Mazik Global" width={192} height={52} priority />
          <div className="verification-icon error" aria-hidden="true">!</div>
          <p className="eyebrow">Invitation</p>
          <h1 id="invite-error-heading">Invitation unavailable</h1>
          <p className="verification-message">{inviteState.message}</p>
          <Link className="secondary-link" href="/login">Go to sign in</Link>
        </section>
      </main>
    );
  }

  const invitation = inviteState.invitation;

  return (
    <main className={styles.shell}>
      <div className={styles.card}>
        <aside className={styles.aside} aria-label="Candidate onboarding introduction">
          <div className={styles.asideBrandRow}>
            <Image src="/mazik-logo.png" alt="Mazik Global" width={192} height={52} className={styles.asideLogo} priority />
          </div>
          <div className={styles.asideContent}>
            <div>
              <span className={styles.asideEyebrow}>✦ Candidate onboarding</span>
              <h2 className={styles.asideHeading}>Your offer is ready. Let&apos;s get you <em>onboarded.</em></h2>
              <p className={styles.asideText}>Register with this invitation, verify your email, then complete your employee onboarding profile.</p>
            </div>
          </div>
        </aside>

        <section className={styles.panel} aria-labelledby="candidate-register-heading">
          <div className={styles.intro}>
            <span className={styles.eyebrow}>Candidate onboarding</span>
            <h1 id="candidate-register-heading" className={styles.heading}>Create your account</h1>
            <p className={styles.subtext}>
              You&apos;ve been invited for <strong>{invitation.job_title}</strong> in{" "}
              <strong>{invitation.department}</strong>. Create your account, then enter the
              6-digit code we email you to verify and start onboarding.
            </p>
          </div>

          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            {/* Full Name - Single row */}
            <FormField 
              label="Full name" 
              name="full_name" 
              value={form.full_name} 
              error={errors.full_name} 
              onChange={updateField} 
              autoComplete="name" 
            />

            {/* Email + Phone - Two columns */}
            <div className={styles.formRow}>
              <FormField
                label="Work email"
                name="email"
                type="email"
                value={form.email}
                error={errors.email}
                onChange={updateField}
                autoComplete="email"
                hint="Must match the email on your invitation."
                readOnly
              />
              <FormField 
                label="Phone number" 
                name="phone" 
                type="tel" 
                value={form.phone} 
                error={errors.phone} 
                onChange={updateField} 
                autoComplete="tel" 
                hint={PK_MOBILE_HINT} 
                placeholder="0300-1234567" 
              />
            </div>

            {/* Password + Confirm Password - Two columns */}
            <div className={styles.formRow}>
              <PasswordField 
                label="Password" 
                name="password" 
                value={form.password} 
                error={errors.password} 
                onChange={updateField} 
                showPassword={showPassword} 
                onToggle={() => setShowPassword((visible) => !visible)} 
                autoComplete="new-password" 
              />
              <PasswordField 
                label="Confirm password" 
                name="confirm_password" 
                value={form.confirm_password} 
                error={errors.confirm_password} 
                onChange={updateField} 
                showPassword={showPassword} 
                onToggle={() => setShowPassword((visible) => !visible)} 
                autoComplete="new-password" 
              />
            </div>

            <label className={styles.checkboxField}>
              <input name="terms_accepted" type="checkbox" checked={form.terms_accepted} onChange={updateField} />
              <span>I agree to the Terms &amp; Conditions.</span>
            </label>
            {errors.terms_accepted && <p className={styles.fieldError}>⚠ {errors.terms_accepted}</p>}
            {formMessage && <p className={styles.fieldError} role="status">⚠ {formMessage}</p>}

            <button className={styles.primaryButton} type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating account…" : "Create account & verify email"}
            </button>
          </form>

          <p className={styles.footer}>Already registered? <Link href="/login">Sign in</Link></p>
        </section>
      </div>
    </main>
  );
}

function FormField({ label, name, type = "text", value, error, hint, onChange, autoComplete, readOnly, placeholder }) {
  return (
    <label className={`${styles.field} ${styles.animField}`}>
      <span>{label}</span>
      <span className={styles.inputShell}>
        <FieldIcon type={name} />
        <input 
          className={styles.input}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${name}-error` : undefined}
          name={name}
          type={type}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          readOnly={readOnly}
          placeholder={placeholder}
        />
      </span>
      {hint && !error && <small className={styles.hint}>{hint}</small>}
      {error && <small className={styles.fieldError} id={`${name}-error`}>⚠ {error}</small>}
    </label>
  );
}

function PasswordField({ label, name, value, error, onChange, showPassword, onToggle, autoComplete }) {
  return (
    <label className={`${styles.field} ${styles.animField}`}>
      <span>{label}</span>
      <div className={styles.passwordControl}>
        {/* Lock icon with proper positioning */}
        <svg 
          className={styles.inputIcon} 
          style={{ left: "11px", zIndex: 2, position: "absolute", pointerEvents: "none" }}
          viewBox="0 0 20 20" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="1.5" 
          aria-hidden="true"
        >
          <rect x="5" y="9" width="10" height="7" rx="1" />
          <path d="M7.3 9V6.8a2.7 2.7 0 0 1 5.4 0V9" />
        </svg>
        <input
          className={styles.input}
          style={{ paddingLeft: "35px" }} // Gap between lock icon and text
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${name}-error` : undefined}
          name={name}
          type={showPassword ? "text" : "password"}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
        />
        <button 
          type="button" 
          className={styles.toggleButton} 
          onClick={onToggle} 
          aria-label={`${showPassword ? "Hide" : "Show"} password`}
        >
          {showPassword ? "Hide" : "Show"}
        </button>
      </div>
      {error && <small className={styles.fieldError} id={`${name}-error`}>⚠ {error}</small>}
    </label>
  );
}

function FieldIcon({ type }) {
  if (type === "email") {
    return (
      <svg className={styles.inputIcon} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M3 5.5 10 10l7-4.5M4 4h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
      </svg>
    );
  }
  if (type === "phone") {
    return (
      <svg className={styles.inputIcon} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M6.2 3.5 8 6.8 6.5 8.1c.9 1.9 2.4 3.4 4.3 4.3l1.3-1.5 3.3 1.8-.5 3.1c-4.8.5-10.8-5.5-10.3-10.3l1.6-2Z" />
      </svg>
    );
  }
  // Full name icon
  return (
    <svg className={styles.inputIcon} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="10" cy="6.3" r="2.8" />
      <path d="M4.5 16.5c.6-3 2.5-4.6 5.5-4.6s4.9 1.6 5.5 4.6" />
    </svg>
  );
}
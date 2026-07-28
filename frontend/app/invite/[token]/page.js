"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import AuthAside, { INVITE_SLIDES } from "@/components/auth/AuthAside";
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
    errors.phone = "Contact is required.";
  } else if (!isValidPkMobile(form.phone)) {
    errors.phone = `Enter a valid Pakistani contact number (${PK_MOBILE_HINT}).`;
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

function getPasswordRequirements(password) {
  return {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /\d/.test(password),
    special: /[^\w\s]/.test(password),
  };
}

export default function InviteRegisterPage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token;

  const [inviteState, setInviteState] = useState({ status: "loading", invitation: null, message: "" });
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const strength = useMemo(() => getPasswordStrength(form.password), [form.password]);

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
      toast.success(response.message || "Account created. Check your email to verify.");
      router.push("/verify-email");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Registration failed. Please try again."));
    } finally {
      setIsSubmitting(false);
    }
  }

  const showError = (field) => touched[field] && errors[field];
  const invitation = inviteState.invitation;

  if (inviteState.status === "loading") {
    return (
      <main className={styles.shell}>
        <div className={styles.card}>
          <section className={styles.panel} aria-busy="true" aria-live="polite">
            <div className={styles.brandRow}>
              <Image src="/mazikglobal-logo.png" alt="Mazik Global" width={192} height={52} priority />
              <span className={styles.brandDivider} aria-hidden="true" />
              <span className={styles.productName}>Talent</span>
            </div>
            <div className={styles.intro}>
              <p className={styles.eyebrow}>Offer invitation</p>
              <h1 className={styles.heading}>Validating your invitation</h1>
              <p className={styles.subtext}>Hang on while we confirm this invite link…</p>
            </div>
            <p className={styles.formMessage} role="status">
              <span
                className={styles.spinner}
                style={{
                  display: "inline-block",
                  verticalAlign: "middle",
                  marginRight: 10,
                  borderColor: "rgba(31, 127, 224, 0.25)",
                  borderTopColor: "var(--blue-strong)",
                }}
              />
              Checking invitation…
            </p>
          </section>
          <AuthAside slides={INVITE_SLIDES} ariaLabel="Candidate invitation introduction" />
        </div>
      </main>
    );
  }

  if (inviteState.status === "error") {
    return (
      <main className={styles.shell}>
        <div className={styles.card}>
          <section className={styles.panel} aria-labelledby="invite-error-heading">
            <div className={styles.brandRow}>
              <Image src="/mazikglobal-logo.png" alt="Mazik Global" width={192} height={52} priority />
              <span className={styles.brandDivider} aria-hidden="true" />
              <span className={styles.productName}>Talent</span>
            </div>
            <div className={styles.intro}>
              <p className={styles.eyebrow}>Invitation</p>
              <h1 id="invite-error-heading" className={styles.heading}>Invitation unavailable</h1>
              <p className={styles.subtext}>{inviteState.message}</p>
            </div>
            <p className={`${styles.formMessage} ${styles.formMessageError}`} role="alert">
              This link may be expired, already used, or invalid.
            </p>
            <Link className={styles.primaryButton} href="/login" style={{ textAlign: "center", textDecoration: "none" }}>
              Go to sign in
            </Link>
            <p className={styles.footer}>Need a new invite? Ask your recruiter to resend one.</p>
          </section>
          <AuthAside slides={INVITE_SLIDES} ariaLabel="Candidate invitation introduction" />
        </div>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <ToastContainer position="top-right" autoClose={4000} theme="colored" newestOnTop />

      <div className={styles.card}>
        <section className={styles.panel} aria-labelledby="candidate-register-heading">
          <div className={styles.brandRow}>
            <Image src="/mazikglobal-logo.png" alt="Mazik Global" width={192} height={52} priority />
            <span className={styles.brandDivider} aria-hidden="true" />
            <span className={styles.productName}>Talent</span>
          </div>

          <div className={styles.intro}>
            <p className={styles.eyebrow}>Offer invitation</p>
            <h1 id="candidate-register-heading" className={styles.heading}>Create your Talent account</h1>
            <p className={styles.subtext}>
              You&apos;ve been offered <strong>{invitation.job_title}</strong> in{" "}
              <strong>{invitation.department}</strong> at <strong>Mazik Global Pakistan</strong>. Create your
              account, verify your email, then review and sign your offer letter.
            </p>
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
              required
            />
            <FormField
              delay="100ms"
              label="Work email"
              name="email"
              type="email"
              value={form.email}
              error={showError("email") ? errors.email : undefined}
              onChange={updateField}
              onBlur={handleBlur}
              autoComplete="email"
              hint="Must match the email on your invitation."
              placeholder="you@company.com"
              readOnly
              required
            />
            <FormField
              delay="140ms"
              label="Contact"
              name="phone"
              type="tel"
              value={form.phone}
              error={showError("phone") ? errors.phone : undefined}
              onChange={updateField}
              onBlur={handleBlur}
              autoComplete="tel"
              hint={PK_MOBILE_HINT}
              placeholder="0300-1234567"
              required
            />

            <label className={`${styles.field} ${styles.animField}`} style={{ animationDelay: "180ms" }}>
              <span>
                Password <span style={{ color: "#b42318" }}>*</span>
              </span>
              <span className={styles.passwordControl}>
                <input
                  className={styles.input}
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
              {form.password && (
                <>
                  <div className={styles.strengthTrack}>
                    <div
                      className={styles.strengthFill}
                      style={{ width: `${strength.score}%`, background: strength.color }}
                    />
                  </div>
                  <small className={styles.strengthLabel} style={{ color: strength.color }}>
                    {strength.label}
                  </small>
                  <div className={styles.strengthRequirements}>
                    {Object.entries(getPasswordRequirements(form.password)).map(([key, met]) => (
                      <div key={key} className={`${styles.requirement} ${met ? styles.met : ""}`}>
                        <span className={styles.requirementCheck}>{met ? "✓" : ""}</span>
                        <span>
                          {key === "length" && "At least 8 characters"}
                          {key === "uppercase" && "One uppercase letter (A-Z)"}
                          {key === "lowercase" && "One lowercase letter (a-z)"}
                          {key === "number" && "One number (0-9)"}
                          {key === "special" && "One special character (!@#$%^&*)"}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {!form.password && (
                <small className={styles.hint}>
                  8+ characters, with uppercase, lowercase, number, and special character.
                </small>
              )}
              {showError("password") && (
                <small className={styles.fieldError} id="password-error">
                  ⚠ {errors.password}
                </small>
              )}
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
              required
            />

            <label className={styles.checkboxField} style={{ animationDelay: "260ms" }}>
              <input
                name="terms_accepted"
                type="checkbox"
                checked={form.terms_accepted}
                onChange={updateField}
                onBlur={handleBlur}
              />
              <span>I agree to the Terms &amp; Conditions.</span>
            </label>
            {showError("terms_accepted") && (
              <p className={styles.fieldError}>⚠ {errors.terms_accepted}</p>
            )}

            <button
              className={styles.primaryButton}
              type="submit"
              disabled={isSubmitting}
              style={{ animationDelay: "300ms" }}
            >
              {isSubmitting && <span className={styles.spinner} />}
              {isSubmitting ? "Creating account…" : "Create account & verify email"}
            </button>
          </form>

          <p className={styles.footer}>
            Already registered? <Link href="/login">Sign in</Link>
          </p>
        </section>

        <AuthAside slides={INVITE_SLIDES} ariaLabel="Candidate invitation introduction" />
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
  delay,
  readOnly = false,
  required = false,
}) {
  const isTouched = value !== "" || error;
  return (
    <label className={`${styles.field} ${styles.animField}`} style={{ animationDelay: delay }}>
      <span>
        {label}
        {required ? <span style={{ color: "#b42318", marginLeft: 4 }}>*</span> : null}
      </span>
      <input
        className={styles.input}
        aria-invalid={isTouched ? Boolean(error) : undefined}
        aria-describedby={error ? `${name}-error` : undefined}
        aria-required={required || undefined}
        name={name}
        type={type}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        autoComplete={autoComplete}
        placeholder={placeholder}
        readOnly={readOnly}
        required={required}
      />
      {hint && !error && <small className={styles.hint}>{hint}</small>}
      {error && (
        <small className={styles.fieldError} id={`${name}-error`}>
          ⚠ {error}
        </small>
      )}
    </label>
  );
}

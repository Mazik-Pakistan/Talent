"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { candidateRegister, getApiErrorMessage, getInvitation } from "@/services/authService";

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
  if (!/^[+()\-\s\d]{7,20}$/.test(form.phone.trim())) errors.phone = "Enter a valid phone number.";
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
    setForm((currentForm) => ({ ...currentForm, [name]: type === "checkbox" ? checked : value }));
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
        phone: form.phone.trim(),
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
          <Image src="/mazikglobal-logo.png" alt="Mazik Global" width={192} height={52} priority />
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
    <main className="auth-shell">
      <section className="auth-panel" aria-labelledby="candidate-register-heading">
        <div className="brand-row">
          <Image src="/mazikglobal-logo.png" alt="Mazik Global" width={192} height={52} priority />
          <span className="brand-divider" aria-hidden="true" />
          <span className="product-name">Talent</span>
        </div>

        <div className="auth-intro">
          <p className="eyebrow">Candidate onboarding</p>
          <h1 id="candidate-register-heading">Create your account</h1>
          <p>
            You&apos;ve been invited for <strong>{invitation.job_title}</strong> in{" "}
            <strong>{invitation.department}</strong>. Complete registration to begin onboarding.
          </p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <FormField label="Full name" name="full_name" value={form.full_name} error={errors.full_name} onChange={updateField} autoComplete="name" />
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
          <FormField label="Phone number" name="phone" type="tel" value={form.phone} error={errors.phone} onChange={updateField} autoComplete="tel" />
          <PasswordField label="Password" name="password" value={form.password} error={errors.password} onChange={updateField} showPassword={showPassword} onToggle={() => setShowPassword((visible) => !visible)} autoComplete="new-password" />
          <PasswordField label="Confirm password" name="confirm_password" value={form.confirm_password} error={errors.confirm_password} onChange={updateField} showPassword={showPassword} onToggle={() => setShowPassword((visible) => !visible)} autoComplete="new-password" />

          <label className="checkbox-field">
            <input name="terms_accepted" type="checkbox" checked={form.terms_accepted} onChange={updateField} />
            <span>I agree to the Terms &amp; Conditions.</span>
          </label>
          {errors.terms_accepted && <p className="field-error">{errors.terms_accepted}</p>}
          {formMessage && <p className="form-message" role="status">{formMessage}</p>}

          <button className="primary-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Creating account…" : "Create account & verify email"}
          </button>
        </form>

        <p className="auth-footer">Already registered? <Link href="/login">Sign in</Link></p>
      </section>

      <aside className="auth-aside" aria-label="Onboarding introduction">
        <div>
          <p className="eyebrow">Mazik Global</p>
          <h2>Your offer is ready. Let&apos;s get you onboarded.</h2>
          <p>Register with this invitation, verify your email, then complete your employee onboarding profile.</p>
        </div>
        <div className="aside-metric">
          <strong>Secure invitation</strong>
          <span>Only invitees can create a candidate account for this role.</span>
        </div>
      </aside>
    </main>
  );
}

function FormField({ label, name, type = "text", value, error, hint, onChange, autoComplete, readOnly }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${name}-error` : undefined}
        name={name}
        type={type}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        readOnly={readOnly}
      />
      {hint && <small>{hint}</small>}
      {error && <small className="field-error" id={`${name}-error`}>{error}</small>}
    </label>
  );
}

function PasswordField({ label, name, value, error, onChange, showPassword, onToggle, autoComplete }) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="password-control">
        <input
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${name}-error` : undefined}
          name={name}
          type={showPassword ? "text" : "password"}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
        />
        <button type="button" className="toggle-button" onClick={onToggle} aria-label={`${showPassword ? "Hide" : "Show"} password`}>
          {showPassword ? "Hide" : "Show"}
        </button>
      </span>
      {error && <small className="field-error" id={`${name}-error`}>{error}</small>}
    </label>
  );
}

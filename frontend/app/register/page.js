"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { getApiErrorMessage, register } from "@/services/authService";

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

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formMessage, setFormMessage] = useState("");

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
      const response = await register({ ...form, full_name: form.full_name.trim(), email: form.email.trim() });
      // Store email so the verification page can offer a resend
      sessionStorage.setItem("pendingEmail", form.email.trim());
      setFormMessage(response.message);
      router.push("/verify-email");
    } catch (error) {
      setFormMessage(getApiErrorMessage(error, "Registration failed. Please try again."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-labelledby="register-heading">
        <div className="brand-row">
          <Image src="/mazikglobal-logo.png" alt="Mazik Global" width={192} height={52} priority />
          <span className="brand-divider" aria-hidden="true" />
          <span className="product-name">Talent</span>
        </div>

        <div className="auth-intro">
          <p className="eyebrow">Recruiter access</p>
          <h1 id="register-heading">Create your Talent account</h1>
          <p>Set up secure access to manage your recruitment and onboarding workflows.</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <FormField label="Full name" name="full_name" value={form.full_name} error={errors.full_name} onChange={updateField} autoComplete="name" />
          <FormField label="Company email" name="email" type="email" value={form.email} error={errors.email} onChange={updateField} autoComplete="email" hint="Use your work email address." />
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
            {isSubmitting ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="auth-footer">Already have an account? <Link href="/login">Sign in</Link></p>
      </section>

      <aside className="auth-aside" aria-label="Talent platform introduction">
        <div>
          <p className="eyebrow">Mazik Global</p>
          <h2>People operations, made more connected.</h2>
          <p>Talent gives recruitment teams a clear, secure path from candidate selection to successful onboarding.</p>
        </div>
        <div className="aside-metric"><strong>Secure by design</strong><span>Email verification protects every recruiter account.</span></div>
      </aside>
    </main>
  );
}

function FormField({ label, name, type = "text", value, error, hint, onChange, autoComplete }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input aria-invalid={Boolean(error)} aria-describedby={error ? `${name}-error` : undefined} name={name} type={type} value={value} onChange={onChange} autoComplete={autoComplete} />
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
        <input aria-invalid={Boolean(error)} aria-describedby={error ? `${name}-error` : undefined} name={name} type={showPassword ? "text" : "password"} value={value} onChange={onChange} autoComplete={autoComplete} />
        <button type="button" className="toggle-button" onClick={onToggle} aria-label={`${showPassword ? "Hide" : "Show"} password`}>{showPassword ? "Hide" : "Show"}</button>
      </span>
      {error && <small className="field-error" id={`${name}-error`}>{error}</small>}
    </label>
  );
}
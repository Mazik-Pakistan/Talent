"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { getApiErrorMessage, getOnboarding, saveOnboarding } from "@/services/authService";
import { can, ROLE_HOME } from "@/services/rbac";

const STEPS = [
  { id: "personal", label: "Personal" },
  { id: "emergency", label: "Emergency" },
  { id: "employment", label: "Payroll" },
  { id: "documents", label: "Documents" },
  { id: "submit", label: "Review" },
];

const emptyPersonal = {
  date_of_birth: "",
  national_id: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  postal_code: "",
  country: "",
};

const emptyEmergency = { name: "", relationship: "", phone: "" };
const emptyEmployment = {
  bank_name: "",
  account_holder_name: "",
  account_number: "",
  tax_id: "",
};
const emptyDocuments = {
  accepted_code_of_conduct: false,
  accepted_privacy_policy: false,
  accepted_employee_handbook: false,
};

export default function OnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [candidate, setCandidate] = useState(null);
  const [onboarding, setOnboarding] = useState(null);
  const [step, setStep] = useState("personal");
  const [personal, setPersonal] = useState(emptyPersonal);
  const [emergency, setEmergency] = useState(emptyEmergency);
  const [employment, setEmployment] = useState(emptyEmployment);
  const [documents, setDocuments] = useState(emptyDocuments);

  useEffect(() => {
    const accessToken = localStorage.getItem("access_token");
    const storedUser = localStorage.getItem("user");
    if (!accessToken || !storedUser) {
      router.replace("/login");
      return;
    }

    const parsedUser = JSON.parse(storedUser);
    if (!can(parsedUser, "onboarding.self")) {
      router.replace(ROLE_HOME[parsedUser.role] || "/login");
      return;
    }
    if (parsedUser.role !== "candidate" && parsedUser.role !== "employee" && parsedUser.role !== "super_admin") {
      router.replace(ROLE_HOME[parsedUser.role] || "/dashboard");
      return;
    }

    Promise.resolve().then(async () => {
      try {
        const data = await getOnboarding(accessToken);
        setCandidate(data.candidate);
        setOnboarding(data.onboarding);
        hydrateForms(data.onboarding);
        const nextStep =
          data.onboarding?.status === "submitted"
            ? "submit"
            : data.onboarding?.current_step || "personal";
        setStep(nextStep === "complete" ? "submit" : nextStep);
      } catch (error) {
        setMessage(getApiErrorMessage(error, "Unable to load onboarding."));
      } finally {
        setLoading(false);
      }
    });
  }, [router]);

  function hydrateForms(data) {
    if (!data) return;
    if (data.personal) setPersonal({ ...emptyPersonal, ...data.personal });
    if (data.emergency) setEmergency({ ...emptyEmergency, ...data.emergency });
    if (data.employment) setEmployment({ ...emptyEmployment, ...data.employment });
    if (data.documents) setDocuments({ ...emptyDocuments, ...data.documents });
  }

  const stepIndex = useMemo(() => STEPS.findIndex((item) => item.id === step), [step]);
  const submitted = onboarding?.status === "submitted";

  async function persist(payload) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const data = await saveOnboarding(payload, accessToken);
      setOnboarding(data.onboarding);
      setCandidate(data.candidate);
      hydrateForms(data.onboarding);
      setMessage(data.message);
      if (payload.step === "submit") {
        setStep("submit");
      } else if (data.onboarding?.current_step) {
        setStep(data.onboarding.current_step === "complete" ? "submit" : data.onboarding.current_step);
      }
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Could not save this step."));
    } finally {
      setSaving(false);
    }
  }

  async function handleNext(event) {
    event.preventDefault();
    if (submitted) return;

    if (step === "personal") {
      if (!personal.date_of_birth || !personal.national_id || !personal.address_line1 || !personal.city || !personal.state || !personal.postal_code || !personal.country) {
        setMessage("Please complete all required personal fields.");
        return;
      }
      await persist({ step: "personal", personal });
    } else if (step === "emergency") {
      if (!emergency.name || !emergency.relationship || !emergency.phone) {
        setMessage("Please complete your emergency contact.");
        return;
      }
      await persist({ step: "emergency", emergency });
    } else if (step === "employment") {
      if (!employment.bank_name || !employment.account_holder_name || !employment.account_number || !employment.tax_id) {
        setMessage("Please complete payroll details.");
        return;
      }
      await persist({ step: "employment", employment });
    } else if (step === "documents") {
      if (!documents.accepted_code_of_conduct || !documents.accepted_privacy_policy || !documents.accepted_employee_handbook) {
        setMessage("Acknowledge all required documents to continue.");
        return;
      }
      await persist({ step: "documents", documents });
    } else if (step === "submit") {
      await persist({ step: "submit" });
    }
  }

  function goBack() {
    if (stepIndex <= 0 || submitted) return;
    setStep(STEPS[stepIndex - 1].id);
    setMessage("");
  }

  function handleLogout() {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("user");
    router.replace("/login");
  }

  if (loading) {
    return (
      <main className="onboarding-shell">
        <p className="verification-message" style={{ textAlign: "center" }}>Loading onboarding…</p>
      </main>
    );
  }

  return (
    <main className="onboarding-shell">
      <header className="onboarding-header">
        <div className="brand-row">
          <Image src="/mazikglobal-logo.png" alt="Mazik Global" width={160} height={44} priority />
          <span className="brand-divider" aria-hidden="true" />
          <span className="product-name">Talent</span>
        </div>
        <button type="button" className="toggle-button" onClick={handleLogout}>Sign out</button>
      </header>

      <section className="onboarding-card">
        <p className="eyebrow">Employee onboarding</p>
        <h1>Welcome, {candidate?.full_name}</h1>
        <p className="onboarding-lead">
          Role: <strong>{candidate?.job_title}</strong> · {candidate?.department}
        </p>

        <ol className="onboarding-steps" aria-label="Onboarding progress">
          {STEPS.map((item, index) => (
            <li key={item.id} className={index <= stepIndex ? "active" : ""}>
              <span>{index + 1}</span>
              {item.label}
            </li>
          ))}
        </ol>

        {submitted ? (
          <div className="onboarding-complete">
            <div className="verification-icon success" aria-hidden="true">✓</div>
            <h2>Onboarding submitted</h2>
            <p>Your details have been sent to your recruiter. You can sign out or review your answers below.</p>
          </div>
        ) : null}

        <form className="auth-form" onSubmit={handleNext}>
          {step === "personal" && (
            <>
              <h2 className="step-title">Personal information</h2>
              <div className="form-grid">
                <Field label="Date of birth" name="date_of_birth" type="date" value={personal.date_of_birth} onChange={(e) => setPersonal({ ...personal, date_of_birth: e.target.value })} disabled={submitted} />
                <Field label="National ID / Passport" name="national_id" value={personal.national_id} onChange={(e) => setPersonal({ ...personal, national_id: e.target.value })} disabled={submitted} />
                <Field label="Address line 1" name="address_line1" value={personal.address_line1} onChange={(e) => setPersonal({ ...personal, address_line1: e.target.value })} disabled={submitted} wide />
                <Field label="Address line 2" name="address_line2" value={personal.address_line2} onChange={(e) => setPersonal({ ...personal, address_line2: e.target.value })} disabled={submitted} wide />
                <Field label="City" name="city" value={personal.city} onChange={(e) => setPersonal({ ...personal, city: e.target.value })} disabled={submitted} />
                <Field label="State / Province" name="state" value={personal.state} onChange={(e) => setPersonal({ ...personal, state: e.target.value })} disabled={submitted} />
                <Field label="Postal code" name="postal_code" value={personal.postal_code} onChange={(e) => setPersonal({ ...personal, postal_code: e.target.value })} disabled={submitted} />
                <Field label="Country" name="country" value={personal.country} onChange={(e) => setPersonal({ ...personal, country: e.target.value })} disabled={submitted} />
              </div>
            </>
          )}

          {step === "emergency" && (
            <>
              <h2 className="step-title">Emergency contact</h2>
              <div className="form-grid">
                <Field label="Contact name" name="name" value={emergency.name} onChange={(e) => setEmergency({ ...emergency, name: e.target.value })} disabled={submitted} />
                <Field label="Relationship" name="relationship" value={emergency.relationship} onChange={(e) => setEmergency({ ...emergency, relationship: e.target.value })} disabled={submitted} />
                <Field label="Phone" name="phone" value={emergency.phone} onChange={(e) => setEmergency({ ...emergency, phone: e.target.value })} disabled={submitted} />
              </div>
            </>
          )}

          {step === "employment" && (
            <>
              <h2 className="step-title">Payroll & tax</h2>
              <div className="form-grid">
                <Field label="Bank name" name="bank_name" value={employment.bank_name} onChange={(e) => setEmployment({ ...employment, bank_name: e.target.value })} disabled={submitted} />
                <Field label="Account holder" name="account_holder_name" value={employment.account_holder_name} onChange={(e) => setEmployment({ ...employment, account_holder_name: e.target.value })} disabled={submitted} />
                <Field label="Account number" name="account_number" value={employment.account_number} onChange={(e) => setEmployment({ ...employment, account_number: e.target.value })} disabled={submitted} />
                <Field label="Tax ID" name="tax_id" value={employment.tax_id} onChange={(e) => setEmployment({ ...employment, tax_id: e.target.value })} disabled={submitted} />
              </div>
            </>
          )}

          {step === "documents" && (
            <>
              <h2 className="step-title">Acknowledge documents</h2>
              <label className="checkbox-field">
                <input type="checkbox" checked={documents.accepted_code_of_conduct} disabled={submitted} onChange={(e) => setDocuments({ ...documents, accepted_code_of_conduct: e.target.checked })} />
                <span>I have read and accept the Code of Conduct.</span>
              </label>
              <label className="checkbox-field">
                <input type="checkbox" checked={documents.accepted_privacy_policy} disabled={submitted} onChange={(e) => setDocuments({ ...documents, accepted_privacy_policy: e.target.checked })} />
                <span>I have read and accept the Privacy Policy.</span>
              </label>
              <label className="checkbox-field">
                <input type="checkbox" checked={documents.accepted_employee_handbook} disabled={submitted} onChange={(e) => setDocuments({ ...documents, accepted_employee_handbook: e.target.checked })} />
                <span>I have read and accept the Employee Handbook.</span>
              </label>
            </>
          )}

          {step === "submit" && (
            <>
              <h2 className="step-title">Review & submit</h2>
              <div className="review-grid">
                <ReviewBlock title="Personal" items={[
                  ["Date of birth", personal.date_of_birth],
                  ["National ID", personal.national_id],
                  ["Address", `${personal.address_line1}${personal.address_line2 ? `, ${personal.address_line2}` : ""}`],
                  ["City", `${personal.city}, ${personal.state} ${personal.postal_code}`],
                  ["Country", personal.country],
                ]} />
                <ReviewBlock title="Emergency" items={[
                  ["Name", emergency.name],
                  ["Relationship", emergency.relationship],
                  ["Phone", emergency.phone],
                ]} />
                <ReviewBlock title="Payroll" items={[
                  ["Bank", employment.bank_name],
                  ["Account holder", employment.account_holder_name],
                  ["Account", employment.account_number],
                  ["Tax ID", employment.tax_id],
                ]} />
              </div>
            </>
          )}

          {message && <p className="form-message" role="status">{message}</p>}

          {!submitted && (
            <div className="onboarding-actions">
              <button type="button" className="secondary-button" onClick={goBack} disabled={stepIndex === 0 || saving}>
                Back
              </button>
              <button type="submit" className="primary-button" disabled={saving}>
                {saving ? "Saving…" : step === "submit" ? "Submit onboarding" : "Save & continue"}
              </button>
            </div>
          )}
        </form>
      </section>
    </main>
  );
}

function Field({ label, name, value, onChange, type = "text", disabled, wide }) {
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      <input name={name} type={type} value={value} onChange={onChange} disabled={disabled} />
    </label>
  );
}

function ReviewBlock({ title, items }) {
  return (
    <div className="review-block">
      <h3>{title}</h3>
      <dl>
        {items.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value || "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

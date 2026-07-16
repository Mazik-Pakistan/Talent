"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  clearLocalSession,
  getApiErrorMessage,
  getProfileCompletion,
  logout,
  saveProfileCompletion,
} from "@/services/authService";
import SignaturePad from "@/components/SignaturePad";
import ProgressRing from "@/components/ProgressRing";

const STEPS = [
  { id: "emergency", label: "Emergency contact" },
  { id: "employment", label: "Banking" },
  { id: "references", label: "References" },
  { id: "documents", label: "Policies" },
  { id: "nda", label: "Sign NDA" },
  { id: "submit", label: "Finish" },
];

const emptyEmergency = { name: "", relationship: "", phone: "" };
const emptyEmployment = { bank_name: "", account_holder_name: "", account_number: "", tax_id: "" };
const emptyReference = { full_name: "", relationship: "", email: "", phone: "", company: "" };
const emptyDocuments = { accepted_code_of_conduct: false, accepted_privacy_policy: false, accepted_employee_handbook: false };

export default function CompleteProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [employee, setEmployee] = useState(null);
  const [progress, setProgress] = useState(null);
  const [step, setStep] = useState("emergency");

  const [emergency, setEmergency] = useState(emptyEmergency);
  const [employment, setEmployment] = useState(emptyEmployment);
  const [references, setReferences] = useState([{ ...emptyReference }, { ...emptyReference }]);
  const [documents, setDocuments] = useState(emptyDocuments);
  const [ndaName, setNdaName] = useState("");
  const [ndaAgreed, setNdaAgreed] = useState(false);
  const [ndaSignature, setNdaSignature] = useState(null);

  const stepIndex = useMemo(() => STEPS.findIndex((s) => s.id === step), [step]);
  const complete = progress?.profile_status === "complete";

  useEffect(() => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    load(accessToken);
  }, [router]);

  async function load(accessToken) {
    setLoading(true);
    try {
      const data = await getProfileCompletion(accessToken);
      setEmployee(data.employee);
      setProgress(data.progress);
      hydrate(data.onboarding);
      if (data.progress?.current_step && data.progress.current_step !== "submit") {
        setStep(data.progress.current_step);
      } else if (data.progress?.profile_status === "complete") {
        setStep("submit");
      }
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Unable to load your profile."));
    } finally {
      setLoading(false);
    }
  }

  function hydrate(onboarding) {
    if (!onboarding) return;
    if (onboarding.emergency) setEmergency(onboarding.emergency);
    if (onboarding.employment) setEmployment(onboarding.employment);
    if (onboarding.references?.references?.length) setReferences(onboarding.references.references);
    if (onboarding.documents) setDocuments(onboarding.documents);
    if (onboarding.nda) {
      setNdaName(onboarding.nda.full_legal_name || "");
      setNdaAgreed(!!onboarding.nda.agreed);
    }
  }

  async function persist(payload) {
    const accessToken = localStorage.getItem("access_token");
    setSaving(true);
    setMessage("");
    try {
      const data = await saveProfileCompletion(payload, accessToken);
      setEmployee(data.employee);
      setProgress(data.progress);
      hydrate(data.onboarding);
      setMessage(data.message);
      if (payload.step === "submit") {
        setStep("submit");
      } else if (data.progress?.current_step) {
        setStep(data.progress.current_step);
      }
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Could not save this step."));
    } finally {
      setSaving(false);
    }
  }

  async function handleNext(event) {
    event.preventDefault();
    if (step === "emergency") {
      if (!emergency.name || !emergency.relationship || !emergency.phone) {
        setMessage("Complete your emergency contact.");
        return;
      }
      await persist({ step: "emergency", emergency });
    } else if (step === "employment") {
      if (!employment.bank_name || !employment.account_holder_name || !employment.account_number || !employment.tax_id) {
        setMessage("Complete your banking details.");
        return;
      }
      await persist({ step: "employment", employment });
    } else if (step === "references") {
      const valid = references.length >= 2 && references.every((r) => r.full_name && r.relationship && r.email && r.phone && r.company);
      if (!valid) {
        setMessage("Provide at least two complete references.");
        return;
      }
      await persist({ step: "references", references: { references } });
    } else if (step === "documents") {
      if (!documents.accepted_code_of_conduct || !documents.accepted_privacy_policy || !documents.accepted_employee_handbook) {
        setMessage("Acknowledge all three policies to continue.");
        return;
      }
      await persist({ step: "documents", documents });
    } else if (step === "nda") {
      if (!ndaName || !ndaAgreed) {
        setMessage("Type your legal name and agree to sign the NDA.");
        return;
      }
      await persist({ step: "nda", nda: { full_legal_name: ndaName, agreed: ndaAgreed } });
    } else if (step === "submit") {
      await persist({ step: "submit" });
    }
  }

  async function handleLogout() {
    const accessToken = localStorage.getItem("access_token");
    await logout(accessToken);
    clearLocalSession();
    router.replace("/login");
  }

  if (loading) {
    return (
      <main className="onboarding-shell">
        <p style={{ textAlign: "center" }}>Loading your profile…</p>
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
        <button type="button" onClick={handleLogout} className="secondary-button" style={{ borderColor: "#f3c9c3", color: "#b42318" }}>
          Sign out
        </button>
      </header>

      <section className="onboarding-card">
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 8 }}>
          <ProgressRing percentage={progress?.percentage ?? 0} size={64} />
          <div>
            <p className="eyebrow">Welcome aboard</p>
            <h1 style={{ marginBottom: 2 }}>Complete your profile</h1>
            <p className="onboarding-lead" style={{ margin: 0 }}>
              {employee?.employee_id} · {employee?.job_title}
            </p>
          </div>
        </div>

        {complete && step === "submit" ? (
          <div className="onboarding-complete">
            <div className="verification-icon success" style={{ margin: "0 auto 18px" }}>✓</div>
            <h2>Your profile is complete, {employee?.full_name?.split(" ")[0]}!</h2>
            <p className="onboarding-lead" style={{ maxWidth: 420, margin: "0 auto 24px" }}>
              Emergency contact, banking, references, policies, and your NDA are all on file. Welcome to the team.
            </p>
            <button type="button" className="primary-button" onClick={() => router.push("/dashboard/employee")}>
              Go to my dashboard
            </button>
          </div>
        ) : (
          <>
            <ol className="onboarding-steps" aria-label="Profile completion">
              {STEPS.map((item, index) => (
                <li key={item.id} className={index <= stepIndex ? "active" : ""}>
                  <button type="button" onClick={() => setStep(item.id)}>
                    <span>{index + 1}</span>
                    {item.label}
                  </button>
                </li>
              ))}
            </ol>

            {message && <p className="form-message" role="status">{message}</p>}

            <form className="auth-form" onSubmit={handleNext}>
              {step === "emergency" && (
                <div className="form-grid">
                  <h2 className="step-title">Emergency contact</h2>
                  <Field label="Full name" value={emergency.name} onChange={(e) => setEmergency({ ...emergency, name: e.target.value })} />
                  <Field label="Relationship" value={emergency.relationship} onChange={(e) => setEmergency({ ...emergency, relationship: e.target.value })} />
                  <Field label="Phone" value={emergency.phone} onChange={(e) => setEmergency({ ...emergency, phone: e.target.value })} />
                </div>
              )}

              {step === "employment" && (
                <div className="form-grid">
                  <h2 className="step-title">Banking details</h2>
                  <Field label="Bank name" value={employment.bank_name} onChange={(e) => setEmployment({ ...employment, bank_name: e.target.value })} />
                  <Field label="Account holder" value={employment.account_holder_name} onChange={(e) => setEmployment({ ...employment, account_holder_name: e.target.value })} />
                  <Field label="Account number / IBAN" value={employment.account_number} onChange={(e) => setEmployment({ ...employment, account_number: e.target.value })} />
                  <Field label="Tax ID" value={employment.tax_id} onChange={(e) => setEmployment({ ...employment, tax_id: e.target.value })} />
                </div>
              )}

              {step === "references" && (
                <div>
                  <h2 className="step-title">Professional references</h2>
                  <p style={{ marginTop: -8, color: "#5c7086" }}>Provide at least two references.</p>
                  {references.map((ref, index) => (
                    <div key={index} className="form-grid" style={{ marginBottom: 16, paddingBottom: 16, borderBottom: "1px solid #e2e8f0" }}>
                      <Field label="Full name" value={ref.full_name} onChange={(e) => {
                        const next = [...references]; next[index] = { ...next[index], full_name: e.target.value }; setReferences(next);
                      }} />
                      <Field label="Relationship" value={ref.relationship} onChange={(e) => {
                        const next = [...references]; next[index] = { ...next[index], relationship: e.target.value }; setReferences(next);
                      }} />
                      <Field label="Email" type="email" value={ref.email} onChange={(e) => {
                        const next = [...references]; next[index] = { ...next[index], email: e.target.value }; setReferences(next);
                      }} />
                      <Field label="Phone" value={ref.phone} onChange={(e) => {
                        const next = [...references]; next[index] = { ...next[index], phone: e.target.value }; setReferences(next);
                      }} />
                      <Field label="Company" value={ref.company} onChange={(e) => {
                        const next = [...references]; next[index] = { ...next[index], company: e.target.value }; setReferences(next);
                      }} />
                    </div>
                  ))}
                  <button type="button" className="secondary-button" onClick={() => setReferences((c) => [...c, { ...emptyReference }])}>
                    Add another reference
                  </button>
                </div>
              )}

              {step === "documents" && (
                <div>
                  <h2 className="step-title">Company policies</h2>
                  <p style={{ marginTop: -8, color: "#5c7086" }}>Review and acknowledge each policy below.</p>
                  <label className="checkbox-field">
                    <input type="checkbox" checked={documents.accepted_code_of_conduct} onChange={(e) => setDocuments({ ...documents, accepted_code_of_conduct: e.target.checked })} />
                    <span>I have read and agree to the Code of Conduct.</span>
                  </label>
                  <label className="checkbox-field">
                    <input type="checkbox" checked={documents.accepted_privacy_policy} onChange={(e) => setDocuments({ ...documents, accepted_privacy_policy: e.target.checked })} />
                    <span>I have read and agree to the Privacy & IT Security Policy.</span>
                  </label>
                  <label className="checkbox-field">
                    <input type="checkbox" checked={documents.accepted_employee_handbook} onChange={(e) => setDocuments({ ...documents, accepted_employee_handbook: e.target.checked })} />
                    <span>I have read and agree to the Employee Handbook (Leave & Remote Work Policy).</span>
                  </label>
                </div>
              )}

              {step === "nda" && (
                <div className="offer-sign-block">
                  <h3>Non-Disclosure Agreement</h3>
                  <p>Type your full legal name, sign below, and confirm agreement to keep company information confidential.</p>
                  <label className="field">
                    <span>Full legal name</span>
                    <input value={ndaName} onChange={(e) => setNdaName(e.target.value)} />
                  </label>
                  <SignaturePad onChange={setNdaSignature} />
                  <label className="checkbox-field">
                    <input type="checkbox" checked={ndaAgreed} onChange={(e) => setNdaAgreed(e.target.checked)} />
                    <span>I agree to the terms of the Non-Disclosure Agreement.</span>
                  </label>
                </div>
              )}

              {step === "submit" && (
                <div>
                  <h2 className="step-title">Review & finish</h2>
                  <p>All sections below are saved. Submit to complete your profile.</p>
                  <div className="review-grid">
                    <ReviewBlock title="Emergency contact" items={Object.entries(emergency)} />
                    <ReviewBlock title="Banking" items={[["bank_name", employment.bank_name], ["account_holder_name", employment.account_holder_name]]} />
                    <ReviewBlock title="References" items={[["count", String(references.length)]]} />
                    <ReviewBlock title="NDA" items={[["signed_by", ndaName || "—"]]} />
                  </div>
                </div>
              )}

              <div className="onboarding-actions" style={{ justifyContent: "space-between" }}>
                <button type="button" className="secondary-button" onClick={() => router.push("/dashboard/employee")}>
                  Save & exit
                </button>
                <button className="primary-button" type="submit" disabled={saving}>
                  {saving ? "Saving…" : step === "submit" ? "Finish profile" : "Save & continue"}
                </button>
              </div>
            </form>
          </>
        )}
      </section>
    </main>
  );
}

function Field({ label, value, onChange, type = "text" }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={value} onChange={onChange} />
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

"use client";

import Image from "next/image";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  clearLocalSession,
  getApiErrorMessage,
  getOnboarding,
  logout,
  saveOnboarding,
  uploadOnboardingFile,
} from "@/services/authService";
import { can, ROLE_HOME } from "@/services/rbac";

const STEPS = [
  { id: "personal", label: "Personal" },
  { id: "emergency", label: "Emergency" },
  { id: "employment", label: "Payroll" },
  { id: "education", label: "Education" },
  { id: "government_docs", label: "ID docs" },
  { id: "references", label: "References" },
  { id: "documents", label: "Policies" },
  { id: "nda", label: "NDA" },
  { id: "contract", label: "Contract" },
  { id: "resume", label: "Resume" },
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
const emptyEducationEntry = {
  institution: "",
  degree: "",
  field_of_study: "",
  year_completed: "",
  certificate_file: null,
};
const emptyGovDoc = {
  doc_type: "cnic",
  document_number: "",
  file_name: null,
  file_url: null,
};
const emptyReference = {
  full_name: "",
  relationship: "",
  email: "",
  phone: "",
  company: "",
};
const emptyDocuments = {
  accepted_code_of_conduct: false,
  accepted_privacy_policy: false,
  accepted_employee_handbook: false,
};
const emptySignature = { full_legal_name: "", agreed: false, signed_at: null };
const emptyResume = { summary: "", file_name: null, file_url: null };

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <main className="dashboard-shell">
          <p style={{ textAlign: "center", marginTop: "2rem" }}>Loading onboarding…</p>
        </main>
      }
    >
      <OnboardingContent />
    </Suspense>
  );
}

function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedStep = searchParams.get("step");
  const isEditMode = searchParams.get("edit") === "true";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [candidate, setCandidate] = useState(null);
  const [onboarding, setOnboarding] = useState(null);
  const [progress, setProgress] = useState(null);
  const [step, setStep] = useState("personal");
  const [personal, setPersonal] = useState(emptyPersonal);
  const [emergency, setEmergency] = useState(emptyEmergency);
  const [employment, setEmployment] = useState(emptyEmployment);
  const [educationEntries, setEducationEntries] = useState([{ ...emptyEducationEntry }]);
  const [govDocs, setGovDocs] = useState([{ ...emptyGovDoc }]);
  const [references, setReferences] = useState([{ ...emptyReference }, { ...emptyReference }]);
  const [documents, setDocuments] = useState(emptyDocuments);
  const [nda, setNda] = useState(emptySignature);
  const [contract, setContract] = useState(emptySignature);
  const [resume, setResume] = useState(emptyResume);

  // Filter steps: hide "submit" when in edit mode
  const steps = useMemo(() => {
    if (isEditMode) {
      return STEPS.filter((s) => s.id !== "submit");
    }
    return STEPS;
  }, [isEditMode]);

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
    if (parsedUser.role !== "candidate" && parsedUser.role !== "super_admin") {
      router.replace(ROLE_HOME[parsedUser.role] || "/dashboard");
      return;
    }

    Promise.resolve().then(async () => {
      try {
        const data = await getOnboarding(accessToken);
        setCandidate(data.candidate);
        setOnboarding(data.onboarding);
        setProgress(data.progress);
        hydrateForms(data.onboarding);
        const allowedSteps = new Set(STEPS.map((item) => item.id));
        const deepLinkStep =
          requestedStep && allowedSteps.has(requestedStep) ? requestedStep : null;
        const nextStep =
          data.onboarding?.status === "submitted"
            ? "submit"
            : deepLinkStep || data.onboarding?.current_step || "personal";
        setStep(nextStep === "complete" ? "submit" : nextStep);
      } catch (error) {
        setMessage(getApiErrorMessage(error, "Unable to load onboarding."));
      } finally {
        setLoading(false);
      }
    });
  }, [router, requestedStep]);

  function hydrateForms(data) {
    if (!data) return;
    if (data.personal) setPersonal({ ...emptyPersonal, ...data.personal });
    if (data.emergency) setEmergency({ ...emptyEmergency, ...data.emergency });
    if (data.employment) setEmployment({ ...emptyEmployment, ...data.employment });
    if (data.education?.entries?.length) setEducationEntries(data.education.entries);
    if (data.government_docs?.documents?.length) setGovDocs(data.government_docs.documents);
    if (data.references?.references?.length) setReferences(data.references.references);
    if (data.documents) setDocuments({ ...emptyDocuments, ...data.documents });
    if (data.nda) setNda({ ...emptySignature, ...data.nda });
    if (data.contract) setContract({ ...emptySignature, ...data.contract });
    if (data.resume) setResume({ ...emptyResume, ...data.resume });
  }

  // Use filtered steps for index
  const stepIndex = useMemo(() => steps.findIndex((item) => item.id === step), [step, steps]);
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
      setProgress(data.progress);
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

  async function handleFileUpload(event, purpose, index = 0) {
    const file = event.target.files?.[0];
    if (!file) return;
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setUploading(true);
    setMessage("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("purpose", purpose);
      if (purpose === "government_doc") {
        formData.append("doc_type", govDocs[index]?.doc_type || "cnic");
      }
      const data = await uploadOnboardingFile(formData, accessToken);
      setOnboarding(data.onboarding);
      hydrateForms(data.onboarding);
      if (purpose === "resume") {
        setResume((current) => ({
          ...current,
          file_name: data.file_name,
          file_url: data.file_url,
        }));
      } else if (purpose === "government_doc") {
        setGovDocs((current) => {
          const next = [...current];
          next[index] = {
            ...next[index],
            file_name: data.file_name,
            file_url: data.file_url,
            document_number: next[index].document_number || "pending",
          };
          return next;
        });
      } else if (purpose === "education_cert") {
        setEducationEntries((current) => {
          const next = [...current];
          next[index] = { ...next[index], certificate_file: data.file_url };
          return next;
        });
      }
      setMessage("File uploaded.");
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Upload failed."));
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function handleNext(event) {
    event.preventDefault();
    if (submitted && !isEditMode) return;

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
    } else if (step === "education") {
      const valid = educationEntries.every(
        (entry) => entry.institution && entry.degree && entry.field_of_study && entry.year_completed
      );
      if (!valid) {
        setMessage("Add at least one complete education entry.");
        return;
      }
      await persist({ step: "education", education: { entries: educationEntries } });
    } else if (step === "government_docs") {
      const valid = govDocs.every((doc) => doc.doc_type && doc.document_number && doc.file_url);
      if (!valid) {
        setMessage("Add government ID number and upload the document file.");
        return;
      }
      await persist({ step: "government_docs", government_docs: { documents: govDocs } });
    } else if (step === "references") {
      const valid =
        references.length >= 2 &&
        references.every((ref) => ref.full_name && ref.relationship && ref.email && ref.phone && ref.company);
      if (!valid) {
        setMessage("Provide at least two complete professional references.");
        return;
      }
      await persist({ step: "references", references: { references } });
    } else if (step === "documents") {
      if (!documents.accepted_code_of_conduct || !documents.accepted_privacy_policy || !documents.accepted_employee_handbook) {
        setMessage("Acknowledge all required documents to continue.");
        return;
      }
      await persist({ step: "documents", documents });
    } else if (step === "nda") {
      if (!nda.full_legal_name || !nda.agreed) {
        setMessage("Type your legal name and agree to sign the NDA.");
        return;
      }
      await persist({ step: "nda", nda });
    } else if (step === "contract") {
      if (!contract.full_legal_name || !contract.agreed) {
        setMessage("Type your legal name and agree to sign the employment contract.");
        return;
      }
      await persist({ step: "contract", contract });
    } else if (step === "resume") {
      if (!resume.summary || resume.summary.length < 20 || !resume.file_url) {
        setMessage("Add a short resume summary and upload your resume file.");
        return;
      }
      await persist({ step: "resume", resume });
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
        <button
          type="button"
          onClick={handleLogout}
          style={{
            backgroundColor: "#dc2626",
            color: "white",
            padding: "8px 16px",
            borderRadius: "4px",
            border: "none",
            cursor: "pointer",
            fontWeight: "bold",
            fontSize: "14px",
          }}
        >
          Sign out
        </button>
      </header>

      <section className="onboarding-card">
        {/* Edit Mode Banner */}
        {isEditMode && (
          <div style={{
            backgroundColor: "#dbeafe",
            border: "2px solid #3b82f6",
            borderRadius: "8px",
            padding: "12px 16px",
            marginBottom: "16px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}>
            <span style={{ fontSize: "20px" }}>✏️</span>
            <span style={{ fontWeight: "500", color: "#1e40af" }}>
              Edit Mode: All sections are editable. Changes will be saved automatically.
            </span>
          </div>
        )}

        <p className="eyebrow">Employee onboarding</p>
        <h1>Welcome, {candidate?.full_name}</h1>
        <p className="onboarding-lead">
          Role: <strong>{candidate?.job_title}</strong> · {candidate?.department}
          {progress ? <> · Progress: <strong>{progress.percentage}%</strong></> : null}
          {isEditMode && <span style={{ marginLeft: 12, color: "#2563eb", fontWeight: "bold" }}> (editing)</span>}
        </p>

        {/* Updated Steps with Edit Mode Styling */}
        <ol className="onboarding-steps" aria-label="Onboarding progress">
          {steps.map((item, index) => {
            const isActive = index <= stepIndex;
            const isCurrent = index === stepIndex;
            const isCompleted = index < stepIndex;
            
            return (
              <li 
                key={item.id} 
                className={isActive ? "active" : ""}
                style={isEditMode && isActive ? {
                  border: isCurrent ? "2px solid #3b82f6" : "1px solid #93c5fd",
                  borderRadius: "8px",
                  padding: "2px 4px",
                  backgroundColor: isCurrent ? "#eff6ff" : "transparent",
                } : {}}
              >
                <button 
                  type="button" 
                  disabled={submitted && !isEditMode} 
                  onClick={() => (!submitted || isEditMode) ? setStep(item.id) : null}
                  style={isEditMode && isCurrent ? {
                    backgroundColor: "#3b82f6",
                    color: "white",
                    fontWeight: "bold",
                    borderRadius: "6px",
                    padding: "4px 12px",
                  } : isEditMode && isCompleted ? {
                    color: "#1e40af",
                    fontWeight: "500",
                  } : {}}
                >
                  {item.label}
                  {isEditMode && isCurrent && " (editing)"}
                  {isEditMode && isCompleted && " (done)"}
                </button>
              </li>
            );
          })}
        </ol>

        {message && <p className="form-message" role="status">{message}</p>}
        {submitted && !isEditMode && (
          <p className="form-message" role="status">
            Onboarding submitted. A recruiter will review your documents and convert you to an employee.
          </p>
        )}

        <form className="auth-form" onSubmit={handleNext}>
          {step === "personal" && (
            <div className="form-grid">
              <h2 className="step-title">Personal information</h2>
              <Field label="Date of birth" name="date_of_birth" type="date" value={personal.date_of_birth} onChange={(e) => setPersonal({ ...personal, date_of_birth: e.target.value })} disabled={submitted && !isEditMode} isEditMode={isEditMode} />
              <Field label="National ID / CNIC" name="national_id" value={personal.national_id} onChange={(e) => setPersonal({ ...personal, national_id: e.target.value })} disabled={submitted && !isEditMode} isEditMode={isEditMode} />
              <Field label="Address line 1" name="address_line1" value={personal.address_line1} onChange={(e) => setPersonal({ ...personal, address_line1: e.target.value })} disabled={submitted && !isEditMode} isEditMode={isEditMode} wide />
              <Field label="Address line 2" name="address_line2" value={personal.address_line2} onChange={(e) => setPersonal({ ...personal, address_line2: e.target.value })} disabled={submitted && !isEditMode} isEditMode={isEditMode} wide />
              <Field label="City" name="city" value={personal.city} onChange={(e) => setPersonal({ ...personal, city: e.target.value })} disabled={submitted && !isEditMode} isEditMode={isEditMode} />
              <Field label="State" name="state" value={personal.state} onChange={(e) => setPersonal({ ...personal, state: e.target.value })} disabled={submitted && !isEditMode} isEditMode={isEditMode} />
              <Field label="Postal code" name="postal_code" value={personal.postal_code} onChange={(e) => setPersonal({ ...personal, postal_code: e.target.value })} disabled={submitted && !isEditMode} isEditMode={isEditMode} />
              <Field label="Country" name="country" value={personal.country} onChange={(e) => setPersonal({ ...personal, country: e.target.value })} disabled={submitted && !isEditMode} isEditMode={isEditMode} />
            </div>
          )}

          {step === "emergency" && (
            <div className="form-grid">
              <h2 className="step-title">Emergency contact</h2>
              <Field label="Full name" name="name" value={emergency.name} onChange={(e) => setEmergency({ ...emergency, name: e.target.value })} disabled={submitted && !isEditMode} isEditMode={isEditMode} />
              <Field label="Relationship" name="relationship" value={emergency.relationship} onChange={(e) => setEmergency({ ...emergency, relationship: e.target.value })} disabled={submitted && !isEditMode} isEditMode={isEditMode} />
              <Field label="Phone" name="phone" value={emergency.phone} onChange={(e) => setEmergency({ ...emergency, phone: e.target.value })} disabled={submitted && !isEditMode} isEditMode={isEditMode} />
            </div>
          )}

          {step === "employment" && (
            <div className="form-grid">
              <h2 className="step-title">Payroll & tax</h2>
              <Field label="Bank name" name="bank_name" value={employment.bank_name} onChange={(e) => setEmployment({ ...employment, bank_name: e.target.value })} disabled={submitted && !isEditMode} isEditMode={isEditMode} />
              <Field label="Account holder" name="account_holder_name" value={employment.account_holder_name} onChange={(e) => setEmployment({ ...employment, account_holder_name: e.target.value })} disabled={submitted && !isEditMode} isEditMode={isEditMode} />
              <Field label="Account number" name="account_number" value={employment.account_number} onChange={(e) => setEmployment({ ...employment, account_number: e.target.value })} disabled={submitted && !isEditMode} isEditMode={isEditMode} />
              <Field label="Tax ID" name="tax_id" value={employment.tax_id} onChange={(e) => setEmployment({ ...employment, tax_id: e.target.value })} disabled={submitted && !isEditMode} isEditMode={isEditMode} />
            </div>
          )}

          {step === "education" && (
            <div>
              <h2 className="step-title">Education history</h2>
              {educationEntries.map((entry, index) => (
                <div key={index} className="form-grid" style={{ marginBottom: 16, paddingBottom: 16, borderBottom: "1px solid #e2e8f0" }}>
                  <Field label="Institution" value={entry.institution} onChange={(e) => {
                    const next = [...educationEntries];
                    next[index] = { ...next[index], institution: e.target.value };
                    setEducationEntries(next);
                  }} disabled={submitted && !isEditMode} isEditMode={isEditMode} />
                  <Field label="Degree" value={entry.degree} onChange={(e) => {
                    const next = [...educationEntries];
                    next[index] = { ...next[index], degree: e.target.value };
                    setEducationEntries(next);
                  }} disabled={submitted && !isEditMode} isEditMode={isEditMode} />
                  <Field label="Field of study" value={entry.field_of_study} onChange={(e) => {
                    const next = [...educationEntries];
                    next[index] = { ...next[index], field_of_study: e.target.value };
                    setEducationEntries(next);
                  }} disabled={submitted && !isEditMode} isEditMode={isEditMode} />
                  <Field label="Year completed" value={entry.year_completed} onChange={(e) => {
                    const next = [...educationEntries];
                    next[index] = { ...next[index], year_completed: e.target.value };
                    setEducationEntries(next);
                  }} disabled={submitted && !isEditMode} isEditMode={isEditMode} />
                  <label className="field wide">
                    <span>Certificate upload (optional)</span>
                    <input type="file" disabled={(submitted && !isEditMode) || uploading} onChange={(e) => handleFileUpload(e, "education_cert", index)} />
                    {entry.certificate_file && <small>Uploaded: {entry.certificate_file}</small>}
                  </label>
                </div>
              ))}
              {(!submitted || isEditMode) && (
                <button type="button" className="secondary-button" onClick={() => setEducationEntries((c) => [...c, { ...emptyEducationEntry }])}>
                  Add another education entry
                </button>
              )}
            </div>
          )}

          {step === "government_docs" && (
            <div>
              <h2 className="step-title">Government identity documents</h2>
              {govDocs.map((doc, index) => (
                <div key={index} className="form-grid" style={{ marginBottom: 16 }}>
                  <label className="field">
                    <span>Document type</span>
                    <select
                      value={doc.doc_type}
                      disabled={submitted && !isEditMode}
                      onChange={(e) => {
                        const next = [...govDocs];
                        next[index] = { ...next[index], doc_type: e.target.value };
                        setGovDocs(next);
                      }}
                      style={isEditMode && !(submitted && !isEditMode) ? {
                        borderColor: "#3b82f6",
                        backgroundColor: "#f8fafc",
                        borderWidth: "2px",
                      } : {}}
                    >
                      <option value="cnic">CNIC</option>
                      <option value="passport">Passport</option>
                      <option value="other_id">Other ID</option>
                    </select>
                  </label>
                  <Field label="Document number" value={doc.document_number === "pending" ? "" : doc.document_number} onChange={(e) => {
                    const next = [...govDocs];
                    next[index] = { ...next[index], document_number: e.target.value };
                    setGovDocs(next);
                  }} disabled={submitted && !isEditMode} isEditMode={isEditMode} />
                  <label className="field wide">
                    <span>Upload document</span>
                    <input type="file" disabled={(submitted && !isEditMode) || uploading} onChange={(e) => handleFileUpload(e, "government_doc", index)} />
                    {doc.file_url && <small>Uploaded: {doc.file_name || doc.file_url}</small>}
                  </label>
                </div>
              ))}
              {(!submitted || isEditMode) && (
                <button type="button" className="secondary-button" onClick={() => setGovDocs((c) => [...c, { ...emptyGovDoc }])}>
                  Add another document
                </button>
              )}
            </div>
          )}

          {step === "references" && (
            <div>
              <h2 className="step-title">Professional references</h2>
              <p style={{ marginTop: -8 }}>Provide at least two references.</p>
              {references.map((ref, index) => (
                <div key={index} className="form-grid" style={{ marginBottom: 16, paddingBottom: 16, borderBottom: "1px solid #e2e8f0" }}>
                  <Field label="Full name" value={ref.full_name} onChange={(e) => {
                    const next = [...references];
                    next[index] = { ...next[index], full_name: e.target.value };
                    setReferences(next);
                  }} disabled={submitted && !isEditMode} isEditMode={isEditMode} />
                  <Field label="Relationship" value={ref.relationship} onChange={(e) => {
                    const next = [...references];
                    next[index] = { ...next[index], relationship: e.target.value };
                    setReferences(next);
                  }} disabled={submitted && !isEditMode} isEditMode={isEditMode} />
                  <Field label="Email" type="email" value={ref.email} onChange={(e) => {
                    const next = [...references];
                    next[index] = { ...next[index], email: e.target.value };
                    setReferences(next);
                  }} disabled={submitted && !isEditMode} isEditMode={isEditMode} />
                  <Field label="Phone" value={ref.phone} onChange={(e) => {
                    const next = [...references];
                    next[index] = { ...next[index], phone: e.target.value };
                    setReferences(next);
                  }} disabled={submitted && !isEditMode} isEditMode={isEditMode} />
                  <Field label="Company" value={ref.company} onChange={(e) => {
                    const next = [...references];
                    next[index] = { ...next[index], company: e.target.value };
                    setReferences(next);
                  }} disabled={submitted && !isEditMode} isEditMode={isEditMode} wide />
                </div>
              ))}
            </div>
          )}

          {step === "documents" && (
            <div>
              <h2 className="step-title">Acknowledge documents</h2>
              <label className="checkbox-field">
                <input type="checkbox" checked={documents.accepted_code_of_conduct} disabled={submitted && !isEditMode} onChange={(e) => setDocuments({ ...documents, accepted_code_of_conduct: e.target.checked })} />
                <span>I accept the Code of Conduct</span>
              </label>
              <label className="checkbox-field">
                <input type="checkbox" checked={documents.accepted_privacy_policy} disabled={submitted && !isEditMode} onChange={(e) => setDocuments({ ...documents, accepted_privacy_policy: e.target.checked })} />
                <span>I accept the Privacy Policy</span>
              </label>
              <label className="checkbox-field">
                <input type="checkbox" checked={documents.accepted_employee_handbook} disabled={submitted && !isEditMode} onChange={(e) => setDocuments({ ...documents, accepted_employee_handbook: e.target.checked })} />
                <span>I accept the Employee Handbook</span>
              </label>
            </div>
          )}

          {step === "nda" && (
            <div>
              <h2 className="step-title">Sign NDA</h2>
              <p>By signing below you agree to keep company information confidential.</p>
              <Field label="Full legal name" value={nda.full_legal_name} onChange={(e) => setNda({ ...nda, full_legal_name: e.target.value })} disabled={submitted && !isEditMode} isEditMode={isEditMode} wide />
              <label className="checkbox-field">
                <input type="checkbox" checked={nda.agreed} disabled={submitted && !isEditMode} onChange={(e) => setNda({ ...nda, agreed: e.target.checked })} />
                <span>I digitally sign this Non-Disclosure Agreement</span>
              </label>
            </div>
          )}

          {step === "contract" && (
            <div>
              <h2 className="step-title">Sign employment contract</h2>
              <p>Confirm that you accept the offered role, compensation, and terms shared by your recruiter.</p>
              <Field label="Full legal name" value={contract.full_legal_name} onChange={(e) => setContract({ ...contract, full_legal_name: e.target.value })} disabled={submitted && !isEditMode} isEditMode={isEditMode} wide />
              <label className="checkbox-field">
                <input type="checkbox" checked={contract.agreed} disabled={submitted && !isEditMode} onChange={(e) => setContract({ ...contract, agreed: e.target.checked })} />
                <span>I digitally sign this employment contract</span>
              </label>
            </div>
          )}

          {step === "resume" && (
            <div className="form-grid">
              <h2 className="step-title">Resume</h2>
              <label className="field wide">
                <span>Professional summary</span>
                <textarea
                  rows={4}
                  value={resume.summary}
                  disabled={submitted && !isEditMode}
                  onChange={(e) => setResume({ ...resume, summary: e.target.value })}
                  style={{ 
                    width: "100%", 
                    border: isEditMode && !(submitted && !isEditMode) ? "2px solid #3b82f6" : "1px solid #bed0dc", 
                    borderRadius: 8, 
                    padding: "13px 14px", 
                    fontFamily: "inherit",
                    backgroundColor: isEditMode && !(submitted && !isEditMode) ? "#f8fafc" : "white",
                  }}
                />
                {isEditMode && !(submitted && !isEditMode) && (
                  <small style={{ color: "#3b82f6", fontSize: "11px", marginTop: "4px", display: "block" }}>
                    Click to edit
                  </small>
                )}
              </label>
              <label className="field wide">
                <span>Upload resume (PDF/DOC)</span>
                <input type="file" disabled={(submitted && !isEditMode) || uploading} onChange={(e) => handleFileUpload(e, "resume")} />
                {resume.file_url && <small>Uploaded: {resume.file_name || resume.file_url}</small>}
              </label>
            </div>
          )}

          {step === "submit" && !isEditMode && (
            <div>
              <h2 className="step-title">Review & submit</h2>
              <p>Confirm every section is complete. After submit, your recruiter reviews and converts you to an employee.</p>
              <ReviewBlock title="Personal" items={Object.entries(personal)} />
              <ReviewBlock title="Emergency" items={Object.entries(emergency)} />
              <ReviewBlock title="Payroll" items={Object.entries(employment)} />
              <ReviewBlock title="Education entries" items={[["count", String(educationEntries.length)]]} />
              <ReviewBlock title="Government docs" items={[["count", String(govDocs.length)]]} />
              <ReviewBlock title="References" items={[["count", String(references.length)]]} />
              <ReviewBlock title="NDA" items={[["signed_by", nda.full_legal_name], ["agreed", String(nda.agreed)]]} />
              <ReviewBlock title="Contract" items={[["signed_by", contract.full_legal_name], ["agreed", String(contract.agreed)]]} />
              <ReviewBlock title="Resume" items={[["file", resume.file_name || "—"], ["summary", resume.summary?.slice(0, 80)]]} />
            </div>
          )}

          {/* Action Buttons */}
          <div className="dashboard-actions" style={{ marginTop: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {/* Left: Go to dashboard (always visible) */}
            <button
              type="button"
              className="secondary-button"
              onClick={() => router.push("/dashboard/candidate")}
            >
              Go to dashboard
            </button>

            {/* Right: primary action */}
            {!isEditMode && step === "submit" ? (
              <button className="primary-button" type="submit" disabled={saving || uploading || submitted}>
                {saving || uploading ? "Saving…" : "Submit onboarding"}
              </button>
            ) : (
              <button className="primary-button" type="submit" disabled={saving || uploading || (submitted && !isEditMode)}>
                {saving || uploading ? "Saving…" : "Save & continue"}
              </button>
            )}
          </div>
        </form>
      </section>
    </main>
  );
}

function Field({ label, name, value, onChange, type = "text", disabled, wide, isEditMode }) {
  const isEditable = isEditMode && !disabled;
  
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      <input 
        name={name} 
        type={type} 
        value={value} 
        onChange={onChange} 
        disabled={disabled}
        style={isEditable ? {
          borderColor: "#3b82f6",
          backgroundColor: "#f8fafc",
          borderWidth: "2px",
          boxShadow: "0 0 0 1px #3b82f6",
          transition: "all 0.2s ease",
        } : {}}
        onFocus={isEditable ? (e) => {
          e.target.style.borderColor = "#2563eb";
          e.target.style.boxShadow = "0 0 0 3px rgba(59, 130, 246, 0.3)";
        } : undefined}
        onBlur={isEditable ? (e) => {
          e.target.style.borderColor = "#3b82f6";
          e.target.style.boxShadow = "0 0 0 1px #3b82f6";
        } : undefined}
      />
      {isEditable && (
        <small style={{ color: "#3b82f6", fontSize: "11px", marginTop: "4px", display: "block" }}>
          Click to edit
        </small>
      )}
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
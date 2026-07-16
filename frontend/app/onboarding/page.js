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

// Phase 2 flow: candidates complete a short pre-offer INTAKE only. Emergency
// contact, banking, references, NDA, and policy sign-off move to the
// post-hire "complete your profile" stage (see /dashboard/employee/complete-profile)
// once HR approves their signed offer letter.
const STEPS = [
  { id: "personal", label: "Personal" },
  { id: "education", label: "Education" },
  { id: "government_docs", label: "ID docs" },
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
const emptyResume = { summary: "", file_name: null, file_url: null };

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <main className="onboarding-shell">
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
  const [educationEntries, setEducationEntries] = useState([{ ...emptyEducationEntry }]);
  const [govDocs, setGovDocs] = useState([{ ...emptyGovDoc }]);
  const [resume, setResume] = useState(emptyResume);

  const steps = useMemo(() => (isEditMode ? STEPS.filter((s) => s.id !== "submit") : STEPS), [isEditMode]);

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
        const deepLinkStep = requestedStep && allowedSteps.has(requestedStep) ? requestedStep : null;
        const nextStep =
          data.onboarding?.status === "submitted" ? "submit" : deepLinkStep || data.onboarding?.current_step || "personal";
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
    if (data.education?.entries?.length) setEducationEntries(data.education.entries);
    if (data.government_docs?.documents?.length) setGovDocs(data.government_docs.documents);
    if (data.resume) setResume({ ...emptyResume, ...data.resume });
  }

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
        setResume((current) => ({ ...current, file_name: data.file_name, file_url: data.file_url }));
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
        setMessage("Document uploaded — we're extracting the details automatically (OCR).");
      } else if (purpose === "education_cert") {
        setEducationEntries((current) => {
          const next = [...current];
          next[index] = { ...next[index], certificate_file: data.file_url };
          return next;
        });
      }
      if (purpose !== "government_doc") setMessage("File uploaded.");
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
        setMessage("Add your ID number and upload the document file.");
        return;
      }
      await persist({ step: "government_docs", government_docs: { documents: govDocs } });
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
        <button type="button" onClick={handleLogout} className="secondary-button" style={{ borderColor: "#f3c9c3", color: "#b42318" }}>
          Sign out
        </button>
      </header>

      <section className="onboarding-card">
        {isEditMode && (
          <div className="form-message" style={{ background: "#dbeafe", color: "#1e40af", fontWeight: 600, display: "flex", alignItems: "center", gap: 10 }}>
            <span>✏️</span>
            <span>Edit mode — changes save automatically as you move through each step.</span>
          </div>
        )}

        <p className="eyebrow">Step 1 of 3 · Candidate intake</p>
        <h1>Welcome, {candidate?.full_name}</h1>
        <p className="onboarding-lead">
          Role: <strong>{candidate?.job_title}</strong> · {candidate?.department}
          {progress ? (
            <>
              {" "}
              · Progress: <strong>{progress.percentage}%</strong>
            </>
          ) : null}
        </p>

        {submitted && !isEditMode ? (
          <SubmittedState candidate={candidate} onEdit={() => router.push("/onboarding?edit=true")} onDashboard={() => router.push("/dashboard/candidate")} />
        ) : (
          <>
            <ol className="onboarding-steps" aria-label="Onboarding progress">
              {steps.map((item, index) => {
                const isActive = index <= stepIndex;
                const isCurrent = index === stepIndex;
                return (
                  <li key={item.id} className={isActive ? "active" : ""}>
                    <button type="button" disabled={submitted && !isEditMode} onClick={() => setStep(item.id)}>
                      <span>{index + 1}</span>
                      {item.label}
                      {isEditMode && isCurrent && " (editing)"}
                    </button>
                  </li>
                );
              })}
            </ol>

            {message && <p className="form-message" role="status">{message}</p>}

            <form className="auth-form" onSubmit={handleNext}>
              {step === "personal" && (
                <div className="form-grid">
                  <h2 className="step-title">Personal information</h2>
                  <Field label="Date of birth" type="date" value={personal.date_of_birth} onChange={(e) => setPersonal({ ...personal, date_of_birth: e.target.value })} />
                  <Field label="National ID / CNIC" value={personal.national_id} onChange={(e) => setPersonal({ ...personal, national_id: e.target.value })} />
                  <Field label="Address line 1" value={personal.address_line1} onChange={(e) => setPersonal({ ...personal, address_line1: e.target.value })} wide />
                  <Field label="Address line 2" value={personal.address_line2} onChange={(e) => setPersonal({ ...personal, address_line2: e.target.value })} wide />
                  <Field label="City" value={personal.city} onChange={(e) => setPersonal({ ...personal, city: e.target.value })} />
                  <Field label="State" value={personal.state} onChange={(e) => setPersonal({ ...personal, state: e.target.value })} />
                  <Field label="Postal code" value={personal.postal_code} onChange={(e) => setPersonal({ ...personal, postal_code: e.target.value })} />
                  <Field label="Country" value={personal.country} onChange={(e) => setPersonal({ ...personal, country: e.target.value })} />
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
                      }} />
                      <Field label="Degree" value={entry.degree} onChange={(e) => {
                        const next = [...educationEntries];
                        next[index] = { ...next[index], degree: e.target.value };
                        setEducationEntries(next);
                      }} />
                      <Field label="Field of study" value={entry.field_of_study} onChange={(e) => {
                        const next = [...educationEntries];
                        next[index] = { ...next[index], field_of_study: e.target.value };
                        setEducationEntries(next);
                      }} />
                      <Field label="Year completed" value={entry.year_completed} onChange={(e) => {
                        const next = [...educationEntries];
                        next[index] = { ...next[index], year_completed: e.target.value };
                        setEducationEntries(next);
                      }} />
                      <label className="field wide">
                        <span>Certificate upload (auto-read via OCR)</span>
                        <input type="file" disabled={uploading} onChange={(e) => handleFileUpload(e, "education_cert", index)} />
                        {entry.certificate_file && <small>Uploaded: {entry.certificate_file}</small>}
                      </label>
                    </div>
                  ))}
                  <button type="button" className="secondary-button" onClick={() => setEducationEntries((c) => [...c, { ...emptyEducationEntry }])}>
                    Add another education entry
                  </button>
                </div>
              )}

              {step === "government_docs" && (
                <div>
                  <h2 className="step-title">Government identity documents</h2>
                  <p style={{ marginTop: -8, color: "#5c7086" }}>
                    We automatically read your name, ID number, and dates from the file using OCR — this speeds up
                    verification on your recruiter&apos;s side.
                  </p>
                  {govDocs.map((doc, index) => (
                    <div key={index} className="form-grid" style={{ marginBottom: 16 }}>
                      <label className="field">
                        <span>Document type</span>
                        <select
                          value={doc.doc_type}
                          onChange={(e) => {
                            const next = [...govDocs];
                            next[index] = { ...next[index], doc_type: e.target.value };
                            setGovDocs(next);
                          }}
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
                      }} />
                      <label className="field wide">
                        <span>Upload document (PDF, JPG, or PNG — max 10 MB)</span>
                        <input type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={uploading} onChange={(e) => handleFileUpload(e, "government_doc", index)} />
                        {doc.file_url && <small>Uploaded: {doc.file_name || doc.file_url}</small>}
                      </label>
                    </div>
                  ))}
                  <button type="button" className="secondary-button" onClick={() => setGovDocs((c) => [...c, { ...emptyGovDoc }])}>
                    Add another document
                  </button>
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
                      onChange={(e) => setResume({ ...resume, summary: e.target.value })}
                      style={{ width: "100%", border: "1px solid #bed0dc", borderRadius: 8, padding: "13px 14px", fontFamily: "inherit" }}
                    />
                  </label>
                  <label className="field wide">
                    <span>Upload resume (PDF/DOC)</span>
                    <input type="file" disabled={uploading} onChange={(e) => handleFileUpload(e, "resume")} />
                    {resume.file_url && <small>Uploaded: {resume.file_name || resume.file_url}</small>}
                  </label>
                </div>
              )}

              {step === "submit" && !isEditMode && (
                <div>
                  <h2 className="step-title">Review & submit</h2>
                  <p>Confirm every section is complete. Your recruiter reviews it next and sends your offer letter.</p>
                  <div className="review-grid">
                    <ReviewBlock title="Personal" items={Object.entries(personal)} />
                    <ReviewBlock title="Education entries" items={[["count", String(educationEntries.length)]]} />
                    <ReviewBlock title="Government docs" items={[["count", String(govDocs.length)]]} />
                    <ReviewBlock title="Resume" items={[["file", resume.file_name || "—"], ["summary", resume.summary?.slice(0, 80)]]} />
                  </div>
                </div>
              )}

              <div className="onboarding-actions" style={{ justifyContent: "space-between" }}>
                <button type="button" className="secondary-button" onClick={() => router.push("/dashboard/candidate")}>
                  Go to dashboard
                </button>
                {!isEditMode && step === "submit" ? (
                  <button className="primary-button" type="submit" disabled={saving || uploading}>
                    {saving || uploading ? "Saving…" : "Submit for HR review"}
                  </button>
                ) : (
                  <button className="primary-button" type="submit" disabled={saving || uploading}>
                    {saving || uploading ? "Saving…" : "Save & continue"}
                  </button>
                )}
              </div>
            </form>
          </>
        )}
      </section>
    </main>
  );
}

function SubmittedState({ candidate, onEdit, onDashboard }) {
  return (
    <div className="onboarding-complete">
      <div className="verification-icon success" style={{ margin: "0 auto 18px" }}>✓</div>
      <h2 style={{ margin: "0 0 10px" }}>You&apos;re all set, {candidate?.full_name?.split(" ")[0]}</h2>
      <p className="onboarding-lead" style={{ maxWidth: 480, margin: "0 auto 24px" }}>
        Your profile, education history, ID documents, and resume are with your recruiter now. Here&apos;s what
        happens next:
      </p>
      <ol style={{ textAlign: "left", maxWidth: 440, margin: "0 auto 28px", color: "#405266", lineHeight: 1.8 }}>
        <li>Your recruiter reviews your documents (OCR speeds this up automatically).</li>
        <li>You&apos;ll receive an <strong>offer letter</strong> to review and digitally sign.</li>
        <li>Once HR approves your signed offer, you become an employee with your own Employee ID.</li>
        <li>You&apos;ll then complete a short post-hire profile (emergency contact, banking, references, NDA).</li>
      </ol>
      <div className="onboarding-actions" style={{ justifyContent: "center" }}>
        <button type="button" className="secondary-button" onClick={onEdit}>Edit my details</button>
        <button type="button" className="primary-button" onClick={onDashboard}>Go to my dashboard</button>
      </div>
    </div>
  );
}

function Field({ label, name, value, onChange, type = "text", wide }) {
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      <input name={name} type={type} value={value} onChange={onChange} />
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

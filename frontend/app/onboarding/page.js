"use client";

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
import styles from "./onboarding.module.css";

const STEPS = [
  { id: "personal", label: "Personal" },
  { id: "education", label: "Education" },
  { id: "government_docs", label: "ID docs" },
  { id: "resume", label: "Resume" },
  { id: "submit", label: "Review" },
];

const NAV_ITEMS = [
  {
    key: "dashboard",
    label: "Dashboard",
    href: "/dashboard/candidate",
    disabled: false,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" />
      </svg>
    ),
  },
  {
    key: "onboarding",
    label: "Onboarding",
    href: "/onboarding",
    disabled: false,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" />
      </svg>
    ),
  },
  {
    key: "learning",
    label: "Learning",
    href: null,
    disabled: true,
    badge: "PHASE 3",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
  },
  {
    key: "ai",
    label: "AI Coach",
    href: null,
    disabled: true,
    badge: "PHASE 3",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2a5 5 0 0 1 5 5v2a5 5 0 0 1-10 0V7a5 5 0 0 1 5-5z" /><path d="M19 11a7 7 0 0 1-14 0M12 18v4" />
      </svg>
    ),
  },
  {
    key: "profile",
    label: "Profile",
    href: "/onboarding?edit=true",
    disabled: false,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" />
      </svg>
    ),
  },
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
        <div className={styles.root}>
          <div className={styles.content}>
            <p style={{ textAlign: "center", marginTop: "2rem" }}>Loading onboarding…</p>
          </div>
        </div>
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
  const [extractionPreview, setExtractionPreview] = useState(null);

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

  function autoFillFromOCR(ocrResult, purpose, index) {
    if (!ocrResult || ocrResult.status !== "completed") return;
    const { category, fields } = ocrResult;
    if (!fields) return;

    if (purpose === "resume" && category === "resume") {
      if (fields.full_name || fields.email || fields.phone_number) {
        setPersonal((prev) => ({
          ...prev,
          ...(fields.address ? { address_line1: fields.address } : {}),
        }));
      }
      if (fields.full_name || fields.email) {
        // Resume summary auto-fill from name + skills
        const skills = Array.isArray(fields.skills) ? fields.skills.join(", ") : (fields.skills || "");
        const summary = [
          fields.full_name ? `Name: ${fields.full_name}` : "",
          fields.email ? `Email: ${fields.email}` : "",
          fields.phone_number ? `Phone: ${fields.phone_number}` : "",
          skills ? `Skills: ${skills}` : "",
        ].filter(Boolean).join(" | ");
        if (summary) {
          setResume((prev) => ({ ...prev, summary: prev.summary || summary }));
        }
      }
    } else if (purpose === "government_doc") {
      if (category === "cnic") {
        if (fields.cnic_number) {
          setGovDocs((prev) => {
            const next = [...prev];
            next[index] = {
              ...next[index],
              document_number: next[index].document_number && next[index].document_number !== "pending"
                ? next[index].document_number
                : fields.cnic_number,
            };
            return next;
          });
        }
        if (fields.date_of_birth) {
          setPersonal((prev) => ({ ...prev, date_of_birth: prev.date_of_birth || fields.date_of_birth }));
        }
        if (fields.name) {
          setPersonal((prev) => ({ ...prev, national_id: prev.national_id || fields.cnic_number || prev.national_id }));
        }
      } else if (category === "passport") {
        if (fields.passport_number) {
          setGovDocs((prev) => {
            const next = [...prev];
            next[index] = {
              ...next[index],
              document_number: next[index].document_number && next[index].document_number !== "pending"
                ? next[index].document_number
                : fields.passport_number,
            };
            return next;
          });
        }
        if (fields.date_of_birth) {
          setPersonal((prev) => ({ ...prev, date_of_birth: prev.date_of_birth || fields.date_of_birth }));
        }
      }
    } else if (purpose === "education_cert" && category === "certificate") {
      setEducationEntries((prev) => {
        const next = [...prev];
        next[index] = {
          ...next[index],
          institution: next[index].institution || fields.institute || "",
          degree: next[index].degree || fields.degree || "",
          year_completed: next[index].year_completed || fields.completion_date || "",
        };
        return next;
      });
    }
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
    setExtractionPreview(null);
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
      } else if (purpose === "education_cert") {
        setEducationEntries((current) => {
          const next = [...current];
          next[index] = { ...next[index], certificate_file: data.file_url };
          return next;
        });
      }

      // Auto-fill from extraction result
      if (data.ocr_result) {
        autoFillFromOCR(data.ocr_result, purpose, index);
        setExtractionPreview(data.ocr_result);
        const cat = data.ocr_result.category;
        const ok = data.ocr_result.status === "completed";
        setMessage(
          ok
            ? `File uploaded. Document recognised as "${cat}" — fields auto-filled below. Review and adjust before saving.`
            : "File uploaded. Text extraction failed — please fill in the fields manually."
        );
      } else {
        setMessage("File uploaded.");
      }
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

  const initials = candidate?.full_name?.[0]?.toUpperCase() || "?";

  return (
    <div className={styles.root}>
      <div className={styles.app}>
        {/* Sidebar */}
        <aside className={styles.sidebar}>
          <button type="button" className={styles.brand}>
            <div className={styles.brandMark}>MZ</div>
            <div className={styles.brandText}>
              <div className={styles.p1}>Talent</div>
              <div className={styles.p2}>Mazik Global Pakistan</div>
            </div>
          </button>

          <div className={styles.navSectionLabel}>Workspace</div>
          <ul className={styles.nav} style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {NAV_ITEMS.map((item) => {
              const isActive = item.key === "onboarding";
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    className={`${styles.navItem} ${isActive ? styles.active : ""} ${item.disabled ? styles.disabled : ""}`}
                    onClick={() => item.href && router.push(item.href)}
                    title={item.disabled ? `${item.label} — coming in Phase 3` : item.label}
                    disabled={item.disabled}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                    {item.badge && <span className={styles.navBadge}>{item.badge}</span>}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className={styles.sidebarFooter}>
            <div className={styles.avatarSm}>{initials}</div>
            <div>
              <div className={styles.name}>{candidate?.full_name || "…"}</div>
              <div className={styles.role}>Candidate</div>
            </div>
            <button type="button" className={styles.logoutBtn} title="Log out" onClick={handleLogout}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" />
              </svg>
            </button>
          </div>
        </aside>

        {/* Main */}
        <main className={styles.main}>
          <div className={styles.topbar}>
            <button className={styles.iconBtn} onClick={handleLogout} title="Sign out">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" />
              </svg>
            </button>
          </div>

          <div className={styles.content}>
            {loading ? (
              <p style={{ textAlign: "center", marginTop: "2rem" }}>Loading onboarding…</p>
            ) : (
              <section className={styles.card}>
                {isEditMode && (
                  <div className={styles.editBanner}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                    <span>Edit mode — changes save automatically as you move through each step.</span>
                  </div>
                )}

                <p className={styles.eyebrow}>Step 1 of 3 · Candidate intake</p>
                <h1>Welcome, {candidate?.full_name}</h1>
                <p className={styles.lead}>
                  Role: <strong>{candidate?.job_title}</strong> · {candidate?.department}
                  {progress ? (
                    <>
                      {" "}
                      · Progress: <strong>{progress.percentage}%</strong>
                    </>
                  ) : null}
                </p>

                {submitted && !isEditMode ? (
                  <SubmittedState
                    styles={styles}
                    candidate={candidate}
                    onEdit={() => router.push("/onboarding?edit=true")}
                    onDashboard={() => router.push("/dashboard/candidate")}
                  />
                ) : (
                  <>
                    <ol className={styles.steps} aria-label="Onboarding progress">
                      {steps.map((item, index) => {
                        const isActive = index <= stepIndex;
                        const isCurrent = index === stepIndex;
                        return (
                          <li key={item.id} className={isActive ? styles.active : ""}>
                            <button type="button" disabled={submitted && !isEditMode} onClick={() => setStep(item.id)}>
                              <span>{index + 1}</span>
                              {item.label}
                              {isEditMode && isCurrent && " (editing)"}
                            </button>
                          </li>
                        );
                      })}
                    </ol>

                    {message && <p className={styles.formMessage} role="status">{message}</p>}
            {message && <p className="form-message" role="status">{message}</p>}

            {extractionPreview && <ExtractionPreview result={extractionPreview} onDismiss={() => setExtractionPreview(null)} />}

                    <form onSubmit={handleNext}>
                      {step === "personal" && (
                        <div className={styles.formGrid}>
                          <h2 className={styles.stepTitle}>Personal information</h2>
                          <Field styles={styles} label="Date of birth" type="date" value={personal.date_of_birth} onChange={(e) => setPersonal({ ...personal, date_of_birth: e.target.value })} />
                          <Field styles={styles} label="National ID / CNIC" value={personal.national_id} onChange={(e) => setPersonal({ ...personal, national_id: e.target.value })} />
                          <Field styles={styles} label="Address line 1" value={personal.address_line1} onChange={(e) => setPersonal({ ...personal, address_line1: e.target.value })} wide />
                          <Field styles={styles} label="Address line 2" value={personal.address_line2} onChange={(e) => setPersonal({ ...personal, address_line2: e.target.value })} wide />
                          <Field styles={styles} label="City" value={personal.city} onChange={(e) => setPersonal({ ...personal, city: e.target.value })} />
                          <Field styles={styles} label="State" value={personal.state} onChange={(e) => setPersonal({ ...personal, state: e.target.value })} />
                          <Field styles={styles} label="Postal code" value={personal.postal_code} onChange={(e) => setPersonal({ ...personal, postal_code: e.target.value })} />
                          <Field styles={styles} label="Country" value={personal.country} onChange={(e) => setPersonal({ ...personal, country: e.target.value })} />
                        </div>
                      )}

                      {step === "education" && (
                        <div>
                          <h2 className={styles.stepTitle}>Education history</h2>
                          {educationEntries.map((entry, index) => (
                            <div key={index} className={`${styles.formGrid} ${styles.educationEntry}`}>
                              <Field styles={styles} label="Institution" value={entry.institution} onChange={(e) => {
                                const next = [...educationEntries];
                                next[index] = { ...next[index], institution: e.target.value };
                                setEducationEntries(next);
                              }} />
                              <Field styles={styles} label="Degree" value={entry.degree} onChange={(e) => {
                                const next = [...educationEntries];
                                next[index] = { ...next[index], degree: e.target.value };
                                setEducationEntries(next);
                              }} />
                              <Field styles={styles} label="Field of study" value={entry.field_of_study} onChange={(e) => {
                                const next = [...educationEntries];
                                next[index] = { ...next[index], field_of_study: e.target.value };
                                setEducationEntries(next);
                              }} />
                              <Field styles={styles} label="Year completed" value={entry.year_completed} onChange={(e) => {
                                const next = [...educationEntries];
                                next[index] = { ...next[index], year_completed: e.target.value };
                                setEducationEntries(next);
                              }} />
                              <label className={`${styles.field} ${styles.wide}`}>
                                <span>Certificate upload (auto-read via OCR)</span>
                                <input type="file" disabled={uploading} onChange={(e) => handleFileUpload(e, "education_cert", index)} />
                                {entry.certificate_file && <small>Uploaded: {entry.certificate_file}</small>}
                              </label>
                            </div>
                          ))}
                          <button type="button" className={styles.secondaryButton} onClick={() => setEducationEntries((c) => [...c, { ...emptyEducationEntry }])}>
                            Add another education entry
                          </button>
                        </div>
                      )}

                      {step === "government_docs" && (
                        <div>
                          <h2 className={styles.stepTitle}>Government identity documents</h2>
                          <p className={styles.docHelper}>
                            We automatically read your name, ID number, and dates from the file using OCR — this speeds up
                            verification on your recruiter&apos;s side.
                          </p>
                          {govDocs.map((doc, index) => (
                            <div key={index} className={`${styles.formGrid} ${styles.govDocEntry}`}>
                              <label className={styles.field}>
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
                              <Field styles={styles} label="Document number" value={doc.document_number === "pending" ? "" : doc.document_number} onChange={(e) => {
                                const next = [...govDocs];
                                next[index] = { ...next[index], document_number: e.target.value };
                                setGovDocs(next);
                              }} />
                              <label className={`${styles.field} ${styles.wide}`}>
                                <span>Upload document (PDF, JPG, or PNG — max 10 MB)</span>
                                <input type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={uploading} onChange={(e) => handleFileUpload(e, "government_doc", index)} />
                                {doc.file_url && <small>Uploaded: {doc.file_name || doc.file_url}</small>}
                              </label>
                            </div>
                          ))}
                          <button type="button" className={styles.secondaryButton} onClick={() => setGovDocs((c) => [...c, { ...emptyGovDoc }])}>
                            Add another document
                          </button>
                        </div>
                      )}

                      {step === "resume" && (
                        <div className={styles.formGrid}>
                          <h2 className={styles.stepTitle}>Resume</h2>
                          <label className={`${styles.field} ${styles.wide}`}>
                            <span>Professional summary</span>
                            <textarea
                              rows={4}
                              value={resume.summary}
                              onChange={(e) => setResume({ ...resume, summary: e.target.value })}
                              className={styles.resumeTextarea}
                            />
                          </label>
                          <label className={`${styles.field} ${styles.wide}`}>
                            <span>Upload resume (PDF/DOC)</span>
                            <input type="file" disabled={uploading} onChange={(e) => handleFileUpload(e, "resume")} />
                            {resume.file_url && <small>Uploaded: {resume.file_name || resume.file_url}</small>}
                          </label>
                        </div>
                      )}

                      {step === "submit" && !isEditMode && (
                        <div>
                          <h2 className={styles.stepTitle}>Review &amp; submit</h2>
                          <p className={styles.lead} style={{ marginBottom: 0 }}>
                            Confirm every section is complete. Your recruiter reviews it next and sends your offer letter.
                          </p>
                          <div className={styles.reviewGrid}>
                            <ReviewBlock styles={styles} title="Personal" items={Object.entries(personal)} />
                            <ReviewBlock styles={styles} title="Education entries" items={[["count", String(educationEntries.length)]]} />
                            <ReviewBlock styles={styles} title="Government docs" items={[["count", String(govDocs.length)]]} />
                            <ReviewBlock styles={styles} title="Resume" items={[["file", resume.file_name || "—"], ["summary", resume.summary?.slice(0, 80)]]} />
                          </div>
                        </div>
                      )}

                      <div className={`${styles.actions} ${styles.spread}`}>
                        <button type="button" className={styles.secondaryButton} onClick={() => router.push("/dashboard/candidate")}>
                          Go to dashboard
                        </button>
                        {!isEditMode && step === "submit" ? (
                          <button className={styles.primaryButton} type="submit" disabled={saving || uploading}>
                            {saving || uploading ? "Saving…" : "Submit for HR review"}
                          </button>
                        ) : (
                          <button className={styles.primaryButton} type="submit" disabled={saving || uploading}>
                            {saving || uploading ? "Saving…" : "Save & continue"}
                          </button>
                        )}
                      </div>
                    </form>
                  </>
                )}
              </section>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function SubmittedState({ candidate, onEdit, onDashboard, styles }) {
  return (
    <div className={styles.submitted}>
      <div className={styles.submittedIcon}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </div>
      <h2 className={styles.submittedHeading}>You&apos;re all set, {candidate?.full_name?.split(" ")[0]}</h2>
      <p className={`${styles.lead} ${styles.submittedLead}`}>
        Your profile, education history, ID documents, and resume are with your recruiter now. Here&apos;s what
        happens next:
      </p>
      <ol className={styles.submittedSteps}>
        <li>Your recruiter reviews your documents (OCR speeds this up automatically).</li>
        <li>You&apos;ll receive an <strong>offer letter</strong> to review and digitally sign.</li>
        <li>Once HR approves your signed offer, you become an employee with your own Employee ID.</li>
        <li>You&apos;ll then complete a short post-hire profile (emergency contact, banking, references, NDA).</li>
      </ol>
      <div className={`${styles.actions} ${styles.center}`}>
        <button type="button" className={styles.secondaryButton} onClick={onEdit}>Edit my details</button>
        <button type="button" className={styles.primaryButton} onClick={onDashboard}>Go to my dashboard</button>
      </div>
    </div>
  );
}

function Field({ label, name, value, onChange, type = "text", wide, styles }) {
  return (
    <label className={`${styles.field} ${wide ? styles.wide : ""}`}>
      <span>{label}</span>
      <input name={name} type={type} value={value} onChange={onChange} />
    </label>
  );
}

function ReviewBlock({ title, items, styles }) {
  return (
    <div className={styles.reviewBlock}>
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

// ─── ExtractionPreview ───────────────────────────────────────────────────────
// Displays extracted text and structured fields immediately after upload.
// Uses inline styles only so it cannot affect any existing CSS class layout.
function ExtractionPreview({ result, onDismiss }) {
  if (!result) return null;
  const { category, fields, raw_text: rawText, status } = result;
  const hasFields = fields && Object.keys(fields).some((k) => fields[k] !== null && fields[k] !== undefined && fields[k] !== "");

  return (
    <div
      style={{
        margin: "16px 0",
        border: "1px solid #bed0dc",
        borderRadius: 10,
        background: "#f7fbff",
        padding: "16px 20px",
        position: "relative",
      }}
    >
      <button
        type="button"
        onClick={onDismiss}
        style={{
          position: "absolute",
          top: 10,
          right: 12,
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: "1.1rem",
          color: "#5c7086",
          lineHeight: 1,
        }}
        aria-label="Dismiss extraction preview"
      >
        ✕
      </button>

      <p
        style={{
          fontWeight: 600,
          fontSize: ".85rem",
          color: "#1e40af",
          textTransform: "uppercase",
          letterSpacing: ".05em",
          marginBottom: 10,
        }}
      >
        {status === "completed" ? "✅ Extracted Information" : "⚠️ Extraction Incomplete"}
        {category && category !== "unknown" && (
          <span
            style={{
              marginLeft: 8,
              background: "#dbeafe",
              borderRadius: 4,
              padding: "2px 7px",
              fontSize: ".78rem",
              color: "#1e40af",
              textTransform: "capitalize",
            }}
          >
            {category}
          </span>
        )}
      </p>

      {hasFields && (
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: "6px 16px",
            marginBottom: rawText ? 12 : 0,
          }}
        >
          {Object.entries(fields)
            .filter(([, v]) => v !== null && v !== undefined && v !== "")
            .map(([key, value]) => (
              <div key={key}>
                <dt style={{ fontSize: ".78rem", color: "#5c7086", textTransform: "capitalize" }}>
                  {key.replace(/_/g, " ")}
                </dt>
                <dd style={{ fontSize: ".88rem", color: "#1a2535", fontWeight: 500, margin: 0 }}>
                  {Array.isArray(value) ? value.join(", ") : String(value)}
                </dd>
              </div>
            ))}
        </dl>
      )}

      {rawText && (
        <details style={{ marginTop: 8 }}>
          <summary
            style={{
              cursor: "pointer",
              fontSize: ".82rem",
              color: "#5c7086",
              userSelect: "none",
            }}
          >
            Show raw extracted text
          </summary>
          <pre
            style={{
              marginTop: 8,
              padding: "10px 12px",
              background: "#f0f4f8",
              borderRadius: 6,
              fontSize: ".78rem",
              color: "#334155",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 220,
              overflowY: "auto",
            }}
          >
            {typeof rawText === "string" ? rawText : JSON.stringify(rawText, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

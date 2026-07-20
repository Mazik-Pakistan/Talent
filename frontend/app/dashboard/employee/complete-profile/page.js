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
import Toast from "@/components/Toast";
import {
  formatPkMobileInput,
  isValidPkMobile,
  normalizePkMobile,
  PK_MOBILE_HINT,
} from "@/utils/phone";
import styles from "./complete-profile.module.css";

const STEPS = [
  { id: "emergency", label: "Emergency contact" },
  { id: "employment", label: "Banking" },
  { id: "references", label: "References" },
  { id: "documents", label: "Policies" },
  { id: "nda", label: "Sign NDA" },
  { id: "submit", label: "Finish" },
];

const emptyEmergency = { name: "", relationship: "", phone: "", alternate_phone: "", address: "" };
const emptyEmployment = {
  bank_name: "",
  account_holder_name: "",
  account_number: "",
  tax_id: "",
  iban: "",
  branch: "",
  branch_code: "",
  swift_code: "",
};
const emptyReference = { full_name: "", relationship: "", email: "", phone: "", company: "" };
const emptyDocuments = { accepted_code_of_conduct: false, accepted_privacy_policy: false, accepted_employee_handbook: false };

export default function CompleteProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
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

  function showToast(type, messageText) {
    setToast({ id: Date.now(), type, message: messageText });
  }

  function showFormError(messageText, errors = {}) {
    setFieldErrors(errors);
    showToast("error", messageText);
    window.requestAnimationFrame(() => {
      const firstError = document.querySelector("[data-field-error='true']");
      if (firstError) {
        firstError.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  }

  function clearFieldError(key) {
    setFieldErrors((prev) => ({ ...prev, [key]: false }));
  }

  function goToStep(nextStep) {
    setFieldErrors({});
    setStep(nextStep);
  }

  function hydrate(onboarding, emp = null) {
    if (!onboarding) return;
    if (onboarding.emergency) setEmergency(onboarding.emergency);
    if (onboarding.employment) {
      setEmployment({
        ...emptyEmployment,
        ...onboarding.employment,
        account_holder_name:
          onboarding.employment.account_holder_name || emp?.full_name || "",
      });
    } else if (emp?.full_name) {
      setEmployment((current) => ({
        ...current,
        account_holder_name: current.account_holder_name || emp.full_name,
      }));
    }
    if (onboarding.references?.references?.length) setReferences(onboarding.references.references);
    if (onboarding.documents) setDocuments(onboarding.documents);
    const lockedName = emp?.full_name || "";
    if (onboarding.nda) {
      setNdaName(onboarding.nda.full_legal_name || lockedName);
      setNdaAgreed(!!onboarding.nda.agreed);
    } else if (lockedName) {
      setNdaName(lockedName);
    }
  }

  async function load(accessToken) {
    setLoading(true);
    try {
      const data = await getProfileCompletion(accessToken);
      setEmployee(data.employee);
      setProgress(data.progress);
      hydrate(data.onboarding, data.employee);
      if (data.progress?.profile_status === "complete") {
        setStep("submit");
      } else if (data.progress?.current_step) {
        setStep(data.progress.current_step);
      }
    } catch (error) {
      showToast("error", getApiErrorMessage(error, "Unable to load your profile."));
    } finally {
      setLoading(false);
    }
  }

  async function persist(payload) {
    const accessToken = localStorage.getItem("access_token");
    setSaving(true);
    setFieldErrors({});
    try {
      const data = await saveProfileCompletion(payload, accessToken);
      setEmployee(data.employee);
      setProgress(data.progress);
      hydrate(data.onboarding, data.employee);
      showToast("success", data.message || "Progress saved.");
      if (payload.step === "submit") {
        setStep("submit");
      } else if (data.progress?.current_step) {
        setStep(data.progress.current_step);
      }
    } catch (error) {
      showToast("error", getApiErrorMessage(error, "Could not save this step."));
    } finally {
      setSaving(false);
    }
  }

  function validateEmergency() {
    const errors = {
      emergency_name: !emergency.name?.trim(),
      emergency_relationship: !emergency.relationship?.trim(),
      emergency_phone: !isValidPkMobile(emergency.phone),
      emergency_alternate_phone: !!(emergency.alternate_phone && !isValidPkMobile(emergency.alternate_phone)),
    };
    if (Object.values(errors).some(Boolean)) {
      showFormError(`Complete your emergency contact. Phone must be Pakistan mobile (${PK_MOBILE_HINT}).`, errors);
      return false;
    }
    return true;
  }

  function validateEmployment() {
    const errors = {
      employment_bank_name: !employment.bank_name?.trim(),
      employment_account_holder_name: !employment.account_holder_name?.trim(),
      employment_account_number: !employment.account_number?.trim(),
      employment_iban: !employment.iban?.trim(),
      employment_branch: !employment.branch?.trim(),
      employment_branch_code: !employment.branch_code?.trim(),
      employment_tax_id: !employment.tax_id?.trim(),
    };
    if (Object.values(errors).some(Boolean)) {
      showFormError("Complete your banking details including IBAN, branch, and branch code.", errors);
      return false;
    }
    return true;
  }

  function validateReferences() {
    const errors = {};
    const emails = [];
    references.forEach((ref, index) => {
      if (!ref.full_name?.trim()) errors[`ref_${index}_full_name`] = true;
      if (!ref.relationship?.trim()) errors[`ref_${index}_relationship`] = true;
      if (!ref.email?.trim()) errors[`ref_${index}_email`] = true;
      if (!isValidPkMobile(ref.phone)) errors[`ref_${index}_phone`] = true;
      if (!ref.company?.trim()) errors[`ref_${index}_company`] = true;
      if (ref.email?.trim()) emails.push(ref.email.trim().toLowerCase());
    });
    if (emails.length !== new Set(emails).size) {
      references.forEach((ref, index) => {
        const email = ref.email?.trim().toLowerCase();
        if (email && emails.filter((e) => e === email).length > 1) {
          errors[`ref_${index}_email`] = true;
        }
      });
      showFormError("Each reference must use a different email address. Names may be the same.", errors);
      return false;
    }
    const valid = references.length >= 2 && Object.keys(errors).length === 0;
    if (!valid) {
      showFormError(`Provide at least two complete references. Phones: ${PK_MOBILE_HINT}.`, errors);
      return false;
    }
    return true;
  }

  function validateNda() {
    const expected = employee?.full_name || "";
    const errors = {
      nda_name: !ndaName?.trim() || normalizeName(ndaName) !== normalizeName(expected),
      nda_agreed: !ndaAgreed,
      nda_signature: !ndaSignature,
    };
    if (errors.nda_name) {
      showFormError(`NDA name must match your registered name: ${expected}`, errors);
      return false;
    }
    if (errors.nda_signature) {
      showFormError("Please draw your signature on the pad.", errors);
      return false;
    }
    if (errors.nda_agreed) {
      showFormError("Agree to the NDA to continue.", errors);
      return false;
    }
    return true;
  }

  function normalizeName(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function validateDocuments() {
    const errors = {
      doc_code_of_conduct: !documents.accepted_code_of_conduct,
      doc_privacy_policy: !documents.accepted_privacy_policy,
      doc_employee_handbook: !documents.accepted_employee_handbook,
    };
    if (Object.values(errors).some(Boolean)) {
      showFormError("Acknowledge all three policies to continue.", errors);
      return false;
    }
    return true;
  }

  async function handleNext(event) {
    event.preventDefault();
    if (step === "emergency") {
      if (!validateEmergency()) return;
      await persist({
        step: "emergency",
        emergency: {
          ...emergency,
          phone: normalizePkMobile(emergency.phone),
          alternate_phone: emergency.alternate_phone ? normalizePkMobile(emergency.alternate_phone) : null,
          address: emergency.address || null,
        },
      });
    } else if (step === "employment") {
      if (!validateEmployment()) return;
      await persist({
        step: "employment",
        employment: {
          ...employment,
          account_holder_name: employment.account_holder_name || employee?.full_name || "",
          swift_code: employment.swift_code || null,
        },
      });
    } else if (step === "references") {
      if (!validateReferences()) return;
      await persist({
        step: "references",
        references: {
          references: references.map((ref) => ({
            ...ref,
            email: ref.email.trim().toLowerCase(),
            phone: normalizePkMobile(ref.phone),
          })),
        },
      });
    } else if (step === "documents") {
      if (!validateDocuments()) return;
      await persist({ step: "documents", documents });
    } else if (step === "nda") {
      if (!validateNda()) return;
      await persist({
        step: "nda",
        nda: { full_legal_name: employee?.full_name || ndaName, agreed: ndaAgreed },
      });
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
      <Toast toast={toast} onDismiss={() => setToast(null)} />

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
              <br />
              <span style={{ fontSize: 13 }}>
                Only post-hire details are collected here — personal, education, and skills from candidate
                onboarding are already on file and will not be asked again.
              </span>
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
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <button type="button" className="secondary-button" onClick={() => router.push("/dashboard/employee/profile")}>
                View my profile
              </button>
              <button type="button" className="primary-button" onClick={() => router.push("/dashboard/employee")}>
                Go to my dashboard
              </button>
            </div>
          </div>
        ) : (
          <>
            <ol className="onboarding-steps" aria-label="Profile completion">
              {STEPS.map((item, index) => (
                <li key={item.id} className={index <= stepIndex ? "active" : ""}>
                  <button type="button" onClick={() => goToStep(item.id)}>
                    <span>{index + 1}</span>
                    {item.label}
                  </button>
                </li>
              ))}
            </ol>

            <form className="auth-form" onSubmit={handleNext}>
              {step === "emergency" && (
                <div className={styles.formStack}>
                  <div>
                    <h2 className={styles.stepTitle}>Emergency contact</h2>
                    <p className={styles.stepLead}>Who should we reach if we cannot contact you at work?</p>
                  </div>
                  <div className={styles.sectionCard}>
                    <div className={styles.sectionCardHead}>
                      <div>
                        <h3>Contact person</h3>
                        <p>Name and relationship to you.</p>
                      </div>
                    </div>
                    <div className={styles.fieldRow}>
                      <Field
                        label="Full name"
                        value={emergency.name}
                        error={fieldErrors.emergency_name}
                        onChange={(e) => {
                          setEmergency({ ...emergency, name: e.target.value });
                          clearFieldError("emergency_name");
                        }}
                      />
                      <Field
                        label="Relationship"
                        value={emergency.relationship}
                        error={fieldErrors.emergency_relationship}
                        onChange={(e) => {
                          setEmergency({ ...emergency, relationship: e.target.value });
                          clearFieldError("emergency_relationship");
                        }}
                      />
                    </div>
                  </div>
                  <div className={styles.sectionCard}>
                    <div className={styles.sectionCardHead}>
                      <div>
                        <h3>Phone numbers</h3>
                        <p>Primary number is required; alternate is optional.</p>
                      </div>
                    </div>
                    <div className={styles.fieldRow}>
                      <Field
                        label="Phone"
                        value={emergency.phone}
                        error={fieldErrors.emergency_phone}
                        hint={PK_MOBILE_HINT}
                        onChange={(e) => {
                          setEmergency({ ...emergency, phone: formatPkMobileInput(e.target.value) });
                          clearFieldError("emergency_phone");
                        }}
                      />
                      <Field
                        label="Alternate phone (optional)"
                        value={emergency.alternate_phone || ""}
                        error={fieldErrors.emergency_alternate_phone}
                        hint={PK_MOBILE_HINT}
                        onChange={(e) => {
                          setEmergency({ ...emergency, alternate_phone: formatPkMobileInput(e.target.value) });
                          clearFieldError("emergency_alternate_phone");
                        }}
                      />
                    </div>
                  </div>
                  <div className={styles.sectionCard}>
                    <div className={styles.sectionCardHead}>
                      <div>
                        <h3>Address</h3>
                        <p>Optional mailing address for your emergency contact.</p>
                      </div>
                    </div>
                    <Field
                      wide
                      label="Street address"
                      value={emergency.address || ""}
                      onChange={(e) => setEmergency({ ...emergency, address: e.target.value })}
                    />
                  </div>
                </div>
              )}

              {step === "employment" && (
                <div className={styles.formStack}>
                  <div>
                    <h2 className={styles.stepTitle}>Banking details</h2>
                    <p className={styles.stepLead}>Salary will be deposited to this account. Double-check account numbers carefully.</p>
                  </div>
                  <div className={styles.sectionCard}>
                    <div className={styles.sectionCardHead}>
                      <div>
                        <h3>Account information</h3>
                        <p>Bank name, account holder, and account number.</p>
                      </div>
                    </div>
                    <div className={styles.fieldGrid}>
                      <Field
                        label="Bank name"
                        value={employment.bank_name}
                        error={fieldErrors.employment_bank_name}
                        onChange={(e) => {
                          setEmployment({ ...employment, bank_name: e.target.value });
                          clearFieldError("employment_bank_name");
                        }}
                      />
                      <Field
                        label="Account title"
                        value={employment.account_holder_name}
                        error={fieldErrors.employment_account_holder_name}
                        onChange={(e) => {
                          setEmployment({ ...employment, account_holder_name: e.target.value });
                          clearFieldError("employment_account_holder_name");
                        }}
                      />
                      <Field
                        label="Account number"
                        value={employment.account_number}
                        error={fieldErrors.employment_account_number}
                        onChange={(e) => {
                          setEmployment({ ...employment, account_number: e.target.value });
                          clearFieldError("employment_account_number");
                        }}
                      />
                      <Field
                        label="IBAN"
                        value={employment.iban || ""}
                        error={fieldErrors.employment_iban}
                        onChange={(e) => {
                          setEmployment({ ...employment, iban: e.target.value });
                          clearFieldError("employment_iban");
                        }}
                      />
                    </div>
                  </div>
                  <div className={styles.sectionCard}>
                    <div className={styles.sectionCardHead}>
                      <div>
                        <h3>Branch &amp; tax</h3>
                        <p>Branch location and tax identification.</p>
                      </div>
                    </div>
                    <div className={styles.fieldGrid}>
                      <Field
                        label="Branch"
                        value={employment.branch || ""}
                        error={fieldErrors.employment_branch}
                        onChange={(e) => {
                          setEmployment({ ...employment, branch: e.target.value });
                          clearFieldError("employment_branch");
                        }}
                      />
                      <Field
                        label="Branch code"
                        value={employment.branch_code || ""}
                        error={fieldErrors.employment_branch_code}
                        onChange={(e) => {
                          setEmployment({ ...employment, branch_code: e.target.value });
                          clearFieldError("employment_branch_code");
                        }}
                      />
                      <Field
                        label="Swift code (optional)"
                        value={employment.swift_code || ""}
                        onChange={(e) => setEmployment({ ...employment, swift_code: e.target.value })}
                      />
                      <Field
                        label="Tax ID"
                        value={employment.tax_id}
                        error={fieldErrors.employment_tax_id}
                        onChange={(e) => {
                          setEmployment({ ...employment, tax_id: e.target.value });
                          clearFieldError("employment_tax_id");
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {step === "references" && (
                <div className={styles.formStack}>
                  <div>
                    <h2 className={styles.stepTitle}>Professional references</h2>
                    <p className={styles.stepLead}>Provide at least two people who can speak to your work. Names may be the same, but each email must be unique. Phones use Pakistan format ({PK_MOBILE_HINT}).</p>
                  </div>
                  {references.map((ref, index) => (
                    <div key={index} className={`${styles.sectionCard} ${styles.referenceBlock}`}>
                      <div className={styles.sectionCardHead}>
                        <div>
                          <h3>Reference {index + 1}</h3>
                          <p>Former manager, colleague, or professional contact.</p>
                        </div>
                        <span className={styles.referenceIndex}>Ref {index + 1}</span>
                      </div>
                      <div className={styles.fieldRow}>
                        <Field
                          label="Full name"
                          value={ref.full_name}
                          error={fieldErrors[`ref_${index}_full_name`]}
                          onChange={(e) => {
                            const next = [...references];
                            next[index] = { ...next[index], full_name: e.target.value };
                            setReferences(next);
                            clearFieldError(`ref_${index}_full_name`);
                          }}
                        />
                        <Field
                          label="Relationship"
                          value={ref.relationship}
                          error={fieldErrors[`ref_${index}_relationship`]}
                          onChange={(e) => {
                            const next = [...references];
                            next[index] = { ...next[index], relationship: e.target.value };
                            setReferences(next);
                            clearFieldError(`ref_${index}_relationship`);
                          }}
                        />
                      </div>
                      <div className={styles.fieldRow} style={{ marginTop: 16 }}>
                        <Field
                          label="Email"
                          type="email"
                          value={ref.email}
                          error={fieldErrors[`ref_${index}_email`]}
                          onChange={(e) => {
                            const next = [...references];
                            next[index] = { ...next[index], email: e.target.value };
                            setReferences(next);
                            clearFieldError(`ref_${index}_email`);
                          }}
                        />
                        <Field
                          label="Phone"
                          value={ref.phone}
                          error={fieldErrors[`ref_${index}_phone`]}
                          hint={PK_MOBILE_HINT}
                          onChange={(e) => {
                            const next = [...references];
                            next[index] = { ...next[index], phone: formatPkMobileInput(e.target.value) };
                            setReferences(next);
                            clearFieldError(`ref_${index}_phone`);
                          }}
                        />
                      </div>
                      <div style={{ marginTop: 16 }}>
                        <Field
                          wide
                          label="Company"
                          value={ref.company}
                          error={fieldErrors[`ref_${index}_company`]}
                          onChange={(e) => {
                            const next = [...references];
                            next[index] = { ...next[index], company: e.target.value };
                            setReferences(next);
                            clearFieldError(`ref_${index}_company`);
                          }}
                        />
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    className={`secondary-button ${styles.addRefBtn}`}
                    onClick={() => setReferences((c) => [...c, { ...emptyReference }])}
                  >
                    Add another reference
                  </button>
                </div>
              )}

              {step === "documents" && (
                <div className={styles.formStack}>
                  <div>
                    <h2 className={styles.stepTitle}>Company policies</h2>
                    <p className={styles.stepLead}>Review and acknowledge each policy below to continue.</p>
                  </div>
                  <div className={styles.sectionCard}>
                    <PolicyCheck
                      checked={documents.accepted_code_of_conduct}
                      error={fieldErrors.doc_code_of_conduct}
                      onChange={(e) => {
                        setDocuments({ ...documents, accepted_code_of_conduct: e.target.checked });
                        clearFieldError("doc_code_of_conduct");
                      }}
                    >
                      I have read and agree to the Code of Conduct.
                    </PolicyCheck>
                    <PolicyCheck
                      checked={documents.accepted_privacy_policy}
                      error={fieldErrors.doc_privacy_policy}
                      onChange={(e) => {
                        setDocuments({ ...documents, accepted_privacy_policy: e.target.checked });
                        clearFieldError("doc_privacy_policy");
                      }}
                    >
                      I have read and agree to the Privacy &amp; IT Security Policy.
                    </PolicyCheck>
                    <PolicyCheck
                      checked={documents.accepted_employee_handbook}
                      error={fieldErrors.doc_employee_handbook}
                      onChange={(e) => {
                        setDocuments({ ...documents, accepted_employee_handbook: e.target.checked });
                        clearFieldError("doc_employee_handbook");
                      }}
                    >
                      I have read and agree to the Employee Handbook (Leave &amp; Remote Work Policy).
                    </PolicyCheck>
                  </div>
                </div>
              )}

              {step === "nda" && (
                <div className={styles.formStack}>
                  <div className={styles.ndaBlock}>
                    <h3>Non-Disclosure Agreement</h3>
                    <p>
                      Your full legal name is locked to your registered name from first registration and must match
                      your offer letter signature.
                    </p>
                    <label className={`${styles.field} ${styles.wide} ${fieldErrors.nda_name ? styles.fieldError : ""}`} data-field-error={fieldErrors.nda_name ? "true" : undefined}>
                      <span>Full legal name</span>
                      <input type="text" value={employee?.full_name || ndaName} readOnly />
                      <small>Must match: {employee?.full_name}</small>
                    </label>
                    <div style={{ marginTop: 16 }} className={fieldErrors.nda_signature ? styles.fieldError : ""} data-field-error={fieldErrors.nda_signature ? "true" : undefined}>
                      <SignaturePad onChange={setNdaSignature} />
                      {fieldErrors.nda_signature && <em className={styles.fieldErrorText}>Signature required</em>}
                    </div>
                    <label
                      className={`${styles.checkRow} ${fieldErrors.nda_agreed ? styles.checkRowError : ""}`}
                      data-field-error={fieldErrors.nda_agreed ? "true" : undefined}
                      style={{ marginTop: 16 }}
                    >
                      <input
                        type="checkbox"
                        checked={ndaAgreed}
                        onChange={(e) => {
                          setNdaAgreed(e.target.checked);
                          clearFieldError("nda_agreed");
                        }}
                      />
                      <span>I agree to the terms of the Non-Disclosure Agreement.</span>
                    </label>
                  </div>
                </div>
              )}

              {step === "submit" && (
                <div className={styles.formStack}>
                  <div>
                    <h2 className={styles.stepTitle}>Review &amp; finish</h2>
                    <p className={styles.stepLead}>Confirm post-hire sections below, then submit to complete your profile.</p>
                  </div>
                  <div className={styles.reviewGrid}>
                    <ReviewBlock
                      title="Emergency contact"
                      items={[
                        ["Name", emergency.name],
                        ["Relationship", emergency.relationship],
                        ["Phone", emergency.phone],
                        ["Alternate", emergency.alternate_phone],
                      ]}
                    />
                    <ReviewBlock
                      title="Banking"
                      items={[
                        ["Bank", employment.bank_name],
                        ["Account title", employment.account_holder_name],
                        ["IBAN", employment.iban],
                        ["Branch", employment.branch],
                      ]}
                    />
                    <ReviewBlock
                      title="References"
                      items={references.map((ref, i) => [`Ref ${i + 1}`, `${ref.full_name || "—"} · ${ref.email || ""}`])}
                    />
                    <ReviewBlock
                      title="NDA"
                      items={[
                        ["Signed by", employee?.full_name || ndaName || "—"],
                        ["Policies", documents.accepted_code_of_conduct && documents.accepted_privacy_policy && documents.accepted_employee_handbook ? "Acknowledged" : "Incomplete"],
                      ]}
                    />
                  </div>
                </div>
              )}

              <div className="onboarding-actions" style={{ justifyContent: "space-between" }}>
                <button type="button" className="secondary-button" onClick={() => router.push("/dashboard/employee")}>
                  Save &amp; exit
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

function Field({ label, value, onChange, type = "text", wide, error, hint }) {
  return (
    <label
      className={`${styles.field} ${wide ? styles.wide : ""} ${error ? styles.fieldError : ""}`}
      data-field-error={error ? "true" : undefined}
    >
      <span>{label}</span>
      <input type={type} value={value} onChange={onChange} aria-invalid={!!error} />
      {error && <em className={styles.fieldErrorText}>{hint || "Required"}</em>}
      {!error && hint ? <small>{hint}</small> : null}
    </label>
  );
}

function PolicyCheck({ checked, onChange, error, children }) {
  return (
    <label
      className={`${styles.checkRow} ${error ? styles.checkRowError : ""}`}
      data-field-error={error ? "true" : undefined}
      style={{ marginBottom: 10 }}
    >
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{children}</span>
    </label>
  );
}

function ReviewBlock({ title, items }) {
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

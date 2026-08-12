"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import Link from "next/link";

import {
  getApiErrorMessage,
  getNotifications,
  getProfileCompletion,
  saveProfileCompletion,
} from "@/services/authService";
import EmployeeShell from "@/components/employee/EmployeeShell";
import RecruiterLoader from "@/components/recruiter/RecruiterLoader";
import SignaturePad from "@/components/SignaturePad";
import FileUploadField from "@/components/FileUploadField";
import AiField, { AiCheckRow } from "@/components/ai-experience/AiField";
import BankSlipScanner from "@/components/ai-experience/BankSlipScanner";
import { IconCheck, IconScan, IconSparkle } from "@/components/ai-experience/icons";
import { useAutoSave } from "@/lib/ai/useAutoSave";
import { invalidateInsightCache } from "@/lib/ai/employeeInsights";
import { publishGuideContext, registerPageAssist } from "@/lib/ai/guideContext";
import { openAiAssistantChat } from "@/lib/ai/openAiAssistant";
import { scrollOcrFieldIntoView, typewriterFill } from "@/lib/ai/typewriterFill";
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
  { id: "nda", label: "Self Declaration" },
  { id: "submit", label: "Finish" },
];

const SECTION_FIELDS = {
  emergency: ["Full name", "Relationship", "Contact", "Alternate contact", "Address"],
  employment: ["Bank name", "Account holder", "Account number", "IBAN", "Branch", "SWIFT"],
  references: ["Full name", "Relationship", "Email", "Contact", "Company"],
  documents: ["Privacy Policy", "Employee Handbook"],
  nda: ["Full legal name", "Agreement checkbox", "Signature"],
  submit: ["Review all sections", "Submit profile"],
};

const MODE_KEY = "complete_profile_ui_mode";

const emptyEmergency = { name: "", relationship: "", phone: "", alternate_phone: "", address: "" };
const emptyEmployment = {
  bank_name: "",
  account_holder_name: "",
  account_number: "",
  iban: "",
  branch: "",
  branch_code: "",
  swift_code: "",
};
const emptyReference = { full_name: "", relationship: "", email: "", phone: "", company: "" };
const emptyDocuments = {
  accepted_privacy_policy: false,
  accepted_employee_handbook: false,
};

const AUTOSAVE_SECTIONS = ["emergency", "employment", "references", "documents"];

export default function CompleteProfilePage() {
  return (
    <EmployeeShell
      activeKey="onboarding"
      title="Onboarding"
      subtitle="Post-hire profile completion"
      permissions={["onboarding.self", "profile.view"]}
    >
      <CompleteProfileContent />
    </EmployeeShell>
  );
}

function CompleteProfileContent() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [employee, setEmployee] = useState(null);
  const [progress, setProgress] = useState(null);
  const [step, setStep] = useState("emergency");
  const [recruiterNudge, setRecruiterNudge] = useState(null);
  const [showScanner, setShowScanner] = useState(false);
  const [ocrFillMeta, setOcrFillMeta] = useState({ fields: {}, activeField: null });
  const ocrFillAbortRef = useRef(null);

  const [emergency, setEmergency] = useState(emptyEmergency);
  const [employment, setEmployment] = useState(emptyEmployment);
  const [references, setReferences] = useState([{ ...emptyReference }, { ...emptyReference }]);
  const [documents, setDocuments] = useState(emptyDocuments);
  const [selfDeclName, setSelfDeclName] = useState("");
  const [selfDeclAgreed, setSelfDeclAgreed] = useState(false);
  const [selfDeclSignature, setSelfDeclSignature] = useState(null);

  const complete = progress?.profile_status === "complete";
  const isRemote = Boolean(employee?.is_remote);
  const visibleSteps = useMemo(
    () => (isRemote ? STEPS : STEPS.filter((item) => item.id !== "employment")),
    [isRemote]
  );
  const stepIndex = useMemo(
    () => visibleSteps.findIndex((item) => item.id === step),
    [step, visibleSteps]
  );

  useEffect(() => {
    if (!employee) return;
    if (!isRemote && step === "employment") {
      setStep(progress?.current_step || "emergency");
    }
  }, [employee, isRemote, step, progress?.current_step]);

  useEffect(() => {
    publishGuideContext({
      pathname: "/dashboard/employee/complete-profile",
      section: step,
      label: visibleSteps.find((item) => item.id === step)?.label || step,
      fields: SECTION_FIELDS[step] || [],
      progress: progress || null,
      mode: "manual",
      formId: "complete-profile",
    });
  }, [step, progress, visibleSteps]);

  const gotoSection = useCallback((sectionId) => {
    setFieldErrors({});
    setStep(sectionId);
  }, []);

  const hydrate = useCallback((onboarding, emp = null) => {
    if (!onboarding) return;
    if (onboarding.emergency) setEmergency({ ...emptyEmergency, ...onboarding.emergency });
    if (onboarding.employment) {
      setEmployment({
        ...emptyEmployment,
        bank_name: onboarding.employment.bank_name || "",
        account_holder_name: onboarding.employment.account_holder_name || emp?.full_name || "",
        account_number: onboarding.employment.account_number || "",
        iban: onboarding.employment.iban || "",
        branch: onboarding.employment.branch || "",
        branch_code: onboarding.employment.branch_code || "",
        swift_code: onboarding.employment.swift_code || "",
      });
    } else if (emp?.full_name) {
      setEmployment((current) => ({
        ...current,
        account_holder_name: current.account_holder_name || emp.full_name,
      }));
    }
    if (onboarding.references?.references?.length) setReferences(onboarding.references.references);
    if (onboarding.documents) setDocuments({ ...emptyDocuments, ...onboarding.documents });
    const lockedName = emp?.full_name || "";
    if (onboarding.nda) {
      setSelfDeclName(onboarding.nda.full_legal_name || lockedName);
      setSelfDeclAgreed(!!onboarding.nda.agreed);
      if (onboarding.nda.signature) setSelfDeclSignature(onboarding.nda.signature);
    } else if (lockedName) {
      setSelfDeclName(lockedName);
    }
  }, []);

  const persistPayload = useCallback(
    async (payload, { silent = false, advance = true } = {}) => {
      const accessToken = localStorage.getItem("access_token");
      setSaving(true);
      setFieldErrors({});
      try {
        const data = await saveProfileCompletion(payload, accessToken);
        setEmployee(data.employee);
        setProgress(data.progress);
        hydrate(data.onboarding, data.employee);
        invalidateInsightCache();
        if (payload.step === "submit") {
          setStep("submit");
        } else if (advance && !silent && data.progress?.current_step) {
          setStep(data.progress.current_step);
        }
        return { ok: true, data, message: data.message };
      } catch (error) {
        return { ok: false, message: getApiErrorMessage(error, "Could not save this step.") };
      } finally {
        setSaving(false);
      }
    },
    [hydrate]
  );

  useEffect(() => {
    return registerPageAssist(null);
  }, []);

  const load = useCallback(
    async (accessToken) => {
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
        try {
          sessionStorage.removeItem(MODE_KEY);
        } catch {
          // ignore
        }
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Unable to load your profile."));
      } finally {
        setLoading(false);
      }
    },
    [hydrate]
  );

  useEffect(() => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    load(accessToken);
  }, [router]);

  useEffect(() => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken || complete) return undefined;

    let cancelled = false;
    async function loadNudge() {
      try {
        const data = await getNotifications(accessToken);
        if (cancelled) return;
        const reminder = (data.notifications || []).find(
          (item) => item.type === "profile_completion_reminder" && !item.read
        );
        if (reminder) setRecruiterNudge(reminder);
      } catch {
        // Non-critical.
      }
    }
    loadNudge();
    const timer = setInterval(loadNudge, 20000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [complete]);

  const checks = useMemo(
    () => ({
      emergency: () => {
        const errors = {
          "emergency.name": !emergency.name?.trim(),
          "emergency.relationship": !emergency.relationship?.trim(),
          "emergency.phone": !isValidPkMobile(emergency.phone),
          "emergency.alternate_phone": !!(
            emergency.alternate_phone && !isValidPkMobile(emergency.alternate_phone)
          ),
        };
        return {
          errors,
          message: `Complete your emergency contact. Contact must be a valid Pakistan number (${PK_MOBILE_HINT}).`,
        };
      },
      employment: () => ({
        errors: {
          "employment.bank_name": !employment.bank_name?.trim(),
          "employment.account_holder_name": !employment.account_holder_name?.trim(),
          "employment.account_number": !employment.account_number?.trim(),
          "employment.iban": !employment.iban?.trim(),
          "employment.branch": !employment.branch?.trim(),
          "employment.branch_code": !employment.branch_code?.trim(),
        },
        message: "Complete your banking details including IBAN, branch, and branch code.",
      }),
      references: () => {
        const errors = {};
        const emails = [];
        const phones = [];

        references.forEach((reference, index) => {
          if (!reference.full_name?.trim()) errors[`references.${index}.full_name`] = true;
          if (!reference.relationship?.trim()) errors[`references.${index}.relationship`] = true;
          if (!reference.email?.trim()) errors[`references.${index}.email`] = true;
          if (!isValidPkMobile(reference.phone)) errors[`references.${index}.phone`] = true;
          if (!reference.company?.trim()) errors[`references.${index}.company`] = true;

          if (reference.email?.trim()) emails.push(reference.email.trim().toLowerCase());
          if (reference.phone?.trim() && isValidPkMobile(reference.phone)) {
            phones.push(normalizePkMobile(reference.phone.trim()));
          }
        });

        let duplicateEmail = false;
        emails.forEach((email) => {
          if (email && emails.filter((item) => item === email).length > 1) {
            duplicateEmail = true;
            references.forEach((reference, index) => {
              if (reference.email?.trim().toLowerCase() === email) {
                errors[`references.${index}.email`] = "Duplicate email address.";
              }
            });
          }
        });

        let duplicatePhone = false;
        phones.forEach((phone) => {
          if (phone && phones.filter((item) => item === phone).length > 1) {
            duplicatePhone = true;
            references.forEach((reference, index) => {
              if (
                reference.phone?.trim() &&
                isValidPkMobile(reference.phone) &&
                normalizePkMobile(reference.phone.trim()) === phone
              ) {
                errors[`references.${index}.phone`] = "Duplicate contact.";
              }
            });
          }
        });

        if (references.length < 2) errors["references.1.full_name"] = true;

        let message = `Provide at least two complete references. Contacts: ${PK_MOBILE_HINT}.`;
        if (duplicateEmail && duplicatePhone) message = "Each reference needs a unique email and contact.";
        else if (duplicateEmail) message = "Each reference needs a unique email address.";
        else if (duplicatePhone) message = "Each reference needs a unique contact.";

        return { errors, message };
      },
      documents: () => ({
        errors: {
          "documents.accepted_privacy_policy": !documents.accepted_privacy_policy,
          "documents.accepted_employee_handbook": !documents.accepted_employee_handbook,
        },
        message: "Acknowledge both policies to continue.",
      }),
      nda: () => {
        const expected = employee?.full_name || "";
        const nameMismatch =
          !selfDeclName?.trim() || normalizeName(selfDeclName) !== normalizeName(expected);
        const errors = {
          "nda.full_legal_name": nameMismatch,
          "nda.signature": !selfDeclSignature,
          "nda.agreed": !selfDeclAgreed,
        };
        let message = "You must agree to the self-declaration and provide your signature.";
        if (nameMismatch) message = `Name must match your registered name: ${expected}`;
        else if (!selfDeclSignature) message = "Please draw or upload your signature.";
        else if (!selfDeclAgreed) message = "You must agree to the declaration to continue.";
        return { errors, message };
      },
    }),
    [emergency, employment, references, documents, employee, selfDeclName, selfDeclAgreed, selfDeclSignature]
  );

  const isSectionValid = useCallback(
    (sectionId) => {
      const check = checks[sectionId];
      if (!check) return false;
      return !Object.values(check().errors).some(Boolean);
    },
    [checks]
  );

  function validateSection(sectionId) {
    const check = checks[sectionId];
    if (!check) return true;
    const { errors, message } = check();
    if (!Object.values(errors).some(Boolean)) return true;
    setFieldErrors(errors);
    window.requestAnimationFrame(() => {
      document.querySelector("[data-field-error='true']")?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
    return false;
  }

  const buildSectionPayload = useCallback(
    (sectionId) => {
      if (sectionId === "emergency") {
        return {
          step: "emergency",
          emergency: {
            ...emergency,
            phone: normalizePkMobile(emergency.phone),
            alternate_phone: emergency.alternate_phone ? normalizePkMobile(emergency.alternate_phone) : null,
            address: emergency.address || null,
          },
        };
      }
      if (sectionId === "employment") {
        return {
          step: "employment",
          employment: {
            bank_name: employment.bank_name,
            account_holder_name: employment.account_holder_name || employee?.full_name || "",
            account_number: employment.account_number,
            iban: employment.iban,
            branch: employment.branch,
            branch_code: employment.branch_code,
            swift_code: employment.swift_code || null,
          },
        };
      }
      if (sectionId === "references") {
        return {
          step: "references",
          references: {
            references: references.map((reference) => ({
              ...reference,
              email: reference.email.trim().toLowerCase(),
              phone: normalizePkMobile(reference.phone),
            })),
          },
        };
      }
      if (sectionId === "documents") return { step: "documents", documents };
      if (sectionId === "nda") {
        return {
          step: "nda",
          nda: {
            full_legal_name: employee?.full_name || selfDeclName,
            agreed: selfDeclAgreed,
            signature: selfDeclSignature,
          },
        };
      }
      return { step: "submit" };
    },
    [emergency, employment, references, documents, employee, selfDeclName, selfDeclAgreed, selfDeclSignature]
  );

  const autoSaveValue = useMemo(() => {
    if (step === "emergency") return emergency;
    if (step === "employment" && isRemote) return employment;
    if (step === "references") return references;
    if (step === "documents") return documents;
    return null;
  }, [step, emergency, employment, references, documents, isRemote]);

  useAutoSave({
    value: autoSaveValue,
    resetKey: step,
    enabled:
      AUTOSAVE_SECTIONS.includes(step) &&
      !complete &&
      (step !== "employment" || isRemote),
    isReady: () => isSectionValid(step),
    buildPayload: () => buildSectionPayload(step),
    save: async (payload) => {
      const result = await persistPayload(payload, { silent: true, advance: false });
      if (result.ok) {
        toast.success("Progress saved automatically");
      } else {
        toast.error(result.message, { autoClose: 5200 });
      }
    },
  });

  function openOnboardingAssistant() {
    const label = visibleSteps.find((item) => item.id === step)?.label || "onboarding";
    openAiAssistantChat(router, {
      href: "/dashboard/employee/ai-assistant",
      prompt:
        `I was redirected from post-hire onboarding (currently on “${label}”). ` +
        "Help me finish my profile checklist — tell me what’s left and guide me step by step. " +
        "Do not fill form fields for me; I’ll enter the values myself on the onboarding page.",
    });
  }

  function handleScanApplied(result) {
    setShowScanner(false);
    const fields = result?.fields || {};
    const confidence = result?.field_confidence || {};
    const order = [
      "account_holder_name",
      "iban",
      "bank_name",
      "account_number",
      "branch",
      "branch_code",
      "swift_code",
    ];

    ocrFillAbortRef.current?.abort();
    const controller = new AbortController();
    ocrFillAbortRef.current = controller;

    setEmployment((current) => {
      const next = { ...current };
      for (const key of order) {
        if (fields[key]) next[key] = "";
      }
      return next;
    });
    setStep("employment");
    setOcrFillMeta({ fields: {}, activeField: null });

    const entries = order
      .filter((key) => fields[key])
      .map((key) => ({
        key: `employment.${key}`,
        value: String(fields[key]).trim(),
        apply: (partial) => {
          setEmployment((current) => ({ ...current, [key]: partial }));
          setOcrFillMeta((meta) => ({
            activeField: `employment.${key}`,
            fields: {
              ...meta.fields,
              [`employment.${key}`]: {
                status: "typing",
                source: "ocr",
                confidence: confidence[key],
              },
            },
          }));
        },
      }));

    void (async () => {
      await typewriterFill(entries, {
        signal: controller.signal,
        onFieldStart: (key) => {
          setOcrFillMeta((meta) => ({
            activeField: key,
            fields: {
              ...meta.fields,
              [key]: { ...(meta.fields[key] || {}), status: "typing", source: "ocr" },
            },
          }));
          scrollOcrFieldIntoView(key);
        },
        onFieldDone: (key) => {
          const fieldKey = key.replace(/^employment\./, "");
          setOcrFillMeta((meta) => ({
            activeField: null,
            fields: {
              ...meta.fields,
              [key]: {
                status: "filled",
                source: "ocr",
                confidence: confidence[fieldKey],
                filledAt: Date.now(),
              },
            },
          }));
        },
      });
      if (controller.signal.aborted) return;
      setEmployment((current) => {
        const next = { ...current };
        for (const key of order) {
          if (fields[key]) next[key] = String(fields[key]).trim();
        }
        return next;
      });
      toast.success("Bank details filled from your document — review and save when ready.");
    })();
  }

  useEffect(() => () => ocrFillAbortRef.current?.abort(), []);

  async function handleNext(event) {
    event.preventDefault();
    if (step !== "submit" && !validateSection(step)) return;
    const result = await persistPayload(buildSectionPayload(step));
    if (result.ok) {
      toast.success(result.message || "Progress saved.");
    } else {
      toast.error(result.message);
    }
  }

  if (loading) return null;

  const percentage = progress?.percentage ?? (complete ? 100 : 0);
  const remaining = (progress?.missing_fields || []).filter((key) => key !== "submit").length;

  return (
    <>
      {!complete && recruiterNudge ? (
        <div className={styles.nudge} role="status">
          <IconSparkle width={16} height={16} />
          <div>
            <strong>Reminder from your recruiter</strong>
            {recruiterNudge.message || "Please finish your post-hire profile checklist."}
          </div>
        </div>
      ) : null}

      <Hero
        employee={employee}
        percentage={percentage}
        complete={complete}
        remaining={remaining}
      />

      {complete && step === "submit" ? (
        <CompletedRecord
          employee={employee}
          isRemote={isRemote}
          emergency={emergency}
          employment={employment}
          references={references}
          documents={documents}
          selfDeclName={selfDeclName}
          selfDeclAgreed={selfDeclAgreed}
          onViewProfile={() => router.push("/dashboard/employee/profile")}
          onDashboard={() => router.push("/dashboard/employee")}
        />
      ) : (
        <>
          <AssistStrip onOpenAssistant={openOnboardingAssistant} />

          <OnboardingForm
            step={step}
            stepIndex={stepIndex}
            visibleSteps={visibleSteps}
            isRemote={isRemote}
            onStepChange={gotoSection}
            fieldErrors={fieldErrors}
            clearFieldError={(key) => setFieldErrors((current) => ({ ...current, [key]: false }))}
            automation={ocrFillMeta}
            saving={saving}
            complete={complete}
            employee={employee}
            emergency={emergency}
            setEmergency={setEmergency}
            employment={employment}
            setEmployment={setEmployment}
            references={references}
            setReferences={setReferences}
            documents={documents}
            setDocuments={setDocuments}
            selfDeclName={selfDeclName}
            selfDeclAgreed={selfDeclAgreed}
            setSelfDeclAgreed={setSelfDeclAgreed}
            selfDeclSignature={selfDeclSignature}
            setSelfDeclSignature={setSelfDeclSignature}
            showScanner={showScanner}
            onToggleScanner={() => setShowScanner((value) => !value)}
            onScanApplied={handleScanApplied}
            onScanDismissed={() => setShowScanner(false)}
            onSubmit={handleNext}
            onExit={() => router.push("/dashboard/employee")}
          />
        </>
      )}

      </>
  );
}

// ── Hero, ProgressRing, AssistStrip, OnboardingForm, CompletedRecord, etc. ──

function Hero({ employee, percentage, complete, remaining }) {
  return (
    <section className={styles.hero}>
      <div className={styles.heroLeft}>
        <div className={styles.heroEyebrow}>
          <IconSparkle width={12} height={12} />
          {complete ? "Status · Completed" : "Welcome aboard"}
        </div>
        <h1>{complete ? "Your onboarding record" : "Let's finish your profile"}</h1>
        <p className={styles.heroMeta}>
          {complete
            ? "Everything you submitted after joining is on file. Editable details remain available on your profile page."
            : "Only post-hire details are collected here — your personal, education, and skills information already carried over from candidate onboarding."}
        </p>
        <div className={styles.heroChips}>
          {employee?.employee_id ? <span className={styles.heroChip}>{employee.employee_id}</span> : null}
          {employee?.job_title ? <span className={styles.heroChip}>{employee.job_title}</span> : null}
          {complete ? (
            <span className={`${styles.heroChip} ${styles.heroChipDone}`}>
              <IconCheck width={11} height={11} />
              All steps complete
            </span>
          ) : (
            <span className={styles.heroChip}>
              {remaining} step{remaining === 1 ? "" : "s"} remaining
            </span>
          )}
        </div>
      </div>

      <div className={styles.ringWrap}>
        <ProgressRing percentage={percentage} />
        <div className={styles.ringLabel}>{complete ? "Completed" : "Completion progress"}</div>
      </div>
    </section>
  );
}

function ProgressRing({ percentage = 0 }) {
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, percentage));
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <svg className={styles.ring} viewBox="0 0 100 100" role="img" aria-label={`${clamped}% complete`}>
      <defs>
        <linearGradient id="ringGradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#7c5cff" />
        </linearGradient>
      </defs>
      <circle className={styles.ringTrack} cx="50" cy="50" r={radius} fill="none" strokeWidth="8" />
      <circle
        cx="50"
        cy="50"
        r={radius}
        fill="none"
        stroke="url(#ringGradient)"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 50 50)"
        style={{ transition: "stroke-dashoffset 700ms cubic-bezier(.22,1,.36,1)" }}
      />
      <text x="50" y="56" textAnchor="middle" className={styles.ringValue}>
        {clamped}%
      </text>
    </svg>
  );
}

function AssistStrip({ onOpenAssistant }) {
  return (
    <div className={styles.modeStrip}>
      <div className={styles.modeStripText}>
        <div className={styles.modeStripTitle}>Need help with onboarding?</div>
        <div className={styles.modeStripSub}>
          Open AI Assistant chat for guidance. You still fill every field yourself on this page.
        </div>
      </div>
      <div className={styles.modeStripActions}>
        <button type="button" className={styles.btnSecondary} onClick={onOpenAssistant}>
          <IconSparkle />
          Ask AI Assistant
        </button>
      </div>
    </div>
  );
}

function OnboardingForm({
  step,
  stepIndex,
  visibleSteps,
  isRemote,
  onStepChange,
  fieldErrors,
  clearFieldError,
  automation,
  saving,
  complete,
  employee,
  emergency,
  setEmergency,
  employment,
  setEmployment,
  references,
  setReferences,
  documents,
  setDocuments,
  selfDeclName,
  selfDeclAgreed,
  setSelfDeclAgreed,
  selfDeclSignature,
  setSelfDeclSignature,
  showScanner,
  onToggleScanner,
  onScanApplied,
  onScanDismissed,
  onSubmit,
  onExit,
}) {
  const { fields: aiFields, activeField } = automation;
  const [selfDeclSigMethod, setSelfDeclSigMethod] = useState("pad");

  const fieldProps = (key, { required = false } = {}) => ({
    fieldKey: key,
    required,
    ai: aiFields[key],
    active: activeField === key,
    error: fieldErrors[key],
  });

  function updateEmergency(key, value) {
    setEmergency((current) => ({ ...current, [key]: value }));
    clearFieldError(`emergency.${key}`);
  }
  function updateEmployment(key, value) {
    setEmployment((current) => ({ ...current, [key]: value }));
    clearFieldError(`employment.${key}`);
  }
  function updateReference(index, key, value) {
    setReferences((current) => {
      const next = [...current];
      next[index] = { ...next[index], [key]: value };
      return next;
    });
    clearFieldError(`references.${index}.${key}`);
  }
  function updateDocuments(key, value) {
    setDocuments((current) => ({ ...current, [key]: value }));
    clearFieldError(`documents.${key}`);
  }

  const sectionHasData = {
    emergency: Boolean(emergency.name && emergency.phone),
    employment: Boolean(employment.bank_name && employment.account_number),
    references: Boolean(references[0]?.full_name && references[1]?.full_name),
    documents: Boolean(
      documents.accepted_privacy_policy &&
        documents.accepted_employee_handbook
    ),
    nda: Boolean(selfDeclAgreed && selfDeclSignature),
    submit: Boolean(complete),
  };

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionHeadLeft}>
          <span className={`${styles.bar} ${styles.barBlue}`} />
          <div>
            <div className={styles.sectionTitle}>Required information</div>
            <div className={styles.sectionDesc}>
              {isRemote
                ? "Every section is validated before it is saved — including banking, which you must complete yourself."
                : "Every section is validated before it is saved. Banking for on-site roles is handled by your recruiter."}
            </div>
          </div>
        </div>
      </div>

      <div className={styles.sectionBody}>
        <ol className={styles.stepsList} aria-label="Profile completion steps">
          {visibleSteps.map((item, index) => {
            const isCurrent = index === stepIndex;
            const done = sectionHasData[item.id];
            const statusClass = isCurrent
              ? styles.stepCurrent
              : done
                ? styles.stepCompleted
                : styles.stepUpcoming;
            return (
              <li key={item.id} className={statusClass}>
                <button type="button" onClick={() => onStepChange(item.id)}>
                  <span className={styles.stepNum}>
                    {done && !isCurrent ? <IconCheck /> : index + 1}
                  </span>
                  {item.label}
                </button>
              </li>
            );
          })}
        </ol>

        <form data-partner-coach onSubmit={onSubmit}>
          {step === "emergency" ? (
            <div className={styles.formStack}>
              <div>
                <h2 className={styles.stepTitle}>Emergency contact</h2>
                <p className={styles.stepLead}>Who should we reach if we can&apos;t contact you at work?</p>
              </div>
              <div className={styles.fieldRow}>
                <AiField
                  label="Full name"
                  value={emergency.name}
                  onChange={(event) => updateEmergency("name", event.target.value)}
                  {...fieldProps("emergency.name", { required: true })}
                />
                <AiField
                  label="Relationship"
                  value={emergency.relationship}
                  onChange={(event) => updateEmergency("relationship", event.target.value)}
                  {...fieldProps("emergency.relationship", { required: true })}
                />
              </div>
              <div className={styles.fieldRow}>
                <AiField
                  label="Contact"
                  hint={PK_MOBILE_HINT}
                  value={emergency.phone}
                  onChange={(event) => updateEmergency("phone", formatPkMobileInput(event.target.value))}
                  {...fieldProps("emergency.phone", { required: true })}
                />
                <AiField
                  label="Alternate contact (optional)"
                  hint={PK_MOBILE_HINT}
                  value={emergency.alternate_phone || ""}
                  onChange={(event) =>
                    updateEmergency("alternate_phone", formatPkMobileInput(event.target.value))
                  }
                  {...fieldProps("emergency.alternate_phone")}
                />
              </div>
              <AiField
                wide
                label="Mailing address (optional)"
                value={emergency.address || ""}
                onChange={(event) => updateEmergency("address", event.target.value)}
                {...fieldProps("emergency.address")}
              />
            </div>
          ) : null}

          {step === "employment" && isRemote ? (
            <div className={styles.formStack}>
              <div>
                <h2 className={styles.stepTitle}>Banking details</h2>
                <p className={styles.stepLead}>
                  Your salary is deposited to this account, so the account title has to match your registered
                  name and the IBAN has to be exact.
                </p>
              </div>

              {showScanner ? (
                <div className={styles.scannerSlot}>
                  <BankSlipScanner onApply={onScanApplied} />
                  <div style={{ marginTop: 10 }}>
                    <button type="button" className={styles.btnGhost} onClick={onScanDismissed}>
                      Hide scanner and type it in
                    </button>
                  </div>
                </div>
              ) : (
                <div className={styles.scannerToggleRow}>
                  <div className={styles.scannerToggleText}>
                    <strong>Don&apos;t want to type your IBAN?</strong>
                    Upload a cheque or bank letter and the AI will read the account details off it.
                  </div>
                  <button type="button" className={styles.btnSecondary} onClick={onToggleScanner}>
                    <IconScan />
                    Scan a bank document
                  </button>
                </div>
              )}

              <div className={styles.fieldGrid}>
                <AiField
                  label="Bank name"
                  value={employment.bank_name}
                  onChange={(event) => updateEmployment("bank_name", event.target.value)}
                  {...fieldProps("employment.bank_name", { required: true })}
                />
                <AiField
                  label="Account title"
                  value={employment.account_holder_name}
                  onChange={(event) => updateEmployment("account_holder_name", event.target.value)}
                  {...fieldProps("employment.account_holder_name", { required: true })}
                />
                <AiField
                  label="Account number"
                  value={employment.account_number}
                  onChange={(event) => updateEmployment("account_number", event.target.value)}
                  {...fieldProps("employment.account_number", { required: true })}
                />
                <AiField
                  label="IBAN"
                  hint="Format: PK36SCBL0000001123456702"
                  value={employment.iban || ""}
                  onChange={(event) => updateEmployment("iban", event.target.value.toUpperCase())}
                  {...fieldProps("employment.iban", { required: true })}
                />
                <AiField
                  label="Branch"
                  value={employment.branch || ""}
                  onChange={(event) => updateEmployment("branch", event.target.value)}
                  {...fieldProps("employment.branch", { required: true })}
                />
                <AiField
                  label="Branch code"
                  value={employment.branch_code || ""}
                  onChange={(event) => updateEmployment("branch_code", event.target.value)}
                  {...fieldProps("employment.branch_code", { required: true })}
                />
                <AiField
                  label="SWIFT code (optional)"
                  value={employment.swift_code || ""}
                  onChange={(event) => updateEmployment("swift_code", event.target.value)}
                  {...fieldProps("employment.swift_code")}
                />
              </div>
            </div>
          ) : null}

          {step === "references" ? (
            <div className={styles.formStack}>
              <div>
                <h2 className={styles.stepTitle}>Professional references</h2>
                <p className={styles.stepLead}>
                  Two contacts who can speak to your work. The AI can pre-fill the companies from your résumé,
                  but the names and contact details have to come from you.
                </p>
              </div>

              {references.map((reference, index) => (
                <div key={index} className={styles.referenceBlock}>
                  <h3>Reference {index + 1}</h3>
                  <p>A former manager, colleague, or professional contact.</p>
                  <div className={styles.referenceGrid}>
                    <div className={styles.fieldRow}>
                      <AiField
                        label="Full name"
                        value={reference.full_name}
                        onChange={(event) => updateReference(index, "full_name", event.target.value)}
                        {...fieldProps(`references.${index}.full_name`, { required: true })}
                      />
                      <AiField
                        label="Relationship"
                        value={reference.relationship}
                        onChange={(event) => updateReference(index, "relationship", event.target.value)}
                        {...fieldProps(`references.${index}.relationship`, { required: true })}
                      />
                    </div>
                    <div className={styles.fieldRow}>
                      <AiField
                        label="Email"
                        type="email"
                        value={reference.email}
                        onChange={(event) => updateReference(index, "email", event.target.value)}
                        {...fieldProps(`references.${index}.email`, { required: true })}
                      />
                      <AiField
                        label="Contact"
                        hint={PK_MOBILE_HINT}
                        value={reference.phone}
                        onChange={(event) =>
                          updateReference(index, "phone", formatPkMobileInput(event.target.value))
                        }
                        {...fieldProps(`references.${index}.phone`, { required: true })}
                      />
                    </div>
                    <AiField
                      wide
                      label="Company"
                      value={reference.company}
                      onChange={(event) => updateReference(index, "company", event.target.value)}
                      {...fieldProps(`references.${index}.company`, { required: true })}
                    />
                  </div>
                </div>
              ))}

              <div>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => setReferences((current) => [...current, { ...emptyReference }])}
                >
                  Add another reference
                </button>
              </div>
            </div>
          ) : null}

          {step === "documents" ? (
            <div className={styles.formStack}>
              <div>
                <h2 className={styles.stepTitle}>Company policies</h2>
                <p className={styles.stepLead}>
                  Read and acknowledge each policy. These acknowledgements are recorded against your name, so
                  the AI will never tick them without asking you first.
                </p>
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <input
                    id="privacy-policy-checkbox"
                    type="checkbox"
                    checked={documents.accepted_privacy_policy}
                    onChange={(event) => updateDocuments("accepted_privacy_policy", event.target.checked)}
                    style={{ marginTop: 2 }}
                  />
                  <label htmlFor="privacy-policy-checkbox" style={{ fontSize: "0.88rem", lineHeight: 1.55, color: "#486076" }}>
                    I have read and agree to the{" "}
                    <Link href="/privacy-policy" target="_blank" rel="noopener noreferrer" style={{ color: "var(--blue-strong)", fontWeight: 700, textDecoration: "none" }}>
                      Privacy &amp; IT Security Policy
                    </Link>
                    .
                  </label>
                </div>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <input
                    id="employee-handbook-checkbox"
                    type="checkbox"
                    checked={documents.accepted_employee_handbook}
                    onChange={(event) => updateDocuments("accepted_employee_handbook", event.target.checked)}
                    style={{ marginTop: 2 }}
                  />
                  <label htmlFor="employee-handbook-checkbox" style={{ fontSize: "0.88rem", lineHeight: 1.55, color: "#486076" }}>
                    I have read and agree to the{" "}
                    <Link href="/employee-handbook" target="_blank" rel="noopener noreferrer" style={{ color: "var(--blue-strong)", fontWeight: 700, textDecoration: "none" }}>
                      Employee Handbook
                    </Link>
                    .
                  </label>
                </div>
                {fieldErrors["documents.accepted_privacy_policy"] && (
                  <p style={{ margin: "-2px 0 0", color: "var(--danger)", fontSize: ".78rem", fontWeight: 600 }}>⚠ {fieldErrors["documents.accepted_privacy_policy"]}</p>
                )}
                {fieldErrors["documents.accepted_employee_handbook"] && (
                  <p style={{ margin: "-2px 0 0", color: "var(--danger)", fontSize: ".78rem", fontWeight: 600 }}>⚠ {fieldErrors["documents.accepted_employee_handbook"]}</p>
                )}
              </div>
            </div>
          ) : null}

          {step === "nda" ? ( // self-declaration step
            <div className={styles.formStack}>
              <div>
                <h2 className={styles.stepTitle}>Self Declaration</h2>
                <p className={styles.stepLead}>
                  Please confirm that all documents you
                  have submitted are true and correct by signing below.
                </p>
              </div>

              <div style={{ marginBottom: 24 }}>
                <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
                  I, <strong>{employee?.full_name || "—"}</strong>, declare that all documents provided during
                  this onboarding process (identity, educational, professional credentials, etc.) are genuine
                  and true to the best of my knowledge. I take full responsibility and oath to agree with this
                  declaration.
                </p>
              </div>

              <div>
                <AiField
                  wide
                  readOnly
                  label="Full legal name"
                  value={employee?.full_name || selfDeclName}
                  hint={`Must match: ${employee?.full_name || "your registered name"}`}
                  onChange={() => {}}
                  {...fieldProps("nda.full_legal_name", { required: true })}
                />
              </div>

              <div
                style={{ marginTop: 18 }}
                data-field-error={fieldErrors["nda.signature"] ? "true" : undefined}
              >
                <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                  <button
                    type="button"
                    className={
                      selfDeclSigMethod === "pad"
                        ? styles.btnPrimary
                        : styles.btnSecondary
                    }
                    onClick={() => {
                      setSelfDeclSigMethod("pad");
                      setSelfDeclSignature(null);
                    }}
                  >
                    Draw signature
                  </button>
                  <button
                    type="button"
                    className={
                      selfDeclSigMethod === "upload"
                        ? styles.btnPrimary
                        : styles.btnSecondary
                    }
                    onClick={() => {
                      setSelfDeclSigMethod("upload");
                      setSelfDeclSignature(null);
                    }}
                  >
                    Upload signature
                  </button>
                </div>

                {selfDeclSigMethod === "pad" ? (
                  <SignaturePad onChange={setSelfDeclSignature} />
                ) : (
                  <div style={{ display: "grid", gap: 6 }}>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: "var(--text-muted)",
                        textTransform: "uppercase",
                        letterSpacing: ".4px",
                      }}
                    >
                      Signature file (PNG, JPG, or PDF)
                    </span>
                    <FileUploadField
                      accept="image/png,image/jpeg,image/jpg,application/pdf"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (ev) =>
                          setSelfDeclSignature(ev.target.result);
                        reader.readAsDataURL(file);
                      }}
                    />
                  </div>
                )}

                {fieldErrors["nda.signature"] ? (
                  <em
                    style={{
                      fontStyle: "normal",
                      fontSize: 11.5,
                      fontWeight: 700,
                      color: "#b42318",
                      display: "block",
                      marginTop: 8,
                    }}
                  >
                    Signature required
                  </em>
                ) : null}
              </div>

              <div style={{ marginTop: 16 }}>
                <AiCheckRow
                  checked={selfDeclAgreed}
                  onChange={(event) => setSelfDeclAgreed(event.target.checked)}
                  error={fieldErrors["nda.agreed"]}
                >
                  I agree to the above declaration and take full responsibility for the accuracy of my
                  submitted documents.
                </AiCheckRow>
              </div>
            </div>
          ) : null}

          {step === "submit" ? (
            <div className={styles.formStack}>
              <div>
                <h2 className={styles.stepTitle}>Review &amp; finish</h2>
                <p className={styles.stepLead}>Confirm everything below, then submit to complete your profile.</p>
              </div>
              <div className={styles.reviewGrid}>
                <ReviewBlock
                  title="Emergency contact"
                  items={[
                    ["Name", emergency.name],
                    ["Relationship", emergency.relationship],
                    ["Contact", emergency.phone],
                    ["Alternate contact", emergency.alternate_phone],
                  ]}
                />
                {isRemote ? (
                  <ReviewBlock
                    title="Banking"
                    items={[
                      ["Bank", employment.bank_name],
                      ["Account title", employment.account_holder_name],
                      ["IBAN", employment.iban],
                      ["Branch", employment.branch],
                    ]}
                  />
                ) : (
                  <ReviewBlock
                    title="Banking"
                    items={[
                      [
                        "Status",
                        employment.bank_name
                          ? "Added by your recruiter (view on profile)"
                          : "Your recruiter will add payroll banking details",
                      ],
                    ]}
                  />
                )}
                <ReviewBlock
                  title="References"
                  items={references.map((reference, index) => [
                    `Reference ${index + 1}`,
                    `${reference.full_name || "—"}${reference.email ? ` · ${reference.email}` : ""}`,
                  ])}
                />
                <ReviewBlock
                  title="Policies & Self Declaration"
                  items={[
                    ["Signed by", employee?.full_name || selfDeclName || "—"],
                    [
                      "Policies",
                      documents.accepted_privacy_policy &&
                      documents.accepted_employee_handbook
                        ? "Acknowledged"
                        : "Incomplete",
                    ],
                    ["Self Declaration", selfDeclAgreed ? "Agreed" : "—"],
                  ]}
                />
              </div>
            </div>
          ) : null}

          <div className={styles.formFooter}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <button type="button" className={styles.btnSecondary} onClick={onExit}>
                Save &amp; exit
              </button>
              {AUTOSAVE_SECTIONS.includes(step) ? (
                <span className={styles.autoSaveHint}>
                  <IconCheck width={12} height={12} />
                  Saves automatically as you type
                </span>
              ) : null}
            </div>
            <button type="submit" className={styles.btnPrimary} disabled={saving}>
              {saving ? "Saving…" : step === "submit" ? "Finish profile" : "Save & continue"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function CompletedRecord({
  employee,
  isRemote,
  emergency,
  employment,
  references,
  documents,
  selfDeclName,
  selfDeclAgreed,
  onViewProfile,
  onDashboard,
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionHeadLeft}>
          <span className={`${styles.bar} ${styles.barGreen}`} />
          <div>
            <div className={styles.sectionTitle}>Onboarding completed</div>
            <div className={styles.sectionDesc}>
              All required post-hire steps are on file for {employee?.full_name}.
            </div>
          </div>
        </div>
      </div>
      <div className={styles.sectionBody}>
        <div className={styles.historyList}>
          <HistoryBlock title="Emergency contact">
            <HistoryRow label="Name" value={emergency.name} />
            <HistoryRow label="Relationship" value={emergency.relationship} />
            <HistoryRow label="Contact" value={emergency.phone} />
            <HistoryRow label="Alternate contact" value={emergency.alternate_phone} />
            <HistoryRow label="Address" value={emergency.address} />
          </HistoryBlock>

          {isRemote || employment?.bank_name ? (
            <HistoryBlock title="Banking">
              {employment?.bank_name ? (
                <>
                  <HistoryRow label="Bank" value={employment.bank_name} />
                  <HistoryRow label="Account title" value={employment.account_holder_name} />
                  <HistoryRow label="IBAN" value={employment.iban} />
                  <HistoryRow label="Branch" value={employment.branch} />
                </>
              ) : (
                <HistoryRow
                  label="Status"
                  value="Managed by your recruiter — check your profile when available"
                />
              )}
            </HistoryBlock>
          ) : null}

          <HistoryBlock title="References">
            {(references || []).map((reference, index) => (
              <div key={`${reference.email || reference.full_name}-${index}`} className={styles.historyRef}>
                <div className={styles.historyRefTitle}>Reference {index + 1}</div>
                <HistoryRow label="Name" value={reference.full_name} />
                <HistoryRow label="Relationship" value={reference.relationship} />
                <HistoryRow label="Email" value={reference.email} />
                <HistoryRow label="Contact" value={reference.phone} />
                <HistoryRow label="Company" value={reference.company} />
              </div>
            ))}
          </HistoryBlock>

          <HistoryBlock title="Policies">
            <HistoryRow label="Privacy policy" value={documents.accepted_privacy_policy ? "Accepted" : "—"} />
            <HistoryRow label="Employee handbook" value={documents.accepted_employee_handbook ? "Accepted" : "—"} />
          </HistoryBlock>

          <HistoryBlock title="Self Declaration">
            <HistoryRow label="Signed name" value={selfDeclName} />
            <HistoryRow label="Agreed" value={selfDeclAgreed ? "Yes" : "—"} />
          </HistoryBlock>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 24 }}>
          <button type="button" className={styles.btnSecondary} onClick={onViewProfile}>
            View my profile
          </button>
          <button type="button" className={styles.btnPrimary} onClick={onDashboard}>
            Go to my dashboard
          </button>
        </div>
      </div>
    </section>
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

function HistoryBlock({ title, children }) {
  return (
    <div className={styles.historyBlock}>
      <h3>{title}</h3>
      <dl className={styles.historyDl}>{children}</dl>
    </div>
  );
}

function HistoryRow({ label, value }) {
  return (
    <div className={styles.historyRow}>
      <dt>{label}</dt>
      <dd>{value || "—"}</dd>
    </div>
  );
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  clearLocalSession,
  clearOnboardingFile,
  getApiErrorMessage,
  getOnboarding,
  logout,
  saveOnboarding,
  uploadOnboardingFile,
} from "@/services/authService";
import { can, ROLE_HOME } from "@/services/rbac";
import Toast from "@/components/Toast";
import ConfirmDialog from "@/components/ConfirmDialog";
import ProfileAvatar from "@/components/ProfileAvatar";
import styles from "./onboarding.module.css";

const STEPS = [
  { id: "personal", label: "Personal" },
  { id: "education", label: "Education" },
  { id: "skills", label: "Skills" },
  { id: "submit", label: "Review" },
];

const MISSING_SECTION_LABELS = {
  personal: "personal information",
  government_docs: "National ID (CNIC / NIC)",
  education: "education and transcript",
  skills: "skills",
  resume: "Resume / CV",
};

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
    key: "documents",
    label: "Documents",
    href: "/documents",
    disabled: false,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" /><path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" />
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

const FILL_MODE_KEY = "onboarding_fill_mode";

function draftStorageKey() {
  try {
    const user = JSON.parse(localStorage.getItem("user") || "null");
    return user?.email ? `onboarding_personal_draft_${user.email}` : "onboarding_personal_draft";
  } catch {
    return "onboarding_personal_draft";
  }
}

function isPersonalIncomplete(personal) {
  if (!personal) return true;
  return !(
    personal.first_name &&
    personal.last_name &&
    personal.date_of_birth &&
    personal.gender &&
    personal.nationality &&
    personal.marital_status &&
    personal.national_id &&
    personal.current_address &&
    (personal.same_as_current || personal.permanent_address) &&
    personal.city &&
    personal.state &&
    personal.postal_code &&
    personal.country
  );
}

const emptyPersonal = {
  first_name: "",
  last_name: "",
  date_of_birth: "",
  gender: "prefer_not_to_say",
  nationality: "Pakistani",
  marital_status: "single",
  blood_group: "unknown",
  national_id: "",
  father_name: "",
  id_issue_date: "",
  id_expiry_date: "",
  profile_picture: null,
  alternate_phone: "",
  current_address: "",
  permanent_address: "",
  same_as_current: false,
  city: "",
  state: "",
  postal_code: "",
  country: "Pakistan",
};
const emptyEducationEntry = {
  institution: "",
  board_university: "",
  degree: "",
  field_of_study: "",
  year_completed: "",
  cgpa_or_percentage: "",
  certificate_file: null,
};
const emptySkills = {
  technical_skills: "",
  soft_skills: "",
  languages: "",
  certifications: [{ name: "", document_url: null, expiry_date: "" }],
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
  const [uploadPhase, setUploadPhase] = useState("");
  const [message, setMessage] = useState("");
  const [candidate, setCandidate] = useState(null);
  const [onboarding, setOnboarding] = useState(null);
  const [progress, setProgress] = useState(null);
  const [step, setStep] = useState("personal");
  const [fillMode, setFillMode] = useState(null);
  const [personal, setPersonal] = useState(emptyPersonal);
  const [educationEntries, setEducationEntries] = useState([{ ...emptyEducationEntry }]);
  const [skills, setSkills] = useState(emptySkills);
  const [govDocs, setGovDocs] = useState([{ ...emptyGovDoc }]);
  const [resume, setResume] = useState(emptyResume);
  const [extractionPreview, setExtractionPreview] = useState(null);
  const [documentVerification, setDocumentVerification] = useState(null);
  const [autoFilledKeys, setAutoFilledKeys] = useState([]);
  const [fieldErrors, setFieldErrors] = useState({});
  const [toast, setToast] = useState(null);
  const [pendingReplace, setPendingReplace] = useState(null);
  const [scanPulse, setScanPulse] = useState(false);

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
        const storedMode = sessionStorage.getItem(FILL_MODE_KEY);
        if (storedMode === "ocr" || storedMode === "manual") {
          setFillMode(storedMode);
        } else if (isEditMode) {
          setFillMode("manual");
        }
        const data = await getOnboarding(accessToken);
        setCandidate(data.candidate);
        setOnboarding(data.onboarding);
        setProgress(data.progress);
        hydrateForms(data.onboarding);
        // Restore local draft if server personal is empty/partial after an OCR fill that wasn't fully saved.
        try {
          const draft = JSON.parse(localStorage.getItem(draftStorageKey()) || "null");
          if (draft?.personal && isPersonalIncomplete(data.onboarding?.personal)) {
            setPersonal((prev) => ({ ...prev, ...draft.personal }));
            if (draft.govDocs?.length) setGovDocs(draft.govDocs);
          }
        } catch {
          /* ignore draft parse errors */
        }
        const stepAliases = {
          government_docs: "personal",
          resume: "skills",
          complete: isEditMode ? "personal" : "submit",
        };
        const requestedVisibleStep = stepAliases[requestedStep] || requestedStep;
        const allowedSteps = new Set(STEPS.map((item) => item.id));
        const deepLinkStep =
          requestedVisibleStep && allowedSteps.has(requestedVisibleStep) ? requestedVisibleStep : null;
        const storedStep = stepAliases[data.onboarding?.current_step] || data.onboarding?.current_step;
        let nextStep =
          data.onboarding?.status === "submitted" && !isEditMode
            ? "submit"
            : deepLinkStep || storedStep || "personal";
        // Keep user on personal until that section is actually complete.
        if (
          data.onboarding?.status !== "submitted" &&
          isPersonalIncomplete(data.onboarding?.personal) &&
          !deepLinkStep
        ) {
          nextStep = "personal";
        }
        setStep(nextStep);
      } catch (error) {
        setMessage(getApiErrorMessage(error, "Unable to load onboarding."));
      } finally {
        setLoading(false);
      }
    });
  }, [isEditMode, router, requestedStep]);

  function hydrateForms(data) {
    if (!data) return;
    if (data.personal) {
      const p = data.personal;
      setPersonal({
        ...emptyPersonal,
        ...p,
        current_address: p.current_address || p.address_line1 || "",
        permanent_address: p.permanent_address || p.address_line2 || p.current_address || p.address_line1 || "",
        first_name: p.first_name || "",
        last_name: p.last_name || "",
      });
    }
    if (data.education?.entries?.length) setEducationEntries(data.education.entries);
    if (data.skills) {
      setSkills({
        technical_skills: (data.skills.technical_skills || []).join(", "),
        soft_skills: (data.skills.soft_skills || []).join(", "),
        languages: (data.skills.languages || []).join(", "),
        certifications: data.skills.certifications?.length
          ? data.skills.certifications.map((c) => ({
              name: c.name || "",
              document_url: c.document_url || null,
              expiry_date: c.expiry_date || "",
            }))
          : [{ name: "", document_url: null, expiry_date: "" }],
      });
    }
    if (data.government_docs?.documents?.length) {
      setGovDocs(
        data.government_docs.documents.map((d) => ({
          ...d,
          doc_type: "cnic",
        }))
      );
    }
    if (data.resume) setResume({ ...emptyResume, ...data.resume });
  }

  function splitTags(value) {
    return String(value || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function normalizeGender(value) {
    if (!value) return null;
    const v = String(value).trim().toLowerCase();
    if (["male", "m"].includes(v)) return "male";
    if (["female", "f"].includes(v)) return "female";
    if (["other"].includes(v)) return "other";
    return null;
  }

  function normalizeMarital(value) {
    if (!value) return null;
    const v = String(value).trim().toLowerCase();
    if (["single", "unmarried"].includes(v)) return "single";
    if (["married"].includes(v)) return "married";
    if (["divorced"].includes(v)) return "divorced";
    if (["widowed", "widow", "widower"].includes(v)) return "widowed";
    return null;
  }

  function joinList(value) {
    if (Array.isArray(value)) return value.filter(Boolean).join(", ");
    return value || "";
  }

  function normalizeDateForInput(value) {
    if (!value) return "";
    const text = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const match = text.match(/^(\d{1,2})[\/\-. ](\d{1,2})[\/\-. ](\d{4})$/);
    if (!match) return "";
    const [, day, month, year] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  function applyCnicOcrFill(ocrResult, index = 0, fileMeta = null) {
    if (!ocrResult || ocrResult.status !== "completed" || ocrResult.accepted === false) return;
    const fields = ocrResult.fields || {};
    const first = fields.first_name || (fields.name || fields.full_name || "").toString().split(/\s+/)[0] || "";
    const last =
      fields.last_name ||
      (fields.name || fields.full_name || "")
        .toString()
        .split(/\s+/)
        .slice(1)
        .join(" ") ||
      "";
    const idNumber = fields.cnic_number;
    const dateOfBirth = normalizeDateForInput(fields.date_of_birth);
    const gender = normalizeGender(fields.gender);
    const marital = normalizeMarital(fields.marital_status);
    const issueDate =
      normalizeDateForInput(fields.issue_date || fields.id_issue_date || "") || fields.issue_date || "";
    const expiryDate =
      normalizeDateForInput(fields.expiry_date || fields.id_expiry_date || "") || fields.expiry_date || "";

    const nextPersonal = {
      ...personal,
      first_name: first || "",
      last_name: last || "",
      date_of_birth: dateOfBirth || "",
      gender: gender || personal.gender || "prefer_not_to_say",
      nationality: fields.nationality || personal.nationality || "Pakistani",
      marital_status: marital || personal.marital_status || "single",
      national_id: idNumber || "",
      father_name: fields.father_name || "",
      id_issue_date: issueDate || "",
      id_expiry_date: expiryDate || "",
    };

    const nextGovDocs = [...govDocs];
    nextGovDocs[index] = {
      ...nextGovDocs[index],
      ...(fileMeta || {}),
      doc_type: "cnic",
      document_number: idNumber || nextGovDocs[index]?.document_number || "",
      file_name: fileMeta?.file_name || nextGovDocs[index]?.file_name || null,
      file_url: fileMeta?.file_url || nextGovDocs[index]?.file_url || null,
    };

    setPersonal(nextPersonal);
    setGovDocs(nextGovDocs);
    setScanPulse(false);
    setFieldErrors({});

    const immediateFilled = [];
    if (first) immediateFilled.push("first_name");
    if (last) immediateFilled.push("last_name");
    if (dateOfBirth) immediateFilled.push("date_of_birth");
    if (gender) immediateFilled.push("gender");
    if (fields.nationality) immediateFilled.push("nationality");
    if (marital) immediateFilled.push("marital_status");
    if (idNumber) immediateFilled.push("national_id", "document_number");
    if (fields.father_name) immediateFilled.push("father_name");
    if (issueDate) immediateFilled.push("id_issue_date");
    if (expiryDate) immediateFilled.push("id_expiry_date");
    setAutoFilledKeys(immediateFilled);
    void savePersonalDraft(nextPersonal, nextGovDocs);
  }

  function autoFillFromOCR(ocrResult, purpose, index) {
    if (!ocrResult || ocrResult.status !== "completed" || ocrResult.accepted === false) return;
    const { category, fields } = ocrResult;
    if (!fields) return;
    const filled = [];

    if (purpose === "government_doc" && category === "cnic") {
      // Legacy path — prefer applyCnicOcrFill from upload handler.
      return applyCnicOcrFill(ocrResult, index);
    } else if (purpose === "resume" && category === "resume") {
      const first = fields.first_name || (fields.full_name || "").toString().split(/\s+/)[0] || "";
      const last =
        fields.last_name ||
        (fields.full_name || "")
          .toString()
          .split(/\s+/)
          .slice(1)
          .join(" ") ||
        "";

      setPersonal((prev) => {
        const next = { ...prev };
        if (first && !prev.first_name) {
          next.first_name = first;
          filled.push("first_name");
        }
        if (last && !prev.last_name) {
          next.last_name = last;
          filled.push("last_name");
        }
        if (fields.address && !prev.current_address) {
          next.current_address = fields.address;
          filled.push("current_address");
        }
        const dateOfBirth = normalizeDateForInput(fields.date_of_birth);
        if (dateOfBirth && !prev.date_of_birth) {
          next.date_of_birth = dateOfBirth;
          filled.push("date_of_birth");
        }
        return next;
      });

      const summary =
        fields.professional_summary ||
        [
          fields.full_name ? `Name: ${fields.full_name}` : "",
          fields.email ? `Email: ${fields.email}` : "",
          fields.phone_number ? `Phone: ${fields.phone_number}` : "",
          fields.linkedin ? `LinkedIn: ${fields.linkedin}` : "",
          fields.github ? `GitHub: ${fields.github}` : "",
          fields.portfolio ? `Portfolio: ${fields.portfolio}` : "",
        ]
          .filter(Boolean)
          .join(" | ");

      if (summary) {
        setResume((prev) => ({ ...prev, summary: prev.summary || summary }));
        filled.push("summary");
      }

      setSkills((prev) => {
        const tech = joinList(fields.technical_skills || fields.skills);
        const soft = joinList(fields.soft_skills);
        const langs = joinList(fields.languages);
        const certs = Array.isArray(fields.certifications)
          ? fields.certifications.map((c) => (typeof c === "string" ? { name: c, document_url: null, expiry_date: "" } : { name: c?.name || "", document_url: null, expiry_date: "" }))
          : null;
        const next = { ...prev };
        if (tech && !prev.technical_skills) {
          next.technical_skills = tech;
          filled.push("technical_skills");
        }
        if (soft && !prev.soft_skills) {
          next.soft_skills = soft;
          filled.push("soft_skills");
        }
        if (langs && !prev.languages) {
          next.languages = langs;
          filled.push("languages");
        }
        if (certs?.length && (!prev.certifications?.[0]?.name)) {
          next.certifications = certs;
          filled.push("certifications");
        }
        return next;
      });

      if (Array.isArray(fields.education) && fields.education.length) {
        const mapped = fields.education.map((ed) => {
          if (typeof ed === "string") {
            return { ...emptyEducationEntry, institution: ed };
          }
          return {
            ...emptyEducationEntry,
            institution: ed.institute || ed.institution || "",
            degree: ed.degree || "",
            field_of_study: ed.major || ed.program || ed.field_of_study || "",
            year_completed: String(ed.year || ed.passing_year || "").slice(0, 4),
            cgpa_or_percentage: ed.cgpa || ed.gpa || ed.percentage || "",
          };
        });
        setEducationEntries((prev) => {
          const isEmpty = prev.length === 1 && !prev[0].institution && !prev[0].degree;
          if (isEmpty) {
            filled.push("education");
            return mapped;
          }
          return prev;
        });
      }
    } else if (purpose === "education_cert" && (category === "academic_transcript" || category === "certificate")) {
      setEducationEntries((prev) => {
        const next = [...prev];
        const cur = next[index] || { ...emptyEducationEntry };
        const yearRaw = fields.passing_year || fields.year || fields.issue_date || "";
        const year = String(yearRaw).match(/(19|20)\d{2}/)?.[0] || String(yearRaw).slice(0, 4);
        next[index] = {
          ...cur,
          institution: cur.institution || fields.institute || fields.institution || fields.university || "",
          board_university: cur.board_university || fields.board_university || fields.institute || fields.university || "",
          degree: cur.degree || fields.degree || fields.program || fields.qualification || "",
          field_of_study: cur.field_of_study || fields.major || fields.program || fields.field_of_study || "",
          year_completed: cur.year_completed || year || "",
          cgpa_or_percentage:
            cur.cgpa_or_percentage ||
            (fields.cgpa != null ? String(fields.cgpa) : "") ||
            (fields.gpa != null ? String(fields.gpa) : "") ||
            (fields.percentage != null ? String(fields.percentage) : "") ||
            "",
        };
        filled.push("education_transcript");
        return next;
      });
    }

    setAutoFilledKeys(filled);
  }

  const stepIndex = useMemo(() => steps.findIndex((item) => item.id === step), [step, steps]);
  const submitted = onboarding?.status === "submitted";
  const isOcrMode = fillMode === "ocr";
  const isManualMode = fillMode === "manual";
  const showModeChooser = !loading && !submitted && !isEditMode && !fillMode;

  // ── Per-step completion checks (drive the blue progress indicator) ──
  // A step should only be shown as "complete" once its own required fields
  // are actually filled — not merely because the user has navigated past it.
  function isPersonalComplete() {
    if (isPersonalIncomplete(personal)) return false;
    return govDocs.every((doc) => {
      const hasNumber = doc.document_number && doc.document_number !== "pending";
      if (isOcrMode) {
        return hasNumber && doc.file_url;
      }
      return hasNumber || personal.national_id;
    });
  }

  function isEducationComplete() {
    return (
      educationEntries.length > 0 &&
      educationEntries.every(
        (entry) => entry.institution && entry.degree && entry.field_of_study && entry.year_completed
      )
    );
  }

  function isSkillsComplete() {
    const technical_skills = splitTags(skills.technical_skills);
    const soft_skills = splitTags(skills.soft_skills);
    const languages = splitTags(skills.languages);
    const certifications = (skills.certifications || []).filter((c) => c.name && c.name.trim());
    const hasAnySkillData =
      technical_skills.length > 0 || soft_skills.length > 0 || languages.length > 0 || certifications.length > 0;
    const hasSummary = !!(resume.summary && resume.summary.length >= 20);
    return hasAnySkillData && hasSummary;
  }

  function isStepComplete(stepId) {
    if (stepId === "personal") return isPersonalComplete();
    if (stepId === "education") return isEducationComplete();
    if (stepId === "skills") return isSkillsComplete();
    return false;
  }

  function showToast(type, messageText) {
    setToast({ id: Date.now(), type, message: messageText });
  }

  function showFormError(messageText, errors = {}) {
    setFieldErrors(errors);
    setMessage(messageText);
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

  function clearIdentityForRescan(index = 0) {
    setScanPulse(true);
    setPersonal((prev) => ({
      ...prev,
      first_name: "",
      last_name: "",
      date_of_birth: "",
      national_id: "",
      father_name: "",
      id_issue_date: "",
      id_expiry_date: "",
      gender: "prefer_not_to_say",
    }));
    setGovDocs((prev) => {
      const next = [...prev];
      next[index] = { ...emptyGovDoc, doc_type: "cnic" };
      return next;
    });
    setAutoFilledKeys([]);
    setExtractionPreview(null);
    setFieldErrors({});
  }

  function writeLocalDraft(nextPersonal, nextGovDocs) {
    try {
      localStorage.setItem(
        draftStorageKey(),
        JSON.stringify({ personal: nextPersonal, govDocs: nextGovDocs, updatedAt: Date.now() })
      );
    } catch {
      /* ignore quota errors */
    }
  }

  async function savePersonalDraft(nextPersonal, nextGovDocs) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    writeLocalDraft(nextPersonal, nextGovDocs);
    const docsReady = nextGovDocs.every(
      (doc) => doc.file_url && doc.document_number && doc.document_number !== "pending"
    );
    if (!docsReady || !nextPersonal.first_name || !nextPersonal.national_id) {
      showToast("info", "NIC details filled. Complete the remaining fields, then Save & continue.");
      return;
    }
    // Backend rejects incomplete personal payloads (address/city/DOB required) — keep local draft only.
    if (isPersonalIncomplete(nextPersonal)) {
      showToast("info", "NIC details filled. Add your address fields, then Save & continue.");
      return;
    }
    try {
      const payload = {
        step: "personal",
        personal: {
          ...nextPersonal,
          permanent_address: nextPersonal.same_as_current
            ? nextPersonal.current_address
            : nextPersonal.permanent_address,
          alternate_phone: nextPersonal.alternate_phone || null,
          profile_picture: nextPersonal.profile_picture || null,
        },
        government_docs: {
          documents: nextGovDocs.map((doc) => ({ ...doc, doc_type: doc.doc_type || "cnic" })),
        },
      };
      const data = await saveOnboarding(payload, accessToken);
      setOnboarding(data.onboarding);
      setProgress(data.progress);
      setCandidate(data.candidate);
      setStep("personal");
      if (!isPersonalIncomplete(nextPersonal)) {
        localStorage.removeItem(draftStorageKey());
      }
      showToast("success", "NIC details saved. Finish any remaining fields, then continue.");
    } catch (err) {
      showToast(
        "info",
        getApiErrorMessage(err, "Details filled from NIC. Click Save & continue when the form is complete.")
      );
    }
  }

  function chooseFillMode(mode) {
    setFillMode(mode);
    sessionStorage.setItem(FILL_MODE_KEY, mode);
    setMessage("");
  }

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
      showToast("success", data.message || "Saved successfully.");
      if (payload.step === "submit") {
        setStep("submit");
      } else if (data.onboarding?.current_step) {
        const nextStep = data.onboarding.current_step;
        if (isEditMode && nextStep === "submit") {
          setStep(payload.step);
        } else {
          setStep(nextStep === "complete" ? "submit" : nextStep);
        }
      }
    } catch (error) {
      const err = getApiErrorMessage(error, "Could not save this step.");
      setMessage(err);
      showToast("error", err);
    } finally {
      setSaving(false);
    }
  }

  async function handleFileUpload(event, purpose, index = 0) {
    const file = event.target.files?.[0];
    if (!file) return;
    const existingUrl =
      purpose === "resume"
        ? resume.file_url
        : purpose === "government_doc"
          ? govDocs[index]?.file_url
          : purpose === "education_cert"
            ? educationEntries[index]?.certificate_file
            : null;
    if (existingUrl) {
      setPendingReplace({ file, purpose, index, input: event.target });
      return;
    }
    await runFileUpload(file, purpose, index, event.target);
  }

  async function handleFileRemove(purpose, index = 0) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setUploading(true);
    setUploadPhase("Removing document…");
    setMessage("Removing document…");
    try {
      const data = await clearOnboardingFile(purpose, accessToken, index);
      if (data.onboarding) {
        setOnboarding(data.onboarding);
        hydrateForms(data.onboarding);
      }
      if (purpose === "resume") {
        setResume((current) => ({ ...current, file_name: null, file_url: null }));
      } else if (purpose === "government_doc") {
        setGovDocs((current) => {
          const next = [...current];
          if (next[index]) {
            next[index] = {
              ...next[index],
              file_name: null,
              file_url: null,
              document_number: next[index].document_number === "pending" ? "pending" : next[index].document_number,
            };
          }
          return next;
        });
        clearIdentityForRescan(index);
      } else if (purpose === "education_cert") {
        setEducationEntries((current) => {
          const next = [...current];
          if (next[index]) next[index] = { ...next[index], certificate_file: null };
          return next;
        });
      }
      setExtractionPreview(null);
      setMessage("Document removed. You can upload a new file.");
      showToast("success", "Document removed.");
    } catch (error) {
      const err = getApiErrorMessage(error, "Could not remove document.");
      setMessage(err);
      showToast("error", err);
    } finally {
      setUploading(false);
      setUploadPhase("");
    }
  }

  async function runFileUpload(file, purpose, index = 0, inputEl = null) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;

    const willScan = purpose === "government_doc";
    const softOcr = purpose === "education_cert" || purpose === "resume";
    if (willScan) {
      clearIdentityForRescan(index);
    }

    setUploading(true);
    setUploadPhase(
      willScan
        ? "Clearing previous NIC details, then scanning with OCR…"
        : softOcr
          ? "Uploading document and extracting details when possible…"
          : "Uploading and saving your document…"
    );
    setMessage(willScan ? "Scanning document…" : "Uploading document…");
    setExtractionPreview(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("purpose", purpose);
      formData.append("index", String(index));
      if (purpose === "government_doc") {
        formData.append("doc_type", "cnic");
      }
      const data = await uploadOnboardingFile(formData, accessToken);
      setOnboarding(data.onboarding);

      const ocr = data.ocr_result;
      const willAutofillCnic =
        purpose === "government_doc" && ocr?.status === "completed" && ocr?.accepted !== false;
      const ocrHardRejected =
        purpose === "government_doc" && (ocr?.status === "rejected_type" || ocr?.accepted === false);

      if (data.onboarding && !willAutofillCnic) {
        hydrateForms(data.onboarding);
      }

      // Only National ID uploads block on wrong document type.
      if (ocrHardRejected) {
        setScanPulse(false);
        const err = ocr.rejection_message || data.message || "Document type rejected.";
        setMessage(err);
        setExtractionPreview(ocr);
        showToast("error", err);
        return;
      }

      if (purpose === "resume") {
        setResume((current) => ({ ...current, file_name: data.file_name, file_url: data.file_url }));
      } else if (purpose === "government_doc") {
        const fileMeta = { file_name: data.file_name, file_url: data.file_url, doc_type: "cnic" };
        if (willAutofillCnic) {
          applyCnicOcrFill(ocr, index, fileMeta);
          setExtractionPreview(ocr);
          setMessage(
            "National ID scanned successfully — fields were pre-filled and saved. Review and finish the remaining fields."
          );
          showToast("success", "NIC scanned and details filled.");
        } else {
          setGovDocs((current) => {
            const next = [...current];
            next[index] = {
              ...next[index],
              ...fileMeta,
              document_number: next[index].document_number || "pending",
            };
            return next;
          });
          setScanPulse(false);
          setMessage(ocr?.rejection_message || "Could not extract text — please fill the fields manually.");
          if (ocr) setExtractionPreview(ocr);
        }
        if (data.document_verification) setDocumentVerification(data.document_verification);
        return;
      } else if (purpose === "education_cert") {
        setEducationEntries((current) => {
          const next = [...current];
          next[index] = { ...next[index], certificate_file: data.file_url };
          return next;
        });
      }

      if (data.document_verification) {
        setDocumentVerification(data.document_verification);
      }

      if (ocr && ocr.status === "completed" && ocr.accepted !== false) {
        autoFillFromOCR(ocr, purpose, index);
        setExtractionPreview(ocr);
        setMessage("File uploaded and fields updated where available.");
        showToast("success", "Document uploaded.");
      } else if (ocr && softOcr) {
        if (ocr.fields && Object.keys(ocr.fields).length) {
          autoFillFromOCR({ ...ocr, accepted: true, status: "completed", category: ocr.category || "academic_transcript" }, purpose, index);
        }
        const failHint =
          ocr.rejection_message ||
          ocr.error ||
          "Could not auto-read every field — please enter any missing details manually.";
        setExtractionPreview(ocr.status === "completed" ? ocr : null);
        setMessage(ocr.status === "completed" ? "Document saved and details extracted where possible." : `Document saved. ${failHint}`);
        showToast(
          ocr.status === "completed" ? "success" : "info",
          ocr.status === "completed" ? "Document uploaded and scanned." : failHint
        );
      } else if (ocr) {
        setExtractionPreview(ocr);
        setMessage(ocr.rejection_message || "File uploaded. Fill fields manually if needed.");
      } else {
        setMessage("Document uploaded and saved.");
      }
    } catch (error) {
      setScanPulse(false);
      const err = getApiErrorMessage(error, "Upload failed.");
      setMessage(err);
      showToast("error", err);
    } finally {
      setUploading(false);
      setUploadPhase("");
      if (inputEl) inputEl.value = "";
    }
  }

  async function handleNext(event) {
    event.preventDefault();
    if (submitted && !isEditMode) return;

    if (step === "personal") {
      const errors = {};
      if (!personal.first_name) errors.first_name = true;
      if (!personal.last_name) errors.last_name = true;
      if (!personal.date_of_birth) errors.date_of_birth = true;
      if (!personal.gender) errors.gender = true;
      if (!personal.nationality) errors.nationality = true;
      if (!personal.marital_status) errors.marital_status = true;
      if (!personal.national_id) errors.national_id = true;
      if (!personal.current_address) errors.current_address = true;
      if (!personal.same_as_current && !personal.permanent_address) errors.permanent_address = true;
      if (!personal.city) errors.city = true;
      if (!personal.state) errors.state = true;
      if (!personal.postal_code) errors.postal_code = true;
      if (!personal.country) errors.country = true;

      const requiredOk = Object.keys(errors).length === 0;
      if (!requiredOk) {
        showFormError("Please complete all required personal & contact fields highlighted below.", errors);
        return;
      }
      const payload = {
        ...personal,
        permanent_address: personal.same_as_current ? personal.current_address : personal.permanent_address,
        alternate_phone: personal.alternate_phone || null,
        profile_picture: personal.profile_picture || null,
      };
      const validDocs = govDocs.every((doc) => {
        const hasNumber = doc.document_number && doc.document_number !== "pending";
        if (isOcrMode) {
          return hasNumber && doc.file_url;
        }
        return hasNumber || personal.national_id;
      });
      if (!validDocs) {
        showFormError(
          isOcrMode
            ? "Upload your National ID (CNIC) and confirm the document number before continuing."
            : "Enter your National ID / CNIC number (upload is optional) before continuing.",
          { document_number: true, national_id: true }
        );
        return;
      }
      const sanitizedDocs = govDocs.map((doc) => ({
        ...doc,
        doc_type: "cnic",
        document_number:
          doc.document_number && doc.document_number !== "pending"
            ? doc.document_number
            : personal.national_id || doc.document_number,
      }));
      setFieldErrors({});
      await persist({
        step: "personal",
        personal: payload,
        government_docs: { documents: sanitizedDocs },
      });
      localStorage.removeItem(draftStorageKey());
    } else if (step === "education") {
      const valid = educationEntries.every(
        (entry) =>
          entry.institution &&
          entry.degree &&
          entry.field_of_study &&
          entry.year_completed
      );
      if (!valid) {
        showFormError("Complete every education field. Transcript upload is optional.");
        return;
      }
      setFieldErrors({});
      await persist({ step: "education", education: { entries: educationEntries } });
    } else if (step === "skills") {
      const technical_skills = splitTags(skills.technical_skills);
      const soft_skills = splitTags(skills.soft_skills);
      const languages = splitTags(skills.languages);
      const certifications = (skills.certifications || [])
        .filter((c) => c.name && c.name.trim())
        .map((c) => ({
          name: c.name.trim(),
          document_url: c.document_url || null,
          expiry_date: c.expiry_date || null,
        }));
      if (!technical_skills.length && !soft_skills.length && !languages.length && !certifications.length) {
        showFormError("Add at least one skill, language, or certification.");
        return;
      }
      if (!resume.summary || resume.summary.length < 20) {
        showFormError("Add a professional summary (at least 20 characters).", { summary: true });
        return;
      }
      setFieldErrors({});
      await persist({
        step: "skills",
        skills: { technical_skills, soft_skills, languages, certifications },
        resume,
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

  const displayName = candidate?.full_name || "…";

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
            <ProfileAvatar name={displayName} size="sm" fallback="CA" />
            <div>
              <div className={styles.name}>{displayName}</div>
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

                <p className={styles.eyebrow}>
                  {step === "submit" ? "Review" : `Step ${stepIndex + 1} of 3`} · Candidate intake
                </p>
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
                ) : showModeChooser ? (
                  <div className={styles.modeChooser}>
                    <p className={styles.eyebrow}>Get started</p>
                    <h1>How would you like to fill your profile?</h1>
                    <p className={styles.lead}>
                      Choose once — you can always edit every field afterward. OCR only scans your National ID (CNIC)
                      to save time; other documents are stored without scanning.
                    </p>
                    <div className={styles.modeGrid}>
                      <button type="button" className={styles.modeCard} onClick={() => chooseFillMode("ocr")}>
                        <span className={styles.modeIcon} aria-hidden>
                          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8">
                            <path d="M4 7V5a1 1 0 0 1 1-1h2" /><path d="M20 7V5a1 1 0 0 0-1-1h-2" />
                            <path d="M4 17v2a1 1 0 0 0 1 1h2" /><path d="M20 17v2a1 1 0 0 1-1 1h-2" />
                            <rect x="7" y="8" width="10" height="8" rx="1" />
                          </svg>
                        </span>
                        <strong>Scan with OCR</strong>
                        <span>Upload your CNIC and we&apos;ll pre-fill personal details. Continue the rest of the form yourself.</span>
                      </button>
                      <button type="button" className={styles.modeCard} onClick={() => chooseFillMode("manual")}>
                        <span className={styles.modeIcon} aria-hidden>
                          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8">
                            <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                          </svg>
                        </span>
                        <strong>Fill manually</strong>
                        <span>Type your information step by step. You can still attach supporting files later without OCR.</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className={styles.modeBanner}>
                      <span>
                        {isOcrMode
                          ? "OCR mode — National ID scan pre-fills personal details"
                          : "Manual mode — enter details yourself"}
                      </span>
                      {!isEditMode && (
                        <button
                          type="button"
                          className={styles.modeSwitch}
                          onClick={() => {
                            sessionStorage.removeItem(FILL_MODE_KEY);
                            setFillMode(null);
                          }}
                        >
                          Change
                        </button>
                      )}
                    </div>
                    <ol className={styles.steps} aria-label="Onboarding progress">
                      {steps.filter((item) => item.id !== "submit").map((item, index) => {
                        const isCurrent = index === stepIndex;
                        const isComplete = isStepComplete(item.id);
                        const liClassName = [isComplete && !isCurrent ? styles.active : "", isCurrent ? styles.current : ""]
                          .filter(Boolean)
                          .join(" ");
                        return (
                          <li key={item.id} className={liClassName}>
                            <button
                              type="button"
                              disabled={submitted && !isEditMode}
                              onClick={() => {
                                setStep(item.id);
                                setExtractionPreview(null);
                                setMessage("");
                              }}
                            >
                              <span>
                                {isComplete && !isCurrent ? (
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                                    <path d="M20 6L9 17l-5-5" />
                                  </svg>
                                ) : (
                                  index + 1
                                )}
                              </span>
                              {item.label}
                              {isEditMode && isCurrent && " (editing)"}
                            </button>
                          </li>
                        );
                      })}
                    </ol>

                    {message && <p className={styles.formMessage} role="status">{message}</p>}

                    {documentVerification?.verification_status === "mismatch" && (
                      <p className={styles.formMessage} style={{ background: "#fff7ed", color: "#9a3412", border: "1px solid #fdba74" }} role="alert">
                        Some uploaded documents contain inconsistent information. Please review.
                        {(documentVerification.mismatches || []).length > 0 && (
                          <span style={{ display: "block", marginTop: 6, fontSize: ".9em" }}>
                            {(documentVerification.mismatches || []).map((m) => m.reason).join(" · ")}
                          </span>
                        )}
                      </p>
                    )}

            {extractionPreview && step === "personal" && (
              <ExtractionPreview result={extractionPreview} onDismiss={() => setExtractionPreview(null)} />
            )}
            {extractionPreview && step !== "personal" && extractionPreview.accepted !== false && extractionPreview.status === "completed" && (
              <ExtractionPreview result={extractionPreview} onDismiss={() => setExtractionPreview(null)} />
            )}

                    {autoFilledKeys.length > 0 && (
                      <p className={styles.docHelper} style={{ background: "#ecfdf5", color: "#166534", padding: "8px 10px", borderRadius: 6 }}>
                        AI auto-filled: {autoFilledKeys.map((key) => key.replace(/_/g, " ")).join(", ")}. All values remain editable.
                      </p>
                    )}

                    {progress?.missing_fields?.length > 0 && !submitted && (
                      <p className={styles.docHelper}>
                        Missing sections:{" "}
                        <strong>
                          {progress.missing_fields
                            .map((section) => MISSING_SECTION_LABELS[section] || section)
                            .join(", ")}
                        </strong>
                      </p>
                    )}

                    <form onSubmit={handleNext}>
                      {step === "personal" && (
                        <div className={styles.formStack}>
                          <h2 className={styles.stepTitle}>Personal &amp; contact information</h2>
                          <p className={styles.docHelper}>
                            {isOcrMode
                              ? "Upload your CNIC first. We clear previous NIC values, scan the new card, then fill matching fields. Details are saved so they stay after refresh."
                              : "Enter your personal details below. Attaching a CNIC is optional and stored without OCR."}
                          </p>

                          {govDocs.map((doc, index) => (
                            <section key={index} className={`${styles.sectionCard} ${scanPulse ? styles.sectionScanning : ""}`}>
                              <div className={styles.sectionCardHead}>
                                <div>
                                  <h3>National ID</h3>
                                  <p>CNIC / NIC only · PDF, JPG, or PNG</p>
                                </div>
                                {doc.file_url && <span className={styles.pillOk}>Uploaded</span>}
                              </div>
                              <div className={styles.formGrid}>
                                <label className={styles.field}>
                                  <span>Identity document</span>
                                  <input type="text" value="National ID (CNIC / NIC)" disabled readOnly />
                                </label>
                                <FileUploadField
                                  styles={styles}
                                  label={isOcrMode ? "Upload CNIC for OCR" : "Attach CNIC (optional)"}
                                  accept=".pdf,.jpg,.jpeg,.png"
                                  disabled={uploading}
                                  onChange={(e) => handleFileUpload(e, "government_doc", index)}
                                  onRemove={() => handleFileRemove("government_doc", index)}
                                  fileUrl={doc.file_url}
                                  fileName={doc.file_name}
                                  hint="PDF, JPG, or PNG"
                                />
                                <Field
                                  styles={styles}
                                  label="CNIC number"
                                  value={doc.document_number === "pending" ? "" : doc.document_number}
                                  error={fieldErrors.document_number}
                                  onChange={(e) => {
                                    const next = [...govDocs];
                                    next[index] = { ...next[index], doc_type: "cnic", document_number: e.target.value };
                                    setGovDocs(next);
                                    setFieldErrors((prev) => ({ ...prev, document_number: false }));
                                  }}
                                  wide
                                />
                              </div>
                            </section>
                          ))}

                          <section className={styles.sectionCard}>
                            <div className={styles.sectionCardHead}>
                              <div>
                                <h3>Legal name</h3>
                                <p>{isOcrMode ? "Filled from CNIC — edit if anything looks off" : "As on your national ID"}</p>
                              </div>
                            </div>
                            <div className={styles.nameRow}>
                              <Field
                                styles={styles}
                                label="First name"
                                value={personal.first_name}
                                error={fieldErrors.first_name}
                                onChange={(e) => {
                                  setPersonal({ ...personal, first_name: e.target.value });
                                  setFieldErrors((prev) => ({ ...prev, first_name: false }));
                                }}
                              />
                              <Field
                                styles={styles}
                                label="Last name"
                                value={personal.last_name}
                                error={fieldErrors.last_name}
                                onChange={(e) => {
                                  setPersonal({ ...personal, last_name: e.target.value });
                                  setFieldErrors((prev) => ({ ...prev, last_name: false }));
                                }}
                              />
                            </div>
                            <div className={styles.formGrid}>
                              <Field
                                styles={styles}
                                label="Father's name"
                                value={personal.father_name || ""}
                                onChange={(e) => setPersonal({ ...personal, father_name: e.target.value })}
                              />
                              <Field
                                styles={styles}
                                label="National ID / CNIC"
                                value={personal.national_id}
                                error={fieldErrors.national_id}
                                onChange={(e) => {
                                  setPersonal({ ...personal, national_id: e.target.value });
                                  setFieldErrors((prev) => ({ ...prev, national_id: false }));
                                }}
                              />
                            </div>
                          </section>

                          <section className={styles.sectionCard}>
                            <div className={styles.sectionCardHead}>
                              <div>
                                <h3>Personal details</h3>
                                <p>Demographics and ID validity dates</p>
                              </div>
                            </div>
                            <div className={styles.formGrid}>
                              <Field
                                styles={styles}
                                label="Date of birth"
                                type="date"
                                value={personal.date_of_birth}
                                error={fieldErrors.date_of_birth}
                                onChange={(e) => {
                                  setPersonal({ ...personal, date_of_birth: e.target.value });
                                  setFieldErrors((prev) => ({ ...prev, date_of_birth: false }));
                                }}
                              />
                              <label className={`${styles.field} ${fieldErrors.gender ? styles.fieldError : ""}`} data-field-error={fieldErrors.gender ? "true" : undefined}>
                                <span>Gender</span>
                                <select value={personal.gender} onChange={(e) => { setPersonal({ ...personal, gender: e.target.value }); setFieldErrors((prev) => ({ ...prev, gender: false })); }}>
                                  <option value="male">Male</option>
                                  <option value="female">Female</option>
                                  <option value="other">Other</option>
                                  <option value="prefer_not_to_say">Prefer not to say</option>
                                </select>
                              </label>
                              <Field styles={styles} label="Nationality" value={personal.nationality} error={fieldErrors.nationality} onChange={(e) => { setPersonal({ ...personal, nationality: e.target.value }); setFieldErrors((prev) => ({ ...prev, nationality: false })); }} />
                              <label className={styles.field}>
                                <span>Marital status</span>
                                <select value={personal.marital_status} onChange={(e) => setPersonal({ ...personal, marital_status: e.target.value })}>
                                  <option value="single">Single</option>
                                  <option value="married">Married</option>
                                  <option value="divorced">Divorced</option>
                                  <option value="widowed">Widowed</option>
                                  <option value="other">Other</option>
                                </select>
                              </label>
                              <label className={styles.field}>
                                <span>Blood group</span>
                                <select value={personal.blood_group} onChange={(e) => setPersonal({ ...personal, blood_group: e.target.value })}>
                                  {["unknown", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((g) => (
                                    <option key={g} value={g}>{g}</option>
                                  ))}
                                </select>
                              </label>
                              <Field styles={styles} label="Alternate phone" value={personal.alternate_phone} onChange={(e) => setPersonal({ ...personal, alternate_phone: e.target.value })} />
                              <Field styles={styles} label="ID issue date" value={personal.id_issue_date || ""} onChange={(e) => setPersonal({ ...personal, id_issue_date: e.target.value })} />
                              <Field styles={styles} label="ID expiry date" value={personal.id_expiry_date || ""} onChange={(e) => setPersonal({ ...personal, id_expiry_date: e.target.value })} />
                            </div>
                          </section>

                          <section className={styles.sectionCard}>
                            <div className={styles.sectionCardHead}>
                              <div>
                                <h3>Address</h3>
                                <p>Current residence and mailing details</p>
                              </div>
                            </div>
                            <div className={styles.formGrid}>
                              <Field
                                styles={styles}
                                label="Current address"
                                value={personal.current_address}
                                error={fieldErrors.current_address}
                                onChange={(e) => {
                                  setPersonal({ ...personal, current_address: e.target.value });
                                  setFieldErrors((prev) => ({ ...prev, current_address: false }));
                                }}
                                wide
                              />
                              <label className={`${styles.field} ${styles.wide} ${styles.checkRow}`}>
                                <input
                                  type="checkbox"
                                  checked={!!personal.same_as_current}
                                  onChange={(e) => setPersonal({ ...personal, same_as_current: e.target.checked, permanent_address: e.target.checked ? personal.current_address : personal.permanent_address })}
                                />
                                <span>Permanent address same as current</span>
                              </label>
                              {!personal.same_as_current && (
                                <Field
                                  styles={styles}
                                  label="Permanent address"
                                  value={personal.permanent_address}
                                  error={fieldErrors.permanent_address}
                                  onChange={(e) => {
                                    setPersonal({ ...personal, permanent_address: e.target.value });
                                    setFieldErrors((prev) => ({ ...prev, permanent_address: false }));
                                  }}
                                  wide
                                />
                              )}
                              <Field styles={styles} label="City" value={personal.city} error={fieldErrors.city} onChange={(e) => { setPersonal({ ...personal, city: e.target.value }); setFieldErrors((prev) => ({ ...prev, city: false })); }} />
                              <Field styles={styles} label="State / Province" value={personal.state} error={fieldErrors.state} onChange={(e) => { setPersonal({ ...personal, state: e.target.value }); setFieldErrors((prev) => ({ ...prev, state: false })); }} />
                              <Field styles={styles} label="Postal code" value={personal.postal_code} error={fieldErrors.postal_code} onChange={(e) => { setPersonal({ ...personal, postal_code: e.target.value }); setFieldErrors((prev) => ({ ...prev, postal_code: false })); }} />
                              <Field styles={styles} label="Country" value={personal.country} error={fieldErrors.country} onChange={(e) => { setPersonal({ ...personal, country: e.target.value }); setFieldErrors((prev) => ({ ...prev, country: false })); }} />
                            </div>
                          </section>
                        </div>
                      )}

                      {step === "education" && (
                        <div className={styles.formStack}>
                          <h2 className={styles.stepTitle}>Education history</h2>
                          <p className={styles.docHelper}>
                            Enter each qualification below. Transcripts and degree certificates are optional —
                            when uploaded, AI will try to pre-fill fields; you can always edit them.
                          </p>
                          {educationEntries.map((entry, index) => (
                            <section key={index} className={styles.sectionCard}>
                              <div className={styles.sectionCardHead}>
                                <div>
                                  <h3>Education {educationEntries.length > 1 ? `#${index + 1}` : "entry"}</h3>
                                  <p>Institution, degree, and optional transcript</p>
                                </div>
                                {entry.certificate_file && <span className={styles.pillOk}>Transcript uploaded</span>}
                              </div>
                              <div className={styles.formGrid}>
                                <FileUploadField
                                  styles={styles}
                                  label="Academic transcript / certificate (optional)"
                                  accept=".pdf,.jpg,.jpeg,.png"
                                  disabled={uploading}
                                  onChange={(e) => handleFileUpload(e, "education_cert", index)}
                                  onRemove={() => handleFileRemove("education_cert", index)}
                                  fileUrl={entry.certificate_file}
                                  hint="PDF, JPG, or PNG"
                                  wide
                                />
                                <Field styles={styles} label="Institution" value={entry.institution} onChange={(e) => {
                                  const next = [...educationEntries];
                                  next[index] = { ...next[index], institution: e.target.value };
                                  setEducationEntries(next);
                                }} />
                                <Field styles={styles} label="Board / University" value={entry.board_university || ""} onChange={(e) => {
                                  const next = [...educationEntries];
                                  next[index] = { ...next[index], board_university: e.target.value };
                                  setEducationEntries(next);
                                }} />
                                <Field styles={styles} label="Degree" value={entry.degree} onChange={(e) => {
                                  const next = [...educationEntries];
                                  next[index] = { ...next[index], degree: e.target.value };
                                  setEducationEntries(next);
                                }} />
                                <Field styles={styles} label="Major / Field of study" value={entry.field_of_study} onChange={(e) => {
                                  const next = [...educationEntries];
                                  next[index] = { ...next[index], field_of_study: e.target.value };
                                  setEducationEntries(next);
                                }} />
                                <Field styles={styles} label="Year completed" value={entry.year_completed} onChange={(e) => {
                                  const next = [...educationEntries];
                                  next[index] = { ...next[index], year_completed: e.target.value };
                                  setEducationEntries(next);
                                }} />
                                <Field styles={styles} label="CGPA / Percentage" value={entry.cgpa_or_percentage || ""} onChange={(e) => {
                                  const next = [...educationEntries];
                                  next[index] = { ...next[index], cgpa_or_percentage: e.target.value };
                                  setEducationEntries(next);
                                }} />
                              </div>
                              {educationEntries.length > 1 && (
                                <div className={styles.entryActions}>
                                  <button
                                    type="button"
                                    className={styles.secondaryButton}
                                    onClick={() => setEducationEntries((c) => c.filter((_, i) => i !== index))}
                                  >
                                    Remove entry
                                  </button>
                                </div>
                              )}
                            </section>
                          ))}
                          <div className={styles.sectionFooter}>
                            <button type="button" className={styles.secondaryButton} onClick={() => setEducationEntries((c) => [...c, { ...emptyEducationEntry }])}>
                              Add another education entry
                            </button>
                          </div>
                        </div>
                      )}

                      {step === "skills" && (
                        <div className={styles.formStack}>
                          <h2 className={styles.stepTitle}>Skills &amp; certifications</h2>
                          <p className={styles.docHelper}>
                            Summarize your experience and skills. Attach a resume if you have one — it is stored for recruiters without OCR.
                          </p>

                          <section className={styles.sectionCard}>
                            <div className={styles.sectionCardHead}>
                              <div>
                                <h3>Resume &amp; summary</h3>
                                <p>Optional CV file plus a short professional overview</p>
                              </div>
                              {resume.file_url && <span className={styles.pillOk}>Resume uploaded</span>}
                            </div>
                            <div className={styles.formGrid}>
                              <FileUploadField
                                styles={styles}
                                label="Resume / CV (optional)"
                                accept=".pdf,.doc,.docx"
                                disabled={uploading}
                                onChange={(e) => handleFileUpload(e, "resume")}
                                onRemove={() => handleFileRemove("resume")}
                                fileUrl={resume.file_url}
                                fileName={resume.file_name}
                                hint="PDF, DOC, or DOCX"
                                wide
                              />
                              <label className={`${styles.field} ${styles.wide}`}>
                                <span>Professional summary</span>
                                <textarea
                                  rows={4}
                                  value={resume.summary}
                                  onChange={(e) => setResume({ ...resume, summary: e.target.value })}
                                  className={styles.resumeTextarea}
                                  placeholder="A few sentences about your background and strengths…"
                                />
                              </label>
                            </div>
                          </section>

                          <section className={styles.sectionCard}>
                            <div className={styles.sectionCardHead}>
                              <div>
                                <h3>Skills</h3>
                                <p>Separate items with commas</p>
                              </div>
                            </div>
                            <div className={styles.formGrid}>
                              <Field styles={styles} label="Technical skills" value={skills.technical_skills} onChange={(e) => setSkills({ ...skills, technical_skills: e.target.value })} wide />
                              <Field styles={styles} label="Soft skills" value={skills.soft_skills} onChange={(e) => setSkills({ ...skills, soft_skills: e.target.value })} wide />
                              <Field styles={styles} label="Languages" value={skills.languages} onChange={(e) => setSkills({ ...skills, languages: e.target.value })} wide />
                            </div>
                          </section>

                          <section className={styles.sectionCard}>
                            <div className={styles.sectionCardHead}>
                              <div>
                                <h3>Certifications</h3>
                                <p>Optional professional credentials</p>
                              </div>
                            </div>
                            {(skills.certifications || []).map((cert, index) => (
                              <div key={index} className={styles.formGrid} style={{ marginBottom: index < (skills.certifications || []).length - 1 ? 12 : 0 }}>
                                <Field styles={styles} label="Certification name" value={cert.name} onChange={(e) => {
                                  const next = [...skills.certifications];
                                  next[index] = { ...next[index], name: e.target.value };
                                  setSkills({ ...skills, certifications: next });
                                }} />
                                <Field styles={styles} label="Expiry date" type="date" value={cert.expiry_date || ""} onChange={(e) => {
                                  const next = [...skills.certifications];
                                  next[index] = { ...next[index], expiry_date: e.target.value };
                                  setSkills({ ...skills, certifications: next });
                                }} />
                                {(skills.certifications || []).length > 1 && (
                                  <div className={`${styles.entryActions} ${styles.wide}`}>
                                    <button
                                      type="button"
                                      className={styles.secondaryButton}
                                      onClick={() => setSkills({ ...skills, certifications: skills.certifications.filter((_, i) => i !== index) })}
                                    >
                                      Remove certification
                                    </button>
                                  </div>
                                )}
                              </div>
                            ))}
                            <div className={styles.sectionFooter}>
                              <button
                                type="button"
                                className={styles.secondaryButton}
                                onClick={() => setSkills({ ...skills, certifications: [...(skills.certifications || []), { name: "", document_url: null, expiry_date: "" }] })}
                              >
                                Add certification
                              </button>
                            </div>
                          </section>
                        </div>
                      )}

                      {step === "submit" && !isEditMode && (
                        <div className={styles.formStack}>
                          <h2 className={styles.stepTitle}>Review &amp; submit</h2>
                          <p className={styles.reviewIntro}>
                            Confirm every section looks right. Your recruiter reviews this next and sends your offer letter.
                          </p>
                          <div className={styles.reviewStack}>
                            <ReviewSection
                              styles={styles}
                              title="Personal & contact"
                              subtitle="Identity and address details"
                              rows={[
                                ["Full name", [personal.first_name, personal.last_name].filter(Boolean).join(" ")],
                                ["Father's name", personal.father_name],
                                ["Date of birth", personal.date_of_birth],
                                ["Gender", formatReviewValue(personal.gender)],
                                ["Nationality", personal.nationality],
                                ["Marital status", formatReviewValue(personal.marital_status)],
                                ["Blood group", personal.blood_group === "unknown" ? "" : personal.blood_group],
                                ["National ID / CNIC", personal.national_id],
                                ["Alternate phone", personal.alternate_phone],
                                ["ID issue date", personal.id_issue_date],
                                ["ID expiry date", personal.id_expiry_date],
                                ["Current address", personal.current_address, true],
                                ["Permanent address", personal.same_as_current ? "Same as current" : personal.permanent_address, true],
                                ["City", personal.city],
                                ["State / Province", personal.state],
                                ["Postal code", personal.postal_code],
                                ["Country", personal.country],
                              ]}
                            />

                            <ReviewSection
                              styles={styles}
                              title="National ID"
                              subtitle="Uploaded identity document"
                              rows={[
                                ...govDocs.map((doc, i) => [
                                  govDocs.length > 1 ? `Document ${i + 1}` : "CNIC / NIC",
                                  doc.document_number && doc.document_number !== "pending" ? doc.document_number : "—",
                                ]),
                                ...govDocs.map((doc, i) => [
                                  govDocs.length > 1 ? `File ${i + 1}` : "Uploaded file",
                                  doc.file_url ? (doc.file_name || fileDisplayName(doc.file_url)) : "Not uploaded",
                                ]),
                              ]}
                            />

                            <section className={styles.reviewBlock}>
                              <div className={styles.reviewBlockHead}>
                                <div>
                                  <h3>Education</h3>
                                  <p>
                                    {educationEntries.length} {educationEntries.length === 1 ? "entry" : "entries"}
                                  </p>
                                </div>
                              </div>
                              <div className={styles.reviewEduList}>
                                {educationEntries.map((entry, index) => (
                                  <div key={index} className={styles.reviewEduItem}>
                                    <strong>
                                      {entry.degree || "Degree"}
                                      {entry.institution ? ` · ${entry.institution}` : ""}
                                    </strong>
                                    <dl className={styles.reviewGrid}>
                                      <ReviewRow styles={styles} label="Board / University" value={entry.board_university} />
                                      <ReviewRow styles={styles} label="Field of study" value={entry.field_of_study} />
                                      <ReviewRow styles={styles} label="Year completed" value={entry.year_completed} />
                                      <ReviewRow styles={styles} label="CGPA / %" value={entry.cgpa_or_percentage} />
                                      <ReviewRow
                                        styles={styles}
                                        label="Transcript"
                                        value={entry.certificate_file ? fileDisplayName(entry.certificate_file) : "Not uploaded"}
                                        wide
                                      />
                                    </dl>
                                  </div>
                                ))}
                              </div>
                            </section>

                            <ReviewSection
                              styles={styles}
                              title="Skills & resume"
                              subtitle="Professional profile"
                              rows={[
                                ["Technical skills", skills.technical_skills, true],
                                ["Soft skills", skills.soft_skills, true],
                                ["Languages", skills.languages, true],
                                [
                                  "Certifications",
                                  (skills.certifications || [])
                                    .filter((c) => c.name)
                                    .map((c) => (c.expiry_date ? `${c.name} (exp. ${c.expiry_date})` : c.name))
                                    .join(", ") || "—",
                                  true,
                                ],
                                ["Resume file", resume.file_name || (resume.file_url ? fileDisplayName(resume.file_url) : "Not uploaded")],
                              ]}
                            >
                              {resume.summary ? (
                                <div className={`${styles.reviewRow} ${styles.reviewRowWide}`}>
                                  <dt>Professional summary</dt>
                                  <dd>
                                    <p className={styles.reviewSummary}>{resume.summary}</p>
                                  </dd>
                                </div>
                              ) : null}
                            </ReviewSection>
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

      {uploading && (
        <div className={styles.processOverlay} role="status" aria-live="polite">
          <div className={styles.processCard}>
            <div className={styles.processSpinner} aria-hidden />
            <strong>
              {uploadPhase.includes("OCR") || uploadPhase.includes("Scanning") || uploadPhase.includes("Clearing")
                ? "Scanning National ID"
                : "Uploading document"}
            </strong>
            <p>{uploadPhase || "Please wait…"}</p>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingReplace}
        title="Replace this document?"
        message={
          pendingReplace?.purpose === "government_doc"
            ? "Previous NIC values will be cleared first, then the new document will be scanned and the form will be refilled."
            : pendingReplace?.purpose === "education_cert"
              ? "The current transcript will be replaced with the new file. Extracted education fields stay editable."
              : "The current resume will be replaced with the new file."
        }
        confirmLabel={pendingReplace?.purpose === "government_doc" ? "Replace & scan" : "Replace file"}
        cancelLabel="Cancel"
        danger
        onCancel={() => {
          if (pendingReplace?.input) pendingReplace.input.value = "";
          setPendingReplace(null);
        }}
        onConfirm={async () => {
          const job = pendingReplace;
          setPendingReplace(null);
          if (!job) return;
          await runFileUpload(job.file, job.purpose, job.index, job.input);
        }}
      />

      <Toast toast={toast} onDismiss={() => setToast(null)} />
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

function fileDisplayName(urlOrName) {
  if (!urlOrName) return "";
  try {
    const raw = String(urlOrName);
    const path = raw.includes("://") ? new URL(raw).pathname : raw;
    const base = path.split("/").filter(Boolean).pop() || raw;
    return decodeURIComponent(base.split("?")[0]);
  } catch {
    const parts = String(urlOrName).split("/");
    return parts[parts.length - 1] || String(urlOrName);
  }
}

function formatReviewValue(value) {
  if (value == null || value === "") return "";
  return String(value).replace(/_/g, " ");
}

function FileUploadField({ styles, label, accept, disabled, onChange, onRemove, fileUrl, fileName, hint, wide }) {
  const display = fileName || fileDisplayName(fileUrl);
  const isLink = typeof fileUrl === "string" && (fileUrl.startsWith("http") || fileUrl.startsWith("/"));

  return (
    <div className={`${styles.field} ${wide ? styles.wide : ""}`}>
      {label ? <span>{label}</span> : null}
      <div className={styles.fileUpload}>
        <label className={`${styles.fileUploadBtn} ${disabled ? styles.fileUploadBtnDisabled : ""}`}>
          <input
            type="file"
            accept={accept}
            disabled={disabled}
            onChange={onChange}
            className={styles.fileUploadInput}
          />
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          {fileUrl ? "Replace file" : "Choose file"}
        </label>
        {fileUrl ? (
          isLink ? (
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.fileChip}
              title={display}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
              </svg>
              <span className={styles.fileChipName}>{display || "Uploaded document"}</span>
            </a>
          ) : (
            <span className={styles.fileChip} title={display}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
              </svg>
              <span className={styles.fileChipName}>{display || "Uploaded document"}</span>
            </span>
          )
        ) : (
          <span className={styles.fileUploadHint}>{hint || "No file selected"}</span>
        )}
        {fileUrl && onRemove ? (
          <button
            type="button"
            className={styles.fileRemoveBtn}
            disabled={disabled}
            onClick={onRemove}
          >
            Remove
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Field({ label, name, value, onChange, type = "text", wide, styles, error, hint }) {
  return (
    <label
      className={`${styles.field} ${wide ? styles.wide : ""} ${error ? styles.fieldError : ""}`}
      data-field-error={error ? "true" : undefined}
    >
      <span>{label}</span>
      <input name={name} type={type} value={value} onChange={onChange} aria-invalid={!!error} />
      {error && <em className={styles.fieldErrorText}>Required</em>}
      {!error && hint ? <small>{hint}</small> : null}
    </label>
  );
}

function ReviewRow({ styles, label, value, wide }) {
  return (
    <div className={`${styles.reviewRow} ${wide ? styles.reviewRowWide : ""}`}>
      <dt>{label}</dt>
      <dd>{value || "—"}</dd>
    </div>
  );
}

function ReviewSection({ styles, title, subtitle, rows, children }) {
  const visible = (rows || []).filter(([, value]) => value != null && value !== "");
  return (
    <section className={styles.reviewBlock}>
      <div className={styles.reviewBlockHead}>
        <div>
          <h3>{title}</h3>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>
      <dl className={styles.reviewGrid}>
        {visible.map(([label, value, wide]) => (
          <ReviewRow key={label} styles={styles} label={label} value={value} wide={wide} />
        ))}
        {children}
      </dl>
    </section>
  );
}

// ─── ExtractionPreview ───────────────────────────────────────────────────────
// Displays extracted text and structured fields immediately after upload.
// Uses inline styles only so it cannot affect any existing CSS class layout.
function ExtractionPreview({ result, onDismiss }) {
  if (!result) return null;
  const { category, fields, raw_text: rawText, status, rejection_message: rejectionMessage } = result;
  const hasFields =
    fields &&
    Object.keys(fields).some(
      (k) => fields[k] !== null && fields[k] !== undefined && fields[k] !== "" && !(Array.isArray(fields[k]) && !fields[k].length)
    );
  const rejected = status === "rejected_type" || result.accepted === false;
  const classConf = result.classification_confidence;
  const extractConf = result.extraction_confidence;
  const matchConf = result.matching_confidence;

  return (
    <div
      style={{
        margin: "16px 0",
        border: rejected ? "1px solid #fca5a5" : "1px solid #bed0dc",
        borderRadius: 10,
        background: rejected ? "#fef2f2" : "#f7fbff",
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
          color: rejected ? "#b91c1c" : "#1e40af",
          textTransform: "uppercase",
          letterSpacing: ".05em",
          marginBottom: 10,
        }}
      >
        {rejected ? "Document rejected" : status === "completed" ? "Extracted Information" : "Extraction Incomplete"}
        {category && category !== "unknown" && (
          <span
            style={{
              marginLeft: 8,
              background: rejected ? "#fee2e2" : "#dbeafe",
              borderRadius: 4,
              padding: "2px 7px",
              fontSize: ".78rem",
              color: rejected ? "#b91c1c" : "#1e40af",
              textTransform: "capitalize",
            }}
          >
            {String(category).replace(/_/g, " ")}
          </span>
        )}
      </p>

      {rejectionMessage && (
        <p style={{ color: "#b91c1c", marginBottom: 8, fontSize: ".9rem" }}>{rejectionMessage}</p>
      )}
      {result.quality_warning && (
        <p style={{ color: "#9a3412", marginBottom: 8, fontSize: ".9rem" }}>
          {result.quality_warning}
        </p>
      )}

      {(classConf != null || extractConf != null || matchConf != null) && !rejected && (
        <p style={{ fontSize: ".8rem", color: "#5c7086", marginBottom: 10 }}>
          {classConf != null && <>Classification: {Math.round(classConf * 100)}% · </>}
          {extractConf != null && <>Extraction: {Math.round(extractConf * 100)}% · </>}
          {matchConf != null && <>Matching: {Math.round(matchConf * 100)}%</>}
        </p>
      )}

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
            .filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length))
            .map(([key, value]) => (
              <div key={key}>
                <dt style={{ fontSize: ".78rem", color: "#5c7086", textTransform: "capitalize" }}>
                  {key.replace(/_/g, " ")}
                </dt>
                <dd style={{ fontSize: ".88rem", color: "#1a2535", fontWeight: 500, margin: 0 }}>
                  {Array.isArray(value)
                    ? value.map((v) => (typeof v === "object" ? JSON.stringify(v) : v)).join(", ")
                    : typeof value === "object"
                      ? JSON.stringify(value)
                      : String(value)}
                </dd>
              </div>
            ))}
        </dl>
      )}

      {rawText && !rejected && (
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

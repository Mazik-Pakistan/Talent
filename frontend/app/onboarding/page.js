"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import UniversityAutocomplete from "@/components/onboarding/UniversityAutocomplete";
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
import SidebarBrand from "@/components/SidebarBrand";
import RecruiterLoader from "@/components/recruiter/RecruiterLoader";
import { publishCandidateContext, clearCandidateContext } from "@/lib/ai/candidateContext";
import { CANDIDATE_STEP_HELP } from "@/lib/ai/candidateFieldHelp";
import { invalidateCandidateInsightCache } from "@/lib/ai/candidateInsights";
import { openAiAssistantChat } from "@/lib/ai/openAiAssistant";
import { scrollOcrFieldIntoView, typewriterFill } from "@/lib/ai/typewriterFill";
import OcrScanOverlay, {
  CNIC_OCR_FIELDS,
  EDUCATION_OCR_FIELDS,
  RESUME_OCR_FIELDS,
} from "@/components/ai-experience/OcrScanOverlay";
import { CANDIDATE_NAV_ITEMS, isCandidateNavActive } from "@/utils/candidateNav";
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
  blood_group: "N/A",
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
  city: "",
  board_university: "",
  degree: "",
  field_of_study: "",
  year_completed: "",
  cgpa_or_percentage: "",
  certificate_file: null,
};

const COUNTRY_OPTIONS = ["Pakistan", "United Arab Emirates", "Saudi Arabia"];
const PAKISTANI_CITIES = ["Karachi", "Lahore", "Islamabad", "Rawalpindi", "Faisalabad"];
const PAKISTANI_PROVINCES = ["Punjab", "Sindh", "Khyber Pakhtunkhwa", "Balochistan", "Islamabad Capital Territory", "Gilgit-Baltistan", "Azad Kashmir"];

// Curated skill lists
const TECHNICAL_SKILLS = [
  "JavaScript", "TypeScript", "React", "Next.js", "Node.js", "Python", "Java", "C#",
  "SQL", "MongoDB", "GraphQL", "REST APIs", "Docker", "Kubernetes", "AWS", "Azure",
  "Git", "CI/CD", "Agile/Scrum", "Machine Learning", "Data Analysis", "Cybersecurity",
  "Networking", "Linux", "DevOps", "Flutter", "Swift", "Kotlin", "PHP", "Ruby",
];

const SOFT_SKILLS = [
  "Communication", "Teamwork", "Problem Solving", "Critical Thinking", "Leadership",
  "Time Management", "Adaptability", "Creativity", "Emotional Intelligence",
  "Conflict Resolution", "Presentation", "Negotiation", "Mentoring", "Attention to Detail",
  "Work Ethic", "Interpersonal Skills", "Self-motivation", "Resilience",
];

const emptySkills = {
  technical_skills: [],    // now an array of strings
  soft_skills: [],
  languages: [],
  certifications: [{ name: "", document_url: null, expiry_date: "" }],
};

const emptyGovDoc = {
  doc_type: "cnic",
  document_number: "",
  file_name: null,
  file_url: null,
};

const emptyResume = { summary: "", file_name: null, file_url: null };

// --- CONSTANTS AND UTILITY FUNCTIONS ---

const BLOOD_GROUP_OPTIONS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "N/A"];
const BLOOD_GROUP_HINT = "Required for medical emergencies.";

function normalizeBloodGroup(value) {
  if (!value) return "N/A";
  const normalized = String(value).trim().toUpperCase();
  if (BLOOD_GROUP_OPTIONS.includes(normalized)) return normalized;
  return "N/A";
}

function validateTextField(value, minLength, maxLength, fieldName) {
  const text = String(value || "").trim();
  if (text.length === 0 && minLength > 0) return { isValid: false, error: `${fieldName} is required.` };
  if (text.length < minLength) return { isValid: false, error: `${fieldName} must be at least ${minLength} characters.` };
  if (text.length > maxLength) return { isValid: false, error: `${fieldName} cannot exceed ${maxLength} characters.` };
  return { isValid: true, normalized: text };
}

function validateDateNotFuture(value, fieldName) {
  if (!value) return { isValid: false, error: `${fieldName} is required.` };
  const date = new Date(value);
  if (isNaN(date.getTime())) return { isValid: false, error: `Invalid date format for ${fieldName}.` };
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (date > today) return { isValid: false, error: `${fieldName} cannot be in the future.` };
  
  return { isValid: true };
}

function validateCNIC(value) {
  const text = String(value || "").replace(/[^0-9]/g, "");
  if (text.length !== 13) return { isValid: false, error: "CNIC must be in format XXXXX-XXXXXXX-X." };
  return { isValid: true, normalized: `${text.slice(0, 5)}-${text.slice(5, 12)}-${text.slice(12)}` };
}

function isValidPkMobile(value) {
  const text = String(value || "").replace(/[^0-9+]/g, "");
  return /^((\+92)|(0092)|0)?3[0-9]{9}$/.test(text); 
}

// ---------------------------------------

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <RecruiterLoader />
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
  const [ocrTypingKey, setOcrTypingKey] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [toast, setToast] = useState(null);
  const [pendingReplace, setPendingReplace] = useState(null);
  const [bloodGroupPending, setBloodGroupPending] = useState(null);
  const [scanPulse, setScanPulse] = useState(false);
  const [offerUnsigned, setOfferUnsigned] = useState(false);
  const [otherSelections, setOtherSelections] = useState({ country: false, city: false, state: false });
  const [ocrSession, setOcrSession] = useState(null);
  const ocrFillAbortRef = useRef(null);
  const ocrPreviewUrlRef = useRef(null);

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
        if (storedMode === "agent") {
          sessionStorage.removeItem(FILL_MODE_KEY);
        } else if (storedMode === "ocr" || storedMode === "manual") {
          setFillMode(storedMode);
        } else if (isEditMode) {
          setFillMode("manual");
        }
        const data = await getOnboarding(accessToken);
        // Never auto-redirect to /offer — Profile/Onboarding stay open; offer is opt-in via nav/CTA.
        setOfferUnsigned(data.offer_signed === false);
        setCandidate(data.candidate);
        setOnboarding(data.onboarding);
        setProgress(data.progress);
        hydrateForms(data.onboarding);
        try {
          const draft = JSON.parse(localStorage.getItem(draftStorageKey()) || "null");
          if (draft?.personal && isPersonalIncomplete(data.onboarding?.personal)) {
            setPersonal((prev) => ({
              ...prev,
              ...draft.personal,
              blood_group: normalizeBloodGroup(draft.personal.blood_group ?? prev.blood_group),
            }));
            if (draft.govDocs?.length) setGovDocs(draft.govDocs);
          }
        } catch {
          /* ignore */
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
        blood_group: normalizeBloodGroup(p.blood_group),
        current_address: p.current_address || p.address_line1 || "",
        permanent_address: p.permanent_address || p.address_line2 || p.current_address || p.address_line1 || "",
        first_name: p.first_name || "",
        last_name: p.last_name || "",
      });
    }
    if (data.education?.entries?.length) {
      setEducationEntries(
        data.education.entries.map((entry) => ({
          ...emptyEducationEntry,
          ...entry,
          institution: entry.institution || "",
          city: entry.city || "",
          board_university: entry.board_university || "",
          degree: entry.degree || "",
          field_of_study: entry.field_of_study || "",
          year_completed: entry.year_completed || "",
          cgpa_or_percentage: entry.cgpa_or_percentage || "",
          certificate_file: entry.certificate_file || null,
        }))
      );
    }
    if (data.skills) {
      const tech = Array.isArray(data.skills.technical_skills)
        ? data.skills.technical_skills
        : (data.skills.technical_skills || "").split(",").map(s => s.trim()).filter(Boolean);
      const soft = Array.isArray(data.skills.soft_skills)
        ? data.skills.soft_skills
        : (data.skills.soft_skills || "").split(",").map(s => s.trim()).filter(Boolean);
      setSkills({
        technical_skills: tech,
        soft_skills: soft,
        languages: data.skills.languages || [],
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
    if (Array.isArray(value)) {
      return value.map((s) => String(s ?? "").trim()).filter(Boolean);
    }
    return String(value || "")
      .split(/[,;|/]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function joinList(value) {
    if (Array.isArray(value)) return value.filter(Boolean).join(", ");
    return value || "";
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

  function normalizeDateForInput(value) {
    if (!value) return "";
    const text = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const match = text.match(/^(\d{1,2})[\/\-. ](\d{1,2})[\/\-. ](\d{4})$/);
    if (!match) return "";
    const [, day, month, year] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  function beginOcrFill() {
    ocrFillAbortRef.current?.abort();
    const controller = new AbortController();
    ocrFillAbortRef.current = controller;
    setAutoFilledKeys([]);
    setOcrTypingKey(null);
    return controller;
  }

  function clearOcrPreview() {
    if (ocrPreviewUrlRef.current) {
      URL.revokeObjectURL(ocrPreviewUrlRef.current);
      ocrPreviewUrlRef.current = null;
    }
  }

  function startOcrSession({ file, purpose, index = 0 }) {
    clearOcrPreview();
    let previewUrl = null;
    if (file?.type?.startsWith("image/")) {
      previewUrl = URL.createObjectURL(file);
      ocrPreviewUrlRef.current = previewUrl;
    }
    const fieldDefs =
      purpose === "government_doc"
        ? CNIC_OCR_FIELDS
        : purpose === "resume"
          ? RESUME_OCR_FIELDS
          : purpose === "education_cert"
            ? EDUCATION_OCR_FIELDS(index)
            : [];
    const docLabel =
      purpose === "government_doc"
        ? "National ID"
        : purpose === "resume"
          ? "Resume"
          : purpose === "education_cert"
            ? "Transcript"
            : "Document";
    setOcrSession({
      purpose,
      index,
      fileName: file?.name || "Document",
      previewUrl,
      docLabel,
      fieldDefs,
      scanning: true,
      stage: "Uploading and extracting text…",
      typedValues: {},
      revealed: [],
      typingKey: null,
      confidence: {},
      progress: 0.12,
      error: null,
    });
  }

  function patchOcrSession(patch) {
    setOcrSession((current) => (current ? { ...current, ...patch } : current));
  }

  function endOcrSession({ delayMs = 700 } = {}) {
    window.setTimeout(() => {
      setOcrSession(null);
      clearOcrPreview();
    }, delayMs);
  }

  function ocrFillHandlers(signal, totalFields = 0) {
    let doneCount = 0;
    return {
      signal,
      onFieldStart: (key) => {
        setOcrTypingKey(key);
        setAutoFilledKeys((prev) => {
          const next = prev.includes(key) ? prev : [...prev, key];
          if (key === "national_id" && !next.includes("document_number")) next.push("document_number");
          return next;
        });
        scrollOcrFieldIntoView(key);
        setOcrSession((current) => {
          if (!current) return current;
          const revealed = current.revealed.includes(key) ? current.revealed : [...current.revealed, key];
          return {
            ...current,
            scanning: false,
            stage: "Writing extracted fields…",
            typingKey: key,
            revealed,
            progress: totalFields ? Math.min(0.95, (doneCount + 0.35) / totalFields) : current.progress,
          };
        });
      },
      onFieldDone: () => {
        doneCount += 1;
        setOcrTypingKey(null);
        setOcrSession((current) => {
          if (!current) return current;
          return {
            ...current,
            typingKey: null,
            progress: totalFields ? Math.min(1, doneCount / totalFields) : 1,
          };
        });
      },
      trackValue: (key, partial) => {
        setOcrSession((current) =>
          current ? { ...current, typedValues: { ...current.typedValues, [key]: partial } } : current
        );
      },
    };
  }

  function withSessionTrack(handlers, key, apply) {
    return (partial) => {
      handlers.trackValue?.(key, partial);
      apply(partial);
    };
  }

  async function applyCnicOcrFill(ocrResult, index = 0, fileMeta = null) {
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
    const nationality = fields.nationality || "";
    const fatherName = fields.father_name || "";

    const nextPersonal = {
      ...personal,
      first_name: first || "",
      last_name: last || "",
      date_of_birth: dateOfBirth || "",
      gender: gender || personal.gender || "prefer_not_to_say",
      nationality: nationality || personal.nationality || "Pakistani",
      marital_status: marital || personal.marital_status || "single",
      national_id: idNumber || "",
      father_name: fatherName || "",
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

    setGovDocs((current) => {
      const next = [...current];
      next[index] = {
        ...next[index],
        ...(fileMeta || {}),
        doc_type: "cnic",
        document_number: "",
        file_name: fileMeta?.file_name || next[index]?.file_name || null,
        file_url: fileMeta?.file_url || next[index]?.file_url || null,
      };
      return next;
    });
    setPersonal((prev) => ({
      ...prev,
      first_name: "",
      last_name: "",
      date_of_birth: "",
      national_id: "",
      father_name: "",
      id_issue_date: "",
      id_expiry_date: "",
      ...(nationality ? { nationality: "" } : {}),
    }));
    setScanPulse(false);
    setFieldErrors({});

    const controller = beginOcrFill();
    const rawEntries = [
      first && {
        key: "first_name",
        value: first,
        apply: (v) => setPersonal((prev) => ({ ...prev, first_name: v })),
      },
      last && {
        key: "last_name",
        value: last,
        apply: (v) => setPersonal((prev) => ({ ...prev, last_name: v })),
      },
      fatherName && {
        key: "father_name",
        value: fatherName,
        apply: (v) => setPersonal((prev) => ({ ...prev, father_name: v })),
      },
      idNumber && {
        key: "national_id",
        value: idNumber,
        apply: (v) => {
          setPersonal((prev) => ({ ...prev, national_id: v }));
          setGovDocs((current) => {
            const next = [...current];
            next[index] = { ...next[index], document_number: v };
            return next;
          });
        },
      },
      dateOfBirth && {
        key: "date_of_birth",
        value: dateOfBirth,
        apply: (v) => setPersonal((prev) => ({ ...prev, date_of_birth: v })),
      },
      gender && {
        key: "gender",
        value: gender,
        mode: "instant",
        apply: (v) => setPersonal((prev) => ({ ...prev, gender: v })),
      },
      nationality && {
        key: "nationality",
        value: nationality,
        apply: (v) => setPersonal((prev) => ({ ...prev, nationality: v })),
      },
      marital && {
        key: "marital_status",
        value: marital,
        mode: "instant",
        apply: (v) => setPersonal((prev) => ({ ...prev, marital_status: v })),
      },
      issueDate && {
        key: "id_issue_date",
        value: issueDate,
        apply: (v) => setPersonal((prev) => ({ ...prev, id_issue_date: v })),
      },
      expiryDate && {
        key: "id_expiry_date",
        value: expiryDate,
        apply: (v) => setPersonal((prev) => ({ ...prev, id_expiry_date: v })),
      },
    ].filter(Boolean);

    const handlers = ocrFillHandlers(controller.signal, rawEntries.length);
    const entries = rawEntries.map((entry) => ({
      ...entry,
      apply: withSessionTrack(handlers, entry.key, entry.apply),
    }));

    patchOcrSession({
      scanning: false,
      stage: "Writing extracted fields…",
      fieldDefs: CNIC_OCR_FIELDS,
      progress: 0.2,
    });

    await typewriterFill(entries, handlers);
    if (controller.signal.aborted) return;

    setPersonal(nextPersonal);
    setGovDocs(nextGovDocs);
    setOcrTypingKey(null);
    patchOcrSession({ progress: 1, typingKey: null, scanning: false, stage: "Done" });
    void savePersonalDraft(nextPersonal, nextGovDocs);
    endOcrSession();
  }

  useEffect(() => {
    if (!autoFilledKeys.length || ocrTypingKey) return undefined;
    const timer = window.setTimeout(() => setAutoFilledKeys([]), 4200);
    return () => window.clearTimeout(timer);
  }, [autoFilledKeys, ocrTypingKey]);

  useEffect(
    () => () => {
      ocrFillAbortRef.current?.abort();
      if (ocrPreviewUrlRef.current) {
        URL.revokeObjectURL(ocrPreviewUrlRef.current);
        ocrPreviewUrlRef.current = null;
      }
    },
    []
  );

  function fillAnimProps(key) {
    const i = autoFilledKeys.indexOf(key);
    if (i < 0 && ocrTypingKey !== key) return { ocrKey: key };
    return {
      ocrKey: key,
      fillAnim: true,
      fillDelay: 0,
      ocrTyping: ocrTypingKey === key,
    };
  }

  function fillAnimLabelClass(key) {
    const classes = [];
    if (autoFilledKeys.includes(key) || ocrTypingKey === key) classes.push(styles.fieldFillAnim);
    if (ocrTypingKey === key) classes.push(styles.fieldOcrTyping);
    return classes.join(" ");
  }

  function fillAnimLabelStyle(key) {
    if (!autoFilledKeys.includes(key) && ocrTypingKey !== key) return undefined;
    return undefined;
  }

  async function autoFillFromOCR(ocrResult, purpose, index) {
    if (!ocrResult || ocrResult.status !== "completed" || ocrResult.accepted === false) return;
    const { category, fields } = ocrResult;
    if (!fields) return;

    if (purpose === "government_doc" && category === "cnic") {
      return applyCnicOcrFill(ocrResult, index);
    }

    const controller = beginOcrFill();
    const signal = controller.signal;
    let handlers = ocrFillHandlers(signal);

    if (purpose === "resume" && category === "resume") {
      const first = fields.first_name || (fields.full_name || "").toString().split(/\s+/)[0] || "";
      const last =
        fields.last_name ||
        (fields.full_name || "")
          .toString()
          .split(/\s+/)
          .slice(1)
          .join(" ") ||
        "";
      const dateOfBirth = normalizeDateForInput(fields.date_of_birth);
      const address = fields.address || "";
      const summary =
        fields.professional_summary ||
        [
          fields.full_name ? `Name: ${fields.full_name}` : "",
          fields.email ? `Email: ${fields.email}` : "",
          fields.phone_number ? `Contact: ${fields.phone_number}` : "",
          fields.linkedin ? `LinkedIn: ${fields.linkedin}` : "",
          fields.github ? `GitHub: ${fields.github}` : "",
          fields.portfolio ? `Portfolio: ${fields.portfolio}` : "",
        ]
          .filter(Boolean)
          .join(" | ");

      const techArr = splitTags(fields.technical_skills || fields.skills);
      const softArr = splitTags(fields.soft_skills);

      const certs = Array.isArray(fields.certifications)
        ? fields.certifications.map((c) =>
            typeof c === "string"
              ? { name: c, document_url: null, expiry_date: "" }
              : { name: c?.name || "", document_url: null, expiry_date: "" }
          )
        : null;

      const personalSnapshot = personal;
      const skillsSnapshot = skills;
      const resumeSnapshot = resume;
      const educationSnapshot = educationEntries;

      const entries = [];
      if (first && !personalSnapshot.first_name) {
        entries.push({
          key: "first_name",
          value: first,
          apply: (v) => setPersonal((prev) => ({ ...prev, first_name: v })),
        });
      }
      if (last && !personalSnapshot.last_name) {
        entries.push({
          key: "last_name",
          value: last,
          apply: (v) => setPersonal((prev) => ({ ...prev, last_name: v })),
        });
      }
      if (dateOfBirth && !personalSnapshot.date_of_birth) {
        entries.push({
          key: "date_of_birth",
          value: dateOfBirth,
          apply: (v) => setPersonal((prev) => ({ ...prev, date_of_birth: v })),
        });
      }
      if (address && !personalSnapshot.current_address) {
        entries.push({
          key: "current_address",
          value: address,
          apply: (v) => setPersonal((prev) => ({ ...prev, current_address: v })),
        });
      }
      if (summary && !resumeSnapshot.summary) {
        entries.push({
          key: "summary",
          value: summary,
          apply: (v) => setResume((prev) => ({ ...prev, summary: v })),
        });
      }
      if (techArr.length && !skillsSnapshot.technical_skills.length) {
        entries.push({
          key: "technical_skills",
          value: techArr.join(", "),
          apply: (v) => setSkills(prev => ({ ...prev, technical_skills: techArr })),
        });
      }
      if (softArr.length && !skillsSnapshot.soft_skills.length) {
        entries.push({
          key: "soft_skills",
          value: softArr.join(", "),
          apply: (v) => setSkills(prev => ({ ...prev, soft_skills: softArr })),
        });
      }

      handlers = ocrFillHandlers(signal, Math.max(entries.length, 1));
      patchOcrSession({
        scanning: false,
        stage: "Writing extracted fields…",
        fieldDefs: RESUME_OCR_FIELDS,
      });
      await typewriterFill(
        entries.map((entry) => ({ ...entry, apply: withSessionTrack(handlers, entry.key, entry.apply) })),
        handlers
      );
      if (signal.aborted) return;

      if (certs?.length && !skillsSnapshot.certifications?.[0]?.name) {
        setSkills((prev) => ({ ...prev, certifications: certs }));
        setAutoFilledKeys((prev) => (prev.includes("certifications") ? prev : [...prev, "certifications"]));
      }

      if (Array.isArray(fields.education) && fields.education.length) {
        const isEmpty =
          educationSnapshot.length === 1 &&
          !educationSnapshot[0].institution &&
          !educationSnapshot[0].degree;
        if (isEmpty) {
          const mapped = fields.education.map((ed) => {
            if (typeof ed === "string") {
              return { ...emptyEducationEntry, institution: ed };
            }
            return {
              ...emptyEducationEntry,
              institution: ed.institute || ed.institution || "",
              city: ed.city || "",
              degree: ed.degree || "",
              field_of_study: ed.major || ed.program || ed.field_of_study || "",
              year_completed: String(ed.year || ed.passing_year || "").slice(0, 4),
              cgpa_or_percentage: ed.cgpa || ed.gpa || ed.percentage || "",
            };
          });
          const firstEd = mapped[0];
          const eduEntries = [
            firstEd.institution && {
              key: "edu_0_institution",
              value: firstEd.institution,
              apply: (v) =>
                setEducationEntries((prev) => {
                  const next = [...prev];
                  next[0] = { ...(next[0] || emptyEducationEntry), institution: v };
                  return next;
                }),
            },
            firstEd.city && {
              key: "edu_0_city",
              value: firstEd.city,
              apply: (v) =>
                setEducationEntries((prev) => {
                  const next = [...prev];
                  next[0] = { ...(next[0] || emptyEducationEntry), city: v };
                  return next;
                }),
            },
            firstEd.degree && {
              key: "edu_0_degree",
              value: firstEd.degree,
              apply: (v) =>
                setEducationEntries((prev) => {
                  const next = [...prev];
                  next[0] = { ...(next[0] || emptyEducationEntry), degree: v };
                  return next;
                }),
            },
            firstEd.field_of_study && {
              key: "edu_0_field_of_study",
              value: firstEd.field_of_study,
              apply: (v) =>
                setEducationEntries((prev) => {
                  const next = [...prev];
                  next[0] = { ...(next[0] || emptyEducationEntry), field_of_study: v };
                  return next;
                }),
            },
            firstEd.year_completed && {
              key: "edu_0_year_completed",
              value: firstEd.year_completed,
              apply: (v) =>
                setEducationEntries((prev) => {
                  const next = [...prev];
                  next[0] = { ...(next[0] || emptyEducationEntry), year_completed: v };
                  return next;
                }),
            },
            firstEd.cgpa_or_percentage && {
              key: "edu_0_cgpa_or_percentage",
              value: firstEd.cgpa_or_percentage,
              apply: (v) =>
                setEducationEntries((prev) => {
                  const next = [...prev];
                  next[0] = { ...(next[0] || emptyEducationEntry), cgpa_or_percentage: v };
                  return next;
                }),
            },
          ].filter(Boolean);

          setEducationEntries([{ ...emptyEducationEntry }]);
          const eduHandlers = ocrFillHandlers(signal, eduEntries.length);
          patchOcrSession({ fieldDefs: EDUCATION_OCR_FIELDS(0) });
          await typewriterFill(
            eduEntries.map((entry) => ({
              ...entry,
              apply: withSessionTrack(eduHandlers, entry.key, entry.apply),
            })),
            eduHandlers
          );
          if (!signal.aborted) {
            setEducationEntries(mapped);
            setAutoFilledKeys((prev) => (prev.includes("education") ? prev : [...prev, "education"]));
          }
        }
      }
    } else if (purpose === "education_cert" && (category === "academic_transcript" || category === "certificate")) {
      const yearRaw = fields.passing_year || fields.year || fields.issue_date || "";
      const year = String(yearRaw).match(/(19|20)\d{2}/)?.[0] || String(yearRaw).slice(0, 4);
      const mapped = {
        institution: fields.institute || fields.institution || fields.university || "",
        city: fields.city || "",
        degree: fields.degree || fields.program || fields.qualification || "",
        field_of_study: fields.major || fields.program || fields.field_of_study || "",
        year_completed: year || "",
        cgpa_or_percentage:
          (fields.cgpa != null ? String(fields.cgpa) : "") ||
          (fields.gpa != null ? String(fields.gpa) : "") ||
          (fields.percentage != null ? String(fields.percentage) : "") ||
          "",
      };
      const cur = educationEntries[index] || { ...emptyEducationEntry };
      const prefix = `edu_${index}_`;
      const entries = [
        !cur.institution &&
          mapped.institution && {
            key: `${prefix}institution`,
            value: mapped.institution,
            apply: (v) =>
              setEducationEntries((prev) => {
                const next = [...prev];
                next[index] = { ...(next[index] || emptyEducationEntry), institution: v, board_university: "" };
                return next;
              }),
          },
        !cur.city &&
          mapped.city && {
            key: `${prefix}city`,
            value: mapped.city,
            apply: (v) =>
              setEducationEntries((prev) => {
                const next = [...prev];
                next[index] = { ...(next[index] || emptyEducationEntry), city: v };
                return next;
              }),
          },
        !cur.degree &&
          mapped.degree && {
            key: `${prefix}degree`,
            value: mapped.degree,
            apply: (v) =>
              setEducationEntries((prev) => {
                const next = [...prev];
                next[index] = { ...(next[index] || emptyEducationEntry), degree: v };
                return next;
              }),
          },
        !cur.field_of_study &&
          mapped.field_of_study && {
            key: `${prefix}field_of_study`,
            value: mapped.field_of_study,
            apply: (v) =>
              setEducationEntries((prev) => {
                const next = [...prev];
                next[index] = { ...(next[index] || emptyEducationEntry), field_of_study: v };
                return next;
              }),
          },
        !cur.year_completed &&
          mapped.year_completed && {
            key: `${prefix}year_completed`,
            value: mapped.year_completed,
            apply: (v) =>
              setEducationEntries((prev) => {
                const next = [...prev];
                next[index] = { ...(next[index] || emptyEducationEntry), year_completed: v };
                return next;
              }),
          },
        !cur.cgpa_or_percentage &&
          mapped.cgpa_or_percentage && {
            key: `${prefix}cgpa_or_percentage`,
            value: mapped.cgpa_or_percentage,
            apply: (v) =>
              setEducationEntries((prev) => {
                const next = [...prev];
                next[index] = { ...(next[index] || emptyEducationEntry), cgpa_or_percentage: v };
                return next;
              }),
          },
      ].filter(Boolean);

      handlers = ocrFillHandlers(signal, Math.max(entries.length, 1));
      patchOcrSession({
        scanning: false,
        stage: "Writing extracted fields…",
        fieldDefs: EDUCATION_OCR_FIELDS(index),
      });
      await typewriterFill(
        entries.map((entry) => ({ ...entry, apply: withSessionTrack(handlers, entry.key, entry.apply) })),
        handlers
      );
    }

    if (!signal.aborted) {
      setOcrTypingKey(null);
      patchOcrSession({ progress: 1, typingKey: null, scanning: false, stage: "Done" });
      endOcrSession();
    }
  }

  const stepIndex = useMemo(() => steps.findIndex((item) => item.id === step), [step, steps]);
  const submitted = onboarding?.status === "submitted";
  const isOcrMode = fillMode === "ocr";
  const showModeChooser = !loading && !submitted && !isEditMode && !fillMode;

  useEffect(() => {
    const help = CANDIDATE_STEP_HELP[step] || {};
    publishCandidateContext({
      pathname: isEditMode ? "/onboarding?edit=true" : "/onboarding",
      step,
      section: step,
      hint: help.hint || null,
      fields: help.fields || [],
    });
    return () => clearCandidateContext();
  }, [step, isEditMode]);

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
        (entry) => entry.institution && entry.city && entry.degree && entry.field_of_study && entry.year_completed
      )
    );
  }

  function isSkillsComplete() {
    const hasSkills = skills.technical_skills.length > 0 || skills.soft_skills.length > 0;
    const hasCertifications = (skills.certifications || []).some((c) => c.name && c.name.trim());
    const hasSummary = !!(resume.summary && resume.summary.length >= 20);
    return (hasSkills || hasCertifications) && hasSummary;
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
    if (mode === "agent") {
      openOnboardingAssistant();
      return;
    }
    setFillMode(mode);
    sessionStorage.setItem(FILL_MODE_KEY, mode);
    setMessage("");
  }

  function openOnboardingAssistant() {
    const label = steps.find((item) => item.id === step)?.label || "onboarding";
    openAiAssistantChat(router, {
      href: "/dashboard/candidate/ai-assistant",
      prompt:
        `I was redirected from candidate onboarding (currently on “${label}”). ` +
        "Help me finish my profile — tell me what’s left and guide me step by step. " +
        "Do not fill form fields for me; I’ll enter the values myself on the onboarding page.",
    });
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
      invalidateCandidateInsightCache();
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
      } else if (purpose === "skill_cert") {
        setSkills((current) => {
          const next = [...(current.certifications || [])];
          if (next[index]) next[index] = { ...next[index], document_url: null };
          return { ...current, certifications: next };
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

    if (willScan || softOcr) {
      startOcrSession({ file, purpose, index });
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
      if (willScan || softOcr) {
        patchOcrSession({ stage: "Running OCR…", progress: 0.25, scanning: true });
      }
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

      if (ocrHardRejected) {
        setScanPulse(false);
        const err = ocr.rejection_message || data.message || "Document type rejected.";
        setMessage(err);
        setExtractionPreview(ocr);
        showToast("error", err);
        patchOcrSession({ scanning: false, error: err, progress: 1 });
        endOcrSession({ delayMs: 1600 });
        return;
      }

      if (purpose === "resume") {
        setResume((current) => ({ ...current, file_name: data.file_name, file_url: data.file_url }));
      } else if (purpose === "government_doc") {
        const fileMeta = { file_name: data.file_name, file_url: data.file_url, doc_type: "cnic" };
        if (willAutofillCnic) {
          void applyCnicOcrFill(ocr, index, fileMeta);
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
          patchOcrSession({
            scanning: false,
            error: ocr?.rejection_message || "Could not extract text — please fill the fields manually.",
            progress: 1,
          });
          endOcrSession({ delayMs: 1400 });
        }
        if (data.document_verification) setDocumentVerification(data.document_verification);
        return;
      } else if (purpose === "education_cert") {
        setEducationEntries((current) => {
          const next = [...current];
          next[index] = { ...next[index], certificate_file: data.file_url };
          return next;
        });
      } else if (purpose === "skill_cert") {
        setSkills((current) => {
          const next = [...(current.certifications || [])];
          while (next.length <= index) {
            next.push({ name: "", document_url: null, expiry_date: "" });
          }
          next[index] = { ...next[index], document_url: data.file_url || data.document_url };
          return { ...current, certifications: next };
        });
      }

      if (data.document_verification) {
        setDocumentVerification(data.document_verification);
      }

      if (ocr && ocr.status === "completed" && ocr.accepted !== false) {
        void autoFillFromOCR(ocr, purpose, index);
        setExtractionPreview(ocr);
        setMessage("File uploaded and fields updated where available.");
        showToast("success", "Document uploaded.");
      } else if (ocr && softOcr) {
        if (ocr.fields && Object.keys(ocr.fields).length) {
          void autoFillFromOCR({ ...ocr, accepted: true, status: "completed", category: ocr.category || "academic_transcript" }, purpose, index);
        } else {
          endOcrSession({ delayMs: 500 });
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
        if (willScan || softOcr) endOcrSession({ delayMs: 500 });
      } else {
        setMessage("Document uploaded and saved.");
        if (willScan || softOcr) endOcrSession({ delayMs: 400 });
      }
    } catch (error) {
      setScanPulse(false);
      const err = getApiErrorMessage(error, "Upload failed.");
      setMessage(err);
      showToast("error", err);
      if (willScan || softOcr) {
        patchOcrSession({ scanning: false, error: err, progress: 1 });
        endOcrSession({ delayMs: 1400 });
      }
    } finally {
      setUploading(false);
      setUploadPhase("");
      if (inputEl) inputEl.value = "";
    }
  }

  // Toggle a skill pill
  function toggleSkill(skill, category) {
    setSkills(prev => {
      const current = prev[category] || [];
      const exists = current.includes(skill);
      return {
        ...prev,
        [category]: exists ? current.filter(s => s !== skill) : [...current, skill],
      };
    });
  }

  async function handleNext(event) {
    event.preventDefault();
    if (submitted && !isEditMode) return;

    if (step === "personal") {
      const errors = {};
      
      // Validate text fields
      const firstNameValidation = validateTextField(personal.first_name, 1, 80, "First name");
      if (!firstNameValidation.isValid) errors.first_name = firstNameValidation.error;
      
      const lastNameValidation = validateTextField(personal.last_name, 1, 80, "Last name");
      if (!lastNameValidation.isValid) errors.last_name = lastNameValidation.error;
      
      const nationalityValidation = validateTextField(personal.nationality, 2, 80, "Nationality");
      if (!nationalityValidation.isValid) errors.nationality = nationalityValidation.error;
      
      const cityValidation = validateTextField(personal.city, 2, 100, "City");
      if (!cityValidation.isValid) errors.city = cityValidation.error;
      
      const stateValidation = validateTextField(personal.state, 2, 100, "State");
      if (!stateValidation.isValid) errors.state = stateValidation.error;
      
      const postalCodeValidation = validateTextField(personal.postal_code, 3, 20, "Postal code");
      if (!postalCodeValidation.isValid) errors.postal_code = postalCodeValidation.error;
      
      const countryValidation = validateTextField(personal.country, 2, 100, "Country");
      if (!countryValidation.isValid) errors.country = countryValidation.error;
      
      const currentAddressValidation = validateTextField(personal.current_address, 3, 300, "Current address");
      if (!currentAddressValidation.isValid) errors.current_address = currentAddressValidation.error;

      const permanentAddressValidation = personal.same_as_current
        ? null
        : validateTextField(personal.permanent_address, 3, 300, "Permanent address");
      if (permanentAddressValidation && !permanentAddressValidation.isValid) {
        errors.permanent_address = permanentAddressValidation.error;
      }
      
      // Validate date of birth
      const dobValidation = validateDateNotFuture(personal.date_of_birth, "Date of birth");
      if (!dobValidation.isValid) errors.date_of_birth = dobValidation.error;
      
      // Validate CNIC format
      const cnicValidation = validateCNIC(personal.national_id);
      if (!cnicValidation.isValid) errors.national_id = cnicValidation.error;
      
      // Validate alternate phone if provided
      if (personal.alternate_phone && personal.alternate_phone.trim()) {
        if (!isValidPkMobile(personal.alternate_phone)) {
          errors.alternate_phone = "Enter a valid Pakistani mobile number.";
        }
      }
      
      // Validate required dropdowns
      if (!personal.gender) errors.gender = "Gender is required.";
      if (!personal.marital_status) errors.marital_status = "Marital status is required.";
      if (!personal.father_name || !personal.father_name.trim()) errors.father_name = "Father's name is required.";
      const bloodGroupValue = normalizeBloodGroup(personal.blood_group);
      if (!bloodGroupValue) errors.blood_group = "Blood group is required. Select your blood group (e.g. A+, O-, or N/A).";

      const requiredOk = Object.keys(errors).length === 0;
      if (!requiredOk) {
        showFormError("Please complete all required personal & contact fields highlighted below.", errors);
        return;
      }
      const payload = {
        ...personal,
        first_name: firstNameValidation.normalized,
        last_name: lastNameValidation.normalized,
        nationality: nationalityValidation.normalized,
        city: cityValidation.normalized,
        state: stateValidation.normalized,
        postal_code: postalCodeValidation.normalized,
        country: countryValidation.normalized,
        current_address: currentAddressValidation.normalized,
        permanent_address: personal.same_as_current ? currentAddressValidation.normalized : (permanentAddressValidation?.normalized || personal.permanent_address),
        national_id: cnicValidation.normalized,
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
      let hasErrors = false;
      const educationErrors = {};
      
      educationEntries.forEach((entry, index) => {
        const entryErrors = {};
        
        const institutionValidation = validateTextField(entry.institution, 2, 200, "Institution");
        if (!institutionValidation.isValid) entryErrors.institution = institutionValidation.error;

        const cityValidation = validateTextField(entry.city, 2, 100, "City");
        if (!cityValidation.isValid) entryErrors.city = cityValidation.error;
        
        const degreeValidation = validateTextField(entry.degree, 2, 120, "Degree");
        if (!degreeValidation.isValid) entryErrors.degree = degreeValidation.error;
        
        const fieldValidation = validateTextField(entry.field_of_study, 2, 120, "Field of study");
        if (!fieldValidation.isValid) entryErrors.field_of_study = fieldValidation.error;
        
        const yearValidation = validateTextField(entry.year_completed, 4, 4, "Year completed");
        if (!yearValidation.isValid) {
          entryErrors.year_completed = yearValidation.error;
        } else {
          const currentYear = new Date().getFullYear();
          const yearNum = parseInt(entry.year_completed, 10);
          if (yearNum > currentYear) {
            entryErrors.year_completed = "Year completed cannot be in the future.";
          } else if (yearNum < 1900) {
            entryErrors.year_completed = "Year completed must be after 1900.";
          }
        }
        
        if (Object.keys(entryErrors).length > 0) {
          educationErrors[index] = entryErrors;
          hasErrors = true;
        }
      });
      
      if (hasErrors) {
        showFormError("Please fix the errors in education fields.", educationErrors);
        return;
      }
      setFieldErrors({});
      await persist({ step: "education", education: { entries: educationEntries } });
    } else if (step === "skills") {
      const hasSkills = skills.technical_skills.length > 0 || skills.soft_skills.length > 0;
      const hasCertifications = (skills.certifications || []).filter(c => c.name.trim()).length > 0;
      if (!hasSkills && !hasCertifications) {
        showFormError("Select at least one skill or add a certification.");
        return;
      }
      if (!resume.summary || resume.summary.length < 20) {
        showFormError("Add a professional summary (at least 20 characters).", { summary: true });
        return;
      }
      setFieldErrors({});
      await persist({
        step: "skills",
        skills: {
          technical_skills: skills.technical_skills,
          soft_skills: skills.soft_skills,
          languages: [],
          certifications: (skills.certifications || [])
            .filter(c => c.name.trim())
            .map(c => ({
              name: c.name.trim(),
              document_url: c.document_url || null,
              expiry_date: c.expiry_date || null,
            })),
        },
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
    <div className={styles.root} data-app-shell>
      <div className={styles.app}>
        {/* Sidebar */}
        <aside className={styles.sidebar}>
          <SidebarBrand
            collapsed={false}
            className={styles.brand}
            markClassName={styles.brandMark}
            onClick={() => router.push("/dashboard/candidate")}
            title="TalentAI"
          />

          <div className={styles.navSectionLabel}>Workspace</div>
          <ul className={styles.nav} style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {CANDIDATE_NAV_ITEMS.map((item) => {
              const search =
                typeof window !== "undefined"
                  ? window.location.search
                  : isEditMode
                    ? "?edit=true"
                    : "";
              const isActive = isCandidateNavActive(item, {
                pathname: "/onboarding",
                search,
                activeKey: isEditMode ? "profile" : "onboarding",
              });
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    className={`${styles.navItem} ${isActive ? styles.active : ""}`}
                    onClick={() => item.href && router.push(item.href)}
                    title={item.label}
                  >
                    {item.icon}
                    <span>{item.label}</span>
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
              <RecruiterLoader inline />
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

                {offerUnsigned && (
                  <div className={styles.offerHintBanner}>
                    <span>You still have an unsigned offer letter.</span>
                    <button type="button" className={styles.offerHintBtn} onClick={() => router.push("/offer")}>
                      View offer
                    </button>
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
                      <button type="button" className={styles.modeCard} onClick={openOnboardingAssistant}>
                        <span className={styles.modeIcon} aria-hidden>
                          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8">
                            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                          </svg>
                        </span>
                        <strong>Ask AI Assistant</strong>
                        <span>Open the AI Assistant chat for guidance. You still fill every field yourself on this page.</span>
                      </button>
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
                      <button
                        type="button"
                        className={styles.modeSwitch}
                        onClick={openOnboardingAssistant}
                      >
                        Ask AI Assistant
                      </button>
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

                    {extractionPreview && (
                      <ScanFillBanner
                        styles={styles}
                        result={extractionPreview}
                        filledCount={autoFilledKeys.length}
                        onDismiss={() => setExtractionPreview(null)}
                      />
                    )}

                    {autoFilledKeys.length > 0 && !extractionPreview && (
                      <p className={styles.fillSuccessBanner} role="status">
                        <span className={styles.fillSuccessIcon} aria-hidden>✓</span>
                        Filled {autoFilledKeys.length} field{autoFilledKeys.length === 1 ? "" : "s"} from your document — review and edit anytime.
                      </p>
                    )}

                    {(() => {
                      const stillMissing = (progress?.missing_fields || []).filter((section) => {
                        if (section === "personal" || section === "government_docs") return !isPersonalComplete();
                        if (section === "education") return !isEducationComplete();
                        if (section === "skills" || section === "resume") return !isSkillsComplete();
                        return true;
                      });
                      const labels = [...new Set(
                        stillMissing.map((section) => MISSING_SECTION_LABELS[section] || section)
                      )];
                      if (!labels.length || submitted) return null;
                      return (
                        <p className={styles.docHelper}>
                          Missing sections:{" "}
                          <strong>{labels.join(", ")}</strong>
                        </p>
                      );
                    })()}

                    <form data-partner-coach onSubmit={handleNext}>
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
                                  label={isOcrMode ? "Upload CNIC for OCR" : "Attach CNIC"}
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
                                  required
                                  value={doc.document_number === "pending" ? "" : doc.document_number}
                                  error={fieldErrors.document_number}
                                  onChange={(e) => {
                                    const next = [...govDocs];
                                    next[index] = { ...next[index], doc_type: "cnic", document_number: e.target.value };
                                    setGovDocs(next);
                                    setFieldErrors((prev) => ({ ...prev, document_number: false }));
                                  }}
                                  wide
                                  {...fillAnimProps("document_number")}
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
                                required
                                value={personal.first_name}
                                error={fieldErrors.first_name}
                                onChange={(e) => {
                                  setPersonal({ ...personal, first_name: e.target.value });
                                  setFieldErrors((prev) => ({ ...prev, first_name: false }));
                                }}
                                {...fillAnimProps("first_name")}
                              />
                              <Field
                                styles={styles}
                                label="Last name"
                                required
                                value={personal.last_name}
                                error={fieldErrors.last_name}
                                onChange={(e) => {
                                  setPersonal({ ...personal, last_name: e.target.value });
                                  setFieldErrors((prev) => ({ ...prev, last_name: false }));
                                }}
                                {...fillAnimProps("last_name")}
                              />
                            </div>
                            <div className={styles.formGrid}>
                              <Field
                                styles={styles}
                                label="Father's name"
                                required
                                value={personal.father_name || ""}
                                error={fieldErrors.father_name}
                                onChange={(e) => {
                                  setPersonal({ ...personal, father_name: e.target.value });
                                  setFieldErrors((prev) => ({ ...prev, father_name: false }));
                                }}
                                {...fillAnimProps("father_name")}
                              />
                              <Field
                                styles={styles}
                                label="National ID / CNIC"
                                required
                                placeholder="XXXXX-XXXXXXX-X"
                                value={personal.national_id}
                                error={fieldErrors.national_id}
                                onChange={(e) => {
                                  // Strip everything except digits, then auto-format XXXXX-XXXXXXX-X
                                  const digits = e.target.value.replace(/[^0-9]/g, "").slice(0, 13);
                                  let formatted = digits;
                                  if (digits.length > 12) {
                                    formatted = `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
                                  } else if (digits.length > 5) {
                                    formatted = `${digits.slice(0, 5)}-${digits.slice(5)}`;
                                  }
                                  setPersonal({ ...personal, national_id: formatted });
                                  setFieldErrors((prev) => ({ ...prev, national_id: false }));
                                }}
                                {...fillAnimProps("national_id")}
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
                                required
                                value={personal.date_of_birth}
                                error={fieldErrors.date_of_birth}
                                onChange={(e) => {
                                  setPersonal({ ...personal, date_of_birth: e.target.value });
                                  setFieldErrors((prev) => ({ ...prev, date_of_birth: false }));
                                }}
                                {...fillAnimProps("date_of_birth")}
                              />
                              <label
                                className={`${styles.field} ${fieldErrors.gender ? styles.fieldError : ""} ${fillAnimLabelClass("gender")}`}
                                style={fillAnimLabelStyle("gender")}
                                data-field-error={fieldErrors.gender ? "true" : undefined}
                                data-ocr-key="gender"
                              >
                                <span>Gender <span style={{ color: "red", marginLeft: 4 }}>*</span></span>
                                <select value={personal.gender} onChange={(e) => { setPersonal({ ...personal, gender: e.target.value }); setFieldErrors((prev) => ({ ...prev, gender: false })); }}>
                                  <option value="male">Male</option>
                                  <option value="female">Female</option>
                                  <option value="other">Other</option>
                                  <option value="prefer_not_to_say">Prefer not to say</option>
                                </select>
                              </label>
                              <Field styles={styles} label="Nationality" required value={personal.nationality} error={fieldErrors.nationality} onChange={(e) => { setPersonal({ ...personal, nationality: e.target.value }); setFieldErrors((prev) => ({ ...prev, nationality: false })); }} {...fillAnimProps("nationality")} />
                              <label
                                className={`${styles.field} ${fillAnimLabelClass("marital_status")}`}
                                style={fillAnimLabelStyle("marital_status")}
                                data-ocr-key="marital_status"
                              >
                                <span>Marital status <span style={{ color: "red", marginLeft: 4 }}>*</span></span>
                                <select value={personal.marital_status} onChange={(e) => setPersonal({ ...personal, marital_status: e.target.value })}>
                                  <option value="single">Single</option>
                                  <option value="married">Married</option>
                                  <option value="divorced">Divorced</option>
                                  <option value="widowed">Widowed</option>
                                  <option value="other">Other</option>
                                </select>
                              </label>
                              <label className={`${styles.field} ${fieldErrors.blood_group ? styles.fieldError : ""}`} data-field-error={fieldErrors.blood_group ? "true" : undefined}>
                                <span>Blood group <span style={{ color: "red", marginLeft: 2 }}>*</span></span>
                                <select
                                  value={normalizeBloodGroup(personal.blood_group)}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setFieldErrors((prev) => ({ ...prev, blood_group: false }));
                                    if (val === "N/A" || val === personal.blood_group) {
                                      setPersonal({ ...personal, blood_group: val });
                                      return;
                                    }
                                    setBloodGroupPending({ value: val, previous: personal.blood_group });
                                  }}
                                >
                                  {BLOOD_GROUP_OPTIONS.map((g) => (
                                    <option key={g} value={g}>{g}</option>
                                  ))}
                                </select>
                                {fieldErrors.blood_group ? (
                                  <span style={{ color: "var(--error, red)", fontSize: 12 }}>{fieldErrors.blood_group}</span>
                                ) : (
                                  <small style={{ color: "var(--text-muted)", fontWeight: 500 }}>{BLOOD_GROUP_HINT}</small>
                                )}
                              </label>
                              <Field
                                styles={styles}
                                label="Alternate contact"
                                value={personal.alternate_phone}
                                onChange={(e) => setPersonal({ ...personal, alternate_phone: e.target.value })}
                              />
                              <Field styles={styles} label="ID issue date" value={personal.id_issue_date || ""} onChange={(e) => setPersonal({ ...personal, id_issue_date: e.target.value })} {...fillAnimProps("id_issue_date")} />
                              <Field styles={styles} label="ID expiry date" value={personal.id_expiry_date || ""} onChange={(e) => setPersonal({ ...personal, id_expiry_date: e.target.value })} {...fillAnimProps("id_expiry_date")} />
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
                                required
                                value={personal.current_address}
                                error={fieldErrors.current_address}
                                onChange={(e) => {
                                  setPersonal({ ...personal, current_address: e.target.value });
                                  setFieldErrors((prev) => ({ ...prev, current_address: false }));
                                }}
                                wide
                                {...fillAnimProps("current_address")}
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
                                  required
                                  value={personal.permanent_address}
                                  error={fieldErrors.permanent_address}
                                  onChange={(e) => {
                                    setPersonal({ ...personal, permanent_address: e.target.value });
                                    setFieldErrors((prev) => ({ ...prev, permanent_address: false }));
                                  }}
                                  wide
                                />
                              )}
                              <label className={`${styles.field} ${fieldErrors.country ? styles.fieldError : ""}`} data-field-error={fieldErrors.country ? "true" : undefined}>
                                <span>Country <span style={{ color: "red", marginLeft: 4 }}>*</span></span>
                                <select
                                  value={otherSelections.country || (personal.country && !COUNTRY_OPTIONS.includes(personal.country)) ? "other" : personal.country}
                                  onChange={(e) => {
                                    const isOther = e.target.value === "other";
                                    setOtherSelections((prev) => ({ ...prev, country: isOther, city: false, state: false }));
                                    setPersonal({ ...personal, country: isOther ? "" : e.target.value, city: "", state: "" });
                                    setEducationEntries((items) => items.map((item) => ({ ...item, institution: "" })));
                                    setFieldErrors((prev) => ({ ...prev, country: false, city: false }));
                                  }}
                                >
                                  {COUNTRY_OPTIONS.map((country) => <option key={country} value={country}>{country}</option>)}
                                  <option value="other">Other</option>
                                </select>
                                {(otherSelections.country || (personal.country && !COUNTRY_OPTIONS.includes(personal.country))) && (
                                  <input
                                    value={personal.country}
                                    onChange={(e) => setPersonal({ ...personal, country: e.target.value, city: "", state: "" })}
                                    placeholder="Enter country"
                                  />
                                )}
                                {fieldErrors.country && <em className={styles.fieldErrorText}>Required</em>}
                              </label>
                              {personal.country === "Pakistan" && (
                                <label className={`${styles.field} ${fieldErrors.city ? styles.fieldError : ""}`} data-field-error={fieldErrors.city ? "true" : undefined}>
                                  <span>City <span style={{ color: "red", marginLeft: 4 }}>*</span></span>
                                  <select
                                    value={otherSelections.city || (personal.city && !PAKISTANI_CITIES.includes(personal.city)) ? "other" : personal.city}
                                    onChange={(e) => {
                                      const isOther = e.target.value === "other";
                                      setOtherSelections((prev) => ({ ...prev, city: isOther }));
                                      setPersonal({ ...personal, city: isOther ? personal.city : e.target.value });
                                      setEducationEntries((items) => items.map((item) => ({ ...item, institution: "" })));
                                      setFieldErrors((prev) => ({ ...prev, city: false }));
                                    }}
                                  >
                                    <option value="">Select a city</option>
                                    {PAKISTANI_CITIES.map((city) => <option key={city} value={city}>{city}</option>)}
                                    <option value="other">Other</option>
                                  </select>
                                  {(otherSelections.city || (personal.city && !PAKISTANI_CITIES.includes(personal.city))) && (
                                    <input
                                      value={personal.city}
                                      onChange={(e) => {
                                        setPersonal({ ...personal, city: e.target.value });
                                        setEducationEntries((items) => items.map((item) => ({ ...item, institution: "" })));
                                      }}
                                      placeholder="Enter city"
                                    />
                                  )}
                                  {fieldErrors.city && <em className={styles.fieldErrorText}>Required</em>}
                                </label>
                              )}
                              {personal.country === "Pakistan" ? (
                                <label className={`${styles.field} ${fieldErrors.state ? styles.fieldError : ""}`} data-field-error={fieldErrors.state ? "true" : undefined}>
                                  <span>State / Province <span style={{ color: "red", marginLeft: 4 }}>*</span></span>
                                  <select
                                    value={otherSelections.state || (personal.state && !PAKISTANI_PROVINCES.includes(personal.state)) ? "other" : personal.state}
                                    onChange={(e) => {
                                      const isOther = e.target.value === "other";
                                      setOtherSelections((prev) => ({ ...prev, state: isOther }));
                                      setPersonal({ ...personal, state: isOther ? personal.state : e.target.value });
                                      setFieldErrors((prev) => ({ ...prev, state: false }));
                                    }}
                                  >
                                    <option value="">Select a province</option>
                                    {PAKISTANI_PROVINCES.map((province) => <option key={province} value={province}>{province}</option>)}
                                    <option value="other">Other</option>
                                  </select>
                                  {(otherSelections.state || (personal.state && !PAKISTANI_PROVINCES.includes(personal.state))) && (
                                    <input value={personal.state} onChange={(e) => setPersonal({ ...personal, state: e.target.value })} placeholder="Enter province" />
                                  )}
                                  {fieldErrors.state && <em className={styles.fieldErrorText}>Required</em>}
                                </label>
                              ) : (
                                <Field styles={styles} label="State / Province" required value={personal.state} error={fieldErrors.state} onChange={(e) => { setPersonal({ ...personal, state: e.target.value }); setFieldErrors((prev) => ({ ...prev, state: false })); }} />
                              )}
                              <Field styles={styles} label="Postal code" required value={personal.postal_code} error={fieldErrors.postal_code} onChange={(e) => { setPersonal({ ...personal, postal_code: e.target.value }); setFieldErrors((prev) => ({ ...prev, postal_code: false })); }} />
                            </div>
                          </section>
                        </div>
                      )}

                      {step === "education" && (
                        <div className={styles.formStack}>
                          <h2 className={styles.stepTitle}>Education history</h2>
                          
                          {educationEntries.map((entry, index) => (
                            <section key={index} className={styles.sectionCard}>
                              <div className={styles.sectionCardHead}>
                                <div>
                                  <h3>Education {educationEntries.length > 1 ? `#${index + 1}` : "entry"}</h3>
                                  <p>Institution, city, degree, and transcript</p>
                                </div>
                                {entry.certificate_file && <span className={styles.pillOk}>Transcript uploaded</span>}
                              </div>
                              <div className={styles.formGrid}>
                                <FileUploadField
                                  styles={styles}
                                  label="Academic transcript / certificate"
                                  accept=".pdf,.jpg,.jpeg,.png"
                                  disabled={uploading}
                                  onChange={(e) => handleFileUpload(e, "education_cert", index)}
                                  onRemove={() => handleFileRemove("education_cert", index)}
                                  fileUrl={entry.certificate_file}
                                  hint="PDF, JPG, or PNG"
                                  wide
                                />
                                <UniversityAutocomplete
                                  value={entry.institution || ""}
                                  onChange={(val) => {
                                    const next = [...educationEntries];
                                    next[index] = { ...next[index], institution: val };
                                    setEducationEntries(next);
                                    setFieldErrors((prev) => ({ ...prev, [`edu_${index}_institution`]: false }));
                                  }}
                                  error={!!fieldErrors[`edu_${index}_institution`]}
                                  styles={styles}
                                  fillAnimClass={fillAnimLabelClass(`edu_${index}_institution`)}
                                  fillAnimStyle={fillAnimLabelStyle(`edu_${index}_institution`)}
                                  dataOcrKey={`edu_${index}_institution`}
                                />
                                <Field
                                  styles={styles}
                                  label="City"
                                  required
                                  value={entry.city || ""}
                                  error={fieldErrors[`edu_${index}_city`]}
                                  onChange={(e) => {
                                    const next = [...educationEntries];
                                    next[index] = { ...next[index], city: e.target.value };
                                    setEducationEntries(next);
                                    setFieldErrors((prev) => ({ ...prev, [`edu_${index}_city`]: false }));
                                  }}
                                  {...fillAnimProps(`edu_${index}_city`)}
                                />
                                <Field styles={styles} label="Degree" required value={entry.degree || ""} onChange={(e) => {
                                  const next = [...educationEntries];
                                  next[index] = { ...next[index], degree: e.target.value };
                                  setEducationEntries(next);
                                }} {...fillAnimProps(`edu_${index}_degree`)} />
                                <Field styles={styles} label="Major / Field of study" required value={entry.field_of_study || ""} onChange={(e) => {
                                  const next = [...educationEntries];
                                  next[index] = { ...next[index], field_of_study: e.target.value };
                                  setEducationEntries(next);
                                }} {...fillAnimProps(`edu_${index}_field_of_study`)} />
                                <Field styles={styles} label="Year completed" required value={entry.year_completed || ""} onChange={(e) => {
                                  const next = [...educationEntries];
                                  next[index] = { ...next[index], year_completed: e.target.value };
                                  setEducationEntries(next);
                                }} {...fillAnimProps(`edu_${index}_year_completed`)} />
                                <Field styles={styles} label="CGPA / Percentage" value={entry.cgpa_or_percentage || ""} onChange={(e) => {
                                  const next = [...educationEntries];
                                  next[index] = { ...next[index], cgpa_or_percentage: e.target.value };
                                  setEducationEntries(next);
                                }} {...fillAnimProps(`edu_${index}_cgpa_or_percentage`)} />
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
                            {isOcrMode
                              ? "Upload your resume and we'll extract your summary, skills, and certifications into the fields below. Review and edit anything that needs a tweak."
                              : "Select your skills from the lists below or add custom certifications. Attach a resume if you have one."}
                          </p>

                          <section className={styles.sectionCard}>
                            <div className={styles.sectionCardHead}>
                              <div>
                                <h3>Resume &amp; summary</h3>
                              </div>
                              {resume.file_url && <span className={styles.pillOk}>Resume uploaded</span>}
                            </div>
                            <div className={styles.formGrid}>
                              <FileUploadField
                                styles={styles}
                                label="Resume / CV"
                                accept=".pdf,.doc,.docx"
                                disabled={uploading}
                                onChange={(e) => handleFileUpload(e, "resume")}
                                onRemove={() => handleFileRemove("resume")}
                                fileUrl={resume.file_url}
                                fileName={resume.file_name}
                                hint="PDF, DOC, or DOCX"
                                wide
                              />
                              <label
                                className={`${styles.field} ${styles.wide} ${fillAnimLabelClass("summary")}`}
                                style={fillAnimLabelStyle("summary")}
                                data-ocr-key="summary"
                              >
                                <span>Professional summary <span style={{ color: "red", marginLeft: 4 }}>*</span></span>
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

                          {/* Technical Skills Pills */}
                          <section className={styles.sectionCard}>
                            <div className={styles.sectionCardHead}>
                              <div>
                                <h3>Technical Skills</h3>
                                <p>Select all that apply</p>
                              </div>
                            </div>
                            <div className={styles.skillsPillContainer}>
                              {TECHNICAL_SKILLS.map(skill => (
                                <button
                                  type="button"
                                  key={skill}
                                  className={`${styles.skillPill} ${skills.technical_skills.includes(skill) ? styles.skillPillSelected : ""}`}
                                  onClick={() => toggleSkill(skill, "technical_skills")}
                                >
                                  {skill}
                                </button>
                              ))}
                            </div>
                          </section>

                          {/* Soft Skills Pills */}
                          <section className={styles.sectionCard}>
                            <div className={styles.sectionCardHead}>
                              <div>
                                <h3>Soft Skills</h3>
                                <p>Select all that apply</p>
                              </div>
                            </div>
                            <div className={styles.skillsPillContainer}>
                              {SOFT_SKILLS.map(skill => (
                                <button
                                  type="button"
                                  key={skill}
                                  className={`${styles.skillPill} ${skills.soft_skills.includes(skill) ? styles.skillPillSelected : ""}`}
                                  onClick={() => toggleSkill(skill, "soft_skills")}
                                >
                                  {skill}
                                </button>
                              ))}
                            </div>
                          </section>

                          {/* Certifications */}
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
                                <FileUploadField
                                  styles={styles}
                                  wide
                                  label="Certificate file"
                                  accept=".pdf,.png,.jpg,.jpeg"
                                  disabled={uploading}
                                  fileUrl={cert.document_url}
                                  hint="Upload the certificate so your recruiter can open and verify it"
                                  onChange={(e) => handleFileUpload(e, "skill_cert", index)}
                                  onRemove={
                                    cert.document_url
                                      ? () => handleFileRemove("skill_cert", index)
                                      : undefined
                                  }
                                />
                                <Field
                                  styles={styles}
                                  wide
                                  label="Certificate URL (optional)"
                                  value={cert.document_url || ""}
                                  hint="Paste a public link, or upload a file above — recruiters use this URL to open and verify"
                                  onChange={(e) => {
                                    const next = [...skills.certifications];
                                    next[index] = { ...next[index], document_url: e.target.value.trim() || null };
                                    setSkills({ ...skills, certifications: next });
                                  }}
                                />
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
                                ["Blood group", normalizeBloodGroup(personal.blood_group)],
                                ["National ID / CNIC", personal.national_id],
                                ["Alternate contact", personal.alternate_phone],
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
                                      <ReviewRow styles={styles} label="Institute / University" value={entry.institution} />
                                      <ReviewRow styles={styles} label="City" value={entry.city} />
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
                                ["Technical skills", joinList(skills.technical_skills), true],
                                ["Soft skills", joinList(skills.soft_skills), true],
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

      {ocrSession ? (
        <OcrScanOverlay
          open
          title={ocrSession.scanning ? "Reading your document" : "Filling your form"}
          subtitle={`${ocrSession.docLabel} · ${ocrSession.stage || "extracting fields"}`}
          previewUrl={ocrSession.previewUrl}
          fileName={ocrSession.fileName}
          scanning={ocrSession.scanning}
          stage={ocrSession.stage}
          fieldDefs={ocrSession.fieldDefs}
          typedValues={ocrSession.typedValues}
          revealed={ocrSession.revealed}
          typingKey={ocrSession.typingKey}
          confidence={ocrSession.confidence}
          progress={ocrSession.progress}
          error={ocrSession.error}
        />
      ) : null}

      {uploading && !ocrSession && (
        <div className={styles.processOverlay} role="status" aria-live="polite" data-mascot-busy>
          <div className={styles.processCard}>
            <div className={styles.processSpinner} aria-hidden />
            <strong>
              {uploadPhase.includes("Removing")
                ? "Removing document"
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

      <ConfirmDialog
        open={!!bloodGroupPending}
        title="Confirm blood group"
        message={`You selected blood group ${bloodGroupPending?.value}. Blood group information is critical for medical emergencies — are you sure this is correct?`}
        confirmLabel="Yes, set blood group"
        cancelLabel="Keep current"
        onConfirm={() => {
          setPersonal({ ...personal, blood_group: bloodGroupPending.value });
          setBloodGroupPending(null);
        }}
        onCancel={() => {
          setBloodGroupPending(null);
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
        <li>You&apos;ll then complete a short post-hire profile (emergency contact, banking, references, Self Declaration).</li>
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

function Field({ label, name, value, onChange, type = "text", wide, styles, error, hint, required, fillAnim, fillDelay, ocrKey, ocrTyping }) {
  const safeValue = value ?? "";
  return (
    <label
      className={`${styles.field} ${wide ? styles.wide : ""} ${error ? styles.fieldError : ""} ${fillAnim ? styles.fieldFillAnim : ""} ${ocrTyping ? styles.fieldOcrTyping : ""}`}
      style={fillAnim && fillDelay != null ? { animationDelay: `${fillDelay}ms` } : undefined}
      data-field-error={error ? "true" : undefined}
      data-ocr-key={ocrKey || undefined}
    >
      <span>{label}{required && <span style={{ color: "red", marginLeft: 4 }}>*</span>}</span>
      <input name={name} type={type} value={safeValue} onChange={onChange} aria-invalid={!!error} aria-busy={ocrTyping || undefined} />
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

function ScanFillBanner({ styles, result, filledCount = 0, onDismiss }) {
  const [stableCount] = useState(filledCount);
  if (!result) return null;
  const rejected = result.status === "rejected_type" || result.accepted === false;
  const category = result.category && result.category !== "unknown"
    ? String(result.category).replace(/_/g, " ")
    : null;
  const extractConf = result.extraction_confidence;
  const classConf = result.classification_confidence;
  const count = stableCount || filledCount;

  return (
    <div
      className={`${styles.scanBanner} ${rejected ? styles.scanBannerError : styles.scanBannerOk}`}
      role="status"
    >
      <div className={styles.scanBannerGlow} aria-hidden />
      <div className={styles.scanBannerIcon} aria-hidden>
        {rejected ? "!" : "✓"}
      </div>
      <div className={styles.scanBannerBody}>
        <strong>{rejected ? "Document not accepted" : "Scan complete — filling your form"}</strong>
        <p>
          {rejected
            ? result.rejection_message || "Please upload a clearer National ID (CNIC) image."
            : count > 0
              ? `We extracted details${category ? ` from your ${category}` : ""} and animated them into ${count} field${count === 1 ? "" : "s"} below. Everything stays editable.`
              : result.quality_warning ||
                "Document saved. Review the fields below and complete anything missing."}
        </p>
        {!rejected && (classConf != null || extractConf != null) && (
          <span className={styles.scanBannerMeta}>
            {classConf != null && <>Match {Math.round(classConf * 100)}%</>}
            {classConf != null && extractConf != null && " · "}
            {extractConf != null && <>Extract {Math.round(extractConf * 100)}%</>}
          </span>
        )}
      </div>
      <button type="button" className={styles.scanBannerClose} onClick={onDismiss} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}

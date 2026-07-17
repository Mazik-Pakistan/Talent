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
  { id: "skills", label: "Skills" },
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
  const [message, setMessage] = useState("");
  const [candidate, setCandidate] = useState(null);
  const [onboarding, setOnboarding] = useState(null);
  const [progress, setProgress] = useState(null);
  const [step, setStep] = useState("personal");
  const [personal, setPersonal] = useState(emptyPersonal);
  const [educationEntries, setEducationEntries] = useState([{ ...emptyEducationEntry }]);
  const [skills, setSkills] = useState(emptySkills);
  const [govDocs, setGovDocs] = useState([{ ...emptyGovDoc }]);
  const [resume, setResume] = useState(emptyResume);
  const [extractionPreview, setExtractionPreview] = useState(null);
  const [documentVerification, setDocumentVerification] = useState(null);
  const [autoFilledKeys, setAutoFilledKeys] = useState([]);

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
          doc_type: d.doc_type === "passport" ? "passport" : "cnic",
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

  function autoFillFromOCR(ocrResult, purpose, index) {
    if (!ocrResult || ocrResult.status !== "completed" || ocrResult.accepted === false) return;
    const { category, fields } = ocrResult;
    if (!fields) return;
    const filled = [];

    if (purpose === "government_doc" && (category === "cnic" || category === "passport")) {
      const first = fields.first_name || (fields.name || fields.full_name || "").toString().split(/\s+/)[0] || "";
      const last =
        fields.last_name ||
        (fields.name || fields.full_name || "")
          .toString()
          .split(/\s+/)
          .slice(1)
          .join(" ") ||
        "";
      const idNumber = category === "cnic" ? fields.cnic_number : fields.passport_number;

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
        const dateOfBirth = normalizeDateForInput(fields.date_of_birth);
        if (dateOfBirth && !prev.date_of_birth) {
          next.date_of_birth = dateOfBirth;
          filled.push("date_of_birth");
        }
        const gender = normalizeGender(fields.gender);
        if (gender && (!prev.gender || prev.gender === "prefer_not_to_say")) {
          next.gender = gender;
          filled.push("gender");
        }
        if (fields.nationality && (!prev.nationality || prev.nationality === "Pakistani")) {
          next.nationality = fields.nationality;
          filled.push("nationality");
        }
        const marital = normalizeMarital(fields.marital_status);
        if (marital && prev.marital_status === "single") {
          next.marital_status = marital;
          filled.push("marital_status");
        }
        if (idNumber && !prev.national_id) {
          next.national_id = idNumber;
          filled.push("national_id");
        }
        if (fields.father_name && !prev.father_name) {
          next.father_name = fields.father_name;
          filled.push("father_name");
        }
        if (fields.issue_date && !prev.id_issue_date) {
          next.id_issue_date = fields.issue_date;
          filled.push("id_issue_date");
        }
        if (fields.expiry_date && !prev.id_expiry_date) {
          next.id_expiry_date = fields.expiry_date;
          filled.push("id_expiry_date");
        }
        return next;
      });

      if (idNumber) {
        setGovDocs((prev) => {
          const next = [...prev];
          next[index] = {
            ...next[index],
            doc_type: category === "passport" ? "passport" : "cnic",
            document_number:
              next[index].document_number && next[index].document_number !== "pending"
                ? next[index].document_number
                : idNumber,
          };
          return next;
        });
        filled.push("document_number");
      }
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
        next[index] = {
          ...cur,
          institution: cur.institution || fields.institute || "",
          board_university: cur.board_university || fields.institute || "",
          degree: cur.degree || fields.degree || fields.program || "",
          field_of_study: cur.field_of_study || fields.major || fields.program || "",
          year_completed: cur.year_completed || String(fields.passing_year || "").slice(0, 4) || "",
          cgpa_or_percentage:
            cur.cgpa_or_percentage || fields.cgpa || fields.gpa || fields.percentage || "",
        };
        filled.push("education_transcript");
        return next;
      });
    }

    setAutoFilledKeys(filled);
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
    const existingUrl =
      purpose === "resume"
        ? resume.file_url
        : purpose === "government_doc"
          ? govDocs[index]?.file_url
          : purpose === "education_cert"
            ? educationEntries[index]?.certificate_file
            : null;
    if (
      existingUrl &&
      !window.confirm(
        "This will replace the current document. Extracted differences will be reviewed, and existing profile values will only fill when fields are empty. Continue?"
      )
    ) {
      event.target.value = "";
      return;
    }
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
      if (data.onboarding) hydrateForms(data.onboarding);

      const ocr = data.ocr_result;
      if (ocr?.status === "rejected_type" || ocr?.accepted === false) {
        setMessage(ocr.rejection_message || data.message || "Document type rejected.");
        setExtractionPreview(ocr);
        return;
      }

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

      if (data.document_verification) {
        setDocumentVerification(data.document_verification);
      }

      if (ocr) {
        autoFillFromOCR(ocr, purpose, index);
        setExtractionPreview(ocr);
        const cat = ocr.category;
        const ok = ocr.status === "completed";
        setMessage(
          ok
            ? `File uploaded. Document recognised as "${cat}" — fields auto-filled below. Review and adjust before saving.`
            : ocr.rejection_message || "File uploaded. Text extraction failed — please fill in the fields manually."
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
      const requiredOk =
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
        personal.country;
      if (!requiredOk) {
        setMessage("Please complete all required personal & contact fields.");
        return;
      }
      const payload = {
        ...personal,
        permanent_address: personal.same_as_current ? personal.current_address : personal.permanent_address,
        alternate_phone: personal.alternate_phone || null,
        profile_picture: personal.profile_picture || null,
      };
      await persist({ step: "personal", personal: payload });
    } else if (step === "education") {
      const valid = educationEntries.every(
        (entry) => entry.institution && entry.degree && entry.field_of_study && entry.year_completed
      );
      if (!valid) {
        setMessage("Add at least one complete education entry.");
        return;
      }
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
        setMessage("Add at least one skill, language, or certification.");
        return;
      }
      await persist({
        step: "skills",
        skills: { technical_skills, soft_skills, languages, certifications },
      });
    } else if (step === "government_docs") {
      const valid = govDocs.every((doc) => doc.doc_type && doc.document_number && doc.file_url);
      if (!valid) {
        setMessage("Add your ID number and upload the document file.");
        return;
      }
      const sanitized = govDocs.map((d) => ({
        ...d,
        doc_type: d.doc_type === "passport" ? "passport" : "cnic",
      }));
      await persist({ step: "government_docs", government_docs: { documents: sanitized } });
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

            {extractionPreview && <ExtractionPreview result={extractionPreview} onDismiss={() => setExtractionPreview(null)} />}

                    {autoFilledKeys.length > 0 && (
                      <p className={styles.docHelper} style={{ background: "#ecfdf5", color: "#166534", padding: "8px 10px", borderRadius: 6 }}>
                        AI auto-filled: {autoFilledKeys.map((key) => key.replace(/_/g, " ")).join(", ")}. All values remain editable.
                      </p>
                    )}

                    {progress?.missing_fields?.length > 0 && !submitted && (
                      <p className={styles.docHelper}>
                        Missing sections: <strong>{progress.missing_fields.join(", ")}</strong>
                      </p>
                    )}

                    <form onSubmit={handleNext}>
                      {step === "personal" && (
                        <div className={styles.formGrid}>
                          <h2 className={styles.stepTitle}>Personal &amp; contact information</h2>
                          <Field styles={styles} label="First name" value={personal.first_name} onChange={(e) => setPersonal({ ...personal, first_name: e.target.value })} />
                          <Field styles={styles} label="Last name" value={personal.last_name} onChange={(e) => setPersonal({ ...personal, last_name: e.target.value })} />
                          <Field styles={styles} label="Date of birth" type="date" value={personal.date_of_birth} onChange={(e) => setPersonal({ ...personal, date_of_birth: e.target.value })} />
                          <label className={styles.field}>
                            <span>Gender</span>
                            <select value={personal.gender} onChange={(e) => setPersonal({ ...personal, gender: e.target.value })}>
                              <option value="male">Male</option>
                              <option value="female">Female</option>
                              <option value="other">Other</option>
                              <option value="prefer_not_to_say">Prefer not to say</option>
                            </select>
                          </label>
                          <Field styles={styles} label="Nationality" value={personal.nationality} onChange={(e) => setPersonal({ ...personal, nationality: e.target.value })} />
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
                          <Field styles={styles} label="National ID / CNIC / Passport" value={personal.national_id} onChange={(e) => setPersonal({ ...personal, national_id: e.target.value })} />
                          <Field styles={styles} label="Father's name (optional)" value={personal.father_name || ""} onChange={(e) => setPersonal({ ...personal, father_name: e.target.value })} />
                          <Field styles={styles} label="ID issue date (optional)" value={personal.id_issue_date || ""} onChange={(e) => setPersonal({ ...personal, id_issue_date: e.target.value })} />
                          <Field styles={styles} label="ID expiry date (optional)" value={personal.id_expiry_date || ""} onChange={(e) => setPersonal({ ...personal, id_expiry_date: e.target.value })} />
                          <Field styles={styles} label="Alternate phone" value={personal.alternate_phone} onChange={(e) => setPersonal({ ...personal, alternate_phone: e.target.value })} />
                          <Field styles={styles} label="Current address" value={personal.current_address} onChange={(e) => setPersonal({ ...personal, current_address: e.target.value })} wide />
                          <label className={`${styles.field} ${styles.wide}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <input
                              type="checkbox"
                              checked={!!personal.same_as_current}
                              onChange={(e) => setPersonal({ ...personal, same_as_current: e.target.checked, permanent_address: e.target.checked ? personal.current_address : personal.permanent_address })}
                            />
                            <span>Permanent address same as current</span>
                          </label>
                          {!personal.same_as_current && (
                            <Field styles={styles} label="Permanent address" value={personal.permanent_address} onChange={(e) => setPersonal({ ...personal, permanent_address: e.target.value })} wide />
                          )}
                          <Field styles={styles} label="City" value={personal.city} onChange={(e) => setPersonal({ ...personal, city: e.target.value })} />
                          <Field styles={styles} label="State / Province" value={personal.state} onChange={(e) => setPersonal({ ...personal, state: e.target.value })} />
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
                              <label className={`${styles.field} ${styles.wide}`}>
                                <span>Academic transcript (PDF, JPG, or PNG)</span>
                                <input type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={uploading} onChange={(e) => handleFileUpload(e, "education_cert", index)} />
                                {entry.certificate_file && <small>Uploaded: {entry.certificate_file}</small>}
                              </label>
                              {educationEntries.length > 1 && (
                                <button
                                  type="button"
                                  className={styles.secondaryButton}
                                  onClick={() => setEducationEntries((c) => c.filter((_, i) => i !== index))}
                                >
                                  Remove entry
                                </button>
                              )}
                            </div>
                          ))}
                          <button type="button" className={styles.secondaryButton} onClick={() => setEducationEntries((c) => [...c, { ...emptyEducationEntry }])}>
                            Add another education entry
                          </button>
                        </div>
                      )}

                      {step === "skills" && (
                        <div className={styles.formGrid}>
                          <h2 className={styles.stepTitle}>Skills &amp; certifications</h2>
                          <Field styles={styles} label="Technical skills (comma-separated)" value={skills.technical_skills} onChange={(e) => setSkills({ ...skills, technical_skills: e.target.value })} wide />
                          <Field styles={styles} label="Soft skills (comma-separated)" value={skills.soft_skills} onChange={(e) => setSkills({ ...skills, soft_skills: e.target.value })} wide />
                          <Field styles={styles} label="Languages (comma-separated)" value={skills.languages} onChange={(e) => setSkills({ ...skills, languages: e.target.value })} wide />
                          <h3 className={styles.wide}>Certifications</h3>
                          {(skills.certifications || []).map((cert, index) => (
                            <div key={index} className={`${styles.formGrid} ${styles.educationEntry} ${styles.wide}`}>
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
                              <p className={`${styles.docHelper} ${styles.wide}`}>
                                Certification details may be extracted from your resume. Separate certificate documents are not accepted.
                              </p>
                              {(skills.certifications || []).length > 1 && (
                                <button
                                  type="button"
                                  className={styles.secondaryButton}
                                  onClick={() => setSkills({ ...skills, certifications: skills.certifications.filter((_, i) => i !== index) })}
                                >
                                  Remove certification
                                </button>
                              )}
                            </div>
                          ))}
                          <button
                            type="button"
                            className={styles.secondaryButton}
                            onClick={() => setSkills({ ...skills, certifications: [...(skills.certifications || []), { name: "", document_url: null, expiry_date: "" }] })}
                          >
                            Add certification
                          </button>
                        </div>
                      )}

                      {step === "government_docs" && (
                        <div>
                          <h2 className={styles.stepTitle}>Government identity documents</h2>
                          <p className={styles.docHelper}>
                            Upload a National ID (CNIC/NIC) or Passport (for foreigners). Wrong document types are rejected.
                            Extracted fields auto-fill your profile and stay editable.
                          </p>
                          {govDocs.map((doc, index) => (
                            <div key={index} className={`${styles.formGrid} ${styles.govDocEntry}`}>
                              <label className={styles.field}>
                                <span>Document type</span>
                                <select
                                  value={doc.doc_type === "other_id" ? "cnic" : doc.doc_type}
                                  onChange={(e) => {
                                    const next = [...govDocs];
                                    next[index] = { ...next[index], doc_type: e.target.value };
                                    setGovDocs(next);
                                  }}
                                >
                                  <option value="cnic">National ID (CNIC / NIC)</option>
                                  <option value="passport">Passport</option>
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
                            <span>Upload resume / CV (PDF/DOC/DOCX)</span>
                            <input type="file" accept=".pdf,.doc,.docx" disabled={uploading} onChange={(e) => handleFileUpload(e, "resume")} />
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
                            <ReviewBlock styles={styles} title="Personal" items={Object.entries(personal).filter(([k]) => !["address_line1", "address_line2"].includes(k))} />
                            <ReviewBlock styles={styles} title="Education entries" items={[["count", String(educationEntries.length)]]} />
                            <ReviewBlock styles={styles} title="Skills" items={[["technical", skills.technical_skills || "—"], ["soft", skills.soft_skills || "—"]]} />
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

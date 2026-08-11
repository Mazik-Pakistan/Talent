"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";

import {
  deleteDocument,
  getApiErrorMessage,
  getDocumentDownloadUrl,
  listMyDocuments,
  reextractDocument,
  uploadDocument,
  uploadOnboardingFile,
} from "@/services/authService";
import StatusBadge from "@/components/StatusBadge";
import FileUploadField from "@/components/FileUploadField";
import { invalidateInsightCache } from "@/lib/ai/employeeInsights";
import { invalidateCandidateInsightCache } from "@/lib/ai/candidateInsights";
import { COPILOT_DOCUMENTS_ASSIST_EVENT, publishGuideContext } from "@/lib/ai/guideContext";
import { publishCandidateContext } from "@/lib/ai/candidateContext";
import {
  buildDocumentStatusInsights,
  classifyDocuments,
} from "@/lib/ai/documentStatusInsights";

const CATEGORY_OPTIONS = [
  { value: "all", label: "All documents" },
  { value: "identity", label: "Identity" },
  { value: "education", label: "Education" },
  { value: "employment", label: "Employment" },
  { value: "banking", label: "Banking" },
  { value: "legal", label: "Legal" },
  { value: "other", label: "Other" },
];

const DOC_TYPE_OPTIONS_BY_CATEGORY = {
  identity: [
    { value: "cnic", label: "National ID (CNIC / NIC)" },
  ],
  education: [
    { value: "transcript", label: "Academic Transcript" },
  ],
  employment: [
    { value: "other", label: "Employment document" },
  ],
  banking: [
    { value: "other", label: "Banking document" },
  ],
  legal: [
    { value: "other", label: "Legal document" },
  ],
  other: [
    { value: "resume", label: "Resume / CV" },
    { value: "other", label: "Other document" },
  ],
};

const DOC_TYPE_LABELS = {
  cnic: "National ID (CNIC / NIC)",
  passport: "Passport",
  transcript: "Academic Transcript",
  resume: "Resume / CV",
  other: "Other document",
};

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "pending", label: "Pending review" },
  { value: "verified", label: "Verified" },
  { value: "rejected", label: "Needs re-upload" },
];

const STATUS_GROUPS = {
  pending: new Set(["pending", "processing", "uploaded", "sent", "pending_verification", "viewed", "incomplete"]),
  verified: new Set(["verified", "signed", "approved", "complete"]),
  rejected: new Set(["rejected", "reupload_required", "declined", "expired", "mismatch"]),
};

const STATUS_DISPLAY = {
  pending_verification: "Pending review",
  pending: "Pending review",
  processing: "Pending review",
  uploaded: "Pending review",
  verified: "Verified",
  rejected: "Rejected",
  reupload_required: "Re-upload required",
  mismatch: "Needs attention",
};

function matchesStatusFilter(status, filter) {
  if (filter === "all") return true;
  return STATUS_GROUPS[filter]?.has(status) ?? false;
}

function displayStatusLabel(status) {
  const key = String(status || "").toLowerCase();
  return STATUS_DISPLAY[key] || (status ? String(status).replace(/_/g, " ") : "Pending review");
}

const CATEGORY_LABELS = {
  identity: "Identity",
  education: "Education",
  employment: "Employment",
  banking: "Banking",
  legal: "Legal",
  other: "Other",
};

function isIdentityDocType(docType) {
  return docType === "cnic" || docType === "passport";
}

function docTypeLabel(type, categoryHint = null) {
  if (categoryHint && DOC_TYPE_OPTIONS_BY_CATEGORY[categoryHint]) {
    const match = DOC_TYPE_OPTIONS_BY_CATEGORY[categoryHint].find((option) => option.value === type);
    if (match) return match.label;
  }
  // Prefer a specific category option when several categories share doc_type "other".
  for (const options of Object.values(DOC_TYPE_OPTIONS_BY_CATEGORY)) {
    const match = options.find((option) => option.value === type && option.value !== "other");
    if (match && type === match.value && type !== "other") return match.label;
  }
  return DOC_TYPE_LABELS[type] || String(type || "Document").replace(/_/g, " ");
}


const CATEGORY_ICONS = {
  identity: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  education: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
      <path d="M6 12v5c0 2 6 3 6 3s6-1 6-3v-5" />
    </svg>
  ),
  employment: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  ),
  banking: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  ),
  legal: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  other: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  ),
};

const ACTION_ICONS = {
  view: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  download: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  reextract: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  ),
  replace: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  ),
  delete: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  ),
};

const STATUS_COLORS = {
  pending: { bg: "#fff8eb", text: "#9a6700", border: "#f5d98a" },
  verified: { bg: "#e3f8f0", text: "#0d8a5f", border: "#a3dfc7" },
  rejected: { bg: "#fef2f1", text: "#b42318", border: "#f0b4b0" },
};

function statusStyle(status) {
  const key = String(status || "").toLowerCase();
  if (STATUS_GROUPS.pending.has(key)) return STATUS_COLORS.pending;
  if (STATUS_GROUPS.verified.has(key)) return STATUS_COLORS.verified;
  if (STATUS_GROUPS.rejected.has(key)) return STATUS_COLORS.rejected;
  return STATUS_COLORS.pending;
}

// Ring geometry for the hero verification indicator.
const RING_RADIUS = 34;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export default function DocumentManager({ styles, onChanged, compact = false }) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [activeStatus, setActiveStatus] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showUploader, setShowUploader] = useState(false);
  const [category, setCategory] = useState("identity");
  const [docType, setDocType] = useState("cnic");
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [uploadMessage, setUploadMessage] = useState(null);
  const [actionBusyId, setActionBusyId] = useState(null);
  const [replacementDocId, setReplacementDocId] = useState(null);
  const [replacementFile, setReplacementFile] = useState(null);
  const [replacementUploadingId, setReplacementUploadingId] = useState(null);
  const [replacementMessage, setReplacementMessage] = useState(null);
  const fileInputRef = useRef(null);
  const replacementInputRef = useRef(null);

  const loadDocuments = useCallback(() => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setLoading(true);
    listMyDocuments(accessToken)
      .then((data) => {
        const docs = data.documents || [];
        setDocuments(docs);
        const classified = classifyDocuments(docs);
        const tip = buildDocumentStatusInsights(docs, { audience: "self" })[0];
        const role = (() => {
          try {
            return JSON.parse(localStorage.getItem("user") || "null")?.role;
          } catch {
            return null;
          }
        })();
        const shortHint = classified.problem.length
          ? `${classified.problem.length} document${classified.problem.length === 1 ? "" : "s"} need attention on this page.`
          : classified.pending.length
            ? `${classified.pending.length} document${classified.pending.length === 1 ? "" : "s"} awaiting review.`
            : classified.verified.length
              ? "Documents on this page look verified."
              : "Upload identity and employment files, then track verification status here.";
        const payload = {
          pathname: "/documents",
          section: "documents",
          formId: "documents",
          documents: docs,
          problemCount: classified.problem.length,
          hint: shortHint,
          tipId: tip?.id || null,
        };
        if (role === "candidate") {
          const prev =
            typeof window !== "undefined" ? window.__talentCandidateMascotContext || {} : {};
          publishCandidateContext({ ...prev, ...payload });
        } else if (role === "employee") {
          const prev =
            typeof window !== "undefined" ? window.__talentAiGuideContext || {} : {};
          publishGuideContext({ ...prev, ...payload });
        }
      })
      .catch((err) => setError(getApiErrorMessage(err, "Unable to load documents.")))
      .finally(() => setLoading(false));
  }, []);

  function refreshPartnerInsights() {
    invalidateInsightCache();
    invalidateCandidateInsightCache();
  }

  function derivePurpose(docType) {
    if (docType === "resume") return "resume";
    if (docType === "transcript") return "education_cert";
    if (docType === "cnic" || docType === "passport") return "government_doc";
    return null;
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadDocuments();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDocuments]);

  // Copilot can focus problem documents without leaving this page.
  useEffect(() => {
    const onAssist = (event) => {
      const detail = event.detail || {};
      if (detail.status) setActiveStatus(detail.status);
      if (detail.category) setActiveCategory(detail.category);
      if (detail.search != null) setSearchQuery(detail.search);
      if (detail.openUploader) setShowUploader(true);
      if (detail.replaceDocId) setReplacementDocId(detail.replaceDocId);
      window.setTimeout(() => {
        document.querySelector(".document-filter-group, .document-list, [class*='document']")
          ?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      }, 80);
    };
    window.addEventListener(COPILOT_DOCUMENTS_ASSIST_EVENT, onAssist);
    return () => window.removeEventListener(COPILOT_DOCUMENTS_ASSIST_EVENT, onAssist);
  }, []);

  const groupedDocuments = useMemo(() => {
    const filtered = documents.filter((doc) => {
      const categoryValue = doc.category || inferCategory(doc.doc_type);
      const matchesCategory = activeCategory === "all" || categoryValue === activeCategory;
      const matchesStatus = matchesStatusFilter(doc.status, activeStatus);
      const query = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !query ||
        [doc.file_name, docTypeLabel(doc.doc_type, categoryValue), CATEGORY_LABELS[categoryValue] || categoryValue]
          .join(" ")
          .toLowerCase()
          .includes(query);
      return matchesCategory && matchesStatus && matchesSearch;
    });

    return CATEGORY_OPTIONS.filter((option) => option.value !== "all").reduce((acc, option) => {
      acc[option.value] = filtered.filter((doc) => (doc.category || inferCategory(doc.doc_type)) === option.value);
      return acc;
    }, {});
  }, [activeCategory, activeStatus, documents, searchQuery]);

  const totalCount = useMemo(() => documents.length, [documents]);
  const categoryCount = useMemo(
    () => CATEGORY_OPTIONS.filter((option) => option.value !== "all").reduce((acc, option) => {
      acc[option.value] = documents.filter((doc) => (doc.category || inferCategory(doc.doc_type)) === option.value).length;
      return acc;
    }, {}),
    [documents]
  );

  const pendingCount = useMemo(
    () => documents.filter((doc) => STATUS_GROUPS.pending.has(String(doc.status || "").toLowerCase())).length,
    [documents]
  );
  const verifiedCount = useMemo(
    () => documents.filter((doc) => STATUS_GROUPS.verified.has(String(doc.status || "").toLowerCase())).length,
    [documents]
  );
  const verifiedPercent = totalCount ? Math.round((verifiedCount / totalCount) * 100) : 0;
  const ringOffset = RING_CIRCUMFERENCE * (1 - verifiedPercent / 100);

  function inferCategory(docType) {
    if (docType === "cnic" || docType === "passport") return "identity";
    if (docType === "transcript") return "education";
    if (docType === "resume") return "other";
    return "other";
  }

  async function performUpload({ file, category, docType, purpose }) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;

    const typeLabel = docTypeLabel(docType, category);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("category", category);
    formData.append("doc_type", docType);
    if (purpose) formData.append("purpose", purpose);

    setUploading(true);
    setUploadProgress({ typeLabel, fileName: file.name });
    setUploadMessage(null);
    try {
      // Purpose-aware endpoint keeps onboarding slots in sync for candidates/employees.
      const uploader = purpose ? uploadOnboardingFile : uploadDocument;
      const data = await uploader(formData, accessToken);
      const ocr = data?.document?.ocr_result || data?.ocr_result;
      const savedDoc = data?.document;
      const identityHardReject =
        isIdentityDocType(docType) &&
        (ocr?.accepted === false ||
          ocr?.status === "rejected_type" ||
          ocr?.status === "failed" ||
          savedDoc?.is_active === false);

      if (identityHardReject) {
        const message =
          ocr?.rejection_message ||
          "This does not look like a valid National ID. Please upload a clearer CNIC or Passport.";
        setUploadMessage({ type: "error", text: message });
        toast.error(message);
      } else {
        setUploadMessage({
          type: "success",
          text: `Document uploaded — ${typeLabel} is pending review until a recruiter verifies it.`,
        });
        toast.success("Document uploaded.");
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        setShowUploader(false);
        setActiveCategory("all");
        setActiveStatus("all");
      }
      loadDocuments();
      refreshPartnerInsights();
      onChanged?.();
    } catch (err) {
      const uploadError = getApiErrorMessage(err, `Could not upload ${typeLabel}. Please try again.`);
      setUploadMessage({ type: "error", text: uploadError });
      toast.error(uploadError);
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }

  async function handleUpload(e) {
    e.preventDefault();
    if (!file) {
      setUploadMessage({ type: "error", text: "Choose a file to upload." });
      return;
    }
    const purpose = derivePurpose(docType);
    await performUpload({ file, category, docType, purpose });
  }

  async function handleDownload(documentId) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      const data = await getDocumentDownloadUrl(documentId, accessToken);
      if (data?.url) window.open(data.url, "_blank", "noopener,noreferrer");
      else toast.error("Could not prepare the document download. Please try again.");
    } catch {
      toast.error("Could not download the document. Please try again.");
    }
  }

  async function handleReextract(documentId) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setActionBusyId(documentId);
    try {
      await reextractDocument(documentId, accessToken);
      loadDocuments();
      refreshPartnerInsights();
      toast.success("Document re-extracted successfully.");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not re-extract the document."));
    } finally {
      setActionBusyId(null);
    }
  }

  async function handleDelete(documentId) {
    if (!window.confirm("Delete this document from your records?")) return;
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setActionBusyId(documentId);
    try {
      await deleteDocument(documentId, accessToken);
      loadDocuments();
      refreshPartnerInsights();
      onChanged?.();
      toast.success("Document deleted.");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not delete the document."));
    } finally {
      setActionBusyId(null);
    }
  }

  async function performReplacement({ doc, file }) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;

    const replacedDocType = doc.doc_type || "other";
    const typeLabel = docTypeLabel(replacedDocType, category);
    const category = doc.category || inferCategory(replacedDocType);
    const purpose = derivePurpose(replacedDocType);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("category", category);
    formData.append("doc_type", replacedDocType);
    if (purpose) formData.append("purpose", purpose);

    setReplacementUploadingId(doc.id);
    setReplacementMessage(null);
    setUploadProgress({ typeLabel, fileName: file.name, replacing: true });
    try {
      const uploader = purpose ? uploadOnboardingFile : uploadDocument;
      const data = await uploader(formData, accessToken);
      const ocr = data?.document?.ocr_result || data?.ocr_result;
      const identityHardReject =
        isIdentityDocType(replacedDocType) &&
        (ocr?.accepted === false ||
          ocr?.status === "rejected_type" ||
          ocr?.status === "failed" ||
          data?.document?.is_active === false);

      if (identityHardReject) {
        const rejectMessage =
          ocr?.rejection_message || "This does not look like a valid National ID. Try another file.";
        setReplacementMessage({ type: "error", text: rejectMessage });
        toast.error(rejectMessage);
      } else {
        setReplacementDocId(null);
        setReplacementFile(null);
        if (replacementInputRef.current) replacementInputRef.current.value = "";
        setReplacementMessage({
          type: "success",
          text: `${typeLabel} replaced — awaiting recruiter verification.`,
        });
        toast.success(`${typeLabel} replaced successfully.`);
      }
      loadDocuments();
      refreshPartnerInsights();
      onChanged?.();
    } catch (err) {
      const replaceError = getApiErrorMessage(err, "Replacement upload failed.");
      setReplacementMessage({ type: "error", text: replaceError });
      toast.error(replaceError);
    } finally {
      setReplacementUploadingId(null);
      setUploadProgress(null);
    }
  }

  function handleReplacement(doc) {
    if (!replacementFile) {
      setReplacementMessage({ type: "error", text: "Choose a replacement file first." });
      return;
    }
    void performReplacement({ doc, file: replacementFile });
  }

  if (loading) {
    return (
      <div className="document-manager-shell" aria-busy="true">
        <div className="document-skeleton-strip">
          {[0, 1, 2].map((i) => (
            <div key={i} className="document-skeleton-pill" />
          ))}
        </div>
        <div className="document-skeleton-card">
          <div className="document-skeleton-line" style={{ width: "40%" }} />
          <div className="document-skeleton-line" style={{ width: "70%" }} />
          <div className="document-skeleton-line" style={{ width: "55%" }} />
        </div>
        <div className="document-skeleton-card">
          <div className="document-skeleton-line" style={{ width: "35%" }} />
          <div className="document-skeleton-line" style={{ width: "65%" }} />
          <div className="document-skeleton-line" style={{ width: "50%" }} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="document-manager-shell">
        <div className="document-error-banner" role="alert">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20, flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="document-manager-shell"
      data-mascot-busy={uploadProgress ? "true" : undefined}
      aria-busy={Boolean(uploadProgress)}
    >
      {uploadProgress && !uploadProgress.replacing ? (
        <div className="document-upload-status" role="status" aria-live="polite">
          <span className="document-upload-status-spinner" aria-hidden="true" />
          <div>
            <strong>Uploading {uploadProgress.typeLabel}</strong>
            <p>{uploadProgress.fileName}</p>
          </div>
        </div>
      ) : null}

      {/* Hero: verification ring + live counts — the one signature element on this page */}
      <div className="doc-hero" aria-live="polite">
        <div className="doc-hero-ring">
          <svg viewBox="0 0 84 84">
            <defs>
              <linearGradient id="docRingGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="var(--blue)" />
                <stop offset="55%" stopColor="var(--blue-strong)" />
                <stop offset="100%" stopColor="var(--navy-2)" />
              </linearGradient>
            </defs>
            <circle className="track" cx="42" cy="42" r={RING_RADIUS} />
            <circle
              className="fill"
              cx="42"
              cy="42"
              r={RING_RADIUS}
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={ringOffset}
            />
          </svg>
          <div className="doc-hero-ring-label">{verifiedPercent}%</div>
        </div>
        <div className="doc-hero-copy">
          <h3>Document verification</h3>
          <p>Track uploads, replacements, and recruiter sign-off in one place.</p>
          <div className="doc-hero-stats">
            <span className="doc-hero-stat"><span className="dot total" />{totalCount} file{totalCount === 1 ? "" : "s"}</span>
            <span className="doc-hero-stat"><span className="dot pending" />{pendingCount} pending review</span>
            <span className="doc-hero-stat"><span className="dot verified" />{verifiedCount} verified</span>
          </div>
        </div>
      </div>

      <div className="document-manager-toolbar">
        <div className="document-manager-pills-row">
          <div className="document-filter-group" role="tablist" aria-label="Document categories">
            {CATEGORY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`document-filter-pill ${activeCategory === option.value ? "active" : ""}`}
                onClick={() => setActiveCategory(option.value)}
              >
                {option.label}
                {option.value !== "all" ? ` (${categoryCount[option.value] || 0})` : ` (${totalCount})`}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="primary-button document-upload-toggle"
            onClick={() => {
              setShowUploader((value) => {
                const next = !value;
                if (next) setUploadMessage(null);
                return next;
              });
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }} aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            {showUploader ? "Hide uploader" : "Upload document"}
          </button>
        </div>
        <div className="document-manager-controls-row">
          <div className="document-filter-group" role="tablist" aria-label="Document status">
            {STATUS_FILTER_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`document-filter-pill status ${activeStatus === option.value ? "active" : ""}`}
                onClick={() => setActiveStatus(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="document-search-wrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16, color: "var(--text-faint)", flexShrink: 0 }} aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              className="document-search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search by file name or type"
            />
          </div>
        </div>
      </div>

      {!showUploader && uploadMessage ? (
        <div className={"document-upload-message " + uploadMessage.type} role="status">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18, flexShrink: 0 }}>
            {uploadMessage.type === "error" ? (
              <>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </>
            ) : (
              <>
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </>
            )}
          </svg>
          <span>{uploadMessage.text}</span>
        </div>
      ) : null}

      {showUploader && (
        <div className="document-upload-panel">
          <form className="document-upload-card" onSubmit={handleUpload}>
            <div className="document-upload-header">
              <div className="document-upload-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div className="document-upload-intro">
                <strong>Upload a document</strong>
                <p>Pick a category and type, choose a file, then upload. New files stay pending until a recruiter verifies them.</p>
              </div>
            </div>

            <div className="document-upload-fields">
              <label className="field">
                <span>Category</span>
                <select
                  value={category}
                  onChange={(event) => {
                    const nextCategory = event.target.value;
                    setCategory(nextCategory);
                    const options = DOC_TYPE_OPTIONS_BY_CATEGORY[nextCategory] || DOC_TYPE_OPTIONS_BY_CATEGORY.other;
                    setDocType(options[0]?.value || "other");
                  }}
                >
                  {CATEGORY_OPTIONS.filter((option) => option.value !== "all").map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Document type</span>
                <select value={docType} onChange={(event) => setDocType(event.target.value)}>
                  {(DOC_TYPE_OPTIONS_BY_CATEGORY[category] || DOC_TYPE_OPTIONS_BY_CATEGORY.other).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="document-upload-actions">
              <FileUploadField
                ref={fileInputRef}
                className="document-upload-chooser"
                selected={Boolean(file)}
                label="Choose file"
                replaceLabel="Change file"
                onChange={(event) => setFile(event.target.files?.[0] || null)}
              />
              {file ? (
                <span className="document-upload-filename" title={file.name}>
                  {file.name}
                </span>
              ) : (
                <span className="document-upload-filename muted">No file selected</span>
              )}
              <button
                type="submit"
                className="primary-button document-upload-save"
                disabled={uploading || !file}
              >
                {uploading ? "Uploading…" : "Upload"}
              </button>
            </div>

            {uploadMessage && (
              <div className={"document-upload-message " + uploadMessage.type} role="status">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18, flexShrink: 0 }}>
                  {uploadMessage.type === "error" ? (
                    <>
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </>
                  ) : (
                    <>
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </>
                  )}
                </svg>
                <span>{uploadMessage.text}</span>
              </div>
            )}
          </form>
        </div>
      )}

      {!documents.length ? (
        <div className="document-empty-state">
          <div className="document-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <polyline points="9 15 12 12 15 15" />
            </svg>
          </div>
          <div className="document-empty-title">No documents yet</div>
          <p>Upload an identity document, academic transcript, or supporting file. Recruiters verify each file from their review queue.</p>
          <button
            type="button"
            className="primary-button document-empty-action"
            onClick={() => {
              setShowUploader(true);
              window.setTimeout(() => {
                document.querySelector(".document-upload-card")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
              }, 80);
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }} aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Upload your first document
          </button>
        </div>
      ) : (
        <div className="document-category-stack">
          {CATEGORY_OPTIONS.filter((option) => option.value !== "all").map((option) => {
            const docs = groupedDocuments[option.value] || [];
            if (!docs.length) return null;
            return (
              <section key={option.value} className="document-category-card">
                <div className="document-category-head">
                  <div className="document-category-header">
                    <div className="document-category-icon">
                      {CATEGORY_ICONS[option.value] || CATEGORY_ICONS.other}
                    </div>
                    <div>
                      <h4>{option.label}</h4>
                      <p>{docs.length} document{docs.length > 1 ? "s" : ""}</p>
                    </div>
                  </div>
                </div>
                <div className="document-grid">
                  {docs.map((doc) => {
                    const categoryValue = doc.category || inferCategory(doc.doc_type);
                    const isReplacing = replacementDocId === doc.id;
                    const typeLabel = docTypeLabel(doc.doc_type, categoryValue);
                    const isPending = STATUS_GROUPS.pending.has(String(doc.status || "").toLowerCase());
                    const isVerified = STATUS_GROUPS.verified.has(String(doc.status || "").toLowerCase());
                    const isRejected = STATUS_GROUPS.rejected.has(String(doc.status || "").toLowerCase());
                    const statusColor = statusStyle(doc.status);
                    return (
                      <article key={doc.id} className="document-card">
                        <div className="document-card-head">
                          <div className="document-card-icon">
                            {CATEGORY_ICONS[categoryValue] || CATEGORY_ICONS.other}
                          </div>
                          <div className="document-card-info">
                            <div className="document-card-title">{typeLabel}</div>
                            <div className="document-card-subtitle">
                              {doc.file_name || "Uploaded file"}
                            </div>
                          </div>
                          <div className={"document-status-badge " + (doc.status || "pending")} style={{ background: statusColor.bg, color: statusColor.text, borderColor: statusColor.border }}>
                            {displayStatusLabel(doc.status)}
                          </div>
                        </div>

                        <div className="document-card-meta">
                          {doc.uploaded_at ? (
                            <span>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14, flexShrink: 0 }}>
                                <circle cx="12" cy="12" r="10" />
                                <polyline points="12 6 12 12 16 14" />
                              </svg>
                              {new Date(doc.uploaded_at).toLocaleDateString()}
                            </span>
                          ) : (
                            <span className="document-card-missing">Not uploaded</span>
                          )}
                        </div>

                        {isPending && (
                          <div className="document-card-note">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14, flexShrink: 0 }}>
                              <circle cx="12" cy="12" r="10" />
                              <line x1="12" y1="16" x2="12" y2="12" />
                              <line x1="12" y1="8" x2="12.01" y2="8" />
                            </svg>
                            Awaiting recruiter verification
                          </div>
                        )}

                        {isRejected && doc.rejection_reason && (
                          <div className="document-card-warning">{doc.rejection_reason.replace(/_/g, " ")}</div>
                        )}

                        <div className="document-actions">
                          <button type="button" className="secondary-button doc-action-view" onClick={() => handleDownload(doc.id)} title="View document">
                            {ACTION_ICONS.view}
                            <span>View</span>
                          </button>
                          {doc.doc_type === "cnic" && (
                            <button
                              type="button"
                              className="secondary-button doc-action-reextract"
                              disabled={actionBusyId === doc.id}
                              onClick={() => handleReextract(doc.id)}
                              title="Re-extract data"
                            >
                              {ACTION_ICONS.reextract}
                              <span>{actionBusyId === doc.id ? "Processing…" : "Re-extract"}</span>
                            </button>
                          )}
                          <button type="button" className="secondary-button doc-action-replace" onClick={() => setReplacementDocId(isReplacing ? null : doc.id)} title="Replace document">
                            {ACTION_ICONS.replace}
                            <span>{isReplacing ? "Cancel" : "Replace"}</span>
                          </button>
                          <button
                            type="button"
                            className="secondary-button doc-action-delete"
                            disabled={actionBusyId === doc.id}
                            onClick={() => handleDelete(doc.id)}
                            title="Delete document"
                          >
                            {ACTION_ICONS.delete}
                            <span>Delete</span>
                          </button>
                        </div>

                        {isReplacing && (
                          <div className="document-upload-card compact">
                            {replacementUploadingId === doc.id ? (
                              <div className="document-replace-progress" role="status" aria-live="polite">
                                <span className="document-upload-status-spinner" aria-hidden="true" />
                                <div>
                                  <strong>Uploading replacement…</strong>
                                  <p>{replacementFile?.name || "Saving file"}</p>
                                </div>
                              </div>
                            ) : (
                              <>
                                <p className="document-replace-hint">
                                  Replace <strong>{typeLabel}</strong>
                                  {doc.file_name ? ` (${doc.file_name})` : ""}. The new file stays pending until verified.
                                </p>
                                <FileUploadField
                                  ref={replacementInputRef}
                                  label="Choose replacement"
                                  onChange={(event) => setReplacementFile(event.target.files?.[0] || null)}
                                />
                                {replacementFile ? (
                                  <div className="document-upload-selected">
                                    Selected: <strong>{replacementFile.name}</strong>
                                  </div>
                                ) : null}
                                {replacementMessage && (
                                  <p
                                    className="form-message"
                                    style={{
                                      background: replacementMessage.type === "error" ? "#fee9e7" : "#edf8f2",
                                      color: replacementMessage.type === "error" ? "#b42318" : "#176b3b",
                                    }}
                                  >
                                    {replacementMessage.text}
                                  </p>
                                )}
                                <button
                                  type="button"
                                  className="primary-button"
                                  disabled={!replacementFile}
                                  onClick={() => handleReplacement(doc)}
                                >
                                  Upload replacement {typeLabel}
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
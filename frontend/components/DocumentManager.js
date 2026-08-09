"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import DocumentProcessingOverlay from "@/components/ai-experience/DocumentProcessingOverlay";
import useDocumentProcessing from "@/hooks/useDocumentProcessing";
import { normalizeDocumentType } from "@/lib/ai/documentProcessing";
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
  { value: "rejected", label: "Rejected" },
];

const STATUS_GROUPS = {
  pending: new Set(["pending", "processing", "uploaded", "sent", "pending_verification", "viewed", "incomplete"]),
  verified: new Set(["verified", "signed", "approved", "complete"]),
  rejected: new Set(["rejected", "reupload_required", "declined", "expired", "mismatch"]),
};

function matchesStatusFilter(status, filter) {
  if (filter === "all") return true;
  return STATUS_GROUPS[filter]?.has(status) ?? false;
}

const CATEGORY_LABELS = {
  identity: "Identity",
  education: "Education",
  employment: "Employment",
  banking: "Banking",
  legal: "Legal",
  other: "Other",
};

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
  const [uploadMessage, setUploadMessage] = useState(null);
  const [actionBusyId, setActionBusyId] = useState(null);
  const [replacementDocId, setReplacementDocId] = useState(null);
  const [replacementFile, setReplacementFile] = useState(null);
  const [replacementUploadingId, setReplacementUploadingId] = useState(null);
  const [replacementMessage, setReplacementMessage] = useState(null);
  const fileInputRef = useRef(null);
  const replacementInputRef = useRef(null);
  const processing = useDocumentProcessing();
  const retryJobRef = useRef(null);
  const successCloseRef = useRef(null);

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
        // Short status hint only — full tip text comes from insights (avoid Tip 1 == Tip 2).
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

  /** Only doc types the backend actually extracts get extraction messaging. */
  function processingDocumentType(docType) {
    const normalized = String(docType || "").toLowerCase();
    if (["cnic", "passport", "resume", "transcript"].includes(normalized)) {
      return normalizeDocumentType(normalized);
    }
    return "saving";
  }

  /** Closes the success overlay shortly after a completed upload. */
  function scheduleProcessingClose(ms = 1400) {
    if (successCloseRef.current) window.clearTimeout(successCloseRef.current);
    successCloseRef.current = window.setTimeout(() => {
      successCloseRef.current = null;
      processing.cancel();
    }, ms);
  }

  /** Re-runs the last attempt with the same file when "Try Again" is chosen. */
  function handleProcessingRetry() {
    const job = retryJobRef.current;
    if (!job) return;
    if (job.kind === "upload") {
      void performUpload({ file: job.file, category: job.category, docType: job.docType, purpose: job.purpose });
    } else if (job.kind === "replacement") {
      void performReplacement({ doc: job.doc, file: job.file });
    }
  }

  /** Dismisses the overlay so the candidate can choose a different file. */
  function handleProcessingUploadAnother() {
    if (successCloseRef.current) {
      window.clearTimeout(successCloseRef.current);
      successCloseRef.current = null;
    }
    processing.cancel();
  }

  useEffect(
    () => () => {
      if (successCloseRef.current) window.clearTimeout(successCloseRef.current);
    },
    []
  );

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
        [doc.file_name, DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type, CATEGORY_LABELS[categoryValue] || categoryValue]
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

  function inferCategory(docType) {
    if (docType === "cnic" || docType === "passport") return "identity";
    if (docType === "transcript") return "education";
    if (docType === "resume") return "other";
    return "other";
  }

  async function performUpload({ file, category, docType, purpose }) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("category", category);
    formData.append("doc_type", docType);
    if (purpose) formData.append("purpose", purpose);

    processing.begin({ documentType: processingDocumentType(docType), fileName: file.name });
    setUploading(true);
    setUploadMessage(null);
    try {
      // For onboarding-purpose types use the purpose-aware endpoint so
      // employee.onboarding is kept in sync via attach_uploaded_file.
      const uploader = purpose ? uploadOnboardingFile : uploadDocument;
      const data = await uploader(formData, accessToken);
      const ocr = (data?.document?.ocr_result) || (data?.ocr_result);
      if (ocr?.status === "rejected_type") {
        const message = ocr.rejection_message || "The document type was rejected.";
        processing.fail(message);
        setUploadMessage({ type: "error", text: message });
      } else {
        processing.succeed();
        scheduleProcessingClose();
        setUploadMessage({ type: "success", text: "Document uploaded — it is visible here for review and download." });
      }
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setActiveCategory("all");
      loadDocuments();
      refreshPartnerInsights();
      onChanged?.();
    } catch (err) {
      const message = getApiErrorMessage(err, "Upload failed. Please try again.");
      processing.fail(message);
      setUploadMessage({ type: "error", text: message });
    } finally {
      setUploading(false);
    }
  }

  async function handleUpload(e) {
    e.preventDefault();
    if (!file) {
      setUploadMessage({ type: "error", text: "Choose a file to upload." });
      return;
    }
    const purpose = derivePurpose(docType);
    retryJobRef.current = { kind: "upload", file, category, docType, purpose };
    await performUpload({ file, category, docType, purpose });
  }

  async function handleDownload(documentId) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      const data = await getDocumentDownloadUrl(documentId, accessToken);
      if (data?.url) window.open(data.url, "_blank", "noopener,noreferrer");
    } catch {
      // Ignore download errors; the user still sees the document metadata.
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
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not re-extract the document."));
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
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not delete the document."));
    } finally {
      setActionBusyId(null);
    }
  }

  async function performReplacement({ doc, file }) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;

    const replacedDocType = doc.doc_type || "other";
    const category = doc.category || inferCategory(replacedDocType);
    const purpose = derivePurpose(replacedDocType);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("category", category);
    formData.append("doc_type", replacedDocType);
    // Derive purpose so the replacement also syncs employee.onboarding.
    if (purpose) formData.append("purpose", purpose);

    processing.begin({ documentType: processingDocumentType(replacedDocType), fileName: file.name });
    setReplacementUploadingId(doc.id);
    setReplacementMessage(null);
    try {
      const uploader = purpose ? uploadOnboardingFile : uploadDocument;
      await uploader(formData, accessToken);
      setReplacementDocId(null);
      setReplacementFile(null);
      if (replacementInputRef.current) replacementInputRef.current.value = "";
      setReplacementMessage({ type: "success", text: "Replacement uploaded successfully." });
      processing.succeed();
      scheduleProcessingClose();
      loadDocuments();
      refreshPartnerInsights();
      onChanged?.();
    } catch (err) {
      const message = getApiErrorMessage(err, "Replacement upload failed.");
      processing.fail(message);
      setReplacementMessage({ type: "error", text: message });
    } finally {
      setReplacementUploadingId(null);
    }
  }

  function handleReplacement(doc) {
    if (!replacementFile) {
      setReplacementMessage({ type: "error", text: "Choose a replacement file first." });
      return;
    }
    retryJobRef.current = { kind: "replacement", doc, file: replacementFile };
    void performReplacement({ doc, file: replacementFile });
  }

  const processingOpen = processing.state.status !== "idle";

  if (loading) {
    return null;
  }

  if (error) {
    return <p className="form-message" style={{ background: "#fee9e7", color: "#b42318" }}>{error}</p>;
  }

  return (
    <div className="document-manager-shell">
      <DocumentProcessingOverlay
        open={processingOpen}
        {...processing.state}
        onRetry={handleProcessingRetry}
        onUploadAnother={handleProcessingUploadAnother}
      />

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
            onClick={() => setShowUploader((value) => !value)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
          <input
            className="document-search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search by file name or type"
          />
        </div>
      </div>

      {showUploader && (
        <form className="document-upload-card" onSubmit={handleUpload}>
          <div className="document-upload-row">
            <label className="field">
              <span>Category</span>
              <select value={category} onChange={(event) => {
                const nextCategory = event.target.value;
                setCategory(nextCategory);
                const options = DOC_TYPE_OPTIONS_BY_CATEGORY[nextCategory] || DOC_TYPE_OPTIONS_BY_CATEGORY.other;
                setDocType(options[0]?.value || "other");
              }}>
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
            <div className="field">
              <span>File</span>
              <FileUploadField ref={fileInputRef} onChange={(event) => setFile(event.target.files?.[0] || null)} />
            </div>
          </div>
          {uploadMessage && (
            <p className={`form-message ${uploadMessage.type === "error" ? "" : ""}`} style={{ background: uploadMessage.type === "error" ? "#fee9e7" : "#edf8f2", color: uploadMessage.type === "error" ? "#b42318" : "#176b3b" }}>
              {uploadMessage.text}
            </p>
          )}
          <button type="submit" className="primary-button" disabled={uploading}>
            {uploading ? (docType === "cnic" ? "Uploading & scanning…" : "Uploading…") : "Save document"}
          </button>
        </form>
      )}

      {!documents.length ? (
        <div className="document-empty-state">
          <div className="document-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <polyline points="9 15 12 12 15 15" />
            </svg>
          </div>
          <div className="document-empty-title">No documents yet</div>
          <p>Upload an identity document, academic transcript, or any supporting file to start building your document centre.</p>
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
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
                  <div>
                    <h4>{option.label}</h4>
                    <p>{docs.length} document{docs.length > 1 ? "s" : ""}</p>
                  </div>
                </div>
                <div className="document-grid">
                  {docs.map((doc) => {
                    const categoryValue = doc.category || inferCategory(doc.doc_type);
                    const isReplacing = replacementDocId === doc.id;
                    return (
                      <article key={doc.id} className="document-card">
                        <div className="document-card-head">
                          <div>
                            <div className="document-card-title">{doc.file_name || DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type}</div>
                            <div className="document-card-subtitle">
                              {DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type} · {CATEGORY_LABELS[categoryValue] || categoryValue}
                            </div>
                          </div>
                          <StatusBadge status={doc.status} />
                        </div>

                        <div className="document-card-meta">
                          <span>Version {doc.version || 1}</span>
                          {doc.uploaded_at ? <span>{new Date(doc.uploaded_at).toLocaleDateString()}</span> : null}
                        </div>

                        {doc.rejection_reason && (
                          <div className="document-card-warning">{doc.rejection_reason.replace(/_/g, " ")}</div>
                        )}

                        <div className="document-actions">
                          <button type="button" className="secondary-button doc-action-view" onClick={() => handleDownload(doc.id)}>
                            View / download
                          </button>
                          {doc.doc_type === "cnic" && (
                            <button
                              type="button"
                              className="secondary-button doc-action-reextract"
                              disabled={actionBusyId === doc.id}
                              onClick={() => handleReextract(doc.id)}
                            >
                              {actionBusyId === doc.id ? "Processing…" : "Re-extract"}
                            </button>
                          )}
                          <button type="button" className="secondary-button doc-action-replace" onClick={() => setReplacementDocId(isReplacing ? null : doc.id)}>
                            {isReplacing ? "Cancel" : "Replace"}
                          </button>
                          <button
                            type="button"
                            className="secondary-button doc-action-delete"
                            disabled={actionBusyId === doc.id}
                            onClick={() => handleDelete(doc.id)}
                          >
                            Delete
                          </button>
                        </div>

                        {isReplacing && (
                          <div className="document-upload-card compact">
                            <FileUploadField
                              ref={replacementInputRef}
                              label="Choose replacement"
                              onChange={(event) => setReplacementFile(event.target.files?.[0] || null)}
                            />
                            {replacementMessage && (
                              <p className="form-message" style={{ background: replacementMessage.type === "error" ? "#fee9e7" : "#edf8f2", color: replacementMessage.type === "error" ? "#b42318" : "#176b3b" }}>
                                {replacementMessage.text}
                              </p>
                            )}
                            <button type="button" className="primary-button" disabled={replacementUploadingId === doc.id} onClick={() => handleReplacement(doc)}>
                              {replacementUploadingId === doc.id
                                ? (doc.doc_type === "cnic" ? "Uploading & scanning…" : "Uploading…")
                                : "Upload replacement"}
                            </button>
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

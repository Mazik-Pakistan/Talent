"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  deleteDocument,
  getApiErrorMessage,
  getDocumentDownloadUrl,
  listMyDocuments,
  reextractDocument,
  uploadDocument,
} from "@/services/authService";
import StatusBadge from "@/components/StatusBadge";

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
    { value: "passport", label: "Passport" },
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

  const loadDocuments = useCallback(() => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setLoading(true);
    listMyDocuments(accessToken)
      .then((data) => setDocuments(data.documents || []))
      .catch((err) => setError(getApiErrorMessage(err, "Unable to load documents.")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadDocuments();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDocuments]);

  const groupedDocuments = useMemo(() => {
    const filtered = documents.filter((doc) => {
      const categoryValue = doc.category || inferCategory(doc.doc_type);
      const matchesCategory = activeCategory === "all" || categoryValue === activeCategory;
      const query = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !query ||
        [doc.file_name, DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type, CATEGORY_LABELS[categoryValue] || categoryValue]
          .join(" ")
          .toLowerCase()
          .includes(query);
      return matchesCategory && matchesSearch;
    });

    return CATEGORY_OPTIONS.filter((option) => option.value !== "all").reduce((acc, option) => {
      acc[option.value] = filtered.filter((doc) => (doc.category || inferCategory(doc.doc_type)) === option.value);
      return acc;
    }, {});
  }, [activeCategory, documents, searchQuery]);

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

  async function handleUpload(e) {
    e.preventDefault();
    if (!file) {
      setUploadMessage({ type: "error", text: "Choose a file to upload." });
      return;
    }

    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("category", category);
    formData.append("doc_type", docType);

    if (docType === "resume") {
      formData.append("purpose", "resume");
    } else if (docType === "transcript") {
      formData.append("purpose", "education_cert");
    } else if (docType === "cnic" || docType === "passport") {
      formData.append("purpose", "government_doc");
    }

    setUploading(true);
    setUploadMessage(null);
    try {
      const data = await uploadDocument(formData, accessToken);
      const ocr = data?.document?.ocr_result;
      if (ocr?.status === "rejected_type") {
        setUploadMessage({ type: "error", text: ocr.rejection_message || "The document type was rejected." });
      } else {
        setUploadMessage({ type: "success", text: "Document uploaded — it is visible here for review and download." });
      }
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setActiveCategory("all");
      loadDocuments();
      onChanged?.();
    } catch (err) {
      setUploadMessage({ type: "error", text: getApiErrorMessage(err, "Upload failed. Please try again.") });
    } finally {
      setUploading(false);
    }
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
      onChanged?.();
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not delete the document."));
    } finally {
      setActionBusyId(null);
    }
  }

  async function handleReplacement(doc) {
    if (!replacementFile) {
      setReplacementMessage({ type: "error", text: "Choose a replacement file first." });
      return;
    }
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;

    const formData = new FormData();
    formData.append("file", replacementFile);
    formData.append("category", doc.category || inferCategory(doc.doc_type));
    formData.append("doc_type", doc.doc_type || "other");

    setReplacementUploadingId(doc.id);
    setReplacementMessage(null);
    try {
      await uploadDocument(formData, accessToken);
      setReplacementDocId(null);
      setReplacementFile(null);
      if (replacementInputRef.current) replacementInputRef.current.value = "";
      loadDocuments();
      onChanged?.();
    } catch (err) {
      setReplacementMessage({ type: "error", text: getApiErrorMessage(err, "Replacement upload failed.") });
    } finally {
      setReplacementUploadingId(null);
    }
  }

  if (loading) {
    return <p className={compact ? "widget-placeholder" : "form-message"}>Loading documents…</p>;
  }

  if (error) {
    return <p className="form-message" style={{ background: "#fee9e7", color: "#b42318" }}>{error}</p>;
  }

  return (
    <div className="document-manager-shell">
      <div className="document-manager-summary">
        <div>
          <div className="document-manager-eyebrow">Document centre</div>
          <h3>{compact ? "Your documents" : "Manage documents"}</h3>
          <p>Browse by category, download files, and upload a replacement whenever something needs to be updated.</p>
        </div>
        <button type="button" className="primary-button" onClick={() => setShowUploader((value) => !value)}>
          {showUploader ? "Hide uploader" : "Upload document"}
        </button>
      </div>

      <div className="document-manager-toolbar">
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
        <input
          className="document-search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search by file name or document type"
        />
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
            <label className="field">
              <span>File</span>
              <input ref={fileInputRef} type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} />
            </label>
          </div>
          {uploadMessage && (
            <p className={`form-message ${uploadMessage.type === "error" ? "" : ""}`} style={{ background: uploadMessage.type === "error" ? "#fee9e7" : "#edf8f2", color: uploadMessage.type === "error" ? "#b42318" : "#176b3b" }}>
              {uploadMessage.text}
            </p>
          )}
          <button type="submit" className="primary-button" disabled={uploading}>
            {uploading ? "Uploading…" : "Save document"}
          </button>
        </form>
      )}

      {!documents.length ? (
        <div className="document-empty-state">
          <div className="document-empty-title">No documents yet</div>
          <p>Upload an identity document, academic transcript, or any supporting file to start building your document centre.</p>
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
                          <button type="button" className="secondary-button" onClick={() => handleDownload(doc.id)}>
                            View / download
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={actionBusyId === doc.id}
                            onClick={() => handleReextract(doc.id)}
                          >
                            {actionBusyId === doc.id ? "Processing…" : "Re-extract"}
                          </button>
                          <button type="button" className="secondary-button" onClick={() => setReplacementDocId(isReplacing ? null : doc.id)}>
                            {isReplacing ? "Cancel" : "Replace"}
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={actionBusyId === doc.id}
                            onClick={() => handleDelete(doc.id)}
                          >
                            Delete
                          </button>
                        </div>

                        {isReplacing && (
                          <div className="document-upload-card compact">
                            <input
                              ref={replacementInputRef}
                              type="file"
                              onChange={(event) => setReplacementFile(event.target.files?.[0] || null)}
                            />
                            {replacementMessage && (
                              <p className="form-message" style={{ background: replacementMessage.type === "error" ? "#fee9e7" : "#edf8f2", color: replacementMessage.type === "error" ? "#b42318" : "#176b3b" }}>
                                {replacementMessage.text}
                              </p>
                            )}
                            <button type="button" className="primary-button" disabled={replacementUploadingId === doc.id} onClick={() => handleReplacement(doc)}>
                              {replacementUploadingId === doc.id ? "Uploading…" : "Upload replacement"}
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

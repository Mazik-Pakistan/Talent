"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  getApiErrorMessage,
  getDocumentDownloadUrl,
  listMyDocuments,
  uploadDocument,
} from "@/services/authService";
import StatusBadge from "@/components/StatusBadge";

const DOC_TYPE_OPTIONS = [
  { value: "cnic", label: "CNIC", category: "identity" },
  { value: "passport", label: "Passport", category: "identity" },
  { value: "degree", label: "Degree certificate", category: "education" },
  { value: "transcript", label: "Transcript", category: "education" },
  { value: "certificate", label: "Certificate", category: "education" },
  { value: "experience_letter", label: "Experience letter", category: "employment" },
  { value: "relieving_letter", label: "Relieving letter", category: "employment" },
  { value: "salary_certificate", label: "Salary certificate", category: "employment" },
  { value: "reference_letter", label: "Reference letter", category: "legal" },
  { value: "resume", label: "Resume", category: "other" },
  { value: "other", label: "Other document", category: "other" },
];

const DOC_TYPE_LABELS = Object.fromEntries(DOC_TYPE_OPTIONS.map((opt) => [opt.value, opt.label]));

export default function EmployeeDocumentPanel({ styles, onChanged }) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showUploader, setShowUploader] = useState(false);
  const [docType, setDocType] = useState(DOC_TYPE_OPTIONS[0].value);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState(null); // { type: 'error'|'success', text }
  const fileInputRef = useRef(null);

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
    loadDocuments();
  }, [loadDocuments]);

  async function handleUpload(e) {
    e.preventDefault();
    if (!file) {
      setUploadMessage({ type: "error", text: "Choose a file to upload." });
      return;
    }
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;

    const category = DOC_TYPE_OPTIONS.find((opt) => opt.value === docType)?.category || "other";
    const formData = new FormData();
    formData.append("file", file);
    formData.append("category", category);
    formData.append("doc_type", docType);

    setUploading(true);
    setUploadMessage(null);
    try {
      await uploadDocument(formData, accessToken);
      setUploadMessage({ type: "success", text: "Document uploaded — verification is in progress." });
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
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
      // Silently ignore — the status badge already communicates document state.
    }
  }

  if (loading) return <p className={styles.emptySub}>Loading documents…</p>;
  if (error) return <p className={`${styles.uploadMessage} ${styles.error}`}>{error}</p>;

  return (
    <>
      {!documents.length ? (
        <div className={styles.emptyState}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
            <path d="M12 18v-6M9.5 14.5L12 12l2.5 2.5" />
          </svg>
          <div className={styles.emptyTitle}>No documents uploaded yet</div>
          <div className={styles.emptySub}>Upload an ID or education document to start verification.</div>
          <button type="button" className={styles.btnPrimary} onClick={() => setShowUploader((v) => !v)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Upload document
          </button>
        </div>
      ) : (
        <>
          <div className={styles.docGrid}>
            {documents.map((doc) => (
              <div key={doc.id} className={styles.docCard}>
                <div className={styles.docCardHead}>
                  <h4>{DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type}</h4>
                  <StatusBadge status={doc.status} />
                </div>
                <div className={styles.docCardMeta}>
                  {doc.file_name} · v{doc.version}
                  {doc.uploaded_at ? ` · ${new Date(doc.uploaded_at).toLocaleDateString()}` : ""}
                </div>
                {doc.status === "rejected" && doc.rejection_reason && (
                  <div className={styles.docCardMeta} style={{ color: "#B42318" }}>
                    Rejected: {doc.rejection_reason.replace(/_/g, " ")}
                    {doc.rejection_note ? ` — ${doc.rejection_note}` : ""}
                  </div>
                )}
                <button type="button" className={styles.docCardLink} onClick={() => handleDownload(doc.id)}>
                  View / download
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className={styles.btnPrimary}
            style={{ marginTop: 14 }}
            onClick={() => setShowUploader((v) => !v)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Upload another document
          </button>
        </>
      )}

      {showUploader && (
        <form className={styles.uploadForm} onSubmit={handleUpload}>
          <div className={styles.uploadRow}>
            <select value={docType} onChange={(e) => setDocType(e.target.value)}>
              {DOC_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <input
              ref={fileInputRef}
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              accept=".pdf,.jpg,.jpeg,.png"
            />
          </div>
          {uploadMessage && (
            <p className={`${styles.uploadMessage} ${uploadMessage.type === "error" ? styles.error : styles.success}`}>
              {uploadMessage.text}
            </p>
          )}
          <button type="submit" className={styles.btnPrimary} disabled={uploading} style={{ justifySelf: "start" }}>
            {uploading ? "Uploading…" : "Submit document"}
          </button>
        </form>
      )}
    </>
  );
}

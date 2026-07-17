"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  deleteDocument,
  getApiErrorMessage,
  listMyDocuments,
  reextractDocument,
  uploadDocument,
} from "@/services/authService";
import StatusBadge from "@/components/StatusBadge";

const DOC_TYPE_LABELS = {
  cnic: "National ID (CNIC)",
  passport: "Passport",
  degree: "Academic Transcript",
  transcript: "Academic Transcript",
  certificate: "Certificate",
  resume: "Resume / CV",
  experience_letter: "Experience letter",
  relieving_letter: "Relieving letter",
  salary_certificate: "Salary certificate",
  reference_letter: "Reference letter",
  other: "Document",
};

// Category mapping for re-upload (must match backend document categories).
const DOC_TYPE_CATEGORIES = {
  cnic: "identity",
  passport: "identity",
  transcript: "education",
  resume: "other",
  // Legacy types still readable if present in older records
  degree: "education",
  certificate: "education",
  experience_letter: "employment",
  relieving_letter: "employment",
  salary_certificate: "employment",
  reference_letter: "legal",
  other: "other",
};

const PURPOSE_BY_DOC_TYPE = {
  cnic: "government_doc",
  passport: "government_doc",
  transcript: "education_cert",
  resume: "resume",
};

export default function DocumentStatusList({ refreshKey, onChanged }) {
  const [documents, setDocuments] = useState([]);
  const [documentVerification, setDocumentVerification] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  // Re-upload state, keyed by document id so multiple rejected cards don't interfere.
  const [editingId, setEditingId] = useState(null);
  const [fileByDoc, setFileByDoc] = useState({});
  const [uploadingId, setUploadingId] = useState(null);
  const [uploadMessageByDoc, setUploadMessageByDoc] = useState({});
  const fileInputRefs = useRef({});

  const loadDocuments = useCallback(() => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setLoading(true);
    listMyDocuments(accessToken)
      .then((data) => {
        setDocuments(data.documents || []);
        setDocumentVerification(data.document_verification || null);
        setError("");
      })
      .catch((err) => setError(getApiErrorMessage(err, "Unable to load documents.")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments, refreshKey]);

  useEffect(() => {
    const targetId = window.location.hash.replace("#document-", "");
    if (!targetId || !documents.some((doc) => doc.id === targetId)) return;
    // Open the requested replacement control after a notification deep-link.
    setEditingId(targetId);
    window.setTimeout(() => {
      document.getElementById(`document-${targetId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }, [documents]);

  function toggleEdit(docId) {
    setEditingId((current) => (current === docId ? null : docId));
    setUploadMessageByDoc((current) => ({ ...current, [docId]: null }));
  }

  function handleFileChange(docId, fileList) {
    setFileByDoc((current) => ({ ...current, [docId]: fileList?.[0] || null }));
  }

  async function handleReupload(doc) {
    const file = fileByDoc[doc.id];
    if (!file) {
      setUploadMessageByDoc((current) => ({
        ...current,
        [doc.id]: { type: "error", text: "Choose a corrected file first." },
      }));
      return;
    }
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;

    const category = DOC_TYPE_CATEGORIES[doc.doc_type] || "other";
    const formData = new FormData();
    formData.append("file", file);
    formData.append("category", category);
    formData.append("doc_type", doc.doc_type);
    const purpose = PURPOSE_BY_DOC_TYPE[doc.doc_type];
    if (purpose) formData.append("purpose", purpose);

    setUploadingId(doc.id);
    setUploadMessageByDoc((current) => ({ ...current, [doc.id]: null }));
    try {
      const data = await uploadDocument(formData, accessToken);
      const ocr = data?.document?.ocr_result;
      if (ocr?.status === "rejected_type") {
        setUploadMessageByDoc((current) => ({
          ...current,
          [doc.id]: {
            type: "error",
            text: ocr.rejection_message || "Wrong document type — upload rejected.",
          },
        }));
        return;
      }
      setFileByDoc((current) => ({ ...current, [doc.id]: null }));
      if (fileInputRefs.current[doc.id]) fileInputRefs.current[doc.id].value = "";
      setEditingId(null);
      loadDocuments();
      onChanged?.();
    } catch (err) {
      setUploadMessageByDoc((current) => ({
        ...current,
        [doc.id]: { type: "error", text: getApiErrorMessage(err, "Upload failed. Please try again.") },
      }));
    } finally {
      setUploadingId(null);
    }
  }

  async function handleReextract(documentId) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setBusyId(documentId);
    try {
      await reextractDocument(documentId, accessToken);
      loadDocuments();
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not re-extract this document."));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(documentId) {
    if (!window.confirm("Delete this uploaded document? This cannot be undone.")) return;
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setBusyId(documentId);
    try {
      await deleteDocument(documentId, accessToken);
      loadDocuments();
      onChanged?.();
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not delete this document."));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p className="widget-placeholder">Loading documents…</p>;
  if (error) return <p className="form-message" style={{ background: "#fee9e7", color: "#b42318" }}>{error}</p>;
  if (!documents.length) return <p className="widget-placeholder">No documents uploaded yet.</p>;

  return (
    <div>
      {documentVerification?.verification_status === "mismatch" && (
        <p className="form-message" style={{ background: "#fff7ed", color: "#9a3412", marginBottom: 12 }} role="alert">
          Some uploaded documents contain inconsistent information. Please review.
        </p>
      )}
      <div className="doc-grid">
        {documents.map((doc) => {
          const isRequestedReupload =
            doc.status === "reupload_required" && doc.reupload_request_status === "pending";
          const isRejected =
            doc.status === "rejected" ||
            doc.status === "reupload_required" ||
            doc.ocr_result?.status === "rejected_type";
          const isEditing = editingId === doc.id;
          const uploadMessage = uploadMessageByDoc[doc.id];

          return (
            <div
              key={doc.id}
              id={`document-${doc.id}`}
              className={`doc-card ${isRequestedReupload ? "candidate-reupload-card" : ""}`}
            >
              <div className="doc-card-head">
                <h4>{DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type}</h4>
                <StatusBadge status={doc.status} />
              </div>
              <div className="doc-card-meta">
                {doc.file_name} · v{doc.version}
                {doc.uploaded_at ? ` · ${new Date(doc.uploaded_at).toLocaleDateString()}` : ""}
              </div>

              {doc.ocr_result?.status === "completed" && (
                <div className="ocr-panel">
                  Extraction: {Math.round((doc.ocr_result.extraction_confidence || doc.ocr_result.confidence || 0) * 100)}%
                  {doc.ocr_result.classification_confidence != null && (
                    <> · Classification: {Math.round(doc.ocr_result.classification_confidence * 100)}%</>
                  )}
                </div>
              )}

              {doc.ocr_result?.status === "rejected_type" && (
                <p className="doc-card-meta" style={{ color: "#b42318" }}>
                  {doc.ocr_result.rejection_message || "Wrong document type."}
                </p>
              )}

              {(doc.mismatch_reasons || []).length > 0 && (
                <p className="doc-card-meta" style={{ color: "#9a3412" }}>
                  {(doc.mismatch_reasons || []).map((m) => m.reason).join(" · ")}
                </p>
              )}

              {isRequestedReupload ? (
                <div className="candidate-reupload-warning" role="alert">
                  <strong>Your recruiter requested a replacement.</strong>
                  <span>
                    Reason: {(doc.reupload_request_reason || doc.rejection_reason || "other").replace(/_/g, " ")}
                  </span>
                  {(doc.reupload_request_note || doc.rejection_note) && (
                    <span>Note: {doc.reupload_request_note || doc.rejection_note}</span>
                  )}
                  <span>Upload another {DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type}; other document types will be rejected.</span>
                </div>
              ) : (
                isRejected && doc.rejection_reason && (
                  <p className="doc-card-meta" style={{ color: "#b42318" }}>
                    Rejected: {doc.rejection_reason.replace(/_/g, " ")}
                    {doc.rejection_note ? ` — ${doc.rejection_note}` : ""}. Please re-upload a corrected file.
                  </p>
                )
              )}

              <div className="doc-actions" style={{ marginTop: 8 }}>
                {!isRequestedReupload && (
                  <>
                    <button
                      type="button"
                      disabled={busyId === doc.id || uploadingId === doc.id}
                      onClick={() => handleReextract(doc.id)}
                    >
                      {busyId === doc.id ? "Processing…" : "Re-extract"}
                    </button>
                    <button
                      type="button"
                      className="reject"
                      disabled={busyId === doc.id || uploadingId === doc.id}
                      onClick={() => handleDelete(doc.id)}
                    >
                      Delete
                    </button>
                  </>
                )}
                {isRejected && !isEditing && (
                  <button type="button" className={isRequestedReupload ? "request" : ""} onClick={() => toggleEdit(doc.id)}>
                    {isRequestedReupload ? "Upload replacement" : "Edit / Re-upload"}
                  </button>
                )}
              </div>

              {isRejected && isEditing && (
                <div className="doc-uploader">
                  <strong>
                    Replacement {DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type}
                  </strong>
                  <input
                    ref={(el) => {
                      fileInputRefs.current[doc.id] = el;
                    }}
                    type="file"
                    accept={doc.doc_type === "resume" ? ".pdf,.doc,.docx" : ".pdf,.jpg,.jpeg,.png"}
                    onChange={(e) => handleFileChange(doc.id, e.target.files)}
                  />
                  {uploadMessage && (
                    <p
                      className="doc-card-meta"
                      style={{ color: uploadMessage.type === "error" ? "#b42318" : "#1f7a5c" }}
                    >
                      {uploadMessage.text}
                    </p>
                  )}
                  <div className="doc-actions">
                    <button type="button" onClick={() => toggleEdit(doc.id)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="submit"
                      disabled={uploadingId === doc.id}
                      onClick={() => handleReupload(doc)}
                    >
                      {uploadingId === doc.id ? "Validating and extracting…" : "Submit replacement"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

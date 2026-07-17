"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getApiErrorMessage, listMyDocuments, uploadDocument } from "@/services/authService";
import StatusBadge from "@/components/StatusBadge";

const DOC_TYPE_LABELS = {
  cnic: "CNIC",
  passport: "Passport",
  degree: "Degree certificate",
  transcript: "Transcript",
  certificate: "Certificate",
  resume: "Resume",
  experience_letter: "Experience letter",
  relieving_letter: "Relieving letter",
  salary_certificate: "Salary certificate",
  reference_letter: "Reference letter",
  other: "Document",
};

// Backend validates the file extension by category and only runs OCR for
// identity/education categories, so a re-upload must send the same
// category the doc_type originally belongs to (see DOC_TYPE_OPTIONS in
// EmployeeDocumentPanel.js for the source of truth on this mapping).
const DOC_TYPE_CATEGORIES = {
  cnic: "identity",
  passport: "identity",
  degree: "education",
  transcript: "education",
  certificate: "education",
  experience_letter: "employment",
  relieving_letter: "employment",
  salary_certificate: "employment",
  reference_letter: "legal",
  resume: "other",
  other: "other",
};

export default function DocumentStatusList({ refreshKey, onChanged }) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Re-upload state, keyed by document id so multiple rejected cards don't
  // interfere with each other.
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
      .then((data) => setDocuments(data.documents || []))
      .catch((err) => setError(getApiErrorMessage(err, "Unable to load documents.")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments, refreshKey]);

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

    setUploadingId(doc.id);
    setUploadMessageByDoc((current) => ({ ...current, [doc.id]: null }));
    try {
      await uploadDocument(formData, accessToken);
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

  if (loading) return <p className="widget-placeholder">Loading documents…</p>;
  if (error) return <p className="form-message" style={{ background: "#fee9e7", color: "#b42318" }}>{error}</p>;
  if (!documents.length) return <p className="widget-placeholder">No documents uploaded yet.</p>;

  return (
    <div className="doc-grid">
      {documents.map((doc) => {
        const isRejected = doc.status === "rejected" || doc.status === "reupload_required";
        const isEditing = editingId === doc.id;
        const uploadMessage = uploadMessageByDoc[doc.id];

        return (
          <div key={doc.id} className="doc-card">
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
                OCR confidence: {Math.round((doc.ocr_result.confidence || 0) * 100)}%
              </div>
            )}
            {isRejected && doc.rejection_reason && (
              <p className="doc-card-meta" style={{ color: "#b42318" }}>
                Rejected: {doc.rejection_reason.replace(/_/g, " ")}
                {doc.rejection_note ? ` — ${doc.rejection_note}` : ""}. Please re-upload a corrected file.
              </p>
            )}

            {isRejected && !isEditing && (
              <div className="doc-actions">
                <button type="button" onClick={() => toggleEdit(doc.id)}>
                  Edit / Re-upload
                </button>
              </div>
            )}

            {isRejected && isEditing && (
              <div className="doc-uploader">
                <input
                  ref={(el) => { fileInputRefs.current[doc.id] = el; }}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
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
                    {uploadingId === doc.id ? "Uploading…" : "Submit"}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

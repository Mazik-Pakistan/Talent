"use client";

import { useEffect, useState } from "react";

import { getApiErrorMessage, listMyDocuments } from "@/services/authService";
import StatusBadge from "@/components/StatusBadge";

const DOC_TYPE_LABELS = {
  cnic: "National ID (CNIC)",
  passport: "Passport",
  degree: "Degree certificate",
  transcript: "Academic Transcript",
  certificate: "Certificate",
  resume: "Resume / CV",
  experience_letter: "Experience letter",
  relieving_letter: "Relieving letter",
  salary_certificate: "Salary certificate",
  reference_letter: "Reference letter",
  other: "Document",
};

export default function DocumentStatusList({ refreshKey }) {
  const [documents, setDocuments] = useState([]);
  const [documentVerification, setDocumentVerification] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setLoading(true);
    listMyDocuments(accessToken)
      .then((data) => {
        setDocuments(data.documents || []);
        setDocumentVerification(data.document_verification || null);
      })
      .catch((err) => setError(getApiErrorMessage(err, "Unable to load documents.")))
      .finally(() => setLoading(false));
  }, [refreshKey]);

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
        {documents.map((doc) => (
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
            {doc.status === "rejected" && doc.rejection_reason && (
              <p className="doc-card-meta" style={{ color: "#b42318" }}>
                Rejected: {doc.rejection_reason.replace(/_/g, " ")}
                {doc.rejection_note ? ` — ${doc.rejection_note}` : ""}. Please re-upload a corrected file.
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

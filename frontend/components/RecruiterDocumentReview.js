"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { getApiErrorMessage, getDocumentDownloadUrl, listOwnerDocuments, verifyDocument } from "@/services/authService";
import StatusBadge from "@/components/StatusBadge";

const ACTION_REASONS = [
  { value: "blurry_or_unreadable", label: "Blurry or unreadable" },
  { value: "wrong_document_type", label: "Wrong document type" },
  { value: "expired_document", label: "Expired document" },
  { value: "information_mismatch", label: "Information mismatch" },
  { value: "incomplete_document", label: "Incomplete document" },
  { value: "other", label: "Other" },
];

const DOCUMENT_CONFIG = {
  cnic: {
    label: "National ID (CNIC/NIC)",
    fields: ["name", "father_name", "cnic_number", "date_of_birth", "gender", "nationality", "issue_date", "expiry_date"],
  },
  passport: {
    label: "Passport",
    fields: ["name", "passport_number", "nationality", "date_of_birth", "gender", "place_of_birth", "issue_date", "expiry_date"],
  },
  resume: {
    label: "Resume / CV",
    fields: ["full_name", "email", "phone_number", "professional_summary", "technical_skills", "soft_skills", "languages", "linkedin", "github", "portfolio"],
  },
  transcript: {
    label: "Academic Transcript",
    fields: ["candidate_name", "institute", "degree", "program", "major", "cgpa", "gpa", "percentage", "passing_year"],
  },
  degree: {
    label: "Academic Transcript",
    fields: ["candidate_name", "institute", "degree", "program", "major", "cgpa", "gpa", "percentage", "passing_year"],
  },
};

function documentConfig(doc) {
  if (doc.ocr_result?.category === "academic_transcript") return DOCUMENT_CONFIG.transcript;
  return DOCUMENT_CONFIG[doc.doc_type] || {
    label: doc.doc_type.replace(/_/g, " "),
    fields: [],
  };
}

function formatFieldValue(value) {
  if (Array.isArray(value)) {
    return value
      .slice(0, 8)
      .map((item) => (typeof item === "object" ? item.name || item.title || JSON.stringify(item) : item))
      .join(", ");
  }
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  const text = String(value);
  return text.length > 180 ? `${text.slice(0, 180)}…` : text;
}

function uniqueFlags(flags) {
  const seen = new Set();
  return flags.filter((flag) => {
    const key = `${flag.field || ""}|${flag.reason || ""}|${JSON.stringify(flag.values || {})}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function RecruiterDocumentReview({ ownerId }) {
  const [documents, setDocuments] = useState([]);
  const [documentVerification, setDocumentVerification] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [actionForm, setActionForm] = useState(null);
  const [actionReason, setActionReason] = useState("blurry_or_unreadable");
  const [actionNote, setActionNote] = useState("");
  const [openingDocId, setOpeningDocId] = useState(null);

  const load = useCallback(async () => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken || !ownerId) return;
    setLoading(true);
    try {
      const data = await listOwnerDocuments(ownerId, accessToken);
      setDocuments(data.documents || []);
      setDocumentVerification(data.document_verification || null);
      setError("");
    } catch (err) {
      setError(getApiErrorMessage(err, "Unable to load documents."));
    } finally {
      setLoading(false);
    }
  }, [ownerId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const allFlags = useMemo(
    () =>
      uniqueFlags([
        ...(documentVerification?.mismatches || []),
        ...documents.flatMap((doc) => [
          ...(doc.mismatches || []),
          ...(doc.cross_document_mismatches || []),
          ...(doc.mismatch_reasons || []),
        ]),
      ]),
    [documentVerification, documents]
  );

  const hasMismatch =
    documentVerification?.verification_status === "mismatch" ||
    documents.some((doc) => doc.verification_status === "mismatch" || doc.status === "mismatch");

  function openActionForm(documentId, mode) {
    setActionForm({ documentId, mode });
    setActionReason(mode === "reupload" ? "blurry_or_unreadable" : "information_mismatch");
    setActionNote("");
    setFeedback("");
  }

  async function handleVerify(documentId, status, extra = {}) {
    const accessToken = localStorage.getItem("access_token");
    setBusyId(documentId);
    setFeedback("");
    try {
      const result = await verifyDocument(documentId, { status, ...extra }, accessToken);
      setFeedback(
        status === "reupload_required" && result.email_sent === false
          ? "The in-app re-upload request was created, but the email could not be sent. Check SMTP settings."
          : result.message || "Document status updated."
      );
      await load();
      setActionForm(null);
      setActionNote("");
    } catch (err) {
      setFeedback(getApiErrorMessage(err, "Could not update document status."));
    } finally {
      setBusyId(null);
    }
  }

  async function handleOpenDocument(doc) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken || !doc?.id) return;
    setOpeningDocId(doc.id);
    try {
      const data = await getDocumentDownloadUrl(doc.id, accessToken);
      if (data?.url) window.open(data.url, "_blank", "noopener,noreferrer");
      else setFeedback("This document is not available for preview right now.");
    } catch (err) {
      setFeedback(getApiErrorMessage(err, "Could not open this document."));
    } finally {
      setOpeningDocId(null);
    }
  }

  if (loading) return <p className="widget-placeholder">Loading documents…</p>;
  if (error) return <p className="form-message" style={{ background: "#fee9e7", color: "#b42318" }}>{error}</p>;
  if (!documents.length) return <p className="widget-placeholder">No documents submitted yet.</p>;

  return (
    <div className="recruiter-document-review">
      {feedback && <p className="document-review-feedback">{feedback}</p>}

      {hasMismatch && (
        <section className="document-warning-summary" role="alert">
          <div>
            <strong>Document Verification Warning</strong>
            <p>
              {documentVerification?.summary ||
                "Some uploaded documents contain inconsistent information. Review the flags before making a decision."}
            </p>
          </div>
          {allFlags.length > 0 && (
            <div className="verification-flag-grid">
              {allFlags.map((flag, index) => (
                <article key={`${flag.field || "flag"}-${index}`} className="verification-flag">
                  <strong>{flag.reason || `${String(flag.field || "Field").replace(/_/g, " ")} differs`}</strong>
                  {flag.values && (
                    <div>
                      {Object.entries(flag.values).map(([source, value]) => (
                        <span key={source}>
                          <b>{source}:</b> {formatFieldValue(value)}
                        </span>
                      ))}
                    </div>
                  )}
                  {!flag.values && flag.ocr_value && (
                    <span>
                      Extracted: {flag.ocr_value} · Profile: {flag.profile_value}
                    </span>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="review-document-grid">
        {documents.map((doc) => {
          const config = documentConfig(doc);
          const fields = doc.ocr_result?.fields || {};
          const importantFields = config.fields
            .filter((key) => fields[key] !== null && fields[key] !== undefined && fields[key] !== "" && (!Array.isArray(fields[key]) || fields[key].length))
            .map((key) => [key, fields[key]]);
          const docFlags = uniqueFlags([
            ...(doc.mismatches || []),
            ...(doc.cross_document_mismatches || doc.mismatch_reasons || []),
          ]);
          const isFinal = ["verified", "rejected", "reupload_required"].includes(doc.status);
          const formOpen = actionForm?.documentId === doc.id;

          return (
            <article key={doc.id} className={`review-document-card ${doc.status === "reupload_required" ? "needs-reupload" : ""}`}>
              <header className="review-document-head">
                <div>
                  <span className="document-kind">Candidate document</span>
                  <h4>{config.label}</h4>
                  <p>{doc.file_name} · Version {doc.version}</p>
                </div>
                <StatusBadge status={doc.status} />
              </header>

              {importantFields.length > 0 ? (
                <dl className="important-document-fields">
                  {importantFields.map(([key, value]) => (
                    <div key={key}>
                      <dt>{key.replace(/_/g, " ")}</dt>
                      <dd>{formatFieldValue(value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="document-empty-fields">
                  {doc.ocr_result?.status === "failed"
                    ? "Text extraction failed. Review the uploaded file manually."
                    : "No important structured fields were extracted."}
                </p>
              )}

              {doc.ocr_result?.status === "completed" && (
                <div className="document-confidence-row">
                  <span>Classification {Math.round((doc.ocr_result.classification_confidence || 0) * 100)}%</span>
                  <span>Extraction {Math.round((doc.ocr_result.extraction_confidence || doc.ocr_result.confidence || 0) * 100)}%</span>
                  {doc.ocr_result.matching_confidence != null && (
                    <span>Matching {Math.round(doc.ocr_result.matching_confidence * 100)}%</span>
                  )}
                </div>
              )}

              {docFlags.length > 0 && (
                <div className="document-card-flags">
                  <strong>Flags requiring review</strong>
                  {docFlags.slice(0, 4).map((flag, index) => (
                    <p key={`${flag.field || "flag"}-${index}`}>{flag.reason || `${flag.field?.replace(/_/g, " ")} differs from profile.`}</p>
                  ))}
                </div>
              )}

              {doc.status === "reupload_required" && (
                <div className="reupload-requested-summary">
                  <strong>Re-upload requested</strong>
                  <span>
                    {(doc.reupload_request_reason || doc.rejection_reason || "other").replace(/_/g, " ")}
                    {(doc.reupload_request_note || doc.rejection_note)
                      ? ` — ${doc.reupload_request_note || doc.rejection_note}`
                      : ""}
                  </span>
                </div>
              )}

              {doc.raw_extracted_text && (
                <details className="raw-extraction-details">
                  <summary>Show raw extracted text</summary>
                  <pre>{doc.raw_extracted_text}</pre>
                </details>
              )}

              <div className="doc-actions review-document-actions">
                <button
                  type="button"
                  disabled={openingDocId === doc.id}
                  onClick={() => handleOpenDocument(doc)}
                >
                  {openingDocId === doc.id ? "Opening…" : "Open document"}
                </button>

                {!isFinal && (
                  <>
                    <button
                      type="button"
                      className="approve"
                      disabled={busyId === doc.id}
                      onClick={() =>
                        handleVerify(doc.id, "verified", {
                          approve_despite_mismatch: docFlags.length > 0 || hasMismatch,
                        })
                      }
                    >
                      {docFlags.length > 0 || hasMismatch ? "Approve anyway" : "Verify"}
                    </button>
                    <button
                      type="button"
                      className="request"
                      disabled={busyId === doc.id}
                      onClick={() => openActionForm(doc.id, "reupload")}
                    >
                      Request re-upload
                    </button>
                    <button
                      type="button"
                      className="reject"
                      disabled={busyId === doc.id}
                      onClick={() => openActionForm(doc.id, "reject")}
                    >
                      Reject
                    </button>
                  </>
                )}
              </div>

              {formOpen && (
                <div className="doc-reject-form document-action-form">
                  <strong>{actionForm.mode === "reupload" ? `Request a new ${config.label}` : `Reject ${config.label}`}</strong>
                  <select value={actionReason} onChange={(event) => setActionReason(event.target.value)}>
                    {ACTION_REASONS.map((reason) => (
                      <option key={reason.value} value={reason.value}>{reason.label}</option>
                    ))}
                  </select>
                  <textarea
                    rows={3}
                    placeholder="Add a helpful note for the candidate (optional)"
                    value={actionNote}
                    onChange={(event) => setActionNote(event.target.value)}
                  />
                  <div className="doc-actions">
                    <button type="button" onClick={() => setActionForm(null)}>Cancel</button>
                    <button
                      type="button"
                      className={actionForm.mode === "reupload" ? "request" : "reject"}
                      disabled={busyId === doc.id}
                      onClick={() =>
                        handleVerify(
                          doc.id,
                          actionForm.mode === "reupload" ? "reupload_required" : "rejected",
                          { rejection_reason: actionReason, note: actionNote }
                        )
                      }
                    >
                      {busyId === doc.id
                        ? "Sending…"
                        : actionForm.mode === "reupload"
                          ? "Send re-upload request"
                          : "Confirm rejection"}
                    </button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

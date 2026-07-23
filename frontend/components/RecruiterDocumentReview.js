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
    label: "National ID (CNIC)",
    previewFields: ["name", "cnic_number", "date_of_birth"],
  },
  passport: {
    label: "Passport",
    previewFields: ["name", "passport_number", "date_of_birth"],
  },
  resume: {
    label: "Resume / CV",
    previewFields: ["full_name", "email", "phone_number"],
  },
  transcript: {
    label: "Academic Transcript",
    previewFields: ["candidate_name", "institute", "degree", "cgpa"],
  },
  degree: {
    label: "Academic Transcript",
    previewFields: ["candidate_name", "institute", "degree", "cgpa"],
  },
};

function documentConfig(doc) {
  if (doc.ocr_result?.category === "academic_transcript") return DOCUMENT_CONFIG.transcript;
  return DOCUMENT_CONFIG[doc.doc_type] || {
    label: String(doc.doc_type || "Document").replace(/_/g, " "),
    previewFields: [],
  };
}

function formatFieldValue(value) {
  if (Array.isArray(value)) {
    return value
      .slice(0, 4)
      .map((item) => (typeof item === "object" ? item.name || item.title || JSON.stringify(item) : item))
      .join(", ");
  }
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  const text = String(value);
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}

function uniqueFlags(flags) {
  const seen = new Set();
  return flags.filter((flag) => {
    const key = `${flag.field || ""}|${flag.reason || ""}|${JSON.stringify(flag.values || {})}|${flag.ocr_value || ""}|${flag.profile_value || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function displayStatus(doc, liveFlagCount) {
  if (["verified", "rejected", "reupload_required"].includes(doc.status)) return doc.status;
  if ((doc.status === "mismatch" || doc.verification_status === "mismatch") && liveFlagCount === 0) {
    return "pending_verification";
  }
  return doc.status;
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
  const [expandedId, setExpandedId] = useState(null);

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
        ]),
      ]),
    [documentVerification, documents]
  );

  const hasMismatch = allFlags.length > 0;

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
          ? "Re-upload request created, but the email could not be sent."
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
          <strong>Needs review</strong>
          <p>{documentVerification?.summary || "A few fields need a quick check before verification."}</p>
          <ul className="verification-flag-list">
            {allFlags.slice(0, 4).map((flag, index) => (
              <li key={`${flag.field || "flag"}-${index}`}>
                {flag.reason || `${String(flag.field || "Field").replace(/_/g, " ")} differs`}
                {flag.values
                  ? ` — ${Object.values(flag.values).filter(Boolean).join(" / ")}`
                  : flag.ocr_value
                  ? ` — ${flag.ocr_value} vs ${flag.profile_value}`
                  : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="review-document-list">
        {documents.map((doc) => {
          const config = documentConfig(doc);
          const fields = doc.ocr_result?.fields || {};
          const preview = (config.previewFields || [])
            .filter((key) => fields[key] !== null && fields[key] !== undefined && fields[key] !== "")
            .map((key) => [key, fields[key]]);
          const docFlags = uniqueFlags([
            ...(doc.mismatches || []),
            ...(doc.cross_document_mismatches || []),
          ]);
          const status = displayStatus(doc, docFlags.length);
          const isFinal = ["verified", "rejected", "reupload_required"].includes(doc.status);
          const formOpen = actionForm?.documentId === doc.id;
          const expanded = expandedId === doc.id;

          return (
            <article key={doc.id} className={`review-document-row ${doc.status === "reupload_required" ? "needs-reupload" : ""}`}>
              <div className="review-document-row-main">
                <div className="review-document-row-info">
                  <div className="review-document-row-title">
                    <h4>{config.label}</h4>
                    <StatusBadge status={status} />
                  </div>
                  <p className="review-document-meta">{doc.file_name}</p>
                  {preview.length > 0 && (
                    <p className="review-document-preview">
                      {preview.map(([key, value]) => (
                        <span key={key}>
                          <b>{key.replace(/_/g, " ")}:</b> {formatFieldValue(value)}
                        </span>
                      ))}
                    </p>
                  )}
                  {docFlags.length > 0 && (
                    <p className="review-document-flag-hint">{docFlags.length} flag{docFlags.length !== 1 ? "s" : ""} to review</p>
                  )}
                </div>

                <div className="review-document-row-actions">
                  <button type="button" disabled={openingDocId === doc.id} onClick={() => handleOpenDocument(doc)}>
                    {openingDocId === doc.id ? "Opening…" : "Open"}
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
                        {docFlags.length > 0 ? "Approve" : "Verify"}
                      </button>
                      <button
                        type="button"
                        className="request"
                        disabled={busyId === doc.id}
                        onClick={() => openActionForm(doc.id, "reupload")}
                      >
                        Re-upload
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
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setExpandedId(expanded ? null : doc.id)}
                    aria-expanded={expanded}
                  >
                    {expanded ? "Less" : "Details"}
                  </button>
                </div>
              </div>

              {expanded && (
                <div className="review-document-details">
                  {Object.keys(fields).length > 0 ? (
                    <dl className="important-document-fields">
                      {Object.entries(fields)
                        .filter(([, value]) => value !== null && value !== undefined && value !== "")
                        .slice(0, 10)
                        .map(([key, value]) => (
                          <div key={key}>
                            <dt>{key.replace(/_/g, " ")}</dt>
                            <dd>{formatFieldValue(value)}</dd>
                          </div>
                        ))}
                    </dl>
                  ) : (
                    <p className="document-empty-fields">
                      {doc.ocr_result?.status === "failed"
                        ? "Text extraction failed. Open the file to review manually."
                        : "No extracted fields yet."}
                    </p>
                  )}
                  {docFlags.length > 0 && (
                    <div className="document-card-flags">
                      {docFlags.slice(0, 3).map((flag, index) => (
                        <p key={`${flag.field || "flag"}-${index}`}>
                          {flag.reason || `${flag.field?.replace(/_/g, " ")} differs.`}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {formOpen && (
                <div className="doc-reject-form document-action-form">
                  <strong>{actionForm.mode === "reupload" ? `Request a new ${config.label}` : `Reject ${config.label}`}</strong>
                  <select value={actionReason} onChange={(event) => setActionReason(event.target.value)}>
                    {ACTION_REASONS.map((reason) => (
                      <option key={reason.value} value={reason.value}>{reason.label}</option>
                    ))}
                  </select>
                  <textarea
                    rows={2}
                    placeholder="Optional note for the employee"
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
                        ? "Send request"
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

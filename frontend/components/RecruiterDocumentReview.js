"use client";

import { useEffect, useState } from "react";

import { getApiErrorMessage, getDocumentDownloadUrl, listOwnerDocuments, verifyDocument } from "@/services/authService";
import StatusBadge from "@/components/StatusBadge";

const REJECTION_REASONS = [
  { value: "blurry_or_unreadable", label: "Blurry / unreadable" },
  { value: "wrong_document_type", label: "Wrong document type" },
  { value: "expired_document", label: "Expired document" },
  { value: "information_mismatch", label: "Information mismatch" },
  { value: "incomplete_document", label: "Incomplete document" },
  { value: "other", label: "Other" },
];

export default function RecruiterDocumentReview({ ownerId }) {
  const [documents, setDocuments] = useState([]);
  const [documentVerification, setDocumentVerification] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [rejectFormFor, setRejectFormFor] = useState(null);
  const [rejectReason, setRejectReason] = useState("blurry_or_unreadable");
  const [rejectNote, setRejectNote] = useState("");
  const [openingDocId, setOpeningDocId] = useState(null);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);

  async function load() {
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
  }

  async function handleVerify(documentId, status, extra = {}) {
    const accessToken = localStorage.getItem("access_token");
    setBusyId(documentId);
    try {
      await verifyDocument(documentId, { status, ...extra }, accessToken);
      await load();
      setRejectFormFor(null);
      setRejectNote("");
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not update document status."));
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
      if (data?.url) {
        window.open(data.url, "_blank", "noopener,noreferrer");
      } else {
        setError("This document is not available for preview right now.");
      }
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not open this document."));
    } finally {
      setOpeningDocId(null);
    }
  }

  if (loading) return <p className="widget-placeholder">Loading documents…</p>;
  if (error) return <p className="form-message" style={{ background: "#fee9e7", color: "#b42318" }}>{error}</p>;
  if (!documents.length) return <p className="widget-placeholder">No documents submitted yet.</p>;

  const crossMismatches =
    documentVerification?.mismatches ||
    documents.flatMap((d) => d.cross_document_mismatches || d.mismatch_reasons || []);
  const hasMismatch =
    documentVerification?.verification_status === "mismatch" ||
    documents.some((d) => d.verification_status === "mismatch" || d.status === "mismatch");

  return (
    <div>
      {hasMismatch && (
        <div
          className="form-message"
          style={{ background: "#fff7ed", color: "#9a3412", border: "1px solid #fdba74", marginBottom: 16 }}
          role="alert"
        >
          <strong>Document Verification Warning</strong>
          <p style={{ margin: "6px 0 0" }}>
            {documentVerification?.summary ||
              "Some uploaded documents contain inconsistent information. Review and approve or reject based on your judgment."}
          </p>
          {crossMismatches.length > 0 && (
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {crossMismatches.map((m, i) => (
                <li key={i}>
                  {m.reason}
                  {m.values && (
                    <span style={{ display: "block", fontSize: ".85em", opacity: 0.9 }}>
                      {Object.entries(m.values)
                        .map(([src, val]) => `${src}: ${val}`)
                        .join(" · ")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="doc-grid">
        {documents.map((doc) => {
          const docMismatches = [
            ...(doc.mismatches || []),
            ...(doc.cross_document_mismatches || doc.mismatch_reasons || []),
          ];
          const canAct =
            doc.status !== "verified" &&
            doc.status !== "rejected" &&
            doc.status !== "reupload_required";

          return (
            <div key={doc.id} className="doc-card">
              <div className="doc-card-head">
                <h4>{doc.doc_type.replace(/_/g, " ")}</h4>
                <StatusBadge status={doc.status} />
              </div>
              <div className="doc-card-meta">
                {doc.file_name} · v{doc.version}
              </div>

              {doc.ocr_result?.status === "completed" && (
                <dl className="ocr-panel">
                  {Object.entries(doc.ocr_result.fields || {})
                    .filter(([, value]) => value)
                    .map(([key, value]) => (
                      <span key={key}>
                        <dt>{key.replace(/_/g, " ")}:</dt>
                        <dd>
                          {Array.isArray(value)
                            ? value.map((v) => (typeof v === "object" ? JSON.stringify(v) : v)).join(", ")
                            : typeof value === "object"
                              ? JSON.stringify(value)
                              : value}
                        </dd>
                      </span>
                    ))}
                  <span>
                    <dt>Classification:</dt>
                    <dd>{Math.round((doc.ocr_result.classification_confidence || 0) * 100)}%</dd>
                  </span>
                  <span>
                    <dt>Extraction:</dt>
                    <dd>{Math.round((doc.ocr_result.extraction_confidence || doc.ocr_result.confidence || 0) * 100)}%</dd>
                  </span>
                  {doc.ocr_result.matching_confidence != null && (
                    <span>
                      <dt>Matching:</dt>
                      <dd>{Math.round(doc.ocr_result.matching_confidence * 100)}%</dd>
                    </span>
                  )}
                </dl>
              )}
              {doc.ocr_result?.status === "rejected_type" && (
                <p className="doc-card-meta ocr-mismatch">
                  {doc.ocr_result.rejection_message || "Wrong document type — needs re-upload."}
                </p>
              )}
              {doc.ocr_result?.status === "failed" && (
                <p className="doc-card-meta ocr-mismatch">OCR failed — needs manual review.</p>
              )}
              {docMismatches.length > 0 && (
                <p className="ocr-mismatch">
                  ⚠{" "}
                  {docMismatches
                    .map((m) =>
                      m.reason
                        ? m.reason
                        : `${m.field} (${m.ocr_value || Object.values(m.values || {}).join(" / ")} ≠ ${m.profile_value || ""})`
                    )
                    .join("; ")}
                </p>
              )}

              <div className="doc-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={openingDocId === doc.id}
                  onClick={() => handleOpenDocument(doc)}
                >
                  {openingDocId === doc.id ? "Opening…" : "Open document"}
                </button>
                {!canAct ? (
                  <p className="doc-card-meta" style={{ marginTop: 8 }}>
                    {doc.status === "verified" ? "Verified" : `Marked ${doc.status.replace(/_/g, " ")}`}
                    {doc.rejection_reason ? ` — ${doc.rejection_reason.replace(/_/g, " ")}` : ""}
                    {doc.mismatch_approved ? " (approved despite mismatch)" : ""}
                  </p>
                ) : (
                  <div className="doc-actions" style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="approve"
                      disabled={busyId === doc.id}
                      onClick={() =>
                        handleVerify(doc.id, "verified", {
                          approve_despite_mismatch: docMismatches.length > 0 || hasMismatch,
                          note: rejectNote || undefined,
                        })
                      }
                    >
                      {docMismatches.length > 0 || hasMismatch ? "Approve anyway" : "Verify"}
                    </button>
                    <button
                      type="button"
                      className="reject"
                      disabled={busyId === doc.id}
                      onClick={() => setRejectFormFor(doc.id)}
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>

              {rejectFormFor === doc.id && (
                <div className="doc-reject-form">
                  <select value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}>
                    {REJECTION_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <textarea
                    rows={2}
                    placeholder="Optional note for the candidate"
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                  />
                  <div className="doc-actions">
                    <button type="button" onClick={() => setRejectFormFor(null)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="reject"
                      disabled={busyId === doc.id}
                      onClick={() =>
                        handleVerify(doc.id, "rejected", {
                          rejection_reason: rejectReason,
                          note: rejectNote,
                        })
                      }
                    >
                      Confirm reject
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

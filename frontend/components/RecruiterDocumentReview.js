"use client";

import { useEffect, useState } from "react";

import { getApiErrorMessage, listOwnerDocuments, verifyDocument } from "@/services/authService";
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [rejectFormFor, setRejectFormFor] = useState(null);
  const [rejectReason, setRejectReason] = useState("blurry_or_unreadable");
  const [rejectNote, setRejectNote] = useState("");

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

  if (loading) return <p className="widget-placeholder">Loading documents…</p>;
  if (error) return <p className="form-message" style={{ background: "#fee9e7", color: "#b42318" }}>{error}</p>;
  if (!documents.length) return <p className="widget-placeholder">No documents submitted yet.</p>;

  return (
    <div className="doc-grid">
      {documents.map((doc) => (
        <div key={doc.id} className="doc-card">
          <div className="doc-card-head">
            <h4>{doc.doc_type.replace(/_/g, " ")}</h4>
            <StatusBadge status={doc.status} />
          </div>
          <div className="doc-card-meta">{doc.file_name} · v{doc.version}</div>

          {doc.ocr_result?.status === "completed" && (
            <dl className="ocr-panel">
              {Object.entries(doc.ocr_result.fields || {})
                .filter(([, value]) => value)
                .map(([key, value]) => (
                  <span key={key}>
                    <dt>{key.replace(/_/g, " ")}:</dt>
                    <dd>{Array.isArray(value) ? value.join(", ") : value}</dd>
                  </span>
                ))}
              <span>
                <dt>OCR confidence:</dt>
                <dd>{Math.round((doc.ocr_result.confidence || 0) * 100)}%</dd>
              </span>
            </dl>
          )}
          {doc.ocr_result?.status === "failed" && (
            <p className="doc-card-meta ocr-mismatch">OCR failed — needs manual review.</p>
          )}
          {doc.mismatches?.length > 0 && (
            <p className="ocr-mismatch">
              ⚠ Mismatch vs profile: {doc.mismatches.map((m) => `${m.field} (${m.ocr_value} ≠ ${m.profile_value})`).join(", ")}
            </p>
          )}

          {doc.status === "verified" || doc.status === "rejected" || doc.status === "reupload_required" ? (
            <p className="doc-card-meta">
              {doc.status === "verified" ? "Verified" : `Marked ${doc.status.replace(/_/g, " ")}`}
              {doc.rejection_reason ? ` — ${doc.rejection_reason.replace(/_/g, " ")}` : ""}
            </p>
          ) : (
            <div className="doc-actions">
              <button type="button" className="approve" disabled={busyId === doc.id} onClick={() => handleVerify(doc.id, "verified")}>
                Verify
              </button>
              <button type="button" className="reject" disabled={busyId === doc.id} onClick={() => setRejectFormFor(doc.id)}>
                Reject
              </button>
            </div>
          )}

          {rejectFormFor === doc.id && (
            <div className="doc-reject-form">
              <select value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}>
                {REJECTION_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              <textarea
                rows={2}
                placeholder="Optional note for the candidate"
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
              />
              <div className="doc-actions">
                <button type="button" onClick={() => setRejectFormFor(null)}>Cancel</button>
                <button
                  type="button"
                  className="reject"
                  disabled={busyId === doc.id}
                  onClick={() => handleVerify(doc.id, "rejected", { rejection_reason: rejectReason, note: rejectNote })}
                >
                  Confirm reject
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

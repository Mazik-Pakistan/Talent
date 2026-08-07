"use client";

import { forwardRef, Suspense, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { getApiErrorMessage, uploadDocument, verifyDocument, uploadEmployeePhoto, uploadRecruiterPhoto, analyzeBankSlip, uploadOnboardingFile } from "@/services/authService";
import { uploadCertificate, verifyCertificate } from "@/services/learningService";
import {
  bulkInviteSpreadsheet,
  getAgentErrorMessage,
  getAgentHistory,
  sendAgentMessage,
} from "@/services/agentService";
import styles from "./AgentChatCore.module.css";

export const ALLOWED_ROLES = ["candidate", "employee", "recruiter", "super_admin"];

const CONFIRM_PREFIX = "__CONFIRM__:";

const ROLE_COPY = {
  recruiter: {
    title: "Hiring Agent",
    subtitle: "Anything you do in recruiting — for one person or in bulk",
    empty:
      "Tell me what you need — a person, a bulk action, or a goal. I can help across invites, pipeline, offers, documents, Day-1, Learning, Talent, reminders, search, and announcements.",
    starters: [
      "Show my hiring pipeline",
      "Remind incomplete employee profiles",
      "Assign a learning course",
      "Search talent by skills",
    ],
  },
  super_admin: {
    title: "Platform Admin Agent",
    subtitle: "Recruiters, organizations, and platform-wide reports",
    empty:
      "I can help you manage recruiters, organizations, and get platform stats. Ask me about your platform overview, invite a recruiter, or check on any organization.",
    starters: [
      "Show platform overview",
      "Invite a new recruiter",
      "List all recruiters",
      "List all organizations",
      "Create a new organization",
    ],
  },
  candidate: {
    title: "Onboarding Agent",
    subtitle: "Onboarding, documents, and your offer letter",
    empty: "Tell me \"complete my onboarding\" and I'll walk you through it — or ask about documents and your offer.",
    starters: [
      "Complete my onboarding",
      "What do I still need to upload?",
      "Show my offer letter",
      "List my documents",
      "How do I change my password?",
    ],
  },
  employee: {
    title: "Workday Agent",
    subtitle: "Onboarding, Learning, Talent, and day-to-day help",
    empty:
      "Tell me \"continue my onboarding\", ask about Learning or internal opportunities, or update your profile — I can help across your workday.",
    starters: [
      "Continue my onboarding",
      "Show my learning dashboard",
      "Browse internal opportunities",
      "Check my progress",
      "How do I change my password?",
      "What is my company email?",
    ],
  },
};

const DOC_TYPE_LABEL = {
  cnic: "National ID (CNIC)",
  passport: "Passport",
  transcript: "academic transcript",
  resume: "resume",
  photo: "profile photo",
  certificate: "certificate",
  skill_certificate: "certificate",
  bank_slip: "bank slip",
};

function purposeForDocType(docType) {
  if (docType === "resume") return "resume";
  if (docType === "transcript") return "education_cert";
  if (docType === "cnic" || docType === "passport") return "government_doc";
  return undefined;
}

function categoryForDocType(docType) {
  if (docType === "cnic" || docType === "passport") return "identity";
  if (docType === "transcript") return "education";
  // resume, certificate, skill_certificate, and anything else go to "other"
  return "other";
}

function canShowUploadHint(uiHint, isRecruiter) {
  if (!uiHint || uiHint.type !== "upload" || isSpreadsheetHint(uiHint)) return false;
  if (!isRecruiter) return true;
  return uiHint.doc_type === "photo";
}

function IconChat() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function IconSend() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7z" />
    </svg>
  );
}

function IconPaperclip() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05 12.25 20.24a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.67 3.67 0 0 1 5.19 5.19l-9.2 9.19a1.83 1.83 0 0 1-2.6-2.6l8.49-8.48" />
    </svg>
  );
}

function IconRefresh() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 15.3-6.4L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.3 6.4L3 16" />
      <path d="M8 21v-5h-5" />
    </svg>
  );
}

function IconFile() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

export function readAuth() {
  if (typeof window === "undefined") return null;
  try {
    const accessToken = localStorage.getItem("access_token");
    const rawUser = localStorage.getItem("user");
    if (!accessToken || !rawUser) return null;
    const user = JSON.parse(rawUser);
    if (!user?.role || !ALLOWED_ROLES.includes(user.role)) return null;
    return { accessToken, user };
  } catch {
    return null;
  }
}

function statusTone(status) {
  const value = String(status || "").toLowerCase();
  if (value === "verified") return "good";
  if (value === "rejected" || value === "mismatch") return "bad";
  if (value === "reupload_required") return "warn";
  return "neutral";
}

function linkifyText(text) {
  if (!text) return null;
  const parts = String(text).split(/(https?:\/\/[^\s<>"']+)/g);
  return parts.map((part, i) => {
    if (/^https?:\/\//i.test(part)) {
      const href = part.replace(/[),.;]+$/, "");
      const trailing = part.slice(href.length);
      return (
        <span key={`l-${i}`}>
          <a href={href} target="_blank" rel="noopener noreferrer" className={styles.inlineLink}>
            Open document
          </a>
          {trailing}
        </span>
      );
    }
    return <span key={`t-${i}`}>{part}</span>;
  });
}

function isSpreadsheetHint(hint) {
  if (!hint) return false;
  const type = String(hint.type || "").toLowerCase();
  const docType = String(hint.doc_type || "").toLowerCase();
  if (type === "spreadsheet" || type === "sheet" || type === "excel" || type === "csv") return true;
  return (
    type === "upload" &&
    ["spreadsheet", "excel", "xlsx", "csv", "roster", "bulk_invite"].includes(docType)
  );
}

function docKey(doc) {
  return doc.id || doc.document_id;
}

function docFileUrl(doc) {
  return doc.file_url || doc.download_url;
}

function compactAssistantContextValue(value, limit = 6) {
  if (value == null || value === "") return null;
  if (Array.isArray(value)) {
    return value
      .filter((item) => item != null && item !== "")
      .slice(0, limit)
      .map((item) => String(item).slice(0, 80));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, item]) => item != null && item !== "" && !(Array.isArray(item) && item.length === 0))
      .slice(0, limit)
      .map(([key, item]) => [key, compactAssistantContextValue(item, limit)]);
    return Object.fromEntries(entries);
  }
  const text = String(value);
  return text.length > 160 ? text.slice(0, 160) : text;
}

function buildAssistantContext({ pathname, searchParams, auth, extraContext }) {
  const context = { ...(extraContext || {}) };
  if (pathname) {
    context.pathname = pathname;
    context.page = pathname;
    const segments = pathname.split("/").filter(Boolean);
    context.module = segments.length > 2 ? segments[segments.length - 1] : segments[1] || segments[0] || pathname;
  }

  const paramKeys = ["q", "search", "employee_id", "candidate_id", "id", "email", "department", "job_title", "status", "profile_status", "tab", "section", "step"];
  const filters = {};
  for (const key of paramKeys) {
    const value = searchParams?.get?.(key);
    if (value) filters[key] = value;
  }
  if (Object.keys(filters).length > 0) {
    context.filters = { ...(context.filters || {}), ...filters };
  }

  const selectedRecord = context.selected_record || null;
  const selectedId = filters.employee_id || filters.candidate_id || filters.id || null;
  const selectedEmail = filters.email || null;
  if (!selectedRecord && (selectedId || selectedEmail)) {
    context.selected_record = compactAssistantContextValue({
      employee_id: filters.employee_id || undefined,
      candidate_id: filters.candidate_id || undefined,
      id: filters.id || undefined,
      email: selectedEmail || undefined,
      kind: auth?.user?.role || undefined,
    });
  } else if (selectedRecord) {
    context.selected_record = compactAssistantContextValue(selectedRecord);
  }

  return compactAssistantContextValue(context);
}

/**
 * DocumentsAttachment — role-aware document cards in agent chat.
 * Recruiters: verify / reject / request-reupload.
 * Candidates & employees: view + open + re-upload their own files (no recruiter actions).
 */
function DocumentsAttachment({ attachment, auth, onLocalNote, onSelfReupload }) {
  const [busyId, setBusyId] = useState(null);
  const [reasonFor, setReasonFor] = useState(null); // { id, kind }
  const [reason, setReason] = useState("");
  const [docs, setDocs] = useState(attachment.data.documents || []);
  const isRecruiter = auth?.user?.role === "recruiter" || auth?.user?.role === "super_admin";

  useEffect(() => {
    setDocs(attachment.data.documents || []);
  }, [attachment]);

  function resolvedStatus(doc) {
    return String(doc.verification_status || doc.status || "pending").toLowerCase();
  }

  function hasMismatch(doc) {
    return Boolean(doc.mismatches?.length || doc.cross_document_mismatches?.length);
  }

  async function act(doc, status, rejectionReason) {
    if (!auth || !isRecruiter) return;
    const id = docKey(doc);
    if (!id) return;
    setBusyId(id);
    try {
      await verifyDocument(
        id,
        {
          status,
          rejection_reason: rejectionReason || null,
          approve_despite_mismatch: status === "verified" && hasMismatch(doc),
        },
        auth.accessToken
      );
      setDocs((prev) =>
        prev.map((d) =>
          docKey(d) === id
            ? { ...d, status, verification_status: status, rejection_reason: rejectionReason || null }
            : d
        )
      );
      const label = DOC_TYPE_LABEL[doc.doc_type] || doc.doc_type;
      const who = attachment.data.full_name || "this person";
      if (status === "verified") {
        onLocalNote(`Marked ${label} as verified for ${who}.`);
      } else if (status === "reupload_required") {
        onLocalNote(`Requested a re-upload of ${label} for ${who}${rejectionReason ? ` — ${rejectionReason}` : ""}.`);
      } else {
        onLocalNote(
          `Marked ${label} as ${status.replace(/_/g, " ")} for ${who}${
            rejectionReason ? ` — ${rejectionReason}` : ""
          }.`
        );
      }
    } catch (err) {
      onLocalNote(getApiErrorMessage(err, "That verification action didn't go through — please try again."), true);
    } finally {
      setBusyId(null);
      setReasonFor(null);
      setReason("");
    }
  }

  function toggleReason(id, kind) {
    setReason("");
    setReasonFor((current) => (current?.id === id && current?.kind === kind ? null : { id, kind }));
  }

  if (!docs.length) {
    return <div className={styles.attachmentEmpty}>No documents uploaded yet.</div>;
  }

  return (
    <div className={styles.docGrid}>
      {docs.map((doc) => {
        const id = docKey(doc);
        const status = resolvedStatus(doc);
        const tone = statusTone(status);
        const busy = busyId === id;
        const openUrl = docFileUrl(doc);
        const isVerified = status === "verified";
        const isFinalReject = status === "rejected";
        const awaitingReupload = status === "reupload_required";
        const canVerify = isRecruiter && !isVerified && !awaitingReupload;
        const canReject = isRecruiter && !isVerified && !awaitingReupload && !isFinalReject;
        const canRequestReupload = isRecruiter && !isVerified && !awaitingReupload;
        const canSelfReupload =
          !isRecruiter && typeof onSelfReupload === "function" && !isVerified;
        const reasonOpen = reasonFor?.id === id ? reasonFor.kind : null;

        return (
          <div key={id || doc.file_name} className={styles.docCard}>
            <div className={styles.docCardTop}>
              <span className={styles.docIcon}>
                <IconFile />
              </span>
              <div className={styles.docCardText}>
                <div className={styles.docCardTitle}>{DOC_TYPE_LABEL[doc.doc_type] || doc.doc_type}</div>
                <div className={styles.docCardMeta}>{doc.file_name || "Uploaded file"}</div>
              </div>
              <span className={`${styles.statusPill} ${styles[`tone_${tone}`]}`}>
                {status.replace(/_/g, " ")}
              </span>
            </div>

            {doc.mismatches?.length || doc.cross_document_mismatches?.length ? (
              <div className={styles.docMismatch}>
                {[...(doc.mismatches || []), ...(doc.cross_document_mismatches || [])].slice(0, 2).join(" · ")}
              </div>
            ) : null}

            {doc.rejection_reason || doc.reupload_request_reason ? (
              <div className={styles.docMismatch}>
                {doc.rejection_reason || doc.reupload_request_reason}
              </div>
            ) : null}

            <div className={styles.docActions}>
              {openUrl ? (
                <a href={openUrl} target="_blank" rel="noreferrer" className={styles.docOpenLink}>
                  Open file
                </a>
              ) : (
                <span className={styles.docOpenLink} style={{ opacity: 0.45, pointerEvents: "none" }}>
                  No file link
                </span>
              )}

              {isVerified ? (
                <span className={styles.docDoneHint}>Verified</span>
              ) : null}

              {awaitingReupload ? (
                <span className={styles.docDoneHint}>Re-upload requested</span>
              ) : null}

              {canSelfReupload ? (
                <button
                  type="button"
                  className={styles.docReuploadBtn}
                  disabled={busy}
                  onClick={() => onSelfReupload(doc)}
                >
                  Re-upload
                </button>
              ) : null}

              {canVerify ? (
                <button
                  type="button"
                  className={styles.docVerifyBtn}
                  disabled={busy}
                  onClick={() => act(doc, "verified")}
                >
                  {busy ? "Working…" : hasMismatch(doc) ? "Approve anyway" : "Verify"}
                </button>
              ) : null}

              {canRequestReupload ? (
                <button
                  type="button"
                  className={styles.docReuploadBtn}
                  disabled={busy}
                  onClick={() => toggleReason(id, "reupload_required")}
                >
                  Request reupload
                </button>
              ) : null}

              {canReject ? (
                <button
                  type="button"
                  className={styles.docRejectBtn}
                  disabled={busy}
                  onClick={() => toggleReason(id, "rejected")}
                >
                  Reject
                </button>
              ) : null}
            </div>

            {isRecruiter && reasonOpen ? (
              <div className={styles.reasonRow}>
                <input
                  className={styles.reasonInput}
                  placeholder={
                    reasonOpen === "reupload_required"
                      ? "Why does this need a re-upload?"
                      : "Reason for rejection…"
                  }
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  autoFocus
                />
                <button
                  type="button"
                  className={reasonOpen === "reupload_required" ? styles.docReuploadBtn : styles.docRejectBtn}
                  disabled={!reason.trim() || busy}
                  onClick={() => act(doc, reasonOpen, reason.trim())}
                >
                  Confirm
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function PeopleAttachment({ attachment }) {
  const items = attachment.data.candidates || attachment.data.employees || attachment.data.results || [];
  if (!items.length) return <div className={styles.attachmentEmpty}>Nothing to show.</div>;
  return (
    <div className={styles.peopleGrid}>
      {items.slice(0, 12).map((p) => (
        <div key={p.email || p.employee_id || p.id || p.full_name} className={styles.personCard}>
          <div className={styles.personName}>{p.full_name || p.name || "Person"}</div>
          <div className={styles.personMeta}>{p.email || p.job_title || p.department || ""}</div>
          <span className={`${styles.statusPill} ${styles.tone_neutral}`}>
            {(p.conversion_status || p.profile_status || p.onboarding_status || p.status || "on file")
              .toString()
              .replaceAll("_", " ")}
          </span>
        </div>
      ))}
    </div>
  );
}

function ListCardsAttachment({ attachment, itemKey }) {
  const items = attachment.data[itemKey] || attachment.data.items || [];
  if (!items.length) return <div className={styles.attachmentEmpty}>Nothing to show.</div>;
  return (
    <div className={styles.peopleGrid}>
      {items.slice(0, 12).map((item, index) => {
        const title = item.title || item.course_title || item.name || `Item ${index + 1}`;
        const meta =
          item.url ||
          item.course_url ||
          item.department ||
          item.type ||
          item.provider ||
          item.verification_status ||
          "";
        const href = item.url || item.course_url || item.file_url || item.certificate_url || item.document_url || item.download_url;
        return (
          <div key={item.uid || item.id || item.opportunity_id || `${title}-${index}`} className={styles.personCard}>
            <div className={styles.personName}>{title}</div>
            {meta ? <div className={styles.personMeta}>{String(meta).slice(0, 120)}</div> : null}
            {href ? (
              <a className={styles.docOpenBtn} href={href} target="_blank" rel="noreferrer">
                Open
              </a>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function CertificatesAttachment({ attachment, auth, onLocalNote }) {
  const [certs, setCerts] = useState(attachment.data.certificates || []);
  const [busyId, setBusyId] = useState(null);
  const [rejectId, setRejectId] = useState(null);
  const [rejectNote, setRejectNote] = useState("");
  const isRecruiter = auth?.user?.role === "recruiter" || auth?.user?.role === "super_admin";

  useEffect(() => {
    setCerts(attachment.data.certificates || []);
  }, [attachment]);

  if (!certs.length) return <div className={styles.attachmentEmpty}>No certificates to show.</div>;

  async function act(cert, approve, note) {
    if (!auth || !cert?.id) return;
    setBusyId(cert.id);
    try {
      await verifyCertificate(auth.accessToken, cert.id, { approve, note: note || undefined });
      setCerts((prev) =>
        prev.map((c) =>
          c.id === cert.id
            ? {
                ...c,
                verification_status: approve ? "verified" : "rejected",
                rejection_reason: approve ? null : note || c.rejection_reason,
              }
            : c
        )
      );
      onLocalNote(
        approve
          ? `Verified certificate “${cert.course_title || cert.name || cert.id}”.`
          : `Rejected certificate “${cert.course_title || cert.name || cert.id}”${note ? ` — ${note}` : ""}.`
      );
      setRejectId(null);
      setRejectNote("");
    } catch (err) {
      onLocalNote(getApiErrorMessage(err, "Could not update that certificate."), true);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={styles.peopleGrid}>
      {certs.slice(0, 12).map((cert) => {
        const href = cert.file_url || cert.certificate_url || cert.source_url || cert.document_url;
        const status = String(cert.verification_status || "pending").toLowerCase();
        return (
          <div key={cert.id || cert.course_title} className={styles.personCard}>
            <div className={styles.personName}>{cert.course_title || cert.name || "Certificate"}</div>
            <div className={styles.personMeta}>
              {[cert.employee_name, cert.employee_id, status.replaceAll("_", " ")].filter(Boolean).join(" · ")}
            </div>
            {href ? (
              <a className={styles.docOpenBtn} href={href} target="_blank" rel="noreferrer">
                Open certificate
              </a>
            ) : (
              <div className={styles.personMeta}>No file URL on file</div>
            )}
            {cert.source_url && cert.source_url !== href ? (
              <a className={styles.docOpenBtn} href={cert.source_url} target="_blank" rel="noreferrer">
                Public URL
              </a>
            ) : null}
            {isRecruiter && status === "pending" ? (
              <div className={styles.confirmActions} style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className={styles.docVerifyBtn}
                  disabled={busyId === cert.id}
                  onClick={() => act(cert, true)}
                >
                  Verify
                </button>
                {rejectId === cert.id ? (
                  <>
                    <input
                      className={styles.reasonInput}
                      placeholder="Reason (optional)"
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                    />
                    <button
                      type="button"
                      className={styles.docRejectBtn}
                      disabled={busyId === cert.id}
                      onClick={() => act(cert, false, rejectNote)}
                    >
                      Confirm reject
                    </button>
                  </>
                ) : (
                  <button type="button" className={styles.docRejectBtn} onClick={() => setRejectId(cert.id)}>
                    Reject
                  </button>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function OfferAttachment({ attachment }) {
  const offer = attachment.data.offer || attachment.data;
  if (!offer || typeof offer !== "object") {
    return <div className={styles.attachmentEmpty}>No offer on file.</div>;
  }
  const status = (offer.status || "unknown").toString().toLowerCase();
  const isSigned = status === "signed" || Boolean(offer.signed_at);
  return (
    <div className={styles.personCard}>
      <div className={styles.personName}>{offer.job_title || "Offer letter"}</div>
      <div className={styles.personMeta}>
        {[offer.department, offer.employment_type, offer.start_date].filter(Boolean).join(" · ")}
      </div>
      <span className={`${styles.statusPill} ${isSigned ? styles.tone_good : styles.tone_neutral}`}>
        {status.replaceAll("_", " ")}
      </span>
      <a className={styles.docOpenBtn} href="/offer" style={{ marginTop: 8, display: "inline-flex" }}>
        {isSigned ? "View signed offer" : "Review & sign offer"}
      </a>
    </div>
  );
}

function CsvExportAttachment({ attachment }) {
  const csv = attachment.data.csv;
  const filename = attachment.data.filename || "export.csv";
  const rowCount = attachment.data.row_count;
  if (!csv) return <div className={styles.attachmentEmpty}>No CSV data.</div>;

  function download() {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={styles.personCard}>
      <div className={styles.personName}>CSV export ready</div>
      <div className={styles.personMeta}>{rowCount != null ? `${rowCount} row(s)` : filename}</div>
      <button type="button" className={styles.docOpenBtn} onClick={download}>
        Download CSV
      </button>
    </div>
  );
}

function ProgressSteps({ steps }) {
  if (!steps?.length) return null;
  return (
    <ol className={styles.progressList}>
      {steps.map((step, index) => (
        <li key={`${step.tool}-${index}`} className={step.ok ? styles.progressOk : styles.progressFail}>
          <span className={styles.progressMark}>{step.ok ? "✓" : "!"}</span>
          <span>{step.label || step.tool}</span>
        </li>
      ))}
    </ol>
  );
}

function ConfirmationGate({ confirmation, onApprove, onCancel, disabled }) {
  if (!confirmation) return null;
  return (
    <div className={styles.confirmGate}>
      <div className={styles.confirmSummary}>{confirmation.summary || "Confirm this action?"}</div>
      <div className={styles.confirmActions}>
        <button type="button" className={styles.confirmApprove} disabled={disabled} onClick={onApprove}>
          Approve
        </button>
        <button type="button" className={styles.confirmCancel} disabled={disabled} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Attachment({ attachment, auth, onLocalNote, onSelfReupload }) {
  if (!attachment) return null;
  if (attachment.type === "documents") {
    return (
      <DocumentsAttachment
        attachment={attachment}
        auth={auth}
        onLocalNote={onLocalNote}
        onSelfReupload={onSelfReupload}
      />
    );
  }
  if (attachment.type === "candidates" || attachment.type === "employees") {
    return <PeopleAttachment attachment={attachment} />;
  }
  if (attachment.type === "courses") {
    return <ListCardsAttachment attachment={attachment} itemKey="courses" />;
  }
  if (attachment.type === "opportunities") {
    return <ListCardsAttachment attachment={attachment} itemKey="opportunities" />;
  }
  if (attachment.type === "certificates") {
    return <CertificatesAttachment attachment={attachment} auth={auth} onLocalNote={onLocalNote} />;
  }
  if (attachment.type === "offer") {
    return <OfferAttachment attachment={attachment} />;
  }
  if (attachment.type === "csv_export") {
    return <CsvExportAttachment attachment={attachment} />;
  }
  return null;
}

/**
 * variant: "floating" (default, chrome-less body meant to sit inside the
 * launcher panel) or "canvas" (large, embedded, full-height surface used as
 * the default onboarding screen / AI assistant page).
 */
const AgentChatCoreInner = forwardRef(function AgentChatCoreInner({ variant = "floating", auth, onEscalate, context = null, searchParams }, ref) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [uploadingKey, setUploadingKey] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [suggestedReplies, setSuggestedReplies] = useState([]);
  const [errorBanner, setErrorBanner] = useState("");
  const [consecutiveErrors, setConsecutiveErrors] = useState(0);

  const bodyRef = useRef(null);
  const docInputRef = useRef(null);
  const sheetInputRef = useRef(null);
  const pendingUploadHint = useRef(null);
  const router = useRouter();
  const pathname = usePathname();

  const assistantContext = useMemo(
    () => buildAssistantContext({ pathname, searchParams, auth, extraContext: context }),
    [auth, context, pathname, searchParams]
  );

  const copy = auth ? ROLE_COPY[auth.user.role] || ROLE_COPY.employee : null;
  const isRecruiter = auth?.user?.role === "recruiter" || auth?.user?.role === "super_admin";

  const storageKey = useMemo(() => {
    if (!auth) return null;
    const userId = auth.user.id || auth.user._id || auth.user.email;
    return `agent_session_${auth.user.role}_${userId}`;
  }, [auth]);

  useEffect(() => {
    if (!auth || !storageKey) return;
    const existing = typeof window !== "undefined" ? sessionStorage.getItem(storageKey) : null;
    if (existing) {
      setSessionId(existing);
      getAgentHistory(auth.accessToken, existing)
        .then((data) => {
          if (data?.messages?.length) setMessages(data.messages);
        })
        .catch(() => {});
    } else {
      setSessionId(null);
      setMessages([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [messages, sending]);

  const persistSession = useCallback(
    (sid) => {
      setSessionId(sid);
      if (storageKey && typeof window !== "undefined") {
        sessionStorage.setItem(storageKey, sid);
      }
    },
    [storageKey]
  );

  const pushLocalMessages = useCallback((msgs) => {
    setMessages((prev) => [...prev, ...msgs]);
  }, []);

  const doSend = useCallback(
    async (text) => {
      const trimmed = text.trim();
      if (!trimmed || !auth) return;
      setErrorBanner("");
      setInput("");
      pushLocalMessages([{ role: "user", content: trimmed, created_at: new Date().toISOString() }]);
      setSending(true);
      try {
        const data = await sendAgentMessage(auth.accessToken, trimmed, sessionId, assistantContext);
        persistSession(data.session_id);
        setMessages(data.messages || []);
        setSuggestedReplies(data.suggested_replies || []);
        setConsecutiveErrors(0);
      } catch (err) {
        setErrorBanner(getAgentErrorMessage(err, "I couldn't reach the agent just now. Please try again."));
        setConsecutiveErrors((n) => n + 1);
      } finally {
        setSending(false);
      }
    },
    [assistantContext, auth, sessionId, persistSession, pushLocalMessages]
  );

  useImperativeHandle(
    ref,
    () => ({
      sendPrompt: (text) => doSend(text),
      openSheetPicker: () => sheetInputRef.current?.click(),
    }),
    [doSend]
  );

  function handleSubmit(e) {
    e.preventDefault();
    doSend(input);
  }

  function onLocalNote(text, isError) {
    pushLocalMessages([
      {
        role: "assistant",
        content: text,
        created_at: new Date().toISOString(),
        meta: isError ? { error: true } : undefined,
      },
    ]);
  }

  function handleAction(action) {
    if (!action) return;
    if (action.kind === "prompt" && action.prompt) {
      doSend(action.prompt);
      return;
    }
    if (action.route) {
      router.push(action.route);
    }
  }

  function openDocPicker(hint) {
    pendingUploadHint.current = hint;
    docInputRef.current?.click();
  }

  async function handleDocFileChosen(e) {
    const file = e.target.files?.[0];
    const hint = pendingUploadHint.current;
    e.target.value = "";
    if (!file || !hint || !auth) return;

    const docType = String(hint.doc_type || "").toLowerCase();

    // Recruiters: spreadsheet roster OR own profile photo — never /api/documents/upload.
    if (isRecruiter && docType !== "photo") {
      await handleSheetFileChosen({ target: { files: [file], value: "" } });
      return;
    }
    if (isSpreadsheetHint(hint)) {
      await handleSheetFileChosen({ target: { files: [file], value: "" } });
      return;
    }

    const key = `${docType}-${Date.now()}`;
    setUploadingKey(key);
    setErrorBanner("");
    try {
      if (docType === "photo") {
        if (isRecruiter) {
          await uploadRecruiterPhoto(file, auth.accessToken);
        } else {
          await uploadEmployeePhoto(file, auth.accessToken);
        }
        await doSend("I've uploaded my profile photo.");
        return;
      }

      if (docType === "certificate" || docType === "skill_certificate") {
        const role = auth.user?.role;
        if (role === "employee") {
          const formData = new FormData();
          formData.append("file", file);
          formData.append("course_title", hint.course_title || hint.title || "Certificate");
          if (hint.course_uid) formData.append("course_uid", hint.course_uid);
          if (hint.source_url) formData.append("source_url", hint.source_url);
          const result = await uploadCertificate(auth.accessToken, formData);
          const cert = result?.certificate || result || {};
          const url = cert.file_url || cert.certificate_url || "";
          await doSend(
            `I've uploaded my certificate for ${hint.course_title || hint.title || "my course"}.` +
              (url ? ` Certificate URL for recruiter verification: ${url}` : " Please confirm it was saved with a file URL.")
          );
          return;
        }

        // Candidate (and employee fallback): store URL on skills.certifications.document_url
        const formData = new FormData();
        formData.append("file", file);
        formData.append("purpose", "skill_cert");
        formData.append("index", String(hint.index || 0));
        const data = await uploadOnboardingFile(formData, auth.accessToken);
        const url = data.file_url || data.document_url;
        const certName = hint.course_title || hint.title || hint.cert_name || "my certification";
        await doSend(
          `I've uploaded the certificate file for "${certName}".` +
            (url
              ? ` Save it on my skills certifications with document_url=${url} (recruiter must be able to open this URL).`
              : " Please attach the returned document URL to my skills certifications.")
        );
        return;
      }

      if (docType === "bank_slip") {
        const data = await analyzeBankSlip(file, auth.accessToken);
        const fields = data?.fields || data?.extracted || data || {};
        const summary = typeof fields === "object" ? JSON.stringify(fields) : String(fields);
        await doSend(
          `I uploaded my bank slip. Please use these OCR fields for my employment/banking step (ask me to confirm before saving): ${summary}`
        );
        return;
      }

      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", hint.category || categoryForDocType(hint.doc_type));
      formData.append("doc_type", hint.doc_type);
      const purpose = purposeForDocType(hint.doc_type);

      // For onboarding-purpose doc types (cnic, passport, transcript, resume) use the
      // purpose-aware endpoint so employee.onboarding is kept in sync via attach_uploaded_file.
      // For generic/unsupported types fall back to the general document upload endpoint.
      let uploadResult = null;
      if (purpose) {
        formData.append("purpose", purpose);
        uploadResult = await uploadOnboardingFile(formData, auth.accessToken);
      } else {
        uploadResult = await uploadDocument(formData, auth.accessToken);
      }
      const label = DOC_TYPE_LABEL[hint.doc_type] || hint.doc_type;
      const ocr = uploadResult?.ocr_result || uploadResult?.document?.ocr_result;
      const fields = ocr?.fields && typeof ocr.fields === "object" ? ocr.fields : null;
      if (fields && Object.keys(fields).length > 0 && ocr?.status !== "rejected_type") {
        await doSend(
          `I've uploaded my ${label}. OCR extracted these fields — save them into my onboarding/profile now ` +
            `(use update_my_profile and/or save_step with only real extracted values; ask me to confirm anything uncertain): ` +
            JSON.stringify(fields)
        );
      } else if (ocr?.status === "rejected_type") {
        await doSend(
          `I've uploaded a file meant to be my ${label}, but OCR rejected the document type` +
            `${ocr.rejection_message ? ` (${ocr.rejection_message})` : ""}. Please tell me what to do next.`
        );
      } else {
        await doSend(`I've uploaded my ${label}.`);
      }
    } catch (err) {
      setErrorBanner(getApiErrorMessage(err, "That upload didn't go through — please try again."));
    } finally {
      setUploadingKey(null);
    }
  }

  function approveConfirmation(confirmation) {
    if (!confirmation?.tool) return;
    const payload = JSON.stringify({ tool: confirmation.tool, args: confirmation.args || {} });
    doSend(`${CONFIRM_PREFIX}${payload}`);
  }

  function cancelConfirmation() {
    doSend("Cancel — do not proceed with that action.");
  }

  async function handleSheetFileChosen(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !auth) return;

    setSending(true);
    setErrorBanner("");
    pushLocalMessages([
      { role: "user", content: `[Uploaded spreadsheet: ${file.name}]`, created_at: new Date().toISOString() },
    ]);
    try {
      const data = await bulkInviteSpreadsheet(auth.accessToken, file, sessionId);
      persistSession(data.session_id);
      pushLocalMessages([{ role: "assistant", content: data.message, created_at: new Date().toISOString() }]);
    } catch (err) {
      setErrorBanner(getAgentErrorMessage(err, "Couldn't process that spreadsheet."));
    } finally {
      setSending(false);
    }
  }

  function handleReset() {
    setMessages([]);
    setSuggestedReplies([]);
    setSessionId(null);
    setErrorBanner("");
    setConsecutiveErrors(0);
    if (storageKey && typeof window !== "undefined") sessionStorage.removeItem(storageKey);
  }

  if (!auth) return null;

  return (
    <div className={variant === "canvas" ? styles.canvasRoot : styles.floatingRoot}>
      <div className={variant === "canvas" ? styles.canvasHeader : styles.header}>
        <div className={styles.headerIcon}>
          <IconChat />
        </div>
        <div className={styles.headerText}>
          <div className={styles.headerTitle}>{copy?.title}</div>
          <div className={styles.headerSubtitle}>{copy?.subtitle}</div>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.iconButton} onClick={handleReset} aria-label="Start a new conversation" title="New conversation">
            <IconRefresh />
          </button>
        </div>
      </div>

      <div className={variant === "canvas" ? styles.canvasBody : styles.body} ref={bodyRef}>
        {messages.length === 0 ? (
          <div className={styles.emptyState}>
            <strong>{copy?.title}</strong>
            <p>{copy?.empty}</p>
            <div className={styles.starterGrid}>
              {copy?.starters.map((s) => (
                <button key={s} type="button" className={styles.starterButton} onClick={() => doSend(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, idx) => {
            const isUser = m.role === "user";
            const uiHint = m.meta?.ui_hint;
            const attachment = m.meta?.attachment;
            const actions = m.meta?.actions || [];
            const progress = m.meta?.progress || [];
            const confirmation = m.meta?.confirmation;
            const isErrorNote = m.meta?.error;
            const isLatest = idx === messages.length - 1;
            return (
              <div key={m.created_at ? `${m.created_at}-${idx}` : idx} className={`${styles.row} ${isUser ? styles.rowUser : styles.rowAgent}`}>
                <div className={`${styles.bubble} ${isUser ? styles.bubbleUser : styles.bubbleAgent} ${isErrorNote ? styles.bubbleError : ""}`}>
                  {isUser ? m.content : linkifyText(m.content)}
                  {!isUser && progress.length > 0 ? <ProgressSteps steps={progress} /> : null}
                  {!isUser && isSpreadsheetHint(uiHint) ? (
                    <div className={styles.uploadHint}>
                      <button
                        type="button"
                        className={styles.uploadButton}
                        disabled={sending}
                        onClick={() => sheetInputRef.current?.click()}
                      >
                        {sending ? "Uploading…" : "Upload Excel / CSV"}
                      </button>
                    </div>
                  ) : null}
                  {!isUser && canShowUploadHint(uiHint, isRecruiter) ? (
                    <div className={styles.uploadHint}>
                      <button
                        type="button"
                        className={styles.uploadButton}
                        disabled={uploadingKey !== null}
                        onClick={() => openDocPicker(uiHint)}
                      >
                        {uploadingKey !== null
                          ? "Uploading…"
                          : `Upload ${DOC_TYPE_LABEL[uiHint.doc_type] || uiHint.doc_type}`}
                      </button>
                    </div>
                  ) : null}
                  {!isUser && attachment ? (
                    <div className={styles.attachmentWrap}>
                      <Attachment
                        attachment={attachment}
                        auth={auth}
                        onLocalNote={onLocalNote}
                        onSelfReupload={(doc) =>
                          openDocPicker({
                            type: "upload",
                            doc_type: doc.doc_type || "other",
                            category: categoryForDocType(doc.doc_type),
                          })
                        }
                      />
                    </div>
                  ) : null}
                  {!isUser && confirmation && isLatest ? (
                    <ConfirmationGate
                      confirmation={confirmation}
                      disabled={sending}
                      onApprove={() => approveConfirmation(confirmation)}
                      onCancel={cancelConfirmation}
                    />
                  ) : null}
                  {/* Only the latest reply shows nav chips — repeating them on every bubble looks spammy. */}
                  {!isUser && isLatest && actions.length > 0 ? (
                    <div className={styles.bubbleActions}>
                      {actions.map((action) => (
                        <button
                          key={`${action.kind}-${action.label}`}
                          type="button"
                          className={styles.bubbleActionChip}
                          onClick={() => handleAction(action)}
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
        {sending ? (
          <div className={`${styles.row} ${styles.rowAgent}`}>
            <div className={`${styles.bubble} ${styles.bubbleAgent}`}>
              <span className={styles.typing}>
                <span />
                <span />
                <span />
              </span>
            </div>
          </div>
        ) : null}
        {errorBanner ? (
          <div className={`${styles.row} ${styles.rowAgent}`}>
            <div className={`${styles.bubble} ${styles.bubbleAgent} ${styles.bubbleError}`}>{errorBanner}</div>
          </div>
        ) : null}
        {!isRecruiter && onEscalate && consecutiveErrors >= 2 ? (
          <div className={styles.escalateBanner}>
            <span>Having trouble with the agent right now.</span>
            <button type="button" className={styles.escalateBtn} onClick={onEscalate}>
              Switch to manual form
            </button>
          </div>
        ) : null}
      </div>

      {suggestedReplies.length > 0 ? (
        <div className={styles.suggestions}>
          {suggestedReplies.map((s) => (
            <button key={s} type="button" className={styles.suggestionChip} onClick={() => doSend(s)}>
              {s}
            </button>
          ))}
        </div>
      ) : null}

      <form className={styles.footer} onSubmit={handleSubmit}>
        {isRecruiter ? (
          <>
            <button
              type="button"
              className={styles.attachButton}
              title="Attach a candidate spreadsheet (.xlsx or .csv)"
              aria-label="Attach spreadsheet"
              disabled={sending}
              onClick={() => sheetInputRef.current?.click()}
            >
              <IconPaperclip />
            </button>
            <input
              ref={sheetInputRef}
              type="file"
              accept=".xlsx,.xlsm,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className={styles.visuallyHidden}
              onChange={handleSheetFileChosen}
            />
          </>
        ) : null}
        <textarea
          className={styles.textarea}
          placeholder={isRecruiter ? (auth?.user?.role === "super_admin" ? "Message the platform admin agent…" : "Message the hiring agent…") : "Message the onboarding agent…"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              doSend(input);
            }
          }}
          rows={1}
          disabled={sending}
        />
        <button type="submit" className={styles.sendButton} disabled={sending || !input.trim()} aria-label="Send">
          <IconSend />
        </button>
      </form>

      <input ref={docInputRef} type="file" accept=".jpg,.jpeg,.png,.pdf,.doc,.docx" className={styles.visuallyHidden} onChange={handleDocFileChosen} />
    </div>
  );
});

/**
 * Thin bridge that reads useSearchParams() inside a Suspense boundary so the
 * static-generation pass doesn't fail. AgentChatCoreInner receives searchParams
 * as a plain prop — no hook call at the outer forwardRef level.
 */
function SearchParamsBridge({ innerRef, ...props }) {
  const searchParams = useSearchParams();
  return <AgentChatCoreInner ref={innerRef} {...props} searchParams={searchParams} />;
}

const AgentChatCore = forwardRef(function AgentChatCore(props, ref) {
  return (
    <Suspense fallback={null}>
      <SearchParamsBridge innerRef={ref} {...props} />
    </Suspense>
  );
});

export default AgentChatCore;

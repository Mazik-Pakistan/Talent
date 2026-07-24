"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

import { getApiErrorMessage, uploadDocument, verifyDocument } from "@/services/authService";
import {
  bulkInviteSpreadsheet,
  getAgentErrorMessage,
  getAgentHistory,
  sendAgentMessage,
} from "@/services/agentService";
import styles from "./AgentChatCore.module.css";

export const ALLOWED_ROLES = ["candidate", "employee", "recruiter", "super_admin"];

const ROLE_COPY = {
  recruiter: {
    title: "Hiring Agent",
    subtitle: "Anything you do in recruiting — for one person or in bulk",
    empty:
      "Tell me what you need — a person, a bulk action, or a goal. I can help across invites, pipeline, offers, documents, Day-1, reminders, search, and announcements.",
    starters: [
      "What can you help me with?",
      "Show my hiring pipeline",
      "Remind incomplete employee profiles",
      "Invite a new candidate",
    ],
  },
  super_admin: {
    title: "Hiring Agent",
    subtitle: "Anything you do in recruiting — for one person or in bulk",
    empty:
      "Tell me what you need — a person, a bulk action, or a goal. I can help across invites, pipeline, offers, documents, Day-1, reminders, search, and announcements.",
    starters: [
      "What can you help me with?",
      "Show my hiring pipeline",
      "Remind incomplete employee profiles",
      "Invite a new candidate",
    ],
  },
  candidate: {
    title: "Onboarding Agent",
    subtitle: "Let's get your profile ready",
    empty: "Tell me \"complete my onboarding\" and I'll walk you through it — or ask what's still missing.",
    starters: ["Complete my onboarding", "What do I still need to upload?", "Check my progress"],
  },
  employee: {
    title: "Onboarding Agent",
    subtitle: "Finish setting up your profile",
    empty: "Tell me \"continue my onboarding\" and I'll walk you through what's left.",
    starters: ["Continue my onboarding", "What's left to complete?", "Check my progress"],
  },
};

const DOC_TYPE_LABEL = {
  cnic: "National ID (CNIC)",
  passport: "Passport",
  transcript: "academic transcript",
  resume: "resume",
};

function purposeForDocType(docType) {
  if (docType === "resume") return "resume";
  if (docType === "transcript") return "education_cert";
  if (docType === "cnic" || docType === "passport") return "government_doc";
  return undefined;
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
  if (status === "verified") return "good";
  if (status === "rejected" || status === "mismatch") return "bad";
  if (status === "reupload_required") return "warn";
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

/**
 * DocumentsAttachment — recruiter-facing document review cards rendered inline
 * in the agent chat. Verify/reject act directly against the documents API
 * (not through the LLM) so the outcome is instant and deterministic; a short
 * confirmation line is then appended to the conversation for continuity.
 */
function DocumentsAttachment({ attachment, auth, onLocalNote }) {
  const [busyId, setBusyId] = useState(null);
  const [reasonFor, setReasonFor] = useState(null);
  const [reason, setReason] = useState("");
  const [docs, setDocs] = useState(attachment.data.documents || []);

  useEffect(() => {
    setDocs(attachment.data.documents || []);
  }, [attachment]);

  async function act(doc, status, rejectionReason) {
    if (!auth) return;
    const id = docKey(doc);
    if (!id) return;
    setBusyId(id);
    try {
      await verifyDocument(id, { status, rejection_reason: rejectionReason || null }, auth.accessToken);
      setDocs((prev) =>
        prev.map((d) => (docKey(d) === id ? { ...d, status, verification_status: status } : d))
      );
      const label = DOC_TYPE_LABEL[doc.doc_type] || doc.doc_type;
      onLocalNote(
        status === "verified"
          ? `Marked ${label} as verified for ${attachment.data.full_name || "this person"}.`
          : `Marked ${label} as ${status.replace("_", " ")} for ${attachment.data.full_name || "this person"}${
              rejectionReason ? ` — ${rejectionReason}` : ""
            }.`
      );
    } catch (err) {
      onLocalNote(getApiErrorMessage(err, "That verification action didn't go through — please try again."), true);
    } finally {
      setBusyId(null);
      setReasonFor(null);
      setReason("");
    }
  }

  if (!docs.length) {
    return <div className={styles.attachmentEmpty}>No documents uploaded yet.</div>;
  }

  return (
    <div className={styles.docGrid}>
      {docs.map((doc) => {
        const id = docKey(doc);
        const tone = statusTone(doc.verification_status || doc.status);
        const busy = busyId === id;
        const openUrl = docFileUrl(doc);
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
                {(doc.verification_status || doc.status || "pending").replace("_", " ")}
              </span>
            </div>

            {doc.mismatches?.length || doc.cross_document_mismatches?.length ? (
              <div className={styles.docMismatch}>
                {[...(doc.mismatches || []), ...(doc.cross_document_mismatches || [])].slice(0, 2).join(" · ")}
              </div>
            ) : null}

            <div className={styles.docActions}>
              {openUrl ? (
                <a href={openUrl} target="_blank" rel="noreferrer" className={styles.docOpenLink}>
                  Open file
                </a>
              ) : null}
              <button
                type="button"
                className={styles.docVerifyBtn}
                disabled={busy}
                onClick={() => act(doc, "verified")}
              >
                {busy ? "Working…" : "Verify"}
              </button>
              <button
                type="button"
                className={styles.docRejectBtn}
                disabled={busy}
                onClick={() => setReasonFor(reasonFor === id ? null : id)}
              >
                Reject
              </button>
            </div>

            {reasonFor === id ? (
              <div className={styles.reasonRow}>
                <input
                  className={styles.reasonInput}
                  placeholder="Reason for rejection…"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  autoFocus
                />
                <button
                  type="button"
                  className={styles.docRejectBtn}
                  disabled={!reason.trim() || busy}
                  onClick={() => act(doc, "rejected", reason.trim())}
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
  const items = attachment.data.candidates || attachment.data.employees || [];
  if (!items.length) return <div className={styles.attachmentEmpty}>Nothing to show.</div>;
  return (
    <div className={styles.peopleGrid}>
      {items.slice(0, 12).map((p) => (
        <div key={p.email} className={styles.personCard}>
          <div className={styles.personName}>{p.full_name}</div>
          <div className={styles.personMeta}>{p.email}</div>
          <span className={`${styles.statusPill} ${styles.tone_neutral}`}>
            {(p.conversion_status || p.profile_status || p.onboarding_status || "on file").toString().replace("_", " ")}
          </span>
        </div>
      ))}
    </div>
  );
}

function Attachment({ attachment, auth, onLocalNote }) {
  if (!attachment) return null;
  if (attachment.type === "documents") {
    return <DocumentsAttachment attachment={attachment} auth={auth} onLocalNote={onLocalNote} />;
  }
  if (attachment.type === "candidates" || attachment.type === "employees") {
    return <PeopleAttachment attachment={attachment} />;
  }
  return null;
}

/**
 * variant: "floating" (default, chrome-less body meant to sit inside the
 * launcher panel) or "canvas" (large, embedded, full-height surface used as
 * the default onboarding screen / AI assistant page).
 */
const AgentChatCore = forwardRef(function AgentChatCore({ variant = "floating", auth, onEscalate }, ref) {
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
        const data = await sendAgentMessage(auth.accessToken, trimmed, sessionId);
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
    [auth, sessionId, persistSession, pushLocalMessages]
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

  function openDocPicker(hint) {
    pendingUploadHint.current = hint;
    docInputRef.current?.click();
  }

  async function handleDocFileChosen(e) {
    const file = e.target.files?.[0];
    const hint = pendingUploadHint.current;
    e.target.value = "";
    if (!file || !hint || !auth) return;

    // Recruiters must use the bulk-invite endpoint, never /api/documents/upload.
    if (isRecruiter || isSpreadsheetHint(hint)) {
      await handleSheetFileChosen({ target: { files: [file], value: "" } });
      return;
    }

    const key = `${hint.doc_type}-${Date.now()}`;
    setUploadingKey(key);
    setErrorBanner("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", hint.category || "other");
      formData.append("doc_type", hint.doc_type);
      const purpose = purposeForDocType(hint.doc_type);
      if (purpose) formData.append("purpose", purpose);

      await uploadDocument(formData, auth.accessToken);
      const label = DOC_TYPE_LABEL[hint.doc_type] || hint.doc_type;
      await doSend(`I've uploaded my ${label}.`);
    } catch (err) {
      setErrorBanner(getApiErrorMessage(err, "That upload didn't go through — please try again."));
    } finally {
      setUploadingKey(null);
    }
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
            const isErrorNote = m.meta?.error;
            return (
              <div key={m.created_at ? `${m.created_at}-${idx}` : idx} className={`${styles.row} ${isUser ? styles.rowUser : styles.rowAgent}`}>
                <div className={`${styles.bubble} ${isUser ? styles.bubbleUser : styles.bubbleAgent} ${isErrorNote ? styles.bubbleError : ""}`}>
                  {isUser ? m.content : linkifyText(m.content)}
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
                  {!isUser && uiHint?.type === "upload" && !isSpreadsheetHint(uiHint) && !isRecruiter ? (
                    <div className={styles.uploadHint}>
                      <button
                        type="button"
                        className={styles.uploadButton}
                        disabled={uploadingKey !== null}
                        onClick={() => openDocPicker(uiHint)}
                      >
                        {uploadingKey !== null ? "Uploading…" : `Upload ${DOC_TYPE_LABEL[uiHint.doc_type] || uiHint.doc_type}`}
                      </button>
                    </div>
                  ) : null}
                  {!isUser && attachment ? (
                    <div className={styles.attachmentWrap}>
                      <Attachment attachment={attachment} auth={auth} onLocalNote={onLocalNote} />
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
          placeholder={isRecruiter ? "Message the hiring agent…" : "Message the onboarding agent…"}
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

      <input ref={docInputRef} type="file" accept=".jpg,.jpeg,.png,.pdf" className={styles.visuallyHidden} onChange={handleDocFileChosen} />
    </div>
  );
});

export default AgentChatCore;

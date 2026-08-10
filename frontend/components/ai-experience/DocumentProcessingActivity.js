"use client";

import { DOCUMENT_SUCCESS_LABELS, getDocumentActivities } from "@/lib/ai/documentProcessing";
import { IconAlert, IconCheck } from "./icons";
import styles from "./DocumentProcessing.module.css";

/**
 * AI-agent-style document processing indicator.
 *
 * Shows exactly ONE activity message at a time (never a checklist / stepper).
 * Shared by Resume, Transcript, and CNIC — only the message set changes.
 */
export default function DocumentProcessingActivity({
  documentType = "generic",
  fileName = null,
  status = "processing",
  activities = null,
  activityIndex = 0,
  error = null,
  onRetry = null,
  onUploadAnother = null,
}) {
  if (status === "error") {
    return (
      <div className={styles.activityError} role="alert" aria-live="assertive">
        <span className={styles.activityErrorIcon} aria-hidden="true">
          <IconAlert />
        </span>
        <strong>We couldn&apos;t finish processing this document.</strong>
        {error ? <p>{error}</p> : null}
        {onRetry || onUploadAnother ? (
          <div className={styles.activityActions}>
            {onRetry ? (
              <button type="button" className={styles.activityBtnPrimary} onClick={onRetry}>
                Try Again
              </button>
            ) : null}
            {onUploadAnother ? (
              <button type="button" className={styles.activityBtn} onClick={onUploadAnother}>
                Upload Another Document
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  if (status === "success") {
    const successLabel =
      DOCUMENT_SUCCESS_LABELS[documentType] || DOCUMENT_SUCCESS_LABELS.generic;
    return (
      <div className={styles.activityRow} role="status" aria-live="polite" data-status="success">
        <span className={styles.activitySuccessIcon} aria-hidden="true">
          <IconCheck />
        </span>
        <span key="success" className={styles.activityMessage}>
          {successLabel}
        </span>
      </div>
    );
  }

  const list =
    Array.isArray(activities) && activities.length
      ? activities
      : getDocumentActivities(documentType, fileName);
  const index = Math.min(Math.max(activityIndex, 0), Math.max(list.length - 1, 0));
  const message = list[index] || "Reading your document…";

  return (
    <div className={styles.activityRow} role="status" aria-live="polite" data-status="processing">
      <span className={styles.activitySpinner} aria-hidden="true" />
      <span key={`${documentType}-${index}-${message}`} className={styles.activityMessage}>
        <ActivityText text={message} fileName={fileName} />
      </span>
      <span className={styles.activityDots} aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}

/** Renders activity text, highlighting a matching file name when present. */
function ActivityText({ text, fileName }) {
  const name = String(fileName || "").trim();
  if (!name || !text.includes(name)) {
    return text;
  }
  const parts = text.split(name);
  return (
    <>
      {parts.map((part, i) => (
        <span key={`${i}-${part}`}>
          {part}
          {i < parts.length - 1 ? <code className={styles.activityFileName}>{name}</code> : null}
        </span>
      ))}
    </>
  );
}

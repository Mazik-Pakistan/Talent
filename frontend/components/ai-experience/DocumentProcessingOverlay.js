"use client";

import AiOrb from "./AiOrb";
import DocumentProcessingActivity from "./DocumentProcessingActivity";
import { DOCUMENT_TYPE_LABELS } from "@/lib/ai/documentProcessing";
import aiStyles from "./AiExperience.module.css";
import styles from "./DocumentProcessing.module.css";

/**
 * Full-screen unified document-processing overlay for surfaces outside the
 * onboarding OCR workspace (e.g. the Candidate documents page). Driven by the
 * shared useDocumentProcessing hook; renders the same single-activity agent
 * animation as the onboarding overlay.
 */
export default function DocumentProcessingOverlay({
  open,
  documentType = "generic",
  fileName = null,
  status = "processing",
  activities = null,
  activityIndex = 0,
  error = null,
  onRetry = null,
  onUploadAnother = null,
}) {
  if (!open || status === "idle") return null;

  const label = DOCUMENT_TYPE_LABELS[documentType] || DOCUMENT_TYPE_LABELS.generic;
  const thinking = status === "processing";
  const title =
    status === "error"
      ? "Document processing failed"
      : status === "success"
        ? `Your ${label} is ready`
        : `Processing your ${label}`;

  return (
    <div className={aiStyles.ocrOverlay} role="status" aria-live="polite" data-mascot-busy>
      <div className={`${aiStyles.ocrOverlayCard} ${styles.overlayCard}`}>
        <header className={styles.overlayHead}>
          <AiOrb size="md" thinking={thinking} particles={thinking} />
          <div>
            <div className={styles.overlayTitle}>{title}</div>
            {fileName ? <div className={styles.overlaySub}>{fileName}</div> : null}
          </div>
        </header>
        <div className={styles.overlayBody}>
          <DocumentProcessingActivity
            documentType={documentType}
            fileName={fileName}
            status={status}
            activities={activities}
            activityIndex={activityIndex}
            error={error}
            onRetry={onRetry}
            onUploadAnother={onUploadAnother}
          />
        </div>
      </div>
    </div>
  );
}

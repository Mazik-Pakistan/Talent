"use client";

import AiOrb from "./AiOrb";
import { IconAlert, IconCheck, IconSpinner } from "./icons";
import styles from "./AiExperience.module.css";

const MARKS = {
  saving: <IconSpinner />,
  success: <IconCheck />,
  error: <IconAlert />,
};

/**
 * Small floating confirmation that replaces the "click Save" habit. Appears
 * only after progress has genuinely been written to the server.
 */
export default function AiSaveToast({ notice }) {
  if (!notice) return null;

  const tone = notice.tone || "success";

  return (
    <div className={styles.toastLayer} role="status" aria-live="polite">
      <div
        key={notice.id}
        className={`${styles.toast} ${tone === "error" ? styles.toastError : ""} ${
          tone === "saving" ? styles.toastSaving : ""
        }`}
      >
        {notice.byAi && tone === "success" ? (
          <AiOrb size="sm" />
        ) : (
          <span className={styles.toastMark}>{MARKS[tone] || MARKS.success}</span>
        )}
        <span>{notice.message}</span>
      </div>
    </div>
  );
}

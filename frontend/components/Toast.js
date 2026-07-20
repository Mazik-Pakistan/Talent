"use client";

import { useEffect } from "react";
import styles from "./Toast.module.css";

/**
 * Lightweight toast stack. Pass `toast` as { id, type, message } or null.
 * type: "error" | "success" | "info"
 */
export default function Toast({ toast, onDismiss, duration = 4500 }) {
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => onDismiss?.(), duration);
    return () => window.clearTimeout(timer);
  }, [toast, duration, onDismiss]);

  if (!toast) return null;

  return (
    <div className={styles.viewport} role="status" aria-live="polite">
      <div className={`${styles.toast} ${styles[toast.type || "info"]}`}>
        <div className={styles.body}>
          <strong className={styles.title}>
            {toast.type === "error" ? "Something went wrong" : toast.type === "success" ? "Done" : "Notice"}
          </strong>
          <p className={styles.message}>{toast.message}</p>
        </div>
        <button type="button" className={styles.close} onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      </div>
    </div>
  );
}

"use client";

import styles from "./RecruiterLoader.module.css";

export default function RecruiterLoader({ inline = false } = {}) {
  return (
    <div className={`${styles.shell} ${inline ? styles.shellInline : ""}`}>
      <div className={styles.loader} role="status" aria-live="polite" aria-label="Loading your workspace">
        <div className={styles.grid} aria-hidden="true">
          <span className={styles.chip} />
          <span className={styles.chip} />
          <span className={styles.chip} />
          <span className={styles.chip} />
        </div>

        <div className={styles.wordmark} aria-hidden="true">
          <span className={styles.mazik}>mazik</span>
          <span className={styles.global}>global</span>
        </div>

        <div className={styles.dotTrail} aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>

        <div className={styles.caption}>Loading your workspace...</div>
      </div>
    </div>
  );
}

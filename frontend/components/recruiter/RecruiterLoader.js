"use client";

import styles from "./RecruiterLoader.module.css";

// This is the single application loading experience. It must obscure the
// dashboard shell as well as the content being fetched.
export default function RecruiterLoader() {
  return (
    <div className={styles.shell}>
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

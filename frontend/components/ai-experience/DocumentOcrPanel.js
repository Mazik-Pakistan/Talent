"use client";

import AiOrb, { AiThinkingDots } from "./AiOrb";
import { IconFile, IconScan } from "./icons";
import { LOW_CONFIDENCE_THRESHOLD } from "@/lib/ai/sources";
import styles from "./AiExperience.module.css";

/**
 * Shared light-theme OCR workspace: document preview + live field reveal.
 * Used by bank slip scanning and onboarding document extraction.
 */
export default function DocumentOcrPanel({
  title,
  subtitle,
  previewUrl,
  fileName,
  scanning = false,
  stage = "",
  fieldDefs = [],
  typedValues = {},
  revealed = [],
  typingKey = null,
  confidence = {},
  progress = 0,
  error = null,
  note = null,
  footer = null,
  emptyHint = "Extracted values will appear here as I read your document.",
}) {
  const visibleKeys = fieldDefs.filter((f) => revealed.includes(f.key));
  const showFields = scanning || visibleKeys.length > 0 || error;

  return (
    <section className={styles.scanner} data-ocr-panel>
      <header className={styles.scannerHead}>
        <AiOrb size="md" thinking={scanning || Boolean(typingKey)} particles />
        <div>
          <div className={styles.scannerTitle}>{title}</div>
          {subtitle ? <div className={styles.scannerSub}>{subtitle}</div> : null}
        </div>
      </header>

      <div className={styles.scannerBody}>
        <div className={styles.scannerSplit}>
          <div className={`${styles.preview} ${styles.previewLight}`}>
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- local blob / signed preview
              <img src={previewUrl} alt="Document preview" />
            ) : (
              <div className={styles.previewFile}>
                <IconFile width={18} height={18} />
                <span>{fileName || "Document"}</span>
              </div>
            )}
            {scanning ? (
              <>
                <div className={styles.scanOverlay} />
                <div className={styles.scanGrid} />
                <div className={styles.scanBeam} />
                <div className={styles.scanStatus}>
                  <IconScan width={13} height={13} />
                  <span>{stage || "Extracting text…"}</span>
                  <AiThinkingDots />
                </div>
              </>
            ) : null}
          </div>

          <div className={styles.scannerSide}>
            {error ? <div className={`${styles.scannerNote} ${styles.noteError}`}>{error}</div> : null}

            {!error && showFields ? (
              <>
                {scanning && !visibleKeys.length ? (
                  <div className={styles.scannerEmpty}>
                    <AiThinkingDots />
                    <p>{emptyHint}</p>
                  </div>
                ) : null}

                {visibleKeys.length ? (
                  <div className={styles.resultList}>
                    {visibleKeys.map(({ key, label }) => {
                      const score = confidence[key];
                      const low = score != null && score < LOW_CONFIDENCE_THRESHOLD;
                      const isTyping = typingKey === key;
                      const done = revealed.includes(key) && !isTyping && typedValues[key];
                      return (
                        <div
                          key={key}
                          className={[
                            styles.resultRow,
                            low ? styles.resultRowLow : "",
                            isTyping ? styles.resultRowTyping : "",
                            done ? styles.resultRowDone : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          data-ocr-key={key}
                        >
                          <span className={styles.resultLabel}>{label}</span>
                          <span className={styles.resultValue}>
                            {typedValues[key] ?? ""}
                            {isTyping ? <span className={styles.typeCaret} aria-hidden="true" /> : null}
                          </span>
                          {score != null ? (
                            <span
                              className={styles.confidenceChip}
                              title={`${Math.round(score * 100)}% confidence`}
                            >
                              {Math.round(score * 100)}%
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {progress > 0 ? (
                  <div className={styles.scannerProgress} aria-hidden="true">
                    <div className={styles.scannerProgressTrack}>
                      <div
                        className={styles.scannerProgressFill}
                        style={{ width: `${Math.min(100, Math.round(progress * 100))}%` }}
                      />
                    </div>
                  </div>
                ) : null}

                {note ? <p className={styles.scannerHelper}>{note}</p> : null}
              </>
            ) : null}

            {footer}
          </div>
        </div>
      </div>
    </section>
  );
}

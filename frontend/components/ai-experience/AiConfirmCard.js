"use client";

import { useState } from "react";

import styles from "./AiExperience.module.css";

/**
 * Human-in-the-loop prompt. The AI raises one of these instead of guessing:
 * either to pick between values it found, or to ask for something it genuinely
 * cannot know.
 *
 * Mount this with `key={question.id}` — a new question is a new card, so the
 * draft answer resets without an effect.
 */
export default function AiConfirmCard({ question, onAnswer, onSkip }) {
  const [draft, setDraft] = useState(question?.defaultValue || "");

  if (!question) return null;

  const options = question.options || [];
  const allowFreeText = question.allowFreeText !== false;

  function submitDraft(event) {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    onAnswer?.(trimmed);
  }

  return (
    <div className={styles.confirm}>
      <div className={styles.confirmQuestion}>{question.question}</div>
      {question.why ? <div className={styles.confirmWhy}>{question.why}</div> : null}

      {options.length ? (
        <div className={styles.confirmOptions}>
          {options.map((option) => {
            const value = typeof option === "string" ? option : option.value;
            const hint = typeof option === "string" ? null : option.hint;
            return (
              <button
                key={value}
                type="button"
                className={styles.confirmOption}
                onClick={() => onAnswer?.(value)}
              >
                <span>{value}</span>
                {hint ? <span className={styles.confirmOptionHint}>{hint}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {allowFreeText ? (
        <form className={styles.confirmInputRow} onSubmit={submitDraft}>
          <input
            className={styles.confirmInput}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={question.placeholder || "Type your answer…"}
            autoFocus
          />
          <button type="submit" className={`${styles.panelBtn} ${styles.panelBtnPrimary}`} disabled={!draft.trim()}>
            Confirm
          </button>
        </form>
      ) : null}

      {question.skippable !== false ? (
        <div className={styles.confirmOptions}>
          <button type="button" className={styles.confirmOption} onClick={onSkip}>
            <span>Skip this — I&apos;ll fill it in myself</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

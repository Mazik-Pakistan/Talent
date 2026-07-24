"use client";

import { useEffect, useId, useRef, useState } from "react";

import AiSourceBadge from "./AiSourceBadge";
import { IconCheck } from "./icons";
import { publishFieldBlur, publishFieldFocus } from "@/lib/ai/guideContext";
import styles from "./AiExperience.module.css";

/**
 * A normal form input that the AI can also drive.
 *
 * `ai` carries the runtime metadata for this field (typing / filled / review)
 * and `active` marks it as the one the assistant is working on right now. The
 * field scrolls itself into view and takes focus so the employee's eye follows
 * the AI, and it keeps working exactly like a plain input when nobody is
 * automating it.
 *
 * `fieldKey` (e.g. "employment.iban") lets the Copilot explain the field on focus.
 */
export default function AiField({
  label,
  value,
  onChange,
  type = "text",
  wide = false,
  error,
  hint,
  readOnly = false,
  placeholder,
  ai,
  active = false,
  autoScroll = true,
  fieldKey,
}) {
  const inputId = useId();
  const inputRef = useRef(null);
  const wrapRef = useRef(null);
  const [flash, setFlash] = useState(false);
  const previousStatus = useRef(ai?.status);

  useEffect(() => {
    if (!active || !autoScroll) return;
    wrapRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (!readOnly) inputRef.current?.focus({ preventScroll: true });
  }, [active, autoScroll, readOnly]);

  useEffect(() => {
    const status = ai?.status;
    if (status === "filled" && previousStatus.current === "typing") {
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), 950);
      previousStatus.current = status;
      return () => clearTimeout(timer);
    }
    previousStatus.current = status;
    return undefined;
  }, [ai?.status]);

  const errorText = typeof error === "string" ? error : error ? hint || "Required" : null;
  const status = ai?.status;

  const className = [
    styles.field,
    wide ? styles.fieldWide : "",
    error ? styles.fieldError : "",
    active ? styles.fieldActive : "",
    status === "typing" ? styles.fieldTyping : "",
    status === "filled" ? styles.fieldFilled : "",
    status === "review" ? styles.fieldReview : "",
    status === "asking" ? styles.fieldAsking : "",
    flash ? styles.fieldFlash : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className} ref={wrapRef} data-field-error={error ? "true" : undefined}>
      <div className={styles.fieldHead}>
        <label className={styles.fieldLabel} htmlFor={inputId}>
          {label}
        </label>
        {status && status !== "typing" && ai?.source ? (
          <AiSourceBadge source={ai.source} confidence={ai.confidence} note={ai.note} />
        ) : null}
      </div>

      <div className={styles.fieldControl}>
        <input
          id={inputId}
          ref={inputRef}
          type={type}
          value={value ?? ""}
          onChange={onChange}
          readOnly={readOnly}
          placeholder={placeholder}
          aria-invalid={!!error}
          aria-busy={status === "typing"}
          onFocus={() => {
            if (fieldKey || label) publishFieldFocus({ path: fieldKey, label });
          }}
          onBlur={() => publishFieldBlur()}
        />
        {status === "typing" ? <span className={styles.scanline} aria-hidden="true" /> : null}
        {status === "filled" && flash ? (
          <span className={styles.fieldCheck} aria-hidden="true">
            <IconCheck />
          </span>
        ) : null}
      </div>

      {errorText ? <em className={styles.fieldErrorText}>{errorText}</em> : null}
      {!error && hint ? <small className={styles.fieldHint}>{hint}</small> : null}
    </div>
  );
}

/** Checkbox row with the same AI states — used for policy acknowledgements. */
export function AiCheckRow({ checked, onChange, error, ai, active = false, children }) {
  const wrapRef = useRef(null);
  const status = ai?.status;

  useEffect(() => {
    if (!active) return;
    wrapRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [active]);

  const className = [
    styles.checkRow,
    error ? styles.checkRowError : "",
    active ? styles.checkRowActive : "",
    status === "filled" ? styles.checkRowFilled : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <label className={className} ref={wrapRef} data-field-error={error ? "true" : undefined}>
      <input type="checkbox" checked={!!checked} onChange={onChange} />
      <span className={styles.checkRowText}>{children}</span>
      {status === "filled" && ai?.source ? (
        <AiSourceBadge source={ai.source} confidence={ai.confidence} note={ai.note} />
      ) : null}
    </label>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

import { confidenceLabel, getSource, LOW_CONFIDENCE_THRESHOLD } from "@/lib/ai/sources";
import { IconAlert, IconCheck } from "./icons";
import styles from "./AiExperience.module.css";

const TONES = {
  blue: styles.toneBlue,
  indigo: styles.toneIndigo,
  violet: styles.toneViolet,
  cyan: styles.toneCyan,
  mint: styles.toneMint,
  amber: styles.toneAmber,
  rose: styles.toneRose,
};

/**
 * Provenance chip shown next to any value the AI produced. Click to see where
 * the value came from and how sure the AI is about it.
 */
export default function AiSourceBadge({ source, confidence, note }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const definition = getSource(source);

  useEffect(() => {
    if (!open) return undefined;
    function onDocumentClick(event) {
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    }
    function onEscape(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocumentClick);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onDocumentClick);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  if (!definition) return null;

  const uncertain = confidence != null && confidence < LOW_CONFIDENCE_THRESHOLD;
  const tone = uncertain ? TONES.amber : TONES[definition.tone] || TONES.blue;
  const percent = confidence != null ? Math.round(confidence * 100) : null;

  return (
    <span className={styles.badgeWrap} ref={wrapRef}>
      <button
        type="button"
        className={`${styles.badge} ${tone}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title={`${definition.label} — click for details`}
      >
        {uncertain ? <IconAlert /> : <IconCheck />}
        {definition.label}
      </button>

      {open ? (
        <span className={styles.badgePop} role="dialog">
          <span className={styles.badgePopTitle}>{definition.label}</span>
          <span className={styles.badgePopBody}>{note || definition.description}</span>
          {percent != null ? (
            <span className={styles.badgePopMeta}>
              <span>{percent}%</span>
              <span className={styles.confidenceTrack}>
                <span
                  className={`${styles.confidenceFill} ${uncertain ? styles.confidenceLow : ""}`}
                  style={{ width: `${percent}%` }}
                />
              </span>
              <span>{confidenceLabel(confidence)}</span>
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

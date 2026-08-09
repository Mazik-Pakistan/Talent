"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getDocumentActivities,
  normalizeDocumentType,
} from "@/lib/ai/documentProcessing";

/**
 * How often the single visible activity message advances while the upload/OCR
 * request is in flight. The backend is synchronous, so these are contextual
 * descriptions — never fake completion, and success is only set via succeed().
 */
const ACTIVITY_ADVANCE_MS = 2200;

const IDLE_STATE = {
  status: "idle", // idle | processing | success | error
  documentType: "generic",
  fileName: null,
  activities: [],
  activityIndex: 0,
  error: null,
};

/**
 * Shared processing-animation state for Candidate document uploads.
 *
 * `begin` starts rotating through ONE activity message at a time while the
 * upload request is in flight; `succeed` stops rotation and shows the success
 * label; `fail` stops the animation and surfaces recovery actions.
 *
 * Used identically for CNIC, Resume, and Transcript — only the activity
 * message set changes with document type.
 */
export default function useDocumentProcessing() {
  const [state, setState] = useState(IDLE_STATE);
  const timersRef = useRef({ advance: null });

  const clearTimers = useCallback(() => {
    const timers = timersRef.current;
    if (timers.advance) {
      window.clearInterval(timers.advance);
      timers.advance = null;
    }
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const begin = useCallback(
    ({ documentType, fileName } = {}) => {
      clearTimers();
      const normalized = normalizeDocumentType(documentType);
      const activities = getDocumentActivities(normalized, fileName);
      setState({
        ...IDLE_STATE,
        status: "processing",
        documentType: normalized,
        fileName: fileName || null,
        activities,
        activityIndex: 0,
      });

      const timers = timersRef.current;
      timers.advance = window.setInterval(() => {
        setState((current) => {
          if (current.status !== "processing") return current;
          const total = current.activities.length;
          if (total <= 1) return current;
          // Keep rotating through contextual activities for as long as the
          // real request is in flight — never freeze on a "Still working" state.
          return {
            ...current,
            activityIndex: (current.activityIndex + 1) % total,
          };
        });
      }, ACTIVITY_ADVANCE_MS);
    },
    [clearTimers]
  );

  const succeed = useCallback(() => {
    clearTimers();
    setState((current) => ({
      ...current,
      status: "success",
      error: null,
    }));
  }, [clearTimers]);

  const fail = useCallback(
    (message) => {
      clearTimers();
      setState((current) => ({
        ...current,
        status: "error",
        error:
          message ||
          "We couldn't finish processing this document. Please try again or upload another file.",
      }));
    },
    [clearTimers]
  );

  const cancel = useCallback(() => {
    clearTimers();
    setState(IDLE_STATE);
  }, [clearTimers]);

  return { state, begin, succeed, fail, cancel };
}

"use client";

import { useEffect, useRef } from "react";
import { publishAutosave } from "@/lib/ai/guideContext";

/**
 * Debounced background save for a form section.
 *
 * Only fires when the section's data actually changed and passes the caller's
 * own validation, so autosave can never push a half-typed value through an
 * endpoint that would reject it.
 */
export function useAutoSave({ value, isReady, buildPayload, save, delay = 2200, enabled = true, resetKey }) {
  const lastSavedRef = useRef(null);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(null);
  const resetKeyRef = useRef(resetKey);

  const saveRef = useRef(save);
  const buildRef = useRef(buildPayload);
  const readyRef = useRef(isReady);

  useEffect(() => {
    saveRef.current = save;
    buildRef.current = buildPayload;
    readyRef.current = isReady;
  }, [save, buildPayload, isReady]);

  useEffect(() => {
    if (!enabled) return undefined;

    const snapshot = JSON.stringify(value ?? null);

    // Switching sections isn't an edit — adopt the new baseline instead of
    // firing a save for a section the employee hasn't touched.
    if (resetKeyRef.current !== resetKey) {
      resetKeyRef.current = resetKey;
      lastSavedRef.current = snapshot;
      return undefined;
    }

    // Treat the first observed value as already saved: hydrating a form from
    // the server is not a change the employee made.
    if (lastSavedRef.current === null) {
      lastSavedRef.current = snapshot;
      return undefined;
    }
    if (snapshot === lastSavedRef.current) return undefined;
    if (!readyRef.current?.()) return undefined;

    async function commit(pendingSnapshot) {
      if (inFlightRef.current) {
        pendingRef.current = pendingSnapshot;
        return;
      }
      inFlightRef.current = true;
      try {
        const payload = buildRef.current?.();
        if (payload) {
          await saveRef.current?.(payload);
          lastSavedRef.current = pendingSnapshot;
          publishAutosave({ message: "✓ Progress saved automatically" });
        }
      } catch {
        // A failed autosave must never interrupt typing — the explicit Save
        // button stays available and reports errors properly.
      } finally {
        inFlightRef.current = false;
        const queued = pendingRef.current;
        pendingRef.current = null;
        if (queued && queued !== lastSavedRef.current) commit(queued);
      }
    }

    const timer = setTimeout(() => commit(snapshot), delay);
    return () => clearTimeout(timer);
  }, [value, delay, enabled, resetKey]);
}

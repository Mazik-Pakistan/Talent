"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Persisted sidebar collapse toggle. Previously copy-pasted (with a
 * different localStorage key per role) inside RecruiterShell, EmployeeShell,
 * and CandidateShell. Behavior is unchanged: starts expanded on first paint,
 * then syncs from localStorage on mount (avoids SSR/client mismatch), and
 * persists every toggle under the given key.
 *
 * @param {string} storageKey e.g. "recruiter_sidebar_collapsed"
 */
export function useSidebarCollapse(storageKey) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(storageKey) === "1");
  }, [storageKey]);

  const toggle = useCallback(() => {
    setCollapsed((value) => {
      const next = !value;
      localStorage.setItem(storageKey, next ? "1" : "0");
      return next;
    });
  }, [storageKey]);

  return [collapsed, toggle];
}

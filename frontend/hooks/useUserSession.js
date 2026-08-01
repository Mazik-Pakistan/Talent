"use client";

import { useCallback, useEffect, useState } from "react";

function readStoredUser() {
  const stored = localStorage.getItem("user");
  return stored ? JSON.parse(stored) : null;
}

/**
 * Reads the persisted user session and keeps it in sync.
 *
 * The three original shells each re-synced slightly differently:
 *  - RecruiterShell: re-reads whenever the route changes, and listens for
 *    both the in-app "talent-user-updated" event and cross-tab "storage".
 *  - EmployeeShell: only listens for "talent-user-updated".
 *  - CandidateShell: reads once on mount only.
 *
 * `options` reproduces each of those exactly so no shell's behavior changes.
 *
 * @param {{ pathname?: string, watchEvents?: string[] }} options
 */
export function useUserSession({ pathname, watchEvents = [] } = {}) {
  const [user, setUser] = useState(null);

  const refresh = useCallback(() => {
    setUser(readStoredUser());
  }, []);

  useEffect(() => {
    refresh();
    // Only re-runs on pathname change when the caller passes one in,
    // matching RecruiterShell's per-navigation refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!watchEvents.length) return undefined;
    const onUpdate = () => refresh();
    watchEvents.forEach((eventName) => window.addEventListener(eventName, onUpdate));
    return () => {
      watchEvents.forEach((eventName) => window.removeEventListener(eventName, onUpdate));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchEvents.join(","), refresh]);

  return user;
}

"use client";

import { useEffect, useState } from "react";
import { getOrgStructureOptions } from "@/services/orgFrameworkService";
import { onFrameworkInvalidated } from "@/lib/frameworkEvents";

/**
 * Organization Framework options — the single source of truth for every
 * department / role / skill / certification dropdown across recruiter,
 * candidate and employee modules.
 *
 * The response is cached for the session so navigation between pages is
 * instant; call `refresh()` to re-fetch, or `bustOrgFrameworkCache()` after a
 * framework edit/import so the next page mount picks up the change.
 */
let frameworkCache = null;
let frameworkPromise = null;

export function bustOrgFrameworkCache() {
  frameworkCache = null;
}

function loadFrameworkOptions() {
  if (frameworkCache) return Promise.resolve(frameworkCache);
  if (frameworkPromise) return frameworkPromise;
  const token = localStorage.getItem("access_token");
  if (!token) return Promise.resolve(null);
  frameworkPromise = getOrgStructureOptions(token)
    .then((data) => {
      frameworkCache = data;
      return data;
    })
    .catch(() => null)
    .finally(() => {
      frameworkPromise = null;
    });
  return frameworkPromise;
}

export function useOrgFrameworkOptions() {
  const [options, setOptions] = useState(frameworkCache);
  const [loading, setLoading] = useState(!frameworkCache);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      loadFrameworkOptions().then((data) => {
        if (cancelled) return;
        setOptions(data);
        setLoading(false);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [version]);

  useEffect(() => {
    const unsub = onFrameworkInvalidated(() => {
      frameworkCache = null;
      setVersion((v) => v + 1);
    });
    return unsub;
  }, []);

  function refresh() {
    frameworkCache = null;
    setVersion((v) => v + 1);
  }

  const departments = (options?.departments || []).filter(Boolean);
  const roleNames = [...new Set((options?.roles || []).map((r) => r.name).filter(Boolean))].sort();
  const skills = (options?.skills || []).filter(Boolean);
  const certifications = (options?.certifications || []).filter(Boolean);
  const courses = (options?.courses || []).filter(Boolean);

  return {
    options,
    loading,
    refresh,
    departments,
    roleNames,
    skills,
    certifications,
    courses,
  };
}

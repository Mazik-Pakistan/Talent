"use client";

/**
 * Event bus + persistence for the Super Admin Mascot.
 * Mirrors recruiterContext.js for the super admin domain.
 */

export const SUPER_ADMIN_CONTEXT_EVENT = "talent-super-admin-mascot-context";

export const SUPER_ADMIN_MEMORY_KEY = "super_admin_mascot_memory_v1";
export const SUPER_ADMIN_GREETING_KEY = "super_admin_mascot_greeted_v1";

export const MASCOT_PRIORITY = {
  pipeline: 1,
  task: 2,
  notification: 3,
  insight: 4,
  ai: 5,
  tip: 6,
  idle: 7,
};

export function publishSuperAdminContext(detail) {
  if (typeof window === "undefined") return;
  const next = {
    pathname: window.location.pathname,
    section: null,
    tab: null,
    hint: null,
    fields: [],
    ...detail,
    at: Date.now(),
  };
  window.__talentSuperAdminMascotContext = next;
  window.dispatchEvent(new CustomEvent(SUPER_ADMIN_CONTEXT_EVENT, { detail: next }));
}

export function readSuperAdminContext() {
  if (typeof window === "undefined") return null;
  return window.__talentSuperAdminMascotContext || null;
}

export function clearSuperAdminContext() {
  if (typeof window === "undefined") return;
  window.__talentSuperAdminMascotContext = null;
  window.dispatchEvent(new CustomEvent(SUPER_ADMIN_CONTEXT_EVENT, { detail: null }));
}

export function readMascotMemory() {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(sessionStorage.getItem(SUPER_ADMIN_MEMORY_KEY) || "null");
  } catch {
    return null;
  }
}

export function writeMascotMemory(patch) {
  if (typeof window === "undefined") return null;
  const prev = readMascotMemory() || {};
  const next = { ...prev, ...patch, at: Date.now() };
  try {
    sessionStorage.setItem(SUPER_ADMIN_MEMORY_KEY, JSON.stringify(next));
  } catch {
    window.__talentSuperAdminMascotMemory = next;
  }
  return next;
}

export function readMascotGreeted() {
  if (typeof window === "undefined") return false;
  try {
    const raw = sessionStorage.getItem(SUPER_ADMIN_GREETING_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    const today = new Date().toISOString().slice(0, 10);
    return parsed?.date === today;
  } catch {
    return false;
  }
}

export function markMascotGreeted() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      SUPER_ADMIN_GREETING_KEY,
      JSON.stringify({ date: new Date().toISOString().slice(0, 10), at: Date.now() })
    );
  } catch {
    // ignore
  }
}

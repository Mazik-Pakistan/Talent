"use client";

/**
 * Event bus + persistence for the Recruiter Mascot (NOT the Employee Copilot).
 *
 * Pages may publish live subsection context; the mascot reacts with short
 * speech-bubble guidance without becoming a chatbot.
 */

export const MASCOT_CONTEXT_EVENT = "talent-recruiter-mascot-context";

/** @deprecated alias — kept for any early publishers */
export const RECRUITER_CONTEXT_EVENT = MASCOT_CONTEXT_EVENT;

export const MASCOT_MEMORY_KEY = "recruiter_mascot_memory_v1";
export const MASCOT_GREETING_KEY = "recruiter_mascot_greeted_v1";

/** Lower number = higher priority (mirrors employee copilot ranks). */
export const MASCOT_PRIORITY = {
  pipeline: 1,
  task: 2,
  notification: 3,
  insight: 4,
  ai: 5,
  tip: 6,
  idle: 7,
};

export function publishRecruiterContext(detail) {
  if (typeof window === "undefined") return;
  const next = {
    pathname: window.location.pathname,
    section: null,
    tab: null,
    hint: null,
    fields: [],
    progress: null,
    ...detail,
    at: Date.now(),
  };
  window.__talentRecruiterMascotContext = next;
  window.dispatchEvent(new CustomEvent(MASCOT_CONTEXT_EVENT, { detail: next }));
}

export function readRecruiterContext() {
  if (typeof window === "undefined") return null;
  return window.__talentRecruiterMascotContext || null;
}

export function clearRecruiterContext() {
  if (typeof window === "undefined") return;
  window.__talentRecruiterMascotContext = null;
  window.dispatchEvent(new CustomEvent(MASCOT_CONTEXT_EVENT, { detail: null }));
}

export function readMascotMemory() {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(sessionStorage.getItem(MASCOT_MEMORY_KEY) || "null");
  } catch {
    return null;
  }
}

export function writeMascotMemory(patch) {
  if (typeof window === "undefined") return null;
  const prev = readMascotMemory() || {};
  const next = { ...prev, ...patch, at: Date.now() };
  try {
    sessionStorage.setItem(MASCOT_MEMORY_KEY, JSON.stringify(next));
  } catch {
    // Private mode — in-memory only for this tab via window
    window.__talentRecruiterMascotMemory = next;
  }
  return next;
}

export function readMascotGreeted() {
  if (typeof window === "undefined") return false;
  try {
    const raw = sessionStorage.getItem(MASCOT_GREETING_KEY);
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
      MASCOT_GREETING_KEY,
      JSON.stringify({ date: new Date().toISOString().slice(0, 10), at: Date.now() })
    );
  } catch {
    // ignore
  }
}

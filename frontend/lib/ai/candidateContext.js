"use client";

/**
 * Event bus + persistence for the Candidate Assistant.
 *
 * Candidate pages publish live workflow context; the mascot reacts with short
 * speech-bubble guidance without interrupting candidate tasks.
 */

export const CANDIDATE_MASCOT_CONTEXT_EVENT = "talent-candidate-mascot-context";
export const CANDIDATE_MASCOT_MEMORY_KEY = "candidate_mascot_memory_v1";
export const CANDIDATE_MASCOT_GREETING_KEY = "candidate_mascot_greeted_v1";

export const CANDIDATE_MASCOT_PRIORITY = {
  workflow: 1,
  task: 2,
  notification: 3,
  insight: 4,
  ai: 5,
  tip: 6,
  idle: 7,
};

export function publishCandidateContext(detail) {
  if (typeof window === "undefined") return;
  const next = {
    pathname: window.location.pathname,
    section: null,
    step: null,
    hint: null,
    fields: [],
    progress: null,
    ...detail,
    at: Date.now(),
  };
  window.__talentCandidateMascotContext = next;
  window.dispatchEvent(new CustomEvent(CANDIDATE_MASCOT_CONTEXT_EVENT, { detail: next }));
}

export function readCandidateContext() {
  if (typeof window === "undefined") return null;
  return window.__talentCandidateMascotContext || null;
}

export function clearCandidateContext() {
  if (typeof window === "undefined") return;
  window.__talentCandidateMascotContext = null;
  window.dispatchEvent(new CustomEvent(CANDIDATE_MASCOT_CONTEXT_EVENT, { detail: null }));
}

export function readMascotMemory() {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(sessionStorage.getItem(CANDIDATE_MASCOT_MEMORY_KEY) || "null");
  } catch {
    return null;
  }
}

export function writeMascotMemory(patch) {
  if (typeof window === "undefined") return null;
  const prev = readMascotMemory() || {};
  const next = { ...prev, ...patch, at: Date.now() };
  try {
    sessionStorage.setItem(CANDIDATE_MASCOT_MEMORY_KEY, JSON.stringify(next));
  } catch {
    window.__talentCandidateMascotMemory = next;
  }
  return next;
}

export function readMascotGreeted() {
  if (typeof window === "undefined") return false;
  try {
    const raw = sessionStorage.getItem(CANDIDATE_MASCOT_GREETING_KEY);
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
      CANDIDATE_MASCOT_GREETING_KEY,
      JSON.stringify({ date: new Date().toISOString().slice(0, 10), at: Date.now() })
    );
  } catch {
    // ignore
  }
}

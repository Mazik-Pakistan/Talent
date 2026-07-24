"use client";

/**
 * Global event bus + persistence keys for the Employee AI Copilot.
 *
 * The Copilot is NOT the autonomous AI Agent. Pages publish context and
 * transient signals (focus, hover, autosave, validation, notifications);
 * the Copilot reacts without navigating or taking control.
 */

export const COPILOT_CONTEXT_EVENT = "talent-employee-ai-context";
export const COPILOT_FOCUS_EVENT = "talent-copilot-focus";
export const COPILOT_HOVER_EVENT = "talent-copilot-hover";
export const COPILOT_AUTOSAVE_EVENT = "talent-copilot-autosave";
export const COPILOT_VALIDATION_EVENT = "talent-copilot-validation";
export const COPILOT_NOTIFY_EVENT = "talent-copilot-notify";
export const COPILOT_DOCUMENTS_ASSIST_EVENT = "talent-copilot-documents-assist";
export const COPILOT_ASSIST_APPLY_EVENT = "talent-copilot-assist-apply";
export const COPILOT_ASSIST_REGISTER_EVENT = "talent-copilot-assist-register";

/** @deprecated use COPILOT_CONTEXT_EVENT — kept so older publishers still work */
export const GUIDE_CONTEXT_EVENT = COPILOT_CONTEXT_EVENT;

export const GUIDE_MINIMIZED_KEY = "employee_ai_copilot_minimized";

/** Canonical employee-portal onboarding order (Copilot never jumps ahead). */
export const ONBOARDING_WORKFLOW = [
  { id: "personal", label: "Personal Information" },
  { id: "emergency", label: "Emergency Contact" },
  { id: "employment", label: "Bank Details" },
  { id: "references", label: "References" },
  { id: "documents", label: "Policies" },
  { id: "nda", label: "NDA" },
  { id: "submit", label: "Review & Submit" },
];

export function publishGuideContext(detail) {
  if (typeof window === "undefined") return;
  const next = {
    pathname: window.location.pathname,
    section: null,
    label: null,
    fields: [],
    hint: null,
    progress: null,
    mode: null,
    formId: null,
    tab: null,
    ...detail,
    at: Date.now(),
  };
  window.__talentAiGuideContext = next;
  window.dispatchEvent(new CustomEvent(COPILOT_CONTEXT_EVENT, { detail: next }));
}

export function clearGuideContext() {
  if (typeof window === "undefined") return;
  // Soft-clear only when leaving the portal — pages should publish, not wipe,
  // so the Copilot never flashes empty mid-navigation.
  window.__talentAiGuideContext = null;
  window.dispatchEvent(new CustomEvent(COPILOT_CONTEXT_EVENT, { detail: null }));
}

export function readGuideContext() {
  if (typeof window === "undefined") return null;
  return window.__talentAiGuideContext || null;
}

export function readGuideMinimized() {
  if (typeof window === "undefined") return false;
  try {
    const stored = localStorage.getItem(GUIDE_MINIMIZED_KEY);
    // Default open when never set.
    if (stored === null) return false;
    return stored === "1";
  } catch {
    return false;
  }
}

export function writeGuideMinimized(minimized) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(GUIDE_MINIMIZED_KEY, minimized ? "1" : "0");
  } catch {
    // Private mode — in-memory state still works for the tab.
  }
}

export function publishFieldFocus(detail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(COPILOT_FOCUS_EVENT, {
      detail: { ...detail, at: Date.now() },
    })
  );
}

export function publishFieldBlur() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(COPILOT_FOCUS_EVENT, { detail: null }));
}

export function publishHover(detail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(COPILOT_HOVER_EVENT, {
      detail: detail ? { ...detail, at: Date.now() } : null,
    })
  );
}

export function publishAutosave(detail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(COPILOT_AUTOSAVE_EVENT, {
      detail: { status: "saved", message: "Progress saved", ...detail, at: Date.now() },
    })
  );
}

export function publishValidation(detail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(COPILOT_VALIDATION_EVENT, {
      detail: { ...detail, at: Date.now() },
    })
  );
}

export function publishCopilotNotification(detail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(COPILOT_NOTIFY_EVENT, {
      detail: { ...detail, at: Date.now() },
    })
  );
}

/**
 * Pages register a page-scoped assist handler. The Copilot may call it only
 * after the employee approves — and only for the current page.
 */
export function registerPageAssist(handler) {
  if (typeof window === "undefined") return () => {};
  window.__talentCopilotAssist = handler;
  window.dispatchEvent(new CustomEvent(COPILOT_ASSIST_REGISTER_EVENT, { detail: !!handler }));
  return () => {
    if (window.__talentCopilotAssist === handler) {
      window.__talentCopilotAssist = null;
      window.dispatchEvent(new CustomEvent(COPILOT_ASSIST_REGISTER_EVENT, { detail: false }));
    }
  };
}

export function readPageAssist() {
  if (typeof window === "undefined") return null;
  return window.__talentCopilotAssist || null;
}

/** Priority ranks — lower number = higher priority. */
export const COPILOT_PRIORITY = {
  task: 1,
  validation: 2,
  unsaved: 3,
  onboarding: 4,
  notification: 5,
  assist: 6,
  tip: 7,
};

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "react-toastify";
import styles from "./BaseMascot.module.css";
import useDraggableFab from "@/lib/ai/useDraggableFab";
import {
  coachMessage,
  coachSnapshot,
  collectFormSteps,
  getFieldLabel as coachFieldLabel,
  getSelectFieldMeta,
} from "@/lib/ai/formCoach";
import { recruiterFieldHelpFor, recruiterPageSummaryFor } from "@/lib/ai/recruiterFieldHelp";

export const MASCOT_PRIORITY_LEVELS = {
  ERROR: 5,
  NOTIFICATION: 4,
  SUCCESS: 3,
  SUGGESTION: 2,
  IDLE_TIP: 1,
  NONE: 0,
};

const BUBBLE_TIMEOUT_MS = 8000;
const COOLDOWN_MS = 12000;
const IDLE_TIMEOUT_MS = 30000;

function panelOpenStorageKey(roleLabel) {
  // v2: old key defaulted to open; bump so we don't resurrect minimized panels.
  return `mascot_panel_open_v2_${String(roleLabel || "assistant").toLowerCase()}`;
}

function readStoredPanelOpen(roleLabel) {
  if (typeof window === "undefined") return false;
  try {
    const stored = localStorage.getItem(panelOpenStorageKey(roleLabel));
    // Stay closed until the user opens the FAB — never auto-pop on load.
    if (stored === null) return false;
    return stored === "1";
  } catch {
    return false;
  }
}

function isCoachableFormField(field) {
  if (!field || !["INPUT", "SELECT", "TEXTAREA"].includes(field.tagName)) return false;
  // File uploads (OCR), buttons, and secrets must not start live guidance.
  if (["hidden", "submit", "button", "file", "password", "reset", "image"].includes(field.type)) {
    return false;
  }
  return true;
}

function writeStoredPanelOpen(roleLabel, open) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(panelOpenStorageKey(roleLabel), open ? "1" : "0");
  } catch {
    // Private mode — in-memory state still works for the tab.
  }
}

function isFieldEmpty(field) {
  if (field.type === "checkbox" || field.type === "radio") return !field.checked;
  const value = typeof field.value === "string" ? field.value.trim() : field.value;
  if (field.tagName === "SELECT") return !value;
  return !value;
}

function isFieldVisible(field) {
  return field && !field.disabled && field.offsetParent !== null;
}

function getFieldLabel(field) {
  const labelEl = field.closest("label");
  if (labelEl) {
    const span = labelEl.querySelector("span");
    const text = (span?.textContent || labelEl.textContent || "").trim();
    if (text) return text.replace(/\*$/, "").trim();
  }
  const placeholder = field.getAttribute("placeholder");
  if (placeholder) return placeholder.trim();
  const name = field.name || field.id;
  if (name) return name.replace(/_/g, " ");
  return "This field";
}

function getVisibleForms() {
  return Array.from(document.querySelectorAll("form")).filter(
    (form) => form.offsetParent !== null && !form.hasAttribute("data-mascot-command")
  );
}

function getNextMissingRequiredField() {
  for (const form of getVisibleForms()) {
    const fields = form.querySelectorAll("input, select, textarea");
    for (const field of fields) {
      if (field.required && isFieldEmpty(field) && isFieldVisible(field)) {
        return field;
      }
    }
  }
  return null;
}

function getFormGuidance(resolveFieldHelp) {
  const forms = getVisibleForms();
  if (!forms.length) return null;

  const nextField = getNextMissingRequiredField();
  if (nextField) {
    const label = getFieldLabel(nextField);
    const tip = typeof resolveFieldHelp === "function" ? resolveFieldHelp(nextField) : null;
    const key = `form:missing:${nextField.name || nextField.id || label}`;
    return {
      type: "missing",
      text: tip ? `${label} is required. ${tip}` : `${label} is required — fill this next.`,
      key,
      field: nextField,
    };
  }

  const hasRequired = forms.some((form) => form.querySelector("[required]"));
  if (hasRequired) {
    return {
      type: "complete",
      text: "All required fields look good — ready to submit.",
      key: "form:complete",
      field: null,
    };
  }

  return null;
}

function humanizeNotification(notification) {
  if (!notification) return null;
  const message = notification.message?.trim();
  const title = notification.title?.trim();
  const type = notification.type;

  const nameFromMessage = message?.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/)?.[1];
  const subject = nameFromMessage || title?.replace(/:$/, "") || "Someone";

  const byType = {
    intake_submitted: `${subject} submitted onboarding for review.`,
    offer_signed: `${subject} signed the offer letter.`,
    offer_sent: `Offer sent to ${subject}.`,
    offer_declined: `${subject} declined the offer.`,
    candidate_registered: `${subject} accepted the invitation.`,
    invitation_sent: message || `Invitation sent to ${subject}.`,
    employee_created: `${subject} is ready — employee record created.`,
    employee_profile_completed: `${subject} completed their profile.`,
    document_uploaded: `Document uploaded for review.`,
    document_reuploaded: `Document re-uploaded.`,
    document_verified: `Your documents have been verified.`,
    document_reupload_required: `Document re-upload required.`,
    certificate_uploaded: `Certificate uploaded.`,
    certificate_verified: `Certificate verified.`,
    certificate_rejected: `Certificate needs attention.`,
    course_assigned: message || `New learning assignment available.`,
    announcement: title || message,
  };

  if (byType[type]) return byType[type];
  if (message && title && !message.startsWith(title)) return `${title}: ${message.slice(0, 100)}`;
  if (message) return message.slice(0, 120);
  if (title) return title;
  return null;
}

function formatNotificationText(notifications) {
  const unread = (notifications || []).filter((n) => !n.read);
  if (!unread.length) return null;
  return humanizeNotification(unread[0]);
}

function pickFromPool(pool, lastPick) {
  if (!pool.length) return null;
  let candidates = pool.filter((item) => item !== lastPick);
  if (!candidates.length) candidates = pool;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export function visibleFormFields() {
  return getVisibleForms().flatMap((form) =>
    Array.from(form.querySelectorAll("input, select, textarea")).filter(
      (field) => isFieldVisible(field) && !["hidden", "submit", "button", "file", "password"].includes(field.type)
    )
  );
}

export function setNativeFieldValue(field, value, { trim = true } = {}) {
  const prototype =
    field.tagName === "SELECT"
      ? HTMLSelectElement.prototype
      : field.tagName === "TEXTAREA"
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) return false;
  let next = value == null ? "" : String(value);
  if (trim) next = next.trim();
  if (field.tagName === "SELECT") {
    const option = Array.from(field.options).find(
      (item) =>
        item.value.toLowerCase() === next.toLowerCase() ||
        item.text.trim().toLowerCase() === next.toLowerCase()
    );
    if (!option) return false;
    next = option.value;
  }
  setter.call(field, next);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

async function typeValueIntoField(field, rawValue) {
  if (!field) return false;
  const value = rawValue == null ? "" : String(rawValue);
  if (!value.trim()) return false;

  if (field.tagName === "SELECT") {
    return setNativeFieldValue(field, value);
  }

  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  if (reduced || value.length > 80) {
    return setNativeFieldValue(field, value);
  }

  const total = Math.min(1200, Math.max(280, value.length * 28));
  const perChar = Math.max(12, Math.round(total / value.length));
  for (let index = 1; index <= value.length; index += 1) {
    setNativeFieldValue(field, value.slice(0, index), { trim: false });
    await new Promise((resolve) => setTimeout(resolve, perChar));
  }
  return true;
}

export default function BaseMascot({
  roleLabel = "Assistant",
  contextEvent,
  refreshEvent,
  routePrefixes = [],
  readContext = () => null,
  readGreeted = () => false,
  markGreeted = () => {},
  updateMemory = () => ({ prev: null, next: null }),
  buildContinuityMessage = () => null,
  welcomeMessage = () => "Welcome!",
  buildInsights = async () => ({ insights: [], stats: {} }),
  buildIdleInsights = () => [],
  invalidateCache = () => {},
  commandFields = {},
  onFormCommand = null,
  commandPlaceholderFn = null,
  confirmAction = null,
  /** Optional: return a tip string for a focused form field (partner mode). */
  resolveFieldHelp = null,
  /** Optional: return { title, what, why } for the current page intro. */
  resolvePageSummary = null,
  /** When false, hide the quick-ask strip (partner tips still show on focus/click). */
  enableCommands = true,
  /** localStorage key for Messenger-style FAB position. */
  fabStorageKey,
}) {
  const pathname = usePathname();
  const router = useRouter();
  const mascotBtnRef = useRef(null);
  const resolvedFabKey = fabStorageKey || `mascot_fab_pos_${String(roleLabel || "assistant").toLowerCase()}`;
  const { wrapRef, style: fabStyle, dragging, didDrag, handleProps, alignH, alignV } = useDraggableFab(
    resolvedFabKey,
    { fabRef: mascotBtnRef }
  );

  const [activeState, setActiveState] = useState("stateIdle");
  const [bubbleText, setBubbleText] = useState("");
  const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 });
  const [formCommand, setFormCommand] = useState("");
  const [showFormCommand, setShowFormCommand] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [insights, setInsights] = useState([]);
  const [insightCount, setInsightCount] = useState(0);
  const [coach, setCoach] = useState(null);
  const [activityLog, setActivityLog] = useState([]);
  // Hydrate from localStorage after mount so minimize/maximize survives page navigation.
  const [panelOpen, setPanelOpenState] = useState(false);
  const [panelHydrated, setPanelHydrated] = useState(false);
  const [statusLine, setStatusLine] = useState(null);
  const [coachDraft, setCoachDraft] = useState("");
  const [isTypingIntoField, setIsTypingIntoField] = useState(false);
  const [skippedOptionalKeys, setSkippedOptionalKeys] = useState([]);
  const [optionalFillAccepted, setOptionalFillAccepted] = useState(false);
  const [coachEngaged, setCoachEngaged] = useState(false);
  const [browsingTips, setBrowsingTips] = useState(false);

  const bubbleTimerRef = useRef(null);
  const cooldownTimerRef = useRef(null);
  const idleTimerRef = useRef(null);
  const stateTimerRef = useRef(null);
  const lastUnreadCountRef = useRef(null);
  const lastMessageKeyRef = useRef(null);
  const lastIdleMessageRef = useRef(null);
  const lastPageSuggestionRef = useRef(null);
  const bubbleRef = useRef({ text: "", priority: MASCOT_PRIORITY_LEVELS.NONE });
  const cooldownActiveRef = useRef(false);
  const highlightedTargetRef = useRef(null);
  const statsRef = useRef({});
  const insightsRef = useRef([]);
  const suggestionIndexRef = useRef(0);
  const audioContextRef = useRef(null);
  const lastHoverSoundRef = useRef(0);
  const lastCoachNextKeyRef = useRef(null);
  const lastFilledKeyRef = useRef(null);
  const typingLockRef = useRef(false);
  const coachInputRef = useRef(null);
  const optionalFillAcceptedRef = useRef(false);
  const skippedOptionalKeysRef = useRef([]);
  const coachEngagedRef = useRef(false);
  const panelOpenRef = useRef(false);

  const setPanelOpen = useCallback(
    (open) => {
      const next = Boolean(open);
      panelOpenRef.current = next;
      setPanelOpenState(next);
      writeStoredPanelOpen(roleLabel, next);
    },
    [roleLabel]
  );

  useEffect(() => {
    const stored = readStoredPanelOpen(roleLabel);
    panelOpenRef.current = stored;
    setPanelOpenState(stored);
    setPanelHydrated(true);
  }, [roleLabel]);

  const pageSummary = useCallback(() => {
    const context = typeof readContext === "function" ? readContext() || {} : {};
    if (typeof resolvePageSummary === "function") {
      return resolvePageSummary(pathname, context);
    }
    return recruiterPageSummaryFor(pathname, context);
  }, [pathname, readContext, resolvePageSummary]);

  const isRelevantRoute = useCallback(() => {
    if (!pathname) return false;
    if (!routePrefixes.length) return true;
    return routePrefixes.some((prefix) => pathname.includes(prefix));
  }, [pathname, routePrefixes]);

  const clearFieldHighlight = useCallback(() => {
    if (highlightedTargetRef.current) {
      highlightedTargetRef.current.classList.remove(styles.fieldHighlight);
      highlightedTargetRef.current.style.position = "";
      highlightedTargetRef.current = null;
    }
  }, []);

  const highlightField = useCallback(
    (field) => {
      clearFieldHighlight();
      if (!field) return;
      const target = field.closest("label") || field;
      if (getComputedStyle(target).position === "static") {
        target.style.position = "relative";
      }
      target.classList.add(styles.fieldHighlight);
      highlightedTargetRef.current = target;
    },
    [clearFieldHighlight]
  );

  const triggerState = useCallback((stateName, duration = 3000) => {
    setActiveState(stateName);
    if (stateTimerRef.current) clearTimeout(stateTimerRef.current);
    stateTimerRef.current = setTimeout(() => {
      setActiveState("stateIdle");
    }, duration);
  }, []);

  const startCooldown = useCallback(() => {
    cooldownActiveRef.current = true;
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    cooldownTimerRef.current = setTimeout(() => {
      cooldownActiveRef.current = false;
    }, COOLDOWN_MS);
  }, []);

  const dismissBubble = useCallback((maxPriority = MASCOT_PRIORITY_LEVELS.NONE) => {
    const prevPriority = bubbleRef.current.priority;
    if (prevPriority > maxPriority) return;
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    bubbleRef.current = { text: "", priority: MASCOT_PRIORITY_LEVELS.NONE };
    setBubbleText("");
    if (prevPriority <= MASCOT_PRIORITY_LEVELS.SUGGESTION) {
      lastMessageKeyRef.current = null;
    }
  }, []);

  const setMessage = useCallback(
    (text, priority, messageKey, options = {}) => {
      const { bypassCooldown = false, force = false, animation = null, highlightField: field = null } = options;
      if (!text) return false;

      const current = bubbleRef.current;
      const sameKey = messageKey && messageKey === lastMessageKeyRef.current;

      if (!force && sameKey && priority <= MASCOT_PRIORITY_LEVELS.SUGGESTION) {
        return false;
      }

      if (!force && current.text && priority < current.priority) {
        return false;
      }

      if (!bypassCooldown && cooldownActiveRef.current && priority <= MASCOT_PRIORITY_LEVELS.SUGGESTION) {
        return false;
      }

      lastMessageKeyRef.current = messageKey;
      bubbleRef.current = { text, priority };
      setBubbleText(text);

      if (field) {
        highlightField(field);
      }

      if (animation) {
        triggerState(animation, priority >= MASCOT_PRIORITY_LEVELS.ERROR ? 3000 : 2500);
      }

      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
      bubbleTimerRef.current = setTimeout(() => {
        if (bubbleRef.current.text === text) {
          bubbleRef.current = { text: "", priority: MASCOT_PRIORITY_LEVELS.NONE };
          setBubbleText("");
          clearFieldHighlight();
          if (priority <= MASCOT_PRIORITY_LEVELS.SUGGESTION) {
            lastMessageKeyRef.current = null;
          }
          startCooldown();
        }
      }, BUBBLE_TIMEOUT_MS);

      return true;
    },
    [clearFieldHighlight, highlightField, startCooldown, triggerState]
  );

  const refreshFormGuidance = useCallback(
    (options = {}) => {
      const { force = false, animation = "statePoint" } = options;
      const guidance = getFormGuidance(resolveFieldHelp);
      if (!guidance) {
        clearFieldHighlight();
        if (lastMessageKeyRef.current?.startsWith("form:")) {
          dismissBubble(MASCOT_PRIORITY_LEVELS.SUGGESTION);
        }
        return;
      }

      if (guidance.type === "missing") {
        highlightField(guidance.field);
        const keyChanged = lastMessageKeyRef.current !== guidance.key;
        setMessage(guidance.text, MASCOT_PRIORITY_LEVELS.SUGGESTION, guidance.key, {
          force: force || keyChanged,
          animation,
          highlightField: guidance.field,
          bypassCooldown: keyChanged,
        });
        return;
      }

      if (guidance.type === "complete") {
        clearFieldHighlight();
        setMessage(guidance.text, MASCOT_PRIORITY_LEVELS.SUGGESTION, guidance.key, {
          force,
          animation: "stateHappy",
          bypassCooldown: true,
        });
      }
    },
    [clearFieldHighlight, dismissBubble, highlightField, resolveFieldHelp, setMessage]
  );

  const explainField = useCallback(
    (field, options = {}) => {
      if (!field) return false;
      const label = getFieldLabel(field);
      const tip =
        (typeof resolveFieldHelp === "function" && resolveFieldHelp(field)) ||
        (field.required
          ? `“${label}” is required — enter it carefully; it becomes part of the record.`
          : `“${label}” is optional — fill it if you have the detail.`);
      return setMessage(tip, MASCOT_PRIORITY_LEVELS.SUGGESTION, `field-help:${field.name || field.id || label}`, {
        force: true,
        bypassCooldown: true,
        animation: options.animation || "statePoint",
        highlightField: field,
      });
    },
    [resolveFieldHelp, setMessage]
  );

  const pushActivity = useCallback((message, tone = "ok") => {
    if (!message) return;
    setActivityLog((prev) => [{ id: `${Date.now()}-${message.slice(0, 24)}`, message, tone, at: Date.now() }, ...prev].slice(0, 4));
  }, []);

  const handleFormCommand = useCallback(
    async (event) => {
      event.preventDefault();
      const command = formCommand.trim();
      if (!command) return;

      if (onFormCommand) {
        const handled = await onFormCommand(command, {
          pathname,
          router,
          setMessage,
          triggerState,
          refreshFormGuidance,
          setFormCommand,
          commandFields,
          explainField,
          visibleFormFields,
        });
        if (handled) return;
      }

      // Partner default: explain / highlight a matching field — never auto-fill.
      const fields = visibleFormFields();
      const lowered = command.toLowerCase();
      const match = fields.find((field) => {
        const identifier = `${field.name || ""} ${field.id || ""} ${getFieldLabel(field)}`
          .toLowerCase()
          .replace(/[_-]/g, " ");
        return (
          identifier.includes(lowered) ||
          Object.entries(commandFields).some(
            ([key, names]) =>
              (identifier.includes(key.replace(/_/g, " ")) || names.some((name) => identifier.includes(name))) &&
              (lowered.includes(key.replace(/_/g, " ")) || names.some((name) => lowered.includes(name)))
          )
        );
      });

      if (match) {
        setFormCommand("");
        explainField(match);
        return;
      }

      const nextField = getNextMissingRequiredField();
      if (nextField) {
        setFormCommand("");
        explainField(nextField);
        setMessage(
          `I guide field-by-field — you type the values. Next up: ${getFieldLabel(nextField)}.`,
          MASCOT_PRIORITY_LEVELS.SUGGESTION,
          "partner-guide-next",
          { force: true, bypassCooldown: true, animation: "statePoint", highlightField: nextField }
        );
        return;
      }

      setMessage(
        `Ask about a field name, or open AI Assistant for full automation (bulk invite, approvals, reminders).`,
        MASCOT_PRIORITY_LEVELS.SUGGESTION,
        "partner-help",
        { force: true, bypassCooldown: true, animation: "stateThinking" }
      );
    },
    [
      commandFields,
      explainField,
      formCommand,
      onFormCommand,
      pathname,
      refreshFormGuidance,
      router,
      setMessage,
      triggerState,
    ]
  );

  const getFormCommandPlaceholder = useCallback(() => {
    if (commandPlaceholderFn) return commandPlaceholderFn(visibleFormFields());
    const labels = visibleFormFields().slice(0, 2).map(getFieldLabel).filter(Boolean);
    return labels.length ? `Ask about: ${labels.join(", ")}${labels.length > 1 ? "…" : ""}` : `Ask ${roleLabel}…`;
  }, [commandPlaceholderFn, roleLabel]);

  const playMascotSound = useCallback((kind) => {
    if (typeof window === "undefined") return;
    if (kind === "hover" && Date.now() - lastHoverSoundRef.current < 900) return;
    if (kind === "hover") lastHoverSoundRef.current = Date.now();

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = audioContextRef.current || new AudioContext();
    audioContextRef.current = context;
    if (context.state === "suspended") context.resume().catch(() => {});

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(kind === "success" ? 520 : 380, now);
    if (kind === "success") oscillator.frequency.exponentialRampToValueAtTime(760, now + 0.16);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(kind === "success" ? 0.09 : 0.045, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (kind === "success" ? 0.25 : 0.11));
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + (kind === "success" ? 0.26 : 0.12));
  }, []);

  const refreshCoach = useCallback(
    (options = {}) => {
      const {
        announce = false,
        forceHighlight = false,
        skippedKeys: skippedOverride,
        engage = false,
      } = options;
      if (!isRelevantRoute()) {
        setCoach(null);
        setStatusLine(null);
        return null;
      }
      const skipped = skippedOverride ?? skippedOptionalKeysRef.current;
      const snapshot = coachSnapshot(collectFormSteps(), skipped);
      setCoach(snapshot.total ? snapshot : null);

      if (!snapshot.total) {
        setStatusLine(null);
        return snapshot;
      }

      // Intro mode: keep a live progress snapshot, but don't hijack the page with field coaching.
      if (!coachEngagedRef.current && !engage) {
        clearFieldHighlight();
        setStatusLine(
          snapshot.done
            ? `${snapshot.done} of ${snapshot.total} fields ready — open tips, or ask me to guide`
            : `Form on this page — ${snapshot.total} fields`
        );
        return snapshot;
      }

      if (engage && !coachEngagedRef.current) {
        coachEngagedRef.current = true;
        setCoachEngaged(true);
      }

      const tipFn = resolveFieldHelp || recruiterFieldHelpFor;
      const tip = snapshot.next?.field ? tipFn(snapshot.next.field) : null;
      const message = coachMessage(snapshot, tip);

      if (snapshot.allComplete) {
        setStatusLine("Click the primary button on the form");
        optionalFillAcceptedRef.current = false;
        setOptionalFillAccepted(false);
        if (announce) {
          setMessage(
            "All set — required filled, optional handled. Continue with the primary button on the form.",
            MASCOT_PRIORITY_LEVELS.SUGGESTION,
            "coach:complete",
            {
              force: true,
              bypassCooldown: true,
              animation: "stateHappy",
            }
          );
          pushActivity("Form ready — submit to continue", "ok");
          playMascotSound("success");
          const submitBtn =
            document.querySelector('form button[type="submit"]') ||
            Array.from(document.querySelectorAll("form button")).find((btn) =>
              /create invitation|save|submit|publish|send|assign|post/i.test(btn.textContent || "")
            );
          if (submitBtn) {
            clearFieldHighlight();
            if (getComputedStyle(submitBtn).position === "static") {
              submitBtn.style.position = "relative";
            }
            submitBtn.classList.add(styles.fieldHighlight);
            highlightedTargetRef.current = submitBtn;
            try {
              submitBtn.scrollIntoView({ behavior: "smooth", block: "center" });
            } catch {
              // ignore
            }
          }
        } else {
          clearFieldHighlight();
        }
        lastCoachNextKeyRef.current = "complete";
        return snapshot;
      }

      if (snapshot.next) {
        const nextKey = snapshot.next.key;
        const selectMeta = getSelectFieldMeta(snapshot.next.field);
        const isOptional = !snapshot.next.required;

        // Only reset the fill/skip prompt when moving to a *new* optional field.
        if (isOptional && nextKey !== lastCoachNextKeyRef.current) {
          optionalFillAcceptedRef.current = false;
          setOptionalFillAccepted(false);
        }

        const fillAccepted = optionalFillAcceptedRef.current;
        setStatusLine(
          isOptional && !fillAccepted
            ? `Optional: ${snapshot.next.label} — fill or skip?`
            : selectMeta?.many
              ? `Pick “${snapshot.next.label}” on the form (${selectMeta.count} options)`
              : isOptional
                ? `Optional now: ${snapshot.next.label}`
                : `Now: ${snapshot.next.label} (${snapshot.requiredDone + 1}/${snapshot.requiredTotal || snapshot.total})`
        );

        if (forceHighlight || nextKey !== lastCoachNextKeyRef.current) {
          highlightField(snapshot.next.field);
          setCoachDraft("");
          if (announce || forceHighlight) {
            setMessage(message, MASCOT_PRIORITY_LEVELS.SUGGESTION, `coach:${nextKey}`, {
              force: true,
              bypassCooldown: true,
              animation: "statePoint",
              highlightField: snapshot.next.field,
            });
          }
          lastCoachNextKeyRef.current = nextKey;
          if ((!isOptional || fillAccepted) && !selectMeta?.many) {
            setTimeout(() => coachInputRef.current?.focus?.(), 80);
          }
        }
      }
      return snapshot;
    },
    [clearFieldHighlight, highlightField, isRelevantRoute, playMascotSound, pushActivity, resolveFieldHelp, setMessage]
  );

  const showFormIntro = useCallback(
    (snapshot = null) => {
      const live = snapshot || coachSnapshot(collectFormSteps(), skippedOptionalKeysRef.current);
      const summary = pageSummary();
      const title = summary?.title || "This form";
      const what = summary?.what || "Fill the form on this page to continue.";
      const why = summary?.why || "I’ll explain each step when you’re ready.";
      const progressNote =
        live?.done > 0
          ? ` You’ve already completed ${live.done} of ${live.total} fields.`
          : "";
      clearFieldHighlight();
      setBrowsingTips(false);
      setStatusLine(live?.total ? `Form ready — ${live.total} fields` : null);
      setMessage(
        `${title}: ${what} ${why}${progressNote}`,
        MASCOT_PRIORITY_LEVELS.SUGGESTION,
        `intro:${pathname}:${title}`,
        {
          force: true,
          bypassCooldown: true,
          animation: "stateWave",
        }
      );
    },
    [clearFieldHighlight, pageSummary, pathname, setMessage]
  );

  const openPageTips = useCallback(() => {
    // Leave the form overview so the tip carousel can actually show.
    setBrowsingTips(true);
    setPanelOpen(true);
    const deck = insightsRef.current.filter((item) => item?.message && String(item.message).trim());
    if (!deck.length) {
      const summary = pageSummary();
      const seeded = [
        summary?.what,
        summary?.why,
        "Use Guide me through it when you want field-by-field help on this form.",
      ].filter(Boolean);
      const fallback = seeded.map((message, index) => ({
        id: `seed-tip-${index}`,
        message,
      }));
      insightsRef.current = fallback;
      setInsights(fallback);
      setInsightCount(fallback.length);
    }
    const start = insightsRef.current[0]?.message
      ? 0
      : Math.min(suggestionIndexRef.current, Math.max(insightsRef.current.length - 1, 0));
    suggestionIndexRef.current = start;
    setSuggestionIndex(start);
    triggerState("stateWave", 1800);
  }, [pageSummary, setPanelOpen, triggerState]);

  const engageCoach = useCallback(
    (options = {}) => {
      const { announce = true } = options;
      coachEngagedRef.current = true;
      setCoachEngaged(true);
      setBrowsingTips(false);
      setPanelOpen(true);
      lastCoachNextKeyRef.current = null;
      pushActivity("Started form guidance", "info");
      const snapshot = refreshCoach({ announce, forceHighlight: true, engage: true });
      if (snapshot?.allComplete) {
        setMessage(
          "Looks complete — use the primary button on the form when you’re ready.",
          MASCOT_PRIORITY_LEVELS.SUGGESTION,
          "coach:already-complete",
          { force: true, bypassCooldown: true, animation: "stateHappy" }
        );
      }
      return snapshot;
    },
    [pushActivity, refreshCoach, setMessage, setPanelOpen]
  );

  const exitCoachToTips = useCallback(() => {
    coachEngagedRef.current = false;
    setCoachEngaged(false);
    lastCoachNextKeyRef.current = null;
    optionalFillAcceptedRef.current = false;
    setOptionalFillAccepted(false);
    clearFieldHighlight();
    const snapshot = refreshCoach({ announce: false });
    showFormIntro(snapshot);
  }, [clearFieldHighlight, refreshCoach, showFormIntro]);

  const focusCoachField = useCallback((field) => {
    if (!field) return;
    highlightField(field);
    try {
      field.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    } catch {
      // ignore
    }
    try {
      field.focus({ preventScroll: true });
    } catch {
      try {
        field.focus();
      } catch {
        // ignore
      }
    }
  }, [highlightField]);

  const applyCoachValue = useCallback(
    async (rawValue) => {
      if (typingLockRef.current || isTypingIntoField) return;
      const value = String(rawValue || "").trim();
      if (!value) return;

      const snapshot = coachSnapshot(collectFormSteps(), skippedOptionalKeysRef.current);
      const field = snapshot.next?.field;
      if (!field) {
        setMessage("Nothing left to fill — save / submit when ready.", MASCOT_PRIORITY_LEVELS.SUGGESTION, "coach:empty", {
          force: true,
          bypassCooldown: true,
          animation: "stateHappy",
        });
        return;
      }

      typingLockRef.current = true;
      setIsTypingIntoField(true);
      setPanelOpen(true);
      focusCoachField(field);
      setStatusLine(`Typing into “${snapshot.next.label}”…`);
      setMessage(`Writing into ${snapshot.next.label}…`, MASCOT_PRIORITY_LEVELS.SUGGESTION, `typing:${snapshot.next.key}`, {
        force: true,
        bypassCooldown: true,
        animation: "stateThinking",
        highlightField: field,
      });
      triggerState("stateThinking", 4000);

      try {
        const ok = await typeValueIntoField(field, value);
        if (!ok) {
          setMessage(
            field.tagName === "SELECT"
              ? `Couldn't match “${value}” in ${snapshot.next.label}. Pick a chip below or type the exact option.`
              : `Couldn't fill ${snapshot.next.label}. Try again.`,
            MASCOT_PRIORITY_LEVELS.ERROR,
            "coach:type-fail",
            { force: true, bypassCooldown: true, animation: "stateWarning", highlightField: field }
          );
          return;
        }
        setCoachDraft("");
        optionalFillAcceptedRef.current = false;
        setOptionalFillAccepted(false);
        pushActivity(`Filled “${snapshot.next.label}” from partner`, "ok");
        playMascotSound("success");
        triggerState("stateHappy", 1600);
        setTimeout(() => refreshCoach({ announce: true, forceHighlight: true }), 200);
      } finally {
        typingLockRef.current = false;
        setIsTypingIntoField(false);
      }
    },
    [focusCoachField, isTypingIntoField, playMascotSound, pushActivity, refreshCoach, setMessage, triggerState]
  );

  const skipOptionalField = useCallback(
    (event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      const snapshot = coachSnapshot(collectFormSteps(), skippedOptionalKeysRef.current);
      const next = snapshot.next;
      if (!next || next.required) return;

      const nextSkipped = skippedOptionalKeysRef.current.includes(next.key)
        ? skippedOptionalKeysRef.current
        : [...skippedOptionalKeysRef.current, next.key];
      skippedOptionalKeysRef.current = nextSkipped;
      setSkippedOptionalKeys(nextSkipped);
      optionalFillAcceptedRef.current = false;
      setOptionalFillAccepted(false);
      pushActivity(`Skipped optional “${next.label}”`, "info");
      setMessage(`Skipped “${next.label}”. Moving on…`, MASCOT_PRIORITY_LEVELS.SUGGESTION, `skip:${next.key}`, {
        force: true,
        bypassCooldown: true,
        animation: "stateWave",
      });
      lastCoachNextKeyRef.current = null;
      refreshCoach({ announce: true, forceHighlight: true, skippedKeys: nextSkipped });
    },
    [pushActivity, refreshCoach, setMessage]
  );

  const acceptOptionalFill = useCallback(
    (event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      const snapshot = coachSnapshot(collectFormSteps(), skippedOptionalKeysRef.current);
      if (!snapshot.next || snapshot.next.required) return;

      optionalFillAcceptedRef.current = true;
      setOptionalFillAccepted(true);
      focusCoachField(snapshot.next.field);

      const selectMeta = getSelectFieldMeta(snapshot.next.field);
      setMessage(
        selectMeta?.many
          ? `Select “${snapshot.next.label}” from the highlighted dropdown on the form.`
          : `Enter “${snapshot.next.label}” below — or type it in the highlighted field on the form.`,
        MASCOT_PRIORITY_LEVELS.SUGGESTION,
        `optional-fill:${snapshot.next.key}`,
        {
          force: true,
          bypassCooldown: true,
          animation: "statePoint",
          highlightField: snapshot.next.field,
        }
      );
      setStatusLine(`Optional now: ${snapshot.next.label}`);
      if (!selectMeta?.many) {
        setTimeout(() => coachInputRef.current?.focus?.(), 120);
      }
    },
    [focusCoachField, setMessage]
  );

  const applyCoachAnswer = useCallback(
    async (event) => {
      event?.preventDefault?.();
      await applyCoachValue(coachDraft);
    },
    [applyCoachValue, coachDraft]
  );

  const showPageSuggestion = useCallback(
    (force = false) => {
      // While guiding a form, keep field coaching. Otherwise prefer page tips / form intro.
      const liveCoach = coachSnapshot(collectFormSteps(), skippedOptionalKeysRef.current);
      if (liveCoach.total && coachEngagedRef.current) {
        refreshCoach({ announce: true, forceHighlight: true });
        return;
      }
      if (liveCoach.total && !coachEngagedRef.current) {
        refreshCoach({ announce: false });
        showFormIntro(liveCoach);
        return;
      }

      const formGuidance = getFormGuidance(resolveFieldHelp);
      if (formGuidance?.type === "missing") {
        refreshFormGuidance({ force: true, animation: "stateWave" });
        return;
      }

      const pool = insightsRef.current.map((insight) => insight.message).filter(Boolean);
      const pick = pool[suggestionIndexRef.current] || pool[0];
      if (!pick) return;
      lastPageSuggestionRef.current = pick;
      setMessage(pick, MASCOT_PRIORITY_LEVELS.SUGGESTION, `page:${pick}`, {
        force,
        bypassCooldown: true,
        animation: "stateWave",
      });
    },
    [refreshCoach, refreshFormGuidance, resolveFieldHelp, setMessage, showFormIntro]
  );

  const showIdleTip = useCallback(() => {
    if (cooldownActiveRef.current) return;
    // Don't interrupt active field coaching with random page tips.
    if (coachEngagedRef.current && coachSnapshot(collectFormSteps(), skippedOptionalKeysRef.current).total) {
      return;
    }
    const pool = buildIdleInsights(insightsRef.current);
    const pick = pickFromPool(pool, lastIdleMessageRef.current) || pool[0];
    if (!pick) return;
    lastIdleMessageRef.current = pick;
    triggerState("stateBlink", 2000);
    setMessage(pick, MASCOT_PRIORITY_LEVELS.IDLE_TIP, `idle:${pick}`, { animation: "stateBlink" });
  }, [buildIdleInsights, setMessage, triggerState]);

  const getUserFirstName = useCallback(() => {
    try {
      const user = JSON.parse(localStorage.getItem("user") || "null");
      return (user?.full_name || user?.name || "").trim().split(/\s+/)[0] || "";
    } catch {
      return "";
    }
  }, []);

  const refreshInsights = useCallback(async () => {
    const token = localStorage.getItem("access_token");
    if (!token || !isRelevantRoute()) return;

    const context = { ...(readContext() || {}), firstName: getUserFirstName() };
    try {
      const { insights, stats } = await buildInsights(pathname, token, context);
      const seen = new Set();
      const cleaned = (insights || []).filter((item) => {
        const key = String(item?.message || "")
          .trim()
          .toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      insightsRef.current = cleaned;
      setInsights(cleaned);
      setInsightCount(cleaned.length);
      suggestionIndexRef.current = 0;
      setSuggestionIndex(0);
      statsRef.current = stats || {};

      const { prev, next } = updateMemory(statsRef.current);
      const continuity = buildContinuityMessage(prev, next, context.firstName);
      if (continuity) {
        setMessage(continuity, MASCOT_PRIORITY_LEVELS.SUGGESTION, `continuity:${continuity}`, {
          bypassCooldown: true,
          animation: "stateHappy",
        });
      } else if (!readGreeted()) {
        markGreeted();
        setMessage(welcomeMessage(context.firstName, statsRef.current), MASCOT_PRIORITY_LEVELS.SUGGESTION, "welcome", {
          bypassCooldown: true,
          animation: "stateWave",
        });
      } else {
        showPageSuggestion(true);
      }
    } catch {
      // The mascot remains available even when contextual data is unavailable.
    }
  }, [
    buildContinuityMessage,
    buildInsights,
    getUserFirstName,
    isRelevantRoute,
    markGreeted,
    pathname,
    readContext,
    readGreeted,
    setMessage,
    showPageSuggestion,
    updateMemory,
    welcomeMessage,
  ]);

  const showSuggestion = useCallback(
    (nextIndex) => {
      const deck = insightsRef.current;
      if (!deck.length) return;
      // Skip blanks so the pager never lands on an empty tip.
      let index = ((nextIndex % deck.length) + deck.length) % deck.length;
      let item = deck[index];
      let guard = 0;
      while ((!item?.message || !String(item.message).trim()) && guard < deck.length) {
        index = (index + 1) % deck.length;
        item = deck[index];
        guard += 1;
      }
      if (!item?.message) return;
      suggestionIndexRef.current = index;
      setSuggestionIndex(index);
      lastPageSuggestionRef.current = item.message;
      // Tip carousel only — do not force the panel open; user opens via FAB / Guide me.
      triggerState("stateWave", 1800);
    },
    [triggerState]
  );

  const handlePartnerTap = useCallback(() => {
    if (didDrag()) return;
    playMascotSound("click");
    setPanelOpen(true);
    const snapshot = refreshCoach({ announce: false });
    if (snapshot?.total && coachEngagedRef.current && !snapshot.allComplete) {
      refreshCoach({ announce: true, forceHighlight: true });
      return;
    }
    if (snapshot?.total && !coachEngagedRef.current) {
      // Cycle page suggestions while staying in intro mode.
      const deck = insightsRef.current;
      if (deck.length) {
        const next = (suggestionIndexRef.current + 1) % deck.length;
        showSuggestion(next);
        return;
      }
      showFormIntro(snapshot);
      return;
    }
    const formGuidance = getFormGuidance(resolveFieldHelp);
    if (formGuidance?.type === "missing" && formGuidance.field) {
      explainField(formGuidance.field, { animation: "statePoint" });
      return;
    }
    const deck = insightsRef.current;
    if (deck.length) {
      const next = (suggestionIndexRef.current + 1) % deck.length;
      showSuggestion(next);
      return;
    }
    showPageSuggestion(true);
  }, [
    didDrag,
    explainField,
    playMascotSound,
    refreshCoach,
    resolveFieldHelp,
    showFormIntro,
    showPageSuggestion,
    showSuggestion,
  ]);

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(showIdleTip, IDLE_TIMEOUT_MS);
  }, [showIdleTip]);

  useEffect(() => {
    if (!isRelevantRoute()) return;

    lastMessageKeyRef.current = null;
    lastPageSuggestionRef.current = null;
    lastCoachNextKeyRef.current = null;
    setActivityLog([]);
    skippedOptionalKeysRef.current = [];
    optionalFillAcceptedRef.current = false;
    coachEngagedRef.current = false;
    setSkippedOptionalKeys([]);
    setOptionalFillAccepted(false);
    setCoachEngaged(false);
    setBrowsingTips(false);
    clearFieldHighlight();
    resetIdleTimer();
    // Keep user's minimize/maximize preference across page changes.

    const animationTimer = setTimeout(() => {
      triggerState("stateWave", 2500);
    }, 0);

    const timer = setTimeout(async () => {
      await refreshInsights();
      const snapshot = refreshCoach({ announce: false });
      if (snapshot?.total) {
        showFormIntro(snapshot);
      } else {
        showPageSuggestion(true);
      }
    }, 800);

    return () => {
      clearTimeout(animationTimer);
      clearTimeout(timer);
    };
  }, [
    clearFieldHighlight,
    isRelevantRoute,
    pathname,
    refreshCoach,
    refreshInsights,
    resetIdleTimer,
    showFormIntro,
    showPageSuggestion,
    triggerState,
  ]);

  useEffect(() => {
    const onContext = () => {
      // Tab/section changed on the same page — refresh tips + page summary.
      coachEngagedRef.current = false;
      setCoachEngaged(false);
      setBrowsingTips(false);
      lastCoachNextKeyRef.current = null;
      optionalFillAcceptedRef.current = false;
      setOptionalFillAccepted(false);
      clearFieldHighlight();
      refreshInsights();
      const snapshot = refreshCoach({ announce: false });
      if (snapshot?.total) showFormIntro(snapshot);
      else showPageSuggestion(true);
    };
    const onRefresh = () => refreshInsights();
    if (contextEvent) window.addEventListener(contextEvent, onContext);
    if (refreshEvent) window.addEventListener(refreshEvent, onRefresh);
    return () => {
      if (contextEvent) window.removeEventListener(contextEvent, onContext);
      if (refreshEvent) window.removeEventListener(refreshEvent, onRefresh);
    };
  }, [
    clearFieldHighlight,
    contextEvent,
    refreshCoach,
    refreshEvent,
    refreshInsights,
    showFormIntro,
    showPageSuggestion,
  ]);

  useEffect(() => {
    const updateVisibility = () => setShowFormCommand(Boolean(enableCommands && isRelevantRoute()));
    const initialTimer = setTimeout(updateVisibility, 0);
    let coachTimer = null;
    const observer = new MutationObserver(() => {
      updateVisibility();
      if (coachTimer) clearTimeout(coachTimer);
      coachTimer = setTimeout(() => refreshCoach({ announce: false }), 400);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      clearTimeout(initialTimer);
      if (coachTimer) clearTimeout(coachTimer);
      observer.disconnect();
    };
  }, [enableCommands, isRelevantRoute, pathname, refreshCoach]);

  useEffect(() => {
    const timer = setInterval(refreshInsights, 45000);
    return () => clearInterval(timer);
  }, [refreshInsights]);

  useEffect(() => {
    const events = ["mousedown", "mousemove", "keydown", "scroll", "touchstart"];
    const handleActivity = () => resetIdleTimer();

    events.forEach((name) => window.addEventListener(name, handleActivity, { passive: true }));
    return () => {
      events.forEach((name) => window.removeEventListener(name, handleActivity));
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
      if (stateTimerRef.current) clearTimeout(stateTimerRef.current);
      clearFieldHighlight();
    };
  }, [clearFieldHighlight, resetIdleTimer]);

  useEffect(() => {
    const handleFormInput = (e) => {
      const field = e.target;
      if (!field.closest("form") || field.closest("[data-mascot-command]")) return;
      // OCR / file picks fire `change` on <input type="file"> — never treat that as
      // "user is filling the form" or the panel jumps into Guiding live mid-scan.
      if (!isCoachableFormField(field)) return;
      // Busy overlays (OCR scan, uploads) — stay quiet until the user is free again.
      if (document.querySelector("[data-mascot-busy]")) return;
      // Minimized = leave the user alone. Typing must never re-open the panel.
      if (!panelOpenRef.current) {
        resetIdleTimer();
        return;
      }

      resetIdleTimer();

      // Live guidance is opt-in ("Guide me through it") — never auto-open / auto-engage.
      if (!coachEngagedRef.current) return;

      const label = coachFieldLabel(field);
      const key = field.name || field.id || label;
      const filled = !isFieldEmpty(field);
      if (filled && key !== lastFilledKeyRef.current) {
        lastFilledKeyRef.current = key;
        pushActivity(`Filled “${label}”`, "ok");
        triggerState("stateHappy", 1200);
        optionalFillAcceptedRef.current = false;
        setOptionalFillAccepted(false);
        refreshCoach({ announce: true });
      } else {
        refreshCoach({ announce: false });
      }
    };

    const handleFocus = (e) => {
      const field = e.target;
      if (!field.closest?.("form") || field.closest("[data-mascot-command]")) return;
      if (!isCoachableFormField(field)) return;
      if (document.querySelector("[data-mascot-busy]")) return;
      // Don't narrate / flash status while the panel is minimized.
      if (!panelOpenRef.current) {
        resetIdleTimer();
        return;
      }
      triggerState("stateThinking", 4000);
      resetIdleTimer();
      if (!coachEngagedRef.current) {
        // Panel already open in intro — tip the focused field without engaging guide mode.
        explainField(field, { animation: "statePoint" });
        setStatusLine(`Editing: ${getFieldLabel(field)}`);
        refreshCoach({ announce: false });
        return;
      }
      explainField(field, { animation: "statePoint" });
      setStatusLine(`Editing: ${getFieldLabel(field)}`);
      pushActivity(`Focus on “${getFieldLabel(field)}”`, "info");
      refreshCoach({ announce: false });
    };

    const handleSubmit = (e) => {
      if (!e.target.closest("form")) return;
      triggerState("stateThinking", 5000);
      resetIdleTimer();
    };

    const handleInvalid = (e) => {
      const field = e.target;
      if (!field.closest("form")) return;
      if (!panelOpenRef.current) {
        resetIdleTimer();
        return;
      }
      refreshFormGuidance({ force: true, animation: "stateWarning" });
      const guidance = getFormGuidance(resolveFieldHelp);
      if (guidance?.type === "missing") {
        setMessage(guidance.text, MASCOT_PRIORITY_LEVELS.ERROR, `${guidance.key}:invalid`, {
          force: true,
          animation: "stateWarning",
          highlightField: guidance.field,
          bypassCooldown: true,
        });
      }
      resetIdleTimer();
    };

    window.addEventListener("input", handleFormInput, true);
    window.addEventListener("change", handleFormInput, true);
    window.addEventListener("focusin", handleFocus);
    window.addEventListener("submit", handleSubmit);
    window.addEventListener("invalid", handleInvalid, true);

    return () => {
      window.removeEventListener("input", handleFormInput, true);
      window.removeEventListener("change", handleFormInput, true);
      window.removeEventListener("focusin", handleFocus);
      window.removeEventListener("submit", handleSubmit);
      window.removeEventListener("invalid", handleInvalid, true);
    };
  }, [explainField, pushActivity, refreshCoach, refreshFormGuidance, resetIdleTimer, resolveFieldHelp, setMessage, triggerState]);

  useEffect(() => {
    const unsubscribe = toast.onChange((payload) => {
      if (payload.status !== "added" && payload.status !== "updated") return;

      const type = payload.type;
      const rawContent = payload.content;
      let text = "";

      if (typeof rawContent === "string") {
        text = rawContent;
      } else if (rawContent?.props?.children) {
        text = String(rawContent.props.children);
      }

      if (!text) return;

      if (type === "success") {
        clearFieldHighlight();
        triggerState("stateCelebrate", 3000);
        setMessage(text, MASCOT_PRIORITY_LEVELS.SUCCESS, `toast:success:${text}`, {
          force: true,
          bypassCooldown: true,
        });
      } else if (type === "error" || type === "warning") {
        triggerState("stateWarning", 3000);
        setMessage(text, MASCOT_PRIORITY_LEVELS.ERROR, `toast:error:${text}`, {
          force: true,
          bypassCooldown: true,
        });
      }
    });

    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [clearFieldHighlight, setMessage, triggerState]);

  useEffect(() => {
    const handleFormSuccess = (e) => {
      const message = e.detail?.message || "Action successful!";
      clearFieldHighlight();
      triggerState("stateCelebrate", 3500);
      setMessage(message, MASCOT_PRIORITY_LEVELS.SUCCESS, `event:success:${message}`, {
        force: true,
        bypassCooldown: true,
      });
      invalidateCache();
    };

    const handleFormError = (e) => {
      const message = e.detail?.message || "Form validation failed.";
      triggerState("stateWarning", 3500);
      setMessage(message, MASCOT_PRIORITY_LEVELS.ERROR, `event:error:${message}`, {
        force: true,
        bypassCooldown: true,
      });
    };

    window.addEventListener("talent-form-success", handleFormSuccess);
    window.addEventListener("talent-form-error", handleFormError);

    return () => {
      window.removeEventListener("talent-form-success", handleFormSuccess);
      window.removeEventListener("talent-form-error", handleFormError);
    };
  }, [clearFieldHighlight, invalidateCache, setMessage, triggerState]);

  useEffect(() => {
    const handleShellNotifications = (e) => {
      const { unreadCount, notifications } = e.detail || {};
      if (unreadCount === undefined) return;

      const previous = lastUnreadCountRef.current;
      lastUnreadCountRef.current = unreadCount;

      if (previous !== null && unreadCount > previous) {
        const text = formatNotificationText(notifications);
        if (text) {
          const latest = (notifications || []).find((n) => !n.read);
          triggerState("stateNotification", 4000);
          setMessage(text, MASCOT_PRIORITY_LEVELS.NOTIFICATION, `notif:${latest?.id || text}`, {
            force: true,
            bypassCooldown: true,
          });
        }
      }
    };

    window.addEventListener("talent-notifications-updated", handleShellNotifications);
    return () => {
      window.removeEventListener("talent-notifications-updated", handleShellNotifications);
    };
  }, [setMessage, triggerState]);

  useEffect(() => {
    let rafId = null;
    const handleMouseMove = (e) => {
      if (activeState !== "stateIdle" || !mascotBtnRef.current) return;
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const rect = mascotBtnRef.current.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 3;
        const dx = Math.max(-3, Math.min(3, (e.clientX - cx) / 40));
        const dy = Math.max(-2, Math.min(2, (e.clientY - cy) / 40));
        setEyeOffset({ x: dx, y: dy });
      });
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [activeState]);

  return (
    <div
      ref={wrapRef}
      className={[
        styles.mascotWrapper,
        alignH === "start" ? styles.panelAlignStart : "",
        alignV === "below" ? styles.panelBelow : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={fabStyle}
    >
      {showFormCommand && (
        <div className={styles.commandStack}>
          <form className={styles.formCommand} data-mascot-command onSubmit={handleFormCommand}>
            <input
              value={formCommand}
              onChange={(event) => setFormCommand(event.target.value)}
              placeholder={getFormCommandPlaceholder()}
              aria-label={`${roleLabel} command`}
            />
            <button type="submit" aria-label="Run command">
              Go
            </button>
          </form>
          {confirmAction}
        </div>
      )}

      {panelHydrated && panelOpen && (bubbleText || coach?.total || statusLine || insightCount > 0)
        ? (() => {
            const formComplete = Boolean(coach?.allComplete);
            const hasForm = Boolean(coach?.total);
            const introMode = Boolean(hasForm && !coachEngaged && !formComplete && !browsingTips);
            const coaching = Boolean(hasForm && coachEngaged);
            const tipMode = !coaching;
            const summary = pageSummary();
            const nextOptionalOffer = Boolean(
              coaching && coach?.next && !coach.next.required && !optionalFillAccepted && !formComplete
            );
            const isWorking =
              isTypingIntoField ||
              activeState === "stateThinking" ||
              activeState === "statePoint";
            const liveLabel = isTypingIntoField
              ? "Writing into form…"
              : activeState === "stateThinking"
                ? "Thinking…"
                : activeState === "statePoint"
                  ? "Pointing the next step…"
                  : formComplete
                    ? "Ready when you are"
                    : coaching
                      ? "Guiding live"
                      : introMode
                        ? "Standing by"
                        : "Watching this page";

            return (
              <div
                className={[
                  styles.partnerPanel,
                  styles.panelLive,
                  introMode ? styles.panelIntro : "",
                  coaching ? styles.panelGuiding : "",
                  formComplete ? styles.panelReady : "",
                  isWorking ? styles.panelWorking : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                role="status"
                aria-live="polite"
              >
                <div className={styles.panelSheen} aria-hidden="true" />
                <button
                  type="button"
                  className={styles.closeBubbleBtn}
                  onClick={() => {
                    setPanelOpen(false);
                    coachEngagedRef.current = false;
                    setCoachEngaged(false);
                    optionalFillAcceptedRef.current = false;
                    setOptionalFillAccepted(false);
                    setBrowsingTips(false);
                    setStatusLine(null);
                    bubbleRef.current = { text: "", priority: MASCOT_PRIORITY_LEVELS.NONE };
                    setBubbleText("");
                    lastMessageKeyRef.current = null;
                    clearFieldHighlight();
                    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
                  }}
                  aria-label="Minimize partner"
                >
                  &times;
                </button>

                <div className={styles.aiLiveBar} aria-hidden="true">
                  <span className={`${styles.aiLiveDots} ${isWorking ? styles.aiLiveDotsActive : ""}`}>
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className={styles.aiLiveLabel}>{liveLabel}</span>
                </div>

                <div className={`${styles.panelLabel} ${formComplete ? styles.panelLabelOk : ""}`}>
                  <span className={styles.panelPulse} aria-hidden="true" />
                  {formComplete
                    ? "Ready to send"
                    : nextOptionalOffer
                      ? "Optional field"
                      : coaching
                        ? "Guiding you"
                        : introMode
                          ? "AI partner"
                          : "Page tip"}
                </div>

                {coaching ? (
                  <div className={styles.panelProgress} aria-hidden="true">
                    <div
                      className={`${styles.panelProgressFill} ${isWorking ? styles.panelProgressBusy : ""}`}
                      style={{ width: `${coach.progress}%` }}
                    />
                  </div>
                ) : null}

                {introMode ? (
                  <div className={`${styles.formIntro} ${styles.fadeInUp}`} data-mascot-command>
                    <p className={styles.bubbleText}>{summary?.title || "Form on this page"}</p>
                    <p className={styles.formIntroWhat}>{summary?.what || "You can fill this form to continue."}</p>
                    <p className={styles.formIntroWhy}>{summary?.why || "Ask me to guide you when you’re ready."}</p>
                    {coach?.done > 0 ? (
                      <p className={styles.formIntroProgress}>
                        Progress so far: {coach.done} of {coach.total} fields done.
                      </p>
                    ) : null}
                    <div className={styles.optionalOfferActions}>
                      <button type="button" className={styles.coachConfirm} onClick={() => engageCoach()}>
                        Guide me through it
                      </button>
                      <button type="button" className={styles.optionalSkip} onClick={openPageTips}>
                        More tips
                      </button>
                    </div>
                  </div>
                ) : null}

                {coaching ? (
                  <p key={`coach-msg-${coach?.next?.key || "done"}-${formComplete}`} className={`${styles.bubbleText} ${styles.fadeInUp}`}>
                    {formComplete
                      ? "All set — required filled, optional handled. Click the primary button on the form."
                      : nextOptionalOffer
                        ? `Optional: “${coach.next.label}”. Want to fill it, or skip?`
                        : bubbleText ||
                          (coach.next
                            ? `Next up: “${coach.next.label}”.`
                            : "Fill the highlighted field.")}
                  </p>
                ) : null}

                {!introMode && !coaching && bubbleText && insightCount === 0 ? (
                  <p key={bubbleText} className={`${styles.bubbleText} ${styles.fadeInUp}`}>
                    {bubbleText}
                  </p>
                ) : null}

                {isTypingIntoField ? (
                  <div className={styles.typingRail} aria-live="polite">
                    <span className={styles.typingDots}>
                      <i />
                      <i />
                      <i />
                    </span>
                    <span>AI is typing into the form…</span>
                  </div>
                ) : null}

                {coaching && !formComplete && !nextOptionalOffer && statusLine ? (
                  <p className={`${styles.panelStatus} ${styles.fadeInUp}`}>{statusLine}</p>
                ) : null}

                {nextOptionalOffer ? (
                  <div className={`${styles.optionalOffer} ${styles.fadeInUp}`} data-mascot-command>
                    <p className={styles.optionalOfferHint}>
                      This field is optional — fill it if you have the detail, or skip to continue.
                    </p>
                    <div className={styles.optionalOfferActions}>
                      <button type="button" className={styles.coachConfirm} onClick={acceptOptionalFill}>
                        Fill it
                      </button>
                      <button type="button" className={styles.optionalSkip} onClick={skipOptionalField}>
                        Skip
                      </button>
                    </div>
                  </div>
                ) : null}

                {coach?.next && coaching && !formComplete && !nextOptionalOffer
                  ? (() => {
                      const selectMeta = getSelectFieldMeta(coach.next.field);
                      const pickOnForm = Boolean(selectMeta?.many);

                      if (pickOnForm) {
                        return (
                          <div className={`${styles.coachPickOnForm} ${styles.fadeInUp}`} data-mascot-command>
                            <p className={styles.coachPickTitle}>
                              Select “{coach.next.label}” from the dropdown on the form
                              {!coach.next.required ? " (optional)" : ""}
                            </p>
                            <p className={styles.coachPickHint}>
                              {selectMeta.count} options — too many to list here. Choose it yourself in the
                              highlighted field; I&apos;ll mark it done when you pick one.
                            </p>
                            <div className={styles.optionalOfferActions}>
                              <button
                                type="button"
                                className={styles.coachConfirm}
                                onClick={() => {
                                  highlightField(coach.next.field);
                                  coach.next.field?.focus?.();
                                  setMessage(
                                    `Open the “${coach.next.label}” dropdown on the form and pick a value.`,
                                    MASCOT_PRIORITY_LEVELS.SUGGESTION,
                                    `pick-on-form:${coach.next.key}`,
                                    {
                                      force: true,
                                      bypassCooldown: true,
                                      animation: "statePoint",
                                      highlightField: coach.next.field,
                                    }
                                  );
                                }}
                              >
                                Show me the field
                              </button>
                              {!coach.next.required ? (
                                <button type="button" className={styles.optionalSkip} onClick={skipOptionalField}>
                                  Skip
                                </button>
                              ) : null}
                            </div>
                          </div>
                        );
                      }

                      return (
                        <form
                          className={`${styles.coachInputRow} ${styles.fadeInUp}`}
                          data-mascot-command
                          onSubmit={applyCoachAnswer}
                        >
                          <label className={styles.coachInputLabel} htmlFor="recruiter-partner-fill">
                            {selectMeta
                              ? `Choose “${coach.next.label}”${!coach.next.required ? " (optional)" : ""}`
                              : `Type here — I'll write it into “${coach.next.label}”${!coach.next.required ? " (optional)" : ""}`}
                          </label>
                          {selectMeta ? (
                            <div className={styles.coachSelectHints}>
                              {selectMeta.options.map((opt) => (
                                <button
                                  key={opt.value}
                                  type="button"
                                  className={styles.coachChip}
                                  disabled={isTypingIntoField}
                                  onClick={() => applyCoachValue(opt.text?.trim() || opt.value)}
                                >
                                  {opt.text?.trim() || opt.value}
                                </button>
                              ))}
                            </div>
                          ) : null}
                          <div className={styles.coachInputControls}>
                            <input
                              ref={coachInputRef}
                              id="recruiter-partner-fill"
                              className={styles.coachInput}
                              value={coachDraft}
                              disabled={isTypingIntoField}
                              onChange={(event) => setCoachDraft(event.target.value)}
                              placeholder={
                                isTypingIntoField
                                  ? "Writing into the form…"
                                  : `Enter ${coach.next.label}…`
                              }
                              autoComplete="off"
                            />
                            <button
                              type="submit"
                              className={styles.coachConfirm}
                              disabled={isTypingIntoField || !coachDraft.trim()}
                            >
                              {isTypingIntoField ? "…" : "Fill"}
                            </button>
                          </div>
                          {!coach.next.required ? (
                            <button
                              type="button"
                              className={styles.optionalSkipLink}
                              onClick={skipOptionalField}
                            >
                              Skip this optional field
                            </button>
                          ) : null}
                        </form>
                      );
                    })()
                  : null}

                {coaching && coach.steps?.length ? (
                  <ul className={`${styles.stepList} ${styles.fadeInUp}`} aria-label="Form progress">
                    {coach.steps.slice(0, 10).map((step, index) => (
                      <li
                        key={`${step.key}-${step.label}`}
                        className={`${styles.stepItem} ${
                          step.status === "done"
                            ? styles.stepDone
                            : step.status === "skipped"
                              ? styles.stepSkipped
                              : step.status === "active"
                                ? styles.stepActive
                                : styles.stepPending
                        }`}
                        style={{ animationDelay: `${index * 40}ms` }}
                      >
                        <span className={styles.stepMark} aria-hidden="true">
                          {step.status === "done"
                            ? "✓"
                            : step.status === "skipped"
                              ? "–"
                              : step.status === "active"
                                ? "●"
                                : "○"}
                        </span>
                        <span>
                          {step.label}
                          {!step.required ? <em className={styles.optionalTag}> optional</em> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {coaching && !formComplete ? (
                  <button type="button" className={styles.optionalSkipLink} onClick={exitCoachToTips}>
                    Back to page tips
                  </button>
                ) : null}

                {formComplete ? (
                  <p className={`${styles.panelCta} ${styles.fadeInUp}`}>
                    Next action: use the primary button on the form to continue.
                  </p>
                ) : null}

                {/* Intro: explain why the page/form helps. Tip mode: only pager — current tip is already the main bubble. */}
                {introMode && insightCount > 0 ? (
                  <div className={`${styles.pageTipsBlock} ${styles.fadeInUp}`}>
                    <div className={styles.pageTipsHead}>Why this helps</div>
                    <p className={styles.pageTipText}>
                      {summary?.why ||
                        insightsRef.current[0]?.message ||
                        "Ask me to guide you when you’re ready."}
                    </p>
                  </div>
                ) : null}

                {browsingTips && !coaching && !formComplete && insightCount === 0 ? (
                  <div className={`${styles.pageTipsBlock} ${styles.fadeInUp}`}>
                    <div className={styles.pageTipsHead}>Tips for this page</div>
                    <p className={styles.pageTipText}>
                      {summary?.what || "This page helps you continue your hiring journey."}
                    </p>
                    <p className={styles.pageTipText} style={{ marginTop: 6 }}>
                      {summary?.why || "Fill what’s on screen, then use Guide me through it for field help."}
                    </p>
                    <div className={styles.optionalOfferActions} style={{ marginTop: 10 }}>
                      <button type="button" className={styles.coachConfirm} onClick={() => engageCoach()}>
                        Guide me through it
                      </button>
                      <button
                        type="button"
                        className={styles.optionalSkip}
                        onClick={() => {
                          setBrowsingTips(false);
                          showFormIntro(coach);
                        }}
                      >
                        Back to overview
                      </button>
                    </div>
                  </div>
                ) : null}

                {tipMode && !introMode && !coaching && !formComplete && insightCount > 0 ? (
                  <div className={`${styles.pageTipsBlock} ${styles.fadeInUp}`}>
                    {browsingTips && hasForm ? (
                      <div className={styles.pageTipsHead}>Tips for this page</div>
                    ) : null}
                    <p key={`tip-${suggestionIndex}`} className={`${styles.pageTipText} ${styles.fadeInUp}`}>
                      {(insights[suggestionIndex] || insights[0])?.message ||
                        summary?.what ||
                        "Tips for this page appear here."}
                    </p>
                    {insightCount > 1 ? (
                      <div
                        className={styles.suggestionPager}
                        aria-label={`Tip ${suggestionIndex + 1} of ${insightCount}`}
                      >
                        <button
                          type="button"
                          disabled={suggestionIndex <= 0}
                          onClick={() => showSuggestion(suggestionIndex - 1)}
                          aria-label="Previous tip"
                        >
                          ‹
                        </button>
                        <span>
                          Tip {suggestionIndex + 1} of {insightCount}
                        </span>
                        <button
                          type="button"
                          disabled={suggestionIndex >= insightCount - 1}
                          onClick={() => showSuggestion(suggestionIndex + 1)}
                          aria-label="Next tip"
                        >
                          ›
                        </button>
                      </div>
                    ) : null}
                    {browsingTips && hasForm ? (
                      <div className={styles.optionalOfferActions} style={{ marginTop: 10 }}>
                        <button type="button" className={styles.coachConfirm} onClick={() => engageCoach()}>
                          Guide me through it
                        </button>
                        <button
                          type="button"
                          className={styles.optionalSkip}
                          onClick={() => {
                            setBrowsingTips(false);
                            showFormIntro(coach);
                          }}
                        >
                          Back to overview
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {formComplete && insightCount > 0 ? (
                  <div className={`${styles.pageTipsBlock} ${styles.fadeInUp}`}>
                    <div className={styles.pageTipsHead}>More tips</div>
                    <p key={`tip-done-${suggestionIndex}`} className={styles.pageTipText}>
                      {(insights[suggestionIndex] || insights[0])?.message ||
                        "This page is ready — tap › if more tips are available."}
                    </p>
                    {insightCount > 1 ? (
                      <div
                        className={styles.suggestionPager}
                        aria-label={`Tip ${suggestionIndex + 1} of ${insightCount}`}
                      >
                        <button
                          type="button"
                          disabled={suggestionIndex <= 0}
                          onClick={() => showSuggestion(suggestionIndex - 1)}
                          aria-label="Previous tip"
                        >
                          ‹
                        </button>
                        <span>
                          Tip {suggestionIndex + 1} of {insightCount}
                        </span>
                        <button
                          type="button"
                          disabled={suggestionIndex >= insightCount - 1}
                          onClick={() => showSuggestion(suggestionIndex + 1)}
                          aria-label="Next tip"
                        >
                          ›
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {activityLog.length > 0 && coaching && !formComplete ? (
                  <details className={styles.activityDetails}>
                    <summary>Recent AI activity</summary>
                    <ul className={styles.activityList}>
                      {activityLog.slice(0, 3).map((item) => (
                        <li key={item.id} className={item.tone === "ok" ? styles.activityOk : ""}>
                          {item.message}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                <div className={styles.bubbleArrow} />
              </div>
            );
          })()
        : null}

      <button
        ref={mascotBtnRef}
        type="button"
        className={[
          styles.mascotBtn,
          styles[activeState],
          panelOpen ? styles.mascotBtnActive : "",
          isTypingIntoField ? styles.mascotBtnWorking : "",
          dragging ? styles.mascotBtnDragging : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={handlePartnerTap}
        onMouseEnter={() => playMascotSound("hover")}
        aria-label={`${roleLabel} partner — show next tip`}
        aria-expanded={panelOpen}
        title={`${roleLabel} partner — drag to move`}
        {...handleProps}
      >
        <span className={styles.auraRing} aria-hidden="true" />
        <span className={`${styles.auraRing} ${styles.auraRingDelayed}`} aria-hidden="true" />
        {coach?.total && !panelOpen ? (
          <span className={styles.avatarBadge}>{Math.max(coach.total - coach.done, 0) || "✓"}</span>
        ) : null}
        <svg viewBox="0 0 100 100" className={styles.mascotSvg} xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="screenGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#2563eb" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#1e3a8a" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="scanGlow" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0" />
              <stop offset="50%" stopColor="#22d3ee" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
            </linearGradient>
            <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
              <feDropShadow dx="0" dy="4" stdDeviation="3" floodColor="#000" floodOpacity="0.2" />
            </filter>
            <clipPath id="faceClip">
              <rect x="28" y="22" width="44" height="34" rx="12" />
            </clipPath>
          </defs>

          <ellipse cx="50" cy="84" rx="12" ry="4" className={styles.thrusterGlow} />

          <path d="M 38 65 Q 50 78 62 65 Q 50 68 38 65 Z" className={styles.bodyBase} filter="url(#shadow)" />
          <path d="M 45 68 L 55 68 L 50 78 Z" className={styles.bodyThruster} />

          <rect x="46" y="54" width="8" height="8" rx="2" className={styles.robotNeck} />

          <path d="M 28 50 C 18 50 14 38 16 32 C 18 30 20 34 20 38 C 20 44 26 46 28 46 Z" className={styles.leftArm} />

          <path d="M 72 50 C 82 50 86 44 84 38 C 82 36 80 40 80 44 C 80 46 74 46 72 46 Z" className={styles.rightArm} />

          <rect x="24" y="18" width="52" height="42" rx="16" className={styles.headShell} filter="url(#shadow)" />

          <rect x="28" y="22" width="44" height="34" rx="12" className={styles.faceScreen} />

          <rect x="28" y="22" width="44" height="34" rx="12" fill="url(#screenGlow)" pointerEvents="none" />

          <g clipPath="url(#faceClip)" pointerEvents="none">
            <rect x="28" y="22" width="44" height="8" fill="url(#scanGlow)" className={styles.faceScan} />
          </g>

          <ellipse cx={42 + eyeOffset.x} cy={39 + eyeOffset.y} rx="5" ry="7" className={`${styles.eye} ${styles.leftEye}`} />
          <ellipse cx={58 + eyeOffset.x} cy={39 + eyeOffset.y} rx="5" ry="7" className={`${styles.eye} ${styles.rightEye}`} />

          <line x1="50" y1="18" x2="50" y2="10" strokeWidth="3" strokeLinecap="round" className={styles.antennaStem} />
          <circle cx="50" cy="8" r="4" className={styles.antennaTip} />
        </svg>
      </button>
    </div>
  );
}

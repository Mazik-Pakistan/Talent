"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "react-toastify";
import styles from "./BaseMascot.module.css";

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

function getFormGuidance() {
  const forms = getVisibleForms();
  if (!forms.length) return null;

  const nextField = getNextMissingRequiredField();
  if (nextField) {
    const label = getFieldLabel(nextField);
    const key = `form:missing:${nextField.name || nextField.id || label}`;
    return {
      type: "missing",
      text: `${label} is required.`,
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

export function setNativeFieldValue(field, value) {
  const prototype =
    field.tagName === "SELECT"
      ? HTMLSelectElement.prototype
      : field.tagName === "TEXTAREA"
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) return false;
  let next = value.trim();
  if (field.tagName === "SELECT") {
    const option = Array.from(field.options).find(
      (item) => item.value.toLowerCase() === next.toLowerCase() || item.text.trim().toLowerCase() === next.toLowerCase()
    );
    if (!option) return false;
    next = option.value;
  }
  setter.call(field, next);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

export default function BaseMascot({
  openChat,
  toggleChat,
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
}) {
  const pathname = usePathname();
  const router = useRouter();

  const [activeState, setActiveState] = useState("stateIdle");
  const [bubbleText, setBubbleText] = useState("");
  const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 });
  const [formCommand, setFormCommand] = useState("");
  const [showFormCommand, setShowFormCommand] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [insightCount, setInsightCount] = useState(0);

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
  const mascotBtnRef = useRef(null);
  const statsRef = useRef({});
  const insightsRef = useRef([]);
  const suggestionIndexRef = useRef(0);
  const audioContextRef = useRef(null);
  const lastHoverSoundRef = useRef(0);

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
      const guidance = getFormGuidance();
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
    [clearFieldHighlight, dismissBubble, highlightField, setMessage]
  );

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
        });
        if (handled) return;
      }

      // Default generic command filler using commandFields
      const fields = visibleFormFields();
      const allAliases = Object.values(commandFields).flat().join("|");
      let filled = 0;
      fields.forEach((field) => {
        const identifier = `${field.name || ""} ${field.id || ""} ${getFieldLabel(field)}`.toLowerCase().replace(/[_-]/g, " ");
        const aliases = Object.entries(commandFields)
          .filter(([key, names]) => identifier.includes(key.replace(/_/g, " ")) || names.some((name) => identifier.includes(name)))
          .flatMap(([, names]) => names)
          .sort((a, b) => b.length - a.length);
        const alias = aliases.find((name) =>
          new RegExp(`(?:^|[,;\\s])${name.replace(/ /g, "\\s+")}(?:\\s*(?:is|:|=))?\\s+`, "i").test(command)
        );
        if (!alias) return;
        const value = command
          .match(
            new RegExp(
              `(?:^|[,;\\s])${alias.replace(/ /g, "\\s+")}(?:\\s*(?:is|:|=))?\\s+(.+?)(?=\\s*(?:,|;|\\band\\b)\\s*(?:${allAliases})\\b|$)`,
              "i"
            )
          )?.[1]
          ?.trim()
          .replace(/^['\"]|['\"]$/g, "");
        if (value && setNativeFieldValue(field, value)) filled += 1;
      });

      if (!filled) {
        const firstField = fields[0] ? getFieldLabel(fields[0]) : "a visible field";
        setMessage(`Enter ${firstField} followed by its value.`, MASCOT_PRIORITY_LEVELS.SUGGESTION, "form-command-help", {
          force: true,
          bypassCooldown: true,
          animation: "stateThinking",
        });
        return;
      }

      setFormCommand("");
      const required = fields.filter((field) => field.required);
      const remaining = required.filter(isFieldEmpty).length;
      const progress = required.length ? ` Step ${required.length - remaining} of ${required.length}; ${remaining} left.` : "";
      setMessage(`Filled ${filled} field${filled === 1 ? "" : "s"}.${progress}`, MASCOT_PRIORITY_LEVELS.SUGGESTION, `form-command:${Date.now()}`, {
        force: true,
        bypassCooldown: true,
        animation: "stateHappy",
      });
      setTimeout(() => refreshFormGuidance({ force: true }), 0);
    },
    [commandFields, formCommand, onFormCommand, pathname, refreshFormGuidance, router, setMessage, triggerState]
  );

  const getFormCommandPlaceholder = useCallback(() => {
    if (commandPlaceholderFn) return commandPlaceholderFn(visibleFormFields());
    const labels = visibleFormFields().slice(0, 2).map(getFieldLabel).filter(Boolean);
    return labels.length ? `Fill: ${labels.join(", ")}${labels.length > 1 ? "…" : ""}` : `Ask ${roleLabel}…`;
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

  const showPageSuggestion = useCallback(
    (force = false) => {
      const formGuidance = getFormGuidance();
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
    [refreshFormGuidance, setMessage]
  );

  const showIdleTip = useCallback(() => {
    if (cooldownActiveRef.current) return;
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
      insightsRef.current = insights || [];
      setInsightCount(insightsRef.current.length);
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
      const item = deck[nextIndex];
      if (!item?.message) return;
      suggestionIndexRef.current = nextIndex;
      setSuggestionIndex(nextIndex);
      lastPageSuggestionRef.current = item.message;
      setMessage(item.message, MASCOT_PRIORITY_LEVELS.SUGGESTION, `page:${item.id || item.message}`, {
        force: true,
        bypassCooldown: true,
        animation: "stateWave",
      });
    },
    [setMessage]
  );

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(showIdleTip, IDLE_TIMEOUT_MS);
  }, [showIdleTip]);

  useEffect(() => {
    if (!isRelevantRoute()) return;

    lastMessageKeyRef.current = null;
    lastPageSuggestionRef.current = null;
    clearFieldHighlight();
    resetIdleTimer();

    const animationTimer = setTimeout(() => {
      triggerState("stateWave", 2500);
    }, 0);

    const timer = setTimeout(() => {
      refreshInsights();
    }, 800);

    return () => {
      clearTimeout(animationTimer);
      clearTimeout(timer);
    };
  }, [clearFieldHighlight, isRelevantRoute, pathname, refreshInsights, resetIdleTimer, triggerState]);

  useEffect(() => {
    const refresh = () => refreshInsights();
    if (contextEvent) window.addEventListener(contextEvent, refresh);
    if (refreshEvent) window.addEventListener(refreshEvent, refresh);
    return () => {
      if (contextEvent) window.removeEventListener(contextEvent, refresh);
      if (refreshEvent) window.removeEventListener(refreshEvent, refresh);
    };
  }, [contextEvent, refreshEvent, refreshInsights]);

  useEffect(() => {
    const updateVisibility = () => setShowFormCommand(Boolean(isRelevantRoute()));
    const initialTimer = setTimeout(updateVisibility, 0);
    const observer = new MutationObserver(updateVisibility);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      clearTimeout(initialTimer);
      observer.disconnect();
    };
  }, [isRelevantRoute, pathname]);

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
      if (!field.closest("form")) return;
      resetIdleTimer();
      refreshFormGuidance({ force: true });
    };

    const handleFocus = (e) => {
      if (!e.target.closest("form")) return;
      triggerState("stateThinking", 4000);
      resetIdleTimer();
    };

    const handleSubmit = (e) => {
      if (!e.target.closest("form")) return;
      triggerState("stateThinking", 5000);
      resetIdleTimer();
    };

    const handleInvalid = (e) => {
      const field = e.target;
      if (!field.closest("form")) return;
      refreshFormGuidance({ force: true, animation: "stateWarning" });
      const guidance = getFormGuidance();
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
  }, [refreshFormGuidance, resetIdleTimer, setMessage, triggerState]);

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
    <div className={styles.mascotWrapper}>
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
      {bubbleText && (
        <div className={styles.speechBubble} role="alert" aria-live="polite">
          <p className={styles.bubbleText}>{bubbleText}</p>
          <button
            type="button"
            className={styles.closeBubbleBtn}
            onClick={() => {
              bubbleRef.current = { text: "", priority: MASCOT_PRIORITY_LEVELS.NONE };
              setBubbleText("");
              lastMessageKeyRef.current = null;
              clearFieldHighlight();
              if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
            }}
            aria-label="Dismiss message"
          >
            &times;
          </button>
          {insightCount > 1 && (
            <div className={styles.suggestionPager} aria-label={`Suggestion ${suggestionIndex + 1} of ${insightCount}`}>
              <button
                type="button"
                disabled={suggestionIndex <= 0}
                onClick={() => showSuggestion(suggestionIndex - 1)}
                aria-label="Previous suggestion"
              >
                ‹
              </button>
              <span>
                {suggestionIndex + 1} of {insightCount}
              </span>
              <button
                type="button"
                disabled={suggestionIndex >= insightCount - 1}
                onClick={() => showSuggestion(suggestionIndex + 1)}
                aria-label="Next suggestion"
              >
                ›
              </button>
            </div>
          )}
          <div className={styles.bubbleArrow} />
        </div>
      )}

      <button
        ref={mascotBtnRef}
        type="button"
        className={`${styles.mascotBtn} ${styles[activeState]} ${openChat ? styles.chatOpen : ""}`}
        onClick={() => {
          playMascotSound("click");
          toggleChat();
        }}
        onMouseEnter={() => playMascotSound("hover")}
        aria-label={openChat ? `Close ${roleLabel.toLowerCase()} assistant` : `Open ${roleLabel.toLowerCase()} assistant`}
      >
        <svg viewBox="0 0 100 100" className={styles.mascotSvg} xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="screenGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#2563eb" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#1e3a8a" stopOpacity="0" />
            </radialGradient>
            <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
              <feDropShadow dx="0" dy="4" stdDeviation="3" floodColor="#000" floodOpacity="0.2" />
            </filter>
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

          <ellipse cx={42 + eyeOffset.x} cy={39 + eyeOffset.y} rx="5" ry="7" className={`${styles.eye} ${styles.leftEye}`} />
          <ellipse cx={58 + eyeOffset.x} cy={39 + eyeOffset.y} rx="5" ry="7" className={`${styles.eye} ${styles.rightEye}`} />

          <line x1="50" y1="18" x2="50" y2="10" strokeWidth="3" strokeLinecap="round" className={styles.antennaStem} />
          <circle cx="50" cy="8" r="4" className={styles.antennaTip} />
        </svg>
      </button>
    </div>
  );
}

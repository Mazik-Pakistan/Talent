"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { toast } from "react-toastify";
import { getDashboardSummary, getReadyForConversion } from "@/services/authService";
import styles from "./RecruiterMascot.module.css";

const PRIORITY = {
  ERROR: 5,
  NOTIFICATION: 4,
  SUCCESS: 3,
  SUGGESTION: 2,
  IDLE_TIP: 1,
  NONE: 0,
};

const BUBBLE_TIMEOUT_MS = 6000;
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
  return Array.from(document.querySelectorAll("form")).filter((form) => form.offsetParent !== null);
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

function formatNotificationText(notifications) {
  const unread = (notifications || []).filter((n) => !n.read);
  if (!unread.length) return null;
  const latest = unread[0];
  const title = latest.title?.trim();
  const message = latest.message?.trim();
  if (title && message) return `${title}: ${message.slice(0, 100)}`;
  if (message) return message.slice(0, 120);
  if (title) return title;
  return null;
}

function buildPageSuggestions(path, stats) {
  if (path.includes("/overview")) {
    return [
      stats.pendingApprovals > 0
        ? `${stats.pendingApprovals} approval${stats.pendingApprovals > 1 ? "s" : ""} need attention.`
        : null,
      stats.readyCandidates > 0
        ? `${stats.readyCandidates} candidate${stats.readyCandidates > 1 ? "s are" : " is"} ready for activation.`
        : null,
      "Welcome to your recruiter overview.",
      "Review recent recruiter activities.",
      "Check the notification bell for updates.",
    ].filter(Boolean);
  }

  if (path.includes("/candidates")) {
    return [
      stats.readyCandidates > 0
        ? `${stats.readyCandidates} candidate${stats.readyCandidates > 1 ? "s are" : " is"} ready for activation.`
        : null,
      "Track candidate onboarding progress.",
      "Review signed offers awaiting activation.",
      "Filter candidates by onboarding stage.",
    ].filter(Boolean);
  }

  if (path.includes("/invite")) {
    return [
      "Fill in candidate details to send an invite.",
      "Pick designation and department from org lists.",
      "Set an expiry date before sending.",
    ];
  }

  if (path.includes("/employees")) {
    return [
      "Browse the active employee directory.",
      "Search employees from the top bar.",
      "Open a profile to manage assets and orientation.",
    ];
  }

  if (path.includes("/learning")) {
    return [
      "Assign corporate learning paths to roles.",
      "Review role skill requirements.",
      "Add certifications to keep teams current.",
    ];
  }

  if (path.includes("/talent")) {
    return [
      "Review skill match analytics.",
      "Post internal opportunities for talent mapping.",
      "Compare candidate skills against open roles.",
    ];
  }

  if (path.includes("/announcements")) {
    return [
      "Create a new announcement for your teams.",
      "Broadcast updates to employees and candidates.",
      "Review past announcements for reference.",
    ];
  }

  if (path.includes("/activity")) {
    return [
      "Review recent system activity logs.",
      "Track recruiter actions across the platform.",
      "Use logs to audit invitation and offer events.",
    ];
  }

  if (path.includes("/profile")) {
    return [
      "Keep your profile info current.",
      "Update your contact details and photo.",
      "Review your recruiter account settings.",
    ];
  }

  return ["Need assistance? Click me to chat!"];
}

function buildIdleTips(path, stats) {
  if (path.includes("/overview")) {
    return [
      "Review pending approvals when you have a moment.",
      "Check candidates ready for activation.",
      "Glance at recent recruiter activity.",
      stats.pendingApprovals > 0 ? "Approvals are waiting on your review." : null,
    ].filter(Boolean);
  }

  if (path.includes("/candidates")) {
    return [
      "Track onboarding progress for active candidates.",
      stats.readyCandidates > 0 ? "Some candidates are ready to activate." : null,
      "Review offer status from the candidates list.",
      "Follow up on incomplete candidate profiles.",
    ].filter(Boolean);
  }

  if (path.includes("/invite")) {
    return [
      "Complete the invite form when you're ready.",
      "Double-check designation and department selections.",
      "Set a sensible expiry for new invitations.",
    ];
  }

  if (path.includes("/employees")) {
    return [
      "Review today's new employees.",
      "Search the directory from the top bar.",
      "Open employee profiles to manage onboarding.",
    ];
  }

  if (path.includes("/learning")) {
    return [
      "Learning assignments are available.",
      "Review role-based skill requirements.",
      "Add certifications to learning paths.",
    ];
  }

  if (path.includes("/talent")) {
    return [
      "Review skill match analytics.",
      "Explore internal talent opportunities.",
      "Map skills to open roles.",
    ];
  }

  if (path.includes("/announcements")) {
    return [
      "Create a new announcement.",
      "Share updates with your teams.",
      "Review recent broadcasts.",
    ];
  }

  if (path.includes("/activity")) {
    return [
      "Review recruiter activity logs.",
      "Audit recent platform events.",
      "Check invitation and offer history.",
    ];
  }

  if (path.includes("/profile")) {
    return [
      "Keep profile info current.",
      "Update your photo and contact details.",
      "Review account settings.",
    ];
  }

  return ["Click me if you need help."];
}

function pickFromPool(pool, lastPick) {
  if (!pool.length) return null;
  let candidates = pool.filter((item) => item !== lastPick);
  if (!candidates.length) candidates = pool;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export default function RecruiterMascot({ openChat, toggleChat }) {
  const pathname = usePathname();
  const [activeState, setActiveState] = useState("stateIdle");
  const [bubbleText, setBubbleText] = useState("");
  const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 });

  const bubbleTimerRef = useRef(null);
  const cooldownTimerRef = useRef(null);
  const idleTimerRef = useRef(null);
  const stateTimerRef = useRef(null);
  const lastUnreadCountRef = useRef(null);
  const lastMessageKeyRef = useRef(null);
  const lastIdleMessageRef = useRef(null);
  const lastPageSuggestionRef = useRef(null);
  const bubbleRef = useRef({ text: "", priority: PRIORITY.NONE });
  const cooldownActiveRef = useRef(false);
  const highlightedTargetRef = useRef(null);
  const mascotBtnRef = useRef(null);
  const statsRef = useRef({ pendingApprovals: 0, readyCandidates: 0 });

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

  const dismissBubble = useCallback((maxPriority = PRIORITY.NONE) => {
    const prevPriority = bubbleRef.current.priority;
    if (prevPriority > maxPriority) return;
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    bubbleRef.current = { text: "", priority: PRIORITY.NONE };
    setBubbleText("");
    if (prevPriority <= PRIORITY.SUGGESTION) {
      lastMessageKeyRef.current = null;
    }
  }, []);

  const setMessage = useCallback(
    (text, priority, messageKey, options = {}) => {
      const { bypassCooldown = false, force = false, animation = null, highlightField: field = null } = options;
      if (!text) return false;

      const current = bubbleRef.current;
      const sameKey = messageKey && messageKey === lastMessageKeyRef.current;

      if (!force && sameKey && priority <= PRIORITY.SUGGESTION) {
        return false;
      }

      if (!force && current.text && priority < current.priority) {
        return false;
      }

      if (!bypassCooldown && cooldownActiveRef.current && priority <= PRIORITY.SUGGESTION) {
        return false;
      }

      lastMessageKeyRef.current = messageKey;
      bubbleRef.current = { text, priority };
      setBubbleText(text);

      if (field) {
        highlightField(field);
      }

      if (animation) {
        triggerState(animation, priority >= PRIORITY.ERROR ? 3000 : 2500);
      }

      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
      bubbleTimerRef.current = setTimeout(() => {
        if (bubbleRef.current.text === text) {
          bubbleRef.current = { text: "", priority: PRIORITY.NONE };
          setBubbleText("");
          clearFieldHighlight();
          if (priority <= PRIORITY.SUGGESTION) {
            lastMessageKeyRef.current = null;
          }
          startCooldown();
        }
      }, BUBBLE_TIMEOUT_MS);

      return true;
    },
    [clearFieldHighlight, highlightField, startCooldown, triggerState]
  );

  const fetchOverviewStats = useCallback(async () => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    try {
      const [summary, ready] = await Promise.all([
        getDashboardSummary(token).catch(() => null),
        getReadyForConversion(token).catch(() => null),
      ]);
      statsRef.current = {
        pendingApprovals: summary?.pending_approvals?.length || 0,
        readyCandidates: ready?.candidates?.length || 0,
      };
    } catch {
      // Non-critical
    }
  }, []);

  const refreshFormGuidance = useCallback(
    (options = {}) => {
      const { force = false, animation = "statePoint" } = options;
      const guidance = getFormGuidance();
      if (!guidance) {
        clearFieldHighlight();
        if (lastMessageKeyRef.current?.startsWith("form:")) {
          dismissBubble(PRIORITY.SUGGESTION);
        }
        return;
      }

      if (guidance.type === "missing") {
        highlightField(guidance.field);
        const keyChanged = lastMessageKeyRef.current !== guidance.key;
        setMessage(guidance.text, PRIORITY.SUGGESTION, guidance.key, {
          force: force || keyChanged,
          animation,
          highlightField: guidance.field,
          bypassCooldown: keyChanged,
        });
        return;
      }

      if (guidance.type === "complete") {
        clearFieldHighlight();
        setMessage(guidance.text, PRIORITY.SUGGESTION, guidance.key, {
          force,
          animation: "stateHappy",
          bypassCooldown: true,
        });
      }
    },
    [clearFieldHighlight, dismissBubble, setMessage]
  );

  const showPageSuggestion = useCallback(
    (force = false) => {
      const path = pathname || "";
      const formGuidance = getFormGuidance();
      if (formGuidance?.type === "missing") {
        refreshFormGuidance({ force: true, animation: "stateWave" });
        return;
      }

      const pool = buildPageSuggestions(path, statsRef.current);
      const pick = pickFromPool(pool, lastPageSuggestionRef.current) || pool[0];
      lastPageSuggestionRef.current = pick;
      setMessage(pick, PRIORITY.SUGGESTION, `page:${pick}`, {
        force,
        bypassCooldown: true,
        animation: "stateWave",
      });
    },
    [pathname, refreshFormGuidance, setMessage]
  );

  const showIdleTip = useCallback(() => {
    if (cooldownActiveRef.current) return;
    const path = pathname || "";
    const pool = buildIdleTips(path, statsRef.current);
    const pick = pickFromPool(pool, lastIdleMessageRef.current) || pool[0];
    lastIdleMessageRef.current = pick;
    triggerState("stateBlink", 2000);
    setMessage(pick, PRIORITY.IDLE_TIP, `idle:${pick}`, { animation: "stateBlink" });
  }, [pathname, setMessage, triggerState]);

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(showIdleTip, IDLE_TIMEOUT_MS);
  }, [showIdleTip]);

  useEffect(() => {
    if (!pathname?.includes("/dashboard/recruiter")) return;

    if (pathname.includes("/overview") || pathname.includes("/candidates")) {
      fetchOverviewStats();
    }

    lastMessageKeyRef.current = null;
    lastPageSuggestionRef.current = null;
    clearFieldHighlight();
    resetIdleTimer();
    triggerState("stateWave", 2500);

    const timer = setTimeout(() => {
      showPageSuggestion(true);
    }, 800);

    return () => clearTimeout(timer);
  }, [
    pathname,
    fetchOverviewStats,
    showPageSuggestion,
    triggerState,
    resetIdleTimer,
    clearFieldHighlight,
  ]);

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
  }, [resetIdleTimer, clearFieldHighlight]);

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
        setMessage(guidance.text, PRIORITY.ERROR, `${guidance.key}:invalid`, {
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
        setMessage(text, PRIORITY.SUCCESS, `toast:success:${text}`, {
          force: true,
          bypassCooldown: true,
        });
      } else if (type === "error" || type === "warning") {
        triggerState("stateWarning", 3000);
        setMessage(text, PRIORITY.ERROR, `toast:error:${text}`, {
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
      setMessage(message, PRIORITY.SUCCESS, `event:success:${message}`, {
        force: true,
        bypassCooldown: true,
      });
    };

    const handleFormError = (e) => {
      const message = e.detail?.message || "Form validation failed.";
      triggerState("stateWarning", 3500);
      setMessage(message, PRIORITY.ERROR, `event:error:${message}`, {
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
  }, [clearFieldHighlight, setMessage, triggerState]);

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
          setMessage(text, PRIORITY.NOTIFICATION, `notif:${latest?.id || text}`, {
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
      {bubbleText && (
        <div className={styles.speechBubble} role="alert" aria-live="polite">
          <p className={styles.bubbleText}>{bubbleText}</p>
          <button
            type="button"
            className={styles.closeBubbleBtn}
            onClick={() => {
              bubbleRef.current = { text: "", priority: PRIORITY.NONE };
              setBubbleText("");
              lastMessageKeyRef.current = null;
              clearFieldHighlight();
              if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
            }}
            aria-label="Dismiss message"
          >
            &times;
          </button>
          <div className={styles.bubbleArrow} />
        </div>
      )}

      <button
        ref={mascotBtnRef}
        type="button"
        className={`${styles.mascotBtn} ${styles[activeState]} ${openChat ? styles.chatOpen : ""}`}
        onClick={toggleChat}
        aria-label={openChat ? "Close recruitment assistant" : "Open recruitment assistant"}
      >
        <svg
          viewBox="0 0 100 100"
          className={styles.mascotSvg}
          xmlns="http://www.w3.org/2000/svg"
        >
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

          <path
            d="M 38 65 Q 50 78 62 65 Q 50 68 38 65 Z"
            className={styles.bodyBase}
            filter="url(#shadow)"
          />
          <path d="M 45 68 L 55 68 L 50 78 Z" className={styles.bodyThruster} />

          <rect x="46" y="54" width="8" height="8" rx="2" className={styles.robotNeck} />

          <path
            d="M 28 50 C 18 50 14 38 16 32 C 18 30 20 34 20 38 C 20 44 26 46 28 46 Z"
            className={styles.leftArm}
          />

          <path
            d="M 72 50 C 82 50 86 44 84 38 C 82 36 80 40 80 44 C 80 46 74 46 72 46 Z"
            className={styles.rightArm}
          />

          <rect
            x="24"
            y="18"
            width="52"
            height="42"
            rx="16"
            className={styles.headShell}
            filter="url(#shadow)"
          />

          <rect x="28" y="22" width="44" height="34" rx="12" className={styles.faceScreen} />

          <rect
            x="28"
            y="22"
            width="44"
            height="34"
            rx="12"
            fill="url(#screenGlow)"
            pointerEvents="none"
          />

          <ellipse
            cx={42 + eyeOffset.x}
            cy={39 + eyeOffset.y}
            rx="5"
            ry="7"
            className={`${styles.eye} ${styles.leftEye}`}
          />
          <ellipse
            cx={58 + eyeOffset.x}
            cy={39 + eyeOffset.y}
            rx="5"
            ry="7"
            className={`${styles.eye} ${styles.rightEye}`}
          />

          <line
            x1="50"
            y1="18"
            x2="50"
            y2="10"
            strokeWidth="3"
            strokeLinecap="round"
            className={styles.antennaStem}
          />
          <circle cx="50" cy="8" r="4" className={styles.antennaTip} />
        </svg>
      </button>
    </div>
  );
}

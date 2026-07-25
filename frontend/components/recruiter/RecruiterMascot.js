"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { toast } from "react-toastify";
import { getDashboardSummary, getReadyForConversion } from "@/services/authService";
import styles from "./RecruiterMascot.module.css";

// Severity categories for Priority System
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

export default function RecruiterMascot({ openChat, toggleChat }) {
  const pathname = usePathname();
  const [activeState, setActiveState] = useState("stateIdle");
  const [bubbleText, setBubbleText] = useState("");
  const [bubblePriority, setBubblePriority] = useState(PRIORITY.NONE);
  const [cooldownActive, setCooldownActive] = useState(false);
  const [stats, setStats] = useState({ pendingApprovals: 0, readyCandidates: 0 });

  // Refs for tracking timers and states across renders
  const bubbleTimerRef = useRef(null);
  const cooldownTimerRef = useRef(null);
  const idleTimerRef = useRef(null);
  const stateTimerRef = useRef(null);
  const lastUnreadCountRef = useRef(null);

  // Fetch quick metrics for dynamic suggestion text (only on Overview and Candidates pages)
  const fetchOverviewStats = useCallback(async () => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    try {
      // Run concurrent requests
      const [summary, ready] = await Promise.all([
        getDashboardSummary(token).catch(() => null),
        getReadyForConversion(token).catch(() => null),
      ]);
      const pendingApprovalsCount = summary?.pending_approvals?.length || 0;
      const readyCandidatesCount = ready?.candidates?.length || 0;
      setStats({
        pendingApprovals: pendingApprovalsCount,
        readyCandidates: readyCandidatesCount,
      });
    } catch {
      // Silence network errors to avoid breaking layout
    }
  }, []);

  // Map pages to suggestions and idle messages
  const getContextualTip = useCallback((type) => {
    const isIdle = type === "idle";
    const path = pathname || "";

    if (path.includes("/overview")) {
      if (stats.pendingApprovals > 0) {
        return {
          text: `${stats.pendingApprovals} approval${stats.pendingApprovals > 1 ? "s" : ""} need attention.`,
          priority: isIdle ? PRIORITY.IDLE_TIP : PRIORITY.SUGGESTION,
        };
      }
      if (stats.readyCandidates > 0) {
        return {
          text: `${stats.readyCandidates} candidate${stats.readyCandidates > 1 ? "s are" : " is"} ready for activation.`,
          priority: isIdle ? PRIORITY.IDLE_TIP : PRIORITY.SUGGESTION,
        };
      }
      return {
        text: isIdle ? "Review recent recruiter activities." : "Welcome to the recruiter overview.",
        priority: isIdle ? PRIORITY.IDLE_TIP : PRIORITY.SUGGESTION,
      };
    }

    if (path.includes("/candidates")) {
      if (stats.readyCandidates > 0) {
        return {
          text: `${stats.readyCandidates} candidate${stats.readyCandidates > 1 ? "s are" : " is"} ready for activation.`,
          priority: isIdle ? PRIORITY.IDLE_TIP : PRIORITY.SUGGESTION,
        };
      }
      return {
        text: isIdle ? "Track candidate onboarding progress." : "One candidate is ready for activation.",
        priority: isIdle ? PRIORITY.IDLE_TIP : PRIORITY.SUGGESTION,
      };
    }

    if (path.includes("/invite")) {
      return {
        text: isIdle ? "Complete the invite form." : "Department and Designation are required.",
        priority: isIdle ? PRIORITY.IDLE_TIP : PRIORITY.SUGGESTION,
      };
    }

    if (path.includes("/employees")) {
      return {
        text: isIdle ? "Review today's new employees." : "Manage active employee directory.",
        priority: isIdle ? PRIORITY.IDLE_TIP : PRIORITY.SUGGESTION,
      };
    }

    if (path.includes("/learning")) {
      return {
        text: isIdle ? "Learning assignments are available." : "Assign corporate learning paths.",
        priority: isIdle ? PRIORITY.IDLE_TIP : PRIORITY.SUGGESTION,
      };
    }

    if (path.includes("/talent")) {
      return {
        text: isIdle ? "Review skill match analytics." : "Optimize talent mapping.",
        priority: isIdle ? PRIORITY.IDLE_TIP : PRIORITY.SUGGESTION,
      };
    }

    if (path.includes("/announcements")) {
      return {
        text: isIdle ? "Create a new announcement." : "Broadcast announcements to your teams.",
        priority: isIdle ? PRIORITY.IDLE_TIP : PRIORITY.SUGGESTION,
      };
    }

    if (path.includes("/activity")) {
      return {
        text: isIdle ? "Review recruiter logs." : "Review recent system activity logs.",
        priority: isIdle ? PRIORITY.IDLE_TIP : PRIORITY.SUGGESTION,
      };
    }

    if (path.includes("/profile")) {
      return {
        text: isIdle ? "Keep profile info current." : "Update your profile details.",
        priority: isIdle ? PRIORITY.IDLE_TIP : PRIORITY.SUGGESTION,
      };
    }

    return {
      text: "Need assistance? Click me to chat!",
      priority: PRIORITY.SUGGESTION,
    };
  }, [pathname, stats]);

  // Main Speech Bubble Trigger with Priority System & Cooldown
  const showBubble = useCallback((text, priority, bypassCooldown = false) => {
    if (!text) return;

    // Reject message if another higher priority message is active
    if (bubbleText && priority < bubblePriority) {
      return;
    }

    // Reject if cooldown is active (unless bypassed by critical events like error/success/notif)
    if (cooldownActive && !bypassCooldown && priority <= PRIORITY.SUGGESTION) {
      return;
    }

    // Set bubble content
    setBubbleText(text);
    setBubblePriority(priority);

    // Set auto-dismiss timer
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    bubbleTimerRef.current = setTimeout(() => {
      setBubbleText("");
      setBubblePriority(PRIORITY.NONE);

      // Start cooldown phase
      setCooldownActive(true);
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = setTimeout(() => {
        setCooldownActive(false);
      }, COOLDOWN_MS);
    }, BUBBLE_TIMEOUT_MS);
  }, [bubbleText, bubblePriority, cooldownActive]);

  // Handle temporary Mascot Animation States
  const triggerState = useCallback((stateName, duration = 3000) => {
    setActiveState(stateName);
    if (stateTimerRef.current) clearTimeout(stateTimerRef.current);
    stateTimerRef.current = setTimeout(() => {
      setActiveState("stateIdle");
    }, duration);
  }, []);

  // Idle Timer Reset and Management
  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      // Trigger idle mascot animation and display idle message
      triggerState("stateBlink", 2000);
      const tip = getContextualTip("idle");
      showBubble(tip.text, tip.priority, false);
    }, IDLE_TIMEOUT_MS);
  }, [getContextualTip, showBubble, triggerState]);

  // Fetch stats and trigger greeting on page changes
  useEffect(() => {
    if (pathname?.includes("/dashboard/recruiter")) {
      if (pathname.includes("/overview") || pathname.includes("/candidates")) {
        fetchOverviewStats();
      }
      resetIdleTimer();

      // Trigger standard entrance animation (Wave) and suggestion
      triggerState("stateWave", 2500);
      const tip = getContextualTip("suggestion");
      // Add a tiny delay to ensure transition doesn't clash with route loading
      const timer = setTimeout(() => {
        showBubble(tip.text, tip.priority, true);
      }, 800);

      return () => clearTimeout(timer);
    }
  }, [pathname, fetchOverviewStats, getContextualTip, showBubble, triggerState, resetIdleTimer]);

  // 1. Observe general user activity for idle detection
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
    };
  }, [resetIdleTimer]);

  // 2. Observe Forms (Started, Submitted, Success, Failures)
  useEffect(() => {
    // A. Form focus: triggers "Thinking"
    const handleFocus = (e) => {
      if (e.target.closest("form")) {
        triggerState("stateThinking", 4000);
        resetIdleTimer();
      }
    };

    // B. Form submission: triggers "Thinking"
    const handleSubmit = (e) => {
      if (e.target.closest("form")) {
        triggerState("stateThinking", 5000);
        resetIdleTimer();
      }
    };

    // C. Form validation invalid inputs (bubbles on window, captured in capture phase)
    const handleInvalid = (e) => {
      const field = e.target;
      if (field.closest("form")) {
        triggerState("stateWarning", 3000);
        let fieldLabel = field.name || "field";
        if (fieldLabel === "department") {
          showBubble("Department is still missing.", PRIORITY.ERROR, true);
        } else if (fieldLabel === "job_title") {
          showBubble("Designation is still missing.", PRIORITY.ERROR, true);
        } else {
          showBubble(`Required field is missing or invalid.`, PRIORITY.ERROR, true);
        }
        resetIdleTimer();
      }
    };

    window.addEventListener("focusin", handleFocus);
    window.addEventListener("submit", handleSubmit);
    window.addEventListener("invalid", handleInvalid, true); // useCapture = true

    return () => {
      window.removeEventListener("focusin", handleFocus);
      window.removeEventListener("submit", handleSubmit);
      window.removeEventListener("invalid", handleInvalid, true);
    };
  }, [triggerState, showBubble, resetIdleTimer]);

  // 3. Observe Global Toast Notifications (Form success, errors)
  useEffect(() => {
    const unsubscribe = toast.onChange((payload) => {
      if (payload.status === "added" || payload.status === "updated") {
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
          // Highlight successful event
          triggerState("stateCelebrate", 3000);
          showBubble(text, PRIORITY.SUCCESS, true);
        } else if (type === "error" || type === "warning") {
          // Highlight errors
          triggerState("stateWarning", 3000);
          showBubble(text, PRIORITY.ERROR, true);
        }
      }
    });

    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [triggerState, showBubble]);

  // 4. Observe Custom Success Event from invite/announcement pages (bypasses toast check)
  useEffect(() => {
    const handleFormSuccess = (e) => {
      const message = e.detail?.message || "Action successful!";
      triggerState("stateCelebrate", 3500);
      showBubble(message, PRIORITY.SUCCESS, true);
    };

    const handleFormError = (e) => {
      const message = e.detail?.message || "Form validation failed.";
      triggerState("stateWarning", 3500);
      showBubble(message, PRIORITY.ERROR, true);
    };

    window.addEventListener("talent-form-success", handleFormSuccess);
    window.addEventListener("talent-form-error", handleFormError);

    return () => {
      window.removeEventListener("talent-form-success", handleFormSuccess);
      window.removeEventListener("talent-form-error", handleFormError);
    };
  }, [triggerState, showBubble]);

  // 5. Observe Custom Shell Notifications update
  useEffect(() => {
    const handleShellNotifications = (e) => {
      const { unreadCount, notifications } = e.detail || {};
      if (unreadCount === undefined) return;

      const previous = lastUnreadCountRef.current;
      lastUnreadCountRef.current = unreadCount;

      // React only if unread count has increased
      if (previous !== null && unreadCount > previous) {
        triggerState("stateNotification", 4000);
        showBubble(
          `You received new notifications.`,
          PRIORITY.NOTIFICATION,
          true
        );
      }
    };

    window.addEventListener("talent-notifications-updated", handleShellNotifications);
    return () => {
      window.removeEventListener("talent-notifications-updated", handleShellNotifications);
    };
  }, [triggerState, showBubble]);

  return (
    <div className={styles.mascotWrapper}>
      {/* Speech Bubble */}
      {bubbleText && (
        <div className={styles.speechBubble} role="alert" aria-live="polite">
          <p className={styles.bubbleText}>{bubbleText}</p>
          <button
            type="button"
            className={styles.closeBubbleBtn}
            onClick={() => {
              setBubbleText("");
              setBubblePriority(PRIORITY.NONE);
            }}
            aria-label="Dismiss message"
          >
            &times;
          </button>
          <div className={styles.bubbleArrow} />
        </div>
      )}

      {/* Mascot SVG Button */}
      <button
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

          {/* Engine Glow Thruster */}
          <ellipse
            cx="50"
            cy="84"
            rx="12"
            ry="4"
            className={styles.thrusterGlow}
          />

          {/* Robotic Body / Base */}
          <path
            d="M 38 65 Q 50 78 62 65 Q 50 68 38 65 Z"
            className={styles.bodyBase}
            filter="url(#shadow)"
          />
          <path
            d="M 45 68 L 55 68 L 50 78 Z"
            className={styles.bodyThruster}
          />

          {/* Connective Neck */}
          <rect
            x="46"
            y="54"
            width="8"
            height="8"
            rx="2"
            className={styles.robotNeck}
          />

          {/* Waving/Interactive Left Arm */}
          <path
            d="M 28 50 C 18 50 14 38 16 32 C 18 30 20 34 20 38 C 20 44 26 46 28 46 Z"
            className={styles.leftArm}
          />

          {/* Right Arm */}
          <path
            d="M 72 50 C 82 50 86 44 84 38 C 82 36 80 40 80 44 C 80 46 74 46 72 46 Z"
            className={styles.rightArm}
          />

          {/* Main Head Outer Shell */}
          <rect
            x="24"
            y="18"
            width="52"
            height="42"
            rx="16"
            className={styles.headShell}
            filter="url(#shadow)"
          />

          {/* Face Screen Frame */}
          <rect
            x="28"
            y="22"
            width="44"
            height="34"
            rx="12"
            className={styles.faceScreen}
          />

          {/* Screen Light Effect */}
          <rect
            x="28"
            y="22"
            width="44"
            height="34"
            rx="12"
            fill="url(#screenGlow)"
            pointerEvents="none"
          />

          {/* Digital Eyes */}
          {/* Left Eye */}
          <ellipse
            cx="42"
            cy="39"
            rx="5"
            ry="7"
            className={`${styles.eye} ${styles.leftEye}`}
          />
          {/* Right Eye */}
          <ellipse
            cx="58"
            cy="39"
            rx="5"
            ry="7"
            className={`${styles.eye} ${styles.rightEye}`}
          />

          {/* Antenna */}
          <line
            x1="50"
            y1="18"
            x2="50"
            y2="10"
            strokeWidth="3"
            strokeLinecap="round"
            className={styles.antennaStem}
          />
          <circle
            cx="50"
            cy="8"
            r="4"
            className={styles.antennaTip}
          />
        </svg>
      </button>
    </div>
  );
}

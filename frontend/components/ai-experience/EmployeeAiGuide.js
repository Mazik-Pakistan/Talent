"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { buildEmployeeInsights, INSIGHTS_REFRESH_EVENT } from "@/lib/ai/employeeInsights";
import { fieldHelpFor, hoverHelpFor } from "@/lib/ai/fieldHelp";
import {
  COPILOT_AUTOSAVE_EVENT,
  COPILOT_CONTEXT_EVENT,
  COPILOT_FOCUS_EVENT,
  COPILOT_HOVER_EVENT,
  COPILOT_NOTIFY_EVENT,
  COPILOT_PRIORITY,
  COPILOT_VALIDATION_EVENT,
  clearGuideContext,
  readGuideContext,
  readGuideMinimized,
  writeGuideMinimized,
} from "@/lib/ai/guideContext";
import { IconAlert, IconCheck, IconChevronLeft, IconChevronRight, IconSparkle } from "./icons";
import styles from "./EmployeeAiGuide.module.css";

const INCLUDED_PREFIXES = ["/dashboard/employee", "/documents"];
const SEEN_KEY = "employee_ai_copilot_seen_tips";
const WAVE_MS = 2400;

function readSeenTips() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function writeSeenTips(set) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...set].slice(-80)));
  } catch {
    // ignore
  }
}

function historyToneClass(kind, tone) {
  if (tone === "warn" || kind === "validation") return styles.bubbleQuietWarn;
  if (kind === "autosave" || kind === "assist") return styles.bubbleQuietOk;
  return "";
}

/**
 * Employee AI Copilot — global contextual partner (NOT the autonomous Agent).
 *
 * Mounted once from the root layout so it never unmounts during employee
 * routing. Strictly read-only: it explains what's on screen and surfaces
 * tips/notifications. It never types into fields, fills forms, switches
 * tabs, or takes any action on the employee's behalf — that's the separate,
 * explicitly-invoked Agent.
 */
export default function EmployeeAiGuide() {
  const pathname = usePathname();
  const router = useRouter();

  const [minimized, setMinimized] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [ready, setReady] = useState(false);
  const [insights, setInsights] = useState([]);
  const [index, setIndex] = useState(0);
  const [section, setSection] = useState(null);
  const [pageContext, setPageContext] = useState(null);
  const [focusHint, setFocusHint] = useState(null);
  const [hoverHint, setHoverHint] = useState(null);
  const [flash, setFlash] = useState(null);
  const [history, setHistory] = useState([]);
  const [contextTick, setContextTick] = useState(0);
  const [statusLine, setStatusLine] = useState(null);
  const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 });
  const [waving, setWaving] = useState(false);

  const historyIdsRef = useRef(new Set());
  const seenTipsRef = useRef(null);
  const pageTipKeysRef = useRef([]);
  const mascotBtnRef = useRef(null);
  const waveTimerRef = useRef(null);
  const eligible = INCLUDED_PREFIXES.some((prefix) => pathname?.startsWith(prefix));

  function appendHistory(entry) {
    // Quiet log — no page tips, focus/hover noise, or intermediate "busy" lines.
    if (!entry?.message) return;
    if (entry.kind === "page" || entry.kind === "focus" || entry.kind === "hover" || entry.kind === "busy") {
      return;
    }
    const id = entry.id || `${entry.kind || "note"}-${entry.message.slice(0, 40)}-${entry.at || Date.now()}`;
    if (historyIdsRef.current.has(id)) return;
    historyIdsRef.current.add(id);
    setHistory((prev) => [{ id, at: Date.now(), ...entry }, ...prev].slice(0, 3));
  }

  // Fresh page = fresh status/history (don't carry Documents noise to Learning).
  useEffect(() => {
    setStatusLine(null);
    setHistory([]);
    historyIdsRef.current = new Set();

    setWaving(true);
    if (waveTimerRef.current) clearTimeout(waveTimerRef.current);
    waveTimerRef.current = setTimeout(() => setWaving(false), WAVE_MS);
    return () => {
      if (waveTimerRef.current) clearTimeout(waveTimerRef.current);
    };
  }, [pathname]);

  // Eyes track the cursor, like the recruiter mascot.
  useEffect(() => {
    let rafId = null;
    const handleMouseMove = (event) => {
      if (!mascotBtnRef.current || rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const rect = mascotBtnRef.current.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 3;
        const dx = Math.max(-3, Math.min(3, (event.clientX - cx) / 40));
        const dy = Math.max(-2, Math.min(2, (event.clientY - cy) / 40));
        setEyeOffset({ x: dx, y: dy });
      });
    };
    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  // Persist open/minimized — default open, never auto-minimise.
  useEffect(() => {
    setMinimized(readGuideMinimized());
    setHydrated(true);
  }, []);

  // Page context from publishers (tabs, steps, progress…).
  useEffect(() => {
    if (!eligible) {
      clearGuideContext();
      setPageContext(null);
      setSection(null);
      return undefined;
    }

    const apply = (detail) => {
      setPageContext(detail);
      setSection(detail?.section || null);
      setContextTick((n) => n + 1);
    };

    const existing = readGuideContext();
    if (existing) apply(existing);

    const onContext = (event) => apply(event.detail);
    window.addEventListener(COPILOT_CONTEXT_EVENT, onContext);
    return () => window.removeEventListener(COPILOT_CONTEXT_EVENT, onContext);
  }, [pathname, eligible]);

  // Focus / hover / autosave / validation / notifications — live signals.
  useEffect(() => {
    if (!eligible) return undefined;

    const onFocus = (event) => {
      const detail = event.detail;
      if (!detail) {
        setFocusHint(null);
        return;
      }
      const message = detail.message || fieldHelpFor(detail.path, detail.label);
      if (!message) return;
      setFocusHint({ id: `focus-${detail.path || detail.label}`, message, priority: COPILOT_PRIORITY.task });
      setIndex(0);
    };

    const onHover = (event) => {
      const detail = event.detail;
      if (!detail) {
        setHoverHint(null);
        return;
      }
      const message = detail.message || hoverHelpFor(detail.key || detail.target);
      if (!message) return;
      setHoverHint({ id: `hover-${detail.key}`, message, priority: COPILOT_PRIORITY.tip });
    };

    const onAutosave = (event) => {
      const detail = event.detail || {};
      const message = detail.message || "✓ Progress saved";
      setFlash({ id: `save-${Date.now()}`, message, tone: "ok", priority: COPILOT_PRIORITY.unsaved });
      appendHistory({ kind: "autosave", message });
      window.setTimeout(() => setFlash((current) => (current?.message === message ? null : current)), 3200);
    };

    const onValidation = (event) => {
      const detail = event.detail || {};
      if (!detail.message) return;
      const entry = {
        id: `val-${detail.path || detail.message}`,
        message: detail.message,
        tone: detail.ok ? "ok" : "warn",
        priority: detail.ok ? COPILOT_PRIORITY.tip : COPILOT_PRIORITY.validation,
      };
      setFlash(entry);
      appendHistory({ kind: "validation", ...entry });
    };

    const onNotify = (event) => {
      const detail = event.detail || {};
      if (!detail.message) return;
      const entry = {
        id: `notify-${detail.id || detail.message}`,
        message: detail.message,
        tone: "info",
        priority: COPILOT_PRIORITY.notification,
      };
      setFlash(entry);
      appendHistory({ kind: "notification", ...entry });
    };

    window.addEventListener(COPILOT_FOCUS_EVENT, onFocus);
    window.addEventListener(COPILOT_HOVER_EVENT, onHover);
    window.addEventListener(COPILOT_AUTOSAVE_EVENT, onAutosave);
    window.addEventListener(COPILOT_VALIDATION_EVENT, onValidation);
    window.addEventListener(COPILOT_NOTIFY_EVENT, onNotify);

    return () => {
      window.removeEventListener(COPILOT_FOCUS_EVENT, onFocus);
      window.removeEventListener(COPILOT_HOVER_EVENT, onHover);
      window.removeEventListener(COPILOT_AUTOSAVE_EVENT, onAutosave);
      window.removeEventListener(COPILOT_VALIDATION_EVENT, onValidation);
      window.removeEventListener(COPILOT_NOTIFY_EVENT, onNotify);
    };
  }, [eligible]);

  useEffect(() => {
    if (!eligible) return undefined;
    const onDataChanged = () => setContextTick((n) => n + 1);
    window.addEventListener(INSIGHTS_REFRESH_EVENT, onDataChanged);
    return () => window.removeEventListener(INSIGHTS_REFRESH_EVENT, onDataChanged);
  }, [eligible]);

  // Rebuild page insights — keep history; only refresh the live deck.
  useEffect(() => {
    if (!eligible) {
      setReady(false);
      return undefined;
    }

    let cancelled = false;
    const accessToken = localStorage.getItem("access_token");
    let user = null;
    try {
      user = JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      user = null;
    }

    if (!accessToken || user?.role !== "employee") {
      setReady(false);
      return undefined;
    }

    const live = pageContext || readGuideContext();
    const context = {
      section: live?.section || section,
      fields: live?.fields || [],
      hint: live?.hint || null,
      progress: live?.progress || null,
      mode: live?.mode || null,
      tab: live?.tab || null,
      firstName: (user.full_name || "").split(" ")[0],
    };

    const timer = setTimeout(() => {
      buildEmployeeInsights(pathname, accessToken, context)
        .then((next) => {
          if (cancelled) return;
          const deck = next?.length ? next : [{ id: "fallback", message: "I'm beside you on this page." }];
          setInsights(deck);
          setIndex(0);
          setReady(true);

          if (!seenTipsRef.current) seenTipsRef.current = readSeenTips();
          const tipKeys = deck.map((tip) => `${pathname}:${tip.id}`).filter(Boolean);
          pageTipKeysRef.current = tipKeys;
        })
        .catch(() => {
          if (cancelled) return;
          setInsights([{ id: "fallback", message: "I'm beside you on this page." }]);
          setReady(true);
        });
    }, 280);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (!seenTipsRef.current) seenTipsRef.current = readSeenTips();
      pageTipKeysRef.current.forEach((key) => seenTipsRef.current.add(key));
      writeSeenTips(seenTipsRef.current);
      pageTipKeysRef.current = [];
    };
  }, [pathname, eligible, section, contextTick, pageContext]);

  function minimize() {
    setMinimized(true);
    writeGuideMinimized(true);
  }

  function toggleOpen() {
    setMinimized((current) => {
      const next = !current;
      writeGuideMinimized(next);
      return next;
    });
  }

  // Stay mounted when ineligible — just hide UI so state survives brief exits.
  if (!hydrated || !eligible || !ready) return null;

  // Priority surface: focus > flash validation/notify > insights
  const deck = (() => {
    const items = [];
    if (focusHint) items.push(focusHint);
    if (flash) items.push(flash);
    if (hoverHint && !focusHint) items.push(hoverHint);
    items.push(...insights);
    return items;
  })();

  const current = deck[Math.min(index, Math.max(deck.length - 1, 0))] || deck[0];
  // Badge = how many things need attention (tip.count when set), not tip carousel length.
  const alertCount = insights.reduce(
    (sum, item) => (item.tone === "warn" ? sum + (Number(item.count) > 0 ? Number(item.count) : 1) : sum),
    0
  );
  const tipCount = insights.length;

  const isWarn = current?.tone === "warn";
  const isOk = flash?.tone === "ok" && !isWarn;
  const mascotState = waving ? "stateWave" : isWarn ? "stateWarn" : isOk ? "stateOk" : "stateIdle";
  const ariaLabel = alertCount
    ? `Employee Copilot — ${alertCount} to review`
    : tipCount
      ? `Employee Copilot — ${tipCount} tip${tipCount === 1 ? "" : "s"}`
      : "Employee Copilot";

  return (
    <div className={styles.wrapper}>
      {!minimized && current?.message ? (
        <div className={styles.speechBubble} role="status" aria-live="polite">
          <button
            type="button"
            className={styles.closeBubbleBtn}
            onClick={minimize}
            aria-label="Close Copilot"
            title="Close"
          >
            &times;
          </button>

          <div className={`${styles.bubbleLabel} ${isWarn ? styles.bubbleLabelWarn : ""}`}>
            {isWarn ? <IconAlert width={12} height={12} /> : <IconSparkle width={12} height={12} />}
            {isWarn ? "Needs your attention" : "For you"}
          </div>
          <p
            className={`${styles.bubbleMessage} ${isWarn ? styles.bubbleMessageWarn : ""}`}
            key={`${current?.id || "msg"}-${section || pathname}`}
          >
            {current.message}
          </p>

          {current?.actions?.length ? (
            <div className={styles.bubbleActions}>
              {current.actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  className={`${styles.bubbleAction} ${action.primary ? styles.bubbleActionPrimary : ""}`}
                  onClick={() => {
                    if (action.href) router.push(action.href);
                    else action.onClick?.();
                  }}
                >
                  {action.primary ? <IconSparkle width={11} height={11} /> : null}
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}

          {statusLine ? (
            <p className={styles.bubbleStatus} role="status">
              {statusLine}
            </p>
          ) : null}

          {deck.length > 1 ? (
            <div className={styles.bubblePager} aria-label={`Suggestion ${index + 1} of ${deck.length}`}>
              <button
                type="button"
                className={styles.bubblePagerBtn}
                disabled={index <= 0}
                onClick={() => setIndex((n) => Math.max(0, n - 1))}
                aria-label="Previous suggestion"
              >
                <IconChevronLeft width={13} height={13} />
              </button>
              <span className={styles.bubblePagerLabel}>
                {index + 1} of {deck.length}
              </span>
              <button
                type="button"
                className={styles.bubblePagerBtn}
                disabled={index >= deck.length - 1}
                onClick={() => setIndex((n) => Math.min(deck.length - 1, n + 1))}
                aria-label="Next suggestion"
              >
                <IconChevronRight width={13} height={13} />
              </button>
            </div>
          ) : null}

          {history.length > 0 && !statusLine ? (
            <details className={styles.bubbleHistory}>
              <summary>Recent activity</summary>
              <ul className={styles.bubbleQuietLog} aria-label="Recent activity">
                {history.slice(0, 2).map((item) => (
                  <li key={item.id} className={`${styles.bubbleQuietItem} ${historyToneClass(item.kind, item.tone)}`}>
                    <span className={styles.bubbleQuietMark} aria-hidden="true">
                      {item.tone === "warn" ? <IconAlert width={8} height={8} /> : <IconCheck width={8} height={8} />}
                    </span>
                    <span>{item.message}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className={styles.bubbleArrow} />
        </div>
      ) : null}

      <button
        ref={mascotBtnRef}
        type="button"
        className={`${styles.mascotBtn} ${styles[mascotState]}`}
        onClick={toggleOpen}
        aria-expanded={!minimized}
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        {minimized && alertCount > 0 ? (
          <span className={styles.avatarBadge} title={`${alertCount} to review`}>
            {alertCount}
          </span>
        ) : null}
        <svg viewBox="0 0 100 100" className={styles.mascotSvg} xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id="employeeCopilotShadow" x="-10%" y="-10%" width="120%" height="120%">
              <feDropShadow dx="0" dy="4" stdDeviation="3" floodColor="#000" floodOpacity="0.2" />
            </filter>
          </defs>

          <ellipse cx="50" cy="84" rx="12" ry="4" className={styles.thrusterGlow} />

          <path d="M 38 65 Q 50 78 62 65 Q 50 68 38 65 Z" className={styles.bodyBase} filter="url(#employeeCopilotShadow)" />
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

          <rect x="24" y="18" width="52" height="42" rx="16" className={styles.headShell} filter="url(#employeeCopilotShadow)" />
          <rect x="28" y="22" width="44" height="34" rx="12" className={styles.faceScreen} />

          <ellipse
            cx={42 + eyeOffset.x}
            cy={39 + eyeOffset.y}
            rx="5"
            ry="7"
            className={styles.eye}
          />
          <ellipse
            cx={58 + eyeOffset.x}
            cy={39 + eyeOffset.y}
            rx="5"
            ry="7"
            className={styles.eye}
          />

          <line x1="50" y1="18" x2="50" y2="10" strokeWidth="3" strokeLinecap="round" className={styles.antennaStem} />
          <circle cx="50" cy="8" r="4" className={styles.antennaTip} />
        </svg>
      </button>
    </div>
  );
}
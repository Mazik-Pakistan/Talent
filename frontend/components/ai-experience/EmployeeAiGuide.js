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
  readPageAssist,
  writeGuideMinimized,
} from "@/lib/ai/guideContext";
import AiOrb from "./AiOrb";
import { IconAlert, IconCheck, IconChevronDown, IconChevronLeft, IconChevronRight, IconChevronUp, IconSparkle } from "./icons";
import styles from "./AiExperience.module.css";

const INCLUDED_PREFIXES = ["/dashboard/employee", "/documents"];
const SEEN_KEY = "employee_ai_copilot_seen_tips";

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
  if (tone === "warn" || kind === "validation") return styles.guideTimelineWarn;
  if (kind === "autosave" || kind === "assist") return styles.guideTimelineOk;
  return styles.guideTimelineInfo;
}

/**
 * Employee AI Copilot — global contextual partner (NOT the autonomous Agent).
 *
 * Mounted once from the root layout so it never unmounts during employee
 * routing. It explains, recommends, and can autofill the CURRENT page only
 * after the employee approves — with visible typing handled by the page.
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
  const [assistOffer, setAssistOffer] = useState(null);
  const [lastAssist, setLastAssist] = useState(null);
  const [assistBusy, setAssistBusy] = useState(false);
  const [assistDone, setAssistDone] = useState(false);
  const [contextTick, setContextTick] = useState(0);
  const [statusLine, setStatusLine] = useState(null);

  const historyIdsRef = useRef(new Set());
  const seenTipsRef = useRef(null);
  const pageTipKeysRef = useRef([]);
  const assistDoneRef = useRef(false);
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

  function acceptAssistOffer(offer) {
    if (!offer?.applyLabel && !offer?.message) {
      setAssistOffer(null);
      return;
    }
    setLastAssist(offer);
    setAssistOffer(offer);
    assistDoneRef.current = false;
    setAssistDone(false);
  }

  // Fresh page = fresh assist / status (don't carry Documents noise to Learning).
  useEffect(() => {
    assistDoneRef.current = false;
    setAssistDone(false);
    setAssistOffer(null);
    setStatusLine(null);
    setLastAssist(null);
    setHistory([]);
    historyIdsRef.current = new Set();
  }, [pathname]);

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
          // Page-scoped assist offer (current page only).
          const assist = readPageAssist();
          if (assist?.propose) {
            Promise.resolve(assist.propose({ pathname, section: context.section, context }))
              .then((offer) => {
                if (cancelled) return;
                // After they act or dismiss, keep a quiet "Show again" — don't re-spam the card.
                if (assistDoneRef.current) {
                  setAssistOffer(null);
                  return;
                }
                acceptAssistOffer(offer);
              })
              .catch(() => {
                if (!cancelled) setAssistOffer(null);
              });
          } else {
            setAssistOffer(null);
          }
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

  function maximize() {
    setMinimized(false);
    writeGuideMinimized(false);
  }

  async function approveAssist(offerOverride) {
    const assist = readPageAssist();
    const offer = offerOverride || assistOffer || lastAssist;
    if (!assist?.apply || !offer) return;
    setAssistBusy(true);
    setStatusLine(null);
    try {
      await assist.apply(offer);
      const done = offer.doneMessage || "Done";
      setStatusLine(done);
      assistDoneRef.current = true;
      setAssistDone(true);
      setAssistOffer(null);
      setLastAssist(offer);
      window.setTimeout(() => setStatusLine((line) => (line === done ? null : line)), 4000);
    } catch {
      setStatusLine("Couldn't finish — try again from the list.");
      setAssistDone(false);
    } finally {
      setAssistBusy(false);
    }
  }

  // Stay mounted when ineligible — just hide UI so state survives brief exits.
  if (!hydrated || !eligible || !ready) return null;

  // Priority surface: focus > flash validation/notify > assist > insights
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
  const roleLabel = focusHint
    ? "Helping with this field"
    : flash?.tone === "ok"
      ? "Your progress is saved"
      : assistBusy
        ? "Working…"
        : alertCount
          ? "I found something to review"
          : section
            ? `Helping with ${String(section).replace(/_/g, " ")}`
            : "Your page assistant";

  const showAssistAgain = assistDone && lastAssist && !assistOffer && !assistBusy;

  if (minimized) {
    return (
      <button
        type="button"
        className={styles.guideLauncher}
        onClick={maximize}
        aria-expanded={false}
        aria-label={
          alertCount
            ? `Expand Copilot — ${alertCount} to fix`
            : tipCount
              ? `Expand Copilot — ${tipCount} tip${tipCount === 1 ? "" : "s"}`
              : "Expand Copilot"
        }
        title={alertCount ? `${alertCount} to fix` : "Open Copilot"}
      >
        <AiOrb size="sm" />
        Copilot
        {alertCount > 0 ? (
          <span className={styles.guideBadge} title={`${alertCount} to fix`}>
            {alertCount}
          </span>
        ) : null}
        <IconChevronUp width={14} height={14} />
      </button>
    );
  }

  return (
    <aside className={styles.guide} aria-label="Employee AI Copilot">
      <div className={styles.guideTop}>
        <AiOrb size="md" thinking={assistBusy} />
        <div>
          <div className={styles.guideName}>Employee Copilot</div>
          <div className={styles.guideRole}>{roleLabel}</div>
        </div>
        <button
          type="button"
          className={styles.guideClose}
          onClick={minimize}
          aria-label="Minimize Copilot"
          title="Minimize"
        >
          <IconChevronDown />
        </button>
      </div>

      <div className={styles.guideBody}>
        <div
          className={`${styles.guideConversation} ${
            current?.tone === "warn" ? styles.guideConversationWarn : ""
          }`}
        >
          {current?.message ? (
            <>
              <div className={styles.guideMessageLabel}>
                {current?.tone === "warn" ? (
                  <IconAlert width={13} height={13} />
                ) : (
                  <IconSparkle width={13} height={13} />
                )}
                {current?.tone === "warn" ? "Needs your attention" : "For you"}
              </div>
              <p
                className={`${styles.guideMessage} ${current?.tone === "warn" ? styles.guideMessageWarn : ""}`}
                key={`${current?.id || "msg"}-${section || pathname}`}
              >
                {current.message}
              </p>
            </>
          ) : null}

          {assistOffer ? (
            <div className={styles.guideAssist}>
              {assistOffer.message ? (
                <p className={styles.guideAssistText}>{assistOffer.message}</p>
              ) : null}
              {assistOffer.items?.length ? (
                <ul className={styles.guideAssistItems}>
                  {assistOffer.items.slice(0, 3).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
              <div className={styles.guideActions}>
                <button
                  type="button"
                  className={`${styles.guideAction} ${styles.guideActionPrimary}`}
                  disabled={assistBusy}
                  onClick={() => approveAssist(assistOffer)}
                >
                  <IconSparkle width={12} height={12} />
                  {assistBusy ? "Working…" : assistOffer.applyLabel || "Help me"}
                </button>
                <button
                  type="button"
                  className={styles.guideAction}
                  disabled={assistBusy}
                  onClick={() => {
                    assistDoneRef.current = true;
                    setAssistOffer(null);
                    setAssistDone(true);
                  }}
                >
                  Not now
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {showAssistAgain ? (
          <div className={styles.guideActions}>
            <button
              type="button"
              className={`${styles.guideAction} ${styles.guideActionPrimary}`}
              disabled={assistBusy}
              onClick={() => approveAssist(lastAssist)}
            >
              <IconSparkle width={12} height={12} />
              {assistBusy ? "Working…" : lastAssist.applyLabel || "Show again"}
            </button>
          </div>
        ) : null}

        {current?.actions?.length ? (
          <div className={styles.guideActions}>
            {current.actions.map((action) => (
              <button
                key={action.label}
                type="button"
                className={`${styles.guideAction} ${action.primary ? styles.guideActionPrimary : ""}`}
                onClick={() => {
                  if (action.href) router.push(action.href);
                  else action.onClick?.();
                }}
              >
                {action.primary ? <IconSparkle width={12} height={12} /> : null}
                {action.label}
              </button>
            ))}
          </div>
        ) : null}

        {statusLine ? (
          <p className={styles.guideStatus} role="status">
            {statusLine}
          </p>
        ) : null}

        {deck.length > 1 ? (
          <div className={styles.guidePager} aria-label={`Suggestion ${index + 1} of ${deck.length}`}>
            <button
              type="button"
              className={styles.guidePagerBtn}
              disabled={index <= 0}
              onClick={() => setIndex((n) => Math.max(0, n - 1))}
              aria-label="Previous suggestion"
            >
              <IconChevronLeft width={16} height={16} />
            </button>
            <span className={styles.guidePagerLabel}>
              {index + 1} of {deck.length}
            </span>
            <button
              type="button"
              className={styles.guidePagerBtn}
              disabled={index >= deck.length - 1}
              onClick={() => setIndex((n) => Math.min(deck.length - 1, n + 1))}
              aria-label="Next suggestion"
            >
              <IconChevronRight width={16} height={16} />
            </button>
          </div>
        ) : null}

        {history.length > 0 && !statusLine ? (
          <details className={styles.guideHistory}>
            <summary>Recent activity</summary>
            <ul className={styles.guideQuietLog} aria-label="Recent activity">
              {history.slice(0, 2).map((item) => (
                <li key={item.id} className={`${styles.guideQuietItem} ${historyToneClass(item.kind, item.tone)}`}>
                  <span className={styles.guideTimelineMark} aria-hidden="true">
                    {item.tone === "warn" ? <IconAlert width={10} height={10} /> : <IconCheck width={10} height={10} />}
                  </span>
                  <span>{item.message}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </aside>
  );
}

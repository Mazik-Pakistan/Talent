"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { clearLocalSession, logout } from "@/services/authService";

/** Default: 15 minutes idle timeout. Override with NEXT_PUBLIC_SESSION_TIMEOUT_MS. */
const SESSION_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_SESSION_TIMEOUT_MS || 900000);
/** Default: warn 60 seconds before the session expires. Override with NEXT_PUBLIC_SESSION_WARNING_MS. */
const WARNING_BEFORE_MS = Math.min(
  Number(process.env.NEXT_PUBLIC_SESSION_WARNING_MS || 60000),
  Math.max(SESSION_TIMEOUT_MS - 1000, 1000)
);

const ACTIVITY_EVENTS = ["mousedown", "mousemove", "keydown", "scroll", "touchstart", "click"];

/**
 * US-009: Session Timeout
 * - Idle timer starts as soon as an authenticated user is detected.
 * - A warning is displayed before the session expires (acceptance criteria).
 * - The session expires automatically and the user is returned to Login.
 */
export default function SessionTimeout() {
  const router = useRouter();
  const pathname = usePathname();

  const expireTimerRef = useRef(null);
  const warningTimerRef = useRef(null);
  const countdownIntervalRef = useRef(null);
  const warningActiveRef = useRef(false);

  const [warningVisible, setWarningVisible] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const isAuthenticated = useCallback(() => {
    return Boolean(localStorage.getItem("access_token") && localStorage.getItem("user"));
  }, []);

  const clearAllTimers = useCallback(() => {
    if (expireTimerRef.current) clearTimeout(expireTimerRef.current);
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    expireTimerRef.current = null;
    warningTimerRef.current = null;
    countdownIntervalRef.current = null;
  }, []);

  const doExpire = useCallback(() => {
    clearAllTimers();
    warningActiveRef.current = false;
    setWarningVisible(false);

    if (!isAuthenticated()) return;

    const accessToken = localStorage.getItem("access_token");
    logout(accessToken); // best-effort server-side session revocation (fire and forget)
    clearLocalSession();

    if (pathname !== "/login") {
      router.replace("/login?reason=session_timeout");
    }
  }, [clearAllTimers, isAuthenticated, pathname, router]);

  const showWarning = useCallback(() => {
    if (!isAuthenticated()) return;
    warningActiveRef.current = true;
    setWarningVisible(true);
    setSecondsLeft(Math.round(WARNING_BEFORE_MS / 1000));

    countdownIntervalRef.current = setInterval(() => {
      setSecondsLeft((current) => (current > 0 ? current - 1 : 0));
    }, 1000);

    expireTimerRef.current = setTimeout(doExpire, WARNING_BEFORE_MS);
  }, [doExpire, isAuthenticated]);

  const scheduleTimers = useCallback(() => {
    clearAllTimers();
    warningActiveRef.current = false;
    setWarningVisible(false);

    if (!isAuthenticated()) return;

    localStorage.setItem("session_last_active", String(Date.now()));
    warningTimerRef.current = setTimeout(showWarning, Math.max(SESSION_TIMEOUT_MS - WARNING_BEFORE_MS, 0));
    expireTimerRef.current = setTimeout(doExpire, SESSION_TIMEOUT_MS);
  }, [clearAllTimers, doExpire, isAuthenticated, showWarning]);

  function handleStaySignedIn() {
    scheduleTimers();
  }

  useEffect(() => {
    if (isAuthenticated()) {
      const lastActive = Number(localStorage.getItem("session_last_active") || 0);
      if (lastActive && Date.now() - lastActive >= SESSION_TIMEOUT_MS) {
        // Already idle longer than the timeout (e.g. tab restored) — expire immediately.
        doExpire();
      } else {
        scheduleTimers();
      }
    }

    function onActivity() {
      // Once the warning is showing, require an explicit choice instead of
      // silently resetting on background mouse movement.
      if (warningActiveRef.current) return;
      scheduleTimers();
    }

    ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, onActivity, { passive: true });
    });

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !warningActiveRef.current) onActivity();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearAllTimers();
      ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, onActivity);
      });
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // Re-run only when the route changes; internal callbacks are stable via useCallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (!warningVisible) return null;

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div
      className="session-warning-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-warning-title"
      aria-describedby="session-warning-message"
    >
      <div className="session-warning-card">
        <p className="eyebrow">Session expiring</p>
        <h2 id="session-warning-title">You&apos;ve been idle for a while</h2>
        <p id="session-warning-message">
          For your security, you&apos;ll be signed out in{" "}
          <strong>
            {minutes}:{seconds}
          </strong>{" "}
          unless you stay signed in.
        </p>
        <div className="session-warning-actions">
          <button type="button" className="secondary-button" onClick={doExpire}>
            Sign out now
          </button>
          <button type="button" className="primary-button" onClick={handleStaySignedIn}>
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  );
}
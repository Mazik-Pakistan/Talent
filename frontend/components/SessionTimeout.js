"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import {
  clearLocalSession,
  getTokenExpiresAt,
  isRememberMeEnabled,
  logout,
  refreshSession,
} from "@/services/authService";

/** Default: 15 minutes idle timeout. Override with NEXT_PUBLIC_SESSION_TIMEOUT_MS. */
const SESSION_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_SESSION_TIMEOUT_MS || 900000);
/** Remember me: 7 days idle by default. Override with NEXT_PUBLIC_SESSION_TIMEOUT_REMEMBER_MS. */
const SESSION_TIMEOUT_REMEMBER_MS = Number(
  process.env.NEXT_PUBLIC_SESSION_TIMEOUT_REMEMBER_MS || 7 * 24 * 60 * 60 * 1000
);
/** Default: warn 60 seconds before the session expires. Override with NEXT_PUBLIC_SESSION_WARNING_MS. */
const WARNING_BEFORE_MS = Number(process.env.NEXT_PUBLIC_SESSION_WARNING_MS || 60000);

const ACTIVITY_EVENTS = ["mousedown", "mousemove", "keydown", "scroll", "touchstart", "click"];

function getIdleTimeoutMs() {
  return isRememberMeEnabled() ? SESSION_TIMEOUT_REMEMBER_MS : SESSION_TIMEOUT_MS;
}

/** Warning window can never be longer than the time actually left before expiry. */
function getWarningBeforeMs(msUntilExpiry) {
  return Math.min(WARNING_BEFORE_MS, Math.max(msUntilExpiry - 1000, 1000));
}

/**
 * The idle-timeout deadline: last recorded activity + the idle window.
 * Falls back to "now" if we've never recorded activity (e.g. first run).
 */
function getIdleDeadline() {
  const lastActive = Number(localStorage.getItem("session_last_active") || Date.now());
  return lastActive + getIdleTimeoutMs();
}

/**
 * The real, server-side JWT expiry. This is independent of user activity: an
 * actively-typing user still has their access token expire on schedule unless
 * it's explicitly refreshed. Falls back to Infinity if unknown (e.g. a session
 * created before this was tracked), so idle-only logic still applies for it.
 */
function getTokenDeadline() {
  const tokenExpiresAt = getTokenExpiresAt();
  return tokenExpiresAt > 0 ? tokenExpiresAt : Infinity;
}

/**
 * US-009: Session Timeout
 * - Idle timer starts as soon as an authenticated user is detected.
 * - Remember me uses a much longer idle window (still works on localhost).
 * - The session's real JWT expiry is also tracked, so an active user whose
 *   token is about to expire server-side gets warned too, not just an idle one.
 * - A warning is displayed before whichever deadline (idle or token) comes first.
 * - "Stay signed in" refreshes the access token; if that fails, the session
 *   expires and the user is returned to Login.
 */
export default function SessionTimeout() {
  const router = useRouter();
  const pathname = usePathname();

  const expireTimerRef = useRef(null);
  const warningTimerRef = useRef(null);
  const countdownIntervalRef = useRef(null);
  const warningActiveRef = useRef(false);
  const warningBeforeRef = useRef(WARNING_BEFORE_MS);

  const [warningVisible, setWarningVisible] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [expiryReason, setExpiryReason] = useState("idle"); // "idle" | "token"
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");

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

  const doExpire = useCallback(
    (reason) => {
      clearAllTimers();
      warningActiveRef.current = false;
      setWarningVisible(false);
      setRefreshError("");

      if (!isAuthenticated()) return;

      const accessToken = localStorage.getItem("access_token");
      logout(accessToken); // best-effort server-side session revocation (fire and forget)
      clearLocalSession();

      if (pathname !== "/login") {
        const isSuperAdminArea = pathname.startsWith("/dashboard/super-admin");
        if (isSuperAdminArea) {
          router.replace("/portal-root-x9f3");
          return;
        }
        const reasonParam =
          reason === "token" ? "session_expired" : reason === "idle" ? "session_timeout" : "";
        router.replace(reasonParam ? `/login?reason=${reasonParam}` : "/login");
      }
    },
    [clearAllTimers, isAuthenticated, pathname, router]
  );

  const showWarning = useCallback(
    (reason, warningMs) => {
      if (!isAuthenticated()) return;
      warningActiveRef.current = true;
      setExpiryReason(reason);
      setWarningVisible(true);
      setSecondsLeft(Math.round(warningMs / 1000));

      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = setInterval(() => {
        setSecondsLeft((current) => (current > 0 ? current - 1 : 0));
      }, 1000);
      // Note: the actual sign-out is driven by expireTimerRef (set once in
      // scheduleTimers) so we don't schedule a second, redundant timer here.
    },
    [isAuthenticated]
  );

  const scheduleTimers = useCallback(() => {
    clearAllTimers();
    warningActiveRef.current = false;
    setWarningVisible(false);
    setRefreshError("");

    if (!isAuthenticated()) return;

    localStorage.setItem("session_last_active", String(Date.now()));

    const idleDeadline = getIdleDeadline();
    const tokenDeadline = getTokenDeadline();
    const effectiveDeadline = Math.min(idleDeadline, tokenDeadline);
    const reason = tokenDeadline < idleDeadline ? "token" : "idle";

    const msUntilExpiry = Math.max(effectiveDeadline - Date.now(), 1000);
    const warningMs = getWarningBeforeMs(msUntilExpiry);
    warningBeforeRef.current = warningMs;

    warningTimerRef.current = setTimeout(
      () => showWarning(reason, warningMs),
      Math.max(msUntilExpiry - warningMs, 0)
    );
    expireTimerRef.current = setTimeout(() => doExpire(reason), msUntilExpiry);
  }, [clearAllTimers, doExpire, isAuthenticated, showWarning]);

  async function handleStaySignedIn() {
    // Idle-only warnings just need the local activity clock reset.
    // Token-expiry warnings need an actual refreshed access token, or the
    // user will keep getting warned (or start seeing failed requests).
    if (expiryReason !== "token") {
      scheduleTimers();
      return;
    }

    setIsRefreshing(true);
    setRefreshError("");
    try {
      await refreshSession();
      scheduleTimers();
    } catch {
      setRefreshError("We couldn't renew your session. Please sign in again.");
      doExpire("token");
    } finally {
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    if (isAuthenticated()) {
      const idleDeadline = getIdleDeadline();
      const tokenDeadline = getTokenDeadline();
      if (Date.now() >= Math.min(idleDeadline, tokenDeadline)) {
        // Already past the idle window or the token's real expiry
        // (e.g. tab restored after a long time away) — expire immediately.
        doExpire(tokenDeadline < idleDeadline ? "token" : "idle");
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
  const heading =
    expiryReason === "token" ? "Your session is about to expire" : "You've been idle for a while";

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
        <h2 id="session-warning-title">{heading}</h2>
        <p id="session-warning-message">
          For your security, you&apos;ll be signed out in{" "}
          <strong>
            {minutes}:{seconds}
          </strong>{" "}
          unless you stay signed in.
        </p>
        {refreshError ? <p className="field-error">{refreshError}</p> : null}
        <div className="session-warning-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => doExpire()}
            disabled={isRefreshing}
          >
            Sign out now
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={handleStaySignedIn}
            disabled={isRefreshing}
          >
            {isRefreshing ? "Renewing…" : "Stay signed in"}
          </button>
        </div>
      </div>
    </div>
  );
}

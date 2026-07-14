"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

/** Default: 15 minutes. Override with NEXT_PUBLIC_SESSION_TIMEOUT_MS. */
const SESSION_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_SESSION_TIMEOUT_MS || 900000);

const ACTIVITY_EVENTS = ["mousedown", "mousemove", "keydown", "scroll", "touchstart", "click"];

function clearSession() {
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
  localStorage.removeItem("user");
  localStorage.removeItem("session_last_active");
}

export default function SessionTimeout() {
  const router = useRouter();
  const pathname = usePathname();
  const timerRef = useRef(null);

  useEffect(() => {
    function isAuthenticated() {
      return Boolean(localStorage.getItem("access_token") && localStorage.getItem("user"));
    }

    function expireSession() {
      if (!isAuthenticated()) return;
      clearSession();
      if (pathname !== "/login") {
        router.replace("/login?reason=session_timeout");
      }
    }

    function resetTimer() {
      if (!isAuthenticated()) {
        if (timerRef.current) clearTimeout(timerRef.current);
        return;
      }
      localStorage.setItem("session_last_active", String(Date.now()));
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(expireSession, SESSION_TIMEOUT_MS);
    }

    // If already idle longer than timeout (e.g. tab restored), expire immediately
    if (isAuthenticated()) {
      const lastActive = Number(localStorage.getItem("session_last_active") || 0);
      if (lastActive && Date.now() - lastActive >= SESSION_TIMEOUT_MS) {
        expireSession();
        return undefined;
      }
      resetTimer();
    }

    ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, resetTimer, { passive: true });
    });

    const onVisibility = () => {
      if (document.visibilityState === "visible") resetTimer();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, resetTimer);
      });
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pathname, router]);

  return null;
}

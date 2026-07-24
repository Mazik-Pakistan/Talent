"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import AgentChatCore, { readAuth } from "./AgentChatCore";
import styles from "./AgentChatWidgetLauncher.module.css";

// Routes where the floating agent should never appear (public/unauthenticated
// surfaces — landing, auth flows, invite/offer accept pages, the onboarding
// page itself which has its own full-canvas agent, and print-style pages).
const HIDDEN_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/invite",
  "/offer",
  "/onboarding",
];

function IconChat() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/**
 * Global floating agent widget. Mounted once at the root layout so it's
 * available on every authenticated screen without every page needing to
 * remember to import it. Hidden on dedicated /ai-assistant routes (those
 * pages own the full-canvas chat).
 */
export default function AgentChatWidget() {
  const pathname = usePathname();
  const [auth, setAuth] = useState(null);
  const [open, setOpen] = useState(false);

  const onAssistantRoute = Boolean(pathname?.includes("/ai-assistant"));
  const hidden =
    HIDDEN_PREFIXES.some((p) => pathname?.startsWith(p)) || pathname === "/" || onAssistantRoute;

  useEffect(() => {
    setAuth(hidden ? null : readAuth());
  }, [pathname, hidden]);

  // Re-check auth on focus/storage changes so the widget appears immediately
  // after login without a full navigation.
  useEffect(() => {
    function recheck() {
      if (!hidden) setAuth(readAuth());
    }
    window.addEventListener("storage", recheck);
    window.addEventListener("focus", recheck);
    return () => {
      window.removeEventListener("storage", recheck);
      window.removeEventListener("focus", recheck);
    };
  }, [hidden]);

  if (!auth) return null;

  return (
    <>
      <button
        type="button"
        className={styles.launcher}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close AI agent" : "Open AI agent"}
      >
        {open ? <IconClose /> : <IconChat />}
      </button>

      {open ? (
        <div className={styles.panel} role="dialog" aria-label="AI agent">
          <AgentChatCore variant="floating" auth={auth} />
        </div>
      ) : null}
    </>
  );
}

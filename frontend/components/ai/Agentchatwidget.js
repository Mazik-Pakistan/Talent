"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import AgentChatCore, { readAuth } from "./AgentChatCore";
import styles from "./AgentChatWidgetLauncher.module.css";
import RecruiterMascot from "@/components/recruiter/RecruiterMascot";
import CandidateMascot from "@/components/candidate/CandidateMascot";

// Routes where floating assistants are hidden (unauthenticated auth flows & dedicated full-canvas AI pages).
const PUBLIC_HIDDEN_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
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
 * Global floating assistant widget launcher.
 * Renders RecruiterMascot on recruiter routes and CandidateMascot on candidate routes.
 */
export default function AgentChatWidget() {
  const pathname = usePathname();
  const [auth, setAuth] = useState(null);
  const [open, setOpen] = useState(false);

  const isRecruiterPage = Boolean(pathname?.startsWith("/dashboard/recruiter"));
  const isCandidatePage = Boolean(
    pathname?.startsWith("/dashboard/candidate") ||
    pathname?.startsWith("/onboarding") ||
    pathname?.startsWith("/offer") ||
    pathname?.startsWith("/documents")
  );
  const onAssistantRoute = Boolean(pathname?.includes("/ai-assistant"));

  const hidden =
    PUBLIC_HIDDEN_PREFIXES.some((p) => pathname?.startsWith(p)) ||
    pathname === "/" ||
    onAssistantRoute;

  const showRecruiterMascot = isRecruiterPage && !hidden;
  const showCandidateMascot = isCandidatePage && !hidden && !showRecruiterMascot;

  useEffect(() => {
    setAuth(hidden ? null : readAuth());
  }, [pathname, hidden]);

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
      {showRecruiterMascot ? (
        <RecruiterMascot openChat={open} toggleChat={() => setOpen((v) => !v)} />
      ) : showCandidateMascot ? (
        <CandidateMascot openChat={open} toggleChat={() => setOpen((v) => !v)} />
      ) : (
        <button
          type="button"
          className={styles.launcher}
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close AI agent" : "Open AI agent"}
        >
          {open ? <IconClose /> : <IconChat />}
        </button>
      )}

      {open ? (
        <div className={styles.panel} role="dialog" aria-label="AI agent">
          <AgentChatCore variant="floating" auth={auth} />
        </div>
      ) : null}
    </>
  );
}

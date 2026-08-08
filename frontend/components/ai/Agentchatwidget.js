"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { readAuth } from "./AgentChatCore";
import RecruiterMascot from "@/components/recruiter/RecruiterMascot";
import CandidateMascot from "@/components/candidate/CandidateMascot";
import EmployeeMascot from "@/components/employee/EmployeeMascot";
import SuperAdminMascot from "@/components/super-admin/SuperAdminMascot";

// Routes where floating partners are hidden (auth flows & dedicated Agent pages).
const PUBLIC_HIDDEN_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
];

/**
 * Global partner mascot host (NOT the autonomous AI Agent).
 *
 * - Recruiter / Candidate / Employee: contextual partner on dashboard pages.
 * - Autonomous Agent chat lives only on each role's /ai-assistant page.
 */
export default function AgentChatWidget() {
  const pathname = usePathname();
  const [auth, setAuth] = useState(null);

  const onAssistantRoute = Boolean(pathname?.includes("/ai-assistant"));
  const hidden =
    PUBLIC_HIDDEN_PREFIXES.some((p) => pathname?.startsWith(p)) ||
    pathname === "/" ||
    onAssistantRoute;

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

  if (!auth || hidden) return null;

  const role = auth.user?.role;

  if (
    pathname?.startsWith("/dashboard/super-admin") &&
    role === "super_admin"
  ) {
    return <SuperAdminMascot />;
  }

  if (
    pathname?.startsWith("/dashboard/recruiter") &&
    (role === "recruiter" || role === "super_admin")
  ) {
    return <RecruiterMascot />;
  }

  if (
    role === "candidate" &&
    (pathname?.startsWith("/dashboard/candidate") ||
      pathname?.startsWith("/onboarding") ||
      pathname?.startsWith("/offer") ||
      pathname?.startsWith("/documents"))
  ) {
    return <CandidateMascot />;
  }

  if (
    role === "employee" &&
    (pathname?.startsWith("/dashboard/employee") || pathname?.startsWith("/documents"))
  ) {
    return <EmployeeMascot />;
  }

  return null;
}

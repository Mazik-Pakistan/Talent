"use client";

import { useCallback } from "react";
import BaseMascot from "@/components/mascot/BaseMascot";
import {
  buildEmployeeInsights,
  invalidateInsightCache,
  INSIGHTS_REFRESH_EVENT,
} from "@/lib/ai/employeeInsights";
import { COPILOT_CONTEXT_EVENT, readGuideContext } from "@/lib/ai/guideContext";
import { employeeFieldHelpFor, employeePageSummaryFor } from "@/lib/ai/employeeFieldHelp";

const GREETING_KEY = "employee_partner_greeted_v1";

function readGreeted() {
  try {
    return localStorage.getItem(GREETING_KEY) === "1";
  } catch {
    return false;
  }
}

function markGreeted() {
  try {
    localStorage.setItem(GREETING_KEY, "1");
  } catch {
    // ignore
  }
}

function welcomeMessage(firstName) {
  const name = firstName ? `, ${firstName}` : "";
  return `Hi${name} — I'm your employee partner. I'll explain each page and guide forms when you ask.`;
}

function updateMemory() {
  return { prev: null, next: null };
}

function buildContinuityMessage() {
  return null;
}

function buildIdleInsights(insights) {
  return (insights || []).map((item) => item.message).filter(Boolean);
}

/**
 * Employee partner mascot — same BaseMascot UX as Recruiter/Candidate.
 * Autonomous Agent lives on /dashboard/employee/ai-assistant only.
 */
export default function EmployeeMascot() {
  const buildInsights = useCallback(async (pathname, token, context) => {
    const list = await buildEmployeeInsights(pathname, token, context);
    const insights = Array.isArray(list) ? list : [];
    return { insights, stats: {} };
  }, []);

  const handleFormCommand = useCallback(async () => false, []);

  return (
    <BaseMascot
      roleLabel="Employee"
      routePrefixes={["/dashboard/employee", "/documents"]}
      contextEvent={COPILOT_CONTEXT_EVENT}
      refreshEvent={INSIGHTS_REFRESH_EVENT}
      readContext={readGuideContext}
      readGreeted={readGreeted}
      markGreeted={markGreeted}
      updateMemory={updateMemory}
      buildContinuityMessage={buildContinuityMessage}
      welcomeMessage={welcomeMessage}
      buildInsights={buildInsights}
      buildIdleInsights={buildIdleInsights}
      invalidateCache={invalidateInsightCache}
      onFormCommand={handleFormCommand}
      resolveFieldHelp={employeeFieldHelpFor}
      resolvePageSummary={employeePageSummaryFor}
      enableCommands={false}
    />
  );
}

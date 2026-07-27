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

const EMPLOYEE_COMMAND_FIELDS = {
  first_name: ["first name"],
  last_name: ["last name", "surname"],
  date_of_birth: ["date of birth", "dob", "birthday"],
  national_id: ["national id", "cnic", "nic"],
  phone: ["phone", "mobile", "contact"],
  email: ["email"],
  current_address: ["current address", "address"],
  permanent_address: ["permanent address"],
  name: ["emergency name", "contact name"],
  relationship: ["relationship"],
  alternate_phone: ["alternate phone", "backup phone", "alternate contact"],
  bank_name: ["bank name", "bank"],
  account_holder_name: ["account holder", "account name"],
  account_number: ["account number"],
  iban: ["iban"],
  branch: ["branch"],
  branch_code: ["branch code"],
  swift_code: ["swift", "bic"],
  full_name: ["full name", "reference name", "legal name"],
  company: ["company"],
  full_legal_name: ["legal name", "nda name"],
};

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
  return `Hi${name} — I'm your employee partner. Tap me for the next tip, or focus a field for guidance.`;
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

  const handleFormCommand = useCallback(
    async (command, { setFormCommand, explainField, visibleFormFields, setMessage, pathname, router }) => {
      if (/(?:do it for me|fill (?:all|everything)|run (?:the )?agent)/i.test(command)) {
        setFormCommand("");
        setMessage(
          "I highlight fields and explain them — you type the values yourself on the form. For multi-step help, open AI Assistant.",
          2,
          "partner-not-agent",
          { force: true, bypassCooldown: true, animation: "stateWave" }
        );
        if (pathname && !pathname.includes("/ai-assistant")) {
          // Stay on page; optional nudge only via message.
        }
        return true;
      }

      if (/(?:open|go to|take me to)\s+(?:ai )?assistant/i.test(command)) {
        setFormCommand("");
        router?.push?.("/dashboard/employee/ai-assistant");
        return true;
      }

      const fields = typeof visibleFormFields === "function" ? visibleFormFields() : [];
      const lowered = command.toLowerCase().replace(/^(what(?:'s| is)|help(?: with)?|explain)\s+/i, "");
      const match = fields.find((field) => {
        const identifier = `${field.name || ""} ${field.id || ""}`.toLowerCase().replace(/[_-]/g, " ");
        const label = (field.closest("label")?.textContent || field.placeholder || "").toLowerCase();
        return (
          Object.entries(EMPLOYEE_COMMAND_FIELDS).some(
            ([key, names]) =>
              (identifier.includes(key.replace(/_/g, " ")) || names.some((n) => identifier.includes(n) || label.includes(n))) &&
              (lowered.includes(key.replace(/_/g, " ")) || names.some((n) => lowered.includes(n)))
          ) ||
          identifier.includes(lowered) ||
          label.includes(lowered)
        );
      });

      if (match && explainField) {
        setFormCommand("");
        explainField(match);
        return true;
      }

      return false;
    },
    []
  );

  const commandPlaceholderFn = useCallback((fields) => {
    const labels = fields
      .slice(0, 2)
      .map((field) => {
        const labelEl = field.closest("label");
        return (labelEl?.querySelector("span")?.textContent || labelEl?.textContent || field.name || "")
          .trim()
          .replace(/\*$/, "")
          .trim() || null;
      })
      .filter(Boolean);
    return labels.length ? `Ask about ${labels.join(" / ")}…` : "Ask about a field…";
  }, []);

  return (
    <BaseMascot
      roleLabel="Employee"
      fabStorageKey="mascot_fab_pos_employee"
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
      commandFields={EMPLOYEE_COMMAND_FIELDS}
      onFormCommand={handleFormCommand}
      commandPlaceholderFn={commandPlaceholderFn}
      resolveFieldHelp={employeeFieldHelpFor}
      resolvePageSummary={employeePageSummaryFor}
      enableCommands={false}
    />
  );
}

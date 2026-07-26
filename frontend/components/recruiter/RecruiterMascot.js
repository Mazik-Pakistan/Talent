"use client";

import { useCallback } from "react";
import BaseMascot from "@/components/mascot/BaseMascot";
import {
  buildIdleInsights,
  buildRecruiterInsights,
  invalidateRecruiterInsightCache,
  RECRUITER_INSIGHTS_REFRESH_EVENT,
} from "@/lib/ai/recruiterInsights";
import {
  MASCOT_CONTEXT_EVENT,
  markMascotGreeted,
  readMascotGreeted,
  readRecruiterContext,
} from "@/lib/ai/recruiterContext";
import {
  buildContinuityMessage,
  updatePipelineMemory,
  welcomeMessage,
} from "@/lib/ai/recruiterMemory";
import { recruiterFieldHelpFor, recruiterPageSummaryFor } from "@/lib/ai/recruiterFieldHelp";
import { globalSearch } from "@/services/authService";

const COMMAND_FIELDS = {
  full_name: ["full name", "name", "mera naam", "naam"],
  first_name: ["first name"],
  last_name: ["last name", "surname"],
  cnic: ["cnic", "nic", "national id"],
  email: ["email", "email address"],
  phone: ["phone", "mobile"],
  department: ["department", "dep"],
  job_title: ["job title", "designation", "title"],
  office_location: ["office location", "location"],
  start_date: ["start date", "joining date"],
  address: ["address"],
  expires_in_days: ["expires", "expiry", "expire days"],
  employment_type: ["employment type"],
  reporting_manager: ["reporting manager", "manager"],
  monthly_salary: ["monthly salary", "salary"],
  currency: ["currency"],
  message_to_candidate: ["message to candidate", "message"],
  company_email: ["company email"],
  asset_type: ["asset type"],
  serial_number: ["serial number", "serial"],
  trainer: ["trainer"],
  meeting_link: ["meeting link"],
  agenda: ["agenda"],
  dueDate: ["due date"],
  mandatory: ["mandatory"],
  audience: ["audience"],
  body: ["body", "announcement body"],
  actionReason: ["reason", "action reason"],
  actionNote: ["action note"],
  rejectNote: ["reject note", "rejection"],
  required_skills: ["required skills", "skills"],
  description: ["description"],
};

/**
 * Recruiter partner mascot — page/field guidance only.
 * Autonomous hiring actions live on /dashboard/recruiter/ai-assistant.
 */
export default function RecruiterMascot() {
  const handleFormCommand = useCallback(
    async (
      command,
      { pathname, router, setMessage, triggerState, setFormCommand, explainField, visibleFormFields }
    ) => {
      const searchMatch = command.match(
        /^(?:search|find|dhoondo|talash)\s+(.+?)(?:\s+(employee|candidate))?$/i
      );
      if (searchMatch) {
        const query = searchMatch[1].trim();
        const requestedType = searchMatch[2]?.toLowerCase();
        const token = localStorage.getItem("access_token");
        if (!token || query.length < 2) return true;
        triggerState("stateThinking", 2200);
        try {
          const results = (await globalSearch(query, token)).results || [];
          const matches = requestedType
            ? results.filter((item) => item.type === requestedType)
            : results;
          const match =
            matches.find((item) => item.full_name?.toLowerCase() === query.toLowerCase()) ||
            matches[0];
          if (!match) {
            setMessage(
              `No ${requestedType || "candidate or employee"} found for “${query}”.`,
              2,
              "command-search-empty",
              { force: true, bypassCooldown: true, animation: "stateThinking" }
            );
            return true;
          }
          setFormCommand("");
          setMessage(
            `Found ${match.full_name}. Opening their ${match.type} record — you take it from here.`,
            2,
            `command-search:${match.id}`,
            { force: true, bypassCooldown: true, animation: "stateHappy" }
          );
          router.push(
            match.type === "employee"
              ? `/dashboard/recruiter/employees/${match.id}`
              : "/dashboard/recruiter/candidates"
          );
        } catch {
          setMessage(
            "Search is unavailable right now. Please try again.",
            5,
            "command-search-error",
            { force: true, bypassCooldown: true, animation: "stateWarning" }
          );
        }
        return true;
      }

      // Redirect automation intents to the Hiring Agent page.
      if (
        /(?:bulk\s*invite|excel|spreadsheet|approve\s+all|remind\s+all|send\s+invite|verify\s+all)/i.test(
          command
        )
      ) {
        setFormCommand("");
        setMessage(
          "That’s a Hiring Agent job — open AI Assistant in the sidebar for bulk invites, approvals, and reminders.",
          2,
          "redirect-agent",
          { force: true, bypassCooldown: true, animation: "stateWave" }
        );
        if (pathname && !pathname.includes("/ai-assistant")) {
          setTimeout(() => router.push("/dashboard/recruiter/ai-assistant"), 900);
        }
        return true;
      }

      if (/(?:open|go to|take me to)\s+(?:ai )?assistant/i.test(command)) {
        setFormCommand("");
        router?.push?.("/dashboard/recruiter/ai-assistant");
        return true;
      }

      // Partner: explain a named field — never auto-fill values.
      const fields = typeof visibleFormFields === "function" ? visibleFormFields() : [];
      const lowered = command.toLowerCase().replace(/^(what(?:'s| is)|help(?: with)?|explain)\s+/i, "");
      const match = fields.find((field) => {
        const identifier = `${field.name || ""} ${field.id || ""}`
          .toLowerCase()
          .replace(/[_-]/g, " ");
        const label = (field.closest("label")?.textContent || field.placeholder || "").toLowerCase();
        return (
          Object.entries(COMMAND_FIELDS).some(
            ([key, names]) =>
              (identifier.includes(key.replace(/_/g, " ")) || names.some((n) => identifier.includes(n) || label.includes(n))) &&
              (lowered.includes(key.replace(/_/g, " ")) || names.some((n) => lowered.includes(n)))
          ) || identifier.includes(lowered) || label.includes(lowered)
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
        const text = (labelEl?.querySelector("span")?.textContent || labelEl?.textContent || field.name || "")
          .trim()
          .replace(/\*$/, "")
          .trim();
        return text || null;
      })
      .filter(Boolean);
    return labels.length
      ? `Ask about ${labels.join(" / ")}… or search name`
      : "Ask about a field, or search employee/candidate";
  }, []);

  return (
    <BaseMascot
      roleLabel="Recruiter"
      fabStorageKey="mascot_fab_pos_recruiter"
      routePrefixes={["/dashboard/recruiter"]}
      contextEvent={MASCOT_CONTEXT_EVENT}
      refreshEvent={RECRUITER_INSIGHTS_REFRESH_EVENT}
      readContext={readRecruiterContext}
      readGreeted={readMascotGreeted}
      markGreeted={markMascotGreeted}
      updateMemory={updatePipelineMemory}
      buildContinuityMessage={buildContinuityMessage}
      welcomeMessage={welcomeMessage}
      buildInsights={buildRecruiterInsights}
      buildIdleInsights={buildIdleInsights}
      invalidateCache={invalidateRecruiterInsightCache}
      commandFields={COMMAND_FIELDS}
      onFormCommand={handleFormCommand}
      commandPlaceholderFn={commandPlaceholderFn}
      resolveFieldHelp={recruiterFieldHelpFor}
      resolvePageSummary={recruiterPageSummaryFor}
      enableCommands={false}
    />
  );
}

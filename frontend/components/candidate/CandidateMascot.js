"use client";

import { useCallback } from "react";
import BaseMascot from "@/components/mascot/BaseMascot";
import {
  buildCandidateInsights,
  buildIdleInsights,
  invalidateCandidateInsightCache,
  CANDIDATE_INSIGHTS_REFRESH_EVENT,
} from "@/lib/ai/candidateInsights";
import {
  CANDIDATE_MASCOT_CONTEXT_EVENT,
  markMascotGreeted,
  readCandidateContext,
  readMascotGreeted,
} from "@/lib/ai/candidateContext";
import {
  buildContinuityMessage,
  updateCandidateMemory,
  welcomeMessage,
} from "@/lib/ai/candidateMemory";
import { candidateFieldHelpFor, candidatePageSummaryFor } from "@/lib/ai/candidateFieldHelp";

const CANDIDATE_COMMAND_FIELDS = {
  full_name: ["full name", "name", "naam"],
  cnic: ["cnic", "nic", "national id"],
  email: ["email", "email address"],
  phone: ["phone", "mobile"],
  address: ["address", "current address"],
  job_title: ["job title", "designation", "title"],
  degree: ["degree", "qualification"],
  institution: ["institution", "university", "college"],
  skills: ["skills", "skillset"],
};

/**
 * Candidate partner mascot — field/page guidance only.
 * Autonomous agent actions live on /dashboard/candidate/ai-assistant.
 */
export default function CandidateMascot() {
  const handleFormCommand = useCallback(
    async (command, { router, setMessage, setFormCommand, explainField, visibleFormFields, pathname }) => {
      if (/(?:sign|accept).*(?:offer|letter)|(?:offer|letter).*(?:sign|accept)|do it for me|fill (?:all|everything)/i.test(command)) {
        setFormCommand("");
        setMessage(
          "I highlight fields and explain them — you type the values yourself on the form. For multi-step automation, open AI Assistant.",
          2,
          "partner-not-agent",
          { force: true, bypassCooldown: true, animation: "stateWave" }
        );
        return true;
      }

      if (/(?:open|go to|take me to)\s+(?:ai )?assistant/i.test(command)) {
        setFormCommand("");
        router?.push?.("/dashboard/candidate/ai-assistant");
        return true;
      }

      const fields = typeof visibleFormFields === "function" ? visibleFormFields() : [];
      const lowered = command.toLowerCase().replace(/^(what(?:'s| is)|help(?: with)?|explain)\s+/i, "");
      const match = fields.find((field) => {
        const identifier = `${field.name || ""} ${field.id || ""}`.toLowerCase().replace(/[_-]/g, " ");
        const label = (field.closest("label")?.textContent || field.placeholder || "").toLowerCase();
        return (
          Object.entries(CANDIDATE_COMMAND_FIELDS).some(
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
      roleLabel="Candidate"
      fabStorageKey="mascot_fab_pos_candidate"
      routePrefixes={["/dashboard/candidate", "/onboarding", "/offer", "/documents"]}
      contextEvent={CANDIDATE_MASCOT_CONTEXT_EVENT}
      refreshEvent={CANDIDATE_INSIGHTS_REFRESH_EVENT}
      readContext={readCandidateContext}
      readGreeted={readMascotGreeted}
      markGreeted={markMascotGreeted}
      updateMemory={updateCandidateMemory}
      buildContinuityMessage={buildContinuityMessage}
      welcomeMessage={welcomeMessage}
      buildInsights={buildCandidateInsights}
      buildIdleInsights={buildIdleInsights}
      invalidateCache={invalidateCandidateInsightCache}
      commandFields={CANDIDATE_COMMAND_FIELDS}
      onFormCommand={handleFormCommand}
      commandPlaceholderFn={commandPlaceholderFn}
      resolveFieldHelp={candidateFieldHelpFor}
      resolvePageSummary={candidatePageSummaryFor}
      enableCommands={false}
    />
  );
}

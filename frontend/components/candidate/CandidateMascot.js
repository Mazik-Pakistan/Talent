"use client";

import { useCallback, useState } from "react";
import BaseMascot, {
  setNativeFieldValue,
  visibleFormFields,
} from "@/components/mascot/BaseMascot";
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
import styles from "@/components/mascot/BaseMascot.module.css";

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

function getFieldLabel(field) {
  const labelEl = field.closest("label");
  if (labelEl) {
    const span = labelEl.querySelector("span");
    const text = (span?.textContent || labelEl.textContent || "").trim();
    if (text) return text.replace(/\*$/, "").trim();
  }
  const placeholder = field.getAttribute("placeholder");
  if (placeholder) return placeholder.trim();
  const name = field.name || field.id;
  if (name) return name.replace(/_/g, " ");
  return "This field";
}

function isFieldEmpty(field) {
  if (field.type === "checkbox" || field.type === "radio") return !field.checked;
  const value = typeof field.value === "string" ? field.value.trim() : field.value;
  if (field.tagName === "SELECT") return !value;
  return !value;
}

export default function CandidateMascot({ openChat, toggleChat }) {
  const [confirmOffer, setConfirmOffer] = useState(false);

  const handleFormCommand = useCallback(
    async (
      command,
      { pathname, router, setMessage, triggerState, refreshFormGuidance, setFormCommand }
    ) => {
      const fields = visibleFormFields();
      const allAliases = Object.values(CANDIDATE_COMMAND_FIELDS).flat().join("|");
      let filled = 0;
      fields.forEach((field) => {
        const identifier = `${field.name || ""} ${field.id || ""} ${getFieldLabel(field)}`
          .toLowerCase()
          .replace(/[_-]/g, " ");
        const aliases = Object.entries(CANDIDATE_COMMAND_FIELDS)
          .filter(
            ([key, names]) =>
              identifier.includes(key.replace(/_/g, " ")) ||
              names.some((name) => identifier.includes(name))
          )
          .flatMap(([, names]) => names)
          .sort((a, b) => b.length - a.length);
        const alias = aliases.find((name) =>
          new RegExp(`(?:^|[,;\\s])${name.replace(/ /g, "\\s+")}(?:\\s*(?:is|:|=))?\\s+`, "i").test(
            command
          )
        );
        if (!alias) return;
        const value = command
          .match(
            new RegExp(
              `(?:^|[,;\\s])${alias.replace(/ /g, "\\s+")}(?:\\s*(?:is|:|=))?\\s+(.+?)(?=\\s*(?:,|;|\\band\\b)\\s*(?:${allAliases})\\b|$)`,
              "i"
            )
          )?.[1]
          ?.trim()
          .replace(/^['\"]|['\"]$/g, "");
        if (value && setNativeFieldValue(field, value)) filled += 1;
      });

      if (!filled) {
        const firstField = fields[0] ? getFieldLabel(fields[0]) : "a visible field";
        setMessage(`Enter ${firstField} followed by its value.`, 2, "form-command-help", {
          force: true,
          bypassCooldown: true,
          animation: "stateThinking",
        });
        return true;
      }

      setFormCommand("");
      const asksToSignOffer = /(?:sign|accept).*(?:offer|letter)|(?:offer|letter).*(?:sign|accept)/i.test(
        command
      );
      setConfirmOffer(Boolean(asksToSignOffer && pathname?.includes("/offer")));
      const required = fields.filter((field) => field.required);
      const remaining = required.filter(isFieldEmpty).length;
      const progress = required.length
        ? ` Step ${required.length - remaining} of ${required.length}; ${remaining} left.`
        : "";
      setMessage(`Filled ${filled} field${filled === 1 ? "" : "s"}.${progress}`, 2, `form-command:${Date.now()}`, {
        force: true,
        bypassCooldown: true,
        animation: "stateHappy",
      });
      setTimeout(() => refreshFormGuidance({ force: true }), 0);
      return true;
    },
    []
  );

  const commandPlaceholderFn = useCallback((fields) => {
    const labels = fields.slice(0, 2).map(getFieldLabel).filter(Boolean);
    return labels.length
      ? `Fill: ${labels.join(", ")}${labels.length > 1 ? "…" : ""}`
      : "Ask Candidate Assistant…";
  }, []);

  const handleConfirmOffer = useCallback(() => {
    setConfirmOffer(false);
    const signBtn = document.querySelector("button[type='submit'], button.sign-btn, button.accept-btn");
    if (signBtn) signBtn.click();
  }, []);

  const confirmActionButton = confirmOffer ? (
    <button type="button" className={styles.confirmAction} onClick={handleConfirmOffer}>
      Review & accept offer
    </button>
  ) : null;

  return (
    <BaseMascot
      openChat={openChat}
      toggleChat={toggleChat}
      roleLabel="Candidate"
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
      confirmAction={confirmActionButton}
    />
  );
}

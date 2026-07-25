"use client";

import { useCallback, useState } from "react";
import BaseMascot, {
  setNativeFieldValue,
  visibleFormFields,
} from "@/components/mascot/BaseMascot";
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
import { globalSearch } from "@/services/authService";
import styles from "@/components/mascot/BaseMascot.module.css";

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

function getVisibleForms() {
  return Array.from(document.querySelectorAll("form")).filter(
    (form) => form.offsetParent !== null && !form.hasAttribute("data-mascot-command")
  );
}

function isFieldEmpty(field) {
  if (field.type === "checkbox" || field.type === "radio") return !field.checked;
  const value = typeof field.value === "string" ? field.value.trim() : field.value;
  if (field.tagName === "SELECT") return !value;
  return !value;
}

export default function RecruiterMascot({ openChat, toggleChat }) {
  const [confirmInvite, setConfirmInvite] = useState(false);

  const handleFormCommand = useCallback(
    async (
      command,
      { pathname, router, setMessage, triggerState, refreshFormGuidance, setFormCommand }
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
            `Found ${match.full_name}. Opening their ${match.type} record.`,
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

      const fields = visibleFormFields();
      const allAliases = Object.values(COMMAND_FIELDS).flat().join("|");
      let filled = 0;
      fields.forEach((field) => {
        const identifier = `${field.name || ""} ${field.id || ""} ${getFieldLabel(field)}`
          .toLowerCase()
          .replace(/[_-]/g, " ");
        const aliases = Object.entries(COMMAND_FIELDS)
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
      const asksToSendInvite = /(?:send|bhej|bhj).*(?:invite|invitation)|(?:invite|invitation).*(?:send|bhej|bhj)/i.test(
        command
      );
      setConfirmInvite(Boolean(asksToSendInvite && pathname?.includes("/invite")));
      const required = fields.filter((field) => field.required);
      const remaining = required.filter(isFieldEmpty).length;
      const progress = required.length
        ? ` Step ${required.length - remaining} of ${required.length}; ${remaining} left.`
        : "";
      const sendNote =
        asksToSendInvite && pathname?.includes("/invite")
          ? " Review the details, then confirm sending."
          : asksToSendInvite
          ? " Offers can be sent after candidate onboarding and document review."
          : "";
      setMessage(
        `Filled ${filled} field${filled === 1 ? "" : "s"}.${progress}${sendNote}`,
        2,
        `form-command:${Date.now()}`,
        {
          force: true,
          bypassCooldown: true,
          animation: "stateHappy",
        }
      );
      setTimeout(() => refreshFormGuidance({ force: true }), 0);
      return true;
    },
    []
  );

  const commandPlaceholderFn = useCallback((fields) => {
    const labels = fields.slice(0, 2).map(getFieldLabel).filter(Boolean);
    return labels.length
      ? `Fill: ${labels.join(", ")}${labels.length > 1 ? "…" : ""}`
      : "Search employee or candidate";
  }, []);

  const handleConfirmInvite = useCallback(() => {
    const inviteForm = getVisibleForms()[0];
    if (!inviteForm) return;
    setConfirmInvite(false);
    inviteForm.requestSubmit();
  }, []);

  const confirmActionButton = confirmInvite ? (
    <button type="button" className={styles.confirmAction} onClick={handleConfirmInvite}>
      Review & send invitation
    </button>
  ) : null;

  return (
    <BaseMascot
      openChat={openChat}
      toggleChat={toggleChat}
      roleLabel="Recruiter"
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
      confirmAction={confirmActionButton}
    />
  );
}

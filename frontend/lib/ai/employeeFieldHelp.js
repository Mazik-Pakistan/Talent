"use client";

import { FIELD_HELP, HOVER_HELP, fieldHelpFor as pathFieldHelp } from "@/lib/ai/fieldHelp";

/** Page briefs for employee partner intro (what + why). */
export const EMPLOYEE_PAGE_SUMMARIES = {
  dashboard: {
    title: "Employee dashboard",
    what: "See announcements, employment status, and what onboarding still needs.",
    why: "Gives you a single place to know what’s next at work.",
  },
  onboarding: {
    title: "Employee onboarding",
    what: "Complete emergency contact, banking, references, policies, and NDA.",
    why: "HR needs these details before payroll and day-one access can finish.",
  },
  documents: {
    title: "Your documents",
    what: "Upload identity and employment files and track verification.",
    why: "Clear documents unblock compliance checks and keep your record complete.",
  },
  learning: {
    title: "Learning hub",
    what: "Take assigned courses, track progress, and close skill gaps.",
    why: "Keeps mandatory training on schedule and grows your role readiness.",
  },
  talent: {
    title: "My Talent",
    what: "Review your journey, achievements, and internal opportunities.",
    why: "Helps you see growth paths inside the company.",
  },
  profile: {
    title: "Your profile",
    what: "Update personal and employment information.",
    why: "Payroll, compliance, and teammates rely on accurate details.",
  },
};

function fieldLabel(field) {
  const labelEl = field?.closest?.("label");
  return (labelEl?.querySelector("span")?.textContent || labelEl?.textContent || field?.placeholder || "")
    .trim()
    .replace(/\*$/, "")
    .trim();
}

/** Adapter: BaseMascot passes a DOM field; employee FIELD_HELP is path-keyed. */
export function employeeFieldHelpFor(field) {
  if (!field) return null;
  const name = (field.name || field.id || "").replace(/-/g, "_");
  const label = fieldLabel(field);

  if (name && FIELD_HELP[name]) return FIELD_HELP[name];

  const pathGuesses = [
    name,
    name.includes(".") ? name : null,
    `personal.${name}`,
    `emergency.${name}`,
    `employment.${name}`,
    `references.${name}`,
    `nda.${name}`,
    `documents.${name}`,
  ].filter(Boolean);

  for (const path of pathGuesses) {
    const tip = pathFieldHelp(path, label);
    if (tip && !tip.startsWith("You're editing")) return tip;
  }

  if (label) {
    for (const [key, tip] of Object.entries(FIELD_HELP)) {
      const leaf = key.split(".").pop().replace(/_/g, " ");
      if (label.toLowerCase().includes(leaf)) return tip;
    }
    return `“${label}” — fill this carefully; it becomes part of your employee record.`;
  }

  return pathFieldHelp(name, label);
}

export function employeePageSummaryFor(pathname, context = null) {
  if (!pathname) return null;

  if (pathname.includes("/complete-profile")) {
    const section = context?.section || context?.tab;
    const label = context?.label;
    if (section || label) {
      return {
        key: `onboarding-${section || "step"}`,
        title: label || "Onboarding step",
        what: context?.hint || HOVER_HELP[section] || EMPLOYEE_PAGE_SUMMARIES.onboarding.what,
        why: EMPLOYEE_PAGE_SUMMARIES.onboarding.why,
      };
    }
    return { key: "onboarding", ...EMPLOYEE_PAGE_SUMMARIES.onboarding };
  }

  if (pathname.includes("/documents")) return { key: "documents", ...EMPLOYEE_PAGE_SUMMARIES.documents };
  if (pathname.includes("/learning")) return { key: "learning", ...EMPLOYEE_PAGE_SUMMARIES.learning };
  if (pathname.includes("/talent")) return { key: "talent", ...EMPLOYEE_PAGE_SUMMARIES.talent };
  if (pathname.includes("/profile")) {
    const section = context?.section;
    if (section && HOVER_HELP[section]) {
      return {
        key: `profile-${section}`,
        title: context?.label || "Profile section",
        what: HOVER_HELP[section],
        why: EMPLOYEE_PAGE_SUMMARIES.profile.why,
      };
    }
    return { key: "profile", ...EMPLOYEE_PAGE_SUMMARIES.profile };
  }
  if (pathname.includes("/dashboard/employee")) {
    return { key: "dashboard", ...EMPLOYEE_PAGE_SUMMARIES.dashboard };
  }

  return {
    key: "employee",
    title: "Employee partner",
    what: "I explain this page and can guide you through forms step by step.",
    why: "You stay in control — I highlight what’s next and why it matters.",
  };
}

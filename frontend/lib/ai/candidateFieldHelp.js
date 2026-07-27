"use client";

import { getFieldLabel, isOpaqueDomId } from "@/lib/ai/formCoach";

/** Field tips when a candidate focuses an input. */
export const CANDIDATE_FIELD_HELP = {
  full_name: "Use your legal full name as it appears on your CNIC / passport.",
  first_name: "Legal first name — must match your ID documents.",
  last_name: "Legal last / family name — must match your ID documents.",
  email: "Use an email you check often — offer and interview updates go here.",
  phone: "Primary contact number with country code if possible.",
  cnic: "CNIC / national ID in the format XXXXX-XXXXXXX-X.",
  date_of_birth: "Date of birth exactly as on your national ID.",
  gender: "Select the option that matches your official records.",
  address: "Current residential address where you can be reached.",
  city: "City of your current address.",
  country: "Country of residence.",
  degree: "Highest or relevant degree title (e.g. BS Computer Science).",
  institution: "University / college / institute name.",
  field_of_study: "Major or specialization.",
  year: "Graduation or expected completion year.",
  skills: "Comma-separated skills recruiters search for (e.g. React, SQL, Python).",
  job_title: "Recent or target role title.",
  company: "Employer or organization name.",
  agree: "Confirm you have read and accept the offer terms before signing.",
  signature: "Sign in the box with your full legal name as on the offer.",
};

export const CANDIDATE_PAGE_SUMMARIES = {
  dashboard: {
    title: "Candidate dashboard",
    what: "See what’s next: onboarding, documents, offer, and interviews.",
    why: "Keeps your hiring journey clear so nothing important is missed.",
  },
  onboarding: {
    title: "Candidate onboarding",
    what: "Complete personal details, education, and skills for your application.",
    why: "Recruiters use this to verify you and move you to the next hiring step.",
  },
  profile: {
    title: "Edit your profile",
    what: "Update personal, education, and skills information.",
    why: "Accurate details keep your application and future offer records correct.",
  },
  documents: {
    title: "Your documents",
    what: "Upload and track identity and supporting files.",
    why: "Clear, verified documents unblock offer and background checks.",
  },
  offer: {
    title: "Offer letter",
    what: "Review compensation and terms, then accept or decline.",
    why: "This is your formal decision point — read carefully before signing.",
  },
};

export const CANDIDATE_STEP_HELP = {
  personal: {
    title: "Personal & contact",
    hint: "Fill legal name, CNIC, contact, and address so recruiters can verify you.",
    fields: ["full_name", "email", "phone", "cnic", "date_of_birth", "address", "city"],
  },
  education: {
    title: "Education",
    hint: "Add degrees and institutions — verification often starts here.",
    fields: ["degree", "institution", "field_of_study", "year"],
  },
  skills: {
    title: "Skills & experience",
    hint: "List skills and recent roles so matching and screening stay accurate.",
    fields: ["skills", "job_title", "company"],
  },
  submit: {
    title: "Review & submit",
    hint: "Check every section once, then submit your onboarding record.",
    fields: [],
  },
};

export function candidateFieldHelpFor(field) {
  if (!field) return null;
  const dataKey = field.getAttribute?.("data-field-key") || "";
  const rawName = dataKey || field.name || (isOpaqueDomId(field.id) ? "" : field.id) || "";
  const name = String(rawName).toLowerCase().replace(/-/g, "_");
  if (name && CANDIDATE_FIELD_HELP[name]) return CANDIDATE_FIELD_HELP[name];

  const short = name.split(".").pop();
  if (short && CANDIDATE_FIELD_HELP[short]) return CANDIDATE_FIELD_HELP[short];

  const label = getFieldLabel(field);
  if (label && label !== "This field") {
    for (const [key, tip] of Object.entries(CANDIDATE_FIELD_HELP)) {
      if (label.toLowerCase().includes(key.replace(/_/g, " "))) return tip;
    }
    return `“${label}” — fill this carefully; it becomes part of your hiring record.`;
  }

  return null;
}

export function candidatePageSummaryFor(pathname, context = null) {
  if (!pathname) return null;

  if (pathname.includes("/onboarding")) {
    const isProfile = typeof window !== "undefined" && /(?:\?|&)edit=true\b/.test(window.location.search);
    const step = context?.step || context?.section;
    const stepHelp = step ? CANDIDATE_STEP_HELP[step] : null;
    if (stepHelp) {
      return {
        key: `onboarding-${step}`,
        title: isProfile ? `Profile · ${stepHelp.title}` : stepHelp.title,
        what: stepHelp.hint,
        why: isProfile
          ? "Updates here keep your candidate record current for recruiters."
          : CANDIDATE_PAGE_SUMMARIES.onboarding.why,
      };
    }
    return {
      key: isProfile ? "profile" : "onboarding",
      ...(isProfile ? CANDIDATE_PAGE_SUMMARIES.profile : CANDIDATE_PAGE_SUMMARIES.onboarding),
    };
  }

  if (pathname.includes("/documents")) return { key: "documents", ...CANDIDATE_PAGE_SUMMARIES.documents };
  if (pathname.includes("/offer")) return { key: "offer", ...CANDIDATE_PAGE_SUMMARIES.offer };
  if (pathname.includes("/dashboard/candidate")) {
    return { key: "dashboard", ...CANDIDATE_PAGE_SUMMARIES.dashboard };
  }

  return {
    key: "candidate",
    title: "Candidate partner",
    what: "I explain this page and can guide you through forms step by step.",
    why: "You stay in control — I highlight what’s next and why it matters.",
  };
}

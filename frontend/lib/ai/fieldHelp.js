"use client";

/** Field-level help the Copilot shows when an input receives focus. */
export const FIELD_HELP = {
  // Emergency
  "emergency.name": "Enter the full name of someone we can reach if we cannot contact you at work.",
  "emergency.relationship": "How this person relates to you — spouse, parent, sibling, friend…",
  "emergency.phone": "Primary mobile number that answers outside work hours.",
  "emergency.alternate_phone": "Optional backup number for the same contact.",
  "emergency.address": "Where this person can usually be reached.",

  // Banking
  "employment.bank_name": "The bank that holds your salary account.",
  "employment.account_holder_name": "Must match the name on the account — usually your legal name.",
  "employment.account_number": "Your bank account number. Digits only are preferred.",
  "employment.iban": "Pakistani IBAN starts with PK and is 24 characters. Double-check before saving.",
  "employment.branch": "Branch name or city where the account was opened.",
  "employment.branch_code": "Numeric branch code from your cheque or bank letter.",
  "employment.swift_code": "SWIFT / BIC if your bank provides one (optional for local payroll).",
  "employment.tax_id": "NTN or tax ID if you have one (optional).",

  // References
  "references.full_name": "Full name of a professional reference who can vouch for your work.",
  "references.relationship": "How you know them — manager, colleague, mentor…",
  "references.email": "Unique work email for this reference. Each reference needs a different address.",
  "references.phone": "Phone number HR can use to reach them.",
  "references.company": "Company where they work (or worked with you).",

  // Personal (profile)
  "personal.first_name": "Your legal first name as it appears on your National ID.",
  "personal.last_name": "Your legal last name / family name.",
  "personal.date_of_birth": "Date of birth from your National ID.",
  "personal.national_id": "CNIC / NIC format: XXXXX-XXXXXXX-X.",
  "personal.phone": "Your primary mobile number for company communication.",
  "personal.email": "This email will be used for company communication.",
  "personal.current_address": "Where you currently live.",
  "personal.permanent_address": "Your permanent / home address if different.",

  // NDA
  "nda.full_legal_name": "Type your full legal name exactly as on your ID.",
  "nda.agreed": "Confirm you have read and agree to the NDA terms.",
};

export const HOVER_HELP = {
  dashboard: "Your home base — announcements, employment profile, and onboarding status.",
  onboarding: "Complete or review your employee onboarding record here.",
  documents: "Upload your identity and employment documents here.",
  learning: "Assigned courses, skill profile, and career-path recommendations.",
  talent: "Your journey, achievements, and internal opportunities.",
  profile: "This page manages your personal and employment information.",
  "ai-assistant": "Full AI Agent chat — multi-step workflows live here, not in the Copilot.",
  emergency: "Verify emergency contact information carefully.",
  employment: "Verify your banking information carefully before payroll runs.",
  references: "Professional references HR may contact.",
  personal: "This section holds your personal identity details.",
  banking: "Verify your banking information carefully.",
};

export function fieldHelpFor(path, label) {
  if (path && FIELD_HELP[path]) return FIELD_HELP[path];
  const key = Object.keys(FIELD_HELP).find((k) => path && path.endsWith(k.split(".").pop()));
  if (key) return FIELD_HELP[key];
  if (label) return `You're editing ${label}. Fill this carefully — it becomes part of your employee record.`;
  return null;
}

export function hoverHelpFor(key) {
  if (!key) return null;
  return HOVER_HELP[key] || HOVER_HELP[String(key).toLowerCase()] || null;
}

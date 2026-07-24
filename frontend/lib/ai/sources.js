/**
 * Provenance for every value the AI writes into a form.
 *
 * Each filled field carries one of these so the employee can always see where
 * a value came from, and click through for the underlying evidence.
 */

export const AI_SOURCES = {
  candidateProfile: {
    key: "candidateProfile",
    label: "Candidate Profile",
    tone: "blue",
    description: "Read from the personal details you submitted during candidate onboarding.",
  },
  employeeRecord: {
    key: "employeeRecord",
    label: "Employee Record",
    tone: "indigo",
    description: "Read from your official employee record created when you were hired.",
  },
  recruiterData: {
    key: "recruiterData",
    label: "Recruiter Data",
    tone: "violet",
    description: "Provided by your recruiter when your offer was issued.",
  },
  resume: {
    key: "resume",
    label: "Résumé",
    tone: "cyan",
    description: "Extracted from the résumé you uploaded.",
  },
  governmentId: {
    key: "governmentId",
    label: "Government ID",
    tone: "cyan",
    description: "Extracted from your National ID document.",
  },
  ocr: {
    key: "ocr",
    label: "OCR",
    tone: "mint",
    description: "Read directly off the document image using optical character recognition.",
  },
  offerLetter: {
    key: "offerLetter",
    label: "Offer Letter",
    tone: "amber",
    description: "Taken from your signed offer letter.",
  },
  previousStep: {
    key: "previousStep",
    label: "Previous Step",
    tone: "blue",
    description: "Carried forward from a section you already completed.",
  },
  employeeInput: {
    key: "employeeInput",
    label: "You confirmed",
    tone: "mint",
    description: "You entered or confirmed this value yourself.",
  },
};

export function getSource(key) {
  return AI_SOURCES[key] || null;
}

/** Confidence below this needs an explicit human confirmation before saving. */
export const LOW_CONFIDENCE_THRESHOLD = 0.7;

export function confidenceLabel(confidence) {
  if (confidence == null) return null;
  if (confidence >= 0.9) return "High confidence";
  if (confidence >= LOW_CONFIDENCE_THRESHOLD) return "Good confidence";
  if (confidence >= 0.4) return "Needs your check";
  return "Low confidence";
}

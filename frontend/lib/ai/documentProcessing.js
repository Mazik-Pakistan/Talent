/**
 * Unified candidate document-processing activity messages.
 *
 * Shared by Resume, Transcript, and CNIC uploads (plus generic / saving
 * fallbacks). The backend upload API is synchronous
 * (`upload → processing → success/failure`) and does not expose per-stage
 * progress, so the UI rotates through ONE contextual activity at a time while
 * the request is in flight — never fake percentages, checklists, or numbered steps.
 *
 * The final success label is only shown after the real OCR/upload operation
 * succeeds (see DOCUMENT_SUCCESS_LABELS / useDocumentProcessing.succeed).
 */

export const DOCUMENT_TYPE_LABELS = {
  resume: "Resume",
  transcript: "Academic Transcript",
  cnic: "National ID (CNIC / NIC)",
  generic: "Document",
  saving: "Document",
};

/** Shown only once processing has actually succeeded. */
export const DOCUMENT_SUCCESS_LABELS = {
  resume: "Resume analyzed successfully",
  transcript: "Transcript analyzed successfully",
  cnic: "CNIC analyzed successfully",
  generic: "Document analyzed successfully",
  saving: "Document saved successfully",
};

/**
 * Activity message sets per document type. Only the current index is rendered;
 * previous activities are never kept on screen.
 *
 * Use `{fileName}` as a placeholder — resolved by getDocumentActivities().
 */
const DOCUMENT_PROCESSING_ACTIVITIES = {
  resume: [
    "Reading {fileName}…",
    "Extracting text from your resume…",
    "Understanding your education and qualifications…",
    "Identifying your skills and experience…",
    "Preparing your profile information…",
  ],
  transcript: [
    "Reading your transcript…",
    "Extracting academic information…",
    "Understanding your subjects and grades…",
    "Identifying your degree and program…",
    "Organizing your academic information…",
  ],
  cnic: [
    "Reading your CNIC…",
    "Extracting identity information…",
    "Understanding your document details…",
    "Preparing your profile information…",
  ],
  generic: [
    "Reading your document…",
    "Extracting information…",
    "Understanding your document…",
    "Organizing the details…",
  ],
  // Plain document types the backend only stores (no extraction) — never
  // claim "extracting" for them.
  saving: [
    "Saving your document…",
    "Adding it to your document centre…",
  ],
};

/** @deprecated Use getDocumentActivities — kept so existing key lookups still work. */
export const DOCUMENT_PROCESSING_STEPS = DOCUMENT_PROCESSING_ACTIVITIES;

/**
 * Returns the ordered activity strings for a document type, with the optional
 * file name interpolated into `{fileName}` placeholders.
 */
export function getDocumentActivities(documentType, fileName) {
  const normalized = normalizeDocumentType(documentType);
  const templates =
    DOCUMENT_PROCESSING_ACTIVITIES[normalized] || DOCUMENT_PROCESSING_ACTIVITIES.generic;
  const displayName = String(fileName || "").trim() || "your document";
  return templates.map((template) => template.replace(/\{fileName\}/g, displayName));
}

/**
 * Maps the existing upload-flow identifiers onto the shared document types.
 * Accepts onboarding `purpose` values or documents-page `doc_type` values.
 * Explicit message-set keys (e.g. "saving") pass through untouched.
 */
export function normalizeDocumentType(value) {
  const normalized = String(value || "").toLowerCase().replace(/[\s_-]+/g, "_");
  if (normalized in DOCUMENT_PROCESSING_ACTIVITIES) return normalized;
  if (["government_doc", "cnic", "nic", "passport", "national_id", "identity"].includes(normalized)) {
    return "cnic";
  }
  if (["education_cert", "transcript", "certificate", "degree"].includes(normalized)) {
    return "transcript";
  }
  if (["resume", "cv"].includes(normalized)) {
    return "resume";
  }
  return "generic";
}

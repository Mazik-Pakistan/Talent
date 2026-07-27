"use client";

import DocumentOcrPanel from "./DocumentOcrPanel";
import styles from "./AiExperience.module.css";

/**
 * Full-screen light OCR session used while onboarding documents are scanned
 * and fields are typewriter-filled into the form.
 */
export default function OcrScanOverlay({
  open,
  title = "Reading your document",
  subtitle = "Extracting fields",
  previewUrl,
  fileName,
  scanning,
  stage,
  fieldDefs = [],
  typedValues = {},
  revealed = [],
  typingKey = null,
  confidence = {},
  progress = 0,
  error = null,
}) {
  if (!open) return null;

  return (
    <div className={styles.ocrOverlay} role="status" aria-live="polite" data-mascot-busy>
      <div className={styles.ocrOverlayCard}>
        <DocumentOcrPanel
          title={title}
          subtitle={subtitle}
          previewUrl={previewUrl}
          fileName={fileName}
          scanning={scanning}
          stage={stage}
          fieldDefs={fieldDefs}
          typedValues={typedValues}
          revealed={revealed}
          typingKey={typingKey}
          confidence={confidence}
          progress={progress}
          error={error}
          note="Values are being written into your form — review and edit anytime after."
          emptyHint="Hang tight — extracted fields will appear here one by one."
        />
      </div>
    </div>
  );
}

export const CNIC_OCR_FIELDS = [
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
  { key: "father_name", label: "Father's name" },
  { key: "national_id", label: "National ID" },
  { key: "date_of_birth", label: "Date of birth" },
  { key: "gender", label: "Gender" },
  { key: "nationality", label: "Nationality" },
  { key: "marital_status", label: "Marital status" },
  { key: "id_issue_date", label: "ID issue date" },
  { key: "id_expiry_date", label: "ID expiry date" },
];

export const RESUME_OCR_FIELDS = [
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
  { key: "date_of_birth", label: "Date of birth" },
  { key: "current_address", label: "Address" },
  { key: "summary", label: "Summary" },
  { key: "technical_skills", label: "Technical skills" },
  { key: "soft_skills", label: "Soft skills" },
];

export const EDUCATION_OCR_FIELDS = (index = 0) => [
  { key: `edu_${index}_institution`, label: "Institution" },
  { key: `edu_${index}_degree`, label: "Degree" },
  { key: `edu_${index}_field_of_study`, label: "Field of study" },
  { key: `edu_${index}_year_completed`, label: "Year" },
  { key: `edu_${index}_cgpa_or_percentage`, label: "CGPA / %" },
];

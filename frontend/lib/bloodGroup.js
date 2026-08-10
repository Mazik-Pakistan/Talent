/** Blood group options and helpers shared by onboarding + employee profile. */

export const BLOOD_GROUP_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

export const BLOOD_GROUP_OPTIONS = ["N/A", ...BLOOD_GROUP_TYPES];

export const BLOOD_GROUP_HINT =
  "N/A is temporary — update it as soon as you know your type. Blood group is used in emergencies, so only select a type if you are sure.";

/**
 * Canonicalize stored / drafted blood group values.
 * Legacy "unknown" and empty → "N/A".
 */
export function normalizeBloodGroup(value) {
  const raw = (value || "").trim();
  if (!raw || raw.toLowerCase() === "unknown") return "N/A";
  return raw;
}

/** True when the person still needs to verify a real blood type. */
export function isBloodGroupPending(value) {
  const normalized = normalizeBloodGroup(value);
  return normalized === "N/A" || !BLOOD_GROUP_TYPES.includes(normalized);
}

/** Display label for recruiters / read-only views. */
export function formatBloodGroupDisplay(value, { pendingSuffix = " — needs update" } = {}) {
  const normalized = normalizeBloodGroup(value);
  if (isBloodGroupPending(normalized)) {
    return `N/A${pendingSuffix}`;
  }
  return normalized;
}

/**
 * True when selecting a real blood type that differs from the current value.
 * Callers should show an in-app confirm dialog (not window.confirm).
 */
export function needsBloodGroupConfirmation(next, previous) {
  const normalizedNext = normalizeBloodGroup(next);
  const normalizedPrev = normalizeBloodGroup(previous);
  return !isBloodGroupPending(normalizedNext) && normalizedNext !== normalizedPrev;
}

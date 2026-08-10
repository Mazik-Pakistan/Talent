/**
 * Parse a backend 422 detail array into per-field errors.
 * Errors whose `loc` matches a known form field become field errors;
 * anything else is returned as a single general message.
 */
export function parseFieldErrors(error, knownFields) {
  const fieldErrors = {};
  let general = null;
  const detail = error?.response?.data?.detail;
  if (Array.isArray(detail)) {
    for (const item of detail) {
      const raw = item?.msg || item?.message;
      if (!raw) continue;
      const loc = item?.loc || [];
      const field = typeof loc[loc.length - 1] === "string" ? loc[loc.length - 1] : null;
      const message = String(raw)
        .replace(/^Value error,\s*/i, "")
        .replace(/^Assertion failed,\s*/i, "")
        .trim();
      if (field && knownFields.includes(field)) {
        fieldErrors[field] = message;
      } else {
        general = general || message;
      }
    }
  }
  return { fieldErrors, general };
}

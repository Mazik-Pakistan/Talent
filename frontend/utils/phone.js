/** Pakistan mobile: normalize to 03XXXXXXXXX (11 digits). */

export function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

export function normalizePkMobile(value) {
  let digits = digitsOnly(value);
  if (digits.startsWith("92") && digits.length === 12) {
    digits = `0${digits.slice(2)}`;
  } else if (digits.startsWith("3") && digits.length === 10) {
    digits = `0${digits}`;
  }
  return digits;
}

export function isValidPkMobile(value) {
  return /^03\d{9}$/.test(normalizePkMobile(value));
}

/** Format as 03XX-XXXXXXX while typing / for display. */
export function formatPkMobileDisplay(value) {
  const digits = normalizePkMobile(value).slice(0, 11);
  if (digits.length <= 4) return digits;
  return `${digits.slice(0, 4)}-${digits.slice(4)}`;
}

export function formatPkMobileInput(value) {
  const digits = digitsOnly(value).slice(0, 12);
  let normalized = digits;
  if (normalized.startsWith("92")) {
    normalized = `0${normalized.slice(2)}`;
  } else if (normalized.startsWith("3") && !normalized.startsWith("03")) {
    normalized = `0${normalized}`;
  }
  normalized = normalized.slice(0, 11);
  if (normalized.length <= 4) return normalized;
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

export const PK_MOBILE_HINT = "Format: 03XX-XXXXXXX";

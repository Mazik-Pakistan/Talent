/**
 * Frontend validation utilities that match backend validation patterns.
 */

const MIN_DOB_AGE = 14;

/**
 * Return the latest valid DOB string (YYYY-MM-DD) for date input `max` attribute.
 * The user must be at least MIN_DOB_AGE years old.
 * @returns {string} YYYY-MM-DD representing today minus MIN_DOB_AGE years
 */
export function getMaxDob() {
  const now = new Date();
  let year = now.getFullYear() - MIN_DOB_AGE;
  let month = now.getMonth();
  let day = now.getDate();

  const candidate = new Date(year, month, day);
  if (candidate.getDate() !== day) {
    day = new Date(year, month + 1, 0).getDate();
  }
  const mm = String(month + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * Validate date of birth: must exist, be valid, not be in the future, and user must be >= MIN_DOB_AGE.
 * Uses date-only parsing to avoid timezone shift issues.
 * @param {string} dateString - Date string in YYYY-MM-DD format
 * @param {string} fieldName - Name of the field for error message
 * @returns {{isValid: boolean, error: string|null}}
 */
export function validateDateOfBirth(dateString, fieldName = "Date of birth") {
  if (!dateString) {
    return { isValid: false, error: `${fieldName} is required.` };
  }

  const parts = String(dateString).split("-");
  if (parts.length !== 3) {
    return { isValid: false, error: `Invalid ${fieldName.toLowerCase()} format.` };
  }
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const parsed = new Date(year, month, day);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month ||
    parsed.getDate() !== day ||
    isNaN(parsed.getTime())
  ) {
    return { isValid: false, error: `Invalid ${fieldName.toLowerCase()}.` };
  }

  const now = new Date();
  const todayYear = now.getFullYear();
  const todayMonth = now.getMonth();
  const todayDay = now.getDate();

  if (year > todayYear || (year === todayYear && month > todayMonth) || (year === todayYear && month === todayMonth && day > todayDay)) {
    return { isValid: false, error: `${fieldName} cannot be in the future.` };
  }

  let age = todayYear - year;
  if (todayMonth < month || (todayMonth === month && todayDay < day)) {
    age--;
  }

  if (age < MIN_DOB_AGE) {
    return { isValid: false, error: `You must be at least ${MIN_DOB_AGE} years old.` };
  }

  return { isValid: true, error: null };
}

// CNIC format: XXXXX-XXXXXXX-X (with or without hyphens)
export const CNIC_REGEX = /^\d{5}-?\d{7}-?\d{1}$/;

// URL validation pattern
export const URL_REGEX = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

// Email validation pattern
export const EMAIL_REGEX = /^\S+@\S+\.\S+$/;

// Password validation pattern (matches backend)
export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s])(?!.*\s).{8,}$/;

// Shared password hint text
export const PASSWORD_HINT_TEXT =
  "Use 8+ characters with uppercase, lowercase, number, special character, and no spaces.";

/**
 * Validate Pakistani CNIC/NIC format (XXXXX-XXXXXXX-X).
 * @param {string} value - CNIC value to validate
 * @returns {{isValid: boolean, error: string|null, normalized: string}}
 */
export function validateCNIC(value) {
  const raw = (value || "").trim();
  
  if (!raw) {
    return {
      isValid: false,
      error: "National ID (CNIC) is required.",
      normalized: raw
    };
  }
  
  // Check if it matches the CNIC pattern with or without hyphens
  if (!CNIC_REGEX.test(raw)) {
    return {
      isValid: false,
      error: "Enter a valid Pakistani CNIC/NIC (format: XXXXX-XXXXXXX-X).",
      normalized: raw
    };
  }
  
  // Remove any non-digit characters for normalization
  const digits = raw.replace(/\D/g, "");
  
  // Format with hyphens for consistency: XXXXX-XXXXXXX-X
  let normalized = raw;
  if (digits.length === 13 && !raw.includes("-")) {
    normalized = `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
  }
  
  return {
    isValid: true,
    error: null,
    normalized
  };
}

/**
 * Validate date is not in the future.
 * NOTE: For Date of Birth fields, use validateDateOfBirth instead which also enforces minimum age.
 * @param {string} dateString - Date string in YYYY-MM-DD format
 * @param {string} fieldName - Name of the field for error message
 * @returns {{isValid: boolean, error: string|null}}
 */
export function validateDateNotFuture(dateString, fieldName = "date") {
  if (!dateString) {
    return {
      isValid: false,
      error: `${fieldName} is required.`
    };
  }
  
  const inputDate = new Date(dateString);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  if (inputDate > today) {
    return {
      isValid: false,
      error: `${fieldName} cannot be in the future.`
    };
  }
  
  return {
    isValid: true,
    error: null
  };
}

/**
 * Validate date is not in the past (for future dates like start dates).
 * @param {string} dateString - Date string in YYYY-MM-DD format
 * @param {string} fieldName - Name of the field for error message
 * @returns {{isValid: boolean, error: string|null}}
 */
export function validateDateNotPast(dateString, fieldName = "date") {
  if (!dateString) {
    return {
      isValid: false,
      error: `${fieldName} is required.`
    };
  }
  
  const inputDate = new Date(dateString);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  if (inputDate < today) {
    return {
      isValid: false,
      error: `${fieldName} cannot be in the past.`
    };
  }
  
  return {
    isValid: true,
    error: null
  };
}

/**
 * Validate URL format.
 * @param {string} value - URL to validate
 * @param {string} fieldName - Name of the field for error message
 * @returns {{isValid: boolean, error: string|null, normalized: string}}
 */
export function validateURL(value, fieldName = "URL") {
  if (!value) {
    return {
      isValid: true,
      error: null,
      normalized: ""
    };
  }
  
  const cleaned = value.trim();
  if (!cleaned) {
    return {
      isValid: true,
      error: null,
      normalized: ""
    };
  }
  
  if (!URL_REGEX.test(cleaned)) {
    return {
      isValid: false,
      error: `Enter a valid ${fieldName} (must start with http:// or https://).`,
      normalized: cleaned
    };
  }
  
  return {
    isValid: true,
    error: null,
    normalized: cleaned
  };
}

/**
 * Basic HTML sanitization to prevent XSS.
 * @param {string} value - Text to sanitize
 * @returns {string} Sanitized text
 */
export function sanitizeHTML(value) {
  if (!value) return "";
  
  let sanitized = value
    // Remove script tags
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    // Remove event handlers
    .replace(/on\w+="[^"]*"/gi, "")
    .replace(/on\w+='[^']*'/gi, "")
    .replace(/on\w+=\S*/gi, "")
    // Remove javascript: protocol
    .replace(/javascript:/gi, "")
    // Remove other potentially dangerous tags
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, "")
    .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, "")
    .replace(/<link\b[^<]*(?:(?!<\/link>)<[^<]*)*<\/link>/gi, "");
  
  return sanitized.trim();
}

/**
 * Validate year completed (education).
 * @param {string} year - Year string
 * @returns {{isValid: boolean, error: string|null}}
 */
export function validateYearCompleted(year) {
  if (!year) {
    return {
      isValid: false,
      error: "Year completed is required."
    };
  }
  
  const currentYear = new Date().getFullYear();
  
  // Check if it's a 4-digit number
  if (!/^\d{4}$/.test(year)) {
    return {
      isValid: false,
      error: "Year completed must be a valid 4-digit year."
    };
  }
  
  const yearNum = parseInt(year, 10);
  
  if (yearNum > currentYear) {
    return {
      isValid: false,
      error: "Year completed cannot be in the future."
    };
  }
  
  if (yearNum < 1900) {
    return {
      isValid: false,
      error: "Year completed must be after 1900."
    };
  }
  
  return {
    isValid: true,
    error: null
  };
}

/**
 * Validate CGPA or percentage format.
 * @param {string} value - CGPA or percentage value
 * @returns {{isValid: boolean, error: string|null, normalized: string}}
 */
export function validateCgpaOrPercentage(value) {
  if (!value) {
    return {
      isValid: true,
      error: null,
      normalized: ""
    };
  }
  
  const cleaned = value.trim();
  if (!cleaned) {
    return {
      isValid: true,
      error: null,
      normalized: ""
    };
  }
  
  // Check if it's a percentage (e.g., "85%", "85", "85.5%")
  if (/^\d+(\.\d+)?%?$/.test(cleaned)) {
    // Extract numeric value
    const numStr = cleaned.replace("%", "");
    const num = parseFloat(numStr);
    
    if (isNaN(num)) {
      return {
        isValid: false,
        error: "Invalid percentage format.",
        normalized: cleaned
      };
    }
    
    if (num < 0 || num > 100) {
      return {
        isValid: false,
        error: "Percentage must be between 0 and 100.",
        normalized: cleaned
      };
    }
    
    return {
      isValid: true,
      error: null,
      normalized: cleaned
    };
  }
  
  // Check if it's CGPA (e.g., "3.5/4.0", "3.5")
  if (/^\d+(\.\d+)?(\/\d+(\.\d+)?)?$/.test(cleaned)) {
    try {
      if (cleaned.includes("/")) {
        const parts = cleaned.split("/");
        if (parts.length === 2) {
          const cgpa = parseFloat(parts[0]);
          const maxCgpa = parseFloat(parts[1]);
          
          if (isNaN(cgpa) || isNaN(maxCgpa)) {
            return {
              isValid: false,
              error: "Invalid CGPA format.",
              normalized: cleaned
            };
          }
          
          if (cgpa < 0 || cgpa > maxCgpa) {
            return {
              isValid: false,
              error: `CGPA must be between 0 and ${maxCgpa}.`,
              normalized: cleaned
            };
          }
        }
      } else {
        const cgpa = parseFloat(cleaned);
        
        if (isNaN(cgpa)) {
          return {
            isValid: false,
            error: "Invalid CGPA format.",
            normalized: cleaned
          };
        }
        
        if (cgpa < 0 || cgpa > 4.0) {
          return {
            isValid: false,
            error: "CGPA must be between 0 and 4.0.",
            normalized: cleaned
          };
        }
      }
      
      return {
        isValid: true,
        error: null,
        normalized: cleaned
      };
    } catch (error) {
      return {
        isValid: false,
        error: "Invalid CGPA format.",
        normalized: cleaned
      };
    }
  }
  
  return {
    isValid: false,
    error: "Enter a valid percentage (e.g., 85%) or CGPA (e.g., 3.5/4.0).",
    normalized: cleaned
  };
}

/**
 * Validate numeric range.
 * @param {number} value - Numeric value
 * @param {number} min - Minimum value (inclusive)
 * @param {number} max - Maximum value (inclusive)
 * @param {string} fieldName - Name of the field for error message
 * @returns {{isValid: boolean, error: string|null}}
 */
export function validateNumericRange(value, min, max, fieldName = "value") {
  if (value === null || value === undefined) {
    return {
      isValid: false,
      error: `${fieldName} is required.`
    };
  }
  
  if (typeof value !== "number" || isNaN(value)) {
    return {
      isValid: false,
      error: `${fieldName} must be a number.`
    };
  }
  
  if (value < min || value > max) {
    return {
      isValid: false,
      error: `${fieldName} must be between ${min} and ${max}.`
    };
  }
  
  return {
    isValid: true,
    error: null
  };
}

/**
 * Validate text field with length constraints.
 * @param {string} value - Text value
 * @param {number} minLength - Minimum length
 * @param {number} maxLength - Maximum length
 * @param {string} fieldName - Name of the field for error message
 * @returns {{isValid: boolean, error: string|null, normalized: string}}
 */
export function validateTextField(value, minLength, maxLength, fieldName = "field") {
  const cleaned = (value || "").trim();
  
  if (!cleaned && minLength > 0) {
    return {
      isValid: false,
      error: `${fieldName} is required.`,
      normalized: cleaned
    };
  }
  
  if (cleaned.length < minLength) {
    return {
      isValid: false,
      error: `${fieldName} must be at least ${minLength} characters.`,
      normalized: cleaned
    };
  }
  
  if (cleaned.length > maxLength) {
    return {
      isValid: false,
      error: `${fieldName} must be no more than ${maxLength} characters.`,
      normalized: cleaned
    };
  }
  
  return {
    isValid: true,
    error: null,
    normalized: cleaned
  };
}
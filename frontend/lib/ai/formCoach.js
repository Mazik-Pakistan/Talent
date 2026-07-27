"use client";

/**
 * Shared form-coaching helpers for partner mascots (all roles).
 * Guides required fields, then offers optional ones (fill or skip).
 */

/** React useId() values look like `:r1:`, `:R1f:`, `_R_abc` — never show those as labels. */
export function isOpaqueDomId(value) {
  const id = String(value || "").trim();
  if (!id) return true;
  if (id.startsWith(":") || id.endsWith(":")) return true;
  if (id.includes("«") || id.includes("»")) return true;
  if (/^_?R[_:]/i.test(id)) return true;
  // e.g. "r 1f" / "R1f" after underscore→space mangling
  if (/^[rR][\s_]?\d/.test(id) && id.length < 12) return true;
  return false;
}

function cleanLabelText(raw) {
  return String(raw || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\*$/, "")
    .trim()
    .slice(0, 48);
}

function labelTextFromElement(labelEl, field) {
  if (!labelEl) return "";
  // Clone and strip controls so we don't pick up input values as the "label".
  try {
    const clone = labelEl.cloneNode(true);
    clone.querySelectorAll("input, select, textarea, button, svg, [aria-hidden='true']").forEach((el) => el.remove());
    const span = clone.querySelector("span");
    return cleanLabelText(span?.textContent || clone.textContent);
  } catch {
    return cleanLabelText(labelEl.textContent);
  }
}

export function isCoachableField(field) {
  if (!field || field.disabled || field.readOnly) return false;
  if (field.offsetParent === null) return false;
  if (["hidden", "submit", "button", "file", "password"].includes(field.type)) return false;
  if (field.closest("[data-mascot-command]")) return false;
  return true;
}

/** Only intentional create/edit forms — not every filter bar on the page. */
export function isCoachableForm(form) {
  if (!form || form.offsetParent === null) return false;
  if (form.hasAttribute("data-mascot-command")) return false;
  if (form.hasAttribute("data-partner-ignore")) return false;
  if (form.hasAttribute("data-partner-coach")) return true;

  // Heuristic: a real workflow form usually has at least one required field.
  const fields = Array.from(form.querySelectorAll("input, select, textarea")).filter(isCoachableField);
  return fields.some((field) => field.required);
}

/**
 * Collect coachable containers: real <form> elements plus any element explicitly
 * tagged with data-partner-coach (e.g. div-based edit sections on profile pages).
 */
function collectCoachableContainers(root) {
  const forms = Array.from(root.querySelectorAll("form")).filter(isCoachableForm);
  const tagged = Array.from(root.querySelectorAll("[data-partner-coach]")).filter(
    (el) =>
      el.tagName !== "FORM" &&
      el.offsetParent !== null &&
      !el.hasAttribute("data-mascot-command") &&
      !el.hasAttribute("data-partner-ignore")
  );
  // De-dupe nested tagged containers (keep outermost only).
  const containers = [...forms, ...tagged];
  return containers.filter(
    (el) => !containers.some((other) => other !== el && other.contains(el))
  );
}

export function fieldKey(field) {
  const dataKey = field?.getAttribute?.("data-field-key");
  if (dataKey) return dataKey;
  if (field?.name) return field.name;
  if (field?.id && !isOpaqueDomId(field.id)) return field.id;
  const label = getFieldLabel(field);
  if (label && label !== "This field") return label;
  return "field";
}

/**
 * Resolve a human-readable label for any role's form controls.
 * Supports htmlFor labels (AiField), wrapping labels, data-field-label, aria-label.
 */
export function getFieldLabel(field) {
  if (!field) return "This field";

  const dataLabel =
    field.getAttribute?.("data-field-label") ||
    field.closest?.("[data-field-label]")?.getAttribute("data-field-label");
  if (dataLabel) {
    const text = cleanLabelText(dataLabel);
    if (text) return text;
  }

  const aria = field.getAttribute?.("aria-label");
  if (aria) {
    const text = cleanLabelText(aria);
    if (text) return text;
  }

  if (field.id && field.ownerDocument) {
    try {
      const byFor = field.ownerDocument.querySelector(`label[for="${CSS.escape(field.id)}"]`);
      const text = labelTextFromElement(byFor, field);
      if (text) return text;
    } catch {
      // CSS.escape / querySelector failures — fall through
    }
  }

  const wrapLabel = field.closest?.("label");
  if (wrapLabel) {
    const text = labelTextFromElement(wrapLabel, field);
    if (text) return text;
  }

  // Common field shells: label sits in a sibling header (AiField layout).
  const shell = field.closest?.("[data-field-root]");
  if (shell) {
    const headLabel = shell.querySelector("label");
    const text = labelTextFromElement(headLabel, field);
    if (text) return text;
  }

  const placeholder = field.getAttribute?.("placeholder");
  if (placeholder) {
    const text = cleanLabelText(placeholder);
    if (text) return text;
  }

  if (field.name && !isOpaqueDomId(field.name)) {
    return cleanLabelText(String(field.name).replace(/_/g, " ")) || "This field";
  }

  // Never surface React useId() as a label.
  return "This field";
}

export function isFieldFilled(field) {
  if (!field) return false;
  if (field.type === "checkbox" || field.type === "radio") return Boolean(field.checked);
  if (field.tagName === "SELECT") return Boolean(field.value);
  const value = typeof field.value === "string" ? field.value.trim() : field.value;
  return Boolean(value);
}

function formHasUnsetRequired(form) {
  return Array.from(form.querySelectorAll("input, select, textarea"))
    .filter(isCoachableField)
    .some((field) => field.required && !isFieldFilled(field));
}

/**
 * Collect steps from ONE primary form so Invite and Learning don't blend into one checklist.
 */
export function collectFormSteps(root = typeof document !== "undefined" ? document : null) {
  if (!root) return [];
  const forms = collectCoachableContainers(root);
  if (!forms.length) return [];

  const marked = forms.filter((form) => form.hasAttribute("data-partner-coach"));
  const pool = marked.length ? marked : forms;
  const form = pool.find(formHasUnsetRequired) || pool[0];
  if (!form) return [];

  const steps = [];
  const seen = new Set();
  Array.from(form.querySelectorAll("input, select, textarea"))
    .filter(isCoachableField)
    .forEach((field) => {
      const key = fieldKey(field);
      const dedupe = `${key}:${field.type}`;
      if (seen.has(dedupe)) return;
      seen.add(dedupe);
      steps.push({
        key,
        label: getFieldLabel(field),
        required: Boolean(field.required) || field.getAttribute?.("data-required") === "true" || field.getAttribute?.("aria-required") === "true",
        filled: isFieldFilled(field),
        field,
      });
    });

  // Required first, then optional — stable within each group.
  steps.sort((a, b) => Number(b.required) - Number(a.required));
  return steps;
}

/**
 * @param {Array} steps from collectFormSteps
 * @param {Set<string>|string[]} skippedKeys optional fields the user chose to skip
 */
export function coachSnapshot(steps, skippedKeys = []) {
  const skipped = skippedKeys instanceof Set ? skippedKeys : new Set(skippedKeys || []);
  const list = (steps || []).map((s) => ({
    ...s,
    skipped: !s.required && skipped.has(s.key),
  }));

  const isSettled = (s) => s.filled || s.skipped;
  const next = list.find((s) => !isSettled(s)) || null;

  const required = list.filter((s) => s.required);
  const optional = list.filter((s) => !s.required);
  const requiredDone = required.filter((s) => s.filled).length;
  const requiredTotal = required.length;
  const requiredComplete = requiredTotal > 0 ? requiredDone >= requiredTotal : true;

  const optionalDone = optional.filter((s) => isSettled(s)).length;
  const optionalTotal = optional.length;
  const optionalComplete = optionalTotal === 0 || optionalDone >= optionalTotal;

  const settledCount = list.filter(isSettled).length;
  const total = list.length;
  const progress = total ? Math.round((settledCount / total) * 100) : 0;

  const offeringOptional = Boolean(requiredComplete && next && !next.required);
  const allComplete = total > 0 && requiredComplete && optionalComplete;

  return {
    steps: list.map((s) => ({
      key: s.key,
      label: s.label,
      required: s.required,
      filled: s.filled,
      skipped: s.skipped,
      status: s.filled
        ? "done"
        : s.skipped
          ? "skipped"
          : next && s.key === next.key
            ? "active"
            : "pending",
    })),
    total,
    done: settledCount,
    progress,
    next,
    requiredDone,
    requiredTotal,
    requiredComplete,
    optionalDone,
    optionalTotal,
    optionalComplete,
    offeringOptional,
    allComplete,
  };
}

export function coachMessage(snapshot, fieldTip) {
  if (!snapshot?.total) return null;
  if (snapshot.allComplete) {
    return "All set — required fields filled, optional ones handled. Use the primary button on the form to continue.";
  }

  const next = snapshot.next;
  if (!next) return null;

  if (snapshot.offeringOptional || !next.required) {
    return `Optional next: “${next.label}”. Enter it in the highlighted field, or skip.`;
  }

  const step = snapshot.requiredTotal
    ? `Step ${snapshot.requiredDone + 1} of ${snapshot.requiredTotal}`
    : `Field ${snapshot.done + 1} of ${snapshot.total}`;

  const selectMeta = getSelectFieldMeta(next.field);
  if (selectMeta?.many) {
    return `${step} — pick “${next.label}” from the form dropdown.`;
  }
  if (next.field?.tagName === "SELECT") {
    return `${step} — choose “${next.label}” on the form.`;
  }
  // Keep tip short; avoid repeating the field name three times in the panel.
  if (fieldTip) return `${step}. ${fieldTip}`;
  return `${step}: enter “${next.label}” in the highlighted field.`;
}

/** Selects with more than this many options should be filled on the form, not via chips. */
export const SELECT_CHIP_LIMIT = 4;

export function getSelectFieldMeta(field) {
  if (!field || field.tagName !== "SELECT") return null;
  const options = Array.from(field.options || []).filter((opt) => opt.value);
  return {
    count: options.length,
    options,
    many: options.length > SELECT_CHIP_LIMIT,
  };
}

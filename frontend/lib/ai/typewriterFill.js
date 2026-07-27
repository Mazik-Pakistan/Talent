/**
 * Character-by-character OCR / AI form fill.
 * Fast enough to follow (~16ms/char), with a cap so long text doesn't drag.
 */

export const TYPEWRITER_MS_PER_CHAR = 16;
export const TYPEWRITER_GAP_MS = 70;
export const TYPEWRITER_MAX_MS_PER_FIELD = 1000;

function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function sleep(ms, signal) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Type a single string into a field via `onUpdate(partial)`.
 * @returns {Promise<string>} final value
 */
export async function typeValue(value, onUpdate, options = {}) {
  const {
    signal,
    msPerChar = TYPEWRITER_MS_PER_CHAR,
    maxMs = TYPEWRITER_MAX_MS_PER_FIELD,
  } = options;
  const text = value == null ? "" : String(value);
  if (!text) {
    onUpdate?.("");
    return "";
  }

  if (prefersReducedMotion() || signal?.aborted) {
    onUpdate?.(text);
    return text;
  }

  const total = Math.min(maxMs, Math.max(msPerChar * text.length, 100));
  const perChar = Math.max(8, Math.round(total / text.length));

  for (let i = 1; i <= text.length; i += 1) {
    if (signal?.aborted) {
      onUpdate?.(text);
      return text;
    }
    onUpdate?.(text.slice(0, i));
    try {
      await sleep(perChar, signal);
    } catch {
      onUpdate?.(text);
      return text;
    }
  }
  return text;
}

/**
 * Fill multiple fields sequentially (type or instant for selects).
 *
 * @param {Array<{ key: string, value: unknown, mode?: 'type'|'instant', apply: (partial: string) => void }>} entries
 * @param {{ signal?: AbortSignal, gapMs?: number, onFieldStart?: (key: string) => void, onFieldDone?: (key: string) => void }} [options]
 */
export async function typewriterFill(entries, options = {}) {
  const {
    signal,
    gapMs = TYPEWRITER_GAP_MS,
    onFieldStart,
    onFieldDone,
    msPerChar = TYPEWRITER_MS_PER_CHAR,
    maxMs = TYPEWRITER_MAX_MS_PER_FIELD,
  } = options;

  const list = (entries || []).filter((entry) => {
    const v = entry?.value;
    return v != null && String(v).length > 0;
  });

  for (let i = 0; i < list.length; i += 1) {
    if (signal?.aborted) break;
    const entry = list[i];
    const text = String(entry.value);
    onFieldStart?.(entry.key);

    if (entry.mode === "instant" || prefersReducedMotion()) {
      entry.apply(text);
    } else {
      await typeValue(text, entry.apply, { signal, msPerChar, maxMs });
    }

    onFieldDone?.(entry.key);

    if (i < list.length - 1 && gapMs > 0 && !signal?.aborted) {
      try {
        await sleep(gapMs, signal);
      } catch {
        break;
      }
    }
  }
}

/** Scroll the field currently being filled into view. */
export function scrollOcrFieldIntoView(key) {
  if (typeof document === "undefined" || !key) return;
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(key)
      : String(key).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const el =
    document.querySelector(`[data-ocr-key="${escaped}"]`) ||
    document.querySelector(`[data-field-key="${escaped}"]`);
  el?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
}

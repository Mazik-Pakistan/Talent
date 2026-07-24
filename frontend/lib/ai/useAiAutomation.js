"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LOW_CONFIDENCE_THRESHOLD } from "./sources";

/**
 * Runtime that lets an employee watch the AI work.
 *
 * A "plan" is an ordered list of steps. Each step gets a context object with
 * the primitives the AI needs to act on the page — read data, move to a
 * section, type into a field, ask a question, save progress — and every one of
 * those primitives yields to the pause/skip/stop controls between beats, so
 * the employee stays in charge of a run that is already in flight.
 *
 * The hook owns presentation state only. Reading and writing real data stays
 * with the page through the `applyField`, `gotoSection` and `persist`
 * callbacks, so existing validation and API calls are untouched.
 */

const SKIP = Symbol("ai-skip-step");
const STOP = Symbol("ai-stop-run");

const TYPING_MS_PER_CHAR = 32;
const TYPING_MIN_MS = 280;

class ControlSignal extends Error {
  constructor(kind) {
    super(kind === SKIP ? "step-skipped" : "run-stopped");
    this.kind = kind;
  }
}

function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useAiAutomation({ applyField, gotoSection, persist } = {}) {
  const [status, setStatus] = useState("idle");
  const [tasks, setTasks] = useState([]);
  const [activeTaskId, setActiveTaskId] = useState(null);
  const [fields, setFields] = useState({});
  const [activeField, setActiveField] = useState(null);
  const [question, setQuestion] = useState(null);
  const [thought, setThought] = useState("");
  const [notice, setNotice] = useState(null);
  const [summary, setSummary] = useState(null);

  const controlRef = useRef({ paused: false, skip: false, stopped: false, wake: null, rejectors: [] });
  const answerRef = useRef(null);
  const runIdRef = useRef(0);
  const mountedRef = useRef(true);
  const noticeTimerRef = useRef(null);

  // Kept in refs so a run in flight always calls the page's latest handlers
  // without the plan having to be rebuilt.
  const applyFieldRef = useRef(applyField);
  const gotoSectionRef = useRef(gotoSection);
  const persistRef = useRef(persist);

  useEffect(() => {
    applyFieldRef.current = applyField;
    gotoSectionRef.current = gotoSection;
    persistRef.current = persist;
  }, [applyField, gotoSection, persist]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controlRef.current.stopped = true;
      controlRef.current.wake?.();
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  const pushNotice = useCallback((next) => {
    if (!mountedRef.current) return;
    setNotice({ ...next, id: Date.now() + Math.random() });
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setNotice(null);
    }, next.duration ?? 3200);
  }, []);

  const setFieldMeta = useCallback((key, meta) => {
    setFields((current) => ({ ...current, [key]: { ...(current[key] || {}), ...meta } }));
  }, []);

  const clearFieldMeta = useCallback((key) => {
    setFields((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const resetFieldMeta = useCallback(() => setFields({}), []);

  /**
   * Page-scoped visible typing for the Copilot (NOT an Agent run). Does not
   * navigate sections or change routes — only writes into the given field.
   */
  const typeField = useCallback(
    async (key, rawValue, meta = {}) => {
      const value = rawValue == null ? "" : String(rawValue);
      if (!value) return null;
      const reducedMotion = prefersReducedMotion();
      setActiveField(key);
      setFieldMeta(key, {
        status: "typing",
        source: meta.source,
        confidence: meta.confidence,
        note: meta.note,
      });
      await new Promise((resolve) => setTimeout(resolve, reducedMotion ? 0 : 180));

      if (reducedMotion) {
        applyFieldRef.current?.(key, value);
      } else {
        const total = Math.min(1400, Math.max(TYPING_MIN_MS, value.length * TYPING_MS_PER_CHAR));
        const perChar = Math.max(10, Math.round(total / value.length));
        for (let index = 1; index <= value.length; index += 1) {
          applyFieldRef.current?.(key, value.slice(0, index));
          await new Promise((resolve) => setTimeout(resolve, perChar));
        }
      }

      const lowConfidence = meta.confidence != null && meta.confidence < LOW_CONFIDENCE_THRESHOLD;
      setFieldMeta(key, {
        status: lowConfidence ? "review" : "filled",
        source: meta.source,
        confidence: meta.confidence,
        note: meta.note,
        filledAt: Date.now(),
      });
      await new Promise((resolve) => setTimeout(resolve, reducedMotion ? 0 : 160));
      return value;
    },
    [setFieldMeta]
  );

  // ── Control gate ──────────────────────────────────────────────────────
  const gate = useCallback(async () => {
    const control = controlRef.current;
    if (control.stopped) throw new ControlSignal(STOP);
    if (control.skip) {
      control.skip = false;
      throw new ControlSignal(SKIP);
    }
    while (control.paused) {
       
      await new Promise((resolve) => {
        control.wake = resolve;
      });
      control.wake = null;
      if (control.stopped) throw new ControlSignal(STOP);
      if (control.skip) {
        control.skip = false;
        throw new ControlSignal(SKIP);
      }
    }
  }, []);

  const wait = useCallback(
    async (ms) => {
      const deadline = Date.now() + ms;
      // Slice the delay so pause/skip register within a frame or two rather
      // than after the whole beat has elapsed.
      while (Date.now() < deadline) {
        await gate();
        const remaining = deadline - Date.now();
         
        await new Promise((resolve) => setTimeout(resolve, Math.min(60, remaining)));
      }
      await gate();
    },
    [gate]
  );

  // ── Controls ──────────────────────────────────────────────────────────
  /** Break any `waitFor` that is currently blocking the run. */
  const releaseWaiters = useCallback((kind) => {
    const rejectors = controlRef.current.rejectors || [];
    controlRef.current.rejectors = [];
    rejectors.forEach((reject) => reject(new ControlSignal(kind)));
  }, []);

  const pause = useCallback(() => {
    controlRef.current.paused = true;
    setStatus((current) => (current === "running" ? "paused" : current));
  }, []);

  const resume = useCallback(() => {
    controlRef.current.paused = false;
    controlRef.current.wake?.();
    setStatus((current) => (current === "paused" ? "running" : current));
  }, []);

  const skip = useCallback(() => {
    controlRef.current.skip = true;
    controlRef.current.paused = false;
    controlRef.current.wake?.();
    releaseWaiters(SKIP);
    if (answerRef.current) {
      const resolve = answerRef.current;
      answerRef.current = null;
      setQuestion(null);
      resolve({ skipped: true });
    }
  }, [releaseWaiters]);

  const stop = useCallback(() => {
    controlRef.current.stopped = true;
    controlRef.current.paused = false;
    controlRef.current.wake?.();
    releaseWaiters(STOP);
    if (answerRef.current) {
      const resolve = answerRef.current;
      answerRef.current = null;
      setQuestion(null);
      resolve({ stopped: true });
    }
    setActiveField(null);
    setActiveTaskId(null);
    setThought("");
    setStatus("stopped");
  }, [releaseWaiters]);

  const answer = useCallback((value) => {
    const resolve = answerRef.current;
    if (!resolve) return;
    answerRef.current = null;
    setQuestion(null);
    resolve({ value });
  }, []);

  // ── Run ───────────────────────────────────────────────────────────────
  const run = useCallback(
    async (steps) => {
      if (!Array.isArray(steps) || steps.length === 0) return;

      const runId = ++runIdRef.current;
      const alive = () => mountedRef.current && runIdRef.current === runId;

      controlRef.current = { paused: false, skip: false, stopped: false, wake: null, rejectors: [] };
      const reducedMotion = prefersReducedMotion();

      setStatus("running");
      setSummary(null);
      setTasks(
        steps
          .filter((step) => !step.silent)
          .map((step) => ({ id: step.id, label: step.label, detail: step.detail, status: "pending" }))
      );

      const markTask = (id, patch) =>
        setTasks((current) => current.map((task) => (task.id === id ? { ...task, ...patch } : task)));

      const memory = {};
      const filled = [];
      const needsReview = [];

      const makeContext = (step) => ({
        memory,
        reducedMotion,

        /** Yield to pause/skip/stop. Call between long synchronous chunks. */
        checkpoint: gate,

        /** Visible "thinking" beat — also the pause-responsive delay primitive. */
        think: async (message, ms = 620) => {
          if (message && alive()) setThought(message);
          await wait(reducedMotion ? Math.min(ms, 160) : ms);
        },

        /** Append a line of detail under the running task. */
        log: (detail) => {
          if (alive()) markTask(step.id, { detail });
        },

        /** Move the form to a section and let the scroll settle. */
        goToSection: async (sectionId, message) => {
          await gate();
          gotoSectionRef.current?.(sectionId);
          if (message && alive()) setThought(message);
          await wait(reducedMotion ? 120 : 520);
        },

        /** Highlight a field without writing to it. */
        focusField: async (key, ms = 260) => {
          await gate();
          if (alive()) setActiveField(key);
          await wait(reducedMotion ? 0 : ms);
        },

        /**
         * Type a value into a field character by character, then badge it with
         * where the value came from.
         */
        type: async (key, rawValue, meta = {}) => {
          const value = rawValue == null ? "" : String(rawValue);
          if (!value) return null;
          await gate();
          if (!alive()) return null;

          setActiveField(key);
          setFieldMeta(key, { status: "typing", source: meta.source, confidence: meta.confidence, note: meta.note });
          await wait(reducedMotion ? 0 : 220);

          if (reducedMotion) {
            applyFieldRef.current?.(key, value);
          } else {
            // Long values shouldn't drag: cap the whole word at ~1.4s.
            const total = Math.min(1400, Math.max(TYPING_MIN_MS, value.length * TYPING_MS_PER_CHAR));
            const perChar = Math.max(10, Math.round(total / value.length));
            for (let index = 1; index <= value.length; index += 1) {
               
              await gate();
              applyFieldRef.current?.(key, value.slice(0, index));
               
              await new Promise((resolve) => setTimeout(resolve, perChar));
            }
          }

          await gate();
          const lowConfidence = meta.confidence != null && meta.confidence < LOW_CONFIDENCE_THRESHOLD;
          if (alive()) {
            setFieldMeta(key, {
              status: lowConfidence ? "review" : "filled",
              source: meta.source,
              confidence: meta.confidence,
              note: meta.note,
              filledAt: Date.now(),
            });
          }
          filled.push(key);
          if (lowConfidence) needsReview.push(key);
          await wait(reducedMotion ? 0 : 240);
          return value;
        },

        /** Toggle a checkbox-style field with the same badge treatment. */
        check: async (key, value, meta = {}) => {
          await gate();
          if (!alive()) return;
          setActiveField(key);
          setFieldMeta(key, { status: "typing", source: meta.source, confidence: meta.confidence, note: meta.note });
          await wait(reducedMotion ? 0 : 260);
          applyFieldRef.current?.(key, value);
          if (alive()) {
            setFieldMeta(key, {
              status: "filled",
              source: meta.source,
              confidence: meta.confidence,
              note: meta.note,
              filledAt: Date.now(),
            });
          }
          filled.push(key);
          await wait(reducedMotion ? 0 : 200);
        },

        /**
         * Hand control back to the employee. Resolves with `{ value }`,
         * `{ skipped: true }` or `{ stopped: true }`.
         */
        ask: async (prompt) => {
          await gate();
          if (!alive()) return { stopped: true };
          if (prompt.fieldKey) {
            setActiveField(prompt.fieldKey);
            setFieldMeta(prompt.fieldKey, { status: "asking" });
          }
          setStatus("waiting");
          setThought(prompt.question);
          markTask(step.id, { status: "waiting" });

          const response = await new Promise((resolve) => {
            answerRef.current = resolve;
            setQuestion({ ...prompt, id: `${step.id}-${Date.now()}` });
          });

          if (alive() && !response.stopped) {
            setStatus("running");
            markTask(step.id, { status: "active" });
          }
          if (prompt.fieldKey && alive()) {
            setFieldMeta(prompt.fieldKey, { status: response.value ? "filled" : "idle" });
          }
          if (response.stopped) throw new ControlSignal(STOP);
          if (response.skipped) throw new ControlSignal(SKIP);
          return response;
        },

        /** Persist through the page's existing save path. */
        save: async (payload, label = "Progress saved automatically") => {
          await gate();
          const result = await persistRef.current?.(payload);
          if (result?.ok === false) {
            pushNotice({ tone: "error", message: result.message || "Could not save that section." });
            return result;
          }
          pushNotice({ tone: "success", message: label, byAi: true });
          return result ?? { ok: true };
        },

        /**
         * Block on something happening outside the plan — an upload, a
         * signature — without losing the pause/skip/stop controls.
         */
        waitFor: async (promise, { hint } = {}) => {
          await gate();
          if (hint && alive()) setThought(hint);
          let rejector;
          const interrupted = new Promise((_, reject) => {
            rejector = reject;
            controlRef.current.rejectors.push(reject);
          });
          try {
            return await Promise.race([promise, interrupted]);
          } finally {
            controlRef.current.rejectors = (controlRef.current.rejectors || []).filter(
              (entry) => entry !== rejector
            );
          }
        },

        notify: pushNotice,
        setFieldMeta,
      });

      let stopped = false;
      try {
        for (const step of steps) {
          if (!alive()) return;
          setActiveTaskId(step.silent ? null : step.id);
          if (!step.silent) markTask(step.id, { status: "active" });

          try {
             
            await step.run(makeContext(step));
            if (!step.silent && alive()) markTask(step.id, { status: "done" });
             
            await wait(reducedMotion ? 0 : 260);
          } catch (error) {
            if (error instanceof ControlSignal && error.kind === SKIP) {
              if (!step.silent && alive()) markTask(step.id, { status: "skipped" });
              continue;
            }
            if (error instanceof ControlSignal && error.kind === STOP) {
              stopped = true;
              break;
            }
            if (!step.silent && alive()) {
              markTask(step.id, { status: "failed", detail: error?.message || "Something went wrong." });
            }
            pushNotice({
              tone: "error",
              message: error?.message || "The AI hit a problem on this step — you can continue manually.",
              duration: 5200,
            });
          }
        }
      } finally {
        if (alive()) {
          setActiveField(null);
          setActiveTaskId(null);
          setThought("");
          if (!stopped && !controlRef.current.stopped) {
            setStatus("done");
            setSummary({ filled: [...new Set(filled)], needsReview: [...new Set(needsReview)] });
          }
        }
      }
    },
    [gate, wait, pushNotice, setFieldMeta]
  );

  const reset = useCallback(() => {
    releaseWaiters(STOP);
    controlRef.current = { paused: false, skip: false, stopped: false, wake: null, rejectors: [] };
    runIdRef.current += 1;
    setStatus("idle");
    setTasks([]);
    setActiveTaskId(null);
    setActiveField(null);
    setQuestion(null);
    setThought("");
    setSummary(null);
  }, [releaseWaiters]);

  const progress = useMemo(() => {
    if (!tasks.length) return 0;
    const settled = tasks.filter((task) => ["done", "skipped", "failed"].includes(task.status)).length;
    return Math.round((settled / tasks.length) * 100);
  }, [tasks]);

  return {
    status,
    isRunning: status === "running" || status === "paused" || status === "waiting",
    isPaused: status === "paused",
    tasks,
    activeTaskId,
    progress,
    fields,
    activeField,
    question,
    thought,
    notice,
    summary,
    run,
    pause,
    resume,
    skip,
    stop,
    answer,
    reset,
    pushNotice,
    setFieldMeta,
    clearFieldMeta,
    resetFieldMeta,
    typeField,
    dismissNotice: () => setNotice(null),
  };
}

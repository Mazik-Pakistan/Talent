"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./MascotStatic.module.css";

const MOOD_COPY = {
  neutral: "Hi there!",
  red: "Oops — try again!",
  yellow: "Nice start!",
  green: "Looking strong!",
};

const PHASE_COPY = {
  greeting: "Hi there!",
  email_focus: "Welcome back.",
  password_privacy: "Your secret is safe.",
  authenticating: "Checking…",
  success: "Welcome, Admin.",
  error: "Let's try that again.",
};

const ROLE_GREETINGS = {
  candidate: "Welcome, Candidate.",
  employee: "Welcome, Employee.",
  recruiter: "Welcome, Recruiter.",
  super_admin: "Welcome, Admin.",
};

const EYE_MAX = 5.5; // px, clamps how far the eyes can travel from center
const EYE_EASE = 0.16; // spring damping factor per animation frame
const GREETING_DELAY = 380; // ms before the wave starts
const WAVE_DURATION = 900; // ms, matches the .wave keyframes below
const GREETING_TOTAL = 1500; // ms the whole greeting phase stays active
const BLINK_MIN = 3000;
const BLINK_MAX = 6000;
const BLINK_DURATION = 140;
const PASSWORD_CLOSE_DELAY = 150; // ms the eyes spend "looking down" before closing

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e) => setReduced(e.matches);
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);
  return reduced;
}

function toPascalCase(phase) {
  return phase.replace(/(^\w|_\w)/g, (chunk) => chunk.replace("_", "").toUpperCase());
}

/**
 * Enterprise-grade animated mascot for the login flow.
 *
 * fieldFocus: "none" | "email" | "password"
 * authStatus: "idle" | "checking" | "success" | "error"
 * cardRef: optional ref to the login card container, used so eye-tracking
 *          gently returns to center once the cursor leaves the card.
 */
export default function MascotStatic({
  mood = "neutral",
  message,
  fieldFocus = "none",
  authStatus = "idle",
  cardRef,
  role,
}) {
  const safeMood = MOOD_COPY[mood] ? mood : "neutral";
  const reducedMotion = usePrefersReducedMotion();

  const mascotRef = useRef(null);
  const rafRef = useRef(null);
  const targetEyeRef = useRef({ x: 0, y: 0 });
  const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 });

  const hasGreetedRef = useRef(false);
  const [greetingActive, setGreetingActive] = useState(false);
  const [isWaving, setIsWaving] = useState(false);
  const [blinking, setBlinking] = useState(false);
  const [eyesClosedVisual, setEyesClosedVisual] = useState(false);

  // ---- 1. Initial greeting: once per mount (page load), never repeats ----
  useEffect(() => {
    if (hasGreetedRef.current || reducedMotion) return;
    hasGreetedRef.current = true;
    setGreetingActive(true);
    const waveStart = setTimeout(() => setIsWaving(true), GREETING_DELAY);
    const waveEnd = setTimeout(() => setIsWaving(false), GREETING_DELAY + WAVE_DURATION);
    const greetEnd = setTimeout(() => setGreetingActive(false), GREETING_TOTAL);
    return () => {
      clearTimeout(waveStart);
      clearTimeout(waveEnd);
      clearTimeout(greetEnd);
    };
  }, [reducedMotion]);

  // ---- Phase resolution (priority order matches the requested state machine) ----
  const phase = useMemo(() => {
    if (authStatus === "checking") return "authenticating";
    if (authStatus === "success") return "success";
    if (authStatus === "error") return "error";
    if (greetingActive) return "greeting";
    if (fieldFocus === "password") return "password_privacy";
    if (fieldFocus === "email") return "email_focus";
    return "tracking";
  }, [authStatus, greetingActive, fieldFocus]);

  const trackingEnabled = phase === "tracking" || phase === "greeting";

  // ---- 2. Cursor tracking, spring-eased, paused outside the login card ----
  useEffect(() => {
    if (reducedMotion) return;

    function isInsideCard(x, y) {
      const node = cardRef?.current;
      if (!node) return true;
      const rect = node.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }

    function handleMouseMove(event) {
      if (!mascotRef.current || !trackingEnabled) return;

      if (!isInsideCard(event.clientX, event.clientY)) {
        targetEyeRef.current = { x: 0, y: 0 };
        return;
      }

      const rect = mascotRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 3;
      targetEyeRef.current = {
        x: Math.max(-EYE_MAX, Math.min(EYE_MAX, (event.clientX - centerX) / 32)),
        y: Math.max(-EYE_MAX, Math.min(EYE_MAX, (event.clientY - centerY) / 32)),
      };
    }

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [trackingEnabled, cardRef, reducedMotion]);

  // ---- 3 & 7. Fixed gaze targets for non-tracking phases ----
  useEffect(() => {
    if (phase === "email_focus") {
      targetEyeRef.current = { x: 0, y: 3 };
    } else if (phase === "authenticating") {
      targetEyeRef.current = { x: 0, y: 5 };
    } else if (phase === "success" || phase === "error") {
      targetEyeRef.current = { x: 0, y: 0 };
    }
  }, [phase]);

  // ---- 4 & 5 & 6. Password privacy: look down first, then close; reopen on exit ----
  useEffect(() => {
    if (phase === "password_privacy") {
      targetEyeRef.current = { x: 0, y: 5 }; // look toward the field first
      const t = setTimeout(() => setEyesClosedVisual(true), PASSWORD_CLOSE_DELAY);
      return () => clearTimeout(t);
    }
    if (phase === "password_visible") {
      targetEyeRef.current = { x: 0, y: 2 }; // cautiously open, still glancing down
      setEyesClosedVisual(false);
      return undefined;
    }
    setEyesClosedVisual(false);
    return undefined;
  }, [phase]);

  // ---- Spring loop: continuously lerp actual eye position toward target ----
  useEffect(() => {
    if (reducedMotion) {
      setEyeOffset(targetEyeRef.current);
      return undefined;
    }
    function tick() {
      setEyeOffset((current) => {
        const dx = targetEyeRef.current.x - current.x;
        const dy = targetEyeRef.current.y - current.y;
        if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) return targetEyeRef.current;
        return { x: current.x + dx * EYE_EASE, y: current.y + dy * EYE_EASE };
      });
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => rafRef.current && cancelAnimationFrame(rafRef.current);
  }, [reducedMotion]);

  // ---- 8. Idle natural blink, only while genuinely idle/tracking ----
  useEffect(() => {
    if (reducedMotion || phase !== "tracking") return undefined;
    let timeoutId;
    function scheduleBlink() {
      const delay = BLINK_MIN + Math.random() * (BLINK_MAX - BLINK_MIN);
      timeoutId = setTimeout(() => {
        setBlinking(true);
        setTimeout(() => setBlinking(false), BLINK_DURATION);
        scheduleBlink();
      }, delay);
    }
    scheduleBlink();
    return () => clearTimeout(timeoutId);
  }, [phase, reducedMotion]);

  const eyesClosed = eyesClosedVisual;
  const eyesBlinking = blinking && !eyesClosed;
  const bubbleText =
    message ||
    (phase === "success" && role ? ROLE_GREETINGS[role] : null) ||
    PHASE_COPY[phase] ||
    MOOD_COPY[safeMood];

  const wrapperClasses = [
    styles.mascotWrapper,
    styles[`mood${safeMood[0].toUpperCase()}${safeMood.slice(1)}`],
    styles[`phase${toPascalCase(phase)}`],
    reducedMotion ? styles.reducedMotion : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={mascotRef} className={wrapperClasses}>
      <span key={phase} className={styles.greeting} aria-live="polite">
        {bubbleText}
      </span>
      <svg viewBox="0 0 100 100" className={styles.mascotSvg} xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="screenGlowStatic" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#38a2ff" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#153d5e" stopOpacity="0" />
          </radialGradient>
          <filter id="shadowStatic" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="4" stdDeviation="3" floodColor="#000" floodOpacity="0.15" />
          </filter>
        </defs>

        <g className={styles.floatGroup}>
          <ellipse cx="50" cy="84" rx="12" ry="4" className={styles.thrusterGlow} />

          <path d="M 38 65 Q 50 78 62 65 Q 50 68 38 65 Z" className={styles.bodyBase} filter="url(#shadowStatic)" />
          <path d="M 45 68 L 55 68 L 50 78 Z" className={styles.bodyThruster} />

          <rect x="46" y="54" width="8" height="8" rx="2" className={styles.robotNeck} />

          <path
            d="M 28 50 C 18 50 14 38 16 32 C 18 30 20 34 20 38 C 20 44 26 46 28 46 Z"
            className={`${styles.leftArm} ${isWaving ? styles.leftArmWave : ""}`}
          />
          <path
            d="M 72 50 C 82 50 86 44 84 38 C 82 36 80 40 80 44 C 80 46 74 46 72 46 Z"
            className={styles.rightArm}
          />

          <g className={styles.headGroup}>
            <rect x="24" y="18" width="52" height="42" rx="16" className={styles.headShell} filter="url(#shadowStatic)" />
            <rect x="28" y="22" width="44" height="34" rx="12" className={styles.faceScreen} />
            <rect x="28" y="22" width="44" height="34" rx="12" fill="url(#screenGlowStatic)" pointerEvents="none" />

            <g
              className={`${styles.eyesGroup} ${eyesClosed ? styles.eyesGroupClosed : ""} ${
                eyesBlinking ? styles.eyesGroupBlink : ""
              }`}
            >
              <ellipse cx={42 + eyeOffset.x} cy={39 + eyeOffset.y} rx="5.5" ry="7.5" className={styles.eye} />
              <ellipse cx={58 + eyeOffset.x} cy={39 + eyeOffset.y} rx="5.5" ry="7.5" className={styles.eye} />
            </g>

            <line x1="50" y1="18" x2="50" y2="10" strokeWidth="3" strokeLinecap="round" className={styles.antennaStem} />
            <circle cx="50" cy="8" r="4" className={styles.antennaTip} />
          </g>
        </g>
      </svg>
    </div>
  );
}
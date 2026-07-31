"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./MascotStatic.module.css";

const MASCOT_COPY = {
  neutral: "Hi there!",
  red: "Oops — try again!",
  yellow: "Nice start!",
  green: "Looking strong!",
};

export default function MascotStatic({ mood = "neutral", message }) {
  const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 });
  const mascotRef = useRef(null);
  const rafIdRef = useRef(null);
  const safeMood = MASCOT_COPY[mood] ? mood : "neutral";

  useEffect(() => {
    function handleMouseMove(event) {
      if (!mascotRef.current) return;
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);

      rafIdRef.current = requestAnimationFrame(() => {
        const rect = mascotRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 3;
        setEyeOffset({
          x: Math.max(-6, Math.min(6, (event.clientX - centerX) / 30)),
          y: Math.max(-5, Math.min(5, (event.clientY - centerY) / 30)),
        });
        rafIdRef.current = null;
      });
    }

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  return (
    <div ref={mascotRef} className={`${styles.mascotWrapper} ${styles[`mood${safeMood[0].toUpperCase()}${safeMood.slice(1)}`]}`}>
      <span className={styles.greeting} aria-live="polite">{message || MASCOT_COPY[safeMood]}</span>
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

        <ellipse cx="50" cy="84" rx="12" ry="4" className={styles.thrusterGlow} />

        <path d="M 38 65 Q 50 78 62 65 Q 50 68 38 65 Z" className={styles.bodyBase} filter="url(#shadowStatic)" />
        <path d="M 45 68 L 55 68 L 50 78 Z" className={styles.bodyThruster} />

        <rect x="46" y="54" width="8" height="8" rx="2" className={styles.robotNeck} />

        <path d="M 28 50 C 18 50 14 38 16 32 C 18 30 20 34 20 38 C 20 44 26 46 28 46 Z" className={styles.leftArm} />
        <path d="M 72 50 C 82 50 86 44 84 38 C 82 36 80 40 80 44 C 80 46 74 46 72 46 Z" className={styles.rightArm} />

        <rect x="24" y="18" width="52" height="42" rx="16" className={styles.headShell} filter="url(#shadowStatic)" />

        <rect x="28" y="22" width="44" height="34" rx="12" className={styles.faceScreen} />

        <rect x="28" y="22" width="44" height="34" rx="12" fill="url(#screenGlowStatic)" pointerEvents="none" />

        <ellipse cx={42 + eyeOffset.x} cy={39 + eyeOffset.y} rx="5.5" ry="7.5" className={styles.eye} />
        <ellipse cx={58 + eyeOffset.x} cy={39 + eyeOffset.y} rx="5.5" ry="7.5" className={styles.eye} />

        <line x1="50" y1="18" x2="50" y2="10" strokeWidth="3" strokeLinecap="round" className={styles.antennaStem} />
        <circle cx="50" cy="8" r="4" className={styles.antennaTip} />
      </svg>
    </div>
  );
}

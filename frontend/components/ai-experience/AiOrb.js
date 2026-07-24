"use client";

import { IconSparkle } from "./icons";
import styles from "./AiExperience.module.css";

const SIZES = { sm: styles.orbSm, md: styles.orbMd, lg: styles.orbLg };

/**
 * The AI's visual anchor. Pulses with a halo and floating particles while the
 * assistant is actually working, and sits still when it isn't — so the
 * animation always means something.
 */
export default function AiOrb({ size = "md", thinking = false, particles = false, className = "" }) {
  return (
    <span
      className={`${styles.orb} ${SIZES[size] || SIZES.md} ${thinking ? styles.orbThinking : ""} ${className}`}
      aria-hidden="true"
    >
      <IconSparkle />
      {particles && thinking ? (
        <span className={styles.particles}>
          {[0, 1, 2, 3].map((index) => (
            <span
              key={index}
              className={styles.particle}
              style={{
                left: `${18 + index * 20}%`,
                animationDelay: `${index * 0.55}s`,
                "--ai-drift": `${index % 2 === 0 ? 8 : -8}px`,
              }}
            />
          ))}
        </span>
      ) : null}
    </span>
  );
}

export function AiThinkingDots({ className = "" }) {
  return (
    <span className={`${styles.thinkingDots} ${className}`} aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

"use client";

import styles from "@/components/recruiter/recruiter-shell.module.css";

/**
 * Shared statistics card for the Super Admin module.
 *
 * Defaults to the Overview dashboard card design (icon container, sizing, tone
 * colors, typography, shadow and hover). The "spacious" variant restores the
 * larger card dimensions used by the Organizations panel (min-width, padding,
 * radius, border, shadow, icon radius and typography scale) while keeping the
 * same icon, tone colors, value and label.
 *
 * Tones available: navy, blue, cyan, green, orange, purple, red, grey.
 */
export default function StatsCard({ icon, tone, value, label, variant = "default" }) {
  const spacious = variant === "spacious";
  return (
    <div className={`${styles.statCard} ${spacious ? styles.statCardSpacious : ""}`}>
      <div className={`${styles.statIcon} ${styles[tone]}`}>{icon}</div>
      <div className={styles.statText}>
        <div className={styles.statValue}>{value}</div>
        <div className={styles.statLabel}>{label}</div>
      </div>
    </div>
  );
}

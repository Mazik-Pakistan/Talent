"use client";

import styles from "./ProfileAvatar.module.css";

export function initialsFor(name, fallback = "?") {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  const first = parts[0]?.[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || fallback;
}

/**
 * Displays a profile photo or initials fallback.
 * size: "sm" | "md" | "lg" | "xl"
 */
export default function ProfileAvatar({
  src,
  name,
  size = "md",
  className = "",
  fallback = "?",
  alt,
}) {
  const initials = initialsFor(name, fallback);
  const classes = [styles.avatar, styles[size], className].filter(Boolean).join(" ");

  if (src) {
    return (
      <div className={classes} aria-hidden={!alt}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt || `${name || "User"} profile photo`} className={styles.image} />
      </div>
    );
  }

  return (
    <div className={classes} aria-hidden="true">
      <span className={styles.initials}>{initials}</span>
    </div>
  );
}

"use client";

import { Eye, EyeOff } from "lucide-react";

/**
 * Shared password visibility toggle (eye / eye-off icon button).
 * Renders inside the right edge of a password input's relative wrapper.
 */
export default function PasswordToggle({ visible, onToggle, className = "", size = 16, style }) {
  const label = visible ? "Hide password" : "Show password";
  return (
    <button
      type="button"
      className={className}
      style={style}
      onClick={onToggle}
      onMouseDown={(event) => event.preventDefault()}
      aria-label={label}
      title={label}
    >
      {visible ? <Eye size={size} aria-hidden="true" /> : <EyeOff size={size} aria-hidden="true" />}
    </button>
  );
}

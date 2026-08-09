"use client";

import { LOGO_URL } from "@/lib/logo";

function MazikIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" style={{ display: "block" }}>
      <rect x="4" y="4" width="92" height="92" rx="6" fill="#4CAF50" />
      <path d="M50 72 C50 72 30 55 35 35 C40 15 62 18 68 30 C74 42 65 55 50 72Z" fill="white" />
      <path d="M50 72 C50 72 70 55 65 35 C60 15 38 18 32 30" fill="none" stroke="white" strokeWidth="3" />
      <rect x="104" y="4" width="92" height="92" rx="6" fill="#2196F3" />
      <ellipse cx="150" cy="58" rx="28" ry="16" fill="white" />
      <ellipse cx="134" cy="62" rx="14" ry="10" fill="white" />
      <ellipse cx="166" cy="62" rx="14" ry="10" fill="white" />
      <rect x="122" y="62" width="56" height="12" fill="white" />
      <rect x="4" y="104" width="92" height="92" rx="6" fill="#1A3A5C" />
      <polygon points="50,120 80,134 50,148 20,134" fill="white" />
      <rect x="46" y="148" width="8" height="18" rx="2" fill="white" />
      <ellipse cx="50" cy="166" rx="7" ry="7" fill="white" />
      <rect x="76" y="132" width="6" height="22" rx="3" fill="white" />
      <rect x="104" y="104" width="92" height="92" rx="6" fill="#E53935" />
      <polygon points="150,116 150,168 122,168" fill="white" />
      <polygon points="150,122 150,162 172,162" fill="white" />
      <rect x="118" y="170" width="60" height="6" rx="2" fill="white" />
    </svg>
  );
}

/**
 * Shared sidebar logo: compact centered TalentAI wordmark when expanded,
 * inline Mazik grid icon when collapsed (no external file dependency).
 */
export default function SidebarBrand({
  collapsed = false,
  className,
  markClassName,
  onClick,
  title,
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      title={title || (collapsed ? "Expand sidebar" : "Collapse sidebar")}
      aria-expanded={!collapsed}
    >
      <div className={markClassName} aria-hidden="true">
        {collapsed ? (
          <MazikIcon
            style={{
              width: 36,
              height: 36,
              margin: "0 auto",
            }}
          />
        ) : (
          <img
            src={LOGO_URL}
            alt="Mazik Global TalentAI"
            style={{
              width: "auto",
              height: "auto",
              maxWidth: 148,
              maxHeight: 52,
              display: "block",
              objectFit: "contain",
              objectPosition: "center center",
              margin: "0 auto",
            }}
          />
        )}
      </div>
    </button>
  );
}

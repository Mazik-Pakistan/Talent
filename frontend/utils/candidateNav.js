"use client";

/**
 * Shared candidate workspace nav — keep AI Assistant on every candidate page.
 */

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "1.8",
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export const CANDIDATE_NAV_ICONS = {
  dashboard: (
    <svg {...iconProps}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),

  onboarding: (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12l2.5 2.5L16 9" />
    </svg>
  ),

  documents: (
    <svg {...iconProps}>
      <path d="M6 3h8l5 5v13H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M14 3v6h5" />
      <path d="M8 13h6" />
      <path d="M8 17h5" />
    </svg>
  ),

  profile: (
    <svg {...iconProps}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20c.8-3.4 3.3-5.2 7.5-5.2s6.7 1.8 7.5 5.2" />
    </svg>
  ),

  assistant: (
    <svg {...iconProps}>
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" />
      <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z" />
    </svg>
  ),
};


export const CANDIDATE_NAV_ITEMS = [
  {
    key: "dashboard",
    label: "Dashboard",
    href: "/dashboard/candidate",
    icon: CANDIDATE_NAV_ICONS.dashboard,
  },

  {
    key: "onboarding",
    label: "Onboarding",
    href: "/onboarding",
    icon: CANDIDATE_NAV_ICONS.onboarding,
  },

  {
    key: "documents",
    label: "Documents",
    href: "/documents",
    icon: CANDIDATE_NAV_ICONS.documents,
  },

  {
    key: "profile",
    label: "Profile",
    href: "/dashboard/candidate/profile",
    icon: CANDIDATE_NAV_ICONS.profile,
  },

  {
    key: "assistant",
    label: "AI Assistant",
    href: "/dashboard/candidate/ai-assistant",
    icon: CANDIDATE_NAV_ICONS.assistant,
  },
];


export function isCandidateNavActive(
  item,
  { pathname, search = "", activeKey } = {}
) {
  // When a page declares an activeKey, only that item is active.
  // Never combine with pathname rules to avoid dual highlights.
  if (activeKey) return item.key === activeKey;

  if (!item.href || !pathname) return false;

  const pathOnly = item.href.split("?")[0];

  // Dashboard is exact-match only.
  if (item.key === "dashboard") {
    return pathname === pathOnly;
  }

  // AI Assistant and all of its nested pages.
  if (item.key === "assistant") {
    return (
      pathname === pathOnly ||
      pathname.startsWith(`${pathOnly}/`)
    );
  }

  // Candidate profile and nested profile pages.
  if (item.key === "profile") {
    return pathname.startsWith("/dashboard/candidate/profile");
  }

  // Onboarding and its nested pages.
  if (item.key === "onboarding") {
    return pathname.startsWith("/onboarding");
  }

  // Documents and nested document pages.
  if (item.key === "documents") {
    return (
      pathname === pathOnly ||
      pathname.startsWith(`${pathOnly}/`)
    );
  }

  return (
    pathname === pathOnly ||
    pathname.startsWith(`${pathOnly}/`)
  );
}
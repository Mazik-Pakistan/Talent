"use client";

/**
 * Shared candidate workspace nav — keep AI Assistant on every candidate page.
 */

export const CANDIDATE_NAV_ICONS = {
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  onboarding: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 12l2 2 4-4" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  ),
  documents: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  ),
  profile: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" />
    </svg>
  ),
  assistant: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2a5 5 0 0 1 5 5v2a5 5 0 0 1-10 0V7a5 5 0 0 1 5-5z" />
      <path d="M19 11a7 7 0 0 1-14 0" />
      <path d="M12 18v4" />
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

export function isCandidateNavActive(item, { pathname, search = "", activeKey } = {}) {
  // When a page declares an activeKey, only that item is active — never combine
  // with pathname rules (that caused dual highlights, e.g. Profile + Onboarding).
  if (activeKey) return item.key === activeKey;
  if (!item.href || !pathname) return false;

  const pathOnly = item.href.split("?")[0];

  if (item.key === "dashboard") {
    return pathname === pathOnly;
  }
  if (item.key === "assistant") {
    return pathname === pathOnly || pathname.startsWith(`${pathOnly}/`);
  }
  if (item.key === "profile") {
    return pathname.startsWith("/dashboard/candidate/profile");
  }
  if (item.key === "onboarding") {
    return pathname.startsWith("/onboarding");
  }
  if (item.key === "documents") {
    return pathname === pathOnly || pathname.startsWith(`${pathOnly}/`);
  }
  return pathname === pathOnly || pathname.startsWith(`${pathOnly}/`);
}

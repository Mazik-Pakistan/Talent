"use client";

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "1.8",
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export const EMPLOYEE_NAV_ICONS = {
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

  learning: (
    <svg {...iconProps}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 1 4 17.5z" />
      <path d="M4 5.5v12" />
      <path d="M8 7h8" />
      <path d="M8 11h6" />
    </svg>
  ),

  ai: (
    <svg {...iconProps}>
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" />
      <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z" />
    </svg>
  ),

  profile: (
    <svg {...iconProps}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20c.8-3.4 3.3-5.2 7.5-5.2s6.7 1.8 7.5 5.2" />
    </svg>
  ),

  messages: (
    <svg {...iconProps}>
      <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H7l-4 2v-9.5A7.5 7.5 0 0 1 10.5 4h2A7.5 7.5 0 0 1 20 11.5z" />
      <path d="M8 11h.01" />
      <path d="M12 11h.01" />
      <path d="M16 11h.01" />
    </svg>
  ),

  // My Career — career progression
  career: (
    <svg {...iconProps}>
      <path d="M4 19h16" />
      <path d="M6 16l4-4 3 3 5-7" />
      <path d="M15 8h3v3" />
    </svg>
  ),

  // My Talent — personal skills and strengths
  talent: (
    <svg {...iconProps}>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 20c.7-3.5 3-5.5 7-5.5s6.3 2 7 5.5" />
      <path d="M19 3.5l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6z" />
    </svg>
  ),

  it: (
    <svg {...iconProps}>
      <rect x="3" y="4" width="14" height="11" rx="1.5" />
      <path d="M7 20h6" />
      <path d="M10 15v5" />

      <circle cx="18" cy="17" r="3" />
      <path d="M18 15.5v1.5l1 1" />
      <path d="M18 13v1" />
      <path d="M18 20v1" />
      <path d="M14 17h1" />
      <path d="M21 17h1" />
    </svg>
  ),
};


/**
 * Employee sidebar items.
 *
 * Onboarding is only shown while the profile is incomplete.
 * After 100% completion, profile edits go through Profile.
 *
 * Recruiter-employees (can_switch_to_recruiter) skip the
 * onboarding item entirely.
 */
export function getEmployeeNavItems({ profileComplete = false, user } = {}) {
  const allItems = [
    {
      key: "dashboard",
      label: "Dashboard",
      module: null,
      href: "/dashboard/employee",
      icon: EMPLOYEE_NAV_ICONS.dashboard,
    },

    {
      key: "onboarding",
      label: "Onboarding",
      module: "onboarding",
      href: "/dashboard/employee/complete-profile",
      icon: EMPLOYEE_NAV_ICONS.onboarding,
    },

    {
      key: "documents",
      label: "Documents",
      module: null,
      href: "/documents",
      icon: EMPLOYEE_NAV_ICONS.documents,
    },

    {
      key: "learning",
      label: "Learning",
      module: "learning",
      href: "/dashboard/employee/learning",
      icon: EMPLOYEE_NAV_ICONS.learning,
    },

    {
      key: "career",
      label: "My Career",
      module: "learning",
      href: "/dashboard/employee/career",
      icon: EMPLOYEE_NAV_ICONS.career,
    },

    {
      key: "talent",
      label: "My Talent",
      module: "learning",
      href: "/dashboard/employee/talent",
      icon: EMPLOYEE_NAV_ICONS.talent,
    },

    {
      key: "ai-assistant",
      label: "AI Assistant",
      module: null,
      href: "/dashboard/employee/ai-assistant",
      icon: EMPLOYEE_NAV_ICONS.ai,
    },

    {
      key: "it-support",
      label: "IT support",
      module: null,
      href: "/dashboard/employee/it-support",
      icon: EMPLOYEE_NAV_ICONS.it,
    },

    {
      key: "messages",
      label: "Message HR",
      module: null,
      href: "/dashboard/employee/messages",
      icon: EMPLOYEE_NAV_ICONS.messages,
    },

    {
      key: "profile",
      label: "Profile",
      module: "profile",
      href: "/dashboard/employee/profile",
      icon: EMPLOYEE_NAV_ICONS.profile,
    },
  ];

  return allItems.filter((item) => {
    if (
      item.key === "onboarding" &&
      (profileComplete || user?.can_switch_to_recruiter)
    ) {
      return false;
    }

    return true;
  });
}


/**
 * Exclusive active matching for employee nav.
 *
 * Dashboard is exact-match only so /dashboard/employee/*
 * does not keep Dashboard highlighted.
 */
export function isEmployeeNavActive(
  item,
  { pathname, activeKey } = {}
) {
  if (activeKey) {
    return item.key === activeKey;
  }

  if (!item.href || !pathname) {
    return false;
  }

  if (item.key === "dashboard") {
    return (
      pathname === item.href ||
      pathname === `${item.href}/`
    );
  }

  return (
    pathname === item.href ||
    pathname.startsWith(`${item.href}/`)
  );
}
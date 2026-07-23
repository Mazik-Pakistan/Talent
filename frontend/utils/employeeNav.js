"use client";

export const EMPLOYEE_NAV_ICONS = {
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
  learning: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  ),
  ai: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2a5 5 0 0 1 5 5v2a5 5 0 0 1-10 0V7a5 5 0 0 1 5-5z" />
      <path d="M19 11a7 7 0 0 1-14 0M12 18v4" />
    </svg>
  ),
  profile: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" />
    </svg>
  ),
  talent: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2l2.9 6.3L22 9.3l-5 4.9 1.2 6.9L12 17.8 5.8 21.1 7 14.2 2 9.3l7.1-1z" />
    </svg>
  ),
};

/**
 * Employee sidebar items. Onboarding stays visible after completion so
 * employees can reopen their completed onboarding record.
 */
export function getEmployeeNavItems({ profileComplete = false } = {}) {
  return [
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
      badge: profileComplete ? "Completed" : null,
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
      key: "talent",
      label: "My Talent",
      module: "learning",
      href: "/dashboard/employee/talent",
      icon: EMPLOYEE_NAV_ICONS.talent,
    },
    {
      key: "profile",
      label: "Profile",
      module: "profile",
      href: "/dashboard/employee/profile",
      icon: EMPLOYEE_NAV_ICONS.profile,
    },
  ];
}

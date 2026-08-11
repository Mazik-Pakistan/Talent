"use client";

/**
 * Recruiter sidebar items.
 * Each maps to exactly one independent capability key.
 */

import { hasCapability } from "../../services/rbac";

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "1.8",
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

const ALL_NAV_ITEMS = [
  {
    key: "overview",
    label: "Overview",
    href: "/dashboard/recruiter/overview",
    capability: "overview",
    icon: (
      <svg {...iconProps}>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },

  {
    key: "candidates",
    label: "Candidates",
    href: "/dashboard/recruiter/candidates",
    capability: "candidates",
    icon: (
      <svg {...iconProps}>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M3 20c.6-3.4 2.6-5.2 6-5.2s5.4 1.8 6 5.2" />
        <path d="M16 5.5a3.5 3.5 0 0 1 0 5.9" />
        <path d="M18 14.8c1.8.8 2.8 2.4 3 5.2" />
      </svg>
    ),
  },

  {
    key: "invite",
    label: "Invite & Offer",
    href: "/dashboard/recruiter/invite",
    capability: "invite",
    icon: (
      <svg {...iconProps}>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M3 20c.6-3.4 2.6-5.2 6-5.2s5.4 1.8 6 5.2" />
        <path d="M19 12v7" />
        <path d="M15.5 15.5h7" />
      </svg>
    ),
  },

  {
    key: "employees",
    label: "Employees",
    href: "/dashboard/recruiter/employees",
    capability: "employees",
    icon: (
      <svg {...iconProps}>
        <rect x="3" y="6.5" width="18" height="14" rx="2" />
        <path d="M8 6.5V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1.5" />
        <path d="M3 11h18" />
        <path d="M10 14h4" />
      </svg>
    ),
  },

  {
    key: "talent",
    label: "Talent",
    href: "/dashboard/recruiter/talent",
    capability: "talent",
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5 20c.7-3.5 3-5.5 7-5.5s6.3 2 7 5.5" />
        <path d="M19 3.5l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6z" />
      </svg>
    ),
  },

  {
    key: "learning",
    label: "Learning",
    href: "/dashboard/recruiter/learning",
    capability: "learning",
    icon: (
      <svg {...iconProps}>
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 1 4 17.5z" />
        <path d="M4 5.5v12" />
        <path d="M8 7h8" />
        <path d="M8 11h6" />
      </svg>
    ),
  },

  {
    key: "org-config",
    label: "Organization Setup",
    href: "/dashboard/recruiter/organization-config",
    capability: "org_config",
    icon: (
      <svg {...iconProps}>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M9 21v-6h6v6" />
        <path d="M8 7h.01" />
        <path d="M12 7h.01" />
        <path d="M16 7h.01" />
        <path d="M8 11h.01" />
        <path d="M12 11h.01" />
        <path d="M16 11h.01" />
      </svg>
    ),
  },

  {
    key: "messages",
    label: "Messages",
    href: "/dashboard/recruiter/messages",
    capability: "messages",
    icon: (
      <svg {...iconProps}>
        <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H7l-4 2v-9.5A7.5 7.5 0 0 1 10.5 4h2A7.5 7.5 0 0 1 20 11.5z" />
        <path d="M8 11h.01" />
        <path d="M12 11h.01" />
        <path d="M16 11h.01" />
      </svg>
    ),
  },

  {
    key: "announcements",
    label: "Announcements",
    href: "/dashboard/recruiter/announcements",
    capability: "announcements",
    icon: (
      <svg {...iconProps}>
        <path d="M4 14V10l12-4v12L4 14z" />
        <path d="M16 9.5a3.5 3.5 0 0 1 0 5" />
        <path d="M6 14l1.5 5h3L9 15" />
      </svg>
    ),
  },

  {
    key: "it-provisioning",
    label: "IT Support",
    href: "/dashboard/recruiter/it",
    capability: "it",
    icon: (
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
  },

  {
    key: "activity",
    label: "Activity",
    href: "/dashboard/recruiter/activity",
    capability: "reporting",
    icon: (
      <svg {...iconProps}>
        <path d="M3 17h4l2.5-7 4 10L16 13h5" />
        <path d="M3 6h4" />
      </svg>
    ),
  },

  {
    key: "assistant",
    label: "AI Assistant",
    href: "/dashboard/recruiter/ai-assistant",
    capability: "assistant",
    icon: (
      <svg {...iconProps}>
        <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" />
        <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z" />
      </svg>
    ),
  },

  {
    key: "support",
    label: "Support",
    href: "/dashboard/recruiter/support",
    capability: "support",
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9a2.6 2.6 0 1 1 4.8 1.4c-.8 1.1-2.3 1.4-2.3 2.9" />
        <path d="M12 17h.01" />
      </svg>
    ),
  },

  {
    key: "profile",
    label: "Profile",
    href: "/dashboard/recruiter/profile",
    capability: "profile",
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M4.5 20c.8-3.4 3.3-5.2 7.5-5.2s6.7 1.8 7.5 5.2" />
      </svg>
    ),
  },
];

/**
 * Get filtered nav items based on recruiter capabilities.
 */
export function getFilteredNavItems() {
  return ALL_NAV_ITEMS.filter((item) => {
    if (!item.capability) return true;
    return hasCapability(item.capability);
  });
}

export const RECRUITER_NAV_ITEMS = ALL_NAV_ITEMS;
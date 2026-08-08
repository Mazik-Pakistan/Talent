"use client";

import { getFieldLabel, isOpaqueDomId } from "@/lib/ai/formCoach";

/**
 * Super Admin field tips + page summaries for the mascot.
 */

export const SUPER_ADMIN_FIELD_HELP = {
  full_name: "Recruiter's full name as it appears in the sidebar and notifications.",
  email: "Email address for the invitation — they receive a link to set their password.",
  job_title: "Job title / designation shown on the recruiter's profile.",
  department: "Department assignment — used for filtering and org structure.",
  office_location: "Office location (optional) — shown in the recruiter directory.",
  password: "Temporary password for direct-create accounts (invite links use their own flow).",
  confirm_password: "Must match the password above.",
  organization_id: "Which organization this recruiter belongs to — modules are clamped to the org's purchases.",
  contact_email: "Organization contact email — used for notifications and account management.",
  description: "Brief description of the organization's purpose or industry.",
  subject: "Short ticket title that tells support what broke or what you need.",
  category: "Choose the closest issue type so the ticket reaches the right queue.",
  priority: "How urgent: Low, Medium, High, or Critical — this determines the response queue.",
  affected_module: "Which recruiter area, employee area, or system part is affected.",
  ticket_description: "Describe the issue, what you expected, and steps to reproduce.",
  reply: "Write your reply to the support ticket — they'll be notified.",
  q: "Search by name, email, or keyword to narrow the list.",
  status: "Filter by recruiter status: active, inactive, or pending.",
};

const LABEL_ALIASES = [
  [/full name/i, "full_name"],
  [/email/i, "email"],
  [/job title|designation/i, "job_title"],
  [/department/i, "department"],
  [/office|location/i, "office_location"],
  [/password/i, "password"],
  [/contact email/i, "contact_email"],
  [/organization|company/i, "organization_id"],
  [/description/i, "description"],
  [/subject|title/i, "subject"],
  [/category/i, "category"],
  [/priority/i, "priority"],
  [/module|affected/i, "affected_module"],
  [/reply|message/i, "reply"],
  [/search/i, "q"],
  [/status/i, "status"],
];

export function superAdminFieldHelpFor(field) {
  if (!field) return null;
  const dataKey = field.getAttribute?.("data-field-key") || "";
  const raw = dataKey || field.name || (isOpaqueDomId(field.id) ? "" : field.id) || "";
  const name = String(raw).toLowerCase().replace(/-/g, "_");
  if (name && SUPER_ADMIN_FIELD_HELP[name]) return SUPER_ADMIN_FIELD_HELP[name];

  const camel = String(raw).replace(/-/g, "");
  if (camel && SUPER_ADMIN_FIELD_HELP[camel]) return SUPER_ADMIN_FIELD_HELP[camel];

  const label = getFieldLabel(field);
  if (label && label !== "This field") {
    for (const [re, key] of LABEL_ALIASES) {
      if (re.test(label) && SUPER_ADMIN_FIELD_HELP[key]) return SUPER_ADMIN_FIELD_HELP[key];
    }
    for (const [key, tip] of Object.entries(SUPER_ADMIN_FIELD_HELP)) {
      if (label.toLowerCase().includes(key.replace(/_/g, " "))) return tip;
    }
    return `"${label}" — fill this carefully; it becomes part of the platform configuration.`;
  }

  if (name) return `You're editing "${name.replace(/_/g, " ")}". Fill it carefully.`;
  return null;
}

export const SUPER_ADMIN_TAB_HELP = {
  overview: {
    title: "Platform overview",
    hint: "See total recruiters, active vs pending invitations, and organizations at a glance.",
    fields: [],
  },
  invite: {
    title: "Invite recruiter",
    hint: "Create a recruiter account with name, email, and role capabilities — they receive an invitation link.",
    fields: ["full_name", "email", "job_title", "department", "office_location", "organization_id"],
  },
  recruiters: {
    title: "Recruiter management",
    hint: "View, edit, or deactivate recruiter accounts. Bulk-edit capabilities with templates.",
    fields: ["q", "status"],
  },
  organizations: {
    title: "Organizations",
    hint: "Create and manage organizations — each org controls which modules its recruiters can access.",
    fields: ["contact_email", "description"],
  },
  support: {
    title: "Support tickets",
    hint: "View and manage all support tickets across the platform — assign, reply, and resolve.",
    fields: [],
  },
};

export const SUPER_ADMIN_PAGE_SUMMARIES = {
  overview: {
    title: "Platform Overview",
    what: "See total recruiters, active vs pending invitations, and organizations.",
    why: "Keeps you informed about platform health and growth at a glance.",
  },
  invite: {
    title: "Invite Recruiter",
    what: "Create a recruiter account with name, email, and role capabilities.",
    why: "Onboards new recruiters to the platform with the right access.",
  },
  recruiters: {
    title: "Recruiter Management",
    what: "View, edit, or deactivate recruiter accounts and bulk-edit capabilities.",
    why: "Maintains access control and recruiter lifecycle across the platform.",
  },
  organizations: {
    title: "Organizations",
    what: "Create and manage organizations — each org controls which modules its recruiters can access.",
    why: "Multi-tenancy backbone — module purchases here determine feature availability.",
  },
  support: {
    title: "Support Tickets",
    what: "View and manage all support tickets across the platform.",
    why: "Keeps issues moving and escalations visible to platform admins.",
  },
};

export function superAdminPageSummaryFor(pathname, context = null) {
  if (!pathname) return null;

  const tab = context?.tab || context?.section;
  const tabHelp = tab ? SUPER_ADMIN_TAB_HELP[tab] : null;
  if (tabHelp) {
    return {
      key: `super-admin-${tab}`,
      title: tabHelp.title || "Platform Admin",
      what: tabHelp.hint,
      why: SUPER_ADMIN_PAGE_SUMMARIES[tab]?.why || "Keep the platform running smoothly.",
    };
  }

  return {
    key: "super-admin",
    title: "Platform Admin",
    what: "Manage recruiters, organizations, and platform configuration.",
    why: "You're in control of the entire platform — focus a field for tips.",
  };
}

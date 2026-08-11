"use client";

import { listRecruiters, listOrganizations } from "@/services/authService";
import { MASCOT_PRIORITY } from "@/lib/ai/superAdminContext";
import {
  SUPER_ADMIN_TAB_HELP,
  SUPER_ADMIN_PAGE_SUMMARIES,
} from "@/lib/ai/superAdminFieldHelp";

/**
 * Contextual guidance for the Super Admin Mascot.
 * Data-driven tips from platform stats + live page/tab context.
 */

const CACHE_TTL_MS = 45000;
const cache = new Map();

export const SUPER_ADMIN_INSIGHTS_REFRESH_EVENT = "talent-super-admin-data-changed";

async function cached(key, loader, ttl = CACHE_TTL_MS) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await loader();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function invalidateSuperAdminInsightCache() {
  cache.clear();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SUPER_ADMIN_INSIGHTS_REFRESH_EVENT));
  }
}

function push(insights, item) {
  if (!item?.message) return;
  const normalized = String(item.message).trim().toLowerCase();
  if (
    insights.some(
      (existing) =>
        existing.id === item.id ||
        String(existing.message || "").trim().toLowerCase() === normalized
    )
  ) {
    return;
  }
  insights.push({
    priority: MASCOT_PRIORITY.tip,
    tone: "info",
    ...item,
  });
}

function sortByPriority(insights) {
  return [...insights].sort((a, b) => (a.priority || 99) - (b.priority || 99));
}

function pushContextHints(insights, context) {
  if (context?.hint) {
    push(insights, {
      id: "context-hint",
      priority: MASCOT_PRIORITY.task,
      message: context.hint,
    });
  }
  if (context?.fields?.length) {
    push(insights, {
      id: "context-fields",
      priority: MASCOT_PRIORITY.insight,
      message: `On this step, fill: ${context.fields.map((f) => String(f).replace(/_/g, " ")).join(", ")}. Focus one for a tip.`,
    });
  }
}

async function loadPlatformSnapshot(accessToken) {
  if (!accessToken) return null;

  return cached("super-admin-snapshot", async () => {
    const [recruitersData, orgsData] = await Promise.all([
      listRecruiters(accessToken, { page_size: 200 }).catch(() => null),
      listOrganizations(accessToken).catch(() => null),
    ]);

    const recruiters = recruitersData?.recruiters || [];
    const organizations = orgsData?.organizations || [];

    const active = recruiters.filter((r) => r.status === "active" || r.is_active).length;
    const pending = recruiters.filter((r) => r.status === "pending").length;
    const inactive = recruiters.filter((r) => r.status === "inactive").length;

    return {
      totalRecruiters: recruiters.length,
      activeRecruiters: active,
      pendingInvitations: pending,
      inactiveRecruiters: inactive,
      totalOrganizations: organizations.length,
    };
  });
}

function overviewInsights(snapshot) {
  const insights = [];

  if (snapshot) {
    if (snapshot.pendingInvitations > 0) {
      push(insights, {
        id: "sa-overview-pending",
        priority: MASCOT_PRIORITY.task,
        tone: "warn",
        message:
          snapshot.pendingInvitations === 1
            ? "1 pending invitation — consider sending a reminder or revoking if stale."
            : `${snapshot.pendingInvitations} pending invitations — send reminders or revoke stale ones.`,
      });
    }
    if (snapshot.inactiveRecruiters > 0) {
      push(insights, {
        id: "sa-overview-inactive",
        priority: MASCOT_PRIORITY.insight,
        message: `${snapshot.inactiveRecruiters} inactive recruiter${snapshot.inactiveRecruiters === 1 ? "" : "s"} — review and reactivate or remove.`,
      });
    }
    if (snapshot.totalOrganizations === 0) {
      push(insights, {
        id: "sa-overview-no-orgs",
        priority: MASCOT_PRIORITY.task,
        message: "No organizations yet — create one to enable module permissions for recruiters.",
      });
    }
    if (snapshot.activeRecruiters > 0) {
      push(insights, {
        id: "sa-overview-active",
        priority: MASCOT_PRIORITY.tip,
        message: `${snapshot.activeRecruiters} active recruiter${snapshot.activeRecruiters === 1 ? "" : "s"} on the platform.`,
      });
    }
  }

  push(insights, {
    id: "sa-overview-tip",
    priority: MASCOT_PRIORITY.tip,
    message: "Use the tabs above to invite recruiters, manage organizations, or review support tickets.",
  });

  return insights;
}

function inviteInsights(context) {
  return [
    {
      id: "sa-invite-what",
      priority: MASCOT_PRIORITY.task,
      message: "Create a recruiter account with name, email, and capabilities — they receive an invitation link.",
    },
    {
      id: "sa-invite-org",
      priority: MASCOT_PRIORITY.insight,
      message: "Select an organization first — module capabilities are clamped to what the org has purchased.",
    },
    {
      id: "sa-invite-guide",
      priority: MASCOT_PRIORITY.tip,
      message: "Need help filling the form? Tap Guide me through it for field-by-field help.",
    },
  ];
}

function recruitersInsights(snapshot) {
  const insights = [];
  if (snapshot) {
    if (snapshot.totalRecruiters > 0) {
      push(insights, {
        id: "sa-recruiters-count",
        priority: MASCOT_PRIORITY.insight,
        message: `${snapshot.totalRecruiters} recruiter${snapshot.totalRecruiters === 1 ? "" : "s"} on the platform — ${snapshot.activeRecruiters} active, ${snapshot.pendingInvitations} pending.`,
      });
      if (snapshot.inactiveRecruiters > 0) {
        push(insights, {
          id: "sa-recruiters-inactive",
          priority: MASCOT_PRIORITY.task,
          message: `${snapshot.inactiveRecruiters} inactive recruiter${snapshot.inactiveRecruiters === 1 ? "" : "s"} — review and reactivate or remove from this page.`,
        });
      }
    } else {
      push(insights, {
        id: "sa-recruiters-empty",
        priority: MASCOT_PRIORITY.task,
        message: "No recruiters yet — use the Invite tab or click Invite Recruiter to create the first account.",
      });
    }
  }
  push(insights, {
    id: "sa-recruiters-search",
    priority: MASCOT_PRIORITY.tip,
    message: "Use the search bar to find recruiters by name, email, department, or job title.",
  });
  push(insights, {
    id: "sa-recruiters-status-filter",
    priority: MASCOT_PRIORITY.tip,
    message: "Filter by status — Active, Pending, or Inactive — to focus on recruiters that need attention.",
  });
  push(insights, {
    id: "sa-recruiters-org-filter",
    priority: MASCOT_PRIORITY.tip,
    message: "Filter by organization to manage recruiters within a specific company.",
  });
  push(insights, {
    id: "sa-recruiters-bulk",
    priority: MASCOT_PRIORITY.tip,
    message: "Select multiple recruiters and use Bulk Edit to apply a role template or change status at once.",
  });
  push(insights, {
    id: "sa-recruiters-capabilities",
    priority: MASCOT_PRIORITY.tip,
    message: "Each recruiter's capabilities control which modules they can access — review and adjust them in the edit panel.",
  });
  push(insights, {
    id: "sa-recruiters-actions",
    priority: MASCOT_PRIORITY.tip,
    message: "From this page you can edit profiles, toggle status, manage capabilities, or remove recruiters.",
  });
  push(insights, {
    id: "sa-recruiters-refresh",
    priority: MASCOT_PRIORITY.tip,
    message: "Use Refresh to reload the latest recruiter data from the server.",
  });
  return insights;
}

function organizationsInsights(snapshot) {
  const insights = [];
  if (snapshot) {
    if (snapshot.totalOrganizations > 0) {
      push(insights, {
        id: "sa-orgs-count",
        priority: MASCOT_PRIORITY.insight,
        message: `${snapshot.totalOrganizations} organization${snapshot.totalOrganizations === 1 ? "" : "s"} configured.`,
      });
    } else {
      push(insights, {
        id: "sa-orgs-empty",
        priority: MASCOT_PRIORITY.task,
        message: "No organizations yet — create one to enable module permissions for recruiters.",
      });
    }
  }
  push(insights, {
    id: "sa-orgs-modules",
    priority: MASCOT_PRIORITY.tip,
    message: "Each organization's purchased modules determine what its recruiters can access.",
  });
  return insights;
}

function supportInsights() {
  return [
    {
      id: "sa-support-what",
      priority: MASCOT_PRIORITY.task,
      message: "View and manage all support tickets across the platform — assign, reply, and resolve.",
    },
    {
      id: "sa-support-tip",
      priority: MASCOT_PRIORITY.tip,
      message: "Filter by status or priority to find tickets that need attention.",
    },
  ];
}

export async function buildSuperAdminInsights(pathname, accessToken, rawContext = {}) {
  const context = rawContext;
  const tab = context?.tab || context?.section || "overview";
  const snapshot = await loadPlatformSnapshot(accessToken);
  const insights = [];

  pushContextHints(insights, context);

  if (tab === "overview") {
    insights.push(...overviewInsights(snapshot));
  } else if (tab === "invite") {
    insights.push(...inviteInsights(context));
  } else if (tab === "recruiters") {
    insights.push(...recruitersInsights(snapshot));
  } else if (tab === "organizations") {
    insights.push(...organizationsInsights(snapshot));
  } else if (tab === "support") {
    insights.push(...supportInsights());
  }

  const summary = SUPER_ADMIN_PAGE_SUMMARIES[tab];
  if (summary?.what) {
    push(insights, {
      id: `page-what-${tab}`,
      priority: MASCOT_PRIORITY.tip,
      message: summary.what,
    });
  }
  if (summary?.why) {
    push(insights, {
      id: `page-why-${tab}`,
      priority: MASCOT_PRIORITY.tip,
      message: summary.why,
    });
  }

  if (!insights.length) {
    push(insights, {
      id: "fallback",
      priority: MASCOT_PRIORITY.tip,
      message: "Focus any field for help, or tap me for the next tip on this view.",
    });
  }

  return {
    insights: sortByPriority(insights),
    stats: snapshot || {},
    snapshot,
  };
}

export function buildIdleInsights(insights) {
  return (insights || [])
    .filter((item) => item.priority >= MASCOT_PRIORITY.tip)
    .map((item) => item.message);
}

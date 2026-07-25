"use client";

import {
  getDashboardActivity,
  getDashboardSummary,
  getOnboardingInProgress,
  getPendingReview,
  getReadyForConversion,
  getRecruiterMascotBrief,
} from "@/services/authService";
import { getLearningAnalytics } from "@/services/learningService";
import { getTalentMetrics } from "@/services/talentService";
import { MASCOT_PRIORITY } from "@/lib/ai/recruiterContext";

/**
 * Contextual guidance for the Recruiter Mascot (NOT the Employee Copilot).
 *
 * Rule-based insights use cached recruiter APIs. OpenRouter is invoked only
 * for high-value briefs (overview / pipeline summaries) via the shared backend
 * llm_service — never from the browser.
 */

const CACHE_TTL_MS = 45000;
const AI_BRIEF_TTL_MS = 300000;
const cache = new Map();

/** Fired when recruiter data changes so the mascot refetches insights. */
export const RECRUITER_INSIGHTS_REFRESH_EVENT = "talent-recruiter-data-changed";

async function cached(key, loader, ttl = CACHE_TTL_MS) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await loader();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function invalidateRecruiterInsightCache() {
  cache.clear();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(RECRUITER_INSIGHTS_REFRESH_EVENT));
  }
}

function push(insights, item) {
  if (!item?.message) return;
  if (insights.some((existing) => existing.id === item.id)) return;
  insights.push({
    priority: MASCOT_PRIORITY.tip,
    tone: "info",
    ...item,
  });
}

function sortByPriority(insights) {
  return [...insights].sort((a, b) => (a.priority || 99) - (b.priority || 99));
}

function recruiterPageKey(pathname) {
  if (!pathname) return "unknown";
  if (pathname.includes("/overview")) return "overview";
  if (pathname.includes("/invite")) return "invite";
  if (pathname.includes("/candidates")) return "candidates";
  if (pathname.includes("/employees")) return "employees";
  if (pathname.includes("/learning")) return "learning";
  if (pathname.includes("/talent")) return "talent";
  if (pathname.includes("/announcements")) return "announcements";
  if (pathname.includes("/activity")) return "activity";
  if (pathname.includes("/profile")) return "profile";
  return "other";
}

function listToSentence(items) {
  if (!items?.length) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

async function loadRecruiterSnapshot(accessToken) {
  if (!accessToken) return null;

  return cached("recruiter-snapshot", async () => {
    const [summary, pending, ready, inProgress, activity] = await Promise.all([
      getDashboardSummary(accessToken).catch(() => null),
      getPendingReview(accessToken).catch(() => null),
      getReadyForConversion(accessToken).catch(() => null),
      getOnboardingInProgress(accessToken).catch(() => null),
      getDashboardActivity(accessToken, 5).catch(() => null),
    ]);

    const pendingApprovals = summary?.pending_approvals || [];
    const readyList = ready?.candidates || [];
    const pendingList = pending?.candidates || [];
    const inProgressList = inProgress?.candidates || [];

    return {
      summary,
      kpis: summary?.kpis || {},
      pendingApprovals,
      pendingApprovalCount: pendingApprovals.length,
      readyCandidates: readyList,
      readyCount: readyList.length,
      pendingOffers: pendingList,
      pendingOfferCount: pendingList.length,
      onboardingInProgress: inProgressList,
      onboardingCount: inProgressList.length,
      upcomingJoinings: summary?.upcoming_joining_dates || [],
      recentActivity: activity?.activities || [],
      unreadNotifications: summary?.notifications_unread_count || 0,
    };
  });
}

function pipelineStats(snapshot) {
  if (!snapshot) {
    return {
      pendingApprovals: 0,
      readyCandidates: 0,
      pendingOffers: 0,
      onboardingInProgress: 0,
      activeEmployees: 0,
      pendingOnboarding: 0,
      unreadNotifications: 0,
    };
  }
  return {
    pendingApprovals: snapshot.pendingApprovalCount,
    readyCandidates: snapshot.readyCount,
    pendingOffers: snapshot.pendingOfferCount,
    onboardingInProgress: snapshot.onboardingCount,
    activeEmployees: snapshot.kpis?.active_employees || 0,
    pendingOnboarding: snapshot.kpis?.pending_onboarding || 0,
    unreadNotifications: snapshot.unreadNotifications,
  };
}

function approvalInsight(snapshot) {
  const count = snapshot?.pendingApprovalCount || 0;
  if (!count) return null;
  const names = (snapshot.pendingApprovals || []).slice(0, 2).map((c) => c.full_name).filter(Boolean);
  const nameHint = names.length ? ` — ${listToSentence(names)}` : "";
  return {
    id: "pipeline-approvals",
    priority: MASCOT_PRIORITY.task,
    tone: count > 2 ? "warn" : "info",
    message:
      count === 1
        ? `1 onboarding submission awaits your review${nameHint}.`
        : `${count} approvals need attention${nameHint}.`,
  };
}

function readyInsight(snapshot) {
  const count = snapshot?.readyCount || 0;
  if (!count) return null;
  const first = snapshot.readyCandidates?.[0]?.full_name;
  const nameHint = first ? (count === 1 ? `${first} is ready to activate.` : `${first} and ${count - 1} more ready to activate.`) : null;
  return {
    id: "pipeline-ready",
    priority: MASCOT_PRIORITY.task,
    message:
      nameHint ||
      (count === 1 ? "1 signed offer is ready for activation." : `${count} candidates are ready to activate.`),
  };
}

function pendingOfferInsight(snapshot) {
  const count = snapshot?.pendingOfferCount || 0;
  if (!count) return null;
  const first = snapshot.pendingOffers?.[0]?.full_name;
  return {
    id: "pipeline-offers",
    priority: MASCOT_PRIORITY.task,
    message: first
      ? count === 1
        ? `${first} needs an offer review.`
        : `${count} candidates need offer action — starting with ${first}.`
      : `${count} candidate${count > 1 ? "s" : ""} need offer review.`,
  };
}

function onboardingInsight(snapshot) {
  const count = snapshot?.onboardingCount || 0;
  if (!count) return null;
  return {
    id: "pipeline-onboarding",
    priority: MASCOT_PRIORITY.insight,
    message:
      count === 1
        ? "1 candidate is onboarding — follow up if progress stalls."
        : `${count} candidates are mid-onboarding.`,
  };
}

function recentActivityInsight(snapshot) {
  const latest = snapshot?.recentActivity?.[0];
  if (!latest?.label && !latest?.action) return null;
  const label = latest.label || latest.action?.replace(/_/g, " ");
  const who = latest.full_name || latest.email || "";
  return {
    id: `activity-${latest.id || label}`,
    priority: MASCOT_PRIORITY.insight,
    message: who ? `Latest: ${who} — ${label}.` : `Latest activity: ${label}.`,
  };
}

function upcomingJoiningInsight(snapshot) {
  const upcoming = snapshot?.upcomingJoinings || [];
  if (!upcoming.length) return null;
  const next = upcoming[0];
  return {
    id: "upcoming-joining",
    priority: MASCOT_PRIORITY.insight,
    message: next?.full_name
      ? `${next.full_name} joins ${formatShortDate(next.start_date)}.`
      : `${upcoming.length} joining${upcoming.length > 1 ? "s" : ""} in the next 30 days.`,
  };
}

function formatShortDate(value) {
  if (!value) return "soon";
  try {
    return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "soon";
  }
}

function pageInsights(page, snapshot, context) {
  const stats = pipelineStats(snapshot);
  const section = context?.section || context?.tab || null;

  if (page === "overview") {
    const insights = [];
    [approvalInsight, readyInsight, pendingOfferInsight, upcomingJoiningInsight, recentActivityInsight].forEach(
      (fn) => {
        const item = fn(snapshot);
        if (item) push(insights, item);
      }
    );

    if (stats.activeEmployees) {
      push(insights, {
        id: "kpi-employees",
        priority: MASCOT_PRIORITY.tip,
        message: `${stats.activeEmployees} active employee${stats.activeEmployees === 1 ? "" : "s"} on your roster.`,
      });
    }
    if (stats.pendingOnboarding) {
      push(insights, {
        id: "kpi-onboarding",
        priority: MASCOT_PRIORITY.insight,
        message: `${stats.pendingOnboarding} onboarding case${stats.pendingOnboarding === 1 ? "" : "s"} in progress.`,
      });
    }
    push(insights, {
      id: "overview-hint",
      priority: MASCOT_PRIORITY.tip,
      message: "Your overview reflects live pipeline KPIs — approvals, offers, and join dates.",
    });
    return insights;
  }

  if (page === "candidates") {
    const insights = [];
    [approvalInsight, pendingOfferInsight, readyInsight, onboardingInsight].forEach((fn) => {
      const item = fn(snapshot);
      if (item) push(insights, item);
    });
    if (!insights.length) {
      push(insights, {
        id: "candidates-clear",
        priority: MASCOT_PRIORITY.tip,
        message: "Pipeline looks clear — invite someone new when you're ready.",
      });
    }
    push(insights, {
      id: "candidates-filter",
      priority: MASCOT_PRIORITY.tip,
      message: "Track each stage: new signups, offer review, and activation.",
    });
    return insights;
  }

  if (page === "invite") {
    const insights = [];
    if (stats.onboardingInProgress) {
      push(insights, {
        id: "invite-in-progress",
        priority: MASCOT_PRIORITY.insight,
        message: `${stats.onboardingInProgress} invitation${stats.onboardingInProgress === 1 ? "" : "s"} already in progress.`,
      });
    }
    push(insights, {
      id: "invite-form",
      priority: MASCOT_PRIORITY.task,
      message: section
        ? `Complete ${section.replace(/_/g, " ")} before sending the invite.`
        : "Fill candidate details, designation, and department before sending.",
    });
    push(insights, {
      id: "invite-expiry",
      priority: MASCOT_PRIORITY.tip,
      message: "Set a sensible expiry — most teams use 7 days.",
    });
    return insights;
  }

  if (page === "employees") {
    const insights = [];
    if (stats.activeEmployees) {
      push(insights, {
        id: "employees-count",
        priority: MASCOT_PRIORITY.insight,
        message: `${stats.activeEmployees} active employee${stats.activeEmployees === 1 ? "" : "s"} in your directory.`,
      });
    }
    const recent = snapshot?.summary?.recent_employees?.[0];
    if (recent?.full_name) {
      push(insights, {
        id: "employees-recent",
        priority: MASCOT_PRIORITY.tip,
        message: `Recently added: ${recent.full_name}${recent.job_title ? ` (${recent.job_title})` : ""}.`,
      });
    }
    push(insights, {
      id: "employees-search",
      priority: MASCOT_PRIORITY.tip,
      message: "Search employees from the top bar or open a profile for assets and orientation.",
    });
    return insights;
  }

  if (page === "announcements") {
    return [
      {
        id: "announcements-create",
        priority: MASCOT_PRIORITY.tip,
        message: "Broadcast updates to candidates and employees from here.",
      },
      {
        id: "announcements-audience",
        priority: MASCOT_PRIORITY.tip,
        message: "Target announcements by audience so the right people see them.",
      },
    ];
  }

  if (page === "activity") {
    const insights = [];
    const act = recentActivityInsight(snapshot);
    if (act) push(insights, act);
    push(insights, {
      id: "activity-audit",
      priority: MASCOT_PRIORITY.tip,
      message: "Audit invitation, offer, and activation events across your pipeline.",
    });
    return insights;
  }

  if (page === "profile") {
    return [
      {
        id: "profile-update",
        priority: MASCOT_PRIORITY.tip,
        message: "Keep your recruiter profile current — HR and candidates see your contact info.",
      },
    ];
  }

  return [];
}

async function learningPageInsights(accessToken) {
  const insights = [];
  try {
    const data = accessToken ? await cached("learning-analytics", () => getLearningAnalytics(accessToken)) : null;
    const assignments = data?.total_assignments ?? data?.assignments_count;
    const completions = data?.completion_rate;
    if (assignments != null) {
      push(insights, {
        id: "learning-assignments",
        priority: MASCOT_PRIORITY.insight,
        message: `${assignments} learning assignment${assignments === 1 ? "" : "s"} tracked across your org.`,
      });
    }
    if (completions != null && completions < 70) {
      push(insights, {
        id: "learning-completion",
        priority: MASCOT_PRIORITY.task,
        tone: "warn",
        message: `Completion rate is ${Math.round(completions)}% — consider nudging teams with open courses.`,
      });
    }
    push(insights, {
      id: "learning-roles",
      priority: MASCOT_PRIORITY.tip,
      message: "Assign corporate learning paths by role and review skill requirements.",
    });
  } catch {
    push(insights, {
      id: "learning-fallback",
      priority: MASCOT_PRIORITY.tip,
      message: "Manage role skills, certifications, and course assignments here.",
    });
  }
  return insights;
}

async function talentPageInsights(accessToken) {
  const insights = [];
  try {
    const data = accessToken ? await cached("talent-metrics", () => getTalentMetrics(accessToken)) : null;
    const gaps = data?.skill_gaps?.length ?? data?.top_gaps?.length;
    if (gaps) {
      push(insights, {
        id: "talent-gaps",
        priority: MASCOT_PRIORITY.insight,
        message: `${gaps} skill gap${gaps === 1 ? "" : "s"} flagged — review talent analytics.`,
      });
    }
    push(insights, {
      id: "talent-opportunities",
      priority: MASCOT_PRIORITY.tip,
      message: "Post internal opportunities and compare candidate skills against open roles.",
    });
  } catch {
    push(insights, {
      id: "talent-fallback",
      priority: MASCOT_PRIORITY.tip,
      message: "Review skill match analytics and internal mobility from here.",
    });
  }
  return insights;
}

async function maybeAiBrief(accessToken, page, snapshot, firstName) {
  if (!accessToken || page !== "overview") return null;

  const stats = pipelineStats(snapshot);
  const hasSignal =
    stats.pendingApprovals > 0 ||
    stats.readyCandidates > 0 ||
    stats.pendingOffers > 0 ||
    stats.onboardingInProgress > 0;
  if (!hasSignal) return null;

  const cacheKey = `ai-brief:${page}:${stats.pendingApprovals}:${stats.readyCandidates}:${stats.pendingOffers}`;
  return cached(
    cacheKey,
    async () => {
      try {
        const payload = {
          page,
          first_name: firstName || null,
          pending_approvals: stats.pendingApprovals,
          ready_to_activate: stats.readyCandidates,
          pending_offers: stats.pendingOffers,
          onboarding_in_progress: stats.onboardingInProgress,
          active_employees: stats.activeEmployees,
          recent_names: (snapshot.pendingApprovals || [])
            .slice(0, 2)
            .map((c) => c.full_name)
            .filter(Boolean),
        };
        const result = await getRecruiterMascotBrief(payload, accessToken);
        if (result?.message) {
          return {
            id: "ai-brief",
            priority: MASCOT_PRIORITY.ai,
            message: String(result.message).slice(0, 140),
          };
        }
      } catch {
        // Rule-based insights already cover the page — AI is optional.
      }
      return null;
    },
    AI_BRIEF_TTL_MS
  );
}

/**
 * Build prioritized insight deck for the current recruiter route.
 */
export async function buildRecruiterInsights(pathname, accessToken, context = {}) {
  const page = recruiterPageKey(pathname);
  const snapshot = await loadRecruiterSnapshot(accessToken);
  const stats = pipelineStats(snapshot);
  const insights = [];

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
      priority: MASCOT_PRIORITY.task,
      message: `Focus on: ${listToSentence(context.fields)}.`,
    });
  }

  if (page === "learning") {
    insights.push(...(await learningPageInsights(accessToken)));
  } else if (page === "talent") {
    insights.push(...(await talentPageInsights(accessToken)));
  } else {
    insights.push(...pageInsights(page, snapshot, context));
  }

  const aiBrief = await maybeAiBrief(accessToken, page, snapshot, context?.firstName);
  if (aiBrief) push(insights, aiBrief);

  if (!insights.length) {
    push(insights, {
      id: "fallback",
      priority: MASCOT_PRIORITY.tip,
      message: "Need assistance? Click me to chat!",
    });
  }

  return {
    insights: sortByPriority(insights),
    stats,
    snapshot,
    page,
  };
}

/** Idle tips — lower priority items from the same data pool. */
export function buildIdleInsights(insights) {
  return (insights || [])
    .filter((item) => item.priority >= MASCOT_PRIORITY.tip)
    .map((item) => item.message);
}

/** Export stats shape for mascot memory / continuity. */
export { pipelineStats, loadRecruiterSnapshot };

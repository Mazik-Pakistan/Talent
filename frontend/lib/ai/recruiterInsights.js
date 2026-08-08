"use client";

import {
  getDashboardActivity,
  getDashboardSummary,
  getItOfficersOverview,
  getOnboardingInProgress,
  getPendingReview,
  getReadyForConversion,
  getRecruiterMascotBrief,
  listEmployees,
  listItServiceRequests,
} from "@/services/authService";
import {
  getLearningAnalytics,
  listPendingCertificates,
} from "@/services/learningService";
import { getTalentMetrics, browseOpportunities } from "@/services/talentService";
import { MASCOT_PRIORITY } from "@/lib/ai/recruiterContext";
import {
  EMPLOYEE_TAB_HELP,
  LEARNING_TAB_HELP,
  ORG_CONFIG_TAB_HELP,
  TALENT_TAB_HELP,
  pathMatchesPageKey,
} from "@/lib/ai/recruiterFieldHelp";
import { buildDocumentStatusInsights } from "@/lib/ai/documentStatusInsights";
import { scopedContext } from "@/lib/ai/contextScope";
import { RECRUITER_PAGE_SUMMARIES } from "@/lib/ai/recruiterFieldHelp";

/**
 * Contextual guidance for the Recruiter Mascot (partner — not Hiring Agent).
 * Rule-based actionable tips from dashboard APIs + live page/tab context.
 */

const CACHE_TTL_MS = 45000;
const AI_BRIEF_TTL_MS = 300000;
const cache = new Map();

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
  const normalized = String(item.message).trim().toLowerCase();
  if (
    insights.some(
      (existing) =>
        existing.id === item.id ||
        String(existing.message || "")
          .trim()
          .toLowerCase() === normalized
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

function recruiterPageKey(pathname) {
  if (!pathname) return "unknown";
  if (pathMatchesPageKey(pathname, "overview")) return "overview";
  if (pathMatchesPageKey(pathname, "invite")) return "invite";
  if (pathname.includes("/candidates/")) return "candidate_detail";
  if (pathMatchesPageKey(pathname, "candidates")) return "candidates";
  if (pathname.includes("/employees/")) return "employee_detail";
  if (pathMatchesPageKey(pathname, "employees")) return "employees";
  if (pathMatchesPageKey(pathname, "learning")) return "learning";
  if (pathMatchesPageKey(pathname, "talent")) return "talent";
  if (pathMatchesPageKey(pathname, "announcements")) return "announcements";
  if (pathMatchesPageKey(pathname, "messages")) return "messages";
  if (pathMatchesPageKey(pathname, "activity")) return "activity";
  if (pathMatchesPageKey(pathname, "profile")) return "profile";
  if (pathMatchesPageKey(pathname, "support")) return "support";
  if (pathMatchesPageKey(pathname, "organization-config")) return "organization-config";
  if (pathMatchesPageKey(pathname, "it-kits")) return "it-kits";
  if (pathMatchesPageKey(pathname, "it")) return "it";
  return "other";
}

function listToSentence(items) {
  if (!items?.length) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function firstNames(list, n = 2) {
  return (list || []).slice(0, n).map((c) => c.full_name).filter(Boolean);
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
      documentsPending: summary?.kpis?.documents_pending || 0,
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
      documentsPending: 0,
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
    documentsPending: snapshot.documentsPending || 0,
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
      message: `On this step, fill: ${listToSentence(context.fields.map((f) => String(f).replace(/_/g, " ")))}.`,
    });
  }
  if (context?.employeeName) {
    push(insights, {
      id: "context-employee",
      priority: MASCOT_PRIORITY.tip,
      message: `You're viewing ${context.employeeName}. Use the tabs for day-1, learning, talent, and documents.`,
    });
  }
}

function overviewInsights(snapshot) {
  const insights = [];
  const stats = pipelineStats(snapshot);
  const names = firstNames(snapshot?.pendingApprovals);
  const readyNames = firstNames(snapshot?.readyCandidates);
  const offerNames = firstNames(snapshot?.pendingOffers);
  const onboardNames = firstNames(snapshot?.onboardingInProgress);

  if (stats.pendingApprovals) {
    push(insights, {
      id: "next-approvals",
      priority: MASCOT_PRIORITY.pipeline,
      tone: "warn",
      message:
        stats.pendingApprovals === 1
          ? `Next: review ${names[0] || "1"} onboarding submission on Candidates.`
          : `Next: ${stats.pendingApprovals} submissions need review${names.length ? ` (incl. ${listToSentence(names)})` : ""} — open Candidates.`,
    });
  }
  if (stats.pendingOffers) {
    push(insights, {
      id: "next-offers",
      priority: MASCOT_PRIORITY.task,
      message:
        stats.pendingOffers === 1
          ? `Next: review docs and send an offer to ${offerNames[0] || "1 candidate"}.`
          : `Next: ${stats.pendingOffers} candidates need offer action${offerNames.length ? ` — start with ${offerNames[0]}` : ""}.`,
    });
  }
  if (stats.readyCandidates) {
    push(insights, {
      id: "next-activate",
      priority: MASCOT_PRIORITY.task,
      message:
        stats.readyCandidates === 1
          ? `Next: approve & activate ${readyNames[0] || "the signed candidate"}.`
          : `Next: ${stats.readyCandidates} signed offers are ready to activate${readyNames.length ? ` (e.g. ${readyNames[0]})` : ""}.`,
    });
  }
  if (stats.onboardingInProgress) {
    push(insights, {
      id: "next-remind",
      priority: MASCOT_PRIORITY.insight,
      message:
        stats.onboardingInProgress === 1
          ? `${onboardNames[0] || "1 candidate"} is mid-onboarding — send a reminder if stalled.`
          : `${stats.onboardingInProgress} candidates are mid-onboarding — remind anyone stuck.`,
    });
  }
  if (stats.documentsPending) {
    push(insights, {
      id: "next-docs",
      priority: MASCOT_PRIORITY.insight,
      message: `${stats.documentsPending} document${stats.documentsPending === 1 ? "" : "s"} pending verification.`,
    });
  }

  const upcoming = snapshot?.upcomingJoinings || [];
  if (upcoming[0]?.full_name) {
    push(insights, {
      id: "upcoming-joining",
      priority: MASCOT_PRIORITY.insight,
      message: `${upcoming[0].full_name} joins ${formatShortDate(upcoming[0].start_date)} — finish day-1 if needed.`,
    });
  }

  if (!insights.length) {
    push(insights, {
      id: "overview-clear",
      priority: MASCOT_PRIORITY.tip,
      message: "Pipeline looks clear — invite a new candidate when you're ready.",
    });
  } else {
    push(insights, {
      id: "overview-order",
      priority: MASCOT_PRIORITY.tip,
      message: "Suggested order: review → offer → activate → day-1 for new employees.",
    });
  }

  if (stats.activeEmployees) {
    push(insights, {
      id: "kpi-employees",
      priority: MASCOT_PRIORITY.tip,
      message: `${stats.activeEmployees} active employee${stats.activeEmployees === 1 ? "" : "s"} on your roster.`,
    });
  }
  return insights;
}

function candidatesInsights(snapshot) {
  const insights = [];
  const stats = pipelineStats(snapshot);
  const onboard = stats.onboardingInProgress;
  const offers = stats.pendingOffers;
  const ready = stats.readyCandidates;

  if (onboard) {
    push(insights, {
      id: "cand-onboard",
      priority: MASCOT_PRIORITY.task,
      message:
        onboard === 1
          ? "1 new signup in progress — open their profile or send a reminder."
          : `${onboard} candidates still onboarding — remind stalled ones, then open profiles to check progress.`,
    });
  }
  if (offers) {
    push(insights, {
      id: "cand-offers",
      priority: MASCOT_PRIORITY.pipeline,
      tone: "warn",
      message:
        offers === 1
          ? "1 candidate awaits offer review — verify documents, then Send offer letter."
          : `${offers} candidates await offer review — verify documents, then compose offers.`,
    });
  }
  if (ready) {
    push(insights, {
      id: "cand-ready",
      priority: MASCOT_PRIORITY.pipeline,
      message:
        ready === 1
          ? "1 signed offer is ready — click Approve & activate."
          : `${ready} signed offers are ready — Approve & activate each one.`,
    });
  }
  if (!onboard && !offers && !ready) {
    push(insights, {
      id: "cand-clear",
      priority: MASCOT_PRIORITY.tip,
      message: "No pending pipeline items — use Invite to add someone new.",
    });
  }
  push(insights, {
    id: "cand-flow",
    priority: MASCOT_PRIORITY.tip,
    message: "Flow: New signups → Pending offer review → Ready to activate.",
  });
  return insights;
}

function candidateDetailInsights(snapshot, context) {
  const insights = [];
  const docs = context?.documents || [];
  if (docs.length) {
    buildDocumentStatusInsights(docs, { audience: "reviewer" }).forEach((item) =>
      push(insights, {
        ...item,
        priority: item.tone === "warn" ? MASCOT_PRIORITY.task : MASCOT_PRIORITY.tip,
      })
    );
  } else {
    push(insights, {
      id: "cand-detail",
      priority: MASCOT_PRIORITY.task,
      message: context?.candidateName
        ? `Review ${context.candidateName}'s progress, documents, and missing fields — remind if stuck.`
        : "Check onboarding progress and documents. Send a reminder with an optional note if needed.",
    });
    push(insights, {
      id: "cand-detail-docs",
      priority: MASCOT_PRIORITY.tip,
      message: "Verify documents below — trust each card’s status badge (Verified / Pending / Reupload required).",
    });
  }
  push(insights, {
    id: "cand-detail-screen",
    priority: MASCOT_PRIORITY.tip,
    message: "If a tip feels off, check the status badge on the document card — that is the source of truth.",
  });
  if (snapshot?.pendingOfferCount) {
    push(insights, {
      id: "cand-detail-pipeline",
      priority: MASCOT_PRIORITY.insight,
      message: `${snapshot.pendingOfferCount} other candidate${snapshot.pendingOfferCount === 1 ? "" : "s"} still need offer action in the list.`,
    });
  }
  return insights;
}

function inviteInsights(snapshot, context) {
  const insights = [];
  push(insights, {
    id: "invite-why",
    priority: MASCOT_PRIORITY.insight,
    message:
      "This form creates one candidate invitation — they get a link to join your pipeline with the role you pick.",
  });
  push(insights, {
    id: "invite-fill",
    priority: MASCOT_PRIORITY.task,
    message: "Need help filling it? Tap “Guide me through it” and I’ll walk field by field.",
  });
  push(insights, {
    id: "invite-taxonomy",
    priority: MASCOT_PRIORITY.insight,
    message: "Designation & department matter: learning and talent tools use them from day one.",
  });
  push(insights, {
    id: "invite-optional",
    priority: MASCOT_PRIORITY.tip,
    message: "Office location and start date are optional — add them only if you already know.",
  });
  push(insights, {
    id: "invite-bulk",
    priority: MASCOT_PRIORITY.tip,
    message: "Inviting many people from Excel? Open AI Assistant for bulk invite.",
  });
  if (snapshot?.onboardingCount) {
    push(insights, {
      id: "invite-inflight",
      priority: MASCOT_PRIORITY.insight,
      message: `${snapshot.onboardingCount} invitation${snapshot.onboardingCount === 1 ? "" : "s"} already in progress.`,
    });
  }
  return insights;
}

async function employeesInsights(accessToken, snapshot) {
  const insights = [];
  const active = snapshot?.kpis?.active_employees || 0;
  if (active) {
    push(insights, {
      id: "emp-count",
      priority: MASCOT_PRIORITY.insight,
      message: `${active} active employee${active === 1 ? "" : "s"} in your directory.`,
    });
  }

  try {
    const incomplete = accessToken
      ? await cached("employees-incomplete", () =>
          listEmployees(accessToken, { profile_status: "incomplete", page_size: 1 })
        )
      : null;
    const total = incomplete?.total ?? incomplete?.count ?? incomplete?.employees?.length;
    if (total > 0) {
      push(insights, {
        id: "emp-incomplete",
        priority: MASCOT_PRIORITY.task,
        tone: "warn",
        message:
          total === 1
            ? "1 employee has an incomplete profile — filter Profile status = Incomplete, then send a reminder."
            : `${total} employees have incomplete profiles — filter Incomplete, open each, and send reminders.`,
      });
    }
  } catch {
    // optional signal
  }

  push(insights, {
    id: "emp-filters",
    priority: MASCOT_PRIORITY.tip,
    message: "Filter by department, designation, status, or profile completeness — then Export CSV if needed.",
  });
  push(insights, {
    id: "emp-career",
    priority: MASCOT_PRIORITY.tip,
    message: "Use Career timeline on a row to log promotions, title, or department changes.",
  });
  push(insights, {
    id: "emp-open",
    priority: MASCOT_PRIORITY.insight,
    message: "Open a profile for day-1 (email, assets, orientation), learning assign, and document verify.",
  });
  return insights;
}

function employeeDetailInsights(context) {
  const insights = [];
  const tab = context?.tab || context?.section || "overview";
  const tabHelp = EMPLOYEE_TAB_HELP[tab];
  if (tabHelp?.hint) {
    push(insights, {
      id: `emp-tab-${tab}`,
      priority: MASCOT_PRIORITY.task,
      message: tabHelp.hint,
    });
  }
  if (tabHelp?.fields?.length) {
    push(insights, {
      id: `emp-tab-fields-${tab}`,
      priority: MASCOT_PRIORITY.insight,
      message: `Fields on this tab: ${listToSentence(tabHelp.fields.map((f) => f.replace(/_/g, " ")))}. Focus one for a tip.`,
    });
  }
  if (tab === "day1") {
    push(insights, {
      id: "emp-day1-order",
      priority: MASCOT_PRIORITY.tip,
      message: "Day-1 order: company email → assign laptop/assets → schedule orientation with agenda.",
    });
  }
  if (tab === "learning") {
    push(insights, {
      id: "emp-learning-assign",
      priority: MASCOT_PRIORITY.tip,
      message: "Save role first if needed, then assign recommended courses or search the catalog.",
    });
  }
  if (tab === "documents" || context?.documents?.length) {
    const docs = context?.documents || [];
    if (docs.length) {
      buildDocumentStatusInsights(docs, { audience: "reviewer" }).forEach((item) =>
        push(insights, {
          ...item,
          priority: item.tone === "warn" ? MASCOT_PRIORITY.task : MASCOT_PRIORITY.tip,
        })
      );
    } else {
      push(insights, {
        id: "emp-docs-check-screen",
        priority: MASCOT_PRIORITY.tip,
        message: "Check each document card’s status badge — Reupload required means they must replace the file.",
      });
    }
  }
  return insights;
}

async function learningPageInsights(accessToken, context) {
  const insights = [];
  const tab = context?.tab || context?.section || "catalog";
  const tabHelp = LEARNING_TAB_HELP[tab];

  // Strict tab scope: only tips for the surface the recruiter is looking at.
  if (tab === "catalog") {
    push(insights, {
      id: "learn-catalog-what",
      priority: MASCOT_PRIORITY.task,
      message: tabHelp?.hint || "Browse courses here, then Assign when you find the right one.",
    });
    push(insights, {
      id: "learn-catalog-sources",
      priority: MASCOT_PRIORITY.tip,
      message: "Switch Microsoft / Coursera / Recruiter KB, then filter by role, level, or type.",
    });
    push(insights, {
      id: "learn-catalog-assign",
      priority: MASCOT_PRIORITY.insight,
      message: "Found a course? Use Assign to send it to people, a department, or a designation.",
    });
    return insights;
  }

  if (tab === "knowledge") {
    push(insights, {
      id: "learn-kb-what",
      priority: MASCOT_PRIORITY.task,
      message: tabHelp?.hint || "Add org roles and certifications for accurate matching.",
    });
    push(insights, {
      id: "learn-kb-roles",
      priority: MASCOT_PRIORITY.insight,
      message: "Add a role with title, skills, and certs — this powers career matching and recommendations.",
    });
    push(insights, {
      id: "learn-kb-certs",
      priority: MASCOT_PRIORITY.insight,
      message: "Add certifications/courses below so they appear in your Recruiter KB catalog.",
    });
    push(insights, {
      id: "learn-kb-guide",
      priority: MASCOT_PRIORITY.tip,
      message: "Need help filling the Add role form? Tap Guide me through it.",
    });
    return insights;
  }

  if (tab === "assign") {
    push(insights, {
      id: "learn-assign-what",
      priority: MASCOT_PRIORITY.task,
      message: tabHelp?.hint || "Pick a course, choose who gets it, set a due date, then Assign.",
    });
    push(insights, {
      id: "learn-assign-steps",
      priority: MASCOT_PRIORITY.pipeline,
      message: "Wizard order: course → audience (people / dept / designation / skills) → due date → Assign.",
    });
    push(insights, {
      id: "learn-assign-mandatory",
      priority: MASCOT_PRIORITY.tip,
      message: "Mark mandatory when the course is required — it shows up clearly on Track Progress.",
    });
    return insights;
  }

  if (tab === "assignments") {
    push(insights, {
      id: "learn-track-what",
      priority: MASCOT_PRIORITY.task,
      message: tabHelp?.hint || "See who started or finished — filter and follow up.",
    });
    try {
      if (accessToken) {
        const analytics = await cached("learning-analytics", () => getLearningAnalytics(accessToken)).catch(() => null);
        const assignments = analytics?.total_assignments ?? analytics?.assignments_count;
        const completion = analytics?.completion_rate ?? analytics?.mandatory_completion_rate;
        if (assignments != null) {
          push(insights, {
            id: "learn-track-count",
            priority: MASCOT_PRIORITY.insight,
            message: `${assignments} learning assignment${assignments === 1 ? "" : "s"} tracked — filter by status or mandatory.`,
          });
        }
        if (completion != null && Number(completion) < 70) {
          push(insights, {
            id: "learn-track-completion",
            priority: MASCOT_PRIORITY.task,
            tone: "warn",
            message: `Completion is ${Math.round(Number(completion))}% — nudge teams with open courses.`,
          });
        }
      }
    } catch {
      // keep base tip
    }
    push(insights, {
      id: "learn-track-followup",
      priority: MASCOT_PRIORITY.tip,
      message: "Filter mandatory or incomplete to find who needs a reminder.",
    });
    return insights;
  }

  if (tab === "certificates") {
    push(insights, {
      id: "learn-certs-what",
      priority: MASCOT_PRIORITY.task,
      message: tabHelp?.hint || "Verify or reject pending certificates here.",
    });
    try {
      if (accessToken) {
        const pendingCerts = await cached("learning-pending-certs", async () => {
          const data = await listPendingCertificates(accessToken);
          return data?.certificates || data?.items || data || [];
        }).catch(() => []);
        const pendingCount = Array.isArray(pendingCerts) ? pendingCerts.length : 0;
        if (pendingCount > 0) {
          push(insights, {
            id: "learn-certs-pending",
            priority: MASCOT_PRIORITY.pipeline,
            tone: "warn",
            message:
              pendingCount === 1
                ? "1 certificate is waiting for your review."
                : `${pendingCount} certificates are waiting for your review.`,
          });
        } else {
          push(insights, {
            id: "learn-certs-clear",
            priority: MASCOT_PRIORITY.insight,
            message: "No pending certificates right now — you're caught up.",
          });
        }
      }
    } catch {
      // keep base tip
    }
    push(insights, {
      id: "learn-certs-reject",
      priority: MASCOT_PRIORITY.tip,
      message: "If you reject, leave a clear reason so the employee knows what to fix.",
    });
    return insights;
  }

  if (tab === "analytics") {
    push(insights, {
      id: "learn-analytics-what",
      priority: MASCOT_PRIORITY.task,
      message: tabHelp?.hint || "Review completion by department and export when leadership asks.",
    });
    try {
      if (accessToken) {
        const analytics = await cached("learning-analytics", () => getLearningAnalytics(accessToken)).catch(() => null);
        const completion = analytics?.completion_rate ?? analytics?.mandatory_completion_rate;
        const assignments = analytics?.total_assignments ?? analytics?.assignments_count;
        if (completion != null) {
          push(insights, {
            id: "learn-analytics-rate",
            priority: MASCOT_PRIORITY.insight,
            message: `Org learning completion sits around ${Math.round(Number(completion))}%.`,
          });
        }
        if (assignments != null) {
          push(insights, {
            id: "learn-analytics-volume",
            priority: MASCOT_PRIORITY.tip,
            message: `${assignments} assignments in the dataset — filter by department for a closer look.`,
          });
        }
      }
    } catch {
      // keep base tip
    }
    return insights;
  }

  // Unknown tab — still stay local, never dump the whole module.
  if (tabHelp?.hint) {
    push(insights, {
      id: `learn-tab-${tab}`,
      priority: MASCOT_PRIORITY.task,
      message: tabHelp.hint,
    });
  }
  return insights;
}

async function talentPageInsights(accessToken, context) {
  const insights = [];
  const tab = context?.tab || context?.section || "metrics";
  const tabHelp = TALENT_TAB_HELP[tab];

  if (tab === "metrics") {
    push(insights, {
      id: "talent-metrics-what",
      priority: MASCOT_PRIORITY.task,
      message: tabHelp?.hint || "Review headcount and readiness signals here.",
    });
    try {
      if (accessToken) {
        const metrics = await cached("talent-metrics", () => getTalentMetrics(accessToken)).catch(() => null);
        const readyCount = metrics?.promotion_readiness_count ?? metrics?.promotion_ready_count;
        if (readyCount > 0) {
          push(insights, {
            id: "talent-promo",
            priority: MASCOT_PRIORITY.task,
            message: `${readyCount} people show promotion readiness — open a profile to act.`,
          });
        }
        const highPotential = metrics?.high_potential_employees?.length;
        if (highPotential) {
          push(insights, {
            id: "talent-hipo",
            priority: MASCOT_PRIORITY.insight,
            message: `${highPotential} high-potential employee${highPotential === 1 ? "" : "s"} flagged on this view.`,
          });
        }
        const gaps = metrics?.skill_gaps?.length ?? metrics?.top_gaps?.length ?? metrics?.skill_distribution?.length;
        if (gaps) {
          push(insights, {
            id: "talent-gaps",
            priority: MASCOT_PRIORITY.tip,
            message: "Skill gap signals are on this page — use them before hiring outside.",
          });
        }
      }
    } catch {
      // keep base tip
    }
    return insights;
  }

  if (tab === "search") {
    push(insights, {
      id: "talent-search-what",
      priority: MASCOT_PRIORITY.task,
      message: tabHelp?.hint || "Filter by skills, certs, and competency to find internal talent.",
    });
    push(insights, {
      id: "talent-search-filters",
      priority: MASCOT_PRIORITY.insight,
      message: "Combine department + skills (and optional semantic search) for sharper matches.",
    });
    push(insights, {
      id: "talent-search-act",
      priority: MASCOT_PRIORITY.tip,
      message: "Open a profile from results to assign learning or plan development.",
    });
    return insights;
  }

  if (tab === "opportunities") {
    push(insights, {
      id: "talent-opps-what",
      priority: MASCOT_PRIORITY.task,
      message: tabHelp?.hint || "Post internal roles/projects and review applicants here.",
    });
    try {
      if (accessToken) {
        const opps = await cached("talent-opps", () => browseOpportunities(accessToken)).catch(() => null);
        const list = opps?.opportunities || opps?.items || opps || [];
        const openCount = Array.isArray(list) ? list.filter((o) => o.status !== "closed").length : 0;
        if (openCount > 0) {
          push(insights, {
            id: "talent-open-opps",
            priority: MASCOT_PRIORITY.insight,
            message: `${openCount} open internal opportunit${openCount === 1 ? "y" : "ies"} — review applicants or close filled ones.`,
          });
        } else {
          push(insights, {
            id: "talent-post-opp",
            priority: MASCOT_PRIORITY.tip,
            message: "No open opportunities — post one with title, department, and required skills.",
          });
        }
      }
    } catch {
      // keep base tip
    }
    push(insights, {
      id: "talent-opps-guide",
      priority: MASCOT_PRIORITY.tip,
      message: "Filling the post form? Tap Guide me through it for field-by-field help.",
    });
    return insights;
  }

  if (tabHelp?.hint) {
    push(insights, {
      id: `talent-tab-${tab}`,
      priority: MASCOT_PRIORITY.task,
      message: tabHelp.hint,
    });
  }
  return insights;
}

function announcementsInsights() {
  return [
    {
      id: "ann-fill",
      priority: MASCOT_PRIORITY.task,
      message: "Write a clear title and body, pick audience (candidates / employees / both), then Publish.",
    },
    {
      id: "ann-target",
      priority: MASCOT_PRIORITY.insight,
      message: "For employees: optionally target departments, designations, or specific people.",
    },
    {
      id: "ann-email",
      priority: MASCOT_PRIORITY.tip,
      message: "Leave Send email checked when people should get it outside the app too.",
    },
  ];
}

function messagesInsights(context = {}) {
  const insights = [
    {
      id: "msg-inbox",
      priority: MASCOT_PRIORITY.task,
      message:
        "Open a thread on the left, then Reply — the employee gets an in-app notification and an email copy.",
    },
    {
      id: "msg-from-employee",
      priority: MASCOT_PRIORITY.tip,
      message:
        "From an employee profile, use Messages to open or start a conversation filtered to that person.",
    },
  ];
  if (context?.employee_id || context?.employeeId) {
    insights.unshift({
      id: "msg-filtered",
      priority: MASCOT_PRIORITY.insight,
      message: `Filtered to employee ${context.employee_id || context.employeeId} — reply here or send the first message if none exists yet.`,
    });
  }
  return insights;
}

function activityInsights(snapshot) {
  const insights = [];
  const latest = snapshot?.recentActivity?.[0];
  if (latest?.label || latest?.action) {
    const label = latest.label || latest.action?.replace(/_/g, " ");
    const who = latest.full_name || latest.email || "";
    push(insights, {
      id: "activity-latest",
      priority: MASCOT_PRIORITY.insight,
      message: who ? `Latest: ${who} — ${label}.` : `Latest activity: ${label}.`,
    });
  }
  push(insights, {
    id: "activity-use",
    priority: MASCOT_PRIORITY.tip,
    message: "Watch invitations, offers, activations, and profile events here — pause live if you need to read.",
  });
  return insights;
}

function profileInsights() {
  return [
    {
      id: "profile-fill",
      priority: MASCOT_PRIORITY.task,
      message: "Update your name, contact, designation, department, and office — email is fixed to your account.",
    },
    {
      id: "profile-photo",
      priority: MASCOT_PRIORITY.tip,
      message: "Add a profile photo so teammates recognize you in the product.",
    },
    {
      id: "profile-security",
      priority: MASCOT_PRIORITY.tip,
      message: "Change your password anytime from the Security section below — no verification code needed.",
    },
  ];
}

async function itHubInsights(accessToken) {
  const insights = [];
  if (!accessToken) {
    return [
      {
        id: "it-hub-basic",
        priority: MASCOT_PRIORITY.tip,
        message:
          "IT officers tracks who provisions new hires; Requests is for post-activation help (broken laptop, access, licenses).",
      },
    ];
  }

  const [overview, requestsData] = await Promise.all([
    cached("it-officers", () => getItOfficersOverview(accessToken).catch(() => null)),
    cached("it-requests", () => listItServiceRequests(accessToken).catch(() => null)),
  ]);

  const officers = overview?.officers || [];
  const requests = requestsData?.requests || [];
  const waitingHr = requests.filter((r) => r.status === "draft" || r.status === "reviewing");
  const withIt = requests.filter((r) => r.status === "sent");
  const awaitingEmployee = requests.filter((r) => r.status === "fulfilled");

  if (waitingHr.length) {
    insights.push({
      id: "it-send-drafts",
      priority: MASCOT_PRIORITY.task,
      message:
        waitingHr.length === 1
          ? `1 support request is waiting for HR — open Requests and Send to IT when ready.`
          : `${waitingHr.length} support requests need HR action — open Requests, pick one, and Send to IT.`,
    });
  }
  if (withIt.length) {
    insights.push({
      id: "it-with-it",
      priority: MASCOT_PRIORITY.insight,
      message:
        withIt.length === 1
          ? "1 ticket is with IT — they’ll mark it resolved from their email link."
          : `${withIt.length} tickets are with IT — they’ll mark each resolved from their email link.`,
    });
  }
  if (awaitingEmployee.length) {
    insights.push({
      id: "it-awaiting-emp",
      priority: MASCOT_PRIORITY.insight,
      message:
        awaitingEmployee.length === 1
          ? "1 ticket is awaiting the employee to confirm & close after IT resolved it."
          : `${awaitingEmployee.length} tickets await employee confirm & close after IT resolved them.`,
    });
  }
  if (officers.length) {
    insights.push({
      id: "it-officers",
      priority: MASCOT_PRIORITY.tip,
      message: `You have ${officers.length} IT officer${officers.length === 1 ? "" : "s"} on file — expand a row for provisioning people and their support tickets.`,
    });
  } else {
    insights.push({
      id: "it-no-officers",
      priority: MASCOT_PRIORITY.tip,
      message:
        "No IT officers yet — send a provisioning request or create a support ticket and they’ll appear here.",
    });
  }
  insights.push({
    id: "it-create",
    priority: MASCOT_PRIORITY.tip,
    message:
      "Need help for someone already employed? Tap Request IT help — or Manage kits for reusable asset setups.",
  });
  return insights;
}

function itKitsInsights() {
  return [
    {
      id: "it-kits-why",
      priority: MASCOT_PRIORITY.insight,
      message:
        "Kits are reusable asset + license packages. Suggest the matching kit when provisioning a standard role.",
    },
    {
      id: "it-kits-create",
      priority: MASCOT_PRIORITY.task,
      message:
        "Create a kit with a clear name, role tags, and the assets/licenses IT should assign every time.",
    },
    {
      id: "it-kits-back",
      priority: MASCOT_PRIORITY.tip,
      message: "When you’re done here, go back to IT & support to raise tickets or review officers.",
    },
  ];
}

function orgConfigInsights(context) {
  const insights = [];
  const section = context?.tab || context?.section || "overview";
  const sectionHelp = ORG_CONFIG_TAB_HELP[section];

  if (sectionHelp?.hint) {
    push(insights, {
      id: `orgcfg-section-${section}`,
      priority: MASCOT_PRIORITY.task,
      message: sectionHelp.hint,
    });
  }
  if (sectionHelp?.fields?.length) {
    push(insights, {
      id: `orgcfg-fields-${section}`,
      priority: MASCOT_PRIORITY.insight,
      message: `Fields on this section: ${listToSentence(sectionHelp.fields.map((f) => f.replace(/_/g, " ")))}. Focus one for a tip.`,
    });
  }
  if (section === "overview") {
    push(insights, {
      id: "orgcfg-start",
      priority: MASCOT_PRIORITY.tip,
      message: "Start fast: seed departments/roles from existing records, import an Excel template, or build the framework manually section by section.",
    });
    push(insights, {
      id: "orgcfg-effect",
      priority: MASCOT_PRIORITY.insight,
      message: "Changes here apply everywhere — invites, learning assignments, and talent filters all read from this framework.",
    });
  }
  if (section === "departments") {
    push(insights, {
      id: "orgcfg-dept-effect",
      priority: MASCOT_PRIORITY.tip,
      message: "Renaming a department updates it everywhere it's referenced across the platform.",
    });
  }
  if (section === "roles") {
    push(insights, {
      id: "orgcfg-role-effect",
      priority: MASCOT_PRIORITY.tip,
      message: "Fill Next Role on each role so promotion pipelines and career tracks know the target.",
    });
  }
  if (section === "promotion") {
    push(insights, {
      id: "orgcfg-promo-effect",
      priority: MASCOT_PRIORITY.tip,
      message: "Promotion rules feed Talent Intelligence readiness — the Ready / Almost / Behind buckets.",
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
          recent_names: firstNames(snapshot.pendingApprovals),
        };
        const result = await getRecruiterMascotBrief(payload, accessToken);
        if (result?.message) {
          return {
            id: "ai-brief",
            priority: MASCOT_PRIORITY.ai,
            message: String(result.message).slice(0, 160),
          };
        }
      } catch {
        // optional
      }
      return null;
    },
    AI_BRIEF_TTL_MS
  );
}

export async function buildRecruiterInsights(pathname, accessToken, rawContext = {}) {
  const page = recruiterPageKey(pathname);
  const context = scopedContext(rawContext, pathname);
  const snapshot = await loadRecruiterSnapshot(accessToken);
  const stats = pipelineStats(snapshot);
  const insights = [];
  const tabScoped =
    page === "learning" ||
    page === "talent" ||
    page === "employee_detail" ||
    page === "organization-config";

  // Tabbed pages already inject the right local tips — avoid duplicating context + module-wide noise.
  if (!tabScoped) {
    pushContextHints(insights, context);
  } else if (page === "employee_detail" && context?.employeeName) {
    push(insights, {
      id: "context-employee",
      priority: MASCOT_PRIORITY.tip,
      message: `You're viewing ${context.employeeName} — tips below are for this profile tab only.`,
    });
  }

  if (page === "overview") {
    insights.push(...overviewInsights(snapshot));
  } else if (page === "candidates") {
    insights.push(...candidatesInsights(snapshot));
  } else if (page === "candidate_detail") {
    insights.push(...candidateDetailInsights(snapshot, context));
  } else if (page === "invite") {
    insights.push(...inviteInsights(snapshot, context));
  } else if (page === "employees") {
    insights.push(...(await employeesInsights(accessToken, snapshot)));
  } else if (page === "employee_detail") {
    insights.push(...employeeDetailInsights(context));
  } else if (page === "learning") {
    insights.push(...(await learningPageInsights(accessToken, context)));
  } else if (page === "talent") {
    insights.push(...(await talentPageInsights(accessToken, context)));
  } else if (page === "announcements") {
    insights.push(...announcementsInsights());
  } else if (page === "messages") {
    insights.push(...messagesInsights(context));
  } else if (page === "activity") {
    insights.push(...activityInsights(snapshot));
  } else if (page === "profile") {
    insights.push(...profileInsights());
  } else if (page === "it") {
    insights.push(...(await itHubInsights(accessToken)));
  } else if (page === "it-kits") {
    insights.push(...itKitsInsights());
  } else if (page === "organization-config") {
    insights.push(...orgConfigInsights(context));
  }

  // Keep tips on this screen only — no AI brief (it invents off-page content).
  const summary = RECRUITER_PAGE_SUMMARIES[page];
  if (summary?.what) {
    push(insights, {
      id: `page-what-${page}`,
      priority: MASCOT_PRIORITY.tip,
      message: summary.what,
    });
  }
  if (summary?.why) {
    push(insights, {
      id: `page-why-${page}`,
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
    stats,
    snapshot,
    page,
  };
}

export function buildIdleInsights(insights) {
  return (insights || [])
    .filter((item) => item.priority >= MASCOT_PRIORITY.tip)
    .map((item) => item.message);
}

export { pipelineStats, loadRecruiterSnapshot };

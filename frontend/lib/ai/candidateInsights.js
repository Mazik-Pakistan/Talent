"use client";

import {
  getCandidateDashboard,
  getMyOffer,
  getProfileCompletion,
  getNotifications,
  listMyDocuments,
} from "@/services/authService";
import { getLearningDashboard } from "@/services/learningService";
import { CANDIDATE_MASCOT_PRIORITY } from "@/lib/ai/candidateContext";
import {
  buildDocumentStatusInsights,
  classifyDocuments,
  isProblemDocument,
} from "@/lib/ai/documentStatusInsights";
import { scopedContext } from "@/lib/ai/contextScope";
import { CANDIDATE_PAGE_SUMMARIES } from "@/lib/ai/candidateFieldHelp";

/**
 * Contextual guidance engine for the Candidate Assistant.
 * Rule-based insights only — no invented AI briefs on the tip carousel.
 */

const CACHE_TTL_MS = 45000;
const cache = new Map();

export const CANDIDATE_INSIGHTS_REFRESH_EVENT = "talent-candidate-data-changed";

async function cached(key, loader, ttl = CACHE_TTL_MS) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await loader();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function invalidateCandidateInsightCache() {
  cache.clear();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CANDIDATE_INSIGHTS_REFRESH_EVENT));
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
    priority: CANDIDATE_MASCOT_PRIORITY.tip,
    tone: "info",
    ...item,
  });
}

function sortByPriority(insights) {
  return [...insights].sort((a, b) => (a.priority || 99) - (b.priority || 99));
}

function candidatePageKey(pathname) {
  if (!pathname) return "unknown";
  if (pathname.includes("/onboarding")) {
    if (typeof window !== "undefined" && /(?:\?|&)edit=true\b/.test(window.location.search)) {
      return "profile";
    }
    return "onboarding";
  }
  if (pathname.includes("/documents")) return "documents";
  if (pathname.includes("/offer")) return "offer";
  if (pathname.includes("/learning")) return "learning";
  if (pathname.includes("/dashboard/candidate")) return "dashboard";
  if (pathname.includes("/profile")) return "profile";
  return "other";
}

async function loadCandidateSnapshot(accessToken) {
  if (!accessToken) return null;

  return cached("candidate-snapshot", async () => {
    const [dashboard, offerData, docsData, profileData, notifData, learningData] = await Promise.all([
      getCandidateDashboard(accessToken).catch(() => null),
      getMyOffer(accessToken).catch(() => null),
      listMyDocuments(accessToken).catch(() => null),
      getProfileCompletion(accessToken).catch(() => null),
      getNotifications(accessToken).catch(() => null),
      getLearningDashboard(accessToken).catch(() => null),
    ]);

    const profile = dashboard?.profile || profileData?.profile || {};
    const tasks = dashboard?.tasks || [];
    const offer = offerData?.offer || null;
    const docs = docsData?.documents || [];
    const notifs = notifData?.notifications || [];

    const classified = classifyDocuments(docs);
    const unverifiedDocs = docs.filter(
      (d) => isProblemDocument(d) || ["pending", "processing", "uploaded", "pending_verification"].includes(
        String(d.verification_status || d.status || "").toLowerCase()
      )
    );
    const missingResume = !profile.resume_url && !docs.some((d) => d.document_type?.includes("resume"));
    const missingSkills = !profile.skills || (Array.isArray(profile.skills) && profile.skills.length === 0);
    const missingEducation = !profile.education || (Array.isArray(profile.education) && profile.education.length === 0);
    const missingExperience = !profile.experience || (Array.isArray(profile.experience) && profile.experience.length === 0);

    const completionPct =
      profileData?.completion_percentage ?? dashboard?.progress?.percentage ?? null;
    const remainingTasks = tasks.filter((t) => !t.completed);

    return {
      profile,
      tasks,
      remainingTasks,
      onboardingRemaining: remainingTasks.length,
      offer,
      offerStatus: offer?.status || (dashboard?.has_signed_offer ? "accepted" : "none"),
      docs,
      docsClassified: classified,
      problemDocsCount: classified.problem.length,
      unverifiedDocsCount: unverifiedDocs.length,
      missingResume,
      missingSkills: missingSkills ? 1 : 0,
      missingEducation,
      missingExperience,
      completionPct,
      unreadNotifications: notifData?.unread_count || 0,
      assignedLearning: learningData?.enrolled_courses?.length || 0,
      recommendedLearning: Array.isArray(learningData?.recommended_courses)
        ? learningData.recommended_courses.length
        : 0,
      interviewScheduled: Boolean(dashboard?.upcoming_interview),
      interviewAt:
        dashboard?.upcoming_interview?.scheduled_at ||
        dashboard?.upcoming_interview?.date ||
        null,
    };
  });
}

function candidateStats(snapshot) {
  // No data yet → no fabricated numbers. Insight builders skip null values.
  if (!snapshot) {
    return {
      profileCompletionPct: null,
      missingResume: null,
      missingSkills: null,
      missingEducation: null,
      unverifiedDocuments: 0,
      problemDocuments: 0,
      interviewScheduled: false,
      interviewAt: null,
      offerStatus: null,
      onboardingProgress: null,
      onboardingRemaining: null,
      assignedLearning: 0,
      recommendedLearning: 0,
      unreadNotifications: 0,
    };
  }

  return {
    profileCompletionPct: snapshot.completionPct,
    missingResume: snapshot.missingResume,
    missingSkills: snapshot.missingSkills,
    missingEducation: snapshot.missingEducation,
    unverifiedDocuments: snapshot.unverifiedDocsCount,
    problemDocuments: snapshot.problemDocsCount || 0,
    interviewScheduled: snapshot.interviewScheduled,
    interviewAt: snapshot.interviewAt || null,
    offerStatus: snapshot.offerStatus,
    onboardingProgress: snapshot.completionPct,
    onboardingRemaining: snapshot.onboardingRemaining,
    assignedLearning: snapshot.assignedLearning,
    recommendedLearning: snapshot.recommendedLearning,
    unreadNotifications: snapshot.unreadNotifications,
  };
}

function profileCompletionInsight(stats) {
  if (stats.profileCompletionPct == null) return null;
  if (stats.profileCompletionPct >= 100) return null;
  return {
    id: "cand-profile-pct",
    priority: CANDIDATE_MASCOT_PRIORITY.workflow,
    message: `Your profile is ${stats.profileCompletionPct}% complete.`,
  };
}

function resumeInsight(stats) {
  if (stats.missingResume !== true) return null;
  return {
    id: "cand-missing-resume",
    priority: CANDIDATE_MASCOT_PRIORITY.task,
    tone: "warn",
    message: "You haven't uploaded your resume yet.",
  };
}

function offerInsight(stats) {
  if (stats.offerStatus === "sent" || stats.offerStatus === "pending") {
    return {
      id: "cand-offer-pending",
      priority: CANDIDATE_MASCOT_PRIORITY.workflow,
      message: "Your offer is waiting for acceptance.",
    };
  }
  if (stats.offerStatus === "accepted") {
    return {
      id: "cand-offer-accepted",
      priority: CANDIDATE_MASCOT_PRIORITY.insight,
      message: "Your offer letter has been signed & accepted.",
    };
  }
  return null;
}

/**
 * Concise, dashboard-safe document status (never the full "upload a clear copy"
 * instruction — that belongs only to the Documents page).
 */
function documentSummaryInsight(docs = []) {
  const { problem, pending, verified } = classifyDocuments(docs);
  if (problem.length) {
    return {
      id: "cand-docs-problem",
      priority: CANDIDATE_MASCOT_PRIORITY.task,
      tone: "warn",
      message: `${problem.length} document${problem.length > 1 ? "s" : ""} need attention — open Documents to fix.`,
      actions: [{ label: "Open documents", href: "/documents", primary: true }],
    };
  }
  if (pending.length) {
    return {
      id: "cand-docs-pending",
      priority: CANDIDATE_MASCOT_PRIORITY.insight,
      message: `${pending.length} document${pending.length > 1 ? "s" : ""} awaiting verification.`,
    };
  }
  if (verified.length) {
    return {
      id: "cand-docs-verified",
      priority: CANDIDATE_MASCOT_PRIORITY.insight,
      message: "Your documents have been verified.",
    };
  }
  return null;
}

function documentVerificationInsight(stats, docs = []) {
  const live = buildDocumentStatusInsights(docs, { audience: "self" });
  if (live.length) {
    return {
      ...live[0],
      priority:
        live[0].tone === "warn"
          ? CANDIDATE_MASCOT_PRIORITY.task
          : CANDIDATE_MASCOT_PRIORITY.insight,
    };
  }
  if (stats.problemDocuments > 0) {
    return {
      id: "cand-docs-problem",
      priority: CANDIDATE_MASCOT_PRIORITY.task,
      tone: "warn",
      message: `Check your screen — ${stats.problemDocuments} document${stats.problemDocuments > 1 ? "s" : ""} need attention (reupload or rejected).`,
    };
  }
  if (stats.unverifiedDocuments > 0) {
    return {
      id: "cand-docs-pending",
      priority: CANDIDATE_MASCOT_PRIORITY.task,
      message: `${stats.unverifiedDocuments} document${stats.unverifiedDocuments > 1 ? "s" : ""} pending verification.`,
    };
  }
  return {
    id: "cand-docs-verified",
    priority: CANDIDATE_MASCOT_PRIORITY.insight,
    message: "Your documents have been verified.",
  };
}

function onboardingStepInsight(stats) {
  if (stats.onboardingRemaining == null || !stats.onboardingRemaining) return null;
  return {
    id: "cand-onboarding-step",
    priority: CANDIDATE_MASCOT_PRIORITY.workflow,
    message:
      stats.onboardingRemaining === 1
        ? "Only one onboarding step remains."
        : `${stats.onboardingRemaining} onboarding steps remaining.`,
  };
}

function learningRecommendationInsight(stats) {
  if (!stats.recommendedLearning) return null;
  return {
    id: "cand-learning-rec",
    priority: CANDIDATE_MASCOT_PRIORITY.tip,
    message: `${stats.recommendedLearning} recommended course${stats.recommendedLearning === 1 ? "" : "s"} match your profile.`,
  };
}

function interviewInsight(stats) {
  if (!stats.interviewScheduled) return null;
  const when = stats.interviewAt ? new Date(stats.interviewAt) : null;
  const label =
    when && !Number.isNaN(when.getTime())
      ? when.toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : null;
  return {
    id: "cand-interview-scheduled",
    priority: CANDIDATE_MASCOT_PRIORITY.workflow,
    message: label ? `Interview scheduled for ${label}.` : "You have an interview scheduled.",
  };
}

function seedPageTips(page) {
  const summary = CANDIDATE_PAGE_SUMMARIES[page];
  if (!summary) return [];
  const tips = [];
  if (summary.what) {
    tips.push({
      id: `page-what-${page}`,
      priority: CANDIDATE_MASCOT_PRIORITY.tip,
      message: summary.what,
    });
  }
  if (summary.why) {
    tips.push({
      id: `page-why-${page}`,
      priority: CANDIDATE_MASCOT_PRIORITY.tip,
      message: summary.why,
    });
  }
  return tips;
}

function pageInsights(page, snapshot, context = {}) {
  const stats = candidateStats(snapshot);

  if (page === "dashboard") {
    const insights = [];
    [
      profileCompletionInsight,
      resumeInsight,
      offerInsight,
      onboardingStepInsight,
      interviewInsight,
    ].forEach((fn) => {
      const item = fn(stats);
      if (item) push(insights, item);
    });
    const docsItem = documentSummaryInsight(snapshot?.docs || []);
    if (docsItem) push(insights, docsItem);
    seedPageTips("dashboard").forEach((item) => push(insights, item));
    return insights;
  }

  if (page === "onboarding" || page === "profile") {
    const insights = [];
    const step = context?.step || context?.section;
    if (step === "personal") {
      push(insights, {
        id: "onboarding-personal",
        priority: CANDIDATE_MASCOT_PRIORITY.task,
        message: "Start with legal name, CNIC, contact, and address — recruiters verify these first.",
      });
      push(insights, {
        id: "onboarding-personal-id",
        priority: CANDIDATE_MASCOT_PRIORITY.tip,
        message: "Your name and CNIC must match your National ID document exactly.",
      });
    } else if (step === "education") {
      push(insights, {
        id: "onboarding-education",
        priority: CANDIDATE_MASCOT_PRIORITY.task,
        message: "Add at least one education entry with institution and degree.",
      });
      push(insights, {
        id: "onboarding-education-transcript",
        priority: CANDIDATE_MASCOT_PRIORITY.tip,
        message: "Upload a clear transcript or certificate if you have it — it speeds up verification.",
      });
      push(insights, {
        id: "onboarding-education-fields",
        priority: CANDIDATE_MASCOT_PRIORITY.tip,
        message: "Institute, degree, field of study, and year are the details recruiters check first.",
      });
    } else if (step === "skills") {
      push(insights, {
        id: "onboarding-skills",
        priority: CANDIDATE_MASCOT_PRIORITY.task,
        message: "List skills recruiters search for — React, SQL, Python, etc.",
      });
      push(insights, {
        id: "onboarding-skills-roles",
        priority: CANDIDATE_MASCOT_PRIORITY.tip,
        message: "Add a recent job title and company if you have work experience.",
      });
    } else if (step === "submit") {
      push(insights, {
        id: "onboarding-submit",
        priority: CANDIDATE_MASCOT_PRIORITY.task,
        message: "Review each section once, then submit your onboarding record.",
      });
    } else {
      if (stats.missingSkills) {
        push(insights, {
          id: "onboarding-skills",
          priority: CANDIDATE_MASCOT_PRIORITY.task,
          message: "Add key skills to boost your profile strength.",
        });
      }
      if (stats.missingEducation) {
        push(insights, {
          id: "onboarding-education",
          priority: CANDIDATE_MASCOT_PRIORITY.task,
          message: "Include education history for verification.",
        });
      }
      if (stats.onboardingRemaining > 0) {
        push(insights, {
          id: "onboarding-remaining",
          priority: CANDIDATE_MASCOT_PRIORITY.workflow,
          message:
            stats.onboardingRemaining === 1
              ? "Only one onboarding step remains."
              : `${stats.onboardingRemaining} steps left to complete onboarding.`,
        });
      }
    }
    push(insights, {
      id: "onboarding-guide",
      priority: CANDIDATE_MASCOT_PRIORITY.tip,
      message: "Need help filling fields? Tap Guide me through it.",
    });
    seedPageTips(page).forEach((item) => push(insights, item));
    return insights;
  }

  if (page === "documents") {
    const insights = [];
    const docs = context?.documents?.length ? context.documents : snapshot?.docs || [];
    const live = buildDocumentStatusInsights(docs, { audience: "self" });
    live.forEach((item) =>
      push(insights, {
        ...item,
        priority:
          item.tone === "warn"
            ? CANDIDATE_MASCOT_PRIORITY.task
            : CANDIDATE_MASCOT_PRIORITY.tip,
      })
    );
    if (!live.length) {
      const docInsight = documentVerificationInsight(stats, docs);
      if (docInsight) push(insights, docInsight);
    }
    seedPageTips("documents").forEach((item) => push(insights, item));
    return insights;
  }

  if (page === "offer") {
    const insights = [];
    const offerItem = offerInsight(stats);
    if (offerItem) push(insights, offerItem);
    push(insights, {
      id: "offer-review-hint",
      priority: CANDIDATE_MASCOT_PRIORITY.tip,
      message: "Review compensation, benefits, and start date before signing.",
    });
    push(insights, {
      id: "offer-guide",
      priority: CANDIDATE_MASCOT_PRIORITY.tip,
      message: "I can highlight the agree + signature fields — you confirm the final sign.",
    });
    seedPageTips("offer").forEach((item) => push(insights, item));
    return insights;
  }

  if (page === "learning") {
    const insights = [];
    if (stats.assignedLearning > 0) {
      push(insights, {
        id: "learning-assigned-count",
        priority: CANDIDATE_MASCOT_PRIORITY.workflow,
        message: `You have ${stats.assignedLearning} active learning module${stats.assignedLearning > 1 ? "s" : ""}.`,
      });
    }
    const rec = learningRecommendationInsight(stats);
    if (rec) push(insights, rec);
    if (!insights.length) {
      push(insights, {
        id: "learning-empty",
        priority: CANDIDATE_MASCOT_PRIORITY.tip,
        message: "Learning tips appear here when courses are assigned to you.",
      });
    }
    return insights;
  }

  return seedPageTips(page);
}

export async function buildCandidateInsights(pathname, accessToken, rawContext = {}) {
  const page = candidatePageKey(pathname);
  const context = scopedContext(rawContext, pathname);
  const snapshot = await loadCandidateSnapshot(accessToken);
  const stats = candidateStats(snapshot);
  const insights = [];

  // Live page tips only — no AI brief (it invents off-page content like courses).
  insights.push(...pageInsights(page, snapshot, context));

  if (context?.hint && page !== "documents") {
    push(insights, {
      id: "context-hint",
      priority: CANDIDATE_MASCOT_PRIORITY.task,
      message: context.hint,
    });
  }

  if (!insights.length) {
    push(insights, {
      id: "cand-fallback",
      priority: CANDIDATE_MASCOT_PRIORITY.tip,
      message: "You’re on this page — focus a field for help, or use the left menu to continue.",
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
    .filter((item) => item.priority >= CANDIDATE_MASCOT_PRIORITY.tip)
    .map((item) => item.message);
}

export { candidateStats, loadCandidateSnapshot };

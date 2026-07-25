"use client";

import {
  getCandidateDashboard,
  getMyOffer,
  getProfileCompletion,
  getNotifications,
  listMyDocuments,
  getRecruiterMascotBrief,
} from "@/services/authService";
import { getLearningDashboard } from "@/services/learningService";
import { CANDIDATE_MASCOT_PRIORITY } from "@/lib/ai/candidateContext";

/**
 * Contextual guidance engine for the Candidate Assistant.
 *
 * Rule-based insights use cached candidate APIs. OpenRouter AI is invoked only
 * for high-value workflow reasoning briefs via the shared backend service.
 */

const CACHE_TTL_MS = 45000;
const AI_BRIEF_TTL_MS = 300000;
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
  if (insights.some((existing) => existing.id === item.id)) return;
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
  if (pathname.includes("/dashboard/candidate")) return "dashboard";
  if (pathname.includes("/onboarding")) return "onboarding";
  if (pathname.includes("/documents")) return "documents";
  if (pathname.includes("/offer")) return "offer";
  if (pathname.includes("/learning")) return "learning";
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

    const unverifiedDocs = docs.filter((d) => d.status === "pending" || d.status === "rejected");
    const missingResume = !profile.resume_url && !docs.some((d) => d.document_type?.includes("resume"));
    const missingSkills = !profile.skills || (Array.isArray(profile.skills) && profile.skills.length === 0);
    const missingEducation = !profile.education || (Array.isArray(profile.education) && profile.education.length === 0);
    const missingExperience = !profile.experience || (Array.isArray(profile.experience) && profile.experience.length === 0);

    const completionPct = profileData?.completion_percentage ?? dashboard?.progress?.percentage ?? 82;
    const remainingTasks = tasks.filter((t) => !t.completed);

    return {
      profile,
      tasks,
      remainingTasks,
      onboardingRemaining: remainingTasks.length,
      offer,
      offerStatus: offer?.status || (dashboard?.has_signed_offer ? "accepted" : "none"),
      docs,
      unverifiedDocsCount: unverifiedDocs.length,
      missingResume,
      missingSkills: missingSkills ? 1 : 0,
      missingEducation,
      missingExperience,
      completionPct,
      unreadNotifications: notifData?.unread_count || 0,
      assignedLearning: learningData?.enrolled_courses?.length || 0,
      recommendedLearning: learningData?.recommended_courses?.length || 2,
      interviewScheduled: Boolean(dashboard?.upcoming_interview),
    };
  });
}

function candidateStats(snapshot) {
  if (!snapshot) {
    return {
      profileCompletionPct: 82,
      missingResume: true,
      missingSkills: 1,
      missingEducation: true,
      unverifiedDocuments: 0,
      assessmentStatus: "none",
      interviewScheduled: false,
      offerStatus: "none",
      onboardingProgress: 80,
      onboardingRemaining: 1,
      assignedLearning: 0,
      recommendedLearning: 2,
      unreadNotifications: 0,
    };
  }

  return {
    profileCompletionPct: snapshot.completionPct,
    missingResume: snapshot.missingResume,
    missingSkills: snapshot.missingSkills,
    missingEducation: snapshot.missingEducation,
    unverifiedDocuments: snapshot.unverifiedDocsCount,
    assessmentStatus: "none",
    interviewScheduled: snapshot.interviewScheduled,
    offerStatus: snapshot.offerStatus,
    onboardingProgress: snapshot.completionPct,
    onboardingRemaining: snapshot.onboardingRemaining,
    assignedLearning: snapshot.assignedLearning,
    recommendedLearning: snapshot.recommendedLearning,
    unreadNotifications: snapshot.unreadNotifications,
  };
}

function profileCompletionInsight(stats) {
  if (stats.profileCompletionPct >= 100) return null;
  return {
    id: "cand-profile-pct",
    priority: CANDIDATE_MASCOT_PRIORITY.workflow,
    message: `Your profile is ${stats.profileCompletionPct}% complete.`,
  };
}

function resumeInsight(stats) {
  if (!stats.missingResume) return null;
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

function documentVerificationInsight(stats) {
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
  if (!stats.onboardingRemaining) return null;
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
    message: `${stats.recommendedLearning} recommended courses match your profile.`,
  };
}

function interviewInsight(stats) {
  if (!stats.interviewScheduled) return null;
  return {
    id: "cand-interview-scheduled",
    priority: CANDIDATE_MASCOT_PRIORITY.workflow,
    message: "Interview scheduled for tomorrow.",
  };
}

function pageInsights(page, snapshot) {
  const stats = candidateStats(snapshot);

  if (page === "dashboard") {
    const insights = [];
    [
      profileCompletionInsight,
      resumeInsight,
      offerInsight,
      onboardingStepInsight,
      documentVerificationInsight,
      interviewInsight,
      learningRecommendationInsight,
    ].forEach((fn) => {
      const item = fn(stats);
      if (item) push(insights, item);
    });
    return insights;
  }

  if (page === "onboarding" || page === "profile") {
    const insights = [];
    if (stats.missingResume) {
      push(insights, {
        id: "onboarding-resume",
        priority: CANDIDATE_MASCOT_PRIORITY.task,
        message: "You haven't uploaded your resume yet.",
      });
    }
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
    return insights;
  }

  if (page === "documents") {
    const insights = [];
    const docInsight = documentVerificationInsight(stats);
    if (docInsight) push(insights, docInsight);
    push(insights, {
      id: "documents-hint",
      priority: CANDIDATE_MASCOT_PRIORITY.tip,
      message: "Ensure uploaded document copies are clear and legible.",
    });
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
    return insights;
  }

  return [];
}

async function maybeAiBrief(accessToken, page, snapshot, firstName) {
  if (!accessToken || page !== "dashboard") return null;
  const stats = candidateStats(snapshot);
  const cacheKey = `cand-ai-brief:${page}:${stats.profileCompletionPct}:${stats.offerStatus}:${stats.onboardingRemaining}`;

  return cached(
    cacheKey,
    async () => {
      try {
        const payload = {
          page,
          first_name: firstName || null,
          role: "candidate",
          profile_completion: `${stats.profileCompletionPct}%`,
          missing_resume: stats.missingResume,
          unverified_docs: stats.unverifiedDocuments,
          offer_status: stats.offerStatus,
          onboarding_remaining: stats.onboardingRemaining,
        };
        const result = await getRecruiterMascotBrief(payload, accessToken);
        if (result?.message) {
          return {
            id: "cand-ai-brief",
            priority: CANDIDATE_MASCOT_PRIORITY.ai,
            message: String(result.message).slice(0, 140),
          };
        }
      } catch {
        // Fallback to rule-based candidate insights
      }
      return null;
    },
    AI_BRIEF_TTL_MS
  );
}

export async function buildCandidateInsights(pathname, accessToken, context = {}) {
  const page = candidatePageKey(pathname);
  const snapshot = await loadCandidateSnapshot(accessToken);
  const stats = candidateStats(snapshot);
  const insights = [];

  if (context?.hint) {
    push(insights, {
      id: "context-hint",
      priority: CANDIDATE_MASCOT_PRIORITY.task,
      message: context.hint,
    });
  }

  insights.push(...pageInsights(page, snapshot));

  const aiBrief = await maybeAiBrief(accessToken, page, snapshot, context?.firstName);
  if (aiBrief) push(insights, aiBrief);

  if (!insights.length) {
    push(insights, {
      id: "cand-fallback",
      priority: CANDIDATE_MASCOT_PRIORITY.tip,
      message: "Need help with your candidate profile or documents? Click me to chat!",
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

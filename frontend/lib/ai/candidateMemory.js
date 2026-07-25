"use client";

import { readMascotMemory, writeMascotMemory } from "@/lib/ai/candidateContext";

/**
 * Candidate workflow snapshot + conversation continuity engine.
 * Remembers candidate journey milestones across page transitions.
 */

export function snapshotFromCandidateStats(stats = {}) {
  return {
    profileCompletionPct: Number(stats.profileCompletionPct) || 0,
    missingResume: Boolean(stats.missingResume),
    missingSkills: Number(stats.missingSkills) || 0,
    missingEducation: Boolean(stats.missingEducation),
    unverifiedDocuments: Number(stats.unverifiedDocuments) || 0,
    assessmentStatus: stats.assessmentStatus || "none",
    interviewScheduled: Boolean(stats.interviewScheduled),
    offerStatus: stats.offerStatus || "none",
    onboardingProgress: Number(stats.onboardingProgress) || 0,
    onboardingRemaining: Number(stats.onboardingRemaining) || 0,
    assignedLearning: Number(stats.assignedLearning) || 0,
    recommendedLearning: Number(stats.recommendedLearning) || 0,
    unreadNotifications: Number(stats.unreadNotifications) || 0,
  };
}

export function updateCandidateMemory(stats) {
  const next = snapshotFromCandidateStats(stats);
  const prev = readMascotMemory()?.candidate || null;
  writeMascotMemory({ candidate: next, candidatePrev: prev });
  return { prev, next };
}

export function buildContinuityMessage(prev, next, firstName = "") {
  if (!prev || !next) return null;
  const name = firstName ? `, ${firstName}` : "";

  if (prev.profileCompletionPct < next.profileCompletionPct) {
    return `Your profile is now ${next.profileCompletionPct}% complete. Great progress${name}!`;
  }

  if (prev.unverifiedDocuments > 0 && next.unverifiedDocuments === 0) {
    return "Your documents have been verified!";
  }

  if (prev.offerStatus !== "accepted" && next.offerStatus === "accepted") {
    return `Congratulations${name}! Offer accepted — welcome to the team!`;
  }

  if (prev.onboardingRemaining > next.onboardingRemaining && next.onboardingRemaining > 0) {
    return next.onboardingRemaining === 1
      ? "Only one onboarding step remains."
      : `${next.onboardingRemaining} onboarding steps remaining.`;
  }

  if (prev.onboardingRemaining > 0 && next.onboardingRemaining === 0) {
    return "All onboarding steps completed!";
  }

  if (!prev.interviewScheduled && next.interviewScheduled) {
    return "Interview scheduled for tomorrow.";
  }

  if (prev.missingResume && !next.missingResume) {
    return "Resume uploaded successfully!";
  }

  if (prev.assignedLearning < next.assignedLearning) {
    const diff = next.assignedLearning - prev.assignedLearning;
    return `${diff} new learning module${diff > 1 ? "s" : ""} assigned to your profile.`;
  }

  return null;
}

export function welcomeMessage(firstName, stats) {
  const name = firstName ? `, ${firstName}` : "";
  const pct = stats?.profileCompletionPct ?? 0;
  const offerStatus = stats?.offerStatus;
  const missingResume = stats?.missingResume;
  const remainingSteps = stats?.onboardingRemaining ?? 0;

  if (offerStatus === "sent" || offerStatus === "pending") {
    return `Welcome back${name}. Your offer is waiting for acceptance.`;
  }

  if (remainingSteps === 1) {
    return `Welcome back${name}. Only one onboarding step remains.`;
  }

  if (missingResume) {
    return `Welcome back${name}. You haven't uploaded your resume yet.`;
  }

  if (pct > 0 && pct < 100) {
    return `Welcome back${name}. Your profile is ${pct}% complete.`;
  }

  return `Welcome back${name}. I'm here to guide your candidate journey.`;
}

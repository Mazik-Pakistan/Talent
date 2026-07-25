"use client";

import { readMascotMemory, writeMascotMemory } from "@/lib/ai/recruiterContext";

/**
 * Pipeline snapshot + conversation continuity for the Recruiter Mascot.
 * Keeps short evolving messages instead of restarting on every navigation.
 */

export function snapshotFromStats(stats = {}) {
  return {
    pendingApprovals: Number(stats.pendingApprovals) || 0,
    readyCandidates: Number(stats.readyCandidates) || 0,
    pendingOffers: Number(stats.pendingOffers) || 0,
    onboardingInProgress: Number(stats.onboardingInProgress) || 0,
    activeEmployees: Number(stats.activeEmployees) || 0,
    pendingOnboarding: Number(stats.pendingOnboarding) || 0,
    unreadNotifications: Number(stats.unreadNotifications) || 0,
  };
}

export function updatePipelineMemory(stats) {
  const next = snapshotFromStats(stats);
  const prev = readMascotMemory()?.pipeline || null;
  writeMascotMemory({ pipeline: next, pipelinePrev: prev });
  return { prev, next };
}

export function buildContinuityMessage(prev, next, firstName = "") {
  if (!prev || !next) return null;

  if (prev.pendingApprovals > next.pendingApprovals) {
    const cleared = prev.pendingApprovals - next.pendingApprovals;
    const remaining = next.pendingApprovals;
    if (remaining === 0) {
      return cleared === 1 ? "Approval completed. You're all caught up." : "All approvals cleared. Nice work today.";
    }
    if (cleared === 1 && remaining === 1) return "Great. Only one approval remains.";
    if (cleared === 1) return `Great. Only ${remaining} remain.`;
    return `${cleared} approvals done — ${remaining} left.`;
  }

  if (prev.readyCandidates < next.readyCandidates) {
    const added = next.readyCandidates - prev.readyCandidates;
    if (added === 1) return "A signed offer is ready for activation.";
    return `${added} candidates are ready to activate.`;
  }

  if (prev.readyCandidates > next.readyCandidates && next.readyCandidates >= 0) {
    return "Candidate activated. Recruitment pipeline updated.";
  }

  if (prev.pendingOffers > next.pendingOffers) {
    return next.pendingOffers === 0 ? "Offer queue cleared." : "Offer step completed.";
  }

  if (prev.onboardingInProgress < next.onboardingInProgress) {
    return "A new candidate started onboarding.";
  }

  if (
    prev.pendingApprovals === 0 &&
    next.pendingApprovals > 0 &&
    next.pendingApprovals !== prev.pendingApprovals
  ) {
    const n = next.pendingApprovals;
    return n === 1
      ? "New onboarding submission needs your review."
      : `You have ${n} pending approvals.`;
  }

  if (prev.activeEmployees < next.activeEmployees) {
    return firstName
      ? `Excellent progress today, ${firstName}.`
      : "Excellent progress today.";
  }

  return null;
}

export function welcomeMessage(firstName, stats) {
  const name = firstName ? `, ${firstName}` : "";
  const pending = stats?.pendingApprovals || 0;
  if (pending > 0) {
    return `Welcome back${name}. ${pending} approval${pending > 1 ? "s" : ""} need attention.`;
  }
  const ready = stats?.readyCandidates || 0;
  if (ready > 0) {
    return `Welcome back${name}. ${ready} candidate${ready > 1 ? "s are" : " is"} ready to activate.`;
  }
  return `Welcome back${name}.`;
}

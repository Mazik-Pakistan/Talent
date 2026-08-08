"use client";

import CandidateDashboard from "@/components/dashboard/CandidateDashboard";
import RecruiterDashboard from "@/components/dashboard/RecruiterDashboard";

export function DashboardModule({ user, onLogout, data = {} }) {
  if (!user) return null;

  if (user.role === "candidate" || user.role === "employee") {
    return <CandidateDashboard user={user} onLogout={onLogout} data={data.candidate || {}} />;
  }

  return <RecruiterDashboard user={user} onLogout={onLogout} data={data.recruiter || {}} />;
}

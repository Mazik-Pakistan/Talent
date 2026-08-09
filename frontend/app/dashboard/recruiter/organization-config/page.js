"use client";

import ProtectedRecruiterRoute from "@/components/ProtectedRecruiterRoute";
import RecruiterShell from "@/components/recruiter/RecruiterShell";
import OrgFrameworkTab from "../learning/OrgFrameworkTab";

export default function OrganizationConfigPage() {
  return (
    <ProtectedRecruiterRoute requiredCapability="org_config">
      <RecruiterShell
        activeKey="organization-config"
        capability="org_config"
        title="Organization Setup"
        subtitle="Departments, role ladders, learning roadmaps, and promotion readiness rules"
      >
        <OrgFrameworkTab />
      </RecruiterShell>
    </ProtectedRecruiterRoute>
  );
}

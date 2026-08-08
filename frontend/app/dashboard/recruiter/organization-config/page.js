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
        subtitle="Departments, roles, skills, roadmaps, promotion rules, and career tracks"
      >
        <OrgFrameworkTab />
      </RecruiterShell>
    </ProtectedRecruiterRoute>
  );
}

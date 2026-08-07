"use client";

import { useEffect } from "react";
import ProtectedRecruiterRoute from "@/components/ProtectedRecruiterRoute";
import RecruiterShell from "@/components/recruiter/RecruiterShell";
import OrgFrameworkTab from "../learning/OrgFrameworkTab";
import { publishRecruiterContext, clearRecruiterContext } from "@/lib/ai/recruiterContext";

export default function OrganizationConfigPage() {
  useEffect(() => {
    publishRecruiterContext({
      tab: "organization-config",
      section: "organization-framework",
      hint: "Configure organization structure and hierarchy",
      fields: [],
    });
    return () => clearRecruiterContext();
  }, []);

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

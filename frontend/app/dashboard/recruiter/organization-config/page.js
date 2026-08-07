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
    <ProtectedRecruiterRoute requiredCapability="learning">
      <RecruiterShell
        activeKey="organization-config"
        capability="learning"
        title="Organization Configuration"
        subtitle="Configure organization structure, departments, and hierarchy"
      >
        <OrgFrameworkTab />
      </RecruiterShell>
    </ProtectedRecruiterRoute>
  );
}

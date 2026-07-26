"use client";

import { useEffect, useState } from "react";

import AgentChatCore, { readAuth } from "@/components/ai/AgentChatCore";
import EmployeeShell from "@/components/employee/EmployeeShell";

export default function EmployeeAIAssistantPage() {
  const [auth, setAuth] = useState(null);
  useEffect(() => setAuth(readAuth()), []);

  return (
    <EmployeeShell
      activeKey="ai-assistant"
      title="Your workday assistant"
      subtitle="Chat here for multi-step help. On other employee pages, the Copilot mascot guides you field-by-field — it never runs workflows for you."
      permissions={["onboarding.self", "profile.view"]}
    >
      <AgentChatCore variant="canvas" auth={auth} />
    </EmployeeShell>
  );
}
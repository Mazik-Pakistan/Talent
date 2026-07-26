"use client";

import { useEffect, useState } from "react";

import AgentChatCore, { readAuth } from "@/components/ai/AgentChatCore";
import AssistantPageShell from "@/components/ai/AssistantPageShell";

export default function EmployeeAIAssistantPage() {
  const [auth, setAuth] = useState(null);
  useEffect(() => setAuth(readAuth()), []);

  return (
    <AssistantPageShell
      eyebrow="Automation workspace"
      title="Your workday assistant"
      description="Chat here for multi-step help. On other employee pages, the Copilot mascot guides you field-by-field — it never runs workflows for you."
      highlights={["HR help", "Onboarding support", "Fast answers"]}
    >
      <AgentChatCore variant="canvas" auth={auth} />
    </AssistantPageShell>
  );
}

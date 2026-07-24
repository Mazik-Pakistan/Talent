"use client";

import { useEffect, useState } from "react";

import AgentChatCore, { readAuth } from "@/components/ai/AgentChatCore";
import AssistantPageShell from "@/components/ai/AssistantPageShell";

export default function EmployeeAIAssistantPage() {
  const [auth, setAuth] = useState(null);
  useEffect(() => setAuth(readAuth()), []);

  return (
    <AssistantPageShell
      eyebrow="Employee workspace"
      title="Your workday assistant"
      description="Ask for help with employee tasks, onboarding follow-ups, profile completion, and document questions in one polished workspace."
      highlights={["HR help", "Onboarding support", "Fast answers"]}
    >
      <AgentChatCore variant="canvas" auth={auth} />
    </AssistantPageShell>
  );
}

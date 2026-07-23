"use client";

import AgentChatWidget from "@/components/ai/Agentchatwidget";
import AssistantPageShell from "@/components/ai/AssistantPageShell";

export default function EmployeeAIAssistantPage() {
  return (
    <AssistantPageShell
      eyebrow="Employee workspace"
      title="Your workday assistant"
      description="Ask for help with employee tasks, onboarding follow-ups, profile completion, and document questions in one polished workspace."
      highlights={["HR help", "Onboarding support", "Fast answers"]}
    >
      <AgentChatWidget />
    </AssistantPageShell>
  );
}
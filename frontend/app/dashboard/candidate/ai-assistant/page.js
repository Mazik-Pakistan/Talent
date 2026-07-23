"use client";

import AgentChatWidget from "@/components/ai/Agentchatwidget";
import AssistantPageShell from "@/components/ai/AssistantPageShell";

export default function CandidateAIAssistantPage() {
  return (
    <AssistantPageShell
      eyebrow="Candidate workspace"
      title="Your onboarding copilot"
      description="Keep your onboarding moving with one place to ask questions, upload documents, and get help with next steps."
      highlights={["Document guidance", "Profile readiness", "Next-step suggestions"]}
    >
      <AgentChatWidget />
    </AssistantPageShell>
  );
}
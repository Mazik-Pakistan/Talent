"use client";

import AgentChatWidget from "@/components/ai/Agentchatwidget";
import AssistantPageShell from "@/components/ai/AssistantPageShell";

export default function RecruiterAIAssistantPage() {
  return (
    <AssistantPageShell
      eyebrow="Recruiter workspace"
      title="Your hiring copilot"
      description="Run hiring workflows, review candidates, and ask for support without leaving your recruiting dashboard."
      highlights={["Invite candidates", "Offer workflows", "Pipeline support"]}
    >
      <AgentChatWidget />
    </AssistantPageShell>
  );
}
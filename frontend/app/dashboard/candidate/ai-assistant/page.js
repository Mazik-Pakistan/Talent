"use client";

import AgentChatWidget from "@/components/ai/Agentchatwidget";

export default function CandidateAIAssistantPage() {
  return (
    <div style={{ padding: "24px" }}>
      <h1>Onboarding Assistant</h1>
      <p>Complete your onboarding and ask questions anytime.</p>

      <AgentChatWidget />
    </div>
  );
}
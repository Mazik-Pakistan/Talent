"use client";

import AgentChatWidget from "@/components/ai/Agentchatwidget";
import AssistantPageShell from "@/components/ai/AssistantPageShell";
import RecruiterShell from "@/components/recruiter/RecruiterShell";

export default function RecruiterAIAssistantPage() {
  return (
    <RecruiterShell
      activeKey="assistant"
      title="AI Assistant"
      subtitle="Your hiring copilot — invite, review, offer, onboard, and notify candidates and employees in one place."
    >
      <AssistantPageShell
        eyebrow="Recruiter workspace"
        title="Your hiring copilot"
        description="Ask in plain language — for one candidate/employee or many at once. Same Hiring Agent as the floating chat."
        highlights={[
          "Candidates & employees",
          "One person or bulk",
          "Email & notifications",
          "Ask anything recruiting",
        ]}
      >
        <AgentChatWidget variant="page" />
      </AssistantPageShell>
    </RecruiterShell>
  );
}

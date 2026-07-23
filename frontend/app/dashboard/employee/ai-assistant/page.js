"use client";

import AgentChatWidget from "@/components/ai/Agentchatwidget";

export default function EmployeeAIAssistantPage() {
  return (
    <div style={{ padding: "24px" }}>
      <h1>Employee AI Assistant</h1>
      <p>Get help with HR tasks, documents, and onboarding.</p>

      <AgentChatWidget />
    </div>
  );
}
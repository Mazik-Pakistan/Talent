"use client";

import { useRef } from "react";

import AgentChatWidget from "@/components/ai/Agentchatwidget";
import AssistantPageShell from "@/components/ai/AssistantPageShell";
import RecruiterShell from "@/components/recruiter/RecruiterShell";

const QUICK_ACTIONS = [
  {
    label: "Show hiring pipeline",
    prompt: "Show my hiring pipeline — new signups, pending offer review, and ready to activate.",
  },
  {
    label: "Invite in bulk",
    prompt:
      "I want to invite candidates in bulk. Tell me the required spreadsheet columns (same as Create invitation), then I'll upload the file.",
  },
  {
    label: "Remind incomplete profiles",
    prompt: "Remind all employees who still have an incomplete post-hire Complete Profile.",
  },
  {
    label: "Ready to activate",
    prompt: "Show candidates with signed offers who are ready to activate.",
  },
];

export default function RecruiterAIAssistantPage() {
  const agentRef = useRef(null);

  function handleQuickAction(prompt) {
    agentRef.current?.sendPrompt?.(prompt);
  }

  return (
    <RecruiterShell
      activeKey="assistant"
      title="AI Assistant"
      subtitle="Ask in plain language — invite, review, offer, onboard, and notify, for one person or many."
    >
      <AssistantPageShell
        eyebrow="Quick actions"
        title="Hiring Agent"
        description="Click an action below or type in the chat. Same agent as the floating assistant — for one candidate/employee or bulk."
        highlights={QUICK_ACTIONS}
        onHighlightClick={handleQuickAction}
      >
        <AgentChatWidget ref={agentRef} variant="page" />
      </AssistantPageShell>
    </RecruiterShell>
  );
}

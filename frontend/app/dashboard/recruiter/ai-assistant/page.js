"use client";

import { useEffect, useRef, useState } from "react";

import AgentChatCore, { readAuth } from "@/components/ai/AgentChatCore";
import AssistantPageShell from "@/components/ai/AssistantPageShell";
import RecruiterShell from "@/components/recruiter/RecruiterShell";
import ProtectedRecruiterRoute from "@/components/ProtectedRecruiterRoute";

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
  {
    label: "Send IT provisioning",
    prompt: "Send IT provisioning to the IT manager for the candidates with signed offers who are ready — send ONE batch roster email listing them all (company email and assets setup).",
  },
  {
    label: "Follow up with IT",
    prompt: "Remind IT about pending provisioning requests that are still awaiting submission.",
  },
];

export default function RecruiterAIAssistantPage() {
  return (
    <ProtectedRecruiterRoute requiredCapability="recruitment">
      <RecruiterAIAssistantPageContent />
    </ProtectedRecruiterRoute>
  );
}

function RecruiterAIAssistantPageContent() {
  const agentRef = useRef(null);
  const [auth, setAuth] = useState(null);

  useEffect(() => setAuth(readAuth()), []);

  function handleQuickAction(prompt) {
    agentRef.current?.sendPrompt?.(prompt);
  }

  return (
    <RecruiterShell
      activeKey="assistant"
      capability="assistant"
      title="AI Assistant"
      subtitle="Hiring Agent · bulk invite, approvals, reminders, Day-1"
    >
      <AssistantPageShell
        eyebrow="Automation workspace"
        title="Hiring Agent"
        description="This is the only place the agent runs workflows for you. Upload Excel for bulk invites, approve offers, verify docs, assign assets — one person or many. Page tips stay with the floating mascot elsewhere."
        highlights={QUICK_ACTIONS}
        onHighlightClick={handleQuickAction}
      >
        <AgentChatCore ref={agentRef} variant="canvas" auth={auth} />
      </AssistantPageShell>
    </RecruiterShell>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

import AgentChatCore, { readAuth } from "@/components/ai/AgentChatCore";
import AssistantPageShell from "@/components/ai/AssistantPageShell";
import CandidateShell from "@/components/candidate/CandidateShell";

const QUICK_ACTIONS = [
  {
    label: "Complete onboarding",
    prompt: "Complete my onboarding",
  },
  {
    label: "What to upload?",
    prompt: "What do I still need to upload?",
  },
  {
    label: "Check my progress",
    prompt: "Check my progress",
  },
  {
    label: "Next steps",
    prompt: "What should I do next for my onboarding?",
  },
];

export default function CandidateAIAssistantPage() {
  const agentRef = useRef(null);
  const [auth, setAuth] = useState(null);

  useEffect(() => setAuth(readAuth()), []);

  function handleQuickAction(prompt) {
    agentRef.current?.sendPrompt?.(prompt);
  }

  return (
    <CandidateShell
      activeKey="assistant"
      title="AI Assistant"
      subtitle="Onboarding help · documents · next steps"
    >
      <AssistantPageShell
        eyebrow="Automation workspace"
        title="Your onboarding assistant"
        description="Chat here for multi-step help. Elsewhere, the floating mascot is your partner — tips and field guidance while you complete each step yourself."
        highlights={QUICK_ACTIONS}
        onHighlightClick={handleQuickAction}
      >
        <AgentChatCore ref={agentRef} variant="canvas" auth={auth} />
      </AssistantPageShell>
    </CandidateShell>
  );
}

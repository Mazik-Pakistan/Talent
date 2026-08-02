"use client";

import { useEffect, useRef, useState } from "react";

import AgentChatCore, { readAuth } from "@/components/ai/AgentChatCore";
import AssistantPageShell from "@/components/ai/AssistantPageShell";
import CandidateShell from "@/components/candidate/CandidateShell";
import { consumeAiAssistantSeedPrompt } from "@/lib/ai/openAiAssistant";

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
  {
    label: "Message HR",
    prompt: "Message HR about my onboarding",
  },
  {
    label: "Change my password",
    prompt: "How do I change my password?",
  },
];

export default function CandidateAIAssistantPage() {
  const agentRef = useRef(null);
  const [auth] = useState(() => readAuth());

  // One-shot seed from redirects (e.g. onboarding → Ask AI Assistant).
  useEffect(() => {
    if (!auth) return;
    const seed = consumeAiAssistantSeedPrompt();
    if (!seed) return;
    const timer = window.setTimeout(() => {
      agentRef.current?.sendPrompt?.(seed);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [auth]);

  function handleQuickAction(prompt) {
    agentRef.current?.sendPrompt?.(prompt);
  }

  return (
    <CandidateShell
      activeKey="assistant"
      title="AI Assistant"
      subtitle="Onboarding help · documents · offers · messages · next steps"
    >
      <AssistantPageShell
        eyebrow="Chat workspace"
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

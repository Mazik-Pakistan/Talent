"use client";

import { useEffect, useRef, useState } from "react";

import AgentChatCore, { readAuth } from "@/components/ai/AgentChatCore";
import AssistantPageShell from "@/components/ai/AssistantPageShell";
import EmployeeShell from "@/components/employee/EmployeeShell";
import { consumeAiAssistantSeedPrompt } from "@/lib/ai/openAiAssistant";

const QUICK_ACTIONS = [
  {
    label: "Continue onboarding",
    prompt: "Continue my onboarding",
  },
  {
    label: "What's left?",
    prompt: "What's left to complete on my onboarding checklist?",
  },
  {
    label: "Check my progress",
    prompt: "Check my progress",
  },
  {
    label: "Company email & password",
    prompt: "What is my company email and how do I change my password?",
  },
  {
    label: "HR help",
    prompt: "What HR and workday questions can you help me with?",
  },
];

export default function EmployeeAIAssistantPage() {
  const agentRef = useRef(null);
  const [auth] = useState(() => readAuth());

  // One-shot seed from redirects (e.g. post-hire onboarding → Ask AI Assistant).
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
    <EmployeeShell
      activeKey="ai-assistant"
      title="AI Assistant"
      subtitle="Workday help · onboarding · HR answers"
      permissions={["onboarding.self", "profile.view"]}
    >
      <AssistantPageShell
        eyebrow="Chat workspace"
        title="Your workday assistant"
        description="Chat here for multi-step help. On other employee pages, the Copilot mascot guides you field-by-field — it never fills forms for you."
        highlights={QUICK_ACTIONS}
        onHighlightClick={handleQuickAction}
      >
        <AgentChatCore ref={agentRef} variant="canvas" auth={auth} />
      </AssistantPageShell>
    </EmployeeShell>
  );
}

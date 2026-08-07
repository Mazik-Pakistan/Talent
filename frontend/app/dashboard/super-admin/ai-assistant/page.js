"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import AgentChatCore, { readAuth } from "@/components/ai/AgentChatCore";
import AssistantPageShell from "@/components/ai/AssistantPageShell";
import SuperAdminShell from "@/components/super-admin/SuperAdminShell";
import ProtectedSuperAdminRoute from "@/components/ProtectedSuperAdminRoute";

const QUICK_ACTIONS = [
  {
    label: "Platform overview",
    prompt:
      "Show me a platform overview — how many recruiters, active/pending, organizations, and per-recruiter employee counts.",
  },
  {
    label: "Invite recruiter",
    prompt:
      "I want to invite a new recruiter. Ask me for their full name, email, job title, and department.",
  },
  {
    label: "List all recruiters",
    prompt: "Show me all recruiters on the platform with their status and employee counts.",
  },
  {
    label: "List organizations",
    prompt: "Show me all organizations with their recruiter and employee counts.",
  },
  {
    label: "Create organization",
    prompt: "I want to create a new organization. Ask me for the name and any optional details.",
  },
];

export default function SuperAdminAIAssistantPage() {
  return (
    <ProtectedSuperAdminRoute>
      <SuperAdminAIAssistantPageContent />
    </ProtectedSuperAdminRoute>
  );
}

function SuperAdminAIAssistantPageContent() {
  const router = useRouter();
  const agentRef = useRef(null);
  const [auth, setAuth] = useState(null);

  useEffect(() => setAuth(readAuth()), []);

  function handleTabChange() {
    router.push("/dashboard/super-admin");
  }

  function handleQuickAction(prompt) {
    agentRef.current?.sendPrompt?.(prompt);
  }

  return (
    <SuperAdminShell
      activeTab="assistant"
      onTabChange={handleTabChange}
      title="AI Assistant"
      subtitle="Platform Admin Agent · recruiters, organizations, platform stats"
      user={auth?.user}
    >
      <AssistantPageShell
        eyebrow="Automation workspace"
        title="Platform Admin Agent"
        description="Manage recruiters, organizations, and get platform-wide reports. Ask me anything about your platform stats — I'll fetch the exact data from your dashboard."
        highlights={QUICK_ACTIONS}
        onHighlightClick={handleQuickAction}
      >
        <AgentChatCore ref={agentRef} variant="canvas" auth={auth} />
      </AssistantPageShell>
    </SuperAdminShell>
  );
}

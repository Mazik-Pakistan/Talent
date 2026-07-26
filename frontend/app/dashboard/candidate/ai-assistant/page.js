"use client";

import { useEffect, useState } from "react";

import AgentChatCore, { readAuth } from "@/components/ai/AgentChatCore";
import AssistantPageShell from "@/components/ai/AssistantPageShell";
import CandidateShell from "@/components/candidate/CandidateShell";
import styles from "./ai-assistant.module.css";

export default function CandidateAIAssistantPage() {
  const [auth, setAuth] = useState(null);
  useEffect(() => setAuth(readAuth()), []);

  return (
    <CandidateShell
      activeKey="assistant"
      title="AI Assistant"
      subtitle="Onboarding help · documents · next steps"
    >
      <div className={styles.assistantEnter}>
        <AssistantPageShell
          eyebrow="Automation workspace"
          title="Your onboarding assistant"
          description="Chat here for multi-step help. Elsewhere, the floating mascot is your partner — tips and field guidance while you complete each step yourself."
          highlights={["Document guidance", "Profile readiness", "Next-step suggestions"]}
        >
          <AgentChatCore variant="canvas" auth={auth} />
        </AssistantPageShell>
      </div>
    </CandidateShell>
  );
}

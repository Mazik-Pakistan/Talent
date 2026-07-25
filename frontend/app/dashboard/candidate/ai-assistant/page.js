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
          eyebrow="Candidate workspace"
          title="Your onboarding copilot"
          description="Keep your onboarding moving with one place to ask questions, upload documents, and get help with next steps."
          highlights={["Document guidance", "Profile readiness", "Next-step suggestions"]}
        >
          <AgentChatCore variant="canvas" auth={auth} />
        </AssistantPageShell>
      </div>
    </CandidateShell>
  );
}

"use client";

import { useEffect, useState } from "react";

import AgentChatCore, { readAuth } from "@/components/ai/AgentChatCore";
import AssistantPageShell from "@/components/ai/AssistantPageShell";

export default function RecruiterAIAssistantPage() {
  const [auth, setAuth] = useState(null);
  useEffect(() => setAuth(readAuth()), []);

  return (
    <AssistantPageShell
      eyebrow="Recruiter workspace"
      title="Your hiring copilot"
      description="Run hiring workflows, review candidates, open & verify documents, and send offers without leaving your recruiting dashboard."
      highlights={["Invite candidates", "Document verification", "Offer workflows"]}
    >
      <AgentChatCore variant="canvas" auth={auth} />
    </AssistantPageShell>
  );
}

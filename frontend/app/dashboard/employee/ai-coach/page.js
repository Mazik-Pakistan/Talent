"use client";

import EmployeeShell from "@/components/employee/EmployeeShell";
import ChatWindow from "@/components/aiCoach/ChatWindow";

const SUGGESTIONS = [
  "How do I become a Senior Full Stack Developer?",
  "What skills am I missing for a Lead Engineer role?",
  "Recommend courses to close my current skill gaps",
  "How does promotion work here?",
];

export default function EmployeeAiCoachPage() {
  return (
    <EmployeeShell activeKey="ai" title="AI Coach" subtitle="Your personal career growth assistant">
      <ChatWindow
        title="AI Coach"
        subtitle="Grounded in your resume, skills, certificates, and company career policy — ask about growth, skill gaps, or courses."
        suggestions={SUGGESTIONS}
      />
    </EmployeeShell>
  );
}

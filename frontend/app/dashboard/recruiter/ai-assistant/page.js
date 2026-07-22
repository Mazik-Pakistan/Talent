"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** AI Assistant chatbot removed — redirect to Learning Knowledge Base. */
export default function AiAssistantRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/recruiter/learning");
  }, [router]);
  return <p style={{ textAlign: "center", marginTop: "2rem" }}>Redirecting to Learning…</p>;
}

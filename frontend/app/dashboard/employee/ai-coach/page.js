"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Chatbot removed — redirect to Career Path inside Learning. */
export default function AiCoachRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/employee/learning?tab=career");
  }, [router]);
  return <p style={{ textAlign: "center", marginTop: "2rem" }}>Redirecting to Career Path…</p>;
}

"use client";

import { useEffect } from "react";
import RecruiterLoader from "@/components/recruiter/RecruiterLoader";
import { useRouter } from "next/navigation";

/** Chatbot removed â€” redirect to Career Path inside Learning. */
export default function AiCoachRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/employee/learning?tab=career");
  }, [router]);
  return <RecruiterLoader />;
}


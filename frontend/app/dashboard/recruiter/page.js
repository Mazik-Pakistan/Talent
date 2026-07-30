"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import RecruiterLoader from "@/components/recruiter/RecruiterLoader";

export default function RecruiterDashboardPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard/recruiter/overview");
  }, [router]);

  return <RecruiterLoader />;
}

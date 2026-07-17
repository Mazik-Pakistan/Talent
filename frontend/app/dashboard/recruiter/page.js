"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function RecruiterDashboardPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard/recruiter/overview");
  }, [router]);

  return <p style={{ textAlign: "center", marginTop: "2rem" }}>Redirecting to the new recruiter experience…</p>;
}

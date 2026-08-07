"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import RecruiterLoader from "@/components/recruiter/RecruiterLoader";
import { ROLE_HOME } from "@/services/rbac";

export default function DashboardIndexPage() {
  const router = useRouter();

  useEffect(() => {
    const storedUser = localStorage.getItem("user");
    const accessToken = localStorage.getItem("access_token");
    if (!storedUser || !accessToken) {
      router.replace("/login");
      return;
    }
    const user = JSON.parse(storedUser);
    if (user.must_change_password) {
      router.replace("/set-password");
      return;
    }
    router.replace(ROLE_HOME[user.role] || "/login");
  }, [router]);

  return <RecruiterLoader />;
}

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import RecruiterLoader from "@/components/recruiter/RecruiterLoader";

const ROLE_HOME = {
  recruiter: "/dashboard/recruiter",
  candidate: "/dashboard/candidate",
  employee: "/dashboard/employee",
  super_admin: "/dashboard/super-admin",
};

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

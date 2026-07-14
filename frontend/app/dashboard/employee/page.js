"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import RequireAccess, { ModuleNav } from "@/components/RequireAccess";

export default function EmployeeDashboardPage() {
  return (
    <RequireAccess anyOf={["onboarding.self", "profile.view"]} roles={["employee"]}>
      <EmployeeDashboardContent />
    </RequireAccess>
  );
}

function EmployeeDashboardContent() {
  const router = useRouter();
  const [user, setUser] = useState(null);

  useEffect(() => {
    setUser(JSON.parse(localStorage.getItem("user")));
  }, []);

  function handleLogout() {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("user");
    router.replace("/login");
  }

  if (!user) {
    return <p style={{ textAlign: "center", marginTop: "2rem" }}>Loading…</p>;
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Employee dashboard</p>
          <h1>Welcome, {user.full_name}</h1>
          <p>Signed in as {user.email} · Role: {user.role}</p>
          <ModuleNav role={user.role} />
        </div>
        <button type="button" className="primary-button" onClick={handleLogout}>
          Log out
        </button>
      </header>

      <section className="dashboard-card">
        <h2>Workplace overview</h2>
        <p>
          Title: <strong>{user.job_title || "—"}</strong> · Department:{" "}
          <strong>{user.department || "—"}</strong>
        </p>
        <p>Candidate transitioned to employee. Access: onboarding history, learning, AI Coach, profile.</p>
      </section>
    </main>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import RequireAccess, { ModuleNav } from "@/components/RequireAccess";

export default function CandidateDashboardPage() {
  return (
    <RequireAccess anyOf={["onboarding.self", "profile.view"]} roles={["candidate"]}>
      <CandidateDashboardContent />
    </RequireAccess>
  );
}

function CandidateDashboardContent() {
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
          <p className="eyebrow">Candidate dashboard</p>
          <h1>Welcome, {user.full_name}</h1>
          <p>Signed in as {user.email} · Role: {user.role}</p>
          <ModuleNav role={user.role} />
        </div>
        <div className="dashboard-actions">
          <button type="button" className="secondary-button" onClick={() => router.push("/onboarding")}>
            Open onboarding
          </button>
          <button type="button" className="primary-button" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      <section className="dashboard-card">
        <h2>Your hiring progress</h2>
        <p>
          Role: <strong>{user.job_title || "—"}</strong> · {user.department || "—"}
        </p>
        <p>Authorized modules: personal onboarding, learning, AI Coach, and profile.</p>
      </section>
    </main>
  );
}

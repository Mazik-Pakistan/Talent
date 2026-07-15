"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import RequireAccess, { ModuleNav } from "@/components/RequireAccess";
import {
  clearLocalSession,
  getApiErrorMessage,
  getMyEmployeeProfile,
  logout,
} from "@/services/authService";

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
  const [employee, setEmployee] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUser(JSON.parse(localStorage.getItem("user")));
  }, []);

  const loadProfile = useCallback(async () => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      const data = await getMyEmployeeProfile(accessToken);
      setEmployee(data.employee);
      setLoadError("");
    } catch (error) {
      setLoadError(getApiErrorMessage(error, "Could not load your employee profile."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  async function handleLogout() {
    const accessToken = localStorage.getItem("access_token");
    await logout(accessToken);
    clearLocalSession();
    router.replace("/login");
  }

  if (!user) {
    return <p style={{ textAlign: "center", marginTop: "2rem" }}>Loading…</p>;
  }

  const onboarding = employee?.onboarding || {};

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Employee dashboard</p>
          <h1>Welcome, {employee?.full_name || user.full_name}</h1>
          <p>
            Signed in as {user.email} · Role: {user.role}
            {employee?.employee_id ? <> · ID: <strong>{employee.employee_id}</strong></> : null}
          </p>
          <ModuleNav role={user.role} />
        </div>
        <button type="button" className="primary-button" onClick={handleLogout}>
          Log out
        </button>
      </header>

      {loadError && (
        <section className="dashboard-card wide">
          <p className="form-message" role="alert">{loadError}</p>
        </section>
      )}

      <section className="dashboard-card wide" aria-labelledby="emp-profile-heading">
        <h2 id="emp-profile-heading">Employment profile</h2>
        {loading ? (
          <p className="empty-state">Loading…</p>
        ) : (
          <dl className="profile-facts">
            <div className="profile-fact">
              <dt>Employee ID</dt>
              <dd>{employee?.employee_id || "—"}</dd>
            </div>
            <div className="profile-fact">
              <dt>Designation</dt>
              <dd>{employee?.job_title || "—"}</dd>
            </div>
            <div className="profile-fact">
              <dt>Department</dt>
              <dd>{employee?.department || "—"}</dd>
            </div>
            <div className="profile-fact">
              <dt>Office location</dt>
              <dd>{employee?.office_location || "—"}</dd>
            </div>
            <div className="profile-fact">
              <dt>Joining date</dt>
              <dd>{formatDate(employee?.start_date)}</dd>
            </div>
            <div className="profile-fact">
              <dt>Converted on</dt>
              <dd>{formatDate(employee?.converted_at)}</dd>
            </div>
          </dl>
        )}
      </section>

      <div className="dashboard-columns">
        <div className="dashboard-stack">
          <section className="dashboard-card wide">
            <h2>Onboarding record retained</h2>
            <p>All information collected during candidate onboarding is preserved on your employee profile.</p>
            <div className="form-grid" style={{ marginTop: 12 }}>
              <InfoCard title="Personal" body={summarize(onboarding.personal)} />
              <InfoCard title="Emergency contact" body={summarize(onboarding.emergency)} />
              <InfoCard title="Payroll" body={summarize(onboarding.employment)} />
              <InfoCard
                title="Education"
                body={`${onboarding.education?.entries?.length || 0} entr${(onboarding.education?.entries?.length || 0) === 1 ? "y" : "ies"}`}
              />
              <InfoCard
                title="Government docs"
                body={`${onboarding.government_docs?.documents?.length || 0} document(s)`}
              />
              <InfoCard
                title="References"
                body={`${onboarding.references?.references?.length || 0} reference(s)`}
              />
              <InfoCard title="NDA" body={onboarding.nda?.full_legal_name || "Not on file"} />
              <InfoCard title="Contract" body={onboarding.contract?.full_legal_name || "Not on file"} />
              <InfoCard title="Resume" body={onboarding.resume?.file_name || "Not on file"} />
            </div>
          </section>

          <section className="dashboard-card wide">
            <h2>Workplace modules</h2>
            <div className="dashboard-columns" style={{ marginTop: 0 }}>
              <div className="widget-placeholder">Assigned learning modules will appear here in Phase 3.</div>
              <div className="widget-placeholder">AI Coach will appear here in Phase 3.</div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function InfoCard({ title, body }) {
  return (
    <div className="profile-fact">
      <dt>{title}</dt>
      <dd>{body}</dd>
    </div>
  );
}

function summarize(obj) {
  if (!obj) return "Not provided";
  if (obj.full_name) return obj.full_name;
  if (obj.national_id) return `ID on file · ${obj.city || ""}`.trim();
  if (obj.bank_name) return obj.bank_name;
  return "On file";
}

function formatDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

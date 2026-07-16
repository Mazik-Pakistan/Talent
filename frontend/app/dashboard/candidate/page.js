"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import RequireAccess, { ModuleNav } from "@/components/RequireAccess";
import { clearLocalSession, getApiErrorMessage, getCandidateDashboard, getMyOffer, logout } from "@/services/authService";
import DocumentStatusList from "@/components/DocumentStatusList";

const DASHBOARD_REFRESH_MS = 60000;

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

  // ----- US-018 / US-019 / US-021 / US-022 -----
  const [dashboard, setDashboard] = useState(null);
  const [offer, setOffer] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUser(JSON.parse(localStorage.getItem("user")));
  }, []);

  const loadDashboard = useCallback(async () => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      const [data, offerData] = await Promise.all([
        getCandidateDashboard(accessToken),
        getMyOffer(accessToken).catch(() => null),
      ]);
      setDashboard(data);
      setOffer(offerData?.offer || null);
      setLoadError("");
    } catch (error) {
      setLoadError(getApiErrorMessage(error, "Could not load your dashboard."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
    const interval = setInterval(loadDashboard, DASHBOARD_REFRESH_MS);
    return () => clearInterval(interval);
  }, [loadDashboard]);

  async function handleLogout() {
    const accessToken = localStorage.getItem("access_token");
    await logout(accessToken);
    clearLocalSession();
    router.replace("/login");
  }

  // ★ Unified navigation to onboarding with edit mode
  function goToEditProfile() {
    router.push("/onboarding?edit=true");
  }

  if (!user) {
    return <p style={{ textAlign: "center", marginTop: "2rem" }}>Loading…</p>;
  }

  const profile = dashboard?.profile;
  const progress = dashboard?.progress;
  const tasks = dashboard?.tasks || [];
  const announcements = dashboard?.announcements || [];

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
          {/* ★ Replaced "Open onboarding" with "Edit Profile" */}
          <button type="button" className="secondary-button" onClick={goToEditProfile}>
            Edit Profile
          </button>
          <button type="button" className="primary-button" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      {loadError && (
        <section className="dashboard-card wide">
          <p className="form-message" role="alert">{loadError}</p>
        </section>
      )}

      {!loading && offer && offer.status !== "approved" && (
        <section className="dashboard-card wide" style={{ padding: 0, background: "transparent", border: "none", boxShadow: "none" }}>
          <div className="profile-incomplete-banner" style={{ background: offer.status === "signed" ? "linear-gradient(120deg, #f3faf7, #ffffff)" : undefined, borderColor: offer.status === "signed" ? "#bfe3d2" : undefined }}>
            <div className="banner-copy">
              <h3 style={{ color: offer.status === "signed" ? "#087a55" : undefined }}>
                {offer.status === "signed" ? "Offer signed — awaiting HR approval" : "Your offer letter has arrived"}
              </h3>
              <p style={{ color: offer.status === "signed" ? "#3a6f5a" : undefined }}>
                {offer.status === "signed"
                  ? `You signed the ${offer.job_title} offer. HR will approve it and issue your Employee ID shortly.`
                  : `Review and digitally sign your offer for ${offer.job_title}.`}
              </p>
            </div>
            {offer.status !== "signed" && (
              <button type="button" className="primary-button" onClick={() => router.push("/offer")}>
                Review my offer
              </button>
            )}
          </div>
        </section>
      )}

      {/* US-022: personalized welcome + profile facts */}
      <section className="dashboard-card wide" aria-labelledby="profile-heading">
        <div className="profile-header">
          <span className="avatar-circle">{loading ? "…" : profile?.initials || "?"}</span>
          <div>
            <p className="eyebrow" style={{ marginBottom: 4 }}>Hiring profile</p>
            <h2 id="profile-heading" style={{ margin: 0 }}>{profile?.full_name || user.full_name}</h2>
          </div>
        </div>
        <dl className="profile-facts">
          <div className="profile-fact">
            <dt>Designation</dt>
            <dd>{profile?.job_title || "—"}</dd>
          </div>
          <div className="profile-fact">
            <dt>Department</dt>
            <dd>{profile?.department || "—"}</dd>
          </div>
          <div className="profile-fact">
            <dt>Office location</dt>
            <dd>{profile?.office_location || "Not yet assigned"}</dd>
          </div>
          <div className="profile-fact">
            <dt>Joining date</dt>
            <dd>{formatDate(profile?.start_date)}</dd>
          </div>
          <div className="profile-fact">
            <dt>Recruiter contact</dt>
            <dd>
              {profile?.recruiter?.full_name || profile?.recruiter?.email || "—"}
              {profile?.recruiter?.email && profile?.recruiter?.full_name && (
                <>
                  <br />
                  <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: ".8rem" }}>
                    {profile.recruiter.email}
                  </span>
                </>
              )}
            </dd>
          </div>
        </dl>
      </section>

      <div className="dashboard-columns">
        <div className="dashboard-stack">
          {/* US-019: onboarding progress tracker */}
          <section className="dashboard-card wide" aria-labelledby="progress-heading">
            <h2 id="progress-heading">Onboarding progress</h2>
            <div className="progress-row">
              <span className="progress-percentage">{loading ? "—" : `${progress?.percentage ?? 0}%`}</span>
              <div className="progress-bar-track">
                <div className="progress-bar-fill" style={{ width: `${progress?.percentage ?? 0}%` }} />
              </div>
            </div>

            {/* US-021: candidate task list */}
            <ul className="task-list">
              {tasks.map((task) => (
                <li key={task.id}>
                  <button
                    type="button"
                    className={`task-item ${task.completed ? "completed" : ""} ${!task.available ? "disabled" : ""}`}
                    disabled={!task.available}
                    onClick={() =>
                      task.available && !task.completed && router.push(`/onboarding?step=${task.action_step || ""}`)
                    }
                  >
                    <span className="task-check">{task.completed ? "✓" : ""}</span>
                    <span className="task-label">{task.label}</span>
                    {!task.available && <span className="task-tag">Coming soon</span>}
                  </button>
                </li>
              ))}
              {!loading && tasks.length === 0 && <p className="empty-state">No tasks yet.</p>}
            </ul>
          </section>

          {/* Learning + AI Coach shortcuts (Phase 3) */}
          <section className="dashboard-card wide" aria-labelledby="widgets-heading">
            <h2 id="widgets-heading">Learning &amp; AI Coach</h2>
            <div className="dashboard-columns" style={{ marginTop: 0 }}>
              <div className="widget-placeholder">🎓 Assigned learning modules will appear here once Phase 3 launches.</div>
              <div className="widget-placeholder">🤖 Your AI Coach assistant will appear here once Phase 3 launches.</div>
            </div>
          </section>

          <section className="dashboard-card wide" id="documents-section">
            <h2>My documents</h2>
            <p>Government ID and education documents you&apos;ve uploaded, with live OCR/verification status.</p>
            <DocumentStatusList />
          </section>
        </div>

        {/* US-020: announcements */}
        <section className="dashboard-card" aria-labelledby="announcements-heading">
          <h2 id="announcements-heading" style={{ fontSize: "1.1rem" }}>Announcements</h2>
          <div className="announcement-stack">
            {loading ? (
              <p className="empty-state">Loading…</p>
            ) : announcements.length ? (
              announcements.map((announcement) => (
                <article className="announcement-card" key={announcement.id}>
                  <h4>{announcement.title}</h4>
                  <p>{announcement.body}</p>
                  <p className="announcement-meta">
                    {announcement.created_by_name || "Recruiting team"} · {formatDate(announcement.created_at)}
                  </p>
                </article>
              ))
            ) : (
              <p className="empty-state">No announcements yet.</p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function formatDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
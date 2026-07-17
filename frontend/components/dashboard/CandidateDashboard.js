"use client";

import Link from "next/link";

import DashboardLayout from "@/components/dashboard/DashboardLayout";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
const candidateSidebarItems = [
  { id: "overview", label: "Overview", hint: "Progress snapshot" },
  { id: "tasks", label: "Tasks", hint: "Pending checklist" },
  { id: "announcements", label: "Announcements", hint: "Company updates" },
  { id: "learning", label: "Learning", hint: "Assigned modules" },
  { id: "assistant", label: "Assistant", hint: "Helpful shortcuts" },
  { id: "profile", label: "Profile", hint: "Joining details" },
];

function StatCard({ label, value, detail }) {
  return (
    <article className="metric-card metric-card--accent">
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value ?? "—"}</strong>
      <p className="metric-detail">{detail || "Add your data to populate this KPI."}</p>
    </article>
  );
}

function ProgressBar({ completed, total }) {
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="candidate-progress">
      <div className="candidate-progress__top">
        <div>
          <p className="eyebrow">Onboarding progress</p>
          <h2>{percentage}% complete</h2>
        </div>
        <strong>{completed}/{total} steps</strong>
      </div>
      <div className="progress-bar-track">
        <div className="progress-bar-fill" style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

function TaskPill({ status }) {
  const tone = status === "completed" ? "success" : status === "in-progress" ? "info" : "warning";
  const label = status === "completed" ? "Done" : status === "in-progress" ? "In progress" : "Pending";
  return <span className={`status-pill status-pill--${tone}`}>{label}</span>;
}

function EmptyState({ title, body }) {
  return (
    <div className="empty-section">
      <div>
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
    </div>
  );
}

export default function CandidateDashboard({ user, onLogout, data = {} }) {
  const metrics = data.metrics || [];
  const tasks = data.tasks || [];
  const announcements = data.announcements || [];
  const learning = data.learning || [];
  const assistantShortcuts = data.assistantShortcuts || [];
  const profile = data.profile || {};
  const completedTasks = typeof data.completedTasks === "number" ? data.completedTasks : tasks.filter((task) => task.status === "completed").length;
  const totalTasks = typeof data.totalTasks === "number" ? data.totalTasks : tasks.length;

  return (
    <DashboardLayout
      sidebar={
        <DashboardSidebar
          user={user}
          items={candidateSidebarItems.map((item, index) => ({ ...item, active: index === 0 }))}
          roleLabel="Candidate Dashboard"
          accent="candidate"
        />
      }
      header={
        <header className="dashboard-header-card" id="overview">
          <div>
            <p className="eyebrow">Candidate workspace</p>
            <h1>Welcome, {user?.full_name}</h1>
            <p className="dashboard-lead">
              A focused personal workspace for onboarding progress, assigned tasks, learning, and company updates.
            </p>
          </div>
          <div className="dashboard-header-actions">
            <Link className="secondary-button dashboard-button-link" href="/onboarding">
              Open onboarding
            </Link>
            <button type="button" className="primary-button" onClick={onLogout}>
              Log out
            </button>
          </div>
        </header>
      }
      rail={
        <div className="dashboard-rail-stack">
          <section className="dashboard-card dashboard-card--compact" id="assistant">
            <div className="section-heading-row">
              <div>
                <p className="eyebrow">AI Assistant</p>
                <h2>Helpful shortcuts</h2>
              </div>
            </div>
            <div className="announcement-stack">
              {assistantShortcuts.length ? assistantShortcuts.map((item) => (
                <div key={item.label} className="announcement-card">
                  <h4>{item.label}</h4>
                  <p>{item.hint}</p>
                </div>
              )) : (
                <EmptyState title="Add assistant shortcuts" body="Use this block for quick links, prompts, or AI-powered helper actions." />
              )}
            </div>
          </section>

          <section className="dashboard-card dashboard-card--compact" id="profile">
            <div className="section-heading-row">
              <div>
                <p className="eyebrow">Profile snapshot</p>
                <h2>Joining details</h2>
              </div>
            </div>
            <dl className="profile-facts">
              <div className="profile-fact"><dt>Joining date</dt><dd>{profile.joiningDate || "—"}</dd></div>
              <div className="profile-fact"><dt>Recruiter</dt><dd>{profile.recruiter || "—"}</dd></div>
              <div className="profile-fact"><dt>Department</dt><dd>{profile.department || user?.department || "—"}</dd></div>
              <div className="profile-fact"><dt>Office</dt><dd>{profile.officeLocation || "—"}</dd></div>
            </dl>
          </section>
        </div>
      }
    >
      <div className="dashboard-stack">
        <section className="dashboard-card">
          <div className="profile-header">
            <div className="avatar-circle" aria-hidden="true">HA</div>
            <div>
              <p className="eyebrow">Personalized greeting</p>
              <h2>Hello, {user?.full_name}</h2>
              <p className="dashboard-lead">
                {profile.designation || user?.job_title || "Your dashboard"} · {profile.department || user?.department || "—"}
              </p>
            </div>
          </div>
          <ProgressBar completed={completedTasks} total={totalTasks} />
        </section>

        <section className="dashboard-card" id="tasks">
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">Tasks</p>
              <h2>Pending onboarding checklist</h2>
            </div>
            <span className="status-pill status-pill--warning">{Math.max(totalTasks - completedTasks, 0)} remaining</span>
          </div>
          <div className="task-list">
            {tasks.length ? tasks.map((task) => (
              <Link key={task.title} href={task.route} className={`task-item ${task.status === "completed" ? "completed" : ""}`}>
                <span className="task-check" aria-hidden="true">✓</span>
                <span className="task-label">{task.title}</span>
                <TaskPill status={task.status} />
                <span className="task-due">{task.due ? `Due ${task.due}` : "—"}</span>
              </Link>
            )) : (
              <EmptyState title="Add onboarding tasks" body="Connect your checklist items here for documents, signatures, learning, and profile completion." />
            )}
          </div>
        </section>

        <section className="dashboard-columns" id="announcements">
          <div className="dashboard-card">
            <div className="section-heading-row">
              <div>
                <p className="eyebrow">Announcements</p>
                <h2>Latest company updates</h2>
              </div>
            </div>
            <div className="announcement-stack">
              {announcements.length ? announcements.map((announcement) => (
                <article key={announcement.title} className="announcement-card">
                  <h4>{announcement.title}</h4>
                  <p>{announcement.body}</p>
                  <div className="announcement-meta">{announcement.meta || ""}</div>
                </article>
              )) : (
                <EmptyState title="Add announcements" body="Use this block for onboarding updates, policy reminders, or company notices." />
              )}
            </div>
          </div>

          <div className="dashboard-card" id="learning">
            <div className="section-heading-row">
              <div>
                <p className="eyebrow">Learning</p>
                <h2>Assigned modules</h2>
              </div>
            </div>
            {learning.length ? (
              <ul className="mini-list">
                {learning.map((module) => (
                  <li key={module.title}>
                    <div>
                      <strong>{module.title}</strong>
                      <div className="muted-text">{module.length}</div>
                    </div>
                    <TaskPill status={module.status === "In progress" ? "in-progress" : module.status === "Completed" ? "completed" : "pending"} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Add learning modules" body="Show the onboarding curriculum or assigned learning modules here." />
            )}
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}

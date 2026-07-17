"use client";

import Link from "next/link";

import DashboardLayout from "@/components/dashboard/DashboardLayout";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
const recruiterSidebarItems = [
  { id: "overview", label: "Overview", hint: "Metric snapshot" },
  { id: "search", label: "Search", hint: "People lookup" },
  { id: "approvals", label: "Approvals", hint: "Documents & tasks" },
  { id: "activity", label: "Activity", hint: "Team timeline" },
  { id: "actions", label: "Shortcuts", hint: "Common actions" },
];

function StatCard({ label, value, detail }) {
  return (
    <article className="metric-card">
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value ?? "—"}</strong>
      <p className="metric-detail">{detail || "Add a metric value to populate this card."}</p>
    </article>
  );
}

function Pill({ children, tone = "neutral" }) {
  return <span className={`status-pill status-pill--${tone}`}>{children}</span>;
}

function ProgressRow({ label, value }) {
  return (
    <div className="progress-row">
      <span>{label}</span>
      <strong>{typeof value === "number" ? `${value}%` : "—"}</strong>
    </div>
  );
}

function SectionEmpty({ title, body, action }) {
  return (
    <div className="empty-section">
      <div>
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
      {action}
    </div>
  );
}

export default function RecruiterDashboard({ user, onLogout, data = {} }) {
  const metrics = data.metrics || [];
  const notifications = data.notifications || [];
  const quickActions = data.quickActions || [];
  const searchResults = data.searchResults || [];
  const approvals = data.approvals || [];
  const activity = data.activity || [];
  const employees = data.employees || [];
  const pendingCount = data.pendingOnboardingCount;
  const progressValue = data.progressValue;
  const unreadCount = typeof data.unreadCount === "number" ? data.unreadCount : notifications.filter((item) => !item.read).length;

  return (
    <DashboardLayout
      sidebar={
        <DashboardSidebar
          user={user}
          items={recruiterSidebarItems.map((item, index) => ({ ...item, active: index === 0 }))}
          roleLabel="Recruiter Dashboard"
          accent="recruiter"
        />
      }
      header={
        <header className="dashboard-header-card" id="overview">
          <div>
            <p className="eyebrow">Recruiter workspace</p>
            <h1>Welcome back, {user?.full_name}</h1>
            <p className="dashboard-lead">
              A clean command center for onboarding visibility, search, approvals, and team activity.
            </p>
          </div>
          <div className="dashboard-header-actions">
            <Link className="secondary-button dashboard-button-link" href="#search">
              Search people
            </Link>
            <button type="button" className="primary-button" onClick={onLogout}>
              Log out
            </button>
          </div>
        </header>
      }
      rail={
        <div className="dashboard-rail-stack">
          <section className="dashboard-card dashboard-card--compact" id="notifications">
            <div className="section-heading-row">
              <div>
                <p className="eyebrow">Notifications</p>
                <h2>Unread updates</h2>
              </div>
              <span className="badge-count">{unreadCount || 0}</span>
            </div>
            <div className="notif-panel">
              {notifications.length ? notifications.map((item) => (
                <div key={item.id} className={`notif-item ${item.read ? "read" : ""}`}>
                  <span className="notif-dot" aria-hidden="true" />
                  <span className="notif-body">
                    <span className="notif-title">{item.title}</span>
                    <span className="notif-message">{item.message}</span>
                    <span className="notif-time">{item.time}</span>
                  </span>
                </div>
              )) : (
                <SectionEmpty title="No notifications yet" body="Connect your notification stream to surface document submissions, approvals, and onboarding events here." />
              )}
            </div>
          </section>

          <section className="dashboard-card dashboard-card--compact" id="actions">
            <div className="section-heading-row">
              <div>
                <p className="eyebrow">Quick actions</p>
                <h2>Shortcuts</h2>
              </div>
            </div>
            <div className="quick-actions-grid">
              {quickActions.length ? quickActions.map((action) => (
                <Link key={action.label} className="quick-action" href={action.route}>
                  <strong>{action.label}</strong>
                  <span className="qa-hint">{action.hint}</span>
                </Link>
              )) : (
                <SectionEmpty title="Add quick actions" body="Pass an array of shortcuts to surface common recruiter workflows like reports, documents, or approvals." />
              )}
            </div>
          </section>
        </div>
      }
    >
      <div className="dashboard-stack">
        <section className="dashboard-card">
          <div className="kpi-grid">
            {metrics.length ? metrics.map((metric) => (
              <StatCard key={metric.label} {...metric} />
            )) : [
              { label: "Active employees", value: null, detail: "Add a metric object for live counts." },
              { label: "Pending onboarding", value: null, detail: "Add onboarding volume here." },
              { label: "Docs awaiting review", value: null, detail: "Connect your review metrics." },
              { label: "Upcoming joiners", value: null, detail: "Track upcoming start dates here." },
            ].map((metric) => <StatCard key={metric.label} {...metric} />)}
          </div>
          <ProgressRow label="Pending onboarding progress" value={progressValue} />
          <div className="progress-bar-track" aria-label="Recruiter onboarding progress">
            <div className="progress-bar-fill" style={{ width: typeof progressValue === "number" ? `${progressValue}%` : "0%" }} />
          </div>
        </section>

        <section className="dashboard-card" id="search">
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">Universal search</p>
              <h2>Find employees and candidates anywhere</h2>
            </div>
            <Pill tone="info">Ready for live search</Pill>
          </div>
          <SectionEmpty
            title="Add your live search results"
            body="Pass a list of matching candidates or employees here when you connect Atlas Search or any backend search endpoint."
          />
        </section>

        <section className="dashboard-card" id="approvals">
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">Approvals</p>
              <h2>Pending document review</h2>
            </div>
            <Pill tone="warning">{approvals.length || pendingCount || 0} pending</Pill>
          </div>
          <div className="table-card">
            {approvals.length ? (
              <table>
                <thead>
                  <tr>
                    <th>Candidate</th>
                    <th>Item</th>
                    <th>Status</th>
                    <th>Due</th>
                  </tr>
                </thead>
                <tbody>
                  {approvals.map((row) => (
                    <tr key={row.name + row.item}>
                      <td>{row.name}</td>
                      <td>{row.item}</td>
                      <td><Pill tone="warning">{row.status || "Pending"}</Pill></td>
                      <td>{row.due || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <SectionEmpty
                title="Add approval records"
                body="Use this area for document reviews, pending verifications, or any other approval workflow rows."
              />
            )}
          </div>
        </section>

        <section className="dashboard-columns" id="activity">
          <div className="dashboard-card">
            <div className="section-heading-row">
              <div>
                <p className="eyebrow">Recent activity</p>
                <h2>Latest onboarding events</h2>
              </div>
            </div>
            {activity.length ? (
              <ul className="activity-list">
                {activity.map((item) => (
                  <li key={`${item.actor}-${item.action}`}>
                    <span className="activity-dot" aria-hidden="true" />
                    <div>
                      <div className="activity-label">{item.action}</div>
                      <div className="activity-meta">{item.meta} · {item.actor}</div>
                    </div>
                    <div className="activity-time">{item.time}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <SectionEmpty title="Add activity items" body="Show candidate registrations, OCR completion, employee creation, or any other event timeline here." />
            )}
          </div>

          <div className="dashboard-card">
            <div className="section-heading-row">
              <div>
                <p className="eyebrow">Joining soon</p>
                <h2>Upcoming employees</h2>
              </div>
            </div>
            {employees.length ? (
              <ul className="mini-list">
                {employees.map((employee) => (
                  <li key={employee.name}>
                    <div>
                      <strong>{employee.name}</strong>
                      <div className="muted-text">{employee.role} · {employee.department}</div>
                    </div>
                    <div className="muted-text">{employee.joining}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <SectionEmpty title="Add upcoming joiners" body="Use this panel to show new hires and their joining dates once your data is connected." />
            )}
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}

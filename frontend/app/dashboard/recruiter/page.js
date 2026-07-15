"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import RequireAccess, { ModuleNav } from "@/components/RequireAccess";
import {
  clearLocalSession,
  createAnnouncement,
  createEmployeeFromCandidate,
  createInvitation,
  getAnnouncements,
  getApiErrorMessage,
  getDashboardActivity,
  getDashboardSummary,
  getNotifications,
  getReadyForConversion,
  globalSearch,
  listEmployees,
  logout,
  markNotificationsRead,
} from "@/services/authService";

const initialInvite = {
  full_name: "",
  email: "",
  job_title: "",
  department: "",
  office_location: "",
  start_date: "",
  expires_in_days: 7,
};

/** US-013: Dashboard data refreshes every 60 seconds. */
const DASHBOARD_REFRESH_MS = 60000;
const SEARCH_DEBOUNCE_MS = 350;

export default function RecruiterDashboardPage() {
  return (
    <RequireAccess anyOf={["recruitment.view", "recruitment.invite"]} roles={["recruiter", "super_admin"]}>
      <RecruiterDashboardContent />
    </RequireAccess>
  );
}

function RecruiterDashboardContent() {
  const router = useRouter();
  const [user, setUser] = useState(null);

  // ----- US-013: dashboard overview -----
  const [summary, setSummary] = useState(null);
  const [activities, setActivities] = useState([]);
  const [dashboardError, setDashboardError] = useState("");
  const [dashboardLoading, setDashboardLoading] = useState(true);

  // ----- US-014: notifications -----
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifBusy, setNotifBusy] = useState(false);

  // ----- US-017: global search -----
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef(null);

  // ----- invite form (US-001 flow that feeds this dashboard) -----
  const [inviteForm, setInviteForm] = useState(initialInvite);
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [inviteEmailSent, setInviteEmailSent] = useState(null);
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [isCreating, setIsCreating] = useState(false);

  // ----- US-020: announcements -----
  const [announcements, setAnnouncements] = useState([]);
  const [announcementForm, setAnnouncementForm] = useState({ title: "", body: "" });
  const [announcementMessage, setAnnouncementMessage] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);

  // ----- US-023 / US-024: conversion -----
  const [readyCandidates, setReadyCandidates] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [conversionMessage, setConversionMessage] = useState("");
  const [convertingId, setConvertingId] = useState(null);
  const [expandedCandidateId, setExpandedCandidateId] = useState(null);

  useEffect(() => {
    const storedUser = localStorage.getItem("user");
    setUser(JSON.parse(storedUser));
  }, []);

  const loadDashboard = useCallback(async () => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      const [summaryData, activityData, notificationsData, announcementsData, readyData, employeesData] =
        await Promise.all([
          getDashboardSummary(accessToken),
          getDashboardActivity(accessToken, 15),
          getNotifications(accessToken, 20),
          getAnnouncements(accessToken, 10),
          getReadyForConversion(accessToken),
          listEmployees(accessToken),
        ]);
      setSummary(summaryData);
      setActivities(activityData.activities);
      setNotifications(notificationsData.notifications);
      setUnreadCount(notificationsData.unread_count);
      setAnnouncements(announcementsData.announcements);
      setReadyCandidates(readyData.candidates || []);
      setEmployees(employeesData.employees || []);
      setDashboardError("");
    } catch (error) {
      setDashboardError(getApiErrorMessage(error, "Could not load dashboard data."));
    } finally {
      setDashboardLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
    const interval = setInterval(loadDashboard, DASHBOARD_REFRESH_MS);
    return () => clearInterval(interval);
  }, [loadDashboard]);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      const accessToken = localStorage.getItem("access_token");
      if (!accessToken) return;
      try {
        const data = await globalSearch(trimmed, accessToken);
        setSearchResults(data.results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery]);

  async function handleLogout() {
    const accessToken = localStorage.getItem("access_token");
    await logout(accessToken);
    clearLocalSession();
    router.replace("/login");
  }

  async function handleMarkAllRead() {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken || unreadCount === 0) return;
    setNotifBusy(true);
    try {
      await markNotificationsRead({ all: true }, accessToken);
      setNotifications((current) => current.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {
      // Non-critical — the next 60s refresh will reconcile state.
    } finally {
      setNotifBusy(false);
    }
  }

  async function handleMarkOneRead(notificationId) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      await markNotificationsRead({ ids: [notificationId] }, accessToken);
      setNotifications((current) =>
        current.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
      );
      setUnreadCount((count) => Math.max(0, count - 1));
    } catch {
      // Non-critical.
    }
  }

  function handleNotificationClick(notification) {
    if (!notification.read) {
      handleMarkOneRead(notification.id);
    }
    if (notification.link) {
      if (notification.link.includes("#")) {
        const hash = notification.link.split("#")[1];
        scrollToSection(hash);
      } else if (notification.type === "invitation_sent") {
        scrollToSection("invite-section");
      } else if (notification.type === "onboarding_submitted") {
        scrollToSection("conversion-section");
      } else if (notification.type === "candidate_registered") {
        scrollToSection("approvals-section");
      } else if (notification.type === "employee_created") {
        scrollToSection("employees-section");
      } else {
        scrollToSection("conversion-section");
      }
    }
  }

  function handleSearchSelect(result) {
    setSelectedPerson(result);
    setSearchOpen(false);
    setSearchQuery(result.full_name || "");
    scrollToSection("search-detail-section");
  }

  function scrollToSection(id) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function updateInviteField(event) {
    const { name, value } = event.target;
    setInviteForm((current) => ({ ...current, [name]: value }));
    setInviteMessage("");
  }

  async function handleCreateInvite(event) {
    event.preventDefault();
    setInviteMessage("");
    setInviteLink("");
    setInviteEmailSent(null);
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) {
      router.replace("/login");
      return;
    }

    setIsCreating(true);
    try {
      const payload = {
        full_name: inviteForm.full_name.trim(),
        email: inviteForm.email.trim(),
        job_title: inviteForm.job_title.trim(),
        department: inviteForm.department.trim(),
        expires_in_days: Number(inviteForm.expires_in_days) || 7,
      };
      if (inviteForm.office_location.trim()) payload.office_location = inviteForm.office_location.trim();
      if (inviteForm.start_date) payload.start_date = inviteForm.start_date;

      const data = await createInvitation(payload, accessToken);
      setInviteMessage(data.message);
      setInviteLink(data.invitation.invite_link);
      setInviteEmailSent(Boolean(data.email_sent));
      setInviteForm(initialInvite);
      loadDashboard();
    } catch (error) {
      setInviteMessage(getApiErrorMessage(error, "Could not create invitation."));
    } finally {
      setIsCreating(false);
    }
  }

  async function copyLink() {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setInviteMessage("Invitation link copied.");
  }

  function updateAnnouncementField(event) {
    const { name, value } = event.target;
    setAnnouncementForm((current) => ({ ...current, [name]: value }));
    setAnnouncementMessage("");
  }

  async function handlePublishAnnouncement(event) {
    event.preventDefault();
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    setIsPublishing(true);
    setAnnouncementMessage("");
    try {
      const data = await createAnnouncement(
        { title: announcementForm.title.trim(), body: announcementForm.body.trim() },
        accessToken
      );
      setAnnouncementMessage(data.message);
      setAnnouncementForm({ title: "", body: "" });
      setAnnouncements((current) => [data.announcement, ...current]);
    } catch (error) {
      setAnnouncementMessage(getApiErrorMessage(error, "Could not publish the announcement."));
    } finally {
      setIsPublishing(false);
    }
  }

  async function handleConvertCandidate(candidateId) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    setConvertingId(candidateId);
    setConversionMessage("");
    try {
      const data = await createEmployeeFromCandidate(candidateId, accessToken);
      setConversionMessage(
        `${data.message} Employee ID: ${data.employee?.employee_id}${
          data.email_sent ? " · Welcome email sent." : " · Welcome email could not be sent."
        }`
      );
      await loadDashboard();
    } catch (error) {
      setConversionMessage(getApiErrorMessage(error, "Could not convert candidate."));
    } finally {
      setConvertingId(null);
    }
  }

  if (!user) {
    return <p style={{ textAlign: "center", marginTop: "2rem" }}>Loading…</p>;
  }

  const canInvite = user.role === "recruiter" || user.role === "super_admin";

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Recruiter dashboard</p>
          <h1>Welcome, {user.full_name}</h1>
          <p>Signed in as {user.email} · Role: {user.role}</p>
          <ModuleNav role={user.role} />
        </div>
        <button onClick={handleLogout} className="primary-button" type="button">
          Log out
        </button>
      </header>

      {/* US-013: KPI overview + US-017: global search + US-015: quick actions */}
      <section className="dashboard-card wide" aria-labelledby="overview-heading">
        <h2 id="overview-heading">Onboarding overview</h2>
        <p>A snapshot of hiring activity across your candidates and employees. Refreshes automatically every minute.</p>

        {dashboardError && <p className="form-message" role="alert">{dashboardError}</p>}

        <div className="kpi-grid">
          <KpiCard label="Active employees" value={summary?.kpis?.active_employees} loading={dashboardLoading} />
          <KpiCard label="Pending onboarding" value={summary?.kpis?.pending_onboarding} loading={dashboardLoading} />
          <KpiCard label="Documents pending" value={summary?.kpis?.documents_pending} loading={dashboardLoading} />
          <KpiCard label="Upcoming joinings" value={summary?.kpis?.upcoming_joinings} loading={dashboardLoading} />
        </div>

        <div className="search-bar">
          <label className="field">
            <span>Search employees &amp; candidates</span>
            <input
              type="text"
              placeholder="Search by name, email, employee ID, department, or phone…"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            />
          </label>
          {searchOpen && searchQuery.trim().length >= 2 && (
            <div className="search-results">
              {searching && <p className="empty-state">Searching…</p>}
              {!searching && searchResults.length === 0 && (
                <p className="empty-state">No matches for &ldquo;{searchQuery.trim()}&rdquo;.</p>
              )}
              {!searching &&
                searchResults.map((result) => (
                  <button
                    type="button"
                    className="search-result-item"
                    key={`${result.type}-${result.id}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handleSearchSelect(result)}
                    style={{ width: "100%", textAlign: "left", cursor: "pointer", background: "transparent", border: 0 }}
                  >
                    <div>
                      <strong>{result.full_name}</strong>
                      <div className="muted-text">
                        {result.email} · {result.job_title || "—"} · {result.department || "—"}
                      </div>
                    </div>
                    <span className="type-pill">{result.type}</span>
                  </button>
                ))}
            </div>
          )}
        </div>

        {selectedPerson && (
          <section id="search-detail-section" className="invite-link-box" style={{ marginTop: 16 }} aria-live="polite">
            <div>
              <strong>{selectedPerson.full_name}</strong>
              <div className="muted-text">
                {selectedPerson.type} · {selectedPerson.email} · {selectedPerson.job_title || "—"} ·{" "}
                {selectedPerson.department || "—"} · status: {selectedPerson.status || "—"}
              </div>
            </div>
            <button type="button" className="secondary-button" onClick={() => setSelectedPerson(null)}>
              Clear
            </button>
          </section>
        )}

        <div className="section-heading-row" style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: "1rem" }}>Quick actions</h2>
        </div>
        <div className="quick-actions-grid">
          <button type="button" className="quick-action" onClick={() => scrollToSection("invite-section")}>
            <span className="qa-icon" aria-hidden="true">+</span>
            <strong>Add employee</strong>
            <span className="qa-hint">Email an onboarding invitation</span>
          </button>
          <button type="button" className="quick-action" onClick={() => scrollToSection("approvals-section")}>
            <span className="qa-icon" aria-hidden="true">✓</span>
            <strong>Pending approvals</strong>
            <span className="qa-hint">{summary?.pending_approvals?.length || 0} awaiting review</span>
          </button>
          <button type="button" className="quick-action" onClick={() => scrollToSection("conversion-section")}>
            <span className="qa-icon" aria-hidden="true">→</span>
            <strong>Convert to employee</strong>
            <span className="qa-hint">{readyCandidates.length} ready at 100%</span>
          </button>
          <button type="button" className="quick-action" onClick={() => scrollToSection("employees-section")}>
            <span className="qa-icon" aria-hidden="true">ID</span>
            <strong>Employee directory</strong>
            <span className="qa-hint">{employees.length} active employees</span>
          </button>
          <QuickActionComingSoon icon="Doc" label="View documents" hint="Embedded in conversion review" />
          <QuickActionComingSoon icon="Learn" label="Learning assignments" hint="Coming in Phase 3" />
        </div>
      </section>

      <div className="dashboard-columns">
        <div className="dashboard-stack">
          {/* Pending approvals (recently submitted onboarding) */}
          <section className="dashboard-card wide" id="approvals-section" aria-labelledby="approvals-heading">
            <div className="section-heading-row">
              <h2 id="approvals-heading">Pending approvals</h2>
            </div>
            <p style={{ marginTop: -8 }}>Candidates who submitted onboarding in the last 7 days.</p>
            {dashboardLoading ? (
              <p className="empty-state">Loading…</p>
            ) : summary?.pending_approvals?.length ? (
              <ul className="mini-list">
                {summary.pending_approvals.map((item) => (
                  <li key={item.email}>
                    <div>
                      <strong>{item.full_name}</strong>
                      <div className="muted-text">{item.job_title} · {item.department}</div>
                    </div>
                    <span className="muted-text">{formatDate(item.submitted_at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">Nothing pending review right now.</p>
            )}
          </section>

          {/* US-023: Convert candidates with 100% onboarding */}
          <section className="dashboard-card wide" id="conversion-section" aria-labelledby="conversion-heading">
            <div className="section-heading-row">
              <h2 id="conversion-heading">Ready for conversion (100%)</h2>
            </div>
            <p style={{ marginTop: -8 }}>
              Candidates who completed personal details, documents, references, NDA, contract, and resume.
              Convert only once — this generates an Employee ID and sends congratulations email.
            </p>
            {conversionMessage && <p className="form-message" role="status">{conversionMessage}</p>}
            {dashboardLoading ? (
              <p className="empty-state">Loading…</p>
            ) : readyCandidates.length ? (
              <ul className="mini-list">
                {readyCandidates.map((candidate) => (
                  <li key={candidate.id} style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, width: "100%", flexWrap: "wrap" }}>
                      <div>
                        <strong>{candidate.full_name}</strong>
                        <div className="muted-text">
                          {candidate.email} · {candidate.job_title} · {candidate.department} ·{" "}
                          {candidate.progress_percentage}%
                        </div>
                        <div className="muted-text">Submitted {formatDate(candidate.submitted_at)}</div>
                      </div>
                      <div className="dashboard-actions">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() =>
                            setExpandedCandidateId((current) => (current === candidate.id ? null : candidate.id))
                          }
                        >
                          {expandedCandidateId === candidate.id ? "Hide details" : "Review details"}
                        </button>
                        <button
                          type="button"
                          className="primary-button"
                          disabled={convertingId === candidate.id}
                          onClick={() => handleConvertCandidate(candidate.id)}
                        >
                          {convertingId === candidate.id ? "Converting…" : "Convert to employee"}
                        </button>
                      </div>
                    </div>
                    {expandedCandidateId === candidate.id && (
                      <div className="review-block" style={{ width: "100%" }}>
                        <h3>Onboarding package</h3>
                        <dl>
                          <div>
                            <dt>NDA</dt>
                            <dd>{candidate.onboarding?.nda?.full_legal_name || "—"}</dd>
                          </div>
                          <div>
                            <dt>Contract</dt>
                            <dd>{candidate.onboarding?.contract?.full_legal_name || "—"}</dd>
                          </div>
                          <div>
                            <dt>Education entries</dt>
                            <dd>{candidate.onboarding?.education?.entries?.length || 0}</dd>
                          </div>
                          <div>
                            <dt>Government docs</dt>
                            <dd>{candidate.onboarding?.government_docs?.documents?.length || 0}</dd>
                          </div>
                          <div>
                            <dt>References</dt>
                            <dd>{candidate.onboarding?.references?.references?.length || 0}</dd>
                          </div>
                          <div>
                            <dt>Resume</dt>
                            <dd>{candidate.onboarding?.resume?.file_name || "—"}</dd>
                          </div>
                        </dl>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">No candidates have completed 100% onboarding yet.</p>
            )}
          </section>

          {/* US-024: Employee directory with IDs */}
          <section className="dashboard-card wide" id="employees-section" aria-labelledby="employees-heading">
            <h2 id="employees-heading">Employee directory</h2>
            <p style={{ marginTop: -8 }}>Converted employees with unique Employee IDs (format MZK-YYYY-000123).</p>
            {dashboardLoading ? (
              <p className="empty-state">Loading…</p>
            ) : employees.length ? (
              <ul className="mini-list">
                {employees.map((employee) => (
                  <li key={employee.employee_id || employee.id}>
                    <div>
                      <strong>{employee.full_name}</strong>
                      <div className="muted-text">
                        {employee.employee_id} · {employee.email} · {employee.job_title} · {employee.department}
                      </div>
                    </div>
                    <span className="muted-text">{formatDate(employee.converted_at || employee.start_date)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">No employees converted yet.</p>
            )}
          </section>

          {/* US-016: Activity timeline */}
          <section className="dashboard-card wide" aria-labelledby="activity-heading">
            <h2 id="activity-heading">Recent activity</h2>
            {dashboardLoading ? (
              <p className="empty-state">Loading…</p>
            ) : activities.length ? (
              <ul className="activity-list">
                {activities.map((activity, index) => (
                  <li key={`${activity.action}-${activity.created_at}-${index}`}>
                    <span className="activity-dot" />
                    <div>
                      <div className="activity-label">{activity.label}</div>
                      <div className="activity-meta">
                        {activity.email} · {formatDateTime(activity.created_at)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">No activity yet.</p>
            )}
          </section>

          {/* Recently joined + upcoming joining dates */}
          <section className="dashboard-card wide" aria-labelledby="roster-heading">
            <h2 id="roster-heading">Roster snapshot</h2>
            <div className="dashboard-columns" style={{ marginTop: 0 }}>
              <div>
                <h3 style={{ fontSize: ".9rem" }}>Recently joined employees</h3>
                {summary?.recent_employees?.length ? (
                  <ul className="mini-list">
                    {summary.recent_employees.map((employee) => (
                      <li key={employee.email}>
                        <div>
                          <strong>{employee.full_name}</strong>
                          <div className="muted-text">{employee.job_title} · {employee.department}</div>
                        </div>
                        <span className="muted-text">{formatDate(employee.created_at)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="empty-state">No employees yet.</p>
                )}
              </div>
              <div>
                <h3 style={{ fontSize: ".9rem" }}>Upcoming joining dates</h3>
                {summary?.upcoming_joining_dates?.length ? (
                  <ul className="mini-list">
                    {summary.upcoming_joining_dates.map((item, index) => (
                      <li key={`${item.full_name}-${index}`}>
                        <div>
                          <strong>{item.full_name}</strong>
                          <div className="muted-text">{item.department}</div>
                        </div>
                        <span className="muted-text">{formatDate(item.start_date)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="empty-state">Nothing in the next 30 days.</p>
                )}
              </div>
            </div>
          </section>

          {canInvite ? (
            <section className="dashboard-card wide" id="invite-section" aria-labelledby="invite-heading">
              <h2 id="invite-heading">Invite candidate to register</h2>
              <p>
                After an offer is accepted, invite the candidate by email. They will receive a link, create an account,
                and verify with a 6-digit code before onboarding.
              </p>

              <form className="auth-form" onSubmit={handleCreateInvite}>
                <div className="form-grid">
                  <label className="field">
                    <span>Candidate full name</span>
                    <input name="full_name" value={inviteForm.full_name} onChange={updateInviteField} required />
                  </label>
                  <label className="field">
                    <span>Candidate email</span>
                    <input name="email" type="email" value={inviteForm.email} onChange={updateInviteField} required />
                  </label>
                  <label className="field">
                    <span>Job title</span>
                    <input name="job_title" value={inviteForm.job_title} onChange={updateInviteField} required />
                  </label>
                  <label className="field">
                    <span>Department</span>
                    <input name="department" value={inviteForm.department} onChange={updateInviteField} required />
                  </label>
                  <label className="field">
                    <span>Office location (optional)</span>
                    <input name="office_location" value={inviteForm.office_location} onChange={updateInviteField} />
                  </label>
                  <label className="field">
                    <span>Start date (optional)</span>
                    <input name="start_date" type="date" value={inviteForm.start_date} onChange={updateInviteField} />
                  </label>
                  <label className="field">
                    <span>Expires in days</span>
                    <input name="expires_in_days" type="number" min="1" max="30" value={inviteForm.expires_in_days} onChange={updateInviteField} />
                  </label>
                </div>

                {inviteMessage && <p className="form-message" role="status">{inviteMessage}</p>}
                {inviteEmailSent === true && (
                  <p className="form-message" role="status">Invitation email sent. You can still copy the link as a backup.</p>
                )}
                {inviteEmailSent === false && (
                  <p className="form-message" role="alert">Email delivery failed. Share the invitation link below manually.</p>
                )}
                {inviteLink && (
                  <div className="invite-link-box">
                    <code>{inviteLink}</code>
                    <button type="button" className="secondary-button" onClick={copyLink}>Copy link</button>
                  </div>
                )}

                <button className="primary-button" type="submit" disabled={isCreating}>
                  {isCreating ? "Sending invitation…" : "Send invitation"}
                </button>
              </form>
            </section>
          ) : null}

          {/* US-020: announcements management */}
          <section className="dashboard-card wide" id="announcements-section" aria-labelledby="announcements-manage-heading">
            <h2 id="announcements-manage-heading">Announcements</h2>
            <p>Publish onboarding updates and company news visible to all candidates on their dashboard.</p>

            <form className="auth-form" onSubmit={handlePublishAnnouncement}>
              <label className="field">
                <span>Title</span>
                <input name="title" value={announcementForm.title} onChange={updateAnnouncementField} required />
              </label>
              <label className="field">
                <span>Message</span>
                <textarea
                  name="body"
                  rows={4}
                  value={announcementForm.body}
                  onChange={updateAnnouncementField}
                  required
                  style={{ width: "100%", border: "1px solid #bed0dc", borderRadius: 8, padding: "13px 14px", fontFamily: "inherit", fontSize: "1rem", resize: "vertical" }}
                />
              </label>
              {announcementMessage && <p className="form-message" role="status">{announcementMessage}</p>}
              <button className="primary-button" type="submit" disabled={isPublishing}>
                {isPublishing ? "Publishing…" : "Publish announcement"}
              </button>
            </form>

            <div className="announcement-stack" style={{ marginTop: 22 }}>
              {announcements.length ? (
                announcements.map((announcement) => (
                  <article className="announcement-card" key={announcement.id}>
                    <h4>{announcement.title}</h4>
                    <p>{announcement.body}</p>
                    <p className="announcement-meta">
                      {announcement.created_by_name || user.full_name} · {formatDate(announcement.created_at)}
                    </p>
                  </article>
                ))
              ) : (
                <p className="empty-state">No announcements published yet.</p>
              )}
            </div>
          </section>
        </div>

        {/* US-014: Notifications panel */}
        <section className="dashboard-card" aria-labelledby="notifications-heading">
          <div className="section-heading-row">
            <h2 id="notifications-heading" style={{ fontSize: "1.1rem" }}>
              Notifications
              {unreadCount > 0 && <span className="badge-count">{unreadCount}</span>}
            </h2>
            <button type="button" className="link-button" onClick={handleMarkAllRead} disabled={notifBusy || unreadCount === 0}>
              Mark all read
            </button>
          </div>
          <div className="notif-panel">
            {dashboardLoading ? (
              <p className="empty-state">Loading…</p>
            ) : notifications.length ? (
              notifications.map((notification) => (
                <button
                  type="button"
                  key={notification.id}
                  className={`notif-item ${notification.read ? "read" : ""}`}
                  style={{ width: "100%", textAlign: "left", background: "transparent", border: 0, cursor: "pointer", padding: "12px 0" }}
                  onClick={() => handleNotificationClick(notification)}
                >
                  <span className="notif-dot" />
                  <span className="notif-body">
                    <span className="notif-title">{notification.title}</span>
                    <span className="notif-message">{notification.message}</span>
                    <span className="notif-time">{formatDateTime(notification.created_at)}</span>
                  </span>
                </button>
              ))
            ) : (
              <p className="empty-state">You&apos;re all caught up.</p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function KpiCard({ label, value, loading }) {
  return (
    <div className="kpi-card">
      <span className="kpi-value">{loading ? "—" : value ?? 0}</span>
      <span className="kpi-label">{label}</span>
    </div>
  );
}

function QuickActionComingSoon({ icon, label, hint }) {
  return (
    <div className="quick-action disabled" aria-disabled="true">
      <span className="qa-icon">{icon}</span>
      <strong>{label}</strong>
      <span className="qa-hint">{hint}</span>
    </div>
  );
}

function formatDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
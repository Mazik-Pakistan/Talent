"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import RequireAccess, { ModuleNav } from "@/components/RequireAccess";
import {
  approveOffer,
  clearLocalSession,
  createAnnouncement,
  createInvitation,
  getAnnouncements,
  getApiErrorMessage,
  getDashboardActivity,
  getDashboardSummary,
  getNotifications,
  getPendingReview,
  getReadyForConversion,
  globalSearch,
  listEmployees,
  logout,
  markNotificationsRead,
} from "@/services/authService";
import OfferComposerModal from "@/components/OfferComposerModal";
import RecruiterDocumentReview from "@/components/RecruiterDocumentReview";
import styles from "./recruiter-dashboard.module.css";

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

const ICONS = {
  overview: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  approvals: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" />
    </svg>
  ),
  offers: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
    </svg>
  ),
  activate: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9h6M7 13h10M7 17h4" />
    </svg>
  ),
  employees: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c1.2-3.5 3.8-5.5 6.5-5.5s5.3 2 6.5 5.5" />
      <circle cx="17.5" cy="8.5" r="2.5" /><path d="M15.5 14.3c2.3.4 4 2 5 5.7" />
    </svg>
  ),
  invite: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M19 8v6M22 11h-6" />
    </svg>
  ),
  announcements: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 11v3a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1z" /><path d="M15 8a4 4 0 0 1 0 8" /><path d="M18 5a8 8 0 0 1 0 14" />
    </svg>
  ),
  activity: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 12h4l2 8 4-16 2 8h6" />
    </svg>
  ),
};

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
  const [notifOpen, setNotifOpen] = useState(false);

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

  // ----- Offer letter cycle: pending review -> send offer -> signed -> approve -----
  const [pendingCandidates, setPendingCandidates] = useState([]);
  const [readyCandidates, setReadyCandidates] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [conversionMessage, setConversionMessage] = useState("");
  const [approvingOfferId, setApprovingOfferId] = useState(null);
  const [expandedCandidateId, setExpandedCandidateId] = useState(null);
  const [offerModalCandidate, setOfferModalCandidate] = useState(null);

  useEffect(() => {
    const storedUser = localStorage.getItem("user");
    setUser(JSON.parse(storedUser));
  }, []);

  const loadDashboard = useCallback(async () => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      const [summaryData, activityData, notificationsData, announcementsData, pendingData, readyData, employeesData] =
        await Promise.all([
          getDashboardSummary(accessToken),
          getDashboardActivity(accessToken, 15),
          getNotifications(accessToken, 20),
          getAnnouncements(accessToken, 10),
          getPendingReview(accessToken),
          getReadyForConversion(accessToken),
          listEmployees(accessToken),
        ]);
      setSummary(summaryData);
      setActivities(activityData.activities);
      setNotifications(notificationsData.notifications);
      setUnreadCount(notificationsData.unread_count);
      setAnnouncements(announcementsData.announcements);
      setPendingCandidates(pendingData.candidates || []);
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
    setNotifOpen(false);
    if (notification.link) {
      if (notification.link.includes("#")) {
        const hash = notification.link.split("#")[1];
        scrollToSection(hash);
      } else if (notification.type === "invitation_sent") {
        scrollToSection("invite-section");
      } else if (notification.type === "intake_submitted") {
        scrollToSection("pending-review-section");
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

  async function handleApproveOffer(offerId) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    setApprovingOfferId(offerId);
    setConversionMessage("");
    try {
      const data = await approveOffer(offerId, {}, accessToken);
      setConversionMessage(`${data.message} Employee ID: ${data.employee?.employee_id}.`);
      await loadDashboard();
    } catch (error) {
      setConversionMessage(getApiErrorMessage(error, "Could not approve this offer."));
    } finally {
      setApprovingOfferId(null);
    }
  }

  const canInvite = user?.role === "recruiter" || user?.role === "super_admin";

  const navItems = useMemo(() => {
    const items = [
      { key: "overview", label: "Overview", icon: ICONS.overview, anchor: "overview-section" },
      { key: "approvals", label: "Pending approvals", icon: ICONS.approvals, anchor: "approvals-section", count: summary?.pending_approvals?.length },
      { key: "offers", label: "Offer review", icon: ICONS.offers, anchor: "pending-review-section", count: pendingCandidates.length },
      { key: "activate", label: "Activate employees", icon: ICONS.activate, anchor: "conversion-section", count: readyCandidates.length },
      { key: "employees", label: "Employees", icon: ICONS.employees, anchor: "employees-section" },
      { key: "activity", label: "Activity", icon: ICONS.activity, anchor: "activity-section" },
    ];
    if (canInvite) items.push({ key: "invite", label: "Invite candidate", icon: ICONS.invite, anchor: "invite-section" });
    items.push({ key: "announcements", label: "Announcements", icon: ICONS.announcements, anchor: "announcements-section" });
    return items;
  }, [summary, pendingCandidates.length, readyCandidates.length, canInvite]);

  if (!user) {
    return <p style={{ textAlign: "center", marginTop: "2rem" }}>Loading…</p>;
  }

  const initials = initialsFor(user.full_name);

  return (
    <div className={styles.root}>
      <div className={styles.app}>
        {/* Sidebar */}
        <aside className={styles.sidebar}>
          <button type="button" className={styles.brand}>
            <div className={styles.brandMark}>MZ</div>
            <div className={styles.brandText}>
              <div className={styles.p1}>Talent</div>
              <div className={styles.p2}>Mazik Global Pakistan</div>
            </div>
          </button>

          <div className={styles.navSectionLabel}>Recruiting</div>
          <ul className={styles.nav} style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {navItems.map((item) => (
              <li key={item.key}>
                <button type="button" className={styles.navItem} onClick={() => scrollToSection(item.anchor)}>
                  {item.icon}
                  <span>{item.label}</span>
                  {!!item.count && <span className={styles.navCount}>{item.count}</span>}
                </button>
              </li>
            ))}
          </ul>

          <div className={styles.sidebarFooter}>
            <div className={styles.avatarSm}>{initials}</div>
            <div>
              <div className={styles.name}>{user.full_name}</div>
              <div className={styles.role}>{user.role.replace("_", " ")}</div>
            </div>
            <button type="button" className={styles.logoutBtn} title="Log out" onClick={handleLogout}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" />
              </svg>
            </button>
          </div>
        </aside>

        {/* Main */}
        <main className={styles.main}>
          <div className={styles.topbar}>
            <div>
              <div className={styles.topbarTitle}>Recruiter Dashboard</div>
              <div className={styles.topbarSub}>Hiring pipeline &amp; onboarding overview</div>
            </div>
            <div className={styles.topbarActions}>
              <div className={styles.searchWrap}>
                <div className={styles.searchBox}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search by name, email, ID, department…"
                    value={searchQuery}
                    onChange={(event) => { setSearchQuery(event.target.value); setSearchOpen(true); }}
                    onFocus={() => setSearchOpen(true)}
                    onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                  />
                </div>
                {searchOpen && searchQuery.trim().length >= 2 && (
                  <div className={styles.searchResults}>
                    {searching && <p className={styles.searchEmpty}>Searching…</p>}
                    {!searching && searchResults.length === 0 && (
                      <p className={styles.searchEmpty}>No matches for &ldquo;{searchQuery.trim()}&rdquo;.</p>
                    )}
                    {!searching &&
                      searchResults.map((result) => (
                        <button
                          type="button"
                          className={styles.searchResultItem}
                          key={`${result.type}-${result.id}`}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => handleSearchSelect(result)}
                        >
                          <div>
                            <div className={styles.searchResultLabel}>{result.full_name}</div>
                            <div className={styles.searchResultMeta}>
                              {result.email} · {result.job_title || "—"} · {result.department || "—"}
                            </div>
                          </div>
                          <span className={styles.typePill}>{result.type}</span>
                        </button>
                      ))}
                  </div>
                )}
              </div>

              <div className={styles.dropdownWrap}>
                <div className={styles.iconBtn} title="Notifications" role="button" tabIndex={0} onClick={() => setNotifOpen((v) => !v)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
                  </svg>
                  {unreadCount > 0 && <span className={styles.dot} />}
                </div>
                {notifOpen && (
                  <div className={styles.notifDropdown}>
                    <div className={styles.notifDropdownHead}>
                      <strong>Notifications{unreadCount > 0 ? ` (${unreadCount})` : ""}</strong>
                      <button type="button" className={styles.linkButton} onClick={handleMarkAllRead} disabled={notifBusy || unreadCount === 0}>
                        Mark all read
                      </button>
                    </div>
                    <div className={styles.notifList}>
                      {dashboardLoading ? (
                        <p className={styles.notifEmpty}>Loading…</p>
                      ) : notifications.length ? (
                        notifications.map((notification) => (
                          <button
                            type="button"
                            key={notification.id}
                            className={`${styles.notifItem} ${notification.read ? styles.read : ""}`}
                            onClick={() => handleNotificationClick(notification)}
                          >
                            <span className={styles.notifItemDot} />
                            <span className={styles.notifItemBody}>
                              <span className={styles.notifItemTitle}>{notification.title}</span>
                              <span className={styles.notifItemMessage}>{notification.message}</span>
                              <span className={styles.notifItemTime}>{formatDateTime(notification.created_at)}</span>
                            </span>
                          </button>
                        ))
                      ) : (
                        <p className={styles.notifEmpty}>You&apos;re all caught up.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className={styles.content}>
            {dashboardError && <div className={styles.loadError} role="alert">{dashboardError}</div>}

            {/* Hero */}
            <div className={styles.hero} id="overview-section">
              <div className={styles.heroEyebrow}>Recruiter dashboard</div>
              <h1>Welcome, {user.full_name}</h1>
              <div className={styles.heroMeta}>
                Signed in as <b>{user.email}</b> · Role: <b>{user.role.replace("_", " ")}</b>
              </div>
              <div style={{ marginTop: 14 }}>
                <ModuleNav role={user.role} />
              </div>
            </div>

            {/* KPI overview */}
            <div className={styles.stats}>
              <StatCard styles={styles} tone="green" value={dashboardLoading ? "—" : summary?.kpis?.active_employees ?? 0} label="Active employees" icon={ICONS.employees} />
              <StatCard styles={styles} tone="orange" value={dashboardLoading ? "—" : summary?.kpis?.pending_onboarding ?? 0} label="Pending onboarding" icon={ICONS.approvals} />
              <StatCard styles={styles} tone="cyan" value={dashboardLoading ? "—" : summary?.kpis?.documents_pending ?? 0} label="Documents pending" icon={ICONS.offers} />
              <StatCard styles={styles} tone="navy" value={dashboardLoading ? "—" : summary?.kpis?.upcoming_joinings ?? 0} label="Upcoming joinings" icon={ICONS.activate} />
            </div>

            {selectedPerson && (
              <div id="search-detail-section" className={styles.inviteLinkBox} style={{ marginBottom: 24 }}>
                <div>
                  <strong style={{ color: "var(--navy)" }}>{selectedPerson.full_name}</strong>
                  <div className={styles.mutedText}>
                    {selectedPerson.type} · {selectedPerson.email} · {selectedPerson.job_title || "—"} ·{" "}
                    {selectedPerson.department || "—"} · status: {selectedPerson.status || "—"}
                  </div>
                </div>
                <button type="button" className={styles.secondaryButton} onClick={() => setSelectedPerson(null)}>
                  Clear
                </button>
              </div>
            )}

            {/* Quick actions */}
            <div className={styles.quickGrid}>
              <button type="button" className={styles.quickAction} onClick={() => scrollToSection("invite-section")}>
                <span className={styles.qaIcon} aria-hidden="true">+</span>
                <strong>Add employee</strong>
                <span className={styles.qaHint}>Email an onboarding invitation</span>
              </button>
              <button type="button" className={styles.quickAction} onClick={() => scrollToSection("approvals-section")}>
                <span className={styles.qaIcon} aria-hidden="true">✓</span>
                <strong>Pending approvals</strong>
                <span className={styles.qaHint}>{summary?.pending_approvals?.length || 0} awaiting review</span>
              </button>
              <button type="button" className={styles.quickAction} onClick={() => scrollToSection("pending-review-section")}>
                <span className={styles.qaIcon} aria-hidden="true">→</span>
                <strong>Review &amp; send offers</strong>
                <span className={styles.qaHint}>{pendingCandidates.length} awaiting offer</span>
              </button>
              <button type="button" className={styles.quickAction} onClick={() => scrollToSection("conversion-section")}>
                <span className={styles.qaIcon} aria-hidden="true">ID</span>
                <strong>Activate employees</strong>
                <span className={styles.qaHint}>{readyCandidates.length} offer signed</span>
              </button>
              <button type="button" className={styles.quickAction} onClick={() => scrollToSection("employees-section")}>
                <span className={styles.qaIcon} aria-hidden="true">ID</span>
                <strong>Employee directory</strong>
                <span className={styles.qaHint}>{employees.length} active employees</span>
              </button>
              <div className={`${styles.quickAction} ${styles.disabled}`} aria-disabled="true">
                <span className={styles.qaIcon}>Lrn</span>
                <strong>Learning assignments</strong>
                <span className={styles.qaHint}>Coming in Phase 3</span>
              </div>
            </div>

            <div className={styles.cols2}>
              <div className={styles.dashboardStack}>
                {/* Pending approvals */}
                <div className={styles.section} id="approvals-section">
                  <div className={styles.sectionHead}>
                    <div className={styles.sectionHeadLeft}>
                      <div className={`${styles.bar} ${styles.orange}`} />
                      <div>
                        <div className={styles.sectionTitle}>Pending approvals</div>
                        <div className={styles.sectionDesc}>Candidates who submitted onboarding in the last 7 days.</div>
                      </div>
                    </div>
                  </div>
                  <div className={styles.sectionBody}>
                    {dashboardLoading ? (
                      <p className={styles.emptySub}>Loading…</p>
                    ) : summary?.pending_approvals?.length ? (
                      <ul className={styles.miniList}>
                        {summary.pending_approvals.map((item) => (
                          <li className={styles.miniListItem} key={item.email}>
                            <div>
                              <strong>{item.full_name}</strong>
                              <div className={styles.mutedText}>{item.job_title} · {item.department}</div>
                            </div>
                            <span className={styles.mutedText}>{formatDate(item.submitted_at)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className={styles.emptySub}>Nothing pending review right now.</p>
                    )}
                  </div>
                </div>

                {/* Pending offer review */}
                <div className={styles.section} id="pending-review-section">
                  <div className={styles.sectionHead}>
                    <div className={styles.sectionHeadLeft}>
                      <div className={`${styles.bar} ${styles.cyan}`} />
                      <div>
                        <div className={styles.sectionTitle}>Pending offer review</div>
                        <div className={styles.sectionDesc}>
                          Review documents (OCR-assisted) and send an offer letter.
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className={styles.sectionBody}>
                    {conversionMessage && <p className={styles.formMessage} role="status">{conversionMessage}</p>}
                    {dashboardLoading ? (
                      <p className={styles.emptySub}>Loading…</p>
                    ) : pendingCandidates.length ? (
                      <div>
                        {pendingCandidates.map((candidate) => (
                          <div key={candidate.id} className={styles.candidateCard}>
                            <div className={styles.candidateHead}>
                              <div>
                                <h4>{candidate.full_name}</h4>
                                <span>
                                  {candidate.email} · {candidate.job_title} · {candidate.department} · Submitted{" "}
                                  {formatDate(candidate.submitted_at)}
                                </span>
                              </div>
                              <div className={styles.rowActions}>
                                <button
                                  type="button"
                                  className={styles.secondaryButton}
                                  onClick={() =>
                                    setExpandedCandidateId((current) => (current === candidate.id ? null : candidate.id))
                                  }
                                >
                                  {expandedCandidateId === candidate.id ? "Hide documents" : "Review documents"}
                                </button>
                                <button type="button" className={styles.primaryButton} onClick={() => setOfferModalCandidate(candidate)}>
                                  Send offer letter
                                </button>
                              </div>
                            </div>
                            {expandedCandidateId === candidate.id && (
                              <div style={{ marginTop: 14 }}>
                                <RecruiterDocumentReview ownerId={candidate.id} />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className={styles.emptySub}>No candidates awaiting an offer right now.</p>
                    )}
                  </div>
                </div>

                {/* Ready to activate */}
                <div className={styles.section} id="conversion-section">
                  <div className={styles.sectionHead}>
                    <div className={styles.sectionHeadLeft}>
                      <div className={`${styles.bar} ${styles.green}`} />
                      <div>
                        <div className={styles.sectionTitle}>Ready to activate (offer signed)</div>
                        <div className={styles.sectionDesc}>
                          Approve to generate an Employee ID and activate the account.
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className={styles.sectionBody}>
                    {dashboardLoading ? (
                      <p className={styles.emptySub}>Loading…</p>
                    ) : readyCandidates.length ? (
                      <ul className={styles.miniList}>
                        {readyCandidates.map((candidate) => (
                          <li className={styles.miniListItem} key={candidate.offer_id}>
                            <div>
                              <strong>{candidate.full_name}</strong>
                              <div className={styles.mutedText}>
                                {candidate.email} · {candidate.job_title} · {candidate.department}
                                {candidate.reporting_manager ? ` · reports to ${candidate.reporting_manager}` : ""}
                              </div>
                              <div className={styles.mutedText}>Signed {formatDate(candidate.signed_at)}</div>
                            </div>
                            <button
                              type="button"
                              className={styles.primaryButton}
                              disabled={approvingOfferId === candidate.offer_id}
                              onClick={() => handleApproveOffer(candidate.offer_id)}
                            >
                              {approvingOfferId === candidate.offer_id ? "Activating…" : "Approve & activate"}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className={styles.emptySub}>No signed offers awaiting approval right now.</p>
                    )}
                  </div>
                </div>

                {offerModalCandidate && (
                  <OfferComposerModal
                    candidate={offerModalCandidate}
                    onClose={() => setOfferModalCandidate(null)}
                    onSent={(data) => {
                      setConversionMessage(data.message);
                      setOfferModalCandidate(null);
                      loadDashboard();
                    }}
                  />
                )}

                {/* Employee directory */}
                <div className={styles.section} id="employees-section">
                  <div className={styles.sectionHead}>
                    <div className={styles.sectionHeadLeft}>
                      <div className={`${styles.bar} ${styles.navy}`} />
                      <div>
                        <div className={styles.sectionTitle}>Employee directory</div>
                        <div className={styles.sectionDesc}>Converted employees with unique Employee IDs (format MZK-YYYY-000123).</div>
                      </div>
                    </div>
                  </div>
                  <div className={styles.sectionBody}>
                    {dashboardLoading ? (
                      <p className={styles.emptySub}>Loading…</p>
                    ) : employees.length ? (
                      <ul className={styles.miniList}>
                        {employees.map((employee) => (
                          <li className={styles.miniListItem} key={employee.employee_id || employee.id}>
                            <div>
                              <strong>{employee.full_name}</strong>
                              <div className={styles.mutedText}>
                                {employee.employee_id} · {employee.email} · {employee.job_title} · {employee.department}
                              </div>
                            </div>
                            <span className={styles.mutedText}>{formatDate(employee.converted_at || employee.start_date)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className={styles.emptySub}>No employees converted yet.</p>
                    )}
                  </div>
                </div>

                {/* Recent activity */}
                <div className={styles.section} id="activity-section">
                  <div className={styles.sectionHead}>
                    <div className={styles.sectionHeadLeft}>
                      <div className={`${styles.bar} ${styles.purple}`} />
                      <div>
                        <div className={styles.sectionTitle}>Recent activity</div>
                        <div className={styles.sectionDesc}>Latest hiring &amp; onboarding events.</div>
                      </div>
                    </div>
                  </div>
                  <div className={styles.sectionBody}>
                    {dashboardLoading ? (
                      <p className={styles.emptySub}>Loading…</p>
                    ) : activities.length ? (
                      <ul className={styles.activityList}>
                        {activities.map((activity, index) => (
                          <li key={`${activity.action}-${activity.created_at}-${index}`}>
                            <span className={styles.activityDot} />
                            <div>
                              <div className={styles.activityLabel}>{activity.label}</div>
                              <div className={styles.activityMeta}>
                                {activity.email} · {formatDateTime(activity.created_at)}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className={styles.emptySub}>No activity yet.</p>
                    )}
                  </div>
                </div>

                {/* Roster snapshot */}
                <div className={styles.section} style={{ marginBottom: 0 }}>
                  <div className={styles.sectionHead}>
                    <div className={styles.sectionHeadLeft}>
                      <div className={`${styles.bar} ${styles.cyan}`} />
                      <div>
                        <div className={styles.sectionTitle}>Roster snapshot</div>
                        <div className={styles.sectionDesc}>Recently joined and upcoming joining dates.</div>
                      </div>
                    </div>
                  </div>
                  <div className={styles.sectionBody}>
                    <div className={styles.rosterGrid}>
                      <div>
                        <h3>Recently joined employees</h3>
                        {summary?.recent_employees?.length ? (
                          <ul className={styles.miniList}>
                            {summary.recent_employees.map((employee) => (
                              <li className={styles.miniListItem} key={employee.email}>
                                <div>
                                  <strong>{employee.full_name}</strong>
                                  <div className={styles.mutedText}>{employee.job_title} · {employee.department}</div>
                                </div>
                                <span className={styles.mutedText}>{formatDate(employee.created_at)}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className={styles.emptySub}>No employees yet.</p>
                        )}
                      </div>
                      <div>
                        <h3>Upcoming joining dates</h3>
                        {summary?.upcoming_joining_dates?.length ? (
                          <ul className={styles.miniList}>
                            {summary.upcoming_joining_dates.map((item, index) => (
                              <li className={styles.miniListItem} key={`${item.full_name}-${index}`}>
                                <div>
                                  <strong>{item.full_name}</strong>
                                  <div className={styles.mutedText}>{item.department}</div>
                                </div>
                                <span className={styles.mutedText}>{formatDate(item.start_date)}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className={styles.emptySub}>Nothing in the next 30 days.</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right column: invite + announcements */}
              <div className={styles.stickyCol}>
                {canInvite && (
                  <div className={styles.section} id="invite-section">
                    <div className={styles.sectionHead}>
                      <div className={styles.sectionHeadLeft}>
                        <div className={`${styles.bar} ${styles.orange}`} />
                        <div>
                          <div className={styles.sectionTitle}>Invite candidate</div>
                          <div className={styles.sectionDesc}>Email an onboarding invitation after an offer is accepted.</div>
                        </div>
                      </div>
                    </div>
                    <div className={styles.sectionBody}>
                      <form onSubmit={handleCreateInvite}>
                        <div className={styles.formGrid}>
                          <label className={styles.field}>
                            <span>Candidate full name</span>
                            <input name="full_name" value={inviteForm.full_name} onChange={updateInviteField} required />
                          </label>
                          <label className={styles.field}>
                            <span>Candidate email</span>
                            <input name="email" type="email" value={inviteForm.email} onChange={updateInviteField} required />
                          </label>
                          <label className={styles.field}>
                            <span>Job title</span>
                            <input name="job_title" value={inviteForm.job_title} onChange={updateInviteField} required />
                          </label>
                          <label className={styles.field}>
                            <span>Department</span>
                            <input name="department" value={inviteForm.department} onChange={updateInviteField} required />
                          </label>
                          <label className={styles.field}>
                            <span>Office location (optional)</span>
                            <input name="office_location" value={inviteForm.office_location} onChange={updateInviteField} />
                          </label>
                          <label className={styles.field}>
                            <span>Start date (optional)</span>
                            <input name="start_date" type="date" value={inviteForm.start_date} onChange={updateInviteField} />
                          </label>
                          <label className={styles.field}>
                            <span>Expires in days</span>
                            <input name="expires_in_days" type="number" min="1" max="30" value={inviteForm.expires_in_days} onChange={updateInviteField} />
                          </label>
                        </div>

                        {inviteMessage && <p className={styles.formMessage} role="status">{inviteMessage}</p>}
                        {inviteEmailSent === true && (
                          <p className={styles.formMessage} role="status">Invitation email sent. You can still copy the link as a backup.</p>
                        )}
                        {inviteEmailSent === false && (
                          <p className={styles.formMessage} role="alert">Email delivery failed. Share the invitation link below manually.</p>
                        )}
                        {inviteLink && (
                          <div className={styles.inviteLinkBox}>
                            <code>{inviteLink}</code>
                            <button type="button" className={styles.secondaryButton} onClick={copyLink}>Copy link</button>
                          </div>
                        )}

                        <button className={styles.primaryButton} type="submit" disabled={isCreating}>
                          {isCreating ? "Sending invitation…" : "Send invitation"}
                        </button>
                      </form>
                    </div>
                  </div>
                )}

                {/* Announcements */}
                <div className={styles.section} id="announcements-section" style={{ marginBottom: 0 }}>
                  <div className={styles.sectionHead}>
                    <div className={styles.sectionHeadLeft}>
                      <div className={`${styles.bar} ${styles.green}`} />
                      <div>
                        <div className={styles.sectionTitle}>Announcements</div>
                        <div className={styles.sectionDesc}>Publish updates visible to all candidates.</div>
                      </div>
                    </div>
                  </div>
                  <div className={styles.sectionBody}>
                    <form onSubmit={handlePublishAnnouncement}>
                      <label className={styles.field} style={{ marginBottom: 12 }}>
                        <span>Title</span>
                        <input name="title" value={announcementForm.title} onChange={updateAnnouncementField} required />
                      </label>
                      <label className={styles.field}>
                        <span>Message</span>
                        <textarea
                          name="body"
                          rows={4}
                          value={announcementForm.body}
                          onChange={updateAnnouncementField}
                          required
                          className={styles.textarea}
                        />
                      </label>
                      {announcementMessage && <p className={styles.formMessage} role="status">{announcementMessage}</p>}
                      <button className={styles.primaryButton} type="submit" disabled={isPublishing}>
                        {isPublishing ? "Publishing…" : "Publish announcement"}
                      </button>
                    </form>

                    <div className={styles.announcementStack} style={{ marginTop: 20 }}>
                      {announcements.length ? (
                        announcements.map((announcement) => (
                          <article className={styles.announcementCard} key={announcement.id}>
                            <h4>{announcement.title}</h4>
                            <p>{announcement.body}</p>
                            <p className={styles.announcementMeta}>
                              {announcement.created_by_name || user.full_name} · {formatDate(announcement.created_at)}
                            </p>
                          </article>
                        ))
                      ) : (
                        <p className={styles.emptySub}>No announcements published yet.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className={styles.footerNote}>Talent by Mazik Global Pakistan · Recruiter Dashboard</div>
          </div>
        </main>
      </div>
    </div>
  );
}

function StatCard({ icon, tone, value, label, styles }) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statTop}>
        <div className={`${styles.statIcon} ${styles[tone]}`}>{icon}</div>
      </div>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
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

function initialsFor(name) {
  if (!name) return "RC";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "RC";
}
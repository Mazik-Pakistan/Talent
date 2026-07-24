"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "react-toastify";

import RequireAccess from "@/components/RequireAccess";
import ProfileAvatar from "@/components/ProfileAvatar";
import {
  clearLocalSession,
  getAnnouncements,
  getApiErrorMessage,
  getMyEmployeeProfile,
  getNotifications,
  getProfileCompletion,
  listMyDocuments,
  logout,
  markNotificationsRead,
  patchLocalUser,
} from "@/services/authService";
import { moduleAccess } from "@/services/rbac";
import { getEmployeeNavItems } from "@/utils/employeeNav";
import styles from "./employee-dashboard.module.css";

const ANNOUNCEMENTS_POLL_MS = 30000;
const NOTIFICATIONS_POLL_MS = 20000;

export default function EmployeeDashboardPage() {
  return (
    <RequireAccess anyOf={["onboarding.self", "profile.view"]} roles={["employee"]}>
      <EmployeeDashboardContent />
    </RequireAccess>
  );
}

function EmployeeDashboardContent() {
  const router = useRouter();
  const pathname = usePathname();

  const [user, setUser] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [progress, setProgress] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);

  const [docCount, setDocCount] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [announcements, setAnnouncements] = useState([]);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const lastUnreadRef = useRef(null);

  useEffect(() => {
    setUser(JSON.parse(localStorage.getItem("user")));
    const onUserUpdated = () => setUser(JSON.parse(localStorage.getItem("user")));
    window.addEventListener("talent-user-updated", onUserUpdated);
    return () => window.removeEventListener("talent-user-updated", onUserUpdated);
  }, []);

  const loadProfile = useCallback(async () => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      const [profileData, completionData] = await Promise.all([
        getMyEmployeeProfile(accessToken),
        getProfileCompletion(accessToken).catch(() => null),
      ]);
      setEmployee(profileData.employee);
      if (profileData.employee?.profile_picture !== undefined) {
        const nextUser = patchLocalUser({
          profile_picture: profileData.employee.profile_picture || null,
          full_name: profileData.employee.full_name,
        });
        if (nextUser) setUser(nextUser);
      }
      setProgress(completionData?.progress || null);
      setLoadError("");
    } catch (error) {
      setLoadError(getApiErrorMessage(error, "Could not load your employee profile."));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAnnouncements = useCallback(async () => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      const data = await getAnnouncements(accessToken, 20);
      setAnnouncements(data.announcements || []);
    } catch {
      // Non-critical polling failure
    }
  }, []);

  const refreshNotifications = useCallback(async (silent = true) => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      const data = await getNotifications(accessToken);
      const nextUnread = data.unread_count || 0;
      const nextList = data.notifications || [];
      if (
        silent &&
        lastUnreadRef.current != null &&
        nextUnread > lastUnreadRef.current &&
        nextList[0]
      ) {
        toast.info(nextList[0].title || "New notification");
      }
      lastUnreadRef.current = nextUnread;
      setNotifications(nextList);
      setUnreadNotifications(nextUnread);
    } catch {
      // Non-critical polling failure
    }
  }, []);

  const loadDocCount = useCallback(() => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    listMyDocuments(accessToken)
      .then((data) => setDocCount((data.documents || []).length))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadProfile();
    loadDocCount();
  }, [loadProfile, loadDocCount]);

  useEffect(() => {
    loadAnnouncements();
    const timer = setInterval(loadAnnouncements, ANNOUNCEMENTS_POLL_MS);
    return () => clearInterval(timer);
  }, [loadAnnouncements]);

  useEffect(() => {
    refreshNotifications(false);
    const timer = setInterval(() => refreshNotifications(true), NOTIFICATIONS_POLL_MS);
    return () => clearInterval(timer);
  }, [refreshNotifications]);

  async function handleLogout() {
    const accessToken = localStorage.getItem("access_token");
    await logout(accessToken);
    clearLocalSession();
    router.replace("/login");
  }

  async function handleNotification(notification) {
    const accessToken = localStorage.getItem("access_token");
    if (accessToken && !notification.read) {
      try {
        await markNotificationsRead({ ids: [notification.id], all: false }, accessToken);
        setNotifications((current) =>
          current.map((item) => (item.id === notification.id ? { ...item, read: true } : item))
        );
        setUnreadNotifications((current) => Math.max(0, current - 1));
      } catch {
        // Navigation remains available if read-state persistence is temporarily unavailable.
      }
    }
    setNotifOpen(false);
    if (notification.link) router.push(notification.link);
  }

  const modules = useMemo(() => moduleAccess(user?.role), [user?.role]);

  const onboarding = useMemo(() => employee?.onboarding || {}, [employee]);
  const profileIncomplete = employee?.profile_status === "incomplete";
  const profileComplete = employee?.profile_status === "complete";
  const percentage = progress?.percentage ?? (profileIncomplete ? 0 : 100);
  const navItems = useMemo(() => getEmployeeNavItems({ profileComplete }), [profileComplete]);
  const documentsSummary = onboarding?.government_docs?.documents?.length ?? null;
  const assignedAssets = employee?.assets || [];
  const orientation = employee?.orientation;

  // ----- Client-side "Search records" over the data already on this page -----
  const searchIndex = useMemo(() => {
    if (!employee) return [];
    const rows = [
      { label: "Employee ID", value: employee.employee_id, anchor: "profile-section" },
      { label: "Designation", value: employee.job_title, anchor: "profile-section" },
      { label: "Department", value: employee.department, anchor: "profile-section" },
      { label: "Reporting manager", value: employee.reporting_manager, anchor: "profile-section" },
      { label: "Office location", value: employee.office_location, anchor: "profile-section" },
      { label: "Joining date", value: formatDate(employee.start_date), anchor: "profile-section" },
      { label: "Personal", value: summarize(onboarding.personal), anchor: "onboarding-section" },
      { label: "Emergency contact", value: summarize(onboarding.emergency), anchor: "onboarding-section" },
      { label: "Payroll", value: summarize(onboarding.employment), anchor: "onboarding-section" },
      { label: "NDA", value: onboarding.nda?.full_legal_name || "Not on file", anchor: "onboarding-section" },
      { label: "Resume", value: onboarding.resume?.file_name || "Not on file", anchor: "onboarding-section" },
      ...announcements.map((a) => ({ label: "Announcement", value: a.title, anchor: "announcements-section" })),
    ];
    return rows.filter((row) => row.value);
  }, [employee, onboarding, announcements]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return searchIndex.filter(
      (row) => row.label.toLowerCase().includes(q) || String(row.value).toLowerCase().includes(q)
    ).slice(0, 8);
  }, [searchQuery, searchIndex]);

  function goToResult(anchor) {
    setSearchOpen(false);
    setSearchQuery("");
    document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (!user) {
    return <p style={{ textAlign: "center", marginTop: "2rem" }}>Loading…</p>;
  }

  const displayName = employee?.full_name || user.full_name;
  const photoUrl = employee?.profile_picture || user?.profile_picture || null;

  return (
    <div className={styles.root}>
      <div className={styles.app}>
        {/* Sidebar */}
        <aside className={`${styles.sidebar} ${sidebarCollapsed ? styles.collapsed : ""}`}>
          <button
            type="button"
            className={styles.brand}
            onClick={() => setSidebarCollapsed((v) => !v)}
            title="Click to collapse sidebar"
          >
            <div className={styles.brandMark}>MZ</div>
            <div className={styles.brandText}>
              <div className={styles.p1}>Talent</div>
              <div className={styles.p2}>Mazik Global Pakistan</div>
            </div>
          </button>

          <div className={styles.navSectionLabel}>Workspace</div>
          <ul className={styles.nav} style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {navItems.map((item) => {
              const enabled = item.module ? modules[item.module] : true;
              if (!enabled) return null;
              const isActive = item.href && (pathname === item.href || (item.href !== "/dashboard/employee" && pathname.startsWith(item.href)));
              const disabled = !item.href;
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    className={`${styles.navItem} ${isActive ? styles.active : ""} ${disabled ? styles.disabled : ""}`}
                    onClick={() => item.href && router.push(item.href)}
                    title={disabled ? `${item.label} — coming in Phase 3` : item.label}
                    disabled={disabled}
                  >
                    {item.icon}
                    <span className={styles.navLabel}>{item.label}</span>
                    {item.badge && <span className={styles.navBadge}>{item.badge}</span>}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className={styles.sidebarFooter}>
            <ProfileAvatar src={photoUrl} name={displayName} size="sm" fallback="EM" />
            <div className={styles.sidebarFooterText}>
              <div className={styles.name}>{displayName}</div>
              <div className={styles.role}>{employee?.job_title || "Employee"}</div>
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
              <div className={styles.topbarTitle}>Employee Dashboard</div>
              <div className={styles.topbarSub}>
                {employee?.employee_id || "—"} · {employee?.department || "—"}
              </div>
            </div>
            <div className={styles.topbarActions}>
              <div className={styles.searchWrap}>
                <div className={styles.searchBox}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
                  </svg>
                  <input
                    placeholder="Search records…"
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
                    onFocus={() => setSearchOpen(true)}
                    onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                  />
                </div>
                {searchOpen && searchQuery.trim().length >= 2 && (
                  <div className={styles.searchResults}>
                    {searchResults.length ? (
                      searchResults.map((row) => (
                        <div
                          key={row.label}
                          className={styles.searchResultItem}
                          role="button"
                          tabIndex={0}
                          onMouseDown={() => goToResult(row.anchor)}
                        >
                          <div className={styles.searchResultLabel}>{row.label}</div>
                          <div className={styles.searchResultMeta}>{String(row.value)}</div>
                        </div>
                      ))
                    ) : (
                      <div className={styles.searchEmpty}>No matches on this page.</div>
                    )}
                  </div>
                )}
              </div>

              <div className={styles.dropdownWrap}>
                <div
                  className={styles.iconBtn}
                  title="Notifications"
                  role="button"
                  tabIndex={0}
                  onClick={() => setNotifOpen((v) => !v)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
                  </svg>
                  {unreadNotifications > 0 && (
                    <span className={styles.badgeCount}>
                      {unreadNotifications > 99 ? "99+" : unreadNotifications}
                    </span>
                  )}
                </div>
                {notifOpen && (
                  <div className={styles.notifPanel}>
                    <div className={styles.notifHeading}>
                      <strong>Notifications</strong>
                      {unreadNotifications > 0 && <span>{unreadNotifications} unread</span>}
                    </div>
                    <div className={styles.notifList}>
                      {notifications.length ? (
                        notifications.slice(0, 8).map((notification) => (
                          <button
                            key={notification.id}
                            type="button"
                            className={`${styles.notifItem} ${!notification.read ? styles.unread : ""}`}
                            onClick={() => handleNotification(notification)}
                          >
                            <strong>{notification.title}</strong>
                            <span>{notification.message}</span>
                          </button>
                        ))
                      ) : (
                        <span>No notifications yet.</span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div
                className={styles.iconBtn}
                title="My profile"
                role="button"
                tabIndex={0}
                onClick={() => router.push("/dashboard/employee/profile")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" />
                </svg>
              </div>
            </div>
          </div>

          <div className={styles.content}>
            {loadError && <div className={styles.loadError} role="alert">{loadError}</div>}

            {!loading && profileIncomplete && (
              <div className={styles.banner}>
                <MiniRing percentage={percentage} />
                <div className={styles.bannerCopy}>
                  <h3>
                    {notifications.some((n) => n.type === "profile_completion_reminder" && !n.read)
                      ? "Your recruiter asked you to complete your profile"
                      : "Your profile is incomplete"}
                  </h3>
                  <p>
                    Add your emergency contact, banking details, references, sign the NDA, and acknowledge company
                    policies to unlock your full workspace.
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.btnPrimary}
                  onClick={() => router.push("/dashboard/employee/complete-profile")}
                >
                  Complete my profile
                </button>
              </div>
            )}

            {/* Hero */}
            <div className={styles.hero}>
              <div>
                <div className={styles.heroEyebrow}>Employee Dashboard</div>
                <h1>Welcome, {employee?.full_name || user.full_name}</h1>
                <div className={styles.heroMeta}>
                  Signed in as <b>{user.email}</b> · Role: <b>Employee</b>
                  {employee?.employee_id ? <> · ID <b>{employee.employee_id}</b></> : null}
                </div>
                <div className={styles.heroChips}>
                  {employee?.start_date && <span className={styles.chip}>Joined {formatDate(employee.start_date)}</span>}
                  {employee?.converted_at && <span className={styles.chip}>Converted {formatDate(employee.converted_at)}</span>}
                  {employee?.company_email && <span className={styles.chip}>{employee.company_email}</span>}
                  {orientation?.date && (
                    <span className={styles.chip}>
                      Orientation {formatDate(orientation.date)}{orientation.time ? ` · ${orientation.time}` : ""}
                    </span>
                  )}
                  {assignedAssets.length > 0 && (
                    <span className={styles.chip}>
                      {assignedAssets.length} asset{assignedAssets.length === 1 ? "" : "s"} assigned
                    </span>
                  )}
                  <span className={`${styles.chip} ${profileIncomplete ? styles.incomplete : styles.complete}`}>
                    {profileIncomplete ? "Profile incomplete" : "✓ Profile complete"}
                  </span>
                </div>
              </div>
              <div className={styles.ringWrap}>
                <HeroRing percentage={percentage} />
                <div className={styles.ringLabel}>Profile<br />completion</div>
              </div>
            </div>

            {/* Stats */}
            <div className={styles.stats}>
              <StatCard
                icon={<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />}
                iconExtra={<path d="M14 2v6h6" />}
                tone="cyan"
                value={docCount}
                label="Documents on file"
              />
              <StatCard
                icon={<><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></>}
                tone="green"
                value={profileIncomplete ? "Incomplete" : "Complete"}
                label="Onboarding status"
              />
              <StatCard
                icon={<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></>}
                tone="orange"
                value={tenureLabel(employee?.start_date)}
                label="Tenure since joining"
              />
              <StatCard
                icon={<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>}
                tone="navy"
                value="Phase 3"
                label="Learning modules unlock"
              />
            </div>

            {/* Employment profile */}
            <div className={styles.section} id="profile-section">
              <div className={styles.sectionHead}>
                <div className={styles.sectionHeadLeft}>
                  <div className={`${styles.bar} ${styles.navy}`} />
                  <div>
                    <div className={styles.sectionTitle}>Employment profile</div>
                    <div className={styles.sectionDesc}>Core employment record synced from HR onboarding.</div>
                  </div>
                </div>
              </div>
              <div className={styles.sectionBody}>
                {loading ? (
                  <p className={styles.emptySub}>Loading…</p>
                ) : (
                  <div className={styles.fieldGrid}>
                    <Field label="Employee ID" value={employee?.employee_id} styles={styles} />
                    <Field label="Designation" value={employee?.job_title} styles={styles} />
                    <Field label="Department" value={employee?.department} styles={styles} />
                    <Field label="Reporting manager" value={employee?.reporting_manager} styles={styles} />
                    <Field label="Office location" value={employee?.office_location} styles={styles} />
                    <Field label="Joining date" value={formatDate(employee?.start_date)} styles={styles} />
                    <Field label="Converted on" value={formatDate(employee?.converted_at)} styles={styles} />
                    <div>
                      <div className={styles.fieldLabel}>Profile status</div>
                      <span className={`${styles.statusPill} ${profileIncomplete ? styles.incomplete : ""}`}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                        {profileIncomplete ? "Incomplete" : "Complete"}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {(employee?.company_email || orientation || assignedAssets.length > 0) && (
              <div className={styles.section} id="workplace-section">
                <div className={styles.sectionHead}>
                  <div className={styles.sectionHeadLeft}>
                    <div className={`${styles.bar} ${styles.green}`} />
                    <div>
                      <div className={styles.sectionTitle}>Workplace setup</div>
                      <div className={styles.sectionDesc}>Company email, orientation, and assigned assets from HR.</div>
                    </div>
                  </div>
                </div>
                <div className={styles.sectionBody}>
                  <div className={styles.fieldGrid}>
                    {employee?.company_email && <Field label="Company email" value={employee.company_email} styles={styles} />}
                    {orientation && (
                      <>
                        <Field
                          label="Orientation date"
                          value={`${formatDate(orientation.date)}${orientation.time ? ` · ${orientation.time}` : ""}`}
                          styles={styles}
                        />
                        <Field label="Trainer" value={orientation.trainer} styles={styles} />
                        {orientation.meeting_link && <Field label="Meeting link" value={orientation.meeting_link} styles={styles} />}
                      </>
                    )}
                    {assignedAssets.length > 0 && (
                      <Field
                        label="Assigned assets"
                        value={assignedAssets.map((asset) => asset.name).filter(Boolean).join(", ")}
                        styles={styles}
                      />
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className={styles.section} id="announcements-section">
              <div className={styles.sectionHead}>
                <div className={styles.sectionHeadLeft}>
                  <div className={`${styles.bar} ${styles.green}`} />
                  <div>
                    <div className={styles.sectionTitle}>Announcements</div>
                    <div className={styles.sectionDesc}>Updates from the recruiting team.</div>
                  </div>
                </div>
              </div>
              <div className={styles.sectionBody}>
                <div className={styles.announcementStack}>
                  {announcements.length ? (
                    announcements.map((a) => (
                      <article className={styles.announcementCard} key={a.id}>
                        <h4>{a.title}</h4>
                        <p>{a.body}</p>
                        <p className={styles.announcementMeta}>
                          {a.created_by_name || "Recruiting team"} · {formatDate(a.created_at)}
                        </p>
                      </article>
                    ))
                  ) : (
                    <p className={styles.emptySub}>No announcements yet.</p>
                  )}
                </div>
              </div>
            </div>

            <div className={styles.cols2}>
              <div className={styles.section} style={{ marginBottom: 0 }} id="documents-section">
                <div className={styles.sectionHead}>
                  <div className={styles.sectionHeadLeft}>
                    <div className={`${styles.bar} ${styles.orange}`} />
                    <div>
                      <div className={styles.sectionTitle}>My documents</div>
                      <div className={styles.sectionDesc}>Upload, organize, and download your files in the document centre.</div>
                    </div>
                  </div>
                </div>
                <div className={styles.sectionBody}>
                  <div className={styles.banner} style={{ margin: 0 }}>
                    <div className={styles.bannerCopy}>
                      <h3>Document centre</h3>
                      <p>
                        {docCount
                          ? `You have ${docCount} document${docCount === 1 ? "" : "s"} on file. Open the centre to upload, replace, or download them.`
                          : "Manage identity, education, and employment documents with category filters, search, and secure downloads."}
                      </p>
                    </div>
                    <button type="button" className={styles.btnPrimary} onClick={() => router.push("/documents")}>
                      Open documents
                    </button>
                  </div>
                </div>
              </div>

              <div className={styles.section} style={{ marginBottom: 0 }} id="onboarding-section">
                <div className={styles.sectionHead}>
                  <div className={styles.sectionHeadLeft}>
                    <div className={`${styles.bar} ${styles.cyan}`} />
                    <div>
                      <div className={styles.sectionTitle}>Onboarding record</div>
                      <div className={styles.sectionDesc}>Preserved from your onboarding submission.</div>
                    </div>
                  </div>
                </div>
                <div className={styles.sectionBody}>
                  <div className={styles.recordGrid}>
                    <RecordItem
                      styles={styles}
                      label="Personal"
                      value={summarize(onboarding.personal)}
                      icon={<><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" /></>}
                    />
                    <RecordItem
                      styles={styles}
                      label="Emergency contact"
                      value={summarize(onboarding.emergency)}
                      icon={<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />}
                    />
                    <RecordItem
                      styles={styles}
                      label="Payroll"
                      value={summarize(onboarding.employment)}
                      icon={<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>}
                    />
                    <RecordItem
                      styles={styles}
                      label="Education"
                      value={`${onboarding.education?.entries?.length || 0} entr${(onboarding.education?.entries?.length || 0) === 1 ? "y" : "ies"}`}
                      icon={<><path d="M22 10L12 5 2 10l10 5 10-5z" /><path d="M6 12v5c3 2 9 2 12 0v-5" /></>}
                    />
                    <RecordItem
                      styles={styles}
                      label="Government docs"
                      value={documentsSummary !== null ? `${documentsSummary} document(s)` : "Not on file"}
                      icon={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>}
                    />
                    <RecordItem
                      styles={styles}
                      label="References"
                      value={`${onboarding.references?.references?.length || 0} reference(s)`}
                      icon={<><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" /></>}
                    />
                    <RecordItem
                      styles={styles}
                      label="NDA"
                      value={onboarding.nda?.full_legal_name ? `Signed · ${onboarding.nda.full_legal_name}` : "Not on file"}
                      icon={<><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></>}
                    />
                    <RecordItem
                      styles={styles}
                      label="Resume"
                      value={onboarding.resume?.file_name || "Not on file"}
                      icon={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Workplace modules */}
            <div className={styles.section} style={{ marginTop: 24, marginBottom: 0 }}>
              <div className={styles.sectionHead}>
                <div className={styles.sectionHeadLeft}>
                  <div className={`${styles.bar} ${styles.green}`} />
                  <div>
                    <div className={styles.sectionTitle}>Workplace modules</div>
                    <div className={styles.sectionDesc}>Learning &amp; AI coaching unlock after onboarding.</div>
                  </div>
                </div>
              </div>
              <div className={styles.sectionBody}>
                <div className={styles.modulesGrid}>
                  <ModuleCard
                    styles={styles}
                    title="Learning & Career Path"
                    desc="Skill profile, role matching, and personalized learning paths."
                    icon={<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>}
                  />
                </div>
              </div>
            </div>

            <div className={styles.footerNote}>Talent by Mazik Global Pakistan · Employee Dashboard</div>
          </div>
        </main>
      </div>
    </div>
  );
}

function Field({ label, value, styles }) {
  return (
    <div>
      <div className={styles.fieldLabel}>{label}</div>
      <div className={`${styles.fieldValue} ${!value ? styles.dim : ""}`}>{value || "Not assigned"}</div>
    </div>
  );
}

function RecordItem({ label, value, icon, styles }) {
  return (
    <div className={styles.recordItem}>
      <div className={styles.recordIcon}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{icon}</svg>
      </div>
      <div>
        <div className={styles.recordLabel}>{label}</div>
        <div className={styles.recordValue}>{value}</div>
      </div>
    </div>
  );
}

function ModuleCard({ title, desc, icon, styles }) {
  return (
    <div className={styles.moduleCard}>
      <div className={styles.phaseBadge}>PHASE 3</div>
      <div className={styles.moduleIcon}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{icon}</svg>
      </div>
      <div className={styles.moduleTitle}>{title}</div>
      <div className={styles.moduleDesc}>{desc}</div>
      <div className={styles.progressTrack}><div className={styles.progressFill} style={{ width: "0%" }} /></div>
    </div>
  );
}

function StatCard({ icon, iconExtra, tone, value, label }) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statTop}>
        <div className={`${styles.statIcon} ${styles[tone]}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{icon}{iconExtra}</svg>
        </div>
      </div>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}

function HeroRing({ percentage = 0 }) {
  const r = 42;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (Math.min(100, Math.max(0, percentage)) / 100) * circumference;
  return (
    <svg className={styles.ring} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="9" />
      <circle
        cx="50" cy="50" r={r} fill="none" stroke="#1FAE7A" strokeWidth="9" strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={offset} transform="rotate(-90 50 50)"
      />
      <text x="50" y="55" textAnchor="middle" className={styles.ringValue}>{percentage}%</text>
    </svg>
  );
}

function MiniRing({ percentage = 0, size = 72, stroke = 7 }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, Math.max(0, percentage)) / 100) * circumference;
  return (
    <div style={{ width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#eee0b8" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#b8860b" strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x="50%" y="53%" textAnchor="middle" style={{ fontWeight: 800, fontSize: "1.05rem", fill: "#7a5c0a" }}>
          {percentage}%
        </text>
      </svg>
    </div>
  );
}

function summarize(obj) {
  if (!obj) return "Not provided";
  if (obj.full_name) return obj.full_name;
  if (obj.national_id) return `ID on file · ${obj.city || ""}`.trim();
  if (obj.bank_name) return obj.bank_name;
  if (obj.name) return obj.name;
  return "On file";
}

function formatDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function tenureLabel(startDate) {
  if (!startDate) return "—";
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return "—";
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  if (months < 0) return "Upcoming";
  if (months < 12) return `${months} mo`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem ? `${years} yr ${rem} mo` : `${years} yr`;
}

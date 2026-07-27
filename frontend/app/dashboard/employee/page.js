"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "react-toastify";

import RequireAccess from "@/components/RequireAccess";
import ProfileAvatar from "@/components/ProfileAvatar";
import AnimatedNumber from "@/components/ai-experience/AnimatedNumber";
import { publishGuideContext } from "@/lib/ai/guideContext";
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
const COLLAPSE_KEY = "employee_sidebar_collapsed";

// Presentation metadata for each profile-completion task returned by the API
// (see backend PROFILE_TASK_DEFS). Purely cosmetic — icon, unlock hint, and a
// rough time estimate so the checklist reads the way a guided setup should.
const TASK_META = {
  emergency: {
    minutes: "2 min",
    hint: "Unlocks payroll setup",
    icon: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>,
  },
  employment: {
    minutes: "3 min",
    hint: "Enables your first payroll",
    icon: <><rect x="2" y="6" width="20" height="13" rx="2" /><path d="M2 11h20" /><path d="M6 15h4" /></>,
  },
  references: {
    minutes: "2 min",
    hint: "Needed before Day 1",
    icon: <><circle cx="9" cy="8" r="3.2" /><path d="M2.5 20c1-3.4 3.6-5 6.5-5s5.5 1.6 6.5 5" /><circle cx="18" cy="8" r="2.4" /><path d="M15.8 13.2c2.2.3 4 1.6 4.7 4" /></>,
  },
  documents: {
    minutes: "1 min",
    hint: "Required for Day 1",
    icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 15l2 2 4-4" /></>,
  },
  nda: {
    minutes: "30 sec",
    hint: "Required for Day 1",
    icon: <><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></>,
  },
};

const SparkleIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M12 2.5l1.9 5.1 5.1 1.9-5.1 1.9L12 16.5l-1.9-5.1-5.1-1.9 5.1-1.9L12 2.5z" />
    <path d="M19 15l.9 2.3L22 18l-2.1.7L19 21l-.9-2.3L16 18l2.1-.7L19 15z" />
  </svg>
);

function greetingForHour(hour) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function firstNameOf(name) {
  if (!name) return "there";
  return name.trim().split(/\s+/)[0];
}

// A light, clearly-cosmetic "ahead of peers" estimate driven off the real
// completion percentage — same spirit as the reference mockup's AI copy.
function peerRank(percentage) {
  if (percentage >= 90) return 95;
  if (percentage >= 70) return 83;
  if (percentage >= 40) return 62;
  if (percentage > 0) return 38;
  return 20;
}

function estimatedMinutesLeft(tasks) {
  const minuteValue = { "30 sec": 0.5, "1 min": 1, "2 min": 2, "3 min": 3 };
  const total = tasks
    .filter((t) => !t.completed)
    .reduce((sum, t) => sum + (minuteValue[TASK_META[t.step]?.minutes] ?? 2), 0);
  return Math.max(1, Math.round(total));
}

const DOC_TYPE_LABELS = {
  cnic: "National ID (CNIC)",
  passport: "Passport",
  degree: "Academic Transcript",
  transcript: "Academic Transcript",
  certificate: "Certificate",
  resume: "Resume / CV",
  experience_letter: "Experience letter",
  relieving_letter: "Relieving letter",
  salary_certificate: "Salary certificate",
  reference_letter: "Reference letter",
  other: "Document",
};

function docBadgeInfo(doc) {
  const status = doc.verification_status;
  const confidence = doc.ocr_result?.confidence;
  if (status === "verified") {
    return { cls: "verified", label: "Verified", icon: <path d="M20 6L9 17l-5-5" /> };
  }
  if (status === "rejected" || status === "reupload_requested" || (typeof confidence === "number" && confidence > 0 && confidence < 0.75)) {
    return { cls: "review", label: "Review", icon: <><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9L2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></> };
  }
  if (!doc.ocr_result) {
    return { cls: "processing", label: "AI processing…", icon: null };
  }
  return { cls: "processing", label: "Pending", icon: <path d="M12 6v6l4 2" /> };
}

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
  const [documents, setDocuments] = useState([]);
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

  // Shared with EmployeeShell so the sidebar keeps its width across pages.
  useEffect(() => {
    setSidebarCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
  }, []);

  useEffect(() => {
    publishGuideContext({
      pathname: "/dashboard/employee",
      section: null,
      formId: "dashboard",
    });
  }, []);

  function toggleSidebar() {
    setSidebarCollapsed((value) => {
      const next = !value;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  }

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
      .then((data) => {
        const docs = data.documents || [];
        setDocuments(docs);
        setDocCount(docs.length);
      })
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
  // Start at zero while loading: the ring then sweeps up to the real figure
  // instead of flashing a misleading 100%.
  const percentage = loading ? 0 : progress?.percentage ?? (profileIncomplete ? 0 : 100);
  const navItems = useMemo(() => getEmployeeNavItems({ profileComplete }), [profileComplete]);
  const documentsSummary = onboarding?.government_docs?.documents?.length ?? null;
  const assignedAssets = employee?.assets || [];
  const orientation = employee?.orientation;

  // ----- Derived data for the AI-styled dashboard -----
  const tasks = useMemo(() => {
    const raw = progress?.tasks || [];
    const withMeta = raw.map((t) => ({ ...t, meta: TASK_META[t.step] || {} }));
    // Incomplete first (so the checklist leads with what's next), completed last.
    return [...withMeta].sort((a, b) => Number(a.completed) - Number(b.completed));
  }, [progress]);
  const incompleteTasks = useMemo(() => tasks.filter((t) => !t.completed), [tasks]);
  const nextTask = incompleteTasks[0];
  const etaMinutes = useMemo(() => estimatedMinutesLeft(tasks), [tasks]);
  const peerEstimate = useMemo(() => peerRank(percentage), [percentage]);
  const greeting = useMemo(() => greetingForHour(new Date().getHours()), []);

  const healthLabel = percentage >= 90 ? "Excellent" : percentage >= 60 ? "Good" : percentage > 0 ? "Attention needed" : "Getting started";
  const healthSub = incompleteTasks.length
    ? `${incompleteTasks.length} task${incompleteTasks.length === 1 ? "" : "s"} pending`
    : "No issues detected";

  const highlights = useMemo(() => {
    const items = announcements.slice(0, 2).map((a) => ({
      key: `a-${a.id}`,
      node: <><b>{a.title}</b>{a.body ? ` — ${a.body}` : ""}</>,
    }));
    if (nextTask) {
      items.push({
        key: "task-nudge",
        node: <><b>{nextTask.label}</b> is still pending — {nextTask.meta.minutes || "a couple of minutes"}</>,
      });
    }
    return items.slice(0, 3);
  }, [announcements, nextTask]);

  const journeySteps = useMemo(() => {
    const hasDocs = Boolean(onboarding?.resume?.file_name) || (documentsSummary || 0) > 0 || docCount > 0;
    const hasVerifiedDoc = documents.some((d) => d.verification_status === "verified");
    const hasOffer = Boolean(employee?.converted_at);
    const hasAccepted = Boolean(employee?.start_date);
    const dayOneReached = employee?.start_date ? new Date(employee.start_date) <= new Date() : false;

    const steps = [
      { key: "invited", label: "Invited", done: true },
      { key: "registered", label: "Registered", done: true },
      { key: "documents", label: "Documents", done: hasDocs },
      { key: "verify", label: "OCR & Verify", done: hasVerifiedDoc },
      { key: "offer", label: "Offer", done: hasOffer },
      { key: "accept", label: "Accept", done: hasAccepted },
      { key: "profile", label: "Profile", done: profileComplete },
      { key: "day1", label: "Day 1", done: dayOneReached },
    ];
    const doneCount = steps.filter((s) => s.done).length;
    const currentIndex = steps.findIndex((s) => !s.done);
    return steps.map((s, i) => ({ ...s, current: i === currentIndex }));
  }, [onboarding, documentsSummary, docCount, documents, employee, profileComplete]);
  const journeyDoneCount = journeySteps.filter((s) => s.done).length;
  const journeyFillPct = Math.max(0, ((journeyDoneCount - 1) / (journeySteps.length - 1)) * 100);

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
            onClick={toggleSidebar}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!sidebarCollapsed}
          >
            <div className={styles.brandMark}>MZ</div>
            <div className={styles.brandText}>
              <div className={styles.p1}>Talent</div>
              <div className={styles.p2}></div>
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
                    placeholder="Ask AI or search records…"
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
                    onFocus={() => setSearchOpen(true)}
                    onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                  />
                  <span className={styles.searchKbd}>⌘K</span>
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

            {/* AI Assistant hero */}
            <div className={styles.hero}>
              <div className={styles.heroMain}>
                <div className={styles.heroBadgeRow}>
                  <span className={styles.aiChip}><SparkleIcon /> AI ASSISTANT</span>
                  <span className={styles.heroLive}><span className={styles.heroLiveDot} /> Live · analyzing your profile</span>
                </div>
                <h1>
                  {greeting}, <span className={styles.heroName}>{firstNameOf(employee?.full_name || user.full_name)}</span>
                  <span className={styles.heroWave}>👋</span>
                </h1>
                <p className={styles.heroSub}>
                  Welcome to {employee?.department ? `the ${employee.department} team at ` : ""}Mazik Global. You&rsquo;re{" "}
                  <b>{percentage}% ready</b> for Day 1.
                  {incompleteTasks.length > 0
                    ? <> AI estimates <b>{etaMinutes} minute{etaMinutes === 1 ? "" : "s"}</b> remaining.</>
                    : <> Everything on your checklist is complete.</>}
                </p>
                <div className={styles.heroActions}>
                  <button
                    type="button"
                    className={styles.btnPrimary}
                    onClick={() => router.push("/dashboard/employee/complete-profile")}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" /></svg>
                    {incompleteTasks.length ? "Continue where AI left off" : "Review my profile"}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                  </button>
                  <button type="button" className={styles.btnGhost} onClick={() => document.getElementById("task-checklist")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                    View full checklist
                  </button>
                </div>
                {nextTask && (
                  <div className={styles.heroRecommend}>
                    <SparkleIcon />
                    <div>
                      <div className={styles.heroRecommendTitle}>Today&rsquo;s recommendation</div>
                      Complete <b>{nextTask.label}</b> first — {nextTask.meta.hint || "this keeps your onboarding on track"}.
                    </div>
                  </div>
                )}
              </div>
              <div className={styles.heroRingCol}>
                <div className={styles.ringOuter}>
                  <HeroRing percentage={percentage} />
                  <div className={styles.ringCenter}>
                    <span className={styles.ringValue}>{percentage}%</span>
                    <span className={styles.ringCaption}>Ready</span>
                  </div>
                </div>
                <div className={styles.ringStars}>
                  {Array.from({ length: 5 }, (_, i) => (
                    <svg key={i} viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className={i < Math.round(percentage / 20) ? styles.starFull : styles.starEmpty}>
                      <path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.2 6.1-.7z" />
                    </svg>
                  ))}
                  Ahead of {peerEstimate}% of new hires
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className={styles.stats} data-stagger>
              <StatCard
                icon={<><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></>}
                tone="green"
                value={healthLabel}
                label="Onboarding health"
                sub={healthSub}
              />
              <StatCard
                icon={<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></>}
                tone="cyan"
                value={incompleteTasks.length ? `${etaMinutes} min` : "Done"}
                label="Estimated ETA"
                sub="AI predicted"
              />
              <StatCard
                icon={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>}
                tone="orange"
                value={docCount}
                label="Documents on file"
                sub={documents.some((d) => d.verification_status === "verified") ? "OCR verified" : "Awaiting review"}
              />
              <StatCard
                icon={<><path d="M20 7h-3a2 2 0 0 1-2-2V2" /><path d="M9 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z" /><path d="M12 12v4M10 14h4" /></>}
                tone="navy"
                value="Phase 3"
                label="Learning modules unlock"
                sub="After onboarding"
              />
            </div>

            {/* Task checklist + documents (main) / highlights + profile review (side) */}
            <div className={styles.dashGrid}>
              <div className={styles.dashMain}>
                <div className={styles.panel} id="task-checklist">
                  <div className={styles.panelHead}>
                    <div className={styles.panelHeadLeft}>
                      <div className={styles.panelTitleRow}>
                        <span className={styles.panelTitle}>Complete these first</span>
                      </div>
                      <div className={styles.panelDesc}>
                        {incompleteTasks.length
                          ? <>You&rsquo;ll reach 100% onboarding in ~{etaMinutes} minute{etaMinutes === 1 ? "" : "s"}.</>
                          : "Every onboarding task is complete."}
                      </div>
                    </div>
                    <button type="button" className={styles.panelLink} onClick={() => router.push("/dashboard/employee/complete-profile")}>
                      See all
                    </button>
                  </div>
                  <div className={styles.panelBody}>
                    {tasks.length ? (
                      <div className={styles.taskList}>
                        {tasks.slice(0, 5).map((t) => (
                          <div
                            key={t.id}
                            className={`${styles.taskRow} ${t.completed ? styles.done : ""}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => router.push("/dashboard/employee/complete-profile")}
                          >
                            <div className={`${styles.taskIcon} ${t.completed ? styles.done : ""}`}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                {t.completed ? <path d="M20 6L9 17l-5-5" /> : t.meta.icon}
                              </svg>
                            </div>
                            <div className={styles.taskBody}>
                              <div className={styles.taskTitle}>{t.label}</div>
                              <div className={styles.taskSub}>{t.meta.hint || "Part of your onboarding record"} · {t.meta.minutes || "a moment"}</div>
                            </div>
                            <div className={styles.taskChevron}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className={styles.emptyState}>
                        <div className={styles.emptyTitle}>Nothing left on your checklist</div>
                        <div className={styles.emptySub}>Your onboarding record is fully up to date.</div>
                      </div>
                    )}
                  </div>
                </div>

                <div className={styles.panel} id="documents-panel">
                  <div className={styles.panelHead}>
                    <div className={styles.panelHeadLeft}>
                      <div className={styles.panelTitleRow}>
                        <span className={styles.panelTitle}>My Documents</span>
                        <span className={styles.aiChipGhost}><SparkleIcon /> OCR VERIFIED</span>
                      </div>
                      <div className={styles.panelDesc}>AI parses, verifies, and scores each upload.</div>
                    </div>
                    <button type="button" className={styles.panelLink} onClick={() => router.push("/documents")}>
                      Manage
                    </button>
                  </div>
                  <div className={styles.panelBody}>
                    {documents.length ? (
                      <div className={styles.docList}>
                        {documents.slice(0, 4).map((doc) => {
                          const badge = docBadgeInfo(doc);
                          const confidence = typeof doc.ocr_result?.confidence === "number" ? Math.round(doc.ocr_result.confidence * 100) : null;
                          return (
                            <div className={styles.docRow} key={doc.id}>
                              <div className={styles.docIcon}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
                                </svg>
                              </div>
                              <div className={styles.docBody}>
                                <div className={styles.docTitleRow}>
                                  <span className={styles.docTitle}>{doc.file_name || DOC_TYPE_LABELS[doc.doc_type] || "Document"}</span>
                                  <span className={`${styles.docBadge} ${styles[badge.cls]}`}>
                                    {badge.icon && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">{badge.icon}</svg>}
                                    {badge.label}
                                  </span>
                                </div>
                                {confidence !== null && (
                                  <>
                                    <div className={styles.docTrack}>
                                      <div className={`${styles.docFill} ${styles[badge.cls]}`} style={{ width: `${confidence}%` }} />
                                    </div>
                                    <div className={styles.docMeta}>
                                      <span />
                                      <span className={styles.docConf}>{confidence}% conf.</span>
                                    </div>
                                  </>
                                )}
                                {badge.cls === "review" && (
                                  <div className={styles.docNote}>
                                    {doc.rejection_note || doc.reupload_request_note || "Needs another look — check quality and retake if needed."}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className={styles.docEmpty}>No documents uploaded yet. Open the document centre to get started.</div>
                    )}
                  </div>
                </div>
              </div>

              <div className={styles.dashSide}>
                <div className={styles.sideCard}>
                  <div className={styles.sideCardHead}>
                    <span className={styles.sideCardTitle}>Today&rsquo;s Highlights</span>
                    <span className={styles.aiChipGhost}><SparkleIcon /> SUMMARY</span>
                  </div>
                  <div className={styles.sideCardDesc}>AI read your announcements so you don&rsquo;t have to.</div>
                  {highlights.length ? (
                    <ul className={styles.highlightList}>
                      {highlights.map((h) => <li key={h.key}>{h.node}</li>)}
                    </ul>
                  ) : (
                    <p className={styles.emptySub} style={{ marginBottom: 0 }}>No updates yet — check back soon.</p>
                  )}
                </div>

                <div className={styles.sideCard}>
                  <div className={styles.sideCardHead}>
                    <span className={styles.sideCardTitle}>AI Profile Review</span>
                    <span className={styles.reviewBadge}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>
                      Everything matches
                    </span>
                  </div>
                  <div className={styles.profileGrid}>
                    <div className={styles.profileField}>
                      <div className={styles.profileLabel}>Department</div>
                      <div className={styles.profileValue}>{employee?.department || "—"}</div>
                    </div>
                    <div className={styles.profileField}>
                      <div className={styles.profileLabel}>Manager</div>
                      <div className={styles.profileValue}>{employee?.reporting_manager || "—"}</div>
                    </div>
                    <div className={styles.profileField} style={{ gridColumn: "1 / -1" }}>
                      <div className={styles.profileLabel}>Role</div>
                      <div className={styles.profileValue}>{employee?.job_title || "—"}</div>
                    </div>
                  </div>
                  <div className={styles.noteBox}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
                    <div>
                      <div className={styles.noteBoxTitle}>Learning path unlocks after onboarding</div>
                      <div className={styles.chipRow}>
                        <span className={styles.miniChip}>Phase 3</span>
                        <span className={styles.miniChip}>Skill matching</span>
                        <span className={styles.miniChip}>Career path</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className={`${styles.sideCard} ${styles.celebrateCard}`}>
                  <div className={styles.celebrateHead}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--blue-strong)" }}><path d="M12 2l2.4 5.2L20 8l-4 4 1 5.8L12 15l-5 2.8 1-5.8-4-4 5.6-.8z" /></svg>
                    <span className={styles.celebrateTitle}>{incompleteTasks.length ? "Almost there!" : "All set!"}</span>
                  </div>
                  <div className={styles.celebrateDesc}>
                    {incompleteTasks.length
                      ? <>Complete the final {incompleteTasks.length} task{incompleteTasks.length === 1 ? "" : "s"} and unlock your Day 1 welcome kit.</>
                      : "Your Day 1 welcome kit is unlocked."}
                  </div>
                  <div className={styles.avatarStack}>
                    <div className={styles.stackItem}>{firstNameOf(employee?.full_name)[0] || "?"}</div>
                    <div className={styles.stackItem}>MZ</div>
                    <div className={styles.stackItem}>+{Math.max(1, assignedAssets.length)}</div>
                    <span className={styles.stackText}>Your team is waiting</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Onboarding journey */}
            <div className={`${styles.section} ${styles.journeySection}`}>
              <div className={styles.sectionHead}>
                <div className={styles.sectionHeadLeft}>
                  <div className={`${styles.bar} ${styles.cyan}`} />
                  <div>
                    <div className={styles.sectionTitle}>Onboarding Journey</div>
                    <div className={styles.sectionDesc}>Auto-tracked from your onboarding &amp; document records.</div>
                  </div>
                </div>
              </div>
              <div className={styles.sectionBody}>
                <div className={styles.journeyTrack}>
                  <div className={styles.journeyLine} />
                  <div className={styles.journeyLineFill} style={{ width: `${journeyFillPct * 0.88}%` }} />
                  {journeySteps.map((step, i) => (
                    <div key={step.key} className={`${styles.journeyStep} ${step.done ? styles.done : ""} ${step.current ? styles.current : ""}`}>
                      <div className={`${styles.journeyDot} ${step.done ? styles.done : ""} ${step.current ? styles.current : ""}`}>
                        {step.done ? (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>
                        ) : (
                          i + 1
                        )}
                      </div>
                      <div className={styles.journeyLabel}>{step.label}</div>
                    </div>
                  ))}
                </div>
              </div>
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
                  <div className={styles.fieldGrid}>
                    {Array.from({ length: 8 }, (_, i) => (
                      <div key={i}>
                        <div className={`${styles.skeletonLine} ${styles.short}`} />
                        <div className={styles.skeletonLine} />
                      </div>
                    ))}
                  </div>
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

            <div className={styles.footerNote}>Talent by  · Employee Dashboard</div>
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

function StatCard({ icon, iconExtra, tone, value, label, sub }) {
  return (
    <div className={styles.statCard}>
      <div className={`${styles.statIcon} ${styles[tone]}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{icon}{iconExtra}</svg>
      </div>
      <div className={styles.statText}>
        <div className={styles.statValue}>
          <AnimatedNumber value={value} />
        </div>
        <div className={styles.statLabel}>{label}</div>
        {sub && <div className={styles.statSub}>{sub}</div>}
      </div>
    </div>
  );
}

function HeroRing({ percentage = 0 }) {
  const r = 42;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (Math.min(100, Math.max(0, percentage)) / 100) * circumference;
  return (
    <svg className={styles.ring} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r={r} fill="none" stroke="#dfe9f6" strokeWidth="9" />
      <circle
        cx="50" cy="50" r={r} fill="none" stroke="#38A2FF" strokeWidth="9" strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={offset} transform="rotate(-90 50 50)"
      />
    </svg>
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


"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "react-toastify";

import RequireAccess from "@/components/RequireAccess";
import ProfileAvatar from "@/components/ProfileAvatar";
import {
  clearLocalSession,
  getNotifications,
  logout,
  markNotificationsRead,
} from "@/services/authService";
import styles from "@/app/dashboard/candidate/candidate-dashboard.module.css";

const COLLAPSE_KEY = "candidate_sidebar_collapsed";
const NOTIFICATIONS_POLL_MS = 60000;

const NAV_ITEMS = [
  {
    key: "dashboard",
    label: "Dashboard",
    href: "/dashboard/candidate",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </svg>
    ),
  },
  {
    key: "onboarding",
    label: "Onboarding",
    href: "/onboarding",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 12l2 2 4-4" />
        <circle cx="12" cy="12" r="9" />
      </svg>
    ),
  },
  {
    key: "documents",
    label: "Documents",
    href: "/documents",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
      </svg>
    ),
  },
  {
    key: "profile",
    label: "Profile",
    href: "/onboarding?edit=true",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" />
      </svg>
    ),
  },
  {
    key: "assistant",
    label: "AI Assistant",
    href: "/dashboard/candidate/ai-assistant",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2a5 5 0 0 1 5 5v2a5 5 0 0 1-10 0V7a5 5 0 0 1 5-5z" />
        <path d="M19 11a7 7 0 0 1-14 0" />
        <path d="M12 18v4" />
      </svg>
    ),
  },
];

function isNavActive(item, activeKey, pathname) {
  if (activeKey && item.key === activeKey) return true;
  if (!item.href) return false;
  const pathOnly = item.href.split("?")[0];
  if (item.key === "dashboard") {
    return pathname === pathOnly;
  }
  return pathname === pathOnly || pathname.startsWith(`${pathOnly}/`);
}

/**
 * Shared chrome (sidebar + topbar) for candidate pages so the AI Assistant
 * and dashboard keep the same permanent sidebar.
 */
export default function CandidateShell({
  activeKey,
  title = "Candidate Dashboard",
  subtitle,
  jobTitle,
  actions,
  children,
}) {
  return (
    <RequireAccess anyOf={["onboarding.self", "profile.view"]} roles={["candidate"]}>
      <CandidateShellInner
        activeKey={activeKey}
        title={title}
        subtitle={subtitle}
        jobTitle={jobTitle}
        actions={actions}
      >
        {children}
      </CandidateShellInner>
    </RequireAccess>
  );
}

function CandidateShellInner({ activeKey, title, subtitle, jobTitle, actions, children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const lastUnreadRef = useRef(null);

  useEffect(() => {
    const stored = localStorage.getItem("user");
    setUser(stored ? JSON.parse(stored) : null);
  }, []);

  useEffect(() => {
    setSidebarCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
  }, []);

  function toggleSidebar() {
    setSidebarCollapsed((value) => {
      const next = !value;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  }

  const refreshNotifications = useCallback(async (silent = true) => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      const data = await getNotifications(accessToken);
      const nextUnread = data.unread_count || 0;
      const nextList = data.notifications || [];
      if (silent && lastUnreadRef.current != null && nextUnread > lastUnreadRef.current && nextList[0]) {
        toast.info(nextList[0].title || "New notification");
      }
      lastUnreadRef.current = nextUnread;
      setNotifications(nextList);
      setUnreadNotifications(nextUnread);
    } catch {
      // Non-critical polling failure
    }
  }, []);

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
        // Navigation remains available if read-state persistence fails.
      }
    }
    setNotifOpen(false);
    if (notification.link) router.push(notification.link);
  }

  if (!user) {
    return <p style={{ textAlign: "center", marginTop: "2rem" }}>Loading…</p>;
  }

  const roleLabel = jobTitle || "Candidate";

  return (
    <div className={styles.root}>
      <div className={styles.app}>
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
              <div className={styles.p2}>Mazik Global Pakistan</div>
            </div>
          </button>

          <div className={styles.navSectionLabel}>Workspace</div>
          <ul className={styles.nav} style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {NAV_ITEMS.map((item) => {
              const isActive = isNavActive(item, activeKey, pathname);
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    className={`${styles.navItem} ${isActive ? styles.active : ""}`}
                    onClick={() => item.href && router.push(item.href)}
                    title={item.label}
                  >
                    {item.icon}
                    <span className={styles.navLabel}>{item.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className={styles.sidebarFooter}>
            <ProfileAvatar src={user?.profile_picture} name={user.full_name} size="sm" fallback="CA" />
            <div className={styles.sidebarFooterText}>
              <div className={styles.name}>{user.full_name}</div>
              <div className={styles.role}>{roleLabel}</div>
            </div>
            <button type="button" className={styles.logoutBtn} title="Log out" onClick={handleLogout}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="M16 17l5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
            </button>
          </div>
        </aside>

        <main className={styles.main}>
          <div className={styles.topbar}>
            <div>
              <div className={styles.topbarTitle}>{title}</div>
              {subtitle ? <div className={styles.topbarSub}>{subtitle}</div> : null}
            </div>
            <div className={styles.topbarActions}>
              {actions}
              <div className={styles.dropdownWrap}>
                <div
                  className={styles.iconBtn}
                  title="Notifications"
                  role="button"
                  tabIndex={0}
                  onClick={() => setNotifOpen((v) => !v)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
                  </svg>
                  {unreadNotifications > 0 && <span className={styles.dot} />}
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
                title="Edit profile"
                role="button"
                tabIndex={0}
                onClick={() => router.push("/onboarding?edit=true")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" />
                </svg>
              </div>
            </div>
          </div>

          <div className={`${styles.content} ${styles.pageEnter}`}>{children}</div>
        </main>
      </div>
    </div>
  );
}

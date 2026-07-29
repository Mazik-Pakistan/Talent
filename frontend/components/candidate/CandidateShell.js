"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "react-toastify";

import RequireAccess from "@/components/RequireAccess";
import ProfileAvatar from "@/components/ProfileAvatar";
import SidebarBrand from "@/components/SidebarBrand";
import {
  clearLocalSession,
  getNotifications,
  logout,
  markNotificationsRead,
} from "@/services/authService";
import styles from "@/app/dashboard/candidate/candidate-dashboard.module.css";
import { CANDIDATE_NAV_ITEMS, isCandidateNavActive } from "@/utils/candidateNav";

const COLLAPSE_KEY = "candidate_sidebar_collapsed";
const NOTIFICATIONS_POLL_MS = 20000;

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
  const [search, setSearch] = useState("");
  const [user, setUser] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const lastUnreadRef = useRef(null);

  useEffect(() => {
    setSearch(typeof window !== "undefined" ? window.location.search : "");
  }, [pathname]);

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
      if (
        silent &&
        lastUnreadRef.current != null &&
        nextUnread > lastUnreadRef.current &&
        nextList[0]
      ) {
        const newest = nextList[0];
        toast.info(`${newest.title}: ${newest.message?.slice(0, 100) || "New notification"}`, {
          toastId: `candidate-notif-${newest.id || newest.title}`,
        });
      }
      lastUnreadRef.current = nextUnread;
      setNotifications(nextList);
      setUnreadNotifications(nextUnread);
      window.dispatchEvent(
        new CustomEvent("talent-notifications-updated", {
          detail: { unreadCount: nextUnread, notifications: nextList },
        })
      );
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
    <div className={styles.root} data-app-shell>
      <div className={styles.app}>
        <aside className={`${styles.sidebar} ${sidebarCollapsed ? styles.collapsed : ""}`}>
          <SidebarBrand
            collapsed={sidebarCollapsed}
            className={styles.brand}
            markClassName={styles.brandMark}
            onClick={toggleSidebar}
          />

          <div className={styles.navSectionLabel}>Workspace</div>
          <ul className={styles.nav} style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {CANDIDATE_NAV_ITEMS.map((item) => {
              const isActive = isCandidateNavActive(item, { activeKey, pathname, search });
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
            <div className={styles.topbarLeft}>
              <div className={styles.topbarTitle}>{title}</div>
              {subtitle ? <div className={styles.topbarSub} title={subtitle}>{subtitle}</div> : null}
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
                            {String(notification.type || "").includes("offer") ? (
                              <em style={{ display: "block", marginTop: 4, fontSize: 11, color: "#0D5C91" }}>
                                Open offer letter
                              </em>
                            ) : null}
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



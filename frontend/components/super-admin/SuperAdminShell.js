"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";

import RequireAccess from "@/components/RequireAccess";
import ProfileAvatar from "@/components/ProfileAvatar";
import SidebarBrand from "@/components/SidebarBrand";
import RecruiterLoader from "@/components/recruiter/RecruiterLoader";
import {
  clearLocalSession,
  getNotifications,
  logout,
  markNotificationsRead,
} from "@/services/authService";
import { can } from "@/services/rbac";
import styles from "@/components/recruiter/recruiter-shell.module.css";

const COLLAPSE_KEY = "super_admin_sidebar_collapsed";
const POLL_MS = 20000;

const NAV_ITEMS = [
  {
    key: "overview",
    label: "Overview",
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
    key: "recruiters",
    label: "Recruiters",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    key: "organizations",
    label: "Organizations",
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
    key: "invite",
    label: "Invite Recruiter",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="8.5" cy="7" r="4" />
        <line x1="20" y1="8" x2="20" y2="14" />
        <line x1="23" y1="11" x2="17" y2="11" />
      </svg>
    ),
  },
  {
    key: "support",
    label: "Support",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
      </svg>
    ),
  },
  {
    key: "assistant",
    label: "AI Assistant",
    route: "/dashboard/super-admin/ai-assistant",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 2.5l1.9 5.1 5.1 1.9-5.1 1.9L12 16.5l-1.9-5.1-5.1-1.9 5.1-1.9L12 2.5z" />
        <path d="M19 15l.9 2.3L22 18l-2.1.7L19 21l-.9-2.3L16 18l2.1-.7L19 15z" />
      </svg>
    ),
  },
];

export default function SuperAdminShell({ activeTab, onTabChange, title, subtitle, user, capability, children }) {
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifBusy, setNotifBusy] = useState(false);
  const lastUnreadRef = useRef(null);

  useEffect(() => {
    setSidebarCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
  }, []);

  function handleNavClick(item) {
    if (item.route) {
      router.push(item.route);
    } else if (onTabChange) {
      onTabChange(item.key);
    }
  }

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
      const data = await getNotifications(accessToken, 20);
      const nextUnread = data.unread_count || 0;
      const nextList = data.notifications || [];
      if (silent && lastUnreadRef.current != null && nextUnread > lastUnreadRef.current && nextList[0]) {
        const newest = nextList[0];
        toast.info(`${newest.title}: ${newest.message?.slice(0, 100) || "New notification"}`, {
          toastId: `super-admin-notif-${newest.id || newest.title}`,
        });
      }
      lastUnreadRef.current = nextUnread;
      setNotifications(nextList);
      setUnreadCount(nextUnread);
    } catch {
      // Non-critical polling failure
    }
  }, []);

  useEffect(() => {
    refreshNotifications(false);
    const timer = setInterval(() => refreshNotifications(true), POLL_MS);
    return () => clearInterval(timer);
  }, [refreshNotifications]);

  async function handleLogout() {
    const accessToken = localStorage.getItem("access_token");
    await logout(accessToken);
    clearLocalSession();
    router.replace("/portal-root-x9f3");
  }

  async function handleMarkAllRead() {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken || unreadCount === 0) return;
    setNotifBusy(true);
    try {
      await markNotificationsRead({ all: true }, accessToken);
      setNotifications((current) => current.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
      lastUnreadRef.current = 0;
    } catch {
      toast.error("Could not update notifications.");
    } finally {
      setNotifBusy(false);
    }
  }

  if (!user) {
    return <RecruiterLoader />;
  }

  return (
    <RequireAccess anyOf={["admin.access"]} roles={["super_admin"]} fallback={<RecruiterLoader />}>
      <div className={styles.root} data-app-shell>
        <div className={styles.app}>
          <aside className={`${styles.sidebar} ${sidebarCollapsed ? styles.sidebarCollapsed : ""}`}>
            <SidebarBrand
              collapsed={sidebarCollapsed}
              className={styles.brand}
              markClassName={styles.brandMark}
              onClick={toggleSidebar}
            />

            <div className={styles.navSectionLabel}>Administration</div>
            <ul className={styles.nav}>
              {NAV_ITEMS.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    className={`${styles.navItem} ${activeTab === item.key ? styles.navItemActive : ""}`}
                    onClick={() => handleNavClick(item)}
                    title={item.label}
                  >
                    <span className={styles.navIcon}>{item.icon}</span>
                    <span className={styles.navLabel}>{item.label}</span>
                  </button>
                </li>
              ))}
            </ul>

            <div className={styles.sidebarFooter}>
              <ProfileAvatar src={user.profile_picture} name={user.full_name} size="sm" fallback="SA" />
              <div className={styles.sidebarFooterText}>
                <div className={styles.name}>{user.full_name}</div>
                <div className={styles.role}>{user.role?.replace("_", " ")}</div>
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
                <div className={styles.topbarSub} title={subtitle}>{subtitle}</div>
              </div>

              <div className={styles.topbarActions}>
                <div className={styles.dropdownWrap}>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    title="Notifications"
                    aria-label="Notifications"
                    onClick={() => setNotifOpen((v) => !v)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
                    </svg>
                    {unreadCount > 0 && (
                      <span className={styles.badgeCount}>{unreadCount > 99 ? "99+" : unreadCount}</span>
                    )}
                  </button>
                  {notifOpen && (
                    <div className={styles.notifDropdown}>
                      <div className={styles.notifDropdownHead}>
                        <strong>Notifications{unreadCount > 0 ? ` (${unreadCount})` : ""}</strong>
                        <button
                          type="button"
                          className={styles.linkButton}
                          onClick={handleMarkAllRead}
                          disabled={notifBusy || unreadCount === 0}
                        >
                          Mark all read
                        </button>
                      </div>
                      <div className={styles.notifList}>
                        {notifications.length ? (
                          notifications.map((notification) => (
                            <div key={notification.id} className={styles.notifItem}>
                              <span className={styles.notifItemDot} />
                              <span className={styles.notifItemBody}>
                                <span className={styles.notifItemTitle}>{notification.title}</span>
                                <span className={styles.notifItemMessage}>{notification.message}</span>
                              </span>
                            </div>
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

            <div className={styles.content}>{children}</div>
          </main>
        </div>
      </div>
    </RequireAccess>
  );
}
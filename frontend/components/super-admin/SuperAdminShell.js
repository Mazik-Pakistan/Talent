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


const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "1.8",
  strokeLinecap: "round",
  strokeLinejoin: "round",
};


const NAV_ITEMS = [
  {
    key: "overview",
    label: "Overview",
    icon: (
      <svg {...iconProps}>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },

  {
    key: "recruiters",
    label: "Recruiters",
    icon: (
      <svg {...iconProps}>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M3.5 20c.7-3.5 2.8-5.5 5.5-5.5s4.8 2 5.5 5.5" />
        <circle cx="18" cy="8" r="2.5" />
        <path d="M16 14.5c2.2.2 3.8 2 4.5 4.5" />
      </svg>
    ),
  },

  {
    key: "organizations",
    label: "Organizations",
    icon: (
      <svg {...iconProps}>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M9 21V13h6v8" />
        <path d="M8 7h.01" />
        <path d="M12 7h.01" />
        <path d="M16 7h.01" />
        <path d="M8 10h.01" />
        <path d="M12 10h.01" />
        <path d="M16 10h.01" />
      </svg>
    ),
  },

  {
    key: "invite",
    label: "Invite Recruiter",
    icon: (
      <svg {...iconProps}>
        <circle cx="8.5" cy="8" r="3.5" />
        <path d="M3 20c.6-3.5 2.5-5.5 5.5-5.5S13.4 16.5 14 20" />
        <path d="M19 7v7" />
        <path d="M15.5 10.5H22.5" />
      </svg>
    ),
  },

  {
    key: "support",
    label: "Support",
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.2 9a3 3 0 0 1 5.7 1.3c0 2-2.9 2.5-2.9 4.2" />
        <path d="M12 17h.01" />
      </svg>
    ),
  },

  {
    key: "assistant",
    label: "AI Assistant",
    route: "/dashboard/super-admin/ai-assistant",
    icon: (
      <svg {...iconProps}>
        <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" />
        <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z" />
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
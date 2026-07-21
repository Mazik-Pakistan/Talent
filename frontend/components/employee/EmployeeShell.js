"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "react-toastify";

import RequireAccess from "@/components/RequireAccess";
import ProfileAvatar from "@/components/ProfileAvatar";
import {
  clearLocalSession,
  getMyEmployeeProfile,
  getNotifications,
  logout,
  markNotificationsRead,
} from "@/services/authService";
import { moduleAccess } from "@/services/rbac";
import { getEmployeeNavItems } from "@/utils/employeeNav";
import styles from "@/app/dashboard/employee/employee-dashboard.module.css";

const NOTIFICATIONS_POLL_MS = 20000;

/**
 * Shared chrome (sidebar + topbar) for employee pages that live outside the
 * monolithic /dashboard/employee page — e.g. the Learning module. Visually
 * identical to the main dashboard shell so navigation feels seamless.
 */
export default function EmployeeShell({ activeKey, title, subtitle, children }) {
  return (
    <RequireAccess anyOf={["learning.access", "profile.view"]} roles={["employee"]}>
      <EmployeeShellInner activeKey={activeKey} title={title} subtitle={subtitle}>
        {children}
      </EmployeeShellInner>
    </RequireAccess>
  );
}

function EmployeeShellInner({ activeKey, title, subtitle, children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const lastUnreadRef = useRef(null);

  useEffect(() => {
    const stored = localStorage.getItem("user");
    setUser(stored ? JSON.parse(stored) : null);
    const onUserUpdated = () => {
      const next = localStorage.getItem("user");
      setUser(next ? JSON.parse(next) : null);
    };
    window.addEventListener("talent-user-updated", onUserUpdated);
    return () => window.removeEventListener("talent-user-updated", onUserUpdated);
  }, []);

  useEffect(() => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    getMyEmployeeProfile(accessToken)
      .then((data) => setEmployee(data.employee))
      .catch(() => {});
  }, []);

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
        setNotifications((current) => current.map((item) => (item.id === notification.id ? { ...item, read: true } : item)));
        setUnreadNotifications((current) => Math.max(0, current - 1));
      } catch {
        // Navigation remains available even if read-state persistence fails.
      }
    }
    setNotifOpen(false);
    if (notification.link) router.push(notification.link);
  }

  if (!user) {
    return <p style={{ textAlign: "center", marginTop: "2rem" }}>Loading…</p>;
  }

  const modules = moduleAccess(user?.role);
  const profileComplete = employee?.profile_status === "complete";
  const navItems = getEmployeeNavItems({ profileComplete: profileComplete || true }).map((item) =>
    item.key === activeKey ? { ...item } : item
  );
  const displayName = employee?.full_name || user.full_name;
  const photoUrl = employee?.profile_picture || user?.profile_picture || null;

  return (
    <div className={styles.root}>
      <div className={styles.app}>
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
              const isActive = item.key === activeKey || (item.href && pathname.startsWith(item.href));
              const disabled = !item.href;
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    className={`${styles.navItem} ${isActive ? styles.active : ""} ${disabled ? styles.disabled : ""}`}
                    onClick={() => item.href && router.push(item.href)}
                    title={disabled ? `${item.label} — coming soon` : item.label}
                    disabled={disabled}
                  >
                    {item.icon}
                    <span className={styles.navLabel}>{item.label}</span>
                    {item.badge && !disabled ? null : item.badge ? <span className={styles.navBadge}>{item.badge}</span> : null}
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
              <div className={styles.topbarSub}>{subtitle}</div>
            </div>
            <div className={styles.topbarActions}>
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
                  {unreadNotifications > 0 && (
                    <span className={styles.badgeCount}>{unreadNotifications > 99 ? "99+" : unreadNotifications}</span>
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
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" />
                </svg>
              </div>
            </div>
          </div>

          <div className={styles.content}>{children}</div>
        </main>
      </div>
    </div>
  );
}

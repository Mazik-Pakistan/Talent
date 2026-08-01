"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import RequireAccess from "@/components/RequireAccess";
import ProfileAvatar from "@/components/ProfileAvatar";
import SidebarBrand from "@/components/SidebarBrand";
import RecruiterLoader from "@/components/recruiter/RecruiterLoader";
import { getMyEmployeeProfile } from "@/services/authService";
import { moduleAccess } from "@/services/rbac";
import { getEmployeeNavItems, isEmployeeNavActive } from "@/utils/employeeNav";
import { publishCopilotNotification, publishHover } from "@/lib/ai/guideContext";
import { BellIcon, LogoutIcon, ProfileIcon } from "@/components/shared/shell/ShellIcons";
import { useLogout } from "@/hooks/useLogout";
import { useSidebarCollapse } from "@/hooks/useSidebarCollapse";
import { useUserSession } from "@/hooks/useUserSession";
import { useNotificationsCenter } from "@/hooks/useNotificationsCenter";
import styles from "@/app/dashboard/employee/employee-dashboard.module.css";

const COLLAPSE_KEY = "employee_sidebar_collapsed";

/**
 * Shared chrome (sidebar + topbar) for every employee page. Pages supply their
 * own permission set, an optional topbar action slot, and an `onEmployee`
 * callback so they can reuse the profile lookup the shell already makes.
 */
export default function EmployeeShell({
  activeKey,
  title,
  subtitle,
  permissions = ["learning.access", "profile.view"],
  actions,
  onEmployee,
  children,
}) {
  return (
    <RequireAccess anyOf={permissions} roles={["employee"]}>
      <EmployeeShellInner
        activeKey={activeKey}
        title={title}
        subtitle={subtitle}
        actions={actions}
        onEmployee={onEmployee}
      >
        {children}
      </EmployeeShellInner>
    </RequireAccess>
  );
}

function EmployeeShellInner({ activeKey, title, subtitle, actions, onEmployee, children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [employee, setEmployee] = useState(null);

  const user = useUserSession({ watchEvents: ["talent-user-updated"] });
  const [sidebarCollapsed, toggleSidebar] = useSidebarCollapse(COLLAPSE_KEY);
  const handleLogout = useLogout();

  const { notifOpen, setNotifOpen, notifications, unreadCount, markOneRead } = useNotificationsCenter({
    toastIdPrefix: undefined,
    onNewNotification: (newest) =>
      publishCopilotNotification({
        id: newest.id,
        message: newest.title
          ? `${newest.title}${newest.message ? ` — ${newest.message}` : ""}`
          : "You have a new notification.",
      }),
  });

  useEffect(() => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    getMyEmployeeProfile(accessToken)
      .then((data) => {
        setEmployee(data.employee);
        onEmployee?.(data.employee);
      })
      .catch(() => {});
    // `onEmployee` is a render-time callback; re-running on identity changes
    // would refetch the profile on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleNotification(notification) {
    if (!notification.read) await markOneRead(notification.id);
    setNotifOpen(false);
    if (notification.type === "hr_message") {
      const threadId = notification.related_id || notification.relatedId;
      if (threadId) {
        router.push(`/dashboard/employee/messages?thread=${encodeURIComponent(threadId)}`);
        return;
      }
      if (notification.link) {
        router.push(notification.link);
        return;
      }
      router.push("/dashboard/employee/messages");
      return;
    }
    if (notification.link) router.push(notification.link);
  }

  if (!user) {
    return <RecruiterLoader />;
  }

  const modules = moduleAccess(user?.role);
  const profileComplete = employee?.profile_status === "complete";
  const navItems = getEmployeeNavItems({ profileComplete });
  const displayName = employee?.full_name || user.full_name;
  const photoUrl = employee?.profile_picture || user?.profile_picture || null;

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
            {navItems.map((item) => {
              const enabled = item.module ? modules[item.module] : true;
              if (!enabled) return null;
              const isActive = isEmployeeNavActive(item, { pathname, activeKey });
              const disabled = !item.href;
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    className={`${styles.navItem} ${isActive ? styles.active : ""} ${disabled ? styles.disabled : ""}`}
                    onClick={() => item.href && router.push(item.href)}
                    onMouseEnter={() => publishHover({ key: item.key, target: item.label })}
                    onMouseLeave={() => publishHover(null)}
                    title={disabled ? `${item.label} — coming soon` : item.label}
                    disabled={disabled}
                  >
                    {item.icon}
                    <span className={styles.navLabel}>{item.label}</span>
                    {item.badge ? <span className={styles.navBadge}>{item.badge}</span> : null}
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
              <LogoutIcon />
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
              {actions}
              <div className={styles.dropdownWrap}>
                <div
                  className={styles.iconBtn}
                  title="Notifications"
                  role="button"
                  tabIndex={0}
                  onClick={() => setNotifOpen((v) => !v)}
                >
                  <BellIcon />
                  {unreadCount > 0 && (
                    <span className={styles.badgeCount}>{unreadCount > 99 ? "99+" : unreadCount}</span>
                  )}
                </div>
                {notifOpen && (
                  <div className={styles.notifPanel}>
                    <div className={styles.notifHeading}>
                      <strong>Notifications</strong>
                      {unreadCount > 0 && <span>{unreadCount} unread</span>}
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
                <ProfileIcon />
              </div>
            </div>
          </div>

          <div className={styles.content}>{children}</div>
        </main>
      </div>
    </div>
  );
}

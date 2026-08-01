"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import RequireAccess from "@/components/RequireAccess";
import ProfileAvatar from "@/components/ProfileAvatar";
import SidebarBrand from "@/components/SidebarBrand";
import RecruiterLoader from "@/components/recruiter/RecruiterLoader";
import { BellIcon, LogoutIcon, ProfileIcon } from "@/components/shared/shell/ShellIcons";
import { useLogout } from "@/hooks/useLogout";
import { useSidebarCollapse } from "@/hooks/useSidebarCollapse";
import { useUserSession } from "@/hooks/useUserSession";
import { useNotificationsCenter } from "@/hooks/useNotificationsCenter";
import styles from "@/app/dashboard/candidate/candidate-dashboard.module.css";
import { CANDIDATE_NAV_ITEMS, isCandidateNavActive } from "@/utils/candidateNav";

const COLLAPSE_KEY = "candidate_sidebar_collapsed";

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

  const user = useUserSession();
  const [sidebarCollapsed, toggleSidebar] = useSidebarCollapse(COLLAPSE_KEY);
  const handleLogout = useLogout();

  const { notifOpen, setNotifOpen, notifications, unreadCount, markOneRead } = useNotificationsCenter({
    toastIdPrefix: "candidate-notif",
    broadcastOnRefresh: true,
  });

  useEffect(() => {
    setSearch(typeof window !== "undefined" ? window.location.search : "");
  }, [pathname]);

  async function handleNotification(notification) {
    if (!notification.read) await markOneRead(notification.id);
    setNotifOpen(false);
    if (notification.link) router.push(notification.link);
  }

  if (!user) {
    return <RecruiterLoader />;
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
              <LogoutIcon />
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
                  <BellIcon />
                  {unreadCount > 0 && <span className={styles.dot} />}
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
                <ProfileIcon />
              </div>
            </div>
          </div>

          <div className={`${styles.content} ${styles.pageEnter}`}>{children}</div>
        </main>
      </div>
    </div>
  );
}

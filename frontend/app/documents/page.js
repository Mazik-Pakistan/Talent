"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

import RequireAccess from "@/components/RequireAccess";
import DocumentManager from "@/components/DocumentManager";
import {
  clearLocalSession,
  getApiErrorMessage,
  getCandidateDashboard,
  getMyEmployeeProfile,
  getNotifications,
  logout,
  markNotificationsRead,
} from "@/services/authService";
import { moduleAccess } from "@/services/rbac";
import candidateStyles from "@/app/dashboard/candidate/candidate-dashboard.module.css";
import employeeStyles from "@/app/dashboard/employee/employee-dashboard.module.css";

const DOCUMENTS_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
  </svg>
);

const CANDIDATE_NAV = [
  {
    key: "dashboard",
    label: "Dashboard",
    href: "/dashboard/candidate",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" />
      </svg>
    ),
  },
  {
    key: "onboarding",
    label: "Onboarding",
    href: "/onboarding",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" />
      </svg>
    ),
  },
  {
    key: "documents",
    label: "Documents",
    href: "/documents",
    icon: DOCUMENTS_ICON,
  },
  {
    key: "profile",
    label: "Profile",
    href: "/onboarding?edit=true",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" />
      </svg>
    ),
  },
];

const EMPLOYEE_NAV = [
  {
    key: "dashboard",
    label: "Dashboard",
    module: null,
    href: "/dashboard/employee",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" />
      </svg>
    ),
  },
  {
    key: "onboarding",
    label: "Onboarding",
    module: "onboarding",
    href: "/dashboard/employee/complete-profile",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" />
      </svg>
    ),
  },
  {
    key: "documents",
    label: "Documents",
    module: null,
    href: "/documents",
    icon: DOCUMENTS_ICON,
  },
  {
    key: "profile",
    label: "Profile",
    module: "profile",
    href: "/dashboard/employee/complete-profile",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" />
      </svg>
    ),
  },
];

export default function DocumentsPage() {
  return (
    <RequireAccess anyOf={["documents.self", "profile.view"]} roles={["candidate", "employee"]}>
      <DocumentsPageContent />
    </RequireAccess>
  );
}

function DocumentsPageContent() {
  const router = useRouter();
  const pathname = usePathname();

  const [user, setUser] = useState(null);
  const [profileMeta, setProfileMeta] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  const isEmployee = user?.role === "employee";
  const styles = isEmployee ? employeeStyles : candidateStyles;
  const navItems = isEmployee ? EMPLOYEE_NAV : CANDIDATE_NAV;
  const modules = moduleAccess(user?.role);

  useEffect(() => {
    setUser(JSON.parse(localStorage.getItem("user")));
  }, []);

  const loadContext = useCallback(async () => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken || !user) return;

    try {
      const notificationData = await getNotifications(accessToken).catch(() => ({
        notifications: [],
        unread_count: 0,
      }));
      setNotifications(notificationData?.notifications || []);
      setUnreadNotifications(notificationData?.unread_count || 0);

      if (user.role === "employee") {
        const profileData = await getMyEmployeeProfile(accessToken);
        setProfileMeta(profileData.employee || null);
      } else {
        const dashboard = await getCandidateDashboard(accessToken);
        setProfileMeta(dashboard?.profile || null);
      }
      setLoadError("");
    } catch (error) {
      setLoadError(getApiErrorMessage(error, "Could not load your profile context."));
    }
  }, [user]);

  useEffect(() => {
    if (user) loadContext();
  }, [user, loadContext]);

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

  if (!user) {
    return <p style={{ textAlign: "center", marginTop: "2rem" }}>Loading…</p>;
  }

  const initials = initialsFor(user.full_name);
  const subtitle = isEmployee
    ? `${profileMeta?.employee_id || "—"} · ${profileMeta?.department || "—"}`
    : `${profileMeta?.job_title || "—"} · ${profileMeta?.department || "—"}`;

  return (
    <div className={styles.root}>
      <div className={styles.app}>
        <aside className={`${styles.sidebar} ${sidebarCollapsed ? styles.collapsed : ""}`}>
          <button
            type="button"
            className={styles.brand}
            onClick={() => setSidebarCollapsed((value) => !value)}
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
              if (isEmployee && item.module && !modules[item.module]) return null;
              const isActive = item.href && pathname === item.href;
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
            <div className={styles.avatarSm}>{initials}</div>
            <div className={styles.sidebarFooterText}>
              <div className={styles.name}>{user.full_name}</div>
              <div className={styles.role}>{profileMeta?.job_title || (isEmployee ? "Employee" : "Candidate")}</div>
            </div>
            <button type="button" className={styles.logoutBtn} title="Log out" onClick={handleLogout}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" />
              </svg>
            </button>
          </div>
        </aside>

        <main className={styles.main}>
          <div className={styles.topbar}>
            <div>
              <div className={styles.topbarTitle}>Documents</div>
              <div className={styles.topbarSub}>{subtitle}</div>
            </div>
            <div className={styles.topbarActions}>
              <div className={styles.dropdownWrap}>
                <div
                  className={styles.iconBtn}
                  title="Notifications"
                  role="button"
                  tabIndex={0}
                  onClick={() => setNotifOpen((value) => !value)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
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
            </div>
          </div>

          <div className={styles.content}>
            {loadError && <div className={styles.loadError} role="alert">{loadError}</div>}

            <div className={styles.section} style={{ marginBottom: 24 }}>
              <div className={styles.sectionHead}>
                <div className={styles.sectionHeadLeft}>
                  <div className={`${styles.bar} ${styles.orange}`} />
                  <div>
                    <div className={styles.sectionTitle}>My documents</div>
                    <div className={styles.sectionDesc}>
                      Organize files by category, download when needed, and upload updates from one place.
                    </div>
                  </div>
                </div>
              </div>
              <div className={styles.sectionBody}>
                <DocumentManager compact={false} />
              </div>
            </div>

            <div className={styles.footerNote}>
              Talent by Mazik Global Pakistan · {isEmployee ? "Employee" : "Candidate"} Documents
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function initialsFor(name) {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "U";
}

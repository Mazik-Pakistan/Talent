"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "react-toastify";

import RequireAccess from "@/components/RequireAccess";
import ProfileAvatar from "@/components/ProfileAvatar";
import {
  clearLocalSession,
  getNotifications,
  globalSearch,
  logout,
  markNotificationsRead,
} from "@/services/authService";
import styles from "./recruiter-shell.module.css";

const SEARCH_DEBOUNCE_MS = 350;

const NAV_ITEMS = [
  {
    key: "overview",
    label: "Overview",
    href: "/dashboard/recruiter/overview",
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
    key: "candidates",
    label: "Candidates",
    href: "/dashboard/recruiter/candidates",
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
    key: "invite",
    label: "Invite",
    href: "/dashboard/recruiter/invite",
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
    key: "employees",
    label: "Employees",
    href: "/dashboard/recruiter/employees",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="7" width="20" height="14" rx="2" />
        <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
      </svg>
    ),
  },
  {
    key: "announcements",
    label: "Announcements",
    href: "/dashboard/recruiter/announcements",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
    ),
  },
  {
    key: "activity",
    label: "Activity",
    href: "/dashboard/recruiter/activity",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    key: "profile",
    label: "Profile",
    href: "/dashboard/recruiter/profile",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" />
      </svg>
    ),
  },
];

const POLL_MS = 20000;

export default function RecruiterShell({ activeKey, title, subtitle, children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifBusy, setNotifBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState(null);
  const searchTimerRef = useRef(null);
  const lastUnreadRef = useRef(null);

  const refreshUser = useCallback(() => {
    const storedUser = localStorage.getItem("user");
    setUser(storedUser ? JSON.parse(storedUser) : null);
  }, []);

  useEffect(() => {
    refreshUser();
  }, [pathname, refreshUser]);

  useEffect(() => {
    const onUserUpdated = () => refreshUser();
    window.addEventListener("talent-user-updated", onUserUpdated);
    window.addEventListener("storage", onUserUpdated);
    return () => {
      window.removeEventListener("talent-user-updated", onUserUpdated);
      window.removeEventListener("storage", onUserUpdated);
    };
  }, [refreshUser]);

  const refreshNotifications = useCallback(async (silent = true) => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      const data = await getNotifications(accessToken, 20);
      const nextUnread = data.unread_count || 0;
      const nextList = data.notifications || [];
      if (
        silent &&
        lastUnreadRef.current != null &&
        nextUnread > lastUnreadRef.current &&
        nextList[0]
      ) {
        const newest = nextList[0];
        toast.info(`${newest.title}: ${newest.message?.slice(0, 80) || "New notification"}`);
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
  }, [pathname, refreshNotifications]);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      const accessToken = localStorage.getItem("access_token");
      if (!accessToken) return;
      try {
        const data = await globalSearch(trimmed, accessToken);
        setSearchResults(data.results || []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery]);

  async function handleLogout() {
    const accessToken = localStorage.getItem("access_token");
    await logout(accessToken);
    clearLocalSession();
    router.replace("/login");
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
      toast.success("All notifications marked as read.");
    } catch {
      toast.error("Could not update notifications.");
    } finally {
      setNotifBusy(false);
    }
  }

  async function handleMarkOneRead(notificationId) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      await markNotificationsRead({ ids: [notificationId] }, accessToken);
      setNotifications((current) => current.map((n) => (n.id === notificationId ? { ...n, read: true } : n)));
      setUnreadCount((count) => {
        const next = Math.max(0, count - 1);
        lastUnreadRef.current = next;
        return next;
      });
    } catch {
      // Non-critical
    }
  }

  function handleNotificationClick(notification) {
    if (!notification.read) handleMarkOneRead(notification.id);
    setNotifOpen(false);
    if (!notification.link) return;
    if (notification.type === "announcement") {
      router.push("/dashboard/recruiter/announcements");
      return;
    }
    if (notification.link.includes("#")) {
      const hash = notification.link.split("#")[1];
      document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (notification.type === "invitation_sent") {
      router.push("/dashboard/recruiter/invite");
    } else if (notification.type === "intake_submitted" || notification.type === "offer_signed") {
      router.push("/dashboard/recruiter/candidates");
    } else if (notification.link.startsWith("/dashboard/recruiter/employees")) {
      router.push(notification.link);
    } else {
      router.push("/dashboard/recruiter/overview");
    }
  }

  function handleSearchSelect(result) {
    setSelectedPerson(result);
    setSearchOpen(false);
    setSearchQuery(result.full_name || "");
    if (result.type === "employee") {
      router.push(`/dashboard/recruiter/employees/${result.id}`);
    } else {
      router.push("/dashboard/recruiter/candidates");
    }
  }

  if (!user) {
    return <p style={{ textAlign: "center", marginTop: "2rem" }}>Loading…</p>;
  }

  return (
    <RequireAccess anyOf={["recruitment.view", "recruitment.invite"]} roles={["recruiter", "super_admin"]}>
      <div className={styles.root}>
        <div className={styles.app}>
          <aside className={`${styles.sidebar} ${sidebarCollapsed ? styles.sidebarCollapsed : ""}`}>
            <button
              type="button"
              className={styles.brand}
              onClick={() => setSidebarCollapsed((value) => !value)}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <div className={styles.brandMark}>MZ</div>
              <div className={styles.brandText}>
                <div className={styles.p1}>Talent</div>
                <div className={styles.p2}>Mazik Global Pakistan</div>
              </div>
            </button>

            <div className={styles.navSectionLabel}>Recruiting</div>
            <ul className={styles.nav}>
              {NAV_ITEMS.map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    className={`${styles.navItem} ${activeKey === item.key ? styles.navItemActive : ""}`}
                    onClick={() => router.push(item.href)}
                    title={item.label}
                  >
                    <span className={styles.navIcon}>{item.icon}</span>
                    <span className={styles.navLabel}>{item.label}</span>
                  </button>
                </li>
              ))}
            </ul>

            <div className={styles.sidebarFooter}>
              <button
                type="button"
                className={styles.footerClickable}
                onClick={() => router.push("/dashboard/recruiter/profile")}
                title="Open profile"
              >
                <ProfileAvatar src={user.profile_picture} name={user.full_name} size="sm" fallback="RC" />
                <div className={styles.sidebarFooterText}>
                  <div className={styles.name}>{user.full_name}</div>
                  <div className={styles.role}>{user.role?.replace("_", " ")}</div>
                </div>
              </button>
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
                <div className={styles.searchWrap}>
                  <div className={styles.searchBox}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="11" cy="11" r="7" />
                      <path d="M21 21l-4.3-4.3" />
                    </svg>
                    <input
                      value={searchQuery}
                      onChange={(event) => {
                        setSearchQuery(event.target.value);
                        setSearchOpen(true);
                      }}
                      onFocus={() => setSearchOpen(true)}
                      onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                      placeholder="Search candidates, employees…"
                      aria-label="Search"
                    />
                  </div>
                  {searchOpen && searchQuery.trim().length >= 2 && (
                    <div className={styles.searchResults}>
                      {searching && <p className={styles.searchEmpty}>Searching…</p>}
                      {!searching && searchResults.length === 0 && (
                        <p className={styles.searchEmpty}>No matches for “{searchQuery.trim()}”.</p>
                      )}
                      {!searching &&
                        searchResults.map((result) => (
                          <button
                            type="button"
                            className={styles.searchResultItem}
                            key={`${result.type}-${result.id}`}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => handleSearchSelect(result)}
                          >
                            <div>
                              <div className={styles.searchResultLabel}>{result.full_name}</div>
                              <div className={styles.searchResultMeta}>
                                {result.email || "—"} · {result.department || "—"}
                              </div>
                            </div>
                            <span className={styles.typePill}>{result.type}</span>
                          </button>
                        ))}
                    </div>
                  )}
                </div>

                <div className={styles.dropdownWrap}>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    title="Notifications"
                    aria-label="Notifications"
                    onClick={() => setNotifOpen((value) => !value)}
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
                            <button
                              key={notification.id}
                              type="button"
                              className={`${styles.notifItem} ${notification.read ? styles.notifItemRead : ""}`}
                              onClick={() => handleNotificationClick(notification)}
                            >
                              <span className={styles.notifItemDot} />
                              <span className={styles.notifItemBody}>
                                <span className={styles.notifItemTitle}>{notification.title}</span>
                                <span className={styles.notifItemMessage}>{notification.message}</span>
                                <span className={styles.notifItemTime}>{formatDateTime(notification.created_at)}</span>
                              </span>
                            </button>
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

            <div className={styles.content}>
              {selectedPerson && (
                <div className={styles.selectionBox}>
                  <div>
                    <strong>{selectedPerson.full_name}</strong>
                    <div className={styles.mutedText}>
                      {selectedPerson.type} · {selectedPerson.email || "—"} · {selectedPerson.department || "—"}
                    </div>
                  </div>
                  <button type="button" className={styles.secondaryButton} onClick={() => setSelectedPerson(null)}>
                    Clear
                  </button>
                </div>
              )}
              {children}
            </div>
          </main>
        </div>
      </div>
    </RequireAccess>
  );
}

function formatDateTime(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

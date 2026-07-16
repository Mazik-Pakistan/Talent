"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import RequireAccess from "@/components/RequireAccess";
import {
  clearLocalSession,
  getApiErrorMessage,
  getNotifications,
  globalSearch,
  logout,
  markNotificationsRead,
} from "@/services/authService";
import styles from "./recruiter-shell.module.css";

const SEARCH_DEBOUNCE_MS = 350;

const NAV_ITEMS = [
  { key: "overview", label: "Overview", href: "/dashboard/recruiter/overview", icon: "◈" },
  { key: "candidates", label: "Candidates", href: "/dashboard/recruiter/candidates", icon: "◎" },
  { key: "invite", label: "Invite", href: "/dashboard/recruiter/invite", icon: "+" },
  { key: "employees", label: "Employees", href: "/dashboard/recruiter/employees", icon: "◌" },
  { key: "announcements", label: "Announcements", href: "/dashboard/recruiter/announcements", icon: "✦" },
  { key: "activity", label: "Activity", href: "/dashboard/recruiter/activity", icon: "↺" },
];

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

  useEffect(() => {
    const storedUser = localStorage.getItem("user");
    setUser(storedUser ? JSON.parse(storedUser) : null);
  }, []);

  useEffect(() => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    getNotifications(accessToken, 12)
      .then((data) => {
        setNotifications(data.notifications || []);
        setUnreadCount(data.unread_count || 0);
      })
      .catch(() => {
        setNotifications([]);
      });
  }, [pathname]);

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
    } catch {
      // Non-critical
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
      setUnreadCount((count) => Math.max(0, count - 1));
    } catch {
      // Non-critical
    }
  }

  function handleNotificationClick(notification) {
    if (!notification.read) handleMarkOneRead(notification.id);
    setNotifOpen(false);
    if (notification.link) {
      if (notification.link.includes("#")) {
        const hash = notification.link.split("#")[1];
        document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (notification.type === "invitation_sent") {
        router.push("/dashboard/recruiter/invite");
      } else if (notification.type === "intake_submitted") {
        router.push("/dashboard/recruiter/candidates");
      } else if (notification.type === "offer_signed") {
        router.push("/dashboard/recruiter/candidates");
      } else {
        router.push("/dashboard/recruiter/overview");
      }
    }
  }

  function handleSearchSelect(result) {
    setSelectedPerson(result);
    setSearchOpen(false);
    setSearchQuery(result.full_name || "");
    router.push("/dashboard/recruiter/employees");
  }

  const initials = useMemo(() => initialsFor(user?.full_name), [user]);

  if (!user) {
    return <p style={{ textAlign: "center", marginTop: "2rem" }}>Loading…</p>;
  }

  return (
    <RequireAccess anyOf={["recruitment.view", "recruitment.invite"]} roles={["recruiter", "super_admin"]}>
      <div className={styles.root}>
        <div className={styles.app}>
          <aside className={`${styles.sidebar} ${sidebarCollapsed ? styles.sidebarCollapsed : ""}`}>
            <button type="button" className={styles.brand} onClick={() => setSidebarCollapsed((value) => !value)}>
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
                  >
                    <span className={styles.navIcon}>{item.icon}</span>
                    <span className={styles.navLabel}>{item.label}</span>
                  </button>
                </li>
              ))}
            </ul>

            <div className={styles.sidebarFooter}>
              <div className={styles.avatarSm}>{initials}</div>
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
                      placeholder="Search candidates, employees, departments…"
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
                          <button type="button" className={styles.searchResultItem} key={`${result.type}-${result.id}`} onMouseDown={(event) => event.preventDefault()} onClick={() => handleSearchSelect(result)}>
                            <div>
                              <div className={styles.searchResultLabel}>{result.full_name}</div>
                              <div className={styles.searchResultMeta}>{result.email || "—"} · {result.department || "—"}</div>
                            </div>
                            <span className={styles.typePill}>{result.type}</span>
                          </button>
                        ))}
                    </div>
                  )}
                </div>

                <div className={styles.dropdownWrap}>
                  <div className={styles.iconBtn} title="Notifications" role="button" tabIndex={0} onClick={() => setNotifOpen((value) => !value)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
                    </svg>
                    {unreadCount > 0 && <span className={styles.dot} />}
                  </div>
                  {notifOpen && (
                    <div className={styles.notifDropdown}>
                      <div className={styles.notifDropdownHead}>
                        <strong>Notifications{unreadCount > 0 ? ` (${unreadCount})` : ""}</strong>
                        <button type="button" className={styles.linkButton} onClick={handleMarkAllRead} disabled={notifBusy || unreadCount === 0}>
                          Mark all read
                        </button>
                      </div>
                      <div className={styles.notifList}>
                        {notifications.length ? (
                          notifications.map((notification) => (
                            <button key={notification.id} type="button" className={`${styles.notifItem} ${notification.read ? styles.notifItemRead : ""}`} onClick={() => handleNotificationClick(notification)}>
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
                    <div className={styles.mutedText}>{selectedPerson.type} · {selectedPerson.email || "—"} · {selectedPerson.department || "—"}</div>
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

function initialsFor(name) {
  if (!name) return "RC";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "RC";
}

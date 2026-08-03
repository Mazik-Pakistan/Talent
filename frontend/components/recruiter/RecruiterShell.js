"use client";

import { usePathname, useRouter } from "next/navigation";

import RequireAccess from "@/components/RequireAccess";
import ProfileAvatar from "@/components/ProfileAvatar";
import SidebarBrand from "@/components/SidebarBrand";
import RecruiterLoader from "@/components/recruiter/RecruiterLoader";
import RoleSwitchButton from "@/components/shared/shell/RoleSwitchButton";
import { BellIcon, LogoutIcon, SearchIcon } from "@/components/shared/shell/ShellIcons";
import { useLogout } from "@/hooks/useLogout";
import { useSidebarCollapse } from "@/hooks/useSidebarCollapse";
import { useUserSession } from "@/hooks/useUserSession";
import { useNotificationsCenter } from "@/hooks/useNotificationsCenter";
import { useGlobalSearch } from "@/hooks/useGlobalSearch";
import { RECRUITER_NAV_ITEMS } from "@/components/recruiter/recruiterNav";
import styles from "./recruiter-shell.module.css";

const COLLAPSE_KEY = "recruiter_sidebar_collapsed";

export default function RecruiterShell({ activeKey, capability, title, subtitle, children }) {
  const router = useRouter();
  const pathname = usePathname();

  const user = useUserSession({ pathname, watchEvents: ["talent-user-updated", "storage"] });
  const [sidebarCollapsed, toggleSidebar] = useSidebarCollapse(COLLAPSE_KEY);
  const handleLogout = useLogout();

  const {
    notifOpen,
    setNotifOpen,
    notifications,
    unreadCount,
    notifBusy,
    markAllRead,
    markOneRead,
  } = useNotificationsCenter({
    limit: 20,
    toastIdPrefix: "recruiter-notif",
    broadcastOnRefresh: true,
    broadcastOnMarkAll: true,
    broadcastOnMarkOne: true,
  });

  const search = useGlobalSearch();

  function handleNotificationClick(notification) {
    if (!notification.read) markOneRead(notification.id);
    setNotifOpen(false);
    if (!notification.link) return;
    if (notification.type === "certificate_uploaded" || notification.link.startsWith("/dashboard/recruiter/learning")) {
      const certificateId = notification.related_id || notification.relatedId;
      const params = new URLSearchParams({ tab: "certificates" });
      if (certificateId) params.set("certificateId", certificateId);
      router.push(`/dashboard/recruiter/learning?${params.toString()}`);
      return;
    }
    if (notification.type === "announcement") {
      router.push("/dashboard/recruiter/announcements");
      return;
    }
    if (notification.type === "hr_message") {
      const threadId = notification.related_id || notification.relatedId;
      if (threadId) {
        router.push(`/dashboard/recruiter/messages?thread=${encodeURIComponent(threadId)}`);
      } else if (notification.link) {
        router.push(notification.link);
      } else {
        router.push("/dashboard/recruiter/messages");
      }
      return;
    }
    if (notification.type === "invitation_sent") {
      router.push("/dashboard/recruiter/invite");
    } else if (notification.type === "intake_submitted" || notification.type === "offer_signed") {
      router.push("/dashboard/recruiter/candidates");
    } else if (notification.link.startsWith("/dashboard/recruiter/employees")) {
      router.push(notification.link);
    } else if (notification.link.includes("#")) {
      router.push(notification.link);
    } else {
      router.push(notification.link);
    }
  }

  function handleSearchSelect(result) {
    search.setSelected(result);
    search.setOpen(false);
    search.setQuery(result.full_name || "");
    if (result.href) {
      router.push(result.href);
      return;
    }
    if (result.type === "employee" || result.type === "historical_employee") {
      router.push(`/dashboard/recruiter/employees/${result.id}`);
      return;
    }
    if (result.type === "candidate" || result.type === "historical_candidate") {
      router.push(`/dashboard/recruiter/candidates/${result.id}`);
      return;
    }
    router.push("/dashboard/recruiter/candidates");
  }

  const allowedNavItems = RECRUITER_NAV_ITEMS.filter((item) => {
    if (!item.capability) return true;
    return user?.capabilities?.[item.capability] ?? true;
  });

  const hasCapability = !capability || (user?.capabilities?.[capability] ?? true);

  if (!user) {
    return <RecruiterLoader />;
  }

  if (capability && !hasCapability) {
    return (
      <RequireAccess
        anyOf={["recruitment.view", "recruitment.invite"]}
        roles={["recruiter", "super_admin"]}
        fallback={<RecruiterLoader />}
      >
        <div className={styles.root} data-app-shell>
          <div className={styles.app}>
            <aside className={`${styles.sidebar} ${sidebarCollapsed ? styles.sidebarCollapsed : ""}`}>
              <SidebarBrand
                collapsed={sidebarCollapsed}
                className={styles.brand}
                markClassName={styles.brandMark}
                onClick={toggleSidebar}
              />
              <div className={styles.navSectionLabel}>Recruiting</div>
              <ul className={styles.nav}>
                {allowedNavItems.map((item) => {
                  const isActive = activeKey === item.key;
                  return (
                    <li key={item.key}>
                      <button
                        type="button"
                        className={`${styles.navItem} ${isActive ? styles.navItemActive : ""}`}
                        onClick={() => router.push(item.href)}
                        title={item.label}
                      >
                        <span className={styles.navIcon}>{item.icon}</span>
                        <span className={styles.navLabel}>{item.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className={styles.sidebarFooter}>
                <ProfileAvatar src={user.profile_picture} name={user.full_name} size="sm" fallback="RC" />
                <div className={styles.sidebarFooterText}>
                  <div className={styles.name}>{user.full_name}</div>
                  <div className={styles.role}>{user.role?.replace("_", " ")}</div>
                </div>
                <button type="button" className={styles.logoutBtn} title="Log out" onClick={handleLogout}>
                  <LogoutIcon />
                </button>
              </div>
            </aside>
            <main className={styles.main}>
              <div className={styles.topbar}>
                <div className={styles.topbarLeft}>
                  <div className={styles.topbarTitle}>{title || "Recruiter"}</div>
                </div>
              </div>
              <div className={styles.content}>
                <div style={{ padding: "3rem", textAlign: "center" }}>
                  <div style={{ fontSize: 48, marginBottom: 16 }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="48" height="48" style={{ color: "#dc2626" }}>
                      <circle cx="12" cy="12" r="10" />
                      <line x1="15" y1="9" x2="9" y2="15" />
                      <line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                  </div>
                  <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Access denied</h2>
                  <p style={{ color: "var(--text-muted)", marginBottom: 20, maxWidth: 400, margin: "0 auto 20px" }}>
                    This feature has been disabled for your account. Contact the Super Admin to request access.
                  </p>
                  <button
                    type="button"
                    onClick={() => router.push("/dashboard/recruiter/overview")}
                    style={{ padding: "8px 24px", background: "#0D5C91", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                  >
                    Back to overview
                  </button>
                </div>
              </div>
            </main>
          </div>
        </div>
      </RequireAccess>
    );
  }

  return (
    <RequireAccess
      anyOf={["recruitment.view", "recruitment.invite"]}
      roles={["recruiter", "super_admin"]}
      fallback={<RecruiterLoader />}
    >
      <div className={styles.root} data-app-shell>
        <div className={styles.app}>
          <aside className={`${styles.sidebar} ${sidebarCollapsed ? styles.sidebarCollapsed : ""}`}>
            <SidebarBrand
              collapsed={sidebarCollapsed}
              className={styles.brand}
              markClassName={styles.brandMark}
              onClick={toggleSidebar}
            />

            <div className={styles.navSectionLabel}>Recruiting</div>
            <ul className={styles.nav}>
              {allowedNavItems.map((item) => {
                const isActive = activeKey
                  ? activeKey === item.key
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.key}>
                    <button
                      type="button"
                      className={`${styles.navItem} ${isActive ? styles.navItemActive : ""}`}
                      onClick={() => router.push(item.href)}
                      title={item.label}
                    >
                      <span className={styles.navIcon}>{item.icon}</span>
                      <span className={styles.navLabel}>{item.label}</span>
                    </button>
                  </li>
                );
              })}
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
                <div className={styles.searchWrap}>
                  <div className={styles.searchBox}>
                    <SearchIcon />
                    <input
                      value={search.query}
                      onChange={(event) => {
                        search.setQuery(event.target.value);
                        search.setOpen(true);
                      }}
                      onFocus={() => search.setOpen(true)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        search.submitNow();
                      }}
                      onBlur={() => setTimeout(() => search.setOpen(false), 150)}
                      placeholder="Ask AI or search candidates…"
                      aria-label="Search"
                    />
                  </div>
                  {search.open && search.query.trim().length >= 2 && (
                    <div className={styles.searchResults}>
                      {search.searching && <p className={styles.searchEmpty}>Searching…</p>}
                      {!search.searching && search.results.length === 0 && (
                        <p className={styles.searchEmpty}>No matches for “{search.query.trim()}”.</p>
                      )}
                      {!search.searching &&
                        search.results.map((result) => (
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

                <RoleSwitchButton user={user} />

                <div className={styles.dropdownWrap}>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    title="Notifications"
                    aria-label="Notifications"
                    onClick={() => setNotifOpen((value) => !value)}
                  >
                    <BellIcon />
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
                          onClick={markAllRead}
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
              {search.selected && (
                <div className={styles.selectionBox}>
                  <div>
                    <strong>{search.selected.full_name}</strong>
                    <div className={styles.mutedText}>
                      {search.selected.type} · {search.selected.email || "—"} · {search.selected.department || "—"}
                    </div>
                  </div>
                  <button type="button" className={styles.secondaryButton} onClick={() => search.setSelected(null)}>
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

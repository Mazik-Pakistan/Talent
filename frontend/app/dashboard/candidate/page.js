"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

<<<<<<< Updated upstream
import RequireAccess, { ModuleNav } from "@/components/RequireAccess";
import { clearLocalSession, getApiErrorMessage, getCandidateDashboard, getMyOffer, logout } from "@/services/authService";
=======
import RequireAccess from "@/components/RequireAccess";
import ProfileImageControl from "@/components/ProfileImageControl";
import {
  clearLocalSession,
  getApiErrorMessage,
  getCandidateDashboard,
  getMyOffer,
  logout,
} from "@/services/authService";
>>>>>>> Stashed changes
import DocumentStatusList from "@/components/DocumentStatusList";

const DASHBOARD_REFRESH_MS = 60000;

export default function CandidateDashboardPage() {
  return (
    <RequireAccess anyOf={["onboarding.self", "profile.view"]} roles={["candidate"]}>
      <CandidateDashboardContent />
    </RequireAccess>
  );
}

function CandidateDashboardContent() {
  const router = useRouter();
  const [user, setUser] = useState(null);

  // ----- US-018 / US-019 / US-021 / US-022 -----
  const [dashboard, setDashboard] = useState(null);
  const [offer, setOffer] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUser(JSON.parse(localStorage.getItem("user")));
  }, []);

  const loadDashboard = useCallback(async () => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      const [data, offerData] = await Promise.all([
        getCandidateDashboard(accessToken),
        getMyOffer(accessToken).catch(() => null),
      ]);
      setDashboard(data);
      setOffer(offerData?.offer || null);
      setLoadError("");
    } catch (error) {
      setLoadError(getApiErrorMessage(error, "Could not load your dashboard."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
    const interval = setInterval(loadDashboard, DASHBOARD_REFRESH_MS);
    return () => clearInterval(interval);
  }, [loadDashboard]);

  async function handleLogout() {
    const accessToken = localStorage.getItem("access_token");
    await logout(accessToken);
    clearLocalSession();
    router.replace("/login");
  }

<<<<<<< Updated upstream
  // ★ Unified navigation to onboarding with edit mode
  function goToEditProfile() {
    router.push("/onboarding?edit=true");
=======
  const profile = dashboard?.profile;
  const profileImage = profile?.profileImage || user?.profileImage;
  const progress = dashboard?.progress;
  const tasks = useMemo(() => dashboard?.tasks || [], [dashboard]);
  const announcements = useMemo(() => dashboard?.announcements || [], [dashboard]);
  const pct = progress?.percentage ?? 0;
  const completedCount = tasks.filter((t) => t.completed).length;

  // ----- Client-side "Search records" over the data already on this page -----
  const searchIndex = useMemo(() => {
    const rows = [
      { label: "Designation", value: profile?.job_title, anchor: "profile-section" },
      { label: "Department", value: profile?.department, anchor: "profile-section" },
      { label: "Office", value: profile?.office_location, anchor: "profile-section" },
      { label: "Joining date", value: formatDate(profile?.start_date), anchor: "profile-section" },
      { label: "Recruiter", value: profile?.recruiter?.full_name, anchor: "profile-section" },
      { label: "Offer status", value: offer?.status, anchor: "tasks-section" },
      ...tasks.map((t) => ({ label: "Task", value: t.label, anchor: "tasks-section" })),
      ...announcements.map((a) => ({ label: "Announcement", value: a.title, anchor: "announcements-section" })),
    ];
    return rows.filter((row) => row.value);
  }, [profile, offer, tasks, announcements]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return searchIndex.filter(
      (row) => row.label.toLowerCase().includes(q) || String(row.value).toLowerCase().includes(q)
    ).slice(0, 8);
  }, [searchQuery, searchIndex]);

  function goToResult(anchor) {
    setSearchOpen(false);
    setSearchQuery("");
    document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
>>>>>>> Stashed changes
  }

  if (!user) {
    return <p style={{ textAlign: "center", marginTop: "2rem" }}>Loading…</p>;
  }

  const profile = dashboard?.profile;
  const progress = dashboard?.progress;
  const tasks = dashboard?.tasks || [];
  const announcements = dashboard?.announcements || [];

  return (
<<<<<<< Updated upstream
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Candidate dashboard</p>
          <h1>Welcome, {user.full_name}</h1>
          <p>Signed in as {user.email} · Role: {user.role}</p>
          <ModuleNav role={user.role} />
=======
    <div className={styles.root}>
      <div className={styles.app}>
        {/* Sidebar */}
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
            {NAV_ITEMS.map((item) => (
              <li key={item.key}>
                <button
                  type="button"
                  className={`${styles.navItem} ${item.disabled ? styles.disabled : ""}`}
                  onClick={() => item.href && router.push(item.href)}
                  title={item.disabled ? `${item.label} — coming in Phase 3` : item.label}
                  disabled={item.disabled}
                >
                  {item.icon}
                  <span className={styles.navLabel}>{item.label}</span>
                  {item.badge && <span className={styles.navBadge}>{item.badge}</span>}
                </button>
              </li>
            ))}
          </ul>

          <div className={styles.sidebarFooter}>
            <div className={styles.avatarSm}>
              {profileImage?.secure_url ? (
                <img
                  src={profileImage.secure_url}
                  alt={user.full_name}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              ) : (
                initials
              )}
            </div>
            <div className={styles.sidebarFooterText}>
              <div className={styles.name}>{user.full_name}</div>
              <div className={styles.role}>{profile?.job_title || "Candidate"}</div>
            </div>
            <button type="button" className={styles.logoutBtn} title="Log out" onClick={handleLogout}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" />
              </svg>
            </button>
          </div>
        </aside>

        {/* Main */}
        <main className={styles.main}>
          <div className={styles.topbar}>
            <div>
              <div className={styles.topbarTitle}>Candidate Dashboard</div>
              <div className={styles.topbarSub}>
                {profile?.job_title || "—"} · {profile?.department || "—"}
              </div>
            </div>
            <div className={styles.topbarActions}>
              <div className={styles.searchWrap}>
                <div className={styles.searchBox}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
                  </svg>
                  <input
                    placeholder="Search records…"
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
                    onFocus={() => setSearchOpen(true)}
                    onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                  />
                </div>
                {searchOpen && searchQuery.trim().length >= 2 && (
                  <div className={styles.searchResults}>
                    {searchResults.length ? (
                      searchResults.map((row, i) => (
                        <div
                          key={`${row.label}-${i}`}
                          className={styles.searchResultItem}
                          role="button"
                          tabIndex={0}
                          onMouseDown={() => goToResult(row.anchor)}
                        >
                          <div className={styles.searchResultLabel}>{row.label}</div>
                          <div className={styles.searchResultMeta}>{String(row.value)}</div>
                        </div>
                      ))
                    ) : (
                      <div className={styles.searchEmpty}>No matches on this page.</div>
                    )}
                  </div>
                )}
              </div>

              <div className={styles.dropdownWrap}>
                <div
                  className={styles.iconBtn}
                  title="Notifications"
                  role="button"
                  tabIndex={0}
                  onClick={() => setNotifOpen((v) => !v)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
                  </svg>
                  {announcements.length > 0 && <span className={styles.dot} />}
                </div>
                {notifOpen && (
                  <div className={styles.notifPanel}>
                    <strong>Notifications</strong>
                    {announcements.length
                      ? `You have ${announcements.length} announcement(s) from the recruiting team — see the Announcements panel below.`
                      : "In-app notifications for candidate accounts are landing in a later phase — you'll see onboarding updates here once that ships."}
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
                  <circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" />
                </svg>
              </div>
            </div>
          </div>

          <div className={styles.content}>
            {loadError && <div className={styles.loadError} role="alert">{loadError}</div>}

            {/* Hero */}
            <div className={styles.hero}>
              <div>
                <div className={styles.heroEyebrow}>Candidate Dashboard</div>
                <h1>Welcome, {user.full_name}</h1>
                <div className={styles.heroMeta}>
                  Signed in as <b>{user.email}</b> · Role: <b>Candidate</b>
                </div>
                <div className={styles.heroChips}>
                  {profile?.start_date && <span className={styles.chip}>Joins {formatDate(profile.start_date)}</span>}
                  {offer?.status === "signed" && <span className={`${styles.chip} ${styles.complete}`}>✓ Offer signed</span>}
                  <span className={`${styles.chip} ${pct === 100 ? styles.complete : styles.incomplete}`}>
                    {pct === 100 ? "✓ Onboarding complete" : "Onboarding in progress"}
                  </span>
                </div>
              </div>
              <div className={styles.ringWrap}>
                <HeroRing percentage={pct} />
                <div className={styles.ringLabel}>Onboarding<br />progress</div>
              </div>
            </div>

            {offer && !["signed", "approved", "declined", "expired"].includes(offer.status) && (
              <div className={styles.banner}>
                <div className={styles.bannerCopy}>
                  <h3>Offer letter ready to review</h3>
                  <p>Your recruiter has sent an offer letter. Open it here to review the terms and sign digitally.</p>
                </div>
                <button type="button" className={styles.btnPrimary} onClick={() => router.push("/offer")}>
                  Review and sign offer
                </button>
              </div>
            )}

            {/* Stats */}
            <div className={styles.stats}>
              <StatCard
                icon={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>}
                tone="cyan"
                value={tasks.length}
                label="Onboarding tasks"
              />
              <StatCard
                icon={<><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></>}
                tone="green"
                value={completedCount}
                label="Completed"
              />
              <StatCard
                icon={<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></>}
                tone="orange"
                value={offer?.status || "—"}
                label="Offer status"
              />
              <StatCard
                icon={<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>}
                tone="purple"
                value="Phase 3"
                label="Learning modules unlock"
              />
            </div>

            {/* Hiring profile */}
            <div className={styles.section} id="profile-section">
              <div className={styles.sectionHead}>
                <div className={styles.sectionHeadLeft}>
                  <div className={`${styles.bar} ${styles.navy}`} />
                  <div>
                    <div className={styles.sectionTitle}>Hiring profile</div>
                    <div className={styles.sectionDesc}>Core profile record synced from onboarding.</div>
                  </div>
                </div>
              </div>
              <div className={styles.sectionBody}>
                {!loading && (
                  <div style={{ marginBottom: 16 }}>
                    <ProfileImageControl
                      user={user}
                      profileImage={profileImage}
                      required
                      label="Candidate profile image"
                      description="Upload a clear JPG, PNG, or WEBP image before submitting your profile."
                      allowDelete={false}
                      onChange={(nextProfileImage) =>
                        setDashboard((current) =>
                          current
                            ? {
                                ...current,
                                profile: {
                                  ...(current.profile || {}),
                                  profileImage: nextProfileImage,
                                },
                              }
                            : current
                        )
                      }
                    />
                  </div>
                )}
                {loading ? (
                  <p className={styles.emptySub}>Loading…</p>
                ) : (
                  <div className={styles.fieldGrid}>
                    <Field label="Designation" value={profile?.job_title} styles={styles} />
                    <Field label="Department" value={profile?.department} styles={styles} />
                    <Field label="Office location" value={profile?.office_location} styles={styles} />
                    <Field label="Joining date" value={formatDate(profile?.start_date)} styles={styles} />
                    <Field label="Recruiter" value={profile?.recruiter?.full_name} styles={styles} />
                  </div>
                )}
              </div>
            </div>

            <div className={styles.cols2}>
              <div className={styles.dashboardStack}>
                {/* Onboarding tasks */}
                <div className={styles.section} style={{ marginBottom: 0 }} id="tasks-section">
                  <div className={styles.sectionHead}>
                    <div className={styles.sectionHeadLeft}>
                      <div className={`${styles.bar} ${styles.cyan}`} />
                      <div>
                        <div className={styles.sectionTitle}>Onboarding tasks</div>
                        <div className={styles.sectionDesc}>Steps to complete before your start date.</div>
                      </div>
                    </div>
                  </div>
                  <div className={styles.sectionBody}>
                    <ul className={styles.taskList}>
                      {tasks.map((task) => (
                        <li key={task.id}>
                          <button
                            type="button"
                            className={`${styles.taskItem} ${task.completed ? styles.completed : ""} ${!task.available ? styles.disabled : ""}`}
                            disabled={!task.available}
                            onClick={() => task.available && !task.completed && router.push(`/onboarding?step=${task.action_step || ""}`)}
                          >
                            <span className={styles.taskCheck}>
                              {task.completed && (
                                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3">
                                  <path d="M20 6L9 17l-5-5" />
                                </svg>
                              )}
                            </span>
                            <span className={styles.taskLabel}>{task.label}</span>
                            {!task.available && <span className={styles.taskTag}>Coming soon</span>}
                          </button>
                        </li>
                      ))}
                      {!loading && tasks.length === 0 && <p className={styles.emptySub}>No tasks yet.</p>}
                    </ul>
                  </div>
                </div>

                {/* My documents */}
                <div className={styles.section} style={{ marginBottom: 0 }} id="documents-section">
                  <div className={styles.sectionHead}>
                    <div className={styles.sectionHeadLeft}>
                      <div className={`${styles.bar} ${styles.orange}`} />
                      <div>
                        <div className={styles.sectionTitle}>My documents</div>
                        <div className={styles.sectionDesc}>Identity &amp; education files with live verification status.</div>
                      </div>
                    </div>
                  </div>
                  <div className={styles.sectionBody}>
                    <DocumentStatusList />
                  </div>
                </div>
              </div>

              {/* Announcements */}
              <div className={styles.section} style={{ marginBottom: 0 }} id="announcements-section">
                <div className={styles.sectionHead}>
                  <div className={styles.sectionHeadLeft}>
                    <div className={`${styles.bar} ${styles.green}`} />
                    <div>
                      <div className={styles.sectionTitle}>Announcements</div>
                      <div className={styles.sectionDesc}>Updates from the recruiting team.</div>
                    </div>
                  </div>
                </div>
                <div className={styles.sectionBody}>
                  <div className={styles.announcementStack}>
                    {loading ? (
                      <p className={styles.emptySub}>Loading…</p>
                    ) : announcements.length ? (
                      announcements.map((a) => (
                        <article className={styles.announcementCard} key={a.id}>
                          <h4>{a.title}</h4>
                          <p>{a.body}</p>
                          <p className={styles.announcementMeta}>
                            {a.created_by_name || "Recruiting team"} · {formatDate(a.created_at)}
                          </p>
                        </article>
                      ))
                    ) : (
                      <p className={styles.emptySub}>No announcements yet.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Workplace modules */}
            <div className={styles.section} style={{ marginTop: 24, marginBottom: 0 }}>
              <div className={styles.sectionHead}>
                <div className={styles.sectionHeadLeft}>
                  <div className={`${styles.bar} ${styles.purple}`} />
                  <div>
                    <div className={styles.sectionTitle}>Workplace modules</div>
                    <div className={styles.sectionDesc}>Learning &amp; AI coaching unlock after onboarding.</div>
                  </div>
                </div>
              </div>
              <div className={styles.sectionBody}>
                <div className={styles.modulesGrid}>
                  <ModuleCard
                    styles={styles}
                    title="Learning modules"
                    desc="Assigned courses and skill paths will appear here once Learning launches."
                    icon={<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>}
                  />
                  <ModuleCard
                    styles={styles}
                    title="AI Coach"
                    desc="Your personal AI coaching sessions and progress will appear here."
                    icon={<><path d="M12 2a5 5 0 0 1 5 5v2a5 5 0 0 1-10 0V7a5 5 0 0 1 5-5z" /><path d="M19 11a7 7 0 0 1-14 0M12 18v4" /></>}
                  />
                </div>
              </div>
            </div>

            <div className={styles.footerNote}>Talent by Mazik Global Pakistan · Candidate Dashboard</div>
          </div>
        </main>
      </div>
    </div>
  );
}

function Field({ label, value, styles }) {
  return (
    <div>
      <div className={styles.fieldLabel}>{label}</div>
      <div className={`${styles.fieldValue} ${!value ? styles.dim : ""}`}>{value || "Not assigned"}</div>
    </div>
  );
}

function ModuleCard({ title, desc, icon, styles }) {
  return (
    <div className={styles.moduleCard}>
      <div className={styles.phaseBadge}>PHASE 3</div>
      <div className={styles.moduleIcon}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{icon}</svg>
      </div>
      <div className={styles.moduleTitle}>{title}</div>
      <div className={styles.moduleDesc}>{desc}</div>
      <div className={styles.progressTrack}><div className={styles.progressFill} style={{ width: "0%" }} /></div>
    </div>
  );
}

function StatCard({ icon, tone, value, label }) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statTop}>
        <div className={`${styles.statIcon} ${styles[tone]}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{icon}</svg>
>>>>>>> Stashed changes
        </div>
        <div className="dashboard-actions">
          {/* ★ Replaced "Open onboarding" with "Edit Profile" */}
          <button type="button" className="secondary-button" onClick={goToEditProfile}>
            Edit Profile
          </button>
          <button type="button" className="primary-button" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      {loadError && (
        <section className="dashboard-card wide">
          <p className="form-message" role="alert">{loadError}</p>
        </section>
      )}

      {!loading && offer && offer.status !== "approved" && (
        <section className="dashboard-card wide" style={{ padding: 0, background: "transparent", border: "none", boxShadow: "none" }}>
          <div className="profile-incomplete-banner" style={{ background: offer.status === "signed" ? "linear-gradient(120deg, #f3faf7, #ffffff)" : undefined, borderColor: offer.status === "signed" ? "#bfe3d2" : undefined }}>
            <div className="banner-copy">
              <h3 style={{ color: offer.status === "signed" ? "#087a55" : undefined }}>
                {offer.status === "signed" ? "Offer signed — awaiting HR approval" : "Your offer letter has arrived"}
              </h3>
              <p style={{ color: offer.status === "signed" ? "#3a6f5a" : undefined }}>
                {offer.status === "signed"
                  ? `You signed the ${offer.job_title} offer. HR will approve it and issue your Employee ID shortly.`
                  : `Review and digitally sign your offer for ${offer.job_title}.`}
              </p>
            </div>
            {offer.status !== "signed" && (
              <button type="button" className="primary-button" onClick={() => router.push("/offer")}>
                Review my offer
              </button>
            )}
          </div>
        </section>
      )}

      {/* US-022: personalized welcome + profile facts */}
      <section className="dashboard-card wide" aria-labelledby="profile-heading">
        <div className="profile-header">
          <span className="avatar-circle">{loading ? "…" : profile?.initials || "?"}</span>
          <div>
            <p className="eyebrow" style={{ marginBottom: 4 }}>Hiring profile</p>
            <h2 id="profile-heading" style={{ margin: 0 }}>{profile?.full_name || user.full_name}</h2>
          </div>
        </div>
        <dl className="profile-facts">
          <div className="profile-fact">
            <dt>Designation</dt>
            <dd>{profile?.job_title || "—"}</dd>
          </div>
          <div className="profile-fact">
            <dt>Department</dt>
            <dd>{profile?.department || "—"}</dd>
          </div>
          <div className="profile-fact">
            <dt>Office location</dt>
            <dd>{profile?.office_location || "Not yet assigned"}</dd>
          </div>
          <div className="profile-fact">
            <dt>Joining date</dt>
            <dd>{formatDate(profile?.start_date)}</dd>
          </div>
          <div className="profile-fact">
            <dt>Recruiter contact</dt>
            <dd>
              {profile?.recruiter?.full_name || profile?.recruiter?.email || "—"}
              {profile?.recruiter?.email && profile?.recruiter?.full_name && (
                <>
                  <br />
                  <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: ".8rem" }}>
                    {profile.recruiter.email}
                  </span>
                </>
              )}
            </dd>
          </div>
        </dl>
      </section>

      <div className="dashboard-columns">
        <div className="dashboard-stack">
          {/* US-019: onboarding progress tracker */}
          <section className="dashboard-card wide" aria-labelledby="progress-heading">
            <h2 id="progress-heading">Onboarding progress</h2>
            <div className="progress-row">
              <span className="progress-percentage">{loading ? "—" : `${progress?.percentage ?? 0}%`}</span>
              <div className="progress-bar-track">
                <div className="progress-bar-fill" style={{ width: `${progress?.percentage ?? 0}%` }} />
              </div>
            </div>

            {/* US-021: candidate task list */}
            <ul className="task-list">
              {tasks.map((task) => (
                <li key={task.id}>
                  <button
                    type="button"
                    className={`task-item ${task.completed ? "completed" : ""} ${!task.available ? "disabled" : ""}`}
                    disabled={!task.available}
                    onClick={() =>
                      task.available && !task.completed && router.push(`/onboarding?step=${task.action_step || ""}`)
                    }
                  >
                    <span className="task-check">{task.completed ? "✓" : ""}</span>
                    <span className="task-label">{task.label}</span>
                    {!task.available && <span className="task-tag">Coming soon</span>}
                  </button>
                </li>
              ))}
              {!loading && tasks.length === 0 && <p className="empty-state">No tasks yet.</p>}
            </ul>
          </section>

          {/* Learning + AI Coach shortcuts (Phase 3) */}
          <section className="dashboard-card wide" aria-labelledby="widgets-heading">
            <h2 id="widgets-heading">Learning &amp; AI Coach</h2>
            <div className="dashboard-columns" style={{ marginTop: 0 }}>
              <div className="widget-placeholder">🎓 Assigned learning modules will appear here once Phase 3 launches.</div>
              <div className="widget-placeholder">🤖 Your AI Coach assistant will appear here once Phase 3 launches.</div>
            </div>
          </section>

          <section className="dashboard-card wide" id="documents-section">
            <h2>My documents</h2>
            <p>Government ID and education documents you&apos;ve uploaded, with live OCR/verification status.</p>
            <DocumentStatusList />
          </section>
        </div>

        {/* US-020: announcements */}
        <section className="dashboard-card" aria-labelledby="announcements-heading">
          <h2 id="announcements-heading" style={{ fontSize: "1.1rem" }}>Announcements</h2>
          <div className="announcement-stack">
            {loading ? (
              <p className="empty-state">Loading…</p>
            ) : announcements.length ? (
              announcements.map((announcement) => (
                <article className="announcement-card" key={announcement.id}>
                  <h4>{announcement.title}</h4>
                  <p>{announcement.body}</p>
                  <p className="announcement-meta">
                    {announcement.created_by_name || "Recruiting team"} · {formatDate(announcement.created_at)}
                  </p>
                </article>
              ))
            ) : (
              <p className="empty-state">No announcements yet.</p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function formatDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
<<<<<<< Updated upstream
}
=======
}

function initialsFor(name) {
  if (!name) return "CA";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "CA";
}
>>>>>>> Stashed changes

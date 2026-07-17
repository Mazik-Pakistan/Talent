"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

import RequireAccess from "@/components/RequireAccess";
import {
  clearLocalSession,
  getApiErrorMessage,
  getMyEmployeeProfile,
  getProfileCompletion,
  listMyDocuments,
  logout,
} from "@/services/authService";
import { ROLE_HOME, moduleAccess } from "@/services/rbac";
import DocumentManager from "@/components/DocumentManager";
import styles from "./employee-dashboard.module.css";

const NAV_ITEMS = [
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
    href: "/onboarding",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" />
      </svg>
    ),
  },
  {
    key: "learning",
    label: "Learning",
    module: "learning",
    href: null,
    badge: "PHASE 3",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
  },
  {
    key: "ai",
    label: "AI Coach",
    module: "ai",
    href: null,
    badge: "PHASE 3",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2a5 5 0 0 1 5 5v2a5 5 0 0 1-10 0V7a5 5 0 0 1 5-5z" /><path d="M19 11a7 7 0 0 1-14 0M12 18v4" />
      </svg>
    ),
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

export default function EmployeeDashboardPage() {
  return (
    <RequireAccess anyOf={["onboarding.self", "profile.view"]} roles={["employee"]}>
      <EmployeeDashboardContent />
    </RequireAccess>
  );
}

function EmployeeDashboardContent() {
  const router = useRouter();
  const pathname = usePathname();

  const [user, setUser] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [progress, setProgress] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);

  const [docCount, setDocCount] = useState(0);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    setUser(JSON.parse(localStorage.getItem("user")));
  }, []);

  const loadProfile = useCallback(async () => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      const [profileData, completionData] = await Promise.all([
        getMyEmployeeProfile(accessToken),
        getProfileCompletion(accessToken).catch(() => null),
      ]);
      setEmployee(profileData.employee);
      setProgress(completionData?.progress || null);
      setLoadError("");
    } catch (error) {
      setLoadError(getApiErrorMessage(error, "Could not load your employee profile."));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDocCount = useCallback(() => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    listMyDocuments(accessToken)
      .then((data) => setDocCount((data.documents || []).length))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadProfile();
    loadDocCount();
  }, [loadProfile, loadDocCount]);

  async function handleLogout() {
    const accessToken = localStorage.getItem("access_token");
    await logout(accessToken);
    clearLocalSession();
    router.replace("/login");
  }

  const modules = useMemo(() => moduleAccess(user?.role), [user?.role]);

  const onboarding = useMemo(() => employee?.onboarding || {}, [employee]);
  const profileIncomplete = employee?.profile_status === "incomplete";
  const percentage = progress?.percentage ?? (profileIncomplete ? 0 : 100);
  const documentsSummary = onboarding?.government_docs?.documents?.length ?? null;

  // ----- Client-side "Search records" over the data already on this page -----
  const searchIndex = useMemo(() => {
    if (!employee) return [];
    const rows = [
      { label: "Employee ID", value: employee.employee_id, anchor: "profile-section" },
      { label: "Designation", value: employee.job_title, anchor: "profile-section" },
      { label: "Department", value: employee.department, anchor: "profile-section" },
      { label: "Reporting manager", value: employee.reporting_manager, anchor: "profile-section" },
      { label: "Office location", value: employee.office_location, anchor: "profile-section" },
      { label: "Joining date", value: formatDate(employee.start_date), anchor: "profile-section" },
      { label: "Personal", value: summarize(onboarding.personal), anchor: "onboarding-section" },
      { label: "Emergency contact", value: summarize(onboarding.emergency), anchor: "onboarding-section" },
      { label: "Payroll", value: summarize(onboarding.employment), anchor: "onboarding-section" },
      { label: "NDA", value: onboarding.nda?.full_legal_name || "Not on file", anchor: "onboarding-section" },
      { label: "Resume", value: onboarding.resume?.file_name || "Not on file", anchor: "onboarding-section" },
    ];
    return rows.filter((row) => row.value);
  }, [employee, onboarding]);

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
  }

  if (!user) {
    return <p style={{ textAlign: "center", marginTop: "2rem" }}>Loading…</p>;
  }

  const initials = initialsFor(employee?.full_name || user.full_name);

  return (
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
            {NAV_ITEMS.map((item) => {
              const enabled = item.module ? modules[item.module] : true;
              if (!enabled) return null;
              const isActive = item.href && pathname === item.href;
              const disabled = !item.href;
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    className={`${styles.navItem} ${isActive ? styles.active : ""} ${disabled ? styles.disabled : ""}`}
                    onClick={() => item.href && router.push(item.href)}
                    title={disabled ? `${item.label} — coming in Phase 3` : item.label}
                    disabled={disabled}
                  >
                    {item.icon}
                    <span className={styles.navLabel}>{item.label}</span>
                    {item.badge && <span className={styles.navBadge}>{item.badge}</span>}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className={styles.sidebarFooter}>
            <div className={styles.avatarSm}>{initials}</div>
            <div className={styles.sidebarFooterText}>
              <div className={styles.name}>{employee?.full_name || user.full_name}</div>
              <div className={styles.role}>{employee?.job_title || "Employee"}</div>
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
              <div className={styles.topbarTitle}>Employee Dashboard</div>
              <div className={styles.topbarSub}>
                {employee?.employee_id || "—"} · {employee?.department || "—"}
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
                      searchResults.map((row) => (
                        <div
                          key={row.label}
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
                </div>
                {notifOpen && (
                  <div className={styles.notifPanel}>
                    <strong>Notifications</strong>
                    In-app notifications for employee accounts are landing in a later phase — you&apos;ll see document
                    and onboarding updates here once that ships.
                  </div>
                )}
              </div>

              <div
                className={styles.iconBtn}
                title="Edit profile"
                role="button"
                tabIndex={0}
                onClick={() => router.push("/dashboard/employee/complete-profile")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" />
                </svg>
              </div>
            </div>
          </div>

          <div className={styles.content}>
            {loadError && <div className={styles.loadError} role="alert">{loadError}</div>}

            {!loading && profileIncomplete && (
              <div className={styles.banner}>
                <MiniRing percentage={percentage} />
                <div className={styles.bannerCopy}>
                  <h3>Your profile is incomplete</h3>
                  <p>
                    Add your emergency contact, banking details, references, sign the NDA, and acknowledge company
                    policies to unlock your full workspace.
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.btnPrimary}
                  onClick={() => router.push("/dashboard/employee/complete-profile")}
                >
                  Complete my profile
                </button>
              </div>
            )}

            {/* Hero */}
            <div className={styles.hero}>
              <div>
                <div className={styles.heroEyebrow}>Employee Dashboard</div>
                <h1>Welcome, {employee?.full_name || user.full_name}</h1>
                <div className={styles.heroMeta}>
                  Signed in as <b>{user.email}</b> · Role: <b>Employee</b>
                  {employee?.employee_id ? <> · ID <b>{employee.employee_id}</b></> : null}
                </div>
                <div className={styles.heroChips}>
                  {employee?.start_date && <span className={styles.chip}>Joined {formatDate(employee.start_date)}</span>}
                  {employee?.converted_at && <span className={styles.chip}>Converted {formatDate(employee.converted_at)}</span>}
                  <span className={`${styles.chip} ${profileIncomplete ? styles.incomplete : styles.complete}`}>
                    {profileIncomplete ? "Profile incomplete" : "✓ Profile complete"}
                  </span>
                </div>
              </div>
              <div className={styles.ringWrap}>
                <HeroRing percentage={percentage} />
                <div className={styles.ringLabel}>Profile<br />completion</div>
              </div>
            </div>

            {/* Stats */}
            <div className={styles.stats}>
              <StatCard
                icon={<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />}
                iconExtra={<path d="M14 2v6h6" />}
                tone="cyan"
                value={docCount}
                label="Documents on file"
              />
              <StatCard
                icon={<><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></>}
                tone="green"
                value={profileIncomplete ? "Incomplete" : "Complete"}
                label="Onboarding status"
              />
              <StatCard
                icon={<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></>}
                tone="orange"
                value={tenureLabel(employee?.start_date)}
                label="Tenure since joining"
              />
              <StatCard
                icon={<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>}
                tone="navy"
                value="Phase 3"
                label="Learning modules unlock"
              />
            </div>

            {/* Employment profile */}
            <div className={styles.section} id="profile-section">
              <div className={styles.sectionHead}>
                <div className={styles.sectionHeadLeft}>
                  <div className={`${styles.bar} ${styles.navy}`} />
                  <div>
                    <div className={styles.sectionTitle}>Employment profile</div>
                    <div className={styles.sectionDesc}>Core employment record synced from HR onboarding.</div>
                  </div>
                </div>
              </div>
              <div className={styles.sectionBody}>
                {loading ? (
                  <p className={styles.emptySub}>Loading…</p>
                ) : (
                  <div className={styles.fieldGrid}>
                    <Field label="Employee ID" value={employee?.employee_id} styles={styles} />
                    <Field label="Designation" value={employee?.job_title} styles={styles} />
                    <Field label="Department" value={employee?.department} styles={styles} />
                    <Field label="Reporting manager" value={employee?.reporting_manager} styles={styles} />
                    <Field label="Office location" value={employee?.office_location} styles={styles} />
                    <Field label="Joining date" value={formatDate(employee?.start_date)} styles={styles} />
                    <Field label="Converted on" value={formatDate(employee?.converted_at)} styles={styles} />
                    <div>
                      <div className={styles.fieldLabel}>Profile status</div>
                      <span className={`${styles.statusPill} ${profileIncomplete ? styles.incomplete : ""}`}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                        {profileIncomplete ? "Incomplete" : "Complete"}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className={styles.cols2}>
              {/* My documents */}
              <div className={styles.section} style={{ marginBottom: 0 }} id="documents-section">
                <div className={styles.sectionHead}>
                  <div className={styles.sectionHeadLeft}>
                    <div className={`${styles.bar} ${styles.orange}`} />
                    <div>
                      <div className={styles.sectionTitle}>My documents</div>
                        <div className={styles.sectionDesc}>Organized by category with upload, download, and update actions.</div>
                      </div>
                    </div>
                  </div>
                  <div className={styles.sectionBody}>
                    <DocumentManager styles={styles} compact onChanged={loadDocCount} />
                  <div className={styles.sectionHeadLeft}>
                    <div className={`${styles.bar} ${styles.cyan}`} />
                    <div>
                      <div className={styles.sectionTitle}>Onboarding record</div>
                      <div className={styles.sectionDesc}>Preserved from your onboarding submission.</div>
                    </div>
                  </div>
                </div>
                <div className={styles.sectionBody}>
                  <div className={styles.recordGrid}>
                    <RecordItem
                      styles={styles}
                      label="Personal"
                      value={summarize(onboarding.personal)}
                      icon={<><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" /></>}
                    />
                    <RecordItem
                      styles={styles}
                      label="Emergency contact"
                      value={summarize(onboarding.emergency)}
                      icon={<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />}
                    />
                    <RecordItem
                      styles={styles}
                      label="Payroll"
                      value={summarize(onboarding.employment)}
                      icon={<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>}
                    />
                    <RecordItem
                      styles={styles}
                      label="Education"
                      value={`${onboarding.education?.entries?.length || 0} entr${(onboarding.education?.entries?.length || 0) === 1 ? "y" : "ies"}`}
                      icon={<><path d="M22 10L12 5 2 10l10 5 10-5z" /><path d="M6 12v5c3 2 9 2 12 0v-5" /></>}
                    />
                    <RecordItem
                      styles={styles}
                      label="Government docs"
                      value={documentsSummary !== null ? `${documentsSummary} document(s)` : "Not on file"}
                      icon={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>}
                    />
                    <RecordItem
                      styles={styles}
                      label="References"
                      value={`${onboarding.references?.references?.length || 0} reference(s)`}
                      icon={<><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" /></>}
                    />
                    <RecordItem
                      styles={styles}
                      label="NDA"
                      value={onboarding.nda?.full_legal_name ? `Signed · ${onboarding.nda.full_legal_name}` : "Not on file"}
                      icon={<><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></>}
                    />
                    <RecordItem
                      styles={styles}
                      label="Resume"
                      value={onboarding.resume?.file_name || "Not on file"}
                      icon={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Workplace modules */}
            <div className={styles.section} style={{ marginTop: 24, marginBottom: 0 }}>
              <div className={styles.sectionHead}>
                <div className={styles.sectionHeadLeft}>
                  <div className={`${styles.bar} ${styles.green}`} />
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

            <div className={styles.footerNote}>Talent by Mazik Global Pakistan · Employee Dashboard</div>
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

function RecordItem({ label, value, icon, styles }) {
  return (
    <div className={styles.recordItem}>
      <div className={styles.recordIcon}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{icon}</svg>
      </div>
      <div>
        <div className={styles.recordLabel}>{label}</div>
        <div className={styles.recordValue}>{value}</div>
      </div>
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

function StatCard({ icon, iconExtra, tone, value, label }) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statTop}>
        <div className={`${styles.statIcon} ${styles[tone]}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{icon}{iconExtra}</svg>
        </div>
      </div>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}

function HeroRing({ percentage = 0 }) {
  const r = 42;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (Math.min(100, Math.max(0, percentage)) / 100) * circumference;
  return (
    <svg className={styles.ring} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="9" />
      <circle
        cx="50" cy="50" r={r} fill="none" stroke="#1FAE7A" strokeWidth="9" strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={offset} transform="rotate(-90 50 50)"
      />
      <text x="50" y="55" textAnchor="middle" className={styles.ringValue}>{percentage}%</text>
    </svg>
  );
}

function MiniRing({ percentage = 0, size = 72, stroke = 7 }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, Math.max(0, percentage)) / 100) * circumference;
  return (
    <div style={{ width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#eee0b8" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#b8860b" strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x="50%" y="53%" textAnchor="middle" style={{ fontWeight: 800, fontSize: "1.05rem", fill: "#7a5c0a" }}>
          {percentage}%
        </text>
      </svg>
    </div>
  );
}

function summarize(obj) {
  if (!obj) return "Not provided";
  if (obj.full_name) return obj.full_name;
  if (obj.national_id) return `ID on file · ${obj.city || ""}`.trim();
  if (obj.bank_name) return obj.bank_name;
  if (obj.name) return obj.name;
  return "On file";
}

function formatDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function tenureLabel(startDate) {
  if (!startDate) return "—";
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return "—";
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  if (months < 0) return "Upcoming";
  if (months < 12) return `${months} mo`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem ? `${years} yr ${rem} mo` : `${years} yr`;
}

function initialsFor(name) {
  if (!name) return "EM";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "EM";
}

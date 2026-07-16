"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

<<<<<<< Updated upstream
import RequireAccess, { ModuleNav } from "@/components/RequireAccess";
=======
import RequireAccess from "@/components/RequireAccess";
import ProfileImageControl from "@/components/ProfileImageControl";
>>>>>>> Stashed changes
import {
  clearLocalSession,
  getApiErrorMessage,
  getMyEmployeeProfile,
  getProfileCompletion,
  logout,
} from "@/services/authService";
import ProgressRing from "@/components/ProgressRing";
import DocumentStatusList from "@/components/DocumentStatusList";

export default function EmployeeDashboardPage() {
  return (
    <RequireAccess anyOf={["onboarding.self", "profile.view"]} roles={["employee"]}>
      <EmployeeDashboardContent />
    </RequireAccess>
  );
}

function EmployeeDashboardContent() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [progress, setProgress] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  async function handleLogout() {
    const accessToken = localStorage.getItem("access_token");
    await logout(accessToken);
    clearLocalSession();
    router.replace("/login");
  }

<<<<<<< Updated upstream
=======
  const modules = useMemo(() => moduleAccess(user?.role), [user?.role]);

  const onboarding = useMemo(() => employee?.onboarding || {}, [employee]);
  const profileImage = employee?.profileImage || user?.profileImage;
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

>>>>>>> Stashed changes
  if (!user) {
    return <p style={{ textAlign: "center", marginTop: "2rem" }}>Loading…</p>;
  }

  const onboarding = employee?.onboarding || {};
  const profileIncomplete = employee?.profile_status === "incomplete";

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Employee dashboard</p>
          <h1>Welcome, {employee?.full_name || user.full_name}</h1>
          <p>
            Signed in as {user.email} · Role: {user.role}
            {employee?.employee_id ? <> · ID: <strong>{employee.employee_id}</strong></> : null}
          </p>
          <ModuleNav role={user.role} />
        </div>
        <button type="button" className="primary-button" onClick={handleLogout}>
          Log out
        </button>
      </header>

      {loadError && (
        <section className="dashboard-card wide">
          <p className="form-message" role="alert">{loadError}</p>
        </section>
      )}

<<<<<<< Updated upstream
      {!loading && profileIncomplete && (
        <section className="dashboard-card wide" style={{ padding: 0, background: "transparent", border: "none", boxShadow: "none", marginBottom: 0 }}>
          <div className="profile-incomplete-banner">
            <ProgressRing percentage={progress?.percentage ?? 0} />
            <div className="banner-copy">
              <h3>Your profile is incomplete</h3>
              <p>
                Add your emergency contact, banking details, references, sign the NDA, and acknowledge company
                policies to unlock your full workspace.
              </p>
=======
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
              <div className={styles.name}>{employee?.full_name || user.full_name}</div>
              <div className={styles.role}>{employee?.job_title || "Employee"}</div>
>>>>>>> Stashed changes
            </div>
            <button type="button" className="primary-button" onClick={() => router.push("/dashboard/employee/complete-profile")}>
              Complete my profile
            </button>
          </div>
        </section>
      )}

      <section className="dashboard-card wide" aria-labelledby="emp-profile-heading">
        <h2 id="emp-profile-heading">Employment profile</h2>
        {loading ? (
          <p className="empty-state">Loading…</p>
        ) : (
          <dl className="profile-facts">
            <div className="profile-fact">
              <dt>Employee ID</dt>
              <dd>{employee?.employee_id || "—"}</dd>
            </div>
            <div className="profile-fact">
              <dt>Designation</dt>
              <dd>{employee?.job_title || "—"}</dd>
            </div>
            <div className="profile-fact">
              <dt>Department</dt>
              <dd>{employee?.department || "—"}</dd>
            </div>
            <div className="profile-fact">
              <dt>Reporting manager</dt>
              <dd>{employee?.reporting_manager || "—"}</dd>
            </div>
            <div className="profile-fact">
              <dt>Office location</dt>
              <dd>{employee?.office_location || "—"}</dd>
            </div>
            <div className="profile-fact">
              <dt>Joining date</dt>
              <dd>{formatDate(employee?.start_date)}</dd>
            </div>
            <div className="profile-fact">
              <dt>Converted on</dt>
              <dd>{formatDate(employee?.converted_at)}</dd>
            </div>
            <div className="profile-fact">
              <dt>Profile status</dt>
              <dd><span className={`status-badge ${employee?.profile_status || "complete"}`}>{employee?.profile_status || "complete"}</span></dd>
            </div>
          </dl>
        )}
      </section>

      <div className="dashboard-columns">
        <div className="dashboard-stack">
          <section className="dashboard-card wide" id="documents-section">
            <h2>My documents</h2>
            <p>Identity and education documents you submitted during onboarding, with live verification status.</p>
            <DocumentStatusList />
          </section>

          <section className="dashboard-card wide">
            <h2>Onboarding record retained</h2>
            <p>All information collected during your onboarding is preserved on your employee profile.</p>
            <div className="form-grid" style={{ marginTop: 12 }}>
              <InfoCard title="Personal" body={summarize(onboarding.personal)} />
              <InfoCard title="Emergency contact" body={summarize(onboarding.emergency)} />
              <InfoCard title="Payroll" body={summarize(onboarding.employment)} />
              <InfoCard
                title="Education"
                body={`${onboarding.education?.entries?.length || 0} entr${(onboarding.education?.entries?.length || 0) === 1 ? "y" : "ies"}`}
              />
              <InfoCard
                title="Government docs"
                body={`${onboarding.government_docs?.documents?.length || 0} document(s)`}
              />
              <InfoCard
                title="References"
                body={`${onboarding.references?.references?.length || 0} reference(s)`}
              />
              <InfoCard title="NDA" body={onboarding.nda?.full_legal_name || "Not on file"} />
              <InfoCard title="Resume" body={onboarding.resume?.file_name || "Not on file"} />
            </div>
          </section>

<<<<<<< Updated upstream
          <section className="dashboard-card wide">
            <h2>Workplace modules</h2>
            <div className="dashboard-columns" style={{ marginTop: 0 }}>
              <div className="widget-placeholder">Assigned learning modules will appear here in Phase 3.</div>
              <div className="widget-placeholder">AI Coach will appear here in Phase 3.</div>
=======
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
                {!loading && (
                  <div style={{ marginBottom: 16 }}>
                    <ProfileImageControl
                      user={employee || user}
                      profileImage={profileImage}
                      label="Employee profile image"
                      description="Replace your Cloudinary profile image whenever you need to."
                      allowDelete={false}
                      onChange={(nextProfileImage) =>
                        setEmployee((current) => (current ? { ...current, profileImage: nextProfileImage } : current))
                      }
                    />
                  </div>
                )}
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
>>>>>>> Stashed changes
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function InfoCard({ title, body }) {
  return (
    <div className="profile-fact">
      <dt>{title}</dt>
      <dd>{body}</dd>
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

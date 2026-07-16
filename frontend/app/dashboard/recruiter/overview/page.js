"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import RecruiterShell from "@/components/recruiter/RecruiterShell";
import styles from "@/components/recruiter/recruiter-shell.module.css";
import {
  getAnnouncements,
  getApiErrorMessage,
  getDashboardActivity,
  getDashboardSummary,
  getPendingReview,
  getReadyForConversion,
} from "@/services/authService";

const ICONS = {
  overview: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  approvals: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 12l2 2 4-4" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  ),
  offers: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  ),
  activate: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9h6M7 13h10M7 17h4" />
    </svg>
  ),
  employees: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c1.2-3.5 3.8-5.5 6.5-5.5s5.3 2 6.5 5.5" />
      <circle cx="17.5" cy="8.5" r="2.5" />
      <path d="M15.5 14.3c2.3.4 4 2 5 5.7" />
    </svg>
  ),
};

const DASHBOARD_REFRESH_MS = 60000;

export default function RecruiterOverviewPage() {
  const router = useRouter();
  const [summary, setSummary] = useState(null);
  const [activities, setActivities] = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [pendingCandidates, setPendingCandidates] = useState([]);
  const [readyCandidates, setReadyCandidates] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDashboard = useCallback(async () => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      const [summaryData, activityData, pendingData, readyData, announcementsData] = await Promise.all([
        getDashboardSummary(accessToken),
        getDashboardActivity(accessToken, 8),
        getPendingReview(accessToken),
        getReadyForConversion(accessToken),
        getAnnouncements(accessToken, 4),
      ]);
      setSummary(summaryData);
      setActivities(activityData.activities || []);
      setPendingApprovals(summaryData.pending_approvals || []);
      setPendingCandidates(pendingData.candidates || []);
      setReadyCandidates(readyData.candidates || []);
      setAnnouncements(announcementsData.announcements || []);
      setError("");
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not load the recruiter overview."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
    const interval = setInterval(loadDashboard, DASHBOARD_REFRESH_MS);
    return () => clearInterval(interval);
  }, [loadDashboard]);

  const quickActions = useMemo(
    () => [
      { title: "Invite candidate", hint: "Send onboarding invitations", action: () => router.push("/dashboard/recruiter/invite") },
      { title: "Review approvals", hint: `${pendingApprovals.length} awaiting review`, action: () => router.push("/dashboard/recruiter/candidates") },
      { title: "Send offers", hint: `${pendingCandidates.length} pending offer action`, action: () => router.push("/dashboard/recruiter/candidates") },
      { title: "Activate employees", hint: `${readyCandidates.length} offer signed`, action: () => router.push("/dashboard/recruiter/candidates") },
      { title: "Employee directory", hint: "Browse active employees", action: () => router.push("/dashboard/recruiter/employees") },
      { title: "Announcements", hint: "Share updates with candidates", action: () => router.push("/dashboard/recruiter/announcements") },
    ],
    [pendingApprovals.length, pendingCandidates.length, readyCandidates.length, router]
  );

  return (
    <RecruiterShell activeKey="overview" title="Recruiter overview" subtitle="Real-time hiring pipeline and onboarding snapshots">
      {error && <div className={styles.formMessage} role="alert">{error}</div>}

      <div className={styles.hero} style={{ marginBottom: 20 }}>
        <div className={styles.heroEyebrow}>Recruiter dashboard</div>
        <h1>Keep the hiring pipeline moving</h1>
        <div className={styles.heroMeta}>Monitor onboarding, offers, approvals, and employee activation in one place.</div>
      </div>

      <div className={styles.stats}>
        <StatCard tone="green" value={loading ? "—" : summary?.kpis?.active_employees ?? 0} label="Active employees" icon={ICONS.employees} />
        <StatCard tone="orange" value={loading ? "—" : summary?.kpis?.pending_onboarding ?? 0} label="Pending onboarding" icon={ICONS.approvals} />
        <StatCard tone="cyan" value={loading ? "—" : summary?.kpis?.documents_pending ?? 0} label="Documents pending" icon={ICONS.offers} />
        <StatCard tone="navy" value={loading ? "—" : summary?.kpis?.upcoming_joinings ?? 0} label="Upcoming joinings" icon={ICONS.activate} />
      </div>

      <div className={styles.quickGrid}>
        {quickActions.map((action) => (
          <button key={action.title} type="button" className={styles.quickAction} onClick={action.action}>
            <span className={styles.qaIcon}>↗</span>
            <strong>{action.title}</strong>
            <span className={styles.qaHint}>{action.hint}</span>
          </button>
        ))}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <div className={`${styles.bar} ${styles.orange}`} />
            <div>
              <div className={styles.sectionTitle}>Pending approvals</div>
              <div className={styles.sectionDesc}>Candidates who just submitted onboarding and need attention.</div>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          {loading ? <p className={styles.emptySub}>Loading…</p> : pendingApprovals.length ? (
            <ul className={styles.miniList}>
              {pendingApprovals.map((item) => (
                <li className={styles.miniListItem} key={`${item.full_name}-${item.email}`}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div className={styles.avatarSm} style={{ width: 40, height: 40, flexShrink: 0 }}>
                      {item.profileImage?.secure_url ? (
                        <img
                          src={item.profileImage.secure_url}
                          alt={item.full_name}
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                        />
                      ) : (
                        initialsFor(item.full_name)
                      )}
                    </div>
                    <div>
                      <strong>{item.full_name}</strong>
                      <div className={styles.mutedText}>{item.job_title || "—"} · {item.department || "—"}</div>
                    </div>
                  </div>
                  <span className={styles.mutedText}>{formatDate(item.submitted_at)}</span>
                </li>
              ))}
            </ul>
          ) : <p className={styles.emptySub}>Nothing pending right now.</p>}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <div className={`${styles.bar} ${styles.cyan}`} />
            <div>
              <div className={styles.sectionTitle}>Offer review & activation</div>
              <div className={styles.sectionDesc}>Candidates waiting for offers and signed offers ready for activation.</div>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          <div className={styles.cols2}>
            <div>
              <h3 className={styles.sectionTitle} style={{ fontSize: 14, marginBottom: 10 }}>Pending offer review</h3>
              {pendingCandidates.length ? (
                <ul className={styles.miniList}>
                  {pendingCandidates.map((candidate) => (
                    <li className={styles.miniListItem} key={candidate.id}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div className={styles.avatarSm} style={{ width: 40, height: 40, flexShrink: 0 }}>
                          {candidate.profileImage?.secure_url ? (
                            <img
                              src={candidate.profileImage.secure_url}
                              alt={candidate.full_name}
                              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                            />
                          ) : (
                            initialsFor(candidate.full_name)
                          )}
                        </div>
                        <div>
                          <strong>{candidate.full_name}</strong>
                          <div className={styles.mutedText}>{candidate.email} · {candidate.job_title || "—"}</div>
                        </div>
                      </div>
                      <button type="button" className={styles.secondaryButton} onClick={() => router.push("/dashboard/recruiter/candidates")}>Open</button>
                    </li>
                  ))}
                </ul>
              ) : <p className={styles.emptySub}>No candidates currently need an offer step.</p>}
            </div>
            <div>
              <h3 className={styles.sectionTitle} style={{ fontSize: 14, marginBottom: 10 }}>Ready to activate</h3>
              {readyCandidates.length ? (
                <ul className={styles.miniList}>
                  {readyCandidates.map((candidate) => (
                    <li className={styles.miniListItem} key={candidate.offer_id}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div className={styles.avatarSm} style={{ width: 40, height: 40, flexShrink: 0 }}>
                          {candidate.profileImage?.secure_url ? (
                            <img
                              src={candidate.profileImage.secure_url}
                              alt={candidate.full_name}
                              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                            />
                          ) : (
                            initialsFor(candidate.full_name)
                          )}
                        </div>
                        <div>
                          <strong>{candidate.full_name}</strong>
                          <div className={styles.mutedText}>{candidate.email} · {candidate.department || "—"}</div>
                        </div>
                      </div>
                      <button type="button" className={styles.secondaryButton} onClick={() => router.push("/dashboard/recruiter/candidates")}>Approve</button>
                    </li>
                  ))}
                </ul>
              ) : <p className={styles.emptySub}>No signed offers awaiting approval.</p>}
            </div>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <div className={`${styles.bar} ${styles.green}`} />
            <div>
              <div className={styles.sectionTitle}>Recent activity</div>
              <div className={styles.sectionDesc}>Latest hiring and onboarding updates from the live backend.</div>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          {loading ? <p className={styles.emptySub}>Loading…</p> : activities.length ? (
            <ul className={styles.activityList}>
              {activities.map((activity, index) => (
                <li key={`${activity.action}-${activity.created_at}-${index}`}>
                  <span className={styles.activityDot} />
                  <div>
                    <div className={styles.activityLabel}>{activity.label}</div>
                    <div className={styles.activityMeta}>{activity.actor_email || activity.email || "system"} · {formatDateTime(activity.created_at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className={styles.emptySub}>No activity yet.</p>}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <div className={`${styles.bar} ${styles.purple}`} />
            <div>
              <div className={styles.sectionTitle}>Latest announcements</div>
              <div className={styles.sectionDesc}>Recent updates published to candidates.</div>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          {announcements.length ? (
            <div className={styles.announcementStack}>
              {announcements.map((announcement) => (
                <article className={styles.announcementCard} key={announcement.id}>
                  <h4>{announcement.title}</h4>
                  <p>{announcement.body}</p>
                  <p className={styles.announcementMeta}>{announcement.created_by_name || "Recruiting team"} · {formatDate(announcement.created_at)}</p>
                </article>
              ))}
            </div>
          ) : <p className={styles.emptySub}>No announcements published yet.</p>}
        </div>
      </div>
    </RecruiterShell>
  );
}

function StatCard({ icon, tone, value, label }) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statTop}>
        <div className={`${styles.statIcon} ${styles[tone]}`}>{icon}</div>
      </div>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}

function formatDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function initialsFor(name) {
  if (!name) return "RC";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "RC";
}

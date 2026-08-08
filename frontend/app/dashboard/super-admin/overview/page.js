"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import SuperAdminShell from "@/components/super-admin/SuperAdminShell";
import ProtectedSuperAdminRoute from "@/components/ProtectedSuperAdminRoute";
import StatsCard from "@/components/super-admin/StatsCard";
import styles from "@/components/recruiter/recruiter-shell.module.css";
import {
  getAnnouncements,
  getApiErrorMessage,
  listRecruiters,
  listOrganizations,
} from "@/services/authService";
import { getStoredUser } from "@/services/rbac";

const SparkleIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M12 2.5l1.9 5.1 5.1 1.9-5.1 1.9L12 16.5l-1.9-5.1-5.1-1.9 5.1-1.9L12 2.5z" />
    <path d="M19 15l.9 2.3L22 18l-2.1.7L19 21l-.9-2.3L16 18l2.1-.7L19 15z" />
  </svg>
);

const ICONS = {
  recruiters: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  active: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 12l2 2 4-4" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  ),
  pending: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  ),
  organizations: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
};

const DASHBOARD_REFRESH_MS = 60000;

export default function SuperAdminOverviewPage() {
  return (
    <ProtectedSuperAdminRoute>
      <SuperAdminOverviewPageContent />
    </ProtectedSuperAdminRoute>
  );
}

function SuperAdminOverviewPageContent() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [recruiters, setRecruiters] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const storedUser = getStoredUser();
    if (storedUser) {
      setUser(storedUser);
    }
  }, []);

  const loadDashboard = useCallback(async () => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      const [recruitersData, orgsData, announcementsData] = await Promise.all([
        listRecruiters(accessToken),
        listOrganizations(accessToken),
        getAnnouncements(accessToken, 8),
      ]);
      setRecruiters(recruitersData.recruiters || []);
      setOrganizations(orgsData.organizations || []);
      setAnnouncements(announcementsData.announcements || []);
      setError("");
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not load the super admin overview."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
    const interval = setInterval(loadDashboard, DASHBOARD_REFRESH_MS);
    return () => clearInterval(interval);
  }, [loadDashboard]);

  const stats = useMemo(() => {
    const total = recruiters.length;
    const active = recruiters.filter((r) => r.is_active).length;
    const pending = recruiters.filter((r) => r.status === "pending").length;
    const orgs = organizations.length;
    return { total, active, pending, orgs };
  }, [recruiters, organizations]);

  const quickActions = useMemo(
    () => [
      {
        title: "Invite Recruiter",
        hint: "Send invitations to new recruiters",
        action: () => router.push("/dashboard/super-admin"),
      },
      {
        title: "Manage Organizations",
        hint: `${stats.orgs} organization${stats.orgs === 1 ? "" : "s"} configured`,
        action: () => router.push("/dashboard/super-admin"),
      },
      {
        title: "View Reports",
        hint: "Activity and audit logs",
        action: () => router.push("/dashboard/super-admin"),
      },
    ],
    [stats.orgs, router]
  );

  const aiRecommendation = useMemo(() => {
    if (stats.pending > 0) {
      return {
        title: "Pending invitations",
        body: (
          <>
            <b>{stats.pending}</b> recruiter invitation{stats.pending === 1 ? "" : "s"} awaiting acceptance. Consider sending a reminder or revoking stale invites.
          </>
        ),
        action: () => router.push("/dashboard/super-admin"),
        cta: "Manage recruiters →",
      };
    }
    if (stats.active === 0) {
      return {
        title: "Get started",
        body: <>Invite your first recruiter to begin managing hiring pipelines and onboarding.</>,
        action: () => router.push("/dashboard/super-admin"),
        cta: "Invite recruiter →",
      };
    }
    if (stats.orgs === 0) {
      return {
        title: "Organization setup",
        body: <>Create your first organization to enable multi-tenancy and module permissions.</>,
        action: () => router.push("/dashboard/super-admin"),
        cta: "Create organization →",
      };
    }
    return {
      title: "Platform health",
      body: (
        <>
          <b>{stats.active}</b> active recruiter{stats.active === 1 ? "" : "s"} across <b>{stats.orgs}</b> organization{stats.orgs === 1 ? "" : "s"}. All systems operational.
        </>
      ),
      action: () => router.push("/dashboard/super-admin"),
      cta: "View details →",
    };
  }, [stats.pending, stats.active, stats.orgs, router]);

  const handleTabChange = (tab) => {
    router.push("/dashboard/super-admin");
  };

  return (
    <SuperAdminShell
      activeKey="overview"
      onTabChange={handleTabChange}
      title="Super Admin Overview"
      subtitle="Platform-wide dashboard and administration"
      user={user}
    >
      {error && <div className={styles.formMessage} role="alert">{error}</div>}

      <div className={styles.hero} style={{ marginBottom: 20 }}>
        <div className={styles.heroEyebrow}>Administration</div>
        <h1>Platform Command Center</h1>
        <div className={styles.heroMeta}>
          Monitor recruiters, organizations, and platform-wide activity in real time.
        </div>
        <div className={styles.heroRecommend}>
          <SparkleIcon />
          <div>
            <div style={{ fontWeight: 700, color: "var(--navy)", marginBottom: 2 }}>{aiRecommendation.title}</div>
            <div>{aiRecommendation.body}</div>
            <button
              type="button"
              className={styles.linkButton}
              style={{ marginTop: 8 }}
              onClick={aiRecommendation.action}
            >
              {aiRecommendation.cta}
            </button>
          </div>
        </div>
      </div>

      <div className={styles.stats}>
        <StatsCard tone="navy" value={loading ? "—" : stats.total} label="Total Recruiters" icon={ICONS.recruiters} />
        <StatsCard tone="green" value={loading ? "—" : stats.active} label="Active Recruiters" icon={ICONS.active} />
        <StatsCard tone="orange" value={loading ? "—" : stats.pending} label="Pending Invitations" icon={ICONS.pending} />
        <StatsCard tone="cyan" value={loading ? "—" : stats.orgs} label="Organizations" icon={ICONS.organizations} />
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
            <div className={`${styles.bar} ${styles.green}`} />
            <div>
              <div className={styles.sectionTitle}>Recent activity</div>
              <div className={styles.sectionDesc}>Latest platform updates and recruiter actions.</div>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          {announcements.length ? (
            <ul className={styles.activityList}>
              {announcements.map((announcement, index) => (
                <li key={`announcement-${announcement.id || index}`}>
                  <span className={styles.activityDot} />
                  <div>
                    <div className={styles.activityLabel}>{announcement.title}</div>
                    <div className={styles.activityMeta}>
                      {announcement.created_by_name || "System"} · {formatDateTime(announcement.created_at)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.emptySub}>No recent activity.</p>
          )}
        </div>
      </div>
    </SuperAdminShell>
  );
}

function formatDateTime(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

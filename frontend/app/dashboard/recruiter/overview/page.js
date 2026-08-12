"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import RecruiterShell from "@/components/recruiter/RecruiterShell";
import ProtectedRecruiterRoute from "@/components/ProtectedRecruiterRoute";
import styles from "@/components/recruiter/recruiter-shell.module.css";
import {
  getAnnouncements,
  getApiErrorMessage,
  getDashboardActivity,
  getDashboardSummary,
  getPendingReview,
  getReadyForConversion,
  hasCapability,
} from "@/services/authService";
import {
  clearRecruiterContext,
  publishRecruiterContext,
} from "@/lib/ai/recruiterContext";

const SparkleIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M12 2.5l1.9 5.1 5.1 1.9-5.1 1.9L12 16.5l-1.9-5.1-5.1-1.9 5.1-1.9L12 2.5z" />
    <path d="M19 15l.9 2.3L22 18l-2.1.7L19 21l-.9-2.3L16 18l2.1-.7L19 15z" />
  </svg>
);

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
  return (
    <ProtectedRecruiterRoute requiredCapability="overview">
      <RecruiterOverviewPageContent />
    </ProtectedRecruiterRoute>
  );
}

function RecruiterOverviewPageContent() {
  const router = useRouter();
  const [summary, setSummary] = useState(null);
  const [activities, setActivities] = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [pendingCandidates, setPendingCandidates] = useState([]);
  const [readyCandidates, setReadyCandidates] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const approvals = pendingApprovals.length;
    const offers = pendingCandidates.length;
    const ready = readyCandidates.length;
    let hint = "Pipeline looks clear — invite a new candidate when you're ready.";
    if (approvals > 0) {
      hint = `Next: review ${approvals} onboarding submission${approvals === 1 ? "" : "s"} on Candidates.`;
    } else if (offers > 0) {
      hint = `Next: review docs and send offers for ${offers} candidate${offers === 1 ? "" : "s"}.`;
    } else if (ready > 0) {
      hint = `Next: approve & activate ${ready} signed offer${ready === 1 ? "" : "s"}.`;
    }
    publishRecruiterContext({
      section: "overview",
      hint,
      fields: [],
    });
    return () => clearRecruiterContext();
  }, [pendingApprovals.length, pendingCandidates.length, readyCandidates.length]);

  const loadDashboard = useCallback(async () => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setLoading(true);
    setError("");
    try {
      const summaryPromise = getDashboardSummary(accessToken).then((data) => {
        setSummary(data);
        return data;
      });
      const activityPromise = getDashboardActivity(accessToken, 8).then((data) => {
        setActivities(data.activities || []);
        return data;
      });
      const pendingPromise = getPendingReview(accessToken).then((data) => {
        setPendingCandidates(data.candidates || []);
        return data;
      });
      const readyPromise = getReadyForConversion(accessToken).then((data) => {
        setReadyCandidates(data.candidates || []);
        return data;
      });
      const announcementsPromise = getAnnouncements(accessToken, 4).then((data) => {
        setAnnouncements(data.announcements || []);
        return data;
      });
      const [summaryData] = await Promise.all([summaryPromise, activityPromise, pendingPromise, readyPromise, announcementsPromise]);
      setPendingApprovals(summaryData.pending_approvals || []);
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not load the recruiter overview."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await loadDashboard();
    })();
    const interval = setInterval(loadDashboard, DASHBOARD_REFRESH_MS);
    return () => clearInterval(interval);
  }, [loadDashboard]);

  const quickActions = useMemo(
    () => {
      const actions = [
        { title: "Invite candidate", hint: "Send onboarding invitations", action: () => router.push("/dashboard/recruiter/invite"), capability: "invite" },
        { title: "Review approvals", hint: `${pendingApprovals.length} awaiting review`, action: () => router.push("/dashboard/recruiter/candidates"), capability: "candidates" },
        { title: "Send offers", hint: `${pendingCandidates.length} pending offer action`, action: () => router.push("/dashboard/recruiter/candidates"), capability: "candidates" },
        { title: "Activate employees", hint: `${readyCandidates.length} offer signed`, action: () => router.push("/dashboard/recruiter/candidates"), capability: "candidates" },
        { title: "Employee directory", hint: "Browse active employees", action: () => router.push("/dashboard/recruiter/employees"), capability: "employees" },
        { title: "Announcements", hint: "Share updates with candidates", action: () => router.push("/dashboard/recruiter/announcements"), capability: "announcements" },
      ];
      return actions.filter((action) => hasCapability(action.capability));
    },
    [pendingApprovals.length, pendingCandidates.length, readyCandidates.length, router]
  );

  const aiRecommendation = useMemo(() => {
    const canCandidates = hasCapability("candidates");
    if (pendingApprovals.length > 0 && canCandidates) {
      return {
        title: "Today's recommendation",
        body: (
          <>
            Review <b>{pendingApprovals.length}</b> onboarding submission{pendingApprovals.length === 1 ? "" : "s"} next — this unblocks offer review.
          </>
        ),
        action: () => router.push("/dashboard/recruiter/candidates"),
        cta: "Open approvals →",
      };
    }
    if (pendingCandidates.length > 0 && canCandidates) {
      return {
        title: "Today's recommendation",
        body: (
          <>
            Send or review offers for <b>{pendingCandidates.length}</b> candidate{pendingCandidates.length === 1 ? "" : "s"} waiting in the pipeline.
          </>
        ),
        action: () => router.push("/dashboard/recruiter/candidates"),
        cta: "Review offers →",
      };
    }
    if (readyCandidates.length > 0 && canCandidates) {
      return {
        title: "Today's recommendation",
        body: (
          <>
            Activate <b>{readyCandidates.length}</b> signed offer{readyCandidates.length === 1 ? "" : "s"} to convert candidates into employees.
          </>
        ),
        action: () => router.push("/dashboard/recruiter/candidates"),
        cta: "Activate →",
      };
    }
    if (hasCapability("invite")) {
      return {
        title: "Pipeline looks clear",
        body: <>Invite a new candidate when you&apos;re ready — AI can help with bulk invites from the Assistant.</>,
        action: () => router.push("/dashboard/recruiter/invite"),
        cta: "Invite candidate →",
      };
    }
    return {
      title: "Pipeline looks clear",
      body: <>Your hiring pipeline is up to date. Open the assistant for guided workflows.</>,
      action: () => router.push("/dashboard/recruiter/ai-assistant"),
      cta: "Open assistant →",
    };
  }, [pendingApprovals.length, pendingCandidates.length, readyCandidates.length, router]);

  return (
    <RecruiterShell activeKey="overview" capability="overview" title="Recruiter overview" subtitle="Real-time hiring pipeline and onboarding snapshots">
      {error && <div className={styles.formMessage} role="alert">{error}</div>}

      <div className={styles.hero} style={{ marginBottom: 20 }}>
        <div className={styles.heroEyebrow}>Hiring command center</div>
        <h1>Keep the hiring pipeline moving</h1>
        <div className={styles.heroMeta}>
          Monitor onboarding, offers, approvals, and employee activation in one place.
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
        <StatCard tone="green" value={summary?.kpis?.active_employees ?? (loading ? "—" : 0)} label="Active employees" icon={ICONS.employees} />
        <StatCard tone="orange" value={summary?.kpis?.pending_onboarding ?? (loading ? "—" : 0)} label="Pending onboarding" icon={ICONS.approvals} />
        <StatCard tone="cyan" value={summary?.kpis?.documents_pending ?? (loading ? "—" : 0)} label="Documents pending" icon={ICONS.offers} />
        <StatCard tone="navy" value={summary?.kpis?.upcoming_joinings ?? (loading ? "—" : 0)} label="Upcoming joinings" icon={ICONS.activate} />
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
          {pendingApprovals.length ? (
            <ul className={styles.miniList}>
              {pendingApprovals.map((item) => (
                <li className={styles.miniListItem} key={`${item.full_name}-${item.email}`}>
                  <div>
                    <strong>{item.full_name}</strong>
                    <div className={styles.mutedText}>{item.job_title || "—"} · {item.department || "—"}</div>
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
          <div className={styles.offerSplit}>
            <div className={styles.offerGroup}>
              <div className={styles.offerGroupHead}>
                <h3 className={styles.offerHeading}>Pending offer review</h3>
              </div>
              {pendingCandidates.length ? (
                <ul className={styles.miniList}>
                  {pendingCandidates.map((candidate) => (
                    <li className={styles.miniListItem} key={candidate.id}>
                      <div>
                        <strong>{candidate.full_name}</strong>
                        <div className={styles.mutedText}>{candidate.email} · {candidate.job_title || "—"}</div>
                      </div>
                      <button type="button" className={styles.secondaryButton} onClick={() => router.push("/dashboard/recruiter/candidates")}>Open</button>
                    </li>
                  ))}
                </ul>
              ) : <p className={styles.emptySub}>No candidates currently need an offer step.</p>}
            </div>
            <div className={styles.offerGroup}>
              <div className={styles.offerGroupHead}>
                <h3 className={styles.offerHeading}>Ready to activate</h3>
              </div>
              {readyCandidates.length ? (
                <ul className={styles.miniList}>
                  {readyCandidates.map((candidate) => (
                    <li className={styles.miniListItem} key={candidate.offer_id}>
                      <div>
                        <strong>{candidate.full_name}</strong>
                        <div className={styles.mutedText}>
                          {candidate.email} · {candidate.department || "—"}
                          {candidate.can_activate ? " · IT complete" : " · awaiting IT"}
                        </div>
                      </div>
                      <button type="button" className={styles.secondaryButton} onClick={() => router.push("/dashboard/recruiter/candidates")}>
                        {candidate.can_activate ? "Approve" : "Open"}
                      </button>
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
          {activities.length ? (
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
      <div className={`${styles.statIcon} ${styles[tone]}`}>{icon}</div>
      <div className={styles.statText}>
        <div className={styles.statValue}>{value}</div>
        <div className={styles.statLabel}>{label}</div>
      </div>
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

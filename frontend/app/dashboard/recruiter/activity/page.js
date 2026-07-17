"use client";

import { useCallback, useEffect, useState } from "react";
import RecruiterShell from "@/components/recruiter/RecruiterShell";
import styles from "@/components/recruiter/recruiter-shell.module.css";
import { getRecruiterActivity, getApiErrorMessage } from "@/services/authService";

export default function RecruiterActivityPage() {
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadActivity = useCallback(async () => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      const data = await getRecruiterActivity(accessToken);
      setActivity(data.activity || []);
      setError("");
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not load activity feed."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadActivity();
  }, [loadActivity]);

  return (
    <RecruiterShell activeKey="activity" title="Activity feed" subtitle="Follow recent recruiter and onboarding activity">
      {error && <div className={styles.formMessage} role="alert">{error}</div>}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <div className={`${styles.bar} ${styles.cyan}`} />
            <div>
              <div className={styles.sectionTitle}>Recent events</div>
              <div className={styles.sectionDesc}>A compact timeline of candidate, offer, and onboarding events.</div>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          {loading ? <p className={styles.emptySub}>Loading…</p> : activity.length ? (
            <ul className={styles.miniList}>
              {activity.map((item) => (
                <li className={styles.miniListItem} key={item.id || `${item.type}-${item.created_at}`}>
                  <div>
                    <strong>{item.title || item.type}</strong>
                    <div className={styles.mutedText}>{item.description || item.message || "No details available."}</div>
                    <div className={styles.mutedText}>{formatDate(item.created_at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className={styles.emptySub}>No recent activity.</p>}
        </div>
      </div>
    </RecruiterShell>
  );
}

function formatDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

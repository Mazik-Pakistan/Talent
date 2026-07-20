"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import RecruiterShell from "@/components/recruiter/RecruiterShell";
import styles from "@/components/recruiter/recruiter-shell.module.css";
import { getRecruiterActivity, getApiErrorMessage } from "@/services/authService";

export default function RecruiterActivityPage() {
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [live, setLive] = useState(true);

  const loadActivity = useCallback(async (silent = false) => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      const data = await getRecruiterActivity(accessToken, 50);
      const next = data.activities || [];
      setActivity((prev) => {
        if (silent && prev.length && next[0]?.created_at && next[0].created_at !== prev[0]?.created_at) {
          toast.info(`New activity: ${next[0].label || next[0].action}`);
        }
        return next;
      });
      setError("");
    } catch (err) {
      const message = getApiErrorMessage(err, "Could not load activity feed.");
      setError(message);
      if (!silent) toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadActivity(false);
  }, [loadActivity]);

  useEffect(() => {
    if (!live) return undefined;
    const timer = setInterval(() => loadActivity(true), 20000);
    return () => clearInterval(timer);
  }, [live, loadActivity]);

  return (
    <RecruiterShell activeKey="activity" title="Activity feed" subtitle="Live timeline of recruiting and onboarding events">
      {error && (
        <div className={styles.formMessage} role="alert">
          {error}
        </div>
      )}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <div className={`${styles.bar} ${styles.cyan}`} />
            <div>
              <div className={styles.sectionTitle}>Recent events</div>
              <div className={styles.sectionDesc}>
                Candidate, offer, document, announcement, and employee profile events · auto-refresh {live ? "on" : "paused"}
              </div>
            </div>
          </div>
          <button type="button" className={styles.secondaryButton} onClick={() => setLive((v) => !v)}>
            {live ? "Pause live" : "Resume live"}
          </button>
        </div>
        <div className={styles.sectionBody}>
          {loading ? (
            <p className={styles.emptySub}>Loading…</p>
          ) : activity.length ? (
            <ul className={styles.activityList}>
              {activity.map((item, index) => (
                <li key={`${item.action}-${item.created_at}-${index}`}>
                  <span className={styles.activityDot} />
                  <div>
                    <div className={styles.activityLabel}>{item.label || item.action}</div>
                    <div className={styles.activityMeta}>
                      {item.actor_email || item.email || "system"}
                      {item.outcome ? ` · ${item.outcome}` : ""} · {formatDateTime(item.created_at)}
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
    </RecruiterShell>
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

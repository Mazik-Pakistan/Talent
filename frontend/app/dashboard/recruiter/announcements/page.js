"use client";

import { useCallback, useEffect, useState } from "react";
import RecruiterShell from "@/components/recruiter/RecruiterShell";
import styles from "@/components/recruiter/recruiter-shell.module.css";
import { createAnnouncement, getAnnouncements, getApiErrorMessage } from "@/services/authService";

export default function RecruiterAnnouncementsPage() {
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);

  const loadAnnouncements = useCallback(async () => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      const data = await getAnnouncements(accessToken);
      setAnnouncements(data.announcements || []);
      setError("");
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not load announcements."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAnnouncements();
  }, [loadAnnouncements]);

  async function handlePublishAnnouncement(event) {
    event.preventDefault();
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;

    setIsPublishing(true);
    setFormMessage("");
    try {
      const data = await createAnnouncement({ title: title.trim(), body: body.trim() }, accessToken);
      setAnnouncements((current) => [data.announcement, ...current]);
      setTitle("");
      setBody("");
      setFormMessage(data.message || "Announcement published.");
    } catch (err) {
      setFormMessage(getApiErrorMessage(err, "Could not publish the announcement."));
    } finally {
      setIsPublishing(false);
    }
  }

  return (
    <RecruiterShell activeKey="announcements" title="Announcements" subtitle="Keep the wider team informed with current updates">
      {error && <div className={styles.formMessage} role="alert">{error}</div>}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <div className={`${styles.bar} ${styles.purple}`} />
            <div>
              <div className={styles.sectionTitle}>Publish announcement</div>
              <div className={styles.sectionDesc}>Share a hiring update or policy note with candidates from this page.</div>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          <form onSubmit={handlePublishAnnouncement}>
            <label className={styles.field} style={{ marginBottom: 12 }}>
              <span>Title</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} required />
            </label>
            <label className={styles.field}>
              <span>Message</span>
              <textarea
                rows={4}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                required
                className={styles.textarea}
              />
            </label>
            {formMessage && <p className={styles.formMessage} role="status">{formMessage}</p>}
            <button className={styles.primaryButton} type="submit" disabled={isPublishing}>
              {isPublishing ? "Publishing…" : "Publish announcement"}
            </button>
          </form>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <div className={`${styles.bar} ${styles.cyan}`} />
            <div>
              <div className={styles.sectionTitle}>Latest updates</div>
              <div className={styles.sectionDesc}>Announcements delivered by the backend are surfaced here in a simpler feed.</div>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          {loading ? <p className={styles.emptySub}>Loading…</p> : announcements.length ? (
            <ul className={styles.miniList}>
              {announcements.map((item) => (
                <li className={styles.miniListItem} key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <div className={styles.mutedText}>{item.body}</div>
                    <div className={styles.mutedText}>{item.created_by_name ? `${item.created_by_name} · ` : ""}Posted {formatDate(item.created_at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className={styles.emptySub}>No announcements to display.</p>}
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

"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import RecruiterShell from "@/components/recruiter/RecruiterShell";
import ConfirmDialog from "@/components/ConfirmDialog";
import styles from "@/components/recruiter/recruiter-shell.module.css";
import {
  createAnnouncement,
  deleteAnnouncement,
  getAnnouncements,
  getApiErrorMessage,
  updateAnnouncement,
} from "@/services/authService";

const EMPTY_FORM = {
  title: "",
  body: "",
  audience: "both",
  send_email: true,
  notify_again: false,
};

export default function RecruiterAnnouncementsPage() {
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const loadAnnouncements = useCallback(async () => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      const data = await getAnnouncements(accessToken, 50);
      setAnnouncements(data.announcements || []);
      setError("");
    } catch (err) {
      const message = getApiErrorMessage(err, "Could not load announcements.");
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAnnouncements();
    const timer = setInterval(loadAnnouncements, 30000);
    return () => clearInterval(timer);
  }, [loadAnnouncements]);

  function startEdit(item) {
    setEditingId(item.id);
    setForm({
      title: item.title || "",
      body: item.body || "",
      audience: item.audience || "both",
      send_email: false,
      notify_again: false,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setSaving(true);
    try {
      if (editingId) {
        const data = await updateAnnouncement(
          editingId,
          {
            title: form.title.trim(),
            body: form.body.trim(),
            audience: form.audience,
            send_email: form.send_email,
            notify_again: form.notify_again,
          },
          accessToken
        );
        setAnnouncements((current) =>
          current.map((item) => (item.id === editingId ? data.announcement : item))
        );
        toast.success(data.message || "Announcement updated.");
      } else {
        const data = await createAnnouncement(
          {
            title: form.title.trim(),
            body: form.body.trim(),
            audience: form.audience,
            send_email: form.send_email,
          },
          accessToken
        );
        setAnnouncements((current) => [data.announcement, ...current]);
        toast.success(data.message || "Announcement published.");
      }
      resetForm();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not save announcement."));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      await deleteAnnouncement(deleteTarget.id, accessToken);
      setAnnouncements((current) => current.filter((item) => item.id !== deleteTarget.id));
      if (editingId === deleteTarget.id) resetForm();
      toast.success("Announcement deleted.");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not delete announcement."));
    } finally {
      setDeleteTarget(null);
    }
  }

  return (
    <RecruiterShell
      activeKey="announcements"
      title="Announcements"
      subtitle="Publish, edit, and remove updates for candidates and employees"
    >
      {error && (
        <div className={styles.formMessage} role="alert">
          {error}
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <div className={`${styles.bar} ${styles.purple}`} />
            <div>
              <div className={styles.sectionTitle}>{editingId ? "Edit announcement" : "Publish announcement"}</div>
              <div className={styles.sectionDesc}>
                Choose audience, optionally email everyone, and send in-app notifications automatically.
              </div>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          <form onSubmit={handleSubmit} className={styles.announceForm}>
            <label className={styles.field}>
              <span>Title</span>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
                minLength={3}
                maxLength={150}
                placeholder="e.g. Orientation schedule update"
              />
            </label>
            <label className={styles.field}>
              <span>Message</span>
              <textarea
                rows={5}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                required
                minLength={3}
                maxLength={4000}
                className={styles.textarea}
                placeholder="Write a clear update for your audience…"
              />
            </label>
            <div className={styles.announceOptions}>
              <label className={styles.field}>
                <span>Audience</span>
                <select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
                  <option value="both">Candidates &amp; employees</option>
                  <option value="candidates">Candidates only</option>
                  <option value="employees">Employees only</option>
                </select>
              </label>
              <label className={styles.checkInline}>
                <input
                  type="checkbox"
                  checked={form.send_email}
                  onChange={(e) => setForm({ ...form, send_email: e.target.checked })}
                />
                <span>Send email to audience</span>
              </label>
              {editingId && (
                <label className={styles.checkInline}>
                  <input
                    type="checkbox"
                    checked={form.notify_again}
                    onChange={(e) => setForm({ ...form, notify_again: e.target.checked })}
                  />
                  <span>Re-notify in-app</span>
                </label>
              )}
            </div>
            <div className={styles.announceActions}>
              {editingId && (
                <button type="button" className={styles.secondaryButton} onClick={resetForm} disabled={saving}>
                  Cancel edit
                </button>
              )}
              <button className={styles.primaryButton} type="submit" disabled={saving}>
                {saving ? "Saving…" : editingId ? "Save changes" : "Publish announcement"}
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <div className={`${styles.bar} ${styles.cyan}`} />
            <div>
              <div className={styles.sectionTitle}>All announcements</div>
              <div className={styles.sectionDesc}>
                {announcements.length} published · refresh every 30s for live updates
              </div>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          {loading ? (
            <p className={styles.emptySub}>Loading…</p>
          ) : announcements.length ? (
            <div className={styles.announcementStack}>
              {announcements.map((item) => (
                <article className={styles.announcementCard} key={item.id}>
                  <div className={styles.announcementCardHead}>
                    <div>
                      <h4>{item.title}</h4>
                      <p className={styles.announcementMeta}>
                        {item.created_by_name || "Recruiting team"} · {formatDate(item.created_at)}
                        {item.updated_at && item.updated_at !== item.created_at
                          ? ` · Updated ${formatDate(item.updated_at)}`
                          : ""}
                      </p>
                    </div>
                    <span className={styles.audiencePill}>{audienceLabel(item.audience)}</span>
                  </div>
                  <p className={styles.announcementBody}>{item.body}</p>
                  <div className={styles.announcementCardActions}>
                    <button type="button" className={styles.secondaryButton} onClick={() => startEdit(item)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className={styles.dangerButton}
                      onClick={() => setDeleteTarget(item)}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className={styles.emptySub}>No announcements yet. Publish your first update above.</p>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete announcement?"
        message={`“${deleteTarget?.title || ""}” will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </RecruiterShell>
  );
}

function audienceLabel(value) {
  if (value === "candidates") return "Candidates";
  if (value === "employees") return "Employees";
  return "Everyone";
}

function formatDate(value) {
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

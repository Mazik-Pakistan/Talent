"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import RecruiterShell from "@/components/recruiter/RecruiterShell";
import ProfilePhotoEditor from "@/components/ProfilePhotoEditor";
import styles from "@/components/recruiter/recruiter-shell.module.css";
import {
  getApiErrorMessage,
  getRecruiterProfile,
  patchLocalUser,
  removeRecruiterPhoto,
  updateRecruiterProfile,
  uploadRecruiterPhoto,
} from "@/services/authService";

export default function RecruiterProfilePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    department: "",
    job_title: "",
    office_location: "",
  });

  const syncLocalUser = useCallback((nextProfile) => {
    patchLocalUser({
      full_name: nextProfile.full_name,
      phone: nextProfile.phone,
      profile_picture: nextProfile.profile_picture || null,
      job_title: nextProfile.job_title,
      department: nextProfile.department,
    });
    window.dispatchEvent(new Event("talent-user-updated"));
  }, []);

  const load = useCallback(async () => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setLoading(true);
    try {
      const data = await getRecruiterProfile(accessToken);
      const next = data.profile || {};
      setProfile(next);
      setForm({
        full_name: next.full_name || "",
        phone: next.phone || "",
        department: next.department || "",
        job_title: next.job_title || "",
        office_location: next.office_location || "",
      });
      syncLocalUser(next);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not load your profile."));
    } finally {
      setLoading(false);
    }
  }, [syncLocalUser]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave(event) {
    event.preventDefault();
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setSaving(true);
    try {
      const data = await updateRecruiterProfile(
        {
          full_name: form.full_name.trim(),
          phone: form.phone.trim() || null,
          department: form.department.trim() || null,
          job_title: form.job_title.trim() || null,
          office_location: form.office_location.trim() || null,
        },
        accessToken
      );
      setProfile(data.profile);
      syncLocalUser(data.profile);
      toast.success("Profile updated.");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not save profile."));
    } finally {
      setSaving(false);
    }
  }

  async function handlePhotoUpload(file) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setPhotoBusy(true);
    try {
      const data = await uploadRecruiterPhoto(file, accessToken);
      setProfile(data.profile);
      syncLocalUser(data.profile);
      toast.success("Profile photo updated.");
    } catch (err) {
      const message = getApiErrorMessage(err, "Could not upload photo.");
      toast.error(message);
      throw new Error(message);
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handlePhotoRemove() {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setPhotoBusy(true);
    try {
      const data = await removeRecruiterPhoto(accessToken);
      setProfile(data.profile);
      syncLocalUser(data.profile);
      toast.success("Profile photo removed.");
    } catch (err) {
      const message = getApiErrorMessage(err, "Could not remove photo.");
      toast.error(message);
      throw new Error(message);
    } finally {
      setPhotoBusy(false);
    }
  }

  return (
    <RecruiterShell activeKey="profile" title="My profile" subtitle="Your recruiter account details">
      {loading ? (
        <p className={styles.emptySub}>Loading profile…</p>
      ) : (
        <>
          <div className={styles.section}>
            <div className={styles.profileHero}>
              <ProfilePhotoEditor
                src={profile?.profile_picture}
                name={profile?.full_name}
                onUpload={handlePhotoUpload}
                onRemove={handlePhotoRemove}
                busy={photoBusy}
              />
              <div>
                <h2 className={styles.profileName}>{profile?.full_name}</h2>
                <p className={styles.mutedText}>
                  {profile?.email} · {(profile?.role || "recruiter").replace("_", " ")}
                </p>
                <div className={styles.chipRow}>
                  {profile?.job_title && <span className={styles.chip}>{profile.job_title}</span>}
                  {profile?.department && <span className={styles.chip}>{profile.department}</span>}
                  {profile?.office_location && <span className={styles.chip}>{profile.office_location}</span>}
                </div>
              </div>
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <div className={styles.sectionHeadLeft}>
                <div className={`${styles.bar} ${styles.cyan}`} />
                <div>
                  <div className={styles.sectionTitle}>Edit profile</div>
                  <div className={styles.sectionDesc}>Keep your contact and role details up to date.</div>
                </div>
              </div>
            </div>
            <div className={styles.sectionBody}>
              <form onSubmit={handleSave} className={styles.profileForm}>
                <label className={styles.field}>
                  <span>Full name</span>
                  <input
                    value={form.full_name}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                    required
                    minLength={2}
                  />
                </label>
                <label className={styles.field}>
                  <span>Email</span>
                  <input value={profile?.email || ""} disabled readOnly />
                </label>
                <label className={styles.field}>
                  <span>Phone</span>
                  <input
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="03XX-XXXXXXX"
                  />
                </label>
                <label className={styles.field}>
                  <span>Job title</span>
                  <input
                    value={form.job_title}
                    onChange={(e) => setForm({ ...form, job_title: e.target.value })}
                    placeholder="Talent Acquisition Lead"
                  />
                </label>
                <label className={styles.field}>
                  <span>Department</span>
                  <input
                    value={form.department}
                    onChange={(e) => setForm({ ...form, department: e.target.value })}
                    placeholder="Human Resources"
                  />
                </label>
                <label className={styles.field}>
                  <span>Office location</span>
                  <input
                    value={form.office_location}
                    onChange={(e) => setForm({ ...form, office_location: e.target.value })}
                    placeholder="Karachi"
                  />
                </label>
                <button type="submit" className={styles.primaryButton} disabled={saving}>
                  {saving ? "Saving…" : "Save profile"}
                </button>
              </form>
            </div>
          </div>
        </>
      )}
    </RecruiterShell>
  );
}

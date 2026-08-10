"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import RecruiterShell from "@/components/recruiter/RecruiterShell";
import ProtectedRecruiterRoute from "@/components/ProtectedRecruiterRoute";
import ProfilePhotoEditor from "@/components/ProfilePhotoEditor";
import SecuritySection from "@/components/SecuritySection";
import styles from "@/components/recruiter/recruiter-shell.module.css";
import { useOrgFrameworkOptions } from "@/hooks/useOrgFrameworkOptions";
import {
  getApiErrorMessage,
  getRecruiterProfile,
  patchLocalUser,
  removeRecruiterPhoto,
  updateRecruiterProfile,
  uploadRecruiterPhoto,
} from "@/services/authService";
import { validateTextField } from "@/utils/validation";
import {
  clearRecruiterContext,
  publishRecruiterContext,
} from "@/lib/ai/recruiterContext";
import FieldError, { INPUT_ERROR_STYLE } from "@/lib/formFeedback";

export default function RecruiterProfilePage() {
  return (
    <ProtectedRecruiterRoute requiredCapability="profile">
      <RecruiterProfilePageContent />
    </ProtectedRecruiterRoute>
  );
}

function RecruiterProfilePageContent() {
  const { departments: frameworkDepartments, roleNames: frameworkDesignations } = useOrgFrameworkOptions();
  const departmentOptions = frameworkDepartments;
  const designationOptions = frameworkDesignations;
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
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    publishRecruiterContext({
      section: "recruiter_profile",
      hint: "Update your name, contact, designation, department, and office. Focus each field for a tip.",
      fields: ["full_name", "phone", "job_title", "department", "office_location"],
    });
    return () => clearRecruiterContext();
  }, []);

  // Track when Security section becomes visible
  useEffect(() => {
    if (loading) return;
    const securitySection = document.getElementById("security-section");
    if (!securitySection) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            publishRecruiterContext({
              section: "security",
              tab: "security-section",
              hint: "Change your password to keep your account secure.",
              fields: ["current_password", "new_password", "confirm_new_password"],
            });
          } else {
            publishRecruiterContext({
              section: "recruiter_profile",
              hint: "Update your name, contact, designation, department, and office. Focus each field for a tip.",
              fields: ["full_name", "phone", "job_title", "department", "office_location"],
            });
          }
        });
      },
      { rootMargin: "-96px 0px -50% 0px", threshold: 0.1 }
    );

    observer.observe(securitySection);
    return () => observer.disconnect();
  }, [loading]);

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
    setFieldErrors({});
    const errors = {
      full_name: !validateTextField(form.full_name, 2, 120).isValid ? "Full name is required." : undefined,
      phone: form.phone && !validateTextField(form.phone, 7, 20).isValid ? "Enter a valid phone number." : undefined,
    };
    if (Object.values(errors).some(Boolean)) {
      setFieldErrors(errors);
      return;
    }
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) {
      toast.error("Your session expired. Please sign in again.");
      return;
    }
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
      const nextProfile = data?.profile || data;
      if (nextProfile) {
        setProfile(nextProfile);
        syncLocalUser(nextProfile);
      }
      toast.success(data?.message || "Profile saved successfully.");
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

  const completedFields = [form.full_name, form.phone, form.department, form.job_title, form.office_location].filter(Boolean).length;
  const totalFields = 5;
  const completionPct = Math.round((completedFields / totalFields) * 100);
  const profileComplete = completionPct >= 80;

  return (
    <RecruiterShell activeKey="profile" capability="profile" title="My profile" subtitle="Your recruiter account details">
      {loading ? (
        <div className={styles.section}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 20px", color: "var(--text-muted)" }}>
            <div className={styles.spinner} style={{ marginBottom: 14 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--navy)" }}>Loading profile…</div>
          </div>
        </div>
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
                variant="overlay"
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
                  <span
                    className={styles.chip}
                    style={{
                      background: profileComplete ? "var(--green-light)" : "var(--orange-light)",
                      color: profileComplete ? "var(--green)" : "var(--orange)",
                      borderColor: "transparent",
                    }}
                  >
                    {completionPct}% complete
                  </span>
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
              <span
                className={styles.chip}
                style={{
                  background: profileComplete ? "var(--green-light)" : "var(--orange-light)",
                  color: profileComplete ? "var(--green)" : "var(--orange)",
                  borderColor: "transparent",
                  fontSize: 11,
                }}
              >
                {profileComplete ? "Profile looks great" : `${5 - completedFields} field${5 - completedFields === 1 ? "" : "s"} remaining`}
              </span>
            </div>
            <div className={styles.sectionBody}>
              <form data-partner-coach onSubmit={handleSave} className={styles.profileForm}>
                <label className={styles.field}>
                  <span>Full name <span style={{ color: "#b42318", marginLeft: 4 }}>*</span></span>
                  <input
                    name="full_name"
                    value={form.full_name}
                    onChange={(e) => {
                      setForm({ ...form, full_name: e.target.value });
                      setFieldErrors((current) => {
                        const next = { ...current };
                        delete next.full_name;
                        return next;
                      });
                    }}
                    required
                    minLength={2}
                    aria-invalid={Boolean(fieldErrors.full_name)}
                    style={fieldErrors.full_name ? INPUT_ERROR_STYLE : undefined}
                  />
                  {fieldErrors.full_name && <FieldError>{fieldErrors.full_name}</FieldError>}
                </label>
                <label className={styles.field}>
                  <span>Email</span>
                  <input name="email" value={profile?.email || ""} disabled readOnly />
                </label>
                <label className={styles.field}>
                  <span>Contact</span>
                  <input
                    name="phone"
                    value={form.phone}
                    onChange={(e) => {
                      setForm({ ...form, phone: e.target.value });
                      setFieldErrors((current) => {
                        const next = { ...current };
                        delete next.phone;
                        return next;
                      });
                    }}
                    placeholder="03XX-XXXXXXX"
                    aria-invalid={Boolean(fieldErrors.phone)}
                    style={fieldErrors.phone ? INPUT_ERROR_STYLE : undefined}
                  />
                  {fieldErrors.phone && <FieldError>{fieldErrors.phone}</FieldError>}
                </label>
                <label className={styles.field}>
                  <span>Job title</span>
                  <select
                    name="job_title"
                    value={form.job_title}
                    onChange={(e) => setForm({ ...form, job_title: e.target.value })}
                  >
                    <option value="">Select designation</option>
                    {designationOptions.map((designation) => (
                      <option key={designation} value={designation}>{designation}</option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span>Department</span>
                  <select
                    name="department"
                    value={form.department}
                    onChange={(e) => setForm({ ...form, department: e.target.value })}
                  >
                    <option value="">Select department</option>
                    {departmentOptions.map((department) => (
                      <option key={department} value={department}>{department}</option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span>Office location</span>
                  <input
                    name="office_location"
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

          <div className={styles.section} id="security-section">
            <div className={styles.sectionHead}>
              <div className={styles.sectionHeadLeft}>
                <div className={`${styles.bar} ${styles.green}`} />
                <div>
                  <div className={styles.sectionTitle}>Security</div>
                  <div className={styles.sectionDesc}>
                    Change your account password. One password covers your sign-in — no verification code needed when
                    you know your current password.
                  </div>
                </div>
              </div>
            </div>
            <div className={styles.sectionBody}>
              <SecuritySection />
            </div>
          </div>
        </>
      )}
    </RecruiterShell>
  );
}

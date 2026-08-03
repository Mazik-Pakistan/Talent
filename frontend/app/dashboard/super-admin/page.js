"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

import RecruiterLoader from "@/components/recruiter/RecruiterLoader";
import SuperAdminShell from "@/components/super-admin/SuperAdminShell";
import styles from "@/components/recruiter/recruiter-shell.module.css";
import local from "./super-admin.module.css";
import {
  bootstrapSuperAdmin,
  getApiErrorMessage,
  inviteRecruiter,
  listRecruiters,
  updateRecruiterCapabilities,
} from "@/services/authService";
import { can } from "@/services/rbac";

const initialForm = { full_name: "", email: "", phone: "", password: "", confirm_password: "" };

const CAPABILITY_LABELS = {
  recruitment: "Candidates & overview",
  invite: "Invite & offer",
  employees: "Employees",
  documents: "Document review",
  learning: "Learning",
  announcements: "Announcements",
  it: "IT & support",
  messages: "Messages",
  reporting: "Activity & reporting",
  profile: "Profile",
};

const initialInviteForm = { full_name: "", email: "", job_title: "", department: "", office_location: "", is_remote: false };

export default function SuperAdminDashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState("invite");
  const [recruiters, setRecruiters] = useState([]);
  const [recruitersLoading, setRecruitersLoading] = useState(false);
  const [inviteForm, setInviteForm] = useState(initialInviteForm);
  const [inviteCaps, setInviteCaps] = useState(
    Object.keys(CAPABILITY_LABELS).reduce((acc, k) => ({ ...acc, [k]: true }), {})
  );
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteMessage, setInviteMessage] = useState("");

  useEffect(() => {
    const storedUser = localStorage.getItem("user");
    const accessToken = localStorage.getItem("access_token");
    if (storedUser && accessToken) {
      const parsed = JSON.parse(storedUser);
      if (parsed.role === "super_admin" && can(parsed, "admin.access")) {
        setUser(parsed);
        return;
      }
      router.replace("/dashboard");
      return;
    }
    setNeedsBootstrap(true);
  }, [router]);

  const [recruitersError, setRecruitersError] = useState("");

  const loadRecruiters = useCallback(async () => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setRecruitersLoading(true);
    setRecruitersError("");
    try {
      const data = await listRecruiters(accessToken);
      setRecruiters(data.recruiters || []);
    } catch (error) {
      setRecruitersError(getApiErrorMessage(error, "Could not load recruiters."));
    } finally {
      setRecruitersLoading(false);
    }
  }, []);

  useEffect(() => { if (user) loadRecruiters(); }, [user, loadRecruiters]);

  async function handleBootstrap(event) {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);
    try {
      const data = await bootstrapSuperAdmin({ ...form, full_name: form.full_name.trim(), email: form.email.trim(), phone: form.phone.trim() });
      sessionStorage.setItem("pendingEmail", form.email.trim());
      sessionStorage.setItem("pendingRole", "super_admin");
      setMessage(data.message);
      router.push("/verify-email");
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Could not create super admin."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleInvite(event) {
    event.preventDefault();
    setInviteMessage("");
    setInviteSubmitting(true);
    try {
      const accessToken = localStorage.getItem("access_token");
      await inviteRecruiter({ ...inviteForm, full_name: inviteForm.full_name.trim(), email: inviteForm.email.trim(), job_title: inviteForm.job_title.trim(), department: inviteForm.department.trim(), office_location: inviteForm.office_location.trim() || undefined, capabilities: inviteCaps }, accessToken);
      setInviteMessage("Invitation sent successfully!");
      setInviteForm(initialInviteForm);
      loadRecruiters();
    } catch (error) {
      setInviteMessage(getApiErrorMessage(error, "Failed to send invitation."));
    } finally {
      setInviteSubmitting(false);
    }
  }

  async function toggleCapability(invitationId, key, currentValue) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      const result = await updateRecruiterCapabilities(invitationId, { capabilities: { [key]: !currentValue } }, accessToken);
      setRecruiters((prev) => prev.map((r) => r.id === invitationId ? { ...r, capabilities: result.capabilities } : r));
    } catch { loadRecruiters(); }
  }

  if (!user && !needsBootstrap) return <RecruiterLoader />;

  if (needsBootstrap && !user) {
    return (
      <div className={styles.root} data-app-shell>
        <div className={local.bootstrapWrap}>
          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <div className={styles.sectionHeadLeft}>
                <div className={`${styles.bar} ${styles.navy}`} />
                <div>
                  <div className={styles.sectionTitle}>Create Super Admin</div>
                  <div className={styles.sectionDesc}>No super admin exists yet. Create the first one, verify email, then sign in.</div>
                </div>
              </div>
            </div>
            <div className={styles.sectionBody}>
              <form onSubmit={handleBootstrap}>
                {["full_name", "email", "phone", "password", "confirm_password"].map((field) => (
                  <label key={field} className={styles.field} style={{ marginBottom: 12 }}>
                    <span>{field.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} *</span>
                    <input
                      type={field.includes("password") ? "password" : field === "email" ? "email" : "text"}
                      value={form[field]}
                      onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                      required
                    />
                  </label>
                ))}
                {message && <p className={styles.formMessage}>{message}</p>}
                <button type="submit" disabled={isSubmitting} className={styles.primaryButton}>
                  {isSubmitting ? "Creating…" : "Create super admin"}
                </button>
              </form>
              <p className={styles.instruction} style={{ marginTop: 16 }}>
                Already have an account? <a href="/login" className={styles.linkButton}>Sign in</a>
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <SuperAdminShell
      activeTab={activeTab}
      onTabChange={setActiveTab}
      title="Super Admin"
      subtitle={`Welcome, ${user.full_name}`}
      user={user}
    >
      {activeTab === "invite" && (
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionHeadLeft}>
              <div className={`${styles.bar} ${styles.cyan}`} />
              <div>
                <div className={styles.sectionTitle}>Invite a Recruiter</div>
                <div className={styles.sectionDesc}>The invited recruiter will receive both Employee and Recruiter access.</div>
              </div>
            </div>
          </div>
          <div className={styles.sectionBody}>
            <form onSubmit={handleInvite}>
              <div className={styles.formGrid}>
                {[
                  { k: "full_name", l: "Full Name", t: "text" },
                  { k: "email", l: "Email", t: "email" },
                  { k: "job_title", l: "Job Title", t: "text" },
                  { k: "department", l: "Department", t: "text" },
                  { k: "office_location", l: "Office Location", t: "text" },
                ].map(({ k, l, t }) => (
                  <label key={k} className={styles.field}>
                    <span>{l}{k !== "office_location" ? " *" : ""}</span>
                    <input
                      type={t}
                      value={inviteForm[k]}
                      onChange={(e) => setInviteForm({ ...inviteForm, [k]: e.target.value })}
                      required={k !== "office_location"}
                    />
                  </label>
                ))}
              </div>

              <label className={local.checkboxRow} style={{ marginBottom: 16 }}>
                <input
                  type="checkbox"
                  checked={inviteForm.is_remote}
                  onChange={(e) => setInviteForm({ ...inviteForm, is_remote: e.target.checked })}
                />
                Remote employee
              </label>

              <p className={local.capabilityLabel}>Capabilities</p>
              <div className={local.capabilityGrid}>
                {Object.entries(CAPABILITY_LABELS).map(([key, label]) => (
                  <label key={key} className={local.checkboxRow}>
                    <input
                      type="checkbox"
                      checked={inviteCaps[key]}
                      onChange={(e) => setInviteCaps({ ...inviteCaps, [key]: e.target.checked })}
                    />
                    {label}
                  </label>
                ))}
              </div>

              {inviteMessage && <p className={styles.formMessage}>{inviteMessage}</p>}
              <button type="submit" disabled={inviteSubmitting} className={styles.primaryButton}>
                {inviteSubmitting ? "Sending…" : "Send invitation"}
              </button>
            </form>
          </div>
        </div>
      )}

      {activeTab === "recruiters" && (
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionHeadLeft}>
              <div className={`${styles.bar} ${styles.orange}`} />
              <div>
                <div className={styles.sectionTitle}>Invited Recruiters</div>
                <div className={styles.sectionDesc}>Manage access and capabilities for every recruiter you've invited.</div>
              </div>
            </div>
          </div>
          <div className={styles.sectionBody}>
            {recruitersError && <p className={local.emptySub} style={{ color: "#dc2626" }}>{recruitersError}</p>}
            {recruitersLoading ? (
              <p className={styles.emptySub}>Loading…</p>
            ) : recruiters.length === 0 ? (
              <p className={styles.emptySub}>No recruiters invited yet.</p>
            ) : (
              <ul className={styles.miniList}>
                {recruiters.map((r) => (
                  <li key={r.id} className={styles.miniListItem} style={{ flexDirection: "column", alignItems: "stretch" }}>
                    <div className={local.recruiterHead}>
                      <div>
                        <strong>{r.full_name}</strong>
                        <span
                          className={`${local.statusPill} ${
                            r.is_active ? local.active : r.status === "pending" ? local.pending : local.other
                          }`}
                          style={{ marginLeft: 8 }}
                        >
                          {r.is_active ? "Active" : r.status}
                        </span>
                        <div className={local.recruiterMeta}>
                          {r.email} · {r.department} · {r.job_title}
                        </div>
                        <div className={local.recruiterMeta}>
                          Created {r.created_at ? new Date(r.created_at).toLocaleDateString() : "Null"}
                        </div>
                      </div>
                    </div>
                    <div className={local.capabilityChips}>
                      {Object.entries(CAPABILITY_LABELS).map(([key, label]) => (
                        <label key={key} className={local.capabilityChip}>
                          <input
                            type="checkbox"
                            checked={r.capabilities?.[key] ?? true}
                            onChange={() => toggleCapability(r.id, key, r.capabilities?.[key] ?? true)}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    {r.employee_count > 0 && (
                      <div className={local.recruiterMeta} style={{ marginTop: 8 }}>
                        <strong>Employees ({r.employee_count}):</strong>
                        <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                          {r.employees.map((e) => (
                            <li key={e.id}>{e.full_name} — {e.email}{e.job_title ? ` · ${e.job_title}` : ""}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </SuperAdminShell>
  );
}

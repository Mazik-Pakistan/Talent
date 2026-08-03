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
  updateRecruiter,
  updateRecruiterCapabilities,
} from "@/services/authService";
import { can } from "@/services/rbac";

const initialForm = { full_name: "", email: "", phone: "", password: "", confirm_password: "" };

const CAPABILITY_LABELS = {
  overview: "Overview dashboard",
  candidates: "Candidates",
  invite: "Invite & offer",
  employees: "Employees",
  talent: "Talent analytics",
  learning: "Learning",
  assistant: "AI assistant",
  messages: "Messages",
  announcements: "Announcements",
  it: "IT & support",
  reporting: "Activity & reporting",
  profile: "Profile",
};

const initialInviteForm = { full_name: "", email: "", job_title: "", department: "", office_location: "", is_remote: false };

const STATUS_FILTERS = [
  { key: "", label: "All" },
  { key: "active", label: "Active" },
  { key: "pending", label: "Pending" },
  { key: "inactive", label: "Inactive" },
  { key: "expired", label: "Expired" },
];

export default function SuperAdminDashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [activeTab, setActiveTab] = useState("recruiters");
  const [recruiters, setRecruiters] = useState([]);
  const [recruitersLoading, setRecruitersLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editSaving, setEditSaving] = useState(false);

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
      const data = await listRecruiters(accessToken, { status: statusFilter || undefined });
      setRecruiters(data.recruiters || []);
    } catch (error) {
      setRecruitersError(getApiErrorMessage(error, "Could not load recruiters."));
    } finally {
      setRecruitersLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { if (user) loadRecruiters(); }, [user, loadRecruiters]);

  const filteredRecruiters = searchQuery.trim().length >= 2
    ? recruiters.filter((r) => {
        const q = searchQuery.toLowerCase();
        return r.email.toLowerCase().includes(q) || (r.full_name || "").toLowerCase().includes(q) || (r.department || "").toLowerCase().includes(q) || (r.job_title || "").toLowerCase().includes(q);
      })
    : recruiters;

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

  async function toggleCapability(recruiterId, key, currentValue) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      const result = await updateRecruiterCapabilities(recruiterId, { capabilities: { [key]: !currentValue } }, accessToken);
      setRecruiters((prev) => prev.map((r) => r.id === recruiterId ? { ...r, capabilities: result.capabilities } : r));
    } catch { loadRecruiters(); }
  }

  function startEdit(r) {
    setEditingId(r.id);
    setEditForm({ job_title: r.job_title || "", department: r.department || "", office_location: r.office_location || "", status: r.status || "active" });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm({});
  }

  async function saveEdit(recruiterId) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setEditSaving(true);
    try {
      await updateRecruiter(recruiterId, editForm, accessToken);
      setEditingId(null);
      loadRecruiters();
    } catch (error) {
      alert(getApiErrorMessage(error, "Failed to update recruiter."));
    } finally {
      setEditSaving(false);
    }
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
                  {isSubmitting ? "Creating\u2026" : "Create super admin"}
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
                    <input type={t} value={inviteForm[k]} onChange={(e) => setInviteForm({ ...inviteForm, [k]: e.target.value })} required={k !== "office_location"} />
                  </label>
                ))}
              </div>

              <label className={local.checkboxRow} style={{ marginBottom: 16 }}>
                <input type="checkbox" checked={inviteForm.is_remote} onChange={(e) => setInviteForm({ ...inviteForm, is_remote: e.target.checked })} />
                Remote employee
              </label>

              <p className={local.capabilityLabel}>Default Capabilities</p>
              <div className={local.capabilityGrid}>
                {Object.entries(CAPABILITY_LABELS).map(([key, label]) => (
                  <label key={key} className={local.checkboxRow}>
                    <input type="checkbox" checked={inviteCaps[key]} onChange={(e) => setInviteCaps({ ...inviteCaps, [key]: e.target.checked })} />
                    {label}
                  </label>
                ))}
              </div>

              {inviteMessage && <p className={styles.formMessage}>{inviteMessage}</p>}
              <button type="submit" disabled={inviteSubmitting} className={styles.primaryButton}>
                {inviteSubmitting ? "Sending\u2026" : "Send invitation"}
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
                <div className={styles.sectionTitle}>All Recruiters</div>
                <div className={styles.sectionDesc}>Manage access, capabilities, and roles for every recruiter on the platform.</div>
              </div>
            </div>
          </div>

          <div className={styles.sectionBody}>
            <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="text"
                placeholder="Search by name, email, department\u2026"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ flex: "1 1 200px", padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13 }}
              />
              <div style={{ display: "flex", gap: 4 }}>
                {STATUS_FILTERS.map((sf) => (
                  <button
                    key={sf.key}
                    type="button"
                    onClick={() => setStatusFilter(sf.key)}
                    style={{
                      padding: "4px 12px",
                      fontSize: 12,
                      fontWeight: 600,
                      borderRadius: 20,
                      border: "1px solid var(--border)",
                      background: statusFilter === sf.key ? "#0D5C91" : "transparent",
                      color: statusFilter === sf.key ? "#fff" : "var(--text-muted)",
                      cursor: "pointer",
                    }}
                  >
                    {sf.label}
                  </button>
                ))}
              </div>
            </div>

            {recruitersLoading ? (
              <p className={styles.emptySub}>Loading\u2026</p>
            ) : filteredRecruiters.length === 0 ? (
              <p className={styles.emptySub}>{searchQuery || statusFilter ? "No recruiters match your filters." : "No recruiters on the platform yet."}</p>
            ) : (
              <ul className={styles.miniList}>
                {filteredRecruiters.map((r) => (
                  <li key={r.id} className={styles.miniListItem} style={{ flexDirection: "column", alignItems: "stretch" }}>
                    <div className={local.recruiterHead}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <strong>{r.full_name}</strong>
                          <span className={`${local.statusPill} ${r.is_active ? local.active : r.status === "pending" ? local.pending : r.status === "inactive" ? local.inactive : local.other}`}>
                            {r.status}
                          </span>
                          {r.has_employee_profile && (
                            <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "#ede9fe", color: "#5b21b6", fontWeight: 600 }}>DUAL ROLE</span>
                          )}
                          {r.employee_id && (
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{r.employee_id}</span>
                          )}
                        </div>
                        <div className={local.recruiterMeta}>{r.email}</div>
                        {editingId === r.id ? (
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8, marginTop: 10 }}>
                            {[
                              { k: "job_title", l: "Job Title" },
                              { k: "department", l: "Department" },
                              { k: "office_location", l: "Location" },
                            ].map(({ k, l }) => (
                              <label key={k} style={{ fontSize: 12 }}>
                                <span style={{ display: "block", color: "var(--text-muted)", marginBottom: 2 }}>{l}</span>
                                <input type="text" value={editForm[k]} onChange={(e) => setEditForm({ ...editForm, [k]: e.target.value })} style={{ width: "100%", padding: "4px 8px", border: "1px solid var(--border)", borderRadius: 4, fontSize: 12 }} />
                              </label>
                            ))}
                            <label style={{ fontSize: 12 }}>
                              <span style={{ display: "block", color: "var(--text-muted)", marginBottom: 2 }}>Status</span>
                              <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })} style={{ width: "100%", padding: "4px 8px", border: "1px solid var(--border)", borderRadius: 4, fontSize: 12 }}>
                                <option value="active">Active</option>
                                <option value="inactive">Inactive</option>
                              </select>
                            </label>
                            <div style={{ display: "flex", gap: 6, alignSelf: "end" }}>
                              <button type="button" disabled={editSaving} onClick={() => saveEdit(r.id)} className={styles.primaryButton} style={{ padding: "4px 14px", fontSize: 12 }}>
                                {editSaving ? "\u2026" : "Save"}
                              </button>
                              <button type="button" onClick={cancelEdit} style={{ padding: "4px 14px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, background: "transparent", cursor: "pointer" }}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div className={local.recruiterMeta}>
                            {r.job_title || "\u2014"} \u00b7 {r.department || "\u2014"} {r.office_location ? `\u00b7 ${r.office_location}` : ""} {r.created_at ? `\u00b7 Invited ${new Date(r.created_at).toLocaleDateString()}` : ""}
                          </div>
                        )}
                      </div>
                      {editingId !== r.id && (
                        <button type="button" onClick={() => startEdit(r)} style={{ padding: "4px 12px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, background: "transparent", cursor: "pointer", whiteSpace: "nowrap" }}>
                          Edit role
                        </button>
                      )}
                    </div>
                    <div className={local.capabilityChips}>
                      {Object.entries(CAPABILITY_LABELS).map(([key, label]) => (
                        <label key={key} className={local.capabilityChip}>
                          <input type="checkbox" checked={r.capabilities?.[key] ?? true} onChange={() => toggleCapability(r.id, key, r.capabilities?.[key] ?? true)} />
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

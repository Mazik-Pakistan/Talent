"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

import RecruiterLoader from "@/components/recruiter/RecruiterLoader";
import SuperAdminShell from "@/components/super-admin/SuperAdminShell";
import OrganizationDeleteModal from "@/components/OrganizationDeleteModal";
import styles from "@/components/recruiter/recruiter-shell.module.css";
import local from "./super-admin.module.css";
import {
  bootstrapSuperAdmin,
  bulkUpdateRecruiterCapabilities,
  createOrganization,
  deleteOrganization,
  getApiErrorMessage,
  getCapabilityTemplates,
  inviteRecruiter,
  listOrganizations,
  listRecruiters,
  updateOrganization,
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

const TEMPLATE_LABELS = {
  standard_recruiter: "Standard Recruiter",
  hiring_only: "Hiring Only",
  people_ops: "People Ops",
  it_admin: "IT Admin",
  viewer: "Viewer",
};

const initialInviteForm = { full_name: "", email: "", job_title: "", department: "", office_location: "", is_remote: false, organization_id: "" };

function allCapabilityFlags(source = {}, fallback = true) {
  return Object.keys(CAPABILITY_LABELS).reduce((acc, key) => {
    acc[key] = source[key] ?? fallback;
    return acc;
  }, {});
}

/** Modules purchased by an organization (all-true when org unknown). */
function orgPurchasedModules(organizations, organizationId) {
  if (!organizationId) return allCapabilityFlags({}, true);
  const org = organizations.find((o) => o.id === organizationId);
  if (!org) return allCapabilityFlags({}, true);
  return allCapabilityFlags(org.modules || {}, true);
}

/** Keep only modules the org purchased; force others off. */
function clampCapsToOrg(caps, orgModules) {
  return Object.keys(CAPABILITY_LABELS).reduce((acc, key) => {
    if (orgModules[key] === false) {
      acc[key] = false;
    } else {
      acc[key] = caps[key] ?? true;
    }
    return acc;
  }, {});
}

const emptyEditForm = { job_title: "", department: "", office_location: "", status: "active" };

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
  const [inviteCaps, setInviteCaps] = useState(() => allCapabilityFlags({}, true));
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteMessage, setInviteMessage] = useState("");
  const [templates, setTemplates] = useState({});
  const [activeTemplate, setActiveTemplate] = useState("standard_recruiter");
  const [bulkSelected, setBulkSelected] = useState([]);
  const [bulkTemplate, setBulkTemplate] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState("");
  const [orgFilter, setOrgFilter] = useState("");
  const [organizations, setOrganizations] = useState([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [orgFormOpen, setOrgFormOpen] = useState(false);
  const [orgForm, setOrgForm] = useState({ name: "", contact_email: "", description: "" });
  const [orgModules, setOrgModules] = useState(() => allCapabilityFlags({}, true));
  const [orgSaving, setOrgSaving] = useState(false);
  const [orgMessage, setOrgMessage] = useState("");
  const [orgDeleteTarget, setOrgDeleteTarget] = useState(null);
  const [orgDeleting, setOrgDeleting] = useState(false);
  const [orgDeleteError, setOrgDeleteError] = useState("");
  const [editOrgId, setEditOrgId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (token) {
      getCapabilityTemplates(token).then((data) => {
        setTemplates(data.templates || {});
      }).catch(() => {});
    }
  }, []);

  const loadOrganizations = useCallback(async () => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setOrgsLoading(true);
    try {
      const data = await listOrganizations(accessToken);
      setOrganizations(data.organizations || []);
    } catch { /* non-critical */ } finally {
      setOrgsLoading(false);
    }
  }, []);

  useEffect(() => { if (user) loadOrganizations(); }, [user, loadOrganizations]);

  // Auto-select the first organization in the invite form once they load,
  // so invites visibly bind to a real company instead of an invisible default.
  useEffect(() => {
    if (organizations.length > 0 && !inviteForm.organization_id) {
      setInviteForm((current) => ({ ...current, organization_id: organizations[0].id }));
    }
  }, [organizations, inviteForm.organization_id]);

  // When the selected organization changes, drop modules that org did not purchase.
  useEffect(() => {
    if (!inviteForm.organization_id || !organizations.length) return;
    const orgModules = orgPurchasedModules(organizations, inviteForm.organization_id);
    setInviteCaps((current) => clampCapsToOrg(current, orgModules));
    setActiveTemplate("");
  }, [inviteForm.organization_id, organizations]);

  function openCreateOrg() {
    setEditOrgId(null);
    setOrgForm({ name: "", contact_email: "", description: "" });
    setOrgModules(allCapabilityFlags({}, true));
    setOrgFormOpen(true);
    setOrgMessage("");
  }

  function openEditOrg(org) {
    setEditOrgId(org.id);
    setOrgForm({
      name: org.name || "",
      contact_email: org.contact_email || "",
      description: org.description || "",
    });
    setOrgModules(allCapabilityFlags(org.modules || {}, true));
    setOrgFormOpen(true);
    setOrgMessage("");
  }

  async function handleOrgSubmit(event) {
    event.preventDefault();
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setOrgSaving(true);
    setOrgMessage("");
    try {
      if (editOrgId) {
        await updateOrganization(editOrgId, { modules: orgModules }, accessToken);
        setOrgMessage("Organization modules updated.");
      } else {
        await createOrganization({ ...orgForm, modules: orgModules }, accessToken);
        setOrgMessage("Organization created.");
      }
      setOrgFormOpen(false);
      loadOrganizations();
    } catch (err) {
      setOrgMessage(getApiErrorMessage(err, "Could not save organization."));
    } finally {
      setOrgSaving(false);
    }
  }

  async   function handleOrgDelete(org) {
    setOrgDeleteTarget(org);
    setOrgDeleteError("");
  }

  async function confirmOrgDelete() {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken || !orgDeleteTarget || orgDeleting) return;
    setOrgDeleting(true);
    setOrgDeleteError("");
    try {
      const result = await deleteOrganization(orgDeleteTarget.id, accessToken);
      const wiped = result?.wiped || {};
      setOrgMessage(
        result?.message ||
          `Organization deleted. Wiped ${wiped.recruiters || 0} recruiter(s), ` +
            `${wiped.candidates || 0} candidate(s), ${wiped.employees || 0} employee(s).`
      );
      setOrgDeleteTarget(null);
      loadOrganizations();
      loadRecruiters();
    } catch (err) {
      setOrgDeleteError(getApiErrorMessage(err, "Could not delete organization."));
    } finally {
      setOrgDeleting(false);
    }
  }

  function applyTemplate(templateKey) {
    const template = templates[templateKey];
    if (!template) return;
    const orgModules = orgPurchasedModules(organizations, inviteForm.organization_id);
    setInviteCaps(clampCapsToOrg(allCapabilityFlags(template, false), orgModules));
    setActiveTemplate(templateKey);
  }

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

  const loadRecruiters = useCallback(async () => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setRecruitersLoading(true);
    try {
      const data = await listRecruiters(accessToken);
      setRecruiters(data.recruiters || []);
    } catch { /* non-critical */ } finally {
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
      const orgModules = orgPurchasedModules(organizations, inviteForm.organization_id);
      const capabilities = clampCapsToOrg(inviteCaps, orgModules);
      await inviteRecruiter({
        ...inviteForm,
        full_name: inviteForm.full_name.trim(),
        email: inviteForm.email.trim(),
        job_title: inviteForm.job_title.trim(),
        department: inviteForm.department.trim(),
        office_location: inviteForm.office_location.trim() || undefined,
        organization_id: inviteForm.organization_id || undefined,
        capabilities,
      }, accessToken);
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

  function toggleBulkSelect(id) {
    setBulkSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function toggleBulkSelectAll() {
    const filtered = recruiters.filter((r) => !orgFilter || r.organization_id === orgFilter);
    setBulkSelected((prev) => (prev.length === filtered.length ? [] : filtered.map((r) => r.id)));
  }

  async function handleBulkApply() {
    if (!bulkSelected.length || !bulkTemplate || !templates[bulkTemplate]) return;
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setBulkBusy(true);
    setBulkMessage("");
    try {
      const result = await bulkUpdateRecruiterCapabilities(
        { invitation_ids: bulkSelected, capabilities: templates[bulkTemplate] },
        accessToken
      );
      setBulkMessage(result.message || "Capabilities updated.");
      setBulkSelected([]);
      loadRecruiters();
    } catch (err) {
      setBulkMessage(getApiErrorMessage(err, "Bulk update failed."));
    } finally {
      setBulkBusy(false);
    }
  }

  function startEdit(r) {
    setEditingId(r.id);
    setEditForm({
      job_title: r.job_title || "",
      department: r.department || "",
      office_location: r.office_location || "",
      status: r.is_active ? "active" : r.status === "inactive" ? "inactive" : "active",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(emptyEditForm);
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
                      value={form[field] ?? ""}
                      onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                      required
                    />
                  </label>
                ))}
                {message && <p className={styles.formMessage}>{message}</p>}
                <button type="submit" disabled={isSubmitting} className={styles.primaryButton}>
                  {isSubmitting ? "Creating..." : "Create super admin"}
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
                      value={inviteForm[k] ?? ""}
                      onChange={(e) => setInviteForm({ ...inviteForm, [k]: e.target.value })}
                      required={k !== "office_location"}
                    />
                  </label>
                ))}
                <label className={styles.field}>
                  <span>Organization</span>
                  <select
                    value={inviteForm.organization_id ?? ""}
                    onChange={(e) => {
                      const organization_id = e.target.value;
                      setInviteForm({ ...inviteForm, organization_id });
                      const orgModules = orgPurchasedModules(organizations, organization_id);
                      setInviteCaps((current) => clampCapsToOrg(current, orgModules));
                      setActiveTemplate("");
                    }}
                  >
                    <option value="">Auto (default organization)</option>
                    {organizations.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className={local.checkboxRow} style={{ marginBottom: 16 }}>
                <input
                  type="checkbox"
                  checked={Boolean(inviteForm.is_remote)}
                  onChange={(e) => setInviteForm({ ...inviteForm, is_remote: e.target.checked })}
                />
                Remote employee
              </label>

              <p className={local.capabilityLabel}>Recruiter modules</p>
              <p className={local.recruiterMeta} style={{ marginBottom: 8 }}>
                Only modules purchased by the selected organization are shown. Turn off any of those you do not want
                this recruiter to use.
              </p>
              <div className={local.templateBar}>
                {Object.keys(TEMPLATE_LABELS).map((templateKey) => (
                  <button
                    key={templateKey}
                    type="button"
                    className={`${local.templateBtn} ${activeTemplate === templateKey ? local.templateBtnActive : ""}`}
                    onClick={() => applyTemplate(templateKey)}
                    title={templates[templateKey] ? Object.entries(templates[templateKey]).filter(([, v]) => v).map(([k]) => CAPABILITY_LABELS[k] || k).join(", ") : ""}
                  >
                    {TEMPLATE_LABELS[templateKey]}
                  </button>
                ))}
              </div>
              <div className={local.capabilityGrid}>
                {Object.entries(CAPABILITY_LABELS)
                  .filter(([key]) => orgPurchasedModules(organizations, inviteForm.organization_id)[key] !== false)
                  .map(([key, label]) => (
                  <label key={key} className={local.checkboxRow}>
                    <input
                      type="checkbox"
                      checked={Boolean(inviteCaps[key])}
                      onChange={(e) => { setInviteCaps({ ...inviteCaps, [key]: e.target.checked }); setActiveTemplate(""); }}
                    />
                    {label}
                  </label>
                ))}
              </div>
              {Object.values(orgPurchasedModules(organizations, inviteForm.organization_id)).some((v) => v === false) && (
                <p className={local.recruiterMeta} style={{ marginTop: 8 }}>
                  Hidden modules are not purchased by this organization. Enable them under Organizations first if needed.
                </p>
              )}

              {inviteMessage && <p className={styles.formMessage}>{inviteMessage}</p>}
              <button type="submit" disabled={inviteSubmitting} className={styles.primaryButton}>
                {inviteSubmitting ? "Sending..." : "Send invitation"}
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
            {recruitersLoading ? (
              <p className={styles.emptySub}>Loading...</p>
            ) : recruiters.length === 0 ? (
              <p className={styles.emptySub}>No recruiters invited yet.</p>
            ) : (
              <>
                <div className={local.bulkBar}>
                  <span className={local.bulkBarLabel}>Bulk update</span>
                  <label className={local.selectAllRow} style={{ marginBottom: 0 }}>
                    <input
                      type="checkbox"
                      checked={bulkSelected.length === recruiters.length}
                      onChange={toggleBulkSelectAll}
                    />
                    Select all ({recruiters.filter((r) => !orgFilter || r.organization_id === orgFilter).length})
                  </label>
                  <select
                    className={local.bulkSelect}
                    value={orgFilter}
                    onChange={(e) => { setOrgFilter(e.target.value); setBulkSelected([]); }}
                  >
                    <option value="">All organizations</option>
                    {organizations.map((org) => (
                      <option key={org.id} value={org.id}>{org.name}</option>
                    ))}
                  </select>
                  <select
                    className={local.bulkSelect}
                    value={bulkTemplate}
                    onChange={(e) => setBulkTemplate(e.target.value)}
                  >
                    <option value="">Apply template...</option>
                    {Object.keys(TEMPLATE_LABELS).map((templateKey) => (
                      <option key={templateKey} value={templateKey}>
                        {TEMPLATE_LABELS[templateKey]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={local.bulkApplyBtn}
                    disabled={bulkBusy || !bulkSelected.length || !bulkTemplate}
                    onClick={handleBulkApply}
                  >
                    {bulkBusy ? "Applying..." : `Apply to ${bulkSelected.length}`}
                  </button>
                  {bulkMessage && <span className={styles.formMessage}>{bulkMessage}</span>}
                </div>
                <ul className={styles.miniList}>
                  {recruiters.filter((r) => !orgFilter || r.organization_id === orgFilter).map((r) => (
                    <li key={r.id} className={styles.miniListItem} style={{ flexDirection: "column", alignItems: "stretch" }}>
                      <div className={local.recruiterRow}>
                        <input
                          type="checkbox"
                          className={local.recruiterCheckbox}
                          checked={bulkSelected.includes(r.id)}
                          onChange={() => toggleBulkSelect(r.id)}
                          title={`Select ${r.full_name} for bulk update`}
                        />
                        <div className={local.recruiterHead} style={{ flex: 1 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <strong>{r.full_name}</strong>
                              <span
                                className={`${local.statusPill} ${
                                  r.is_active ? local.active : r.status === "pending" ? local.pending : local.other
                                }`}
                              >
                                {r.is_active ? "Active" : r.status}
                              </span>
                              {r.has_employee_profile && (
                                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "#ede9fe", color: "#5b21b6", fontWeight: 600 }}>DUAL ROLE</span>
                              )}
                            </div>
                            <div className={local.recruiterMeta}>
                              {r.email}
                              {r.organization_id && (
                                <>{" - Org: "} {organizations.find((o) => o.id === r.organization_id)?.name || "-"}</>
                              )}
                            </div>
                            {editingId === r.id ? (
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8, marginTop: 10 }}>
                                {[
                                  { k: "job_title", l: "Job Title" },
                                  { k: "department", l: "Department" },
                                  { k: "office_location", l: "Location" },
                                ].map(({ k, l }) => (
                                  <label key={k} style={{ fontSize: 12 }}>
                                    <span style={{ display: "block", color: "var(--text-muted)", marginBottom: 2 }}>{l}</span>
                                    <input type="text" value={editForm[k] ?? ""} onChange={(e) => setEditForm({ ...editForm, [k]: e.target.value })} style={{ width: "100%", padding: "4px 8px", border: "1px solid var(--border)", borderRadius: 4, fontSize: 12 }} />
                                  </label>
                                ))}
                                <label style={{ fontSize: 12 }}>
                                  <span style={{ display: "block", color: "var(--text-muted)", marginBottom: 2 }}>Status</span>
                                  <select value={editForm.status ?? "active"} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })} style={{ width: "100%", padding: "4px 8px", border: "1px solid var(--border)", borderRadius: 4, fontSize: 12 }}>
                                    <option value="active">Active</option>
                                    <option value="inactive">Inactive</option>
                                  </select>
                                </label>
                                <div style={{ display: "flex", gap: 6, alignSelf: "end" }}>
                                  <button type="button" disabled={editSaving} onClick={() => saveEdit(r.id)} className={styles.primaryButton} style={{ padding: "4px 14px", fontSize: 12 }}>
                                    {editSaving ? "..." : "Save"}
                                  </button>
                                  <button type="button" onClick={cancelEdit} style={{ padding: "4px 14px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, background: "transparent", cursor: "pointer" }}>Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <div className={local.recruiterMeta}>
                                {r.job_title || "-"} - {r.department || "-"}
                                {r.office_location ? ` - ${r.office_location}` : ""}
                                {r.created_at ? ` - Created ${new Date(r.created_at).toLocaleDateString()}` : ""}
                              </div>
                            )}
                          </div>
                          {editingId !== r.id && (
                            <button type="button" onClick={() => startEdit(r)} style={{ padding: "4px 12px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, background: "transparent", cursor: "pointer", whiteSpace: "nowrap" }}>
                              Edit role
                            </button>
                          )}
                        </div>
                      </div>
                      <div className={local.capabilityChips}>
                        {Object.entries(CAPABILITY_LABELS).map(([key, label]) => {
                          const orgAllows = orgPurchasedModules(organizations, r.organization_id)[key] !== false;
                          if (!orgAllows) return null;
                          return (
                          <label key={key} className={local.capabilityChip}>
                            <input
                              type="checkbox"
                              checked={Boolean(r.capabilities?.[key] ?? true)}
                              onChange={() => toggleCapability(r.id, key, r.capabilities?.[key] ?? true)}
                            />
                            {label}
                          </label>
                          );
                        })}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === "organizations" && (
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionHeadLeft}>
              <div className={`${styles.bar} ${styles.cyan}`} />
              <div>
                <div className={styles.sectionTitle}>Organizations</div>
                <div className={styles.sectionDesc}>
                  Companies using the product. Grant each organization its own module set ? recruiters can only use
                  modules their organization has purchased.
                </div>
              </div>
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.primaryButton} onClick={openCreateOrg}>
                + New organization
              </button>
            </div>
          </div>
          <div className={styles.sectionBody}>
            {orgFormOpen && (
              <form onSubmit={handleOrgSubmit} style={{ marginBottom: 20, padding: 16, border: "1px solid var(--border)", borderRadius: 8 }}>
                <div className={styles.formGrid}>
                  <label className={styles.field}>
                    <span>Organization name *</span>
                    <input
                      value={orgForm.name ?? ""}
                      onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })}
                      placeholder="Acme Corp"
                      required={!editOrgId}
                      disabled={Boolean(editOrgId)}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Contact email</span>
                    <input
                      type="email"
                      value={orgForm.contact_email ?? ""}
                      onChange={(e) => setOrgForm({ ...orgForm, contact_email: e.target.value })}
                      disabled={Boolean(editOrgId)}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Description</span>
                    <input
                      value={orgForm.description ?? ""}
                      onChange={(e) => setOrgForm({ ...orgForm, description: e.target.value })}
                      disabled={Boolean(editOrgId)}
                    />
                  </label>
                </div>
                <p className={local.capabilityLabel}>Modules purchased by this organization</p>
                <p className={local.recruiterMeta} style={{ marginBottom: 8 }}>
                  These are the modules this company has bought. Recruiters in this org can never access a module that
                  is unchecked here, regardless of their own settings.
                </p>
                <div className={local.capabilityGrid}>
                  {Object.entries(CAPABILITY_LABELS).map(([key, label]) => (
                    <label key={key} className={local.checkboxRow}>
                      <input
                        type="checkbox"
                        checked={Boolean(orgModules[key])}
                        onChange={(e) => setOrgModules({ ...orgModules, [key]: e.target.checked })}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                {orgMessage && <p className={styles.formMessage}>{orgMessage}</p>}
                <div className={styles.actions} style={{ marginTop: 12 }}>
                  <button type="submit" className={styles.primaryButton} disabled={orgSaving}>
                    {orgSaving ? "Saving..." : editOrgId ? "Save modules" : "Create organization"}
                  </button>
                  <button type="button" className={styles.secondaryButton} onClick={() => setOrgFormOpen(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {orgsLoading ? (
              <p className={styles.emptySub}>Loading...</p>
            ) : organizations.length === 0 ? (
              <p className={styles.emptySub}>No organizations yet. Create one to start selling the product.</p>
            ) : (
              <ul className={styles.miniList}>
                {organizations.map((org) => (
                  <li key={org.id} className={styles.miniListItem} style={{ flexDirection: "column", alignItems: "stretch" }}>
                    <div className={local.recruiterHead}>
                      <div>
                        <strong>{org.name}</strong>
                        <span className={`${local.statusPill} ${org.status === "active" ? local.active : local.other}`} style={{ marginLeft: 8 }}>
                          {org.status}
                        </span>
                        <div className={local.recruiterMeta}>
                          {org.contact_email || "No contact email"} ? Created{" "}
                          {org.created_at ? new Date(org.created_at).toLocaleDateString() : "-"}
                          {" ? "}
                          {recruiters.filter((r) => r.organization_id === org.id).length} recruiter(s)
                        </div>
                        {org.description && <div className={local.recruiterMeta}>{org.description}</div>}
                      </div>
                      <div className={styles.actions} style={{ gap: 8 }}>
                        <button type="button" className={styles.secondaryButton} onClick={() => openEditOrg(org)}>
                          Edit modules
                        </button>
                        <button type="button" className={styles.secondaryButton} onClick={() => handleOrgDelete(org)}>
                          Delete
                        </button>
                      </div>
                    </div>
                    <div className={local.capabilityChips}>
                      {Object.entries(CAPABILITY_LABELS).map(([key, label]) => (
                        <span
                          key={key}
                          className={local.capabilityChip}
                          style={org.modules?.[key] ? { borderColor: "var(--green)", color: "var(--green)" } : { opacity: 0.4 }}
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <OrganizationDeleteModal
        open={Boolean(orgDeleteTarget)}
        onClose={() => {
          if (!orgDeleting) setOrgDeleteTarget(null);
        }}
        org={orgDeleteTarget}
        recruiterCount={
          orgDeleteTarget ? recruiters.filter((r) => r.organization_id === orgDeleteTarget.id).length : 0
        }
        busy={orgDeleting}
        error={orgDeleteError}
        onConfirm={confirmOrgDelete}
      />
    </SuperAdminShell>
  );
}
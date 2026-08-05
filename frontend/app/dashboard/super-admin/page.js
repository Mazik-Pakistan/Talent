"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

import RecruiterLoader from "@/components/recruiter/RecruiterLoader";
import SuperAdminShell from "@/components/super-admin/SuperAdminShell";
import OrganizationDeleteModal from "@/components/OrganizationDeleteModal";
import RecruiterDetailsModal from "@/components/super-admin/RecruiterDetailsModal";
import styles from "@/components/recruiter/recruiter-shell.module.css";
import local from "./super-admin.module.css";
import {
  bootstrapSuperAdmin,
  bulkUpdateRecruiterCapabilities,
  createOrganization,
  deleteOrganization,
  deleteRecruiter,
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
  
  // New state for improved UI
  const [selectedRecruiterId, setSelectedRecruiterId] = useState(null);
  const [showRecruiterDetails, setShowRecruiterDetails] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [recruitersPerPage] = useState(20);
  const [deletingRecruiterId, setDeletingRecruiterId] = useState(null);
  const [expandedOrgs, setExpandedOrgs] = useState({});
  const [editOrgModules, setEditOrgModules] = useState({});

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

  // New handler functions for improved UI
  function openRecruiterDetails(recruiterId) {
    setSelectedRecruiterId(recruiterId);
    setShowRecruiterDetails(true);
  }

  function closeRecruiterDetails() {
    setShowRecruiterDetails(false);
    setSelectedRecruiterId(null);
  }

  async function handleRecruiterDeleted() {
    await loadRecruiters();
    closeRecruiterDetails();
  }

  async function handleRecruiterUpdated() {
    await loadRecruiters();
  }

  async function quickDeleteRecruiter(recruiterId, recruiterName) {
    if (!confirm(`Are you sure you want to delete ${recruiterName}? This action cannot be undone.`)) {
      return;
    }
    
    setDeletingRecruiterId(recruiterId);
    try {
      const accessToken = localStorage.getItem("access_token");
      await deleteRecruiter(recruiterId, accessToken);
      await loadRecruiters();
    } catch (error) {
      alert(getApiErrorMessage(error, "Failed to delete recruiter."));
    } finally {
      setDeletingRecruiterId(null);
    }
  }

  // Organization card expansion functions
  function toggleOrgExpansion(orgId) {
    setExpandedOrgs(prev => ({
      ...prev,
      [orgId]: !prev[orgId]
    }));
  }

  function toggleOrgModule(orgId, moduleKey, currentValue) {
    setEditOrgModules(prev => ({
      ...prev,
      [orgId]: {
        ...prev[orgId],
        [moduleKey]: !currentValue
      }
    }));
  }

  async function saveOrgModules(orgId) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    
    try {
      const modules = editOrgModules[orgId];
      if (modules) {
        await updateOrganization(orgId, { modules }, accessToken);
        loadOrganizations();
        setEditOrgModules(prev => {
          const updated = { ...prev };
          delete updated[orgId];
          return updated;
        });
      }
    } catch (error) {
      alert(getApiErrorMessage(error, "Failed to update organization modules."));
    }
  }

  function cancelOrgEdit(orgId) {
    setEditOrgModules(prev => {
      const updated = { ...prev };
      delete updated[orgId];
      return updated;
    });
  }

  // Helper function to determine consistent recruiter status
  function getRecruiterStatus(recruiter) {
    // Debug log for taha to see actual structure
    if (recruiter.email === "hutezule@idf.ovh") {
      console.log("Debug taha:", {
        email: recruiter.email,
        is_active: recruiter.is_active,
        status: recruiter.status,
        recruiter_id: recruiter.recruiter_id,
        has_recruiter_profile: !!recruiter.recruiter_id,
        full_data: recruiter
      });
    }

    // 1. Has active recruiter profile = "Active"
    if (recruiter.recruiter_id && recruiter.is_active) {
      return "Active";
    }
    
    // 2. Has recruiter profile but inactive (deactivated by admin) = "Inactive"  
    if (recruiter.recruiter_id && !recruiter.is_active) {
      return "Inactive";
    }
    
    // 3. Invitation pending (never started registration) = "Pending"
    if (recruiter.status === "pending") {
      return "Pending";
    }
    
    // 4. Invitation used but no recruiter profile (incomplete registration) = "Pending"
    if (recruiter.status === "used" && !recruiter.recruiter_id) {
      return "Pending";
    }
    
    // 5. Any other case = "Pending" (safest default)
    return "Pending";
  }
  const filteredRecruiters = recruiters.filter(recruiter => {
    const matchesSearch = !searchTerm || 
      recruiter.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      recruiter.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      recruiter.job_title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      recruiter.department?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesOrg = !orgFilter || recruiter.organization_id === orgFilter;
    
    const matchesStatus = !statusFilter || 
      (statusFilter === "active" && recruiter.is_active) ||
      (statusFilter === "pending" && recruiter.status === "pending") ||
      (statusFilter === "inactive" && !recruiter.is_active && recruiter.status !== "pending");
    
    return matchesSearch && matchesOrg && matchesStatus;
  });

  const totalPages = Math.ceil(filteredRecruiters.length / recruitersPerPage);
  const startIndex = (currentPage - 1) * recruitersPerPage;
  const paginatedRecruiters = filteredRecruiters.slice(startIndex, startIndex + recruitersPerPage);

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
                <div className={styles.sectionDesc}>Manage access and capabilities for every recruiter you&apos;ve invited.</div>
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
                      checked={bulkSelected.length === paginatedRecruiters.length}
                      onChange={() => {
                        const filtered = paginatedRecruiters.filter((r) => !orgFilter || r.organization_id === orgFilter);
                        setBulkSelected((prev) => (prev.length === filtered.length ? [] : filtered.map((r) => r.id)));
                      }}
                    />
                    Select all ({filteredRecruiters.length})
                  </label>
                  <select
                    className={local.bulkSelect}
                    value={orgFilter}
                    onChange={(e) => { setOrgFilter(e.target.value); setBulkSelected([]); setCurrentPage(1); }}
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
                    className={styles.primaryButton}
                    disabled={bulkBusy || !bulkSelected.length || !bulkTemplate}
                    onClick={handleBulkApply}
                  >
                    {bulkBusy ? "Applying..." : `Apply to ${bulkSelected.length}`}
                  </button>
                  {bulkMessage && <span className={styles.formMessage}>{bulkMessage}</span>}
                </div>

                <div className={local.searchFilterBar}>
                  <input
                    type="search"
                    className={local.searchInput}
                    placeholder="Search by name, email, job title, or department..."
                    value={searchTerm}
                    onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                  />
                  <select
                    className={local.bulkSelect}
                    value={statusFilter}
                    onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}
                  >
                    <option value="">All statuses</option>
                    <option value="active">Active</option>
                    <option value="pending">Pending</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>

                <div className={local.recruiterCountBar}>
                  Showing {paginatedRecruiters.length > 0 ? startIndex + 1 : 0}-{startIndex + paginatedRecruiters.length} of {filteredRecruiters.length} recruiters
                </div>

                <ul className={local.recruiterList}>
                  {paginatedRecruiters.map((r) => (
                    <li key={r.id} className={local.recruiterCard}>
                      <div className={local.recruiterCardHead}>
                        <input
                          type="checkbox"
                          className={local.recruiterCheckbox}
                          checked={bulkSelected.includes(r.id)}
                          onChange={() => toggleBulkSelect(r.id)}
                          title={`Select ${r.full_name} for bulk update`}
                        />
                        <div className={local.recruiterAvatar}>
                          {(r.full_name || "?").charAt(0).toUpperCase()}
                        </div>
                        <div className={local.recruiterCardInfo}>
                          <div className={local.recruiterCardName}>
                            <strong>{r.full_name || "Unknown"}</strong>
                            <span
                              className={`${local.statusPill} ${
                                getRecruiterStatus(r) === "Active" ? local.active : 
                                getRecruiterStatus(r) === "Pending" ? local.pending : local.other
                              }`}
                            >
                              {getRecruiterStatus(r)}
                            </span>
                            {r.has_employee_profile && (
                              <span className={local.dualRolePill}>DUAL ROLE</span>
                            )}
                          </div>
                          <div className={local.recruiterCardEmail}>{r.email}</div>
                          <div className={local.recruiterCardMeta}>
                            {r.organization_id && (
                              <>Org: {organizations.find((o) => o.id === r.organization_id)?.name || "-"}
                              {r.job_title || r.department ? " • " : ""}</>
                            )}
                            {r.job_title || "-"} - {r.department || "-"}
                            {r.office_location ? ` - ${r.office_location}` : ""}
                            {r.created_at ? ` - Created ${new Date(r.created_at).toLocaleDateString()}` : ""}
                          </div>
                        </div>
                        <div className={local.recruiterCardActions}>
                          <button
                            type="button"
                            className={styles.secondaryButton}
                            onClick={() => openRecruiterDetails(r.id)}
                          >
                            View Details
                          </button>
                          <button
                            type="button"
                            className={styles.dangerButton}
                            disabled={deletingRecruiterId === r.id}
                            onClick={() => quickDeleteRecruiter(r.id, r.full_name || r.email)}
                          >
                            {deletingRecruiterId === r.id ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </div>
                      <div className={local.capabilityChips}>
                        {Object.entries(CAPABILITY_LABELS).map(([key, label]) => {
                          const orgAllows = orgPurchasedModules(organizations, r.organization_id)[key] !== false;
                          if (!orgAllows) return null;
                          return (
                          <label key={key} className={local.capabilityChip}>
                            <span className={local.chipLabel}>{label}</span>
                            <span className={local.miniToggle}>
                              <input
                                type="checkbox"
                                checked={Boolean(r.capabilities?.[key] ?? true)}
                                onChange={() => toggleCapability(r.id, key, r.capabilities?.[key] ?? true)}
                              />
                              <span className={local.miniSlider}></span>
                            </span>
                          </label>
                          );
                        })}
                      </div>
                    </li>
                  ))}
                </ul>

                {totalPages > 1 && (
                  <div className={local.paginationBar}>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage(currentPage - 1)}
                    >
                      Previous
                    </button>
                    <span className={local.pageInfo}>
                      Page {currentPage} of {totalPages}
                    </span>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      disabled={currentPage === totalPages}
                      onClick={() => setCurrentPage(currentPage + 1)}
                    >
                      Next
                    </button>
                  </div>
                )}
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
                  Companies using the product. Grant each organization its own module set — recruiters can only use
                  modules their organization has purchased.
                </div>
              </div>
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.primaryButton} onClick={openCreateOrg}>
                + New Organization
              </button>
            </div>
          </div>
          <div className={styles.sectionBody}>
            {orgFormOpen && (
              <div className={local.modernCard}>
                <div className={local.cardHeader}>
                  <h3>{editOrgId ? "Edit Organization" : "Create New Organization"}</h3>
                  <button 
                    type="button" 
                    className={local.closeButton}
                    onClick={() => setOrgFormOpen(false)}
                  >
                    ×
                  </button>
                </div>
                <form onSubmit={handleOrgSubmit} className={local.modernForm}>
                  <div className={local.formRow}>
                    <div className={local.inputGroup}>
                      <label>Organization Name *</label>
                      <input
                        type="text"
                        value={orgForm.name ?? ""}
                        onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })}
                        placeholder="e.g., Acme Corporation"
                        required={!editOrgId}
                        disabled={Boolean(editOrgId)}
                        className={local.modernInput}
                      />
                    </div>
                    <div className={local.inputGroup}>
                      <label>Contact Email</label>
                      <input
                        type="email"
                        value={orgForm.contact_email ?? ""}
                        onChange={(e) => setOrgForm({ ...orgForm, contact_email: e.target.value })}
                        placeholder="admin@acmecorp.com"
                        disabled={Boolean(editOrgId)}
                        className={local.modernInput}
                      />
                    </div>
                  </div>
                  <div className={local.inputGroup}>
                    <label>Description</label>
                    <textarea
                      value={orgForm.description ?? ""}
                      onChange={(e) => setOrgForm({ ...orgForm, description: e.target.value })}
                      placeholder="Brief description of the organization..."
                      disabled={Boolean(editOrgId)}
                      className={local.modernTextarea}
                      rows={3}
                    />
                  </div>
                  
                  <div className={local.moduleSection}>
                    <h4>Module Permissions</h4>
                    <p className={local.moduleDescription}>
                      Select which modules this organization has purchased. Recruiters can only access enabled modules.
                    </p>
                    <div className={local.moduleGrid}>
                      {Object.entries(CAPABILITY_LABELS).map(([key, label]) => (
                        <div key={key} className={local.toggleItem}>
                          <div className={local.toggleInfo}>
                            <span className={local.toggleLabel}>{label}</span>
                          </div>
                          <label className={local.toggleSwitch}>
                            <input
                              type="checkbox"
                              checked={Boolean(orgModules[key])}
                              onChange={(e) => setOrgModules({ ...orgModules, [key]: e.target.checked })}
                            />
                            <span className={local.slider}></span>
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  {orgMessage && <div className={local.alertMessage}>{orgMessage}</div>}
                  
                  <div className={styles.actions}>
                    <button 
                      type="submit" 
                      className={styles.primaryButton} 
                      disabled={orgSaving}
                    >
                      {orgSaving ? "Saving..." : (editOrgId ? "Update Organization" : "Create Organization")}
                    </button>
                    <button 
                      type="button" 
                      className={styles.secondaryButton} 
                      onClick={() => setOrgFormOpen(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}

            {orgsLoading ? (
              <div className={local.loadingState}>
                <div className={local.spinner}></div>
                <p>Loading organizations...</p>
              </div>
            ) : organizations.length === 0 ? (
              <div className={local.emptyState}>
                <h3>No Organizations Yet</h3>
                <p>Create your first organization to start managing modules and recruiters.</p>
                <button type="button" className={styles.primaryButton} onClick={openCreateOrg}>
                  + Create Organization
                </button>
              </div>
            ) : (
              <div className={local.organizationsGrid}>
                {organizations.map((org) => (
                  <div key={org.id} className={local.orgCard}>
                    <div className={local.orgCardHeader} onClick={() => toggleOrgExpansion(org.id)}>
                      <div className={local.orgInfo}>
                      <div className={local.orgName}>
                        <h3>{org.name}</h3>
                        <span className={`${local.statusBadge} ${org.status === "active" ? local.statusActive : local.statusInactive}`}>
                          {org.status}
                        </span>
                      </div>
                      <div className={local.orgMeta}>
                        <span className={local.metaItem}>
                          {org.contact_email || "No contact email"}
                        </span>
                        <span className={local.metaItem}>
                          Created {org.created_at ? new Date(org.created_at).toLocaleDateString() : "Unknown"}
                        </span>
                        <span className={local.metaItem}>
                          {recruiters.filter((r) => r.organization_id === org.id).length} recruiter(s)
                        </span>
                      </div>
                        {org.description && (
                          <p className={local.orgDescription}>{org.description}</p>
                        )}
                      </div>
                      <div className={local.expandButton}>
                        <span className={`${local.chevron} ${expandedOrgs[org.id] ? local.expanded : ''}`}>
                          ▼
                        </span>
                      </div>
                    </div>

                    {expandedOrgs[org.id] && (
                      <div className={local.orgCardContent}>
                        <div className={local.moduleHeader}>
                          <h4>Module Permissions</h4>
                          <div className={local.moduleActions}>
                            {editOrgModules[org.id] ? (
                              <>
                                <button
                                  type="button"
                                  className={styles.primaryButton}
                                  onClick={() => saveOrgModules(org.id)}
                                >
                                  Save Changes
                                </button>
                                <button
                                  type="button"
                                  className={styles.secondaryButton}
                                  onClick={() => cancelOrgEdit(org.id)}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className={styles.secondaryButton}
                                  onClick={() => setEditOrgModules(prev => ({ ...prev, [org.id]: { ...org.modules } }))}
                                >
                                  Edit Modules
                                </button>
                                <button
                                  type="button"
                                  className={styles.dangerButton}
                                  onClick={() => handleOrgDelete(org)}
                                >
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                        
                        <div className={local.moduleGrid}>
                          {Object.entries(CAPABILITY_LABELS).map(([key, label]) => {
                            const isEditing = editOrgModules[org.id];
                            const currentValue = isEditing 
                              ? editOrgModules[org.id][key] 
                              : org.modules?.[key];
                            
                            return (
                              <div key={key} className={local.moduleItem}>
                                <div className={local.moduleInfo}>
                                  <span className={local.moduleLabel}>{label}</span>
                                  <span className={`${local.moduleStatus} ${currentValue ? local.enabled : local.disabled}`}>
                                    {currentValue ? 'Enabled' : 'Disabled'}
                                  </span>
                                </div>
                                {isEditing ? (
                                  <label className={local.toggleSwitch}>
                                    <input
                                      type="checkbox"
                                      checked={Boolean(currentValue)}
                                      onChange={() => toggleOrgModule(org.id, key, currentValue)}
                                    />
                                    <span className={local.slider}></span>
                                  </label>
                                ) : (
                                  <div className={`${local.staticIndicator} ${currentValue ? local.enabled : local.disabled}`}>
                                    {currentValue ? '✓' : '✗'}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
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

      <RecruiterDetailsModal
        recruiterId={selectedRecruiterId}
        isOpen={showRecruiterDetails}
        onClose={closeRecruiterDetails}
        onDeleted={handleRecruiterDeleted}
        onUpdated={handleRecruiterUpdated}
        organizations={organizations}
      />
    </SuperAdminShell>
  );
}
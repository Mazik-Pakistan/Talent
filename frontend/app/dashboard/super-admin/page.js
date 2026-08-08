"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

import RecruiterLoader from "@/components/recruiter/RecruiterLoader";
import SuperAdminShell from "@/components/super-admin/SuperAdminShell";
import InviteRecruiter from "@/components/super-admin/InviteRecruiter";
import OrganizationsPanel from "@/components/super-admin/OrganizationsPanel";
import RecruitersPanel from "@/components/super-admin/RecruitersPanel";
import SupportTicketsPanel from "@/components/super-admin/SupportTicketsPanel";
import StatsCard from "@/components/super-admin/StatsCard";
import OrganizationDeleteModal from "@/components/OrganizationDeleteModal";
import RecruiterDetailsModal from "@/components/super-admin/RecruiterDetailsModal";
import styles from "@/components/recruiter/recruiter-shell.module.css";
import local from "./super-admin.module.css";
import { toast } from "react-toastify";
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
import { clearSuperAdminContext, publishSuperAdminContext } from "@/lib/ai/superAdminContext";
import { SUPER_ADMIN_TAB_HELP } from "@/lib/ai/superAdminFieldHelp";

const SparkleIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M12 2.5l1.9 5.1 5.1 1.9-5.1 1.9L12 16.5l-1.9-5.1-5.1-1.9 5.1-1.9L12 2.5z" />
    <path d="M19 15l.9 2.3L22 18l-2.1.7L19 21l-.9-2.3L16 18l2.1-.7L19 15z" />
  </svg>
);

const ICONS = {
  recruiters: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  active: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 12l2 2 4-4" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  ),
  pending: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  ),
  organizations: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
};

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
  support: "Support tickets",
};

const ORG_MODULE_KEYS = Object.keys(CAPABILITY_LABELS).filter((key) => key !== "support");

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

function orgModuleFlags(source = {}, fallback = true) {
  return ORG_MODULE_KEYS.reduce((acc, key) => {
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
  const [activeTab, setActiveTab] = useState("overview");
  const [recruiters, setRecruiters] = useState([]);
  const [recruitersLoading, setRecruitersLoading] = useState(false);
  const [inviteForm, setInviteForm] = useState(initialInviteForm);
  const [inviteCaps, setInviteCaps] = useState(() => allCapabilityFlags({}, true));
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [templates, setTemplates] = useState({});
  const [activeTemplate, setActiveTemplate] = useState("standard_recruiter");
  const [bulkSelected, setBulkSelected] = useState([]);
  const [bulkTemplate, setBulkTemplate] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [orgFilter, setOrgFilter] = useState("");
  const [organizations, setOrganizations] = useState([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [orgFormOpen, setOrgFormOpen] = useState(false);
  const [orgForm, setOrgForm] = useState({ name: "", contact_email: "", description: "" });
  const [orgModules, setOrgModules] = useState(() => orgModuleFlags({}, true));
  const [orgSaving, setOrgSaving] = useState(false);
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

  useEffect(() => {
    const help = SUPER_ADMIN_TAB_HELP[activeTab] || {};
    publishSuperAdminContext({
      tab: activeTab,
      section: activeTab,
      hint: help.hint || null,
      fields: help.fields || [],
    });
    return () => clearSuperAdminContext();
  }, [activeTab]);

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
    setOrgModules(orgModuleFlags({}, true));
    setOrgFormOpen(true);
  }

  function openEditOrg(org) {
    setEditOrgId(org.id);
    setOrgForm({
      name: org.name || "",
      contact_email: org.contact_email || "",
      description: org.description || "",
    });
    setOrgModules(orgModuleFlags(org.modules || {}, true));
    setOrgFormOpen(true);
  }

  function closeOrgForm() {
    if (orgSaving) return;
    setOrgFormOpen(false);
    setEditOrgId(null);
  }

  async function handleOrgSubmit(event) {
    event.preventDefault();
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setOrgSaving(true);
    try {
      const payload = {
        name: orgForm.name.trim(),
        contact_email: orgForm.contact_email.trim() || undefined,
        description: orgForm.description.trim() || undefined,
        modules: orgModuleFlags(orgModules, true),
      };
      if (editOrgId) {
        await updateOrganization(editOrgId, payload, accessToken);
        toast.success("Organization modules updated.");
      } else {
        await createOrganization(payload, accessToken);
        toast.success("Organization created.");
      }
      setOrgFormOpen(false);
      setEditOrgId(null);
      loadOrganizations();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not save organization."));
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
    try {
      const result = await deleteOrganization(orgDeleteTarget.id, accessToken);
      const wiped = result?.wiped || {};
      toast.success(
        result?.message ||
          `Organization deleted. Wiped ${wiped.recruiters || 0} recruiter(s), ` +
            `${wiped.candidates || 0} candidate(s), ${wiped.employees || 0} employee(s).`
      );
      setOrgDeleteTarget(null);
      loadOrganizations();
      loadRecruiters();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not delete organization."));
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
    setInviteSubmitting(true);
    try {
      const accessToken = localStorage.getItem("access_token");
      const orgModules = orgPurchasedModules(organizations, inviteForm.organization_id);
      const capabilities = clampCapsToOrg(inviteCaps, orgModules);
      const invitePayload = {
        ...inviteForm,
        full_name: inviteForm.full_name.trim(),
        email: inviteForm.email.trim(),
        job_title: inviteForm.job_title.trim(),
        department: inviteForm.department.trim(),
        office_location: inviteForm.office_location.trim() || undefined,
        organization_id: inviteForm.organization_id || undefined,
        capabilities,
      };
      await inviteRecruiter(invitePayload, accessToken);
      toast.success("Invitation sent successfully!");
      setInviteForm(initialInviteForm);
      loadRecruiters();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to send invitation."));
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
    } catch {
      toast.error("Could not update capability.");
      loadRecruiters();
    }
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
    try {
      const result = await bulkUpdateRecruiterCapabilities(
        { invitation_ids: bulkSelected, capabilities: templates[bulkTemplate] },
        accessToken
      );
      toast.success(result.message || "Capabilities updated.");
      setBulkSelected([]);
      loadRecruiters();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Bulk update failed."));
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
      status: r.recruiter_id ? (r.is_active ? "active" : "inactive") : "pending",
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
      const recruiter = recruiters.find((r) => r.id === recruiterId);
      const payload = { ...editForm };
      if (!recruiter?.recruiter_id) delete payload.status;
      await updateRecruiter(recruiterId, payload, accessToken);
      toast.success("Recruiter updated.");
      setEditingId(null);
      loadRecruiters();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to update recruiter."));
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
      toast.success("Recruiter deleted.");
      await loadRecruiters();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to delete recruiter."));
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
        toast.success("Organization modules updated.");
        loadOrganizations();
        setEditOrgModules(prev => {
          const updated = { ...prev };
          delete updated[orgId];
          return updated;
        });
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to update organization modules."));
    }
  }

  function cancelOrgEdit(orgId) {
    setEditOrgModules(prev => {
      const updated = { ...prev };
      delete updated[orgId];
      return updated;
    });
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
              <form data-partner-coach onSubmit={handleBootstrap}>
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
      {activeTab === "overview" && (
        <>
          <div className={styles.hero} style={{ marginBottom: 20 }}>
            <div className={styles.heroEyebrow}>Platform Administration</div>
            <h1>Welcome to the Super Admin Dashboard</h1>
            <div className={styles.heroMeta}>
              Manage recruiters, organizations, and platform-wide settings from here.
            </div>
            <div className={styles.heroRecommend}>
              <SparkleIcon />
              <div>
                <div style={{ fontWeight: 700, color: "var(--navy)", marginBottom: 2 }}>
                  {recruiters.length > 0 ? "Platform Overview" : "Get Started"}
                </div>
                <div>
                  {recruiters.length > 0
                    ? `${recruiters.length} recruiter${recruiters.length === 1 ? "" : "s"} managing hiring pipelines across ${organizations.length} organization${organizations.length === 1 ? "" : "s"}.`
                    : "Invite your first recruiter to start managing hiring pipelines."}
                </div>
                <button
                  type="button"
                  className={styles.linkButton}
                  style={{ marginTop: 8 }}
                  onClick={() => setActiveTab("invite")}
                >
                  {recruiters.length > 0 ? "Invite another →" : "Invite recruiter →"}
                </button>
              </div>
            </div>
          </div>

          <div className={styles.stats}>
            <StatsCard
              tone="navy"
              value={recruiters.length}
              label="Total Recruiters"
              icon={ICONS.recruiters}
            />
            <StatsCard
              tone="green"
              value={recruiters.filter((r) => r.is_active).length}
              label="Active Recruiters"
              icon={ICONS.active}
            />
            <StatsCard
              tone="orange"
              value={recruiters.filter((r) => r.status === "pending").length}
              label="Pending Invitations"
              icon={ICONS.pending}
            />
            <StatsCard
              tone="cyan"
              value={organizations.length}
              label="Organizations"
              icon={ICONS.organizations}
            />
          </div>

          <div className={styles.quickGrid}>
            <button
              type="button"
              className={styles.quickAction}
              onClick={() => setActiveTab("invite")}
            >
              <span className={styles.qaIcon}>↗</span>
              <strong>Invite Recruiter</strong>
              <span className={styles.qaHint}>Send onboarding invitations</span>
            </button>
            <button
              type="button"
              className={styles.quickAction}
              onClick={() => setActiveTab("recruiters")}
            >
              <span className={styles.qaIcon}>↗</span>
              <strong>Manage Recruiters</strong>
              <span className={styles.qaHint}>View and edit recruiter access</span>
            </button>
            <button
              type="button"
              className={styles.quickAction}
              onClick={() => setActiveTab("organizations")}
            >
              <span className={styles.qaIcon}>↗</span>
              <strong>Organizations</strong>
              <span className={styles.qaHint}>Configure company modules</span>
            </button>
          </div>
        </>
      )}

      {activeTab === "invite" && (
        <InviteRecruiter
          inviteForm={inviteForm}
          setInviteForm={setInviteForm}
          inviteCaps={inviteCaps}
          setInviteCaps={setInviteCaps}
          inviteSubmitting={inviteSubmitting}
          handleInvite={handleInvite}
          organizations={organizations}
          templates={templates}
          activeTemplate={activeTemplate}
          setActiveTemplate={setActiveTemplate}
          applyTemplate={applyTemplate}
        />
      )}
      {activeTab === "recruiters" && (
        <RecruitersPanel
          recruiters={recruiters}
          recruitersLoading={recruitersLoading}
          organizations={organizations}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          orgFilter={orgFilter}
          setOrgFilter={setOrgFilter}
          bulkSelected={bulkSelected}
          toggleBulkSelect={toggleBulkSelect}
          toggleBulkSelectAll={toggleBulkSelectAll}
          bulkTemplate={bulkTemplate}
          setBulkTemplate={setBulkTemplate}
          handleBulkApply={handleBulkApply}
          bulkBusy={bulkBusy}
          templates={templates}
          startEdit={startEdit}
          editingId={editingId}
          editForm={editForm}
          setEditForm={setEditForm}
          saveEdit={saveEdit}
          cancelEdit={cancelEdit}
          editSaving={editSaving}
          toggleCapability={toggleCapability}
          quickDeleteRecruiter={quickDeleteRecruiter}
          onTabChange={setActiveTab}
        />
      )}

      {activeTab === "organizations" && (
        <OrganizationsPanel
          organizations={organizations}
          recruiters={recruiters}
          orgsLoading={orgsLoading}
          openCreateOrg={openCreateOrg}
          handleOrgDelete={handleOrgDelete}
          setEditOrgModules={setEditOrgModules}
          editOrgModules={editOrgModules}
          toggleOrgModule={toggleOrgModule}
          saveOrgModules={saveOrgModules}
          cancelOrgEdit={cancelOrgEdit}
          expandedOrgs={expandedOrgs}
          toggleOrgExpansion={toggleOrgExpansion}
        />
      )}

      {activeTab === "support" && (
        <SupportTicketsPanel />
      )}

      {orgFormOpen && (
        <div className={local.orgModalBackdrop} role="presentation" onMouseDown={closeOrgForm}>
          <div
            className={local.orgModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="org-form-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={local.orgModalHeader}>
              <div>
                <div className={local.orgModalEyebrow}>Organizations</div>
                <h2 id="org-form-title" className={local.orgModalTitle}>
                  {editOrgId ? "Edit Organization" : "New Organization"}
                </h2>
                <p className={local.orgModalDesc}>
                  {editOrgId
                    ? "Update the organization profile and module access."
                    : "Create a new organization and choose which modules it has access to."}
                </p>
              </div>
              <button type="button" className={local.orgModalClose} onClick={closeOrgForm} aria-label="Close">
                ×
              </button>
            </div>

            <form data-partner-coach className={local.orgModalBody} onSubmit={handleOrgSubmit}>
              <label className={local.orgField}>
                <span>Name</span>
                <input
                  type="text"
                  data-field-key="organization_name"
                  value={orgForm.name}
                  onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })}
                  placeholder="Acme Corporation"
                  required
                  disabled={orgSaving}
                />
              </label>
              <label className={local.orgField}>
                <span>Contact Email</span>
                <input
                  type="email"
                  data-field-key="contact_email"
                  value={orgForm.contact_email}
                  onChange={(e) => setOrgForm({ ...orgForm, contact_email: e.target.value })}
                  placeholder="hr@company.com"
                  disabled={orgSaving}
                />
              </label>
              <label className={local.orgField}>
                <span>Description</span>
                <textarea
                  data-field-key="description"
                  value={orgForm.description}
                  onChange={(e) => setOrgForm({ ...orgForm, description: e.target.value })}
                  placeholder="Short description of the organization"
                  rows={4}
                  disabled={orgSaving}
                />
              </label>

              <div className={local.orgModuleSection}>
                <div className={local.orgModuleHeading}>Module Access</div>
                <div className={local.orgModuleGrid}>
                  {Object.entries(CAPABILITY_LABELS).map(([key, label]) => (
                    <label key={key} className={local.orgModuleToggle}>
                      <span>{label}</span>
                      <input
                        type="checkbox"
                        checked={Boolean(orgModules[key])}
                        onChange={() => setOrgModules((current) => ({ ...current, [key]: !current[key] }))}
                        disabled={orgSaving}
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className={local.orgModalActions}>
                <button type="button" className={local.orgSecondaryButton} onClick={closeOrgForm} disabled={orgSaving}>
                  Cancel
                </button>
                <button type="submit" className={local.orgPrimaryButton} disabled={orgSaving}>
                  {orgSaving ? "Saving..." : editOrgId ? "Save Organization" : "Create Organization"}
                </button>
              </div>
            </form>
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

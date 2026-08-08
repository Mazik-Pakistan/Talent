import { useState, useEffect, useCallback } from "react";
import { getRecruiterDetails, deleteRecruiter, updateRecruiterCapabilities, updateRecruiter, getApiErrorMessage } from "@/services/authService";
import styles from "./RecruiterDetailsModal.module.css";
import shell from "@/components/recruiter/recruiter-shell.module.css";

const CAPABILITY_LABELS = {
  overview: "Overview dashboard",
  candidates: "Candidates", 
  invite: "Invite & offer",
  employees: "Employees",
  talent: "Talent analytics",
  learning: "Learning",
  org_config: "Organization Setup",
  assistant: "AI assistant",
  messages: "Messages",
  announcements: "Announcements",
  it: "IT & support",
  reporting: "Activity & reporting",
  profile: "Profile",
  support: "Support tickets",
};

export default function RecruiterDetailsModal({ 
  recruiterId, 
  isOpen, 
  onClose, 
  onDeleted, 
  onUpdated,
  organizations = [] 
}) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const loadRecruiterDetails = useCallback(async () => {
    if (!isOpen || !recruiterId) return;
    setLoading(true);
    setError("");
    try {
      const accessToken = localStorage.getItem("access_token");
      const data = await getRecruiterDetails(recruiterId, accessToken);
      setDetails(data.recruiter);

      // Keep invitation-only recruiters pending until they register.
      const profile = data.recruiter.profile || {};
      const invitation = data.recruiter.invitation || {};
      setEditForm({
        full_name: profile.full_name || invitation.full_name || "",
        job_title: profile.job_title || invitation.job_title || "",
        department: profile.department || invitation.department || "",
        office_location: profile.office_location || invitation.office_location || "",
        status: profile.user_id ? (profile.status || "active") : "pending",
      });
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to load recruiter details"));
    } finally {
      setLoading(false);
    }
  }, [isOpen, recruiterId]);

  useEffect(() => {
    loadRecruiterDetails();
  }, [loadRecruiterDetails]);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const accessToken = localStorage.getItem("access_token");
      const payload = { ...editForm };
      if (!details?.profile?.user_id) {
        delete payload.status;
      }
      await updateRecruiter(recruiterId, payload, accessToken);
      setIsEditing(false);
      await loadRecruiterDetails();
      onUpdated && onUpdated();
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to update recruiter"));
    } finally {
      setSaving(false);
    }
  };

  const handleCapabilityToggle = async (key, currentValue) => {
    try {
      const accessToken = localStorage.getItem("access_token");
      await updateRecruiterCapabilities(recruiterId, { 
        capabilities: { [key]: !currentValue } 
      }, accessToken);
      await loadRecruiterDetails();
      onUpdated && onUpdated();
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to update capability"));
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError("");
    try {
      const accessToken = localStorage.getItem("access_token");
      await deleteRecruiter(recruiterId, accessToken);
      onDeleted && onDeleted();
      onClose();
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to delete recruiter"));
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  // Helper function to determine consistent recruiter status
  const getRecruiterStatus = (details) => {
    if (!details) return "Unknown";
    
    const profile = details.profile;
    if (profile) {
      return profile.status === "inactive" ? "Inactive" : "Active";
    }
    return "Pending";
  };

  const getOrganizationName = (orgId) => {
    const org = organizations.find(o => o.id === orgId);
    return org ? org.name : "Unknown Organization";
  };

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <h2>Recruiter Details</h2>
            {details && (
              <div className={styles.recruiterSummary}>
                <span className={styles.name}>
                  {details.profile?.full_name || details.invitation?.full_name || "Unknown"}
                </span>
                <span className={`${styles.statusBadge} ${
                  getRecruiterStatus(details) === "Active"
                    ? styles.active
                    : getRecruiterStatus(details) === "Pending"
                      ? styles.pending
                      : styles.inactive
                }`}>
                  {getRecruiterStatus(details)}
                </span>
                {details.employee_profile && (
                  <span className={styles.dualRole}>DUAL ROLE</span>
                )}
              </div>
            )}
          </div>
          <div className={styles.headerActions}>
            {!isEditing && (
              <button 
                onClick={() => setIsEditing(true)}
                className={shell.secondaryButton}
              >
                Edit
              </button>
            )}
            <button 
              onClick={() => setShowDeleteConfirm(true)}
              className={shell.dangerButton}
              disabled={deleting}
            >
              Delete
            </button>
            <button onClick={onClose} className={styles.closeBtn}>×</button>
          </div>
        </div>

        {error && (
          <div className={styles.error}>{error}</div>
        )}

        {loading ? (
          <div className={styles.loading}>Loading recruiter details...</div>
        ) : details ? (
          <div className={styles.content}>
            <div className={styles.tabs}>
              <button 
                className={`${styles.tab} ${activeTab === "overview" ? styles.active : ""}`}
                onClick={() => setActiveTab("overview")}
              >
                Overview
              </button>
              <button 
                className={`${styles.tab} ${activeTab === "capabilities" ? styles.active : ""}`}
                onClick={() => setActiveTab("capabilities")}
              >
                Capabilities
              </button>
              <button 
                className={`${styles.tab} ${activeTab === "statistics" ? styles.active : ""}`}
                onClick={() => setActiveTab("statistics")}
              >
                Statistics
              </button>
            </div>

            <div className={styles.tabContent}>
              {activeTab === "overview" && (
                <div className={styles.overview}>
                  {isEditing ? (
                    <div className={styles.editForm}>
                      <div className={styles.formGrid}>
                        <label className={styles.field}>
                          <span>Full Name</span>
                          <input
                            type="text"
                            value={editForm.full_name}
                            onChange={(e) => setEditForm({...editForm, full_name: e.target.value})}
                          />
                        </label>
                        <label className={styles.field}>
                          <span>Job Title</span>
                          <input
                            type="text"
                            value={editForm.job_title}
                            onChange={(e) => setEditForm({...editForm, job_title: e.target.value})}
                          />
                        </label>
                        <label className={styles.field}>
                          <span>Department</span>
                          <input
                            type="text"
                            value={editForm.department}
                            onChange={(e) => setEditForm({...editForm, department: e.target.value})}
                          />
                        </label>
                        <label className={styles.field}>
                          <span>Office Location</span>
                          <input
                            type="text"
                            value={editForm.office_location}
                            onChange={(e) => setEditForm({...editForm, office_location: e.target.value})}
                          />
                        </label>
                        <label className={styles.field}>
                          <span>Status</span>
                          {details.profile ? (
                            <select
                              value={editForm.status}
                              onChange={(e) => setEditForm({...editForm, status: e.target.value})}
                            >
                              <option value="active">Active</option>
                              <option value="inactive">Inactive</option>
                            </select>
                          ) : (
                            <select value="pending" disabled>
                              <option value="pending">Pending</option>
                            </select>
                          )}
                        </label>
                      </div>
                      <div className={styles.formActions}>
                        <button 
                          onClick={handleSave}
                          disabled={saving}
                          className={shell.primaryButton}
                        >
                          {saving ? "Saving..." : "Save Changes"}
                        </button>
                        <button 
                          onClick={() => setIsEditing(false)}
                          className={shell.secondaryButton}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className={styles.infoGrid}>
                      <div className={styles.infoCard}>
                        <h3>Basic Information</h3>
                        <div className={styles.infoItem}>
                          <label>Email:</label>
                          <span>{details.profile?.email || details.invitation?.email}</span>
                        </div>
                        <div className={styles.infoItem}>
                          <label>Phone:</label>
                          <span>{details.profile?.phone || details.user_account?.phone || "Not provided"}</span>
                        </div>
                        <div className={styles.infoItem}>
                          <label>Job Title:</label>
                          <span>{details.profile?.job_title || details.invitation?.job_title || "Not set"}</span>
                        </div>
                        <div className={styles.infoItem}>
                          <label>Department:</label>
                          <span>{details.profile?.department || details.invitation?.department || "Not set"}</span>
                        </div>
                        <div className={styles.infoItem}>
                          <label>Office Location:</label>
                          <span>{details.profile?.office_location || details.invitation?.office_location || "Not set"}</span>
                        </div>
                        <div className={styles.infoItem}>
                          <label>Organization:</label>
                          <span>{getOrganizationName(details.profile?.organization_id || details.invitation?.organization_id)}</span>
                        </div>
                      </div>

                      <div className={styles.infoCard}>
                        <h3>Account Status</h3>
                        <div className={styles.infoItem}>
                          <label>Account Status:</label>
                          <span className={`${styles.statusText} ${
                            getRecruiterStatus(details) === "Active"
                              ? styles.active
                              : getRecruiterStatus(details) === "Pending"
                                ? styles.pending
                                : styles.inactive
                          }`}>
                            {getRecruiterStatus(details)}
                          </span>
                        </div>
                        <div className={styles.infoItem}>
                          <label>User ID:</label>
                          <span className={styles.monospace}>{details.profile?.user_id || "Not assigned"}</span>
                        </div>
                        <div className={styles.infoItem}>
                          <label>Created:</label>
                          <span>{details.profile?.created_at ? new Date(details.profile.created_at).toLocaleString() : "Unknown"}</span>
                        </div>
                        <div className={styles.infoItem}>
                          <label>Last Updated:</label>
                          <span>{details.profile?.updated_at ? new Date(details.profile.updated_at).toLocaleString() : "Unknown"}</span>
                        </div>
                        {details.employee_profile && (
                          <div className={styles.infoItem}>
                            <label>Employee Profile:</label>
                            <span className={styles.dualRoleText}>Has employee access</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "capabilities" && (
                <div className={styles.capabilities}>
                  <h3>System Capabilities</h3>
                  <div className={styles.capabilityGrid}>
                    {Object.entries(CAPABILITY_LABELS).map(([key, label]) => {
                      const hasCapability = details.profile?.capabilities?.[key] ?? true;
                      return (
                        <label key={key} className={styles.capabilityItem}>
                          <input
                            type="checkbox"
                            checked={hasCapability}
                            onChange={() => handleCapabilityToggle(key, hasCapability)}
                            disabled={isEditing}
                          />
                          <span>{label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeTab === "statistics" && (
                <div className={styles.statistics}>
                  <h3>Activity Statistics</h3>
                  <div className={styles.statsGrid}>
                    <div className={styles.statCard}>
                      <div className={styles.statNumber}>
                        {details.statistics?.candidates_managed || 0}
                      </div>
                      <div className={styles.statLabel}>Candidates Managed</div>
                    </div>
                    <div className={styles.statCard}>
                      <div className={styles.statNumber}>
                        {details.statistics?.employees_managed || 0}
                      </div>
                      <div className={styles.statLabel}>Employees Managed</div>
                    </div>
                    <div className={styles.statCard}>
                      <div className={styles.statNumber}>
                        {details.statistics?.offers_created || 0}
                      </div>
                      <div className={styles.statLabel}>Offers Created</div>
                    </div>
                    <div className={styles.statCard}>
                      <div className={styles.statNumber}>
                        {details.statistics?.invitations_sent || 0}
                      </div>
                      <div className={styles.statLabel}>Invitations Sent</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className={styles.error}>Failed to load recruiter details</div>
        )}

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className={styles.deleteOverlay}>
            <div className={styles.deleteModal}>
              <h3>Delete Recruiter</h3>
              <p>
                Are you sure you want to permanently delete this recruiter? This action cannot be undone.
              </p>
              <p className={styles.deleteWarning}>
                This will remove the recruiter account, user login, and all associated data.
              </p>
              <div className={styles.deleteActions}>
                <button 
                  onClick={handleDelete}
                  disabled={deleting}
                  className={shell.dangerButton}
                >
                  {deleting ? "Deleting..." : "Delete Permanently"}
                </button>
                <button 
                  onClick={() => setShowDeleteConfirm(false)}
                  className={shell.secondaryButton}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

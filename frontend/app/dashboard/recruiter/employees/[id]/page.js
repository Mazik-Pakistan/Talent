"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import RecruiterShell from "@/components/recruiter/RecruiterShell";
import styles from "@/components/recruiter/recruiter-shell.module.css";
import {
  getEmployeeDetail,
  getApiErrorMessage,
  setEmployeeCompanyEmail,
  assignEmployeeAsset,
  removeEmployeeAsset,
  scheduleEmployeeOrientation,
  remindEmployeeProfile,
} from "@/services/authService";
import EmployeeLearningPanel from "@/components/recruiter/EmployeeLearningPanel";
import EmployeeTalentPanel from "@/components/recruiter/EmployeeTalentPanel";
import RecruiterDocumentReview from "@/components/RecruiterDocumentReview";

function toLabel(key) {
  return String(key)
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

function fmtDate(raw) {
  if (!raw) return null;
  try {
    return new Date(raw).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return String(raw);
  }
}

const ASSET_TYPES = [
  { value: "laptop", label: "Laptop" },
  { value: "monitor", label: "Monitor" },
  { value: "phone", label: "Phone" },
  { value: "headset", label: "Headset" },
  { value: "badge", label: "Badge" },
  { value: "other", label: "Other" },
];

const EMPTY_ASSET_FORM = {
  name: "",
  asset_type: "laptop",
  serial_number: "",
  notes: "",
};

function orientationDefaults(orientation) {
  return {
    date: orientation?.date || "",
    time: orientation?.time || "",
    meeting_link: orientation?.meeting_link || "",
    trainer: orientation?.trainer || "",
    agenda: orientation?.agenda || "",
  };
}

/**
 * Post-hire Complete Profile progress + recruiter reminder controls.
 */
function ProfileCompletionSection({ employee, employeeId, onEmployeeUpdate }) {
  const progress = employee.profile_progress || null;
  const tasks = Array.isArray(progress?.tasks) ? progress.tasks : [];
  const percentage = typeof progress?.percentage === "number" ? progress.percentage : null;
  const incomplete = (employee.profile_status || progress?.profile_status) === "incomplete";
  const completedCount = tasks.filter((t) => t.completed).length;

  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [sending, setSending] = useState(false);

  async function handleRemind() {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setSending(true);
    try {
      const data = await remindEmployeeProfile(
        employeeId,
        note.trim() ? { note: note.trim() } : {},
        accessToken
      );
      if (data.employee) onEmployeeUpdate(data.employee);
      toast.success(data.message || "Reminder sent.");
      setNote("");
      setShowNote(false);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not send reminder."));
    } finally {
      setSending(false);
    }
  }

  const lastReminder = fmtDate(employee.profile_reminder_sent_at);
  const missingLabels = tasks.filter((t) => !t.completed).map((t) => t.label);

  return (
    <div className={styles.section} style={{ marginBottom: 16 }}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionHeadLeft}>
          <div className={`${styles.bar} ${incomplete ? styles.orange : styles.green}`} />
          <div>
            <div className={styles.sectionTitle}>Post-hire profile</div>
            <div className={styles.sectionDesc}>
              {incomplete
                ? `${completedCount} of ${tasks.length || 5} steps done${
                    missingLabels[0] ? ` | next: ${missingLabels[0]}` : ""
                  }`
                : "All post-hire steps completed."}
            </div>
          </div>
        </div>
        {percentage !== null && (
          <span
            className={styles.chip}
            style={{
              background: incomplete ? "var(--orange-light)" : "var(--green-light)",
              color: incomplete ? "var(--orange)" : "var(--green)",
              fontWeight: 700,
            }}
          >
            {percentage}%
          </span>
        )}
      </div>
      <div className={styles.sectionBody}>
        {tasks.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: incomplete ? 14 : 0 }}>
            {tasks.map((task) => (
              <span
                key={task.id || task.step}
                className={styles.chip}
                style={{
                  background: task.completed ? "var(--green-light)" : "#F3F4F6",
                  color: task.completed ? "var(--green)" : "var(--text-muted)",
                  borderColor: task.completed ? "transparent" : "var(--border)",
                }}
              >
                {task.completed ? "âœ“ " : ""}
                {task.label.replace(/^(Add |Complete |Provide |Acknowledge |Sign the )/i, "")}
              </span>
            ))}
          </div>
        )}

        {incomplete && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <button type="button" className={styles.primaryButton} disabled={sending} onClick={handleRemind}>
              {sending ? "Sending..." : "Send reminder"}
            </button>
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => setShowNote((v) => !v)}
            >
              {showNote ? "Hide note" : "Add note"}
            </button>
            {lastReminder && (
              <span className={styles.mutedText} style={{ fontSize: 12 }}>
                Last sent {lastReminder}
              </span>
            )}
            {showNote && (
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note for the employee"
                style={{ flex: "1 1 220px", minWidth: 180 }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Recruiter Day-1 onboarding assignments: company email, assets, orientation.
 */
function DayOneOnboardingSection({ employee, employeeId, onEmployeeUpdate }) {
  const [companyEmail, setCompanyEmail] = useState(employee.company_email || "");
  const [emailMessage, setEmailMessage] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);

  const [assetForm, setAssetForm] = useState(EMPTY_ASSET_FORM);
  const [assetMessage, setAssetMessage] = useState("");
  const [assetSaving, setAssetSaving] = useState(false);
  const [removingAssetId, setRemovingAssetId] = useState(null);

  const [orientationForm, setOrientationForm] = useState(() => orientationDefaults(employee.orientation));
  const [orientationMessage, setOrientationMessage] = useState("");
  const [orientationSaving, setOrientationSaving] = useState(false);

  useEffect(() => {
    setCompanyEmail(employee.company_email || "");
  }, [employee.company_email]);

  useEffect(() => {
    setOrientationForm(orientationDefaults(employee.orientation));
  }, [employee.orientation]);

  const assets = Array.isArray(employee.assets) ? employee.assets : [];
  const orientation = employee.orientation || null;

  async function handleSaveCompanyEmail(event) {
    event.preventDefault();
    setEmailMessage("");
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;

    const trimmed = companyEmail.trim();
    if (!trimmed) {
      const msg = "Enter a valid company email address.";
      setEmailMessage(msg);
      toast.error(msg);
      return;
    }

    setEmailSaving(true);
    try {
      const data = await setEmployeeCompanyEmail(employeeId, { company_email: trimmed }, accessToken);
      if (data.employee) onEmployeeUpdate(data.employee);
      const msg = data.message || "Company email saved.";
      setEmailMessage(msg);
      toast.success(msg);
    } catch (err) {
      const msg = getApiErrorMessage(err, "Could not save company email.");
      setEmailMessage(msg);
      toast.error(msg);
    } finally {
      setEmailSaving(false);
    }
  }

  function updateAssetField(event) {
    const { name, value } = event.target;
    setAssetForm((current) => ({ ...current, [name]: value }));
    setAssetMessage("");
  }

  async function handleAssignAsset(event) {
    event.preventDefault();
    setAssetMessage("");
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;

    const name = assetForm.name.trim();
    if (!name) {
      const msg = "Asset name is required.";
      setAssetMessage(msg);
      toast.error(msg);
      return;
    }

    const payload = {
      name,
      asset_type: assetForm.asset_type,
    };
    const serial = assetForm.serial_number.trim();
    const notes = assetForm.notes.trim();
    if (serial) payload.serial_number = serial;
    if (notes) payload.notes = notes;

    setAssetSaving(true);
    try {
      const data = await assignEmployeeAsset(employeeId, payload, accessToken);
      if (data.employee) onEmployeeUpdate(data.employee);
      setAssetForm(EMPTY_ASSET_FORM);
      const msg = data.message || "Asset assigned.";
      setAssetMessage(msg);
      toast.success(msg);
    } catch (err) {
      const msg = getApiErrorMessage(err, "Could not assign asset.");
      setAssetMessage(msg);
      toast.error(msg);
    } finally {
      setAssetSaving(false);
    }
  }

  async function handleRemoveAsset(assetId) {
    setAssetMessage("");
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;

    setRemovingAssetId(assetId);
    try {
      const data = await removeEmployeeAsset(employeeId, assetId, accessToken);
      if (data.employee) onEmployeeUpdate(data.employee);
      const msg = data.message || "Asset removed.";
      setAssetMessage(msg);
      toast.success(msg);
    } catch (err) {
      const msg = getApiErrorMessage(err, "Could not remove asset.");
      setAssetMessage(msg);
      toast.error(msg);
    } finally {
      setRemovingAssetId(null);
    }
  }

  function updateOrientationField(event) {
    const { name, value } = event.target;
    setOrientationForm((current) => ({ ...current, [name]: value }));
    setOrientationMessage("");
  }

  async function handleScheduleOrientation(event) {
    event.preventDefault();
    setOrientationMessage("");
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;

    const payload = {
      date: orientationForm.date.trim(),
      time: orientationForm.time.trim(),
      trainer: orientationForm.trainer.trim(),
      agenda: orientationForm.agenda.trim(),
    };
    const link = orientationForm.meeting_link.trim();
    if (link) payload.meeting_link = link;

    setOrientationSaving(true);
    try {
      const data = await scheduleEmployeeOrientation(employeeId, payload, accessToken);
      if (data.employee) onEmployeeUpdate(data.employee);
      const msg = data.message || "Orientation scheduled.";
      setOrientationMessage(msg);
      toast.success(msg);
    } catch (err) {
      const msg = getApiErrorMessage(err, "Could not schedule orientation.");
      setOrientationMessage(msg);
      toast.error(msg);
    } finally {
      setOrientationSaving(false);
    }
  }

  return (
    <div style={{ marginBottom: "28px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "10px",
          marginBottom: "18px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div className={`${styles.bar} ${styles.cyan}`} />
          <div>
            <h3 className={styles.sectionTitle} style={{ fontSize: 18, margin: 0 }}>
              Day-1 onboarding assignment
            </h3>
            <p className={styles.sectionDesc} style={{ margin: "2px 0 0" }}>
              Set up company email, hardware, and orientation before start date.
            </p>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* â”€â”€ Company email â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: "12px",
            overflow: "hidden",
            background: "var(--card)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "14px 18px",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg)",
            }}
          >
            <div className={`${styles.bar} ${styles.navy}`} />
            <div>
              <div className={styles.sectionTitle} style={{ fontSize: "14px" }}>Company email</div>
              <div className={styles.sectionDesc}>Official work address for this employee.</div>
            </div>
          </div>
          <div className={styles.sectionBody} style={{ padding: "16px 18px 18px" }}>
            {employee.company_email && (
              <p className={styles.instruction} style={{ margin: "0 0 14px" }}>
                <strong>Current:</strong>{" "}
                <span style={{ color: "var(--navy)" }}>{employee.company_email}</span>
              </p>
            )}
            <form onSubmit={handleSaveCompanyEmail}>
              <div className={styles.formGrid} style={{ marginBottom: "12px" }}>
                <label className={styles.field} style={{ gridColumn: "1 / -1" }}>
                  <span>{employee.company_email ? "Update company email" : "Company email"}</span>
                  <input
                    type="email"
                    value={companyEmail}
                    onChange={(e) => {
                      setCompanyEmail(e.target.value);
                      setEmailMessage("");
                    }}
                    placeholder="name@company.com"
                    required
                  />
                </label>
              </div>
              {emailMessage && (
                <p className={styles.formMessage} role="status" style={{ marginTop: 0 }}>
                  {emailMessage}
                </p>
              )}
              <button type="submit" className={styles.primaryButton} disabled={emailSaving}>
                {emailSaving ? "Saving..." : "Save company email"}
              </button>
            </form>
          </div>
        </div>

        {/* â”€â”€ Company assets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: "12px",
            overflow: "hidden",
            background: "var(--card)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "14px 18px",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg)",
            }}
          >
            <div className={`${styles.bar} ${styles.orange}`} />
            <div style={{ flex: 1 }}>
              <div className={styles.sectionTitle} style={{ fontSize: "14px" }}>Company assets</div>
              <div className={styles.sectionDesc}>
                {assets.length
                  ? `${assets.length} asset${assets.length !== 1 ? "s" : ""} assigned`
                  : "No assets assigned yet"}
              </div>
            </div>
          </div>
          <div className={styles.sectionBody} style={{ padding: "16px 18px 18px" }}>
            {assets.length > 0 ? (
              <ul className={styles.miniList} style={{ marginBottom: "16px" }}>
                {assets.map((asset) => {
                  const typeLabel =
                    ASSET_TYPES.find((t) => t.value === asset.asset_type)?.label ||
                    toLabel(asset.asset_type || "other");
                  const assignedDate = fmtDate(asset.assigned_at);
                  return (
                    <li key={asset.id} className={styles.miniListItem}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                          <strong>{asset.name}</strong>
                          <span className={styles.typePill}>{typeLabel}</span>
                          {asset.status && (
                            <span
                              style={{
                                fontSize: "10px",
                                fontWeight: 600,
                                textTransform: "capitalize",
                                color: "var(--green)",
                                background: "var(--green-light)",
                                padding: "2px 8px",
                                borderRadius: "20px",
                              }}
                            >
                              {asset.status}
                            </span>
                          )}
                        </div>
                        <div className={styles.mutedText}>
                          {asset.serial_number ? `Serial: ${asset.serial_number}` : "No serial on file"}
                          {assignedDate ? ` | Assigned ${assignedDate}` : ""}
                        </div>
                      </div>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        style={{ fontSize: "11.5px", padding: "6px 12px", color: "var(--red)", borderColor: "#f0c4c2" }}
                        disabled={removingAssetId === asset.id}
                        onClick={() => handleRemoveAsset(asset.id)}
                      >
                        {removingAssetId === asset.id ? "Removing..." : "Remove"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className={styles.emptySub} style={{ margin: "0 0 14px" }}>
                Assign laptops, badges, and other equipment for day one.
              </p>
            )}

            <form onSubmit={handleAssignAsset}>
              <p
                style={{
                  fontSize: "10.5px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  color: "var(--text-faint)",
                  margin: "0 0 10px",
                }}
              >
                Add asset
              </p>
              <div className={styles.formGrid} style={{ marginBottom: "12px" }}>
                <label className={styles.field}>
                  <span>Asset name</span>
                  <input name="name" value={assetForm.name} onChange={updateAssetField} placeholder="MacBook Pro 14" required />
                </label>
                <label className={styles.field}>
                  <span>Asset type</span>
                  <select name="asset_type" value={assetForm.asset_type} onChange={updateAssetField}>
                    {ASSET_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span>Serial number (optional)</span>
                  <input name="serial_number" value={assetForm.serial_number} onChange={updateAssetField} placeholder="SN-12345" />
                </label>
                <label className={styles.field}>
                  <span>Notes (optional)</span>
                  <input name="notes" value={assetForm.notes} onChange={updateAssetField} placeholder="Dock included" />
                </label>
              </div>
              {assetMessage && (
                <p className={styles.formMessage} role="status" style={{ marginTop: 0 }}>
                  {assetMessage}
                </p>
              )}
              <button type="submit" className={styles.primaryButton} disabled={assetSaving}>
                {assetSaving ? "Assigning..." : "Assign asset"}
              </button>
            </form>
          </div>
        </div>

        {/* â”€â”€ Orientation session â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: "12px",
            overflow: "hidden",
            background: "var(--card)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "14px 18px",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg)",
            }}
          >
            <div className={`${styles.bar} ${styles.green}`} />
            <div style={{ flex: 1 }}>
              <div className={styles.sectionTitle} style={{ fontSize: "14px" }}>Orientation session</div>
              <div className={styles.sectionDesc}>
                {orientation
                  ? `Scheduled for ${orientation.date} at ${orientation.time}`
                  : "Schedule the employee's first-day orientation"}
              </div>
            </div>
          </div>
          <div className={styles.sectionBody} style={{ padding: "16px 18px 18px" }}>
            {orientation && (
              <div
                style={{
                  border: "1px solid var(--border)",
                  borderLeft: "4px solid var(--green)",
                  borderRadius: "10px",
                  padding: "14px 16px",
                  background: "var(--green-light)",
                  marginBottom: "16px",
                }}
              >
                <p
                  style={{
                    fontSize: "10.5px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    color: "var(--green)",
                    margin: "0 0 8px",
                  }}
                >
                  Scheduled session
                </p>
                <p className={styles.instruction} style={{ margin: 0, lineHeight: 1.6 }}>
                  <strong>Date:</strong> {orientation.date} | <strong>Time:</strong> {orientation.time}
                  <br />
                  <strong>Trainer:</strong> {orientation.trainer}
                  {orientation.meeting_link && (
                    <>
                      <br />
                      <strong>Meeting link:</strong>{" "}
                      <a
                        href={orientation.meeting_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "var(--cyan)", wordBreak: "break-all" }}
                      >
                        {orientation.meeting_link}
                      </a>
                    </>
                  )}
                  <br />
                  <strong>Agenda:</strong> {orientation.agenda}
                </p>
              </div>
            )}

            <form onSubmit={handleScheduleOrientation}>
              <p
                style={{
                  fontSize: "10.5px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  color: "var(--text-faint)",
                  margin: "0 0 10px",
                }}
              >
                {orientation ? "Update session" : "Schedule session"}
              </p>
              <div className={styles.formGrid} style={{ marginBottom: "12px" }}>
                <label className={styles.field}>
                  <span>Date</span>
                  <input name="date" type="date" value={orientationForm.date} onChange={updateOrientationField} required />
                </label>
                <label className={styles.field}>
                  <span>Time</span>
                  <input name="time" type="time" value={orientationForm.time} onChange={updateOrientationField} required />
                </label>
                <label className={styles.field}>
                  <span>Trainer</span>
                  <input name="trainer" value={orientationForm.trainer} onChange={updateOrientationField} placeholder="Jane Smith" required />
                </label>
                <label className={styles.field}>
                  <span>Meeting link (optional)</span>
                  <input
                    name="meeting_link"
                    type="url"
                    value={orientationForm.meeting_link}
                    onChange={updateOrientationField}
                    placeholder="https://teams.microsoft.com/..."
                  />
                </label>
                <label className={styles.field} style={{ gridColumn: "1 / -1" }}>
                  <span>Agenda</span>
                  <textarea
                    name="agenda"
                    rows={3}
                    value={orientationForm.agenda}
                    onChange={updateOrientationField}
                    placeholder="Welcome, HR policies, IT setup, team introductions..."
                    required
                  />
                </label>
              </div>
              {orientationMessage && (
                <p className={styles.formMessage} role="status" style={{ marginTop: 0 }}>
                  {orientationMessage}
                </p>
              )}
              <button type="submit" className={styles.primaryButton} disabled={orientationSaving}>
                {orientationSaving
                  ? "Saving..."
                  : orientation
                  ? "Update orientation"
                  : "Schedule orientation"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function EmployeeProfilePage({ params }) {
  const router = useRouter();

  const unwrappedParams = use(params);
  const id = unwrappedParams.id;

  const [employee, setEmployee] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [activeTab, setActiveTab] = useState("overview");

  useEffect(() => {
    async function loadProfile() {
      setLoading(true); // Ensure loading resets if navigating between profiles
      const accessToken = localStorage.getItem("access_token");
      if (!accessToken) {
        router.push("/login");
        return;
      }
      try {
        const data = await getEmployeeDetail(id, accessToken);
        setEmployee(data.employee);
      } catch (err) {
        setError(getApiErrorMessage(err, "Could not load employee profile."));
      } finally {
        setLoading(false);
      }
    }
    loadProfile();
  }, [id, router]);

  if (loading) {
    return (
      <RecruiterShell activeKey="employees" title="Employee Profile" subtitle="Loading profile details...">
        <div className={styles.section}>
          <div className={styles.sectionBody}>
            <p className={styles.emptySub}>Loading...</p>
          </div>
        </div>
      </RecruiterShell>
    );
  }

  if (error || !employee) {
    return (
      <RecruiterShell activeKey="employees" title="Employee Profile" subtitle="Profile Error">
        <div className={styles.section}>
          <div className={styles.sectionBody}>
            <div className={styles.formMessage} role="alert">{error || "Employee not found."}</div>
            <button type="button" className={styles.secondaryButton} onClick={() => router.back()} style={{ marginTop: "16px" }}>
              &larr; Back to Directory
            </button>
          </div>
        </div>
      </RecruiterShell>
    );
  }

  const employeeId      = employee.employee_id || id;
  const careerEvents    = Array.isArray(employee.career) ? employee.career : [];
  const initials = (employee.full_name || "?")
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";

  const TABS = [
    { key: "overview", label: "Overview" },
    { key: "learning", label: "Learning" },
    { key: "talent", label: "Talent" },
    { key: "documents", label: "Documents" },
    { key: "career", label: "Career" },
    { key: "day1", label: "Day-1" },
  ];

  // â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <RecruiterShell
      activeKey="employees"
      title="Employee Profile"
      subtitle={`Detailed overview for ${employee.full_name}`}
    >
      <div style={{ marginBottom: "20px" }}>
        <button type="button" className={styles.secondaryButton} onClick={() => router.back()}>
          &larr; Back to Directory
        </button>
      </div>

      {/* â”€â”€ Profile hero â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className={styles.section} style={{ marginBottom: 16 }}>
        <div className={styles.profileHero}>
          <div className={styles.profileAvatar}>{initials}</div>
          <div>
            <h2 className={styles.profileName}>{employee.full_name}</h2>
            <p className={styles.mutedText} style={{ margin: 0 }}>
              {employee.job_title || "No designation"} | {employee.department || "No department"}
            </p>
            <div className={styles.chipRow}>
              {employee.employee_id && <span className={styles.chip}>{employee.employee_id}</span>}
              {employee.profile_status && (
                <span
                  className={styles.chip}
                  style={{
                    textTransform: "capitalize",
                    background:
                      employee.profile_status === "incomplete"
                        ? "var(--orange-light)"
                        : "var(--green-light)",
                    color:
                      employee.profile_status === "incomplete" ? "var(--orange)" : "var(--green)",
                  }}
                >
                  {employee.profile_status === "incomplete" ? "Profile incomplete" : "Profile complete"}
                  {employee.profile_progress?.percentage != null
                    ? ` | ${employee.profile_progress.percentage}%`
                    : ""}
                </span>
              )}
              {employee.company_email && <span className={styles.chip}>{employee.company_email}</span>}
              {employee.office_location && <span className={styles.chip}>{employee.office_location}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className={styles.tabRow}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`${styles.tabBtn} ${activeTab === tab.key ? styles.tabBtnActive : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <>
          <ProfileCompletionSection
            employee={employee}
            employeeId={employeeId}
            onEmployeeUpdate={setEmployee}
          />
          <div className={styles.section}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionHeadLeft}>
              <div className={`${styles.bar} ${styles.navy}`} />
              <div>
                <div className={styles.sectionTitle}>Employee overview</div>
                <div className={styles.sectionDesc}>Key employment and contact details.</div>
              </div>
            </div>
          </div>
          <div className={styles.sectionBody}>
            <dl className={styles.employeeFactGrid}>
              <div className={styles.employeeFact}>
                <dt>Full name</dt>
                <dd>{employee.full_name || "-"}</dd>
              </div>
              <div className={styles.employeeFact}>
                <dt>Employee ID</dt>
                <dd>{employee.employee_id || "-"}</dd>
              </div>
              <div className={styles.employeeFact}>
                <dt>Email</dt>
                <dd>{employee.email || "-"}</dd>
              </div>
              <div className={styles.employeeFact}>
                <dt>Company email</dt>
                <dd>{employee.company_email || "-"}</dd>
              </div>
              <div className={styles.employeeFact}>
                <dt>Phone</dt>
                <dd>{employee.phone || "-"}</dd>
              </div>
              <div className={styles.employeeFact}>
                <dt>Job title</dt>
                <dd>{employee.job_title || "-"}</dd>
              </div>
              <div className={styles.employeeFact}>
                <dt>Department</dt>
                <dd>{employee.department || "-"}</dd>
              </div>
              <div className={styles.employeeFact}>
                <dt>Reporting manager</dt>
                <dd>{employee.reporting_manager || "-"}</dd>
              </div>
              <div className={styles.employeeFact}>
                <dt>Office location</dt>
                <dd>{employee.office_location || "-"}</dd>
              </div>
              <div className={styles.employeeFact}>
                <dt>Start date</dt>
                <dd>{fmtDate(employee.start_date) || "-"}</dd>
              </div>
              <div className={styles.employeeFact}>
                <dt>Profile status</dt>
                <dd style={{ textTransform: "capitalize" }}>
                  {employee.profile_status || "-"}
                  {employee.profile_progress?.percentage != null
                    ? ` (${employee.profile_progress.percentage}%)`
                    : ""}
                </dd>
              </div>
            </dl>
          </div>
        </div>
        </>
      )}

      {activeTab === "day1" && (
        <DayOneOnboardingSection
          employee={employee}
          employeeId={employeeId}
          onEmployeeUpdate={setEmployee}
        />
      )}

      {activeTab === "learning" && (
        <EmployeeLearningPanel employee={employee} onEmployeeUpdate={setEmployee} />
      )}

      {activeTab === "talent" && (
        <EmployeeTalentPanel employee={employee} />
      )}

      {activeTab === "career" && (
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionHeadLeft}>
              <div className={`${styles.bar} ${styles.cyan}`} />
              <div>
                <div className={styles.sectionTitle}>Career timeline</div>
                <div className={styles.sectionDesc}>Promotions, title changes, and role history.</div>
              </div>
            </div>
          </div>
          <div className={styles.sectionBody}>
            {careerEvents.length === 0 ? (
              <p className={styles.emptySub}>No career events recorded yet.</p>
            ) : (
              <ul className={styles.miniList}>
                {careerEvents.map((event) => (
                  <li key={event.id} className={styles.miniListItem}>
                    <div>
                      <strong style={{ textTransform: "capitalize" }}>
                        {toLabel(event.event_type || "event")}
                      </strong>
                      <div className={styles.sectionDesc}>
                        {fmtDate(event.effective_date) || "No date"}
                        {event.to_title ? ` | ${event.to_title}` : ""}
                        {event.to_department ? ` | ${event.to_department}` : ""}
                        {event.to_manager ? ` | Manager: ${event.to_manager}` : ""}
                        {event.note ? ` - ${event.note}` : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {activeTab === "documents" && (
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionHeadLeft}>
              <div className={`${styles.bar} ${styles.purple}`} />
              <div>
                <div className={styles.sectionTitle}>Documents</div>
                <div className={styles.sectionDesc}>Verify identity, education, and resume files.</div>
              </div>
            </div>
          </div>
          <div className={styles.sectionBody}>
            {employee.id ? (
              <RecruiterDocumentReview ownerId={employee.id} />
            ) : (
              <p className={styles.emptySub}>No document owner ID on this employee record.</p>
            )}
          </div>
        </div>
      )}
    </RecruiterShell>
  );
}

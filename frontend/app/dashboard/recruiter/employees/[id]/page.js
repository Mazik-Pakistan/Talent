"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import RecruiterShell from "@/components/recruiter/RecruiterShell";
import ProtectedRecruiterRoute from "@/components/ProtectedRecruiterRoute";
import styles from "@/components/recruiter/recruiter-shell.module.css";
import {
  getEmployeeDetail,
  getApiErrorMessage,
  markEmployeeExit,
  addCareerEvent,
  scheduleEmployeeOrientation,
  updateEmployeeBanking,
} from "@/services/authService";
import { RECRUITER_DEPARTMENTS, RECRUITER_DESIGNATIONS } from "@/components/recruiter/recruiterOptions";
import { useOrgFrameworkOptions } from "@/hooks/useOrgFrameworkOptions";
import EmployeeLearningPanel from "@/components/recruiter/EmployeeLearningPanel";
import EmployeeTalentPanel from "@/components/recruiter/EmployeeTalentPanel";
import RecruiterDocumentReview from "@/components/RecruiterDocumentReview";
import OfferSummaryCard from "@/components/offers/OfferSummaryCard";
import SendReminderModal from "@/components/recruiter/SendReminderModal";
import {
  clearRecruiterContext,
  publishRecruiterContext,
} from "@/lib/ai/recruiterContext";
import { EMPLOYEE_TAB_HELP } from "@/lib/ai/recruiterFieldHelp";
import { formatBloodGroupDisplay, isBloodGroupPending } from "@/lib/bloodGroup";

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
  { value: "license", label: "Software license" },
  { value: "other", label: "Other" },
];

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
  const router = useRouter();
  const progress = employee.profile_progress || null;
  const tasks = Array.isArray(progress?.tasks) ? progress.tasks : [];
  const percentage = typeof progress?.percentage === "number" ? progress.percentage : null;
  const incomplete = (employee.profile_status || progress?.profile_status) === "incomplete";
  const completedCount = tasks.filter((t) => t.completed).length;
  const [reminderOpen, setReminderOpen] = useState(false);

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
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
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
                {task.completed ? "✓ " : ""}
                {task.label.replace(/^(Add |Complete |Provide |Acknowledge |Sign the )/i, "")}
              </span>
            ))}
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <button type="button" className={styles.primaryButton} onClick={() => setReminderOpen(true)}>
            Send reminder
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() =>
              router.push(`/dashboard/recruiter/messages?employee_id=${encodeURIComponent(employeeId)}`)
            }
          >
            Messages
          </button>
          {lastReminder && (
            <span className={styles.mutedText} style={{ fontSize: 12 }}>
              Last profile reminder {lastReminder}
            </span>
          )}
        </div>
      </div>
      <SendReminderModal
        open={reminderOpen}
        target={{ id: employeeId, full_name: employee.full_name, role: "employee" }}
        accessToken={typeof window !== "undefined" ? localStorage.getItem("access_token") : null}
        defaultKind={incomplete ? "profile" : "general"}
        onClose={() => setReminderOpen(false)}
        onSent={(data) => {
          toast.success(data?.message || "Reminder sent.");
          if (data?.employee) onEmployeeUpdate(data.employee);
        }}
      />
    </div>
  );
}

/**
 * IT-provisioned company email (read-only) — shown on Overview.
 */
function CompanyEmailSection({ employee }) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionHeadLeft}>
          <div className={`${styles.bar} ${styles.navy}`} />
          <div>
            <div className={styles.sectionTitle}>Company email</div>
            <div className={styles.sectionDesc}>Assigned by IT · not editable by recruiter</div>
          </div>
        </div>
      </div>
      <div className={styles.sectionBody}>
        {employee.company_email ? (
          <p className={styles.instruction} style={{ margin: 0 }}>
            <strong>{employee.company_email}</strong>
            {employee.has_company_email_password ? (
              <span className={styles.mutedText}> · mailbox password on file (employee can reveal via OTP)</span>
            ) : null}
          </p>
        ) : (
          <p className={styles.emptySub} style={{ margin: 0 }}>
            No company email on file. IT should complete provisioning before activation.
          </p>
        )}
      </div>
    </div>
  );
}

const emptyBankingForm = {
  bank_name: "",
  account_holder_name: "",
  account_number: "",
  iban: "",
  branch: "",
  branch_code: "",
  swift_code: "",
};

/**
 * Recruiter-managed payroll banking for on-site employees.
 * Remote employees enter banking themselves — this section is informational only.
 */
function BankingManagementSection({ employee, employeeId, onEmployeeUpdate }) {
  const existing = employee?.onboarding?.employment || {};
  const isRemote = Boolean(employee?.is_remote);
  const hasBanking = Boolean(existing.bank_name || employee?.has_banking);
  const [editing, setEditing] = useState(!hasBanking && !isRemote);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [form, setForm] = useState({
    ...emptyBankingForm,
    bank_name: existing.bank_name || "",
    account_holder_name: existing.account_holder_name || employee?.full_name || "",
    account_number: existing.account_number || "",
    iban: existing.iban || "",
    branch: existing.branch || "",
    branch_code: existing.branch_code || "",
    swift_code: existing.swift_code || "",
  });

  useEffect(() => {
    const next = employee?.onboarding?.employment || {};
    setForm({
      ...emptyBankingForm,
      bank_name: next.bank_name || "",
      account_holder_name: next.account_holder_name || employee?.full_name || "",
      account_number: next.account_number || "",
      iban: next.iban || "",
      branch: next.branch || "",
      branch_code: next.branch_code || "",
      swift_code: next.swift_code || "",
    });
    setEditing(!(next.bank_name || employee?.has_banking) && !Boolean(employee?.is_remote));
    setSaveError("");
  }, [employee]);

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    setSaveError("");
  }

  async function handleSave(event) {
    event.preventDefault();
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    const required = ["bank_name", "account_holder_name", "account_number", "iban", "branch", "branch_code"];
    if (required.some((key) => !String(form[key] || "").trim())) {
      const msg = "Complete bank name, account title, account number, IBAN, branch, and branch code.";
      setSaveError(msg);
      toast.error(msg);
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const data = await updateEmployeeBanking(
        employeeId,
        {
          bank_name: form.bank_name.trim(),
          account_holder_name: form.account_holder_name.trim(),
          account_number: form.account_number.trim(),
          iban: form.iban.replace(/\s/g, "").toUpperCase(),
          branch: form.branch.trim(),
          branch_code: form.branch_code.trim(),
          swift_code: form.swift_code?.trim() || null,
        },
        accessToken
      );
      if (data?.employee) onEmployeeUpdate(data.employee);
      toast.success(data?.message || "Banking details saved. Employee has been notified.");
      setEditing(false);
      setSaveError("");
    } catch (err) {
      const msg = getApiErrorMessage(err, "Could not save banking details.");
      setSaveError(msg);
      toast.error(msg, { autoClose: 8000 });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.section} id="sec-banking">
      <div className={styles.sectionHead}>
        <div className={styles.sectionHeadLeft}>
          <div className={`${styles.bar} ${hasBanking ? styles.green : styles.orange}`} />
          <div>
            <div className={styles.sectionTitle}>Banking information</div>
            <div className={styles.sectionDesc}>
              {isRemote
                ? "Remote employee — banking is completed in their profile checklist"
                : hasBanking
                  ? "On-site payroll account on file"
                  : "On-site employee — add payroll banking details"}
            </div>
          </div>
        </div>
        <span
          className={styles.chip}
          style={{
            background: hasBanking ? "var(--green-light)" : "var(--orange-light)",
            color: hasBanking ? "var(--green)" : "var(--orange)",
            fontWeight: 700,
          }}
        >
          {hasBanking ? "On file" : "Needed"}
        </span>
      </div>
      <div className={styles.sectionBody}>
        {isRemote ? (
          <p className={styles.emptySub} style={{ margin: 0 }}>
            {hasBanking
              ? "Banking details were submitted by the employee. Values are masked here for privacy."
              : "Waiting for the employee to complete banking in Complete Profile."}
          </p>
        ) : editing ? (
          <form onSubmit={handleSave} className={styles.formGrid} style={{ gap: 12 }}>
            {[
              ["bank_name", "Bank name"],
              ["account_holder_name", "Account title"],
              ["account_number", "Account number"],
              ["iban", "IBAN"],
              ["branch", "Branch"],
              ["branch_code", "Branch code"],
              ["swift_code", "SWIFT (optional)"],
            ].map(([key, label]) => (
              <label key={key} className={styles.field}>
                <span>{label}</span>
                <input
                  value={form[key] || ""}
                  onChange={(e) => updateField(key, e.target.value)}
                  required={key !== "swift_code"}
                  placeholder={key === "iban" ? "PK00XXXX0000000000000000" : undefined}
                />
              </label>
            ))}
            {saveError ? (
              <p
                role="alert"
                style={{
                  gridColumn: "1 / -1",
                  margin: 0,
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: "rgba(185, 28, 28, 0.08)",
                  color: "#b91c1c",
                  fontSize: 13,
                  fontWeight: 600,
                  lineHeight: 1.45,
                }}
              >
                {saveError}
              </p>
            ) : null}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", gridColumn: "1 / -1" }}>
              {hasBanking ? (
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => {
                    setEditing(false);
                    setSaveError("");
                  }}
                  disabled={saving}
                >
                  Cancel
                </button>
              ) : null}
              <button type="submit" className={styles.primaryButton} disabled={saving}>
                {saving ? "Saving…" : hasBanking ? "Update banking" : "Save banking"}
              </button>
            </div>
          </form>
        ) : (
          <>
            <dl className={styles.employeeFactGrid}>
              <div className={styles.employeeFact}>
                <dt>Bank</dt>
                <dd>{existing.bank_name || "-"}</dd>
              </div>
              <div className={styles.employeeFact}>
                <dt>Account title</dt>
                <dd>{existing.account_holder_name || "-"}</dd>
              </div>
              <div className={styles.employeeFact}>
                <dt>Account number</dt>
                <dd>{existing.account_number || "-"}</dd>
              </div>
              <div className={styles.employeeFact}>
                <dt>IBAN</dt>
                <dd>{existing.iban || "-"}</dd>
              </div>
              <div className={styles.employeeFact}>
                <dt>Branch</dt>
                <dd>{existing.branch || "-"}</dd>
              </div>
              <div className={styles.employeeFact}>
                <dt>Branch code</dt>
                <dd>{existing.branch_code || "-"}</dd>
              </div>
              <div className={styles.employeeFact}>
                <dt>SWIFT</dt>
                <dd>{existing.swift_code || "-"}</dd>
              </div>
            </dl>
            <button
              type="button"
              className={styles.secondaryButton}
              style={{ marginTop: 12 }}
              onClick={() => setEditing(true)}
            >
              Edit banking
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * IT-provisioned hardware / licenses (read-only) — shown on Overview.
 */
function CompanyAssetsSection({ employee }) {
  const assets = Array.isArray(employee.assets) ? employee.assets : [];
  const licenses = Array.isArray(employee.licenses) ? employee.licenses : [];

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionHeadLeft}>
          <div className={`${styles.bar} ${styles.orange}`} />
          <div>
            <div className={styles.sectionTitle}>Company assets</div>
            <div className={styles.sectionDesc}>
              {assets.length
                ? `${assets.length} asset${assets.length !== 1 ? "s" : ""} from IT`
                : "Hardware and licenses assigned by IT"}
            </div>
          </div>
        </div>
      </div>
      <div className={styles.sectionBody}>
        {assets.length > 0 ? (
          <ul className={styles.miniList} style={{ marginBottom: licenses.length ? "16px" : 0 }}>
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
                      {asset.notes ? ` | ${asset.notes}` : ""}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={styles.emptySub} style={{ margin: licenses.length ? "0 0 14px" : 0 }}>
            No assets assigned by IT yet.
          </p>
        )}

        {licenses.length > 0 && (
          <>
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
              Licenses
            </p>
            <ul className={styles.miniList}>
              {licenses.map((license) => (
                <li key={license.id} className={styles.miniListItem}>
                  <div>
                    <strong>{license.name}</strong>
                    <div className={styles.mutedText}>
                      {[license.vendor, license.notes].filter(Boolean).join(" · ") || "Software license"}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {employee.it_notes && (
          <p className={styles.instruction} style={{ marginTop: 14, marginBottom: 0 }}>
            <strong>IT notes:</strong> {employee.it_notes}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Day-1: recruiter schedules orientation (IT email/assets live on Overview).
 */
function DayOneOnboardingSection({ employee, employeeId, onEmployeeUpdate }) {
  const [orientationForm, setOrientationForm] = useState(() => orientationDefaults(employee.orientation));
  const [orientationMessage, setOrientationMessage] = useState("");
  const [orientationSaving, setOrientationSaving] = useState(false);

  const orientation = employee.orientation || null;

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
              Schedule orientation here. Company email and assets are on Overview (from IT).
            </p>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
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

/**
 * Career tab: unified timeline (hire / promo / resign / prior tenures),
 * add-event form, and resign/exit controls.
 */
function CareerTimelineSection({ employee, employeeId, careerEvents, onEmployeeUpdate }) {
  const { departments: frameworkDepartments, roleNames: frameworkDesignations } = useOrgFrameworkOptions();
  const departmentOptions = frameworkDepartments.length ? frameworkDepartments : RECRUITER_DEPARTMENTS;
  const designationOptions = frameworkDesignations.length ? frameworkDesignations : RECRUITER_DESIGNATIONS;
  const [careerForm, setCareerForm] = useState({
    event_type: "promoted",
    effective_date: new Date().toISOString().slice(0, 10),
    to_title: employee.job_title || "",
    to_department: employee.department || "",
    to_manager: employee.reporting_manager || "",
    note: "",
  });
  const [busy, setBusy] = useState(false);
  const isHistorical =
    employee.history_bucket === "historical" ||
    ["resigned", "terminated", "exited"].includes(String(employee.status || "").toLowerCase());

  async function refreshEmployee() {
    const accessToken = localStorage.getItem("access_token");
    const data = await getEmployeeDetail(employeeId, accessToken);
    onEmployeeUpdate(data.employee);
  }

  async function handleSaveCareerEvent() {
    if (!careerForm.effective_date) {
      toast.error("Effective date is required.");
      return;
    }
    setBusy(true);
    try {
      await addCareerEvent(
        employeeId,
        {
          event_type: careerForm.event_type,
          effective_date: careerForm.effective_date,
          to_title: careerForm.to_title || null,
          to_department: careerForm.to_department || null,
          to_manager: careerForm.to_manager || null,
          note: careerForm.note || null,
        },
        localStorage.getItem("access_token")
      );
      await refreshEmployee();
      toast.success("Career event saved.");
      setCareerForm((prev) => ({ ...prev, note: "" }));
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not save career event."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ExitEmployeeSection
        employee={employee}
        employeeId={employeeId}
        onEmployeeUpdate={onEmployeeUpdate}
      />

      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <div className={`${styles.bar} ${styles.cyan}`} />
            <div>
              <div className={styles.sectionTitle}>Career timeline</div>
              <div className={styles.sectionDesc}>
                Hires, promotions, resignations, and prior tenures for this person — not listed again under Historical once rehired.
              </div>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          {careerEvents.length === 0 ? (
            <p className={styles.emptySub}>No career events recorded yet.</p>
          ) : (
            <ul className={styles.miniList}>
              {careerEvents.map((event) => {
                const isExit = ["resigned", "terminated", "exited"].includes(
                  String(event.event_type || event.to_status || "").toLowerCase()
                );
                return (
                  <li key={event.id} className={styles.miniListItem}>
                    <div>
                      <strong style={{ textTransform: "capitalize" }}>
                        {toLabel(event.event_type || event.to_status || "event")}
                      </strong>
                      {event.employee_id ? (
                        <span className={styles.chip} style={{ marginLeft: 8 }}>
                          {event.employee_id}
                        </span>
                      ) : null}
                      {isExit ? (
                        <span
                          className={styles.chip}
                          style={{
                            marginLeft: 8,
                            background: "var(--orange-light)",
                            color: "var(--orange)",
                          }}
                        >
                          Exit
                        </span>
                      ) : null}
                      <div className={styles.sectionDesc}>
                        {fmtDate(event.effective_date) || "No date"}
                        {event.to_title ? ` · ${event.to_title}` : ""}
                        {event.to_department ? ` · ${event.to_department}` : ""}
                        {event.to_manager ? ` · Manager: ${event.to_manager}` : ""}
                        {event.note ? ` — ${event.note}` : ""}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {!isHistorical ? (
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionHeadLeft}>
              <div className={`${styles.bar} ${styles.purple}`} />
              <div>
                <div className={styles.sectionTitle}>Add career event</div>
                <div className={styles.sectionDesc}>Log a promotion, title, department, or manager change.</div>
              </div>
            </div>
          </div>
          <div className={styles.sectionBody}>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span>Event type</span>
                <select
                  value={careerForm.event_type}
                  onChange={(e) => setCareerForm({ ...careerForm, event_type: e.target.value })}
                >
                  <option value="promoted">Promoted</option>
                  <option value="title_change">Title change</option>
                  <option value="department_change">Department change</option>
                  <option value="manager_change">Manager change</option>
                  <option value="status_change">Status change</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>Effective date</span>
                <input
                  type="date"
                  value={careerForm.effective_date}
                  onChange={(e) => setCareerForm({ ...careerForm, effective_date: e.target.value })}
                />
              </label>
              <label className={styles.field}>
                <span>New title</span>
                <select
                  value={careerForm.to_title}
                  onChange={(e) => setCareerForm({ ...careerForm, to_title: e.target.value })}
                >
                  <option value="">Select designation</option>
                  {designationOptions.map((designation) => (
                    <option key={designation} value={designation}>
                      {designation}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>New department</span>
                <select
                  value={careerForm.to_department}
                  onChange={(e) => setCareerForm({ ...careerForm, to_department: e.target.value })}
                >
                  <option value="">Select department</option>
                  {departmentOptions.map((department) => (
                    <option key={department} value={department}>
                      {department}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>New manager</span>
                <input
                  value={careerForm.to_manager}
                  onChange={(e) => setCareerForm({ ...careerForm, to_manager: e.target.value })}
                />
              </label>
              <label className={styles.field}>
                <span>Note</span>
                <input
                  value={careerForm.note}
                  onChange={(e) => setCareerForm({ ...careerForm, note: e.target.value })}
                />
              </label>
            </div>
            <div className={styles.actions} style={{ marginTop: 12 }}>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={busy}
                onClick={handleSaveCareerEvent}
              >
                {busy ? "Saving…" : "Save event"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * Mark active employee as resigned / terminated / exited.
 */
function ExitEmployeeSection({ employee, employeeId, onEmployeeUpdate }) {
  const isHistorical =
    employee.history_bucket === "historical" ||
    ["resigned", "terminated", "exited"].includes(String(employee.status || "").toLowerCase());
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    exit_type: "resigned",
    exit_date: new Date().toISOString().slice(0, 10),
    exit_reason: "",
    note: "",
  });

  if (isHistorical) {
    return (
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <div className={`${styles.bar} ${styles.orange || styles.navy}`} />
            <div>
              <div className={styles.sectionTitle}>Historical employment</div>
              <div className={styles.sectionDesc}>
                This tenure ended as <strong style={{ textTransform: "capitalize" }}>{employee.exit_type || employee.status}</strong>
                {employee.exit_date ? ` on ${fmtDate(employee.exit_date)}` : ""}.
                {employee.previous_employee_id ? ` Prior employee ID: ${employee.previous_employee_id}.` : ""}
              </div>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          {employee.exit_reason ? <p className={styles.mutedText}>{employee.exit_reason}</p> : null}
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => {
              const email = encodeURIComponent(employee.email || "");
              window.location.href = `/dashboard/recruiter/invite?email=${email}&full_name=${encodeURIComponent(employee.full_name || "")}`;
            }}
          >
            Invite again as candidate
          </button>
        </div>
      </div>
    );
  }

  async function submitExit() {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setBusy(true);
    try {
      const data = await markEmployeeExit(
        employee.employee_id || employeeId,
        {
          exit_type: form.exit_type,
          exit_date: form.exit_date || null,
          exit_reason: form.exit_reason || null,
          note: form.note || null,
          lock_profile: true,
        },
        accessToken
      );
      try {
        const refreshed = await getEmployeeDetail(employee.employee_id || employeeId, accessToken);
        onEmployeeUpdate?.(refreshed.employee);
      } catch {
        onEmployeeUpdate?.(data.employee);
      }
      toast.success(data.message || `Marked as ${form.exit_type}.`);
      setOpen(false);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not update employment status."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionHeadLeft}>
          <div className={`${styles.bar} ${styles.navy}`} />
          <div>
            <div className={styles.sectionTitle}>Employment status</div>
            <div className={styles.sectionDesc}>
              Mark this person as resigned, terminated, or exited. The exit is recorded on the career timeline. If they return later, prior tenures stay on this timeline — not as a separate Historical directory entry while they are active again.
            </div>
          </div>
        </div>
        {!open ? (
          <button type="button" className={styles.secondaryButton} onClick={() => setOpen(true)}>
            Mark as former employee
          </button>
        ) : null}
      </div>
      {open ? (
        <div className={styles.sectionBody}>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>Outcome</span>
              <select value={form.exit_type} onChange={(e) => setForm({ ...form, exit_type: e.target.value })}>
                <option value="resigned">Resigned</option>
                <option value="terminated">Terminated</option>
                <option value="exited">Exited</option>
              </select>
            </label>
            <label className={styles.field}>
              <span>Effective date</span>
              <input type="date" value={form.exit_date} onChange={(e) => setForm({ ...form, exit_date: e.target.value })} />
            </label>
            <label className={styles.field} style={{ gridColumn: "1 / -1" }}>
              <span>Reason</span>
              <input value={form.exit_reason} onChange={(e) => setForm({ ...form, exit_reason: e.target.value })} placeholder="Optional reason" />
            </label>
            <label className={styles.field} style={{ gridColumn: "1 / -1" }}>
              <span>Internal note</span>
              <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={3} placeholder="Optional note for career timeline" />
            </label>
          </div>
          <div className={styles.actions} style={{ marginTop: 12 }}>
            <button type="button" className={styles.primaryButton} disabled={busy} onClick={submitExit}>
              {busy ? "Saving…" : `Confirm ${form.exit_type}`}
            </button>
            <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function EmployeeProfilePage({ params }) {
  return (
    <ProtectedRecruiterRoute requiredCapability="employees">
      <EmployeeProfilePageContent params={params} />
    </ProtectedRecruiterRoute>
  );
}

function EmployeeProfilePageContent({ params }) {
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

  useEffect(() => {
    if (!employee) {
      clearRecruiterContext();
      return undefined;
    }
    const help = EMPLOYEE_TAB_HELP[activeTab] || {};
    publishRecruiterContext({
      tab: activeTab,
      section: activeTab,
      hint: help.hint || null,
      fields: help.fields || [],
      employeeName: employee.full_name || null,
    });
    return () => clearRecruiterContext();
  }, [activeTab, employee]);

  if (loading) {
    return (
      <RecruiterShell activeKey="employees" capability="employees" title="Employee Profile" subtitle="Loading profile details...">
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
      <RecruiterShell activeKey="employees" capability="employees" title="Employee Profile" subtitle="Profile Error">
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
  const careerEvents = Array.isArray(employee.career_timeline) && employee.career_timeline.length
    ? employee.career_timeline
    : Array.isArray(employee.career)
      ? employee.career
      : [];
  const currentOffer = employee.current_offer || null;
  const personal = employee.onboarding?.personal || null;
  const bloodGroupPending = Boolean(personal) && isBloodGroupPending(personal.blood_group);
  const bloodGroupLabel = personal
    ? formatBloodGroupDisplay(personal.blood_group)
    : null;
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

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <RecruiterShell
      activeKey="employees"
      capability="employees"
      title="Employee Profile"
      subtitle={`Detailed overview for ${employee.full_name}`}
    >
      <div style={{ marginBottom: "20px" }}>
        <button type="button" className={styles.secondaryButton} onClick={() => router.back()}>
          &larr; Back to Directory
        </button>
      </div>

      {/* ── Profile hero ─────────────────────────────────────────────── */}
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
                <dt>Contact</dt>
                <dd>{employee.phone || "-"}</dd>
              </div>
              <div className={styles.employeeFact}>
                <dt>Blood group</dt>
                <dd>
                  {bloodGroupLabel || "-"}
                  {bloodGroupPending ? (
                    <span
                      className={styles.chip}
                      style={{
                        marginLeft: 8,
                        background: "var(--orange-light)",
                        color: "var(--orange)",
                      }}
                    >
                      Needs update
                    </span>
                  ) : null}
                </dd>
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
                <dt>Work arrangement</dt>
                <dd>{employee.is_remote ? "Remote" : "On-site / office-based"}</dd>
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
              <div className={styles.employeeFact}>
                <dt>Employment status</dt>
                <dd style={{ textTransform: "capitalize" }}>{employee.exit_type || employee.status || "-"}</dd>
              </div>
              {employee.exit_date ? (
                <div className={styles.employeeFact}>
                  <dt>Exit date</dt>
                  <dd>{fmtDate(employee.exit_date)}</dd>
                </div>
              ) : null}
              {employee.previous_employee_id ? (
                <div className={styles.employeeFact}>
                  <dt>Previous employee ID</dt>
                  <dd>{employee.previous_employee_id}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        </div>
          <CompanyEmailSection employee={employee} />
          <BankingManagementSection
            employee={employee}
            employeeId={employeeId}
            onEmployeeUpdate={setEmployee}
          />
          <CompanyAssetsSection employee={employee} />
        </>
      )}

      {activeTab === "day1" && (
        <DayOneOnboardingSection
          key={`day1-${employeeId}-${employee.orientation?.date || ""}-${employee.orientation?.time || ""}-${employee.orientation?.trainer || ""}`}
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
        <CareerTimelineSection
          employee={employee}
          employeeId={employeeId}
          careerEvents={careerEvents}
          onEmployeeUpdate={setEmployee}
        />
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
            {currentOffer ? (
              <div style={{ marginBottom: 16 }}>
                <OfferSummaryCard
                  offer={currentOffer}
                  candidateName={employee.full_name}
                  title="Offer letter PDF"
                  description="Recruiters can review the final offer letter here alongside the employee's submitted documents."
                />
              </div>
            ) : null}
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

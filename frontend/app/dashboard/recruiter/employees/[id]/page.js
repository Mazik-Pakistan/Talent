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
} from "@/services/authService";
import EmployeeLearningPanel from "@/components/recruiter/EmployeeLearningPanel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Converts a snake_case / camelCase / kebab-case key into a readable label.
 * Examples:  "government_docs" → "Government Docs"
 *            "resume"          → "Resume"
 *            "education"       → "Education"
 */
function toLabel(key) {
  return String(key)
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

/**
 * "Container" keys: their values are lists of sub-documents or sub-objects,
 * but the key itself should NOT become a new category/type label.
 * When we encounter these, we recurse while keeping the parent category/type.
 */
const CONTAINER_KEYS = new Set(["documents", "entries", "files", "items"]);

/**
 * Keys that are metadata, not sub-documents. Skip them when recursing.
 */
const SKIP_KEYS = new Set([
  "_id", "status", "step", "completed_steps", "submitted_at",
  "ocr_result", "profile_verification", "summary",
]);

/**
 * Recursively walks `obj` and extracts every file object — defined as any
 * plain object that carries a `file_url` field.
 *
 * Category is set once per top-level onboarding section (the caller's
 * responsibility). Type is inferred from the nearest named parent key so that
 * versions of the same logical document always share the same group even when
 * the uploaded file has a different name each time.
 *
 * @param {unknown}  obj         - Value to inspect.
 * @param {string}   category    - Top-level onboarding section (e.g. "Government Docs").
 * @param {string}   type        - Current type label (e.g. "Cnic", "Resume").
 * @param {object[]} acc         - Accumulator array.
 */
function extractDocuments(obj, category, type, acc) {
  if (!obj || typeof obj !== "object") return;

  // Arrays: recurse into each item without changing category/type.
  if (Array.isArray(obj)) {
    obj.forEach((item) => extractDocuments(item, category, type, acc));
    return;
  }

  // Plain object: check if it is itself a file record.
  if (obj.file_url) {
    // If the object carries an explicit doc_type field, use that as the type
    // (e.g. GovernmentDocument.doc_type === "cnic"). Otherwise keep ancestry.
    const resolvedType = obj.doc_type ? toLabel(obj.doc_type) : (type || "Document");
    acc.push({
      file_url:     obj.file_url      || null,
      file_name:    obj.file_name     || null,
      document_type: resolvedType,
      category,
      status:       obj.status        || null,
      uploaded_at:  obj.uploaded_at   || null,
      submitted_at: obj.submitted_at  || null,
      created_at:   obj.created_at    || null,
    });
    // Continue recursing — in edge cases a file record may embed sub-documents.
  }

  // Recurse into every object-valued property.
  for (const [key, value] of Object.entries(obj)) {
    if (!value || typeof value !== "object") continue;
    if (SKIP_KEYS.has(key)) continue;

    if (CONTAINER_KEYS.has(key)) {
      // Container key: keep category & type as-is.
      extractDocuments(value, category, type, acc);
    } else {
      // Named key: becomes the new type label for everything nested under it.
      extractDocuments(value, category, toLabel(key), acc);
    }
  }
}

/**
 * Returns the best available date string from a document record.
 * Priority: uploaded_at → submitted_at → created_at
 */
function docDate(doc) {
  return doc.uploaded_at || doc.submitted_at || doc.created_at || null;
}

/**
 * Human-friendly date string, or null when unavailable.
 */
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

// ---------------------------------------------------------------------------
// Sub-components (kept in this file to avoid new-file churn)
// ---------------------------------------------------------------------------

/**
 * A single document type group: renders the current version prominently and
 * lets the recruiter expand older versions inline.
 */
function DocumentGroup({ groupName, docs }) {
  const [expanded, setExpanded] = useState(false);

  const current = docs[0];
  const older   = docs.slice(1);
  const dateStr = fmtDate(docDate(current));

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "10px",
        overflow: "hidden",
        background: "var(--card)",
      }}
    >
      {/* ── Current version ─────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "12px",
          padding: "14px 16px",
          flexWrap: "wrap",
          borderLeft: "4px solid var(--green)",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              flexWrap: "wrap",
              marginBottom: "4px",
            }}
          >
            <strong style={{ fontSize: "13.5px", color: "var(--navy)" }}>
              {current.file_name || groupName}
            </strong>
            {/* "Current" badge */}
            <span
              style={{
                fontSize: "10px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                background: "var(--green-light)",
                color: "var(--green)",
                padding: "2px 8px",
                borderRadius: "20px",
                flexShrink: 0,
              }}
            >
              Current
            </span>
            {/* Status badge */}
            {current.status && (
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 600,
                  textTransform: "capitalize",
                  background: "var(--cyan-light)",
                  color: "var(--cyan)",
                  padding: "2px 7px",
                  borderRadius: "20px",
                  flexShrink: 0,
                }}
              >
                {current.status}
              </span>
            )}
          </div>
          <div className={styles.mutedText}>
            {dateStr ? `Uploaded ${dateStr}` : "Active document"}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          {/* View File link */}
          {current.file_url && (
            <a
              href={current.file_url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.secondaryButton}
              style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "5px" }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              View File
            </a>
          )}
          {/* Toggle older versions */}
          {older.length > 0 && (
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => setExpanded((v) => !v)}
              style={{ fontSize: "11.5px", whiteSpace: "nowrap" }}
              aria-expanded={expanded}
            >
              {expanded
                ? "Hide versions"
                : `${older.length} previous version${older.length !== 1 ? "s" : ""}`}
            </button>
          )}
        </div>
      </div>

      {/* ── Previous versions (collapsible) ─────────────────────────── */}
      {expanded && older.length > 0 && (
        <div
          style={{
            borderTop: "1px dashed var(--border)",
            background: "var(--bg)",
            padding: "10px 16px 12px 20px",
          }}
        >
          <p
            style={{
              fontSize: "10.5px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.6px",
              color: "var(--text-faint)",
              margin: "0 0 8px 0",
            }}
          >
            Previous Versions
          </p>
          <ul className={styles.miniList} style={{ gap: "6px" }}>
            {older.map((oldDoc, idx) => {
              const oldDate = fmtDate(docDate(oldDoc));
              return (
                <li
                  key={idx}
                  className={styles.miniListItem}
                  style={{
                    background: "#FAFAFA",
                    borderLeft: "3px solid var(--border)",
                    borderRadius: "8px",
                    padding: "10px 12px",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                      <strong style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                        {oldDoc.file_name || groupName}
                      </strong>
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 600,
                          textTransform: "uppercase",
                          color: "var(--text-faint)",
                          background: "#ECECEC",
                          padding: "1px 6px",
                          borderRadius: "20px",
                        }}
                      >
                        v{docs.length - 1 - idx}
                      </span>
                    </div>
                    <div className={styles.mutedText} style={{ fontSize: "11px" }}>
                      {oldDate ? `Uploaded ${oldDate}` : `Archived version ${idx + 1}`}
                    </div>
                  </div>
                  {oldDoc.file_url && (
                    <a
                      href={oldDoc.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.secondaryButton}
                      style={{
                        textDecoration: "none",
                        fontSize: "11.5px",
                        padding: "5px 10px",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        flexShrink: 0,
                      }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                        <polyline points="15 3 21 3 21 9"/>
                        <line x1="10" y1="14" x2="21" y2="3"/>
                      </svg>
                      View File
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Accent color for each category section (cycles through the design palette). */
const CATEGORY_COLORS = ["cyan", "purple", "orange", "green", "navy"];

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
        {/* ── Company email ─────────────────────────────────────────── */}
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
                {emailSaving ? "Saving…" : "Save company email"}
              </button>
            </form>
          </div>
        </div>

        {/* ── Company assets ────────────────────────────────────────── */}
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
                          {assignedDate ? ` · Assigned ${assignedDate}` : ""}
                        </div>
                      </div>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        style={{ fontSize: "11.5px", padding: "6px 12px", color: "var(--red)", borderColor: "#f0c4c2" }}
                        disabled={removingAssetId === asset.id}
                        onClick={() => handleRemoveAsset(asset.id)}
                      >
                        {removingAssetId === asset.id ? "Removing…" : "Remove"}
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
                {assetSaving ? "Assigning…" : "Assign asset"}
              </button>
            </form>
          </div>
        </div>

        {/* ── Orientation session ───────────────────────────────────── */}
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
                  <strong>Date:</strong> {orientation.date} · <strong>Time:</strong> {orientation.time}
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
                  ? "Saving…"
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
            <p className={styles.emptySub}>Loading…</p>
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

  // ── 1. Extract all file objects ──────────────────────────────────────────
  //
  // Source A: employee.onboarding
  //   Walk each top-level key separately so that key name becomes the category
  //   (e.g. "government_docs" → "Government Docs").
  //
  // Source B: employee.documents (fallback flat list)
  //
  const rawDocuments = [];

  if (employee.onboarding) {
    for (const [sectionKey, sectionValue] of Object.entries(employee.onboarding)) {
      if (!sectionValue || typeof sectionValue !== "object") continue;
      if (SKIP_KEYS.has(sectionKey)) continue;
      const category = toLabel(sectionKey); // e.g. "Government Docs"
      extractDocuments(sectionValue, category, category, rawDocuments);
    }
  }

  // Fallback: general employee.documents array
  if (Array.isArray(employee.documents)) {
    employee.documents.forEach((doc) => {
      if (!doc || typeof doc !== "object") return;
      if (!doc.file_url) return;
      rawDocuments.push({
        file_url:      doc.file_url     || null,
        file_name:     doc.file_name    || null,
        document_type: doc.document_type
          ? toLabel(doc.document_type)
          : doc.category
          ? toLabel(doc.category)
          : "Document",
        category:      doc.category ? toLabel(doc.category) : "Documents",
        status:        doc.status       || null,
        uploaded_at:   doc.uploaded_at  || null,
        submitted_at:  doc.submitted_at || null,
        created_at:    doc.created_at   || null,
      });
    });
  }

  // ── 2. Group: Category → Document Type → [versions] ─────────────────────
  //
  // Grouping key is the *structural type* (inferred from JSON key ancestry),
  // NOT the file_name. This ensures multiple uploads of the same logical
  // document end up in the same version group even when filenames differ.
  //
  const groupedByCategory = {};

  for (const doc of rawDocuments) {
    const cat     = doc.category      || "Uncategorized";
    const docType = doc.document_type || "Document";

    if (!groupedByCategory[cat])         groupedByCategory[cat] = {};
    if (!groupedByCategory[cat][docType]) groupedByCategory[cat][docType] = [];

    groupedByCategory[cat][docType].push(doc);
  }

  // ── 3. Sort each type group newest → oldest ──────────────────────────────
  //
  // Date priority: uploaded_at → submitted_at → created_at
  //
  for (const cat of Object.keys(groupedByCategory)) {
    for (const docType of Object.keys(groupedByCategory[cat])) {
      groupedByCategory[cat][docType].sort((a, b) => {
        const dA = new Date(docDate(a) || 0);
        const dB = new Date(docDate(b) || 0);
        return dB - dA; // Descending (newest first)
      });
    }
  }

  const categoryEntries = Object.entries(groupedByCategory);
  const hasDocuments    = categoryEntries.length > 0;
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
    { key: "documents", label: "Documents" },
    { key: "career", label: "Career" },
    { key: "day1", label: "Day-1" },
  ];

  // ── Render ───────────────────────────────────────────────────────────────
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

      {/* ── Profile hero ─────────────────────────────────────────────── */}
      <div className={styles.section} style={{ marginBottom: 16 }}>
        <div className={styles.profileHero}>
          <div className={styles.profileAvatar}>{initials}</div>
          <div>
            <h2 className={styles.profileName}>{employee.full_name}</h2>
            <p className={styles.mutedText} style={{ margin: 0 }}>
              {employee.job_title || "No designation"} · {employee.department || "No department"}
            </p>
            <div className={styles.chipRow}>
              {employee.employee_id && <span className={styles.chip}>{employee.employee_id}</span>}
              {employee.profile_status && (
                <span className={styles.chip} style={{ textTransform: "capitalize" }}>
                  {employee.profile_status}
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
                <dd>{employee.full_name || "—"}</dd>
              </div>
              <div className={styles.employeeFact}>
                <dt>Employee ID</dt>
                <dd>{employee.employee_id || "—"}</dd>
              </div>
              <div className={styles.employeeFact}>
                <dt>Email</dt>
                <dd>{employee.email || "—"}</dd>
              </div>
              <div className={styles.employeeFact}>
                <dt>Company email</dt>
                <dd>{employee.company_email || "—"}</dd>
              </div>
              <div className={styles.employeeFact}>
                <dt>Phone</dt>
                <dd>{employee.phone || "—"}</dd>
              </div>
              <div className={styles.employeeFact}>
                <dt>Job title</dt>
                <dd>{employee.job_title || "—"}</dd>
              </div>
              <div className={styles.employeeFact}>
                <dt>Department</dt>
                <dd>{employee.department || "—"}</dd>
              </div>
              <div className={styles.employeeFact}>
                <dt>Reporting manager</dt>
                <dd>{employee.reporting_manager || "—"}</dd>
              </div>
              <div className={styles.employeeFact}>
                <dt>Office location</dt>
                <dd>{employee.office_location || "—"}</dd>
              </div>
              <div className={styles.employeeFact}>
                <dt>Start date</dt>
                <dd>{fmtDate(employee.start_date) || "—"}</dd>
              </div>
              <div className={styles.employeeFact}>
                <dt>Profile status</dt>
                <dd style={{ textTransform: "capitalize" }}>{employee.profile_status || "—"}</dd>
              </div>
            </dl>
          </div>
        </div>
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
                        {event.to_title ? ` · ${event.to_title}` : ""}
                        {event.to_department ? ` · ${event.to_department}` : ""}
                        {event.to_manager ? ` · Manager: ${event.to_manager}` : ""}
                        {event.note ? ` — ${event.note}` : ""}
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
                <div className={styles.sectionTitle}>Uploaded documents</div>
                <div className={styles.sectionDesc}>
                  {hasDocuments
                    ? `${rawDocuments.length} file${rawDocuments.length !== 1 ? "s" : ""} on file`
                    : "Document version history for this employee"}
                </div>
              </div>
            </div>
          </div>
          <div className={styles.sectionBody}>
            {!hasDocuments ? (
              <p className={styles.emptySub}>No documents found for this employee.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                {categoryEntries.map(([category, docGroups], catIdx) => {
                  const colorClass = CATEGORY_COLORS[catIdx % CATEGORY_COLORS.length];
                  const groupEntries = Object.entries(docGroups);
                  const totalFiles  = groupEntries.reduce((sum, [, docs]) => sum + docs.length, 0);

                  return (
                    <div
                      key={category}
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
                        <div className={`${styles.bar} ${styles[colorClass]}`} />
                        <div style={{ flex: 1 }}>
                          <div className={styles.sectionTitle} style={{ fontSize: "15px" }}>
                            {category}
                          </div>
                          <div className={styles.sectionDesc}>
                            {groupEntries.length} type{groupEntries.length !== 1 ? "s" : ""} · {totalFiles} file{totalFiles !== 1 ? "s" : ""}
                          </div>
                        </div>
                      </div>

                      <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: "16px" }}>
                        {groupEntries.map(([groupName, docs]) => (
                          <div key={groupName}>
                            <p
                              style={{
                                fontSize: "10.5px",
                                fontWeight: 700,
                                textTransform: "uppercase",
                                letterSpacing: "0.5px",
                                color: "var(--text-faint)",
                                margin: "0 0 6px 0",
                              }}
                            >
                              {groupName}
                            </p>
                            <DocumentGroup groupName={groupName} docs={docs} />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </RecruiterShell>
  );
}

"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import RecruiterShell from "@/components/recruiter/RecruiterShell";
import styles from "@/components/recruiter/recruiter-shell.module.css";
import { getEmployeeDetail, getApiErrorMessage } from "@/services/authService";

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

      {/* ── Employee Info Card ───────────────────────────────────────── */}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <div className={`${styles.bar} ${styles.navy}`} />
            <div>
              <div className={styles.sectionTitle}>{employee.full_name}</div>
              <div className={styles.sectionDesc}>{employee.job_title || "No Designation"} · {employee.department || "No Department"}</div>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          <p className={styles.instruction} style={{ marginBottom: "30px", lineHeight: "1.6" }}>
            <strong>Email:</strong> {employee.email} <br/>
            <strong>Phone:</strong> {employee.phone || "—"} <br/>
            <strong>Employee ID:</strong> {employee.employee_id} <br/>
            <strong>Employment Type:</strong> {employee.employment_type || "—"} <br/>
            <strong>Office Location:</strong> {employee.office_location || "—"} <br/>
            <strong>Manager:</strong> {employee.reporting_manager || "—"} <br/>
            <strong>Joined:</strong> {employee.start_date ? new Date(employee.start_date).toLocaleDateString() : "—"} <br/>
            <strong>Status:</strong> <span style={{ textTransform: "capitalize" }}>{employee.status || "—"}</span>
          </p>

          {/* ── Document Version History ─────────────────────────────── */}
          <div className={`${styles.bar} ${styles.purple}`} style={{ width: "100%", height: "2px", margin: "20px 0" }} />

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "10px",
              marginBottom: "16px",
            }}
          >
            <h3 className={styles.sectionTitle} style={{ fontSize: 18, margin: 0 }}>
              Uploaded Documents
            </h3>
            {hasDocuments && (
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.4px",
                  color: "var(--purple)",
                  background: "var(--purple-light)",
                  padding: "4px 10px",
                  borderRadius: "20px",
                }}
              >
                {rawDocuments.length} file{rawDocuments.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>

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
                    {/* Category header */}
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

                    {/* Document groups within this category */}
                    <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: "16px" }}>
                      {groupEntries.map(([groupName, docs]) => (
                        <div key={groupName}>
                          {/* Type label */}
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
    </RecruiterShell>
  );
}

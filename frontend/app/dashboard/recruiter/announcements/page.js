"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import RecruiterShell from "@/components/recruiter/RecruiterShell";
import ProtectedRecruiterRoute from "@/components/ProtectedRecruiterRoute";
import ConfirmDialog from "@/components/ConfirmDialog";
import styles from "@/components/recruiter/recruiter-shell.module.css";
import s from "./announcements.module.css";
import { useOrgFrameworkOptions } from "@/hooks/useOrgFrameworkOptions";
import {
  createAnnouncement,
  deleteAnnouncement,
  getAnnouncements,
  getApiErrorMessage,
  listEmployees,
  updateAnnouncement,
} from "@/services/authService";
import { validateTextField } from "@/utils/validation";
import FieldError, { INPUT_ERROR_STYLE } from "@/lib/formFeedback";
import {
  clearRecruiterContext,
  publishRecruiterContext,
} from "@/lib/ai/recruiterContext";

const EMPTY_FORM = {
  title: "",
  body: "",
  audience: "both",
  target_departments: [],
  target_designations: [],
  target_employee_ids: [],
  send_email: true,
  notify_again: false,
};

const AUDIENCE_OPTIONS = [
  { value: "both", label: "Candidates & employees" },
  { value: "candidates", label: "Candidates only" },
  { value: "employees", label: "Employees only" },
];

export default function RecruiterAnnouncementsPage() {
  return (
    <ProtectedRecruiterRoute requiredCapability="announcements">
      <RecruiterAnnouncementsPageContent />
    </ProtectedRecruiterRoute>
  );
}

function RecruiterAnnouncementsPageContent() {
  const { departments: frameworkDepartments, roleNames: frameworkDesignations } = useOrgFrameworkOptions();
  const departmentOptions = frameworkDepartments;
  const designationOptions = frameworkDesignations;
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [composing, setComposing] = useState(false);
  const [audienceFilter, setAudienceFilter] = useState("all");

  useEffect(() => {
    publishRecruiterContext({
      section: "announcement_form",
      hint: "Write title and body, pick audience, optionally target departments/people, then Publish.",
      fields: ["title", "body", "audience", "send_email", "target_departments", "target_designations"],
    });
    return () => clearRecruiterContext();
  }, []);

  const loadAnnouncements = useCallback(async () => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      const data = await getAnnouncements(accessToken, 50);
      setAnnouncements(data.announcements || []);
      setError("");
    } catch (err) {
      const message = getApiErrorMessage(err, "Could not load announcements.");
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- poll + initial fetch
    loadAnnouncements();
    const timer = setInterval(loadAnnouncements, 30000);
    return () => clearInterval(timer);
  }, [loadAnnouncements]);

  useEffect(() => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    listEmployees(accessToken, { status: "active", page: 1, page_size: 100, sort: "full_name" }).then((employeeData) => {
      setEmployees(employeeData.employees || []);
    }).catch((err) => toast.error(getApiErrorMessage(err, "Could not load employee recipients.")));
  }, []);

  function startCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setComposing(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startEdit(item) {
    setEditingId(item.id);
    setForm({
      title: item.title || "",
      body: item.body || "",
      audience: item.audience || "both",
      target_departments: item.target_departments || [],
      target_designations: item.target_designations || [],
      target_employee_ids: item.target_employee_ids || [],
      send_email: false,
      notify_again: false,
    });
    setFieldErrors({});
    setComposing(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setComposing(false);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFieldErrors({});
    const errors = {
      title: !validateTextField(form.title, 3, 150).isValid ? "Title must be at least 3 characters." : undefined,
      body: !validateTextField(form.body, 3, 4000).isValid ? "Message must be at least 3 characters." : undefined,
    };
    if (Object.values(errors).some(Boolean)) {
      setFieldErrors(errors);
      return;
    }
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setSaving(true);
    try {
      if (editingId) {
        const data = await updateAnnouncement(
          editingId,
          {
            title: form.title.trim(),
            body: form.body.trim(),
            audience: form.audience,
            target_departments: form.target_departments,
            target_designations: form.target_designations,
            target_employee_ids: form.target_employee_ids,
            send_email: form.send_email,
            notify_again: form.notify_again,
          },
          accessToken
        );
        setAnnouncements((current) =>
          current.map((item) => (item.id === editingId ? data.announcement : item))
        );
        toast.success(data.message || "Announcement updated.");
      } else {
        const data = await createAnnouncement(
          {
            title: form.title.trim(),
            body: form.body.trim(),
            audience: form.audience,
            target_departments: form.target_departments,
            target_designations: form.target_designations,
            target_employee_ids: form.target_employee_ids,
            send_email: form.send_email,
          },
          accessToken
        );
        setAnnouncements((current) => [data.announcement, ...current]);
        toast.success(data.message || "Announcement published.");
      }
      resetForm();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not save announcement."));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      await deleteAnnouncement(deleteTarget.id, accessToken);
      setAnnouncements((current) => current.filter((item) => item.id !== deleteTarget.id));
      if (editingId === deleteTarget.id) resetForm();
      toast.success("Announcement deleted.");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not delete announcement."));
    } finally {
      setDeleteTarget(null);
    }
  }

  const counts = {
    all: announcements.length,
    both: announcements.filter((item) => item.audience === "both").length,
    candidates: announcements.filter((item) => item.audience === "candidates").length,
    employees: announcements.filter((item) => item.audience === "employees").length,
  };
  const visibleAnnouncements = audienceFilter === "all"
    ? announcements
    : announcements.filter((item) => item.audience === audienceFilter);

  return (
    <RecruiterShell
      activeKey="announcements"
      capability="announcements"
      title="Announcements"
      subtitle="Publish, edit, and remove updates for candidates and employees"
    >
      {error && (
        <div className={styles.formMessage} role="alert">
          {error}
        </div>
      )}

      <div className={s.stats}>
        <div className={styles.statCard}>
          <div className={`${styles.statIcon} ${styles.blue}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /></svg>
          </div>
          <div className={styles.statText}>
            <div className={styles.statValue}>{counts.all}</div>
            <div className={styles.statLabel}>Published</div>
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={`${styles.statIcon} ${styles.cyan}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
          </div>
          <div className={styles.statText}>
            <div className={styles.statValue}>{counts.both}</div>
            <div className={styles.statLabel}>Everyone</div>
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={`${styles.statIcon} ${styles.purple}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
          </div>
          <div className={styles.statText}>
            <div className={styles.statValue}>{counts.candidates}</div>
            <div className={styles.statLabel}>Candidates</div>
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={`${styles.statIcon} ${styles.green}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /></svg>
          </div>
          <div className={styles.statText}>
            <div className={styles.statValue}>{counts.employees}</div>
            <div className={styles.statLabel}>Employees</div>
          </div>
        </div>
      </div>

      {composing && (
        <div className={`${styles.section} ${s.composer}`} id="announce-composer">
          <div className={styles.sectionHead}>
            <div className={styles.sectionHeadLeft}>
              <div className={`${styles.bar} ${styles.purple}`} />
              <div>
                <div className={styles.sectionTitle}>{editingId ? "Edit announcement" : "New announcement"}</div>
                <div className={styles.sectionDesc}>In-app notifications are sent automatically. Email is optional.</div>
              </div>
            </div>
            <button type="button" className={styles.secondaryButton} onClick={resetForm} disabled={saving}>
              Cancel
            </button>
          </div>
          <div className={styles.sectionBody}>
            <form data-partner-coach onSubmit={handleSubmit} className={s.form}>
              <label className={styles.field}>
                <span>Title</span>
                <input
                  value={form.title}
                  onChange={(e) => {
                    setForm({ ...form, title: e.target.value });
                    setFieldErrors((current) => {
                      const next = { ...current };
                      delete next.title;
                      return next;
                    });
                  }}
                  required
                  minLength={3}
                  maxLength={150}
                  aria-invalid={Boolean(fieldErrors.title)}
                  style={fieldErrors.title ? INPUT_ERROR_STYLE : undefined}
                  placeholder="e.g. Orientation schedule update"
                />
                {fieldErrors.title && <FieldError>{fieldErrors.title}</FieldError>}
              </label>
              <div>
                <div className={s.audienceLabel} id="announce-audience-label">Audience</div>
                <div className={s.tabs} role="group" aria-labelledby="announce-audience-label">
                  {AUDIENCE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`${s.tab} ${form.audience === option.value ? s.tabActive : ""}`}
                      onClick={() =>
                        setForm({
                          ...form,
                          audience: option.value,
                          ...(option.value !== "employees"
                            ? { target_departments: [], target_designations: [], target_employee_ids: [] }
                            : {}),
                        })
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className={styles.field}>
                <span>Message</span>
                <textarea
                  rows={4}
                  value={form.body}
                  onChange={(e) => {
                    setForm({ ...form, body: e.target.value });
                    setFieldErrors((current) => {
                      const next = { ...current };
                      delete next.body;
                      return next;
                    });
                  }}
                  required
                  minLength={3}
                  maxLength={4000}
                  className={s.textarea}
                  aria-invalid={Boolean(fieldErrors.body)}
                  style={fieldErrors.body ? INPUT_ERROR_STYLE : undefined}
                  placeholder="Write a clear update for your audience…"
                />
                {fieldErrors.body && <FieldError>{fieldErrors.body}</FieldError>}
              </label>
              {form.audience === "employees" && (
                <section className={styles.recipientPicker}>
                  <div className={styles.recipientPickerHead}>
                    <div>
                      <span className={styles.recipientEyebrow}>Targeted delivery</span>
                      <h3>Choose employee recipients</h3>
                      <p>Leave everything unselected to reach all active employees. Selections are combined, so anyone matching a chosen department, designation, or name receives the announcement.</p>
                    </div>
                    <span className={styles.recipientCount}>{form.target_departments.length + form.target_designations.length + form.target_employee_ids.length} selected</span>
                  </div>
                  <div className={styles.recipientGrid}>
                    <MultiSelectGroup
                      label="Departments"
                      options={departmentOptions}
                      selected={form.target_departments}
                      onChange={(values) => setForm({ ...form, target_departments: values })}
                    />
                    <MultiSelectGroup
                      label="Designations"
                      options={designationOptions}
                      selected={form.target_designations}
                      onChange={(values) => setForm({ ...form, target_designations: values })}
                    />
                  </div>
                  <div className={styles.employeeSelect}>
                    <div className={styles.employeeSelectHead}>
                      <span>Individual employees</span>
                      <input value={employeeSearch} onChange={(e) => setEmployeeSearch(e.target.value)} placeholder="Search by name, department, or designation" />
                    </div>
                    <div className={styles.employeeOptions}>
                      {employees.filter((employee) => `${employee.full_name} ${employee.department} ${employee.job_title}`.toLowerCase().includes(employeeSearch.toLowerCase())).map((employee) => (
                        <label className={styles.employeeOption} key={employee.id}>
                          <input type="checkbox" checked={form.target_employee_ids.includes(employee.id)} onChange={() => setForm({ ...form, target_employee_ids: toggleValue(form.target_employee_ids, employee.id) })} />
                          <span className={styles.employeeAvatar}>{initials(employee.full_name)}</span>
                          <span><strong>{employee.full_name}</strong><small>{employee.job_title || "No designation"} · {employee.department || "No department"}</small></span>
                        </label>
                      ))}
                    </div>
                  </div>
                </section>
              )}
              <div className={s.footer}>
                <div className={s.checks}>
                  <label className={styles.checkInline}>
                    <input
                      type="checkbox"
                      checked={form.send_email}
                      onChange={(e) => setForm({ ...form, send_email: e.target.checked })}
                    />
                    <span>Send email to audience</span>
                  </label>
                  {editingId && (
                    <label className={styles.checkInline}>
                      <input
                        type="checkbox"
                        checked={form.notify_again}
                        onChange={(e) => setForm({ ...form, notify_again: e.target.checked })}
                      />
                      <span>Re-notify in-app</span>
                    </label>
                  )}
                </div>
                <div className={s.actions}>
                  <button className={styles.primaryButton} type="submit" disabled={saving}>
                    {saving ? "Saving…" : editingId ? "Save changes" : "Publish announcement"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <div className={`${styles.bar} ${styles.cyan}`} />
            <div>
              <div className={styles.sectionTitle}>All announcements</div>
              <div className={styles.sectionDesc}>
                {counts.all} published · updates refresh every 30 seconds
              </div>
            </div>
          </div>
          <div className={s.actions}>
            <button type="button" className={`${styles.secondaryButton} ${styles.btnSm}`} onClick={loadAnnouncements}>
              Refresh
            </button>
            {!composing && (
              <button type="button" className={styles.primaryButton} onClick={startCreate}>
                New announcement
              </button>
            )}
          </div>
        </div>
        <div className={styles.sectionBody}>
          <div className={s.toolbar}>
            <div className={s.filters}>
              {[
                { value: "all", label: "All" },
                { value: "both", label: "Everyone" },
                { value: "candidates", label: "Candidates" },
                { value: "employees", label: "Employees" },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`${s.filter} ${audienceFilter === option.value ? s.filterActive : ""}`}
                  onClick={() => setAudienceFilter(option.value)}
                >
                  {option.label} · {counts[option.value]}
                </button>
              ))}
            </div>
          </div>
          {loading && announcements.length === 0 ? (
            <p className={s.emptyCopy}>Loading announcements…</p>
          ) : visibleAnnouncements.length ? (
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Announcement</th>
                    <th>Audience</th>
                    <th>From</th>
                    <th>Published</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visibleAnnouncements.map((item) => (
                    <tr key={item.id} className={editingId === item.id ? s.rowEditing : undefined}>
                      <td className={s.titleCell}>
                        <p className={s.title}>{item.title}</p>
                        <p className={s.snippet}>{item.body}</p>
                        {targetSummary(item) && <p className={s.target}>{targetSummary(item)}</p>}
                      </td>
                      <td>
                        <span className={`${s.pill} ${audiencePillClass(item.audience)}`}>{audienceLabel(item.audience)}</span>
                      </td>
                      <td className={s.meta}>{item.created_by_name || "Recruiting team"}</td>
                      <td className={s.meta}>{formatDate(item.created_at)}</td>
                      <td>
                        <div className={s.rowActions}>
                          <button type="button" className={`${styles.secondaryButton} ${styles.btnSm}`} onClick={() => startEdit(item)}>
                            Edit
                          </button>
                          <button type="button" className={`${styles.dangerButton} ${styles.btnSm}`} onClick={() => setDeleteTarget(item)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={s.empty}>
              <p className={s.emptyTitle}>{announcements.length ? "No matches in this filter" : "No announcements yet"}</p>
              <p className={s.emptyCopy}>
                {announcements.length
                  ? "Try another audience filter."
                  : "Publish an update for candidates, employees, or both."}
              </p>
              {!composing && !announcements.length && (
                <button type="button" className={styles.primaryButton} onClick={startCreate}>
                  New announcement
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete announcement?"
        message={`“${deleteTarget?.title || ""}” will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </RecruiterShell>
  );
}

function audienceLabel(value) {
  if (value === "candidates") return "Candidates";
  if (value === "employees") return "Employees";
  return "Everyone";
}

function audiencePillClass(value) {
  if (value === "candidates") return s.pillCandidates;
  if (value === "employees") return s.pillEmployees;
  return "";
}

function MultiSelectGroup({ label, options, selected, onChange }) {
  return (
    <div className={styles.multiSelectGroup}>
      <span>{label}</span>
      <div className={styles.multiSelectOptions}>
        {options.map((option) => (
          <label className={`${styles.choiceChip} ${selected.includes(option) ? styles.choiceChipSelected : ""}`} key={option}>
            <input type="checkbox" checked={selected.includes(option)} onChange={() => onChange(toggleValue(selected, option))} />
            {option}
          </label>
        ))}
      </div>
    </div>
  );
}

function toggleValue(values, value) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function initials(name = "") {
  return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}

function targetSummary(item) {
  const parts = [];
  if (item.target_departments?.length) parts.push(`${item.target_departments.length} department${item.target_departments.length === 1 ? "" : "s"}`);
  if (item.target_designations?.length) parts.push(`${item.target_designations.length} designation${item.target_designations.length === 1 ? "" : "s"}`);
  if (item.target_employee_ids?.length) parts.push(`${item.target_employee_ids.length} employee${item.target_employee_ids.length === 1 ? "" : "s"}`);
  return parts.length ? `Targeted to ${parts.join(", ")}` : "";
}

function formatDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

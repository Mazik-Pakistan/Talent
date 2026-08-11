"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import {
  Archive,
  BookOpen,
  Briefcase,
  Building2,
  Calendar,
  Check,
  Clock,
  Download,
  Eye,
  FolderTree,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import ConfirmDialog from "@/components/ConfirmDialog";
import FileUploadField from "@/components/FileUploadField";
import shellStyles from "@/components/recruiter/recruiter-shell.module.css";
import { useOrgFrameworkOptions } from "@/hooks/useOrgFrameworkOptions";
import { getApiErrorMessage } from "@/services/authService";
import { downloadCsv } from "@/utils/downloadCsv";
import {
  archiveManagedCourse,
  bulkManagedCourseAction,
  commitImport,
  commitManagedImport,
  createImportCourse,
  createManagedCourse,
  deleteManagedCourse,
  downloadImportReport,
  getManagedFacets,
  listImportHistory,
  listManagedCourses,
  listProviders,
  previewImport,
  previewManagedImport,
  restoreManagedCourse,
  rollbackImport,
  updateImportCourse,
  updateManagedCourse,
} from "@/services/learningService";
import {
  downloadCourseCatalogTemplate,
  downloadRoadmapTemplate,
} from "./courseImportTemplates";
import styles from "./learning.module.css";

const LEARNING_PROVIDERS_UPDATED_EVENT = "learning-providers-updated";
const LEARNING_PROVIDERS_UPDATED_STORAGE_KEY = "learning-providers-updated-at";

const EMPTY_CATALOG_FORM = {
  id: "",
  provider_id: "",
  title: "",
  url: "",
  external_id: "",
  description: "",
  duration_minutes: "",
  archived: false,
};

const EMPTY_ROADMAP_FORM = {
  id: "",
  provider: "",
  designation: "",
  learning_month: "",
  category: "",
  competency: "",
  title: "",
  url: "",
  duration_minutes: "",
  description: "",
  archived: false,
};

/** Fixed path months so placements stay consistent on the roadmap. */
const ROADMAP_MONTHS = Array.from({ length: 12 }, (_, i) => `Month ${i + 1}`);

function roadmapMonthOptions(currentValue = "") {
  const current = String(currentValue || "").trim();
  if (current && !ROADMAP_MONTHS.includes(current)) {
    return [...ROADMAP_MONTHS, current];
  }
  return ROADMAP_MONTHS;
}

/**
 * Unified Courses tab:
 *  1) Add courses — to a provider, one-by-one or Excel
 *  2) Build roadmap — place courses on designation/role roadmap (manual or Excel)
 */
export default function CoursesTab({
  initialProvider = null,
  onConsumedInitial,
  initialSection = "add",
}) {
  const [section, setSection] = useState(initialSection === "roadmap" ? "roadmap" : "add");
  const [providerRecords, setProviderRecords] = useState([]);

  const loadProviderRecords = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return Promise.resolve([]);
    return listProviders(token, { include_inactive: true, page_size: 100 })
      .then((data) => {
        const list = data.providers || [];
        setProviderRecords(list);
        return list;
      })
      .catch((err) => {
        toast.error(getApiErrorMessage(err, "Could not load providers."));
        return [];
      });
  }, []);

  useEffect(() => {
    loadProviderRecords();
    const onChanged = () => loadProviderRecords();
    window.addEventListener(LEARNING_PROVIDERS_UPDATED_EVENT, onChanged);
    const onStorage = (e) => {
      if (e.key === LEARNING_PROVIDERS_UPDATED_STORAGE_KEY) loadProviderRecords();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(LEARNING_PROVIDERS_UPDATED_EVENT, onChanged);
      window.removeEventListener("storage", onStorage);
    };
  }, [loadProviderRecords]);

  useEffect(() => {
    if (!initialProvider) return;
    setSection("add");
    onConsumedInitial?.();
  }, [initialProvider, onConsumedInitial]);

  return (
    <>
      <div className={styles.modeRow} role="tablist" aria-label="Courses sections">
        <button
          type="button"
          role="tab"
          aria-selected={section === "add"}
          className={`${styles.modeBtn} ${section === "add" ? styles.modeActive : ""}`}
          onClick={() => setSection("add")}
        >
          <Plus aria-hidden="true" /> Add courses
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === "roadmap"}
          className={`${styles.modeBtn} ${section === "roadmap" ? styles.modeActive : ""}`}
          onClick={() => setSection("roadmap")}
        >
          <FolderTree aria-hidden="true" /> Build roadmap
        </button>
      </div>
      <p className={styles.sourceHint}>
        {section === "add"
          ? "Add courses to a provider — one by one or in bulk with Excel. Place them on a roadmap next."
          : "Map courses to designations / roles (and month, category, competency) — manually or via Excel."}
      </p>

      {section === "add" ? (
        <AddCoursesPanel
          providerRecords={providerRecords}
          initialProvider={initialProvider}
          onProvidersChanged={loadProviderRecords}
        />
      ) : (
        <RoadmapPanel
          providerNames={providerRecords.filter((p) => p.active).map((p) => p.name).filter(Boolean)}
          onProvidersChanged={loadProviderRecords}
        />
      )}
    </>
  );
}

function AddCoursesPanel({ providerRecords, initialProvider, onProvidersChanged }) {
  const [providerId, setProviderId] = useState(initialProvider?.id || "");
  const [catalogForm, setCatalogForm] = useState({
    ...EMPTY_CATALOG_FORM,
    provider_id: initialProvider?.id || "",
  });
  const [courseSaving, setCourseSaving] = useState(false);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [missingAction, setMissingAction] = useState("keep");
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [pendingRollback, setPendingRollback] = useState(null);
  const [busyId, setBusyId] = useState("");

  const selectedProvider =
    providerRecords.find((p) => p.id === (catalogForm.provider_id || providerId)) || null;

  function handleDownloadCatalogTemplate() {
    try {
      downloadCourseCatalogTemplate();
      toast.success("Catalog template downloaded.");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not download template."));
    }
  }

  useEffect(() => {
    if (!initialProvider?.id) return;
    setProviderId(initialProvider.id);
    setCatalogForm((current) => ({ ...current, provider_id: initialProvider.id }));
  }, [initialProvider]);

  const loadHistory = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setHistoryLoading(true);
    listImportHistory(token, { page_size: 15 })
      .then((data) => setHistory(data.history || []))
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  function resetCatalogForm() {
    setCatalogForm({
      ...EMPTY_CATALOG_FORM,
      provider_id: catalogForm.provider_id || providerId || "",
    });
  }

  async function handleCatalogSubmit(e) {
    e.preventDefault();
    const pid = catalogForm.provider_id || providerId;
    if (!pid) {
      toast.error("Select a provider first.");
      return;
    }
    if (!catalogForm.title.trim()) {
      toast.error("Course title is required.");
      return;
    }
    const token = localStorage.getItem("access_token");
    if (!token) return;

    const payload = {
      provider_id: pid,
      title: catalogForm.title.trim(),
      url: catalogForm.url.trim() || null,
      external_id: catalogForm.external_id.trim() || null,
      description: catalogForm.description.trim() || null,
      duration_minutes: catalogForm.duration_minutes ? Number(catalogForm.duration_minutes) : null,
      archived: Boolean(catalogForm.archived),
      designation: "",
      learning_month: "",
      category: "",
      competency: "",
    };

    setCourseSaving(true);
    try {
      if (catalogForm.id) {
        await updateImportCourse(token, catalogForm.id, payload);
        toast.success("Course updated.");
      } else {
        await createImportCourse(token, payload);
        toast.success("Course added to provider.");
      }
      resetCatalogForm();
      onProvidersChanged?.();
      loadHistory();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not save course."));
    } finally {
      setCourseSaving(false);
    }
  }

  async function handlePreview(e) {
    e.preventDefault();
    const pid = providerId || catalogForm.provider_id;
    if (!pid) {
      toast.error("Select a provider first.");
      return;
    }
    if (!file) {
      toast.error("Choose an Excel or CSV file.");
      return;
    }
    const token = localStorage.getItem("access_token");
    const found = providerRecords.find((p) => p.id === pid);
    setPreviewing(true);
    setPreview(null);
    try {
      const data = await previewImport(token, {
        file,
        providerId: pid,
        providerName: found?.name,
      });
      setPreview(data);
      if (!data.valid) toast.warn("The file has validation issues. Review below.");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not preview the file."));
    } finally {
      setPreviewing(false);
    }
  }

  async function handleCommit() {
    if (!preview?.valid) return;
    const pid = providerId || catalogForm.provider_id;
    const token = localStorage.getItem("access_token");
    const found = providerRecords.find((p) => p.id === pid);
    setSaving(true);
    try {
      const data = await commitImport(token, {
        file,
        providerId: pid,
        providerName: found?.name,
        missingAction,
      });
      toast.success(data.message || "Courses imported.");
      setPreview(null);
      setFile(null);
      onProvidersChanged?.();
      loadHistory();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Import failed."));
    } finally {
      setSaving(false);
    }
  }

  async function confirmRollback() {
    const token = localStorage.getItem("access_token");
    if (!token || !pendingRollback) return;
    setBusyId(pendingRollback.id);
    try {
      await rollbackImport(token, pendingRollback.id);
      toast.success("Import rolled back.");
      setPendingRollback(null);
      onProvidersChanged?.();
      loadHistory();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not roll back the import."));
    } finally {
      setBusyId("");
    }
  }

  async function handleDownloadReport(historyId) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    try {
      const blob = await downloadImportReport(token, historyId);
      const url = window.URL.createObjectURL(new Blob([blob]));
      const link = document.createElement("a");
      link.href = url;
      link.download = `import-report-${historyId}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not download the report."));
    }
  }

  const activeProviders = providerRecords.filter((p) => p.active);
  const hasInvalid = (preview?.invalid_rows || 0) > 0;

  return (
    <>
      <ConfirmDialog
        open={Boolean(pendingRollback)}
        title="Roll back this import?"
        message="This undoes courses created, updated, archived, or deleted by this import."
        confirmLabel="Roll back"
        cancelLabel="Cancel"
        danger
        onConfirm={confirmRollback}
        onCancel={() => setPendingRollback(null)}
      />

      <div className={shellStyles.section}>
        <div className={shellStyles.sectionHead}>
          <div className={shellStyles.sectionHeadLeft}>
            <span className={`${shellStyles.bar} ${shellStyles.cyan}`} />
            <div>
              <div className={shellStyles.sectionTitle}>
                {catalogForm.id ? "Edit course" : "Add one course"}
              </div>
              <p className={shellStyles.sectionDesc}>
                Save the course under a provider. Roadmap placement comes next in Build roadmap.
              </p>
            </div>
          </div>
        </div>
        <div className={shellStyles.sectionBody}>
          <form className={styles.managedForm} onSubmit={handleCatalogSubmit}>
            <label className={styles.fieldLabel}>
              Provider
              <select
                value={catalogForm.provider_id}
                onChange={(e) => {
                  setCatalogForm((c) => ({ ...c, provider_id: e.target.value }));
                  setProviderId(e.target.value);
                }}
                required
              >
                <option value="">Select a provider…</option>
                {providerRecords.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.active}>
                    {p.name}{!p.active ? " (inactive)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.fieldLabel}>
              External course ID
              <input
                placeholder="Optional"
                value={catalogForm.external_id}
                onChange={(e) => setCatalogForm((c) => ({ ...c, external_id: e.target.value }))}
              />
            </label>
            <label className={`${styles.fieldLabel} ${styles.wide}`}>
              Course title
              <input
                placeholder="e.g. Azure Fundamentals"
                value={catalogForm.title}
                onChange={(e) => setCatalogForm((c) => ({ ...c, title: e.target.value }))}
                required
              />
            </label>
            <label className={`${styles.fieldLabel} ${styles.wide}`}>
              Course URL
              <input
                placeholder="https://example.com/course"
                value={catalogForm.url}
                onChange={(e) => setCatalogForm((c) => ({ ...c, url: e.target.value }))}
              />
            </label>
            <label className={styles.fieldLabel}>
              Duration (minutes)
              <input
                type="number"
                min="1"
                placeholder="e.g. 45"
                value={catalogForm.duration_minutes}
                onChange={(e) => setCatalogForm((c) => ({ ...c, duration_minutes: e.target.value }))}
              />
            </label>
            <label className={styles.checkPill} style={{ alignSelf: "end" }}>
              <input
                type="checkbox"
                checked={Boolean(catalogForm.archived)}
                onChange={(e) => setCatalogForm((c) => ({ ...c, archived: e.target.checked }))}
              />
              <Archive aria-hidden="true" />
              Archived
            </label>
            <label className={`${styles.fieldLabel} ${styles.wide}`}>
              Description
              <textarea
                rows={2}
                placeholder="Short summary"
                value={catalogForm.description}
                onChange={(e) => setCatalogForm((c) => ({ ...c, description: e.target.value }))}
              />
            </label>
            <div className={styles.formActions}>
              <button type="submit" className={styles.assignCourseBtn} disabled={courseSaving}>
                <Check aria-hidden="true" />
                {courseSaving ? "Saving…" : catalogForm.id ? "Update course" : "Add course"}
              </button>
              <button type="button" className={styles.smallBtn} onClick={resetCatalogForm}>
                <X aria-hidden="true" /> Clear
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className={shellStyles.section}>
        <div className={shellStyles.sectionHead}>
          <div className={shellStyles.sectionHeadLeft}>
            <span className={`${shellStyles.bar} ${shellStyles.green}`} />
            <div>
              <div className={shellStyles.sectionTitle}>Add courses via Excel</div>
              <p className={shellStyles.sectionDesc}>
                Bulk-add to a provider. Title is required; roadmap columns are optional.
              </p>
            </div>
          </div>
          <div className={styles.toolbar} style={{ marginBottom: 0 }}>
            <button type="button" className={styles.modeBtn} onClick={handleDownloadCatalogTemplate}>
              <Download aria-hidden="true" /> Download template
            </button>
          </div>
        </div>
        <div className={shellStyles.sectionBody}>
          <form onSubmit={handlePreview}>
            <div className={styles.providerFormGrid}>
              <label className={styles.fieldLabel}>
                Provider
                <select
                  className={styles.importProviderSelect}
                  value={providerId || catalogForm.provider_id}
                  onChange={(e) => {
                    setProviderId(e.target.value);
                    setCatalogForm((c) => ({ ...c, provider_id: e.target.value }));
                  }}
                >
                  <option value="">Select a provider…</option>
                  {providerRecords.map((p) => (
                    <option key={p.id} value={p.id} disabled={!p.active}>
                      {p.name}{!p.active ? " (inactive)" : ""}
                    </option>
                  ))}
                </select>
                {selectedProvider?.provider_type === "api" && (
                  <div className={styles.providerFormHint}>
                    API provider — you can also Sync from the Providers tab.
                  </div>
                )}
              </label>
              <label className={styles.fieldLabel}>
                Missing courses
                <select value={missingAction} onChange={(e) => setMissingAction(e.target.value)}>
                  <option value="keep">Keep (default)</option>
                  <option value="archive">Archive</option>
                  <option value="delete">Delete</option>
                </select>
              </label>
              <div className={`${styles.fieldLabel} ${styles.wide}`}>
                Spreadsheet
                <FileUploadField
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] || null);
                    setPreview(null);
                  }}
                />
                <div className={styles.providerFormHint}>
                  Download the template first, fill Course Title (and optional URL / description), then upload here.
                </div>
              </div>
            </div>
            <div className={styles.formActions}>
              <button
                type="submit"
                className={styles.assignCourseBtn}
                disabled={previewing || !(providerId || catalogForm.provider_id) || !file}
              >
                {previewing ? "Validating…" : "Validate & preview"}
              </button>
            </div>
          </form>

          {preview && (
            <div className={styles.assignPanel} style={{ marginTop: 18 }}>
              <div className={styles.importStats}>
                <div className={styles.importStat}>
                  <div className={styles.importStatValue}>{preview.new_courses}</div>
                  <div className={styles.importStatLabel}>New</div>
                </div>
                <div className={styles.importStat}>
                  <div className={styles.importStatValue}>{preview.updated_courses}</div>
                  <div className={styles.importStatLabel}>Updated</div>
                </div>
                <div className={styles.importStat}>
                  <div className={styles.importStatValue}>{preview.invalid_rows}</div>
                  <div className={styles.importStatLabel}>Invalid</div>
                </div>
              </div>
              {hasInvalid && (
                <p className={styles.inlineNote} style={{ marginTop: 10 }}>
                  Fix invalid rows before confirming.
                </p>
              )}
              <div className={styles.formActions} style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className={styles.assignCourseBtn}
                  disabled={saving || hasInvalid || !preview.valid}
                  onClick={handleCommit}
                >
                  <Check aria-hidden="true" /> {saving ? "Importing…" : "Confirm import"}
                </button>
                <button
                  type="button"
                  className={styles.smallBtn}
                  onClick={() => {
                    setPreview(null);
                    setFile(null);
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {!activeProviders.length && (
            <p className={styles.inlineNote} style={{ marginTop: 12 }}>
              No active providers yet — create one under Providers first.
            </p>
          )}

          <div style={{ marginTop: 24 }}>
            <div className={shellStyles.sectionTitle}>Recent imports</div>
            {!historyLoading && history.length === 0 && (
              <p className={styles.inlineNote}>No imports yet.</p>
            )}
            {!historyLoading &&
              history.map((h) => (
                <div key={h.id} className={styles.importHistoryRow}>
                  <div className={styles.importHistoryMain}>
                    <div className={styles.importHistoryTitle}>
                      {h.provider_name || "Provider"} · {h.import_type === "api" ? "API sync" : "Excel"}
                    </div>
                    <div className={styles.importHistoryMeta}>
                      <span>+{h.rows_imported} new</span>
                      <span>~{h.rows_updated} updated</span>
                      <span>{h.rows_failed} failed</span>
                    </div>
                  </div>
                  <div className={styles.importHistoryActions}>
                    <button type="button" className={styles.smallBtn} onClick={() => handleDownloadReport(h.id)}>
                      <Download aria-hidden="true" /> Report
                    </button>
                    {h.status === "completed" && !h.rollback_at && (
                      <button
                        type="button"
                        className={styles.smallBtn}
                        disabled={busyId === h.id}
                        onClick={() => setPendingRollback(h)}
                      >
                        <RefreshCw aria-hidden="true" /> Roll back
                      </button>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </>
  );
}

function flattenRoadmapCourses(hierarchy) {
  const courses = [];
  for (const designationNode of hierarchy || []) {
    for (const monthNode of designationNode.months || []) {
      for (const categoryNode of monthNode.categories || []) {
        for (const competencyNode of categoryNode.competencies || []) {
          for (const course of competencyNode.courses || []) {
            courses.push({
              ...course,
              designation: course.designation || designationNode.designation || "",
              learning_month: course.learning_month || monthNode.learning_month || "",
              category: course.category || categoryNode.category || "",
              competency: course.competency || competencyNode.competency || "",
            });
          }
        }
      }
    }
  }
  return courses;
}

function monthSortKey(value) {
  const text = String(value || "").toLowerCase();
  const num = text.match(/(\d+)/);
  if (num) return Number(num[1]);
  return text;
}

/** Org-aligned tree: Department → Role → Month → courses */
function buildOrgRoadmapTree(frameworkRoles, courses, { department, role, month }) {
  const roleIndex = new Map();
  for (const r of frameworkRoles || []) {
    if (!r?.name) continue;
    const key = String(r.name).trim().toLowerCase();
    if (!roleIndex.has(key)) roleIndex.set(key, []);
    roleIndex.get(key).push(r);
  }

  const byDept = new Map();

  // Seed with org roles (so empty roles still appear)
  for (const r of frameworkRoles || []) {
    const dept = (r.department || "Unassigned").trim() || "Unassigned";
    if (department && dept.toLowerCase() !== department.toLowerCase()) continue;
    if (role && r.name.toLowerCase() !== role.toLowerCase()) continue;
    if (!byDept.has(dept)) byDept.set(dept, new Map());
    const rolesMap = byDept.get(dept);
    if (!rolesMap.has(r.name)) rolesMap.set(r.name, new Map());
  }

  for (const course of courses || []) {
    if (course.archived) continue;
    const designation = String(course.designation || "").trim();
    if (!designation) continue;
    const matches = roleIndex.get(designation.toLowerCase()) || [];
    // Prefer exact department when multiple roles share a name
    let matched = matches[0];
    if (department && matches.length) {
      matched =
        matches.find((m) => (m.department || "").toLowerCase() === department.toLowerCase()) ||
        matched;
    }
    if (!matched) continue; // only org-aligned roles
    const dept = (matched.department || "Unassigned").trim() || "Unassigned";
    const roleName = matched.name;
    if (department && dept.toLowerCase() !== department.toLowerCase()) continue;
    if (role && roleName.toLowerCase() !== role.toLowerCase()) continue;
    const monthName = String(course.learning_month || "Unassigned").trim() || "Unassigned";
    if (month && monthName.toLowerCase() !== month.toLowerCase()) continue;

    if (!byDept.has(dept)) byDept.set(dept, new Map());
    const rolesMap = byDept.get(dept);
    if (!rolesMap.has(roleName)) rolesMap.set(roleName, new Map());
    const monthsMap = rolesMap.get(roleName);
    if (!monthsMap.has(monthName)) monthsMap.set(monthName, []);
    monthsMap.get(monthName).push(course);
  }

  const hideEmptyRoles = Boolean(month);
  return [...byDept.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([deptName, rolesMap]) => ({
      department: deptName,
      roles: [...rolesMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([roleName, monthsMap]) => ({
          role: roleName,
          months: [...monthsMap.entries()]
            .sort((a, b) => monthSortKey(a[0]) - monthSortKey(b[0]) || String(a[0]).localeCompare(String(b[0])))
            .map(([monthName, monthCourses]) => ({
              month: monthName,
              courses: monthCourses.sort((a, b) =>
                String(a.title || "").localeCompare(String(b.title || ""))
              ),
            })),
        }))
        .filter((roleNode) => !hideEmptyRoles || roleNode.months.length > 0),
    }))
    .filter((deptNode) => deptNode.roles.length > 0);
}

function RoadmapPanel({ providerNames, onProvidersChanged }) {
  const { options, departments, loading: frameworkLoading } = useOrgFrameworkOptions();
  const frameworkRoles = options?.roles || [];
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [allCourses, setAllCourses] = useState([]);
  const [filterDept, setFilterDept] = useState("");
  const [filterRole, setFilterRole] = useState("");
  const [filterMonth, setFilterMonth] = useState("");
  const [showManage, setShowManage] = useState(false);
  const [form, setForm] = useState(EMPTY_ROADMAP_FORM);
  const [preview, setPreview] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const fileInputRef = useRef(null);

  const rolesForFilter = frameworkRoles
    .filter((r) => !filterDept || (r.department || "").toLowerCase() === filterDept.toLowerCase())
    .slice()
    .sort(
      (a, b) =>
        String(a.department || "").localeCompare(String(b.department || "")) ||
        String(a.name || "").localeCompare(String(b.name || ""))
    );

  const monthOptions = Array.from(
    new Set([
      ...ROADMAP_MONTHS,
      ...allCourses
        .map((c) => String(c.learning_month || "").trim())
        .filter(Boolean),
    ])
  ).sort((a, b) => monthSortKey(a) - monthSortKey(b) || a.localeCompare(b));

  const orgTree = buildOrgRoadmapTree(frameworkRoles, allCourses, {
    department: filterDept,
    role: filterRole,
    month: filterMonth,
  });

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    listManagedCourses(token, {
      archived: false,
      sort_by: "title_asc",
      page: 1,
      page_size: 100,
      for_roadmap: true,
    })
      .then((courseData) => {
        // hierarchy includes all matching courses; flatten for org grouping
        const fromHierarchy = flattenRoadmapCourses(courseData.hierarchy || []);
        setAllCourses(fromHierarchy.length ? fromHierarchy : courseData.courses || []);
      })
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not load roadmap.")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function handleDownloadRoadmapTemplate() {
    try {
      downloadRoadmapTemplate({
        roles: frameworkRoles,
        departments,
      });
      if (!frameworkRoles.length) {
        toast.warn("No org roles found — add departments & roles in Organization Setup, then download again.");
      } else {
        toast.success(`Template ready with ${frameworkRoles.length} role(s) from Organization Setup.`);
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not download template."));
    }
  }

  function resetForm() {
    setForm({
      ...EMPTY_ROADMAP_FORM,
      provider: providerNames[0] || "",
      designation: filterRole || "",
    });
  }

  function beginEdit(course) {
    setShowManage(true);
    setForm({
      id: course.uid?.split(":")[1] || "",
      provider: course.provider || "",
      designation: course.designation || "",
      learning_month: course.learning_month || "",
      category: course.category || "",
      competency: course.competency || "",
      title: course.title || "",
      url: course.url || "",
      duration_minutes: course.duration_minutes || "",
      description: course.summary || "",
      archived: Boolean(course.archived),
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;
    if (!form.title.trim()) {
      toast.error("Course title is required.");
      return;
    }
    if (!form.designation.trim()) {
      toast.error("Select a role from Organization Setup.");
      return;
    }
    if (!form.learning_month.trim()) {
      toast.error("Select a learning month (Month 1–12).");
      return;
    }
    setSaving(true);
    const payload = {
      provider: (form.provider || "").trim() || "Managed Learning",
      designation: form.designation.trim(),
      learning_month: form.learning_month.trim(),
      category: form.category.trim(),
      competency: form.competency.trim(),
      title: form.title.trim(),
      url: form.url.trim() || undefined,
      description: form.description.trim() || undefined,
      duration_minutes: form.duration_minutes ? Number(form.duration_minutes) : null,
      archived: Boolean(form.archived),
    };
    try {
      if (form.id) {
        await updateManagedCourse(token, form.id, payload);
        toast.success("Roadmap placement saved.");
      } else {
        const providers = await listProviders(token, { include_inactive: false, page_size: 100 })
          .then((d) => d.providers || [])
          .catch(() => []);
        const match = providers.find(
          (p) => (p.name || "").toLowerCase() === payload.provider.toLowerCase()
        );
        if (match?.id) {
          await createImportCourse(token, {
            provider_id: match.id,
            title: payload.title,
            url: payload.url || null,
            description: payload.description || null,
            duration_minutes: payload.duration_minutes,
            designation: payload.designation,
            learning_month: payload.learning_month,
            category: payload.category,
            competency: payload.competency,
            archived: payload.archived,
          });
        } else {
          await createManagedCourse(token, payload);
        }
        toast.success("Course placed on roadmap.");
      }
      resetForm();
      load();
      onProvidersChanged?.();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not save roadmap course."));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(course) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    if (!window.confirm(`Remove "${course.title}" from the roadmap?`)) return;
    try {
      await deleteManagedCourse(token, course.uid.split(":")[1]);
      toast.success("Course removed.");
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not delete course."));
    }
  }

  async function handlePreviewUpload(uploadFile) {
    const token = localStorage.getItem("access_token");
    if (!token || !uploadFile) return;
    setPreviewBusy(true);
    setPreview(null);
    setPreviewFile(uploadFile);
    try {
      const data = await previewManagedImport(uploadFile, token);
      setPreview(data);
      toast.success(`Preview ready: ${data.total_rows || 0} rows.`);
    } catch (err) {
      setPreview(null);
      toast.error(getApiErrorMessage(err, "Could not preview roadmap import."));
    } finally {
      setPreviewBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleCommitImport() {
    const token = localStorage.getItem("access_token");
    if (!token || !previewFile) return;
    setSaving(true);
    try {
      const data = await commitManagedImport(previewFile, token);
      toast.success(data.message || "Roadmap imported.");
      setPreview(null);
      setPreviewFile(null);
      load();
      onProvidersChanged?.();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not import roadmap."));
    } finally {
      setSaving(false);
    }
  }

  const providerOptions = Array.from(new Set((providerNames || []).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );

  return (
    <div className={shellStyles.section}>
      <div className={shellStyles.sectionHead}>
        <div className={shellStyles.sectionHeadLeft}>
          <span className={`${shellStyles.bar} ${shellStyles.navy}`} />
          <div>
            <div className={shellStyles.sectionTitle}>Learning roadmap</div>
            <p className={shellStyles.sectionDesc}>
              Department → Role → Month → courses, aligned with Organization Setup.
            </p>
          </div>
        </div>
        <div className={styles.toolbar} style={{ marginBottom: 0 }}>
          <div className={styles.toolbarRight}>
            <button type="button" className={styles.modeBtn} onClick={load} title="Reload roadmap placements from the server">
              <RefreshCw aria-hidden="true" /> Reload
            </button>
            <button
              type="button"
              className={styles.modeBtn}
              onClick={() => {
                setShowManage((v) => !v);
                if (!showManage) resetForm();
              }}
            >
              <Plus aria-hidden="true" /> {showManage ? "Hide editor" : "Add / import placements"}
            </button>
          </div>
        </div>
      </div>

      <div className={shellStyles.sectionBody}>
        <div className={styles.filterBar}>
          <select
            className={styles.filterSelect}
            value={filterDept}
            onChange={(e) => {
              setFilterDept(e.target.value);
              setFilterRole("");
            }}
            aria-label="Filter by department"
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <select
            className={styles.filterSelect}
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
            aria-label="Filter by role"
          >
            <option value="">All roles</option>
            {rolesForFilter.map((r) => (
              <option key={`${r.department}::${r.name}`} value={r.name}>
                {r.department ? `${r.department} — ${r.name}` : r.name}
              </option>
            ))}
          </select>
          <select
            className={styles.filterSelect}
            value={filterMonth}
            onChange={(e) => setFilterMonth(e.target.value)}
            aria-label="Filter by month"
          >
            <option value="">All months</option>
            {monthOptions.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        {!frameworkLoading && !frameworkRoles.length && (
          <div className={styles.emptyState}>
            <div className={styles.emptyStateIcon}><Building2 aria-hidden="true" /></div>
            <div className={styles.emptyStateTitle}>Set up departments &amp; roles first</div>
            <p className={styles.emptyStateHint}>
              Add departments and roles in Organization Setup, then build this roadmap by month for each role.
            </p>
          </div>
        )}

        {frameworkRoles.length > 0 && !loading && orgTree.length === 0 && (
          <div className={styles.emptyState}>
            <div className={styles.emptyStateIcon}><FolderTree aria-hidden="true" /></div>
            <div className={styles.emptyStateTitle}>No roadmap for this filter</div>
            <p className={styles.emptyStateHint}>
              Clear filters, or add placements for these roles (manual or Excel template).
            </p>
          </div>
        )}

        {loading && <p className={styles.inlineNote}>Loading roadmap…</p>}

        {!loading &&
          orgTree.map((deptNode) => (
            <div key={deptNode.department} className={styles.hierarchyDept}>
              <div className={styles.hierarchyDeptTitle}>
                <Building2 aria-hidden="true" />
                {deptNode.department}
              </div>
              <div className={styles.hierarchyMonths}>
                {deptNode.roles.map((roleNode) => (
                  <div key={`${deptNode.department}::${roleNode.role}`} className={styles.hierarchyMonth}>
                    <div className={styles.hierarchyMonthTitle}>
                      <Briefcase aria-hidden="true" />
                      {roleNode.role}
                    </div>
                    {roleNode.months.length === 0 ? (
                      <p className={styles.inlineNote} style={{ margin: "4px 0 0" }}>
                        No courses placed yet for this role.
                      </p>
                    ) : (
                      roleNode.months.map((monthNode) => (
                        <div key={monthNode.month} style={{ marginTop: 10 }}>
                          <div className={styles.roadmapMonthHead}>
                            <Calendar aria-hidden="true" />
                            <span className={styles.roadmapMonthLabel}>{monthNode.month}</span>
                            <span className={styles.roadmapMonthCount}>
                              {monthNode.courses.length} course{monthNode.courses.length === 1 ? "" : "s"}
                            </span>
                          </div>
                          <div className={styles.roadmapCourseList}>
                            {monthNode.courses.map((course) => (
                              <div key={course.uid} className={styles.roadmapCourseRow}>
                                <div className={styles.roadmapCourseMain}>
                                  <div className={styles.roadmapCourseTitle}>{course.title}</div>
                                  <div className={styles.roadmapCourseMeta}>
                                    {[course.category, course.competency, course.provider, course.duration_minutes ? `${course.duration_minutes} min` : null]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </div>
                                </div>
                                <div className={styles.courseActions}>
                                  {course.url && (
                                    <a href={course.url} target="_blank" rel="noopener noreferrer" className={styles.smallBtn}>
                                      <Eye aria-hidden="true" /> Open
                                    </a>
                                  )}
                                  <button type="button" className={styles.smallBtn} onClick={() => beginEdit(course)}>
                                    <Pencil aria-hidden="true" /> Edit
                                  </button>
                                  <button type="button" className={styles.smallBtn} onClick={() => handleDelete(course)}>
                                    <Trash2 aria-hidden="true" /> Remove
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

        {showManage && (
          <div className={shellStyles.cols2} style={{ marginTop: 18 }}>
            <div className={shellStyles.section} style={{ margin: 0 }}>
              <div className={shellStyles.sectionHead}>
                <div className={shellStyles.sectionHeadLeft}>
                  <span className={`${shellStyles.bar} ${shellStyles.cyan}`} />
                  <div>
                    <div className={shellStyles.sectionTitle}>
                      {form.id ? "Edit placement" : "Place a course"}
                    </div>
                    <p className={shellStyles.sectionDesc}>
                      Pick an org role and month, then save the course on that path.
                    </p>
                  </div>
                </div>
              </div>
              <div className={shellStyles.sectionBody}>
                <form className={styles.managedForm} onSubmit={handleSubmit}>
                  <label className={styles.fieldLabel}>
                    Provider
                    <select
                      value={form.provider}
                      onChange={(e) => setForm((c) => ({ ...c, provider: e.target.value }))}
                    >
                      <option value="">Select provider</option>
                      {providerOptions.map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.fieldLabel}>
                    Role
                    <select
                      value={form.designation}
                      onChange={(e) => setForm((c) => ({ ...c, designation: e.target.value }))}
                      required
                    >
                      <option value="">Select role…</option>
                      {frameworkRoles
                        .slice()
                        .sort(
                          (a, b) =>
                            String(a.department || "").localeCompare(String(b.department || "")) ||
                            String(a.name || "").localeCompare(String(b.name || ""))
                        )
                        .map((r) => (
                          <option key={`${r.department}::${r.name}`} value={r.name}>
                            {r.department ? `${r.department} — ${r.name}` : r.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className={styles.fieldLabel}>
                    Learning month
                    <select
                      value={form.learning_month}
                      onChange={(e) => setForm((c) => ({ ...c, learning_month: e.target.value }))}
                      required
                    >
                      <option value="">Select month…</option>
                      {roadmapMonthOptions(form.learning_month).map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.fieldLabel}>
                    Category
                    <input
                      placeholder="e.g. Cloud"
                      value={form.category}
                      onChange={(e) => setForm((c) => ({ ...c, category: e.target.value }))}
                    />
                  </label>
                  <label className={styles.fieldLabel}>
                    Competency
                    <input
                      placeholder="e.g. Azure"
                      value={form.competency}
                      onChange={(e) => setForm((c) => ({ ...c, competency: e.target.value }))}
                    />
                  </label>
                  <label className={styles.fieldLabel}>
                    Duration (minutes)
                    <input
                      type="number"
                      min="1"
                      value={form.duration_minutes}
                      onChange={(e) => setForm((c) => ({ ...c, duration_minutes: e.target.value }))}
                    />
                  </label>
                  <label className={`${styles.fieldLabel} ${styles.wide}`}>
                    Course title
                    <input
                      value={form.title}
                      onChange={(e) => setForm((c) => ({ ...c, title: e.target.value }))}
                      required
                    />
                  </label>
                  <label className={`${styles.fieldLabel} ${styles.wide}`}>
                    Course URL
                    <input
                      value={form.url}
                      onChange={(e) => setForm((c) => ({ ...c, url: e.target.value }))}
                    />
                  </label>
                  <div className={styles.formActions}>
                    <button type="submit" className={styles.assignCourseBtn} disabled={saving}>
                      <Check aria-hidden="true" />
                      {saving ? "Saving…" : form.id ? "Update" : "Save to roadmap"}
                    </button>
                    <button type="button" className={styles.smallBtn} onClick={resetForm}>
                      <X aria-hidden="true" /> Clear
                    </button>
                  </div>
                </form>
              </div>
            </div>

            <div className={shellStyles.section} style={{ margin: 0 }}>
              <div className={shellStyles.sectionHead}>
                <div className={shellStyles.sectionHeadLeft}>
                  <span className={`${shellStyles.bar} ${shellStyles.orange}`} />
                  <div>
                    <div className={shellStyles.sectionTitle}>Import roadmap (Excel)</div>
                    <p className={shellStyles.sectionDesc}>
                      Template includes every department &amp; role from Organization Setup.
                    </p>
                  </div>
                </div>
              </div>
              <div className={shellStyles.sectionBody}>
                <div className={styles.formActions} style={{ marginBottom: 12 }}>
                  <button
                    type="button"
                    className={styles.assignCourseBtn}
                    onClick={handleDownloadRoadmapTemplate}
                    disabled={frameworkLoading}
                  >
                    <Download aria-hidden="true" />
                    {frameworkLoading ? "Loading…" : "Download roadmap template"}
                  </button>
                </div>
                {!preview && (
                  <label className={styles.fileDrop}>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.csv"
                      className={styles.fileDropInput}
                      onChange={(e) => handlePreviewUpload(e.target.files?.[0])}
                    />
                    <Upload className={styles.fileDropIcon} aria-hidden="true" />
                    <strong>Upload filled roadmap spreadsheet</strong>
                    <span>Designation must match Organization Setup roles</span>
                  </label>
                )}
                {previewBusy && <p className={styles.inlineNote} style={{ marginTop: 12 }}>Parsing…</p>}
                {preview && (
                  <div style={{ marginTop: 12 }}>
                    <div className={styles.importStats}>
                      <div className={styles.importStat}>
                        <div className={styles.importStatValue}>{preview.total_rows}</div>
                        <div className={styles.importStatLabel}>Rows</div>
                      </div>
                      <div className={styles.importStat}>
                        <div className={styles.importStatValue}>{preview.new_courses}</div>
                        <div className={styles.importStatLabel}>New</div>
                      </div>
                      <div className={styles.importStat}>
                        <div className={styles.importStatValue}>{preview.updated_courses}</div>
                        <div className={styles.importStatLabel}>Updated</div>
                      </div>
                      <div className={styles.importStat}>
                        <div className={styles.importStatValue}>{preview.invalid_rows}</div>
                        <div className={styles.importStatLabel}>Invalid</div>
                      </div>
                    </div>
                    <div className={styles.formActions}>
                      <button type="button" className={styles.assignCourseBtn} disabled={saving} onClick={handleCommitImport}>
                        <Check aria-hidden="true" /> {saving ? "Importing…" : "Confirm import"}
                      </button>
                      <button
                        type="button"
                        className={styles.smallBtn}
                        onClick={() => {
                          setPreview(null);
                          setPreviewFile(null);
                        }}
                      >
                        <X aria-hidden="true" /> Clear
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

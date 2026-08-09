"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import { getApiErrorMessage, listEmployees } from "@/services/authService";
import {
  getFrameworkSummary,
  listOrgDepartments,
  createOrgDepartment,
  updateOrgDepartment,
  deleteOrgDepartment,
  listOrgRoles,
  createOrgRole,
  updateOrgRole,
  deleteOrgRole,
  listOrgCourses,
  listOrgRoadmaps,
  createOrgRoadmap,
  updateOrgRoadmap,
  reorderOrgRoadmap,
  deleteOrgRoadmap,
  listOrgPromotionRules,
  upsertOrgPromotionRule,
  deleteOrgPromotionRule,
  listOrgVersions,
  createOrgVersion,
  exportOrgFramework,
  validateOrgFrameworkImport,
  applyOrgFrameworkImport,
  seedOrgFramework,
} from "@/services/orgFrameworkService";
import { bustOrgFrameworkCache } from "@/hooks/useOrgFrameworkOptions";
import { dispatchFrameworkInvalidated } from "@/lib/frameworkEvents";
import {
  BookOpen,
  Briefcase,
  Building2,
  Calendar,
  Check,
  ChevronDown,
  Clock,
  Compass,
  Download,
  Layers,
  Mail,
  Pencil,
  Plus,
  Route,
  Trash2,
  TrendingUp,
  Upload,
  Users,
  Zap,
} from "lucide-react";
import EmailTemplatesPanel from "./EmailTemplatesPanel";
import CatalogPicker, { CatalogTypeBadge, catalogTypeKey, courseCerts, courseSkills } from "./CatalogPicker";
import {
  clearRecruiterContext,
  publishRecruiterContext,
} from "@/lib/ai/recruiterContext";
import { ORG_CONFIG_TAB_HELP } from "@/lib/ai/recruiterFieldHelp";
import s from "./OrgFrameworkTab.module.css";

const SECTIONS = [
  { key: "overview", label: "Overview", icon: Compass },
  { key: "departments", label: "Departments", icon: Building2 },
  { key: "roles", label: "Role ladders", icon: Briefcase },
  { key: "career-roadmaps", label: "Career Roadmaps", icon: Route },
  { key: "promotion", label: "Promotion", icon: TrendingUp },
  { key: "emails", label: "Email Templates", icon: Mail },
];

export default function OrgFrameworkTab() {
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState("overview");

  const [summary, setSummary] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [roles, setRoles] = useState([]);
  const [courses, setCourses] = useState([]);
  const [roadmaps, setRoadmaps] = useState([]);
  const [promotionRules, setPromotionRules] = useState([]);
  const [versions, setVersions] = useState([]);

  const [importReport, setImportReport] = useState(null);
  const [applying, setApplying] = useState(false);
  const [importing, setImporting] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const fileRef = useRef(null);

  const token = () => localStorage.getItem("access_token");

  const handleSeed = async () => {
    if (!confirm("Create departments and roles from your existing employees, candidates, and recruiters? Their records will not be changed.")) return;
    setSeeding(true);
    try {
      const result = await seedOrgFramework(token());
      const created = (result.departments_created || []).length + (result.roles_created || []).length;
      if (created > 0) {
        toast.success(`Seeded ${result.departments_created.length} department(s) and ${result.roles_created.length} role(s) from existing records.`);
      } else {
        toast.info("Framework already covers all existing departments and roles.");
      }
      await loadAll();
      setSection("overview");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Seed failed."));
    } finally {
      setSeeding(false);
    }
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportReport(null);
    try {
      const report = await validateOrgFrameworkImport(token(), file);
      setImportReport(report);
      if (report.valid) {
        const importCounts = Object.entries(report.counts || {}).filter(([k]) => k !== "catalog_index");
        toast.success(`Validated: ${importCounts.reduce((a, [, b]) => a + b, 0)} items.`);
      } else {
        toast.error(`Validation failed with ${report.errors.length} issue(s).`);
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Import failed."));
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  const handleApply = async () => {
    if (!importReport?.data) return;
    setApplying(true);
    try {
      await applyOrgFrameworkImport(token(), importReport.data);
      toast.success("Framework imported.");
      setImportReport(null);
      await loadAll();
      setSection("overview");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Apply failed."));
    } finally {
      setApplying(false);
    }
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [sum, depts, rls, crss, rmps, rules, vers] = await Promise.all([
        getFrameworkSummary(token()),
        listOrgDepartments(token()),
        listOrgRoles(token()),
        listOrgCourses(token()),
        listOrgRoadmaps(token()),
        listOrgPromotionRules(token()),
        listOrgVersions(token()),
      ]);
      setSummary(sum);
      setDepartments(depts);
      setRoles(rls);
      setCourses(crss);
      setRoadmaps(rmps);
      setPromotionRules(rules);
      setVersions(vers);
      // The framework is the single source of truth for every module's
      // dropdowns — invalidate the shared cache so all pages pick up edits.
      bustOrgFrameworkCache();
      dispatchFrameworkInvalidated();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not load organization framework."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Retired tab — redirect if anything still deep-links to it.
  useEffect(() => {
    if (section === "career-tracks") setSection("roles");
  }, [section]);

  useEffect(() => {
    const help = ORG_CONFIG_TAB_HELP[section] || {};
    publishRecruiterContext({
      tab: section,
      section,
      hint: help.hint || null,
      fields: help.fields || [],
    });
    return () => clearRecruiterContext();
  }, [section]);

  const hasData = departments.length > 0 || roles.length > 0 || courses.length > 0;

  return (
    <div className={s.layout}>
      {/* Section sidebar */}
      <div className={s.sidebar}>
        <div className={s.sidebarHead}>
          <div className={s.sidebarTitle}>Organization Framework</div>
          <div className={s.sidebarHint}>Manage your organization structure</div>
        </div>
        <div className={s.deptList}>
          {SECTIONS.map((sec) => {
            const Icon = sec.icon;
            return (
              <button
                key={sec.key}
                type="button"
                className={`${s.deptItem} ${section === sec.key ? s.deptItemActive : ""}`}
                onClick={() => setSection(sec.key)}
              >
                <div className={s.deptItemIcon}>
                  <Icon aria-hidden="true" style={{ width: 16, height: 16 }} />
                </div>
                <div className={s.deptItemBody}>
                  <div className={s.deptItemName}>{sec.label}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main content */}
      <div className={s.content} style={{ padding: 28, overflowY: "auto" }}>
        <input ref={fileRef} type="file" accept=".xlsx" style={{ display: "none" }} onChange={handleFile} />
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading framework…</div>
        ) : !hasData && section === "overview" ? (
          <EmptyState
            onLoad={loadAll}
            onStart={() => setSection("departments")}
            onImport={() => fileRef.current?.click()}
            onSeed={handleSeed}
            seeding={seeding}
            importReport={importReport}
            applying={applying}
            onApply={(val) => { if (val === null) setImportReport(null); else handleApply(); }}
          />
        ) : section === "overview" ? (
          <OverviewSection summary={summary} departments={departments} roles={roles} courses={courses} versions={versions} loadAll={loadAll} onSeed={handleSeed} seeding={seeding} />
        ) : section === "departments" ? (
          <DepartmentsSection departments={departments} loadAll={loadAll} />
        ) : section === "roles" ? (
          <RolesSection roles={roles} departments={departments} loadAll={loadAll} />
        ) : section === "promotion" ? (
          <PromotionSection
            rules={promotionRules}
            roles={roles}
            loadAll={loadAll}
            onGoToRoles={() => setSection("roles")}
          />
        ) : section === "career-roadmaps" ? (
          <CareerRoadmapsSection roles={roles} roadmaps={roadmaps} loadAll={loadAll} />
        ) : section === "emails" ? (
          <EmailTemplatesPanel />
        ) : null}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════ //
   Empty State (no framework yet)
// ═══════════════════════════════════════════════════════════════════════════════ */

function EmptyState({ onLoad, onStart, onImport, onSeed, seeding, importReport, applying, onApply }) {
  const token = () => localStorage.getItem("access_token");
  const [exporting, setExporting] = useState(false);

  const handleDownloadTemplate = async () => {
    setExporting(true);
    try {
      const blob = await exportOrgFramework(token());
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "organization_framework_template.xlsx";
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Template downloaded.");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Download failed."));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 24px", textAlign: "center" }}>
      <div style={{ width: 64, height: 64, borderRadius: 18, background: "var(--blue-light)", color: "var(--blue-strong)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }}>
        <Layers style={{ width: 28, height: 28 }} />
      </div>
      <h3 style={{ fontSize: 18, fontWeight: 800, color: "var(--navy)", fontFamily: "'Sora', system-ui", margin: "0 0 8px" }}>Organization Framework Not Configured</h3>
      <p style={{ fontSize: 13.5, color: "var(--text-muted)", maxWidth: 520, lineHeight: 1.55, margin: "0 0 24px" }}>
        Download the Excel template and fill sheets in order: Departments → Career Roles → Career Roadmaps → Promotion Rules. Use Catalog Index to copy Course IDs, or put Course Name (+ Provider) and leave Course ID blank to resolve on import.
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={onSeed} disabled={seeding}>
          <Zap aria-hidden="true" /> {seeding ? "Building framework…" : "Auto-configure from existing employees"}
        </button>
        <button type="button" className={`${s.btn} ${s.btnSecondary}`} onClick={handleDownloadTemplate} disabled={exporting}>
          <Download aria-hidden="true" /> {exporting ? "Preparing…" : "Download Excel Template"}
        </button>
        <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={onImport}>
          <Upload aria-hidden="true" /> Import Organization Framework
        </button>
        <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={onStart}>
          Start From Scratch
        </button>
      </div>

      {importReport && (
        <div style={{ marginTop: 24, maxWidth: 640, width: "100%", border: `1px solid ${importReport.valid ? "var(--green)" : "var(--red)"}`, borderRadius: 14, padding: 16, background: importReport.valid ? "#f4fcf7" : "#fdf6f6", textAlign: "left" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 750, color: "var(--navy)", fontFamily: "'Sora', system-ui" }}>
              {importReport.valid ? "Validation passed" : "Validation Report"}
            </div>
            <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={() => onApply(null)}>Dismiss</button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            {Object.entries(importReport.counts || {})
              .filter(([k]) => k !== "catalog_index")
              .map(([k, v]) => (
              <span key={k} style={{ fontSize: 11.5, fontWeight: 700, color: "var(--navy-2)", background: "#fff", border: "1px solid var(--border)", borderRadius: 999, padding: "3px 10px" }}>
                {k.replace(/_/g, " ")}: {v}
              </span>
            ))}
          </div>
          {importReport.errors.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              {importReport.errors.map((e, i) => <div key={i} style={{ fontSize: 12.5, color: "var(--red)", marginBottom: 3 }}>• {e}</div>)}
            </div>
          )}
          {importReport.details?.length > 0 && (
            <div style={{ marginBottom: 8, maxHeight: 220, overflowY: "auto", borderTop: "1px solid rgba(185, 28, 28, 0.15)", paddingTop: 8 }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--navy)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>
                Exact location
              </div>
              {importReport.details.map((d, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12.5, marginBottom: 5 }}>
                  <span style={{ flexShrink: 0, fontFamily: "monospace", fontWeight: 700, color: "var(--red)", background: "#fdecec", borderRadius: 6, padding: "1px 7px" }}>
                    {d.sheet} · row {d.row} · {d.column}
                  </span>
                  <span style={{ color: "var(--navy)" }}>{d.reason}</span>
                </div>
              ))}
            </div>
          )}
          {importReport.warnings.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              {importReport.warnings.map((w, i) => <div key={i} style={{ fontSize: 12, color: "#a57500", marginBottom: 2 }}>• {w}</div>)}
            </div>
          )}
          {importReport.valid && (
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={onApply} disabled={applying}>
              <Check aria-hidden="true" /> {applying ? "Applying…" : "Apply Changes"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════ //
   Overview Section
// ═══════════════════════════════════════════════════════════════════════════════ */

function OverviewSection({ summary, departments, roles, courses, versions, loadAll, onSeed, seeding }) {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState(null);
  const [applying, setApplying] = useState(false);
  const fileRef = useRef(null);
  const token = () => localStorage.getItem("access_token");

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await exportOrgFramework(token());
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "organization_framework.xlsx";
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Framework exported.");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Export failed."));
    } finally {
      setExporting(false);
    }
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportReport(null);
    try {
      const report = await validateOrgFrameworkImport(token(), file);
      setImportReport(report);
      if (report.valid) {
        const importCounts = Object.entries(report.counts || {}).filter(([k]) => k !== "catalog_index");
        toast.success(`Validated: ${importCounts.reduce((a, [, b]) => a + b, 0)} items.`);
      } else {
        toast.error(`Validation failed with ${report.errors.length} issue(s).`);
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Import failed."));
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  const handleApply = async () => {
    if (!importReport?.data) return;
    setApplying(true);
    try {
      await applyOrgFrameworkImport(token(), importReport.data);
      toast.success("Framework imported.");
      setImportReport(null);
      await loadAll();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Apply failed."));
    } finally {
      setApplying(false);
    }
  };

  const stats = [
    { label: "Departments", value: summary?.departments || 0, icon: Building2, color: "cyan" },
    { label: "Roles", value: summary?.roles || 0, icon: Briefcase, color: "green" },
    { label: "Roadmap items", value: summary?.roadmaps || 0, icon: Route, color: "navy" },
    { label: "Promotion Rules", value: summary?.promotion_rules || 0, icon: TrendingUp, color: "green" },
    { label: "Employees", value: summary?.employees || 0, icon: Users, color: "orange" },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: "var(--navy)", fontFamily: "'Sora', system-ui", margin: 0 }}>
          Organization Framework Overview
        </h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className={`${s.btn} ${s.btnSecondary}`} onClick={onSeed} disabled={seeding}>
            <Zap aria-hidden="true" /> {seeding ? "Seeding…" : "Seed from existing records"}
          </button>
          <button type="button" className={`${s.btn} ${s.btnSecondary}`} onClick={handleExport} disabled={exporting}>
            <Download aria-hidden="true" /> {exporting ? "Exporting…" : "Export Excel"}
          </button>
          <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => fileRef.current?.click()} disabled={importing}>
            <Upload aria-hidden="true" /> {importing ? "Importing…" : "Import Excel"}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx" style={{ display: "none" }} onChange={handleFile} />
        </div>
      </div>

      {importReport && (
        <div style={{ border: `1px solid ${importReport.valid ? "var(--green)" : "var(--red)"}`, borderRadius: 14, padding: 16, marginBottom: 20, background: importReport.valid ? "#f4fcf7" : "#fdf6f6" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 750, color: "var(--navy)", fontFamily: "'Sora', system-ui" }}>
              {importReport.valid ? "✓ Validation passed" : "Validation Report"}
            </div>
            <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={() => setImportReport(null)}>Dismiss</button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            {Object.entries(importReport.counts || {})
              .filter(([k]) => k !== "catalog_index")
              .map(([k, v]) => (
              <span key={k} style={{ fontSize: 11.5, fontWeight: 700, color: "var(--navy-2)", background: "#fff", border: "1px solid var(--border)", borderRadius: 999, padding: "3px 10px" }}>
                {k.replace(/_/g, " ")}: {v}
              </span>
            ))}
          </div>
          {importReport.errors.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              {importReport.errors.map((e, i) => <div key={i} style={{ fontSize: 12.5, color: "var(--red)", marginBottom: 3 }}>• {e}</div>)}
            </div>
          )}
          {importReport.details?.length > 0 && (
            <div style={{ marginBottom: 8, maxHeight: 220, overflowY: "auto", borderTop: "1px solid rgba(185, 28, 28, 0.15)", paddingTop: 8 }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--navy)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>
                Exact location
              </div>
              {importReport.details.map((d, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12.5, marginBottom: 5 }}>
                  <span style={{ flexShrink: 0, fontFamily: "monospace", fontWeight: 700, color: "var(--red)", background: "#fdecec", borderRadius: 6, padding: "1px 7px" }}>
                    {d.sheet} · row {d.row} · {d.column}
                  </span>
                  <span style={{ color: "var(--navy)" }}>{d.reason}</span>
                </div>
              ))}
            </div>
          )}
          {importReport.warnings.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              {importReport.warnings.map((w, i) => <div key={i} style={{ fontSize: 12, color: "#a57500", marginBottom: 2 }}>• {w}</div>)}
            </div>
          )}
          {importReport.valid && (
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={handleApply} disabled={applying}>
              <Check aria-hidden="true" /> {applying ? "Applying…" : "Apply Changes"}
            </button>
          )}
        </div>
      )}
      <div className={s.analyticsGrid} style={{ marginBottom: 24 }}>
        {stats.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.label} className={s.kpiCard}>
              <div className={s.kpiTop}>
                <span className={`${s.kpiIcon} ${s[kpi.color]}`}><Icon aria-hidden="true" /></span>
              </div>
              <div className={s.kpiValue}>{kpi.value}</div>
              <div className={s.kpiLabel}>{kpi.label}</div>
            </div>
          );
        })}
      </div>

      {versions.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div className={s.sectionLabel}><Calendar aria-hidden="true" /> Version History</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {versions.slice(0, 5).map((v) => (
              <div key={v.version_id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", border: "1px solid var(--border)", borderRadius: 12, background: "#fff" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--blue-strong)", background: "var(--blue-light)", padding: "3px 8px", borderRadius: 999 }}>{v.version_id}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--navy)" }}>{v.label}</span>
                <span style={{ fontSize: 11.5, color: "var(--text-muted)", marginLeft: "auto" }}>{new Date(v.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {summary?.recent_updates?.length > 0 && (
        <div>
          <div className={s.sectionLabel}><Clock aria-hidden="true" /> Recently Updated</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {summary.recent_updates.map((r, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: "1px solid var(--border-soft)", borderRadius: 10, background: "#fbfcfe", fontSize: 13 }}>
                <span className={`${s.statusPill} ${s.blue}`}>{r.type}</span>
                <span style={{ fontWeight: 650, color: "var(--navy)" }}>{r.name}</span>
                {r.updated_at && <span style={{ fontSize: 11.5, color: "var(--text-muted)", marginLeft: "auto" }}>{new Date(r.updated_at).toLocaleDateString()}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════ //
   Entity CRUD Sections
// ═══════════════════════════════════════════════════════════════════════════════ */

function DepartmentsSection({ departments, loadAll }) {
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [editItem, setEditItem] = useState(null);
  const [busy, setBusy] = useState(false);
  const token = () => localStorage.getItem("access_token");

  const handleCreate = async () => {
    if (!formName.trim()) return;
    setBusy(true);
    try {
      await createOrgDepartment(token(), { name: formName.trim(), description: formDesc.trim() });
      toast.success("Department created.");
      setFormName(""); setFormDesc(""); setShowForm(false);
      await loadAll();
    } catch (err) { toast.error(getApiErrorMessage(err, "Failed.")); }
    finally { setBusy(false); }
  };

  const handleUpdate = async () => {
    if (!editItem || !formName.trim()) return;
    setBusy(true);
    try {
      await updateOrgDepartment(token(), editItem.name, { name: formName.trim(), description: formDesc.trim() });
      toast.success("Department updated.");
      setEditItem(null); setFormName(""); setFormDesc("");
      await loadAll();
    } catch (err) { toast.error(getApiErrorMessage(err, "Failed.")); }
    finally { setBusy(false); }
  };

  const handleDelete = async (name) => {
    if (!confirm(`Delete department "${name}"?`)) return;
    try { await deleteOrgDepartment(token(), name); toast.success("Deleted."); await loadAll(); }
    catch (err) { toast.error(getApiErrorMessage(err, "Failed.")); }
  };

  const startEdit = (d) => { setEditItem(d); setFormName(d.name); setFormDesc(d.description || ""); setShowForm(true); };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--navy)", fontFamily: "'Sora', system-ui", margin: 0 }}>Departments ({departments.length})</h2>
        <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => { setShowForm(true); setEditItem(null); setFormName(""); setFormDesc(""); }}>
          <Plus aria-hidden="true" /> Add Department
        </button>
      </div>
      {showForm && (
        <div data-partner-coach style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 18, marginBottom: 18, background: "#fafcfe" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--navy)", marginBottom: 12 }}>{editItem ? "Edit Department" : "New Department"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label className={s.fieldLabel} style={{ margin: 0 }}>Name<input data-field-key="department_name" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Engineering" /></label>
            <label className={s.fieldLabel} style={{ margin: 0 }}>Description<input data-field-key="description" value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="Optional" /></label>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy} onClick={editItem ? handleUpdate : handleCreate}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" className={`${s.btn} ${s.btnSecondary}`} onClick={() => { setShowForm(false); setEditItem(null); }}>Cancel</button>
          </div>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
        {departments.map((d) => (
          <div key={d.name} style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 16, background: "#fff", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: "var(--blue-light)", color: "var(--blue-strong)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800 }}>{d.name.slice(0, 2).toUpperCase()}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--navy)" }}>{d.name}</div>
                {d.description && <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{d.description}</div>}
              </div>
            </div>
            <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
              <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={() => startEdit(d)}><Pencil aria-hidden="true" style={{ width: 12, height: 12 }} /> Edit</button>
              <button type="button" className={`${s.btn} ${s.btnGhost}`} style={{ color: "var(--red)" }} onClick={() => handleDelete(d.name)}><Trash2 aria-hidden="true" style={{ width: 12, height: 12 }} /> Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Auto level: L1 = entry roles, then +1 along Promotes to (handles merges). */
function computeAutoLevels(deptRoles) {
  const byName = new Map(deptRoles.map((r) => [r.name, r]));
  const parents = {};
  for (const r of deptRoles) {
    const nxt = (r.next_role || "").trim();
    if (nxt && byName.has(nxt)) {
      if (!parents[nxt]) parents[nxt] = [];
      parents[nxt].push(r.name);
    }
  }
  const levels = new Map();
  const depth = (name, stack = new Set()) => {
    if (levels.has(name)) return levels.get(name);
    if (stack.has(name)) return 1;
    stack.add(name);
    const preds = parents[name] || [];
    const value = preds.length ? 1 + Math.max(...preds.map((p) => depth(p, stack))) : 1;
    stack.delete(name);
    levels.set(name, value);
    return value;
  };
  for (const r of deptRoles) depth(r.name);
  return levels;
}

/**
 * One connected ladder per component, layered by level so multiple roles
 * promoting into the same next role share one flow (no duplicate chains).
 */
function buildDepartmentLadderViews(deptRoles) {
  const byName = new Map(deptRoles.map((r) => [r.name, r]));
  const undirected = new Map(deptRoles.map((r) => [r.name, new Set()]));
  for (const r of deptRoles) {
    const nxt = (r.next_role || "").trim();
    if (nxt && byName.has(nxt)) {
      undirected.get(r.name).add(nxt);
      undirected.get(nxt).add(r.name);
    }
  }

  const visited = new Set();
  const components = [];
  for (const r of deptRoles) {
    if (visited.has(r.name)) continue;
    const queue = [r.name];
    const names = [];
    visited.add(r.name);
    while (queue.length) {
      const cur = queue.shift();
      names.push(cur);
      for (const n of undirected.get(cur) || []) {
        if (!visited.has(n)) {
          visited.add(n);
          queue.push(n);
        }
      }
    }
    components.push(names.map((n) => byName.get(n)).filter(Boolean));
  }

  const autoLevels = computeAutoLevels(deptRoles);
  return components
    .map((comp) => {
      const maxL = Math.max(0, ...comp.map((r) => autoLevels.get(r.name) || 1));
      const layers = [];
      for (let L = 1; L <= maxL; L++) {
        const layer = comp
          .filter((r) => (autoLevels.get(r.name) || 1) === L)
          .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        if (layer.length) layers.push(layer);
      }
      return { layers, autoLevels };
    })
    .sort((a, b) => {
      const aName = a.layers[0]?.[0]?.name || "";
      const bName = b.layers[0]?.[0]?.name || "";
      return aName.localeCompare(bName);
    });
}

function RolesSection({ roles, departments, loadAll }) {
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({ name: "", department: "", insert_after: "", description: "" });
  const [busy, setBusy] = useState(false);
  const token = () => localStorage.getItem("access_token");

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const peerInDept = (department, excludeRoleId, excludeName) =>
    roles.filter(
      (r) =>
        r.department === department &&
        (!excludeRoleId || r.role_id !== excludeRoleId) &&
        (!excludeName || r.name !== excludeName)
    );

  /** Preview / resolve next step when inserting after a role. */
  const resolveInsert = (department, insertAfter, selfName, selfCurrentNext) => {
    if (!insertAfter) {
      return { nextRole: selfCurrentNext || null, label: null };
    }
    const pred = roles.find((r) => r.department === department && r.name === insertAfter);
    if (!pred) return { nextRole: null, label: null };
    // If predecessor already points at this role, keep the existing next.
    const nextRole =
      pred.next_role && pred.next_role !== selfName ? pred.next_role : selfCurrentNext || null;
    const mid = selfName || "this role";
    const parts = [insertAfter, mid];
    if (nextRole) parts.push(nextRole);
    return { nextRole, label: parts.join(" → ") };
  };

  /**
   * Place `roleName` immediately after `insertAfter` (or unlink if empty).
   * Reconnects the old predecessor around the moved role so the ladder stays one chain.
   */
  const applyInsertPosition = async ({
    roleId,
    roleName,
    department,
    insertAfter,
    previousName,
    previousNext,
  }) => {
    const bridgeNext = previousNext || null;
    // Anyone who pointed at this role (except the new predecessor) now points at what this role used to promote to.
    const oldPointers = peerInDept(department).filter(
      (r) =>
        (r.next_role === previousName || r.next_role === roleName) &&
        r.name !== insertAfter &&
        r.role_id !== roleId
    );
    for (const p of oldPointers) {
      await updateOrgRole(token(), p.role_id, { next_role: bridgeNext });
    }

    if (!insertAfter) {
      await updateOrgRole(token(), roleId, {
        name: roleName,
        department,
        next_role: bridgeNext,
        description: form.description,
      });
      return;
    }

    const pred = roles.find((r) => r.department === department && r.name === insertAfter);
    if (!pred) {
      await updateOrgRole(token(), roleId, {
        name: roleName,
        department,
        next_role: bridgeNext,
        description: form.description,
      });
      return;
    }
    const inherited =
      pred.next_role && pred.next_role !== previousName && pred.next_role !== roleName
        ? pred.next_role
        : bridgeNext;

    await updateOrgRole(token(), roleId, {
      name: roleName,
      department,
      next_role: inherited,
      description: form.description,
    });
    if (pred.next_role !== roleName) {
      await updateOrgRole(token(), pred.role_id, { next_role: roleName });
    }
  };

  const handleCreate = async () => {
    if (!form.name.trim() || !form.department.trim()) return toast.error("Name and department required.");
    if (form.insert_after && form.insert_after === form.name.trim()) {
      return toast.error("A role cannot come after itself.");
    }
    setBusy(true);
    try {
      const { nextRole } = resolveInsert(form.department, form.insert_after, form.name.trim(), null);
      const created = await createOrgRole(token(), {
        name: form.name.trim(),
        department: form.department,
        next_role: nextRole,
        description: form.description,
      });
      if (form.insert_after) {
        const pred = roles.find((r) => r.department === form.department && r.name === form.insert_after);
        if (pred) await updateOrgRole(token(), pred.role_id, { next_role: form.name.trim() });
      }
      toast.success(
        form.insert_after
          ? `Added after ${form.insert_after}.`
          : created?.name
            ? "Role created."
            : "Role created."
      );
      setShowForm(false);
      resetForm();
      await loadAll();
    } catch (err) { toast.error(getApiErrorMessage(err, "Failed.")); }
    finally { setBusy(false); }
  };

  const handleUpdate = async () => {
    if (!editItem) return;
    if (form.insert_after && form.insert_after === form.name.trim()) {
      return toast.error("A role cannot come after itself.");
    }
    setBusy(true);
    try {
      await applyInsertPosition({
        roleId: editItem.role_id,
        roleName: form.name.trim(),
        department: form.department,
        insertAfter: form.insert_after || "",
        previousName: editItem.name,
        previousNext: editItem.next_role || null,
      });
      toast.success("Role updated.");
      setShowForm(false);
      resetForm();
      await loadAll();
    } catch (err) { toast.error(getApiErrorMessage(err, "Failed.")); }
    finally { setBusy(false); }
  };

  const handleDelete = async (roleId) => {
    if (!confirm("Delete this role?")) return;
    try { await deleteOrgRole(token(), roleId); toast.success("Deleted."); await loadAll(); }
    catch (err) { toast.error(getApiErrorMessage(err, "Failed.")); }
  };

  const resetForm = () => {
    setEditItem(null);
    setForm({ name: "", department: "", insert_after: "", description: "" });
  };
  const startEdit = (r) => {
    const predecessor = roles.find(
      (x) => x.department === r.department && x.next_role === r.name && x.role_id !== r.role_id
    );
    setEditItem(r);
    setForm({
      name: r.name,
      department: r.department,
      insert_after: predecessor?.name || "",
      description: r.description || "",
    });
    setShowForm(true);
  };

  const deptNames = [...new Set([...departments.map((d) => d.name), ...roles.map((r) => r.department).filter(Boolean)])].sort();
  const insertOptions = peerInDept(form.department, editItem?.role_id, form.name.trim() || null).sort(
    (a, b) => (a.level_number || 0) - (b.level_number || 0) || a.name.localeCompare(b.name)
  );

  const { nextRole: previewNext, label: pathPreview } = resolveInsert(
    form.department,
    form.insert_after,
    form.name.trim() || "…",
    editItem?.next_role || null
  );

  const byDept = {};
  [...roles]
    .sort((a, b) => (a.department || "").localeCompare(b.department || "") || (a.level_number || 0) - (b.level_number || 0))
    .forEach((r) => {
      const dept = r.department || "Unassigned";
      if (!byDept[dept]) byDept[dept] = [];
      byDept[dept].push(r);
    });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 18 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--navy)", fontFamily: "'Sora', system-ui", margin: 0 }}>
            Role ladders ({roles.length})
          </h2>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "6px 0 0", maxWidth: 580, lineHeight: 1.5 }}>
            Pick <strong>Add after</strong> — e.g. after Software Developer — and the next step is filled in for you.
          </p>
        </div>
        <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => { setShowForm(true); resetForm(); }}>
          <Plus aria-hidden="true" /> Add Role
        </button>
      </div>

      {showForm && (
        <div data-partner-coach style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 18, marginBottom: 18, background: "#fafcfe" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--navy)", marginBottom: 12 }}>{editItem ? "Edit Role" : "New Role"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            <label className={s.fieldLabel} style={{ margin: 0 }}>
              Role Name
              <input data-field-key="role_name" value={form.name} onChange={(e) => setField("name", e.target.value)} placeholder="e.g. Junior Developer" />
            </label>
            <label className={s.fieldLabel} style={{ margin: 0 }}>
              Department
              <select
                data-field-key="department"
                value={form.department}
                onChange={(e) => setForm((f) => ({ ...f, department: e.target.value, insert_after: "" }))}
              >
                <option value="">Select</option>
                {deptNames.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
          </div>
          <label className={s.fieldLabel} style={{ marginTop: 10, display: "block" }}>
            Add after
            <select
              data-field-key="insert_after"
              value={form.insert_after}
              onChange={(e) => setField("insert_after", e.target.value)}
              disabled={!form.department}
            >
              <option value="">Start of a new path (not after another role)</option>
              {insertOptions.map((r) => (
                <option key={r.role_id} value={r.name}>
                  {r.next_role
                    ? `After ${r.name}  →  inserts before ${r.next_role}`
                    : `After ${r.name}  →  becomes the next step`}
                </option>
              ))}
            </select>
            <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginTop: 4, fontWeight: 500 }}>
              {!form.department
                ? "Pick a department first"
                : form.insert_after
                  ? previewNext
                    ? `Result: ${form.insert_after} → ${form.name.trim() || "…"} → ${previewNext}`
                    : `Result: ${form.insert_after} → ${form.name.trim() || "…"} (end of path)`
                  : "Leave empty to start a separate path"}
            </span>
          </label>
          {pathPreview && (
            <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--navy)", fontWeight: 650 }}>
              {pathPreview}
            </div>
          )}
          <label className={s.fieldLabel} style={{ marginTop: 10, display: "block" }}>
            Description
            <input data-field-key="description" value={form.description} onChange={(e) => setField("description", e.target.value)} placeholder="Optional" />
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy} onClick={editItem ? handleUpdate : handleCreate}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" className={`${s.btn} ${s.btnSecondary}`} onClick={() => { setShowForm(false); resetForm(); }}>Cancel</button>
          </div>
        </div>
      )}

      {roles.length === 0 ? (
        <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-muted)", fontSize: 13.5 }}>
          No roles yet. Add departments first, then add roles and choose who they come after.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {Object.entries(byDept).map(([dept, deptRoles]) => {
            const views = buildDepartmentLadderViews(deptRoles);
            return (
              <div key={dept} className={s.ladderDept}>
                <div className={s.ladderDeptHead}>
                  <Building2 aria-hidden="true" style={{ width: 14, height: 14 }} />
                  {dept}
                  <span className={`${s.statusPill} ${s.neutral}`} style={{ fontSize: 10 }}>{deptRoles.length} roles</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {views.map((view, idx) => (
                    <div key={`${dept}-flow-${idx}`} className={s.ladderChain}>
                      {view.layers.map((layer, li) => (
                        <div key={`${dept}-L${li}`} className={s.ladderLayerWrap}>
                          {li > 0 && <span className={s.ladderArrow} aria-hidden="true">→</span>}
                          <div className={s.ladderLayer}>
                            {layer.map((r) => (
                              <div key={r.role_id} className={s.ladderNode}>
                                <span className={s.ladderName}>{r.name}</span>
                                <button type="button" className={`${s.btn} ${s.btnGhost}`} style={{ padding: 2, minHeight: "auto" }} onClick={() => startEdit(r)} title="Edit">
                                  <Pencil aria-hidden="true" style={{ width: 11, height: 11 }} />
                                </button>
                                <button type="button" className={`${s.btn} ${s.btnGhost}`} style={{ padding: 2, minHeight: "auto", color: "var(--red)" }} onClick={() => handleDelete(r.role_id)} title="Delete">
                                  <Trash2 aria-hidden="true" style={{ width: 11, height: 11 }} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                      {view.layers.length === 1 && view.layers[0].length === 1 && !view.layers[0][0].next_role && (
                        <span style={{ fontSize: 11, color: "var(--text-faint)", marginLeft: 4 }}>standalone — edit and choose Add after</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function empCountKey(department, roleName) {
  return `${(department || "").trim().toLowerCase()}::${(roleName || "").trim().toLowerCase()}`;
}

function findRuleForRole(rules, role) {
  const editable = (rules || []).filter((r) => r.source !== "career_levels");
  const dept = (role.department || "").trim().toLowerCase();
  const name = (role.name || "").trim().toLowerCase();
  return (
    editable.find(
      (r) =>
        (r.role_name || "").trim().toLowerCase() === name &&
        (r.department || "").trim().toLowerCase() === dept
    ) ||
    editable.find(
      (r) =>
        (r.role_name || "").trim().toLowerCase() === name &&
        !r.department
    ) ||
    null
  );
}

function PromotionSection({ rules, roles, loadAll, onGoToRoles }) {
  const [activeDept, setActiveDept] = useState("");
  const [editingKey, setEditingKey] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({
    department: "",
    role_name: "",
    min_experience_months: 12,
    required_readiness_pct: 80,
    manager_approval_required: true,
    min_skills_completed_pct: 100,
    min_certs_completed: 0,
  });
  const [busy, setBusy] = useState(false);
  const [empCounts, setEmpCounts] = useState({});
  const token = () => localStorage.getItem("access_token");
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const blankForm = (department = "") => ({
    department,
    role_name: "",
    min_experience_months: 12,
    required_readiness_pct: 80,
    manager_approval_required: true,
    min_skills_completed_pct: 100,
    min_certs_completed: 0,
  });

  const byDept = {};
  [...roles]
    .sort(
      (a, b) =>
        (a.department || "").localeCompare(b.department || "") ||
        (a.level_number || 0) - (b.level_number || 0) ||
        (a.name || "").localeCompare(b.name || "")
    )
    .forEach((r) => {
      const dept = r.department || "Unassigned";
      if (!byDept[dept]) byDept[dept] = [];
      byDept[dept].push(r);
    });
  const deptNames = Object.keys(byDept);

  useEffect(() => {
    if (!activeDept && deptNames.length) setActiveDept(deptNames[0]);
    else if (activeDept && deptNames.length && !deptNames.includes(activeDept)) {
      setActiveDept(deptNames[0] || "");
    }
  }, [activeDept, deptNames.join("|")]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await listEmployees(token(), { limit: 2000 });
        const list = Array.isArray(data) ? data : data?.employees || data?.items || [];
        const counts = {};
        for (const emp of list) {
          const key = empCountKey(emp.department, emp.job_title || emp.current_role);
          counts[key] = (counts[key] || 0) + 1;
        }
        if (!cancelled) setEmpCounts(counts);
      } catch {
        if (!cancelled) setEmpCounts({});
      }
    })();
    return () => { cancelled = true; };
  }, [roles.length]);

  const startEdit = (role, existing) => {
    setShowAddForm(false);
    setEditingKey(role.role_id);
    setForm({
      department: role.department || "",
      role_name: role.name,
      min_experience_months: existing?.min_experience_months ?? 12,
      required_readiness_pct: existing?.required_readiness_pct ?? 80,
      manager_approval_required: existing?.manager_approval_required ?? true,
      min_skills_completed_pct: existing?.min_skills_completed_pct ?? 100,
      min_certs_completed: existing?.min_certs_completed ?? 0,
    });
  };

  const startAdd = () => {
    if (!activeDept) return toast.error("Pick a department first.");
    setEditingKey(null);
    setForm(blankForm(activeDept));
    setShowAddForm(true);
  };

  const handleSave = async () => {
    if (!form.role_name.trim() || !form.department.trim()) {
      return toast.error("Department and role required.");
    }
    setBusy(true);
    try {
      await upsertOrgPromotionRule(token(), form);
      toast.success("Rule saved for this role.");
      setEditingKey(null);
      setShowAddForm(false);
      await loadAll();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed."));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (role) => {
    if (!confirm(`Remove readiness rule for ${role.name}?`)) return;
    try {
      await deleteOrgPromotionRule(token(), role.name, role.department);
      toast.success("Deleted.");
      if (editingKey === role.role_id) setEditingKey(null);
      await loadAll();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed."));
    }
  };

  if (roles.length === 0) {
    return (
      <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--text-muted)" }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: "var(--blue-light)", color: "var(--blue-strong)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
          <TrendingUp aria-hidden="true" style={{ width: 24, height: 24 }} />
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--navy)", fontFamily: "'Sora', system-ui", marginBottom: 8 }}>No roles yet</div>
        <p style={{ fontSize: 13.5, maxWidth: 460, margin: "0 auto", lineHeight: 1.55 }}>
          Build a <strong>Role ladder</strong> first (with Promotes to), then set readiness rules here per department.
        </p>
      </div>
    );
  }

  const deptRoles = byDept[activeDept] || [];
  const promotable = deptRoles.filter((r) => (r.next_role || "").trim());
  const topOfLadder = deptRoles.filter((r) => !(r.next_role || "").trim());
  const rulesInDept = promotable.filter((r) => findRuleForRole(rules, r)).length;

  const empTotal = deptRoles.reduce(
    (n, r) => n + (empCounts[empCountKey(r.department, r.name)] || 0),
    0
  );

  const rolesNeedingRules = promotable.filter((r) => !findRuleForRole(rules, r));
  const addRoleOptions = rolesNeedingRules.length ? rolesNeedingRules : promotable;

  return (
    <div>
      <div className={s.promoHeader}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--navy)", fontFamily: "'Sora', system-ui", margin: 0 }}>
            Promotion readiness
          </h2>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "6px 0 0", maxWidth: 560, lineHeight: 1.5 }}>
            Filter by department, then add a rule for each ladder step.
            Employees match by <strong>department + job title</strong>.
          </p>
        </div>
        <div className={s.promoHeaderActions}>
          <label className={s.promoFilter}>
            <Building2 aria-hidden="true" style={{ width: 14, height: 14, flexShrink: 0 }} />
            <span className={s.promoFilterLabel}>Department</span>
            <select
              data-field-key="filter_department"
              value={activeDept}
              onChange={(e) => {
                setActiveDept(e.target.value);
                setEditingKey(null);
                setShowAddForm(false);
              }}
            >
              {deptNames.map((dept) => (
                <option key={dept} value={dept}>{dept}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={`${s.btn} ${s.btnPrimary}`}
            onClick={startAdd}
            disabled={!activeDept || promotable.length === 0}
            title={promotable.length === 0 ? "Set Promotes to on Role ladders first" : "Add a promotion rule"}
          >
            <Plus aria-hidden="true" /> Add rule
          </button>
        </div>
      </div>

      {activeDept && (
        <div className={s.promoDeptSummary}>
          <span className={`${s.statusPill} ${s.neutral}`} style={{ fontSize: 10 }}>
            {rulesInDept}/{promotable.length} rules set
          </span>
          <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
            {empTotal} employee{empTotal === 1 ? "" : "s"} matched in {activeDept}
          </span>
        </div>
      )}

      {showAddForm && (
        <div className={s.promoRuleForm} data-partner-coach style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--navy)", marginBottom: 12 }}>
            Add promotion rule — {activeDept}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 12 }}>
            <label className={s.fieldLabel} style={{ margin: 0 }}>
              Role (promotes to next)
              <select
                data-field-key="role_name"
                value={form.role_name}
                onChange={(e) => {
                  const name = e.target.value;
                  const role = promotable.find((r) => r.name === name);
                  const existing = role ? findRuleForRole(rules, role) : null;
                  setForm((f) => ({
                    ...f,
                    role_name: name,
                    department: activeDept,
                    min_experience_months: existing?.min_experience_months ?? 12,
                    required_readiness_pct: existing?.required_readiness_pct ?? 80,
                    manager_approval_required: existing?.manager_approval_required ?? true,
                    min_skills_completed_pct: existing?.min_skills_completed_pct ?? 100,
                    min_certs_completed: existing?.min_certs_completed ?? 0,
                  }));
                }}
              >
                <option value="">Select role</option>
                {addRoleOptions.map((r) => (
                  <option key={r.role_id} value={r.name}>
                    {r.name} → {r.next_role}
                    {findRuleForRole(rules, r) ? " (update)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className={s.fieldLabel} style={{ margin: 0 }}>
              Min time in role (months)
              <input
                data-field-key="min_experience_months"
                type="number"
                min="0"
                value={form.min_experience_months}
                onChange={(e) => setField("min_experience_months", parseInt(e.target.value) || 0)}
              />
            </label>
            <label className={s.fieldLabel} style={{ margin: 0 }}>
              Roadmap readiness %
              <input
                data-field-key="required_readiness_pct"
                type="number"
                min="0"
                max="100"
                value={form.required_readiness_pct}
                onChange={(e) => setField("required_readiness_pct", parseInt(e.target.value) || 0)}
              />
            </label>
          </div>
          <label className={s.cfCheckRow} style={{ marginTop: 12 }}>
            <input
              data-field-key="manager_approval_required"
              type="checkbox"
              checked={form.manager_approval_required}
              onChange={(e) => setField("manager_approval_required", e.target.checked)}
            />
            Manager approval required
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy} onClick={handleSave}>
              {busy ? "Saving…" : "Save rule"}
            </button>
            <button
              type="button"
              className={`${s.btn} ${s.btnSecondary}`}
              onClick={() => { setShowAddForm(false); setForm(blankForm(activeDept)); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {deptRoles.length === 0 ? (
        <div className={s.promoEmpty}>
          No roles in <strong>{activeDept}</strong> yet. Add roles in <strong>Role ladders</strong> first.
          {typeof onGoToRoles === "function" && (
            <div style={{ marginTop: 14 }}>
              <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={onGoToRoles}>
                Open Role ladders
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className={s.promoRoleList}>
          {promotable.length === 0 && (
            <div className={s.promoHint}>
              These roles exist, but none have a <strong>Promotes to</strong> link yet — so there is nowhere to promote.
              Open <strong>Role ladders</strong>, edit the role, and set the next title (e.g. Software Developer → Senior Software Developer).
              {typeof onGoToRoles === "function" && (
                <button type="button" className={`${s.btn} ${s.btnPrimary}`} style={{ marginTop: 12 }} onClick={onGoToRoles}>
                  Fix in Role ladders
                </button>
              )}
            </div>
          )}

          {promotable.map((role) => {
            const existing = findRuleForRole(rules, role);
            const people = empCounts[empCountKey(role.department, role.name)] || 0;
            const isEditing = editingKey === role.role_id;
            return (
              <div key={role.role_id} className={s.promoRoleCard} data-partner-coach={isEditing ? true : undefined}>
                <div className={s.promoRoleHead}>
                  <div>
                    <div className={s.promoRoleTitle}>
                      {role.name}
                      <span className={s.ladderArrow} aria-hidden="true">→</span>
                      <span style={{ fontWeight: 600, color: "var(--text-muted)" }}>{role.next_role}</span>
                    </div>
                    <div className={s.promoRoleMeta}>
                      <Users aria-hidden="true" style={{ width: 12, height: 12 }} />
                      {people === 0
                        ? "No employees with this title yet"
                        : `${people} employee${people === 1 ? "" : "s"} in this role`}
                      {existing ? (
                        <span className={`${s.statusPill} ${s.green}`} style={{ fontSize: 10 }}>Rule set</span>
                      ) : (
                        <span className={`${s.statusPill} ${s.neutral}`} style={{ fontSize: 10 }}>No rule</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    {!isEditing && (
                      <button
                        type="button"
                        className={`${s.btn} ${s.btnSecondary}`}
                        style={{ fontSize: 12, padding: "6px 10px" }}
                        onClick={() => startEdit(role, existing)}
                      >
                        {existing ? "Edit rule" : "Set rule"}
                      </button>
                    )}
                    {existing && !isEditing && (
                      <button
                        type="button"
                        className={`${s.btn} ${s.btnGhost}`}
                        style={{ color: "var(--red)" }}
                        onClick={() => handleDelete(role)}
                        title="Remove rule"
                      >
                        <Trash2 aria-hidden="true" style={{ width: 12, height: 12 }} />
                      </button>
                    )}
                  </div>
                </div>

                {!isEditing && existing && (
                  <div className={s.promoRuleSummary}>
                    <span><Clock aria-hidden="true" style={{ width: 12, height: 12 }} /> {existing.min_experience_months} mo in role</span>
                    <span><Route aria-hidden="true" style={{ width: 12, height: 12 }} /> {existing.required_readiness_pct}% roadmap</span>
                    <span>
                      {existing.manager_approval_required ? "Manager approval required" : "No manager approval"}
                    </span>
                  </div>
                )}

                {isEditing && (
                  <div className={s.promoRuleForm}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
                      <label className={s.fieldLabel} style={{ margin: 0 }}>
                        Min time in role (months)
                        <input
                          data-field-key="min_experience_months"
                          type="number"
                          min="0"
                          value={form.min_experience_months}
                          onChange={(e) => setField("min_experience_months", parseInt(e.target.value) || 0)}
                        />
                      </label>
                      <label className={s.fieldLabel} style={{ margin: 0 }}>
                        Roadmap readiness %
                        <input
                          data-field-key="required_readiness_pct"
                          type="number"
                          min="0"
                          max="100"
                          value={form.required_readiness_pct}
                          onChange={(e) => setField("required_readiness_pct", parseInt(e.target.value) || 0)}
                        />
                        <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginTop: 4, fontWeight: 500 }}>
                          % of {role.name} Career Roadmap completed
                        </span>
                      </label>
                    </div>
                    <label className={s.cfCheckRow} style={{ marginTop: 12 }}>
                      <input
                        data-field-key="manager_approval_required"
                        type="checkbox"
                        checked={form.manager_approval_required}
                        onChange={(e) => setField("manager_approval_required", e.target.checked)}
                      />
                      Manager approval required
                    </label>
                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                      <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy} onClick={handleSave}>
                        {busy ? "Saving…" : "Save rule"}
                      </button>
                      <button type="button" className={`${s.btn} ${s.btnSecondary}`} onClick={() => setEditingKey(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {topOfLadder.map((role) => {
            const people = empCounts[empCountKey(role.department, role.name)] || 0;
            return (
              <div key={role.role_id} className={`${s.promoRoleCard} ${s.promoRoleBlocked}`}>
                <div className={s.promoRoleHead}>
                  <div>
                    <div className={s.promoRoleTitle}>
                      {role.name}
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-faint)" }}>· no next role</span>
                    </div>
                    <div className={s.promoRoleMeta}>
                      <Users aria-hidden="true" style={{ width: 12, height: 12 }} />
                      {people === 0
                        ? "No employees with this title yet"
                        : `${people} employee${people === 1 ? "" : "s"} in this role`}
                      <span className={`${s.statusPill} ${s.neutral}`} style={{ fontSize: 10 }}>Needs Promotes to</span>
                    </div>
                    <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.45 }}>
                      Add another role in this department (or pick an existing one), then set <strong>Promotes to</strong> on {role.name}.
                    </p>
                  </div>
                  {typeof onGoToRoles === "function" && (
                    <button type="button" className={`${s.btn} ${s.btnSecondary}`} style={{ fontSize: 12, padding: "6px 10px" }} onClick={onGoToRoles}>
                      Role ladders
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CareerRoadmapsSection({ roles, roadmaps, loadAll }) {
  const grouped = {};
  [...roles]
    .sort(
      (a, b) =>
        (a.department || "").localeCompare(b.department || "") ||
        (a.level_number || 0) - (b.level_number || 0) ||
        (a.name || "").localeCompare(b.name || "")
    )
    .forEach((r) => {
      const dept = r.department || "Unassigned";
      if (!grouped[dept]) grouped[dept] = [];
      grouped[dept].push(r);
    });

  if (roles.length === 0) {
    return (
      <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--text-muted)" }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: "var(--blue-light)", color: "var(--blue-strong)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
          <Route aria-hidden="true" style={{ width: 24, height: 24 }} />
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--navy)", fontFamily: "'Sora', system-ui", marginBottom: 8 }}>No roles yet</div>
        <p style={{ fontSize: 13.5, maxWidth: 460, margin: "0 auto", lineHeight: 1.55 }}>
          Add roles in the <strong>Roles</strong> tab first — then build each role&apos;s learning path from your catalog here.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--navy)", fontFamily: "'Sora', system-ui", margin: 0 }}>
          Career Roadmaps ({roles.length} roles)
        </h2>
        <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
          Modules, learning paths, courses, and certifications from your catalogs
        </span>
      </div>
      {Object.entries(grouped).map(([dept, deptRoles]) => (
        <div key={dept} className={s.deptGroup}>
          <div className={s.deptGroupTitle}>
            <span>{dept}</span>
            <span>{deptRoles.length} role{deptRoles.length > 1 ? "s" : ""}</span>
          </div>
          {deptRoles.map((role) => (
            <RoleCard
              key={role.role_id}
              role={role}
              roleCourses={roadmaps.filter((r) => r.role_name === role.name)}
              loadAll={loadAll}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function RoleCard({ role, roleCourses, loadAll }) {
  const [open, setOpen] = useState(true);
  const certCount = roleCourses.filter((c) => catalogTypeKey(c) === "certification").length;

  return (
    <div className={s.roleCard} data-partner-coach>
      <button type="button" className={s.roleCardHead} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className={s.roleCardTitle}>{role.name}</div>
          <div className={s.roleCardMeta}>
            {role.department}
            {role.next_role ? ` · Promotes to ${role.next_role}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className={`${s.statusPill} ${s.neutral}`}>
            {roleCourses.length} item{roleCourses.length === 1 ? "" : "s"}
            {certCount > 0 ? ` · ${certCount} cert${certCount === 1 ? "" : "s"}` : ""}
          </span>
          <ChevronDown aria-hidden="true" style={{ width: 16, height: 16, color: "var(--text-muted)", transform: open ? "none" : "rotate(-90deg)", transition: "transform .15s var(--ease)" }} />
        </div>
      </button>
      {open && (
        <div>
          <RoleCoursesBlock roleName={role.name} entries={roleCourses} loadAll={loadAll} />
        </div>
      )}
    </div>
  );
}

function RoleCoursesBlock({ roleName, entries, loadAll }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const token = () => localStorage.getItem("access_token");

  const sorted = [...entries].sort((a, b) => (a.order || 0) - (b.order || 0));

  const handleCreate = async (course) => {
    if (!course || !course.uid) return;
    setBusy(true);
    try {
      await createOrgRoadmap(token(), {
        role_name: roleName,
        course_id: course.uid,
        course_name: course.title,
        catalog_type: course.type || null,
        category: course.category || null,
        competency: course.competency || null,
        skills: courseSkills(course),
        certifications: courseCerts(course),
        mandatory: true,
      });
      toast.success(
        catalogTypeKey(course) === "certification"
          ? `"${course.title}" added (certification).`
          : `"${course.title}" added to roadmap.`
      );
      await loadAll();
    } catch (err) { toast.error(getApiErrorMessage(err, "Failed.")); }
    finally { setBusy(false); }
  };

  const handleDelete = async (roadmapId) => {
    if (!confirm("Remove from roadmap?")) return;
    try { await deleteOrgRoadmap(token(), roadmapId); toast.success("Removed."); await loadAll(); }
    catch (err) { toast.error(getApiErrorMessage(err, "Failed.")); }
  };

  const handleToggleMandatory = async (entry) => {
    if (!entry?.roadmap_id || busy) return;
    setBusy(true);
    try {
      await updateOrgRoadmap(token(), entry.roadmap_id, { mandatory: !entry.mandatory });
      toast.success(entry.mandatory ? "Marked optional." : "Marked mandatory.");
      await loadAll();
    } catch (err) { toast.error(getApiErrorMessage(err, "Failed.")); }
    finally { setBusy(false); }
  };

  const handleReorder = async (orderedIds) => {
    setBusy(true);
    try { await reorderOrgRoadmap(token(), roleName, orderedIds); toast.success("Order updated."); await loadAll(); }
    catch (err) { toast.error(getApiErrorMessage(err, "Reorder failed.")); }
    finally { setBusy(false); }
  };

  const moveEntry = async (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= sorted.length) return;
    const next = [...sorted];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    await handleReorder(next.map((e) => e.roadmap_id));
  };

  return (
    <div className={s.roleBlock}>
      <div className={s.roleBlockHead}>
        <div className={s.roleBlockLabel}><BookOpen aria-hidden="true" /> Learning path (in order)</div>
        <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={() => setPickerOpen(true)}>
          <Plus aria-hidden="true" style={{ width: 12, height: 12 }} /> Add from catalog
        </button>
      </div>
      {sorted.length === 0 ? (
        <span style={{ fontSize: 12.5, color: "var(--text-faint)" }}>
          No catalog items yet — filter by type (module, path, course, cert) and add from your catalogs.
        </span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {sorted.map((r, index) => {
            const fromCareer = r.source === "career_levels";
            const skills = courseSkills(r);
            const certs = courseCerts({ ...r, title: r.course_name || r.title });
            return (
              <div key={r.roadmap_id || `${r.role_name}-${r.course_name || r.course_id}-${index}`} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 12px", border: "1px solid var(--border-soft)", borderRadius: 10, background: fromCareer ? "#f8fafb" : "#fbfcfe", fontSize: 13 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: "var(--text-faint)", minWidth: 22, paddingTop: 2 }}>{index + 1}.</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 650, color: "var(--navy)" }}>{r.course_name || r.course_id}</div>
                  {(skills.length > 0 || certs.length > 0) && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 }}>
                      {skills.slice(0, 3).map((skill) => (
                        <span key={skill} className={`${s.statusPill} ${s.green}`} style={{ fontSize: 9 }}>{skill}</span>
                      ))}
                      {certs.slice(0, 2).map((cert) => (
                        <span key={cert} className={`${s.statusPill} ${s.orange}`} style={{ fontSize: 9 }}>{cert}</span>
                      ))}
                    </div>
                  )}
                </div>
                <CatalogTypeBadge item={r} />
                {!fromCareer ? (
                  <button
                    type="button"
                    className={`${s.statusPill} ${r.mandatory ? s.blue : s.neutral}`}
                    style={{ fontSize: 10, cursor: busy ? "wait" : "pointer", border: "none" }}
                    disabled={busy}
                    onClick={() => handleToggleMandatory(r)}
                    title={r.mandatory ? "Click to make optional" : "Click to make mandatory"}
                  >
                    {r.mandatory ? "Mandatory" : "Optional"}
                  </button>
                ) : (
                  r.mandatory && <span className={`${s.statusPill} ${s.blue}`} style={{ fontSize: 10 }}>Mandatory</span>
                )}
                {fromCareer && <span className={`${s.statusPill} ${s.orange}`} style={{ fontSize: 10 }}>Career Level</span>}
                <div style={{ display: "flex", gap: 2 }}>
                  {!fromCareer && (
                    <>
                      <button type="button" className={`${s.btn} ${s.btnGhost}`} style={{ padding: 2, minHeight: "auto" }} disabled={busy || index === 0} onClick={() => moveEntry(index, -1)} aria-label="Move up">↑</button>
                      <button type="button" className={`${s.btn} ${s.btnGhost}`} style={{ padding: 2, minHeight: "auto" }} disabled={busy || index === sorted.length - 1} onClick={() => moveEntry(index, 1)} aria-label="Move down">↓</button>
                      <button type="button" className={`${s.btn} ${s.btnGhost}`} style={{ padding: 2, minHeight: "auto" }} onClick={() => handleDelete(r.roadmap_id)}>
                        <Trash2 aria-hidden="true" style={{ width: 11, height: 11, color: "var(--red)" }} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {pickerOpen && (
        <CatalogPicker
          title={`Add to roadmap — ${roleName}`}
          onClose={() => setPickerOpen(false)}
          isAdded={(c) => sorted.some((e) => e.course_id === c.uid)}
          pickLabel="Add"
          onPick={handleCreate}
        />
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import { getApiErrorMessage } from "@/services/authService";
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
  listOrgSkills,
  createOrgSkill,
  updateOrgSkill,
  deleteOrgSkill,
  listOrgCertifications,
  createOrgCertification,
  updateOrgCertification,
  deleteOrgCertification,
  listOrgCourses,
  createOrgCourse,
  updateOrgCourse,
  deleteOrgCourse,
  listOrgRoadmaps,
  createOrgRoadmap,
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
  Award,
  BookOpen,
  Briefcase,
  Building2,
  Calendar,
  Check,
  Clock,
  Compass,
  Download,
  Layers,
  Mail,
  Pencil,
  Plus,
  Target,
  Trash2,
  TrendingUp,
  Upload,
  Users,
  Zap,
} from "lucide-react";
import CareerTracksPanel from "../organization-config/CareerTracksPanel";
import EmailTemplatesPanel from "./EmailTemplatesPanel";
import {
  clearRecruiterContext,
  publishRecruiterContext,
} from "@/lib/ai/recruiterContext";
import { ORG_CONFIG_TAB_HELP } from "@/lib/ai/recruiterFieldHelp";
import s from "./OrgFrameworkTab.module.css";

const SECTIONS = [
  { key: "overview", label: "Overview", icon: Compass },
  { key: "departments", label: "Departments", icon: Building2 },
  { key: "roles", label: "Roles", icon: Briefcase },
  { key: "skills", label: "Skills", icon: Zap },
  { key: "courses", label: "Courses", icon: BookOpen },
  { key: "certifications", label: "Certs", icon: Award },
  { key: "roadmaps", label: "Roadmaps", icon: Compass },
  { key: "promotion", label: "Promotion", icon: TrendingUp },
  { key: "career-tracks", label: "Career tracks", icon: Target },
  { key: "emails", label: "Email Templates", icon: Mail },
];

export default function OrgFrameworkTab() {
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState("overview");

  const [summary, setSummary] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [roles, setRoles] = useState([]);
  const [skills, setSkills] = useState([]);
  const [certifications, setCertifications] = useState([]);
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
        toast.success(`Validated: ${Object.values(report.counts).reduce((a, b) => a + b, 0)} items.`);
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
      const [sum, depts, rls, sks, certs, crss, rmps, rules, vers] = await Promise.all([
        getFrameworkSummary(token()),
        listOrgDepartments(token()),
        listOrgRoles(token()),
        listOrgSkills(token()),
        listOrgCertifications(token()),
        listOrgCourses(token()),
        listOrgRoadmaps(token()),
        listOrgPromotionRules(token()),
        listOrgVersions(token()),
      ]);
      setSummary(sum);
      setDepartments(depts);
      setRoles(rls);
      setSkills(sks);
      setCertifications(certs);
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
        ) : section === "skills" ? (
          <SkillsSection skills={skills} roles={roles} loadAll={loadAll} />
        ) : section === "courses" ? (
          <CoursesSection courses={courses} loadAll={loadAll} />
        ) : section === "certifications" ? (
          <CertsSection certifications={certifications} roles={roles} loadAll={loadAll} />
        ) : section === "roadmaps" ? (
          <RoadmapsSection roadmaps={roadmaps} roles={roles} courses={courses} loadAll={loadAll} />
        ) : section === "promotion" ? (
          <PromotionSection rules={promotionRules} roles={roles} loadAll={loadAll} />
        ) : section === "career-tracks" ? (
          <CareerTracksPanel departments={departments} />
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
      <p style={{ fontSize: 13.5, color: "var(--text-muted)", maxWidth: 460, lineHeight: 1.55, margin: "0 0 24px" }}>
        Set up your organization's career structure by importing an Excel template or building it manually. Everything you configure here automatically applies to all employees.
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
            {Object.entries(importReport.counts).map(([k, v]) => (
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
        toast.success(`Validated: ${Object.values(report.counts).reduce((a, b) => a + b, 0)} items.`);
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
    { label: "Skills Defined", value: summary?.skills || 0, icon: Zap, color: "orange" },
    { label: "Courses", value: summary?.courses || 0, icon: BookOpen, color: "navy" },
    { label: "Certifications", value: summary?.certifications || 0, icon: Award, color: "purple" },
    { label: "Learning Paths", value: summary?.roadmaps || 0, icon: Compass, color: "cyan" },
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
            {Object.entries(importReport.counts).map(([k, v]) => (
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

function RolesSection({ roles, departments, loadAll }) {
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({ name: "", department: "", next_role: "", level_number: 1, description: "" });
  const [busy, setBusy] = useState(false);
  const token = () => localStorage.getItem("access_token");

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleCreate = async () => {
    if (!form.name.trim() || !form.department.trim()) return toast.error("Name and department required.");
    setBusy(true);
    try { await createOrgRole(token(), form); toast.success("Role created."); setShowForm(false); resetForm(); await loadAll(); }
    catch (err) { toast.error(getApiErrorMessage(err, "Failed.")); }
    finally { setBusy(false); }
  };

  const handleUpdate = async () => {
    if (!editItem) return;
    setBusy(true);
    try { await updateOrgRole(token(), editItem.role_id, form); toast.success("Role updated."); setShowForm(false); resetForm(); await loadAll(); }
    catch (err) { toast.error(getApiErrorMessage(err, "Failed.")); }
    finally { setBusy(false); }
  };

  const handleDelete = async (roleId) => {
    if (!confirm("Delete this role?")) return;
    try { await deleteOrgRole(token(), roleId); toast.success("Deleted."); await loadAll(); }
    catch (err) { toast.error(getApiErrorMessage(err, "Failed.")); }
  };

  const resetForm = () => { setEditItem(null); setForm({ name: "", department: "", next_role: "", level_number: 1, description: "" }); };
  const startEdit = (r) => { setEditItem(r); setForm({ name: r.name, department: r.department, next_role: r.next_role || "", level_number: r.level_number || 1, description: r.description || "" }); setShowForm(true); };

  const deptNames = [...new Set([...departments.map((d) => d.name), ...roles.map((r) => r.department)])].sort();

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--navy)", fontFamily: "'Sora', system-ui", margin: 0 }}>Roles ({roles.length})</h2>
        <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => { setShowForm(true); resetForm(); }}>
          <Plus aria-hidden="true" /> Add Role
        </button>
      </div>
      {showForm && (
        <div data-partner-coach style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 18, marginBottom: 18, background: "#fafcfe" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--navy)", marginBottom: 12 }}>{editItem ? "Edit Role" : "New Role"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <label className={s.fieldLabel} style={{ margin: 0 }}>Role Name<input data-field-key="role_name" value={form.name} onChange={(e) => setField("name", e.target.value)} placeholder="e.g. Solution Engineer" /></label>
            <label className={s.fieldLabel} style={{ margin: 0 }}>Department<select data-field-key="department" value={form.department} onChange={(e) => setField("department", e.target.value)}><option value="">Select</option>{deptNames.map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
            <label className={s.fieldLabel} style={{ margin: 0 }}>Career Level<input data-field-key="level_number" type="number" min="1" value={form.level_number} onChange={(e) => setField("level_number", parseInt(e.target.value) || 1)} /></label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12, marginTop: 8 }}>
            <label className={s.fieldLabel} style={{ margin: 0 }}>Next Role<input data-field-key="next_role" value={form.next_role} onChange={(e) => setField("next_role", e.target.value)} placeholder="Promotion target role" /></label>
            <label className={s.fieldLabel} style={{ margin: 0 }}>Description<input data-field-key="description" value={form.description} onChange={(e) => setField("description", e.target.value)} placeholder="Description" /></label>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy} onClick={editItem ? handleUpdate : handleCreate}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" className={`${s.btn} ${s.btnSecondary}`} onClick={() => { setShowForm(false); resetForm(); }}>Cancel</button>
          </div>
        </div>
      )}
      <div className={s.tableContainer}>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th>Role</th><th>Department</th><th>Level</th><th>Next Role</th><th style={{ textAlign: "right" }}>Actions</th></tr></thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.role_id}>
                  <td style={{ fontWeight: 650, color: "var(--navy)" }}>{r.name}</td>
                  <td><span className={`${s.statusPill} ${s.blue}`}>{r.department}</span></td>
                  <td>L{r.level_number}</td>
                  <td style={{ color: "var(--text-muted)" }}>{r.next_role || "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={() => startEdit(r)}><Pencil aria-hidden="true" style={{ width: 12, height: 12 }} /></button>
                    <button type="button" className={`${s.btn} ${s.btnGhost}`} style={{ color: "var(--red)" }} onClick={() => handleDelete(r.role_id)}><Trash2 aria-hidden="true" style={{ width: 12, height: 12 }} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SkillsSection({ skills, roles, loadAll }) {
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({ role_name: "", skill_name: "", proficiency: "Intermediate", weight: 20 });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const token = () => localStorage.getItem("access_token");
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const roleNames = [...new Set(roles.map((r) => r.name))].sort();

  const validateForm = () => {
    if (!form.role_name.trim()) return "Role is required.";
    if (!form.skill_name.trim()) return "Skill name is required.";
    const weight = Number(form.weight);
    if (!Number.isInteger(weight) || weight < 1 || weight > 100) return "Weight must be a whole number between 1 and 100.";
    return "";
  };

  const handleSave = async () => {
    const error = validateForm();
    if (error) return setFormError(error);
    setBusy(true);
    setFormError("");
    try {
      if (editItem) {
        await updateOrgSkill(token(), editItem.skill_id, {
          skill_name: form.skill_name.trim(),
          proficiency: form.proficiency,
          weight: Number(form.weight),
        });
        toast.success("Skill updated.");
      } else {
        await createOrgSkill(token(), { ...form, skill_name: form.skill_name.trim(), weight: Number(form.weight) });
        toast.success("Skill added.");
      }
      setShowForm(false);
      setEditItem(null);
      setForm({ role_name: "", skill_name: "", proficiency: "Intermediate", weight: 20 });
      await loadAll();
    } catch (err) { toast.error(getApiErrorMessage(err, "Failed.")); }
    finally { setBusy(false); }
  };

  const handleDelete = async (skillId) => {
    if (!confirm("Delete this skill?")) return;
    try { await deleteOrgSkill(token(), skillId); toast.success("Deleted."); await loadAll(); }
    catch (err) { toast.error(getApiErrorMessage(err, "Failed.")); }
  };

  const startEdit = (sk) => {
    setEditItem(sk);
    setForm({ role_name: sk.role_name, skill_name: sk.skill_name, proficiency: sk.proficiency || "Intermediate", weight: sk.weight || 20 });
    setShowForm(true);
    setFormError("");
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--navy)", fontFamily: "'Sora', system-ui", margin: 0 }}>Skills ({skills.length})</h2>
        <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => { setShowForm(true); setEditItem(null); setForm({ role_name: "", skill_name: "", proficiency: "Intermediate", weight: 20 }); setFormError(""); }}><Plus aria-hidden="true" /> Add Skill</button>
      </div>
      {showForm && (
        <div data-partner-coach style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 18, marginBottom: 18, background: "#fafcfe" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--navy)", marginBottom: 12 }}>{editItem ? "Edit Skill" : "New Skill"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <label className={s.fieldLabel} style={{ margin: 0 }}>Role<select data-field-key="role_name" value={form.role_name} onChange={(e) => setField("role_name", e.target.value)} disabled={!!editItem}><option value="">Select</option>{roleNames.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
            <label className={s.fieldLabel} style={{ margin: 0 }}>Skill<input data-field-key="skill_name" value={form.skill_name} onChange={(e) => setField("skill_name", e.target.value)} placeholder="e.g. Python" /></label>
            <label className={s.fieldLabel} style={{ margin: 0 }}>Proficiency<select data-field-key="proficiency" value={form.proficiency} onChange={(e) => setField("proficiency", e.target.value)}><option>Beginner</option><option>Intermediate</option><option>Advanced</option><option>Expert</option></select></label>
            <label className={s.fieldLabel} style={{ margin: 0 }}>Weight<input data-field-key="weight" type="number" min="1" max="100" value={form.weight} onChange={(e) => setField("weight", e.target.value)} /></label>
          </div>
          {formError && <div style={{ fontSize: 12.5, color: "var(--red)", marginTop: 8 }}>{formError}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy} onClick={handleSave}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" className={`${s.btn} ${s.btnSecondary}`} onClick={() => { setShowForm(false); setEditItem(null); }}>Cancel</button>
          </div>
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {skills.map((sk) => {
          const isEmployeeSkill = sk.source === "employee_skills";
          return (
            <div key={sk.skill_id || `${sk.role_name}-${sk.skill_name}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", border: "1px solid var(--border)", borderRadius: 12, background: isEmployeeSkill ? "#f8fafb" : "#fff" }}>
              <span style={{ fontSize: 12.5, fontWeight: 650, color: "var(--navy)" }}>{sk.skill_name}</span>
              <span className={`${s.statusPill} ${s.blue}`} style={{ fontSize: 10 }}>{sk.role_name}</span>
              <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{sk.proficiency}{isEmployeeSkill && sk.employee_count ? ` · ${sk.employee_count} employee${sk.employee_count > 1 ? "s" : ""}` : ` · w:${sk.weight}`}</span>
              {!isEmployeeSkill && (
                <>
                  <button type="button" className={`${s.btn} ${s.btnGhost}`} style={{ padding: 2, minHeight: "auto" }} onClick={() => startEdit(sk)}>
                    <Pencil aria-hidden="true" style={{ width: 11, height: 11 }} />
                  </button>
                  <button type="button" className={`${s.btn} ${s.btnGhost}`} style={{ padding: 2, minHeight: "auto" }} onClick={() => handleDelete(sk.skill_id || `${sk.organization_id}:${sk.role_name}:${sk.skill_name}`)}>
                    <Trash2 aria-hidden="true" style={{ width: 11, height: 11, color: "var(--red)" }} />
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CoursesSection({ courses, loadAll }) {
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({ name: "", provider: "", category: "", duration_hours: "", difficulty: "Beginner", url: "", description: "" });
  const [busy, setBusy] = useState(false);
  const token = () => localStorage.getItem("access_token");
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error("Course name required.");
    setBusy(true);
    try {
      if (editItem) { await updateOrgCourse(token(), editItem.course_id, form); toast.success("Updated."); }
      else { await createOrgCourse(token(), form); toast.success("Created."); }
      setShowForm(false); resetForm(); await loadAll();
    } catch (err) { toast.error(getApiErrorMessage(err, "Failed.")); }
    finally { setBusy(false); }
  };

  const handleDelete = async (courseId) => {
    if (!confirm("Delete this course?")) return;
    try { await deleteOrgCourse(token(), courseId); toast.success("Deleted."); await loadAll(); }
    catch (err) { toast.error(getApiErrorMessage(err, "Failed.")); }
  };

  const resetForm = () => { setEditItem(null); setForm({ name: "", provider: "", category: "", duration_hours: "", difficulty: "Beginner", url: "", description: "" }); };
  const startEdit = (c) => { setEditItem(c); setForm({ name: c.name, provider: c.provider || "", category: c.category || "", duration_hours: c.duration_hours || "", difficulty: c.difficulty || "Beginner", url: c.url || "", description: c.description || "" }); setShowForm(true); };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--navy)", fontFamily: "'Sora', system-ui", margin: 0 }}>Course Catalog ({courses.length})</h2>
        <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => { setShowForm(true); resetForm(); }}><Plus aria-hidden="true" /> Add Course</button>
      </div>
      {showForm && (
        <div data-partner-coach style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 18, marginBottom: 18, background: "#fafcfe" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--navy)", marginBottom: 12 }}>{editItem ? "Edit Course" : "New Course"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <label className={s.fieldLabel} style={{ margin: 0 }}>Name<input data-field-key="course_name" value={form.name} onChange={(e) => setField("name", e.target.value)} placeholder="Course name" /></label>
            <label className={s.fieldLabel} style={{ margin: 0 }}>Provider<input data-field-key="provider" value={form.provider} onChange={(e) => setField("provider", e.target.value)} placeholder="e.g. Microsoft Learn" /></label>
            <label className={s.fieldLabel} style={{ margin: 0 }}>Category<input data-field-key="course_category" value={form.category} onChange={(e) => setField("category", e.target.value)} placeholder="e.g. Programming" /></label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 8 }}>
            <label className={s.fieldLabel} style={{ margin: 0 }}>Duration (hours)<input data-field-key="duration_hours" value={form.duration_hours} onChange={(e) => setField("duration_hours", e.target.value)} placeholder="e.g. 10" /></label>
            <label className={s.fieldLabel} style={{ margin: 0 }}>Difficulty<select data-field-key="difficulty" value={form.difficulty} onChange={(e) => setField("difficulty", e.target.value)}><option>Beginner</option><option>Intermediate</option><option>Advanced</option><option>Expert</option></select></label>
            <label className={s.fieldLabel} style={{ margin: 0 }}>URL (optional)<input data-field-key="url" value={form.url} onChange={(e) => setField("url", e.target.value)} placeholder="https://…" /></label>
          </div>
          <label className={s.fieldLabel} style={{ margin: "8px 0 0" }}>Description<textarea data-field-key="description" rows={2} value={form.description} onChange={(e) => setField("description", e.target.value)} placeholder="Course description" style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 10, padding: 8, fontSize: 13, fontFamily: "inherit" }} /></label>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy} onClick={handleSave}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" className={`${s.btn} ${s.btnSecondary}`} onClick={() => { setShowForm(false); resetForm(); }}>Cancel</button>
          </div>
        </div>
      )}
      <div className={s.tableContainer}>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th>Course</th><th>Provider</th><th>Category</th><th>Duration</th><th>Difficulty</th><th style={{ textAlign: "right" }}>Actions</th></tr></thead>
            <tbody>
              {courses.map((c) => (
                <tr key={c.course_id}>
                  <td style={{ fontWeight: 650, color: "var(--navy)" }}>{c.name}<div style={{ fontSize: 11, color: "var(--text-muted)" }}>{c.course_id}</div></td>
                  <td>{c.provider || "—"}</td>
                  <td><span className={`${s.statusPill} ${s.blue}`}>{c.category || "—"}</span></td>
                  <td>{c.duration_hours ? `${c.duration_hours}h` : "—"}</td>
                  <td><span className={`${s.statusPill} ${s.neutral}`}>{c.difficulty}</span></td>
                  <td style={{ textAlign: "right" }}>
                    <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={() => startEdit(c)}><Pencil aria-hidden="true" style={{ width: 12, height: 12 }} /></button>
                    <button type="button" className={`${s.btn} ${s.btnGhost}`} style={{ color: "var(--red)" }} onClick={() => handleDelete(c.course_id)}><Trash2 aria-hidden="true" style={{ width: 12, height: 12 }} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CertsSection({ certifications, roles, loadAll }) {
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({ role_name: "", certification_name: "", mandatory: true, expiration_months: "" });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const token = () => localStorage.getItem("access_token");
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const roleNames = [...new Set(roles.map((r) => r.name))].sort();

  const validateForm = () => {
    if (!form.role_name.trim()) return "Role is required.";
    if (!form.certification_name.trim()) return "Certification name is required.";
    if (form.expiration_months !== "" && form.expiration_months != null) {
      const months = Number(form.expiration_months);
      if (!Number.isInteger(months) || months < 1) return "Expiration must be a positive number of months.";
    }
    return "";
  };

  const handleSave = async () => {
    const error = validateForm();
    if (error) return setFormError(error);
    setBusy(true);
    setFormError("");
    const payload = {
      certification_name: form.certification_name.trim(),
      mandatory: form.mandatory,
      expiration_months: form.expiration_months === "" ? null : Number(form.expiration_months),
    };
    try {
      if (editItem) {
        await updateOrgCertification(token(), editItem.cert_id, payload);
        toast.success("Certification updated.");
      } else {
        await createOrgCertification(token(), { ...form, certification_name: form.certification_name.trim(), expiration_months: form.expiration_months === "" ? null : Number(form.expiration_months) });
        toast.success("Added.");
      }
      setShowForm(false);
      setEditItem(null);
      setForm({ role_name: "", certification_name: "", mandatory: true, expiration_months: "" });
      await loadAll();
    } catch (err) { toast.error(getApiErrorMessage(err, "Failed.")); }
    finally { setBusy(false); }
  };

  const handleDelete = async (certId) => {
    if (!confirm("Delete?")) return;
    try { await deleteOrgCertification(token(), certId); toast.success("Deleted."); await loadAll(); }
    catch (err) { toast.error(getApiErrorMessage(err, "Failed.")); }
  };

  const startEdit = (c) => {
    setEditItem(c);
    setForm({ role_name: c.role_name, certification_name: c.certification_name, mandatory: !!c.mandatory, expiration_months: c.expiration_months ?? "" });
    setShowForm(true);
    setFormError("");
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--navy)", fontFamily: "'Sora', system-ui", margin: 0 }}>Certifications ({certifications.length})</h2>
        <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => { setShowForm(true); setEditItem(null); setForm({ role_name: "", certification_name: "", mandatory: true, expiration_months: "" }); setFormError(""); }}><Plus aria-hidden="true" /> Add Certification</button>
      </div>
      {showForm && (
        <div data-partner-coach style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 18, marginBottom: 18, background: "#fafcfe" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--navy)", marginBottom: 12 }}>{editItem ? "Edit Certification" : "New Certification"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <label className={s.fieldLabel} style={{ margin: 0 }}>Role<select data-field-key="role_name" value={form.role_name} onChange={(e) => setField("role_name", e.target.value)} disabled={!!editItem}><option value="">Select</option>{roleNames.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
            <label className={s.fieldLabel} style={{ margin: 0 }}>Certification<input data-field-key="certification_name" value={form.certification_name} onChange={(e) => setField("certification_name", e.target.value)} placeholder="e.g. AZ-900" /></label>
            <label className={s.fieldLabel} style={{ margin: 0 }}>Expiration (months)<input data-field-key="expiration_months" value={form.expiration_months} onChange={(e) => setField("expiration_months", e.target.value)} placeholder="Optional" /></label>
          </div>
          <label className={s.cfCheckRow} style={{ marginTop: 8 }}><input data-field-key="mandatory" type="checkbox" checked={form.mandatory} onChange={(e) => setField("mandatory", e.target.checked)} /> Mandatory</label>
          {formError && <div style={{ fontSize: 12.5, color: "var(--red)", marginTop: 8 }}>{formError}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy} onClick={handleSave}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" className={`${s.btn} ${s.btnSecondary}`} onClick={() => { setShowForm(false); setEditItem(null); }}>Cancel</button>
          </div>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
        {certifications.map((c) => {
          const isEmployeeCert = c.source === "learning_certificates";
          return (
            <div key={c.cert_id || `${c.role_name}-${c.certification_name}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", border: "1px solid var(--border)", borderRadius: 12, background: isEmployeeCert ? "#f8fafb" : "#fff" }}>
              <span style={{ fontSize: 13, fontWeight: 650, color: "var(--navy)", flex: 1 }}>{c.certification_name}</span>
              <span className={`${s.statusPill} ${s.orange}`}>{c.role_name}</span>
              {c.mandatory && <span className={`${s.statusPill} ${s.red}`}>Mandatory</span>}
              {isEmployeeCert && c.employee_count ? <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{c.employee_count} earned</span> : null}
              {!isEmployeeCert && (
                <>
                  <button type="button" className={`${s.btn} ${s.btnGhost}`} style={{ padding: 2, minHeight: "auto" }} onClick={() => startEdit(c)}>
                    <Pencil aria-hidden="true" style={{ width: 11, height: 11 }} />
                  </button>
                  <button type="button" className={`${s.btn} ${s.btnGhost}`} style={{ padding: 2, minHeight: "auto" }} onClick={() => handleDelete(c.cert_id)}>
                    <Trash2 aria-hidden="true" style={{ width: 11, height: 11, color: "var(--red)" }} />
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RoadmapsSection({ roadmaps, roles, courses, loadAll }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ role_name: "", course_id: "", mandatory: true });
  const [busy, setBusy] = useState(false);
  const token = () => localStorage.getItem("access_token");
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const roleNames = [...new Set(roles.map((r) => r.name))].sort();

  const handleCreate = async () => {
    if (!form.role_name.trim() || !form.course_id.trim()) return toast.error("Role and course required.");
    setBusy(true);
    try { await createOrgRoadmap(token(), { ...form, course_name: courses.find((c) => c.course_id === form.course_id)?.name || form.course_id }); toast.success("Added."); setShowForm(false); setForm({ role_name: "", course_id: "", mandatory: true }); await loadAll(); }
    catch (err) { toast.error(getApiErrorMessage(err, "Failed.")); }
    finally { setBusy(false); }
  };

  const handleDelete = async (roadmapId) => {
    if (!confirm("Remove from roadmap?")) return;
    try { await deleteOrgRoadmap(token(), roadmapId); toast.success("Removed."); await loadAll(); }
    catch (err) { toast.error(getApiErrorMessage(err, "Failed.")); }
  };

  const handleReorder = async (roleName, orderedIds) => {
    setBusy(true);
    try { await reorderOrgRoadmap(token(), roleName, orderedIds); toast.success("Order updated."); await loadAll(); }
    catch (err) { toast.error(getApiErrorMessage(err, "Reorder failed.")); }
    finally { setBusy(false); }
  };

  const moveEntry = async (roleName, entries, index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= entries.length) return;
    const next = [...entries];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    await handleReorder(roleName, next.map((e) => e.roadmap_id));
  };

  const groupedByRole = {};
  roadmaps.forEach((r) => { if (!groupedByRole[r.role_name]) groupedByRole[r.role_name] = []; groupedByRole[r.role_name].push(r); });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--navy)", fontFamily: "'Sora', system-ui", margin: 0 }}>Learning Roadmaps ({roadmaps.length} entries)</h2>
        <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => setShowForm(true)}><Plus aria-hidden="true" /> Add to Roadmap</button>
      </div>
      {showForm && (
        <div data-partner-coach style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 18, marginBottom: 18, background: "#fafcfe" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--navy)", marginBottom: 12 }}>Add Course to Roadmap</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 12, alignItems: "end" }}>
            <label className={s.fieldLabel} style={{ margin: 0 }}>Role<select data-field-key="role_name" value={form.role_name} onChange={(e) => setField("role_name", e.target.value)}><option value="">Select</option>{roleNames.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
            <label className={s.fieldLabel} style={{ margin: 0 }}>Course<select data-field-key="course_id" value={form.course_id} onChange={(e) => setField("course_id", e.target.value)}><option value="">Select</option>{courses.map((c) => <option key={c.course_id} value={c.course_id}>{c.name}</option>)}</select></label>
            <label className={s.cfCheckRow}><input data-field-key="mandatory" type="checkbox" checked={form.mandatory} onChange={(e) => setField("mandatory", e.target.checked)} /> Mandatory</label>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy} onClick={handleCreate}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" className={`${s.btn} ${s.btnSecondary}`} onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}
      {Object.entries(groupedByRole).map(([roleName, entries]) => {
        const sorted = [...entries].sort((a, b) => (a.order || 0) - (b.order || 0));
        return (
          <div key={roleName} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 750, color: "var(--navy)", fontFamily: "'Sora', system-ui", marginBottom: 8 }}>{roleName}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {sorted.map((r, index) => (
                <div key={r.roadmap_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: "1px solid var(--border-soft)", borderRadius: 10, background: "#fbfcfe", fontSize: 13 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: "var(--text-faint)", minWidth: 22 }}>{index + 1}.</span>
                  <span style={{ fontWeight: 650, color: "var(--navy)", flex: 1 }}>{r.course_name || r.course_id}</span>
                  {r.mandatory && <span className={`${s.statusPill} ${s.blue}`} style={{ fontSize: 10 }}>Mandatory</span>}
                  <div style={{ display: "flex", gap: 2 }}>
                    <button type="button" className={`${s.btn} ${s.btnGhost}`} style={{ padding: 2, minHeight: "auto" }} disabled={busy || index === 0} onClick={() => moveEntry(roleName, sorted, index, -1)} aria-label="Move up">
                      ↑
                    </button>
                    <button type="button" className={`${s.btn} ${s.btnGhost}`} style={{ padding: 2, minHeight: "auto" }} disabled={busy || index === sorted.length - 1} onClick={() => moveEntry(roleName, sorted, index, 1)} aria-label="Move down">
                      ↓
                    </button>
                    <button type="button" className={`${s.btn} ${s.btnGhost}`} style={{ padding: 2, minHeight: "auto" }} onClick={() => handleDelete(r.roadmap_id)}>
                      <Trash2 aria-hidden="true" style={{ width: 11, height: 11, color: "var(--red)" }} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PromotionSection({ rules, roles, loadAll }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ role_name: "", min_experience_months: 12, required_readiness_pct: 80, manager_approval_required: true, min_skills_completed_pct: 100, min_certs_completed: 0 });
  const [busy, setBusy] = useState(false);
  const token = () => localStorage.getItem("access_token");
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const roleNames = [...new Set(roles.map((r) => r.name))].sort();

  const handleSave = async () => {
    if (!form.role_name.trim()) return toast.error("Role required.");
    setBusy(true);
    try { await upsertOrgPromotionRule(token(), form); toast.success("Saved."); setShowForm(false); await loadAll(); }
    catch (err) { toast.error(getApiErrorMessage(err, "Failed.")); }
    finally { setBusy(false); }
  };

  const handleDelete = async (roleName) => {
    if (!confirm("Delete promotion rule?")) return;
    try { await deleteOrgPromotionRule(token(), roleName); toast.success("Deleted."); await loadAll(); }
    catch (err) { toast.error(getApiErrorMessage(err, "Failed.")); }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--navy)", fontFamily: "'Sora', system-ui", margin: 0 }}>Promotion Rules ({rules.length})</h2>
        <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => setShowForm(true)}><Plus aria-hidden="true" /> Add Rule</button>
      </div>
      {showForm && (
        <div data-partner-coach style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 18, marginBottom: 18, background: "#fafcfe" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--navy)", marginBottom: 12 }}>Promotion Rule</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <label className={s.fieldLabel} style={{ margin: 0 }}>Role<select data-field-key="role_name" value={form.role_name} onChange={(e) => setField("role_name", e.target.value)}><option value="">Select</option>{roleNames.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
            <label className={s.fieldLabel} style={{ margin: 0 }}>Min Experience (months)<input data-field-key="min_experience_months" type="number" min="0" value={form.min_experience_months} onChange={(e) => setField("min_experience_months", parseInt(e.target.value) || 0)} /></label>
            <label className={s.fieldLabel} style={{ margin: 0 }}>Required Readiness %<input data-field-key="required_readiness_pct" type="number" min="0" max="100" value={form.required_readiness_pct} onChange={(e) => setField("required_readiness_pct", parseInt(e.target.value) || 0)} /></label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 8 }}>
            <label className={s.fieldLabel} style={{ margin: 0 }}>Min Skills %<input data-field-key="min_skills_completed_pct" type="number" min="0" max="100" value={form.min_skills_completed_pct} onChange={(e) => setField("min_skills_completed_pct", parseInt(e.target.value) || 0)} /></label>
            <label className={s.fieldLabel} style={{ margin: 0 }}>Min Certs Completed<input data-field-key="min_certs_completed" type="number" min="0" value={form.min_certs_completed} onChange={(e) => setField("min_certs_completed", parseInt(e.target.value) || 0)} /></label>
            <label className={s.cfCheckRow} style={{ marginTop: 22 }}><input data-field-key="manager_approval_required" type="checkbox" checked={form.manager_approval_required} onChange={(e) => setField("manager_approval_required", e.target.checked)} /> Manager Approval Required</label>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy} onClick={handleSave}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" className={`${s.btn} ${s.btnSecondary}`} onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}
      <div className={s.tableContainer}>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th>Role</th><th>Min Experience</th><th>Readiness %</th><th>Skills %</th><th>Min Certs</th><th>Manager Approval</th><th style={{ textAlign: "right" }}>Actions</th></tr></thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.role_name}>
                  <td style={{ fontWeight: 650, color: "var(--navy)" }}>{r.role_name}</td>
                  <td>{r.min_experience_months}mo</td>
                  <td>{r.required_readiness_pct}%</td>
                  <td>{r.min_skills_completed_pct}%</td>
                  <td>{r.min_certs_completed}</td>
                  <td>{r.manager_approval_required ? <span className={`${s.statusPill} ${s.green}`}>Required</span> : <span className={`${s.statusPill} ${s.neutral}`}>Not required</span>}</td>
                  <td style={{ textAlign: "right" }}>
                    <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={() => { setForm({ role_name: r.role_name, min_experience_months: r.min_experience_months, required_readiness_pct: r.required_readiness_pct, manager_approval_required: r.manager_approval_required, min_skills_completed_pct: r.min_skills_completed_pct || 100, min_certs_completed: r.min_certs_completed || 0 }); setShowForm(true); }}><Pencil aria-hidden="true" style={{ width: 12, height: 12 }} /></button>
                    <button type="button" className={`${s.btn} ${s.btnGhost}`} style={{ color: "var(--red)" }} onClick={() => handleDelete(r.role_name)}><Trash2 aria-hidden="true" style={{ width: 12, height: 12 }} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

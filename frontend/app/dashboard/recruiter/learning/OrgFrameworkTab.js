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
  AlertCircle,
  ChevronDown,
  ChevronRight,
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
        <div className={s.navList}>
          {SECTIONS.map((sec) => {
            const Icon = sec.icon;
            return (
              <button
                key={sec.key}
                type="button"
                className={`${s.navItem} ${section === sec.key ? s.navItemActive : ""}`}
                onClick={() => setSection(sec.key)}
              >
                <div className={s.navItemIcon}>
                  <Icon aria-hidden="true" style={{ width: 16, height: 16 }} />
                </div>
                <div className={s.navItemBody}>
                  <div className={s.navItemName}>{sec.label}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main content */}
      <div className={s.content}>
        <input ref={fileRef} type="file" accept=".xlsx" className={s.hiddenInput} onChange={handleFile} />
        {loading ? (
          <div className={s.loadingState}>Loading framework…</div>
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
          <OverviewSection
            summary={summary}
            departments={departments}
            roles={roles}
            roadmaps={roadmaps}
            promotionRules={promotionRules}
            versions={versions}
            loadAll={loadAll}
            onSeed={handleSeed}
            seeding={seeding}
            onNavigate={setSection}
          />
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

function ImportReportPanel({ importReport, onDismiss, onApply, applying, compact }) {
  if (!importReport) return null;
  return (
    <div
      className={`${s.importReport} ${importReport.valid ? s.importReportOk : s.importReportBad}`}
      style={compact ? undefined : { marginTop: 24, maxWidth: 640, width: "100%" }}
    >
      <div className={s.importReportHead}>
        <div className={s.importReportTitle}>
          {importReport.valid ? (compact ? "✓ Validation passed" : "Validation passed") : "Validation Report"}
        </div>
        <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={onDismiss}>Dismiss</button>
      </div>
      <div className={s.importReportCounts}>
        {Object.entries(importReport.counts || {})
          .filter(([k]) => k !== "catalog_index")
          .map(([k, v]) => (
            <span key={k} className={s.importReportCount}>
              {k.replace(/_/g, " ")}: {v}
            </span>
          ))}
      </div>
      {importReport.errors.length > 0 && (
        <div className={s.importReportErrors}>
          {importReport.errors.map((e, i) => (
            <div key={i} className={s.importReportError}>• {e}</div>
          ))}
        </div>
      )}
      {importReport.details?.length > 0 && (
        <div className={s.importReportDetails}>
          <div className={s.importReportDetailsLabel}>Exact location</div>
          {importReport.details.map((d, i) => (
            <div key={i} className={s.importReportDetailRow}>
              <span className={s.importReportLoc}>
                {d.sheet} · row {d.row} · {d.column}
              </span>
              <span className={s.importReportReason}>{d.reason}</span>
            </div>
          ))}
        </div>
      )}
      {importReport.warnings.length > 0 && (
        <div className={s.importReportWarnings}>
          {importReport.warnings.map((w, i) => (
            <div key={i} className={s.importReportWarning}>• {w}</div>
          ))}
        </div>
      )}
      {importReport.valid && (
        <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={onApply} disabled={applying}>
          <Check aria-hidden="true" /> {applying ? "Applying…" : "Apply Changes"}
        </button>
      )}
    </div>
  );
}

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
    <div className={s.emptyState}>
      <div className={`${s.emptyIcon} ${s.emptyIconLarge}`}>
        <Layers aria-hidden="true" />
      </div>
      <h3 className={`${s.emptyTitle} ${s.emptyTitleLarge}`}>Organization Framework Not Configured</h3>
      <p className={s.emptyText}>
        Download the Excel template and fill sheets in order: Departments → Career Roles → Career Roadmaps → Promotion Rules. Use Catalog Index to copy Course IDs, or put Course Name (+ Provider) and leave Course ID blank to resolve on import.
      </p>
      <div className={s.emptyActions}>
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

      <ImportReportPanel
        importReport={importReport}
        applying={applying}
        onDismiss={() => onApply(null)}
        onApply={onApply}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════ //
   Overview Section
// ═══════════════════════════════════════════════════════════════════════════════ */

function OverviewSection({
  summary,
  departments,
  roles,
  roadmaps,
  promotionRules,
  versions,
  loadAll,
  onSeed,
  seeding,
  onNavigate,
}) {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState(null);
  const [applying, setApplying] = useState(false);
  const fileRef = useRef(null);
  const token = () => localStorage.getItem("access_token");

  const deptCount = departments?.length || 0;
  const roleCount = roles?.length || 0;
  const roadmapCount = roadmaps?.length || 0;
  const ruleCount = (promotionRules || []).filter((r) => r?.source !== "career_levels").length;
  const employeeCount = summary?.employees || 0;

  const roadmapRoleNames = new Set(
    (roadmaps || []).map((r) => (r.role_name || "").trim().toLowerCase()).filter(Boolean),
  );
  const rolesWithRoadmap = (roles || []).filter((r) =>
    roadmapRoleNames.has((r.name || "").trim().toLowerCase()),
  );
  const rolesWithoutRoadmap = (roles || []).filter(
    (r) => !roadmapRoleNames.has((r.name || "").trim().toLowerCase()),
  );
  const learningCoveragePct = roleCount
    ? Math.round((rolesWithRoadmap.length / roleCount) * 100)
    : 0;

  const ruleKeys = new Set(
    (promotionRules || [])
      .filter((p) => p?.source !== "career_levels")
      .map((p) => `${(p.department || "").trim().toLowerCase()}::${(p.role_name || "").trim().toLowerCase()}`),
  );
  const rolesWithRules = (roles || []).filter((r) => {
    const dept = (r.department || "").trim().toLowerCase();
    const name = (r.name || "").trim().toLowerCase();
    return ruleKeys.has(`${dept}::${name}`) || ruleKeys.has(`::${name}`);
  });
  const rolesWithoutRules = (roles || []).filter((r) => {
    const dept = (r.department || "").trim().toLowerCase();
    const name = (r.name || "").trim().toLowerCase();
    return !ruleKeys.has(`${dept}::${name}`) && !ruleKeys.has(`::${name}`);
  });
  const promoCoveragePct = roleCount
    ? Math.round((rolesWithRules.length / roleCount) * 100)
    : 0;

  const rolesWithNext = (roles || []).filter((r) => (r.next_role || "").trim()).length;
  const ladderPct = roleCount ? Math.round((rolesWithNext / roleCount) * 100) : 0;

  const deptsWithRoles = new Set((roles || []).map((r) => (r.department || "").trim()).filter(Boolean));
  const emptyDepartments = (departments || []).filter(
    (d) => !deptsWithRoles.has((d.name || "").trim()),
  );

  const setupSteps = [
    {
      key: "departments",
      section: "departments",
      title: "Departments",
      done: deptCount > 0,
      meta: deptCount > 0 ? `${deptCount} department${deptCount === 1 ? "" : "s"}` : "Add your org units first",
    },
    {
      key: "roles",
      section: "roles",
      title: "Role ladders",
      done: roleCount > 0,
      meta: roleCount > 0
        ? `${roleCount} roles · ${rolesWithNext} with Promotes to`
        : "Build career levels per department",
    },
    {
      key: "roadmaps",
      section: "career-roadmaps",
      title: "Career Roadmaps",
      done: rolesWithRoadmap.length > 0,
      meta: roleCount > 0
        ? `${rolesWithRoadmap.length}/${roleCount} roles have learning · ${roadmapCount} items`
        : "Assign courses after roles exist",
    },
    {
      key: "promotion",
      section: "promotion",
      title: "Promotion rules",
      done: ruleCount > 0,
      meta: roleCount > 0
        ? `${rolesWithRules.length}/${roleCount} roles have rules`
        : "Optional readiness thresholds",
    },
  ];
  const stepsDone = setupSteps.filter((step) => step.done).length;
  const setupPct = Math.round((stepsDone / setupSteps.length) * 100);
  const nextStep = setupSteps.find((step) => !step.done);

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

  const cards = [
    {
      key: "setup",
      label: "Setup progress",
      value: `${setupPct}%`,
      hint: nextStep ? `Next: ${nextStep.title}` : "Core setup complete",
      cta: nextStep ? "Continue setup" : "Review departments",
      icon: Compass,
      color: "cyan",
      section: nextStep?.section || "departments",
      pct: setupPct,
      warn: setupPct < 100,
      ok: setupPct === 100,
    },
    {
      key: "learning",
      label: "Learning coverage",
      value: roleCount ? `${rolesWithRoadmap.length}/${roleCount}` : "0",
      hint: roleCount
        ? `${learningCoveragePct}% of roles have roadmap courses`
        : "No roles yet",
      cta: "Open Career Roadmaps",
      icon: Route,
      color: "navy",
      section: "career-roadmaps",
      pct: learningCoveragePct,
      warn: roleCount > 0 && learningCoveragePct < 50,
      ok: roleCount > 0 && learningCoveragePct >= 80,
    },
    {
      key: "ladders",
      label: "Ladder links",
      value: roleCount ? `${rolesWithNext}/${roleCount}` : "0",
      hint: roleCount
        ? `${ladderPct}% of roles have Promotes to`
        : "Build role ladders first",
      cta: "Edit role ladders",
      icon: Briefcase,
      color: "green",
      section: "roles",
      pct: ladderPct,
      warn: roleCount > 0 && ladderPct < 40,
      ok: roleCount > 0 && ladderPct >= 70,
    },
    {
      key: "promo",
      label: "Promotion coverage",
      value: roleCount ? `${rolesWithRules.length}/${roleCount}` : "0",
      hint: ruleCount
        ? `${promoCoveragePct}% of roles have promotion rules`
        : "No promotion rules yet",
      cta: "Open Promotion",
      icon: TrendingUp,
      color: "orange",
      section: "promotion",
      pct: promoCoveragePct,
      warn: roleCount > 0 && promoCoveragePct < 30,
      ok: roleCount > 0 && promoCoveragePct >= 50,
    },
  ];

  return (
    <div>
      <div className={s.pageHeader}>
        <div>
          <h2 className={s.pageTitle} style={{ fontSize: 20 }}>
            Organization Framework Overview
          </h2>
          <p className={s.pageSubtitle}>
            {deptCount} departments · {roleCount} roles · {employeeCount} employees in org.
            Cards show coverage — click any to jump to that section.
          </p>
        </div>
        <div className={s.pageActions}>
          <button type="button" className={`${s.btn} ${s.btnSecondary}`} onClick={onSeed} disabled={seeding}>
            <Zap aria-hidden="true" /> {seeding ? "Seeding…" : "Seed from existing records"}
          </button>
          <button type="button" className={`${s.btn} ${s.btnSecondary}`} onClick={handleExport} disabled={exporting}>
            <Download aria-hidden="true" /> {exporting ? "Exporting…" : "Export Excel"}
          </button>
          <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => fileRef.current?.click()} disabled={importing}>
            <Upload aria-hidden="true" /> {importing ? "Importing…" : "Import Excel"}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx" className={s.hiddenInput} onChange={handleFile} />
        </div>
      </div>

      <ImportReportPanel
        importReport={importReport}
        applying={applying}
        compact
        onDismiss={() => setImportReport(null)}
        onApply={handleApply}
      />

      <div className={s.setupList}>
        <div className={s.setupListHead}>
          <div className={s.setupListTitle}>Setup checklist</div>
          <div className={s.setupListMeta}>{stepsDone}/{setupSteps.length} complete</div>
        </div>
        {setupSteps.map((step) => (
          <button
            key={step.key}
            type="button"
            className={`${s.setupRow} ${step.done ? s.setupRowDone : ""}`}
            onClick={() => onNavigate?.(step.section)}
          >
            <span className={`${s.setupCheck} ${step.done ? s.setupCheckOn : s.setupCheckOff}`}>
              {step.done ? <Check aria-hidden="true" style={{ width: 14, height: 14 }} /> : step.key === "departments" ? "1" : step.key === "roles" ? "2" : step.key === "roadmaps" ? "3" : "4"}
            </span>
            <span className={s.setupBody}>
              <span className={s.setupTitle}>{step.title}</span>
              <span className={s.setupMeta}>{step.meta}</span>
            </span>
            <ChevronRight aria-hidden="true" style={{ width: 16, height: 16, color: "var(--text-muted)", flexShrink: 0 }} />
          </button>
        ))}
      </div>

      <div className={`${s.analyticsGrid} ${s.analyticsGridSpaced}`}>
        {cards.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <button
              key={kpi.key}
              type="button"
              className={`${s.kpiCard} ${kpi.warn ? s.kpiCardWarn : ""} ${kpi.ok ? s.kpiCardOk : ""}`}
              onClick={() => onNavigate?.(kpi.section)}
            >
              <div className={s.kpiTop}>
                <span className={`${s.kpiIcon} ${s[kpi.color]}`}><Icon aria-hidden="true" /></span>
                {kpi.warn ? <AlertCircle aria-hidden="true" style={{ width: 16, height: 16, color: "#a57500" }} /> : null}
              </div>
              <div className={s.kpiValue}>{kpi.value}</div>
              <div className={s.kpiLabel}>{kpi.label}</div>
              <div className={s.kpiHint}>{kpi.hint}</div>
              <div className={s.kpiBar} aria-hidden="true">
                <div className={s.kpiBarFill} style={{ width: `${Math.min(100, kpi.pct || 0)}%` }} />
              </div>
              <div className={s.kpiCta}>{kpi.cta} →</div>
            </button>
          );
        })}
      </div>

      {(rolesWithoutRoadmap.length > 0 || rolesWithoutRules.length > 0 || emptyDepartments.length > 0) && (
        <div className={s.gapPanel}>
          <div className={s.sectionLabel}>
            <AlertCircle aria-hidden="true" /> Needs attention
          </div>
          <div className={s.gapGrid}>
            <div>
              <div className={s.gapColTitle}>Roles without roadmap ({rolesWithoutRoadmap.length})</div>
              {rolesWithoutRoadmap.length === 0 ? (
                <div className={s.gapEmpty}>All roles have at least one learning item.</div>
              ) : (
                rolesWithoutRoadmap.slice(0, 6).map((r) => (
                  <div key={r.role_id || `${r.department}-${r.name}`} className={s.gapItem}>
                    <span>{r.name}</span>
                    <span className={s.gapMeta}>{r.department}</span>
                  </div>
                ))
              )}
              {rolesWithoutRoadmap.length > 6 && (
                <button type="button" className={`${s.btn} ${s.btnGhost}`} style={{ marginTop: 6, padding: "4px 8px" }} onClick={() => onNavigate?.("career-roadmaps")}>
                  View all in Career Roadmaps
                </button>
              )}
            </div>
            <div>
              <div className={s.gapColTitle}>Roles without promotion rule ({rolesWithoutRules.length})</div>
              {rolesWithoutRules.length === 0 ? (
                <div className={s.gapEmpty}>Every role has a promotion rule.</div>
              ) : (
                rolesWithoutRules.slice(0, 6).map((r) => (
                  <div key={`rule-${r.role_id || `${r.department}-${r.name}`}`} className={s.gapItem}>
                    <span>{r.name}</span>
                    <span className={s.gapMeta}>{r.department}</span>
                  </div>
                ))
              )}
              {emptyDepartments.length > 0 && (
                <>
                  <div className={`${s.gapColTitle} ${s.gapColTitleSpaced}`}>
                    Empty departments ({emptyDepartments.length})
                  </div>
                  {emptyDepartments.slice(0, 4).map((d) => (
                    <div key={d.department_id || d.name} className={s.gapItem}>
                      <span>{d.name}</span>
                      <span className={s.gapMeta}>no roles</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {versions.length > 0 && (
        <div>
          <div className={s.sectionLabel}><Calendar aria-hidden="true" /> Recent imports</div>
          <div className={s.versionList}>
            {versions.slice(0, 4).map((v) => (
              <div key={v.version_id} className={s.versionRow}>
                <span className={s.versionId}>{v.version_id}</span>
                <span className={s.versionLabel}>{v.label}</span>
                <span className={s.versionDate}>{new Date(v.created_at).toLocaleDateString()}</span>
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
      <div className={s.pageHeader}>
        <div>
          <h2 className={s.pageTitle}>Departments ({departments.length})</h2>
          <p className={s.pageSubtitle}>Structure your org into departments — roles and roadmaps hang off these units.</p>
        </div>
        <div className={s.pageActions}>
          <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => { setShowForm(true); setEditItem(null); setFormName(""); setFormDesc(""); }}>
            <Plus aria-hidden="true" /> Add Department
          </button>
        </div>
      </div>
      {showForm && (
        <div data-partner-coach className={s.formPanel}>
          <div className={s.formTitle}>{editItem ? "Edit Department" : "New Department"}</div>
          <div className={s.formGrid}>
            <label className={s.fieldLabel} style={{ margin: 0 }}>Name<input data-field-key="department_name" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Engineering" /></label>
            <label className={s.fieldLabel} style={{ margin: 0 }}>Description<input data-field-key="description" value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="Optional" /></label>
          </div>
          <div className={s.formActions}>
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy} onClick={editItem ? handleUpdate : handleCreate}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" className={`${s.btn} ${s.btnSecondary}`} onClick={() => { setShowForm(false); setEditItem(null); }}>Cancel</button>
          </div>
        </div>
      )}
      {departments.length === 0 && !showForm ? (
        <div className={s.emptyState}>
          <div className={s.emptyIcon}>
            <Building2 aria-hidden="true" />
          </div>
          <div className={s.emptyTitle}>No departments yet</div>
          <p className={s.emptyText}>Add your first org unit to start building role ladders and career roadmaps.</p>
          <div className={s.emptyActions}>
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => { setShowForm(true); setEditItem(null); setFormName(""); setFormDesc(""); }}>
              <Plus aria-hidden="true" /> Add Department
            </button>
          </div>
        </div>
      ) : (
        <div className={s.deptCardGrid}>
          {departments.map((d) => (
            <div key={d.name} className={s.deptCard}>
              <div className={s.deptCardTop}>
                <div className={s.deptAvatar}>{d.name.slice(0, 2).toUpperCase()}</div>
                <div className={s.deptCardBody}>
                  <div className={s.deptCardName}>{d.name}</div>
                  {d.description && <div className={s.deptCardDesc}>{d.description}</div>}
                </div>
              </div>
              <div className={s.deptCardActions}>
                <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={() => startEdit(d)}><Pencil aria-hidden="true" style={{ width: 12, height: 12 }} /> Edit</button>
                <button type="button" className={`${s.btn} ${s.btnGhost} ${s.btnDanger}`} onClick={() => handleDelete(d.name)}><Trash2 aria-hidden="true" style={{ width: 12, height: 12 }} /> Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
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
      <div className={s.pageHeader}>
        <div>
          <h2 className={s.pageTitle}>
            Role ladders ({roles.length})
          </h2>
          <p className={s.pageSubtitle}>
            Pick <strong>Add after</strong> — e.g. after Software Developer — and the next step is filled in for you.
          </p>
        </div>
        <div className={s.pageActions}>
          <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => { setShowForm(true); resetForm(); }}>
            <Plus aria-hidden="true" /> Add Role
          </button>
        </div>
      </div>

      {showForm && (
        <div data-partner-coach className={s.formPanel}>
          <div className={s.formTitle}>{editItem ? "Edit Role" : "New Role"}</div>
          <div className={s.formGrid}>
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
            <span className={s.formHint}>
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
            <div className={s.formPathPreview}>
              {pathPreview}
            </div>
          )}
          <label className={s.fieldLabel} style={{ marginTop: 10, display: "block" }}>
            Description
            <input data-field-key="description" value={form.description} onChange={(e) => setField("description", e.target.value)} placeholder="Optional" />
          </label>
          <div className={s.formActions}>
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy} onClick={editItem ? handleUpdate : handleCreate}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" className={`${s.btn} ${s.btnSecondary}`} onClick={() => { setShowForm(false); resetForm(); }}>Cancel</button>
          </div>
        </div>
      )}

      {roles.length === 0 ? (
        <div className={s.emptyState}>
          <div className={s.emptyIcon}>
            <Briefcase aria-hidden="true" />
          </div>
          <div className={s.emptyTitle}>No roles yet</div>
          <p className={s.emptyText}>
            Add departments first, then add roles and choose who they come after to build each ladder.
          </p>
          <div className={s.emptyActions}>
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => { setShowForm(true); resetForm(); }}>
              <Plus aria-hidden="true" /> Add Role
            </button>
          </div>
        </div>
      ) : (
        <div className={s.ladderStack}>
          {Object.entries(byDept).map(([dept, deptRoles]) => {
            const views = buildDepartmentLadderViews(deptRoles);
            return (
              <div key={dept} className={s.ladderDept}>
                <div className={s.ladderDeptHead}>
                  <Building2 aria-hidden="true" style={{ width: 14, height: 14 }} />
                  {dept}
                  <span className={`${s.statusPill} ${s.neutral}`} style={{ fontSize: 10 }}>{deptRoles.length} roles</span>
                </div>
                <div className={s.ladderFlows}>
                  {views.map((view, idx) => (
                    <div key={`${dept}-flow-${idx}`} className={s.ladderChain}>
                      {view.layers.map((layer, li) => (
                        <div key={`${dept}-L${li}`} className={s.ladderLayerWrap}>
                          {li > 0 && <span className={s.ladderArrow} aria-hidden="true">→</span>}
                          <div className={s.ladderLayer}>
                            {layer.map((r) => (
                              <div key={r.role_id} className={s.ladderNode}>
                                <span className={s.ladderName}>{r.name}</span>
                                <span className={s.ladderNodeActions}>
                                  <button type="button" className={`${s.btn} ${s.btnGhost} ${s.btnIconTiny}`} onClick={() => startEdit(r)} title="Edit">
                                    <Pencil aria-hidden="true" style={{ width: 11, height: 11 }} />
                                  </button>
                                  <button type="button" className={`${s.btn} ${s.btnGhost} ${s.btnIconTiny} ${s.btnDanger}`} onClick={() => handleDelete(r.role_id)} title="Delete">
                                    <Trash2 aria-hidden="true" style={{ width: 11, height: 11 }} />
                                  </button>
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                      {view.layers.length === 1 && view.layers[0].length === 1 && !view.layers[0][0].next_role && (
                        <span className={s.ladderStandalone}>standalone — edit and choose Add after</span>
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
      <div className={s.emptyState}>
        <div className={s.emptyIcon}>
          <TrendingUp aria-hidden="true" />
        </div>
        <div className={s.emptyTitle}>No roles yet</div>
        <p className={s.emptyText}>
          Build a <strong>Role ladder</strong> first (with Promotes to), then set readiness rules here per department.
        </p>
        {typeof onGoToRoles === "function" && (
          <div className={s.emptyActions}>
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={onGoToRoles}>
              Open Role ladders
            </button>
          </div>
        )}
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
      <div className={s.pageHeader}>
        <div>
          <h2 className={s.pageTitle}>
            Promotion readiness
          </h2>
          <p className={s.pageSubtitle}>
            Filter by department, then add a rule for each ladder step.
            Employees match by <strong>department + job title</strong>.
          </p>
        </div>
        <div className={s.pageActions}>
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
          <span className={s.gapMeta}>
            {empTotal} employee{empTotal === 1 ? "" : "s"} matched in {activeDept}
          </span>
        </div>
      )}

      {showAddForm && (
        <div className={`${s.formPanel} ${s.promoRuleFormStandalone}`} data-partner-coach>
          <div className={s.formTitle}>
            Add promotion rule — {activeDept}
          </div>
          <div className={s.formGrid3}>
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
          <div className={s.formActions}>
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
            <div className={s.promoEmptyAction}>
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
                <button type="button" className={`${s.btn} ${s.btnPrimary} ${s.promoHintAction}`} onClick={onGoToRoles}>
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
                      <span className={s.mutedInline}>{role.next_role}</span>
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
                  <div className={s.promoInlineActions}>
                    {!isEditing && (
                      <button
                        type="button"
                        className={`${s.btn} ${s.btnSecondary} ${s.btnCompact}`}
                        onClick={() => startEdit(role, existing)}
                      >
                        {existing ? "Edit rule" : "Set rule"}
                      </button>
                    )}
                    {existing && !isEditing && (
                      <button
                        type="button"
                        className={`${s.btn} ${s.btnGhost} ${s.btnDanger}`}
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
                    <div className={s.formGrid}>
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
                        <span className={s.formHint}>
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
                    <div className={s.formActions}>
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
                      <span className={s.faintInline}>· no next role</span>
                    </div>
                    <div className={s.promoRoleMeta}>
                      <Users aria-hidden="true" style={{ width: 12, height: 12 }} />
                      {people === 0
                        ? "No employees with this title yet"
                        : `${people} employee${people === 1 ? "" : "s"} in this role`}
                      <span className={`${s.statusPill} ${s.neutral}`} style={{ fontSize: 10 }}>Needs Promotes to</span>
                    </div>
                    <p className={s.pageSubtitle} style={{ marginTop: 8, maxWidth: "none" }}>
                      Add another role in this department (or pick an existing one), then set <strong>Promotes to</strong> on {role.name}.
                    </p>
                  </div>
                  {typeof onGoToRoles === "function" && (
                    <button type="button" className={`${s.btn} ${s.btnSecondary} ${s.btnCompact}`} onClick={onGoToRoles}>
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
      <div className={s.emptyState}>
        <div className={s.emptyIcon}>
          <Route aria-hidden="true" />
        </div>
        <div className={s.emptyTitle}>No roles yet</div>
        <p className={s.emptyText}>
          Add roles in the <strong>Role ladders</strong> tab first — then build each role&apos;s learning path from your catalog here.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className={s.pageHeader}>
        <div>
          <h2 className={s.pageTitle}>
            Career Roadmaps ({roles.length} roles)
          </h2>
          <p className={s.pageSubtitle}>
            Modules, learning paths, courses, and certifications from your catalogs
          </p>
        </div>
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
  const [open, setOpen] = useState(roleCourses.length > 0);
  const certCount = roleCourses.filter((c) => catalogTypeKey(c) === "certification").length;

  return (
    <div className={s.roleCard} data-partner-coach>
      <button type="button" className={s.roleCardHead} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <div className={s.roleCardHeadMain}>
          <div className={s.roleCardTitle}>{role.name}</div>
          <div className={s.roleCardMeta}>
            {role.department}
            {role.next_role ? ` · Promotes to ${role.next_role}` : ""}
          </div>
        </div>
        <div className={s.roleCardHeadMeta}>
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
        course_url: course.url || course.course_url || null,
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
        <span className={s.courseEmpty}>
          No catalog items yet — filter by type (module, path, course, cert) and add from your catalogs.
        </span>
      ) : (
        <div className={s.courseList}>
          {sorted.map((r, index) => {
            const fromCareer = r.source === "career_levels";
            const skills = courseSkills(r);
            const certs = courseCerts({ ...r, title: r.course_name || r.title });
            return (
              <div
                key={r.roadmap_id || `${r.role_name}-${r.course_name || r.course_id}-${index}`}
                className={`${s.courseRow} ${fromCareer ? s.courseRowDerived : ""}`}
              >
                <span className={s.courseOrder}>{index + 1}.</span>
                <div className={s.courseBody}>
                  <div className={s.courseTitle}>{r.course_name || r.course_id}</div>
                  {(skills.length > 0 || certs.length > 0) && (
                    <div className={s.courseTags}>
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
                <div className={s.courseRowActions}>
                  {!fromCareer && (
                    <>
                      <button type="button" className={`${s.btn} ${s.btnGhost} ${s.btnIconTiny}`} disabled={busy || index === 0} onClick={() => moveEntry(index, -1)} aria-label="Move up">↑</button>
                      <button type="button" className={`${s.btn} ${s.btnGhost} ${s.btnIconTiny}`} disabled={busy || index === sorted.length - 1} onClick={() => moveEntry(index, 1)} aria-label="Move down">↓</button>
                      <button type="button" className={`${s.btn} ${s.btnGhost} ${s.btnIconTiny}`} onClick={() => handleDelete(r.roadmap_id)}>
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

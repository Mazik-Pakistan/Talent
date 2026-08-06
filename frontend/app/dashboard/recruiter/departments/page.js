"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import ProtectedRecruiterRoute from "@/components/ProtectedRecruiterRoute";
import RecruiterShell from "@/components/recruiter/RecruiterShell";
import { getApiErrorMessage, listEmployees } from "@/services/authService";
import { listCareerLevels, listCareerTracks } from "@/services/careerService";
import {
  listOrgDepartments,
  createOrgDepartment,
  updateOrgDepartment,
  deleteOrgDepartment,
} from "@/services/orgFrameworkService";
import { publishRecruiterContext, clearRecruiterContext } from "@/lib/ai/recruiterContext";
import {
  ArrowUpRight,
  Award,
  Briefcase,
  Building2,
  Calendar,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  Compass,
  Eye,
  GraduationCap,
  Layers,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Target,
  Trash2,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import s from "./departments.module.css";

export const dynamic = "force-dynamic";

export default function RecruiterDepartmentsPage() {
  return (
    <ProtectedRecruiterRoute requiredCapability="learning">
      <Suspense fallback={<RecruiterShell activeKey="departments" capability="learning" title="Departments" subtitle="Loading…"><SkeletonPage /></RecruiterShell>}>
        <DepartmentsContent />
      </Suspense>
    </ProtectedRecruiterRoute>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════ //
   Skeleton Loader
// ═══════════════════════════════════════════════════════════════════════════════ */

function SkeletonPage() {
  return (
    <>
      <div className={s.skeletonHero}>
        <div className={s.skeletonHeroLeft}>
          <div className={s.skeleton} style={{ width: 200, height: 18, marginBottom: 10 }} />
          <div className={s.skeleton} style={{ width: 340, height: 13, marginBottom: 8 }} />
          <div className={s.skeleton} style={{ width: 260, height: 13 }} />
        </div>
        <div className={`${s.skeleton} ${s.skeletonHeroRight}`} />
      </div>
      <div className={s.skeletonKpiGrid}>
        {[0, 1, 2, 3].map((i) => <div key={i} className={`${s.skeleton} ${s.skeletonKpi}`} />)}
      </div>
      <div className={s.skeletonLevelRow}>
        {[0, 1, 2].map((i) => <div key={i} className={`${s.skeleton} ${s.skeletonLevel}`} />)}
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════ //
   Main Component
// ═══════════════════════════════════════════════════════════════════════════════ */

function DepartmentsContent() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState([]);
  const [employeeMap, setEmployeeMap] = useState({});
  const [levelsMap, setLevelsMap] = useState({});
  const [tracksMap, setTracksMap] = useState({});
  const [selectedDept, setSelectedDept] = useState(null);
  const [search, setSearch] = useState("");
  const [empSearch, setEmpSearch] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addName, setAddName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [editName, setEditName] = useState("");
  const [editing, setEditing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const isNarrowRef = useRef(typeof window !== "undefined" ? window.matchMedia("(max-width: 1100px)").matches : false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1100px)");
    const onChange = (e) => {
      isNarrowRef.current = e.matches;
      setSidebarCollapsed(e.matches);
    };
    isNarrowRef.current = mq.matches;
    setSidebarCollapsed(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    publishRecruiterContext({ tab: "departments", section: "departments", hint: "Department management", fields: [] });
    return () => clearRecruiterContext();
  }, []);

  const loadData = useCallback(async () => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    try {
      const [deptDocs, levelsData, tracksData] = await Promise.all([
        listOrgDepartments(token),
        listCareerLevels(token),
        listCareerTracks(token),
      ]);

      const deptNames = (deptDocs || []).map((d) => d.name);
      const levels = levelsData.levels || [];
      const tracks = tracksData.tracks || [];

      const lMap = {};
      for (const level of levels) {
        const dept = level.department;
        if (!lMap[dept]) lMap[dept] = [];
        lMap[dept].push(level);
      }
      for (const dept of Object.keys(lMap)) {
        lMap[dept].sort((a, b) => a.level_number - b.level_number);
      }

      const tMap = {};
      for (const track of tracks) {
        const dept = track.department;
        if (!tMap[dept]) tMap[dept] = [];
        tMap[dept].push(track);
      }

      setLevelsMap(lMap);
      setTracksMap(tMap);

      let allEmployees = [];
      let page = 1;
      let total = 0;
      do {
        const data = await listEmployees(token, { page, page_size: 100, status: "active", sort: "full_name" });
        const emps = data.employees || [];
        allEmployees = allEmployees.concat(emps);
        total = data.total || emps.length;
        page++;
        if (page > 20) break;
      } while (allEmployees.length < total);

      const eMap = {};
      for (const emp of allEmployees) {
        const dept = emp.department || "Unassigned";
        if (!eMap[dept]) eMap[dept] = { employees: [], designations: {} };
        eMap[dept].employees.push(emp);
        const title = emp.job_title || "Unassigned";
        eMap[dept].designations[title] = (eMap[dept].designations[title] || 0) + 1;
      }

      setEmployeeMap(eMap);

      const allDepts = [...new Set([...deptNames, ...Object.keys(eMap), ...Object.keys(lMap), ...Object.keys(tMap)])].sort();
      const enriched = allDepts.map((name) => ({
        name,
        employeeCount: (eMap[name]?.employees || []).length,
        designationCount: Object.keys(eMap[name]?.designations || {}).length,
        levelCount: (lMap[name] || []).length,
        trackCount: (tMap[name] || []).length,
        topDesignations: Object.entries(eMap[name]?.designations || {}).sort(([, a], [, b]) => b - a).slice(0, 8),
        allDesignations: Object.entries(eMap[name]?.designations || {}).sort(([, a], [, b]) => b - a),
      }));

      setDepartments(enriched);
      if (enriched.length > 0 && !selectedDept) {
        setSelectedDept(enriched[0].name);
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not load departments."));
    } finally {
      setLoading(false);
    }
  }, [selectedDept]);

  useEffect(() => { loadData(); }, [loadData]);

  const selectDepartment = useCallback((name) => {
    setSelectedDept(name);
    setEmpSearch("");
    if (isNarrowRef.current) setSidebarCollapsed(true);
  }, []);

  const handleAddDepartment = useCallback(async () => {
    const name = addName.trim();
    if (!name) return;
    const token = localStorage.getItem("access_token");
    setAdding(true);
    try {
      await createOrgDepartment(token, { name, description: "" });
      toast.success(`Department "${name}" created.`);
      setAddName("");
      setShowAddForm(false);
      await loadData();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not create department."));
    } finally {
      setAdding(false);
    }
  }, [addName, loadData]);

  const handleEditDepartment = useCallback(async () => {
    if (!editTarget || !editName.trim()) return;
    const token = localStorage.getItem("access_token");
    setEditing(true);
    try {
      const result = await updateOrgDepartment(token, editTarget, { name: editName.trim(), description: "" });
      if (result.unchanged) {
        toast.info("No changes made.");
      } else {
        toast.success(`Department renamed to "${editName.trim()}".`);
        if (selectedDept === editTarget) setSelectedDept(editName.trim());
      }
      setEditTarget(null);
      setEditName("");
      await loadData();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not rename department."));
    } finally {
      setEditing(false);
    }
  }, [editTarget, editName, selectedDept, loadData]);

  const handleDeleteDepartment = useCallback(async () => {
    if (!deleteTarget) return;
    const token = localStorage.getItem("access_token");
    setDeleting(true);
    try {
      await deleteOrgDepartment(token, deleteTarget);
      toast.success(`Department "${deleteTarget}" deleted.`);
      if (selectedDept === deleteTarget) {
        setSelectedDept(null);
      }
      setDeleteTarget(null);
      await loadData();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not delete department."));
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, selectedDept, loadData]);

  const filteredDepts = useMemo(() => {
    if (!search.trim()) return departments;
    const q = search.toLowerCase();
    return departments.filter((d) => d.name.toLowerCase().includes(q));
  }, [departments, search]);

  const selectedInfo = useMemo(() => {
    const dept = departments.find((d) => d.name === selectedDept);
    const empData = employeeMap[selectedDept] || { employees: [], designations: {} };
    const levels = levelsMap[selectedDept] || [];
    const tracks = tracksMap[selectedDept] || [];
    const allDesignations = Object.entries(empData.designations || {}).sort(([, a], [, b]) => b - a);
    const filteredEmployees = empSearch.trim()
      ? empData.employees.filter((e) => (e.full_name || "").toLowerCase().includes(empSearch.toLowerCase()) || (e.job_title || "").toLowerCase().includes(empSearch.toLowerCase()))
      : empData.employees;
    return { dept, employees: empData.employees, filteredEmployees, allDesignations, levels, tracks };
  }, [selectedDept, departments, employeeMap, levelsMap, tracksMap, empSearch]);

  const totalEmployees = departments.reduce((sum, d) => sum + d.employeeCount, 0);
  const totalLevels = Object.values(levelsMap).reduce((s, a) => s + a.length, 0);
  const totalTracks = Object.values(tracksMap).reduce((s, a) => s + a.length, 0);
  const totalDesignations = useMemo(() => {
    const set = new Set();
    Object.values(employeeMap).forEach((ed) => Object.keys(ed.designations || {}).forEach((d) => set.add(d)));
    return set.size;
  }, [employeeMap]);

  /* Career health score: ratio of levels defined vs departments with employees */
  const deptsWithLevels = departments.filter((d) => d.levelCount > 0).length;
  const healthScore = departments.length > 0 ? Math.round((deptsWithLevels / departments.length) * 100) : 0;
  const healthColor = healthScore >= 75 ? "var(--green)" : healthScore >= 40 ? "var(--orange)" : "var(--red)";

  return (
    <>
    <RecruiterShell
      activeKey="departments"
      capability="learning"
      title="Departments"
      subtitle="View and manage organizational departments, employees, and career progressions"
    >
      {loading ? (
        <SkeletonPage />
      ) : departments.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 20, boxShadow: "var(--shadow)" }}>
          <div className={s.emptyState}>
            <div className={s.emptyIcon}><Building2 aria-hidden="true" /></div>
            <div className={s.emptyTitle}>No departments found</div>
            <p className={s.emptyDesc}>Departments will appear once employees are assigned to departments. Start by inviting employees and assigning them to departments.</p>
          </div>
        </div>
      ) : (
        <div className={`${s.pageLayout} ${sidebarCollapsed ? s.sidebarCollapsed : ""}`}>
          {/* ─── Left Sidebar ─── */}
          <div className={s.sidebar} aria-label="Departments sidebar">
            <div className={s.sidebarHead}>
              <div className={s.sidebarHeadTop}>
                <span className={s.sidebarTitle}>Departments</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className={s.sidebarCount}>{filteredDepts.length}</span>
                  {!sidebarCollapsed && (
                    <button
                      type="button"
                      className={s.sidebarToggle}
                      aria-label="Add department"
                      onClick={() => { setShowAddForm(true); setAddName(""); }}
                    >
                      <Plus aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    className={s.sidebarToggle}
                    aria-label={sidebarCollapsed ? "Expand department list" : "Collapse department list"}
                    aria-expanded={!sidebarCollapsed}
                    onClick={() => setSidebarCollapsed((v) => !v)}
                  >
                    {sidebarCollapsed ? <ChevronsRight aria-hidden="true" /> : <ChevronsLeft aria-hidden="true" />}
                  </button>
                </div>
              </div>
              <div className={s.sidebarHint}>{totalEmployees} employees across {departments.length} departments</div>
            </div>
            <div className={s.sidebarSearch}>
              <div className={s.searchWrap}>
                <Search className={s.searchIcon} aria-hidden="true" />
                <input
                  className={s.searchInput}
                  aria-label="Search departments"
                  placeholder="Search departments…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            {showAddForm && !sidebarCollapsed && (
              <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-soft)" }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className={s.searchInput}
                    aria-label="New department name"
                    placeholder="Department name…"
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAddDepartment(); if (e.key === "Escape") setShowAddForm(false); }}
                    autoFocus
                  />
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={adding || !addName.trim()} onClick={handleAddDepartment} style={{ flex: 1 }}>
                    {adding ? "Adding…" : "Add"}
                  </button>
                  <button type="button" className={`${s.btn} ${s.btnSecondary}`} onClick={() => setShowAddForm(false)}>Cancel</button>
                </div>
              </div>
            )}
            <div className={s.deptList} role="listbox" aria-label="Department list">
              {filteredDepts.map((d) => (
                <button
                  key={d.name}
                  type="button"
                  role="option"
                  aria-selected={selectedDept === d.name}
                  title={d.name}
                  className={`${s.deptItem} ${selectedDept === d.name ? s.deptItemActive : ""}`}
                  onClick={() => selectDepartment(d.name)}
                >
                  <div className={s.deptItemIcon}>{d.name.slice(0, 2).toUpperCase()}</div>
                  <div className={s.deptItemBody}>
                    <div className={s.deptItemName}>{d.name}</div>
                    <div className={s.deptItemMeta}>
                      <Users aria-hidden="true" /> {d.employeeCount}
                      <span className={s.deptItemDot} />
                      <GraduationCap aria-hidden="true" /> {d.levelCount} levels
                    </div>
                  </div>
                  <span className={s.deptItemBadge}>{d.employeeCount}</span>
                </button>
              ))}
              {filteredDepts.length === 0 && (
                <div className={s.deptEmpty}>No departments match "{search}"</div>
              )}
            </div>
            {/* Quick-switch chips (mobile, collapsed state) */}
            <div className={s.mobileChips}>
              <div className={s.chipStrip}>
                {filteredDepts.map((d) => (
                  <button
                    key={d.name}
                    type="button"
                    className={`${s.chipItem} ${selectedDept === d.name ? s.chipItemActive : ""}`}
                    onClick={() => selectDepartment(d.name)}
                  >
                    <span className={s.chipName}>{d.name}</span>
                    <span className={s.chipCount}>{d.employeeCount}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ─── Main Content ─── */}
          <div className={s.content}>
            {!selectedDept ? (
              <div className={s.emptyState}>
                <div className={s.emptyIcon}><Building2 aria-hidden="true" /></div>
                <div className={s.emptyTitle}>Select a department</div>
                <p className={s.emptyDesc}>Choose a department from the sidebar to view its employees, designations, and career progression.</p>
              </div>
            ) : (
              <>
                {/* ── Hero ── */}
                <div className={s.hero}>
                  <div className={s.heroTop}>
                    <div className={s.heroLeft}>
                      <div className={s.heroIconRow}>
                        <div className={s.heroIcon}>{selectedDept.slice(0, 2).toUpperCase()}</div>
                        <div className={s.heroBadges}>
                          <span className={`${s.heroBadge} ${s.heroBadgeActive}`}>Active</span>
                          {selectedInfo.levels.length > 0 && <span className={`${s.heroBadge} ${s.heroBadgeLevel}`}><Layers aria-hidden="true" style={{ width: 11, height: 11 }} /> {selectedInfo.levels.length} levels</span>}
                          {selectedInfo.allDesignations.length > 0 && <span className={`${s.heroBadge} ${s.heroBadgeDesignation}`}><Briefcase aria-hidden="true" style={{ width: 11, height: 11 }} /> {selectedInfo.allDesignations.length} designations</span>}
                        </div>
                      </div>
                      <h2 className={s.heroTitle}>{selectedDept}</h2>
                      <p className={s.heroSubtitle}>
                        {selectedInfo.employees.length} active employee{selectedInfo.employees.length !== 1 ? "s" : ""} · {selectedInfo.levels.length} career level{selectedInfo.levels.length !== 1 ? "s" : ""} · {selectedInfo.tracks.length} career track{selectedInfo.tracks.length !== 1 ? "s" : ""}
                      </p>
                      {editTarget === selectedDept && (
                        <div style={{ display: "flex", gap: 8, marginTop: 10, maxWidth: 400 }}>
                          <input
                            className={s.searchInput}
                            aria-label="Rename department"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") handleEditDepartment(); if (e.key === "Escape") { setEditTarget(null); setEditName(""); } }}
                            autoFocus
                          />
                          <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={editing || !editName.trim()} onClick={handleEditDepartment}>
                            {editing ? "Saving…" : "Save"}
                          </button>
                          <button type="button" className={`${s.btn} ${s.btnSecondary}`} onClick={() => { setEditTarget(null); setEditName(""); }}>Cancel</button>
                        </div>
                      )}
                      <div className={s.heroActions}>
                        <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => router.push(`/dashboard/recruiter/learning?tab=career-framework&department=${encodeURIComponent(selectedDept)}`)}>
                          <Briefcase aria-hidden="true" /> Manage career framework
                        </button>
                        <button type="button" className={`${s.btn} ${s.btnSecondary}`} onClick={() => router.push(`/dashboard/recruiter/learning?tab=analytics`)}>
                          <Eye aria-hidden="true" /> Learning analytics
                        </button>
                        <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={() => { setEditTarget(selectedDept); setEditName(selectedDept); }}>
                          <Pencil aria-hidden="true" /> Rename
                        </button>
                        <button type="button" className={`${s.btn} ${s.btnGhost}`} style={{ color: "var(--red)" }} onClick={() => setDeleteTarget(selectedDept)}>
                          <Trash2 aria-hidden="true" /> Delete
                        </button>
                      </div>
                    </div>
                    <div className={s.heroRight}>
                      <div className={s.healthRing}>
                        <svg viewBox="0 0 36 36" style={{ transform: "rotate(-90deg)" }}>
                          <circle className={s.healthTrack} cx="18" cy="18" r="15.9155" />
                          <circle
                            className={s.healthFill}
                            cx="18" cy="18" r="15.9155"
                            stroke={healthColor}
                            strokeDasharray={`${healthScore * (2 * Math.PI * 15.9155) / 100} ${2 * Math.PI * 15.9155}`}
                          />
                        </svg>
                        <div className={s.healthLabel}>
                          <span className={s.healthValue} style={{ color: healthColor }}>{healthScore}%</span>
                          <span className={s.healthText}>Health</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── Analytics KPIs ── */}
                <div className={s.analyticsSection}>
                  <div className={s.sectionLabel}><TrendingUp aria-hidden="true" /> Overview</div>
                  <div className={s.analyticsGrid}>
                    {[
                      { label: "Employees", value: selectedInfo.employees.length, icon: Users, color: "cyan", pct: totalEmployees > 0 ? Math.round((selectedInfo.employees.length / totalEmployees) * 100) : 0, desc: `${Math.round((selectedInfo.employees.length / Math.max(totalEmployees, 1)) * 100)}% of total workforce` },
                      { label: "Career Levels", value: selectedInfo.levels.length, icon: GraduationCap, color: "green", pct: totalLevels > 0 ? Math.round((selectedInfo.levels.length / totalLevels) * 100) : 0, desc: `${selectedInfo.levels.length} of ${totalLevels} total levels defined` },
                      { label: "Designations", value: selectedInfo.allDesignations.length, icon: Briefcase, color: "orange", pct: totalDesignations > 0 ? Math.round((selectedInfo.allDesignations.length / totalDesignations) * 100) : 0, desc: `${selectedInfo.allDesignations.length} distinct job titles` },
                      { label: "Career Tracks", value: selectedInfo.tracks.length, icon: Compass, color: "navy", pct: totalTracks > 0 ? Math.round((selectedInfo.tracks.length / totalTracks) * 100) : 0, desc: `${selectedInfo.tracks.length} progression tracks defined` },
                    ].map((kpi) => {
                      const Icon = kpi.icon;
                      return (
                        <div key={kpi.label} className={s.kpiCard}>
                          <div className={s.kpiTop}>
                            <span className={`${s.kpiIcon} ${s[kpi.color]}`}><Icon aria-hidden="true" /></span>
                            <span className={`${s.kpiTrend} ${s.kpiTrendUp}`}>
                              <ArrowUpRight aria-hidden="true" /> {kpi.pct}%
                            </span>
                          </div>
                          <div className={s.kpiValue}>{kpi.value}</div>
                          <div className={s.kpiLabel}>{kpi.label}</div>
                          <div className={s.kpiBar}>
                            <div className={s.kpiBarFill} style={{ width: `${Math.min(kpi.pct, 100)}%`, background: `var(--${kpi.color === "cyan" ? "blue" : kpi.color})` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* ─── Two-Column Body ─── */}
                <div className={s.bodyGrid}>
                  <div className={s.bodyMain}>
                    {/* ── Career Framework ── */}
                    {selectedInfo.levels.length > 0 && (
                      <div className={s.sectionBlock}>
                        <div className={s.sectionBlockHead}>
                          <div>
                            <div className={s.sectionBlockTitle}><Layers aria-hidden="true" /> Career Progression</div>
                            <div className={s.sectionBlockDesc}>Ranked career levels for {selectedDept} — progression from junior to senior</div>
                          </div>
                          <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={() => router.push(`/dashboard/recruiter/learning?tab=career-framework&department=${encodeURIComponent(selectedDept)}`)}>
                            Manage <ChevronRight aria-hidden="true" />
                          </button>
                        </div>
                        <div className={s.sectionBlockBody}>
                          <div className={s.progression}>
                            {selectedInfo.levels.map((level, idx) => {
                              const lvlEmployees = selectedInfo.employees.filter((e) => {
                                const jt = (e.job_title || "").toLowerCase();
                                const rt = (level.role_title || "").toLowerCase();
                                return jt === rt || jt.includes(rt) || rt.includes(jt);
                              });
                              return (
                                <div key={level.id} className={s.levelWrap}>
                                  {idx > 0 && (
                                    <div className={s.levelArrow}>
                                      <div className={s.levelArrowLine} />
                                      <ChevronRight aria-hidden="true" />
                                    </div>
                                  )}
                                  <div className={s.levelCard}>
                                    <div className={s.levelHead}>
                                      <span className={s.levelBadge}><GraduationCap aria-hidden="true" /> L{level.level_number}</span>
                                      {lvlEmployees.length > 0 && (
                                        <span className={s.levelEmployees}><Users aria-hidden="true" /> {lvlEmployees.length}</span>
                                      )}
                                    </div>
                                    <div className={s.levelTitle}>{level.role_title}</div>
                                    <div className={s.levelFacts}>
                                      {level.min_experience_years > 0 && (
                                        <div className={s.levelFact}><Clock aria-hidden="true" /> Min {level.min_experience_years}yr experience</div>
                                      )}
                                      {level.min_time_in_current_role_months > 0 && (
                                        <div className={s.levelFact}><Calendar aria-hidden="true" /> {level.min_time_in_current_role_months}mo in role</div>
                                      )}
                                    </div>
                                    {level.required_skills?.length > 0 && (
                                      <>
                                        <div className={s.sectionLabel2}>Skills ({level.required_skills.length})</div>
                                        <div className={s.skillChips}>
                                          {level.required_skills.slice(0, 5).map((sk, i) => (
                                            <span key={i} className={s.skillChip}>{sk.skill}</span>
                                          ))}
                                          {level.required_skills.length > 5 && <span className={s.levelMore}>+{level.required_skills.length - 5}</span>}
                                        </div>
                                      </>
                                    )}
                                    {level.required_certifications?.length > 0 && (
                                      <>
                                        <div className={s.sectionLabel2}>Certifications ({level.required_certifications.length})</div>
                                        <div className={s.skillChips}>
                                          {level.required_certifications.map((c, i) => (
                                            <span key={i} className={s.certChip}>{c.certification}</span>
                                          ))}
                                        </div>
                                      </>
                                    )}
                                    {level.learning_path?.length > 0 && (
                                      <>
                                        <div className={s.sectionLabel2}>Courses ({level.learning_path.length})</div>
                                        {level.learning_path.slice(0, 2).map((c, i) => (
                                          <div key={i} className={s.courseRow}>
                                            <span className={s.courseNum}>{c.order}.</span> {c.course_title}
                                          </div>
                                        ))}
                                        {level.learning_path.length > 2 && <div className={s.levelMore}>+{level.learning_path.length - 2} more</div>}
                                      </>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}

                    {selectedInfo.levels.length === 0 && (
                      <div className={s.sectionBlock}>
                        <div className={s.sectionBlockBody}>
                          <div className={s.emptyState}>
                            <div className={s.emptyIcon}><Layers aria-hidden="true" /></div>
                            <div className={s.emptyTitle}>No career levels defined</div>
                            <p className={s.emptyDesc}>Define career levels to establish a clear progression path for {selectedDept}.</p>
                            <button type="button" className={`${s.btn} ${s.btnPrimary}`} style={{ marginTop: 14 }} onClick={() => router.push(`/dashboard/recruiter/learning?tab=career-framework&department=${encodeURIComponent(selectedDept)}`)}>
                              <Plus style={{ width: 14, height: 14 }} /> Define career framework
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ── Career Tracks ── */}
                    <div className={s.sectionBlock}>
                      <div className={s.sectionBlockHead}>
                        <div>
                          <div className={s.sectionBlockTitle}><Compass aria-hidden="true" /> Career Tracks</div>
                          <div className={s.sectionBlockDesc}>Defined career progression tracks for this department</div>
                        </div>
                      </div>
                      <div className={s.sectionBlockBody}>
                        {selectedInfo.tracks.length === 0 ? (
                          <div className={s.emptyState} style={{ padding: "32px 16px" }}>
                            <div className={s.emptyIcon} style={{ width: 44, height: 44, borderRadius: 12 }}><Compass aria-hidden="true" /></div>
                            <div className={s.emptyTitle}>No career tracks yet</div>
                            <p className={s.emptyDesc}>Create career tracks to define progression paths within this department.</p>
                          </div>
                        ) : (
                          <div className={s.trackCards}>
                            {selectedInfo.tracks.map((t) => (
                              <div key={t.id} className={s.trackCard}>
                                <div className={s.trackCardHead}>
                                  <div className={s.trackCardIcon}>{(t.track_name || "?").slice(0, 2).toUpperCase()}</div>
                                  <div className={s.trackCardName}>{t.track_name}</div>
                                </div>
                                {t.description && <div className={s.trackCardDesc}>{t.description}</div>}
                                <div className={s.trackCardMeta}>
                                  <span className={s.trackCardChip}><GraduationCap aria-hidden="true" /> {selectedInfo.levels.filter((l) => l.department === t.department).length} levels</span>
                                  <span className={s.trackCardChip}><Target aria-hidden="true" /> {selectedInfo.employees.length} employees</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* ── Employees ── */}
                    <div className={s.sectionBlock}>
                      <div className={s.sectionBlockHead}>
                        <div>
                          <div className={s.sectionBlockTitle}><Users aria-hidden="true" /> Employees ({selectedInfo.employees.length})</div>
                          <div className={s.sectionBlockDesc}>All active employees in {selectedDept}</div>
                        </div>
                        <div className={`${s.searchWrap} ${s.headSearch}`}>
                          <Search className={s.searchIcon} aria-hidden="true" />
                          <input className={s.searchInput} aria-label="Filter employees" placeholder="Filter employees…" value={empSearch} onChange={(e) => setEmpSearch(e.target.value)} />
                        </div>
                      </div>
                      <div className={s.sectionBlockBody}>
                        {selectedInfo.employees.length === 0 ? (
                          <div className={s.emptyState} style={{ padding: "32px 16px" }}>
                            <div className={s.emptyIcon} style={{ width: 44, height: 44, borderRadius: 12 }}><Users aria-hidden="true" /></div>
                            <div className={s.emptyTitle}>No employees</div>
                            <p className={s.emptyDesc}>No employees are currently assigned to {selectedDept}.</p>
                          </div>
                        ) : (
                          <div className={s.tableContainer}>
                            <div className={s.tableWrap}>
                              <table className={s.table}>
                                <thead>
                                  <tr>
                                    <th>Employee</th>
                                    <th>Designation</th>
                                    <th>Status</th>
                                    <th style={{ textAlign: "right" }}>Actions</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {selectedInfo.filteredEmployees.slice(0, 25).map((emp) => {
                                    const hasLevel = selectedInfo.levels.some((l) => {
                                      const rt = (l.role_title || "").toLowerCase();
                                      const jt = (emp.job_title || "").toLowerCase();
                                      return jt === rt || jt.includes(rt) || rt.includes(jt);
                                    });
                                    return (
                                      <tr key={emp.employee_id}>
                                        <td>
                                          <div className={s.empCell}>
                                            <div className={s.empAvatar}>{(emp.full_name || "?").slice(0, 1).toUpperCase()}</div>
                                            <div>
                                              <div className={s.empName}>{emp.full_name}</div>
                                              <div className={s.empMeta}>{emp.employee_id}</div>
                                            </div>
                                          </div>
                                        </td>
                                        <td><span className={s.statusPill} style={{ background: "var(--blue-lighter)", color: "var(--navy-2)" }}>{emp.job_title || "—"}</span></td>
                                        <td><span className={`${s.statusPill} ${hasLevel ? s.green : s.orange}`}>{hasLevel ? "On track" : "No level"}</span></td>
                                        <td style={{ textAlign: "right" }}>
                                          <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={() => router.push(`/dashboard/recruiter/employees/${emp.employee_id}`)}>
                                            <Eye aria-hidden="true" /> View
                                          </button>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                            {selectedInfo.filteredEmployees.length > 25 && (
                              <div className={s.tableFooter}>
                                <span>Showing 25 of {selectedInfo.filteredEmployees.length} employee{selectedInfo.filteredEmployees.length !== 1 ? "s" : ""}</span>
                                <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={() => router.push("/dashboard/recruiter/employees")}>View all</button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* ─── Right Insights Panel ─── */}
                  <div className={s.bodyAside}>
                    <div className={s.insightsPanel}>
                      <div className={s.insightHead}>
                        <div className={s.insightTitle}>Department Insights</div>
                      </div>

                      {/* Department Health */}
                      <div className={s.insightCard}>
                        <div className={s.insightCardHead}>
                          <div className={s.insightCardIcon} style={{ background: "var(--green-light)", color: "var(--green)" }}><ShieldCheck aria-hidden="true" /></div>
                          <div className={s.insightCardLabel}>Department Health</div>
                        </div>
                        <div className={s.insightCardValue} style={{ color: healthColor }}>{healthScore}%</div>
                        <div className={s.insightCardDesc}>{deptsWithLevels} of {departments.length} departments have career frameworks defined.</div>
                      </div>

                      {/* Employees */}
                      <div className={s.insightCard}>
                        <div className={s.insightCardHead}>
                          <div className={s.insightCardIcon} style={{ background: "var(--cyan)", color: "#fff" }}><Users aria-hidden="true" /></div>
                          <div className={s.insightCardLabel}>Employees</div>
                        </div>
                        <div className={s.insightCardValue}>{selectedInfo.employees.length}</div>
                        <div className={s.insightCardDesc}>Active employees currently in {selectedDept}.</div>
                      </div>

                      {/* Top Skills */}
                      {selectedInfo.levels.length > 0 && (
                        <div className={s.insightCard}>
                          <div className={s.insightCardHead}>
                            <div className={s.insightCardIcon} style={{ background: "var(--blue-light)", color: "var(--blue-strong)" }}><Zap aria-hidden="true" /></div>
                            <div className={s.insightCardLabel}>Top Skills</div>
                          </div>
                          <div className={s.insightSkillList}>
                            {[...new Set(selectedInfo.levels.flatMap((l) => (l.required_skills || []).map((sk) => sk.skill)))].slice(0, 10).map((skill) => (
                              <span key={skill} className={`${s.insightSkill} ${s.insightSkillTop}`}>{skill}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Designations */}
                      {selectedInfo.allDesignations.length > 0 && (
                        <div className={s.insightCard}>
                          <div className={s.insightCardHead}>
                            <div className={s.insightCardIcon} style={{ background: "var(--orange-light)", color: "#a57500" }}><Award aria-hidden="true" /></div>
                            <div className={s.insightCardLabel}>Designations</div>
                          </div>
                          <div className={s.insightSkillList}>
                            {selectedInfo.allDesignations.slice(0, 6).map(([title, count]) => (
                              <span key={title} className={s.insightSkill} style={{ background: "var(--orange-light)", color: "#a57500", border: "1px solid #f6e0b8" }}>
                                {title} ({count})
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Career Tracks */}
                      <div className={s.insightCard}>
                        <div className={s.insightCardHead}>
                          <div className={s.insightCardIcon} style={{ background: "var(--navy-2)", color: "#fff" }}><Compass aria-hidden="true" /></div>
                          <div className={s.insightCardLabel}>Career Tracks</div>
                        </div>
                        <div className={s.insightCardValue}>{selectedInfo.tracks.length}</div>
                        <div className={s.insightCardDesc}>
                          {selectedInfo.tracks.length > 0
                            ? `${selectedInfo.tracks.map((t) => t.track_name).join(", ")}`
                            : "No career tracks defined for this department."}
                        </div>
                      </div>

                      {/* Quick Actions */}
                      <div className={s.insightCard}>
                        <div className={s.insightCardHead}>
                          <div className={s.insightCardIcon} style={{ background: "var(--purple-light)", color: "var(--purple)" }}><Zap aria-hidden="true" /></div>
                          <div className={s.insightCardLabel}>Quick Actions</div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <button type="button" className={`${s.btn} ${s.btnSecondary}`} style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => router.push(`/dashboard/recruiter/learning?tab=career-framework&department=${encodeURIComponent(selectedDept)}`)}>
                            <Briefcase aria-hidden="true" /> Manage Career Framework
                          </button>
                          <button type="button" className={`${s.btn} ${s.btnSecondary}`} style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => router.push(`/dashboard/recruiter/learning?tab=analytics`)}>
                            <TrendingUp aria-hidden="true" /> Learning Analytics
                          </button>
                          <button type="button" className={`${s.btn} ${s.btnSecondary}`} style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => router.push("/dashboard/recruiter/employees")}>
                            <Users aria-hidden="true" /> View All Employees
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </RecruiterShell>

    {/* Delete confirmation modal */}
    {deleteTarget && (
      <div style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(12, 42, 65, 0.4)",
        backdropFilter: "blur(4px)",
      }} onClick={(e) => { if (e.target === e.currentTarget) setDeleteTarget(null); }}>
        <div style={{
          background: "#fff",
          borderRadius: 16,
          border: "1px solid var(--border)",
          boxShadow: "0 24px 60px -24px rgba(21, 61, 94, 0.35)",
          padding: 28,
          maxWidth: 420,
          width: "100%",
          margin: 16,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "var(--red-light)", color: "var(--red)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Trash2 aria-hidden="true" size={18} />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 750, color: "var(--navy)", fontFamily: "'Sora', system-ui, sans-serif" }}>Delete department</div>
            </div>
          </div>
          <p style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.55, margin: 0, marginBottom: 6 }}>
            Are you sure you want to delete <strong style={{ color: "var(--navy)" }}>{deleteTarget}</strong>?
          </p>
          <p style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5, margin: 0, marginBottom: 20 }}>
            This removes the department from the organization framework. Employees assigned to this department will not be affected — they keep their department field unchanged. This action cannot be undone.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className={`${s.btn} ${s.btnSecondary}`} onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </button>
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={handleDeleteDepartment} disabled={deleting} style={{ background: "var(--red)", boxShadow: "0 6px 14px -6px rgba(229, 72, 77, 0.6)" }}>
              {deleting ? "Deleting…" : "Delete department"}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

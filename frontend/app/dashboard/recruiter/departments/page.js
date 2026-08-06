"use client";

import { Suspense } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import ProtectedRecruiterRoute from "@/components/ProtectedRecruiterRoute";
import RecruiterShell from "@/components/recruiter/RecruiterShell";
import RecruiterLoader from "@/components/recruiter/RecruiterLoader";
import shellStyles from "@/components/recruiter/recruiter-shell.module.css";
import learnStyles from "@/app/dashboard/recruiter/learning/learning.module.css";
import { getApiErrorMessage, listEmployees } from "@/services/authService";
import { listCareerLevels, listCareerTracks } from "@/services/careerService";
import { getOrgTaxonomy } from "@/services/learningService";
import { publishRecruiterContext, clearRecruiterContext } from "@/lib/ai/recruiterContext";
import {
  Building2,
  Briefcase,
  Calendar,
  ChevronRight,
  GraduationCap,
  Search,
  Users,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default function RecruiterDepartmentsPage() {
  return (
    <ProtectedRecruiterRoute requiredCapability="learning">
      <Suspense fallback={<RecruiterLoader />}>
        <DepartmentsContent />
      </Suspense>
    </ProtectedRecruiterRoute>
  );
}

function DepartmentsContent() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState([]);
  const [employeeMap, setEmployeeMap] = useState({});
  const [levelsMap, setLevelsMap] = useState({});
  const [tracksMap, setTracksMap] = useState({});
  const [selectedDept, setSelectedDept] = useState(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    publishRecruiterContext({ tab: "departments", section: "departments", hint: "Department management", fields: [] });
    return () => clearRecruiterContext();
  }, []);

  const loadData = useCallback(async () => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    try {
      const [taxonomy, levelsData, tracksData] = await Promise.all([
        getOrgTaxonomy(token, { force: true }),
        listCareerLevels(token),
        listCareerTracks(token),
      ]);

      const deptNames = taxonomy.departments || [];

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
        topDesignations: Object.entries(eMap[name]?.designations || {})
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5),
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
    return { dept, employees: empData.employees, designations: Object.keys(empData.designations || {}), levels, tracks };
  }, [selectedDept, departments, employeeMap, levelsMap, tracksMap]);

  const totalEmployees = departments.reduce((sum, d) => sum + d.employeeCount, 0);

  return (
    <RecruiterShell
      activeKey="departments"
      capability="learning"
      title="Departments"
      subtitle="View and manage organizational departments, employees, and career progressions"
    >
      {loading ? (
        <RecruiterLoader inline />
      ) : departments.length === 0 ? (
        <div className={shellStyles.section}>
          <div className={shellStyles.sectionBody}>
            <div className={learnStyles.emptyState}>
              <div className={learnStyles.emptyStateIcon}><Building2 aria-hidden="true" /></div>
              <div className={learnStyles.emptyStateTitle}>No departments found</div>
              <p className={learnStyles.emptyStateHint}>Departments will appear once employees are assigned to departments.</p>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className={shellStyles.section} style={{ marginBottom: 16 }}>
            <div className={shellStyles.sectionBody}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                {[
                  { label: "Departments", value: departments.length, icon: Building2, color: "cyan" },
                  { label: "Total employees", value: totalEmployees, icon: Users, color: "green" },
                  { label: "Career levels defined", value: Object.values(levelsMap).reduce((s, a) => s + a.length, 0), icon: GraduationCap, color: "orange" },
                  { label: "Career tracks", value: Object.values(tracksMap).reduce((s, a) => s + a.length, 0), icon: Briefcase, color: "navy" },
                ].map((stat) => {
                  const Icon = stat.icon;
                  return (
                    <div key={stat.label} className={shellStyles.statCard} style={{ flex: "1 1 180px" }}>
                      <div className={shellStyles.statTop}>
                        <span className={`${shellStyles.statIcon} ${shellStyles[stat.color]}`}>
                          <Icon aria-hidden="true" />
                        </span>
                      </div>
                      <div className={shellStyles.statValue}>{stat.value}</div>
                      <div className={shellStyles.statLabel}>{stat.label}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className={learnStyles.deptLayout}>
            <div className={learnStyles.deptSidebar}>
              <div className={learnStyles.deptSidebarHead}>
                <div className={learnStyles.deptSidebarTitle}>All departments</div>
                <div className={learnStyles.deptSidebarHint}>{filteredDepts.length} department{filteredDepts.length !== 1 ? "s" : ""} · {totalEmployees} total employees</div>
              </div>
              <div className={learnStyles.deptSearch}>
                <div className={learnStyles.deptSearchWrap}>
                  <Search className={learnStyles.deptSearchIcon} aria-hidden="true" />
                  <input
                    className={learnStyles.deptSearchInput}
                    aria-label="Search departments"
                    placeholder="Search departments…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
              <div className={learnStyles.deptItemList}>
                {filteredDepts.map((d) => (
                  <button
                    key={d.name}
                    type="button"
                    className={`${learnStyles.deptItem} ${selectedDept === d.name ? learnStyles.deptItemActive : ""}`}
                    onClick={() => setSelectedDept(d.name)}
                  >
                    <div className={learnStyles.deptItemIcon}>
                      {d.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className={learnStyles.deptItemBody}>
                      <div className={learnStyles.deptItemName}>{d.name}</div>
                      <div className={learnStyles.deptItemMeta}>
                        <Users aria-hidden="true" /> {d.employeeCount} employee{d.employeeCount !== 1 ? "s" : ""}
                        <span style={{ opacity: 0.4 }}>·</span>
                        {d.levelCount} level{d.levelCount !== 1 ? "s" : ""}
                      </div>
                    </div>
                    <span className={learnStyles.deptItemBadge}>
                      {d.employeeCount}
                    </span>
                  </button>
                ))}
                {filteredDepts.length === 0 && (
                  <div style={{ padding: "24px 16px", textAlign: "center", fontSize: 12.5, color: "var(--text-muted)" }}>
                    No departments match "{search}"
                  </div>
                )}
              </div>
            </div>

            <div className={learnStyles.deptDetail}>
              {!selectedDept ? (
                <div className={learnStyles.emptyState}>
                  <div className={learnStyles.emptyStateIcon}><Building2 aria-hidden="true" /></div>
                  <div className={learnStyles.emptyStateTitle}>Select a department</div>
                  <p className={learnStyles.emptyStateHint}>Choose a department from the list to view its employees, designations, and career progression.</p>
                </div>
              ) : (
                <>
                  <div className={learnStyles.deptDetailHeader}>
                    <div>
                      <div className={learnStyles.deptDetailTitle}>{selectedDept}</div>
                      <div className={learnStyles.deptDetailSubtitle}>
                        {selectedInfo.employees.length} employee{selectedInfo.employees.length !== 1 ? "s" : ""}
                        {" · "}
                        {selectedInfo.designations.length} designation{selectedInfo.designations.length !== 1 ? "s" : ""}
                        {" · "}
                        {selectedInfo.levels.length} career level{selectedInfo.levels.length !== 1 ? "s" : ""}
                      </div>
                    </div>
                    <div className={learnStyles.deptDetailActions}>
                      <button
                        type="button"
                        className={learnStyles.modeBtn}
                        onClick={() => router.push(`/dashboard/recruiter/learning?tab=career-framework&department=${encodeURIComponent(selectedDept)}`)}
                      >
                        <Briefcase aria-hidden="true" /> Manage career framework
                      </button>
                      <button
                        type="button"
                        className={learnStyles.modeBtn}
                        onClick={() => router.push(`/dashboard/recruiter/learning?tab=analytics`)}
                      >
                        <Calendar aria-hidden="true" /> Learning analytics
                      </button>
                    </div>
                  </div>

                  <div className={learnStyles.deptStatGrid}>
                    {[
                      { label: "Employees", value: selectedInfo.employees.length, color: "cyan", icon: Users },
                      { label: "Career levels", value: selectedInfo.levels.length, color: "green", icon: GraduationCap },
                      { label: "Designations", value: selectedInfo.designations.length, color: "orange", icon: Briefcase },
                    ].map((s) => {
                      const Icon = s.icon;
                      return (
                        <div key={s.label} className={shellStyles.statCard}>
                          <div className={shellStyles.statTop}>
                            <span className={`${shellStyles.statIcon} ${shellStyles[s.color]}`}>
                              <Icon aria-hidden="true" />
                            </span>
                          </div>
                          <div className={shellStyles.statValue}>{s.value}</div>
                          <div className={shellStyles.statLabel}>{s.label}</div>
                        </div>
                      );
                    })}
                  </div>

                  {selectedInfo.designations.length > 0 && (
                    <div className={learnStyles.deptDetailSection}>
                      <div className={learnStyles.deptDetailSectionTitle}>
                        <Briefcase aria-hidden="true" /> Designations
                      </div>
                      <div className={learnStyles.deptDesignationChips}>
                        {selectedInfo.designations.map((d) => (
                          <span key={d} className={learnStyles.hierarchyChip}>{d}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedInfo.levels.length > 0 && (
                    <div className={learnStyles.deptDetailSection}>
                      <div className={learnStyles.deptDetailSectionTitle}>
                        <GraduationCap aria-hidden="true" /> Career Ladder ({selectedInfo.levels.length} levels)
                      </div>
                      <div className={learnStyles.cfLadder} style={{ paddingBottom: 0 }}>
                        {selectedInfo.levels.map((level, idx) => (
                          <div key={level.id} className={learnStyles.cfLevelWrap}>
                            {idx > 0 && (
                              <div className={learnStyles.cfArrow}>
                                <ChevronRight aria-hidden="true" />
                              </div>
                            )}
                            <div className={learnStyles.cfLevelCard} style={{ minWidth: 240 }}>
                              <div className={learnStyles.cfLevelHead}>
                                <span className={learnStyles.cfLevelBadge}>
                                  <GraduationCap aria-hidden="true" />L{level.level_number}
                                </span>
                              </div>
                              <div className={learnStyles.cfLevelTitle} style={{ fontSize: 13.5 }}>{level.role_title}</div>
                              {level.required_skills?.length > 0 && (
                                <>
                                  <div className={learnStyles.cfSectionLabel}>Skills ({level.required_skills.length})</div>
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                    {level.required_skills.slice(0, 4).map((s, i) => (
                                      <span key={i} className={learnStyles.cfSkillChip}>{s.skill}</span>
                                    ))}
                                    {level.required_skills.length > 4 && (
                                      <span className={learnStyles.cfMore}>+{level.required_skills.length - 4}</span>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        className={learnStyles.deptAllEmployeesLink}
                        onClick={() => router.push(`/dashboard/recruiter/learning?tab=career-framework&department=${encodeURIComponent(selectedDept)}`)}
                      >
                        Open full career framework <ChevronRight aria-hidden="true" />
                      </button>
                    </div>
                  )}

                  {selectedInfo.tracks.length > 0 && (
                    <div className={learnStyles.deptDetailSection}>
                      <div className={learnStyles.deptDetailSectionTitle}>
                        <Briefcase aria-hidden="true" /> Career Tracks ({selectedInfo.tracks.length})
                      </div>
                      {selectedInfo.tracks.map((t) => (
                        <div key={t.id} className={learnStyles.deptEmployeeRow}>
                          <div className={learnStyles.employeeAvatar} style={{ background: "linear-gradient(135deg, var(--blue-strong), var(--navy-2))" }}>
                            {(t.track_name || "?").slice(0, 2).toUpperCase()}
                          </div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className={learnStyles.deptEmployeeName}>{t.track_name}</div>
                            {t.description && <div className={learnStyles.deptEmployeeMeta}>{t.description}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedInfo.employees.length > 0 && (
                    <div className={learnStyles.deptDetailSection}>
                      <div className={learnStyles.deptDetailSectionTitle}>
                        <Users aria-hidden="true" /> Employees ({selectedInfo.employees.length})
                      </div>
                      {selectedInfo.employees.slice(0, 10).map((emp) => (
                        <div key={emp.employee_id} className={learnStyles.deptEmployeeRow}>
                          <div className={learnStyles.employeeAvatar}>
                            {(emp.full_name || "?").slice(0, 1).toUpperCase()}
                          </div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className={learnStyles.deptEmployeeName}>{emp.full_name}</div>
                            <div className={learnStyles.deptEmployeeMeta}>{emp.job_title || "—"} · {emp.employee_id}</div>
                          </div>
                          <button
                            type="button"
                            className={learnStyles.smallBtn}
                            onClick={() => router.push(`/dashboard/recruiter/employees/${emp.employee_id}`)}
                          >
                            View
                          </button>
                        </div>
                      ))}
                      {selectedInfo.employees.length > 10 && (
                        <button
                          type="button"
                          className={learnStyles.deptAllEmployeesLink}
                          onClick={() => router.push("/dashboard/recruiter/employees")}
                        >
                          View all {selectedInfo.employees.length} employees <ChevronRight aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  )}

                  {selectedInfo.employees.length === 0 && selectedInfo.levels.length === 0 && selectedInfo.designations.length === 0 && (
                    <div className={learnStyles.emptyState}>
                      <div className={learnStyles.emptyStateIcon}><Building2 aria-hidden="true" /></div>
                      <div className={learnStyles.emptyStateTitle}>No data yet for {selectedDept}</div>
                      <p className={learnStyles.emptyStateHint}>Assign employees to this department and define career levels to populate this view.</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </RecruiterShell>
  );
}

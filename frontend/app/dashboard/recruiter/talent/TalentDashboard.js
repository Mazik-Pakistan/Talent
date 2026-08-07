"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import shellStyles from "@/components/recruiter/recruiter-shell.module.css";
import styles from "./talent.module.css";
import { getApiErrorMessage, listEmployees } from "@/services/authService";
import { getTalentMetrics, searchTalent } from "@/services/talentService";
import { getPromotionReadiness } from "@/services/careerService";
import {
  AlertTriangle,
  Award,
  BarChart3,
  BookOpen,
  Building2,
  ChevronRight,
  Filter,
  Target,
  TrendingUp,
  Users,
  X,
} from "lucide-react";

const FOCUS_LABELS = {
  all: "People in scope",
  ready: "Ready for promotion (80%+)",
  almost: "Almost ready (50–79%)",
  behind: "Behind (<50%)",
  high_potential: "High potential",
  departments: "Departments (Organization Framework)",
  roles: "Roles (Organization Framework)",
  certifications: "People with certificates",
  learning: "Learning progress",
};

const INTERACTIVE_FOCUSES = new Set([
  "all",
  "ready",
  "almost",
  "behind",
  "high_potential",
  "departments",
  "roles",
  "certifications",
  "learning",
]);

function fmt(n, suffix = "") {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n}${suffix}`;
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function matchRole(employee, roleName) {
  if (!roleName) return true;
  const title = (employee.job_title || employee.current_role || "").trim().toLowerCase();
  return title === roleName.trim().toLowerCase();
}

function matchDept(employee, department) {
  if (!department) return true;
  return (employee.department || "").trim().toLowerCase() === department.trim().toLowerCase();
}

function asPromoPerson(item) {
  return {
    employee_id: item.employee_id,
    full_name: item.employee_name || item.full_name || "—",
    job_title: item.current_role || item.job_title || "—",
    department: item.department || "—",
    readiness_score: item.readiness_score,
  };
}

function hasCertificate(employee) {
  const certs = employee.certifications;
  if (Array.isArray(certs) && certs.length > 0) return true;
  return (employee.verified_certifications || employee.certification_count || 0) > 0;
}

/**
 * Overview: filters update KPIs + people from the same scoped lists.
 * Clicking a KPI shows the matching breakdown or people counted on that card.
 */
export default function TalentDashboard({
  data,
  loading: bundleLoading,
  hasStructure,
  department = "",
  role = "",
  focus = "all",
  onNavigate,
}) {
  const [scopedMetrics, setScopedMetrics] = useState(null);
  const [scopedPromo, setScopedPromo] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [scopeLoading, setScopeLoading] = useState(false);

  const cards = data?.departmentCards || [];
  const learning = data?.learning;

  // Filters use Organization Framework only.
  const departmentNames = useMemo(() => {
    const fromFramework = (data?.departments || [])
      .map((d) => (typeof d === "string" ? d : d?.name))
      .filter(Boolean);
    if (fromFramework.length) {
      return [...new Set(fromFramework)].sort((a, b) => a.localeCompare(b));
    }
    return [...new Set(cards.map((c) => c.name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }, [data, cards]);

  const frameworkRoles = useMemo(() => {
    return (data?.roles || []).map((r) => (
      typeof r === "string" ? { name: r, department: "" } : r
    )).filter((r) => r?.name);
  }, [data]);

  const roleOptions = useMemo(() => {
    const filtered = department
      ? frameworkRoles.filter((r) => matchDept({ department: r.department }, department))
      : frameworkRoles;
    return [...new Set(filtered.map((r) => r.name))].sort((a, b) => a.localeCompare(b));
  }, [frameworkRoles, department]);

  const loadScope = useCallback(async () => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setScopeLoading(true);
    try {
      const deptParam = department || undefined;
      const [metricsRes, promoRes, searchRes, empRes] = await Promise.allSettled([
        getTalentMetrics(token, deptParam, { force: true }),
        getPromotionReadiness(token, deptParam || null),
        searchTalent(token, {
          q: null,
          department: deptParam || null,
          skills: [],
          certifications: [],
          min_learning_progress: null,
          min_experience_years: null,
          min_competency_score: null,
          semantic: false,
          page: 1,
          page_size: 60,
        }),
        listEmployees(token, {
          department: deptParam,
          page_size: 100,
        }),
      ]);

      if (metricsRes.status === "fulfilled") setScopedMetrics(metricsRes.value);
      else setScopedMetrics(data?.metrics || null);

      if (promoRes.status === "fulfilled") setScopedPromo(promoRes.value);
      else setScopedPromo(data?.promotion || null);

      let list = [];
      if (searchRes.status === "fulfilled" && (searchRes.value.employees || []).length) {
        list = searchRes.value.employees || [];
      } else if (empRes.status === "fulfilled") {
        list = empRes.value.employees || [];
        const pages = empRes.value.pages || 1;
        if (pages > 1) {
          for (let page = 2; page <= pages; page += 1) {
            try {
              const more = await listEmployees(token, {
                department: deptParam,
                page,
                page_size: 100,
              });
              list = [...list, ...(more.employees || [])];
            } catch {
              break;
            }
          }
        }
      }
      if (role) list = list.filter((e) => matchRole(e, role));
      setEmployees(list);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not load scoped talent data."));
    } finally {
      setScopeLoading(false);
    }
  }, [department, role, data]);

  useEffect(() => {
    loadScope();
  }, [loadScope]);

  const metrics = scopedMetrics || data?.metrics;
  const promotion = scopedPromo || data?.promotion;
  const certStats = metrics?.certification_stats || {};

  const promoByBucket = useMemo(() => {
    const filterItem = (item) => {
      if (!matchDept(item, department)) return false;
      if (role && !matchRole(item, role)) return false;
      return true;
    };
    return {
      ready: (promotion?.ready || []).filter(filterItem).map(asPromoPerson),
      almost_ready: (promotion?.almost_ready || []).filter(filterItem).map(asPromoPerson),
      behind: (promotion?.behind || []).filter(filterItem).map(asPromoPerson),
    };
  }, [promotion, department, role]);

  const readinessMap = useMemo(() => {
    const map = new Map();
    for (const bucket of ["ready", "almost_ready", "behind"]) {
      for (const item of promoByBucket[bucket] || []) {
        map.set(item.employee_id, item);
      }
    }
    return map;
  }, [promoByBucket]);

  const highPotential = useMemo(() => {
    let list = metrics?.high_potential_employees || [];
    if (department) list = list.filter((e) => matchDept(e, department));
    if (role) list = list.filter((e) => matchRole(e, role));
    return list.map((e) => ({
      employee_id: e.employee_id,
      full_name: e.full_name || "—",
      job_title: e.job_title || "—",
      department: e.department || "—",
      skill_count: e.skill_count,
      verified_certifications: e.verified_certifications,
    }));
  }, [metrics, department, role]);

  const certifiedPeople = useMemo(
    () => employees.filter(hasCertificate),
    [employees]
  );

  const learningPeople = useMemo(() => {
    return [...employees]
      .map((e) => ({
        ...e,
        learning_progress: e.learning_progress ?? 0,
      }))
      .sort((a, b) => (b.learning_progress || 0) - (a.learning_progress || 0));
  }, [employees]);

  const headcount = employees.length;

  // Framework structure counts (not unique employee job titles).
  const deptsInScope = department ? 1 : departmentNames.length;
  const rolesInScope = role ? 1 : roleOptions.length;

  // % of people in scope who have at least one certificate (not "verified / submitted").
  const certCoverage = headcount
    ? round1((100 * certifiedPeople.length) / headcount)
    : null;

  // Average learning progress across people in scope; fall back to assignment completion rate.
  const learningAvg = useMemo(() => {
    const scored = employees.filter((e) => e.learning_progress != null);
    if (scored.length > 0) {
      const sum = scored.reduce((acc, e) => acc + (Number(e.learning_progress) || 0), 0);
      return round1(sum / scored.length);
    }
    const rate = metrics?.learning_completion_rate ?? learning?.assignment_completion_rate ?? learning?.completion_rate;
    return rate == null ? null : round1(rate);
  }, [employees, metrics, learning]);

  const departmentBreakdown = useMemo(() => {
    const names = department ? [department] : departmentNames;
    return names.map((name) => {
      const people = employees.filter((e) => matchDept(e, name));
      const deptRoles = frameworkRoles.filter((r) => matchDept({ department: r.department }, name));
      return {
        name,
        people: people.length,
        roles: deptRoles.length,
        roleNames: deptRoles.map((r) => r.name),
      };
    });
  }, [department, departmentNames, employees, frameworkRoles]);

  const roleBreakdown = useMemo(() => {
    const names = role ? [role] : roleOptions;
    return names.map((name) => {
      const people = employees.filter((e) => matchRole(e, name));
      const meta = frameworkRoles.find((r) => r.name === name);
      return {
        name,
        people: people.length,
        department: meta?.department || department || "—",
      };
    });
  }, [role, roleOptions, employees, frameworkRoles, department]);

  const visibleEmployees = useMemo(() => {
    if (focus === "ready") return promoByBucket.ready;
    if (focus === "almost") return promoByBucket.almost_ready;
    if (focus === "behind") return promoByBucket.behind;
    if (focus === "high_potential") return highPotential;
    if (focus === "certifications") return certifiedPeople;
    if (focus === "learning") return learningPeople;
    return employees;
  }, [employees, focus, promoByBucket, highPotential, certifiedPeople, learningPeople]);

  const showStructurePanel = focus === "departments" || focus === "roles";
  const showPeoplePanel = !showStructurePanel;

  const kpis = [
    {
      key: "employees",
      label: "Employees",
      value: fmt(headcount),
      icon: Users,
      color: "navy",
      focus: "all",
      interactive: true,
    },
    {
      key: "departments",
      label: department ? "Department" : "Departments",
      value: fmt(deptsInScope || null),
      icon: Building2,
      color: "cyan",
      focus: "departments",
      interactive: true,
    },
    {
      key: "roles",
      label: role ? "Role" : "Roles",
      value: fmt(rolesInScope || null),
      icon: Target,
      color: "blue",
      focus: "roles",
      interactive: true,
    },
    {
      key: "ready",
      label: "Ready (80%+)",
      value: fmt(promoByBucket.ready.length),
      icon: TrendingUp,
      color: "green",
      focus: "ready",
      interactive: true,
    },
    {
      key: "almost",
      label: "Almost Ready",
      value: fmt(promoByBucket.almost_ready.length),
      icon: Award,
      color: "orange",
      focus: "almost",
      interactive: true,
    },
    {
      key: "behind",
      label: "Behind",
      value: fmt(promoByBucket.behind.length),
      icon: AlertTriangle,
      color: "red",
      focus: "behind",
      interactive: true,
    },
    {
      key: "high_potential",
      label: "High potential",
      value: fmt(highPotential.length),
      icon: Award,
      color: "green",
      focus: "high_potential",
      interactive: true,
    },
    {
      key: "certs",
      label: "Certified people",
      value: headcount ? `${fmt(certCoverage, "%")}` : "—",
      hint: `${certifiedPeople.length} of ${headcount}`,
      icon: Award,
      color: "cyan",
      focus: "certifications",
      interactive: true,
    },
    {
      key: "learning",
      label: "Learning progress",
      value: fmt(learningAvg, "%"),
      hint: metrics?.learning_completion_rate != null
        ? `Assignments ${fmt(metrics.learning_completion_rate, "%")} complete`
        : undefined,
      icon: BookOpen,
      color: "blue",
      focus: "learning",
      interactive: true,
    },
  ];

  function setFilters({ department: nextDept, role: nextRole, focus: nextFocus }) {
    onNavigate({
      view: "dashboard",
      department: nextDept !== undefined ? nextDept : department || null,
      role: nextRole !== undefined ? nextRole : role || null,
      focus: nextFocus !== undefined ? nextFocus : focus,
      employee: null,
    });
  }

  function onKpiClick(kpi) {
    if (!kpi.interactive || !INTERACTIVE_FOCUSES.has(kpi.focus)) return;
    const next = focus === kpi.focus && kpi.focus !== "all" ? "all" : kpi.focus;
    setFilters({ focus: next });
  }

  if (bundleLoading && !data) {
    return <p className={styles.inlineNote}>Loading talent intelligence…</p>;
  }

  const scopeLabel = role
    ? `${department || "All departments"} · ${role}`
    : department
      ? department
      : "All departments";

  return (
    <div className={styles.intelStack}>
      {!hasStructure && cards.length === 0 && (
        <div className={styles.infoCard}>
          <div className={styles.infoCardText}>
            <h3 className={styles.infoCardTitle}>Organization structure not configured</h3>
            <p className={styles.infoCardDesc}>
              Configure departments and roles in Organization Setup so filters and drill-down stay accurate.
            </p>
          </div>
          <button type="button" className={styles.modeBtn} onClick={() => onNavigate({ path: "/dashboard/recruiter/organization-config" })}>
            Organization Setup
          </button>
        </div>
      )}

      <div className={styles.scopePanel}>
        <div className={styles.scopePanelHead}>
          <span className={styles.scopePanelIcon} aria-hidden="true">
            <Filter size={16} />
          </span>
          <div className={styles.scopePanelCopy}>
            <div className={styles.scopePanelTitle}>Scope</div>
            <p className={styles.scopePanelDesc}>
              Filter by Organization Framework department and role
            </p>
          </div>
          {(department || role || focus !== "all") && (
            <button
              type="button"
              className={styles.scopeResetBtn}
              onClick={() => setFilters({ department: null, role: null, focus: "all" })}
            >
              <X size={14} aria-hidden="true" />
              Clear
            </button>
          )}
        </div>

        <div className={styles.scopePanelBody}>
          <label className={styles.scopeField}>
            <span className={styles.scopeFieldLabel}>
              <Building2 size={13} aria-hidden="true" />
              Department
            </span>
            <div className={styles.scopeSelectWrap}>
              <select
                className={styles.scopeSelect}
                value={department}
                onChange={(e) => {
                  setFilters({ department: e.target.value || null, role: null, focus: "all" });
                }}
              >
                <option value="">All departments</option>
                {departmentNames.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          </label>

          <label className={styles.scopeField}>
            <span className={styles.scopeFieldLabel}>
              <Target size={13} aria-hidden="true" />
              Role
            </span>
            <div className={styles.scopeSelectWrap}>
              <select
                className={styles.scopeSelect}
                value={role}
                disabled={departmentNames.length > 0 && !!department && roleOptions.length === 0}
                onChange={(e) => setFilters({ role: e.target.value || null, focus: "all" })}
              >
                <option value="">
                  {department
                    ? (roleOptions.length ? "All roles in department" : "No roles in this department")
                    : "All roles"}
                </option>
                {roleOptions.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </label>

          <div className={styles.scopeStatus}>
            <span className={styles.scopeStatusLabel}>Viewing</span>
            <span className={styles.scopeStatusValue}>
              {scopeLabel}
              {scopeLoading ? <span className={styles.scopeStatusBusy}>Updating…</span> : null}
            </span>
          </div>
        </div>

        {departmentNames.length === 0 && (
          <p className={styles.scopeEmptyNote}>
            No Organization Framework departments yet — add them in{" "}
            <button
              type="button"
              className={styles.scopeInlineLink}
              onClick={() => onNavigate({ path: "/dashboard/recruiter/organization-config" })}
            >
              Organization Setup
            </button>
            .
          </p>
        )}
      </div>

      <div className={styles.metricGrid}>
        {kpis.map((s) => {
          const Icon = s.icon;
          const active = s.interactive && focus === s.focus && s.focus !== "all";
          return (
            <button
              key={s.key}
              type="button"
              className={`${shellStyles.statCard} ${styles.statCardBtn} ${
                active ? styles.statCardActive : ""
              }`}
              onClick={() => onKpiClick(s)}
              aria-pressed={active ? true : undefined}
              title={s.interactive ? `Show ${s.label.toLowerCase()}` : undefined}
            >
              <span className={`${shellStyles.statIcon} ${shellStyles[s.color]}`}>
                <Icon aria-hidden="true" />
              </span>
              <div className={shellStyles.statText}>
                <div className={shellStyles.statValue}>{s.value}</div>
                <div className={shellStyles.statLabel}>{s.label}</div>
                {s.hint ? <div className={styles.statHint}>{s.hint}</div> : null}
              </div>
            </button>
          );
        })}
      </div>

      {showStructurePanel && (
        <div className={shellStyles.section}>
          <div className={shellStyles.sectionHead}>
            <div className={shellStyles.sectionHeadLeft}>
              <span className={`${shellStyles.bar} ${shellStyles.cyan}`} />
              <div>
                <div className={shellStyles.sectionTitle}>
                  {FOCUS_LABELS[focus]}
                </div>
                <p className={shellStyles.sectionDesc}>
                  {scopeLabel} · click a row to filter Overview
                </p>
              </div>
            </div>
          </div>
          <div className={shellStyles.sectionBody}>
            {focus === "departments" && departmentBreakdown.length === 0 && (
              <div className={styles.emptyState}>
                <div className={styles.emptyStateTitle}>No departments in Organization Framework</div>
              </div>
            )}
            {focus === "departments" && departmentBreakdown.map((d) => (
              <button
                key={d.name}
                type="button"
                className={styles.structureRow}
                onClick={() => setFilters({ department: d.name, role: null, focus: "all" })}
              >
                <div className={styles.employeeManageMain}>
                  <div className={styles.employeeMiniName}>{d.name}</div>
                  <div className={styles.employeeMiniMeta}>
                    {d.people} people · {d.roles} framework roles
                    {d.roleNames.length ? ` · ${d.roleNames.slice(0, 4).join(", ")}${d.roleNames.length > 4 ? "…" : ""}` : ""}
                  </div>
                </div>
                <span className={styles.deptCardCta}>
                  Filter
                  <ChevronRight size={14} aria-hidden="true" />
                </span>
              </button>
            ))}

            {focus === "roles" && roleBreakdown.length === 0 && (
              <div className={styles.emptyState}>
                <div className={styles.emptyStateTitle}>
                  {department ? `No roles for ${department} in Organization Framework` : "No roles in Organization Framework"}
                </div>
              </div>
            )}
            {focus === "roles" && roleBreakdown.map((r) => (
              <button
                key={r.name}
                type="button"
                className={styles.structureRow}
                onClick={() => setFilters({
                  department: department || (r.department !== "—" ? r.department : null),
                  role: r.name,
                  focus: "all",
                })}
              >
                <div className={styles.employeeManageMain}>
                  <div className={styles.employeeMiniName}>{r.name}</div>
                  <div className={styles.employeeMiniMeta}>
                    {r.department} · {r.people} people in current scope
                  </div>
                </div>
                <span className={styles.deptCardCta}>
                  Filter
                  <ChevronRight size={14} aria-hidden="true" />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {showPeoplePanel && (
        <div className={shellStyles.section}>
          <div className={shellStyles.sectionHead}>
            <div className={shellStyles.sectionHeadLeft}>
              <span className={`${shellStyles.bar} ${shellStyles.navy}`} />
              <div>
                <div className={shellStyles.sectionTitle}>
                  {FOCUS_LABELS[focus] || "People"}
                </div>
                <p className={shellStyles.sectionDesc}>
                  {scopeLabel} · {visibleEmployees.length} shown
                  {focus === "certifications" && certStats.total_certificates != null
                    ? ` · ${fmt(certStats.verified)} verified / ${fmt(certStats.total_certificates)} certificates submitted (${fmt(certStats.certification_rate, "%")} verified)`
                    : ""}
                  {focus === "learning" && metrics?.learning_completion_rate != null
                    ? ` · assignment completion ${fmt(metrics.learning_completion_rate, "%")}`
                    : ""}
                  {focus !== "all" ? " · click the KPI again or Reset to clear" : ""}
                </p>
              </div>
            </div>
            <button
              type="button"
              className={styles.smallBtn}
              onClick={() => onNavigate({ view: "employees", department: department || null, role: null, employee: null })}
            >
              Full employee list
            </button>
          </div>
          <div className={shellStyles.sectionBody}>
            {scopeLoading && <p className={styles.inlineNote}>Loading people…</p>}
            {!scopeLoading && visibleEmployees.length === 0 && (
              <div className={styles.emptyState}>
                <div className={styles.emptyStateIcon}><BarChart3 aria-hidden="true" /></div>
                <div className={styles.emptyStateTitle}>No employees in this filter</div>
                <p className={styles.emptyStateHint}>Clear the role or KPI focus, or pick another department.</p>
              </div>
            )}
            {!scopeLoading && visibleEmployees.map((e) => {
              const promo = readinessMap.get(e.employee_id);
              const score = e.readiness_score ?? promo?.readiness_score;
              const progress = e.learning_progress;
              const certCount = Array.isArray(e.certifications)
                ? e.certifications.length
                : (e.verified_certifications || e.certification_count || 0);
              return (
                <div key={e.employee_id} className={styles.employeeManageRow}>
                  <div className={styles.employeeManageMain}>
                    <div className={styles.employeeMiniName}>{e.full_name}</div>
                    <div className={styles.employeeMiniMeta}>
                      {e.job_title || "—"} · {e.department || "—"} · {e.employee_id}
                      {focus === "certifications" && certCount ? ` · ${certCount} cert${certCount === 1 ? "" : "s"}` : ""}
                      {focus === "learning" && progress != null ? ` · ${fmt(round1(progress), "%")} learning` : ""}
                    </div>
                  </div>
                  <div className={styles.employeeManageSide}>
                    {score != null && (
                      <span
                        className={`${styles.progressBadge} ${
                          score >= 80
                            ? styles.progressBadgeGreen
                            : score >= 50
                              ? styles.progressBadgeOrange
                              : styles.progressBadgeRed
                        }`}
                      >
                        {score}% ready
                      </span>
                    )}
                    {focus === "learning" && progress != null && score == null && (
                      <span className={`${styles.progressBadge} ${styles.progressBadgeOrange}`}>
                        {fmt(round1(progress), "%")}
                      </span>
                    )}
                    <button
                      type="button"
                      className={styles.smallBtnPrimary}
                      onClick={() => onNavigate({
                        view: "profile",
                        employee: e.employee_id,
                        department: e.department || department || null,
                        role: e.job_title || role || null,
                      })}
                    >
                      Manage
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

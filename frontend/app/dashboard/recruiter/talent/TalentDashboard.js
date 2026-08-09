"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import shellStyles from "@/components/recruiter/recruiter-shell.module.css";
import styles from "./talent.module.css";
import { getApiErrorMessage, listEmployees } from "@/services/authService";
import {
  getTalentMetrics,
  getTalentRequirementsStatus,
  searchTalent,
} from "@/services/talentService";
import { getPromotionReadiness } from "@/services/careerService";
import { roleSkillCoverage } from "@/components/recruiter/SkillMatrixBars";
import {
  AlertTriangle,
  Award,
  BarChart3,
  BookOpen,
  Building2,
  ChevronRight,
  ClipboardList,
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
  behind: "Behind on path (<50%)",
  high_potential: "High potential",
  departments: "Departments",
  roles: "Roles",
  certifications: "People with certificates",
  learning: "Learning progress",
  incomplete: "Incomplete requirements (blocked / missing data)",
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
  "incomplete",
]);

const SORT_OPTIONS = [
  { key: "readiness", label: "Readiness" },
  { key: "progress", label: "Learning progress" },
  { key: "incomplete", label: "Incomplete requirements" },
  { key: "name", label: "Name" },
];

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
    progress_percent: item.progress_percent,
  };
}

function hasCertificate(employee) {
  const certs = employee.certifications;
  if (Array.isArray(certs) && certs.length > 0) return true;
  return (employee.verified_certifications || employee.certification_count || 0) > 0;
}

function Breadcrumbs({ crumbs }) {
  return (
    <nav className={styles.breadcrumbs} aria-label="Overview breadcrumb">
      {crumbs.map((c, i) => (
        <span key={c.key} className={styles.breadcrumbItem}>
          {i > 0 && <ChevronRight size={14} className={styles.breadcrumbSep} aria-hidden="true" />}
          {c.onClick ? (
            <button type="button" className={styles.breadcrumbLink} onClick={c.onClick}>{c.label}</button>
          ) : (
            <span className={styles.breadcrumbCurrent}>{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

/**
 * Hierarchical Talent Progress CIC: Org → Dept → Role → people,
 * with unified KPIs, ranking, and incomplete-requirements focus.
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
  const [scopedReq, setScopedReq] = useState(null);
  const [sortBy, setSortBy] = useState("readiness");

  const cards = data?.departmentCards || [];
  const incompleteByEmployee = data?.incompleteByEmployee || {};

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
      const [metricsRes, promoRes, searchRes, empRes, reqRes] = await Promise.allSettled([
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
        getTalentRequirementsStatus(token, {
          department: deptParam || undefined,
          role: role || undefined,
          page_size: 200,
        }),
      ]);

      if (metricsRes.status === "fulfilled") setScopedMetrics(metricsRes.value);
      else setScopedMetrics(data?.metrics || null);

      if (promoRes.status === "fulfilled") setScopedPromo(promoRes.value);
      else setScopedPromo(data?.promotion || null);

      if (reqRes.status === "fulfilled") setScopedReq(reqRes.value);
      else setScopedReq(data?.requirements || null);

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
  const requirements = scopedReq || data?.requirements;

  const incompleteMap = useMemo(() => {
    const map = { ...incompleteByEmployee };
    for (const row of requirements?.employees || []) {
      if (row?.employee_id) map[row.employee_id] = row;
    }
    return map;
  }, [incompleteByEmployee, requirements]);

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

  const certifiedPeople = useMemo(() => employees.filter(hasCertificate), [employees]);

  const learningPeople = useMemo(() => {
    return [...employees]
      .map((e) => ({ ...e, learning_progress: e.learning_progress ?? 0 }))
      .sort((a, b) => (b.learning_progress || 0) - (a.learning_progress || 0));
  }, [employees]);

  const incompletePeople = useMemo(() => {
    return employees
      .map((e) => {
        const req = incompleteMap[e.employee_id];
        return req && req.open_total > 0 ? { ...e, ...req } : null;
      })
      .filter(Boolean)
      .sort((a, b) => (b.open_high || 0) - (a.open_high || 0) || (b.open_total || 0) - (a.open_total || 0));
  }, [employees, incompleteMap]);

  const headcount = employees.length;
  // Counts must reflect people actually in scope — never invent org-wide structure when a role filter is empty.
  const deptsInScope = department
    ? 1
    : role
      ? new Set(
          employees
            .map((e) => (e.department || "").trim())
            .filter(Boolean)
        ).size
      : departmentNames.length;
  const rolesInScope = role ? 1 : roleOptions.length;

  const certCoverage = headcount ? round1((100 * certifiedPeople.length) / headcount) : null;

  // Only average learning for people in the current scope. No org-wide fallback (avoids "15% with 0 people").
  const learningAvg = useMemo(() => {
    if (!employees.length) return null;
    const scored = employees.filter((e) => e.learning_progress != null && !Number.isNaN(Number(e.learning_progress)));
    if (!scored.length) return null;
    const sum = scored.reduce((acc, e) => acc + (Number(e.learning_progress) || 0), 0);
    return round1(sum / scored.length);
  }, [employees]);

  const incompleteCount = useMemo(() => {
    if (department || role) {
      return incompletePeople.length;
    }
    return requirements?.incomplete_count ?? incompletePeople.length;
  }, [department, role, incompletePeople, requirements]);

  const rankedDepartments = useMemo(() => {
    const list = department ? cards.filter((c) => c.name === department) : [...cards];
    return list.sort((a, b) => {
      if (sortBy === "incomplete") {
        return (b.incompleteHigh ?? 0) - (a.incompleteHigh ?? 0)
          || (b.incompleteRequirements ?? 0) - (a.incompleteRequirements ?? 0);
      }
      if (sortBy === "name") return a.name.localeCompare(b.name);
      const ap = a.avgProgress ?? a.avgReadiness ?? -1;
      const bp = b.avgProgress ?? b.avgReadiness ?? -1;
      return bp - ap;
    });
  }, [cards, department, sortBy]);

  const rankedRoles = useMemo(() => {
    const names = role ? [role] : roleOptions;
    return names.map((name) => {
      const people = employees.filter((e) => matchRole(e, name));
      const meta = frameworkRoles.find((r) => r.name === name);
      let ready = 0;
      let almost = 0;
      let behind = 0;
      let readinessSum = 0;
      let readinessN = 0;
      let incomplete = 0;
      for (const e of people) {
        const promo = readinessMap.get(e.employee_id);
        const score = e.readiness_score ?? promo?.readiness_score;
        if (score != null) {
          readinessSum += Number(score);
          readinessN += 1;
          if (score >= 80) ready += 1;
          else if (score >= 50) almost += 1;
          else behind += 1;
        }
        const req = incompleteMap[e.employee_id];
        if (req?.open_high > 0 || req?.open_total > 0) incomplete += 1;
      }
      return {
        name,
        people: people.length,
        department: meta?.department || department || "—",
        ready,
        almost,
        behind,
        avgReadiness: readinessN ? round1(readinessSum / readinessN) : null,
        incomplete,
        meta,
      };
    }).sort((a, b) => {
      if (sortBy === "incomplete") return b.incomplete - a.incomplete;
      if (sortBy === "name") return a.name.localeCompare(b.name);
      return (b.avgReadiness ?? -1) - (a.avgReadiness ?? -1);
    });
  }, [role, roleOptions, employees, frameworkRoles, department, readinessMap, incompleteMap, sortBy]);

  const roleFrameworkSkills = useMemo(() => {
    if (!role) return [];
    const list = data?.skills || [];
    return list.filter((s) => {
      const roles = s.roles || s.role_names || [];
      if (Array.isArray(roles) && roles.length) return roles.includes(role);
      return s.role === role || (department && s.department === department);
    });
  }, [data, role, department]);

  const roleFrameworkCerts = useMemo(() => {
    if (!role) return [];
    const list = data?.certifications || [];
    return list.filter((c) => {
      const roles = c.roles || c.role_names || [];
      if (Array.isArray(roles) && roles.length) return roles.includes(role);
      return c.role === role || (department && c.department === department);
    });
  }, [data, role, department]);

  const coverageRows = useMemo(() => {
    if (!role) return [];
    const required = roleFrameworkSkills.map((s) => s.name || s.skill_name).filter(Boolean);
    const holderSkills = employees.map((e) => e.skills || []);
    return roleSkillCoverage(required, holderSkills);
  }, [role, roleFrameworkSkills, employees]);

  const sortedEmployees = useMemo(() => {
    const list = [...employees];
    list.sort((a, b) => {
      if (sortBy === "name") {
        return (a.full_name || "").localeCompare(b.full_name || "");
      }
      if (sortBy === "progress") {
        return (b.learning_progress ?? -1) - (a.learning_progress ?? -1);
      }
      if (sortBy === "incomplete") {
        const ar = incompleteMap[a.employee_id];
        const br = incompleteMap[b.employee_id];
        return (br?.open_high ?? 0) - (ar?.open_high ?? 0)
          || (br?.open_total ?? 0) - (ar?.open_total ?? 0);
      }
      const as = a.readiness_score ?? readinessMap.get(a.employee_id)?.readiness_score ?? -1;
      const bs = b.readiness_score ?? readinessMap.get(b.employee_id)?.readiness_score ?? -1;
      return bs - as;
    });
    return list;
  }, [employees, sortBy, readinessMap, incompleteMap]);

  const visibleEmployees = useMemo(() => {
    if (focus === "ready") return promoByBucket.ready;
    if (focus === "almost") return promoByBucket.almost_ready;
    if (focus === "behind") return promoByBucket.behind;
    if (focus === "high_potential") return highPotential;
    if (focus === "certifications") return certifiedPeople;
    if (focus === "learning") return learningPeople;
    if (focus === "incomplete") return incompletePeople;
    return sortedEmployees;
  }, [
    sortedEmployees,
    focus,
    promoByBucket,
    highPotential,
    certifiedPeople,
    learningPeople,
    incompletePeople,
  ]);

  const showStructurePanel = focus === "departments" || focus === "roles";
  const showPeoplePanel = !showStructurePanel;
  const level = role && department ? "role" : department ? "dept" : "org";

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
      label: "Behind on path",
      value: fmt(promoByBucket.behind.length),
      icon: AlertTriangle,
      color: "red",
      focus: "behind",
      interactive: true,
    },
    {
      key: "incomplete",
      label: "Incomplete reqs",
      value: fmt(incompleteCount),
      hint: "Missing CV, docs, profile, or path data",
      icon: ClipboardList,
      color: "orange",
      focus: "incomplete",
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
      hint: headcount
        ? `${certifiedPeople.length} of ${headcount} in scope`
        : "No people in this scope",
      icon: Award,
      color: "cyan",
      focus: "certifications",
      interactive: true,
    },
    {
      key: "learning",
      label: "Learning progress",
      value: fmt(learningAvg, "%"),
      hint: !headcount
        ? "No people in this scope"
        : learningAvg == null
          ? "No learning scores for people in scope"
          : `Avg of ${employees.filter((e) => e.learning_progress != null).length} people in scope`,
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

  const crumbs = [
    {
      key: "org",
      label: "Organization",
      onClick: department || role
        ? () => setFilters({ department: null, role: null, focus: "all" })
        : undefined,
    },
    ...(department
      ? [{
          key: "dept",
          label: department,
          onClick: role
            ? () => setFilters({ department, role: null, focus: "all" })
            : undefined,
        }]
      : []),
    ...(role ? [{ key: "role", label: role }] : []),
  ];

  const activeCard = department
    ? cards.find((c) => c.name === department)
    : null;

  return (
    <div className={styles.intelStack}>
      <Breadcrumbs crumbs={crumbs} />

      {!hasStructure && cards.length === 0 && (
        <div className={styles.infoCard}>
          <div className={styles.infoCardText}>
            <h3 className={styles.infoCardTitle}>Organization structure not configured</h3>
            <p className={styles.infoCardDesc}>
              Configure departments and roles in Organization Setup so drill-down and KPIs stay accurate.
            </p>
          </div>
          <button type="button" className={styles.modeBtn} onClick={() => onNavigate({ path: "/dashboard/recruiter/organization-config" })}>
            Organization Setup
          </button>
        </div>
      )}

      {(department || role) && (
        <div className={styles.detailHero}>
          <div>
            <h2 className={styles.detailTitle}>{role || department}</h2>
            <p className={styles.detailDesc}>
              {role
                ? `${department} · role progress vs people in this job title`
                : (activeCard?.description || "Department progress — roles, readiness, and incomplete requirements")}
            </p>
          </div>
          <div className={styles.detailStatRow}>
            <span><Users size={14} aria-hidden="true" /> {fmt(headcount)} people</span>
            {!role && (
              <span><Target size={14} aria-hidden="true" /> {fmt(activeCard?.roleCount ?? rolesInScope)} roles</span>
            )}
            <span><TrendingUp size={14} aria-hidden="true" /> Progress {fmt(activeCard?.avgProgress, "%")}</span>
            <span><ClipboardList size={14} aria-hidden="true" /> Incomplete {fmt(incompleteCount)}</span>
          </div>
        </div>
      )}

      <div className={styles.scopePanel}>
        <div className={styles.scopePanelHead}>
          <span className={styles.scopePanelIcon} aria-hidden="true">
            <Filter size={16} />
          </span>
          <div className={styles.scopePanelCopy}>
            <div className={styles.scopePanelTitle}>Scope & ranking</div>
            <p className={styles.scopePanelDesc}>
              KPIs only count people in this scope. Incomplete requirements ≠ behind on promotion path.
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

          <label className={styles.scopeField}>
            <span className={styles.scopeFieldLabel}>Sort</span>
            <div className={styles.scopeSelectWrap}>
              <select
                className={styles.scopeSelect}
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
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

      {/* Org: ranked departments */}
      {level === "org" && focus === "all" && (
        <div className={shellStyles.section}>
          <div className={shellStyles.sectionHead}>
            <div className={shellStyles.sectionHeadLeft}>
              <span className={`${shellStyles.bar} ${shellStyles.cyan}`} />
              <div>
                <div className={shellStyles.sectionTitle}>Departments by progress</div>
                <p className={shellStyles.sectionDesc}>
                  Click a department to drill into roles and people
                </p>
              </div>
            </div>
          </div>
          <div className={shellStyles.sectionBody}>
            {rankedDepartments.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyStateIcon}><Building2 aria-hidden="true" /></div>
                <div className={styles.emptyStateTitle}>No departments yet</div>
                <p className={styles.emptyStateHint}>Configure structure in Organization Setup.</p>
              </div>
            ) : (
              <div className={styles.deptCardGrid}>
                {rankedDepartments.map((d) => (
                  <button
                    key={d.name}
                    type="button"
                    className={styles.deptCard}
                    onClick={() => setFilters({ department: d.name, role: null, focus: "all" })}
                  >
                    <div className={styles.deptCardTitle}>{d.name}</div>
                    {d.description ? <p className={styles.deptCardDesc}>{d.description}</p> : null}
                    <div className={styles.deptCardMeta}>
                      <span>{fmt(d.employeeCount)} people</span>
                      <span>{fmt(d.roleCount)} roles</span>
                      <span>Progress {fmt(d.avgProgress, "%")}</span>
                      <span>On track {fmt(d.onTrack)}</span>
                      <span>Behind {fmt(d.behind)}</span>
                      <span>Learn {fmt(d.learningCompletion, "%")}</span>
                      {(d.incompleteRequirements > 0 || d.incompleteHigh > 0) && (
                        <span className={styles.incompleteChip}>
                          {fmt(d.incompleteRequirements)} incomplete
                        </span>
                      )}
                    </div>
                    <span className={styles.deptCardCta}>
                      Open department <ChevronRight size={14} aria-hidden="true" />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Dept: ranked roles */}
      {level === "dept" && focus === "all" && (
        <div className={shellStyles.section}>
          <div className={shellStyles.sectionHead}>
            <div className={shellStyles.sectionHeadLeft}>
              <span className={`${shellStyles.bar} ${shellStyles.cyan}`} />
              <div>
                <div className={shellStyles.sectionTitle}>Roles in {department}</div>
                <p className={shellStyles.sectionDesc}>Ranked by readiness — open a role for people and skill coverage</p>
              </div>
            </div>
          </div>
          <div className={shellStyles.sectionBody}>
            {rankedRoles.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyStateTitle}>No roles for this department</div>
                <p className={styles.emptyStateHint}>Add roles in Organization Setup.</p>
              </div>
            ) : (
              rankedRoles.map((r) => (
                <button
                  key={r.name}
                  type="button"
                  className={styles.structureRow}
                  onClick={() => setFilters({ department, role: r.name, focus: "all" })}
                >
                  <div className={styles.employeeManageMain}>
                    <div className={styles.employeeMiniName}>{r.name}</div>
                    <div className={styles.employeeMiniMeta}>
                      {r.people} people · avg readiness {fmt(r.avgReadiness, "%")}
                      {" · "}ready {r.ready} · almost {r.almost} · behind {r.behind}
                      {r.incomplete > 0 ? ` · ${r.incomplete} incomplete reqs` : ""}
                    </div>
                  </div>
                  <span className={styles.deptCardCta}>
                    Open role <ChevronRight size={14} aria-hidden="true" />
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Role: skill coverage */}
      {level === "role" && focus === "all" && (
        <div className={shellStyles.section}>
          <div className={shellStyles.sectionHead}>
            <div className={shellStyles.sectionHeadLeft}>
              <span className={`${shellStyles.bar} ${shellStyles.green}`} />
              <div>
                <div className={shellStyles.sectionTitle}>Role skill coverage</div>
                <p className={shellStyles.sectionDesc}>
                  Framework skills for this role vs people currently in the title
                </p>
              </div>
            </div>
          </div>
          <div className={shellStyles.sectionBody}>
            {roleFrameworkSkills.length === 0 && roleFrameworkCerts.length === 0 && (
              <p className={styles.inlineNote}>
                No skills or certifications linked to this role in Organization Setup yet.
              </p>
            )}
            {coverageRows.length > 0 && (
              <div className={styles.skillMatrixList}>
                {coverageRows.map((row) => (
                  <div key={row.name} className={styles.skillMatrixRow}>
                    <span className={styles.skillMatrixName} title={row.name}>{row.name}</span>
                    <div className={styles.skillMatrixTrack}>
                      <div className={styles.skillMatrixFill} style={{ width: `${row.coverage}%` }} />
                    </div>
                    <span className={styles.skillMatrixProf}>{row.have}/{row.total} · {row.coverage}%</span>
                  </div>
                ))}
              </div>
            )}
            {roleFrameworkCerts.length > 0 && (
              <div className={styles.chipRow} style={{ marginTop: 12 }}>
                {roleFrameworkCerts.map((c) => (
                  <span key={c.id || c.name} className={`${styles.softChip} ${styles.softChipAccent}`}>
                    {c.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showStructurePanel && (
        <div className={shellStyles.section}>
          <div className={shellStyles.sectionHead}>
            <div className={shellStyles.sectionHeadLeft}>
              <span className={`${shellStyles.bar} ${shellStyles.cyan}`} />
              <div>
                <div className={shellStyles.sectionTitle}>{FOCUS_LABELS[focus]}</div>
                <p className={shellStyles.sectionDesc}>{scopeLabel} · click a row to drill down</p>
              </div>
            </div>
          </div>
          <div className={shellStyles.sectionBody}>
            {focus === "departments" && rankedDepartments.map((d) => (
              <button
                key={d.name}
                type="button"
                className={styles.structureRow}
                onClick={() => setFilters({ department: d.name, role: null, focus: "all" })}
              >
                <div className={styles.employeeManageMain}>
                  <div className={styles.employeeMiniName}>{d.name}</div>
                  <div className={styles.employeeMiniMeta}>
                    {fmt(d.employeeCount)} people · progress {fmt(d.avgProgress, "%")}
                    {d.incompleteRequirements > 0 ? ` · ${d.incompleteRequirements} incomplete` : ""}
                  </div>
                </div>
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            ))}
            {focus === "roles" && rankedRoles.map((r) => (
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
                    {r.department} · {r.people} people · avg {fmt(r.avgReadiness, "%")}
                  </div>
                </div>
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      )}

      {showPeoplePanel && (level !== "org" || focus !== "all") && (
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
                  {focus === "incomplete"
                    ? " · blocked / missing data (not the same as behind on promotion)"
                    : ""}
                  {focus === "behind"
                    ? " · on a career path but readiness under 50%"
                    : ""}
                  {focus === "certifications" && certStats.total_certificates != null
                    ? ` · ${fmt(certStats.verified)} verified / ${fmt(certStats.total_certificates)} submitted`
                    : ""}
                </p>
              </div>
            </div>
            <button
              type="button"
              className={styles.smallBtn}
              onClick={() => onNavigate({
                view: "employees",
                department: department || null,
                role: null,
                employee: null,
                focus: focus === "incomplete" ? "incomplete" : "all",
              })}
            >
              Full employee list
            </button>
          </div>
          <div className={shellStyles.sectionBody}>
            {scopeLoading && <p className={styles.inlineNote}>Loading people…</p>}
            {!scopeLoading && visibleEmployees.length === 0 && (
              <div className={styles.emptyState}>
                <div className={styles.emptyStateIcon}><BarChart3 aria-hidden="true" /></div>
                <div className={styles.emptyStateTitle}>
                  {focus === "incomplete"
                    ? "No incomplete requirements in this scope"
                    : "No employees in this filter"}
                </div>
                <p className={styles.emptyStateHint}>
                  {focus === "incomplete"
                    ? "Everyone in scope has fulfilled the tracked checklist items — or data is still loading."
                    : "Clear the role or KPI focus, or pick another department."}
                </p>
              </div>
            )}
            {!scopeLoading && visibleEmployees.map((e) => {
              const promo = readinessMap.get(e.employee_id);
              const score = e.readiness_score ?? promo?.readiness_score;
              const progress = e.learning_progress;
              const req = incompleteMap[e.employee_id] || e;
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
                      {req?.open_total > 0
                        ? ` · ${req.open_total} open req${req.open_total === 1 ? "" : "s"}${req.open_high ? ` (${req.open_high} high)` : ""}`
                        : ""}
                    </div>
                  </div>
                  <div className={styles.employeeManageSide}>
                    {req?.open_high > 0 && (
                      <span className={`${styles.progressBadge} ${styles.progressBadgeOrange}`}>
                        Blocked / incomplete
                      </span>
                    )}
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
                    {score == null && !req?.open_total && (
                      <span className={`${styles.progressBadge} ${styles.progressBadgeMuted}`}>
                        No path data
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

      {level === "org" && focus === "all" && (
        <p className={styles.inlineNote}>
          Tip: click a KPI for ready / behind / incomplete people across the org, or open a department card to drill down.
        </p>
      )}
    </div>
  );
}

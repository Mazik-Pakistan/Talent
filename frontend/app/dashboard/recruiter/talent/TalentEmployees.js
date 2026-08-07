"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import shellStyles from "@/components/recruiter/recruiter-shell.module.css";
import styles from "./talent.module.css";
import ListPager, { paginateLocal } from "./ListPager";
import { getApiErrorMessage } from "@/services/authService";
import { searchTalent } from "@/services/talentService";
import { LayoutGrid, List, Search as SearchIcon, Users } from "lucide-react";

const PROMO_BUCKETS = [
  { key: "", label: "Any promotion status" },
  { key: "ready", label: "Ready (80%+)" },
  { key: "almost", label: "Almost ready (50–79%)" },
  { key: "behind", label: "Behind (<50%)" },
];

const PAGE_SIZE = 25;
/** Max rows to pull when client-side filters (role / promo / high potential) are on. */
const FILTER_FETCH_SIZE = 60;

function openEmployee(onNavigate, e, department) {
  onNavigate({
    view: "profile",
    employee: e.employee_id,
    department: e.department || department || null,
  });
}

export default function TalentEmployees({
  departmentNames = [],
  roleNames = [],
  promotion,
  initialDepartment = "",
  onNavigate,
}) {
  const [q, setQ] = useState("");
  const [department, setDepartment] = useState(initialDepartment || "");
  const [role, setRole] = useState("");
  const [highPotential, setHighPotential] = useState(false);
  const [promoBucket, setPromoBucket] = useState("");
  const [raw, setRaw] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [layout, setLayout] = useState("list");

  useEffect(() => {
    if (initialDepartment) setDepartment(initialDepartment);
  }, [initialDepartment]);

  const needsClientFilter = Boolean(role || highPotential || promoBucket);

  const runSearch = useCallback((nextPage = 1) => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);

    let promoIds = null;
    if (promoBucket && promotion) {
      const list =
        promoBucket === "ready"
          ? promotion.ready
          : promoBucket === "almost"
            ? promotion.almost_ready
            : promotion.behind;
      promoIds = new Set((list || []).map((p) => p.employee_id));
    }

    const requestPage = needsClientFilter ? 1 : nextPage;
    const requestSize = needsClientFilter ? FILTER_FETCH_SIZE : PAGE_SIZE;

    searchTalent(token, {
      q: q || null,
      department: department || null,
      skills: [],
      certifications: [],
      min_learning_progress: null,
      min_experience_years: null,
      min_competency_score: null,
      semantic: false,
      page: requestPage,
      page_size: requestSize,
    })
      .then(async (data) => {
        let employees = data.employees || [];
        let total = data.total ?? employees.length;
        let pages = data.pages || 1;

        // When client filters are active, pull remaining pages (capped) then filter + paginate locally.
        if (needsClientFilter && pages > 1) {
          const maxPages = Math.min(pages, 5);
          const extras = [];
          for (let p = 2; p <= maxPages; p += 1) {
            try {
              const more = await searchTalent(token, {
                q: q || null,
                department: department || null,
                skills: [],
                certifications: [],
                min_learning_progress: null,
                min_experience_years: null,
                min_competency_score: null,
                semantic: false,
                page: p,
                page_size: FILTER_FETCH_SIZE,
              });
              extras.push(...(more.employees || []));
            } catch {
              break;
            }
          }
          employees = [...employees, ...extras];
        }

        if (role) {
          const r = role.trim().toLowerCase();
          employees = employees.filter((e) => (e.job_title || "").trim().toLowerCase() === r);
        }
        if (highPotential) {
          employees = employees.filter(
            (e) =>
              (e.skill_count >= 5 || (e.skills || []).length >= 5) &&
              (e.verified_certifications > 0 || e.certification_count > 0 || (e.certifications || []).length > 0)
          );
        }
        if (promoIds) {
          employees = employees.filter((e) => promoIds.has(e.employee_id));
        }

        if (needsClientFilter) {
          setRaw({
            mode: "client",
            employees,
            total: employees.length,
            pages: Math.max(1, Math.ceil(employees.length / PAGE_SIZE) || 1),
            serverTotal: total,
          });
        } else {
          setRaw({
            mode: "server",
            employees,
            total,
            pages: Math.max(1, pages || 1),
            page: data.page || nextPage,
          });
        }
        setPage(needsClientFilter ? 1 : (data.page || nextPage));
      })
      .catch((err) => toast.error(getApiErrorMessage(err, "Search failed.")))
      .finally(() => setLoading(false));
  }, [q, department, role, highPotential, promoBucket, promotion, needsClientFilter]);

  // Debounced search on filters (runs on mount and when filters change).
  useEffect(() => {
    const t = setTimeout(() => runSearch(1), 280);
    return () => clearTimeout(t);
  }, [q, department, role, highPotential, promoBucket]); // eslint-disable-line react-hooks/exhaustive-deps

  const readinessFor = (employeeId) => {
    if (!promotion) return null;
    for (const bucket of ["ready", "almost_ready", "behind"]) {
      const hit = (promotion[bucket] || []).find((p) => p.employee_id === employeeId);
      if (hit) return hit;
    }
    return null;
  };

  const visible = (() => {
    if (!raw) return { items: [], page: 1, pages: 1, total: 0 };
    if (raw.mode === "client") {
      return paginateLocal(raw.employees, page, PAGE_SIZE);
    }
    return {
      items: raw.employees,
      page: raw.page || page,
      pages: raw.pages,
      total: raw.total,
    };
  })();

  function goToPage(next) {
    if (raw?.mode === "client") {
      setPage(next);
      return;
    }
    runSearch(next);
  }

  return (
    <div className={styles.intelStack}>
      <div className={shellStyles.section}>
        <div className={shellStyles.sectionHead}>
          <div className={shellStyles.sectionHeadLeft}>
            <span className={`${shellStyles.bar} ${shellStyles.navy}`} />
            <div>
              <div className={shellStyles.sectionTitle}>Employees</div>
              <p className={shellStyles.sectionDesc}>
                Search and filter talent — dense list for large directories
              </p>
            </div>
          </div>
          <div className={styles.layoutToggle} role="group" aria-label="Layout">
            <button
              type="button"
              className={`${styles.layoutToggleBtn} ${layout === "list" ? styles.layoutToggleActive : ""}`}
              onClick={() => setLayout("list")}
              aria-pressed={layout === "list"}
            >
              <List size={14} aria-hidden="true" /> List
            </button>
            <button
              type="button"
              className={`${styles.layoutToggleBtn} ${layout === "cards" ? styles.layoutToggleActive : ""}`}
              onClick={() => setLayout("cards")}
              aria-pressed={layout === "cards"}
            >
              <LayoutGrid size={14} aria-hidden="true" /> Cards
            </button>
          </div>
        </div>
        <div className={shellStyles.sectionBody}>
          <div className={styles.filterBar}>
            <input
              className={styles.searchInput}
              placeholder="Search by name, title, skill…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch(1)}
            />
            <select
              className={`${styles.filterSelect} ${styles.w140}`}
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            >
              <option value="">All departments</option>
              {departmentNames.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <select
              className={`${styles.filterSelect} ${styles.w180}`}
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="">All roles</option>
              {roleNames.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <select
              className={`${styles.filterSelect} ${styles.w180}`}
              value={promoBucket}
              onChange={(e) => setPromoBucket(e.target.value)}
            >
              {PROMO_BUCKETS.map((b) => (
                <option key={b.key || "any"} value={b.key}>{b.label}</option>
              ))}
            </select>
            <label className={styles.checkLabel}>
              <input type="checkbox" checked={highPotential} onChange={(e) => setHighPotential(e.target.checked)} />
              High potential
            </label>
            <button type="button" className={styles.smallBtnPrimary} onClick={() => runSearch(1)} disabled={loading}>
              <SearchIcon size={14} aria-hidden="true" /> {loading ? "Searching…" : "Search"}
            </button>
          </div>

          {loading && <p className={styles.inlineNote}>Searching…</p>}
          {!loading && visible.items.length === 0 && (
            <div className={styles.emptyState}>
              <div className={styles.emptyStateIcon}><Users aria-hidden="true" /></div>
              <div className={styles.emptyStateTitle}>No employees match</div>
              <p className={styles.emptyStateHint}>Try broadening department, role, or promotion filters.</p>
            </div>
          )}
          {!loading && visible.items.length > 0 && layout === "list" && (
            <div className={styles.scrollList}>
              <div className={styles.empTable} role="table">
                <div className={styles.empTableHead} role="row">
                  <span role="columnheader">Name</span>
                  <span role="columnheader">Role</span>
                  <span role="columnheader">Department</span>
                  <span role="columnheader">Skills</span>
                  <span role="columnheader">Learning</span>
                  <span role="columnheader">Readiness</span>
                </div>
                {visible.items.map((e) => {
                  const promo = readinessFor(e.employee_id);
                  const skills = e.skills || [];
                  return (
                    <button
                      key={e.employee_id}
                      type="button"
                      className={styles.empTableRow}
                      role="row"
                      onClick={() => openEmployee(onNavigate, e, department)}
                    >
                      <span className={styles.empCellName} role="cell">{e.full_name}</span>
                      <span className={styles.empCellMuted} role="cell">{e.job_title || "—"}</span>
                      <span className={styles.empCellMuted} role="cell">{e.department || "—"}</span>
                      <span className={styles.empCellSkills} role="cell" title={skills.join(", ")}>
                        {skills.length === 0
                          ? "—"
                          : skills.slice(0, 3).join(", ") + (skills.length > 3 ? ` +${skills.length - 3}` : "")}
                      </span>
                      <span className={styles.empCellMetric} role="cell">
                        {e.learning_progress ?? "—"}%
                      </span>
                      <span className={styles.empCellMetric} role="cell">
                        {promo ? `${promo.readiness_score ?? 0}%` : "—"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {!loading && visible.items.length > 0 && layout === "cards" && (
            <div className={styles.scrollList}>
              <div className={styles.resultGrid}>
                {visible.items.map((e) => {
                  const promo = readinessFor(e.employee_id);
                  return (
                    <div
                      key={e.employee_id}
                      className={styles.resultCard}
                      onClick={() => openEmployee(onNavigate, e, department)}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter") openEmployee(onNavigate, e, department);
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div className={styles.resultName}>{e.full_name}</div>
                      <div className={styles.resultMeta}>{e.job_title} · {e.department}</div>
                      <div className={styles.resultTags}>
                        {(e.skills || []).slice(0, 5).map((s, i) => (
                          <span key={`${s}-${i}`} className={styles.resultTag}>{s}</span>
                        ))}
                      </div>
                      <div className={styles.resultStats}>
                        Learning {e.learning_progress ?? "—"}%
                        {promo ? ` · Readiness ${promo.readiness_score ?? 0}%` : ""}
                        {e.years_experience != null ? ` · ${e.years_experience} yrs` : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <ListPager
            page={visible.page}
            pages={visible.pages}
            total={visible.total}
            pageSize={PAGE_SIZE}
            loading={loading}
            onPageChange={goToPage}
            label="employees"
          />
        </div>
      </div>
    </div>
  );
}

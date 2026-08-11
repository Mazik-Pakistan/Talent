"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import shellStyles from "@/components/recruiter/recruiter-shell.module.css";
import styles from "./talent.module.css";
import ListPager, { paginateLocal } from "./ListPager";
import { getApiErrorMessage } from "@/services/authService";
import {
  assignEmployeeCareer,
  getPromotionReadiness,
  listCareerLevels,
} from "@/services/careerService";
import { bustTalentIntelligenceCache } from "@/hooks/useTalentIntelligenceData";
import { searchTalent } from "@/services/talentService";
import {
  AlertTriangle,
  Building2,
  Calendar,
  Check,
  ChevronRight,
  Plus,
  Search as SearchIcon,
  TrendingUp,
  X,
} from "lucide-react";

const BUCKET_PAGE_SIZE = 20;

function scoreColor(score) {
  if (score >= 80) return "var(--green)";
  if (score >= 50) return "var(--orange)";
  return "var(--red)";
}

function matchesQuery(item, q, department) {
  if (department && (item.department || "").trim() !== department.trim()) return false;
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [
    item.employee_name,
    item.employee_id,
    item.current_role,
    item.target_role,
    item.department,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(needle);
}

function PromotionRow({ item, onOpenProfile }) {
  const color = scoreColor(item.readiness_score || 0);
  const circumference = 2 * Math.PI * 15.9155;
  const statusLabel = item.status === "paused" || item.assignment_status === "paused" ? "Paused" : null;
  const isTerminal = Boolean(
    item.is_terminal_role
    || (
      item.current_role
      && item.target_role
      && String(item.current_role).trim().toLowerCase() === String(item.target_role).trim().toLowerCase()
    )
  );

  return (
    <div className={styles.prRow}>
      <div className={styles.prRowMain}>
        <div className={styles.prRowName}>
          {item.employee_name}
          {statusLabel && <span className={styles.pausedChip}>{statusLabel}</span>}
          {isTerminal && !statusLabel && (
            <span className={styles.pausedChip}>Highest role</span>
          )}
        </div>
        <div className={styles.prRowMeta}>
          <span>{item.current_role || "—"}</span>
          {isTerminal ? (
            <span className={styles.metaChip}>Top of ladder</span>
          ) : (
            <>
              <span className={styles.prArrow}><ChevronRight size={16} aria-hidden="true" /></span>
              <span>{item.target_role || "—"}</span>
            </>
          )}
          <span className={styles.metaChip}><Building2 size={14} aria-hidden="true" />{item.department || "—"}</span>
        </div>
      </div>
      <div className={styles.prRowSide}>
        {item.target_date && (
          <span className={styles.prTargetDate}>
            <Calendar size={14} aria-hidden="true" /> Target: {item.target_date}
          </span>
        )}
        <div className={styles.prRingWrap}>
          <svg viewBox="0 0 36 36" style={{ transform: "rotate(-90deg)" }}>
            <circle className={styles.prRingTrack} cx="18" cy="18" r="15.9155" />
            <circle
              className={styles.prRingFill}
              cx="18"
              cy="18"
              r="15.9155"
              stroke={color}
              strokeDasharray={`${(item.readiness_score || 0) * circumference / 100} ${circumference}`}
            />
          </svg>
          <div className={styles.prRingLabel} style={{ color }}>
            {item.readiness_score || 0}%
          </div>
        </div>
        <button
          type="button"
          className={styles.smallBtn}
          onClick={() => onOpenProfile(item)}
        >
          Talent profile
        </button>
      </div>
    </div>
  );
}

function PipelineBucket({
  barClass,
  title,
  desc,
  items,
  page,
  onPageChange,
  onOpenProfile,
}) {
  const sliced = paginateLocal(items, page, BUCKET_PAGE_SIZE);
  if (items.length === 0) return null;

  return (
    <div className={shellStyles.section}>
      <div className={shellStyles.sectionHead}>
        <div className={shellStyles.sectionHeadLeft}>
          <span className={`${shellStyles.bar} ${barClass}`} />
          <div>
            <div className={shellStyles.sectionTitle}>{title} ({items.length})</div>
            <p className={shellStyles.sectionDesc}>{desc}</p>
          </div>
        </div>
      </div>
      <div className={shellStyles.sectionBody}>
        <div className={styles.scrollList}>
          {sliced.items.map((item, idx) => (
            <PromotionRow
              key={`${item.employee_id || "emp"}-${item.target_role || "role"}-${idx}`}
              item={item}
              onOpenProfile={onOpenProfile}
            />
          ))}
        </div>
        <ListPager
          page={sliced.page}
          pages={sliced.pages}
          total={sliced.total}
          pageSize={BUCKET_PAGE_SIZE}
          onPageChange={onPageChange}
          label="people"
        />
      </div>
    </div>
  );
}

export default function PromotionPipeline({
  departmentNames = [],
  onNavigate,
  onRefreshIntel,
}) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [levels, setLevels] = useState([]);
  const [empQuery, setEmpQuery] = useState("");
  const [assignForm, setAssignForm] = useState({ employee_id: "", target_level_id: "", target_date: "" });
  const [assigning, setAssigning] = useState(false);
  const [q, setQ] = useState("");
  const [department, setDepartment] = useState("");
  const [pages, setPages] = useState({ ready: 1, almost: 1, behind: 1 });

  const reload = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    setLoadError(false);
    Promise.all([
      getPromotionReadiness(token, department || null),
      listCareerLevels(token, department || null),
    ])
      .then(([reportData, levelsData]) => {
        setReport(reportData);
        setLevels(levelsData.levels || levelsData || []);
        setPages({ ready: 1, almost: 1, behind: 1 });
      })
      .catch((err) => {
        setLoadError(true);
        toast.error(getApiErrorMessage(err, "Could not load promotion readiness."));
      })
      .finally(() => setLoading(false));
  }, [department]);

  useEffect(() => {
    const t = setTimeout(() => { reload(); }, 0);
    return () => clearTimeout(t);
  }, [reload]);

  useEffect(() => {
    if (!empQuery.trim() || empQuery.length < 2) {
      const t = setTimeout(() => setEmployees([]), 0);
      return () => clearTimeout(t);
    }
    const token = localStorage.getItem("access_token");
    if (!token) return;
    searchTalent(token, {
      q: empQuery,
      department: department || null,
      skills: [],
      certifications: [],
      min_learning_progress: null,
      min_experience_years: null,
      min_competency_score: null,
      semantic: false,
      page: 1,
      page_size: 20,
    })
      .then((data) => setEmployees(data.employees || []))
      .catch(() => setEmployees([]));
  }, [empQuery, department]);

  const filtered = useMemo(() => {
    const ready = (report?.ready || []).filter((i) => matchesQuery(i, q, ""));
    const almost = (report?.almost_ready || []).filter((i) => matchesQuery(i, q, ""));
    const behind = (report?.behind || []).filter((i) => matchesQuery(i, q, ""));
    return { ready, almost, behind };
  }, [report, q]);

  // Reset bucket pages when search changes.
  useEffect(() => {
    const t = setTimeout(() => setPages({ ready: 1, almost: 1, behind: 1 }), 0);
    return () => clearTimeout(t);
  }, [q]);

  async function handleAssign(e) {
    e.preventDefault();
    if (!assignForm.employee_id || !assignForm.target_level_id) {
      toast.warn("Please select an employee and target level.");
      return;
    }
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setAssigning(true);
    try {
      await assignEmployeeCareer(token, assignForm.employee_id, {
        target_level_id: assignForm.target_level_id,
        target_date: assignForm.target_date || undefined,
      });
      toast.success("Career path saved.");
      setShowAssign(false);
      setAssignForm({ employee_id: "", target_level_id: "", target_date: "" });
      bustTalentIntelligenceCache();
      onRefreshIntel?.();
      reload();
    } catch (err) {
      const detail = err.response?.data?.detail;
      const msg = Array.isArray(detail)
        ? detail.map((d) => d.msg || d.message || JSON.stringify(d)).join(" · ")
        : (detail || getApiErrorMessage(err, "Could not assign career path."));
      toast.error(msg);
    } finally {
      setAssigning(false);
    }
  }

  function openProfile(item) {
    onNavigate({
      view: "profile",
      employee: item.employee_id,
      department: item.department || null,
    });
  }

  const empty =
    !loading &&
    !loadError &&
    filtered.ready.length === 0 &&
    filtered.almost.length === 0 &&
    filtered.behind.length === 0;

  return (
    <>
      <div className={shellStyles.section}>
        <div className={shellStyles.sectionHead}>
          <div className={shellStyles.sectionHeadLeft}>
            <span className={`${shellStyles.bar} ${shellStyles.cyan}`} />
            <div>
              <div className={shellStyles.sectionTitle}>Promotion Pipeline</div>
              <p className={shellStyles.sectionDesc}>
                Ready / almost ready / behind — paginated for large pipelines
              </p>
            </div>
          </div>
          <div className={styles.toolbarRight}>
            <button type="button" className={styles.smallBtn} onClick={reload}>Refresh</button>
            <button type="button" className={styles.modeBtn} onClick={() => setShowAssign(!showAssign)}>
              {showAssign ? <><X size={16} aria-hidden="true" /> Close</> : <><Plus size={16} aria-hidden="true" /> Assign Career Path</>}
            </button>
          </div>
        </div>
        <div className={shellStyles.sectionBody}>
          <div className={styles.filterBar}>
            <input
              className={styles.searchInput}
              placeholder="Filter by name, role, or ID…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
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
            <span className={styles.inlineNote} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <SearchIcon size={14} aria-hidden="true" />
              {`${filtered.ready.length + filtered.almost.length + filtered.behind.length} shown`}
            </span>
          </div>
        </div>
      </div>

      {showAssign && (
        <div className={shellStyles.section}>
          <div className={shellStyles.sectionHead}>
            <div className={shellStyles.sectionHeadLeft}>
              <span className={`${shellStyles.bar} ${shellStyles.green}`} />
              <div>
                <div className={shellStyles.sectionTitle}>Assign Career Path</div>
              </div>
            </div>
          </div>
          <div className={shellStyles.sectionBody}>
            {levels.length === 0 && (
              <p className={styles.inlineNote} style={{ marginBottom: 12 }}>
                No career levels yet — configure tracks and levels in{" "}
                <button type="button" className={styles.textLink} onClick={() => onNavigate({ path: "/dashboard/recruiter/organization-config" })}>
                  Organization Setup
                </button>
                .
              </p>
            )}
            <form data-partner-coach className={styles.assignForm} onSubmit={handleAssign}>
              <div className={styles.fieldLabel}>
                <span>Employee</span>
                <input
                  data-field-key="empQuery"
                  className={styles.searchInput}
                  placeholder="Search by name or ID…"
                  value={empQuery}
                  onChange={(e) => {
                    setEmpQuery(e.target.value);
                    setAssignForm((f) => ({ ...f, employee_id: "" }));
                  }}
                />
                {empQuery.trim().length >= 2 && (
                  <select
                    data-field-key="employee_id"
                    value={assignForm.employee_id}
                    onChange={(e) => setAssignForm((f) => ({ ...f, employee_id: e.target.value }))}
                    style={{ marginTop: 6 }}
                  >
                    <option value="">Select employee</option>
                    {employees.map((emp) => (
                      <option key={emp.employee_id} value={emp.employee_id}>
                        {emp.full_name} ({emp.employee_id}) — {emp.job_title || "—"}
                      </option>
                    ))}
                  </select>
                )}
                {empQuery.trim().length >= 2 && employees.length === 0 && (
                  <p className={styles.inlineNote} style={{ marginTop: 6 }}>No employees found.</p>
                )}
              </div>
              <label className={styles.fieldLabel}>
                Target Level
                <select data-field-key="target_level_id" value={assignForm.target_level_id} onChange={(e) => setAssignForm((f) => ({ ...f, target_level_id: e.target.value }))} required>
                  <option value="">Select target level</option>
                  {levels.map((l) => (
                    <option key={l.id} value={l.id}>
                      Level {l.level_number}: {l.role_title} ({l.department})
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.fieldLabel}>
                Target Date
                <input data-field-key="target_date" type="date" value={assignForm.target_date} onChange={(e) => setAssignForm((f) => ({ ...f, target_date: e.target.value }))} />
              </label>
              <div className={styles.formActions}>
                <button type="submit" className={styles.assignCourseBtn} disabled={assigning || levels.length === 0}>
                  <Check size={16} aria-hidden="true" /> {assigning ? "Assigning…" : "Assign"}
                </button>
                <button type="button" className={styles.smallBtn} onClick={() => setShowAssign(false)}>
                  <X size={16} aria-hidden="true" /> Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading && <p className={styles.inlineNote}>Loading promotion pipeline…</p>}

      {!loading && loadError && (
        <div className={styles.emptyState}>
          <div className={styles.emptyStateIcon}><AlertTriangle aria-hidden="true" /></div>
          <div className={styles.emptyStateTitle}>Could not load pipeline</div>
          <p className={styles.emptyStateHint}>Try refreshing, or check that you have Talent access.</p>
          <button type="button" className={styles.modeBtn} onClick={reload}>Retry</button>
        </div>
      )}

      {!loading && !loadError && (
        <>
          <PipelineBucket
            barClass={shellStyles.green}
            title="Ready for Promotion"
            desc="80%+ readiness score"
            items={filtered.ready}
            page={pages.ready}
            onPageChange={(p) => setPages((prev) => ({ ...prev, ready: p }))}
            onOpenProfile={openProfile}
          />
          <PipelineBucket
            barClass={shellStyles.orange}
            title="Almost Ready"
            desc="50–79% readiness"
            items={filtered.almost}
            page={pages.almost}
            onPageChange={(p) => setPages((prev) => ({ ...prev, almost: p }))}
            onOpenProfile={openProfile}
          />
          <PipelineBucket
            barClass={shellStyles.red}
            title="Behind Schedule"
            desc="<50% readiness"
            items={filtered.behind}
            page={pages.behind}
            onPageChange={(p) => setPages((prev) => ({ ...prev, behind: p }))}
            onOpenProfile={openProfile}
          />
        </>
      )}

      {empty && (
        <div className={shellStyles.section}>
          <div className={shellStyles.sectionBody}>
            <div className={styles.emptyState}>
              <div className={styles.emptyStateIcon}><TrendingUp aria-hidden="true" /></div>
              <div className={styles.emptyStateTitle}>
                {q || department ? "No matches in this pipeline" : "No career paths assigned yet"}
              </div>
              <p className={styles.emptyStateHint}>
                {q || department
                  ? "Try clearing search or department filter."
                  : "Use Assign Career Path to start tracking employee readiness."}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

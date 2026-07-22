"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "react-toastify";

import EmployeeShell from "@/components/employee/EmployeeShell";
import ConfirmDialog from "@/components/ConfirmDialog";
import dashStyles from "@/app/dashboard/employee/employee-dashboard.module.css";
import styles from "./learning.module.css";
import { getApiErrorMessage } from "@/services/authService";
import {
  addBookmark,
  assessSkills,
  browseCatalog,
  deleteSkill,
  getCareerGoal,
  getCareerPath,
  getCatalogFacets,
  getLearningDashboard,
  getRecommendations,
  getRoleMatches,
  getSkillCategories,
  getSkillGap,
  getSoftSkillCategories,
  listBookmarks,
  listMyCertificates,
  listMyCourses,
  listSkills,
  removeBookmark,
  setCareerGoal,
  startCourse,
  updateCourseProgress,
  uploadCertificate,
  upsertSkill,
} from "@/services/learningService";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "catalog", label: "Course Catalog" },
  { key: "my-courses", label: "My Learning" },
  { key: "skills", label: "Skill Profile" },
  { key: "career", label: "Career Path" },
  { key: "certificates", label: "Certificates" },
];

const CAREER_SUGGESTIONS = [
  "Senior Full Stack Developer",
  "AI Engineer",
  "Cloud Solutions Architect",
  "DevOps Engineer",
  "Data Scientist",
  "Security Engineer",
];

export default function EmployeeLearningPage() {
  return (
    <Suspense fallback={<p style={{ textAlign: "center", marginTop: "2rem" }}>Loading learning…</p>}>
      <EmployeeLearningPageInner />
    </Suspense>
  );
}

function EmployeeLearningPageInner() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab");
  const [tab, setTab] = useState(
    TABS.some((t) => t.key === initialTab) ? initialTab : "overview"
  );
  const [dashboard, setDashboard] = useState(null);
  const [loadError, setLoadError] = useState("");

  const loadDashboard = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    getLearningDashboard(token)
      .then(setDashboard)
      .catch((err) => setLoadError(getApiErrorMessage(err, "Could not load your learning dashboard.")));
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    const next = searchParams.get("tab");
    if (next && TABS.some((t) => t.key === next)) setTab(next);
  }, [searchParams]);

  return (
    <EmployeeShell
      activeKey="learning"
      title="Learning"
      subtitle={dashboard ? `${dashboard.employee?.job_title || "Employee"} · ${dashboard.employee?.department || "—"}` : "Loading…"}
    >
      {loadError && <div className={dashStyles.loadError}>{loadError}</div>}

      <div className={styles.tabBar}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`${styles.tabBtn} ${tab === t.key ? styles.tabActive : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab dashboard={dashboard} onGo={setTab} />}
      {tab === "catalog" && <CatalogTab onEnroll={loadDashboard} />}
      {tab === "my-courses" && <MyCoursesTab onChange={loadDashboard} />}
      {tab === "skills" && <SkillsTab />}
      {tab === "career" && <CareerTab />}
      {tab === "certificates" && <CertificatesTab onChange={loadDashboard} />}
    </EmployeeShell>
  );
}

// ------------------------------------------------------------------------ //
// Overview (US-069)
// ------------------------------------------------------------------------ //
function OverviewTab({ dashboard, onGo }) {
  if (!dashboard) return <p className={styles.inlineNote}>Loading your learning summary…</p>;
  const s = dashboard.summary || {};

  const stats = [
    { label: "Assigned", value: s.assigned_count ?? 0, color: "orange" },
    { label: "In Progress", value: s.in_progress_count ?? 0, color: "cyan" },
    { label: "Completed", value: s.completed_count ?? 0, color: "green" },
    { label: "Certificates Earned", value: s.certificates_earned ?? 0, color: "navy" },
  ];

  return (
    <>
      <div className={dashStyles.hero}>
        <div>
          <div className={dashStyles.heroEyebrow}>Learning &amp; Development</div>
          <h1>Grow your skills with Microsoft Learn</h1>
          <div className={dashStyles.heroMeta}>
            Overall progress: <b>{s.overall_progress_percent ?? 0}%</b> · Learning hours logged:{" "}
            <b>{s.total_learning_hours ?? 0}</b>
          </div>
          <div className={dashStyles.heroChips}>
            <button type="button" className={dashStyles.chip} onClick={() => onGo("catalog")} style={{ cursor: "pointer", border: "none" }}>
              Browse catalog
            </button>
            <button type="button" className={dashStyles.chip} onClick={() => onGo("career")} style={{ cursor: "pointer", border: "none" }}>
              Get AI recommendations
            </button>
          </div>
        </div>
      </div>

      <div className={dashStyles.stats}>
        {stats.map((stat) => (
          <div key={stat.label} className={dashStyles.statCard}>
            <div className={dashStyles.statTop}>
              <span className={`${dashStyles.statIcon} ${dashStyles[stat.color]}`}>●</span>
            </div>
            <div className={dashStyles.statValue}>{stat.value}</div>
            <div className={dashStyles.statLabel}>{stat.label}</div>
          </div>
        ))}
      </div>

      <div className={dashStyles.cols2}>
        <div className={dashStyles.section}>
          <div className={dashStyles.sectionHead}>
            <div className={dashStyles.sectionHeadLeft}>
              <span className={`${dashStyles.bar} ${dashStyles.cyan}`} />
              <div>
                <div className={dashStyles.sectionTitle}>Recent activity</div>
                <p className={dashStyles.sectionDesc}>Your most recently updated courses</p>
              </div>
            </div>
          </div>
          <div className={dashStyles.sectionBody}>
            {(dashboard.recent_enrollments || []).length === 0 && (
              <div className={dashStyles.emptyState}>
                <div className={dashStyles.emptyTitle}>No courses yet</div>
                <div className={dashStyles.emptySub}>Browse the catalog to start learning.</div>
                <button type="button" className={dashStyles.btnPrimary} onClick={() => onGo("catalog")}>
                  Browse catalog
                </button>
              </div>
            )}
            {(dashboard.recent_enrollments || []).map((e) => (
              <div key={e.id} className={styles.courseListRow}>
                <div className={styles.courseListInfo}>
                  <div className={styles.courseListTitle}>{e.course_title}</div>
                  <div className={styles.courseListMeta}>
                    {e.status === "completed" ? "Completed" : `${e.progress_percent}% complete`}
                  </div>
                </div>
                <div className={styles.courseListProgress}>
                  <div className={styles.progressTrackSm}>
                    <div className={styles.progressFillSm} style={{ width: `${e.progress_percent}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className={dashStyles.section}>
          <div className={dashStyles.sectionHead}>
            <div className={dashStyles.sectionHeadLeft}>
              <span className={`${dashStyles.bar} ${dashStyles.orange}`} />
              <div>
                <div className={dashStyles.sectionTitle}>Upcoming due dates</div>
                <p className={dashStyles.sectionDesc}>Courses assigned by your recruiter</p>
              </div>
            </div>
          </div>
          <div className={dashStyles.sectionBody}>
            {(dashboard.upcoming_due || []).length === 0 && <p className={styles.inlineNote}>Nothing due right now.</p>}
            {(dashboard.upcoming_due || []).map((a) => (
              <div key={a.course_uid} className={styles.courseListRow}>
                <div className={styles.courseListInfo}>
                  <div className={styles.courseListTitle}>{a.course_title}</div>
                  <div className={styles.courseListMeta}>Due {a.due_date || "—"} · {a.status}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------------ //
// Catalog (US-065 / US-066 / US-072 / US-073)
// ------------------------------------------------------------------------ //
const CATALOG_SOURCES = [
  { key: "microsoft_learn", label: "Microsoft Learn" },
  { key: "coursera", label: "Industry Soft Skills" },
  { key: "recruiter_kb", label: "Recruiter Courses" },
];

function CatalogTab({ onEnroll }) {
  const [source, setSource] = useState("microsoft_learn");
  const [q, setQ] = useState("");
  const [facets, setFacets] = useState({ roles: [], levels: [], products: [] });
  const [softSkillCategories, setSoftSkillCategories] = useState([]);
  const [role, setRole] = useState("");
  const [level, setLevel] = useState("");
  const [type, setType] = useState("");
  const [category, setCategory] = useState("");
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ courses: [], total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyUid, setBusyUid] = useState("");

  function switchSource(nextSource) {
    if (nextSource === source) return;
    setSource(nextSource);
    setRole("");
    setLevel("");
    setType("");
    setCategory("");
    setQ("");
    setPage(1);
  }

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    if (source === "coursera") {
      getSoftSkillCategories(token).then((data) => setSoftSkillCategories(data.categories || [])).catch(() => {});
    } else {
      getCatalogFacets(token, source).then(setFacets).catch(() => {});
    }
  }, [source]);

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    browseCatalog(token, {
      q: q || undefined,
      role: source === "microsoft_learn" ? role || undefined : undefined,
      level: source === "microsoft_learn" ? level || undefined : undefined,
      type: source === "microsoft_learn" ? type || undefined : undefined,
      category: source === "coursera" ? category || undefined : undefined,
      source,
      bookmarked_only: bookmarkedOnly || undefined,
      page,
      page_size: 12,
    })
      .then((data) => {
        setResult(data);
        setError("");
      })
      .catch((err) => setError(getApiErrorMessage(err, "Could not load the course catalog.")))
      .finally(() => setLoading(false));
  }, [q, role, level, type, category, source, bookmarkedOnly, page]);

  useEffect(() => {
    const timer = setTimeout(load, 300);
    return () => clearTimeout(timer);
  }, [load]);

  async function handleStart(course) {
    const token = localStorage.getItem("access_token");
    setBusyUid(course.uid);
    try {
      const data = await startCourse(token, course.uid);
      window.open(data.redirect_url || course.url, "_blank", "noopener,noreferrer");
      toast.success("Course started — tracking your progress. Complete it on the provider's site, then upload your certificate here.");
      onEnroll?.();
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not start this course."));
    } finally {
      setBusyUid("");
    }
  }

  async function handleBookmark(course) {
    const token = localStorage.getItem("access_token");
    try {
      if (course.bookmarked) {
        await removeBookmark(token, course.uid);
      } else {
        await addBookmark(token, {
          course_uid: course.uid,
          course_title: course.title,
          course_url: course.url,
          course_type: course.type,
          duration_minutes: course.duration_minutes,
          level: (course.levels || [])[0],
        });
      }
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not update bookmark."));
    }
  }

  const isSoftSkills = source === "coursera";

  return (
    <div className={dashStyles.section}>
      <div className={dashStyles.sectionHead}>
        <div className={dashStyles.sectionHeadLeft}>
          <span className={`${dashStyles.bar} ${dashStyles.cyan}`} />
          <div>
            <div className={dashStyles.sectionTitle}>
              {source === "coursera" ? "Industry soft skills catalog" : source === "recruiter_kb" ? "Recruiter course catalog" : "Microsoft Learn catalog"}
            </div>
            <p className={dashStyles.sectionDesc}>
              {result.total} results ·{" "}
              {source === "coursera"
                ? "powered by Coursera (free, live catalog)"
                : source === "recruiter_kb"
                  ? "certifications & courses from your recruiter knowledge base"
                  : "powered by Microsoft Learn (free, live catalog)"}
            </p>
          </div>
        </div>
      </div>
      <div className={dashStyles.sectionBody}>
        <div className={styles.sourceToggle}>
          {CATALOG_SOURCES.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`${styles.sourceBtn} ${source === s.key ? styles.sourceBtnActive : ""}`}
              onClick={() => switchSource(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className={styles.filterBar}>
          <input
            className={styles.searchInput}
            placeholder={isSoftSkills ? "Search soft skills, e.g. negotiation, leadership…" : "Search by title, skill, product…"}
            value={q}
            onChange={(e) => { setPage(1); setQ(e.target.value); }}
          />
          {isSoftSkills ? (
            <select className={styles.filterSelect} value={category} onChange={(e) => { setPage(1); setCategory(e.target.value); }}>
              <option value="">All categories</option>
              {softSkillCategories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          ) : (
            <>
              <select className={styles.filterSelect} value={type} onChange={(e) => { setPage(1); setType(e.target.value); }}>
                <option value="">All types</option>
                <option value="learningPath">Learning paths</option>
                <option value="module">Modules</option>
                <option value="certification">Certifications</option>
              </select>
              <select className={styles.filterSelect} value={level} onChange={(e) => { setPage(1); setLevel(e.target.value); }}>
                <option value="">All levels</option>
                {facets.levels.map((lv) => (
                  <option key={lv} value={lv}>{lv[0].toUpperCase() + lv.slice(1)}</option>
                ))}
              </select>
              <select className={styles.filterSelect} value={role} onChange={(e) => { setPage(1); setRole(e.target.value); }}>
                <option value="">All roles</option>
                {facets.roles.map((r) => (
                  <option key={r} value={r}>{r.replace(/-/g, " ")}</option>
                ))}
              </select>
            </>
          )}
          <label className={styles.bookmarkFilter}>
            <input
              type="checkbox"
              checked={bookmarkedOnly}
              onChange={(e) => { setPage(1); setBookmarkedOnly(e.target.checked); }}
            />
            Bookmarked only
          </label>
        </div>

        {error && <div className={styles.errorNote}>{error}</div>}
        {loading && <p className={styles.inlineNote}>Loading courses…</p>}

        <div className={styles.courseGrid}>
          {result.courses.map((course) => (
            <div key={course.uid} className={styles.courseCard}>
              <div className={styles.courseCardHead}>
                <div className={styles.badgeRow}>
                  <span className={`${styles.sourceBadge} ${course.source === "coursera" ? styles.sourceBadgeCoursera : ""}`}>
                    {course.source === "coursera"
                      ? "Coursera"
                      : course.source === "recruiter_kb"
                        ? "Recruiter"
                        : "Microsoft Learn"}
                  </span>
                  <span className={`${styles.courseType} ${course.type === "certification" ? styles.certification : ""}`}>
                    {course.type === "learningPath" ? "Learning Path" : course.type === "certification" ? "Certification" : course.type === "course" ? "Course" : "Module"}
                  </span>
                </div>
                <button
                  type="button"
                  className={`${styles.bookmarkBtn} ${course.bookmarked ? styles.bookmarked : ""}`}
                  title={course.bookmarked ? "Remove bookmark" : "Bookmark"}
                  onClick={() => handleBookmark(course)}
                >
                  <svg viewBox="0 0 24 24" fill={course.bookmarked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                  </svg>
                </button>
              </div>
              <div className={styles.courseTitle}>{course.title}</div>
              <div className={styles.courseSummary}>{(course.summary || "").slice(0, 130)}{(course.summary || "").length > 130 ? "…" : ""}</div>
              <div className={styles.courseMeta}>
                {course.category && <span className={styles.levelBadge}>{course.category}</span>}
                {(course.levels || [])[0] && <span className={styles.levelBadge}>{course.levels[0]}</span>}
                {course.duration_minutes ? <span>{Math.round((course.duration_minutes || 0) / 5) * 5 || course.duration_minutes} min</span> : null}
              </div>
              <div className={styles.tagRow}>
                {(course.products || []).slice(0, 3).map((p) => (
                  <span key={p} className={styles.tag}>{p}</span>
                ))}
              </div>
              <div className={styles.courseActions}>
                {course.enrolled ? (
                  <span className={`${styles.statusChip} ${course.enrollment_status === "completed" ? styles.completed : ""}`}>
                    {course.enrollment_status === "completed" ? "Completed" : "In progress"}
                  </span>
                ) : (
                  <button type="button" className={styles.smallBtnPrimary} disabled={busyUid === course.uid} onClick={() => handleStart(course)}>
                    {busyUid === course.uid ? "Starting…" : "Start Learning"}
                  </button>
                )}
                {course.assigned && <span className={styles.statusChip + " " + styles.assigned}>Assigned</span>}
              </div>
            </div>
          ))}
        </div>

        {!loading && result.courses.length === 0 && (
          <div className={dashStyles.emptyState}>
            <div className={dashStyles.emptyTitle}>No courses match your filters</div>
            <div className={dashStyles.emptySub}>Try a broader search term or clear filters.</div>
          </div>
        )}

        {result.pages > 1 && (
          <div className={styles.pagination}>
            <button type="button" className={styles.pageBtn} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <span>Page {result.page} of {result.pages}</span>
            <button type="button" className={styles.pageBtn} disabled={page >= result.pages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------ //
// My learning (US-069 continued)
// ------------------------------------------------------------------------ //
function MyCoursesTab({ onChange }) {
  const [statusFilter, setStatusFilter] = useState("");
  const [enrollments, setEnrollments] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    listMyCourses(token, statusFilter || undefined)
      .then((data) => setEnrollments(data.enrollments || []))
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not load your courses.")))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function bump(uid, current) {
    const token = localStorage.getItem("access_token");
    const next = Math.min(100, current + 25);
    try {
      await updateCourseProgress(token, uid, { progress_percent: next });
      load();
      onChange?.();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not update progress."));
    }
  }

  return (
    <div className={dashStyles.section}>
      <div className={dashStyles.sectionHead}>
        <div className={dashStyles.sectionHeadLeft}>
          <span className={`${dashStyles.bar} ${dashStyles.navy}`} />
          <div>
            <div className={dashStyles.sectionTitle}>My courses</div>
            <p className={dashStyles.sectionDesc}>Everything you&apos;ve started or been assigned</p>
          </div>
        </div>
        <select className={styles.filterSelect} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="in_progress">In progress</option>
          <option value="completed">Completed</option>
        </select>
      </div>
      <div className={dashStyles.sectionBody}>
        {loading && <p className={styles.inlineNote}>Loading…</p>}
        {!loading && enrollments.length === 0 && (
          <div className={dashStyles.emptyState}>
            <div className={dashStyles.emptyTitle}>Nothing here yet</div>
            <div className={dashStyles.emptySub}>Start a course from the catalog to see it here.</div>
          </div>
        )}
        {enrollments.map((e) => (
          <div key={e.id} className={styles.courseListRow}>
            <div className={styles.courseListInfo}>
              <div className={styles.courseListTitle}>{e.course_title}</div>
              <div className={styles.courseListMeta}>
                {e.assigned && "Assigned · "}
                {e.due_date ? `Due ${e.due_date} · ` : ""}
                Started {e.started_at ? new Date(e.started_at).toLocaleDateString() : "—"}
              </div>
            </div>
            <div className={styles.courseListProgress}>
              <div className={styles.progressLabel}>{e.progress_percent}%</div>
              <div className={styles.progressTrackSm}>
                <div className={styles.progressFillSm} style={{ width: `${e.progress_percent}%` }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <a href={e.course_url} target="_blank" rel="noopener noreferrer" className={styles.smallBtn}>Open</a>
              {e.status !== "completed" && (
                <button type="button" className={styles.smallBtn} onClick={() => bump(e.course_uid, e.progress_percent)}>
                  +25%
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------ //
// Skill profile (US-092 / US-093 / US-094)
// ------------------------------------------------------------------------ //
function SkillsTab() {
  const [skills, setSkills] = useState([]);
  const [categories, setCategories] = useState([]);
  const [assessment, setAssessment] = useState(null);
  const [cacheMeta, setCacheMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [assessing, setAssessing] = useState(false);
  const [form, setForm] = useState({ skill_name: "", category: "Programming", proficiency: "Beginner", years_experience: "" });
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    Promise.all([listSkills(token), getSkillCategories(token), assessSkills(token, false, true)])
      .then(([skillData, catData, assessData]) => {
        setSkills(assessData.skills || skillData.skills || []);
        setCategories(catData.categories || []);
        if (assessData.assessment) setAssessment(assessData.assessment);
        if (assessData.cache_meta) setCacheMeta(assessData.cache_meta);
      })
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not load your skills.")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAssess() {
    const token = localStorage.getItem("access_token");
    setAssessing(true);
    try {
      const data = await assessSkills(token, true);
      setAssessment(data.assessment);
      setSkills(data.skills || []);
      setCacheMeta(data.cache_meta || null);
      toast.success(data.cached ? "Loaded cached skill assessment." : "AI skill matrix refreshed from your resume and current role.");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not run AI skill assessment."));
    } finally {
      setAssessing(false);
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!form.skill_name.trim()) return;
    const token = localStorage.getItem("access_token");
    setSaving(true);
    try {
      await upsertSkill(token, {
        skill_name: form.skill_name.trim(),
        category: form.category,
        proficiency: form.proficiency,
        years_experience: form.years_experience ? Number(form.years_experience) : null,
      });
      setForm({ skill_name: "", category: "Programming", proficiency: "Beginner", years_experience: "" });
      load();
      toast.success("Skill saved.");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not save skill."));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete?.id) {
      setPendingDelete(null);
      return;
    }
    const token = localStorage.getItem("access_token");
    try {
      await deleteSkill(token, pendingDelete.id);
      setPendingDelete(null);
      setAssessment(null);
      load();
      toast.success("Skill removed. AI analysis cache cleared.");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not remove skill."));
    }
  }

  const proficiencyRank = { Beginner: 25, Intermediate: 50, Advanced: 75, Expert: 100 };

  return (
    <div className={dashStyles.section}>
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Remove skill?"
        message="Removing this skill will affect AI analysis and career recommendations. Are you sure?"
        confirmLabel="Remove"
        cancelLabel="Cancel"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
      <div className={dashStyles.sectionHead}>
        <div className={dashStyles.sectionHeadLeft}>
          <span className={`${dashStyles.bar} ${dashStyles.green}`} />
          <div>
            <div className={dashStyles.sectionTitle}>Skill profile</div>
            <p className={dashStyles.sectionDesc}>
              Merged from resume, certifications, and manual skills
              {cacheMeta?.lastAnalyzedAt ? ` · Last analyzed ${new Date(cacheMeta.lastAnalyzedAt).toLocaleString()}` : ""}
            </p>
          </div>
        </div>
        <button type="button" className={dashStyles.btnPrimary} disabled={assessing} onClick={handleAssess}>
          {assessing ? "Assessing…" : "Run AI skill assessment"}
        </button>
      </div>
      <div className={dashStyles.sectionBody}>
        {assessment && (
          <div className={styles.assessmentBanner}>
            <div>
              <strong>Role fit: {assessment.role_fit_percentage ?? "—"}%</strong>
              <p>{assessment.summary}</p>
            </div>
            {(assessment.gaps || []).length > 0 && (
              <div className={styles.gapChips}>
                {assessment.gaps.map((g) => (
                  <span key={g.skill} className={`${styles.priorityChip} ${styles[g.priority] || ""}`}>
                    {g.priority}: {g.skill}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {skills.length > 0 && (
          <div className={styles.matrixBars}>
            {skills.slice(0, 12).map((s) => (
              <div key={s.id || s.skill_name} className={styles.matrixRow}>
                <span className={styles.matrixLabel}>{s.skill_name}</span>
                <div className={styles.matrixTrack}>
                  <div className={styles.matrixFill} style={{ width: `${proficiencyRank[s.proficiency] || 25}%` }} />
                </div>
                <span className={styles.matrixPct}>{s.proficiency}</span>
              </div>
            ))}
          </div>
        )}

        <form className={styles.addSkillForm} onSubmit={handleAdd}>
          <label>
            Skill name
            <input value={form.skill_name} onChange={(e) => setForm((f) => ({ ...f, skill_name: e.target.value }))} placeholder="e.g. Docker" required />
          </label>
          <label>
            Category
            <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>
            Proficiency
            <select value={form.proficiency} onChange={(e) => setForm((f) => ({ ...f, proficiency: e.target.value }))}>
              {["Beginner", "Intermediate", "Advanced", "Expert"].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label>
            Years
            <input type="number" min="0" max="50" step="0.5" value={form.years_experience} onChange={(e) => setForm((f) => ({ ...f, years_experience: e.target.value }))} />
          </label>
          <button type="submit" className={dashStyles.btnPrimary} disabled={saving}>{saving ? "Saving…" : "Add / Update"}</button>
        </form>

        {loading && <p className={styles.inlineNote}>Loading…</p>}
        {!loading && skills.length === 0 && (
          <div className={dashStyles.emptyState}>
            <div className={dashStyles.emptyTitle}>No skills recorded yet</div>
            <div className={dashStyles.emptySub}>Run AI assessment from your onboarding resume, or add skills manually.</div>
          </div>
        )}
        <div className={styles.skillGrid}>
          {skills.map((s) => (
            <div key={s.id || `${s.source}-${s.skill_name}`} className={styles.skillCard}>
              <div className={styles.skillCardHead}>
                <div>
                  <div className={styles.skillName}>{s.skill_name}</div>
                  <div className={styles.skillCategory}>
                    {s.category}
                    {s.years_experience ? ` · ${s.years_experience} yrs` : ""}
                    {s.source ? ` · ${s.source}` : ""}
                    {s.confidence != null ? ` · ${s.confidence}% conf.` : ""}
                  </div>
                </div>
                {s.id && (
                  <button type="button" className={styles.deleteSkillBtn} title="Remove" onClick={() => setPendingDelete(s)}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                  </button>
                )}
              </div>
              <span className={`${styles.proficiencyBadge} ${styles[s.proficiency] || ""}`}>{s.proficiency}</span>
              {s.verification_status === "verified" && (
                <div className={styles.verifiedTag}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>
                  Verified via course completion
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------ //
// Career goal + skill gap + AI path + AI recommendations
// (US-074, US-075, US-095, US-099, US-100)
// ------------------------------------------------------------------------ //
function CareerTab() {
  const [goal, setGoal] = useState("");
  const [savedGoal, setSavedGoal] = useState(null);
  const [gap, setGap] = useState(null);
  const [path, setPath] = useState(null);
  const [gapLoading, setGapLoading] = useState(false);
  const [recs, setRecs] = useState(null);
  const [recsLoading, setRecsLoading] = useState(true);
  const [roleMatches, setRoleMatches] = useState([]);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    getCareerGoal(token).then((data) => {
      setSavedGoal(data.target_role);
      if (data.target_role) {
        setGoal(data.target_role);
        loadGapAndPath(data.target_role);
      }
    });
    loadRecommendations(false);
    getRoleMatches(token, false)
      .then((data) => setRoleMatches(data.roles || []))
      .catch(() => {});
  }, []);

  function loadGapAndPath(role) {
    const token = localStorage.getItem("access_token");
    setGapLoading(true);
    Promise.all([getCareerPath(token, false), getSkillGap(token, role, false)])
      .then(([pathData, gapData]) => {
        setPath(pathData);
        setGap(gapData);
      })
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not analyze your skill gap.")))
      .finally(() => setGapLoading(false));
  }

  async function handleSetGoal(role) {
    const token = localStorage.getItem("access_token");
    const target = role || goal;
    if (!target.trim()) return;
    setGoal(target);
    setGapLoading(true);
    try {
      const pathData = await setCareerGoal(token, target.trim());
      setSavedGoal(target.trim());
      setPath(pathData);
      const gapData = await getSkillGap(token, target.trim(), false);
      setGap(gapData);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not set your career goal."));
    } finally {
      setGapLoading(false);
    }
  }

  function loadRecommendations(refresh) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setRecsLoading(true);
    getRecommendations(token, refresh)
      .then(setRecs)
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not load AI recommendations.")))
      .finally(() => setRecsLoading(false));
  }

  return (
    <>
      <div className={dashStyles.section}>
        <div className={dashStyles.sectionHead}>
          <div className={dashStyles.sectionHeadLeft}>
            <span className={`${dashStyles.bar} ${dashStyles.orange}`} />
            <div>
              <div className={dashStyles.sectionTitle}>Career goal &amp; skill gap</div>
              <p className={dashStyles.sectionDesc}>Compare your profile against organization roles — cached until inputs change</p>
            </div>
          </div>
        </div>
        <div className={dashStyles.sectionBody}>
          <div className={styles.goalRow}>
            <input
              className={styles.goalInput}
              placeholder="e.g. Senior Full Stack Developer"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            />
            <button type="button" className={dashStyles.btnPrimary} onClick={() => handleSetGoal()} disabled={gapLoading}>
              {gapLoading ? "Analyzing…" : "Analyze"}
            </button>
          </div>
          <div className={styles.chipSuggestions}>
            {(roleMatches.length > 0 ? roleMatches.map((r) => r.role) : CAREER_SUGGESTIONS).map((s) => (
              <button key={s} type="button" className={styles.chipSuggestion} onClick={() => handleSetGoal(s)}>
                {s}
                {roleMatches.find((r) => r.role === s) ? ` · ${Math.round(roleMatches.find((r) => r.role === s).readiness_score)}%` : ""}
              </button>
            ))}
          </div>

          {!savedGoal && !gapLoading && <p className={styles.inlineNote}>Set a target role above to see your personalized skill gap and learning path.</p>}

          {gap && (
            <>
              <div className={styles.readinessWrap}>
                <ReadinessRing percentage={gap.readiness_percentage ?? 0} />
                <div className={styles.readinessSummary}>
                  {gap.summary}
                  {gap.cached ? <div className={styles.inlineNote}>Cached analysis</div> : null}
                  {(gap.skill_match_percent != null || gap.certification_match_percent != null) && (
                    <div className={styles.inlineNote}>
                      Skills {gap.skill_match_percent ?? "—"}% · Certs {gap.certification_match_percent ?? "—"}%
                      {gap.learning_priority ? ` · Priority: ${gap.learning_priority}` : ""}
                    </div>
                  )}
                </div>
              </div>
              {gap.matched_skills?.length > 0 && (
                <>
                  <div className={dashStyles.fieldLabel} style={{ marginBottom: 6 }}>Skills you already have</div>
                  <div className={styles.missingSkillsRow}>
                    {gap.matched_skills.map((s) => <span key={s} className={styles.matchedSkillTag}>{s}</span>)}
                  </div>
                </>
              )}
              {(gap.skill_gaps?.length > 0 || gap.missing_skills?.length > 0) && (
                <>
                  <div className={dashStyles.fieldLabel} style={{ marginBottom: 6 }}>Skills to build (priority order)</div>
                  <div className={styles.missingSkillsRow}>
                    {(gap.skill_gaps || gap.missing_skills.map((s) => ({ skill: s, priority: "medium" }))).map((g) => (
                      <span key={g.skill || g} className={`${styles.priorityChip} ${styles[g.priority] || styles.medium}`} title={g.reason || ""}>
                        {(g.priority || "medium").toUpperCase()}: {g.skill || g}
                      </span>
                    ))}
                  </div>
                </>
              )}
              {(gap.missing_certifications || []).length > 0 && (
                <>
                  <div className={dashStyles.fieldLabel} style={{ marginBottom: 6, marginTop: 12 }}>Missing certifications</div>
                  <div className={styles.missingSkillsRow}>
                    {gap.missing_certifications.map((c) => {
                      const label = typeof c === "string" ? c : c.title || c.name;
                      return <span key={label} className={`${styles.priorityChip} ${styles.immediate}`}>{label}</span>;
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {path && path.path && path.path.length > 0 && (
        <div className={dashStyles.section}>
          <div className={dashStyles.sectionHead}>
            <div className={dashStyles.sectionHeadLeft}>
              <span className={`${dashStyles.bar} ${dashStyles.navy}`} />
              <div>
                <div className={dashStyles.sectionTitle}>Your learning path</div>
                <p className={dashStyles.sectionDesc}>
                  Toward: {path.target_role}
                  {path.progress_percent != null ? ` · ${path.progress_percent}% complete` : ""}
                  {path.estimated_total_hours ? ` · ~${path.estimated_total_hours}h` : ""}
                </p>
              </div>
            </div>
          </div>
          <div className={dashStyles.sectionBody}>
            {path.progress_percent != null && (
              <div className={styles.matrixTrack} style={{ marginBottom: 16, height: 8 }}>
                <div className={styles.matrixFill} style={{ width: `${path.progress_percent}%` }} />
              </div>
            )}
            <div className={styles.pathTimeline}>
              {path.path.map((step) => (
                <div key={step.step} className={styles.pathStep}>
                  <div className={styles.pathStepMarker}>
                    <div className={styles.pathStepNum}>{step.step}</div>
                    <div className={styles.pathStepLine} />
                  </div>
                  <div className={styles.pathStepBody}>
                    <div className={styles.pathSkillLabel}>Step {step.step}: {step.skill}{step.completed ? " ✓" : ""}</div>
                    <div className={styles.pathCourseTitle}>{step.course?.title}</div>
                    <div className={styles.pathCourseMeta}>
                      {step.course?.source || step.course?.provider || "Catalog"}
                      {step.course?.duration_minutes ? ` · ${step.course.duration_minutes} min` : ""}
                      {step.course?.url ? (
                        <> · <a href={step.course.url} target="_blank" rel="noopener noreferrer">Open resource</a></>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className={dashStyles.section}>
        <div className={dashStyles.sectionHead}>
          <div className={dashStyles.sectionHeadLeft}>
            <span className={`${dashStyles.bar} ${dashStyles.cyan}`} />
            <div>
              <div className={dashStyles.sectionTitle}>Course recommendations</div>
              <p className={dashStyles.sectionDesc}>Personalized picks from Microsoft Learn, Coursera &amp; recruiter courses</p>
            </div>
          </div>
          <button type="button" className={styles.smallBtn} onClick={() => loadRecommendations(true)} disabled={recsLoading}>
            {recsLoading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div className={dashStyles.sectionBody}>
          {recsLoading && <p className={styles.inlineNote}>Thinking…</p>}
          {!recsLoading && (!recs?.recommendations || recs.recommendations.length === 0) && (
            <div className={dashStyles.emptyState}>
              <div className={dashStyles.emptyTitle}>No recommendations yet</div>
              <div className={dashStyles.emptySub}>Add a few skills to your profile for better matches.</div>
            </div>
          )}
          <div className={styles.aiGrid}>
            {(recs?.recommendations || []).map((course) => (
              <div key={course.uid} className={styles.aiCard}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span className={`${styles.courseType} ${course.type === "certification" ? styles.certification : ""}`}>
                    {course.type === "learningPath" ? "Learning Path" : course.type === "certification" ? "Certification" : "Module"}
                  </span>
                  {course.priority && (
                    <span className={`${styles.priorityChip} ${styles[course.priority] || ""}`}>
                      {course.priority}
                    </span>
                  )}
                </div>
                <div className={styles.courseTitle} style={{ marginTop: 8 }}>{course.title}</div>
                <div className={styles.courseMeta} style={{ marginTop: 6 }}>
                  {(course.levels || [])[0] && <span className={styles.levelBadge}>{course.levels[0]}</span>}
                  <span>{course.duration_minutes} min</span>
                </div>
                <div className={styles.aiReason}>
                  <div className={styles.aiReasonLabel}>Why this course</div>
                  {course.reason}
                </div>
                <div className={styles.courseActions} style={{ marginTop: 10 }}>
                  <a href={course.url} target="_blank" rel="noopener noreferrer" className={styles.smallBtnPrimary}>Start Learning</a>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function ReadinessRing({ percentage = 0, size = 84, stroke = 8 }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, Math.max(0, percentage)) / 100) * circumference;
  return (
    <div style={{ width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#E3E9F0" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#00A9CE" strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x="50%" y="53%" textAnchor="middle" style={{ fontWeight: 800, fontSize: "1.05rem", fill: "#0F2A4A" }}>
          {percentage}%
        </text>
      </svg>
    </div>
  );
}

// ------------------------------------------------------------------------ //
// Certificates
// ------------------------------------------------------------------------ //
function CertificatesTab({ onChange }) {
  const [certificates, setCertificates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ course_title: "", completion_date: "", learning_hours: "" });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    listMyCertificates(token)
      .then((data) => setCertificates(data.certificates || []))
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not load your certificates.")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleUpload(e) {
    e.preventDefault();
    if (!file || !form.course_title.trim()) {
      toast.error("Add a course title and select a file.");
      return;
    }
    const token = localStorage.getItem("access_token");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("course_title", form.course_title.trim());
    if (form.completion_date) fd.append("completion_date", form.completion_date);
    if (form.learning_hours) fd.append("learning_hours", form.learning_hours);
    setSaving(true);
    try {
      await uploadCertificate(token, fd);
      toast.success("Certificate submitted for recruiter verification.");
      setForm({ course_title: "", completion_date: "", learning_hours: "" });
      setFile(null);
      load();
      onChange?.();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not upload certificate."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={dashStyles.section}>
      <div className={dashStyles.sectionHead}>
        <div className={dashStyles.sectionHeadLeft}>
          <span className={`${dashStyles.bar} ${dashStyles.green}`} />
          <div>
            <div className={dashStyles.sectionTitle}>Certificates</div>
            <p className={dashStyles.sectionDesc}>Upload completion certificates for recruiter verification</p>
          </div>
        </div>
      </div>
      <div className={dashStyles.sectionBody}>
        <form className={styles.uploadCertForm} onSubmit={handleUpload}>
          <label>
            Course / certification title
            <input value={form.course_title} onChange={(e) => setForm((f) => ({ ...f, course_title: e.target.value }))} required />
          </label>
          <label>
            Completion date
            <input type="date" value={form.completion_date} onChange={(e) => setForm((f) => ({ ...f, completion_date: e.target.value }))} />
          </label>
          <label>
            Learning hours
            <input type="number" min="0" step="0.5" value={form.learning_hours} onChange={(e) => setForm((f) => ({ ...f, learning_hours: e.target.value }))} />
          </label>
          <label>
            Certificate file
            <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] || null)} required />
          </label>
          <button type="submit" className={dashStyles.btnPrimary} disabled={saving} style={{ gridColumn: "1 / -1", justifySelf: "start" }}>
            {saving ? "Uploading…" : "Submit for verification"}
          </button>
        </form>

        {loading && <p className={styles.inlineNote}>Loading…</p>}
        {!loading && certificates.length === 0 && (
          <div className={dashStyles.emptyState}>
            <div className={dashStyles.emptyTitle}>No certificates uploaded yet</div>
            <div className={dashStyles.emptySub}>Completed a course on Microsoft Learn? Upload the certificate above.</div>
          </div>
        )}
        {certificates.map((c) => (
          <div key={c.id} className={styles.certRow}>
            <div className={styles.certInfo}>
              <div className={styles.certTitle}>{c.course_title}</div>
              <div className={styles.certMeta}>
                {c.completion_date ? `Completed ${c.completion_date} · ` : ""}
                {c.learning_hours ? `${c.learning_hours} hrs · ` : ""}
                Submitted {new Date(c.created_at).toLocaleDateString()}
                {c.rejection_reason ? ` · ${c.rejection_reason}` : ""}
              </div>
            </div>
            <span className={`${styles.certStatus} ${styles[c.verification_status]}`}>
              {c.verification_status === "verified" ? "Verified" : c.verification_status === "rejected" ? "Rejected" : "Pending review"}
            </span>
            <a href={c.file_url} target="_blank" rel="noopener noreferrer" className={styles.smallBtn}>View</a>
          </div>
        ))}
      </div>
    </div>
  );
}

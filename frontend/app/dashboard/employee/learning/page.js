"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "react-toastify";

import EmployeeShell from "@/components/employee/EmployeeShell";
import RecruiterLoader from "@/components/recruiter/RecruiterLoader";
import ConfirmDialog from "@/components/ConfirmDialog";
import FileUploadField from "@/components/FileUploadField";
import dashStyles from "@/app/dashboard/employee/employee-dashboard.module.css";
import styles from "./learning.module.css";
import { getApiErrorMessage } from "@/services/authService";
import {
  addBookmark,
  browseCatalog,
  deleteSkill,
  deleteCertificate,
  getCareerGoal,
  getCareerPath,
  getCatalogFacets,
  getDesignationReadiness,
  getLearningDashboard,
  getRecommendations,
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
  updateCertificate,
  updateCourseProgress,
  uploadCertificate,
  upsertSkill,
} from "@/services/learningService";
import { getCareerProgression } from "@/services/talentService";
import { getMyCareerProgress } from "@/services/careerService";
import { useOrgFrameworkOptions } from "@/hooks/useOrgFrameworkOptions";
import { publishGuideContext, registerPageAssist } from "@/lib/ai/guideContext";
import { invalidateInsightCache } from "@/lib/ai/employeeInsights";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "catalog", label: "Course Catalog" },
  { key: "my-courses", label: "My Learning" },
  { key: "skills", label: "Skill Profile" },
  { key: "career", label: "Career Path" },
];

const LEARNING_PROVIDERS_UPDATED_EVENT = "learning-providers-updated";
const LEARNING_PROVIDERS_UPDATED_STORAGE_KEY = "learning-providers-updated-at";

export default function EmployeeLearningPage() {
  return (
    <Suspense fallback={<RecruiterLoader />}>
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
  const [providerRefreshSeed, setProviderRefreshSeed] = useState(0);

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
    const refresh = () => setProviderRefreshSeed((value) => value + 1);
    const onStorage = (event) => {
      if (event.key === LEARNING_PROVIDERS_UPDATED_STORAGE_KEY) {
        refresh();
      }
    };
    window.addEventListener(LEARNING_PROVIDERS_UPDATED_EVENT, refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(LEARNING_PROVIDERS_UPDATED_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    const next = searchParams.get("tab");
    if (next && TABS.some((t) => t.key === next)) setTab(next);
  }, [searchParams]);

  useEffect(() => {
    publishGuideContext({
      pathname: "/dashboard/employee/learning",
      section: tab,
      label: TABS.find((item) => item.key === tab)?.label || tab,
      tab,
      progress: dashboard?.summary || null,
    });
  }, [tab, dashboard]);

  // Enrollments / progress / certificates change what the AI guide reports.
  const refreshAfterChange = useCallback(() => {
    invalidateInsightCache();
    loadDashboard();
  }, [loadDashboard]);

  // Page-scoped Copilot assist — switch tabs / point at next learning action only.
  useEffect(() => {
    return registerPageAssist({
      propose: () => {
        const summary = dashboard?.summary || {};
        const assigned = summary.assigned_count ?? dashboard?.mandatory_count ?? 0;
        const inProgress = summary.in_progress_count ?? 0;
        const items = [];
        if (assigned) items.push(`${assigned} course${assigned === 1 ? "" : "s"} to start`);
        if (inProgress) items.push(`${inProgress} in progress`);

        if (tab !== "my-courses" && (assigned || inProgress)) {
          return {
            message: `You have learning work waiting. I can switch you to My Learning so you can start or resume — I won't leave Learning.`,
            items,
            applyLabel: "Open My Learning",
            busyMessage: "Switching to My Learning…",
            doneMessage: "✓ You're on My Learning — pick a course to continue.",
            meta: { tab: "my-courses" },
          };
        }
        if (tab === "overview" && !assigned && !inProgress) {
          return {
            message: "Nothing is waiting in My Learning. I can open Career Path so you can work the promotion checklist for your next role.",
            applyLabel: "Open Career Path",
            busyMessage: "Opening Career Path…",
            doneMessage: "✓ Career Path is open — start the next required course.",
            meta: { tab: "career" },
          };
        }
        if (tab === "career") {
          return {
            message: "Start the next required course on this checklist, then finish it in My Learning so it counts toward promotion.",
            applyLabel: "Open My Learning",
            busyMessage: "Switching to My Learning…",
            doneMessage: "✓ You're on My Learning — resume or submit a certificate.",
            meta: { tab: "my-courses" },
          };
        }
        if (tab === "skills") {
          return {
            message: "Your skill profile drives recommendations. I can open Career Path so you can work through your promotion checklist.",
            applyLabel: "Open Career Path",
            busyMessage: "Opening Career Path…",
            doneMessage: "✓ Career Path is open — work the promotion checklist for your next role.",
            meta: { tab: "career" },
          };
        }
        return null;
      },
      apply: async (offer) => {
        if (offer.meta?.tab) setTab(offer.meta.tab);
        await new Promise((resolve) => setTimeout(resolve, 280));
      },
    });
  }, [tab, dashboard]);

  return (
    <EmployeeShell
      activeKey="learning"
      title="Learning"
      subtitle={dashboard ? `${dashboard.employee?.job_title || "Employee"} · ${dashboard.employee?.department || "—"}` : ""}
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

      {tab === "overview" && <OverviewTab dashboard={dashboard} onGo={setTab} onRefresh={refreshAfterChange} />}
      {tab === "catalog" && <CatalogTab onEnroll={refreshAfterChange} refreshSeed={providerRefreshSeed} />}
      {tab === "my-courses" && <MyCoursesTab onChange={refreshAfterChange} />}
      {tab === "skills" && <SkillsTab />}
      {tab === "career" && <CareerTab onGo={setTab} />}
    </EmployeeShell>
  );
}

// ------------------------------------------------------------------------ //
// Overview (US-069)
// ------------------------------------------------------------------------ //
function OverviewTab({ dashboard, onGo, onRefresh }) {
  const [startingUid, setStartingUid] = useState("");
  if (!dashboard) return null;
  const s = dashboard.summary || {};

const stats = [
    { label: "To start", value: s.assigned_count ?? 0, color: "orange", icon: "play" },
    { label: "In Progress", value: s.in_progress_count ?? 0, color: "cyan", icon: "clock" },
    { label: "Completed", value: s.completed_count ?? 0, color: "green", icon: "check" },
    { label: "Certificates Earned", value: s.certificates_earned ?? 0, color: "navy", icon: "award" },
  ];

  const STAT_ICONS = {
    play: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
      </svg>
    ),
    clock: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
    check: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="8 12 11 15 16 9" />
      </svg>
    ),
    award: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="6" />
        <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
      </svg>
    ),
  };

  async function startAssigned(uid) {
    const token = localStorage.getItem("access_token");
    if (!token || !uid) return;
    setStartingUid(uid);
    try {
      const data = await startCourse(token, uid);
      if (data.redirect_url) window.open(data.redirect_url, "_blank", "noopener,noreferrer");
      onRefresh?.();
      onGo("my-courses");
      toast.success("Course started — tracking your progress.");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not start this course."));
    } finally {
      setStartingUid("");
    }
  }

  const assigned = s.assigned_count ?? 0;
  const inProgress = s.in_progress_count ?? 0;
  const nextAction = assigned > 0
    ? {
        title: "Start here",
        body: `You have ${assigned} assigned course${assigned === 1 ? "" : "s"} waiting. Open My Learning to begin — that is what counts toward progress.`,
        cta: "Open My Learning",
        tab: "my-courses",
      }
    : inProgress > 0
      ? {
          title: "Continue learning",
          body: `${inProgress} course${inProgress === 1 ? "" : "s"} in progress. Pick up where you left off, then submit a certificate when you finish.`,
          cta: "Continue in My Learning",
          tab: "my-courses",
        }
      : {
          title: "Work toward your next role",
          body: "Your promotion checklist is on Career Path. Complete those required items to become eligible — optional catalog courses come after.",
          cta: "Open Career Path",
          tab: "career",
        };

  return (
    <>
      <div className={dashStyles.hero}>
        <div>
          <div className={dashStyles.heroEyebrow}>Learning &amp; Development</div>
          <h1>Grow your skills with your learning providers</h1>
          <div className={dashStyles.heroMeta}>
            Overall progress: <b>{s.overall_progress_percent ?? 0}%</b> · Learning hours logged:{" "}
            <b>{s.total_learning_hours ?? 0}</b>
          </div>
          <div className={dashStyles.heroActions}>
            <button type="button" className={dashStyles.btnPrimary} onClick={() => onGo(nextAction.tab)}>
              {nextAction.cta}
            </button>
            <button type="button" className={dashStyles.btnGhost} onClick={() => onGo("catalog")}>
              Browse catalog
            </button>
          </div>
        </div>
      </div>

      <div className={styles.readyHero}>
        <div className={styles.readyCopy}>
          <div className={styles.readyTitle}>{nextAction.title}</div>
          <p>{nextAction.body}</p>
        </div>
      </div>

      <div className={dashStyles.stats}>
        {stats.map((stat) => (
          <div key={stat.label} className={dashStyles.statCard}>
            <div className={dashStyles.statTop}>
              <span className={`${dashStyles.statIcon} ${dashStyles[stat.color]}`}>
                {STAT_ICONS[stat.icon]}
              </span>
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
                <button type="button" className={styles.smallBtn} onClick={() => onGo("my-courses")}>
                  {e.status === "completed" ? "View" : "Continue"}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className={dashStyles.section}>
          <div className={dashStyles.sectionHead}>
            <div className={dashStyles.sectionHeadLeft}>
              <span className={`${dashStyles.bar} ${dashStyles.orange}`} />
              <div>
                <div className={dashStyles.sectionTitle}>Assigned Courses</div>
                <p className={dashStyles.sectionDesc}>Courses waiting for you to start</p>
              </div>
            </div>
          </div>
          <div className={dashStyles.sectionBody}>
            {(dashboard.upcoming_due || []).length === 0 && (
              <p className={styles.inlineNote}>
                No pending assignments.{" "}
                <button type="button" className={styles.textLink} onClick={() => onGo("career")}>
                  Open Career Path
                </button>{" "}
                for the courses required for your next role.
              </p>
            )}
            {(dashboard.upcoming_due || []).map((a, index) => (
              <div key={a.id || `${a.course_uid}-${a.due_date || index}`} className={styles.courseListRow}>
                <div className={styles.courseListInfo}>
                  <div className={styles.courseListTitle}>{a.course_title}</div>
                  <div className={styles.courseListMeta}>
                    {a.due_date ? `Due ${String(a.due_date).slice(0, 10)}` : "No due date"} · {a.status}
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.smallBtn}
                  disabled={startingUid === a.course_uid}
                  onClick={() => startAssigned(a.course_uid)}
                >
                  {startingUid === a.course_uid ? "Starting…" : "Start"}
                </button>
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
const STATIC_CATALOG_SOURCES = [
  {
    key: "microsoft_learn",
    label: "Microsoft Courses",
    hint: "Technical learning paths, modules, and certifications from Microsoft Learn.",
  },
  {
    key: "coursera",
    label: "Coursera Courses",
    hint: "Industry soft-skills courses from Coursera (English) — communication, leadership, and more.",
  },
];
const EXCLUDED_PROVIDER_TABS = new Set(["Microsoft Learn", "Coursera"]);
const MANAGED_PROVIDER_REGISTRY_KEY = "talent-managed-learning-providers";

function normalizeManagedProviderTabs(providerValues) {
  const seen = new Set();
  const providers = [];
  for (const raw of providerValues || []) {
    const name = String(raw || "").trim();
    if (!name || EXCLUDED_PROVIDER_TABS.has(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    providers.push(name);
  }
  if (providers.length > 1) {
    return providers.filter((name) => name.toLowerCase() !== "managed learning");
  }
  return providers;
}

function readManagedProviderRegistry() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MANAGED_PROVIDER_REGISTRY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map((item) => String(item || "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeManagedProviderRegistry(providerValues) {
  if (typeof window === "undefined") return;
  try {
    const normalized = normalizeManagedProviderTabs(providerValues);
    window.localStorage.setItem(MANAGED_PROVIDER_REGISTRY_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore storage write failures.
  }
}

function CatalogTab({ onEnroll, refreshSeed = 0 }) {
  const [source, setSource] = useState("managed_learning");
  const [q, setQ] = useState("");
  const [facets, setFacets] = useState({ roles: [], levels: [], products: [], providers: [], designations: [], months: [], categories: [], competencies: [] });
  const [providers, setProviders] = useState([]);
  const [dynamicSources, setDynamicSources] = useState(STATIC_CATALOG_SOURCES);
  const [softSkillCategories, setSoftSkillCategories] = useState([]);
  const [role, setRole] = useState("");
  const [level, setLevel] = useState("");
  const [type, setType] = useState("");
  const [provider, setProvider] = useState("");
  const [designation, setDesignation] = useState("");
  const [learningMonth, setLearningMonth] = useState("");
  const [category, setCategory] = useState("");
  const [competency, setCompetency] = useState("");
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ courses: [], total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyUid, setBusyUid] = useState("");
  const initializedProvidersRef = useRef(false);

  function switchSource(nextSource) {
    if (nextSource === source) return;
    setSource(nextSource);
    setRole("");
    setLevel("");
    setType("");
    setProvider("");
    setDesignation("");
    setLearningMonth("");
    setCategory("");
    setCompetency("");
    setQ("");
    setPage(1);
  }

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    const isManagedProvider = source.startsWith("provider:");
    const facetSource = isManagedProvider ? "managed_learning" : source;
    if (facetSource === "coursera") {
      getSoftSkillCategories(token).then((data) => setSoftSkillCategories(data.categories || [])).catch(() => {});
    } else {
      getCatalogFacets(token, facetSource)
        .then((data) => {
          setFacets(data);
          if (facetSource === "managed_learning") {
            const providerList = normalizeManagedProviderTabs([
              ...(data?.providers || []),
              ...readManagedProviderRegistry(),
            ]);
            setProviders(providerList);
            writeManagedProviderRegistry(providerList);
            const providerSources = providerList.map((prov) => ({
              key: `provider:${prov}`,
              label: prov,
              hint: `Managed roadmap courses from ${prov}.`,
            }));
            setDynamicSources(
              providerSources.length
                ? [...providerSources, ...STATIC_CATALOG_SOURCES]
                : [
                    {
                      key: "managed_learning",
                      label: "Managed Courses",
                      hint: "Managed roadmap courses imported for your designation.",
                    },
                    ...STATIC_CATALOG_SOURCES,
                  ]
            );
            setSource((current) => {
              if (current.startsWith("provider:")) {
                const currentProvider = current.split(":")[1];
                if (providerList.length && !providerList.includes(currentProvider)) {
                  return `provider:${providerList[0]}`;
                }
                return current;
              }
              if (!initializedProvidersRef.current && providerList.length) {
                initializedProvidersRef.current = true;
                return `provider:${providerList[0]}`;
              }
              initializedProvidersRef.current = true;
              return current;
            });
          }
        })
        .catch(() => {});
    }
  }, [source, refreshSeed]);

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    const isManagedProvider = source.startsWith("provider:");
    const actualSource = isManagedProvider ? "managed_learning" : source;
    const selectedProvider = isManagedProvider ? source.split(":")[1] : "";
    browseCatalog(token, {
      q: q || undefined,
      role: actualSource === "microsoft_learn" ? role || undefined : undefined,
      level: actualSource === "microsoft_learn" ? level || undefined : undefined,
      type: actualSource === "microsoft_learn" ? type || undefined : undefined,
      provider: actualSource === "managed_learning" ? (selectedProvider || provider || undefined) : undefined,
      designation: actualSource === "managed_learning" ? designation || undefined : undefined,
      learning_month: actualSource === "managed_learning" ? learningMonth || undefined : undefined,
      category: actualSource === "coursera" || actualSource === "managed_learning" ? category || undefined : undefined,
      competency: actualSource === "managed_learning" ? competency || undefined : undefined,
      source: actualSource,
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
  }, [q, role, level, type, provider, designation, learningMonth, category, competency, source, bookmarkedOnly, page, refreshSeed]);

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

  const isManagedProvider = source.startsWith("provider:");
  const actualSource = isManagedProvider ? "managed_learning" : source;
  const isSoftSkills = source === "coursera";
  const activeSource = dynamicSources.find((s) => s.key === source) || dynamicSources[0];

  return (
    <div className={dashStyles.section}>
      <div className={dashStyles.sectionHead}>
        <div className={dashStyles.sectionHeadLeft}>
          <span className={`${dashStyles.bar} ${dashStyles.cyan}`} />
          <div>
            <div className={dashStyles.sectionTitle}>{activeSource.label}</div>
            <p className={dashStyles.sectionDesc}>
              {result.total} results · pick a source below to browse
            </p>
          </div>
        </div>
      </div>
      <div className={dashStyles.sectionBody}>
        <div className={styles.sourceToggle} role="tablist" aria-label="Course source">
          {dynamicSources.map((s) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={source === s.key}
              className={`${styles.sourceBtn} ${source === s.key ? styles.sourceBtnActive : ""}`}
              onClick={() => switchSource(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className={styles.sourceHint}>{activeSource.hint}</p>

        <div className={styles.filterBar}>
          <input
            className={styles.searchInput}
            placeholder={
              isSoftSkills
                ? "Search soft skills, e.g. negotiation, leadership…"
                : isManagedProvider
                  ? `Search ${source.split(":")[1]} courses by title, month, or competency…`
                  : "Search by title, skill, product…"
            }
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
          ) : actualSource === "microsoft_learn" ? (
            <>
              <select className={styles.filterSelect} value={type} onChange={(e) => { setPage(1); setType(e.target.value); }}>
                <option value="">All types</option>
                <option value="learningPath">Learning paths</option>
                <option value="module">Modules</option>
                <option value="certification">Certifications</option>
              </select>
              <select className={styles.filterSelect} value={level} onChange={(e) => { setPage(1); setLevel(e.target.value); }}>
                <option value="">All levels</option>
                {(facets.levels || []).map((lv) => (
                  <option key={lv} value={lv}>{lv[0].toUpperCase() + lv.slice(1)}</option>
                ))}
              </select>
              <select className={styles.filterSelect} value={role} onChange={(e) => { setPage(1); setRole(e.target.value); }}>
                <option value="">All roles</option>
                {(facets.roles || []).map((r) => (
                  <option key={r} value={r}>{r.replace(/-/g, " ")}</option>
                ))}
              </select>
            </>
          ) : null}
          {source === "managed_learning" && (
            <select className={styles.filterSelect} value={provider} onChange={(e) => {
              setPage(1);
              setProvider(e.target.value);
            }}>
              <option value="">All providers</option>
              {(providers.length ? providers : facets.providers || []).map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          )}
          <label className={styles.bookmarkFilter}>
            <input
              type="checkbox"
              checked={bookmarkedOnly}
              onChange={(e) => { setPage(1); setBookmarkedOnly(e.target.checked); }}
            />
            Bookmarked only
          </label>
          {actualSource === "microsoft_learn" && (
            <button
              type="button"
              className={`${styles.filterSelect} ${type === "certification" ? styles.sourceBtnActive : ""}`}
              style={{ cursor: "pointer", fontWeight: 700 }}
              onClick={() => { setPage(1); setType(type === "certification" ? "" : "certification"); }}
            >
              Certifications only
            </button>
          )}
          {(q || role || level || type || category || bookmarkedOnly) && (
            <button
              type="button"
              className={styles.clearFiltersBtn}
              onClick={() => { setQ(""); setRole(""); setLevel(""); setType(""); setCategory(""); setBookmarkedOnly(false); setPage(1); }}
            >
              Clear filters
            </button>
          )}
        </div>

        {error && <div className={styles.errorNote}>{error}</div>}
        {loading && <p className={styles.inlineNote}>Loading courses…</p>}

        <div className={styles.courseGrid}>
          {result.courses.map((course) => (
            <div key={course.uid} className={styles.courseCard}>
              <div className={styles.courseCardHead}>
                <div className={styles.badgeRow}>
                  <span
                    className={`${styles.sourceBadge} ${
                      course.source === "coursera"
                        ? styles.sourceBadgeCoursera
                        : course.source === "managed_learning"
                          ? styles.sourceBadgeRecruiter
                          : ""
                    }`}
                  >
                    {course.source === "coursera"
                      ? "Coursera"
                      : course.source === "managed_learning"
                        ? (course.provider || "Managed")
                        : "Microsoft"}
                  </span>
                  <span className={`${styles.courseType} ${course.type === "certification" ? styles.certification : ""}`}>
                    {course.type === "learningPath" ? "Learning Path" : course.type === "certification" ? "Certification" : course.type === "course" ? "Course" : "Module"}
                  </span>
                  {course.ai_recommended && (
                    <span className={styles.recommendedBadge} title="Ranked first because it matches your current skill gap">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.3L22 9.3l-5 4.9 1.2 6.9L12 17.8 5.8 21.1 7 14.2 2 9.3l7.1-1z" /></svg>
                      For you
                    </span>
                  )}
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
  const [certificates, setCertificates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [startingUid, setStartingUid] = useState("");
  const [uploadingFor, setUploadingFor] = useState(null);
  const [uploadForm, setUploadForm] = useState({ course_title: "", completion_date: "", learning_hours: "", source_url: "" });
  const [uploadFile, setUploadFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [editingCertId, setEditingCertId] = useState(null);
  const [editForm, setEditForm] = useState({ course_title: "", completion_date: "", learning_hours: "" });
  const today = new Date().toISOString().split("T")[0];

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    Promise.all([
      listMyCourses(token, statusFilter || undefined),
      listMyCertificates(token),
    ])
      .then(([coursesData, certsData]) => {
        setEnrollments(coursesData.enrollments || []);
        setCertificates(certsData.certificates || []);
      })
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not load your courses.")))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  function getCertificateForCourse(courseUid, courseTitle) {
    const uid = (courseUid || "").trim();
    const title = (courseTitle || "").trim().toLowerCase();
    return (
      certificates.find((c) => uid && c.course_uid === uid) ||
      certificates.find((c) => title && (c.course_title || "").trim().toLowerCase() === title) ||
      null
    );
  }

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

  async function startAssigned(uid) {
    const token = localStorage.getItem("access_token");
    if (!token || !uid) return;
    setStartingUid(uid);
    try {
      const data = await startCourse(token, uid);
      if (data.redirect_url) window.open(data.redirect_url, "_blank", "noopener,noreferrer");
      load();
      onChange?.();
      toast.success("Course started — tracking your progress.");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not start this course."));
    } finally {
      setStartingUid("");
    }
  }

  async function openCourse(course) {
    const direct = (course?.course_url || "").trim();
    if (direct.startsWith("http://") || direct.startsWith("https://")) {
      window.open(direct, "_blank", "noopener,noreferrer");
      return;
    }
    const token = localStorage.getItem("access_token");
    const uid = course?.course_uid;
    if (!token || !uid) {
      toast.error("No course link is available yet. Ask your recruiter to add the course URL in Organization Setup.");
      return;
    }
    setStartingUid(uid);
    try {
      const data = await startCourse(token, uid);
      const url = (data.redirect_url || data.enrollment?.course_url || "").trim();
      if (url.startsWith("http://") || url.startsWith("https://")) {
        window.open(url, "_blank", "noopener,noreferrer");
        load();
        onChange?.();
        return;
      }
      toast.error("No course link is available yet. Ask your recruiter to add the course URL in Organization Setup.");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not open this course."));
    } finally {
      setStartingUid("");
    }
  }

  async function handleUploadCertificate(courseUid, e) {
    e.preventDefault();
    const link = uploadForm.source_url?.trim() || "";
    if (!uploadForm.course_title.trim() || !link) {
      toast.error("Add a course title and certificate link (required for recruiter verification).");
      return;
    }
    if (!/^https?:\/\//i.test(link)) {
      toast.error("Certificate link must start with http:// or https://");
      return;
    }
    if (!uploadForm.completion_date) {
      toast.error("Completion date is required.");
      return;
    }
    if (uploadForm.completion_date > today) {
      toast.error("Completion date cannot be in the future.");
      return;
    }
    if (!uploadForm.learning_hours && uploadForm.learning_hours !== 0) {
      toast.error("Learning hours are required.");
      return;
    }
    const token = localStorage.getItem("access_token");
    const fd = new FormData();
    if (uploadFile) fd.append("file", uploadFile);
    fd.append("course_title", uploadForm.course_title.trim());
    fd.append("course_uid", courseUid);
    fd.append("source_url", link);
    fd.append("completion_date", uploadForm.completion_date);
    fd.append("learning_hours", uploadForm.learning_hours);
    setUploading(true);
    try {
      await uploadCertificate(token, fd);
      toast.success("Certificate submitted — course stays in progress until your recruiter verifies it.");
      setUploadForm({ course_title: "", completion_date: "", learning_hours: "", source_url: "" });
      setUploadFile(null);
      setUploadingFor(null);
      load();
      onChange?.();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not upload certificate."));
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteCertificate(certId) {
    if (!window.confirm("Delete this certificate? This cannot be undone.")) return;
    const token = localStorage.getItem("access_token");
    if (!token) return;
    try {
      await deleteCertificate(token, certId);
      toast.success("Certificate deleted.");
      setEditingCertId(null);
      load();
      onChange?.();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not delete certificate."));
    }
  }

  async function handleEditSave(certId) {
    if (!editForm.course_title.trim()) {
      toast.error("Course title is required.");
      return;
    }
    if (!editForm.completion_date) {
      toast.error("Completion date is required.");
      return;
    }
    if (editForm.completion_date > today) {
      toast.error("Completion date cannot be in the future.");
      return;
    }
    if (!editForm.learning_hours && editForm.learning_hours !== 0) {
      toast.error("Learning hours are required.");
      return;
    }
    const token = localStorage.getItem("access_token");
    if (!token) return;
    const payload = {
      course_title: editForm.course_title.trim(),
      completion_date: editForm.completion_date,
      learning_hours: parseFloat(editForm.learning_hours),
    };
    try {
      await updateCertificate(token, certId, payload);
      toast.success("Certificate updated.");
      setEditingCertId(null);
      setEditForm({ course_title: "", completion_date: "", learning_hours: "" });
      load();
      onChange?.();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not update certificate."));
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
          <option value="assigned">Assigned</option>
          <option value="in_progress">In progress</option>
          <option value="completed">Completed</option>
        </select>
      </div>
      <div className={dashStyles.sectionBody}>
        {!loading && enrollments.length === 0 && (
          <div className={dashStyles.emptyState}>
            <div className={dashStyles.emptyTitle}>Nothing here yet</div>
            <div className={dashStyles.emptySub}>Start a course from the catalog, or wait for your recruiter to assign one.</div>
          </div>
        )}
        {enrollments.map((e) => {
          const isAssignedOnly = e.status === "assigned";
          const cert = getCertificateForCourse(e.course_uid, e.course_title);
          const isVerified = cert?.verification_status === "verified";
          const isPending = cert?.verification_status === "pending";
          const isRejected = cert?.verification_status === "rejected";
          // Course is completed only after recruiter verifies the certificate (or no cert required and enrollment completed).
          const isCompleted = isVerified || (e.status === "completed" && !isPending && !isRejected);
          const progressPct = isCompleted ? 100 : isPending ? Math.min(Number(e.progress_percent) || 0, 90) : (e.progress_percent || 0);
          return (
            <div key={e.id} className={styles.courseListRow}>
              <div className={styles.courseListInfo}>
                <div className={styles.courseListTitle}>{e.course_title}</div>
                <div className={styles.courseListMeta}>
                  {e.assigned || isAssignedOnly ? "Assigned · " : ""}
                  {e.due_date ? `Due ${String(e.due_date).slice(0, 10)} · ` : ""}
                  {isAssignedOnly
                    ? "Not started yet"
                    : isCompleted
                      ? `Completed${e.completed_at || cert?.verified_at ? ` ${new Date(e.completed_at || cert.verified_at).toLocaleDateString()}` : ""}`
                      : `Started ${e.started_at ? new Date(e.started_at).toLocaleDateString() : "—"}`}
                  {isPending && " · Waiting for recruiter verification"}
                  {isRejected && " · Certificate rejected — resubmit"}
                </div>
                {!isAssignedOnly && (
                  <div className={styles.progressTrackSm} style={{ marginTop: 8, maxWidth: 220 }}>
                    <div className={styles.progressFillSm} style={{ width: `${progressPct}%` }} />
                  </div>
                )}
              </div>

              <div className={styles.courseListActions}>
                {isCompleted && (
                  <span className={`${styles.certStatus} ${styles.verified}`}>Completed</span>
                )}
                {isAssignedOnly ? (
                  <button
                    type="button"
                    className={styles.smallBtnPrimary}
                    disabled={startingUid === e.course_uid}
                    onClick={() => startAssigned(e.course_uid)}
                  >
                    {startingUid === e.course_uid ? "Starting…" : "Start course"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.smallBtn}
                    disabled={startingUid === e.course_uid}
                    onClick={() => openCourse(e)}
                  >
                    {startingUid === e.course_uid ? "Opening…" : "Open course"}
                  </button>
                )}
                {!isVerified && !isPending && (
                  <button
                    type="button"
                    className={styles.smallBtn}
                    onClick={() => {
                      setUploadingFor(e.course_uid);
                      setUploadForm({
                        course_title: e.course_title || "",
                        completion_date: "",
                        learning_hours: "",
                        source_url: "",
                      });
                      setUploadFile(null);
                    }}
                  >
                    {isRejected ? "Resubmit certificate" : "Submit certificate"}
                  </button>
                )}
                {isPending && (
                  <span className={`${styles.certStatus} ${styles.pending}`}>Pending review</span>
                )}
                {isVerified && (
                  <span className={`${styles.certStatus} ${styles.verified}`}>Certificate verified</span>
                )}
              </div>

              {(uploadingFor === e.course_uid || cert) && (
              <div className={styles.courseCertPanel}>
                {uploadingFor === e.course_uid && (
                  <form className={styles.uploadCertForm} onSubmit={(ev) => handleUploadCertificate(e.course_uid, ev)}>
                    <div className={styles.uploadCertFormHead}>
                      <strong>Submit certificate for verification</strong>
                      <p>
                        Paste the public certificate link so your recruiter can verify it.
                        A PDF or image is optional.
                      </p>
                    </div>
                    <label className={styles.fieldWide}>
                      Certificate link <span className={styles.req}>*</span>
                      <input
                        type="url"
                        placeholder="https://linkedin.com/learning/certificates/…"
                        value={uploadForm.source_url || ""}
                        onChange={(ev) => setUploadForm((f) => ({ ...f, source_url: ev.target.value }))}
                        required
                      />
                    </label>
                    <label>
                      Completion date <span className={styles.req}>*</span>
                      <input
                        type="date"
                        value={uploadForm.completion_date}
                        max={today}
                        onChange={(ev) => setUploadForm((f) => ({ ...f, completion_date: ev.target.value }))}
                        required
                      />
                    </label>
                    <label>
                      Learning hours <span className={styles.req}>*</span>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        placeholder="e.g. 2"
                        value={uploadForm.learning_hours}
                        onChange={(ev) => setUploadForm((f) => ({ ...f, learning_hours: ev.target.value }))}
                        required
                      />
                    </label>
                    <div className={styles.uploadCertFileField}>
                      <FileUploadField
                        caption="Certificate file (optional)"
                        label="Upload document"
                        replaceLabel="Replace document"
                        accept=".pdf,.png,.jpg,.jpeg"
                        onChange={(ev) => setUploadFile(ev.target.files?.[0] || null)}
                        selected={!!uploadFile}
                      />
                      {uploadFile && (
                        <div className={styles.uploadCertSelectedFile}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                          {uploadFile.name}
                        </div>
                      )}
                    </div>
                    <p className={styles.uploadCertHint}>
                      After your recruiter approves, this course is marked complete and skills/certifications are added to your profile.
                    </p>
                    <div className={styles.uploadCertFormActions}>
                      <button type="submit" className={styles.uploadCertSubmit} disabled={uploading}>
                        {uploading ? "Submitting…" : "Send to recruiter"}
                      </button>
                      <button
                        type="button"
                        className={styles.editCancelBtn}
                        onClick={() => {
                          setUploadingFor(null);
                          setUploadForm({ course_title: "", completion_date: "", learning_hours: "", source_url: "" });
                          setUploadFile(null);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}

                {cert && uploadingFor !== e.course_uid && (
                  <div className={styles.certRow}>
                    <div className={styles.certLeft}>
                      {editingCertId === cert.id ? (
                        <form className={styles.editCertForm} onSubmit={(ev) => { ev.preventDefault(); handleEditSave(cert.id); }}>
                          <div className={styles.editFormRow}>
                            <label>
                              Course / certification title
                              <input value={editForm.course_title} readOnly onChange={(ev) => setEditForm((f) => ({ ...f, course_title: ev.target.value }))} required />
                            </label>
                          </div>
                          <div className={styles.editFormRow}>
                            <label>
                              Completion date <span className={styles.req}>*</span>
                              <input type="date" value={editForm.completion_date} max={today} onChange={(ev) => setEditForm((f) => ({ ...f, completion_date: ev.target.value }))} required />
                            </label>
                            <label>
                              Learning hours <span className={styles.req}>*</span>
                              <input type="number" min="0" step="0.5" value={editForm.learning_hours} onChange={(ev) => setEditForm((f) => ({ ...f, learning_hours: ev.target.value }))} required />
                            </label>
                          </div>
                          <div className={styles.editFormActions}>
                            <button type="submit" className={dashStyles.btnPrimary}>Save changes</button>
                            <button type="button" className={styles.editCancelBtn} onClick={() => { setEditingCertId(null); setEditForm({ course_title: "", completion_date: "", learning_hours: "" }); }}>Cancel</button>
                          </div>
                        </form>
                      ) : (
                        <div className={styles.certInfo}>
                          <div className={styles.certTitle}>{cert.course_title}</div>
                          {cert.rejection_reason && (
                            <div className={styles.certMeta}>{cert.rejection_reason}</div>
                          )}
                          {isVerified && (cert.skills_awarded || []).length > 0 && (
                            <div className={styles.awardedSkills}>
                              <span className={styles.focusLabel}>Added to your skills</span>
                              <div className={styles.nextSkills}>
                                {cert.skills_awarded.map((name) => (
                                  <span key={name} className={`${styles.nextSkillChip} ${styles.nextSkillHave}`}>
                                    {name}
                                    {cert.proficiency_awarded ? ` · ${cert.proficiency_awarded}` : ""}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {isVerified && (cert.certifications_awarded || []).length > 0 && (
                            <div className={styles.awardedSkills}>
                              <span className={styles.focusLabel}>Certifications recorded</span>
                              <div className={styles.nextSkills}>
                                {cert.certifications_awarded.map((name) => (
                                  <span key={name} className={styles.focusChip}>{name}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          {isVerified && !(cert.skills_awarded || []).length && (
                            <p className={styles.nextCourseHint}>
                              Certificate verified — this course counts as completed. Skills appear on My skills when the course has linked outcomes.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                    <div className={styles.certRight}>
                      {(cert.file_url || cert.certificate_url) && (
                        <a href={cert.file_url || cert.certificate_url} target="_blank" rel="noopener noreferrer" className={styles.smallBtn}>View file</a>
                      )}
                      {cert.source_url ? (
                        <a href={cert.source_url} target="_blank" rel="noopener noreferrer" className={styles.smallBtn}>Open link</a>
                      ) : null}
                      {cert.verification_status !== "verified" && editingCertId !== cert.id && (
                        <>
                          <button type="button" className={styles.editCertBtn} onClick={() => { setEditingCertId(cert.id); setEditForm({ course_title: cert.course_title, completion_date: cert.completion_date || "", learning_hours: cert.learning_hours || "" }); }} title="Edit certificate">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                          <button type="button" className={styles.deleteCertBtn} onClick={() => handleDeleteCertificate(cert.id)} title="Delete certificate">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h16zM10 11v6M14 11v6" />
                            </svg>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------ //
// Skill profile (US-092 / US-093 / US-094)
// ------------------------------------------------------------------------ //
function SkillsTab() {
  const { skills: frameworkSkills } = useOrgFrameworkOptions();
  const [skills, setSkills] = useState([]);
  const [categories, setCategories] = useState([]);
  const [career, setCareer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ skill_name: "", category: "Programming", proficiency: "Beginner", years_experience: "" });
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    Promise.all([
      listSkills(token),
      getSkillCategories(token),
      getMyCareerProgress(token).catch(() => ({ assignment: null })),
    ])
      .then(([skillData, catData, careerData]) => {
        setSkills(skillData.skills || []);
        setCategories(catData.categories || []);
        setCareer(careerData?.assignment || null);
      })
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not load your skills.")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

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
      load();
      toast.success("Skill removed.");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not remove skill."));
    }
  }

  const proficiencyRank = { Beginner: 25, Intermediate: 50, Advanced: 75, Expert: 100 };
  const sourceLabel = (source) => {
    const s = (source || "").toLowerCase();
    if (s === "manual") return "You added";
    if (s === "course" || s === "org_roadmap") return "From a course";
    if (s.includes("resume") || s === "ai_resume") return "From resume";
    if (s === "certificate") return "From certificate";
    return null;
  };

  const targetRole = career?.target_role_title || null;
  const currentRole = career?.current_role_title || null;
  const pathCourses = career?.assigned_learning_path || [];
  const incompleteCourses = pathCourses.filter((c) => c.status !== "completed" && c.certificate_status !== "verified");
  const readinessPct = career?.readiness_score ?? career?.overall_progress_percent ?? null;

  function courseSkillNames(course) {
    return (course.skills || [])
      .map((x) => (typeof x === "string" ? x : x?.skill || ""))
      .map((n) => n.trim())
      .filter(Boolean);
  }

  function courseCertNames(course) {
    return (course.certifications || [])
      .map((x) => (typeof x === "string" ? x : x?.certification || x?.name || ""))
      .map((n) => n.trim())
      .filter(Boolean);
  }

  return (
    <div className={dashStyles.section}>
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Remove skill?"
        message="This skill will be removed from your profile. You can add it again later."
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
            <div className={dashStyles.sectionTitle}>My skills</div>
            <p className={dashStyles.sectionDesc}>
              Skills on your profile. Finish a course → submit certificate → recruiter verifies → skills &amp; level appear here.
            </p>
          </div>
        </div>
      </div>
      <div className={dashStyles.sectionBody}>
        {targetRole && (
          <div className={styles.readyHero}>
            <div className={styles.readyScore}>{readinessPct ?? 0}%</div>
            <div className={styles.readyCopy}>
              <div className={styles.readyTitle}>
                {currentRole && currentRole.toLowerCase() !== targetRole.toLowerCase()
                  ? `Toward ${targetRole}`
                  : `Ready for ${targetRole}`}
              </div>
              <p>
                These courses are still open. Completing them does not add skills until your recruiter
                verifies the certificate — then they show below with the level (e.g. Intermediate).
              </p>
            </div>
          </div>
        )}

        {incompleteCourses.length > 0 && (
          <div className={styles.nextLearn}>
            <div className={styles.nextLearnHead}>
              <h3 className={styles.nextLearnTitle}>Courses still to finish</h3>
              <p className={styles.nextLearnDesc}>
                Open them in My Learning, submit a certificate link, then wait for verification.
                Skills listed here are what you will earn — not skills you already completed.
              </p>
            </div>

            <div className={styles.nextCourseList}>
              {incompleteCourses.map((c) => {
                const skillNames = courseSkillNames(c);
                const certNames = courseCertNames(c);
                const award = c.skills_award_level || "Intermediate";
                const status =
                  c.certificate_status === "pending"
                    ? "Certificate submitted — awaiting recruiter"
                    : c.status === "in_progress"
                      ? "In progress — not completed yet"
                      : "Not started";
                return (
                  <div key={c.course_uid || c.course_title} className={styles.nextCourse}>
                    <div className={styles.nextCourseTop}>
                      <div>
                        <div className={styles.nextCourseName}>{c.course_title || c.course_uid}</div>
                        <div className={styles.nextCourseMeta}>{status}</div>
                      </div>
                      <span className={styles.awardBadge}>
                        After verify → {award}
                      </span>
                    </div>
                    {skillNames.length > 0 && (
                      <>
                        <div className={styles.focusLabel} style={{ marginTop: 10 }}>Skills you will earn</div>
                        <div className={styles.nextSkills}>
                          {skillNames.map((name) => (
                            <span key={name} className={styles.nextSkillChip}>
                              {name} · {award}
                            </span>
                          ))}
                        </div>
                      </>
                    )}
                    {certNames.length > 0 && (
                      <>
                        <div className={styles.focusLabel} style={{ marginTop: 10 }}>Certification from this course</div>
                        <div className={styles.nextSkills}>
                          {certNames.map((name) => (
                            <span key={name} className={styles.focusChip}>
                              {name}
                            </span>
                          ))}
                        </div>
                      </>
                    )}
                    {skillNames.length === 0 && certNames.length === 0 && (
                      <p className={styles.nextCourseHint}>
                        After verification, skills from this course (and the certificate itself) are added to your profile at {award}.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!loading && skills.length > 0 && (
          <div className={styles.matrixBars}>
            <div className={styles.yourSkillsHead}>
              <div className={styles.focusLabel}>Skills on your profile</div>
              <p className={styles.matrixHint}>
                Only skills already saved on your profile. Course skills appear here after recruiter verification.
              </p>
            </div>
            {skills.slice(0, 10).map((s) => (
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
            <input value={form.skill_name} onChange={(e) => setForm((f) => ({ ...f, skill_name: e.target.value }))} placeholder="e.g. Docker" list="framework-skill-options" required />
            {frameworkSkills.length > 0 && (
              <datalist id="framework-skill-options">
                {frameworkSkills.map((skill) => <option key={skill} value={skill} />)}
              </datalist>
            )}
          </label>
          <label>
            Category
            <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>
            Level
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

        {!loading && skills.length === 0 && (
          <div className={dashStyles.emptyState}>
            <div className={dashStyles.emptyTitle}>No skills yet</div>
            <div className={dashStyles.emptySub}>
              Add skills here, update your resume on Profile, or complete a course and get the certificate verified.
            </div>
          </div>
        )}
        <div className={styles.skillGrid}>
          {skills.map((s) => (
            <div key={s.id || `${s.source}-${s.skill_name}`} className={styles.skillCard}>
              <div className={styles.skillCardHead}>
                <div>
                  <div className={styles.skillName}>{s.skill_name}</div>
                  <div className={styles.skillCategory}>
                    {[s.category, s.years_experience ? `${s.years_experience} yrs` : null, sourceLabel(s.source)]
                      .filter(Boolean)
                      .join(" · ")}
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
                  Verified from a course
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
function CareerTab({ onGo }) {
  const [savedGoal, setSavedGoal] = useState(null);
  const [, setGoal] = useState("");
  const [orgAssignment, setOrgAssignment] = useState(null);
  const [gap, setGap] = useState(null);
  const [path, setPath] = useState(null);
  const [gapLoading, setGapLoading] = useState(false);
  const [recs, setRecs] = useState(null);
  const [recsLoading, setRecsLoading] = useState(true);
  const [startingStep, setStartingStep] = useState("");
  const [ladder, setLadder] = useState(null);
  const [ladderLoading, setLadderLoading] = useState(true);
  const [designationReadiness, setDesignationReadiness] = useState(null);
  const [designationLoading, setDesignationLoading] = useState(false);
  const [showRemaining, setShowRemaining] = useState(true);
  const [bootLoading, setBootLoading] = useState(true);

  function loadGapAndPath(role, refresh = true) {
    const token = localStorage.getItem("access_token");
    if (!token || !role) return;
    setGapLoading(true);
    Promise.all([getCareerPath(token, refresh), getSkillGap(token, role, refresh)])
      .then(([pathData, gapData]) => {
        setPath(pathData);
        setGap(gapData);
      })
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not analyze your skill gap.")))
      .finally(() => setGapLoading(false));
  }

  function loadDesignationReadiness(role) {
    const token = localStorage.getItem("access_token");
    if (!token || !role) return;
    setDesignationLoading(true);
    getDesignationReadiness(token, role)
      .then(setDesignationReadiness)
      .catch(() => {})
      .finally(() => setDesignationLoading(false));
  }

  function loadRecommendations(refresh = false) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setRecsLoading(true);
    getRecommendations(token, refresh)
      .then(setRecs)
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not load AI recommendations.")))
      .finally(() => setRecsLoading(false));
  }

  async function applyTargetRole(role, { silent = false } = {}) {
    const token = localStorage.getItem("access_token");
    const target = (role || "").trim();
    if (!token || !target) return;
    setGoal(target);
    setGapLoading(true);
    try {
      const pathData = await setCareerGoal(token, target);
      setSavedGoal(target);
      setPath(pathData);
      const gapData = await getSkillGap(token, target, true);
      setGap(gapData);
      // Cache-first: do not regenerate AI recs on role sync / tab open.
      // User clicks Refresh on Course recommendations to force a new run.
      loadRecommendations(false);
      loadDesignationReadiness(target);
      if (!silent) toast.success(`Focused on “${target}”.`);
    } catch (err) {
      if (!silent) toast.error(getApiErrorMessage(err, "Could not load role analysis."));
      // Still try read-only analysis if goal sync fails
      loadGapAndPath(target, true);
      loadDesignationReadiness(target);
      loadRecommendations(false);
    } finally {
      setGapLoading(false);
    }
  }

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    let cancelled = false;
    setBootLoading(true);
    setLadderLoading(true);

    Promise.all([
      getMyCareerProgress(token).catch(() => ({ assignment: null })),
      getCareerProgression(token).catch(() => null),
      getCareerGoal(token).catch(() => ({})),
    ])
      .then(async ([progressData, progression, goalData]) => {
        if (cancelled) return;
        const assignment = progressData?.assignment || null;
        setOrgAssignment(assignment);

        let ladderData = progression;
        // If API ladder is empty but we have an org assignment, show at least current → next.
        if ((!ladderData?.ladder || ladderData.ladder.length === 0) && assignment) {
          const current = assignment.current_role_title;
          const next = assignment.target_role_title;
          const rungs = [];
          if (current) {
            rungs.push({
              title: current,
              is_current: true,
              is_next_step: false,
              progress_percentage: 100,
              missing_skills: (assignment.skills_to_acquire || [])
                .filter((s) => s.current_status !== "acquired")
                .map((s) => s.skill)
                .slice(0, 6),
              missing_certifications: (assignment.certifications_to_earn || [])
                .filter((c) => c.status !== "earned")
                .map((c) => c.certification)
                .slice(0, 4),
            });
          }
          if (next && next.toLowerCase() !== (current || "").toLowerCase()) {
            rungs.push({
              title: next,
              is_current: false,
              is_next_step: true,
              progress_percentage: assignment.overall_progress_percent ?? assignment.readiness_score ?? 0,
              missing_skills: (assignment.skills_to_acquire || [])
                .filter((s) => s.current_status !== "acquired")
                .map((s) => s.skill)
                .slice(0, 6),
              missing_certifications: (assignment.certifications_to_earn || [])
                .filter((c) => c.status !== "earned")
                .map((c) => c.certification)
                .slice(0, 4),
            });
          }
          ladderData = {
            current_title: current,
            ladder: rungs,
            source: "career_assignment",
            message: rungs.length ? null : ladderData?.message,
          };
        }
        setLadder(ladderData);

        const orgTarget =
          (assignment?.target_role_title || assignment?.current_role_title || "").trim() || null;
        const existingGoal = (goalData?.target_role || "").trim() || null;
        const focusRole = orgTarget || existingGoal;

        if (focusRole) {
          setSavedGoal(focusRole);
          setGoal(focusRole);
          // Prefer org next-role over a stale free-form goal (e.g. "AI Engineer").
          if (orgTarget && existingGoal?.toLowerCase() !== orgTarget.toLowerCase()) {
            await applyTargetRole(orgTarget, { silent: true });
          } else {
            loadGapAndPath(focusRole, false);
            loadDesignationReadiness(focusRole);
            loadRecommendations(false);
          }
        } else {
          // No career goal yet — still show cached recs if any.
          loadRecommendations(false);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLadderLoading(false);
          setBootLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the "Promotes to" rung % in sync with the Promotion checklist ring.
  useEffect(() => {
    const pct = designationReadiness?.readiness_percent;
    if (pct == null || !ladder?.ladder?.length) return;
    const nextIdx = ladder.ladder.findIndex((r) => r.is_next_step);
    if (nextIdx < 0) return;
    const currentPct = Math.round(ladder.ladder[nextIdx].progress_percentage ?? 0);
    if (currentPct === Math.round(pct)) return;
    setLadder((prev) => {
      if (!prev?.ladder?.length) return prev;
      return {
        ...prev,
        ladder: prev.ladder.map((rung) =>
          rung.is_next_step ? { ...rung, progress_percentage: Math.round(pct) } : rung
        ),
      };
    });
  }, [designationReadiness, ladder]);

  async function startChecklistCourse(req) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    const step = findPathStep(req);
    const uid = req?.course_uid || step?.course?.uid;
    const url = step?.course?.url;
    if (!uid || String(uid).startsWith("kb-cert:")) {
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }
      toast.info("This is a certification requirement — earn it, then upload proof in My Learning.");
      onGo?.("my-courses");
      return;
    }

    setStartingStep(uid);
    try {
      const data = await startCourse(token, uid);
      if (data.redirect_url || url) {
        window.open(data.redirect_url || url, "_blank", "noopener,noreferrer");
      }
      toast.success("Course started. Finish it in My Learning, then submit a certificate so it counts.");
      if (savedGoal) {
        loadDesignationReadiness(savedGoal);
        loadGapAndPath(savedGoal, true);
      }
    } catch (err) {
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
        toast.info("Opened the course link. If it does not appear in My Learning, ask your recruiter to add the catalog URL.");
      } else {
        toast.error(getApiErrorMessage(err, "Could not start this course."));
      }
    } finally {
      setStartingStep("");
    }
  }

  async function startRecommended(course) {
    const token = localStorage.getItem("access_token");
    if (!token || !course?.uid) return;
    setStartingStep(course.uid);
    try {
      const data = await startCourse(token, course.uid);
      if (data.redirect_url || course.url) {
        window.open(data.redirect_url || course.url, "_blank", "noopener,noreferrer");
      }
      toast.success("AI recommended course started — it now appears in My Learning.");
    } catch (err) {
      if (course.url) window.open(course.url, "_blank", "noopener,noreferrer");
      toast.error(getApiErrorMessage(err, "Could not start this course."));
    } finally {
      setStartingStep("");
    }
  }

  const currentRole = orgAssignment?.current_role_title || ladder?.current_title;
  const nextRole = orgAssignment?.target_role_title || ladder?.next_step?.title || savedGoal;
  const recSourceLabel =
    recs?.source === "skill_role_aligned"
      ? "Your role + skills (proficiency growth)"
      : recs?.source === "managed_learning"
        ? "Organization managed learning roadmap"
        : recs?.source === "ai_catalog"
          ? "AI + course catalog"
          : null;

  const checklistItems = (() => {
    const reqs = [...(designationReadiness?.requirements || [])];
    const alreadyListed = (uid, title) =>
      reqs.some(
        (r) =>
          (uid && r.course_uid && r.course_uid === uid) ||
          (title && r.title && r.title.toLowerCase() === String(title).toLowerCase())
      );

    for (const step of path?.path || []) {
      const uid = step.course?.uid;
      const title = step.course?.title || step.skill;
      if (!title || alreadyListed(uid, title)) continue;
      reqs.push({
        type: step.kind === "certification" ? "certification" : "course",
        title,
        course_uid: uid,
        mandatory: true,
        status: step.completed ? "completed" : "not_started",
      });
    }

    if (!reqs.some((r) => r.type === "skill")) {
      for (const s of gap?.matched_skills || []) {
        reqs.push({ type: "skill", title: s, mandatory: true, status: "acquired" });
      }
      for (const g of gap?.skill_gaps || (gap?.missing_skills || []).map((s) => ({ skill: s })) || []) {
        const title = g.skill || g;
        if (!title) continue;
        reqs.push({ type: "skill", title, mandatory: true, status: "missing" });
      }
    }
    if (!reqs.some((r) => r.type === "certification")) {
      for (const c of gap?.missing_certifications || []) {
        const title = typeof c === "string" ? c : c.title || c.name;
        if (!title) continue;
        reqs.push({ type: "certification", title, mandatory: true, status: "missing" });
      }
    }
    return reqs;
  })();

  const pathByKey = (() => {
    const map = new Map();
    for (const step of path?.path || []) {
      const uid = step.course?.uid;
      const title = (step.course?.title || "").toLowerCase();
      if (uid) map.set(uid, step);
      if (title) map.set(title, step);
    }
    return map;
  })();

  function findPathStep(req) {
    if (req.course_uid && pathByKey.has(req.course_uid)) return pathByKey.get(req.course_uid);
    const title = (req.title || "").toLowerCase();
    if (title && pathByKey.has(title)) return pathByKey.get(title);
    return null;
  }

  function requirementStatusLabel(status) {
    if (["acquired", "verified", "completed"].includes(status)) return "Done";
    if (status === "certificate_pending") return "Cert pending";
    if (status === "in_progress") return "In progress";
    if (status === "assigned") return "Assigned";
    return "Incomplete";
  }

  function requirementStatusKind(status) {
    if (["acquired", "verified", "completed"].includes(status)) return "done";
    if (["certificate_pending", "in_progress", "assigned"].includes(status)) return "pending";
    return "incomplete";
  }

  const doneStatuses = new Set(["acquired", "verified", "completed"]);
  const doneCount = checklistItems.filter((r) => doneStatuses.has(r.status)).length;
  const visibleChecklist = showRemaining
    ? checklistItems.filter((r) => !doneStatuses.has(r.status))
    : checklistItems;
  const readinessPct =
    designationReadiness?.readiness_percent ??
    gap?.readiness_percentage ??
    path?.progress_percent ??
    0;
  const checklistKeys = new Set(
    checklistItems.flatMap((i) => [i.course_uid, (i.title || "").toLowerCase()].filter(Boolean))
  );
  const extraRecs = (recs?.recommendations || []).filter(
    (c) => !checklistKeys.has(c.uid) && !checklistKeys.has((c.title || "").toLowerCase())
  );
  const nextCourse = checklistItems.find((r) => r.type === "course" && !doneStatuses.has(r.status));
  const nextCourseUid = nextCourse?.course_uid || findPathStep(nextCourse || {})?.course?.uid;

  return (
    <>
      <div className={dashStyles.section}>
        <div className={dashStyles.sectionHead}>
          <div className={dashStyles.sectionHeadLeft}>
            <span className={`${dashStyles.bar} ${dashStyles.navy}`} />
            <div>
              <div className={dashStyles.sectionTitle}>Your role path</div>
              <p className={dashStyles.sectionDesc}>
                {currentRole && nextRole && currentRole.toLowerCase() !== nextRole.toLowerCase()
                  ? `${currentRole} → ${nextRole}`
                  : currentRole
                    ? `Your role: ${currentRole}`
                    : "From your job title in Organization Setup."}
              </p>
            </div>
          </div>
        </div>
        <div className={dashStyles.sectionBody}>
          {(bootLoading || ladderLoading) && <p className={styles.inlineNote}>Loading your role ladder…</p>}
          {!ladderLoading && (!ladder?.ladder || ladder.ladder.length === 0) && (
            <div className={dashStyles.emptyState}>
              <div className={dashStyles.emptyTitle}>No career ladder for your role yet</div>
              <div className={dashStyles.emptySub}>
                {ladder?.message ||
                  "Ask your recruiter to add your job title under Organization Setup → Role ladders and Career Roadmap."}
              </div>
            </div>
          )}
          {!ladderLoading && ladder?.ladder?.length > 0 && (
            <div className={styles.ladderWrap}>
              {ladder.ladder.map((rung, idx) => (
                <div key={rung.title}>
                  {idx > 0 && <div className={styles.ladderConnector} />}
                  <div
                    className={`${styles.ladderRung} ${rung.is_current ? styles.ladderCurrent : ""}`}
                  >
                    <div className={styles.ladderRungMarker}>{idx + 1}</div>
                    <div className={styles.ladderRungBody}>
                      <div className={styles.ladderRungTitle}>
                        {rung.title}
                        {rung.is_current && <span className={`${styles.ladderRungTag} ${styles.current}`}>You are here</span>}
                        {rung.is_next_step && !rung.is_current && (
                          <span className={`${styles.ladderRungTag} ${styles.next}`}>Promotes to</span>
                        )}
                      </div>
                      {rung.description && <div className={styles.ladderRungMeta}>{rung.description}</div>}
                    </div>
                    <div className={styles.ladderRungProgress}>
                      <div className={styles.ladderRungPct}>{Math.round(rung.progress_percentage ?? 0)}%</div>
                      <div className={styles.ladderRungPctLabel}>Ready</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={dashStyles.section}>
        <div className={dashStyles.sectionHead}>
          <div className={dashStyles.sectionHeadLeft}>
            <span className={`${dashStyles.bar} ${dashStyles.green}`} />
            <div>
              <div className={dashStyles.sectionTitle}>
                {nextRole ? `Path to ${nextRole}` : "Promotion checklist"}
              </div>
              <p className={dashStyles.sectionDesc}>
                Work this list in order. Start a required course, finish it in My Learning, then submit a certificate so it counts toward promotion.
              </p>
            </div>
          </div>
          <div className={styles.checklistHeadActions}>
            <button
              type="button"
              className={styles.smallBtn}
              disabled={designationLoading || gapLoading || !savedGoal}
              onClick={() => {
                if (!savedGoal) return;
                loadDesignationReadiness(savedGoal);
                loadGapAndPath(savedGoal, true);
              }}
            >
              Refresh
            </button>
          </div>
        </div>
        <div className={dashStyles.sectionBody}>
          {(designationLoading || (gapLoading && checklistItems.length === 0)) && (
            <p className={styles.inlineNote}>Loading checklist…</p>
          )}
          {!savedGoal && !gapLoading && !bootLoading && checklistItems.length === 0 && (
            <p className={styles.inlineNote}>
              No career path assigned yet. Ask your recruiter to map your job title in Organization Setup.
            </p>
          )}
          {designationReadiness?.message && checklistItems.length === 0 && (
            <p className={styles.inlineNote}>{designationReadiness.message}</p>
          )}

          {checklistItems.length > 0 && (
            <>
              <div className={styles.readinessWrap} style={{ marginBottom: 16 }}>
                <ReadinessRing percentage={readinessPct} />
                <div className={styles.readinessSummary}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "var(--navy)", marginBottom: 4 }}>
                    {designationReadiness?.eligible ? (
                      <span style={{ color: "var(--green)" }}>Eligible</span>
                    ) : (
                      <span style={{ color: "var(--red)" }}>Not eligible yet</span>
                    )}
                  </div>
                  <div className={styles.inlineNote}>
                    {doneCount} of {checklistItems.length} requirements completed
                    {designationReadiness?.source === "career_assignment" ? " · From your org career path" : ""}
                    {nextCourse ? ` · Next: ${nextCourse.title}` : ""}
                  </div>
                </div>
              </div>
              {nextCourse && (
                <div className={styles.readyHero} style={{ marginBottom: 16 }}>
                  <div className={styles.readyCopy}>
                    <div className={styles.readyTitle}>Next up</div>
                    <p>
                      <strong>{nextCourse.title}</strong>
                      {nextCourse.status === "certificate_pending"
                        ? " — submit the certificate in My Learning so this requirement can count."
                        : nextCourse.status === "in_progress" || nextCourse.status === "assigned"
                          ? " — continue this required course, then submit a certificate in My Learning."
                          : " — start this required course. AI recommended courses below are extra practice, not required for eligibility."}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={dashStyles.btnPrimary}
                    disabled={Boolean(startingStep && nextCourseUid && startingStep === nextCourseUid && nextCourse.status !== "certificate_pending")}
                    onClick={() => {
                      if (nextCourse.status === "certificate_pending") onGo?.("my-courses");
                      else startChecklistCourse(nextCourse);
                    }}
                  >
                    {startingStep && nextCourseUid && startingStep === nextCourseUid
                      ? "Starting…"
                      : nextCourse.status === "certificate_pending"
                        ? "Open My Learning"
                        : nextCourse.status === "in_progress" || nextCourse.status === "assigned"
                          ? "Continue"
                          : "Start learning"}
                  </button>
                </div>
              )}
              <div className={styles.checklistToolbar}>
                <span className={styles.checklistHint}>
                  {showRemaining ? `${visibleChecklist.length} remaining` : `${checklistItems.length} items`}
                </span>
                {doneCount > 0 && (
                  <button type="button" className={styles.smallBtn} onClick={() => setShowRemaining((v) => !v)}>
                    {showRemaining ? "Show all" : "Show remaining"}
                  </button>
                )}
              </div>
              <div className={styles.requirementsList}>
                {visibleChecklist.map((req, idx) => {
                  const step = findPathStep(req);
                  const uid = req.course_uid || step?.course?.uid;
                  const busy = Boolean(startingStep && uid && startingStep === uid);
                  const kind = requirementStatusKind(req.status);
                  const done = doneStatuses.has(req.status);
                  const isNext = nextCourse && req.type === nextCourse.type && req.title === nextCourse.title;
                  const canStart = req.type === "course" && !done && req.status !== "certificate_pending" && Boolean(uid || step?.course?.url);
                  const continueLabel = req.status === "in_progress" || req.status === "assigned";
                  return (
                    <div
                      key={`${req.type}-${req.title}-${idx}`}
                      className={`${styles.requirementRow} ${done ? styles.requirementRowDone : ""} ${isNext ? styles.requirementRowNext : ""}`}
                    >
                      <span className={`${styles.requirementStatus} ${styles[req.status] || styles.not_started}`}>
                        {req.status === "acquired" && "✓"}
                        {req.status === "verified" && "✓"}
                        {req.status === "completed" && "✓"}
                        {req.status === "certificate_pending" && "◐"}
                        {req.status === "in_progress" && "◐"}
                        {req.status === "assigned" && "○"}
                        {req.status === "missing" && "○"}
                        {req.status === "not_started" && "○"}
                      </span>
                      <span className={styles.requirementType}>{req.type}</span>
                      <span className={styles.requirementTitle}>{req.title}</span>
                      {req.mandatory && <span className={styles.requirementMandatory}>Required</span>}
                      <span className={`${styles.requirementStatusLabel} ${
                        kind === "done"
                          ? styles.requirementStatusLabelDone
                          : kind === "pending"
                            ? styles.requirementStatusLabelPending
                            : styles.requirementStatusLabelIncomplete
                      }`}>
                        {requirementStatusLabel(req.status)}
                      </span>
                      {canStart && (
                        <button
                          type="button"
                          className={styles.smallBtnPrimary}
                          disabled={busy}
                          onClick={() => startChecklistCourse(req)}
                        >
                          {busy ? "Starting…" : continueLabel ? "Continue" : "Start learning"}
                        </button>
                      )}
                      {req.type === "skill" && !done && (
                        <button type="button" className={styles.smallBtn} onClick={() => onGo?.("skills")}>
                          Open Skill Profile
                        </button>
                      )}
                      {(req.type === "certification" || req.status === "certificate_pending") && !done && (
                        <button type="button" className={styles.smallBtn} onClick={() => onGo?.("my-courses")}>
                          {req.status === "certificate_pending" ? "Submit / view certificate" : "Upload in My Learning"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      <div className={dashStyles.section}>
        <div className={dashStyles.sectionHead}>
          <div className={dashStyles.sectionHeadLeft}>
            <span className={`${dashStyles.bar} ${dashStyles.cyan}`} />
            <div>
              <div className={dashStyles.sectionTitle}>AI recommended courses</div>
              <p className={dashStyles.sectionDesc}>
                Suggested from your role and skills to raise proficiency. These are not required for promotion.
              </p>
            </div>
          </div>
          <button type="button" className={styles.smallBtn} onClick={() => loadRecommendations(true)} disabled={recsLoading}>
            {recsLoading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div className={dashStyles.sectionBody}>
          {recSourceLabel && !recsLoading && extraRecs.length > 0 && (
            <p className={styles.inlineNote} style={{ marginBottom: 12 }}>
              Source: {recSourceLabel}
              {recs?.cached ? " · Saved for you — click Refresh to regenerate" : ""}
            </p>
          )}
          {recsLoading && <p className={styles.inlineNote}>Thinking…</p>}
          {!recsLoading && extraRecs.length === 0 && (
            <div className={dashStyles.emptyState}>
              <div className={dashStyles.emptyTitle}>No AI recommendations yet</div>
              <div className={dashStyles.emptySub}>
                Finish a few required courses or refresh after your skill profile has gaps to close.
              </div>
            </div>
          )}
          {extraRecs.length > 0 && (
          <div className={styles.aiGrid}>
            {extraRecs.slice(0, 6).map((course) => {
              const providerLabel = (
                course.provider
                || (course.source === "microsoft_learn" ? "Microsoft Learn"
                  : course.source === "coursera" ? "Coursera"
                  : course.source === "org_framework" ? "Career Roadmap"
                  : course.source === "managed_learning" ? "Managed learning"
                  : course.source)
                || "Catalog"
              );
              const levelLabel = (course.levels || []).find(Boolean) || "All levels";
              const durationLabel =
                course.duration_minutes != null && course.duration_minutes > 0
                  ? `${course.duration_minutes} min`
                  : "Self-paced";
              const typeLabel =
                course.type === "learningPath"
                  ? "Learning Path"
                  : course.type === "certification"
                    ? "Certification"
                    : "Module";
              return (
              <div key={course.uid} className={styles.aiCard}>
                <div className={styles.aiCardTop}>
                  <span className={`${styles.courseType} ${course.type === "certification" ? styles.certification : ""}`}>
                    {typeLabel}
                  </span>
                  <span className={styles.providerBadge} title="Learning provider">
                    {providerLabel}
                  </span>
                  <span className={`${styles.priorityChip} ${styles[course.priority] || styles.medium}`}>
                    {course.priority || "medium"}
                  </span>
                </div>
                <div className={`${styles.courseTitle} ${styles.aiCardTitle}`}>{course.title}</div>
                <div className={`${styles.courseMeta} ${styles.aiCardMeta}`}>
                  <span className={styles.levelBadge}>{levelLabel}</span>
                  <span className={styles.aiMetaMuted}>{durationLabel}</span>
                </div>
                <div className={styles.aiReason}>
                  <div className={styles.aiReasonLabel}>Why this course</div>
                  <div className={styles.aiReasonText}>
                    {course.reason || "Matched to your skills and role to raise proficiency."}
                  </div>
                </div>
                <div className={`${styles.courseActions} ${styles.aiCardActions}`}>
                  <button
                    type="button"
                    className={styles.smallBtnPrimary}
                    disabled={startingStep === course.uid}
                    onClick={() => startRecommended(course)}
                  >
                    {startingStep === course.uid ? "Starting…" : "Start learning"}
                  </button>
                </div>
              </div>
              );
            })}
          </div>
          )}
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
  const [form, setForm] = useState({ course_title: "", completion_date: "", learning_hours: "", source_url: "" });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ course_title: "", completion_date: "", learning_hours: "" });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const today = new Date().toISOString().split("T")[0];

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
    const link = form.source_url?.trim() || "";
    if (!form.course_title.trim() || !link) {
      toast.error("Add a course title and certificate link (required for recruiter verification).");
      return;
    }
    if (!/^https?:\/\//i.test(link)) {
      toast.error("Certificate link must start with http:// or https://");
      return;
    }
    if (!form.completion_date) {
      toast.error("Completion date is required.");
      return;
    }
    if (form.completion_date > today) {
      toast.error("Completion date cannot be in the future.");
      return;
    }
    if (!form.learning_hours && form.learning_hours !== 0) {
      toast.error("Learning hours are required.");
      return;
    }
    const token = localStorage.getItem("access_token");
    const fd = new FormData();
    if (file) fd.append("file", file);
    fd.append("course_title", form.course_title.trim());
    fd.append("source_url", link);
    fd.append("completion_date", form.completion_date);
    fd.append("learning_hours", form.learning_hours);
    setSaving(true);
    try {
      await uploadCertificate(token, fd);
      toast.success("Certificate submitted — course stays in progress until your recruiter verifies it.");
      setForm({ course_title: "", completion_date: "", learning_hours: "", source_url: "" });
      setFile(null);
      load();
      onChange?.();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not upload certificate."));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(certId) {
    if (!window.confirm("Delete this certificate? This cannot be undone.")) return;
    const token = localStorage.getItem("access_token");
    if (!token) return;
    try {
      await deleteCertificate(token, certId);
      toast.success("Certificate deleted.");
      load();
      onChange?.();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not delete certificate."));
    }
  }

  function handleEditStart(cert) {
    setEditingId(cert.id);
    setEditForm({
      course_title: cert.course_title,
      completion_date: cert.completion_date || "",
      learning_hours: cert.learning_hours || "",
    });
  }

  function handleEditCancel() {
    setEditingId(null);
    setEditForm({ course_title: "", completion_date: "", learning_hours: "" });
  }

  async function handleEditSave(certId) {
    if (!editForm.course_title.trim()) {
      toast.error("Course title is required.");
      return;
    }
    if (!editForm.completion_date) {
      toast.error("Completion date is required.");
      return;
    }
    if (editForm.completion_date > today) {
      toast.error("Completion date cannot be in the future.");
      return;
    }
    if (!editForm.learning_hours && editForm.learning_hours !== 0) {
      toast.error("Learning hours are required.");
      return;
    }
    const token = localStorage.getItem("access_token");
    if (!token) return;
    const payload = {
      course_title: editForm.course_title.trim(),
      completion_date: editForm.completion_date,
      learning_hours: parseFloat(editForm.learning_hours),
    };
    console.log("Updating certificate:", certId, payload);
    try {
      const result = await updateCertificate(token, certId, payload);
      console.log("Certificate update result:", result);
      
      // Close edit mode
      setEditingId(null);
      setEditForm({ course_title: "", completion_date: "", learning_hours: "" });
      
      // Show success toast
      toast.success("✓ Certificate updated successfully!", { 
        autoClose: 4000,
        position: "top-center"
      });
      
      // Reload the certificate list
      await load();
      
      // Notify parent component
      onChange?.();
    } catch (err) {
      console.error("Certificate update error:", err);
      toast.error(getApiErrorMessage(err, "Could not update certificate."));
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
          <div className={styles.uploadCertFormHead}>
            <strong>Upload a completion certificate</strong>
            <p>
              Certificate link is required for recruiter verification. Attach a PDF or image only if you want.
            </p>
          </div>
          <label className={styles.fieldWide}>
            Course / certification title
            <input value={form.course_title} onChange={(e) => setForm((f) => ({ ...f, course_title: e.target.value }))} required />
          </label>
          <label className={styles.fieldWide}>
            Certificate link <span className={styles.req}>*</span>
            <input
              type="url"
              placeholder="https://linkedin.com/learning/certificates/…"
              value={form.source_url || ""}
              onChange={(e) => setForm((f) => ({ ...f, source_url: e.target.value }))}
              required
            />
          </label>
          <label>
            Completion date <span className={styles.req}>*</span>
            <input type="date" value={form.completion_date} max={today} onChange={(e) => setForm((f) => ({ ...f, completion_date: e.target.value }))} required />
          </label>
          <label>
            Learning hours <span className={styles.req}>*</span>
            <input type="number" min="0" step="0.5" placeholder="e.g. 2" value={form.learning_hours} onChange={(e) => setForm((f) => ({ ...f, learning_hours: e.target.value }))} required />
          </label>
          <div className={styles.uploadCertFileField}>
            <FileUploadField
              caption="Certificate file (optional)"
              label="Upload document"
              replaceLabel="Replace document"
              accept=".pdf,.png,.jpg,.jpeg"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              selected={!!file}
            />
            {file && (
              <div className={styles.uploadCertSelectedFile}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                {file.name}
              </div>
            )}
          </div>
          <p className={styles.uploadCertHint}>
            After approval, skills and certifications from the course are added to your profile.
          </p>
          <div className={styles.uploadCertFormActions}>
            <button type="submit" className={styles.uploadCertSubmit} disabled={saving}>
              {saving ? "Submitting…" : "Send to recruiter"}
            </button>
          </div>
        </form>

        {!loading && certificates.length === 0 && (
          <div className={dashStyles.emptyState}>
            <div className={dashStyles.emptyTitle}>No certificates uploaded yet</div>
            <div className={dashStyles.emptySub}>Completed a course? Upload the certificate above.</div>
          </div>
        )}
        {certificates.map((c) => (
          <div key={c.id}>
            {editingId === c.id ? (
              <form className={styles.editCertForm} onSubmit={(e) => { e.preventDefault(); handleEditSave(c.id); }}>
                <div className={styles.editFormRow}>
                  <label>
                    Course / certification title
                    <input value={editForm.course_title} readOnly onChange={(e) => setEditForm((f) => ({ ...f, course_title: e.target.value }))} required />
                  </label>
                </div>
                <div className={styles.editFormRow}>
                  <label>
                    Completion date <span className={styles.req}>*</span>
                    <input type="date" value={editForm.completion_date} max={today} onChange={(e) => setEditForm((f) => ({ ...f, completion_date: e.target.value }))} required />
                  </label>
                  <label>
                    Learning hours <span className={styles.req}>*</span>
                    <input type="number" min="0" step="0.5" value={editForm.learning_hours} onChange={(e) => setEditForm((f) => ({ ...f, learning_hours: e.target.value }))} required />
                  </label>
                </div>
                <div className={styles.editFormActions}>
                  <button type="submit" className={dashStyles.btnPrimary}>Save changes</button>
                  <button type="button" className={styles.editCancelBtn} onClick={handleEditCancel}>Cancel</button>
                </div>
              </form>
            ) : (
              <div className={styles.certRow}>
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
                <a href={c.file_url || c.certificate_url} target="_blank" rel="noopener noreferrer" className={styles.smallBtn}>View</a>
                {c.source_url && c.source_url !== c.file_url ? (
                  <a href={c.source_url} target="_blank" rel="noopener noreferrer" className={styles.smallBtn}>Public URL</a>
                ) : null}
                {c.verification_status !== "verified" && (
                  <button type="button" className={styles.editCertBtn} onClick={() => handleEditStart(c)} title="Edit certificate">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                )}
                <button type="button" className={styles.deleteCertBtn} onClick={() => handleDelete(c.id)} title="Delete certificate">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h16zM10 11v6M14 11v6" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}


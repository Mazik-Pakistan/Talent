"use client";

import { Suspense } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import { useSearchParams } from "next/navigation";
import ProtectedRecruiterRoute from "@/components/ProtectedRecruiterRoute";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  Archive,
  ArrowRight,
  Award,
  BadgeCheck,
  BarChart3,
  Bell,
  BookOpen,
  Briefcase,
  Building2,
  Calendar,
  Check,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  CircleAlert,
  CircleCheck,
  Clock,
  Compass,
  Download,
  Eye,
  FolderTree,
  Globe,
  Library,
  ListChecks,
  Milestone,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Tag,
  Target,
  Trash2,
  Upload,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

import RecruiterShell from "@/components/recruiter/RecruiterShell";
import RecruiterLoader from "@/components/recruiter/RecruiterLoader";
import shellStyles from "@/components/recruiter/recruiter-shell.module.css";
import styles from "./learning.module.css";
import CoursesTab from "./CoursesTab";
import { useOrgFrameworkOptions } from "@/hooks/useOrgFrameworkOptions";
import { getApiErrorMessage, listEmployees, remindCourseAssignments } from "@/services/authService";
import { downloadCsv } from "@/utils/downloadCsv";
import {
  clearRecruiterContext,
  publishRecruiterContext,
} from "@/lib/ai/recruiterContext";
import { LEARNING_TAB_HELP } from "@/lib/ai/recruiterFieldHelp";
import { dispatchFrameworkInvalidated } from "@/lib/frameworkEvents";
import {
  assignCourses,
  browseCatalog,
  getCatalogFacets,
  getCatalogSources,
  getManagedFacets,
  getOrgTaxonomy,
  getLearningAnalytics,
  listAssignments,
  listPendingCertificates,
  verifyCertificate,
  listProviders,
  createProvider,
  updateProvider,
  deleteProvider,
  activateProvider,
  deactivateProvider,
  syncProviderFromApi,
} from "@/services/learningService";

const TABS = [
  { key: "catalog", label: "Course Catalog", icon: Compass },
  { key: "courses", label: "Courses", icon: BookOpen },
  { key: "providers", label: "Providers", icon: Building2 },
  { key: "assign", label: "Assign Courses", icon: UserCheck },
  { key: "assignments", label: "Track Progress", icon: ListChecks },
  { key: "certificates", label: "Verify Certificates", icon: BadgeCheck },
  { key: "analytics", label: "Learning Analytics", icon: BarChart3 },
];

const LEGACY_TAB_MAP = {
  managed: "courses",
  imports: "courses",
};

function resolveTabKey(raw) {
  if (!raw) return null;
  if (LEGACY_TAB_MAP[raw]) return LEGACY_TAB_MAP[raw];
  if (TABS.some((item) => item.key === raw)) return raw;
  return null;
}

const STATIC_CATALOG_SOURCES = [
  {
    key: "microsoft_learn",
    label: "Microsoft Courses",
    hint: "Technical learning paths, modules, and certifications from Microsoft Learn (English).",
    type: "external",
  },
  {
    key: "coursera",
    label: "Coursera Courses",
    hint: "Industry soft-skills courses from Coursera (English only) — communication, leadership, and more.",
    type: "external",
  },
];
const EXCLUDED_PROVIDER_TABS = new Set(["Microsoft Learn", "Coursera"]);
const LEARNING_PROVIDERS_UPDATED_EVENT = "learning-providers-updated";
const LEARNING_PROVIDERS_UPDATED_STORAGE_KEY = "learning-providers-updated-at";
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

function sourceLabel(source) {
  if (source.startsWith("provider:")) return source.split(":")[1];
  if (source === "coursera") return "Coursera";
  if (source === "microsoft_learn") return "Microsoft";
  return "Courses";
}

function sourceBadgeClass(source) {
  if (source.startsWith("provider:")) return styles.sourceBadgeRecruiter;
  if (source === "coursera") return styles.sourceBadgeCoursera;
  return "";
}

function courseDisplayLabel(course, fallbackSource) {
  const source = String(course?.source || fallbackSource || "");
  if (source === "managed_learning" || source.startsWith("provider:")) {
    return course?.provider || (source.startsWith("provider:") ? source.split(":")[1] : "Managed Learning");
  }
  if (source === "coursera") return "Coursera";
  if (source === "microsoft_learn") return "Microsoft";
  return sourceLabel(source);
}

function courseBadgeClass(course, fallbackSource) {
  const source = String(course?.source || fallbackSource || "");
  if (source === "managed_learning" || source.startsWith("provider:")) {
    return styles.sourceBadgeRecruiter;
  }
  return sourceBadgeClass(source);
}

function LearningPageContent() {
   const searchParams = useSearchParams();
   const tabBarRef = useRef(null);
   const [tab, setTab] = useState(() => {
      const resolved = resolveTabKey(searchParams.get("tab"));
      return resolved || "catalog";
    });
   const [pendingAssign, setPendingAssign] = useState(null);
   const [pendingImportProvider, setPendingImportProvider] = useState(null);
   const selectedCertificateId = searchParams.get("certificateId");

  useEffect(() => {
    const resolved = resolveTabKey(searchParams.get("tab"));
    if (resolved) setTab(resolved);
  }, [searchParams]);

  useEffect(() => {
    const list = tabBarRef.current;
    if (!list) return;
    const active = list.querySelector('[aria-selected="true"]');
    if (active && typeof active.scrollIntoView === "function") {
      active.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
    }
  }, [tab]);

  function handleAssignFromCatalog(course, source) {
    setPendingAssign({ course, source: course?.source || source || "microsoft_learn" });
    setTab("assign");
    toast.info(`Selected "${course.title}" — choose who should take it.`);
  }

  const clearPendingAssign = useCallback(() => {
    setPendingAssign(null);
  }, []);

  const clearPendingImportProvider = useCallback(() => {
    setPendingImportProvider(null);
  }, []);

  useEffect(() => {
    const help = LEARNING_TAB_HELP[tab] || {};
    publishRecruiterContext({
      tab,
      section: tab,
      hint: help.hint || null,
      fields: help.fields || [],
    });
    return () => clearRecruiterContext();
  }, [tab]);

  return (
    <RecruiterShell
      activeKey="learning"
      capability="learning"
      title="Learning Management"
      subtitle="Browse courses, assign learning, verify certificates, and track completion"
    >
      <div
        ref={tabBarRef}
        className={styles.tabBar}
        role="tablist"
        aria-label="Learning management sections"
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`${styles.tabBtn} ${tab === t.key ? styles.tabActive : ""}`}
              onClick={() => setTab(t.key)}
            >
              <span className={styles.tabIcon}>
                <Icon aria-hidden="true" />
              </span>
              {t.label}
            </button>
          );
        })}
      </div>

      <div hidden={tab !== "catalog"} aria-hidden={tab !== "catalog"}>
        <CatalogTab onAssignCourse={handleAssignFromCatalog} />
      </div>
      <div hidden={tab !== "courses"} aria-hidden={tab !== "courses"}>
        <CoursesTab
          initialProvider={pendingImportProvider}
          onConsumedInitial={clearPendingImportProvider}
        />
      </div>
      <div hidden={tab !== "providers"} aria-hidden={tab !== "providers"}>
        <ProvidersTab
          onImportProvider={(p) => {
            setPendingImportProvider(p);
            setTab("courses");
          }}
        />
      </div>
      <div hidden={tab !== "assign"} aria-hidden={tab !== "assign"}>
        <AssignTab
          initialCourse={pendingAssign?.course || null}
          initialSource={pendingAssign?.source || null}
          onConsumedInitial={clearPendingAssign}
        />
      </div>
      <div hidden={tab !== "assignments"} aria-hidden={tab !== "assignments"}>
        <AssignmentsTab />
      </div>
      <div hidden={tab !== "certificates"} aria-hidden={tab !== "certificates"}>
        <CertificatesTab selectedCertificateId={selectedCertificateId} />
      </div>
      <div hidden={tab !== "analytics"} aria-hidden={tab !== "analytics"}>
        <AnalyticsTab />
      </div>
    </RecruiterShell>
  );
}

export default function RecruiterLearningPage() {
  return (
    <ProtectedRecruiterRoute requiredCapability="learning">
      <Suspense fallback={<RecruiterLoader />}>
        <LearningPageContent />
      </Suspense>
    </ProtectedRecruiterRoute>
  );
}

function CatalogTab({ onAssignCourse }) {
  const [source, setSource] = useState("microsoft_learn");
  const [q, setQ] = useState("");
  const [facets, setFacets] = useState({ roles: [], levels: [], products: [], providers: [], designations: [], months: [], categories: [], competencies: [] });
  const [dynamicSources, setDynamicSources] = useState(STATIC_CATALOG_SOURCES);
  const [role, setRole] = useState("");
  const [level, setLevel] = useState("");
  const [type, setType] = useState("");
  const [provider, setProvider] = useState("");
  const [designation, setDesignation] = useState("");
  const [learningMonth, setLearningMonth] = useState("");
  const [category, setCategory] = useState("");
  const [competency, setCompetency] = useState("");
  const [archivedOnly, setArchivedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ courses: [], total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);

  const loadCatalogSources = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return Promise.resolve();
    return getCatalogSources(token)
      .then((data) => {
        const allSources = Array.isArray(data?.sources) ? data.sources : [];
        const providerSources = allSources.filter((item) => String(item?.key || "").startsWith("provider:"));
        const externalSources = allSources.filter((item) => !String(item?.key || "").startsWith("provider:"));
        const providerList = normalizeManagedProviderTabs(providerSources.map((item) => item.provider_name || item.label));
        writeManagedProviderRegistry(providerList);
        setDynamicSources(allSources.length ? [...externalSources, ...providerSources] : STATIC_CATALOG_SOURCES);
        setSource((current) => {
          const merged = allSources.length ? [...externalSources, ...providerSources] : STATIC_CATALOG_SOURCES;
          return merged.some((s) => s.key === current) ? current : (merged[0]?.key || current);
        });
      })
      .catch(() => setDynamicSources(STATIC_CATALOG_SOURCES));
  }, []);

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
    setArchivedOnly(false);
    setQ("");
    setPage(1);
    // Auto-set provider filter if switching to a provider source
    if (nextSource.startsWith("provider:")) {
      setProvider(nextSource.split(":")[1]);
    }
  }

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    const isManagedProvider = source.startsWith("provider:");
    const loader = isManagedProvider ? getManagedFacets : getCatalogFacets;
    loader(token, source)
      .then(setFacets)
      .catch(() => {});
  }, [source]);

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    const isManagedProvider = source.startsWith("provider:");
    const selectedProvider = isManagedProvider ? source.split(":")[1] : "";
    browseCatalog(token, {
      q: q || undefined,
      role: source === "microsoft_learn" ? role || undefined : undefined,
      level: source === "microsoft_learn" ? level || undefined : undefined,
      type: source === "microsoft_learn" ? type || undefined : undefined,
      provider: isManagedProvider ? (selectedProvider || provider || undefined) : undefined,
      designation: isManagedProvider ? designation || undefined : undefined,
      learning_month: isManagedProvider ? learningMonth || undefined : undefined,
      category: isManagedProvider || source === "coursera" ? category || undefined : undefined,
      competency: isManagedProvider ? competency || undefined : undefined,
      archived: isManagedProvider ? (archivedOnly ? true : undefined) : undefined,
      source,
      page,
      page_size: 12,
    })
      .then(setResult)
      .catch((err) => {
        setResult({ courses: [], total: 0, pages: 1, page: 1 });
        toast.error(getApiErrorMessage(err, "Could not load catalog."));
      })
      .finally(() => setLoading(false));
  }, [q, role, level, type, provider, designation, learningMonth, category, competency, archivedOnly, page, source]);

  useEffect(() => {
    const timer = setTimeout(load, 300);
    return () => clearTimeout(timer);
  }, [load]);

  // Keep provider tabs current when Excel imports or provider changes happen elsewhere.
  useEffect(() => {
    loadCatalogSources();
    const onProvidersChanged = () => {
      loadCatalogSources().then(() => load());
    };
    const onStorage = (event) => {
      if (event.key === LEARNING_PROVIDERS_UPDATED_STORAGE_KEY) {
        loadCatalogSources().then(() => load());
      }
    };
    window.addEventListener(LEARNING_PROVIDERS_UPDATED_EVENT, onProvidersChanged);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(LEARNING_PROVIDERS_UPDATED_EVENT, onProvidersChanged);
      window.removeEventListener("storage", onStorage);
    };
  }, [loadCatalogSources, load]);

  const activeSource = dynamicSources.find((s) => s.key === source) || dynamicSources[0];
  const isManagedProvider = source.startsWith("provider:");

  return (
    <div className={shellStyles.section}>
      <div className={shellStyles.sectionHead}>
        <div className={shellStyles.sectionHeadLeft}>
          <span className={`${shellStyles.bar} ${shellStyles.cyan}`} />
          <div>
            <div className={shellStyles.sectionTitle}>Course catalog</div>
            <p className={shellStyles.sectionDesc}>
              Browse courses from your learning providers, then assign them to employees
            </p>
          </div>
        </div>
        <span className={styles.resultPill}>
          <BookOpen aria-hidden="true" />
          {result.total} courses
        </span>
      </div>
      <div className={shellStyles.sectionBody}>
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
              <span className={styles.sourceDot} aria-hidden="true" />
              {s.label}
            </button>
          ))}
        </div>
        <p className={styles.sourceHint}>{activeSource.hint}</p>

        <div className={styles.filterBar}>
          <div className={styles.searchField}>
            <Search className={styles.searchFieldIcon} aria-hidden="true" />
            <input
              className={styles.searchFieldInput}
              aria-label="Search courses"
              placeholder={
                isManagedProvider
                  ? `Search ${provider} courses, designations, competency…`
                  : source === "coursera"
                  ? "Search soft skills, e.g. negotiation, leadership…"
                  : "Search Microsoft courses by title or skill…"
              }
              value={q}
              onChange={(e) => { setPage(1); setQ(e.target.value); }}
            />
          </div>
          {isManagedProvider && (
            <>
              <select className={styles.filterSelect} value={designation} onChange={(e) => { setPage(1); setDesignation(e.target.value); }}>
                <option value="">All designations</option>
                {(facets.designations || []).map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select className={styles.filterSelect} value={learningMonth} onChange={(e) => { setPage(1); setLearningMonth(e.target.value); }}>
                <option value="">All months</option>
                {(facets.months || []).map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select className={styles.filterSelect} value={category} onChange={(e) => { setPage(1); setCategory(e.target.value); }}>
                <option value="">All categories</option>
                {(facets.categories || []).map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select className={styles.filterSelect} value={competency} onChange={(e) => { setPage(1); setCompetency(e.target.value); }}>
                <option value="">All competencies</option>
                {(facets.competencies || []).map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <label className={styles.checkPill}>
                <input type="checkbox" checked={archivedOnly} onChange={(e) => { setPage(1); setArchivedOnly(e.target.checked); }} />
                <Archive aria-hidden="true" />
                Show archived
              </label>
            </>
          )}
          {!isManagedProvider && source === "managed_learning" && (
            <>
              <select className={styles.filterSelect} value={provider} onChange={(e) => { setPage(1); setProvider(e.target.value); }}>
                <option value="">All providers</option>
                {(facets.providers || []).map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select className={styles.filterSelect} value={designation} onChange={(e) => { setPage(1); setDesignation(e.target.value); }}>
                <option value="">All designations</option>
                {(facets.designations || []).map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select className={styles.filterSelect} value={learningMonth} onChange={(e) => { setPage(1); setLearningMonth(e.target.value); }}>
                <option value="">All months</option>
                {(facets.months || []).map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select className={styles.filterSelect} value={category} onChange={(e) => { setPage(1); setCategory(e.target.value); }}>
                <option value="">All categories</option>
                {(facets.categories || []).map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select className={styles.filterSelect} value={competency} onChange={(e) => { setPage(1); setCompetency(e.target.value); }}>
                <option value="">All competencies</option>
                {(facets.competencies || []).map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <label className={styles.checkPill}>
                <input type="checkbox" checked={archivedOnly} onChange={(e) => { setPage(1); setArchivedOnly(e.target.checked); }} />
                <Archive aria-hidden="true" />
                Show archived
              </label>
            </>
          )}
          {source === "microsoft_learn" && (
            <>
              <select className={styles.filterSelect} value={type} onChange={(e) => { setPage(1); setType(e.target.value); }}>
                <option value="">All types</option>
                <option value="learningPath">Learning paths</option>
                <option value="module">Modules</option>
                <option value="certification">Certifications</option>
              </select>
              <select className={styles.filterSelect} value={level} onChange={(e) => { setPage(1); setLevel(e.target.value); }}>
                <option value="">All levels</option>
                {(facets.levels || []).map((lv) => <option key={lv} value={lv}>{lv}</option>)}
              </select>
              <select className={styles.filterSelect} value={role} onChange={(e) => { setPage(1); setRole(e.target.value); }}>
                <option value="">All MS Learn roles</option>
                {(facets.roles || []).map((r) => <option key={r} value={r}>{r.replace(/-/g, " ")}</option>)}
              </select>
            </>
          )}
        </div>
        {(q || role || level || type || provider || designation || learningMonth || category || competency || archivedOnly) && (
          <button type="button" className={styles.clearFiltersBtn} onClick={() => {
            setQ(""); setRole(""); setLevel(""); setType("");
            setProvider(""); setDesignation(""); setLearningMonth("");
            setCategory(""); setCompetency(""); setArchivedOnly(false);
            setPage(1);
          }}>
            <X aria-hidden="true" /> Clear filters
          </button>
        )}
        {!loading && !(result.courses || []).length && (
          <div className={styles.emptyState}>
            <div className={styles.emptyStateIcon}>
              <Search aria-hidden="true" />
            </div>
            <div className={styles.emptyStateTitle}>No courses found</div>
            <p className={styles.emptyStateHint}>
              {isManagedProvider
                ? `No courses have been imported or synced for ${source.split(":")[1]} yet.`
                : "Try a different source, clear your filters, or search with different keywords."}
            </p>
          </div>
        )}
        <div className={styles.courseGrid}>
          {(result.courses || []).map((c) => {
            const courseType = (c.type || "course").toLowerCase();
            const TypeIcon = courseType.includes("path") ? Library : courseType.includes("module") ? ListChecks : courseType.includes("certif") ? Award : Globe;
            return (
            <div key={c.uid} className={styles.courseCard}>
              <div className={styles.courseCardHead}>
                <span className={`${styles.sourceBadge} ${courseBadgeClass(c, source)}`}>
                  {courseDisplayLabel(c, source)}
                </span>
              </div>
              <div className={styles.courseTitleRow}>
                <span className={styles.courseTypeIcon}><TypeIcon aria-hidden="true" /></span>
                <div className={styles.courseTitle}>{c.title}</div>
              </div>
              <div className={styles.courseMeta}>
                {isManagedProvider || source === "managed_learning" ? (
                  <>
                    <span className={styles.metaChip}>
                      <Building2 aria-hidden="true" />{c.provider || "Managed Learning"}
                    </span>
                    <span className={styles.metaChip}>
                      <Clock aria-hidden="true" />{c.duration_minutes || "—"} min
                    </span>
                  </>
                ) : (
                  <>
                    <span className={styles.metaChip}>{c.type || "course"}</span>
                    <span className={styles.metaChip}>
                      <Clock aria-hidden="true" />{c.duration_minutes || "—"} min
                    </span>
                    {(c.levels || [])[0] || c.category ? (
                      <span className={styles.metaChip}>
                        <Tag aria-hidden="true" />{(c.levels || [])[0] || c.category}
                      </span>
                    ) : null}
                  </>
                )}
              </div>
              <p className={styles.courseSummary}>
                {isManagedProvider || source === "managed_learning"
                  ? [c.designation, c.learning_month, c.category, c.competency].filter(Boolean).join(" · ") || (c.summary || "").slice(0, 140)
                  : (c.summary || "").slice(0, 140)}
              </p>
              <div className={styles.courseActions}>
                {c.url && (
                  <a href={c.url} target="_blank" rel="noopener noreferrer" className={styles.smallBtn}>
                    <Eye aria-hidden="true" /> Preview
                  </a>
                )}
                <button
                  type="button"
                  className={styles.assignCourseBtn}
                  onClick={() => onAssignCourse?.(c, source)}
                >
                  <UserCheck aria-hidden="true" /> Assign to employees
                </button>
              </div>
            </div>
            );
          })}
        </div>
        {result.pages > 1 && (
          <div className={styles.pagination}>
            <button type="button" className={styles.pageBtn} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronsLeft aria-hidden="true" /> Previous
            </button>
            <span className={styles.paginationCount}>Page {result.page} of {result.pages}</span>
            <button type="button" className={styles.pageBtn} disabled={page >= result.pages} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronsRight aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function AssignTab({ initialCourse = null, initialSource = null, onConsumedInitial }) {
  const { departments: frameworkDepartments, roleNames: frameworkDesignations } = useOrgFrameworkOptions();
  const departmentOptions = frameworkDepartments;
  const designationOptions = frameworkDesignations;
  const [dynamicSources, setDynamicSources] = useState(STATIC_CATALOG_SOURCES);
  const [source, setSource] = useState(initialSource || "microsoft_learn");
  const [q, setQ] = useState("");
  const [facets, setFacets] = useState({
    roles: [],
    levels: [],
    products: [],
    providers: [],
    designations: [],
    months: [],
    categories: [],
    competencies: [],
  });
  const [role, setRole] = useState("");
  const [level, setLevel] = useState("");
  const [type, setType] = useState("");
  const [designation, setDesignation] = useState("");
  const [learningMonth, setLearningMonth] = useState("");
  const [category, setCategory] = useState("");
  const [competency, setCompetency] = useState("");
  const [courses, setCourses] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState(initialCourse || null);
  const [employees, setEmployees] = useState([]);
  const [empQuery, setEmpQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [filterDept, setFilterDept] = useState("");
  const [filterTitle, setFilterTitle] = useState("");
  const [assignMode, setAssignMode] = useState("employees"); // employees | department | designation | skills
  const [dueDate, setDueDate] = useState("");
  const [mandatory, setMandatory] = useState(true);
  const [requiredSkills, setRequiredSkills] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [targetDesignation, setTargetDesignation] = useState("");
  const [isDesignationRequirement, setIsDesignationRequirement] = useState(false);

  const loadCatalogSources = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return Promise.resolve();
    return getCatalogSources(token)
      .then((data) => {
        const fromApi = (data?.sources || [])
          .filter((s) => s?.key && s.active !== false)
          .map((s) => ({
            key: s.key,
            label: s.label || s.key,
            hint: s.hint || `Courses from ${s.label || s.key}.`,
            type: s.type || (String(s.key).startsWith("provider:") ? "managed" : "external"),
            providerName: s.provider_name || (String(s.key).startsWith("provider:") ? s.key.split(":")[1] : ""),
          }));
        // Prefer registry order (org providers first), fall back to static MS/Coursera.
        const merged = fromApi.length
          ? fromApi
          : STATIC_CATALOG_SOURCES;
        setDynamicSources(merged);
        setSource((current) => {
          if (merged.some((s) => s.key === current)) return current;
          if (initialSource && merged.some((s) => s.key === initialSource)) return initialSource;
          return merged[0]?.key || current;
        });
      })
      .catch(() => {
        // Fall back to managed facets + static external sources (same as Course Catalog).
        return getManagedFacets(token)
          .then((data) => {
            const providerList = normalizeManagedProviderTabs(data?.providers || []);
            const providerSources = providerList.map((prov) => ({
              key: `provider:${prov}`,
              label: prov,
              hint: `Managed courses from ${prov}.`,
              type: "managed",
              providerName: prov,
            }));
            const merged = [...providerSources, ...STATIC_CATALOG_SOURCES];
            setDynamicSources(merged.length ? merged : STATIC_CATALOG_SOURCES);
          })
          .catch(() => setDynamicSources(STATIC_CATALOG_SOURCES));
      });
  }, [initialSource]);

  useEffect(() => {
    loadCatalogSources();
    const onProvidersChanged = () => loadCatalogSources();
    const onStorage = (event) => {
      if (event.key === LEARNING_PROVIDERS_UPDATED_STORAGE_KEY) loadCatalogSources();
    };
    window.addEventListener(LEARNING_PROVIDERS_UPDATED_EVENT, onProvidersChanged);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(LEARNING_PROVIDERS_UPDATED_EVENT, onProvidersChanged);
      window.removeEventListener("storage", onStorage);
    };
  }, [loadCatalogSources]);

  useEffect(() => {
    if (!initialCourse) return;
    setSelectedCourse(initialCourse);
    if (initialSource) setSource(initialSource);
    setQ("");
    setCourses([]);
    onConsumedInitial?.();
  }, [initialCourse, initialSource, onConsumedInitial]);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    const isManagedProvider = source.startsWith("provider:");
    const loader = isManagedProvider ? getManagedFacets : getCatalogFacets;
    loader(token, source)
      .then(setFacets)
      .catch(() => {});
  }, [source]);

  function switchSource(nextSource) {
    if (nextSource === source) return;
    setSource(nextSource);
    setRole("");
    setLevel("");
    setType("");
    setDesignation("");
    setLearningMonth("");
    setCategory("");
    setCompetency("");
    setQ("");
    setCourses([]);
  }

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token || selectedCourse) return;
    const isManagedProvider = source.startsWith("provider:");
    const selectedProvider = isManagedProvider ? source.split(":")[1] : "";
    const hasQuery = Boolean(q.trim());
    const hasFilters = Boolean(
      role || level || type || designation || learningMonth || category || competency
    );
    const timer = setTimeout(() => {
      if (!hasQuery && !hasFilters) {
        setCourses([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      browseCatalog(token, {
        q: q.trim() || undefined,
        source,
        role: source === "microsoft_learn" ? role || undefined : undefined,
        level: source === "microsoft_learn" ? level || undefined : undefined,
        type: source === "microsoft_learn" ? type || undefined : undefined,
        provider: isManagedProvider ? selectedProvider || undefined : undefined,
        designation: isManagedProvider ? designation || undefined : undefined,
        learning_month: isManagedProvider ? learningMonth || undefined : undefined,
        category: isManagedProvider || source === "coursera" ? category || undefined : undefined,
        competency: isManagedProvider ? competency || undefined : undefined,
        page: 1,
        page_size: 20,
      })
        .then((data) => setCourses(data.courses || []))
        .catch(() => setCourses([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [q, source, role, level, type, designation, learningMonth, category, competency, selectedCourse]);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    const timer = setTimeout(() => {
      listEmployees(token, {
        q: empQuery || undefined,
        department: filterDept || undefined,
        job_title: filterTitle || undefined,
        status: "active",
        page: 1,
        page_size: 100,
        sort: "full_name",
      })
        .then((data) => setEmployees(data.employees || []))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [empQuery, filterDept, filterTitle]);

  function toggleEmployee(id) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }

  function clearSelectedCourse() {
    setSelectedCourse(null);
    setQ("");
    setCourses([]);
    setSelectedIds([]);
  }

  async function handleAssign() {
    if (!selectedCourse) { toast.error("Select a course first (from Catalog or search below)."); return; }
    const token = localStorage.getItem("access_token");
    const payload = {
      course_uid: selectedCourse.uid,
      course_title: selectedCourse.title,
      course_url: selectedCourse.url,
      course_type: selectedCourse.type,
      duration_minutes: selectedCourse.duration_minutes,
      due_date: dueDate || undefined,
      mandatory,
      note: note || undefined,
      target_designation: isDesignationRequirement ? (targetDesignation || designationOptions[0] || "") : undefined,
      is_designation_requirement: isDesignationRequirement,
    };

    if (assignMode === "department") {
      if (!filterDept) { toast.error("Select a department to assign to."); return; }
      payload.department = filterDept;
    } else if (assignMode === "designation") {
      if (!filterTitle) { toast.error("Select a joining role / designation to assign to."); return; }
      payload.job_title = filterTitle;
    } else if (assignMode === "skills") {
      const skills = requiredSkills.split(",").map((s) => s.trim()).filter(Boolean);
      if (!skills.length) { toast.error("Enter at least one required skill."); return; }
      payload.required_skills = skills;
      if (filterDept) payload.department = filterDept;
      if (filterTitle) payload.job_title = filterTitle;
    } else {
      if (selectedIds.length === 0) { toast.error("Select at least one employee."); return; }
      payload.employee_ids = selectedIds;
    }

    setSubmitting(true);
    try {
      const result = await assignCourses(token, payload);
      const assignedCount = result.assigned?.length || 0;
      const skippedCount = result.skipped?.length || 0;
      toast.success(
        `Assigned to ${assignedCount} employee(s)${result.due_date ? ` · due ${result.due_date}` : ""}.`
      );
      dispatchFrameworkInvalidated();
      if (skippedCount) toast.warn(`${skippedCount} skipped (already assigned).`);
      if (result.errors?.length) toast.warn(`${result.errors.length} could not be assigned.`);
      setSelectedIds([]);
      setNote("");
      setDueDate("");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not assign the course."));
    } finally {
      setSubmitting(false);
    }
  }

  const courseSource = selectedCourse?.source || source;
  const audienceReady = Boolean(selectedCourse);
  const audienceComplete =
    audienceReady &&
    ((assignMode === "employees" && selectedIds.length > 0) ||
      (assignMode === "department" && Boolean(filterDept)) ||
      (assignMode === "designation" && Boolean(filterTitle)) ||
      (assignMode === "skills" &&
        requiredSkills.split(",").map((s) => s.trim()).filter(Boolean).length > 0));
  const step1Done = Boolean(selectedCourse);
  const step2Done = audienceComplete;
  const step2Active = step1Done && !step2Done;
  const step3Active = step2Done;
  const selectedCourseLabel = courseDisplayLabel(selectedCourse, courseSource);
  const selectedCourseBadgeClass = courseBadgeClass(selectedCourse, courseSource);
  const activeSource = dynamicSources.find((s) => s.key === source) || dynamicSources[0] || STATIC_CATALOG_SOURCES[0];
  const isManagedProvider = source.startsWith("provider:");
  const hasSearchOrFilters = Boolean(
    q.trim() || role || level || type || designation || learningMonth || category || competency
  );
  const assignLabel = submitting
    ? "Assigning…"
    : assignMode === "employees"
      ? `Assign to ${selectedIds.length} employee${selectedIds.length === 1 ? "" : "s"}`
      : `Assign to ${employees.length} matching employee${employees.length === 1 ? "" : "s"}`;

  return (
    <div className={shellStyles.section}>
      <div className={shellStyles.sectionHead}>
        <div className={shellStyles.sectionHeadLeft}>
          <span className={`${shellStyles.bar} ${shellStyles.cyan}`} />
          <div>
            <div className={shellStyles.sectionTitle}>Assign a course</div>
            <p className={shellStyles.sectionDesc}>
              Choose a course, pick who should take it, then set due date and send.
            </p>
          </div>
        </div>
      </div>

      <div className={shellStyles.sectionBody}>
        <div className={styles.assignSteps} aria-label="Assignment steps">
          <div className={`${styles.assignStep} ${step1Done ? styles.assignStepDone : styles.assignStepActive}`}>
            <span className={styles.assignStepNum}>{step1Done ? <Check aria-hidden="true" size={14} /> : "1"}</span>
            <span>Course</span>
          </div>
          <div className={`${styles.assignStepLine} ${step1Done ? styles.assignStepLineDone : ""}`} />
          <div
            className={`${styles.assignStep} ${
              step2Done ? styles.assignStepDone : step2Active ? styles.assignStepActive : ""
            }`}
          >
            <span className={styles.assignStepNum}>{step2Done ? <Check aria-hidden="true" size={14} /> : "2"}</span>
            <span>Audience</span>
          </div>
          <div className={`${styles.assignStepLine} ${step2Done ? styles.assignStepLineDone : ""}`} />
          <div
            className={`${styles.assignStep} ${
              step3Active ? styles.assignStepActive : ""
            }`}
          >
            <span className={styles.assignStepNum}>3</span>
            <span>Send</span>
          </div>
        </div>

        {selectedCourse ? (
          <div className={styles.assignCourseHero}>
            <div className={styles.assignCourseHeroMain}>
              <span className={`${styles.sourceBadge} ${selectedCourseBadgeClass}`}>
                {selectedCourseLabel}
              </span>
              <h3 className={styles.assignCourseHeroTitle}>{selectedCourse.title}</h3>
              <div className={styles.assignCourseHeroMeta}>
                <span className={styles.metaChip}>{selectedCourse.type || "course"}</span>
                <span className={styles.metaChip}>
                  <Clock aria-hidden="true" />{selectedCourse.duration_minutes || "—"} min
                </span>
                {(selectedCourse.levels || [])[0] || selectedCourse.category ? (
                  <span className={styles.metaChip}>
                    <Tag aria-hidden="true" />{(selectedCourse.levels || [])[0] || selectedCourse.category}
                  </span>
                ) : null}
              </div>
              {selectedCourse.summary && (
                <p className={styles.assignCourseHeroSummary}>
                  {String(selectedCourse.summary).slice(0, 180)}
                  {String(selectedCourse.summary).length > 180 ? "…" : ""}
                </p>
              )}
            </div>
            <div className={styles.assignCourseHeroActions}>
              {selectedCourse.url && (
                <a href={selectedCourse.url} target="_blank" rel="noopener noreferrer" className={styles.smallBtn}>
                  <Eye aria-hidden="true" /> Preview
                </a>
              )}
              <button type="button" className={styles.smallBtn} onClick={clearSelectedCourse}>
                <Pencil aria-hidden="true" /> Change course
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.assignPanel}>
            <div className={styles.assignPanelHead}>
              <div>
                <div className={styles.assignPanelTitle}>1 · Select a course</div>
                <p className={styles.assignPanelDesc}>
                  Pick a provider, search or filter courses, or use Course Catalog → Assign to employees.
                </p>
              </div>
            </div>
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
                  <span className={styles.sourceDot} aria-hidden="true" />
                  {s.label}
                </button>
              ))}
            </div>
            <p className={styles.sourceHint}>{activeSource?.hint}</p>
            <div className={styles.searchField}>
              <Search className={styles.searchFieldIcon} aria-hidden="true" />
              <input
                className={styles.searchFieldInput}
                aria-label="Search courses"
                placeholder={`Search ${activeSource?.label || "courses"}…`}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className={styles.filterBar} style={{ marginTop: 10 }}>
              {source === "microsoft_learn" && (
                <>
                  <select className={styles.filterSelect} value={role} onChange={(e) => setRole(e.target.value)}>
                    <option value="">All roles</option>
                    {(facets.roles || []).map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                  <select className={styles.filterSelect} value={level} onChange={(e) => setLevel(e.target.value)}>
                    <option value="">All levels</option>
                    {(facets.levels || []).map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                  <select className={styles.filterSelect} value={type} onChange={(e) => setType(e.target.value)}>
                    <option value="">All types</option>
                    <option value="learningPath">Learning path</option>
                    <option value="module">Module</option>
                    <option value="certification">Certification</option>
                  </select>
                </>
              )}
              {source === "coursera" && (
                <select className={styles.filterSelect} value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">All categories</option>
                  {(facets.categories || []).map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              )}
              {isManagedProvider && (
                <>
                  <select className={styles.filterSelect} value={designation} onChange={(e) => setDesignation(e.target.value)}>
                    <option value="">All designations</option>
                    {(facets.designations || []).map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                  <select className={styles.filterSelect} value={learningMonth} onChange={(e) => setLearningMonth(e.target.value)}>
                    <option value="">All months</option>
                    {(facets.months || []).map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                  <select className={styles.filterSelect} value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="">All categories</option>
                    {(facets.categories || []).map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                  <select className={styles.filterSelect} value={competency} onChange={(e) => setCompetency(e.target.value)}>
                    <option value="">All competencies</option>
                    {(facets.competencies || []).map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </>
              )}
            </div>
            <div className={styles.pickerList}>
              {courses.map((c) => (
                <button
                  key={c.uid}
                  type="button"
                  className={styles.pickerRow}
                  onClick={() => setSelectedCourse(c)}
                >
                  <div>
                    <div className={styles.pickerRowTitle}>{c.title}</div>
                    <div className={styles.pickerRowMeta}>
                      <span className={styles.metaChip}>{courseDisplayLabel(c, source)}</span>
                      <span className={styles.metaChip}>{c.type || "course"}</span>
                      <span className={styles.metaChip}><Clock aria-hidden="true" />{c.duration_minutes || "—"} min</span>
                      {(c.levels || [])[0] || c.category ? <span className={styles.metaChip}>{(c.levels || [])[0] || c.category}</span> : null}
                    </div>
                  </div>
                  <span className={styles.pickerSelectHint}>
                    Select <ArrowRight aria-hidden="true" />
                  </span>
                </button>
              ))}
              {searching && (
                <div className={styles.assignEmpty}>Searching…</div>
              )}
              {!searching && hasSearchOrFilters && courses.length === 0 && (
                <div className={styles.assignEmpty}>
                  No matches — try a different search or filter.
                </div>
              )}
              {!searching && !hasSearchOrFilters && (
                <div className={styles.assignEmpty}>
                  Start typing to find a course, use filters, or pick one from the Course Catalog tab.
                </div>
              )}
            </div>
          </div>
        )}

        <div className={`${styles.assignGrid} ${!audienceReady ? styles.assignGridLocked : ""}`}>
          <div className={styles.assignPanel}>
            <div className={styles.assignPanelHead}>
              <div>
                <div className={styles.assignPanelTitle}>2 · Choose audience</div>
                <p className={styles.assignPanelDesc}>Employees, department, joining role, or skills.</p>
              </div>
              {assignMode === "employees" && selectedIds.length > 0 && (
                <span className={styles.assignCountPill}>
                  <Users aria-hidden="true" />{selectedIds.length} selected
                </span>
              )}
            </div>

            {!audienceReady ? (
              <div className={styles.assignLockedNote}>Select a course first to choose who gets it.</div>
            ) : (
              <>
                <div className={styles.modeRow}>
                  {[
                    { key: "employees", label: "By employee" },
                    { key: "department", label: "By department" },
                    { key: "designation", label: "By joining role" },
                    { key: "skills", label: "By skills" },
                  ].map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      className={`${styles.modeBtn} ${assignMode === m.key ? styles.modeActive : ""}`}
                      onClick={() => setAssignMode(m.key)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                <div className={styles.filterBar}>
                  <select className={styles.filterSelect} value={filterDept} onChange={(e) => setFilterDept(e.target.value)}>
                    <option value="">All departments</option>
                    {departmentOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <select className={styles.filterSelect} value={filterTitle} onChange={(e) => setFilterTitle(e.target.value)}>
                    <option value="">All designations</option>
                    {designationOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>

                {assignMode === "employees" && (
                  <>
                    <div className={styles.searchField} style={{ marginBottom: 12 }}>
                      <Search className={styles.searchFieldIcon} aria-hidden="true" />
                      <input
                        className={styles.searchFieldInput}
                        aria-label="Filter employees by name"
                        placeholder="Filter employees by name…"
                        value={empQuery}
                        onChange={(e) => setEmpQuery(e.target.value)}
                      />
                    </div>
                    <div className={styles.employeeList}>
                      {employees.map((emp) => {
                        const checked = selectedIds.includes(emp.employee_id);
                        return (
                          <label
                            key={emp.employee_id}
                            className={`${styles.employeeCheckRow} ${checked ? styles.employeeCheckRowActive : ""}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleEmployee(emp.employee_id)}
                            />
                            <div className={styles.employeeAvatar}>
                              {(emp.full_name || "?").slice(0, 1).toUpperCase()}
                            </div>
                            <div>
                              <div className={styles.employeeName}>{emp.full_name}</div>
                                <div className={styles.employeeMeta}>{emp.job_title || "—"} · {emp.department || "—"}</div>
                            </div>
                          </label>
                        );
                      })}
                      {employees.length === 0 && (
                        <div className={styles.assignEmpty}>No employees match these filters.</div>
                      )}
                    </div>
                  </>
                )}

                {assignMode === "department" && (
                  <div className={styles.audienceSummary}>
                    <div className={styles.audienceSummaryLabel}>
                      <Building2 aria-hidden="true" /> Bulk assign by department
                    </div>
                    <p>
                      All active employees in <strong>{filterDept || "a selected department"}</strong>
                      {filterTitle ? <> with designation <strong>{filterTitle}</strong></> : null}
                      {" "}({employees.length} currently matching).
                    </p>
                  </div>
                )}
                {assignMode === "designation" && (
                  <div className={styles.audienceSummary}>
                    <div className={styles.audienceSummaryLabel}>
                      <Briefcase aria-hidden="true" /> Bulk assign by joining role
                    </div>
                    <p>
                      All active employees with designation <strong>{filterTitle || "a selected role"}</strong>
                      {filterDept ? <> in <strong>{filterDept}</strong></> : null}
                      {" "}({employees.length} currently matching).
                    </p>
                  </div>
                )}
                {assignMode === "skills" && (
                  <div className={styles.skillsBlock}>
                    <label className={styles.fieldLabel}>
                      Required skills
                      <span>Employees need at least one of these</span>
                      <input
                        value={requiredSkills}
                        onChange={(e) => setRequiredSkills(e.target.value)}
                        placeholder="e.g. Python, Azure, Communication"
                      />
                    </label>
                    <p className={styles.inlineNote}>Department and designation filters above still apply.</p>
                  </div>
                )}
              </>
            )}
          </div>

          <div className={`${styles.assignPanel} ${!audienceComplete ? styles.assignPanelMuted : ""}`}>
            <div className={styles.assignPanelHead}>
              <div>
                <div className={styles.assignPanelTitle}>3 · Details &amp; send</div>
                <p className={styles.assignPanelDesc}>Due date, note, and mandatory flag. Notes appear in the assignment email and in-app notification.</p>
              </div>
            </div>

            {!audienceReady ? (
              <div className={styles.assignLockedNote}>Select a course to finish assignment details.</div>
            ) : !audienceComplete ? (
              <div className={styles.assignLockedNote}>Choose an audience in step 2 to unlock send.</div>
            ) : (
              <>
                <div className={styles.assignDetails}>
                  <label className={styles.fieldLabel}>
                    Due date
                    <span>Auto-set if left blank</span>
                    <span className={styles.metaChip} style={{ marginBottom: 6 }}>
                      <Calendar aria-hidden="true" />
                    </span>
                    <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                  </label>
                  <label className={styles.fieldLabel}>
                    Note
                    <span>Included in email + notification</span>
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Required for onboarding" />
                  </label>
                </div>

                <label className={`${styles.mandatoryToggle} ${mandatory ? styles.mandatoryOn : ""}`}>
                  <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} />
                  <div>
                    <strong>Mandatory assignment</strong>
                    <span>Employees must complete this course</span>
                  </div>
                </label>

                <label className={`${styles.mandatoryToggle} ${isDesignationRequirement ? styles.mandatoryOn : ""}`} style={{ marginTop: 10 }}>
                  <input type="checkbox" checked={isDesignationRequirement} onChange={(e) => setIsDesignationRequirement(e.target.checked)} />
                  <div>
                    <strong>Designation requirement</strong>
                    <span>Counts toward employee&apos;s target designation readiness</span>
                  </div>
                </label>

                {isDesignationRequirement && (
                  <div style={{ marginTop: 10 }}>
                    <select
                      className={styles.filterSelect}
                      value={targetDesignation}
                      onChange={(e) => setTargetDesignation(e.target.value)}
                      style={{ width: "100%" }}
                    >
                      <option value="">Select target designation</option>
                      {designationOptions.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                )}

                <button
                  type="button"
                  className={styles.assignSubmitBtn}
                  disabled={submitting}
                  onClick={handleAssign}
                >
                  <ArrowRight aria-hidden="true" /> {assignLabel}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


function assignmentStatusLabel(status) {
  const key = String(status || "").toLowerCase();
  if (key === "completed") return "Completed";
  if (key === "in_progress") return "In progress";
  if (key === "assigned") return "Not started";
  return (status || "—").replace(/_/g, " ");
}

function buildAssignmentTree(assignments) {
  const deptMap = new Map();
  for (const a of assignments) {
    const department = (a.department || "").trim() || "Unassigned department";
    const role = (a.job_title || a.target_designation || "").trim() || "Unassigned role";
    const personKey = a.employee_id || a.employee_name || "unknown";
    if (!deptMap.has(department)) deptMap.set(department, new Map());
    const roleMap = deptMap.get(department);
    if (!roleMap.has(role)) roleMap.set(role, new Map());
    const personMap = roleMap.get(role);
    if (!personMap.has(personKey)) {
      personMap.set(personKey, {
        employee_id: a.employee_id,
        employee_name: a.employee_name || "Unknown employee",
        courses: [],
      });
    }
    personMap.get(personKey).courses.push(a);
  }

  const sortText = (a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: "base" });
  return Array.from(deptMap.entries())
    .sort(([a], [b]) => sortText(a, b))
    .map(([department, roleMap]) => ({
      department,
      assignmentCount: Array.from(roleMap.values()).reduce(
        (sum, people) => sum + Array.from(people.values()).reduce((n, p) => n + p.courses.length, 0),
        0
      ),
      personCount: Array.from(roleMap.values()).reduce((sum, people) => sum + people.size, 0),
      roles: Array.from(roleMap.entries())
        .sort(([a], [b]) => sortText(a, b))
        .map(([role, personMap]) => ({
          role,
          assignmentCount: Array.from(personMap.values()).reduce((n, p) => n + p.courses.length, 0),
          people: Array.from(personMap.values())
            .sort((a, b) => sortText(a.employee_name, b.employee_name))
            .map((person) => ({
              ...person,
              courses: [...person.courses].sort((a, b) =>
                sortText(a.course_title || "", b.course_title || "")
              ),
            })),
        })),
    }));
}

function AssignmentsTab() {
  const [assignments, setAssignments] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [mandatoryOnly, setMandatoryOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [remindingId, setRemindingId] = useState(null);
  const [collapsed, setCollapsed] = useState({});

  const departmentOptions = useMemo(() => {
    const set = new Set();
    for (const a of assignments) {
      const dept = (a.department || "").trim();
      if (dept) set.add(dept);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [assignments]);

  const providerOptions = useMemo(() => {
    const set = new Set();
    for (const a of assignments) {
      const prov = (a.provider || "").trim();
      if (prov) set.add(prov);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [assignments]);

  const filteredAssignments = useMemo(() => {
    let result = assignments;
    if (departmentFilter) {
      result = result.filter(
        (a) => (a.department || "").trim().toLowerCase() === departmentFilter.toLowerCase()
      );
    }
    if (providerFilter) {
      result = result.filter(
        (a) => (a.provider || "").trim().toLowerCase() === providerFilter.toLowerCase()
      );
    }
    return result;
  }, [assignments, departmentFilter, providerFilter]);

  const assignmentTree = useMemo(
    () => buildAssignmentTree(filteredAssignments),
    [filteredAssignments]
  );

  function toggleCollapsed(key) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function isOpen(key, defaultOpen = true) {
    return collapsed[key] === undefined ? defaultOpen : !collapsed[key];
  }

  function exportProgress() {
    const headers = [
      "Department",
      "Role",
      "Employee ID",
      "Employee Name",
      "Course Title",
      "Course Type",
      "Provider",
      "Status",
      "Progress",
      "Mandatory",
      "Due Date",
      "Assigned Date",
    ];
    const sorted = [...filteredAssignments].sort((a, b) => {
      const dept = String(a.department || "").localeCompare(String(b.department || ""), undefined, { sensitivity: "base" });
      if (dept) return dept;
      const role = String(a.job_title || "").localeCompare(String(b.job_title || ""), undefined, { sensitivity: "base" });
      if (role) return role;
      const name = String(a.employee_name || "").localeCompare(String(b.employee_name || ""), undefined, { sensitivity: "base" });
      if (name) return name;
      return String(a.course_title || "").localeCompare(String(b.course_title || ""), undefined, { sensitivity: "base" });
    });
    const rows = sorted.map((a) => {
      const status = (a.status || "").toLowerCase();
      let progress = assignmentStatusLabel(status);
      if (status === "completed") progress = "100%";
      else if (status === "in_progress") progress = "In Progress";
      else if (status === "assigned") progress = "Not Started";
      return {
        Department: a.department || "",
        Role: a.job_title || a.target_designation || "",
        "Employee ID": a.employee_id || "",
        "Employee Name": a.employee_name || "",
        "Course Title": a.course_title || "",
        "Course Type": a.course_type || "",
        Provider: a.provider || "",
        Status: assignmentStatusLabel(a.status),
        Progress: progress,
        Mandatory: a.mandatory ? "Yes" : "No",
        "Due Date": a.due_date || "",
        "Assigned Date": a.created_at || "",
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows, { header: headers, skipHeader: false });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Assigned Courses");
    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `assigned-courses-${Date.now()}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Assigned courses exported.");
  }

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    listAssignments(
      token,
      {
        status: statusFilter || undefined,
        mandatory: mandatoryOnly || undefined,
      },
      { force: true }
    )
      .then((data) => setAssignments(data.assignments || []))
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not load assignments.")))
      .finally(() => setLoading(false));
  }, [statusFilter, mandatoryOnly]);

  useEffect(() => { load(); }, [load]);

  async function handleRemind(assignment) {
    const token = localStorage.getItem("access_token");
    if (!token || !assignment?.employee_id) return;
    setRemindingId(assignment.id);
    try {
      const data = await remindCourseAssignments(
        { employee_id: assignment.employee_id, note: assignment.note || undefined },
        token
      );
      toast.success(data.message || "Course reminder sent.");
      dispatchFrameworkInvalidated();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not send course reminder."));
    } finally {
      setRemindingId(null);
    }
  }

  return (
    <div className={shellStyles.section}>
      <div className={shellStyles.sectionHead}>
        <div className={shellStyles.sectionHeadLeft}>
          <span className={`${shellStyles.bar} ${shellStyles.navy}`} />
          <div>
            <div className={shellStyles.sectionTitle}>Assigned courses</div>
            <p className={shellStyles.sectionDesc}>
              Drill down by department, role, and person — export Excel for recruiters
            </p>
          </div>
        </div>
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <button type="button" className={styles.modeBtn} onClick={exportProgress} disabled={!filteredAssignments.length}>
              <Download aria-hidden="true" /> Export Excel
            </button>
            <label className={styles.checkPill}>
              <input type="checkbox" checked={mandatoryOnly} onChange={(e) => setMandatoryOnly(e.target.checked)} />
              <Milestone aria-hidden="true" />
              Mandatory only
            </label>
            <select
              className={styles.filterSelect}
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              aria-label="Filter by department"
            >
              <option value="">All departments</option>
              {departmentOptions.map((dept) => (
                <option key={dept} value={dept}>{dept}</option>
              ))}
            </select>
            <select className={styles.filterSelect} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="assigned">Not started</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
            </select>
            <select
              className={styles.filterSelect}
              value={providerFilter}
              onChange={(e) => setProviderFilter(e.target.value)}
              aria-label="Filter by provider"
            >
              <option value="">All providers</option>
              {providerOptions.map((prov) => (
                <option key={prov} value={prov}>{prov}</option>
              ))}
            </select>
          </div>
          <div className={styles.toolbarRight}>
            <button type="button" className={styles.modeBtn} onClick={load}>
              <RefreshCw aria-hidden="true" /> Refresh
            </button>
          </div>
        </div>
      </div>
      <div className={shellStyles.sectionBody}>
        {loading && <p className={styles.inlineNote}>Loading assignments…</p>}
        {!loading && filteredAssignments.length === 0 && (
          <div className={styles.emptyState}>
            <div className={styles.emptyStateIcon}><FolderTree aria-hidden="true" /></div>
            <div className={styles.emptyStateTitle}>No assignments yet</div>
            <p className={styles.emptyStateHint}>
              Assign a course from the Assign Courses tab. Progress appears here by department → role → person.
            </p>
          </div>
        )}
        {!loading &&
          assignmentTree.map((deptNode) => {
            const deptKey = `dept:${deptNode.department}`;
            const deptOpen = isOpen(deptKey, true);
            return (
              <div key={deptNode.department} className={styles.hierarchyDept}>
                <button
                  type="button"
                  className={styles.hierarchyToggle}
                  onClick={() => toggleCollapsed(deptKey)}
                  aria-expanded={deptOpen}
                >
                  <ChevronDown
                    aria-hidden="true"
                    className={`${styles.hierarchyChevron} ${deptOpen ? "" : styles.hierarchyChevronClosed}`}
                  />
                  <Building2 aria-hidden="true" />
                  <span className={styles.hierarchyToggleLabel}>{deptNode.department}</span>
                  <span className={styles.hierarchyToggleMeta}>
                    {deptNode.personCount} person{deptNode.personCount === 1 ? "" : "s"} · {deptNode.assignmentCount} course{deptNode.assignmentCount === 1 ? "" : "s"}
                  </span>
                </button>
                {deptOpen && (
                  <div className={styles.hierarchyMonths}>
                    {deptNode.roles.map((roleNode) => {
                      const roleKey = `role:${deptNode.department}::${roleNode.role}`;
                      const roleOpen = isOpen(roleKey, true);
                      return (
                        <div key={roleKey} className={styles.hierarchyMonth}>
                          <button
                            type="button"
                            className={styles.hierarchyToggle}
                            onClick={() => toggleCollapsed(roleKey)}
                            aria-expanded={roleOpen}
                          >
                            <ChevronDown
                              aria-hidden="true"
                              className={`${styles.hierarchyChevron} ${roleOpen ? "" : styles.hierarchyChevronClosed}`}
                            />
                            <Briefcase aria-hidden="true" />
                            <span className={styles.hierarchyToggleLabel}>{roleNode.role}</span>
                            <span className={styles.hierarchyToggleMeta}>
                              {roleNode.people.length} person{roleNode.people.length === 1 ? "" : "s"} · {roleNode.assignmentCount} course{roleNode.assignmentCount === 1 ? "" : "s"}
                            </span>
                          </button>
                          {roleOpen && (
                            <div className={styles.progressPersonList}>
                              {roleNode.people.map((person) => {
                                const personKey = `person:${deptNode.department}::${roleNode.role}::${person.employee_id || person.employee_name}`;
                                const personOpen = isOpen(personKey, true);
                                const completed = person.courses.filter((c) => c.status === "completed").length;
                                return (
                                  <div key={personKey} className={styles.progressPerson}>
                                    <button
                                      type="button"
                                      className={styles.progressPersonHead}
                                      onClick={() => toggleCollapsed(personKey)}
                                      aria-expanded={personOpen}
                                    >
                                      <ChevronDown
                                        aria-hidden="true"
                                        className={`${styles.hierarchyChevron} ${personOpen ? "" : styles.hierarchyChevronClosed}`}
                                      />
                                      <Users aria-hidden="true" />
                                      <span className={styles.progressPersonName}>{person.employee_name}</span>
                                      <span className={styles.hierarchyToggleMeta}>
                                        {completed}/{person.courses.length} completed
                                      </span>
                                    </button>
                                    {personOpen && (
                                      <div className={styles.progressCourseList}>
                                        {person.courses.map((a) => (
                                          <div key={a.id} className={styles.progressCourseRow}>
                                            <div className={styles.listInfo}>
                                              <div className={styles.listTitle}>
                                                {a.course_title}
                                                {a.mandatory ? (
                                                  <span className={`${styles.statusChip} ${styles.mandatory}`}>Mandatory</span>
                                                ) : null}
                                              </div>
                                              <div className={styles.listMeta}>
                                                <span className={styles.metaChip}>
                                                  <Building2 aria-hidden="true" />{a.provider || "Unknown"}
                                                </span>
                                                {a.due_date ? (
                                                  <span className={styles.metaChip}>
                                                    <Calendar aria-hidden="true" />Due {a.due_date}
                                                  </span>
                                                ) : null}
                                                {a.course_type ? (
                                                  <span className={styles.metaChip}>{a.course_type}</span>
                                                ) : null}
                                              </div>
                                            </div>
                                            <span className={`${styles.statusChip} ${styles[a.status] || ""}`}>
                                              {assignmentStatusLabel(a.status)}
                                            </span>
                                            {a.status !== "completed" ? (
                                              <button
                                                type="button"
                                                className={styles.smallBtn}
                                                disabled={remindingId === a.id}
                                                onClick={() => handleRemind(a)}
                                              >
                                                {remindingId === a.id ? (
                                                  <><RefreshCw aria-hidden="true" className="animate-spin" /> Sending…</>
                                                ) : (
                                                  <><Bell aria-hidden="true" /> Remind</>
                                                )}
                                              </button>
                                            ) : null}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

function CertificatesTab({ selectedCertificateId = null }) {
  const [certificates, setCertificates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rejecting, setRejecting] = useState(null);
  const [rejectNote, setRejectNote] = useState("");
  const lastScrolledIdRef = useRef(null);

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    listPendingCertificates(token)
      .then((data) => setCertificates(data.certificates || []))
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not load pending certificates.")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (loading || !selectedCertificateId || lastScrolledIdRef.current === selectedCertificateId) return;
    const el = document.getElementById(`certificate-${selectedCertificateId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    lastScrolledIdRef.current = selectedCertificateId;
  }, [loading, selectedCertificateId, certificates]);

  async function handleApprove(id) {
    const token = localStorage.getItem("access_token");
    try {
      await verifyCertificate(token, id, { approve: true });
      toast.success("✓ Certificate verified — skill matrix updated via AI.", { 
        autoClose: 4000,
        position: "top-center"
      });
      setTimeout(() => load(), 500);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not verify certificate."));
    }
  }

  async function handleReject(id) {
    const token = localStorage.getItem("access_token");
    try {
      await verifyCertificate(token, id, { approve: false, note: rejectNote || undefined });
      toast.success("✓ Certificate rejected.", { 
        autoClose: 4000,
        position: "top-center"
      });
      setRejecting(null);
      setRejectNote("");
      setTimeout(() => load(), 500);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not reject certificate."));
    }
  }

  return (
    <div className={shellStyles.section}>
      <div className={shellStyles.sectionHead}>
        <div className={shellStyles.sectionHeadLeft}>
          <span className={`${shellStyles.bar} ${shellStyles.orange}`} />
          <div>
            <div className={shellStyles.sectionTitle}>Pending certificate verification</div>
            <p className={shellStyles.sectionDesc}>Approve to OCR/analyze the certificate and update the skill matrix</p>
          </div>
        </div>
      </div>
      <div className={shellStyles.sectionBody}>
        {!loading && certificates.length === 0 && (
          <div className={styles.emptyState}>
            <div className={styles.emptyStateIcon}><BadgeCheck aria-hidden="true" /></div>
            <div className={styles.emptyStateTitle}>Nothing pending review</div>
            <p className={styles.emptyStateHint}>Employee-uploaded certificates will appear here for verification.</p>
          </div>
        )}
        {certificates.map((c) => (
          <div key={c.id} id={`certificate-${c.id}`} className={styles.listRow}>
            <div className={styles.listInfo}>
              <div className={styles.listTitle}>{c.course_title}</div>
              <div className={styles.listMeta}>
                <span className={styles.metaChip}><Users aria-hidden="true" />{c.employee_name} ({c.employee_id})</span>
                {c.completion_date ? <span className={styles.metaChip}><Calendar aria-hidden="true" />Completed {c.completion_date}</span> : null}
                {c.learning_hours ? <span className={styles.metaChip}><Clock aria-hidden="true" />{c.learning_hours} hrs</span> : null}
              </div>
            </div>
            {c.file_url ? (
              <a href={c.file_url} target="_blank" rel="noopener noreferrer" className={styles.smallBtn}>
                <Eye aria-hidden="true" /> View file
              </a>
            ) : null}
            {c.source_url && c.source_url !== c.file_url ? (
              <a href={c.source_url} target="_blank" rel="noopener noreferrer" className={styles.smallBtn}>
                <Globe aria-hidden="true" /> Public URL
              </a>
            ) : null}
            {rejecting === c.id ? (
              <div className={styles.rejectRow}>
                <input className={styles.rejectInput} placeholder="Reason (optional)" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} />
                <button type="button" className={styles.rejectBtn} onClick={() => handleReject(c.id)}>
                  <Check aria-hidden="true" /> Confirm reject
                </button>
                <button type="button" className={styles.smallBtn} onClick={() => setRejecting(null)}>
                  <X aria-hidden="true" /> Cancel
                </button>
              </div>
            ) : (
              <div className={styles.rowActions} style={{ display: "flex", gap: 8 }}>
                <button type="button" className={styles.approveBtn} onClick={() => handleApprove(c.id)}>
                  <CircleCheck aria-hidden="true" /> Verify
                </button>
                <button type="button" className={styles.rejectBtn} onClick={() => setRejecting(c.id)}>
                  <CircleAlert aria-hidden="true" /> Reject
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AnalyticsTab() {
  const { departments: frameworkDepartments } = useOrgFrameworkOptions();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [department, setDepartment] = useState("");
  const departmentOptions = useMemo(() => {
    const fromFramework = frameworkDepartments || [];
    const fromData = (data?.department_comparison || []).map((d) => d.department).filter(Boolean);
    return [...new Set([...fromFramework, ...fromData])].sort((a, b) => a.localeCompare(b));
  }, [frameworkDepartments, data]);

  const load = useCallback((force = false) => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    getLearningAnalytics(token, department || undefined, { force })
      .then(setData)
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not load learning analytics.")))
      .finally(() => setLoading(false));
  }, [department]);

  useEffect(() => {
    const t = setTimeout(() => { load(false); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  function handleExport() {
    if (!data) return;
    const rows = (data.department_comparison || []).map((d) => ({
      department: d.department,
      employee_count: d.employee_count,
      assigned: d.assigned,
      completed: d.completed,
      completion_rate: d.completion_rate,
    }));
    downloadCsv(
      `learning-analytics${department ? `-${department}` : ""}.csv`,
      ["department", "employee_count", "assigned", "completed", "completion_rate"],
      rows.length
        ? rows
        : [{
            department: department || "All",
            employee_count: data.employees_in_scope,
            assigned: data.total_assignments,
            completed: data.completed_assignments,
            completion_rate: data.assignment_completion_rate,
          }]
    );
    const popularRows = (data.popular_courses || []).map((c) => ({
      title: c.title,
      activity_count: c.enrollments,
      basis: data.popular_courses_basis || "activity",
    }));
    if (popularRows.length) {
      downloadCsv(
        `learning-popular-courses${department ? `-${department}` : ""}.csv`,
        ["title", "activity_count", "basis"],
        popularRows
      );
    }
    toast.success("Analytics exported.");
  }

  if (loading) return <p className={styles.inlineNote}>Loading learning analytics…</p>;
  if (!data) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyStateIcon}><BarChart3 aria-hidden="true" /></div>
        <div className={styles.emptyStateTitle}>Analytics unavailable</div>
        <p className={styles.emptyStateHint}>Refresh to try loading learning analytics again.</p>
      </div>
    );
  }

  const stats = [
    {
      label: "Employees in scope",
      value: data.employees_in_scope ?? 0,
      hint: `${data.departments_in_scope ?? 0} department${data.departments_in_scope === 1 ? "" : "s"}`,
      color: "navy",
      icon: Users,
    },
    {
      label: "Assignment completion",
      value: `${data.assignment_completion_rate ?? data.completion_rate ?? 0}%`,
      hint: `${data.completed_assignments ?? 0}/${data.total_assignments ?? 0} completed`,
      color: "cyan",
      icon: CircleCheck,
    },
    {
      label: "Mandatory completion",
      value: `${data.mandatory_completion_rate ?? 0}%`,
      hint: `${data.mandatory_completed_assignments ?? 0}/${data.mandatory_assignments ?? 0} mandatory done`,
      color: "orange",
      icon: Target,
    },
    {
      label: "Verified cert rate",
      value: `${data.certification_rate ?? 0}%`,
      hint: `${data.verified_certificates ?? 0}/${data.total_certificates ?? 0} verified`,
      color: "green",
      icon: Award,
    },
    {
      label: "Learning hours",
      value: data.total_learning_hours ?? 0,
      hint: "Verified certificates + completed enrollments",
      color: "navy",
      icon: Clock,
    },
  ];

  const maxPopular = Math.max(1, ...(data.popular_courses || []).map((c) => c.enrollments));

  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <select className={styles.filterSelect} value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">All departments</option>
            {departmentOptions.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
        <div className={styles.toolbarRight}>
          <button type="button" className={styles.modeBtn} onClick={() => load(true)}>
            <RefreshCw aria-hidden="true" /> Refresh
          </button>
          <button type="button" className={styles.modeBtn} onClick={handleExport}>
            <Download aria-hidden="true" /> Export CSV
          </button>
        </div>
      </div>

      <p className={styles.inlineNote}>
        {data.empty_reason
          || `Showing recruiter-scoped learning activity${department ? ` for ${department}` : " across all departments"}.`}
      </p>

      <div className={styles.analyticsGrid}>
        {stats.map((s) => {
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
              {s.hint && <div className={styles.inlineNote} style={{ marginBottom: 0 }}>{s.hint}</div>}
            </div>
          );
        })}
      </div>

      <div className={shellStyles.section}>
        <div className={shellStyles.sectionHead}>
          <div className={shellStyles.sectionHeadLeft}>
            <span className={`${shellStyles.bar} ${shellStyles.cyan}`} />
            <div>
              <div className={shellStyles.sectionTitle}>Popular courses</div>
              <p className={shellStyles.sectionDesc}>
                Ranked by {data.popular_courses_basis === "assignments" ? "assignments" : "enrollments"} in this scope
              </p>
            </div>
          </div>
        </div>
        <div className={shellStyles.sectionBody}>
          {(data.popular_courses || []).length === 0 && (
            <div className={styles.emptyState}>
              <div className={styles.emptyStateIcon}><BarChart3 aria-hidden="true" /></div>
              <div className={styles.emptyStateTitle}>Not enough data yet</div>
              <p className={styles.emptyStateHint}>Enrollment stats will appear here as employees take courses.</p>
            </div>
          )}
          {(data.popular_courses || []).map((c) => (
            <div key={c.title} className={styles.barRow}>
              <div className={styles.barLabel}>{c.title}</div>
              <div className={styles.barTrack}>
                <div className={styles.barFill} style={{ width: `${(c.enrollments / maxPopular) * 100}%` }} />
              </div>
              <div className={styles.barValue}>{c.enrollments}</div>
            </div>
          ))}
        </div>
      </div>

      <div className={shellStyles.section}>
        <div className={shellStyles.sectionHead}>
          <div className={shellStyles.sectionHeadLeft}>
            <span className={`${shellStyles.bar} ${shellStyles.green}`} />
            <div>
              <div className={shellStyles.sectionTitle}>Department performance</div>
              <p className={shellStyles.sectionDesc}>Assignment completion by department</p>
            </div>
          </div>
        </div>
        <div className={shellStyles.sectionBody}>
          {(data.department_comparison || []).map((d) => (
            <div key={d.department} className={styles.listRow}>
              <div className={styles.listInfo}>
                <div className={styles.listTitle}>{d.department}</div>
                <div className={styles.listMeta}>
                  <span className={styles.metaChip}><Users aria-hidden="true" />{d.employee_count} people</span>
                  <span className={styles.metaChip}><Users aria-hidden="true" />{d.completed}/{d.assigned} completed</span>
                </div>
                <div className={styles.barTrack} style={{ marginTop: 8, maxWidth: 320 }}>
                  <div
                    className={styles.barFill}
                    style={{ width: `${d.assigned ? (d.completed / d.assigned) * 100 : 0}%` }}
                  />
                </div>
              </div>
              <span className={`${styles.statusChip} ${styles.completed}`}>{d.completion_rate}%</span>
            </div>
          ))}
          {!(data.department_comparison || []).length && (
            <div className={styles.emptyState}>
              <div className={styles.emptyStateIcon}><Building2 aria-hidden="true" /></div>
              <div className={styles.emptyStateTitle}>No department data yet</div>
              <p className={styles.emptyStateHint}>Assign courses to departments to start tracking performance.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────── //
// Providers (Phase 1 — Generic Learning Provider Framework)
// ──────────────────────────────────────────────────────────────────────────── //
function ProvidersTab({ onImportProvider }) {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [form, setForm] = useState({
    name: "",
    provider_type: "manual",
    import_method: "excel",
    description: "",
    logo_url: "",
    active: true,
    api_connector: null,
  });
  const isBuiltInSync = Boolean(form.api_connector);

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    listProviders(token, { include_inactive: true, page_size: 100 })
      .then((data) => setProviders(data.providers || []))
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not load providers.")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const onChanged = () => load();
    window.addEventListener(LEARNING_PROVIDERS_UPDATED_EVENT, onChanged);
    const onStorage = (event) => {
      if (event.key === LEARNING_PROVIDERS_UPDATED_STORAGE_KEY) load();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(LEARNING_PROVIDERS_UPDATED_EVENT, onChanged);
      window.removeEventListener("storage", onStorage);
    };
  }, [load]);

  function startCreate() {
    setEditingId(null);
    setForm({
      name: "",
      provider_type: "manual",
      import_method: "excel",
      description: "",
      logo_url: "",
      active: true,
      api_connector: null,
    });
    setShowForm(true);
  }

  function startEdit(provider) {
    const isSyncProvider = Boolean(provider.api_connector);
    setEditingId(provider.id);
    setForm({
      name: provider.name || "",
      provider_type: isSyncProvider ? "api" : "manual",
      import_method: isSyncProvider
        ? "api"
        : provider.import_method === "api"
          ? "excel"
          : provider.import_method || "excel",
      description: provider.description || "",
      logo_url: provider.logo_url || "",
      active: Boolean(provider.active),
      api_connector: provider.api_connector || null,
    });
    setShowForm(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;
    if (!form.name.trim()) { toast.error("Provider name is required."); return; }
    const payload = isBuiltInSync
      ? {
          name: form.name,
          logo_url: form.logo_url,
          description: form.description,
          active: form.active,
        }
      : {
          name: form.name,
          provider_type: "manual",
          import_method: form.import_method === "manual" ? "manual" : "excel",
          logo_url: form.logo_url,
          description: form.description,
          active: form.active,
          ...(editingId ? { clear_api_config: true } : {}),
        };
    setSaving(true);
    try {
      if (editingId) {
        await updateProvider(token, editingId, payload);
        toast.success("Provider updated.");
      } else {
        await createProvider(token, payload);
        toast.success("Provider created — it now appears in every catalog.");
      }
      setShowForm(false);
      setEditingId(null);
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not save provider."));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(provider) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setBusyId(provider.id);
    try {
      if (provider.active) {
        await deactivateProvider(token, provider.id);
        toast.success(`Provider "${provider.name}" deactivated.`);
      } else {
        await activateProvider(token, provider.id);
        toast.success(`Provider "${provider.name}" activated.`);
      }
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not update provider status."));
    } finally {
      setBusyId("");
    }
  }

  async function confirmDelete() {
    const token = localStorage.getItem("access_token");
    if (!token || !pendingDelete) return;
    setBusyId(pendingDelete.id);
    try {
      const result = await deleteProvider(token, pendingDelete.id, true);
      toast.success(
        `Provider removed${result.courses_archived ? ` — ${result.courses_archived} course(s) archived.` : "."}`
      );
      setPendingDelete(null);
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not delete provider."));
    } finally {
      setBusyId("");
    }
  }

  return (
    <>
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete provider?"
        message={
          pendingDelete
            ? `Deleting "${pendingDelete.name}" will archive all of its courses. This cannot be undone. Are you sure?`
            : ""
        }
        confirmLabel="Delete provider"
        cancelLabel="Cancel"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
      <div className={shellStyles.section}>
        <div className={shellStyles.sectionHead}>
          <div className={shellStyles.sectionHeadLeft}>
            <span className={`${shellStyles.bar} ${shellStyles.cyan}`} />
            <div>
              <div className={shellStyles.sectionTitle}>Learning providers</div>
              <p className={shellStyles.sectionDesc}>
                Add providers like Udemy or your internal academy, then import courses from Excel.
                Coursera and Microsoft Learn can Sync courses with one click.
              </p>
            </div>
          </div>
          <button type="button" className={styles.assignCourseBtn} onClick={startCreate}>
            <Plus aria-hidden="true" /> New provider
          </button>
        </div>
        <div className={shellStyles.sectionBody}>
          {showForm && (
            <form data-partner-coach className={styles.managedForm} onSubmit={handleSave}>
              <div className={styles.providerFormGrid}>
                <label className={styles.fieldLabel}>
                  Provider name
                  <input
                    data-field-key="provider_name"
                    placeholder="e.g. Udemy, DataCamp, Company Academy"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    required
                  />
                  <div className={styles.providerFormHint}>This name appears in every catalog tab, filter, and report.</div>
                </label>
                {isBuiltInSync ? (
                  <div className={`${styles.apiConnectorNotice} ${styles.wide}`} role="status">
                    Built-in provider — use <strong>Sync</strong> on the provider card to refresh courses.
                    No API setup needed.
                  </div>
                ) : (
                  <label className={styles.fieldLabel}>
                    How you add courses
                    <select
                      data-field-key="import_method"
                      value={form.import_method}
                      onChange={(e) => setForm((f) => ({
                        ...f,
                        import_method: e.target.value,
                        provider_type: "manual",
                      }))}
                    >
                      <option value="excel">Excel import</option>
                      <option value="manual">Manual entry</option>
                    </select>
                    <div className={styles.providerFormHint}>
                      Most teams upload an Excel/CSV from the provider. Use Import Courses after saving.
                    </div>
                  </label>
                )}
                <label className={styles.fieldLabel}>
                  Logo URL
                  <input
                    data-field-key="logo_url"
                    placeholder="https://…/logo.png (optional)"
                    value={form.logo_url}
                    onChange={(e) => setForm((f) => ({ ...f, logo_url: e.target.value }))}
                  />
                </label>
                <label className={`${styles.fieldLabel} ${styles.wide}`}>
                  Description
                  <input
                    data-field-key="description"
                    placeholder="What does this provider offer?"
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  />
                </label>
                <label className={styles.providerToggle}>
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                  />
                  Active (visible in catalogs)
                </label>
              </div>
              <div className={styles.formActions}>
                <button type="submit" className={styles.assignCourseBtn} disabled={saving}>
                  <Check aria-hidden="true" /> {saving ? "Saving…" : editingId ? "Save changes" : "Create provider"}
                </button>
                <button type="button" className={styles.smallBtn} onClick={() => { setShowForm(false); setEditingId(null); }}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          {!loading && providers.length === 0 && (
            <div className={styles.emptyProviders}>
              <div className={styles.emptyStateIcon}><Building2 aria-hidden="true" /></div>
              <div className={styles.emptyStateTitle}>No learning providers yet</div>
              <p className={styles.emptyStateHint}>
                Create your first provider to start building the course catalog. Existing providers are added automatically.
              </p>
              <button type="button" className={styles.assignCourseBtn} onClick={startCreate}>
                <Plus aria-hidden="true" /> Create a provider
              </button>
            </div>
          )}

          {!loading && providers.length > 0 && (
            <div className={styles.providerGrid}>
              {providers.map((p) => (
                <div key={p.id} className={styles.providerCard}>
                  <div className={styles.providerCardHead}>
                    <div className={styles.providerIdentity}>
                      <div className={styles.providerLogo}>
                        {p.logo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.logo_url} alt={`${p.name} logo`} />
                        ) : (
                          <Building2 aria-hidden="true" />
                        )}
                      </div>
                      <div>
                        <div className={styles.providerName}>{p.name}</div>
                        <div className={styles.providerSlug}>{p.slug}</div>
                      </div>
                    </div>
                  </div>
                  {p.description && <p className={styles.providerDesc}>{p.description}</p>}
                  <div className={styles.providerChips}>
                    <span className={`${styles.providerChip} ${p.api_connector ? styles.providerChipGreen : styles.providerChipGrey}`}>
                      {p.api_connector ? "Built-in sync" : "Manual"}
                    </span>
                    <span className={styles.providerChip}>
                      {p.api_connector
                        ? "One-click sync"
                        : p.import_method === "excel"
                          ? "Excel import"
                          : "Manual entry"}
                    </span>
                    <span className={`${styles.providerChip} ${p.active ? styles.providerChipGreen : styles.providerChipRed}`}>
                      {p.active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <div className={styles.providerCardFooter}>
                    <span className={styles.providerCourseCount}>
                      {p.course_count} <span>courses</span>
                    </span>
                    <div className={styles.providerActions}>
                      <button type="button" className={styles.providerActionBtn} disabled={busyId === p.id} onClick={() => onImportProvider?.(p)}>
                        <Upload aria-hidden="true" /> Add courses
                      </button>
                      {p.api_connector && (
                        <button
                          type="button"
                          className={styles.providerActionBtn}
                          disabled={busyId === p.id}
                          onClick={async () => {
                            const token = localStorage.getItem("access_token");
                            if (!token) {
                              toast.error("Please sign in again to sync.");
                              return;
                            }
                            setBusyId(p.id);
                            toast.info("Syncing courses… this may take a minute for large catalogs.", { autoClose: 8000 });
                            try {
                              const res = await syncProviderFromApi(token, p.id);
                              toast.success(res.message || "API sync completed.");
                              load();
                            } catch (err) {
                              toast.error(getApiErrorMessage(err, "API sync failed."));
                            } finally {
                              setBusyId("");
                            }
                          }}
                        >
                          <RefreshCw aria-hidden="true" /> {busyId === p.id ? "Syncing…" : "Sync"}
                        </button>
                      )}
                      <button type="button" className={styles.providerActionBtn} disabled={busyId === p.id} onClick={() => startEdit(p)}>
                        <Pencil aria-hidden="true" /> Edit
                      </button>
                      <button
                        type="button"
                        className={styles.providerActionBtn}
                        disabled={busyId === p.id}
                        onClick={() => handleToggleActive(p)}
                      >
                        {p.active ? <CircleAlert aria-hidden="true" /> : <CircleCheck aria-hidden="true" />}
                        {p.active ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        type="button"
                        className={`${styles.providerActionBtn} ${styles.providerActionDanger}`}
                        disabled={busyId === p.id}
                        onClick={() => setPendingDelete(p)}
                      >
                        <Trash2 aria-hidden="true" /> Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

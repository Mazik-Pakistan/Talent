"use client";

import { Suspense } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import { useSearchParams } from "next/navigation";
import ProtectedRecruiterRoute from "@/components/ProtectedRecruiterRoute";
import ConfirmDialog from "@/components/ConfirmDialog";
import FileUploadField from "@/components/FileUploadField";
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

export const dynamic = "force-dynamic";

import RecruiterShell from "@/components/recruiter/RecruiterShell";
import RecruiterLoader from "@/components/recruiter/RecruiterLoader";
import shellStyles from "@/components/recruiter/recruiter-shell.module.css";
import styles from "./learning.module.css";
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
  archiveManagedCourse,
  commitManagedImport,
  createManagedCourse,
  browseCatalog,
  createKbCertification,
  createKbRole,
  deleteKbCertification,
  deleteKbRole,
  deleteManagedCourse,
  getCatalogFacets,
  getCatalogSources,
  getManagedFacets,
  getOrgTaxonomy,
  getLearningAnalytics,
  listManagedCourses,
  listAssignments,
  listKbCertifications,
  listKbRoles,
  listPendingCertificates,
  bulkManagedCourseAction,
  previewManagedImport,
  restoreManagedCourse,
  verifyCertificate,
  updateManagedCourse,
  listProviders,
  createProvider,
  updateProvider,
  deleteProvider,
  activateProvider,
  deactivateProvider,
  previewImport,
  commitImport,
  listImportHistory,
  getImportHistory,
  downloadImportReport,
  rollbackImport,
  syncProviderFromApi,
} from "@/services/learningService";

const TABS = [
  { key: "catalog", label: "Course Catalog", icon: Compass },
  { key: "managed", label: "Managed Learning", icon: BookOpen },
  { key: "providers", label: "Providers", icon: Building2 },
  { key: "imports", label: "Import Courses", icon: Upload },
  { key: "knowledge", label: "Knowledge Base", icon: Library },
  { key: "assign", label: "Assign Courses", icon: UserCheck },
  { key: "assignments", label: "Track Progress", icon: ListChecks },
  { key: "certificates", label: "Verify Certificates", icon: BadgeCheck },
  { key: "analytics", label: "Learning Analytics", icon: BarChart3 },
];

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
      const t = searchParams.get("tab");
      if (TABS.some((item) => item.key === t)) return t;
      return "catalog";
    });
   const [pendingAssign, setPendingAssign] = useState(null);
   const [pendingImportProvider, setPendingImportProvider] = useState(null);
   const selectedCertificateId = searchParams.get("certificateId");

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t && TABS.some((item) => item.key === t)) {
      setTab(t);
    }
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

       {tab === "catalog" && <CatalogTab onAssignCourse={handleAssignFromCatalog} />}
       {tab === "managed" && <ManagedLearningTab />}
       {tab === "providers" && <ProvidersTab onImportProvider={(p) => { setPendingImportProvider(p); setTab("imports"); }} />}
       {tab === "imports" && <ImportsTab initialProvider={pendingImportProvider} onConsumedInitial={clearPendingImportProvider} />}
       {tab === "knowledge" && <KnowledgeBaseTab />}
       {tab === "assign" && (
         <AssignTab
           initialCourse={pendingAssign?.course || null}
           initialSource={pendingAssign?.source || null}
           onConsumedInitial={clearPendingAssign}
         />
       )}
       {tab === "assignments" && <AssignmentsTab />}
       {tab === "certificates" && <CertificatesTab selectedCertificateId={selectedCertificateId} />}
       {tab === "analytics" && <AnalyticsTab />}
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
  const [providers, setProviders] = useState([]);
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
  const initializedProvidersRef = useRef(false);

  const loadManagedProviders = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return Promise.resolve();
    return getManagedFacets(token)
      .then((data) => {
        // Source of truth is the server only — do NOT merge from localStorage
        // (stale localStorage entries like "test" or "dfsd" would reappear otherwise).
        const providerList = normalizeManagedProviderTabs(data?.providers || []);
        // Overwrite localStorage with the clean server list.
        writeManagedProviderRegistry(providerList);
        setProviders(providerList);
        // Build dynamic sources with provider tabs first, then external sources
        const providerSources = providerList.map((prov) => ({
          key: `provider:${prov}`,
          label: prov,
          hint: `Managed roadmap courses from ${prov}.`,
          type: "managed",
          providerName: prov,
        }));
        setDynamicSources([...providerSources, ...STATIC_CATALOG_SOURCES]);
        setSource((current) => {
          if (current.startsWith("provider:")) {
            const currentProvider = current.split(":")[1];
            if (providerList.length && !providerList.includes(currentProvider)) {
              return `provider:${providerList[0]}`;
            }
            return current;
          }
          if (!initializedProvidersRef.current && providerList.length) {
            return `provider:${providerList[0]}`;
          }
          const merged = [...providerSources, ...STATIC_CATALOG_SOURCES];
          if (!merged.some((s) => s.key === current)) {
            return merged[0]?.key || current;
          }
          return current;
        });
        initializedProvidersRef.current = true;
      })
      .catch(() => setDynamicSources(STATIC_CATALOG_SOURCES));
  }, []);

  // Keep provider tabs current when Excel imports or provider changes happen elsewhere.
  useEffect(() => {
    loadManagedProviders();
    const onProvidersChanged = () => {
      loadManagedProviders().then(() => load());
    };
    const onStorage = (event) => {
      if (event.key === LEARNING_PROVIDERS_UPDATED_STORAGE_KEY) {
        loadManagedProviders().then(() => load());
      }
    };
    window.addEventListener(LEARNING_PROVIDERS_UPDATED_EVENT, onProvidersChanged);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(LEARNING_PROVIDERS_UPDATED_EVENT, onProvidersChanged);
      window.removeEventListener("storage", onStorage);
    };
  }, [loadManagedProviders]);

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
    loader(token, isManagedProvider ? "managed_learning" : source)
      .then(setFacets)
      .catch(() => {});
  }, [source]);

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
      category: actualSource === "managed_learning" || actualSource === "coursera" ? category || undefined : undefined,
      competency: actualSource === "managed_learning" ? competency || undefined : undefined,
      archived: isManagedProvider ? (archivedOnly ? true : undefined) : undefined,
      source: actualSource,
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
          {source === "managed_learning" && (
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
              Try a different source, clear your filters, or search with different keywords.
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
                {source === "managed_learning" ? (
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
                {source === "managed_learning"
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

function KnowledgeBaseTab() {
  const [roles, setRoles] = useState([]);
  const [certs, setCerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [roleForm, setRoleForm] = useState({ title: "", description: "", required_skills: "", required_certifications: "" });
  const [certForm, setCertForm] = useState({
    title: "",
    provider: "",
    official_url: "",
    description: "",
    skills_covered: "",
    estimated_hours: "",
    difficulty: "Intermediate",
    priority: "medium",
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    Promise.all([listKbRoles(token), listKbCertifications(token)])
      .then(([roleData, certData]) => {
        setRoles(roleData.roles || []);
        setCerts(certData.certifications || []);
      })
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not load knowledge base.")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreateRole(e) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    setSaving(true);
    try {
      await createKbRole(token, {
        title: roleForm.title.trim(),
        description: roleForm.description.trim(),
        required_skills: roleForm.required_skills.split(",").map((s) => s.trim()).filter(Boolean),
        required_certifications: roleForm.required_certifications.split(",").map((s) => s.trim()).filter(Boolean),
      });
      setRoleForm({ title: "", description: "", required_skills: "", required_certifications: "" });
      toast.success("Role added to knowledge base.");
      dispatchFrameworkInvalidated();
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not create role."));
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateCert(e) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    setSaving(true);
    try {
      await createKbCertification(token, {
        title: certForm.title.trim(),
        provider: certForm.provider.trim(),
        official_url: certForm.official_url.trim(),
        description: certForm.description.trim(),
        skills_covered: certForm.skills_covered.split(",").map((s) => s.trim()).filter(Boolean),
        estimated_hours: certForm.estimated_hours ? Number(certForm.estimated_hours) : null,
        difficulty: certForm.difficulty,
        priority: certForm.priority,
      });
      setCertForm({
        title: "",
        provider: "",
        official_url: "",
        description: "",
        skills_covered: "",
        estimated_hours: "",
        difficulty: "Intermediate",
        priority: "medium",
      });
      toast.success("Certification added — it will appear in the course catalog.");
      dispatchFrameworkInvalidated();
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not create certification."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className={shellStyles.section}>
        <div className={shellStyles.sectionHead}>
          <div className={shellStyles.sectionHeadLeft}>
            <span className={`${shellStyles.bar} ${shellStyles.navy}`} />
            <div>
              <div className={shellStyles.sectionTitle}>Organization roles</div>
              <p className={shellStyles.sectionDesc}>Required skills &amp; certifications drive employee career matching</p>
            </div>
          </div>
        </div>
        <div className={shellStyles.sectionBody}>
          <form data-partner-coach className={styles.kbForm} onSubmit={handleCreateRole}>
            <label className={styles.fieldLabel}>
              Role title
              <input placeholder="e.g. Architect" value={roleForm.title} onChange={(e) => setRoleForm((f) => ({ ...f, title: e.target.value }))} required />
            </label>
            <label className={styles.fieldLabel}>
              Required skills
              <input placeholder="Comma-separated, e.g. Python, Azure" value={roleForm.required_skills} onChange={(e) => setRoleForm((f) => ({ ...f, required_skills: e.target.value }))} />
            </label>
            <label className={styles.fieldLabel}>
              Required certifications
              <input placeholder="Comma-separated, e.g. AZ-305" value={roleForm.required_certifications} onChange={(e) => setRoleForm((f) => ({ ...f, required_certifications: e.target.value }))} />
            </label>
            <label className={styles.fieldLabel}>
              Description
              <input placeholder="What does this role require?" value={roleForm.description} onChange={(e) => setRoleForm((f) => ({ ...f, description: e.target.value }))} />
            </label>
            <div className={styles.formActions}>
              <button type="submit" className={styles.assignCourseBtn} disabled={saving}>
                <Plus aria-hidden="true" /> {saving ? "Adding…" : "Add role"}
              </button>
            </div>
          </form>
          {!loading && roles.length === 0 && (
            <div className={styles.emptyState}>
              <div className={styles.emptyStateIcon}><Library aria-hidden="true" /></div>
              <div className={styles.emptyStateTitle}>No roles defined yet</div>
              <p className={styles.emptyStateHint}>Add your first organization role to power employee career matching.</p>
            </div>
          )}
          <div className={styles.courseGrid}>
            {roles.map((r) => (
              <div key={r.id} className={styles.courseCard}>
                <div className={styles.courseCardHead}>
                  <span className={`${styles.sourceBadge} ${styles.sourceBadgeRecruiter}`}>Role</span>
                </div>
                <div className={styles.courseTitle}>{r.title}</div>
                <div className={styles.courseMeta}>
                  <span className={styles.metaChip}><Milestone aria-hidden="true" />{(r.required_skills || []).length} skills</span>
                  <span className={styles.metaChip}><BadgeCheck aria-hidden="true" />{(r.required_certifications || []).length} certs</span>
                </div>
                <p className={styles.courseSummary}>{(r.description || "").slice(0, 160)}</p>
                <div className={styles.courseActions}>
                  <button
                    type="button"
                    className={styles.smallBtn}
                    onClick={async () => {
                      const token = localStorage.getItem("access_token");
                      try {
                        await deleteKbRole(token, r.id);
                        toast.success("Role removed.");
                        dispatchFrameworkInvalidated();
                        load();
                      } catch (err) {
                        toast.error(getApiErrorMessage(err, "Could not delete role."));
                      }
                    }}
                  >
                    <Trash2 aria-hidden="true" /> Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={shellStyles.section}>
        <div className={shellStyles.sectionHead}>
          <div className={shellStyles.sectionHeadLeft}>
            <span className={`${shellStyles.bar} ${shellStyles.green}`} />
            <div>
              <div className={shellStyles.sectionTitle}>Certifications &amp; courses</div>
              <p className={shellStyles.sectionDesc}>Shown in the employee catalog as a managed-learning course</p>
            </div>
          </div>
        </div>
        <div className={shellStyles.sectionBody}>
          <form data-partner-coach className={styles.kbForm} onSubmit={handleCreateCert}>
            <label className={styles.fieldLabel}>
              Title
              <input placeholder="e.g. AZ-305" value={certForm.title} onChange={(e) => setCertForm((f) => ({ ...f, title: e.target.value }))} required />
            </label>
            <label className={styles.fieldLabel}>
              Provider
              <input placeholder="e.g. Microsoft" value={certForm.provider} onChange={(e) => setCertForm((f) => ({ ...f, provider: e.target.value }))} />
            </label>
            <label className={styles.fieldLabel}>
              Official URL
              <input placeholder="https://learn.microsoft.com/…" value={certForm.official_url} onChange={(e) => setCertForm((f) => ({ ...f, official_url: e.target.value }))} />
            </label>
            <label className={styles.fieldLabel}>
              Skills covered
              <input placeholder="Comma-separated, e.g. Kubernetes, Networking" value={certForm.skills_covered} onChange={(e) => setCertForm((f) => ({ ...f, skills_covered: e.target.value }))} />
            </label>
            <label className={styles.fieldLabel}>
              Estimated hours
              <input type="number" min="0" placeholder="e.g. 12" value={certForm.estimated_hours} onChange={(e) => setCertForm((f) => ({ ...f, estimated_hours: e.target.value }))} />
            </label>
            <div className={styles.splitRow}>
              <label className={styles.fieldLabel}>
                Difficulty
                <select value={certForm.difficulty} onChange={(e) => setCertForm((f) => ({ ...f, difficulty: e.target.value }))}>
                  {["Beginner", "Intermediate", "Advanced", "Expert"].map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <label className={styles.fieldLabel}>
                Priority
                <select value={certForm.priority} onChange={(e) => setCertForm((f) => ({ ...f, priority: e.target.value }))}>
                  {["critical", "immediate", "medium", "low"].map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
            </div>
            <label className={`${styles.fieldLabel} ${styles.wide}`}>
              Description
              <input placeholder="What does this certification cover?" value={certForm.description} onChange={(e) => setCertForm((f) => ({ ...f, description: e.target.value }))} />
            </label>
            <div className={styles.formActions}>
              <button type="submit" className={styles.assignCourseBtn} disabled={saving}>
                <Plus aria-hidden="true" /> {saving ? "Adding…" : "Add certification"}
              </button>
            </div>
          </form>
          {!loading && certs.length === 0 && (
            <div className={styles.emptyState}>
              <div className={styles.emptyStateIcon}><BadgeCheck aria-hidden="true" /></div>
              <div className={styles.emptyStateTitle}>No certifications yet</div>
              <p className={styles.emptyStateHint}>Add certifications above and they will appear in the employee course catalog.</p>
            </div>
          )}
          <div className={styles.courseGrid}>
            {certs.map((c) => (
              <div key={c.id} className={styles.courseCard}>
                <div className={styles.courseCardHead}>
                  <span className={`${styles.sourceBadge} ${styles.sourceBadgeCoursera}`}>Certification</span>
                </div>
                <div className={styles.courseTitle}>{c.title}</div>
                <div className={styles.courseMeta}>
                  {c.provider ? <span className={styles.metaChip}><Building2 aria-hidden="true" />{c.provider}</span> : null}
                  <span className={styles.metaChip}>{c.difficulty}</span>
                  {c.estimated_hours ? <span className={styles.metaChip}><Clock aria-hidden="true" />{c.estimated_hours}h</span> : null}
                  <span className={styles.metaChip}>{c.priority}</span>
                </div>
                <p className={styles.courseSummary}>{(c.description || "").slice(0, 140)}</p>
                <div className={styles.courseActions}>
                  {c.official_url && (
                    <a href={c.official_url} target="_blank" rel="noopener noreferrer" className={styles.smallBtn}>
                      <Globe aria-hidden="true" /> Official link
                    </a>
                  )}
                  <button
                    type="button"
                    className={styles.smallBtn}
                    onClick={async () => {
                      const token = localStorage.getItem("access_token");
                      try {
                        await deleteKbCertification(token, c.id);
                        toast.success("Certification removed.");
                        dispatchFrameworkInvalidated();
                        load();
                      } catch (err) {
                        toast.error(getApiErrorMessage(err, "Could not delete certification."));
                      }
                    }}
                  >
                    <Trash2 aria-hidden="true" /> Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function AssignTab({ initialCourse = null, initialSource = null, onConsumedInitial }) {
  const { departments: frameworkDepartments, roleNames: frameworkDesignations } = useOrgFrameworkOptions();
  const departmentOptions = frameworkDepartments;
  const designationOptions = frameworkDesignations;
  const [source, setSource] = useState(initialSource || "microsoft_learn");
  const [q, setQ] = useState("");
  const [courses, setCourses] = useState([]);
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
    const actualSource = isManagedProvider ? "managed_learning" : source;
    const selectedProvider = isManagedProvider ? source.split(":")[1] : "";
    const timer = setTimeout(() => {
      if (!q.trim()) { setCourses([]); return; }
      browseCatalog(token, {
        q,
        source: actualSource,
        provider: actualSource === "managed_learning" ? selectedProvider || undefined : undefined,
        provider: actualSource === "managed_learning" ? (selectedProvider || undefined) : undefined,
        page_size: 10,
      }).then((data) => setCourses(data.courses || [])).catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [q, source]);

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
        page_size: 40,
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
  const selectedCourseLabel = courseDisplayLabel(selectedCourse, courseSource);
  const selectedCourseBadgeClass = courseBadgeClass(selectedCourse, courseSource);
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
        <div className={styles.assignSteps}>
          <div className={`${styles.assignStep} ${selectedCourse ? styles.assignStepDone : styles.assignStepActive}`}>
            <span className={styles.assignStepNum}>{selectedCourse ? <Check aria-hidden="true" size={14} /> : "1"}</span>
            <span>Course</span>
          </div>
          <div className={styles.assignStepLine} />
          <div className={`${styles.assignStep} ${selectedCourse ? styles.assignStepActive : ""}`}>
            <span className={styles.assignStepNum}>2</span>
            <span>Audience</span>
          </div>
          <div className={styles.assignStepLine} />
          <div className={`${styles.assignStep} ${selectedCourse ? styles.assignStepActive : ""}`}>
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
                  Search below, or use Course Catalog â†’ Assign to employees.
                </p>
              </div>
            </div>
            <div className={styles.sourceToggle} role="tablist" aria-label="Course source">
              {STATIC_CATALOG_SOURCES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  aria-selected={source === s.key}
                  className={`${styles.sourceBtn} ${source === s.key ? styles.sourceBtnActive : ""}`}
                  onClick={() => { setSource(s.key); setQ(""); setCourses([]); }}
                >
                  <span className={styles.sourceDot} aria-hidden="true" />
                  {s.label}
                </button>
              ))}
            </div>
            <p className={styles.sourceHint}>
              {(STATIC_CATALOG_SOURCES.find((s) => s.key === source) || STATIC_CATALOG_SOURCES[0]).hint}
            </p>
            <div className={styles.searchField}>
              <Search className={styles.searchFieldIcon} aria-hidden="true" />
              <input
                className={styles.searchFieldInput}
                aria-label="Search courses"
                placeholder={
                  source === "coursera"
                    ? "Search soft skills, e.g. negotiation, leadership…"
                    : source === "managed_learning"
                      ? "Search roadmap courses…"
                      : "Search Microsoft courses…"
                }
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
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
                      <span className={styles.metaChip}>{c.type}</span>
                      <span className={styles.metaChip}><Clock aria-hidden="true" />{c.duration_minutes || "—"} min</span>
                      {(c.levels || [])[0] || c.category ? <span className={styles.metaChip}>{(c.levels || [])[0] || c.category}</span> : null}
                    </div>
                  </div>
                  <span className={styles.pickerSelectHint}>
                    Select <ArrowRight aria-hidden="true" />
                  </span>
                </button>
              ))}
              {q.trim() && courses.length === 0 && (
                <div className={styles.assignEmpty}>
                  No matches — try a different search term.
                </div>
              )}
              {!q.trim() && (
                <div className={styles.assignEmpty}>
                  Start typing to find a course, or pick one from the Course Catalog tab.
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

          <div className={styles.assignPanel}>
            <div className={styles.assignPanelHead}>
              <div>
                <div className={styles.assignPanelTitle}>3 · Details &amp; send</div>
                <p className={styles.assignPanelDesc}>Due date, note, and mandatory flag. Notes appear in the assignment email and in-app notification.</p>
              </div>
            </div>

            {!audienceReady ? (
              <div className={styles.assignLockedNote}>Select a course to finish assignment details.</div>
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

function AssignmentsTab() {
  const [assignments, setAssignments] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [mandatoryOnly, setMandatoryOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [remindingId, setRemindingId] = useState(null);

  const load = useCallback((force = false) => {
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

  useEffect(() => { load(false); }, [load]);

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
              Track completion — reminders go by email and notification
            </p>
          </div>
        </div>
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <label className={styles.checkPill}>
              <input type="checkbox" checked={mandatoryOnly} onChange={(e) => setMandatoryOnly(e.target.checked)} />
              <Milestone aria-hidden="true" />
              Mandatory only
            </label>
            <select className={styles.filterSelect} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="assigned">Assigned</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          <div className={styles.toolbarRight}>
            <button type="button" className={styles.modeBtn} onClick={() => load(true)}>
              <RefreshCw aria-hidden="true" /> Refresh
            </button>
          </div>
        </div>
      </div>
      <div className={shellStyles.sectionBody}>
        {!loading && assignments.length === 0 && (
          <div className={styles.emptyState}>
            <div className={styles.emptyStateIcon}><ListChecks aria-hidden="true" /></div>
            <div className={styles.emptyStateTitle}>No assignments yet</div>
            <p className={styles.emptyStateHint}>Assign a course from the Assign Courses tab to start tracking completion.</p>
          </div>
        )}
        {assignments.map((a) => (
          <div key={a.id} className={styles.listRow}>
            <div className={styles.listInfo}>
              <div className={styles.listTitle}>
                {a.course_title}
                {a.mandatory ? <span className={`${styles.statusChip} ${styles.mandatory}`}>Mandatory</span> : null}
              </div>
              <div className={styles.listMeta}>
                <span className={styles.metaChip}><Users aria-hidden="true" />{a.employee_name}</span>
                <span className={styles.metaChip}>{a.job_title || "—"}</span>
                <span className={styles.metaChip}><Building2 aria-hidden="true" />{a.department || "—"}</span>
                {a.due_date ? <span className={styles.metaChip}><Calendar aria-hidden="true" />Due {a.due_date}</span> : null}
              </div>
            </div>
            <span className={`${styles.statusChip} ${styles[a.status] || ""}`}>{a.status.replace("_", " ")}</span>
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
            <a href={c.file_url || c.certificate_url} target="_blank" rel="noopener noreferrer" className={styles.smallBtn}>
              <Eye aria-hidden="true" /> View file
            </a>
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
  const departmentOptions = frameworkDepartments;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [department, setDepartment] = useState("");

  const load = useCallback((force = false) => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    getLearningAnalytics(token, department || undefined, { force })
      .then(setData)
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not load learning analytics.")))
      .finally(() => setLoading(false));
  }, [department]);

  useEffect(() => { load(false); }, [load]);

  function handleExport() {
    if (!data) return;
    const rows = (data.department_comparison || []).map((d) => ({
      department: d.department,
      assigned: d.assigned,
      completed: d.completed,
      completion_rate: d.completion_rate,
    }));
    downloadCsv(
      `learning-analytics${department ? `-${department}` : ""}.csv`,
      ["department", "assigned", "completed", "completion_rate"],
      rows.length
        ? rows
        : [{
            department: department || "All",
            assigned: data.total_assignments,
            completed: "",
            completion_rate: data.completion_rate,
          }]
    );
    const popularRows = (data.popular_courses || []).map((c) => ({
      title: c.title,
      enrollments: c.enrollments,
    }));
    if (popularRows.length) {
      downloadCsv("learning-popular-courses.csv", ["title", "enrollments"], popularRows);
    }
    toast.success("Analytics exported.");
  }

  if (loading) return null;
  if (!data) return null;

  const stats = [
    { label: "Completion Rate", value: `${data.completion_rate}%`, color: "cyan", icon: CircleCheck },
    { label: "Certification Rate", value: `${data.certification_rate}%`, color: "green", icon: Award },
    { label: "Learning Hours", value: data.total_learning_hours, color: "orange", icon: Clock },
    { label: "Mandatory completion", value: `${data.mandatory_completion_rate ?? 0}%`, color: "navy", icon: Target },
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
              <p className={shellStyles.sectionDesc}>Most-enrolled courses across your employees</p>
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

function ManagedLearningTab() {
  const emptyForm = {
    id: "",
    provider: "Managed Learning",
    designation: "",
    learning_month: "",
    category: "",
    competency: "",
    title: "",
    url: "",
    duration_minutes: "",
    description: "",
    archived: false,
  };

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [courses, setCourses] = useState([]);
  const [hierarchy, setHierarchy] = useState([]);
  const [facets, setFacets] = useState({ providers: [], designations: [], months: [], categories: [], competencies: [] });
  const [q, setQ] = useState("");
  const [provider, setProvider] = useState("");
  const [designation, setDesignation] = useState("");
  const [learningMonth, setLearningMonth] = useState("");
  const [category, setCategory] = useState("");
  const [competency, setCompetency] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [sortBy, setSortBy] = useState("newest");
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [preview, setPreview] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [providers, setProviders] = useState([]);
  const fileInputRef = useRef(null);

  const loadProviderList = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return Promise.resolve([]);
    // Single source of truth: the provider registry.
    // Do NOT merge with getManagedFacets — facets include providers from course docs
    // which may include deleted providers that haven't been fully cleaned up yet.
    return listProviders(token, { include_inactive: false, page_size: 100 })
      .catch(() => ({ providers: [] }))
      .then((providerData) => {
        const list = (providerData?.providers || [])
          .map((p) => p.name ?? p)
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b));
        setProviders(list);
        return list;
      });
  }, []);

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    Promise.all([
      listManagedCourses(token, {
        q: q || undefined,
        provider: provider || undefined,
        designation: designation || undefined,
        learning_month: learningMonth || undefined,
        category: category || undefined,
        competency: competency || undefined,
        archived: showArchived ? true : undefined,
        sort_by: sortBy,
        page: 1,
        page_size: 100,
      }),
      getManagedFacets(token).catch(() => ({ providers: [], designations: [], months: [], categories: [], competencies: [] })),
    ])
      .then(([courseData, facetData]) => {
        setCourses(courseData.courses || []);
        setHierarchy(courseData.hierarchy || []);
        setFacets(facetData || { providers: [], designations: [], months: [], categories: [], competencies: [] });
        // Refresh provider list after courses load so any new providers from
        // saved courses also appear in the dropdown.
        loadProviderList().then((merged) => {
          setForm((current) => {
            if (!current.provider && merged.length) {
              return { ...current, provider: merged[0] };
            }
            return current;
          });
        });
      })
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not load managed-learning courses.")))
      .finally(() => setLoading(false));
  }, [q, provider, designation, learningMonth, category, competency, showArchived, sortBy, loadProviderList]);

  // Load providers immediately on mount, independent of the course list.
  // Also re-load whenever a provider is created, updated, or deleted elsewhere.
  useEffect(() => {
    loadProviderList();
    const onChanged = () => loadProviderList();
    window.addEventListener(LEARNING_PROVIDERS_UPDATED_EVENT, onChanged);
    const onStorage = (e) => {
      if (e.key === LEARNING_PROVIDERS_UPDATED_STORAGE_KEY) loadProviderList();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(LEARNING_PROVIDERS_UPDATED_EVENT, onChanged);
      window.removeEventListener("storage", onStorage);
    };
  }, [loadProviderList]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  function resetForm() {
    setForm(emptyForm);
  }

  function beginEdit(course) {
    setForm({
      id: course.uid?.split(":")[1] || "",
      provider: course.provider || "Managed Learning",
      designation: course.designation || "",
      learning_month: course.learning_month || "",
      category: course.category || "",
      competency: course.competency || "",
      title: course.title || "",
      url: course.url || "",
      duration_minutes: course.duration_minutes || "",
      description: course.summary || "",
      archived: Boolean(course.archived),
    });
    toast.info(`Editing "${course.title}".`);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setSaving(true);
    const payload = {
      provider: form.provider.trim(),
      designation: form.designation.trim(),
      learning_month: form.learning_month.trim(),
      category: form.category.trim(),
      competency: form.competency.trim(),
      title: form.title.trim(),
      url: form.url.trim() || undefined,
      description: form.description.trim() || undefined,
      duration_minutes: form.duration_minutes ? Number(form.duration_minutes) : null,
      archived: Boolean(form.archived),
    };
    try {
      if (form.id) {
        await updateManagedCourse(token, form.id, payload);
        toast.success("Course updated.");
      } else {
        await createManagedCourse(token, payload);
        toast.success("Course added to managed learning.");
      }
      resetForm();
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not save course."));
    } finally {
      setSaving(false);
    }
  }

  async function handleArchiveToggle(course) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    try {
      if (course.archived) {
        await restoreManagedCourse(token, course.uid.split(":")[1]);
        toast.success("Course restored.");
      } else {
        await archiveManagedCourse(token, course.uid.split(":")[1]);
        toast.success("Course archived.");
      }
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not update course status."));
    }
  }

async function handleDelete(course) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    if (!window.confirm(`Delete "${course.title}"? This cannot be undone.`)) return;
    try {
      await deleteManagedCourse(token, course.uid.split(":")[1]);
      toast.success("Course deleted.");
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not delete course."));
    }
  }

  function toggleSelectCourse(uid) {
    setSelectedIds((prev) =>
      prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]
    );
  }

  function toggleSelectAll() {
    const visibleIds = courses.map((c) => c.uid?.split(":")[1]).filter(Boolean);
    if (selectedIds.length === visibleIds.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(visibleIds);
    }
  }

  async function handleBulkAction(action) {
    if (!selectedIds.length) { toast.error("Select at least one course."); return; }
    const token = localStorage.getItem("access_token");
    if (!token) return;
    const labels = { archive: "archive", restore: "restore", delete: "permanently delete" };
    if (!window.confirm(`${labels[action] || action} ${selectedIds.length} course(s)?`)) return;
    setBulkBusy(true);
    try {
      const res = await bulkManagedCourseAction(token, selectedIds, action);
      toast.success(`${action.charAt(0).toUpperCase() + action.slice(1)}d ${res.affected} course(s).`);
      setSelectedIds([]);
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Bulk action failed."));
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleExportCsv() {
    const rows = courses.map((c) => ({
      Provider: c.provider || "",
      Designation: c.designation || "",
      "Learning Month": c.learning_month || "",
      Category: c.category || "",
      Competency: c.competency || "",
      Title: c.title || "",
      URL: c.url || "",
      "Duration (min)": c.duration_minutes || "",
      Description: c.summary || "",
      Archived: c.archived ? "Yes" : "No",
    }));
    const selected = selectedIds.length
      ? rows.filter((_, i) => selectedIds.includes(courses[i]?.uid?.split(":")[1]))
      : rows;
    const headers = ["Provider", "Designation", "Learning Month", "Category", "Competency", "Title", "URL", "Duration (min)", "Description", "Archived"];
    downloadCsv(`managed-courses-${Date.now()}.csv`, headers, selected);
  }

  function selectedImportProvider() {
    return form.provider || "Managed Learning";
  }

  async function handlePreviewUpload(file) {
     const token = localStorage.getItem("access_token");
     if (!token || !file) return;
     setPreviewBusy(true);
     setPreview(null);
     setPreviewFile(file);
     try {
       const data = await previewManagedImport(file, token, form.provider || "Managed Learning");
       setPreview(data);
       toast.success(`Preview ready: ${data.total_rows || 0} rows parsed.`);
     } catch (err) {
       setPreview(null);
       toast.error(getApiErrorMessage(err, "Could not preview roadmap import."));
     } finally {
       setPreviewBusy(false);
       if (fileInputRef.current) fileInputRef.current.value = "";
     }
   }

   async function handleCommitImport() {
     const token = localStorage.getItem("access_token");
     if (!token || !previewFile) return;
     setSaving(true);
     try {
       const data = await commitManagedImport(previewFile, token, form.provider || "Managed Learning");
       toast.success(data.message || "Roadmap imported.");
       setPreview(null);
       setPreviewFile(null);
       load();
     } catch (err) {
       toast.error(getApiErrorMessage(err, "Could not import roadmap."));
     } finally {
       setSaving(false);
     }
   }

  return (
    <div className={shellStyles.section}>
      <div className={shellStyles.sectionHead}>
        <div className={shellStyles.sectionHeadLeft}>
          <span className={`${shellStyles.bar} ${shellStyles.green}`} />
          <div>
            <div className={shellStyles.sectionTitle}>Managed learning roadmap</div>
            <p className={shellStyles.sectionDesc}>Import, edit, archive, and delete managed roadmap courses by designation and month.</p>
          </div>
        </div>
        <div className={styles.toolbar} style={{ marginBottom: 0 }}>
          <div className={styles.toolbarRight}>
            <button type="button" className={styles.modeBtn} onClick={() => load(true)}>
              <RefreshCw aria-hidden="true" /> Refresh
            </button>
            <button type="button" className={styles.modeBtn} onClick={resetForm}>
              <Plus aria-hidden="true" /> New course
            </button>
          </div>
        </div>
      </div>

      <div className={shellStyles.sectionBody}>
        <div className={styles.filterBar}>
          <div className={styles.searchField}>
            <Search className={styles.searchFieldIcon} aria-hidden="true" />
            <input
              className={styles.searchFieldInput}
              aria-label="Search roadmap courses"
              placeholder="Search roadmap courses…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <select className={styles.filterSelect} value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="">All providers</option>
            {(facets.providers || []).map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
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
          <label className={styles.checkPill}>
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            <Archive aria-hidden="true" />
            Show archived
          </label>
          <select
            className={styles.filterSelect}
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            aria-label="Sort courses"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="updated">Recently updated</option>
            <option value="title_asc">Title A–Z</option>
            <option value="title_desc">Title Z–A</option>
            <option value="duration">Duration</option>
            <option value="provider">Provider</option>
          </select>
        </div>

        {selectedIds.length > 0 && (
          <div className={styles.filterBar} style={{ background: "var(--blue-lighter)", borderRadius: 10, padding: "8px 12px", marginBottom: 12, gap: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--navy)", marginRight: 4 }}>
              {selectedIds.length} selected
            </span>
            <button type="button" className={styles.smallBtn} disabled={bulkBusy} onClick={() => handleBulkAction("archive")}>
              <Archive aria-hidden="true" /> Archive
            </button>
            <button type="button" className={styles.smallBtn} disabled={bulkBusy} onClick={() => handleBulkAction("restore")}>
              <RefreshCw aria-hidden="true" /> Restore
            </button>
            <button type="button" className={`${styles.smallBtn}`} style={{ color: "#b42318", borderColor: "#f3c6c1" }} disabled={bulkBusy} onClick={() => handleBulkAction("delete")}>
              <Trash2 aria-hidden="true" /> Delete
            </button>
            <button type="button" className={styles.smallBtn} disabled={bulkBusy} onClick={handleExportCsv}>
              <Download aria-hidden="true" /> Export CSV
            </button>
            <button type="button" className={styles.smallBtn} onClick={() => setSelectedIds([])}>
              <X aria-hidden="true" /> Clear
            </button>
          </div>
        )}

        <div className={shellStyles.cols2}>
          <div className={shellStyles.section} style={{ margin: 0 }}>
            <div className={shellStyles.sectionHead}>
              <div className={shellStyles.sectionHeadLeft}>
                <span className={`${shellStyles.bar} ${shellStyles.cyan}`} />
                <div>
                  <div className={shellStyles.sectionTitle}>{form.id ? "Edit course" : "Add course"}</div>
                  <p className={shellStyles.sectionDesc}>Manual course management for managed learning and other providers.</p>
                </div>
              </div>
            </div>
            <div className={shellStyles.sectionBody}>
              <form data-partner-coach className={styles.managedForm} onSubmit={handleSubmit}>
                <label className={styles.fieldLabel}>
                  Provider
                  <select data-field-key="managed_provider" value={form.provider} onChange={(e) => setForm((current) => ({ ...current, provider: e.target.value }))}>
                    <option value="">Select provider</option>
                    {(providers || []).map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                <label className={styles.fieldLabel}>
                  Designation
                  <input data-field-key="designation" placeholder="e.g. Software Engineer" value={form.designation} onChange={(e) => setForm((current) => ({ ...current, designation: e.target.value }))} />
                </label>
                <label className={styles.fieldLabel}>
                  Learning month
                  <input data-field-key="learning_month" placeholder="e.g. 2025-03" value={form.learning_month} onChange={(e) => setForm((current) => ({ ...current, learning_month: e.target.value }))} />
                </label>
                <label className={styles.fieldLabel}>
                  Category
                  <input data-field-key="managed_category" placeholder="e.g. Cloud" value={form.category} onChange={(e) => setForm((current) => ({ ...current, category: e.target.value }))} />
                </label>
                <label className={styles.fieldLabel}>
                  Competency
                  <input data-field-key="competency" placeholder="e.g. Azure" value={form.competency} onChange={(e) => setForm((current) => ({ ...current, competency: e.target.value }))} />
                </label>
                <label className={styles.fieldLabel}>
                  Duration (minutes)
                  <input data-field-key="duration_minutes" type="number" min="1" placeholder="e.g. 45" value={form.duration_minutes} onChange={(e) => setForm((current) => ({ ...current, duration_minutes: e.target.value }))} />
                </label>
                <label className={`${styles.fieldLabel} ${styles.wide}`}>
                  Course title
                  <input data-field-key="course_title" placeholder="e.g. Azure Fundamentals" value={form.title} onChange={(e) => setForm((current) => ({ ...current, title: e.target.value }))} required />
                </label>
                <label className={`${styles.fieldLabel} ${styles.wide}`}>
                  Course URL
                  <input data-field-key="url" placeholder="https://example.com/course" value={form.url} onChange={(e) => setForm((current) => ({ ...current, url: e.target.value }))} />
                </label>
                <label className={`${styles.fieldLabel} ${styles.wide}`}>
                  Description
                  <textarea data-field-key="description" rows={3} placeholder="Short summary shown in the catalog" value={form.description} onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))} />
                </label>
                <label className={styles.checkPill} style={{ justifySelf: "start" }}>
                  <input type="checkbox" checked={Boolean(form.archived)} onChange={(e) => setForm((current) => ({ ...current, archived: e.target.checked }))} />
                  <Archive aria-hidden="true" />
                  Archived
                </label>
                <div className={styles.formActions}>
                  <button type="submit" className={styles.assignCourseBtn} disabled={saving}>
                    <Check aria-hidden="true" /> {saving ? "Saving…" : form.id ? "Update course" : "Create course"}
                  </button>
                  <button type="button" className={styles.smallBtn} onClick={resetForm}>
                    <X aria-hidden="true" /> Clear
                  </button>
                </div>
              </form>
            </div>
          </div>

          <div className={shellStyles.section} style={{ margin: 0 }}>
            <div className={shellStyles.sectionHead}>
              <div className={shellStyles.sectionHeadLeft}>
                <span className={`${shellStyles.bar} ${shellStyles.orange}`} />
                <div>
                  <div className={shellStyles.sectionTitle}>Import roadmap</div>
                  <p className={shellStyles.sectionDesc}>Upload .xlsx or .csv, preview the hierarchy, then confirm.</p>
                </div>
              </div>
            </div>
            <div className={shellStyles.sectionBody}>
              <label className={styles.fieldLabel} style={{ marginBottom: 12 }}>
                Import provider
                <select value={form.provider} onChange={(e) => setForm((current) => ({ ...current, provider: e.target.value }))}>
                  <option value="">Select provider</option>
                  {(providers || []).map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              {!preview && (
                <label className={styles.fileDrop}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.csv"
                    className={styles.fileDropInput}
                    onChange={(e) => handlePreviewUpload(e.target.files?.[0])}
                  />
                  <Upload className={styles.fileDropIcon} aria-hidden="true" />
                  <strong>Choose a spreadsheet</strong>
                   <span>.xlsx or .csv — parsed and previewed before saving</span>
                </label>
              )}
              {previewBusy && <p className={styles.inlineNote} style={{ marginTop: 12 }}>Parsing spreadsheet…</p>}
              {preview ? (
                <div style={{ marginTop: 12 }}>
                  <div className={styles.importStats}>
                    <div className={styles.importStat}><div className={styles.importStatValue}>{preview.total_rows}</div><div className={styles.importStatLabel}>Rows</div></div>
                    <div className={styles.importStat}><div className={styles.importStatValue}>{preview.new_courses}</div><div className={styles.importStatLabel}>New</div></div>
                    <div className={styles.importStat}><div className={styles.importStatValue}>{preview.updated_courses}</div><div className={styles.importStatLabel}>Updated</div></div>
                    <div className={styles.importStat}><div className={styles.importStatValue}>{preview.duplicate_courses}</div><div className={styles.importStatLabel}>Duplicate</div></div>
                    <div className={styles.importStat}><div className={styles.importStatValue}>{preview.invalid_rows}</div><div className={styles.importStatLabel}>Invalid</div></div>
                  </div>
                  <div className={styles.formActions}>
                    <button type="button" className={styles.assignCourseBtn} disabled={saving} onClick={handleCommitImport}>
                      <Check aria-hidden="true" /> {saving ? "Importing…" : "Confirm import"}
                    </button>
                    <button type="button" className={styles.smallBtn} onClick={() => { setPreview(null); setPreviewFile(null); }}>
                      <X aria-hidden="true" /> Clear preview
                    </button>
                  </div>
                  <p className={styles.inlineNote} style={{ marginTop: 10, marginBottom: 0 }}>
                    {preview.filename || "Uploaded file"} · {preview.rows?.length || 0} preview row(s)
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {hierarchy.length > 0 && (
          <div className={shellStyles.section} style={{ marginTop: 16 }}>
            <div className={shellStyles.sectionHead}>
              <div className={shellStyles.sectionHeadLeft}>
                <span className={`${shellStyles.bar} ${shellStyles.navy}`} />
                <div>
                  <div className={shellStyles.sectionTitle}>Roadmap hierarchy</div>
                  <p className={shellStyles.sectionDesc}>Designation â†’ Month â†’ Category â†’ Competency</p>
                </div>
              </div>
            </div>
            <div className={shellStyles.sectionBody}>
              {hierarchy.map((designationNode) => (
                <div key={designationNode.designation} className={styles.hierarchyDept}>
                  <div className={styles.hierarchyDeptTitle}>
                    <FolderTree aria-hidden="true" />
                    {designationNode.designation}
                  </div>
                  <div className={styles.hierarchyMonths}>
                    {(designationNode.months || []).map((monthNode) => (
                      <div key={monthNode.learning_month} className={styles.hierarchyMonth}>
                        <div className={styles.hierarchyMonthTitle}>
                          <Calendar aria-hidden="true" />
                          {monthNode.learning_month}
                        </div>
                        <div className={styles.hierarchyCats}>
                          {(monthNode.categories || []).map((categoryNode) => (
                            <div key={categoryNode.category}>
                              <div className={styles.hierarchyCatTitle}>{categoryNode.category}</div>
                              <div className={styles.hierarchyChips}>
                                {(categoryNode.competencies || []).map((competencyNode) => (
                                  <span key={competencyNode.competency} className={styles.hierarchyChip}>{competencyNode.competency}</span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && courses.length === 0 && (
          <div className={styles.emptyState}>
            <div className={styles.emptyStateIcon}><BookOpen aria-hidden="true" /></div>
            <div className={styles.emptyStateTitle}>No managed courses</div>
            <p className={styles.emptyStateHint}>Clear your filters or add a new course to build your managed learning roadmap.</p>
          </div>
        )}

        {!loading && courses.length > 0 && (
          <div className={styles.sourceToggle} style={{ marginBottom: 12 }}>
            <label className={styles.checkPill}>
              <input
                type="checkbox"
                checked={selectedIds.length > 0 && selectedIds.length === courses.length}
                onChange={toggleSelectAll}
              />
              Select all
            </label>
          </div>
        )}
        <div className={styles.courseGrid}>
          {courses.map((course) => {
            const courseId = course.uid?.split(":")[1];
            const isSelected = selectedIds.includes(courseId);
            return (
              <div key={course.uid} className={`${styles.courseCard} ${isSelected ? styles.sourceBtnActive : ""}`}>
                <div className={styles.courseCardHead}>
                  <span className={`${styles.sourceBadge} ${styles.sourceBadgeRecruiter}`}>{course.provider || "Managed Learning"}</span>
                  <label className={styles.checkPill}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelectCourse(courseId)}
                    />
                  </label>
                </div>
                <div className={styles.courseTitle}>{course.title}</div>
                <div className={styles.courseMeta}>
                  {course.designation ? <span className={styles.metaChip}><Briefcase aria-hidden="true" />{course.designation}</span> : null}
                  {course.learning_month ? <span className={styles.metaChip}><Calendar aria-hidden="true" />{course.learning_month}</span> : null}
                  <span className={styles.metaChip}><Clock aria-hidden="true" />{course.duration_minutes || "—"} min</span>
                </div>
                <p className={styles.courseSummary}>{[course.category, course.competency, course.summary].filter(Boolean).join(" · ")}</p>
                <div className={styles.courseActions}>
                  {course.url && (
                    <a href={course.url} target="_blank" rel="noopener noreferrer" className={styles.smallBtn}>
                      <Eye aria-hidden="true" /> Preview
                    </a>
                  )}
                  <button type="button" className={styles.smallBtn} onClick={() => beginEdit(course)}>
                    <Pencil aria-hidden="true" /> Edit
                  </button>
                  <button type="button" className={styles.smallBtn} onClick={() => handleArchiveToggle(course)}>
                    {course.archived ? <><RefreshCw aria-hidden="true" /> Restore</> : <><Archive aria-hidden="true" /> Archive</>}
                  </button>
                  <button type="button" className={styles.smallBtn} onClick={() => handleDelete(course)}>
                    <Trash2 aria-hidden="true" /> Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
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
  });

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
    setForm({ name: "", provider_type: "manual", import_method: "excel", description: "", logo_url: "", active: true });
    setShowForm(true);
  }

  function startEdit(provider) {
    setEditingId(provider.id);
    setForm({
      name: provider.name || "",
      provider_type: provider.provider_type || "manual",
      import_method: provider.import_method || "manual",
      description: provider.description || "",
      logo_url: provider.logo_url || "",
      active: Boolean(provider.active),
    });
    setShowForm(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;
    if (!form.name.trim()) { toast.error("Provider name is required."); return; }
    setSaving(true);
    try {
      if (editingId) {
        await updateProvider(token, editingId, form);
        toast.success("Provider updated.");
      } else {
        await createProvider(token, form);
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
                Add any learning provider — Coursera, Udemy, DataCamp, Skillsoft, your internal academy — with zero code changes.
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
                <label className={styles.fieldLabel}>
                  Provider type
                  <select data-field-key="provider_type" value={form.provider_type} onChange={(e) => setForm((f) => ({ ...f, provider_type: e.target.value }))}>
                    <option value="manual">Manual</option>
                    <option value="api">API</option>
                  </select>
                  <div className={styles.providerFormHint}>API providers sync automatically; manual providers use Excel imports.</div>
                </label>
                <label className={styles.fieldLabel}>
                  Import method
                  <select data-field-key="import_method" value={form.import_method} onChange={(e) => setForm((f) => ({ ...f, import_method: e.target.value }))}>
                    <option value="excel">Excel</option>
                    <option value="api">API</option>
                    <option value="manual">Manual entry</option>
                  </select>
                </label>
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
                    <span className={`${styles.providerChip} ${p.provider_type === "api" ? styles.providerChipGreen : styles.providerChipGrey}`}>
                      {p.provider_type === "api" ? "API" : "Manual"}
                    </span>
                    <span className={styles.providerChip}>
                      {p.import_method === "api" ? "API sync" : p.import_method === "excel" ? "Excel import" : "Manual entry"}
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
                        <Upload aria-hidden="true" /> Import
                      </button>
                      {p.provider_type === "api" && (
                        <button
                          type="button"
                          className={styles.providerActionBtn}
                          disabled={busyId === p.id}
                          onClick={async () => {
                            const token = localStorage.getItem("access_token");
                            if (!token) return;
                            setBusyId(p.id);
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
                          <RefreshCw aria-hidden="true" /> Sync
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

// ──────────────────────────────────────────────────────────────────────────── //
// Import Courses (Phase 2 — Universal Provider Import Engine)
// ──────────────────────────────────────────────────────────────────────────── //
function ImportsTab({ initialProvider = null, onConsumedInitial }) {
  const [providers, setProviders] = useState([]);
  const [provider, setProvider] = useState(initialProvider ? initialProvider.id : "");
  const [providerName, setProviderName] = useState(initialProvider ? initialProvider.name : "");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [missingAction, setMissingAction] = useState("keep");
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [step, setStep] = useState(1); // 1 select+upload, 2 preview, 3 done
  const [pendingRollback, setPendingRollback] = useState(null);
  const [busyId, setBusyId] = useState("");

  const loadProviders = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return Promise.resolve();
    return listProviders(token, { include_inactive: true, page_size: 100 })
      .then((data) => setProviders(data.providers || []))
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not load providers.")));
  }, []);

  const loadHistory = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setHistoryLoading(true);
    listImportHistory(token, { page_size: 20 })
      .then((data) => setHistory(data.history || []))
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  }, []);

  useEffect(() => {
    loadProviders();
    loadHistory();
  }, [loadProviders, loadHistory]);

  // Consume the initial provider passed from the Providers tab.
  useEffect(() => {
    if (!initialProvider) return;
    setProvider(initialProvider.id);
    setProviderName(initialProvider.name);
    onConsumedInitial?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProvider]);

  async function handlePreview(e) {
    e.preventDefault();
    if (!provider) { toast.error("Select a provider first."); return; }
    if (!file) { toast.error("Choose an Excel or CSV file to import."); return; }
    const token = localStorage.getItem("access_token");
    setPreviewing(true);
    setPreview(null);
    try {
      const data = await previewImport(token, { file, providerId: provider, providerName: providerName || undefined });
      setPreview(data);
      setStep(data.valid ? 2 : 1);
      if (!data.valid) toast.warn("The file has validation issues. Review the report below.");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not preview the file."));
    } finally {
      setPreviewing(false);
    }
  }

  async function handleCommit() {
    if (!preview || !preview.valid) return;
    const token = localStorage.getItem("access_token");
    setSaving(true);
    try {
      const data = await commitImport(token, {
        file,
        providerId: provider,
        providerName: providerName || undefined,
        missingAction,
      });
      toast.success(data.message || "Import completed.");
      setPreview(null);
      setFile(null);
      setStep(3);
      loadProviders();
      loadHistory();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Import failed."));
    } finally {
      setSaving(false);
    }
  }

  function handleNewImport() {
    setPreview(null);
    setFile(null);
    setStep(1);
    setProvider("");
    setProviderName("");
  }

  async function downloadReport(historyId) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    try {
      const blob = await downloadImportReport(token, historyId);
      const url = window.URL.createObjectURL(new Blob([blob]));
      const link = document.createElement("a");
      link.href = url;
      link.download = `import-report-${historyId}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not download the report."));
    }
  }

  async function confirmRollback() {
    const token = localStorage.getItem("access_token");
    if (!token || !pendingRollback) return;
    setBusyId(pendingRollback.id);
    try {
      const res = await rollbackImport(token, pendingRollback.id);
      toast.success("Import rolled back.");
      setPendingRollback(null);
      loadProviders();
      loadHistory();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not roll back the import."));
    } finally {
      setBusyId("");
    }
  }

  const selectedProvider = providers.find((p) => p.id === provider);
  const hasInvalid = (preview?.invalid_rows || 0) > 0;

  return (
    <>
      <ConfirmDialog
        open={Boolean(pendingRollback)}
        title="Roll back this import?"
        message="Rolling back undoes the courses created, updated, archived, or deleted by this import. Continue?"
        confirmLabel="Roll back"
        cancelLabel="Cancel"
        danger
        onConfirm={confirmRollback}
        onCancel={() => setPendingRollback(null)}
      />
      <div className={shellStyles.section}>
        <div className={shellStyles.sectionHead}>
          <div className={shellStyles.sectionHeadLeft}>
            <span className={`${shellStyles.bar} ${shellStyles.green}`} />
            <div>
              <div className={shellStyles.sectionTitle}>Import course catalog</div>
              <p className={shellStyles.sectionDesc}>
                One import engine for every provider — validate, preview, then import. No provider-specific uploads.
              </p>
            </div>
          </div>
        </div>
        <div className={shellStyles.sectionBody}>
          <div className={styles.importStepBar}>
            <span className={`${styles.importStep} ${step >= 1 ? styles.importStepActive : ""}`}>
              {step > 1 ? <Check aria-hidden="true" /> : "1"} Provider &amp; file
            </span>
            <span className={styles.importStepLine} />
            <span className={`${styles.importStep} ${step >= 2 ? styles.importStepActive : ""}`}>2 Preview</span>
            <span className={styles.importStepLine} />
            <span className={`${styles.importStep} ${step >= 3 ? styles.importStepDone : ""}`}>3 Import</span>
          </div>

          {step !== 3 && (
            <form onSubmit={handlePreview}>
              <div className={styles.providerFormGrid}>
                <label className={styles.fieldLabel}>
                  Provider
                  <select
                    className={styles.importProviderSelect}
                    value={provider}
                    onChange={(e) => {
                      setProvider(e.target.value);
                      const found = providers.find((p) => p.id === e.target.value);
                      setProviderName(found ? found.name : "");
                    }}
                  >
                    <option value="">Select a provider…</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id} disabled={!p.active}>
                        {p.name}{!p.active ? " (inactive)" : ""}
                      </option>
                    ))}
                  </select>
                  {selectedProvider?.provider_type === "api" && (
                    <div className={styles.providerFormHint}>
                      API provider — you can sync automatically from the Providers tab, or import an Excel snapshot here.
                    </div>
                  )}
                </label>
                <label className={styles.fieldLabel}>
                  Missing courses
                  <select value={missingAction} onChange={(e) => setMissingAction(e.target.value)}>
                    <option value="keep">Keep (default)</option>
                    <option value="archive">Archive</option>
                    <option value="delete">Delete</option>
                  </select>
                  <div className={styles.providerFormHint}>
                    What to do with existing courses that are missing from this file. Never automatic by default.
                  </div>
                </label>
                <div className={`${styles.fieldLabel} ${styles.wide}`}>
                  Spreadsheet
                  <FileUploadField
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => { setFile(e.target.files?.[0] || null); setPreview(null); }}
                  />
                  <div className={styles.providerFormHint}>
                    Supported: .xlsx, .xls, .csv. Required columns: Course Title, URL, Designation, Learning Month, Category, Competency.
                  </div>
                </div>
              </div>
              <div className={styles.formActions}>
                <button type="submit" className={styles.assignCourseBtn} disabled={previewing || !provider || !file}>
                  {previewing ? "Validating…" : "Validate & preview"}
                </button>
              </div>
            </form>
          )}

          {preview && (
            <div className={styles.assignPanel} style={{ marginTop: 18 }}>
              <div className={styles.assignPanelHead}>
                <div>
                  <div className={styles.assignPanelTitle}>Import preview — {preview.provider_name || "courses"}</div>
                  <p className={styles.assignPanelDesc}>
                    {preview.filename} · {preview.total_rows} row(s). Review the breakdown, then confirm.
                  </p>
                </div>
              </div>
              <div className={styles.importStats}>
                <div className={styles.importStat}>
                  <div className={styles.importStatValue}>{preview.new_courses}</div>
                  <div className={styles.importStatLabel}>New</div>
                </div>
                <div className={styles.importStat}>
                  <div className={styles.importStatValue}>{preview.updated_courses}</div>
                  <div className={styles.importStatLabel}>Updated</div>
                </div>
                <div className={styles.importStat}>
                  <div className={styles.importStatValue}>{preview.duplicate_rows}</div>
                  <div className={styles.importStatLabel}>Duplicate</div>
                </div>
                <div className={styles.importStat}>
                  <div className={styles.importStatValue}>{preview.invalid_rows}</div>
                  <div className={styles.importStatLabel}>Invalid</div>
                </div>
                <div className={styles.importStat}>
                  <div className={styles.importStatValue}>{preview.skipped_rows}</div>
                  <div className={styles.importStatLabel}>Skipped</div>
                </div>
              </div>
              {hasInvalid ? (
                <div className={styles.importErrorBanner}>
                  <CircleAlert aria-hidden="true" />
                  <div>
                    This file contains invalid rows and will <b>not</b> be imported until they are fixed.
                    Invalid rows are flagged below with the exact reason.
                  </div>
                </div>
              ) : (
                <div className={styles.providerFormHint} style={{ marginTop: 10 }}>
                  The file is valid — duplicate rows will be skipped and existing courses will be updated in place.
                </div>
              )}
              {(preview.rows || []).length > 0 && (
                <div style={{ maxHeight: 320, overflow: "auto" }}>
                  <table className={styles.importPreviewTable}>
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Status</th>
                        <th>Course</th>
                        <th>Designation</th>
                        <th>Month</th>
                        <th>Category</th>
                        <th>Issues</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(preview.rows || []).slice(0, 60).map((row) => {
                        const statusKey = row.status[0].toUpperCase() + row.status.slice(1);
                        return (
                          <tr key={row.row}>
                            <td>{row.row}</td>
                            <td>
                              <span className={`${styles.rowStatusBadge} ${styles[`rowStatus${statusKey}`] || styles.rowStatusSkipped}`}>
                                {row.status}
                              </span>
                            </td>
                            <td>{row.title || "—"}</td>
                            <td>{row.designation || "—"}</td>
                            <td>{row.learning_month || "—"}</td>
                            <td>{row.category || "—"}</td>
                            <td>
                              {(row.issues || []).length > 0 && (
                                <ul className={styles.issueList}>
                                  {(row.issues || []).slice(0, 4).map((issueObj, i) => (
                                    <li key={i}>{issueObj.message}</li>
                                  ))}
                                </ul>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className={styles.formActions} style={{ marginTop: 16 }}>
                <button type="button" className={styles.assignCourseBtn} disabled={saving || hasInvalid || !preview.valid} onClick={handleCommit}>
                  <Check aria-hidden="true" /> {saving ? "Importing…" : "Confirm import"}
                </button>
                <button type="button" className={styles.smallBtn} onClick={handleNewImport}>
                  Start over
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className={styles.emptyState} style={{ marginTop: 18 }}>
              <div className={styles.emptyStateIcon}><CircleCheck aria-hidden="true" /></div>
              <div className={styles.emptyStateTitle}>Import completed</div>
              <p className={styles.emptyStateHint}>
                The courses are live in every catalog. Track the result or roll it back from the history below.
              </p>
              <button type="button" className={styles.assignCourseBtn} onClick={handleNewImport}>
                <Plus aria-hidden="true" /> Import another file
              </button>
            </div>
          )}

          <div style={{ marginTop: 28 }}>
            <div className={shellStyles.sectionTitle}>Import history</div>
            <p className={shellStyles.sectionDesc}>Every import and API sync, with rollback and downloadable reports.</p>
            <div className={shellStyles.sectionBody} style={{ paddingLeft: 0, paddingRight: 0 }}>
              {!historyLoading && history.length === 0 && (
                <p className={styles.inlineNote}>No imports recorded yet.</p>
              )}
              {!historyLoading && history.map((h) => (
                <div key={h.id} className={styles.importHistoryRow}>
                  <div className={styles.importHistoryMain}>
                    <div className={styles.importHistoryTitle}>
                      {h.provider_name || "Unknown provider"} · {h.import_type === "api" ? "API sync" : "Excel import"}
                      {h.status !== "completed" && <span className={styles.statusChip}> {h.status}</span>}
                    </div>
                    <div className={styles.importHistoryMeta}>
                      <span><b>{h.imported_by_name || "—"}</b> · {h.created_at ? new Date(h.created_at).toLocaleString() : ""}</span>
                      {h.filename && <span>{h.filename}</span>}
                      <span>+{h.rows_imported} new</span>
                      <span>~{h.rows_updated} updated</span>
                      <span>{h.rows_failed} failed</span>
                      {h.rows_archived > 0 && <span>{h.rows_archived} archived</span>}
                    </div>
                  </div>
                  <div className={styles.importHistoryActions}>
                    <button type="button" className={styles.smallBtn} onClick={() => downloadReport(h.id)}>
                      <Download aria-hidden="true" /> Report
                    </button>
                    {h.status === "completed" && !h.rollback_at && (
                      <button type="button" className={styles.smallBtn} disabled={busyId === h.id} onClick={() => setPendingRollback(h)}>
                        <RefreshCw aria-hidden="true" /> Roll back
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

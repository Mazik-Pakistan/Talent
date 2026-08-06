"use client";

import { Suspense } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import { useSearchParams } from "next/navigation";
import ProtectedRecruiterRoute from "@/components/ProtectedRecruiterRoute";
import OrgFrameworkTab from "./OrgFrameworkTab";
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
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CircleAlert,
  CircleCheck,
  Clock,
  Compass,
  Download,
  Eye,
  FileText,
  FolderTree,
  Globe,
  GraduationCap,
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
  TrendingUp,
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
import { RECRUITER_DEPARTMENTS, RECRUITER_DESIGNATIONS } from "@/components/recruiter/recruiterOptions";
import { getApiErrorMessage, listEmployees, remindCourseAssignments } from "@/services/authService";
import { downloadCsv } from "@/utils/downloadCsv";
import {
  clearRecruiterContext,
  publishRecruiterContext,
} from "@/lib/ai/recruiterContext";
import { LEARNING_TAB_HELP } from "@/lib/ai/recruiterFieldHelp";
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
  getManagedFacets,
  getOrgTaxonomy,
  getLearningAnalytics,
  listManagedCourses,
  listAssignments,
  listKbCertifications,
  listKbRoles,
  listPendingCertificates,
  previewManagedImport,
  restoreManagedCourse,
  verifyCertificate,
  updateManagedCourse,
} from "@/services/learningService";
import {
  listCareerTracks,
  createCareerTrack,
  listCareerLevels,
  createCareerLevel,
  updateCareerLevel,
  deleteCareerLevel,
  getPromotionReadiness,
  getCareerProgressReport,
  listCareerAssignments,
  assignEmployeeCareer,
  exportCareerFramework,
  importCareerFramework,
} from "@/services/careerService";

const TABS = [
  { key: "catalog", label: "Course Catalog", icon: Compass },
  { key: "managed", label: "LinkedIn Learning", icon: BookOpen },
  { key: "knowledge", label: "Knowledge Base", icon: Library },
  { key: "assign", label: "Assign Courses", icon: UserCheck },
  { key: "assignments", label: "Track Progress", icon: ListChecks },
  { key: "certificates", label: "Verify Certificates", icon: BadgeCheck },
  { key: "analytics", label: "Learning Analytics", icon: BarChart3 },
  { key: "career-framework", label: "Career Framework", icon: Briefcase },
  { key: "org-framework", label: "Organization Framework", icon: FolderTree },
  { key: "promotion-readiness", label: "Promotion Readiness", icon: TrendingUp },
];

const CATALOG_SOURCES = [
  {
    key: "managed_learning",
    label: "LinkedIn Learning",
    hint: "Managed roadmap courses imported from LinkedIn Learning and other configured providers.",
  },
  {
    key: "microsoft_learn",
    label: "Microsoft Courses",
    hint: "Technical learning paths, modules, and certifications from Microsoft Learn (English).",
  },
  {
    key: "coursera",
    label: "Coursera Courses",
    hint: "Industry soft-skills courses from Coursera (English only) — communication, leadership, and more.",
  },
];

function sourceLabel(source) {
  if (source === "managed_learning") return "LinkedIn Learning";
  if (source === "coursera") return "Coursera";
  return "Microsoft";
}

function sourceBadgeClass(source) {
  if (source === "managed_learning") return styles.sourceBadgeRecruiter;
  if (source === "coursera") return styles.sourceBadgeCoursera;
  return "";
}

function LearningPageContent() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState(() => {
    const t = searchParams.get("tab");
    if (["certificates", "career-framework", "org-framework", "analytics", "managed", "knowledge", "assign", "assignments", "promotion-readiness", "catalog"].includes(t)) return t;
    return "catalog";
  });
  const [pendingAssign, setPendingAssign] = useState(null);
  const selectedCertificateId = searchParams.get("certificateId");
  const initialDepartment = searchParams.get("department") || "";

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t && ["certificates", "career-framework", "org-framework", "analytics", "managed", "knowledge", "assign", "assignments", "promotion-readiness", "catalog"].includes(t)) {
      setTab(t);
    }
  }, [searchParams]);

  function handleAssignFromCatalog(course, source) {
    setPendingAssign({ course, source: course?.source || source || "microsoft_learn" });
    setTab("assign");
    toast.info(`Selected “${course.title}” — choose who should take it.`);
  }

  const clearPendingAssign = useCallback(() => {
    setPendingAssign(null);
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
      <div className={styles.tabBar} role="tablist" aria-label="Learning management sections">
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
      {tab === "career-framework" && <CareerFrameworkTab initialDepartment={initialDepartment} />}
      {tab === "org-framework" && <OrgFrameworkTab />}
      {tab === "promotion-readiness" && <PromotionReadinessTab />}
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
  const [source, setSource] = useState("managed_learning");
  const [q, setQ] = useState("");
  const [facets, setFacets] = useState({ roles: [], levels: [], products: [], providers: [], designations: [], months: [], categories: [], competencies: [] });
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
  }

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    const loader = source === "managed_learning" ? getManagedFacets : getCatalogFacets;
    loader(token, source).then(setFacets).catch(() => {});
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
      provider: source === "managed_learning" ? provider || undefined : undefined,
      designation: source === "managed_learning" ? designation || undefined : undefined,
      learning_month: source === "managed_learning" ? learningMonth || undefined : undefined,
      category: source === "managed_learning" ? category || undefined : source === "coursera" ? category || undefined : undefined,
      competency: source === "managed_learning" ? competency || undefined : undefined,
      archived: source === "managed_learning" ? (archivedOnly ? true : undefined) : undefined,
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

  const activeSource = CATALOG_SOURCES.find((s) => s.key === source) || CATALOG_SOURCES[0];

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
          {CATALOG_SOURCES.map((s) => (
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
                source === "managed_learning"
                  ? "Search roadmap courses, designations, competency, or provider…"
                  : source === "coursera"
                  ? "Search soft skills, e.g. negotiation, leadership…"
                  : "Search Microsoft courses by title or skill…"
              }
              value={q}
              onChange={(e) => { setPage(1); setQ(e.target.value); }}
            />
          </div>
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
        {loading && <RecruiterLoader inline />}
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
          {(result.courses || []).map((c) => (
            <div key={c.uid} className={styles.courseCard}>
              <div className={styles.courseCardHead}>
                <span className={`${styles.sourceBadge} ${sourceBadgeClass(c.source || source)}`}>
                  {sourceLabel(c.source || source)}
                </span>
              </div>
              <div className={styles.courseTitle}>{c.title}</div>
              <div className={styles.courseMeta}>
                {source === "managed_learning" ? (
                  <>
                    <span className={styles.metaChip}>
                      <Building2 aria-hidden="true" />{c.provider || "LinkedIn Learning"}
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
          ))}
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
          {loading && <RecruiterLoader inline />}
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
              <p className={shellStyles.sectionDesc}>Shown in employee catalog as LinkedIn Learning</p>
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
    const timer = setTimeout(() => {
      if (!q.trim()) { setCourses([]); return; }
      browseCatalog(token, { q, source, page_size: 10 }).then((data) => setCourses(data.courses || [])).catch(() => {});
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
              <span className={`${styles.sourceBadge} ${sourceBadgeClass(courseSource)}`}>
                {sourceLabel(courseSource)}
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
                  Search below, or use Course Catalog → Assign to employees.
                </p>
              </div>
            </div>
            <div className={styles.sourceToggle} role="tablist" aria-label="Course source">
              {CATALOG_SOURCES.map((s) => (
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
              {(CATALOG_SOURCES.find((s) => s.key === source) || CATALOG_SOURCES[0]).hint}
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
                      <span className={styles.metaChip}>{sourceLabel(c.source || source)}</span>
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
                    {RECRUITER_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <select className={styles.filterSelect} value={filterTitle} onChange={(e) => setFilterTitle(e.target.value)}>
                    <option value="">All designations</option>
                    {RECRUITER_DESIGNATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
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
        {loading && <RecruiterLoader inline />}
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
      toast.success("Certificate verified — skill matrix updated via AI.");
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not verify certificate."));
    }
  }

  async function handleReject(id) {
    const token = localStorage.getItem("access_token");
    try {
      await verifyCertificate(token, id, { approve: false, note: rejectNote || undefined });
      toast.success("Certificate rejected.");
      setRejecting(null);
      setRejectNote("");
      load();
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
        {loading && <RecruiterLoader inline />}
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

  if (loading) return (
    <div className={shellStyles.section}>
      <div className={shellStyles.sectionBody}><RecruiterLoader inline /></div>
    </div>
  );
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
            {RECRUITER_DEPARTMENTS.map((d) => (
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
    provider: "LinkedIn Learning",
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
  const [form, setForm] = useState(emptyForm);
  const [preview, setPreview] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const fileInputRef = useRef(null);

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
        page: 1,
        page_size: 200,
      }),
      getManagedFacets(token),
    ])
      .then(([courseData, facetData]) => {
        setCourses(courseData.courses || []);
        setHierarchy(courseData.hierarchy || []);
        setFacets(facetData || { providers: [], designations: [], months: [], categories: [], competencies: [] });
      })
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not load LinkedIn Learning courses.")))
      .finally(() => setLoading(false));
  }, [q, provider, designation, learningMonth, category, competency, showArchived]);

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
      provider: course.provider || "LinkedIn Learning",
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
    toast.info(`Editing “${course.title}”.`);
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
        toast.success("Course added to LinkedIn Learning.");
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
    if (!window.confirm(`Delete “${course.title}”? This cannot be undone.`)) return;
    try {
      await deleteManagedCourse(token, course.uid.split(":")[1]);
      toast.success("Course deleted.");
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not delete course."));
    }
  }

  async function handlePreviewUpload(file) {
    const token = localStorage.getItem("access_token");
    if (!token || !file) return;
    setPreviewBusy(true);
    setPreview(null);
    setPreviewFile(file);
    try {
      const data = await previewManagedImport(file, token);
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
      const data = await commitManagedImport(previewFile, token);
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
            <div className={shellStyles.sectionTitle}>LinkedIn Learning roadmap</div>
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
        </div>

        <div className={shellStyles.cols2}>
          <div className={shellStyles.section} style={{ margin: 0 }}>
            <div className={shellStyles.sectionHead}>
              <div className={shellStyles.sectionHeadLeft}>
                <span className={`${shellStyles.bar} ${shellStyles.cyan}`} />
                <div>
                  <div className={shellStyles.sectionTitle}>{form.id ? "Edit course" : "Add course"}</div>
                  <p className={shellStyles.sectionDesc}>Manual course management for LinkedIn Learning and other providers.</p>
                </div>
              </div>
            </div>
            <div className={shellStyles.sectionBody}>
              <form className={styles.managedForm} onSubmit={handleSubmit}>
                <label className={styles.fieldLabel}>
                  Provider
                  <input placeholder="e.g. LinkedIn Learning" value={form.provider} onChange={(e) => setForm((current) => ({ ...current, provider: e.target.value }))} />
                </label>
                <label className={styles.fieldLabel}>
                  Designation
                  <input placeholder="e.g. Software Engineer" value={form.designation} onChange={(e) => setForm((current) => ({ ...current, designation: e.target.value }))} />
                </label>
                <label className={styles.fieldLabel}>
                  Learning month
                  <input placeholder="e.g. 2025-03" value={form.learning_month} onChange={(e) => setForm((current) => ({ ...current, learning_month: e.target.value }))} />
                </label>
                <label className={styles.fieldLabel}>
                  Category
                  <input placeholder="e.g. Cloud" value={form.category} onChange={(e) => setForm((current) => ({ ...current, category: e.target.value }))} />
                </label>
                <label className={styles.fieldLabel}>
                  Competency
                  <input placeholder="e.g. Azure" value={form.competency} onChange={(e) => setForm((current) => ({ ...current, competency: e.target.value }))} />
                </label>
                <label className={styles.fieldLabel}>
                  Duration (minutes)
                  <input type="number" min="1" placeholder="e.g. 45" value={form.duration_minutes} onChange={(e) => setForm((current) => ({ ...current, duration_minutes: e.target.value }))} />
                </label>
                <label className={`${styles.fieldLabel} ${styles.wide}`}>
                  Course title
                  <input placeholder="e.g. Azure Fundamentals" value={form.title} onChange={(e) => setForm((current) => ({ ...current, title: e.target.value }))} required />
                </label>
                <label className={`${styles.fieldLabel} ${styles.wide}`}>
                  Course URL
                  <input placeholder="https://www.linkedin.com/learning/…" value={form.url} onChange={(e) => setForm((current) => ({ ...current, url: e.target.value }))} />
                </label>
                <label className={`${styles.fieldLabel} ${styles.wide}`}>
                  Description
                  <textarea rows={3} placeholder="Short summary shown in the catalog" value={form.description} onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))} />
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
                  <p className={shellStyles.sectionDesc}>Designation → Month → Category → Competency</p>
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

        {loading && <RecruiterLoader inline />}
        {!loading && courses.length === 0 && (
          <div className={styles.emptyState}>
            <div className={styles.emptyStateIcon}><BookOpen aria-hidden="true" /></div>
            <div className={styles.emptyStateTitle}>No managed courses</div>
            <p className={styles.emptyStateHint}>Clear your filters or add a new course to build your LinkedIn Learning roadmap.</p>
          </div>
        )}

        <div className={styles.courseGrid}>
          {courses.map((course) => (
            <div key={course.uid} className={styles.courseCard}>
              <div className={styles.courseCardHead}>
                <span className={`${styles.sourceBadge} ${styles.sourceBadgeRecruiter}`}>{course.provider || "LinkedIn Learning"}</span>
                {course.archived ? <span className={styles.statusChip}>Archived</span> : null}
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
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════ //
// Career Framework Tab                                                          //
// ═══════════════════════════════════════════════════════════════════════════════ //

function CareerFrameworkTab({ initialDepartment = null }) {
  const [tracks, setTracks] = useState([]);
  const [levels, setLevels] = useState([]);
  const [allDepartments, setAllDepartments] = useState([]);
  const [selectedDept, setSelectedDept] = useState(initialDepartment || "");
  const [deptSearch, setDeptSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAddTrack, setShowAddTrack] = useState(false);
  const [showAddLevel, setShowAddLevel] = useState(null);
  const [editingLevel, setEditingLevel] = useState(null);
  const [newTrack, setNewTrack] = useState({ department: "", track_name: "", description: "" });
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (initialDepartment) setSelectedDept(initialDepartment);
  }, [initialDepartment]);

  const load = useCallback(async () => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    try {
      const [trackData, levelData, taxonomy] = await Promise.all([
        listCareerTracks(token),
        listCareerLevels(token),
        getOrgTaxonomy(token),
      ]);
      setTracks(trackData.tracks || []);
      setLevels(levelData.levels || []);
      const taxDepts = taxonomy.departments || [];
      const cfDepts = [...new Set([
        ...taxDepts,
        ...(trackData.tracks || []).map((t) => t.department),
        ...(levelData.levels || []).map((l) => l.department),
      ].filter(Boolean))].sort();
      setAllDepartments(cfDepts);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not load career framework."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreateTrack(e) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;
    try {
      await createCareerTrack(token, newTrack);
      toast.success("Career track created.");
      setNewTrack({ department: "", track_name: "", description: "" });
      setShowAddTrack(false);
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not create track."));
    }
  }

  async function handleDeleteLevel(levelId) {
    if (!window.confirm("Delete this career level? This cannot be undone.")) return;
    const token = localStorage.getItem("access_token");
    try {
      await deleteCareerLevel(token, levelId);
      toast.success("Career level deleted.");
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not delete level."));
    }
  }

  async function handleExport() {
    const token = localStorage.getItem("access_token");
    try {
      const blob = await exportCareerFramework(token);
      const url = window.URL.createObjectURL(new Blob([blob]));
      const a = document.createElement("a");
      a.href = url;
      a.download = "career_framework.csv";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success("Framework exported.");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not export framework."));
    }
  }

  async function handleImport() {
    if (!importFile) return;
    const token = localStorage.getItem("access_token");
    setImporting(true);
    try {
      const result = await importCareerFramework(token, importFile);
      toast.success(`Imported ${result.imported} levels. Skipped: ${result.skipped}`);
      if (result.errors?.length) toast.warn(`${result.errors.length} rows had errors.`);
      setImportFile(null);
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not import framework."));
    } finally {
      setImporting(false);
    }
  }

  const levelsByDept = {};
  for (const level of levels) {
    const dept = level.department;
    if (!levelsByDept[dept]) levelsByDept[dept] = [];
    levelsByDept[dept].push(level);
  }
  for (const track of tracks) {
    const dept = track.department;
    if (!levelsByDept[dept]) levelsByDept[dept] = [];
  }
  for (const dept of Object.keys(levelsByDept)) {
    levelsByDept[dept].sort((a, b) => a.level_number - b.level_number);
  }

  const filteredDepts = allDepartments.filter(
    (d) => !deptSearch.trim() || d.toLowerCase().includes(deptSearch.toLowerCase())
  );

  const visibleDepts = selectedDept
    ? Object.entries(levelsByDept).filter(([dept]) => dept === selectedDept)
    : Object.entries(levelsByDept);

  const totalLevels = Object.values(levelsByDept).reduce((s, a) => s + a.length, 0);

  return (
    <>
      <div className={shellStyles.section}>
        <div className={shellStyles.sectionHead}>
          <div className={shellStyles.sectionHeadLeft}>
            <span className={`${shellStyles.bar} ${shellStyles.cyan}`} />
            <div>
              <div className={shellStyles.sectionTitle}>Career Framework</div>
              <p className={shellStyles.sectionDesc}>
                Define career progression tracks by department — each level specifies required skills, certifications, and learning paths.
              </p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" className={styles.modeBtn} onClick={() => setShowAddTrack(true)}>
              <Plus aria-hidden="true" /> Add Track
            </button>
            <button type="button" className={styles.modeBtn} onClick={() => fileInputRef.current?.click()}>
              <Upload aria-hidden="true" /> Import CSV
            </button>
            <button type="button" className={styles.modeBtn} onClick={handleExport}>
              <Download aria-hidden="true" /> Export CSV
            </button>
            <button type="button" className={styles.modeBtn} onClick={() => window.open("/api/career-framework/template", "_blank")}>
              <FileText aria-hidden="true" /> Template
            </button>
            <input ref={fileInputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={(e) => setImportFile(e.target.files?.[0] || null)} />
          </div>
        </div>
      </div>

      {importFile && (
        <div className={shellStyles.section}>
          <div className={shellStyles.sectionBody} style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span className={styles.metaChip}><FileText aria-hidden="true" />{importFile.name}</span>
            <button type="button" className={styles.assignCourseBtn} onClick={handleImport} disabled={importing}>
              <Check aria-hidden="true" /> {importing ? "Importing…" : "Confirm Import"}
            </button>
            <button type="button" className={styles.smallBtn} onClick={() => setImportFile(null)}>
              <X aria-hidden="true" /> Cancel
            </button>
          </div>
        </div>
      )}

      {showAddTrack && (
        <div className={shellStyles.section}>
          <div className={shellStyles.sectionHead}>
            <div className={shellStyles.sectionHeadLeft}>
              <span className={`${shellStyles.bar} ${shellStyles.navy}`} />
              <div>
                <div className={shellStyles.sectionTitle}>Create Career Track</div>
              </div>
            </div>
          </div>
          <div className={shellStyles.sectionBody}>
            <form onSubmit={handleCreateTrack} className={styles.managedForm}>
              <label className={styles.fieldLabel}>
                Department
                <select value={newTrack.department} onChange={(e) => setNewTrack((f) => ({ ...f, department: e.target.value }))} required>
                  <option value="">Select department</option>
                  {allDepartments.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <label className={styles.fieldLabel}>
                Track Name
                <input value={newTrack.track_name} onChange={(e) => setNewTrack((f) => ({ ...f, track_name: e.target.value }))} placeholder="e.g. Software Engineering" required />
              </label>
              <label className={`${styles.fieldLabel} ${styles.wide}`}>
                Description
                <input value={newTrack.description} onChange={(e) => setNewTrack((f) => ({ ...f, description: e.target.value }))} placeholder="Optional description" />
              </label>
              <div className={styles.formActions}>
                <button type="submit" className={styles.assignCourseBtn}>
                  <Check aria-hidden="true" /> Create Track
                </button>
                <button type="button" className={styles.smallBtn} onClick={() => setShowAddTrack(false)}>
                  <X aria-hidden="true" /> Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? (
        <RecruiterLoader inline />
      ) : allDepartments.length === 0 ? (
        <div className={shellStyles.section}>
          <div className={shellStyles.sectionBody}>
            <div className={styles.emptyState}>
              <div className={styles.emptyStateIcon}><Briefcase aria-hidden="true" /></div>
              <div className={styles.emptyStateTitle}>No career framework yet</div>
              <p className={styles.emptyStateHint}>Use "Import CSV" to set up your career progression framework, or add tracks manually.</p>
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.deptLayout}>
          <div className={styles.deptSidebar}>
            <div className={styles.deptSidebarHead}>
              <div className={styles.deptSidebarTitle}>Departments</div>
              <div className={styles.deptSidebarHint}>
                {filteredDepts.length} department{filteredDepts.length !== 1 ? "s" : ""} · {totalLevels} total levels
              </div>
            </div>
            <div className={styles.deptSearch}>
              <div style={{ position: "relative" }}>
                <Search className={styles.deptSearchIcon} aria-hidden="true" />
                <input
                  className={styles.deptSearchInput}
                  aria-label="Search departments"
                  placeholder="Search departments…"
                  value={deptSearch}
                  onChange={(e) => setDeptSearch(e.target.value)}
                />
              </div>
            </div>
            <div className={styles.deptItemList}>
              <button
                type="button"
                className={`${styles.deptItem} ${!selectedDept ? styles.deptItemActive : ""}`}
                onClick={() => setSelectedDept("")}
              >
                <div className={styles.deptItemIcon} style={{ background: "var(--green-light)", color: "var(--green)" }}>
                  <ListChecks aria-hidden="true" />
                </div>
                <div className={styles.deptItemBody}>
                  <div className={styles.deptItemName}>All departments</div>
                  <div className={styles.deptItemMeta}>
                    {totalLevels} levels · {Object.keys(levelsByDept).length} depts
                  </div>
                </div>
              </button>
              {filteredDepts.map((d) => {
                const lvlCount = (levelsByDept[d] || []).length;
                return (
                  <button
                    key={d}
                    type="button"
                    className={`${styles.deptItem} ${selectedDept === d ? styles.deptItemActive : ""}`}
                    onClick={() => setSelectedDept(d)}
                  >
                    <div className={styles.deptItemIcon}>
                      {d.slice(0, 2).toUpperCase()}
                    </div>
                    <div className={styles.deptItemBody}>
                      <div className={styles.deptItemName}>{d}</div>
                      <div className={styles.deptItemMeta}>
                        <GraduationCap aria-hidden="true" /> {lvlCount} level{lvlCount !== 1 ? "s" : ""}
                      </div>
                    </div>
                    <span className={styles.deptItemBadge}>{lvlCount}</span>
                  </button>
                );
              })}
              {filteredDepts.length === 0 && (
                <div style={{ padding: "20px 14px", textAlign: "center", fontSize: 12, color: "var(--text-muted)" }}>
                  No departments match
                </div>
              )}
            </div>
          </div>

          <div style={{ padding: 0, overflowY: "auto" }}>
            {visibleDepts.length === 0 && (
              <div style={{ padding: 40 }}>
                <div className={styles.emptyState}>
                  <div className={styles.emptyStateIcon}><Milestone aria-hidden="true" /></div>
                  <div className={styles.emptyStateTitle}>
                    {selectedDept ? `No levels in ${selectedDept}` : "No career levels defined"}
                  </div>
                  <p className={styles.emptyStateHint}>
                    {selectedDept
                      ? "Add the first career level to start building this department's progression."
                      : "Import a CSV or add tracks manually to define career progressions."}
                  </p>
                </div>
              </div>
            )}
            {visibleDepts.map(([dept, deptLevels]) => (
              <div key={dept} style={{ padding: "24px 28px", borderBottom: "1px solid var(--border-soft)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 750, color: "var(--navy)", fontFamily: "'Sora', system-ui, sans-serif" }}>
                      {dept}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                      {deptLevels.length} career level{deptLevels.length !== 1 ? "s" : ""} · ranked by progression order
                    </div>
                  </div>
                  <button type="button" className={styles.modeBtn} onClick={() => setShowAddLevel({ department: dept })}>
                    <Plus aria-hidden="true" /> Add Level
                  </button>
                </div>
                {deptLevels.length > 0 && (
                  <div className={styles.cfLadder}>
                    {deptLevels.map((level, idx) => (
                      <div key={level.id} className={styles.cfLevelWrap}>
                        {idx > 0 && (
                          <div className={styles.cfArrow}>
                            <ChevronRight aria-hidden="true" />
                          </div>
                        )}
                        <div className={styles.cfLevelCard}>
                          <div className={styles.cfLevelHead}>
                            <span className={styles.cfLevelBadge}>
                              <Milestone aria-hidden="true" />Level {level.level_number}
                            </span>
                            <div className={styles.cfLevelActions}>
                              <button type="button" className={styles.cfLevelActionBtn} onClick={() => setEditingLevel(level)}>
                                <Pencil aria-hidden="true" /> Edit
                              </button>
                              <button type="button" className={`${styles.cfLevelActionBtn} ${styles.danger}`} onClick={() => handleDeleteLevel(level.id)}>
                                <Trash2 aria-hidden="true" /> Delete
                              </button>
                            </div>
                          </div>
                          <div className={styles.cfLevelTitle}>{level.role_title}</div>
                          {level.min_experience_years > 0 && (
                            <div className={styles.cfLevelFact}>
                              <Clock aria-hidden="true" />Min {level.min_experience_years} years experience
                            </div>
                          )}
                          {level.min_time_in_current_role_months > 0 && (
                            <div className={styles.cfLevelFact}>
                              <Calendar aria-hidden="true" />Min {level.min_time_in_current_role_months} months in role
                            </div>
                          )}
                          {level.required_skills?.length > 0 && (
                            <>
                              <div className={styles.cfSectionLabel}>Skills</div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {level.required_skills.map((s, i) => (
                                  <span key={i} className={styles.cfSkillChip}>{s.skill} ({s.proficiency})</span>
                                ))}
                              </div>
                            </>
                          )}
                          {level.required_certifications?.length > 0 && (
                            <>
                              <div className={styles.cfSectionLabel}>Certifications</div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {level.required_certifications.map((c, i) => (
                                  <span key={i} className={styles.cfCertChip}>{c.certification}</span>
                                ))}
                              </div>
                            </>
                          )}
                          {level.learning_path?.length > 0 && (
                            <>
                              <div className={styles.cfSectionLabel}>Learning Path ({level.learning_path.length} courses)</div>
                              {level.learning_path.slice(0, 3).map((c, i) => (
                                <div key={i} className={styles.cfCourseRow}>
                                  <span className={styles.cfCourseNum}>{c.order}.</span>
                                  {c.course_title}
                                </div>
                              ))}
                              {level.learning_path.length > 3 && (
                                <div className={styles.cfMore}>+{level.learning_path.length - 3} more</div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {(showAddLevel || editingLevel) && (
        <CFAddEditLevelForm
          initialData={showAddLevel ? { department: showAddLevel.department } : editingLevel}
          isEdit={Boolean(editingLevel)}
          allDepartments={allDepartments}
          onClose={() => { setShowAddLevel(null); setEditingLevel(null); }}
          onSaved={() => { setShowAddLevel(null); setEditingLevel(null); load(); }}
        />
      )}
    </>
  );
}

function CFAddEditLevelForm({ initialData, isEdit, allDepartments = [], onClose, onSaved }) {
  const [form, setForm] = useState({
    department: initialData?.department || "",
    track_name: initialData?.track_name || "",
    level_number: initialData?.level_number || 1,
    role_title: initialData?.role_title || "",
    description: initialData?.description || "",
    min_experience_years: initialData?.min_experience_years || 0,
    min_time_in_current_role_months: initialData?.min_time_in_current_role_months || 0,
    manager_approval_required: initialData?.manager_approval_required || false,
    required_skills: initialData?.required_skills || [],
    required_certifications: initialData?.required_certifications || [],
    learning_path: initialData?.learning_path || [],
  });
  const [saving, setSaving] = useState(false);

  const [newSkill, setNewSkill] = useState({ skill: "", proficiency: "Intermediate" });
  const [newCert, setNewCert] = useState("");
  const [newCourse, setNewCourse] = useState("");

  function addSkill() {
    if (!newSkill.skill.trim()) return;
    setForm((f) => ({ ...f, required_skills: [...f.required_skills, { ...newSkill, weight: 10 }] }));
    setNewSkill({ skill: "", proficiency: "Intermediate" });
  }

  function removeSkill(idx) {
    setForm((f) => ({ ...f, required_skills: f.required_skills.filter((_, i) => i !== idx) }));
  }

  function addCert() {
    if (!newCert.trim()) return;
    setForm((f) => ({ ...f, required_certifications: [...f.required_certifications, { certification: newCert.trim(), mandatory: true }] }));
    setNewCert("");
  }

  function removeCert(idx) {
    setForm((f) => ({ ...f, required_certifications: f.required_certifications.filter((_, i) => i !== idx) }));
  }

  function addCourse() {
    if (!newCourse.trim()) return;
    setForm((f) => ({
      ...f,
      learning_path: [...f.learning_path, {
        course_uid: `pending:${newCourse.trim().toLowerCase().replace(/\s+/g, "-")}`,
        course_title: newCourse.trim(),
        source: "microsoft_learn",
        mandatory: true,
        order: f.learning_path.length + 1,
      }],
    }));
    setNewCourse("");
  }

  function removeCourse(idx) {
    setForm((f) => ({
      ...f,
      learning_path: f.learning_path.filter((_, i) => i !== idx).map((c, i) => ({ ...c, order: i + 1 })),
    }));
  }

  async function handleSave(e) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    setSaving(true);
    try {
      if (isEdit) {
        await updateCareerLevel(token, initialData.id, {
          role_title: form.role_title,
          required_skills: form.required_skills,
          required_certifications: form.required_certifications,
          learning_path: form.learning_path,
          min_experience_years: form.min_experience_years,
          min_time_in_current_role_months: form.min_time_in_current_role_months,
          manager_approval_required: form.manager_approval_required,
          description: form.description,
        });
        toast.success("Career level updated.");
      } else {
        await createCareerLevel(token, form);
        toast.success("Career level created.");
      }
      onSaved();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not save career level."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={shellStyles.section}>
      <div className={shellStyles.sectionHead}>
        <div className={shellStyles.sectionHeadLeft}>
          <span className={`${shellStyles.bar} ${shellStyles.navy}`} />
          <div>
            <div className={shellStyles.sectionTitle}>{isEdit ? "Edit" : "Add"} Career Level</div>
          </div>
        </div>
      </div>
      <div className={shellStyles.sectionBody}>
        <form onSubmit={handleSave}>
          <div className={styles.formGrid3}>
            <label className={styles.fieldLabel}>
              Department
              <select value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} required disabled={isEdit}>
                <option value="">Select</option>
                {allDepartments.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label className={styles.fieldLabel}>
              Track Name
              <input value={form.track_name} onChange={(e) => setForm((f) => ({ ...f, track_name: e.target.value }))} placeholder="e.g. Software Engineering" required disabled={isEdit} />
            </label>
            <label className={styles.fieldLabel}>
              Level Number
              <input type="number" min="1" max="20" value={form.level_number} onChange={(e) => setForm((f) => ({ ...f, level_number: parseInt(e.target.value) || 1 }))} required disabled={isEdit} />
            </label>
          </div>
          <div className={styles.formGrid2}>
            <label className={styles.fieldLabel}>
              Role Title
              <input value={form.role_title} onChange={(e) => setForm((f) => ({ ...f, role_title: e.target.value }))} placeholder="e.g. Senior Consultant" required />
            </label>
            <label className={styles.fieldLabel}>
              Description
              <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Optional description" />
            </label>
          </div>
          <div className={styles.formGrid3}>
            <label className={styles.fieldLabel}>
              Min Experience (Years)
              <input type="number" min="0" max="50" step="0.5" value={form.min_experience_years} onChange={(e) => setForm((f) => ({ ...f, min_experience_years: parseFloat(e.target.value) || 0 }))} />
            </label>
            <label className={styles.fieldLabel}>
              Min Time in Role (Months)
              <input type="number" min="0" max="120" value={form.min_time_in_current_role_months} onChange={(e) => setForm((f) => ({ ...f, min_time_in_current_role_months: parseInt(e.target.value) || 0 }))} />
            </label>
            <label className={styles.cfCheckRow}>
              <input type="checkbox" checked={form.manager_approval_required} onChange={(e) => setForm((f) => ({ ...f, manager_approval_required: e.target.checked }))} />
              Manager approval required
            </label>
          </div>

          {/* Skills */}
          <div style={{ marginBottom: 18 }}>
            <div className={styles.fieldLabel}>Required Skills</div>
            <div className={styles.tagInputRow}>
              <input value={newSkill.skill} onChange={(e) => setNewSkill((f) => ({ ...f, skill: e.target.value }))} placeholder="Skill name" />
              <select value={newSkill.proficiency} onChange={(e) => setNewSkill((f) => ({ ...f, proficiency: e.target.value }))}>
                {["Beginner", "Intermediate", "Advanced", "Expert"].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <button type="button" onClick={addSkill} className={styles.modeBtn}><Plus aria-hidden="true" /> Add</button>
            </div>
            {form.required_skills.length > 0 && (
              <div className={styles.chipList}>
                {form.required_skills.map((s, i) => (
                  <div key={i} className={styles.chipListRow}>
                    <span>{s.skill}</span>
                    <span style={{ fontSize: 11, color: "var(--text-faint)", fontWeight: 600 }}>({s.proficiency})</span>
                    <button type="button" className={styles.removeBtn} onClick={() => removeSkill(i)}>Remove</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Certifications */}
          <div style={{ marginBottom: 18 }}>
            <div className={styles.fieldLabel}>Required Certifications</div>
            <div className={styles.tagInputRow}>
              <input value={newCert} onChange={(e) => setNewCert(e.target.value)} placeholder="Certification name" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCert())} />
              <button type="button" onClick={addCert} className={styles.modeBtn}><Plus aria-hidden="true" /> Add</button>
            </div>
            {form.required_certifications.length > 0 && (
              <div className={styles.chipList}>
                {form.required_certifications.map((c, i) => (
                  <div key={i} className={styles.chipListRow}>
                    <span>{c.certification}</span>
                    <button type="button" className={styles.removeBtn} onClick={() => removeCert(i)}>Remove</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Learning Path */}
          <div style={{ marginBottom: 18 }}>
            <div className={styles.fieldLabel}>Learning Path (Courses)</div>
            <div className={styles.tagInputRow}>
              <input value={newCourse} onChange={(e) => setNewCourse(e.target.value)} placeholder="Course title" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCourse())} />
              <button type="button" onClick={addCourse} className={styles.modeBtn}><Plus aria-hidden="true" /> Add</button>
            </div>
            {form.learning_path.length > 0 && (
              <div className={styles.chipList}>
                {form.learning_path.map((c, i) => (
                  <div key={i} className={styles.chipListRow}>
                    <span className={styles.courseOrderNum}>{c.order}.</span>
                    <span>{c.course_title}</span>
                    <button type="button" className={styles.removeBtn} onClick={() => removeCourse(i)}>Remove</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={styles.formActions}>
            <button type="submit" className={styles.assignCourseBtn} disabled={saving}>
              <Check aria-hidden="true" /> {saving ? "Saving…" : isEdit ? "Update Level" : "Create Level"}
            </button>
            <button type="button" className={styles.smallBtn} onClick={onClose}>
              <X aria-hidden="true" /> Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════ //
// Promotion Readiness Tab                                                       //
// ═══════════════════════════════════════════════════════════════════════════════ //

function PromotionReadinessTab() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [levels, setLevels] = useState([]);
  const [showAssign, setShowAssign] = useState(false);
  const [assignForm, setAssignForm] = useState({ employee_id: "", target_level_id: "", target_date: "" });
  const [assigning, setAssigning] = useState(false);
  const [empQuery, setEmpQuery] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    Promise.all([
      getPromotionReadiness(token),
      listCareerLevels(token),
    ])
      .then(([reportData, levelData]) => {
        setReport(reportData);
        setLevels(levelData.levels || []);
      })
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not load data.")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token || !showAssign) return;
    const timer = setTimeout(() => {
      listEmployees(token, { q: empQuery || undefined, status: "active", page: 1, page_size: 20 })
        .then((d) => setEmployees(d.employees || []))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [empQuery, showAssign]);

  async function handleAssign(e) {
    e.preventDefault();
    if (!assignForm.employee_id || !assignForm.target_level_id) {
      toast.error("Select an employee and target level.");
      return;
    }
    const token = localStorage.getItem("access_token");
    setAssigning(true);
    try {
      await assignEmployeeCareer(token, assignForm.employee_id, {
        target_level_id: assignForm.target_level_id,
        target_date: assignForm.target_date || undefined,
      });
      toast.success("Career path assigned.");
      setShowAssign(false);
      setAssignForm({ employee_id: "", target_level_id: "", target_date: "" });
      // Reload report
      const reportData = await getPromotionReadiness(token);
      setReport(reportData);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not assign career path."));
    } finally {
      setAssigning(false);
    }
  }

  return (
    <>
      {/* Assign Career Path Button */}
      <div className={shellStyles.section}>
        <div className={shellStyles.sectionHead}>
          <div className={shellStyles.sectionHeadLeft}>
            <span className={`${shellStyles.bar} ${shellStyles.cyan}`} />
            <div>
              <div className={shellStyles.sectionTitle}>Promotion Readiness</div>
              <p className={shellStyles.sectionDesc}>
                Track employee readiness for promotion. Assign career paths to help employees progress.
              </p>
            </div>
          </div>
          <button type="button" className={styles.modeBtn} onClick={() => setShowAssign(!showAssign)}>
            {showAssign ? <><X aria-hidden="true" /> Close</> : <><Plus aria-hidden="true" /> Assign Career Path</>}
          </button>
        </div>
      </div>

      {/* Assign Form */}
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
            <form className={styles.managedForm} onSubmit={handleAssign}>
              <label className={styles.fieldLabel}>
                Employee
                <input
                  placeholder="Search by name or ID…"
                  value={empQuery}
                  onChange={(e) => setEmpQuery(e.target.value)}
                />
                {employees.length > 0 && (
                  <select value={assignForm.employee_id} onChange={(e) => setAssignForm((f) => ({ ...f, employee_id: e.target.value }))}>
                    <option value="">Select employee</option>
                    {employees.map((emp) => (
                      <option key={emp.employee_id} value={emp.employee_id}>{emp.full_name} ({emp.employee_id}) — {emp.job_title || "—"}</option>
                    ))}
                  </select>
                )}
              </label>
              <label className={styles.fieldLabel}>
                Target Level
                <select value={assignForm.target_level_id} onChange={(e) => setAssignForm((f) => ({ ...f, target_level_id: e.target.value }))} required>
                  <option value="">Select target level</option>
                  {levels.map((l) => (
                    <option key={l.id} value={l.id}>Level {l.level_number}: {l.role_title} ({l.department})</option>
                  ))}
                </select>
              </label>
              <label className={`${styles.fieldLabel} ${styles.wide}`} style={{ maxWidth: 260 }}>
                Target Date
                <input type="date" value={assignForm.target_date} onChange={(e) => setAssignForm((f) => ({ ...f, target_date: e.target.value }))} />
              </label>
              <div className={styles.formActions}>
                <button type="submit" className={styles.assignCourseBtn} disabled={assigning}>
                  <Check aria-hidden="true" /> {assigning ? "Assigning…" : "Assign"}
                </button>
                <button type="button" className={styles.smallBtn} onClick={() => setShowAssign(false)}>
                  <X aria-hidden="true" /> Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading && <RecruiterLoader inline />}

      {/* Ready for Promotion */}
      {!loading && report?.ready?.length > 0 && (
        <div className={shellStyles.section}>
          <div className={shellStyles.sectionHead}>
            <div className={shellStyles.sectionHeadLeft}>
              <span className={`${shellStyles.bar} ${shellStyles.green}`} />
              <div>
                <div className={shellStyles.sectionTitle}>Ready for Promotion ({report.ready.length})</div>
                <p className={shellStyles.sectionDesc}>80%+ readiness score</p>
              </div>
            </div>
          </div>
          <div className={shellStyles.sectionBody}>
            {report.ready.map((item) => (
              <CFAssignmentRow key={item.employee_id} item={item} />
            ))}
          </div>
        </div>
      )}

      {/* Almost Ready */}
      {!loading && report?.almost_ready?.length > 0 && (
        <div className={shellStyles.section}>
          <div className={shellStyles.sectionHead}>
            <div className={shellStyles.sectionHeadLeft}>
              <span className={`${shellStyles.bar} ${shellStyles.orange}`} />
              <div>
                <div className={shellStyles.sectionTitle}>Almost Ready ({report.almost_ready.length})</div>
                <p className={shellStyles.sectionDesc}>50–79% readiness</p>
              </div>
            </div>
          </div>
          <div className={shellStyles.sectionBody}>
            {report.almost_ready.map((item) => (
              <CFAssignmentRow key={item.employee_id} item={item} />
            ))}
          </div>
        </div>
      )}

      {/* Behind Schedule */}
      {!loading && report?.behind?.length > 0 && (
        <div className={shellStyles.section}>
          <div className={shellStyles.sectionHead}>
            <div className={shellStyles.sectionHeadLeft}>
              <span className={`${shellStyles.bar} ${shellStyles.orange}`} />
              <div>
                <div className={shellStyles.sectionTitle}>Behind Schedule ({report.behind.length})</div>
                <p className={shellStyles.sectionDesc}>Below 50% readiness</p>
              </div>
            </div>
          </div>
          <div className={shellStyles.sectionBody}>
            {report.behind.map((item) => (
              <CFAssignmentRow key={item.employee_id} item={item} />
            ))}
          </div>
        </div>
      )}

      {!loading && report?.total_count === 0 && (
        <div className={shellStyles.section}>
          <div className={shellStyles.sectionBody}>
            <div className={styles.emptyState}>
              <div className={styles.emptyStateIcon}><TrendingUp aria-hidden="true" /></div>
              <div className={styles.emptyStateTitle}>No career paths assigned yet</div>
              <p className={styles.emptyStateHint}>Use "+ Assign Career Path" to start tracking employee readiness for promotion.</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function CFAssignmentRow({ item }) {
  const scoreColor =
    item.readiness_score >= 80
      ? "var(--green)"
      : item.readiness_score >= 50
      ? "var(--orange)"
      : "var(--red)";
  const circumference = 2 * Math.PI * 15.9155;
  return (
    <div className={styles.prRow}>
      <div className={styles.prRowMain}>
        <div className={styles.prRowName}>{item.employee_name}</div>
        <div className={styles.prRowMeta}>
          <span>{item.current_role}</span>
          <span className={styles.prArrow}><ChevronRight aria-hidden="true" /></span>
          <span>{item.target_role}</span>
          <span className={styles.metaChip}><Building2 aria-hidden="true" />{item.department}</span>
        </div>
      </div>
      <div className={styles.prRowSide}>
        {item.target_date && (
          <span className={styles.prTargetDate}>
            <Calendar aria-hidden="true" /> Target: {item.target_date}
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
              stroke={scoreColor}
              strokeDasharray={`${item.readiness_score * circumference / 100} ${circumference}`}
            />
          </svg>
          <div className={styles.prRingLabel} style={{ color: scoreColor }}>
            {item.readiness_score}%
          </div>
        </div>
        <div className={styles.prScore} style={{ color: scoreColor }}>
          <div className={styles.prScoreValue}>{item.readiness_score}%</div>
          <div className={styles.prScoreLabel}>Readiness</div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import RecruiterShell from "@/components/recruiter/RecruiterShell";
import shellStyles from "@/components/recruiter/recruiter-shell.module.css";
import styles from "./learning.module.css";
import { getApiErrorMessage, listEmployees } from "@/services/authService";
import { downloadCsv } from "@/utils/downloadCsv";
import {
  assignCourses,
  browseCatalog,
  createKbCertification,
  createKbRole,
  deleteKbCertification,
  deleteKbRole,
  getCatalogFacets,
  getLearningAnalytics,
  getOrgTaxonomy,
  listAssignments,
  listKbCertifications,
  listKbRoles,
  listPendingCertificates,
  verifyCertificate,
} from "@/services/learningService";

const TABS = [
  { key: "catalog", label: "Course Catalog" },
  { key: "knowledge", label: "Knowledge Base" },
  { key: "assign", label: "Assign Courses" },
  { key: "assignments", label: "Track Progress" },
  { key: "certificates", label: "Verify Certificates" },
  { key: "analytics", label: "Learning Analytics" },
];

const CATALOG_SOURCES = [
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
  {
    key: "recruiter_kb",
    label: "Recruiter Courses",
    hint: "Courses and certifications you added in the Knowledge Base for your organization.",
  },
];

function sourceLabel(source) {
  if (source === "coursera") return "Coursera";
  if (source === "recruiter_kb") return "Recruiter";
  return "Microsoft";
}

function sourceBadgeClass(source) {
  if (source === "coursera") return styles.sourceBadgeCoursera;
  if (source === "recruiter_kb") return styles.sourceBadgeRecruiter;
  return "";
}

export default function RecruiterLearningPage() {
  const [tab, setTab] = useState("catalog");

  return (
    <RecruiterShell
      activeKey="learning"
      title="Learning Management"
      subtitle="Browse courses, assign learning, verify certificates, and track completion"
    >
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

      {tab === "catalog" && <CatalogTab />}
      {tab === "knowledge" && <KnowledgeBaseTab />}
      {tab === "assign" && <AssignTab />}
      {tab === "assignments" && <AssignmentsTab />}
      {tab === "certificates" && <CertificatesTab />}
      {tab === "analytics" && <AnalyticsTab />}
    </RecruiterShell>
  );
}

function CatalogTab() {
  const [source, setSource] = useState("microsoft_learn");
  const [q, setQ] = useState("");
  const [facets, setFacets] = useState({ roles: [], levels: [], products: [] });
  const [role, setRole] = useState("");
  const [level, setLevel] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ courses: [], total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);

  function switchSource(nextSource) {
    if (nextSource === source) return;
    setSource(nextSource);
    setRole("");
    setLevel("");
    setType("");
    setQ("");
    setPage(1);
  }

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token || source === "recruiter_kb") return;
    getCatalogFacets(token, source).then(setFacets).catch(() => {});
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
  }, [q, role, level, type, page, source]);

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
              {result.total} courses found · pick a source below to browse
            </p>
          </div>
        </div>
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
              {s.label}
            </button>
          ))}
        </div>
        <p className={styles.sourceHint}>{activeSource.hint}</p>

        <div className={styles.filterBar}>
          <input
            className={styles.searchInput}
            placeholder={
              source === "coursera"
                ? "Search soft skills, e.g. negotiation, leadership…"
                : source === "recruiter_kb"
                  ? "Search company / recruiter courses…"
                  : "Search Microsoft courses by title or skill…"
            }
            value={q}
            onChange={(e) => { setPage(1); setQ(e.target.value); }}
          />
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
        {loading && <p className={styles.inlineNote}>Loading…</p>}
        {!loading && !(result.courses || []).length && (
          <p className={styles.inlineNote}>No courses found for this source. Try another pill or clear your search.</p>
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
                {c.type || "course"} · {c.duration_minutes || "—"} min · {(c.levels || [])[0] || c.category || "—"}
              </div>
              <p className={styles.courseSummary}>{(c.summary || "").slice(0, 140)}</p>
              {c.url && (
                <a href={c.url} target="_blank" rel="noopener noreferrer" className={styles.smallBtn}>
                  Open course
                </a>
              )}
            </div>
          ))}
        </div>
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
          <form className={styles.filterBar} onSubmit={handleCreateRole} style={{ flexWrap: "wrap" }}>
            <input className={styles.searchInput} placeholder="Role title (e.g. Software Architect)" value={roleForm.title} onChange={(e) => setRoleForm((f) => ({ ...f, title: e.target.value }))} required />
            <input className={styles.searchInput} placeholder="Required skills (comma-separated)" value={roleForm.required_skills} onChange={(e) => setRoleForm((f) => ({ ...f, required_skills: e.target.value }))} />
            <input className={styles.searchInput} placeholder="Required certs (comma-separated)" value={roleForm.required_certifications} onChange={(e) => setRoleForm((f) => ({ ...f, required_certifications: e.target.value }))} />
            <input className={styles.searchInput} placeholder="Description" value={roleForm.description} onChange={(e) => setRoleForm((f) => ({ ...f, description: e.target.value }))} />
            <button type="submit" className={styles.smallBtn} disabled={saving}>Add role</button>
          </form>
          {loading && <p className={styles.inlineNote}>Loading…</p>}
          <div className={styles.courseGrid}>
            {roles.map((r) => (
              <div key={r.id} className={styles.courseCard}>
                <div className={styles.courseTitle}>{r.title}</div>
                <div className={styles.courseMeta}>{(r.required_skills || []).length} skills · {(r.required_certifications || []).length} certs</div>
                <p className={styles.courseSummary}>{(r.description || "").slice(0, 160)}</p>
                <div className={styles.courseMeta}>Skills: {(r.required_skills || []).join(", ") || "—"}</div>
                <div className={styles.courseMeta}>Certs: {(r.required_certifications || []).join(", ") || "—"}</div>
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
                  Delete
                </button>
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
              <p className={shellStyles.sectionDesc}>Shown in employee catalog as Recruiter Courses</p>
            </div>
          </div>
        </div>
        <div className={shellStyles.sectionBody}>
          <form className={styles.filterBar} onSubmit={handleCreateCert} style={{ flexWrap: "wrap" }}>
            <input className={styles.searchInput} placeholder="Title (e.g. AZ-305)" value={certForm.title} onChange={(e) => setCertForm((f) => ({ ...f, title: e.target.value }))} required />
            <input className={styles.searchInput} placeholder="Provider" value={certForm.provider} onChange={(e) => setCertForm((f) => ({ ...f, provider: e.target.value }))} />
            <input className={styles.searchInput} placeholder="Official URL" value={certForm.official_url} onChange={(e) => setCertForm((f) => ({ ...f, official_url: e.target.value }))} />
            <input className={styles.searchInput} placeholder="Skills covered (comma-separated)" value={certForm.skills_covered} onChange={(e) => setCertForm((f) => ({ ...f, skills_covered: e.target.value }))} />
            <input className={styles.searchInput} placeholder="Estimated hours" type="number" min="0" value={certForm.estimated_hours} onChange={(e) => setCertForm((f) => ({ ...f, estimated_hours: e.target.value }))} />
            <select className={styles.filterSelect} value={certForm.difficulty} onChange={(e) => setCertForm((f) => ({ ...f, difficulty: e.target.value }))}>
              {["Beginner", "Intermediate", "Advanced", "Expert"].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select className={styles.filterSelect} value={certForm.priority} onChange={(e) => setCertForm((f) => ({ ...f, priority: e.target.value }))}>
              {["critical", "immediate", "medium", "low"].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <input className={styles.searchInput} placeholder="Description" value={certForm.description} onChange={(e) => setCertForm((f) => ({ ...f, description: e.target.value }))} />
            <button type="submit" className={styles.smallBtn} disabled={saving}>Add certification</button>
          </form>
          <div className={styles.courseGrid}>
            {certs.map((c) => (
              <div key={c.id} className={styles.courseCard}>
                <div className={styles.courseTitle}>{c.title}</div>
                <div className={styles.courseMeta}>{c.provider || "—"} · {c.difficulty} · {c.estimated_hours || "—"}h · {c.priority}</div>
                <p className={styles.courseSummary}>{(c.description || "").slice(0, 140)}</p>
                {c.official_url && <a href={c.official_url} target="_blank" rel="noopener noreferrer" className={styles.smallBtn}>Official link</a>}
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
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function AssignTab() {
  const [source, setSource] = useState("microsoft_learn");
  const [q, setQ] = useState("");
  const [courses, setCourses] = useState([]);
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [empQuery, setEmpQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [taxonomy, setTaxonomy] = useState({ departments: [], designations: [] });
  const [filterDept, setFilterDept] = useState("");
  const [filterTitle, setFilterTitle] = useState("");
  const [assignMode, setAssignMode] = useState("employees"); // employees | department | designation | skills
  const [dueDate, setDueDate] = useState("");
  const [mandatory, setMandatory] = useState(true);
  const [requiredSkills, setRequiredSkills] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    getOrgTaxonomy(token).then(setTaxonomy).catch(() => {});
  }, []);

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

  async function handleAssign() {
    if (!selectedCourse) { toast.error("Search for and select a course first."); return; }
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

  return (
    <div className={shellStyles.section}>
      <div className={shellStyles.sectionHead}>
        <div className={shellStyles.sectionHeadLeft}>
          <span className={`${shellStyles.bar} ${shellStyles.cyan}`} />
          <div>
            <div className={shellStyles.sectionTitle}>Assign a course</div>
            <p className={shellStyles.sectionDesc}>
              1) Pick a source pill · 2) Search &amp; select a course · 3) Choose who gets it (employees, department, joining role, or skills)
            </p>
          </div>
        </div>
      </div>
      <div className={shellStyles.sectionBody}>
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

        <div className={styles.pickerLayout}>
          <div>
            <div className={styles.sourceToggle} role="tablist" aria-label="Course source">
              {CATALOG_SOURCES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  aria-selected={source === s.key}
                  className={`${styles.sourceBtn} ${source === s.key ? styles.sourceBtnActive : ""}`}
                  onClick={() => { setSource(s.key); setQ(""); setCourses([]); setSelectedCourse(null); }}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <p className={styles.sourceHint}>
              {(CATALOG_SOURCES.find((s) => s.key === source) || CATALOG_SOURCES[0]).hint}
            </p>
            <input
              className={styles.searchInput}
              placeholder={
                source === "coursera"
                  ? "Search soft skills, e.g. negotiation, leadership…"
                  : source === "recruiter_kb"
                    ? "Search recruiter / company courses…"
                    : "Search Microsoft courses…"
              }
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {selectedCourse && (
              <div className={styles.selectedCourseCard}>
                <div className={styles.selectedCourseTitle}>Selected: {selectedCourse.title}</div>
                <div className={styles.selectedCourseMeta}>
                  {sourceLabel(selectedCourse.source || source)} · {selectedCourse.type} · {selectedCourse.duration_minutes || "—"} min
                </div>
              </div>
            )}
            <div className={styles.pickerList}>
              {courses.map((c) => (
                <div
                  key={c.uid}
                  className={`${styles.pickerRow} ${selectedCourse?.uid === c.uid ? styles.pickerSelected : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedCourse(c)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSelectedCourse(c); }}
                >
                  <div>
                    <div className={styles.pickerRowTitle}>{c.title}</div>
                    <div className={styles.pickerRowMeta}>
                      {sourceLabel(c.source || source)} · {c.type} · {c.duration_minutes || "—"} min · {(c.levels || [])[0] || c.category || "—"}
                    </div>
                  </div>
                </div>
              ))}
              {q.trim() && courses.length === 0 && <p className={styles.inlineNote}>No matches — try a different search term.</p>}
            </div>
          </div>

          <div>
            <div className={styles.filterBar}>
              <select className={styles.filterSelect} value={filterDept} onChange={(e) => setFilterDept(e.target.value)}>
                <option value="">All departments</option>
                {(taxonomy.departments || []).map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <select className={styles.filterSelect} value={filterTitle} onChange={(e) => setFilterTitle(e.target.value)}>
                <option value="">All designations</option>
                {(taxonomy.designations || []).map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>

            {assignMode === "employees" && (
              <>
                <input className={styles.searchInput} placeholder="Filter employees…" value={empQuery} onChange={(e) => setEmpQuery(e.target.value)} />
                <div className={styles.employeeList}>
                  {employees.map((emp) => (
                    <label key={emp.employee_id} className={styles.employeeCheckRow}>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(emp.employee_id)}
                        onChange={() => toggleEmployee(emp.employee_id)}
                      />
                      <div>
                        {emp.full_name}
                        <div className={styles.employeeMeta}>{emp.job_title || "—"} · {emp.department || "—"}</div>
                      </div>
                    </label>
                  ))}
                  {employees.length === 0 && <p className={styles.inlineNote}>No employees found for these filters.</p>}
                </div>
              </>
            )}

            {assignMode === "department" && (
              <p className={styles.inlineNote}>
                Will assign to all active employees in <b>{filterDept || "—"}</b>
                {filterTitle ? ` with designation ${filterTitle}` : ""} ({employees.length} currently matching).
              </p>
            )}
            {assignMode === "designation" && (
              <p className={styles.inlineNote}>
                Will assign to all active employees with designation <b>{filterTitle || "—"}</b>
                {filterDept ? ` in ${filterDept}` : ""} ({employees.length} currently matching).
              </p>
            )}
            {assignMode === "skills" && (
              <>
                <label className={styles.inlineNote} style={{ display: "block", marginBottom: 8 }}>
                  Required skills (comma-separated) — employees must have at least one
                  <input
                    className={styles.searchInput}
                    style={{ marginTop: 6 }}
                    value={requiredSkills}
                    onChange={(e) => setRequiredSkills(e.target.value)}
                    placeholder="e.g. Python, Azure, Communication"
                  />
                </label>
                <p className={styles.inlineNote}>
                  Optional department/designation filters still apply above.
                </p>
              </>
            )}

            <div className={styles.assignFormRow}>
              <label>
                Due date (auto if blank)
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </label>
              <label>
                Note (optional)
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Required for onboarding" />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18 }}>
                <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} />
                Mandatory
              </label>
            </div>
            <button type="button" className={shellStyles.primaryButton} disabled={submitting} onClick={handleAssign}>
              {submitting
                ? "Assigning…"
                : assignMode === "employees"
                ? `Assign to ${selectedIds.length || 0} employee(s)`
                : "Assign to matching employees"}
            </button>
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

  return (
    <div className={shellStyles.section}>
      <div className={shellStyles.sectionHead}>
        <div className={shellStyles.sectionHeadLeft}>
          <span className={`${shellStyles.bar} ${shellStyles.navy}`} />
          <div>
            <div className={shellStyles.sectionTitle}>Assigned courses</div>
            <p className={shellStyles.sectionDesc}>Track completion of courses you&apos;ve assigned</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <input type="checkbox" checked={mandatoryOnly} onChange={(e) => setMandatoryOnly(e.target.checked)} />
            Mandatory only
          </label>
          <select className={styles.filterSelect} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="assigned">Assigned</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
          </select>
          <button type="button" className={styles.modeBtn} onClick={() => load(true)}>Refresh</button>
        </div>
      </div>
      <div className={shellStyles.sectionBody}>
        {loading && <p className={styles.inlineNote}>Loading…</p>}
        {!loading && assignments.length === 0 && <p className={shellStyles.emptySub}>No assignments yet — assign a course from the Assign tab.</p>}
        {assignments.map((a) => (
          <div key={a.id} className={styles.listRow}>
            <div className={styles.listInfo}>
              <div className={styles.listTitle}>
                {a.course_title}
                {a.mandatory ? " · Mandatory" : ""}
              </div>
              <div className={styles.listMeta}>
                {a.employee_name} ({a.employee_id}) · {a.job_title || "—"} · {a.department || "—"}
                {a.due_date ? ` · Due ${a.due_date}` : ""}
              </div>
            </div>
            <span className={`${styles.statusChip} ${styles[a.status] || ""}`}>{a.status.replace("_", " ")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CertificatesTab() {
  const [certificates, setCertificates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rejecting, setRejecting] = useState(null);
  const [rejectNote, setRejectNote] = useState("");

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
        {loading && <p className={styles.inlineNote}>Loading…</p>}
        {!loading && certificates.length === 0 && <p className={shellStyles.emptySub}>Nothing pending review.</p>}
        {certificates.map((c) => (
          <div key={c.id} className={styles.listRow}>
            <div className={styles.listInfo}>
              <div className={styles.listTitle}>{c.course_title}</div>
              <div className={styles.listMeta}>
                {c.employee_name} ({c.employee_id})
                {c.completion_date ? ` · Completed ${c.completion_date}` : ""}
                {c.learning_hours ? ` · ${c.learning_hours} hrs` : ""}
              </div>
            </div>
            <a href={c.file_url} target="_blank" rel="noopener noreferrer" className={styles.smallBtn}>View file</a>
            {rejecting === c.id ? (
              <div className={styles.rejectRow}>
                <input className={styles.rejectInput} placeholder="Reason (optional)" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} />
                <button type="button" className={styles.rejectBtn} onClick={() => handleReject(c.id)}>Confirm reject</button>
                <button type="button" className={styles.smallBtn} onClick={() => setRejecting(null)}>Cancel</button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className={styles.approveBtn} onClick={() => handleApprove(c.id)}>Verify</button>
                <button type="button" className={styles.rejectBtn} onClick={() => setRejecting(c.id)}>Reject</button>
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
  const [taxonomy, setTaxonomy] = useState({ departments: [] });

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
    const token = localStorage.getItem("access_token");
    if (!token) return;
    getOrgTaxonomy(token).then(setTaxonomy).catch(() => {});
  }, []);

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

  if (loading) return <p className={styles.inlineNote}>Loading analytics…</p>;
  if (!data) return null;

  const stats = [
    { label: "Completion Rate", value: `${data.completion_rate}%`, color: "cyan" },
    { label: "Certification Rate", value: `${data.certification_rate}%`, color: "green" },
    { label: "Learning Hours", value: data.total_learning_hours, color: "orange" },
    { label: "Mandatory completion", value: `${data.mandatory_completion_rate ?? 0}%`, color: "navy" },
  ];

  const maxPopular = Math.max(1, ...(data.popular_courses || []).map((c) => c.enrollments));

  return (
    <>
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <select className={styles.filterSelect} value={department} onChange={(e) => setDepartment(e.target.value)}>
          <option value="">All departments</option>
          {(taxonomy.departments || []).map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <button type="button" className={styles.modeBtn} onClick={() => load(true)}>Refresh</button>
        <button type="button" className={styles.modeBtn} onClick={handleExport}>Export CSV</button>
      </div>

      <div className={styles.analyticsGrid}>
        {stats.map((s) => (
          <div key={s.label} className={shellStyles.statCard}>
            <div className={shellStyles.statTop}>
              <span className={`${shellStyles.statIcon} ${shellStyles[s.color]}`}>●</span>
            </div>
            <div className={shellStyles.statValue}>{s.value}</div>
            <div className={shellStyles.statLabel}>{s.label}</div>
          </div>
        ))}
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
                <div className={styles.listMeta}>{d.completed}/{d.assigned} completed</div>
              </div>
              <span className={styles.statusChip}>{d.completion_rate}%</span>
            </div>
          ))}
          {!(data.department_comparison || []).length && (
            <p className={styles.inlineNote}>No department data yet — assign courses to start tracking.</p>
          )}
        </div>
      </div>
    </>
  );
}

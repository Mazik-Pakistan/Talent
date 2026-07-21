"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import RecruiterShell from "@/components/recruiter/RecruiterShell";
import shellStyles from "@/components/recruiter/recruiter-shell.module.css";
import styles from "./learning.module.css";
import { getApiErrorMessage, listEmployees } from "@/services/authService";
import {
  assignCourses,
  browseCatalog,
  getCatalogFacets,
  getLearningAnalytics,
  getOrgTaxonomy,
  listAssignments,
  listPendingCertificates,
  verifyCertificate,
} from "@/services/learningService";

const TABS = [
  { key: "catalog", label: "Course Catalog" },
  { key: "assign", label: "Assign Courses" },
  { key: "assignments", label: "Assignments" },
  { key: "certificates", label: "Certificate Verification" },
  { key: "analytics", label: "Analytics" },
];

export default function RecruiterLearningPage() {
  const [tab, setTab] = useState("catalog");

  return (
    <RecruiterShell activeKey="learning" title="Learning Management" subtitle="Catalog, assign by employee / designation / department, verify certificates, track performance">
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
      {tab === "assign" && <AssignTab />}
      {tab === "assignments" && <AssignmentsTab />}
      {tab === "certificates" && <CertificatesTab />}
      {tab === "analytics" && <AnalyticsTab />}
    </RecruiterShell>
  );
}

function CatalogTab() {
  const [q, setQ] = useState("");
  const [facets, setFacets] = useState({ roles: [], levels: [], products: [] });
  const [role, setRole] = useState("");
  const [level, setLevel] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ courses: [], total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    getCatalogFacets(token).then(setFacets).catch(() => {});
  }, []);

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    browseCatalog(token, {
      q: q || undefined,
      role: role || undefined,
      level: level || undefined,
      type: type || undefined,
      page,
      page_size: 12,
    })
      .then(setResult)
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not load catalog.")))
      .finally(() => setLoading(false));
  }, [q, role, level, type, page]);

  useEffect(() => {
    const timer = setTimeout(load, 300);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <div className={shellStyles.section}>
      <div className={shellStyles.sectionHead}>
        <div className={shellStyles.sectionHeadLeft}>
          <span className={`${shellStyles.bar} ${shellStyles.cyan}`} />
          <div>
            <div className={shellStyles.sectionTitle}>Microsoft Learn catalog</div>
            <p className={shellStyles.sectionDesc}>{result.total} courses · same live catalog employees use</p>
          </div>
        </div>
      </div>
      <div className={shellStyles.sectionBody}>
        <div className={styles.filterBar}>
          <input className={styles.searchInput} placeholder="Search courses…" value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} />
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
        </div>
        {loading && <p className={styles.inlineNote}>Loading…</p>}
        <div className={styles.courseGrid}>
          {(result.courses || []).map((c) => (
            <div key={c.uid} className={styles.courseCard}>
              <div className={styles.courseTitle}>{c.title}</div>
              <div className={styles.courseMeta}>{c.type} · {c.duration_minutes || "—"} min · {(c.levels || [])[0] || "—"}</div>
              <p className={styles.courseSummary}>{(c.summary || "").slice(0, 140)}</p>
              <a href={c.url} target="_blank" rel="noopener noreferrer" className={styles.smallBtn}>Open on Microsoft Learn</a>
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

function AssignTab() {
  const [q, setQ] = useState("");
  const [courses, setCourses] = useState([]);
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [empQuery, setEmpQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [taxonomy, setTaxonomy] = useState({ departments: [], designations: [] });
  const [filterDept, setFilterDept] = useState("");
  const [filterTitle, setFilterTitle] = useState("");
  const [assignMode, setAssignMode] = useState("employees"); // employees | department | designation
  const [dueDate, setDueDate] = useState("");
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
      browseCatalog(token, { q, page_size: 10 }).then((data) => setCourses(data.courses || [])).catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

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
      note: note || undefined,
    };

    if (assignMode === "department") {
      if (!filterDept) { toast.error("Select a department to assign to."); return; }
      payload.department = filterDept;
    } else if (assignMode === "designation") {
      if (!filterTitle) { toast.error("Select a designation to assign to."); return; }
      payload.job_title = filterTitle;
    } else {
      if (selectedIds.length === 0) { toast.error("Select at least one employee."); return; }
      payload.employee_ids = selectedIds;
    }

    setSubmitting(true);
    try {
      const result = await assignCourses(token, payload);
      const assignedCount = result.assigned?.length || 0;
      const skippedCount = result.skipped?.length || 0;
      toast.success(`Assigned to ${assignedCount} employee(s).`);
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
            <div className={shellStyles.sectionTitle}>Assign a Microsoft Learn course</div>
            <p className={shellStyles.sectionDesc}>Assign to individuals, an entire department, or everyone with a designation. Duplicates are blocked.</p>
          </div>
        </div>
      </div>
      <div className={shellStyles.sectionBody}>
        <div className={styles.modeRow}>
          {[
            { key: "employees", label: "By employee" },
            { key: "department", label: "By department" },
            { key: "designation", label: "By designation" },
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
            <input className={styles.searchInput} placeholder="Search Microsoft Learn catalog…" value={q} onChange={(e) => setQ(e.target.value)} />
            {selectedCourse && (
              <div className={styles.selectedCourseCard}>
                <div className={styles.selectedCourseTitle}>Selected: {selectedCourse.title}</div>
                <div className={styles.selectedCourseMeta}>{selectedCourse.type} · {selectedCourse.duration_minutes} min</div>
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
                >
                  <div>
                    <div className={styles.pickerRowTitle}>{c.title}</div>
                    <div className={styles.pickerRowMeta}>{c.type} · {c.duration_minutes} min · {(c.levels || [])[0]}</div>
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

            <div className={styles.assignFormRow}>
              <label>
                Due date (optional)
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </label>
              <label>
                Note (optional)
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Required for onboarding" />
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
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    listAssignments(token, { status: statusFilter || undefined })
      .then((data) => setAssignments(data.assignments || []))
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not load assignments.")))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

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
        <select className={styles.filterSelect} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="assigned">Assigned</option>
          <option value="in_progress">In progress</option>
          <option value="completed">Completed</option>
        </select>
      </div>
      <div className={shellStyles.sectionBody}>
        {loading && <p className={styles.inlineNote}>Loading…</p>}
        {!loading && assignments.length === 0 && <p className={shellStyles.emptySub}>No assignments yet — assign a course from the Assign tab.</p>}
        {assignments.map((a) => (
          <div key={a.id} className={styles.listRow}>
            <div className={styles.listInfo}>
              <div className={styles.listTitle}>{a.course_title}</div>
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

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    getLearningAnalytics(token)
      .then(setData)
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not load learning analytics.")))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className={styles.inlineNote}>Loading analytics…</p>;
  if (!data) return null;

  const stats = [
    { label: "Completion Rate", value: `${data.completion_rate}%`, color: "cyan" },
    { label: "Certification Rate", value: `${data.certification_rate}%`, color: "green" },
    { label: "Learning Hours", value: data.total_learning_hours, color: "orange" },
    { label: "Pending Reviews", value: data.pending_certificates, color: "navy" },
  ];

  const maxPopular = Math.max(1, ...(data.popular_courses || []).map((c) => c.enrollments));

  return (
    <>
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

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
  getLearningAnalytics,
  listAssignments,
  listPendingCertificates,
  verifyCertificate,
} from "@/services/learningService";

const TABS = [
  { key: "assign", label: "Assign Courses" },
  { key: "assignments", label: "Assignments" },
  { key: "certificates", label: "Certificate Verification" },
  { key: "analytics", label: "Analytics" },
];

export default function RecruiterLearningPage() {
  const [tab, setTab] = useState("assign");

  return (
    <RecruiterShell activeKey="learning" title="Learning Management" subtitle="Assign Microsoft Learn courses, verify certificates, and track development">
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

      {tab === "assign" && <AssignTab />}
      {tab === "assignments" && <AssignmentsTab />}
      {tab === "certificates" && <CertificatesTab />}
      {tab === "analytics" && <AnalyticsTab />}
    </RecruiterShell>
  );
}

// ------------------------------------------------------------------------ //
// Assign courses (US-068)
// ------------------------------------------------------------------------ //
function AssignTab() {
  const [q, setQ] = useState("");
  const [courses, setCourses] = useState([]);
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [empQuery, setEmpQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
      listEmployees(token, { q: empQuery || undefined, status: "active", page: 1, page_size: 20, sort: "full_name" })
        .then((data) => setEmployees(data.employees || []))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [empQuery]);

  function toggleEmployee(id) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }

  async function handleAssign() {
    if (!selectedCourse) { toast.error("Search for and select a course first."); return; }
    if (selectedIds.length === 0) { toast.error("Select at least one employee."); return; }
    const token = localStorage.getItem("access_token");
    setSubmitting(true);
    try {
      const result = await assignCourses(token, {
        employee_ids: selectedIds,
        course_uid: selectedCourse.uid,
        course_title: selectedCourse.title,
        course_url: selectedCourse.url,
        course_type: selectedCourse.type,
        duration_minutes: selectedCourse.duration_minutes,
        due_date: dueDate || undefined,
        note: note || undefined,
      });
      toast.success(`Assigned to ${result.assigned.length} employee(s).`);
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
            <p className={shellStyles.sectionDesc}>Search the live catalog, pick employees, and set a due date</p>
          </div>
        </div>
      </div>
      <div className={shellStyles.sectionBody}>
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
                  <button type="button" className={styles.smallBtn} onClick={(e) => { e.stopPropagation(); setSelectedCourse(c); }}>
                    Select
                  </button>
                </div>
              ))}
              {q.trim() && courses.length === 0 && <p className={styles.inlineNote}>No matches — try a different search term.</p>}
            </div>
          </div>

          <div>
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
              {employees.length === 0 && <p className={styles.inlineNote}>No employees found.</p>}
            </div>

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
              {submitting ? "Assigning…" : `Assign to ${selectedIds.length || 0} employee(s)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------ //
// Assignments oversight
// ------------------------------------------------------------------------ //
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
                {a.employee_name} ({a.employee_id}) · {a.department || "—"}
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

// ------------------------------------------------------------------------ //
// Certificate verification
// ------------------------------------------------------------------------ //
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
      toast.success("Certificate verified — skill matrix updated.");
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
            <p className={shellStyles.sectionDesc}>Approve to update the employee&apos;s skill matrix, or reject with a note</p>
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

// ------------------------------------------------------------------------ //
// Analytics (US-076)
// ------------------------------------------------------------------------ //
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

  const maxPopular = Math.max(1, ...data.popular_courses.map((c) => c.enrollments));

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
          {data.popular_courses.length === 0 && <p className={shellStyles.emptySub}>No enrollments yet.</p>}
          {data.popular_courses.map((c) => (
            <div key={c.title} className={styles.barRow}>
              <span className={styles.barLabel} title={c.title}>{c.title}</span>
              <div className={styles.barTrack}><div className={styles.barFill} style={{ width: `${(c.enrollments / maxPopular) * 100}%` }} /></div>
              <span className={styles.barValue}>{c.enrollments}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={shellStyles.section}>
        <div className={shellStyles.sectionHead}>
          <div className={shellStyles.sectionHeadLeft}>
            <span className={`${shellStyles.bar} ${shellStyles.green}`} />
            <div>
              <div className={shellStyles.sectionTitle}>Department comparison</div>
              <p className={shellStyles.sectionDesc}>Assignment completion rate by department</p>
            </div>
          </div>
        </div>
        <div className={shellStyles.sectionBody}>
          {data.department_comparison.length === 0 && <p className={shellStyles.emptySub}>No department data yet.</p>}
          {data.department_comparison.map((d) => (
            <div key={d.department} className={styles.barRow}>
              <span className={styles.barLabel} title={d.department}>{d.department}</span>
              <div className={styles.barTrack}><div className={styles.barFill} style={{ width: `${d.completion_rate}%` }} /></div>
              <span className={styles.barValue}>{d.completion_rate}%</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

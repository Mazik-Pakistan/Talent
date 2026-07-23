"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import {
  assignEmployeeRole,
  getApiErrorMessage,
} from "@/services/authService";
import {
  assignCourses,
  browseCatalog,
  getEmployeeLearningProfile,
  getOrgTaxonomy,
} from "@/services/learningService";
import styles from "@/components/recruiter/recruiter-shell.module.css";

const PROF = { Beginner: 25, Intermediate: 50, Advanced: 75, Expert: 100 };

export default function EmployeeLearningPanel({ employee, onEmployeeUpdate }) {
  const employeeId = employee?.employee_id;
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [taxonomy, setTaxonomy] = useState({ departments: [], designations: [] });
  const [roleForm, setRoleForm] = useState({
    job_title: employee?.job_title || "",
    department: employee?.department || "",
    event_type: "title_change",
    note: "",
  });
  const [savingRole, setSavingRole] = useState(false);
  const [assignQ, setAssignQ] = useState("");
  const [assignCoursesList, setAssignCoursesList] = useState([]);
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [assigning, setAssigning] = useState(false);

  const load = useCallback(
    (refresh = false) => {
      const token = localStorage.getItem("access_token");
      if (!token || !employeeId) return;
      setLoading(true);
      getEmployeeLearningProfile(token, employeeId, refresh)
        .then(setProfile)
        .catch((err) => toast.error(getApiErrorMessage(err, "Could not load learning profile.")))
        .finally(() => setLoading(false));
    },
    [employeeId]
  );

  useEffect(() => {
    load(false);
    const token = localStorage.getItem("access_token");
    if (!token) return;
    getOrgTaxonomy(token).then(setTaxonomy).catch(() => {});
  }, [load]);

  useEffect(() => {
    setRoleForm((f) => ({
      ...f,
      job_title: employee?.job_title || "",
      department: employee?.department || "",
    }));
  }, [employee?.job_title, employee?.department]);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token || !assignQ.trim()) {
      setAssignCoursesList([]);
      return;
    }
    const timer = setTimeout(() => {
      browseCatalog(token, { q: assignQ, page_size: 8 })
        .then((data) => setAssignCoursesList(data.courses || []))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [assignQ]);

  async function handleRefreshAi() {
    setRefreshing(true);
    try {
      await load(true);
      toast.success("AI assessment refreshed.");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleSaveRole(e) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    setSavingRole(true);
    try {
      const data = await assignEmployeeRole(
        employeeId,
        {
          job_title: roleForm.job_title,
          department: roleForm.department,
          event_type: roleForm.event_type,
          note: roleForm.note || undefined,
        },
        token
      );
      onEmployeeUpdate?.(data.employee);
      toast.success("Designation / department updated.");
      load(true);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not update role."));
    } finally {
      setSavingRole(false);
    }
  }

  async function handleAssignCourse() {
    if (!selectedCourse) {
      toast.error("Select a course first.");
      return;
    }
    await assignOne(selectedCourse);
  }

  async function assignOne(course) {
    const token = localStorage.getItem("access_token");
    setAssigning(true);
    try {
      const result = await assignCourses(token, {
        employee_ids: [employeeId],
        course_uid: course.uid,
        course_title: course.title,
        course_url: course.url,
        course_type: course.type,
        duration_minutes: course.duration_minutes,
        mandatory: true,
      });
      if (result.skipped?.length) toast.warn("Already assigned to this employee.");
      else toast.success("Course assigned.");
      setSelectedCourse(null);
      setAssignQ("");
      load(false);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not assign course."));
    } finally {
      setAssigning(false);
    }
  }

  if (loading && !profile) {
    return <p className={styles.emptySub}>Loading learning profile…</p>;
  }

  const summary = profile?.summary || {};
  const assessment = profile?.skill_assessment;
  const promotion = profile?.promotion;
  const skills = profile?.skills || [];
  const recommendations = profile?.recommendations || [];
  const gaps = profile?.skill_gaps || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Role assignment */}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <div className={`${styles.bar} ${styles.orange}`} />
            <div>
              <div className={styles.sectionTitle}>Designation &amp; department</div>
              <div className={styles.sectionDesc}>Select from org lists — used by AI skill matrix and course recommendations</div>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          <form onSubmit={handleSaveRole}>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span>Designation</span>
                <select
                  value={roleForm.job_title}
                  onChange={(e) => setRoleForm((f) => ({ ...f, job_title: e.target.value }))}
                  required
                >
                  <option value="">Select designation</option>
                  {(taxonomy.designations || []).map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>Department</span>
                <select
                  value={roleForm.department}
                  onChange={(e) => setRoleForm((f) => ({ ...f, department: e.target.value }))}
                  required
                >
                  <option value="">Select department</option>
                  {(taxonomy.departments || []).map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>Change type</span>
                <select
                  value={roleForm.event_type}
                  onChange={(e) => setRoleForm((f) => ({ ...f, event_type: e.target.value }))}
                >
                  <option value="title_change">Title change</option>
                  <option value="department_change">Department change</option>
                  <option value="promoted">Promotion</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>Note (optional)</span>
                <input
                  value={roleForm.note}
                  onChange={(e) => setRoleForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder="AI recommended after closing skill gaps"
                />
              </label>
            </div>
            <button type="submit" className={styles.primaryButton} disabled={savingRole} style={{ marginTop: 12 }}>
              {savingRole ? "Saving…" : "Save role"}
            </button>
          </form>
        </div>
      </div>

      {/* Summary + AI refresh */}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <div className={`${styles.bar} ${styles.cyan}`} />
            <div>
              <div className={styles.sectionTitle}>Learning overview</div>
              <div className={styles.sectionDesc}>Progress, AI skill assessment, and promotion readiness</div>
            </div>
          </div>
          <button type="button" className={styles.secondaryButton} disabled={refreshing} onClick={handleRefreshAi}>
            {refreshing ? "Refreshing…" : "Refresh AI"}
          </button>
        </div>
        <div className={styles.sectionBody}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12, marginBottom: 16 }}>
            {[
              ["Assigned", summary.assigned_count ?? 0],
              ["Completed", summary.completed_count ?? 0],
              ["Certificates", summary.certificates_earned ?? 0],
              ["Hours", summary.total_learning_hours ?? 0],
              ["Progress", `${summary.overall_progress_percent ?? 0}%`],
            ].map(([label, value]) => (
              <div key={label} className={styles.statCard}>
                <div className={styles.statValue}>{value}</div>
                <div className={styles.statLabel}>{label}</div>
              </div>
            ))}
          </div>

          {assessment && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, marginBottom: 14, background: "var(--bg)" }}>
              <strong>Role fit: {assessment.role_fit_percentage ?? "—"}%</strong>
              <p className={styles.sectionDesc} style={{ marginTop: 6 }}>{assessment.summary}</p>
              {gaps.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                  {gaps.map((g) => (
                    <span
                      key={g.skill}
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: "3px 10px",
                        borderRadius: 20,
                        background: g.priority === "critical" ? "#fee9e7" : g.priority === "immediate" ? "var(--orange-light)" : "#e8f4ff",
                        color: g.priority === "critical" ? "#b42318" : "var(--navy)",
                      }}
                      title={g.reason || ""}
                    >
                      {(g.priority || "medium").toUpperCase()}: {g.skill}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {promotion && (
            <div style={{ border: "1px solid var(--border)", borderLeft: "4px solid var(--green)", borderRadius: 12, padding: 14, background: "var(--card)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <strong>Promotion readiness: {promotion.readiness_score ?? "—"}%</strong>
                <span style={{ fontSize: 12, fontWeight: 700, color: promotion.promotion_ready ? "var(--green)" : "var(--orange)" }}>
                  {promotion.promotion_ready ? "Ready" : promotion.timeline || "Not yet"}
                </span>
              </div>
              <p className={styles.sectionDesc} style={{ marginTop: 6 }}>{promotion.summary}</p>
              {promotion.recommended_next_title && (
                <p className={styles.sectionDesc}>Suggested next: <b>{promotion.recommended_next_title}</b></p>
              )}
              {(promotion.reasons || []).length > 0 && (
                <ul className={styles.miniList} style={{ marginTop: 8 }}>
                  {promotion.reasons.map((r) => (
                    <li key={r} className={styles.miniListItem}>{r}</li>
                  ))}
                </ul>
              )}
              {(promotion.recommended_actions || []).length > 0 && (
                <>
                  <div className={styles.sectionDesc} style={{ marginTop: 8, fontWeight: 700 }}>Recommended actions</div>
                  <ul className={styles.miniList}>
                    {promotion.recommended_actions.map((r) => (
                      <li key={r} className={styles.miniListItem}>{r}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Skill matrix bars */}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <div className={`${styles.bar} ${styles.green}`} />
            <div>
              <div className={styles.sectionTitle}>Skill matrix</div>
              <div className={styles.sectionDesc}>From resume OCR + Gemini, updated by verified certificates</div>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          {skills.length === 0 && <p className={styles.emptySub}>No skills yet — run Refresh AI after a resume is on file.</p>}
          {skills.slice(0, 14).map((s) => (
            <div key={s.id} style={{ display: "grid", gridTemplateColumns: "140px 1fr 90px", gap: 10, alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--navy)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.skill_name}</span>
              <div style={{ height: 8, borderRadius: 99, background: "#E8EEF5", overflow: "hidden" }}>
                <div style={{ width: `${PROF[s.proficiency] || 25}%`, height: "100%", background: "linear-gradient(90deg, #00A9CE, #0F2A4A)" }} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textAlign: "right" }}>{s.proficiency}</span>
            </div>
          ))}
        </div>
      </div>

      {/* AI recommendations + assign */}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <div className={`${styles.bar} ${styles.navy}`} />
            <div>
              <div className={styles.sectionTitle}>AI recommended courses</div>
              <div className={styles.sectionDesc}>Critical / immediate gaps first — assign from here</div>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          {recommendations.length === 0 && <p className={styles.emptySub}>No recommendations yet.</p>}
          {recommendations.map((c) => (
            <div key={c.uid} className={styles.miniListItem} style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
              <div>
                <strong>{c.title}</strong>
                <div className={styles.sectionDesc}>
                  {(c.priority || "medium").toUpperCase()} · {c.reason}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <a href={c.url} target="_blank" rel="noopener noreferrer" className={styles.secondaryButton}>Open</a>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => assignOne(c)}
                >
                  Assign
                </button>
              </div>
            </div>
          ))}

          <div style={{ marginTop: 18, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
            <div className={styles.sectionDesc} style={{ marginBottom: 8, fontWeight: 700 }}>Assign any course</div>
            <input
              className={styles.field}
              style={{ width: "100%", marginBottom: 8, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 10 }}
              placeholder="Search Microsoft Learn…"
              value={assignQ}
              onChange={(e) => setAssignQ(e.target.value)}
            />
            {selectedCourse && (
              <p className={styles.sectionDesc}>Selected: <b>{selectedCourse.title}</b></p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflow: "auto", marginBottom: 10 }}>
              {assignCoursesList.map((c) => (
                <button
                  key={c.uid}
                  type="button"
                  className={styles.secondaryButton}
                  style={{ textAlign: "left" }}
                  onClick={() => setSelectedCourse(c)}
                >
                  {c.title}
                </button>
              ))}
            </div>
            <button type="button" className={styles.primaryButton} disabled={assigning || !selectedCourse} onClick={handleAssignCourse}>
              {assigning ? "Assigning…" : "Assign selected course"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

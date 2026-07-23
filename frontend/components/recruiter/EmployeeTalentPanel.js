"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import { getApiErrorMessage } from "@/services/authService";
import {
  getTalentProfile,
  submitCompetencyEvaluation,
  updateDevelopmentPlan,
} from "@/services/talentService";
import { downloadCsv } from "@/utils/downloadCsv";
import styles from "@/components/recruiter/recruiter-shell.module.css";

const COMPETENCY_DIMENSIONS = [
  { key: "technical", label: "Technical" },
  { key: "leadership", label: "Leadership" },
  { key: "communication", label: "Communication" },
  { key: "collaboration", label: "Collaboration" },
  { key: "problem_solving", label: "Problem Solving" },
  { key: "innovation", label: "Innovation" },
];

export default function EmployeeTalentPanel({ employee }) {
  const employeeId = employee?.employee_id;
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [evalScores, setEvalScores] = useState(
    Object.fromEntries(COMPETENCY_DIMENSIONS.map((d) => [d.key, 3]))
  );
  const [evalComments, setEvalComments] = useState("");
  const [submittingEval, setSubmittingEval] = useState(false);
  const [planTimeline, setPlanTimeline] = useState("");
  const [planNote, setPlanNote] = useState("");
  const [milestoneEdits, setMilestoneEdits] = useState({});
  const [savingPlan, setSavingPlan] = useState(false);

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token || !employeeId) return;
    setLoading(true);
    getTalentProfile(token, employeeId)
      .then((data) => {
        setProfile(data);
        setPlanTimeline(data.development_plan?.target_timeline || "");
        setPlanNote(data.development_plan?.recruiter_note || "");
        setMilestoneEdits({});
      })
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not load talent profile.")))
      .finally(() => setLoading(false));
  }, [employeeId]);

  useEffect(() => { load(); }, [load]);

  async function handleSubmitEvaluation(e) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    setSubmittingEval(true);
    try {
      await submitCompetencyEvaluation(token, employeeId, { ...evalScores, comments: evalComments || null });
      setEvalComments("");
      toast.success("Competency evaluation submitted.");
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not submit evaluation."));
    } finally {
      setSubmittingEval(false);
    }
  }

  function updateMilestone(id, patch) {
    setMilestoneEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function handleSavePlan() {
    const token = localStorage.getItem("access_token");
    const milestones = (profile?.development_plan?.milestones || []).map((m) => ({
      id: m.id,
      status: milestoneEdits[m.id]?.status ?? m.status,
      due_date: milestoneEdits[m.id]?.due_date ?? (m.due_date ? m.due_date.slice(0, 10) : null),
      note: milestoneEdits[m.id]?.note ?? m.note,
    }));
    setSavingPlan(true);
    try {
      await updateDevelopmentPlan(token, employeeId, {
        target_timeline: planTimeline || null,
        recruiter_note: planNote || null,
        milestones,
      });
      toast.success("Development plan updated.");
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not save development plan."));
    } finally {
      setSavingPlan(false);
    }
  }

  function exportCompetencyReport() {
    const evaluations = profile?.competency_evaluations?.evaluations || [];
    if (!evaluations.length) {
      toast.warn("No competency evaluations to export.");
      return;
    }
    downloadCsv(
      `competency-${employeeId}.csv`,
      ["evaluated_at", "overall_score", ...COMPETENCY_DIMENSIONS.map((d) => d.key), "comments"],
      evaluations.map((ev) => ({
        evaluated_at: ev.evaluated_at,
        overall_score: ev.overall_score,
        ...Object.fromEntries(COMPETENCY_DIMENSIONS.map((d) => [d.key, ev.scores?.[d.key] ?? ""])),
        comments: ev.comments || "",
      }))
    );
    toast.success("Competency report exported.");
  }

  function exportProfileCsv() {
    if (!profile) return;
    const p = profile.personal_profile || {};
    const learning = profile.learning_history || {};
    downloadCsv(
      `talent-profile-${employeeId}.csv`,
      ["field", "value"],
      [
        { field: "employee_id", value: p.employee_id },
        { field: "full_name", value: p.full_name },
        { field: "email", value: p.email },
        { field: "job_title", value: p.job_title },
        { field: "department", value: p.department },
        { field: "target_role", value: profile.goals?.target_role || "" },
        { field: "certificates_earned", value: learning.certificates_earned },
        { field: "assignments_completed", value: learning.assignments_completed },
        { field: "assignments_total", value: learning.assignments_total },
        { field: "mandatory_outstanding", value: learning.mandatory_outstanding },
        { field: "career_path_readiness", value: profile.ai_insights?.career_path_readiness ?? "" },
        { field: "latest_competency", value: profile.competency_evaluations?.latest?.overall_score ?? "" },
      ]
    );
    toast.success("360 profile summary exported.");
  }

  function printProfile() {
    window.print();
  }

  if (loading) return <p className={styles.emptySub}>Loading talent profile…</p>;
  if (!profile) return <p className={styles.emptySub}>No talent profile available.</p>;

  const ladder = profile.career_progression?.ladder || [];
  const evaluations = profile.competency_evaluations?.evaluations || [];
  const plan = profile.development_plan;
  const personal = profile.personal_profile || {};
  const learning = profile.learning_history || {};
  const skillCategories = profile.skills?.categories || [];
  const skillList = skillCategories.flatMap((c) => c.skills || []);
  const certs = profile.certifications || [];
  const timelineEvents = profile.career_timeline?.timeline || [];
  const achievementList = profile.achievements?.achievements || [];
  const recommendations = profile.ai_insights?.recommendations || [];
  const nextStep = profile.promotion_readiness;

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <button type="button" className={styles.secondaryButton} onClick={load}>Refresh</button>
        <button type="button" className={styles.secondaryButton} onClick={exportProfileCsv}>Export profile CSV</button>
        <button type="button" className={styles.secondaryButton} onClick={exportCompetencyReport}>Export competency report</button>
        <button type="button" className={styles.secondaryButton} onClick={printProfile}>Print / Save PDF</button>
      </div>

      {/* Personal + summary */}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <span className={`${styles.bar} ${styles.navy}`} />
            <div>
              <div className={styles.sectionTitle}>360° talent profile</div>
              <p className={styles.sectionDesc}>Unified view of personal, skills, learning, competency, and career data</p>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          <div className={styles.miniListItem}>
            <strong>{personal.full_name}</strong>
            <div className={styles.sectionDesc}>
              {personal.job_title || "—"} · {personal.department || "—"} · {personal.email || "—"}
              {personal.start_date ? ` · Started ${String(personal.start_date).slice(0, 10)}` : ""}
            </div>
          </div>
          <div className={styles.sectionDesc} style={{ marginTop: 8 }}>
            Target role: <b>{profile.goals?.target_role || "Not set"}</b>
            {profile.ai_insights?.career_path_readiness != null
              ? ` · Path readiness ${profile.ai_insights.career_path_readiness}%`
              : ""}
            {nextStep?.title
              ? ` · Next step: ${nextStep.title}`
              : ""}
          </div>
          {profile.performance_ratings?.note && (
            <p className={styles.emptySub} style={{ marginTop: 8 }}>{profile.performance_ratings.note}</p>
          )}
        </div>
      </div>

      {/* Skills */}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <span className={`${styles.bar} ${styles.cyan}`} />
            <div>
              <div className={styles.sectionTitle}>Skills</div>
              <p className={styles.sectionDesc}>{skillList.length} tracked skills</p>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          {skillList.length === 0 && <p className={styles.emptySub}>No skills recorded yet.</p>}
          {skillList.slice(0, 16).map((s) => (
            <div key={s.skill_name || s.name || s.id} className={styles.miniListItem} style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{s.skill_name || s.name}</span>
              <span>{s.proficiency || s.category || ""}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Learning history */}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <span className={`${styles.bar} ${styles.green}`} />
            <div>
              <div className={styles.sectionTitle}>Learning history</div>
              <p className={styles.sectionDesc}>
                {learning.assignments_completed || 0}/{learning.assignments_total || 0} assignments completed
                {learning.mandatory_outstanding ? ` · ${learning.mandatory_outstanding} mandatory outstanding` : ""}
                {` · ${learning.certificates_earned || 0} certificates`}
              </p>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          {(learning.recent_assignments || []).length === 0 && <p className={styles.emptySub}>No assignments yet.</p>}
          {(learning.recent_assignments || []).map((a, idx) => (
            <div key={`${a.course_title}-${idx}`} className={styles.miniListItem} style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{a.course_title}{a.mandatory ? " · Mandatory" : ""}</span>
              <span>{a.status}{a.due_date ? ` · due ${String(a.due_date).slice(0, 10)}` : ""}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Certifications */}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <span className={`${styles.bar} ${styles.orange}`} />
            <div>
              <div className={styles.sectionTitle}>Certifications</div>
              <p className={styles.sectionDesc}>Verified and recorded certificates</p>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          {certs.length === 0 && <p className={styles.emptySub}>No certifications yet.</p>}
          {certs.map((c, idx) => (
            <div key={`${c.title}-${idx}`} className={styles.miniListItem}>
              <strong>{c.title}</strong>
              <div className={styles.sectionDesc}>{c.issuer || "—"}{c.date ? ` · ${String(c.date).slice(0, 10)}` : ""}</div>
            </div>
          ))}
        </div>
      </div>

      {/* AI insights */}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <span className={`${styles.bar} ${styles.navy}`} />
            <div>
              <div className={styles.sectionTitle}>AI insights</div>
              <p className={styles.sectionDesc}>Cached course recommendations for this employee</p>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          {recommendations.length === 0 && <p className={styles.emptySub}>No AI recommendations cached yet.</p>}
          {recommendations.slice(0, 6).map((r) => (
            <div key={r.uid || r.title} className={styles.miniListItem}>
              <strong>{r.title}</strong>
              <div className={styles.sectionDesc}>{r.reason || r.priority || ""}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Career timeline + achievements */}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <span className={`${styles.bar} ${styles.cyan}`} />
            <div>
              <div className={styles.sectionTitle}>Career timeline &amp; achievements</div>
              <p className={styles.sectionDesc}>Events and milestones</p>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          {timelineEvents.slice(0, 8).map((ev, idx) => (
            <div key={ev.id || idx} className={styles.miniListItem}>
              <strong>{ev.title || ev.type || "Event"}</strong>
              <div className={styles.sectionDesc}>
                {ev.date || ""}
                {ev.detail ? ` · ${ev.detail}` : ""}
              </div>
            </div>
          ))}
          {achievementList.slice(0, 6).map((a, idx) => (
            <div key={a.id || idx} className={styles.miniListItem}>
              <strong>{a.title || a.name}</strong>
              <div className={styles.sectionDesc}>{a.type || "Achievement"}{a.date ? ` · ${String(a.date).slice(0, 10)}` : ""}</div>
            </div>
          ))}
          {!timelineEvents.length && !achievementList.length && (
            <p className={styles.emptySub}>No timeline events or achievements yet.</p>
          )}
        </div>
      </div>

      {/* Career progression (read-only, US-093) */}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <span className={`${styles.bar} ${styles.navy}`} />
            <div>
              <div className={styles.sectionTitle}>Career progression</div>
              <p className={styles.sectionDesc}>Readiness against the org role ladder</p>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          {ladder.length === 0 && <p className={styles.emptySub}>No org roles configured yet.</p>}
          {ladder.map((r) => (
            <div key={r.title} className={styles.miniListItem} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <strong>{r.title}</strong>
                {r.is_current && " · Current"}
                {r.is_next_step && " · Next step"}
              </div>
              <span>{Math.round(r.progress_percentage ?? 0)}% ready</span>
            </div>
          ))}
        </div>
      </div>

      {/* Competency evaluation (US-099) */}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <span className={`${styles.bar} ${styles.green}`} />
            <div>
              <div className={styles.sectionTitle}>Competency evaluation</div>
              <p className={styles.sectionDesc}>Score across 6 dimensions; history is kept for trend comparison</p>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          <form onSubmit={handleSubmitEvaluation}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 14 }}>
              {COMPETENCY_DIMENSIONS.map((d) => (
                <label key={d.key} style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)" }}>
                  {d.label}: {evalScores[d.key]}
                  <input
                    type="range"
                    min="1"
                    max="5"
                    value={evalScores[d.key]}
                    onChange={(e) => setEvalScores((s) => ({ ...s, [d.key]: Number(e.target.value) }))}
                  />
                </label>
              ))}
            </div>
            <textarea
              placeholder="Comments (optional)"
              value={evalComments}
              onChange={(e) => setEvalComments(e.target.value)}
              style={{ width: "100%", minHeight: 60, border: "1px solid var(--border)", borderRadius: 9, padding: 10, fontFamily: "inherit", fontSize: 12.5, marginBottom: 10 }}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="submit" className={styles.tabBtn} disabled={submittingEval} style={{ background: "var(--navy)", color: "#fff", padding: "8px 16px", borderRadius: 8 }}>
                {submittingEval ? "Submitting…" : "Submit evaluation"}
              </button>
              <button type="button" className={styles.secondaryButton} onClick={exportCompetencyReport}>
                Export report
              </button>
            </div>
          </form>

          {evaluations.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div className={styles.sectionDesc} style={{ marginBottom: 8 }}>
                History ({evaluations.length}){profile.competency_evaluations?.trend != null ? ` · Trend: ${profile.competency_evaluations.trend > 0 ? "+" : ""}${profile.competency_evaluations.trend}` : ""}
              </div>
              {evaluations.slice(0, 5).map((ev) => (
                <div key={ev.id} className={styles.miniListItem} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{new Date(ev.evaluated_at).toLocaleDateString()}</span>
                  <strong>Overall: {ev.overall_score} / 5</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Development plan (US-103) */}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <span className={`${styles.bar} ${styles.orange}`} />
            <div>
              <div className={styles.sectionTitle}>Development plan</div>
              <p className={styles.sectionDesc}>
                Generated from the employee&apos;s AI career path{plan?.target_role ? ` toward ${plan.target_role}` : ""}
                {plan?.progress_percentage != null ? ` · ${plan.progress_percentage}% complete` : ""}
              </p>
            </div>
          </div>
        </div>
        <div className={styles.sectionBody}>
          {(!plan?.milestones || plan.milestones.length === 0) && (
            <p className={styles.emptySub}>No plan yet — the employee hasn&apos;t set a career goal, or has no gap steps remaining.</p>
          )}
          {plan?.milestones?.length > 0 && (
            <>
              <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                <input
                  placeholder="Target timeline (e.g. 6 months)"
                  value={planTimeline}
                  onChange={(e) => setPlanTimeline(e.target.value)}
                  style={{ flex: 1, minWidth: 180, border: "1px solid var(--border)", borderRadius: 9, padding: 9, fontSize: 12.5, fontFamily: "inherit" }}
                />
                <input
                  placeholder="Recruiter note"
                  value={planNote}
                  onChange={(e) => setPlanNote(e.target.value)}
                  style={{ flex: 2, minWidth: 220, border: "1px solid var(--border)", borderRadius: 9, padding: 9, fontSize: 12.5, fontFamily: "inherit" }}
                />
              </div>
              {plan.milestones.map((m) => (
                <div key={m.id} className={styles.miniListItem} style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <strong>{m.title}</strong>
                    <div className={styles.sectionDesc}>{m.kind === "certification" ? "Certification" : "Course"}{m.estimated_hours ? ` · ~${m.estimated_hours}h` : ""}</div>
                  </div>
                  <select
                    value={milestoneEdits[m.id]?.status ?? m.status}
                    onChange={(e) => updateMilestone(m.id, { status: e.target.value })}
                    style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 6, fontSize: 12 }}
                  >
                    <option value="pending">Pending</option>
                    <option value="in_progress">In progress</option>
                    <option value="completed">Completed</option>
                  </select>
                  <input
                    type="date"
                    value={milestoneEdits[m.id]?.due_date ?? (m.due_date ? m.due_date.slice(0, 10) : "")}
                    onChange={(e) => updateMilestone(m.id, { due_date: e.target.value || null })}
                    style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 6, fontSize: 12 }}
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={handleSavePlan}
                disabled={savingPlan}
                style={{ marginTop: 12, background: "var(--navy)", color: "#fff", padding: "8px 16px", borderRadius: 8, border: "none", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
              >
                {savingPlan ? "Saving…" : "Save development plan"}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

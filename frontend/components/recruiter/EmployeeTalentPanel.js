"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import { getApiErrorMessage } from "@/services/authService";
import {
  getTalentProfile,
  submitCompetencyEvaluation,
  updateDevelopmentPlan,
} from "@/services/talentService";
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

  if (loading) return <p className={styles.emptySub}>Loading talent profile…</p>;
  if (!profile) return <p className={styles.emptySub}>No talent profile available.</p>;

  const ladder = profile.career_progression?.ladder || [];
  const evaluations = profile.competency_evaluations?.evaluations || [];
  const plan = profile.development_plan;

  return (
    <>
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
            <button type="submit" className={styles.tabBtn} disabled={submittingEval} style={{ background: "var(--navy)", color: "#fff", padding: "8px 16px", borderRadius: 8 }}>
              {submittingEval ? "Submitting…" : "Submit evaluation"}
            </button>
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

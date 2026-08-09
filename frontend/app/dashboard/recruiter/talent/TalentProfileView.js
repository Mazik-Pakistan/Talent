"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import shellStyles from "@/components/recruiter/recruiter-shell.module.css";
import styles from "./talent.module.css";
import SkillMatrixBars, { normalizeOwnedSkills } from "@/components/recruiter/SkillMatrixBars";
import { getApiErrorMessage, getEmployeeDetail } from "@/services/authService";
import { getEmployeeCareer } from "@/services/careerService";
import { getEmployeeLearningProfile } from "@/services/learningService";
import {
  getTalentProfile,
  getTalentRequirementsStatus,
  updateDevelopmentPlan,
} from "@/services/talentService";
import {
  Award,
  BookOpen,
  ChevronRight,
  CircleCheckBig,
  ClipboardList,
  Clock,
  Target,
  TrendingUp,
  XCircle,
  ArrowRight,
} from "lucide-react";
import {
  publishRecruiterContext,
  clearRecruiterContext,
} from "@/lib/ai/recruiterContext";

const TABS = [
  { key: "progress", label: "Progress" },
  { key: "capability", label: "Skills & courses" },
  { key: "plan", label: "Development plan" },
];

const PROF_ORDER = ["Beginner", "Intermediate", "Advanced", "Expert"];
const PROF_COLORS = {
  Beginner: "#94a3b8",
  Intermediate: "#38a2ff",
  Advanced: "#00a9ce",
  Expert: "#0f2a4a",
};

function SegmentBar({ segments, title }) {
  const total = segments.reduce((sum, s) => sum + (s.value || 0), 0);
  return (
    <div className={styles.segmentCard}>
      <div className={styles.segmentCardTitle}>{title}</div>
      <div className={styles.segmentTrack} role="img" aria-label={title}>
        {total === 0 ? (
          <div className={styles.segmentEmpty} />
        ) : (
          segments.filter((s) => s.value > 0).map((s) => (
            <div
              key={s.key}
              className={styles.segmentFill}
              style={{ width: `${(100 * s.value) / total}%`, background: s.color }}
              title={`${s.label}: ${s.value}`}
            />
          ))
        )}
      </div>
      <div className={styles.segmentLegend}>
        {segments.map((s) => (
          <span key={s.key} className={styles.segmentLegendItem}>
            <i style={{ background: s.color }} />
            {s.label} <b>{s.value}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  if (typeof value === "object") {
    if (Array.isArray(value.items)) return value.items;
    if (Array.isArray(value.results)) return value.results;
    if (Array.isArray(value.data)) return value.data;
    return Object.values(value).filter((v) => v != null && typeof v !== "function");
  }
  return [];
}

function Breadcrumbs({ crumbs }) {
  return (
    <nav className={styles.breadcrumbs} aria-label="Talent profile breadcrumb">
      {crumbs.map((c, i) => (
        <span key={c.key} className={styles.breadcrumbItem}>
          {i > 0 && <ChevronRight size={14} className={styles.breadcrumbSep} aria-hidden="true" />}
          {c.onClick ? (
            <button type="button" className={styles.breadcrumbLink} onClick={c.onClick}>{c.label}</button>
          ) : (
            <span className={styles.breadcrumbCurrent}>{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

function getPromotionStatus(assignment, readiness, progress) {
  if (!assignment) return "No path";
  if (assignment.status === "paused") return "Paused";
  if (readiness == null && progress == null) return "No path";
  if (readiness >= 80) return "Ready";
  if (progress >= 50 && readiness >= 50) return "On track";
  return "At risk";
}

function statusLabel(status) {
  if (status === "acquired" || status === "earned" || status === "completed") return "Completed";
  if (status === "pending_verification" || status === "pending" || status === "submitted") return "Pending verify";
  if (status === "in_progress" || status === "assigned" || status === "enrolled") return "Not completed";
  return "Not completed";
}

function statusClass(status) {
  if (status === "acquired" || status === "earned" || status === "completed") return "promoStatusDone";
  if (status === "in_progress") return "promoStatusInProgress";
  return "promoStatusMissing";
}

function statusIcon(status) {
  if (status === "acquired" || status === "earned" || status === "completed") {
    return <CircleCheckBig size={12} aria-hidden="true" />;
  }
  if (status === "in_progress") return <Clock size={12} aria-hidden="true" />;
  return <XCircle size={12} aria-hidden="true" />;
}

function deriveSkillChecklist(skillsToAcquire, talentSkills, learningSkills) {
  if (!Array.isArray(skillsToAcquire) || skillsToAcquire.length === 0) return [];
  const allSkills = [
    ...(Array.isArray(talentSkills) ? talentSkills : []),
    ...(Array.isArray(learningSkills) ? learningSkills : []),
  ];
  const skillMap = new Map();
  for (const s of allSkills) {
    const name = typeof s === "string" ? s : (s.skill_name || s.name || s.skill || "").trim();
    if (name) skillMap.set(name.toLowerCase(), s);
  }
  const rank = { beginner: 1, intermediate: 2, advanced: 3, expert: 4 };
  return skillsToAcquire.map((req) => {
    const name = typeof req === "string" ? req : (req.skill || req.name || "").trim();
    const currentStatus = typeof req === "object" ? (req.current_status || "not_started") : "not_started";
    const targetRaw = typeof req === "object" ? (req.target_proficiency || "Intermediate") : "Intermediate";
    const target = String(targetRaw).toLowerCase();
    const matched = skillMap.get(name.toLowerCase());
    const have = matched?.proficiency ? String(matched.proficiency).toLowerCase() : "";
    const meetsTarget = Boolean(have && (rank[have] || 0) >= (rank[target] || 2));
    const done = currentStatus === "acquired" || meetsTarget;
    return {
      name: name || "Unknown skill",
      status: done ? "acquired" : currentStatus === "in_progress" ? "in_progress" : "not_started",
    };
  }).filter((s) => s.name && s.name !== "Unknown skill");
}

function deriveCourseChecklist(assignedPath, enrollments) {
  if (!Array.isArray(assignedPath) || assignedPath.length === 0) return [];
  const enrollmentMap = new Map();
  for (const e of Array.isArray(enrollments) ? enrollments : []) {
    const uid = e.course_uid || e.uid;
    if (uid) enrollmentMap.set(uid, e);
  }
  return assignedPath.map((course) => {
    const uid = course.course_uid || "";
    const title = course.course_title || course.title || course.name || "Untitled course";
    const enrollment = enrollmentMap.get(uid);
    const courseStatus = course.status || "not_started";
    const enrollmentStatus = enrollment?.status || "";
    let status = courseStatus;
    if (enrollmentStatus === "completed" || courseStatus === "completed") status = "completed";
    else if (enrollmentStatus === "in_progress" || courseStatus === "in_progress") status = "in_progress";
    else if (enrollmentStatus) status = enrollmentStatus;
    return { name: title, status };
  });
}

function deriveCertChecklist(certsToEarn, certificates) {
  if (!Array.isArray(certsToEarn) || certsToEarn.length === 0) return [];
  const certTitles = new Set();
  for (const c of Array.isArray(certificates) ? certificates : []) {
    const title = c.title || c.course_title || c.name || "";
    if (title) certTitles.add(title.toLowerCase());
  }
  return certsToEarn.map((req) => {
    const name = typeof req === "string" ? req : (req.certification || req.name || req.title || "");
    if (!name) return null;
    const currentStatus = typeof req === "object" ? (req.status || "not_started") : "not_started";
    const earned = certTitles.has(name.toLowerCase()) || currentStatus === "earned";
    return {
      name,
      status: earned ? "earned" : currentStatus === "in_progress" ? "in_progress" : "not_started",
    };
  }).filter(Boolean);
}

function ChecklistCard({ title, done, total, rows, emptyNote }) {
  return (
    <div className={styles.promoChecklistCard}>
      <div className={styles.promoChecklistHead}>
        <span className={styles.promoChecklistTitle}>{title}</span>
        <span className={styles.promoChecklistCount}>{done}/{total} done</span>
      </div>
      <div className={styles.promoChecklistBody}>
        {total === 0 ? (
          <p className={styles.inlineNote} style={{ padding: "6px 4px" }}>{emptyNote}</p>
        ) : (
          rows.map((row, i) => (
            <div key={`${row.name}-${i}`} className={styles.promoChecklistRow}>
              <span className={styles.promoChecklistName} title={row.name}>{row.name}</span>
              <span className={`${styles.promoChecklistStatus} ${styles[statusClass(row.status)]}`}>
                {statusIcon(row.status)} {statusLabel(row.status)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function TalentProfileView({
  employeeId,
  departmentName,
  roleName,
  onNavigate,
}) {
  const [employee, setEmployee] = useState(null);
  const [talent, setTalent] = useState(null);
  const [career, setCareer] = useState(null);
  const [learning, setLearning] = useState(null);
  const [requirements, setRequirements] = useState(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState("progress");
  const [planTimeline, setPlanTimeline] = useState("");
  const [planNote, setPlanNote] = useState("");
  const [milestoneEdits, setMilestoneEdits] = useState({});
  const [savingPlan, setSavingPlan] = useState(false);

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token || !employeeId) return;
    setLoading(true);
    Promise.allSettled([
      getEmployeeDetail(employeeId, token),
      getTalentProfile(token, employeeId),
      getEmployeeCareer(token, employeeId),
      getEmployeeLearningProfile(token, employeeId),
      getTalentRequirementsStatus(token, { employee_id: employeeId }),
    ])
      .then(([empRes, talentRes, careerRes, learnRes, reqRes]) => {
        if (empRes.status === "fulfilled") {
          // /api/employees/detail returns { employee, ... } — unwrap like Employees page.
          const payload = empRes.value;
          setEmployee(payload?.employee || payload);
        } else {
          toast.error(getApiErrorMessage(empRes.reason, "Could not load employee."));
        }
        if (talentRes.status === "fulfilled") {
          setTalent(talentRes.value);
          setPlanTimeline(talentRes.value?.development_plan?.target_timeline || "");
          setPlanNote(talentRes.value?.development_plan?.recruiter_note || "");
          setMilestoneEdits({});
        }
        if (careerRes.status === "fulfilled") setCareer(careerRes.value);
        if (learnRes.status === "fulfilled") setLearning(learnRes.value);
        if (reqRes.status === "fulfilled") setRequirements(reqRes.value);
      })
      .finally(() => setLoading(false));
  }, [employeeId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- Standard data-fetching pattern
  useEffect(() => { load(); }, [load]);

  const name = employee?.full_name
    || talent?.personal_profile?.full_name
    || talent?.full_name
    || career?.assignment?.employee_name
    || employeeId;

  useEffect(() => {
    if (name) {
      publishRecruiterContext({
        tab: "profile",
        section: "profile",
        employeeName: name,
        hint: `You're viewing ${name}'s talent progress — path, skills, learning, and development plan.`,
      });
    }
    return () => clearRecruiterContext();
  }, [name]);

  const jobTitle = employee?.job_title
    || talent?.personal_profile?.job_title
    || talent?.job_title
    || career?.assignment?.current_role_title
    || roleName
    || "—";
  const dept = employee?.department
    || talent?.personal_profile?.department
    || talent?.department
    || career?.assignment?.current_department
    || departmentName
    || "—";

  const crumbs = [
    { key: "talent", label: "Overview", onClick: () => onNavigate({ view: "dashboard", employee: null, department: null, role: null }) },
    ...(departmentName
      ? [{
          key: "dept",
          label: departmentName,
          onClick: () => onNavigate({ view: "dashboard", employee: null, department: departmentName, role: null }),
        }]
      : [{
          key: "emps",
          label: "Employees",
          onClick: () => onNavigate({ view: "employees", employee: null }),
        }]),
    ...(roleName
      ? [{
          key: "role",
          label: roleName,
          onClick: () => onNavigate({
            view: "dashboard",
            employee: null,
            department: departmentName,
            role: roleName,
          }),
        }]
      : []),
    { key: "profile", label: name },
  ];

  // Skill matrix = skills the employee has (talent skill matrix / employee_skills).
  // Never use enrollments, courses, or certificates as matrix rows (those stay on Learning).
  const skillMatrixSource = useMemo(() => {
    const fromTalent = normalizeOwnedSkills(talent?.skills);
    if (fromTalent.length) return talent?.skills?.categories ? talent.skills : fromTalent;
    const fromLearningSkills = normalizeOwnedSkills(learning?.skills);
    if (fromLearningSkills.length) return fromLearningSkills;
    return normalizeOwnedSkills(learning?.skill_matrix);
  }, [talent, learning]);
  const skills = normalizeOwnedSkills(skillMatrixSource);
  const skillGaps = asArray(talent?.skill_gaps || talent?.gaps || learning?.skill_gaps);
  const certs = asArray(learning?.certifications || talent?.certifications);
  const courses = asArray(learning?.enrollments || learning?.courses || learning?.assignments);

  const assignment = career?.assignment || null;
  const readiness = assignment?.readiness_score ?? career?.readiness_score ?? talent?.readiness_score;
  const hasPath = Boolean(assignment?.target_level_id || assignment?.target_role_title || assignment?.target_role);

  // Hide path-gap items when there is no promotion target (avoid contradicting Progress).
  const reqItems = asArray(requirements?.items || requirements?.employee?.items).filter((item) => {
    if (!hasPath && (item.category === "roadmap_gaps" || item.code?.includes("gap") || item.code === "readiness_behind")) {
      return false;
    }
    if (hasPath && item.code === "career_path_missing") return false;
    return true;
  });
  const reqAllMet = reqItems.length === 0;
  const reqOpenHigh = reqItems.filter((i) => i.severity === "high").length;
  const hasDocIssues = reqItems.some((i) => i.category === "identity_docs" || i.category === "cv_resume");

  function achievementStatus(item) {
    const st = (
      item?.verification_status
      || item?.status
      || ""
    ).toLowerCase();
    if (
      ["completed", "verified", "earned", "acquired"].includes(st)
      || item?.completed_at
      || item?.verified_at
    ) {
      return { label: "Completed", cls: styles.progressBadgeGreen };
    }
    if (["pending_verification", "pending", "submitted", "certificate_pending"].includes(st)) {
      return { label: "Pending verify", cls: styles.progressBadgeOrange };
    }
    if (["rejected", "reupload_required", "mismatch"].includes(st)) {
      return { label: "Needs reupload", cls: styles.progressBadgeRed };
    }
    // Product flow is binary: not completed until verified — never show partial %.
    return { label: "Not completed", cls: styles.progressBadgeMuted };
  }

  const completedCourses = courses.filter((c) => achievementStatus(c).label === "Completed").length;
  const certStatuses = certs.map((c) => (typeof c === "string" ? { label: "Completed" } : achievementStatus(c)));
  const verifiedCerts = certStatuses.filter((s) => s.label === "Completed" || s.label === "On file").length;
  const pendingCerts = certStatuses.filter((s) => s.label === "Pending verify").length;
  const openCerts = Math.max(0, certs.length - verifiedCerts - pendingCerts);

  const proficiencyCounts = useMemo(() => {
    const counts = { Beginner: 0, Intermediate: 0, Advanced: 0, Expert: 0 };
    for (const s of skills) {
      const raw = (typeof s === "object" && s.proficiency) || "Beginner";
      const key = String(raw).charAt(0).toUpperCase() + String(raw).slice(1).toLowerCase();
      if (counts[key] != null) counts[key] += 1;
      else counts.Beginner += 1;
    }
    return counts;
  }, [skills]);

  const skillChecklist = useMemo(
    () => deriveSkillChecklist(assignment?.skills_to_acquire, skills, []),
    [assignment, skills]
  );
  const courseChecklist = useMemo(
    () => deriveCourseChecklist(assignment?.assigned_learning_path, learning?.enrollments),
    [assignment, learning]
  );
  const certChecklist = useMemo(
    () => deriveCertChecklist(assignment?.certifications_to_earn, learning?.certificates || certs),
    [assignment, learning, certs]
  );

  // Path completion from done/not-done checklists only (no enrollment progress %).
  const pathDone =
    skillChecklist.filter((s) => s.status === "acquired").length
    + courseChecklist.filter((s) => s.status === "completed").length
    + certChecklist.filter((s) => s.status === "earned").length;
  const pathTotal = skillChecklist.length + courseChecklist.length + certChecklist.length;
  const progress = pathTotal > 0 ? Math.round((100 * pathDone) / pathTotal) : null;
  const promoStatus = getPromotionStatus(assignment, readiness, progress);

  const plan = talent?.development_plan;

  async function handleSavePlan() {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    const milestones = (plan?.milestones || []).map((m) => ({
      id: m.id,
      status: milestoneEdits[m.id]?.status ?? m.status,
      due_date: milestoneEdits[m.id]?.due_date ?? (m.due_date ? String(m.due_date).slice(0, 10) : null),
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

  if (loading && !employee && !talent) {
    return <p className={styles.inlineNote}>Loading talent profile…</p>;
  }

  return (
    <div className={styles.intelStack}>
      <Breadcrumbs crumbs={crumbs} />

      <div className={styles.detailHero}>
        <div>
          <h2 className={styles.detailTitle}>{name}</h2>
          <p className={styles.detailDesc}>{jobTitle} · {dept} · {employeeId}</p>
        </div>
        <div className={styles.detailStatRow}>
          {hasPath ? (
            <span><TrendingUp size={14} aria-hidden="true" /> Readiness {readiness != null ? `${readiness}%` : "—"}</span>
          ) : (
            <span><Target size={14} aria-hidden="true" /> No path assigned</span>
          )}
          <span><BookOpen size={14} aria-hidden="true" /> {skills.length || "No"} skills</span>
          {!reqAllMet && (
            <span className={styles.incompleteChip}>
              {reqItems.length} open req{reqItems.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      {!reqAllMet && (
        <div className={`${styles.reqPanel} ${styles.reqPanelBlocked}`}>
          <div className={styles.reqPanelHead}>
            <div>
              <div className={styles.reqPanelTitle}>
                <ClipboardList size={16} aria-hidden="true" style={{ marginRight: 6, verticalAlign: "middle" }} />
                Still needed
              </div>
              <p className={styles.reqPanelDesc}>
                Post-hire profile complete is separate. These are remaining docs, path setup, or skill gaps.
              </p>
            </div>
            {reqOpenHigh > 0 && (
              <span className={`${styles.reqSeverity} ${styles.reqSeverityHigh}`}>{reqOpenHigh} high</span>
            )}
          </div>
          <div className={styles.reqList}>
            {reqItems.map((item) => (
              <div key={item.code} className={styles.reqRow}>
                <div>
                  <div className={styles.reqRowLabel}>{item.label}</div>
                  {item.actionHint ? <div className={styles.reqRowMeta}>{item.actionHint}</div> : null}
                </div>
                <span
                  className={`${styles.reqSeverity} ${
                    item.severity === "high"
                      ? styles.reqSeverityHigh
                      : item.severity === "medium"
                        ? styles.reqSeverityMedium
                        : styles.reqSeverityLow
                  }`}
                >
                  {item.severity}
                </span>
              </div>
            ))}
          </div>
          {hasDocIssues && (
            <div className={styles.reqActions}>
              <button
                type="button"
                className={styles.smallBtn}
                onClick={() => onNavigate({
                  path: `/dashboard/recruiter/employees/${encodeURIComponent(employeeId)}`,
                })}
              >
                Open employee Documents
              </button>
            </div>
          )}
        </div>
      )}

      {reqAllMet && (
        <div className={`${styles.reqPanel} ${styles.reqPanelOk} ${styles.reqPanelCompact}`}>
          <CircleCheckBig size={15} aria-hidden="true" />
          <span>Requirements clear — no open docs or tracked gaps</span>
        </div>
      )}

      <div className={styles.subTabBar} role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={section === t.key}
            className={`${styles.subTabBtn} ${section === t.key ? styles.subTabActive : ""}`}
            onClick={() => setSection(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {section === "progress" && (
        !hasPath ? (
          <div className={styles.promoEmpty}>
            <div className={styles.promoEmptyIcon}><Target aria-hidden="true" /></div>
            <div className={styles.promoEmptyTitle}>No career path assigned</div>
            <p className={styles.promoEmptyHint}>
              Assign a promotion target in Pipeline to track readiness, skills, courses, and certifications here.
              This is setup — not “behind on path.”
            </p>
            <div className={styles.promoEmptyActions}>
              <button type="button" className={styles.smallBtnPrimary} onClick={() => onNavigate({ view: "pipeline", employee: null })}>
                Open Pipeline
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.detailPanels}>
            <div className={styles.promoHero}>
              <div className={styles.promoHeroMain}>
                <div className={styles.promoHeroTitle}>Promotion path</div>
                <div className={styles.promoPathRow}>
                  <span className={styles.promoPathRole}>
                    {assignment.current_role_title || jobTitle}
                  </span>
                  <ArrowRight size={16} className={styles.promoPathArrow} aria-hidden="true" />
                  <span className={styles.promoPathRole}>
                    {assignment.target_role_title || assignment.target_role || "—"}
                  </span>
                </div>
                {assignment.target_date && (
                  <div className={styles.promoMetaRow}>
                    <span className={styles.promoMetaItem}>
                      <Target size={13} aria-hidden="true" /> Target: {assignment.target_date}
                    </span>
                  </div>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                <span className={`${styles.promoStatusChip} ${styles[`promoStatus${promoStatus.replace(/\s+/g, "")}`]}`}>
                  {promoStatus}
                </span>
                {readiness != null && (
                  <span className={styles.promoMetaItem}>
                    <TrendingUp size={13} aria-hidden="true" /> {readiness}% ready
                  </span>
                )}
              </div>
              <div className={styles.promoProgressWrap}>
                <div className={styles.promoProgressLabel}>
                  <span>Requirements done</span>
                  <span>{pathTotal > 0 ? `${pathDone}/${pathTotal}` : "—"}</span>
                </div>
                <div className={styles.promoProgressTrack}>
                  <div
                    className={`${styles.promoProgressFill} ${
                      progress != null && progress >= 80
                        ? styles.green
                        : progress != null && progress < 50
                          ? styles.red
                          : progress != null
                            ? styles.orange
                            : ""
                    }`}
                    style={{ width: `${Math.min(progress != null ? progress : 0, 100)}%` }}
                  />
                </div>
              </div>
            </div>

            <p className={styles.pathReqIntro}>
              Path target: <strong>{assignment.target_role_title || assignment.target_role || "—"}</strong>.
              Requirements below are what this employee still needs for promotion readiness
              (counts as done after they upload and you verify).
            </p>

            <div className={styles.promoChecklistGrid}>
              <ChecklistCard
                title="Required skills"
                done={skillChecklist.filter((s) => s.status === "acquired").length}
                total={skillChecklist.length}
                rows={skillChecklist}
                emptyNote="No skill requirements on this career level."
              />
              <ChecklistCard
                title="Assigned courses"
                done={courseChecklist.filter((s) => s.status === "completed").length}
                total={courseChecklist.length}
                rows={courseChecklist}
                emptyNote="No courses on this career level yet. Add a learning path on the target level in Organization Setup."
              />
              <ChecklistCard
                title="Required certifications"
                done={certChecklist.filter((s) => s.status === "earned").length}
                total={certChecklist.length}
                rows={certChecklist}
                emptyNote="No certifications required on this career level."
              />
            </div>
          </div>
        )
      )}

      {section === "capability" && (
        <div className={styles.capabilityDense}>
          <div className={styles.capabilityKpiStrip}>
            <div className={styles.capabilityKpi}>
              <span className={styles.capabilityKpiLabel}>Skills</span>
              <strong>{skills.length}</strong>
              <span className={styles.capabilityKpiMeta}>
                {PROF_ORDER.map((k) => `${k.slice(0, 3)} ${proficiencyCounts[k] || 0}`).join(" · ")}
              </span>
            </div>
            <div className={styles.capabilityKpi}>
              <span className={styles.capabilityKpiLabel}>Courses</span>
              <strong>{completedCourses}/{courses.length || 0}</strong>
              <span className={styles.capabilityKpiMeta}>Verified complete</span>
            </div>
            <div className={styles.capabilityKpi}>
              <span className={styles.capabilityKpiLabel}>Certs</span>
              <strong>{verifiedCerts}/{certs.length || 0}</strong>
              <span className={styles.capabilityKpiMeta}>
                {pendingCerts ? `${pendingCerts} pending` : openCerts ? `${openCerts} open` : "Verified"}
              </span>
            </div>
            <div className={styles.capabilityKpi}>
              <span className={styles.capabilityKpiLabel}>Path</span>
              <strong>{hasPath ? (readiness != null ? `${Math.round(readiness)}%` : promoStatus || "On path") : "—"}</strong>
              <span className={styles.capabilityKpiMeta}>
                {hasPath ? (promoStatus || "Assigned") : "No path · assign in Pipeline"}
              </span>
            </div>
            <button
              type="button"
              className={`${styles.smallBtn} ${styles.capabilityKpiAction}`}
              onClick={() => setSection("progress")}
            >
              Path details
            </button>
          </div>

          <section className={styles.capabilityMatrixCard}>
            <SkillMatrixBars
              skills={skillMatrixSource}
              previewCount={22}
              requiredSkills={assignment?.skills_to_acquire || skillChecklist.map((s) => s.name)}
              emptyMessage="No owned skills on file yet."
            />
            {skillGaps.length > 0 && (
              <div className={styles.capabilityGaps}>
                <div className={styles.capabilityGapsTitle}>Skill gaps</div>
                <div className={styles.chipRow}>
                  {skillGaps.slice(0, 10).map((g, i) => (
                    <span key={`gap-${i}`} className={`${styles.softChip} ${styles.softChipAccent}`}>
                      {typeof g === "string" ? g : g.skill || g.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>

          {hasPath && (
            <section className={styles.pathAssignCard}>
              <div className={styles.pathAssignHead}>
                <div>
                  <div className={styles.pathAssignTitle}>
                    Path requirements → {assignment.target_role_title || assignment.target_role || "target"}
                  </div>
                  <p className={styles.pathAssignDesc}>
                    What this employee must finish for the assigned path. Status updates after you verify evidence.
                  </p>
                </div>
                <span className={styles.capabilitySplitMeta}>
                  {pathTotal > 0 ? `${pathDone}/${pathTotal} done` : "No requirements"}
                </span>
              </div>

              <div className={styles.pathAssignGrid}>
                <div>
                  <div className={styles.capabilityBlockTitle}>
                    <BookOpen size={12} aria-hidden="true" /> Assigned courses
                  </div>
                  {courseChecklist.length === 0 ? (
                    <p className={styles.inlineNote}>
                      No courses on this level yet. Configure the learning path on the target career level.
                    </p>
                  ) : (
                    <div className={styles.capabilityList}>
                      {courseChecklist.map((row, i) => {
                        const done = row.status === "completed";
                        return (
                          <div key={`path-course-${i}`} className={styles.capabilityListRow}>
                            <div className={styles.capabilityListMain}>
                              <span className={`${styles.statusDot} ${done ? styles.statusDotGreen : styles.statusDotMuted}`} />
                              <span>{row.name}</span>
                            </div>
                            <span className={`${styles.progressBadge} ${done ? styles.progressBadgeGreen : styles.progressBadgeMuted}`}>
                              {statusLabel(row.status)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div>
                  <div className={styles.capabilityBlockTitle}>
                    <Award size={12} aria-hidden="true" /> Required certifications
                  </div>
                  {certChecklist.length === 0 ? (
                    <p className={styles.inlineNote}>No certifications required on this path.</p>
                  ) : (
                    <div className={styles.capabilityList}>
                      {certChecklist.map((row, i) => {
                        const done = row.status === "earned";
                        return (
                          <div key={`path-cert-${i}`} className={styles.capabilityListRow}>
                            <div className={styles.capabilityListMain}>
                              <span className={`${styles.statusDot} ${done ? styles.statusDotGreen : styles.statusDotMuted}`} />
                              <span>{row.name}</span>
                            </div>
                            <span className={`${styles.progressBadge} ${done ? styles.progressBadgeGreen : styles.progressBadgeMuted}`}>
                              {statusLabel(row.status)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {skillChecklist.length > 0 && (
                <div className={styles.pathAssignSkills}>
                  <div className={styles.capabilityBlockTitle}>Required skills on this path</div>
                  <div className={styles.chipRow}>
                    {skillChecklist.map((row, i) => (
                      <span
                        key={`path-skill-${i}`}
                        className={`${styles.softChip} ${
                          row.status === "acquired" ? styles.softChipOk : styles.softChipAccent
                        }`}
                        title={statusLabel(row.status)}
                      >
                        {row.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          <div className={styles.capabilityLearnRow}>
            <section className={styles.capabilityDenseCard}>
              <div className={styles.capabilitySplitHead}>
                <span className={styles.capabilitySplitTitle}>
                  <BookOpen size={14} aria-hidden="true" /> Other enrollments
                </span>
                <span className={styles.capabilitySplitMeta}>{completedCourses}/{courses.length || 0} done</span>
              </div>
              {courses.length === 0 ? (
                <p className={styles.inlineNote}>No extra learning enrollments.</p>
              ) : (
                <div className={styles.capabilityList}>
                  {courses.map((c, i) => {
                    const status = achievementStatus(c);
                    return (
                      <div key={c.id || c.course_uid || i} className={styles.capabilityListRow}>
                        <div className={styles.capabilityListMain}>
                          <span
                            className={`${styles.statusDot} ${
                              status.label === "Completed"
                                ? styles.statusDotGreen
                                : status.label === "Pending verify"
                                  ? styles.statusDotOrange
                                  : styles.statusDotMuted
                            }`}
                          />
                          <span>{c.title || c.course_title || c.name || "Course"}</span>
                        </div>
                        <span className={`${styles.progressBadge} ${status.cls}`}>{status.label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className={styles.capabilityDenseCard}>
              <div className={styles.capabilitySplitHead}>
                <span className={styles.capabilitySplitTitle}>
                  <Award size={14} aria-hidden="true" /> Certifications on file
                </span>
                <span className={styles.capabilitySplitMeta}>{verifiedCerts}/{certs.length || 0} done</span>
              </div>
              {certs.length > 0 && (
                <SegmentBar
                  title="Status"
                  segments={[
                    { key: "done", label: "Done", value: verifiedCerts, color: "#1fae7a" },
                    { key: "pending", label: "Pending", value: pendingCerts, color: "#d97706" },
                    { key: "open", label: "Open", value: openCerts, color: "#cbd5e1" },
                  ]}
                />
              )}
              {certs.length === 0 ? (
                <p className={styles.inlineNote}>None on file.</p>
              ) : (
                <div className={styles.capabilityList}>
                  {certs.map((c, i) => {
                    const status = typeof c === "string"
                      ? { label: "Completed", cls: styles.progressBadgeGreen }
                      : achievementStatus(c);
                    const title = typeof c === "string" ? c : (c.name || c.title || c.course_title || "Certificate");
                    return (
                      <div key={c.id || i} className={styles.capabilityListRow}>
                        <div className={styles.capabilityListMain}>
                          <span
                            className={`${styles.statusDot} ${
                              status.label === "Completed" || status.label === "On file"
                                ? styles.statusDotGreen
                                : status.label === "Pending verify"
                                  ? styles.statusDotOrange
                                  : styles.statusDotMuted
                            }`}
                          />
                          <span>{title}</span>
                        </div>
                        <span className={`${styles.progressBadge} ${status.cls}`}>{status.label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {section === "plan" && (
        <div className={shellStyles.section}>
          <div className={shellStyles.sectionHead}>
            <div className={shellStyles.sectionHeadLeft}>
              <span className={`${shellStyles.bar} ${shellStyles.orange}`} />
              <div>
                <div className={shellStyles.sectionTitle}>Development plan</div>
                <p className={shellStyles.sectionDesc}>
                  Learning milestones toward a career goal
                  {plan?.target_role ? ` (${plan.target_role})` : ""}
                  {plan?.progress_percentage != null ? ` · ${plan.progress_percentage}% complete` : ""}
                  . This is not the post-hire profile checklist.
                </p>
              </div>
            </div>
          </div>
          <div className={shellStyles.sectionBody}>
            {(!plan?.milestones || plan.milestones.length === 0) && (
              <div className={styles.emptyState}>
                <div className={styles.emptyStateTitle}>No development plan yet</div>
                <p className={styles.emptyStateHint}>
                  A plan appears after the employee sets a learning career goal / AI path, or you assign growth milestones from Learning.
                </p>
              </div>
            )}
            {plan?.milestones?.length > 0 && (
              <>
                <div className={styles.filterBar} style={{ marginBottom: 12 }}>
                  <input
                    className={styles.searchInput}
                    placeholder="Target timeline (e.g. 6 months)"
                    value={planTimeline}
                    onChange={(e) => setPlanTimeline(e.target.value)}
                  />
                  <input
                    className={styles.searchInput}
                    placeholder="Recruiter note"
                    value={planNote}
                    onChange={(e) => setPlanNote(e.target.value)}
                  />
                  <button
                    type="button"
                    className={styles.smallBtnPrimary}
                    onClick={handleSavePlan}
                    disabled={savingPlan}
                  >
                    {savingPlan ? "Saving…" : "Save plan"}
                  </button>
                </div>
                {plan.milestones.map((m) => (
                  <div key={m.id} className={styles.employeeManageRow}>
                    <div className={styles.employeeManageMain}>
                      <div className={styles.employeeMiniName}>{m.title}</div>
                      <div className={styles.employeeMiniMeta}>
                        {m.kind === "certification" ? "Certification" : "Course"}
                        {m.estimated_hours ? ` · ~${m.estimated_hours}h` : ""}
                      </div>
                    </div>
                    <div className={styles.employeeManageSide}>
                      <select
                        className={styles.filterSelect}
                        value={milestoneEdits[m.id]?.status ?? m.status}
                        onChange={(e) => setMilestoneEdits((prev) => ({
                          ...prev,
                          [m.id]: { ...prev[m.id], status: e.target.value },
                        }))}
                      >
                        <option value="pending">Pending</option>
                        <option value="in_progress">In progress</option>
                        <option value="completed">Completed</option>
                      </select>
                      <input
                        type="date"
                        className={styles.filterSelect}
                        value={milestoneEdits[m.id]?.due_date ?? (m.due_date ? String(m.due_date).slice(0, 10) : "")}
                        onChange={(e) => setMilestoneEdits((prev) => ({
                          ...prev,
                          [m.id]: { ...prev[m.id], due_date: e.target.value || null },
                        }))}
                      />
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

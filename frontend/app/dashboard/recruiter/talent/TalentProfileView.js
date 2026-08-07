"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import shellStyles from "@/components/recruiter/recruiter-shell.module.css";
import styles from "./talent.module.css";
import EmployeeTalentPanel from "@/components/recruiter/EmployeeTalentPanel";
import { getApiErrorMessage, getEmployeeDetail } from "@/services/authService";
import { getEmployeeCareer } from "@/services/careerService";
import { getEmployeeLearningProfile } from "@/services/learningService";
import { getTalentProfile } from "@/services/talentService";
import {
  Award,
  BookOpen,
  ChevronRight,
  CircleCheckBig,
  Clock,
  Target,
  TrendingUp,
  XCircle,
  ArrowRight,
  BarChart3,
} from "lucide-react";

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
  if (status === "acquired" || status === "earned" || status === "completed") return "Done";
  if (status === "in_progress") return "In progress";
  return "Missing";
}

function statusClass(status) {
  if (status === "acquired" || status === "earned" || status === "completed") return "promoStatusDone";
  if (status === "in_progress") return "promoStatusInProgress";
  return "promoStatusMissing";
}

function statusIcon(status) {
  if (status === "acquired" || status === "earned" || status === "completed") return <CircleCheckBig size={12} aria-hidden="true" />;
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
  return skillsToAcquire.map((req) => {
    const name = typeof req === "string" ? req : (req.skill || req.name || "").trim();
    const currentStatus = typeof req === "object" ? (req.current_status || "not_started") : "not_started";
    const matched = skillMap.get(name.toLowerCase());
    const done = currentStatus === "acquired" || (matched && matched.proficiency && (
      matched.proficiency.toLowerCase() === "advanced" || matched.proficiency.toLowerCase() === "expert"
    ));
    return {
      name: name || "Unknown skill",
      status: done ? "acquired" : currentStatus === "in_progress" ? "in_progress" : "not_started",
    };
  });
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
    return {
      name: title,
      status,
      progress: course.progress_percent != null ? course.progress_percent : (enrollment?.progress_percent || 0),
    };
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
    const name = typeof req === "string" ? req : (req.certification || req.name || req.title || "Untitled cert");
    const currentStatus = typeof req === "object" ? (req.status || "not_started") : "not_started";
    const earned = certTitles.has(name.toLowerCase()) || currentStatus === "earned";
    return {
      name,
      status: earned ? "earned" : currentStatus === "in_progress" ? "in_progress" : "not_started",
    };
  });
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
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState("promotion");

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token || !employeeId) return;
    setLoading(true);
    Promise.allSettled([
      getEmployeeDetail(employeeId, token),
      getTalentProfile(token, employeeId),
      getEmployeeCareer(token, employeeId),
      getEmployeeLearningProfile(token, employeeId),
    ])
      .then(([empRes, talentRes, careerRes, learnRes]) => {
        console.log("[Profile] employee detail:", empRes.status, empRes.value || empRes.reason);
        console.log("[Profile] talent:", talentRes.status);
        console.log("[Profile] career:", careerRes.status);
        console.log("[Profile] learning:", learnRes.status);
        if (empRes.status === "fulfilled") {
          console.log("[Profile] employee keys:", empRes.value ? Object.keys(empRes.value) : "null");
          setEmployee(empRes.value);
        } else {
          toast.error(getApiErrorMessage(empRes.reason, "Could not load employee."));
        }
        if (talentRes.status === "fulfilled") setTalent(talentRes.value);
        if (careerRes.status === "fulfilled") setCareer(careerRes.value);
        if (learnRes.status === "fulfilled") setLearning(learnRes.value);
      })
      .finally(() => setLoading(false));
  }, [employeeId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- Standard data-fetching pattern
  useEffect(() => { load(); }, [load]);

  const name = employee?.full_name || talent?.full_name || career?.assignment?.employee_name || employeeId;
  const jobTitle = employee?.job_title || talent?.job_title || career?.assignment?.current_role_title || roleName || "—";
  const dept = employee?.department || talent?.department || career?.assignment?.current_department || departmentName || "—";

  const crumbs = [
    { key: "talent", label: "Overview", onClick: () => onNavigate({ view: "dashboard", employee: null, department: null, role: null }) },
    ...(departmentName
      ? [
          {
            key: "dept",
            label: departmentName,
            onClick: () => onNavigate({ view: "dashboard", employee: null, department: departmentName, role: null }),
          },
        ]
      : [
          {
            key: "emps",
            label: "Employees",
            onClick: () => onNavigate({ view: "employees", employee: null }),
          },
        ]),
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

  if (loading && !employee && !talent) {
    return <p className={styles.inlineNote}>Loading talent profile…</p>;
  }

  const readiness = career?.readiness_score ?? career?.assignment?.readiness_score ?? talent?.readiness_score;
  const skillGaps = asArray(talent?.skill_gaps || talent?.gaps || learning?.skill_gaps);
  const skills = asArray(talent?.skills);
  const certs = asArray(learning?.certifications || talent?.certifications);
  const courses = asArray(learning?.enrollments || learning?.courses);
  const careerGaps = asArray(career?.gaps || career?.skill_gaps || career?.assignment?.gaps);

  return (
    <div className={styles.intelStack}>
      <Breadcrumbs crumbs={crumbs} />

      <div className={styles.subTabBar} role="tablist">
        {[
          { key: "promotion", label: "Promotion path" },
          { key: "overview", label: "Overview" },
          { key: "skills", label: "Skills & gaps" },
          { key: "learning", label: "Learning" },
          { key: "career", label: "Career details" },
          { key: "development", label: "Development plan" },
        ].map((t) => (
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

      {section === "promotion" && (() => {
        const assignment = career?.assignment || null;
        const readiness = assignment?.readiness_score ?? career?.readiness_score ?? talent?.readiness_score;
        const progress = assignment?.overall_progress_percent ?? talent?.overall_progress ?? learning?.overall_progress ?? null;
        const promoStatus = getPromotionStatus(assignment, readiness, progress);
        const isPaused = assignment?.status === "paused";
        const targetDate = assignment?.target_date || null;
        const currentRole = assignment?.current_role_title || career?.current_role || jobTitle || "—";
        const targetRole = assignment?.target_role_title || career?.target_role || "—";
        const hasPath = Boolean(assignment);

        const skillChecklist = deriveSkillChecklist(
          assignment?.skills_to_acquire,
          talent?.skills,
          learning?.skills
        );
        const courseChecklist = deriveCourseChecklist(
          assignment?.assigned_learning_path,
          learning?.enrollments
        );
        const certChecklist = deriveCertChecklist(
          assignment?.certifications_to_earn,
          learning?.certificates
        );

        const skillsDone = skillChecklist.filter((s) => s.status === "acquired").length;
        const skillsTotal = skillChecklist.length;
        const coursesDone = courseChecklist.filter((s) => s.status === "completed").length;
        const coursesTotal = courseChecklist.length;
        const certsDone = certChecklist.filter((s) => s.status === "earned").length;
        const certsTotal = certChecklist.length;

        const learningSummary = learning?.summary || null;
        const competencyAvg = talent?.competency_average ?? talent?.average_competency ?? null;

        if (!hasPath) {
          return (
            <div className={styles.promoEmpty}>
              <div className={styles.promoEmptyIcon}><Target aria-hidden="true" /></div>
              <div className={styles.promoEmptyTitle}>No promotion path assigned yet</div>
              <p className={styles.promoEmptyHint}>
                Assign a career path from the Promotion Pipeline so recruiters can track readiness, skills, courses, and certifications in one view.
              </p>
              <div className={styles.promoEmptyActions}>
                <button type="button" className={styles.smallBtnPrimary} onClick={() => onNavigate({ view: "pipeline", employee: null })}>
                  Open Promotion Pipeline
                </button>
                <button type="button" className={styles.smallBtn} onClick={() => onNavigate({ view: "organization-config", employee: null })}>
                  Configure Org Levels
                </button>
              </div>
            </div>
          );
        }

        return (
          <div className={styles.detailPanels}>
            <div className={styles.promoHero}>
              <div className={styles.promoHeroMain}>
                <div className={styles.promoHeroTitle}>{name}</div>
                <div className={styles.promoHeroSub}>{jobTitle} · {dept}</div>
                <div className={styles.promoPathRow}>
                  <span className={styles.promoPathRole}>{currentRole}</span>
                  <ArrowRight size={16} className={styles.promoPathArrow} aria-hidden="true" />
                  <span className={styles.promoPathRole}>{targetRole}</span>
                </div>
                <div className={styles.promoMetaRow}>
                  {targetDate && (
                    <span className={styles.promoMetaItem}><Target size={13} aria-hidden="true" /> Target: {targetDate}</span>
                  )}
                  {isPaused && <span className={styles.promoStatusChip} style={{ background: "#f1f5f9", color: "#64748b" }}>Paused</span>}
                  {competencyAvg != null && (
                    <span className={styles.promoMetaItem}><BarChart3 size={13} aria-hidden="true" /> Competency avg: {competencyAvg}</span>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, minWidth: 140 }}>
                <span className={`${styles.promoStatusChip} ${styles[`promoStatus${promoStatus.replace(/\s+/g, "")}`]}`}>
                  {promoStatus}
                </span>
                {readiness != null && (
                  <span className={styles.promoMetaItem} style={{ fontSize: 12 }}>
                    <TrendingUp size={13} aria-hidden="true" /> Readiness {readiness}%
                  </span>
                )}
              </div>
              <div className={styles.promoProgressWrap}>
                <div className={styles.promoProgressLabel}>
                  <span>Overall progress</span>
                  <span>{progress != null ? `${progress}%` : "—"}</span>
                </div>
                <div className={styles.promoProgressTrack}>
                  <div
                    className={`${styles.promoProgressFill} ${progress != null && progress >= 80 ? styles.green : progress != null && progress < 50 ? styles.red : progress != null ? styles.orange : ""}`}
                    style={{ width: `${Math.min(progress != null ? progress : 0, 100)}%` }}
                  />
                </div>
              </div>
            </div>

            <div className={styles.promoChecklistGrid}>
              <div className={styles.promoChecklistCard}>
                <div className={styles.promoChecklistHead}>
                  <span className={styles.promoChecklistTitle}><BookOpen size={14} aria-hidden="true" /> Skills</span>
                  <span className={styles.promoChecklistCount}>{skillsDone}/{skillsTotal} done</span>
                </div>
                <div className={styles.promoChecklistBody}>
                  {skillsTotal === 0 ? (
                    <p className={styles.inlineNote} style={{ padding: "6px 4px" }}>No skills required for this level.</p>
                  ) : (
                    skillChecklist.map((s, i) => (
                      <div key={`sk-${i}`} className={styles.promoChecklistRow}>
                        <span className={styles.promoChecklistName} title={s.name}>{s.name}</span>
                        <span className={`${styles.promoChecklistStatus} ${styles[statusClass(s.status)]}`}>
                          {statusIcon(s.status)} {statusLabel(s.status)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className={styles.promoChecklistCard}>
                <div className={styles.promoChecklistHead}>
                  <span className={styles.promoChecklistTitle}><BookOpen size={14} aria-hidden="true" /> Courses</span>
                  <span className={styles.promoChecklistCount}>{coursesDone}/{coursesTotal} done</span>
                </div>
                <div className={styles.promoChecklistBody}>
                  {coursesTotal === 0 ? (
                    <p className={styles.inlineNote} style={{ padding: "6px 4px" }}>No courses assigned for this path.</p>
                  ) : (
                    courseChecklist.map((c, i) => (
                      <div key={`co-${i}`} className={styles.promoChecklistRow}>
                        <span className={styles.promoChecklistName} title={c.name}>{c.name}</span>
                        <span className={`${styles.promoChecklistStatus} ${styles[statusClass(c.status)]}`}>
                          {statusIcon(c.status)} {statusLabel(c.status)} {c.progress > 0 && c.progress < 100 && c.status === "in_progress" ? `(${c.progress}%)` : ""}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className={styles.promoChecklistCard}>
                <div className={styles.promoChecklistHead}>
                  <span className={styles.promoChecklistTitle}><Award size={14} aria-hidden="true" /> Certifications</span>
                  <span className={styles.promoChecklistCount}>{certsDone}/{certsTotal} done</span>
                </div>
                <div className={styles.promoChecklistBody}>
                  {certsTotal === 0 ? (
                    <p className={styles.inlineNote} style={{ padding: "6px 4px" }}>No certifications required for this level.</p>
                  ) : (
                    certChecklist.map((c, i) => (
                      <div key={`ce-${i}`} className={styles.promoChecklistRow}>
                        <span className={styles.promoChecklistName} title={c.name}>{c.name}</span>
                        <span className={`${styles.promoChecklistStatus} ${styles[statusClass(c.status)]}`}>
                          {statusIcon(c.status)} {statusLabel(c.status)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className={styles.promoContext}>
              <div className={styles.promoContextCard}>
                <div className={styles.promoContextTitle}>Learning progress</div>
                {learningSummary ? (
                  <>
                    <div className={styles.promoContextRow}><span>Enrollments</span><span>{learningSummary.enrolled_count ?? "—"}</span></div>
                    <div className={styles.promoContextRow}><span>Completed</span><span>{learningSummary.completed_count ?? "—"}</span></div>
                    <div className={styles.promoContextRow}><span>Overall progress</span><span>{learningSummary.overall_progress_percent != null ? `${learningSummary.overall_progress_percent}%` : "—"}</span></div>
                    <div className={styles.promoContextRow}><span>Certificates earned</span><span>{learningSummary.certificates_earned ?? "—"}</span></div>
                  </>
                ) : (
                  <p className={styles.inlineNote}>No learning summary loaded.</p>
                )}
              </div>
              <div className={styles.promoContextCard}>
                <div className={styles.promoContextTitle}>Skill snapshot</div>
                {Array.isArray(talent?.skills) && talent.skills.length > 0 ? (
                  <div className={styles.chipRow}>
                    {talent.skills.slice(0, 12).map((s, i) => (
                      <span key={`ts-${i}`} className={styles.softChip}>{typeof s === "string" ? s : s.name || s.skill_name || s.skill}</span>
                    ))}
                  </div>
                ) : Array.isArray(learning?.skills) && learning.skills.length > 0 ? (
                  <div className={styles.chipRow}>
                    {learning.skills.slice(0, 12).map((s, i) => (
                      <span key={`ls-${i}`} className={styles.softChip}>{typeof s === "string" ? s : s.name || s.skill_name || s.skill}</span>
                    ))}
                  </div>
                ) : (
                  <p className={styles.inlineNote}>No skills on file.</p>
                )}
                {competencyAvg != null && (
                  <p className={styles.inlineNote} style={{ marginTop: 8 }}>Competency average: {competencyAvg}</p>
                )}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
              <button type="button" className={styles.smallBtn} onClick={() => onNavigate({ view: "pipeline", employee: null })}>
                Open Promotion Pipeline
              </button>
              <button type="button" className={styles.smallBtn} onClick={() => onNavigate({ view: "learning", employee: null })}>
                View Learning
              </button>
            </div>
          </div>
        );
      })()}

      {section === "overview" && (
        <div className={styles.detailPanels}>
          <div className={shellStyles.section}>
            <div className={shellStyles.sectionHead}>
              <div className={shellStyles.sectionHeadLeft}>
                <span className={`${shellStyles.bar} ${shellStyles.navy}`} />
                <div>
                  <div className={shellStyles.sectionTitle}>Snapshot</div>
                </div>
              </div>
            </div>
            <div className={shellStyles.sectionBody}>
              {(talent?.competency_average || talent?.average_competency) && (
                <p className={styles.inlineNote}>
                  Competency avg: {talent?.competency_average ?? talent?.average_competency}
                  {" · "}
                  Skills tracked: {skills.length || talent?.skill_count || "—"}
                </p>
              )}
              {(learning?.overall_progress || learning?.completion_rate || talent?.learning_progress) && (
                <p className={styles.inlineNote}>
                  Learning progress: {learning?.overall_progress ?? learning?.completion_rate ?? talent?.learning_progress}%
                </p>
              )}
              {career?.assignment && (
                <p className={styles.inlineNote}>
                  Path: {career.assignment.current_role_title || career.current_role || "—"}
                  {" → "}
                  {career.assignment.target_role_title || career.target_role || "—"}
                  {career.assignment.target_date ? ` · Target ${career.assignment.target_date}` : ""}
                </p>
              )}
              {!talent?.competency_average && !talent?.average_competency && !learning?.overall_progress && !career?.assignment && (
                <p className={styles.inlineNote}>No overview data available yet.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {section === "skills" && (
        <div className={shellStyles.section}>
          <div className={shellStyles.sectionHead}>
            <div className={shellStyles.sectionHeadLeft}>
              <span className={`${shellStyles.bar} ${shellStyles.cyan}`} />
              <div>
                <div className={shellStyles.sectionTitle}>Skills & gaps</div>
              </div>
            </div>
          </div>
          <div className={shellStyles.sectionBody}>
            <div className={styles.chipRow}>
              {skills.map((s, i) => (
                <span key={`sk-${i}`} className={styles.softChip}>
                  {typeof s === "string" ? s : s.name || s.skill}
                </span>
              ))}
            </div>
            {skillGaps.length === 0 ? (
              <p className={styles.inlineNote} style={{ marginTop: 12 }}>No skill gaps reported.</p>
            ) : (
              <ul className={styles.gapList}>
                {skillGaps.map((g, i) => (
                  <li key={`gap-${i}`}>{typeof g === "string" ? g : g.skill || g.name || JSON.stringify(g)}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {section === "learning" && (
        <div className={styles.detailPanels}>
          <div className={shellStyles.section}>
            <div className={shellStyles.sectionHead}>
              <div className={shellStyles.sectionHeadLeft}>
                <span className={`${shellStyles.bar} ${shellStyles.cyan}`} />
                <div>
                  <div className={shellStyles.sectionTitle}>Learning</div>
                </div>
              </div>
            </div>
            <div className={shellStyles.sectionBody}>
              {courses.length === 0 ? (
                <p className={styles.inlineNote}>No learning enrollments loaded.</p>
              ) : (
                courses.slice(0, 12).map((c, i) => (
                  <div key={c.id || i} className={styles.employeeMiniRow}>
                    <div>
                      <div className={styles.employeeMiniName}>{c.title || c.course_title || c.name}</div>
                      <div className={styles.employeeMiniMeta}>
                        <BookOpen size={12} aria-hidden="true" /> {c.status || c.progress != null ? `${c.progress}%` : "—"}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className={shellStyles.section}>
            <div className={shellStyles.sectionHead}>
              <div className={shellStyles.sectionHeadLeft}>
                <span className={`${shellStyles.bar} ${shellStyles.orange}`} />
                <div>
                  <div className={shellStyles.sectionTitle}>Certifications</div>
                </div>
              </div>
            </div>
            <div className={shellStyles.sectionBody}>
              {certs.length === 0 ? (
                <p className={styles.inlineNote}>No certifications on file.</p>
              ) : (
                <div className={styles.chipRow}>
                  {certs.map((c, i) => (
                    <span key={`c-${i}`} className={`${styles.softChip} ${styles.softChipAccent}`}>
                      <Award size={12} aria-hidden="true" /> {typeof c === "string" ? c : c.name || c.title}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {section === "career" && (
        <div className={shellStyles.section}>
          <div className={shellStyles.sectionHead}>
            <div className={shellStyles.sectionHeadLeft}>
              <span className={`${shellStyles.bar} ${shellStyles.green}`} />
              <div>
                <div className={shellStyles.sectionTitle}>Career & promotion readiness</div>
              </div>
            </div>
          </div>
          <div className={shellStyles.sectionBody}>
            {!career?.assignment && !career?.current_role && (
              <p className={styles.inlineNote}>No career assignment yet. Assign a target level from the Promotion Pipeline.</p>
            )}
            {(career?.assignment || career?.current_role) && (
              <>
                <p className={styles.inlineNote}>
                  <Target size={14} aria-hidden="true" />{" "}
                  {career.assignment?.current_role_title || career.current_role || "—"}
                  {" → "}
                  {career.assignment?.target_role_title || career.target_role || "—"}
                </p>
                <p className={styles.inlineNote}>
                  Readiness: {readiness ?? "—"}%
                  {career.assignment?.status ? ` · Status: ${career.assignment.status === "paused" ? "Paused" : career.assignment.status}` : ""}
                </p>
                {careerGaps.length > 0 && (
                  <ul className={styles.gapList}>
                    {careerGaps.map((g, i) => (
                      <li key={`cg-${i}`}>{typeof g === "string" ? g : g.skill || g.name}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
            <button
              type="button"
              className={styles.smallBtn}
              style={{ marginTop: 12 }}
              onClick={() => onNavigate({ view: "pipeline", employee: null })}
            >
              Open promotion pipeline
            </button>
          </div>
        </div>
      )}

      {section === "development" && employee && (
        <EmployeeTalentPanel employee={employee} />
      )}
      {section === "development" && !employee && talent && (
        <EmployeeTalentPanel employee={{ employee_id: employeeId, full_name: name, ...talent }} />
      )}
    </div>
  );
}

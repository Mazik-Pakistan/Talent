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
  Target,
  TrendingUp,
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
  const [section, setSection] = useState("overview");

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
        if (empRes.status === "fulfilled") setEmployee(empRes.value);
        else toast.error(getApiErrorMessage(empRes.reason, "Could not load employee."));
        if (talentRes.status === "fulfilled") setTalent(talentRes.value);
        if (careerRes.status === "fulfilled") setCareer(careerRes.value);
        if (learnRes.status === "fulfilled") setLearning(learnRes.value);
      })
      .finally(() => setLoading(false));
  }, [employeeId]);

  useEffect(() => { load(); }, [load]);

  const name = employee?.full_name || talent?.full_name || employeeId;
  const jobTitle = employee?.job_title || talent?.job_title || roleName || "—";
  const dept = employee?.department || talent?.department || departmentName || "—";

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

      <div className={styles.detailHero}>
        <div>
          <h2 className={styles.detailTitle}>{name}</h2>
          <p className={styles.detailDesc}>{jobTitle} · {dept} · {employeeId}</p>
        </div>
        <div className={styles.detailStatRow}>
          {readiness != null && (
            <span><TrendingUp size={14} aria-hidden="true" /> Readiness {readiness}%</span>
          )}
          {career?.assignment?.status === "paused" && (
            <span className={styles.pausedChip}>Paused</span>
          )}
        </div>
      </div>

      <div className={styles.subTabBar} role="tablist">
        {[
          { key: "overview", label: "Overview" },
          { key: "skills", label: "Skills & gaps" },
          { key: "learning", label: "Learning" },
          { key: "career", label: "Career & promotion" },
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
              <p className={styles.inlineNote}>
                Competency avg: {talent?.competency_average ?? talent?.average_competency ?? "—"}
                {" · "}
                Skills tracked: {skills.length || talent?.skill_count || "—"}
                {" · "}
                Learning progress: {learning?.overall_progress ?? learning?.completion_rate ?? talent?.learning_progress ?? "—"}%
              </p>
              {career?.assignment && (
                <p className={styles.inlineNote}>
                  Path: {career.assignment.current_role_title || career.current_role || "—"}
                  {" → "}
                  {career.assignment.target_role_title || career.target_role || "—"}
                  {career.assignment.target_date ? ` · Target ${career.assignment.target_date}` : ""}
                </p>
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

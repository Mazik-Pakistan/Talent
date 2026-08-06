"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import EmployeeShell from "@/components/employee/EmployeeShell";
import RecruiterLoader from "@/components/recruiter/RecruiterLoader";
import dashStyles from "@/app/dashboard/employee/employee-dashboard.module.css";
import { getApiErrorMessage } from "@/services/authService";
import { getMyCareerProgress } from "@/services/careerService";

export const dynamic = "force-dynamic";

export default function EmployeeCareerPage() {
  return (
    <Suspense fallback={<RecruiterLoader />}>
      <EmployeeCareerInner />
    </Suspense>
  );
}

function EmployeeCareerInner() {
  const [assignment, setAssignment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    getMyCareerProgress(token)
      .then((data) => {
        setAssignment(data.assignment || null);
        setError("");
      })
      .catch((err) => setError(getApiErrorMessage(err, "Could not load your career information.")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <EmployeeShell
      activeKey="career"
      title="My Career"
      subtitle={assignment ? `${assignment.current_role_title} → ${assignment.target_role_title}` : ""}
    >
      {loading && <RecruiterLoader inline />}
      {error && <div className={dashStyles.loadError}>{error}</div>}

      {!loading && !error && !assignment && (
        <div className={dashStyles.section}>
          <div className={dashStyles.sectionBody}>
            <div className={dashStyles.emptyState}>
              <div className={dashStyles.emptyTitle}>No career path assigned yet</div>
              <div className={dashStyles.emptySub}>
                Your recruiter will set up your career progression path. Once assigned, you&apos;ll see your career ladder, required learning, and progress here.
              </div>
            </div>
          </div>
        </div>
      )}

      {!loading && !error && assignment && (
        <>
          {/* Hero */}
          <div className={dashStyles.hero}>
            <div>
              <div className={dashStyles.heroEyebrow}>Career Progression</div>
              <h1 style={{ fontSize: "1.4rem", fontWeight: 700 }}>
                {assignment.current_role_title}
                <span style={{ color: "#00A9CE", margin: "0 12px", fontSize: "1.2rem" }}>→</span>
                {assignment.target_role_title}
              </h1>
              <div className={dashStyles.heroMeta}>
                {assignment.current_department && <span>{assignment.current_department} · </span>}
                {assignment.target_date && <span>Target: {assignment.target_date} · </span>}
                <span>Readiness: <b>{assignment.readiness_score}%</b></span>
              </div>
            </div>
          </div>

          {/* Progress Ring */}
          <div className={dashStyles.section}>
            <div className={dashStyles.sectionHead}>
              <div className={dashStyles.sectionHeadLeft}>
                <span className={`${dashStyles.bar} ${dashStyles.cyan}`} />
                <div>
                  <div className={dashStyles.sectionTitle}>Overall Progress</div>
                  <p className={dashStyles.sectionDesc}>
                    Your progress toward {assignment.target_role_title}
                  </p>
                </div>
              </div>
            </div>
            <div className={dashStyles.sectionBody}>
              <div style={{ display: "flex", gap: 32, alignItems: "center", flexWrap: "wrap" }}>
                <ProgressRing percentage={assignment.overall_progress_percent} />
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>
                    Complete all required courses, skills, and certifications to be eligible for promotion.
                  </div>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                    <StatBlock label="Courses" value={assignment.assigned_learning_path?.length || 0} sub={`${completedCount(assignment.assigned_learning_path)} done`} color="#00A9CE" />
                    <StatBlock label="Skills" value={assignment.skills_to_acquire?.length || 0} sub={`${acquiredCount(assignment.skills_to_acquire)} acquired`} color="#27ae60" />
                    <StatBlock label="Certifications" value={assignment.certifications_to_earn?.length || 0} sub={`${earnedCount(assignment.certifications_to_earn)} earned`} color="#f39c12" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Learning Path */}
          {assignment.assigned_learning_path?.length > 0 && (
            <div className={dashStyles.section}>
              <div className={dashStyles.sectionHead}>
                <div className={dashStyles.sectionHeadLeft}>
                  <span className={`${dashStyles.bar} ${dashStyles.navy}`} />
                  <div>
                    <div className={dashStyles.sectionTitle}>Required Learning</div>
                    <p className={dashStyles.sectionDesc}>Complete these courses to progress toward {assignment.target_role_title}</p>
                  </div>
                </div>
              </div>
              <div className={dashStyles.sectionBody}>
                {assignment.assigned_learning_path
                  .sort((a, b) => (a.order || 0) - (b.order || 0))
                  .map((course, idx) => (
                    <div key={idx} style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "12px 16px",
                      marginBottom: 8,
                      borderRadius: 8,
                      background: course.status === "completed" ? "#D4EDDA" : course.status === "in_progress" ? "#CCE5FF" : "#f8f9fa",
                      border: `1px solid ${course.status === "completed" ? "#C3E6CB" : course.status === "in_progress" ? "#B8DAFF" : "#E3E9F0"}`,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{
                          width: 32,
                          height: 32,
                          borderRadius: "50%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 14,
                          fontWeight: 700,
                          background: course.status === "completed" ? "#28a745" : course.status === "in_progress" ? "#007bff" : "#dee2e6",
                          color: course.status === "completed" || course.status === "in_progress" ? "#fff" : "#666",
                        }}>
                          {course.status === "completed" ? "✓" : idx + 1}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{course.course_title}</div>
                          <div style={{ fontSize: 12, color: "#666" }}>
                            {course.source || "Catalog"} {course.mandatory ? "· Required" : "· Optional"}
                            {course.progress_percent > 0 && course.status !== "completed" && ` · ${course.progress_percent}% complete`}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {course.status === "completed" && (
                          <span style={{ fontSize: 12, color: "#28a745", fontWeight: 600 }}>Completed</span>
                        )}
                        {course.status === "in_progress" && (
                          <span style={{ fontSize: 12, color: "#007bff", fontWeight: 600 }}>In Progress</span>
                        )}
                        {course.status === "not_started" && (
                          <span style={{ fontSize: 12, color: "#999" }}>Not Started</span>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Skills to Acquire */}
          {assignment.skills_to_acquire?.length > 0 && (
            <div className={dashStyles.section}>
              <div className={dashStyles.sectionHead}>
                <div className={dashStyles.sectionHeadLeft}>
                  <span className={`${dashStyles.bar} ${dashStyles.orange}`} />
                  <div>
                    <div className={dashStyles.sectionTitle}>Skills to Acquire</div>
                    <p className={dashStyles.sectionDesc}>Build these skills to meet the requirements for {assignment.target_role_title}</p>
                  </div>
                </div>
              </div>
              <div className={dashStyles.sectionBody}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12 }}>
                  {assignment.skills_to_acquire.map((skill, idx) => (
                    <div key={idx} style={{
                      padding: 16,
                      borderRadius: 8,
                      border: `1px solid ${skill.current_status === "acquired" ? "#C3E6CB" : "#E3E9F0"}`,
                      background: skill.current_status === "acquired" ? "#D4EDDA" : "#fff",
                    }}>
                      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{skill.skill}</div>
                      <div style={{ fontSize: 12, color: "#666" }}>
                        {skill.current_proficiency || "None"} → {skill.target_proficiency}
                      </div>
                      {skill.current_status === "acquired" && (
                        <div style={{ marginTop: 8, fontSize: 12, color: "#28a745", fontWeight: 600 }}>✓ Acquired</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Certifications to Earn */}
          {assignment.certifications_to_earn?.length > 0 && (
            <div className={dashStyles.section}>
              <div className={dashStyles.sectionHead}>
                <div className={dashStyles.sectionHeadLeft}>
                  <span className={`${dashStyles.bar} ${dashStyles.green || dashStyles.navy}`} />
                  <div>
                    <div className={dashStyles.sectionTitle}>Certifications to Earn</div>
                    <p className={dashStyles.sectionDesc}>Obtain these certifications for your promotion</p>
                  </div>
                </div>
              </div>
              <div className={dashStyles.sectionBody}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12 }}>
                  {assignment.certifications_to_earn.map((cert, idx) => (
                    <div key={idx} style={{
                      padding: 16,
                      borderRadius: 8,
                      border: `1px solid ${cert.status === "earned" ? "#C3E6CB" : "#FFF3CD"}`,
                      background: cert.status === "earned" ? "#D4EDDA" : "#FFFCF0",
                    }}>
                      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{cert.certification}</div>
                      {cert.mandatory && <span style={{ fontSize: 11, color: "#856404" }}>Required</span>}
                      {cert.status === "earned" && (
                        <div style={{ marginTop: 8, fontSize: 12, color: "#28a745", fontWeight: 600 }}>✓ Earned</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Eligibility Check */}
          <div className={dashStyles.section}>
            <div className={dashStyles.sectionHead}>
              <div className={dashStyles.sectionHeadLeft}>
                <span className={`${dashStyles.bar} ${dashStyles.cyan}`} />
                <div>
                  <div className={dashStyles.sectionTitle}>Eligibility Check</div>
                  <p className={dashStyles.sectionDesc}>Requirements you must meet to be eligible for promotion</p>
                </div>
              </div>
            </div>
            <div className={dashStyles.sectionBody}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
                <EligibilityItem label="Courses Completed" value={`${completedCount(assignment.assigned_learning_path)}/${assignment.assigned_learning_path?.length || 0}`} met={completedCount(assignment.assigned_learning_path) === (assignment.assigned_learning_path?.length || 0)} />
                <EligibilityItem label="Skills Acquired" value={`${acquiredCount(assignment.skills_to_acquire)}/${assignment.skills_to_acquire?.length || 0}`} met={acquiredCount(assignment.skills_to_acquire) === (assignment.skills_to_acquire?.length || 0)} />
                <EligibilityItem label="Certifications" value={`${earnedCount(assignment.certifications_to_earn)}/${assignment.certifications_to_earn?.length || 0}`} met={earnedCount(assignment.certifications_to_earn) === (assignment.certifications_to_earn?.length || 0)} />
              </div>
            </div>
          </div>

          {/* Career Discussions */}
          {assignment.discussions?.length > 0 && (
            <div className={dashStyles.section}>
              <div className={dashStyles.sectionHead}>
                <div className={dashStyles.sectionHeadLeft}>
                  <span className={`${dashStyles.bar} ${dashStyles.navy}`} />
                  <div>
                    <div className={dashStyles.sectionTitle}>Career Discussions</div>
                    <p className={dashStyles.sectionDesc}>Your career discussion history with your recruiter</p>
                  </div>
                </div>
              </div>
              <div className={dashStyles.sectionBody}>
                {assignment.discussions.map((disc, idx) => (
                  <div key={idx} style={{ padding: "12px 0", borderBottom: idx < assignment.discussions.length - 1 ? "1px solid #f0f4f8" : "none" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{disc.discussion_date}</span>
                      <span style={{ fontSize: 12, color: "#666" }}>with {disc.discussed_by_name}</span>
                    </div>
                    {disc.notes && <p style={{ fontSize: 13, color: "#666", margin: "4px 0" }}>{disc.notes}</p>}
                    {disc.action_items?.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "#999", marginBottom: 4 }}>Action Items</div>
                        {disc.action_items.map((item, i) => (
                          <div key={i} style={{ fontSize: 12, color: "#666", marginBottom: 2 }}>• {item}</div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </EmployeeShell>
  );
}

// ─── Helper Components ──────────────────────────────────────────────────────

function ProgressRing({ percentage = 0, size = 120, stroke = 10 }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, Math.max(0, percentage)) / 100) * circumference;
  const color = percentage >= 80 ? "#27ae60" : percentage >= 50 ? "#00A9CE" : "#f39c12";
  return (
    <div style={{ width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#E3E9F0" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        <text x="50%" y="53%" textAnchor="middle" style={{ fontWeight: 800, fontSize: "1.3rem", fill: "#0F2A4A" }}>
          {percentage}%
        </text>
      </svg>
    </div>
  );
}

function StatBlock({ label, value, sub, color }) {
  return (
    <div style={{ textAlign: "center", padding: "8px 16px", borderRadius: 8, background: "#f8f9fa" }}>
      <div style={{ fontSize: 24, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#333" }}>{label}</div>
      <div style={{ fontSize: 11, color: "#999" }}>{sub}</div>
    </div>
  );
}

function EligibilityItem({ label, value, met }) {
  return (
    <div style={{
      padding: 12,
      borderRadius: 8,
      border: `1px solid ${met ? "#C3E6CB" : "#E3E9F0"}`,
      background: met ? "#D4EDDA" : "#fff",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
    }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 13, color: met ? "#28a745" : "#666", fontWeight: met ? 700 : 400 }}>
        {met ? "✓ " : ""}{value}
      </span>
    </div>
  );
}

function completedCount(path) {
  return (path || []).filter((c) => c.status === "completed").length;
}
function acquiredCount(skills) {
  return (skills || []).filter((s) => s.current_status === "acquired").length;
}
function earnedCount(certs) {
  return (certs || []).filter((c) => c.status === "earned").length;
}

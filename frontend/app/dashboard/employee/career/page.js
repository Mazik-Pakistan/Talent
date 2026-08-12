"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import EmployeeShell from "@/components/employee/EmployeeShell";
import RecruiterLoader from "@/components/recruiter/RecruiterLoader";
import FileUploadField from "@/components/FileUploadField";
import dashStyles from "@/app/dashboard/employee/employee-dashboard.module.css";
import { getApiErrorMessage } from "@/services/authService";
import { getMyCareerProgress } from "@/services/careerService";
import { startCourse, uploadCertificate } from "@/services/learningService";

export const dynamic = "force-dynamic";

const STAT_ICONS = {
  book: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  ),
  clock: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  check: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="8 12 11 15 16 9" />
    </svg>
  ),
};

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
  const [busyUid, setBusyUid] = useState("");
  const [certFormFor, setCertFormFor] = useState(null);
  const [certLink, setCertLink] = useState("");
  const [certCompletionDate, setCertCompletionDate] = useState("");
  const [certLearningHours, setCertLearningHours] = useState("");
  const [certFile, setCertFile] = useState(null);
  const [certBusy, setCertBusy] = useState(false);
  const today = new Date().toISOString().split("T")[0];

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

  async function handleStartCourse(course) {
    const token = localStorage.getItem("access_token");
    if (!token || !course?.course_uid) return;
    setBusyUid(course.course_uid);
    try {
      const data = await startCourse(token, course.course_uid);
      const url = data.redirect_url || course.course_url || data.enrollment?.course_url;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      toast.success("Course opened — complete it on the provider site, then submit your certificate link here.");
      load();
    } catch (err) {
      if (course.course_url) {
        window.open(course.course_url, "_blank", "noopener,noreferrer");
        toast.info("Opened course link. After finishing, submit your certificate below.");
      } else {
        toast.error(getApiErrorMessage(err, "Could not open this course. Try Learning → Course Catalog."));
      }
    } finally {
      setBusyUid("");
    }
  }

  async function handleSubmitCertificate(course) {
    const token = localStorage.getItem("access_token");
    const link = certLink.trim();
    if (!token) return;
    if (!link) {
      toast.error("Certificate link is required for recruiter verification.");
      return;
    }
    if (!/^https?:\/\//i.test(link)) {
      toast.error("Certificate link must start with http:// or https://");
      return;
    }
    if (!certCompletionDate) {
      toast.error("Completion date is required.");
      return;
    }
    if (certCompletionDate > today) {
      toast.error("Completion date cannot be in the future.");
      return;
    }
    if (!certLearningHours && certLearningHours !== 0) {
      toast.error("Learning hours are required.");
      return;
    }
    setCertBusy(true);
    try {
      const formData = new FormData();
      formData.append("course_title", course.course_title || "Course certificate");
      if (course.course_uid) formData.append("course_uid", course.course_uid);
      formData.append("source_url", link);
      formData.append("completion_date", certCompletionDate);
      formData.append("learning_hours", certLearningHours);
      if (certFile) formData.append("file", certFile);
      await uploadCertificate(token, formData);
      toast.success("Certificate submitted — your recruiter will verify the link.");
      setCertFormFor(null);
      setCertLink("");
      setCertCompletionDate("");
      setCertLearningHours("");
      setCertFile(null);
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not submit certificate."));
    } finally {
      setCertBusy(false);
    }
  }

  const courses = [...(assignment?.assigned_learning_path || [])].sort(
    (a, b) => (a.order || 0) - (b.order || 0)
  );

  return (
    <EmployeeShell
      activeKey="career"
      title="My Career"
      subtitle={assignment ? `${assignment.current_role_title} → ${assignment.target_role_title}` : ""}
    >
      {error && <div className={dashStyles.loadError}>{error}</div>}

      {!loading && !error && !assignment && (
        <div className={dashStyles.section}>
          <div className={dashStyles.sectionBody}>
            <div className={dashStyles.emptyState}>
              <div className={dashStyles.emptyTitle}>No career path assigned yet</div>
              <div className={dashStyles.emptySub}>
                Paths are created automatically when your job title is in Organization Setup. If this is still empty, ask your recruiter to add your role to the Role ladders.
              </div>
            </div>
          </div>
        </div>
      )}

      {!loading && !error && assignment && (
        <>
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

          <div className={dashStyles.section}>
            <div className={dashStyles.sectionHead}>
              <div className={dashStyles.sectionHeadLeft}>
                <span className={`${dashStyles.bar} ${dashStyles.cyan}`} />
                <div>
                  <div className={dashStyles.sectionTitle}>Overall Progress</div>
                  <p className={dashStyles.sectionDesc}>
                    Complete each required course, then submit the certificate link for recruiter verification.
                  </p>
                </div>
              </div>
            </div>
            <div className={dashStyles.sectionBody}>
              <div style={{ display: "flex", gap: 32, alignItems: "center", flexWrap: "wrap" }}>
                <ProgressRing percentage={assignment.overall_progress_percent} />
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div className={dashStyles.stats} style={{ marginBottom: 0 }}>
                    <div className={dashStyles.statCard}>
                      <div className={dashStyles.statTop}>
                        <span className={`${dashStyles.statIcon} ${dashStyles.cyan}`}>
                          {STAT_ICONS.book}
                        </span>
                      </div>
                      <div className={dashStyles.statValue}>{courses.length}</div>
                      <div className={dashStyles.statLabel}>Courses</div>
                    </div>
                    <div className={dashStyles.statCard}>
                      <div className={dashStyles.statTop}>
                        <span className={`${dashStyles.statIcon} ${dashStyles.orange}`}>
                          {STAT_ICONS.clock}
                        </span>
                      </div>
                      <div className={dashStyles.statValue}>
                        {courses.filter((c) => c.certificate_status === "pending").length}
                      </div>
                      <div className={dashStyles.statLabel}>Awaiting review</div>
                    </div>
                    <div className={dashStyles.statCard}>
                      <div className={dashStyles.statTop}>
                        <span className={`${dashStyles.statIcon} ${dashStyles.green}`}>
                          {STAT_ICONS.check}
                        </span>
                      </div>
                      <div className={dashStyles.statValue}>
                        {courses.filter((c) => c.certificate_status === "verified" || c.status === "completed").length}
                      </div>
                      <div className={dashStyles.statLabel}>Verified</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {courses.length > 0 && (
            <div className={dashStyles.section}>
              <div className={dashStyles.sectionHead}>
                <div className={dashStyles.sectionHeadLeft}>
                  <span className={`${dashStyles.bar} ${dashStyles.navy}`} />
                  <div>
                    <div className={dashStyles.sectionTitle}>Required Learning</div>
                    <p className={dashStyles.sectionDesc}>
                      Each course lists the skills and certifications you gain. Enroll, finish on the provider site, then submit your certificate link.
                    </p>
                  </div>
                </div>
              </div>
              <div className={dashStyles.sectionBody}>
                {courses.map((course, idx) => {
                  const skills = course.skill_progress?.length
                    ? course.skill_progress
                    : (course.skills || []).map((s) => ({
                        skill: typeof s === "string" ? s : s?.skill,
                        status: "pending",
                      }));
                  const certs = course.certification_progress?.length
                    ? course.certification_progress
                    : (course.certifications || []).map((c) => ({
                        certification: typeof c === "string" ? c : c?.certification,
                        status: "pending",
                      }));
                  const isOpen = certFormFor === (course.course_uid || course.course_title);
                  const certStatus = course.certificate_status;
                  const completed = course.status === "completed" || certStatus === "verified";

                  return (
                    <div
                      key={course.course_uid || `${course.course_title}-${idx}`}
                      style={{
                        padding: 16,
                        marginBottom: 12,
                        borderRadius: 12,
                        background: completed ? "#F0F9F4" : certStatus === "pending" ? "#FFF8E8" : "#fff",
                        border: `1px solid ${completed ? "#C3E6CB" : certStatus === "pending" ? "#FFE2A8" : "#E3E9F0"}`,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                        <div style={{ display: "flex", gap: 12, minWidth: 0, flex: 1 }}>
                          <div style={{
                            width: 32,
                            height: 32,
                            borderRadius: "50%",
                            flexShrink: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 14,
                            fontWeight: 700,
                            background: completed ? "#28a745" : course.status === "in_progress" ? "#007bff" : "#dee2e6",
                            color: completed || course.status === "in_progress" ? "#fff" : "#666",
                          }}>
                            {completed ? "✓" : idx + 1}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 15 }}>{course.course_title}</div>
                            <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
                              {course.source || "Catalog"}
                              {course.mandatory ? " · Required" : " · Optional"}
                              {course.progress_percent > 0 && !completed ? ` · ${course.progress_percent}%` : ""}
                              {certStatus === "pending" ? " · Certificate pending review" : ""}
                              {certStatus === "rejected" ? " · Certificate rejected — resubmit" : ""}
                              {certStatus === "verified" ? " · Certificate verified" : ""}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          {!completed && (
                            <button
                              type="button"
                              style={{
                                ...actionBtnStyle("linear-gradient(100deg, var(--blue-strong), var(--blue))", "#fff"),
                                fontWeight: 700,
                              }}
                              disabled={busyUid === course.course_uid}
                              onClick={() => handleStartCourse(course)}
                            >
                              {busyUid === course.course_uid
                                ? "Opening…"
                                : course.status === "in_progress"
                                  ? "Continue course"
                                  : "Enroll / Open course"}
                            </button>
                          )}
                          {!completed && certStatus !== "pending" && (
                            <button
                              type="button"
                              style={actionBtnStyle("#fff", "#0D5C91", "#B8D4E8")}
                              onClick={() => {
                                setCertFormFor(course.course_uid || course.course_title);
                                setCertLink("");
                                setCertCompletionDate("");
                                setCertLearningHours("");
                                setCertFile(null);
                              }}
                            >
                              Submit certificate
                            </button>
                          )}
                          {completed && (
                            <span style={{ fontSize: 12, color: "#28a745", fontWeight: 700 }}>Completed</span>
                          )}
                          {certStatus === "pending" && (
                            <span style={{ fontSize: 12, color: "#b78103", fontWeight: 700 }}>Awaiting recruiter</span>
                          )}
                        </div>
                      </div>

                      {(skills.length > 0 || certs.length > 0) && (
                        <div style={{ marginTop: 12, paddingLeft: 44 }}>
                          {skills.length > 0 && (
                            <div style={{ marginBottom: certs.length ? 10 : 0 }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "#647186", letterSpacing: "0.04em", marginBottom: 6 }}>
                                SKILLS YOU&apos;LL GAIN
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {skills.map((s) => (
                                  <span key={s.skill || s} style={chipStyle(s.status === "acquired")}>
                                    {s.status === "acquired" ? "✓ " : ""}{s.skill || s}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {certs.length > 0 && (
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "#647186", letterSpacing: "0.04em", marginBottom: 6 }}>
                                CERTIFICATIONS FROM THIS COURSE
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {certs.map((c) => (
                                  <span key={c.certification || c} style={chipStyle(c.status === "earned", true)}>
                                    {c.status === "earned" ? "✓ " : ""}{c.certification || c}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {isOpen && (
                        <div style={{
                          marginTop: 14,
                          marginLeft: 44,
                          padding: 14,
                          borderRadius: 10,
                          background: "#F7FAFC",
                          border: "1px solid #D5E4F4",
                        }}>
                          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
                            Submit certificate for recruiter verification
                          </div>
                          <p style={{ fontSize: 12, color: "#647186", margin: "0 0 10px" }}>
                            Paste the public certificate / completion link (required). Optionally attach a PDF or image.
                          </p>
                          <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                            Certificate link *
                          </label>
                          <input
                            type="url"
                            value={certLink}
                            onChange={(e) => setCertLink(e.target.value)}
                            placeholder="https://…"
                            style={inputStyle}
                          />
                          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
                            <div>
                           <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                             Completion date *
                           </label>
                              <input
                                type="date"
                                value={certCompletionDate}
                                max={today}
                                onChange={(e) => setCertCompletionDate(e.target.value)}
                                style={{ ...inputStyle, maxWidth: 200 }}
                              />
                            </div>
                            <div>
                           <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                             Learning hours *
                           </label>
                              <input
                                type="number"
                                min="0"
                                step="0.5"
                                placeholder="e.g. 2"
                                value={certLearningHours}
                                onChange={(e) => setCertLearningHours(e.target.value)}
                                style={{ ...inputStyle, maxWidth: 160 }}
                              />
                            </div>
                          </div>
                          <div style={{ marginTop: 10 }}>
                            <FileUploadField
                              caption="Certificate file (optional)"
                              label="Upload document"
                              replaceLabel="Replace document"
                              accept=".pdf,.png,.jpg,.jpeg"
                              onChange={(e) => setCertFile(e.target.files?.[0] || null)}
                              selected={!!certFile}
                            />
                            {certFile && (
                              <div
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 6,
                                  marginTop: 6,
                                  padding: "5px 10px",
                                  borderRadius: 7,
                                  background: "#eef6ed",
                                  border: "1px solid #c3d9bf",
                                  fontSize: 12,
                                  fontWeight: 600,
                                  color: "#2d5016",
                                }}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                                  <polyline points="14 2 14 8 20 8" />
                                </svg>
                                {certFile.name}
                              </div>
                            )}
                          </div>
                          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                            <button
                              type="button"
                              style={actionBtnStyle("linear-gradient(100deg, var(--blue-strong), var(--blue))", "#fff")}
                              disabled={certBusy}
                              onClick={() => handleSubmitCertificate(course)}
                            >
                              {certBusy ? "Submitting…" : "Send to recruiter"}
                            </button>
                            <button
                              type="button"
                              style={actionBtnStyle("#fff", "#0c2a41", "#dfe9f6")}
                              onClick={() => {
                                setCertFormFor(null);
                                setCertLink("");
                                setCertCompletionDate("");
                                setCertLearningHours("");
                                setCertFile(null);
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className={dashStyles.section}>
            <div className={dashStyles.sectionHead}>
              <div className={dashStyles.sectionHeadLeft}>
                <span className={`${dashStyles.bar} ${dashStyles.cyan}`} />
                <div>
                  <div className={dashStyles.sectionTitle}>Eligibility Check</div>
                  <p className={dashStyles.sectionDesc}>Course completion is confirmed after recruiter verifies your certificate link</p>
                </div>
              </div>
            </div>
            <div className={dashStyles.sectionBody}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
                <EligibilityItem
                  label="Courses completed"
                  value={`${completedCount(courses)}/${courses.length}`}
                  met={courses.length > 0 && completedCount(courses) === courses.length}
                />
                <EligibilityItem
                  label="Certificates verified"
                  value={`${courses.filter((c) => c.certificate_status === "verified").length}/${courses.filter((c) => (c.certifications || []).length > 0 || c.certificate_status).length || courses.length}`}
                  met={courses.length > 0 && courses.every((c) => c.status === "completed" || c.certificate_status === "verified")}
                />
              </div>
            </div>
          </div>

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

function actionBtnStyle(bg, color, border) {
  return {
    background: bg,
    color,
    border: `1px solid ${border || bg}`,
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  };
}

function chipStyle(done, cert = false) {
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    background: done ? (cert ? "#FFF4D6" : "#E8F8EF") : "#EEF3F8",
    color: done ? (cert ? "#8A6A00" : "#1B7A45") : "#4A5B70",
    border: `1px solid ${done ? (cert ? "#F0D78C" : "#B7E4C7") : "#D7E2EC"}`,
  };
}

const inputStyle = {
  width: "100%",
  maxWidth: 480,
  padding: "9px 12px",
  borderRadius: 8,
  border: "1px solid #D5E4F4",
  fontSize: 13,
};

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

function completedCount(items) {
  return (items || []).filter((i) => i.status === "completed" || i.certificate_status === "verified").length;
}
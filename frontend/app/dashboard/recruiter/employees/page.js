"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import RecruiterShell from "@/components/recruiter/RecruiterShell";
import RecruiterLoader from "@/components/recruiter/RecruiterLoader";
import styles from "@/components/recruiter/recruiter-shell.module.css";
import { RECRUITER_DEPARTMENTS, RECRUITER_DESIGNATIONS } from "@/components/recruiter/recruiterOptions";
import {
  exportEmployeesCsv,
  getApiErrorMessage,
  listEmployees,
} from "@/services/authService";
import SendReminderModal from "@/components/recruiter/SendReminderModal";
import { toast } from "react-toastify";
import {
  clearRecruiterContext,
  publishRecruiterContext,
} from "@/lib/ai/recruiterContext";

export default function RecruiterEmployeesPage() {
  const router = useRouter();
  const [employees, setEmployees] = useState([]);
  const [employeeTotal, setEmployeeTotal] = useState(0);
  const [employeePage, setEmployeePage] = useState(1);
  const [employeePages, setEmployeePages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reminderTarget, setReminderTarget] = useState(null);
  const [dirFilters, setDirFilters] = useState({
    q: "",
    department: "",
    job_title: "",
    status: "active",
    employee_id: "",
    profile_status: "",
    history_bucket: "active",
  });

  useEffect(() => {
    publishRecruiterContext({
      section: "employee_directory",
      hint: "Filter the directory, export CSV, or open a profile. Career timeline, resign/exit, and prior tenures live inside View profile → Career.",
      fields: ["q", "employee_id", "department", "job_title", "status", "profile_status"],
    });
    return () => clearRecruiterContext();
  }, []);

  const loadEmployees = useCallback(async (page = 1, filters = dirFilters) => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    // No global loading for subsequent fetches, only initial one
    try {
      const data = await listEmployees(accessToken, {
        q: filters.q || undefined,
        department: filters.department || undefined,
        job_title: filters.job_title || undefined,
        status: filters.status || undefined,
        employee_id: filters.employee_id || undefined,
        profile_status: filters.profile_status || undefined,
        history_bucket: filters.history_bucket || "active",
        page,
        page_size: 10,
        sort: "full_name",
      });
      setEmployees(data.employees || []);
      setEmployeeTotal(data.total || 0);
      setEmployeePage(data.page || 1);
      setEmployeePages(data.pages || 1);
      setError("");
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not load employee directory."));
    } finally {
      // Only turn off the initial loader once
      if (loading) setLoading(false);
    }
  }, [dirFilters, loading]);

  useEffect(() => {
    loadEmployees(1);
  }, []); // Initial load only once

  async function handleExport() {
    const accessToken = localStorage.getItem("access_token");
    const blob = await exportEmployeesCsv(accessToken, {
      q: dirFilters.q || undefined,
      department: dirFilters.department || undefined,
      job_title: dirFilters.job_title || undefined,
      status: dirFilters.status || undefined,
      employee_id: dirFilters.employee_id || undefined,
      history_bucket: dirFilters.history_bucket || undefined,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "employees.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <RecruiterShell
        activeKey="employees"
        title="Employee directory"
        subtitle="Loading employee data…"
      >
        <RecruiterLoader />
      </RecruiterShell>
    );
  }

  return (
    <RecruiterShell
      activeKey="employees"
      title={dirFilters.history_bucket === "historical" ? "Historical employees" : "Employee directory"}
      subtitle={
        dirFilters.history_bucket === "historical"
          ? "Former employees who have not been rehired — open a profile for career timeline, or invite again with the same email"
          : "Search, filter, export, and open profiles. Career timeline & resign/exit live inside each profile."
      }
    >
      {error && <div className={styles.formMessage} role="alert">{error}</div>}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionHeadLeft}>
            <div className={`${styles.bar} ${styles.navy}`} />
            <div>
              <div className={styles.sectionTitle}>Directory filters</div>
              <div className={styles.sectionDesc}>Search across {employeeTotal} employee records and export results.</div>
            </div>
          </div>
          <div className={styles.actions} style={{ gap: 8 }}>
            <button
              type="button"
              className={dirFilters.history_bucket === "active" ? styles.primaryButton : styles.secondaryButton}
              onClick={() => {
                const next = { ...dirFilters, history_bucket: "active", status: "active" };
                setDirFilters(next);
                loadEmployees(1, next);
              }}
            >
              Active
            </button>
            <button
              type="button"
              className={dirFilters.history_bucket === "historical" ? styles.primaryButton : styles.secondaryButton}
              onClick={() => {
                const next = { ...dirFilters, history_bucket: "historical", status: "" };
                setDirFilters(next);
                loadEmployees(1, next);
              }}
            >
              Historical
            </button>
          </div>
        </div>
        <div className={styles.sectionBody}>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>Search</span>
              <input value={dirFilters.q} onChange={(e) => setDirFilters({ ...dirFilters, q: e.target.value })} placeholder="Name, email, employee ID" />
            </label>
            <label className={styles.field}>
              <span>Employee ID</span>
              <input value={dirFilters.employee_id} onChange={(e) => setDirFilters({ ...dirFilters, employee_id: e.target.value })} />
            </label>
            <label className={styles.field}>
              <span>Department</span>
              <select value={dirFilters.department} onChange={(e) => setDirFilters({ ...dirFilters, department: e.target.value })}>
                <option value="">All</option>
                {RECRUITER_DEPARTMENTS.map((department) => (
                  <option key={department} value={department}>{department}</option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Designation</span>
              <select value={dirFilters.job_title} onChange={(e) => setDirFilters({ ...dirFilters, job_title: e.target.value })}>
                <option value="">All</option>
                {RECRUITER_DESIGNATIONS.map((designation) => (
                  <option key={designation} value={designation}>{designation}</option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Status</span>
              <select value={dirFilters.status} onChange={(e) => setDirFilters({ ...dirFilters, status: e.target.value })}>
                {dirFilters.history_bucket === "historical" ? (
                  <>
                    <option value="">All historical</option>
                    <option value="resigned">Resigned</option>
                    <option value="terminated">Terminated</option>
                    <option value="exited">Exited</option>
                  </>
                ) : (
                  <>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="on_leave">On leave</option>
                  </>
                )}
              </select>
            </label>
            <label className={styles.field}>
              <span>Profile</span>
              <select value={dirFilters.profile_status} onChange={(e) => setDirFilters({ ...dirFilters, profile_status: e.target.value })}>
                <option value="">All</option>
                <option value="incomplete">Incomplete</option>
                <option value="complete">Complete</option>
              </select>
            </label>
            <div className={styles.actions}>
              <button type="button" className={styles.primaryButton} onClick={() => loadEmployees(1, dirFilters)}>Apply filters</button>
              <button type="button" className={styles.secondaryButton} onClick={handleExport}>Export CSV</button>
            </div>
          </div>
          {employees.length ? (
            <>
              <ul className={styles.miniList}>
                {employees.map((employee) => (
                  <li className={styles.miniListItem} key={employee.employee_id || employee.id}>
                    <div>
                      <strong>{employee.full_name}</strong>
                      <div className={styles.mutedText}>
                        {employee.employee_id} · {employee.email} · {employee.job_title} · {employee.department}
                        {employee.history_bucket === "historical" || ["resigned", "terminated", "exited"].includes(employee.status) ? (
                          <> · <span style={{ textTransform: "capitalize" }}>{employee.exit_type || employee.status}</span></>
                        ) : null}
                      </div>
                      {employee.profile_status === "incomplete" && (
                        <div style={{ marginTop: 6 }}>
                          <span
                            className={styles.chip}
                            style={{
                              background: "var(--orange-light)",
                              color: "var(--orange)",
                              textTransform: "capitalize",
                            }}
                          >
                            Profile incomplete
                          </span>
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      {dirFilters.history_bucket !== "historical" ? (
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={() =>
                            setReminderTarget({
                              id: employee.employee_id || employee.id,
                              full_name: employee.full_name,
                              role: "employee",
                            })
                          }
                        >
                          Remind
                        </button>
                      ) : null}
                      <button type="button" className={styles.primaryButton} onClick={() => router.push(`/dashboard/recruiter/employees/${employee.employee_id || employee.id}`)}>View profile</button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className={styles.actions} style={{ marginTop: 12 }}>
                <button type="button" className={styles.secondaryButton} disabled={employeePage <= 1} onClick={() => loadEmployees(employeePage - 1, dirFilters)}>Previous</button>
                <span className={styles.mutedText}>Page {employeePage} / {employeePages}</span>
                <button type="button" className={styles.secondaryButton} disabled={employeePage >= employeePages} onClick={() => loadEmployees(employeePage + 1, dirFilters)}>Next</button>
              </div>
            </>
          ) : (
            <p className={styles.emptySub}>No employees match these filters.</p>
          )}
        </div>
      </div>

      <SendReminderModal
        open={Boolean(reminderTarget)}
        target={reminderTarget}
        accessToken={typeof window !== "undefined" ? localStorage.getItem("access_token") : null}
        defaultKind={reminderTarget?.defaultKind || "profile"}
        onClose={() => setReminderTarget(null)}
        onSent={(data) => toast.success(data?.message || "Reminder sent.")}
      />
    </RecruiterShell>
  );
}
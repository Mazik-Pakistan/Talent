"use client";

import { useCallback, useEffect, useState } from "react";
import RecruiterShell from "@/components/recruiter/RecruiterShell";
import styles from "@/components/recruiter/recruiter-shell.module.css";
import {
  addCareerEvent,
  exportEmployeesCsv,
  getApiErrorMessage,
  getEmployeeDetail,
  listEmployees,
} from "@/services/authService";

export default function RecruiterEmployeesPage() {
  const [employees, setEmployees] = useState([]);
  const [employeeTotal, setEmployeeTotal] = useState(0);
  const [employeePage, setEmployeePage] = useState(1);
  const [employeePages, setEmployeePages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [dirFilters, setDirFilters] = useState({ q: "", department: "", job_title: "", status: "active", employee_id: "" });
  const [careerForm, setCareerForm] = useState({ event_type: "promoted", effective_date: "", to_title: "", to_department: "", to_manager: "", note: "" });

  const loadEmployees = useCallback(async (page = 1, filters = dirFilters) => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      const data = await listEmployees(accessToken, {
        q: filters.q || undefined,
        department: filters.department || undefined,
        job_title: filters.job_title || undefined,
        status: filters.status || undefined,
        employee_id: filters.employee_id || undefined,
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
      setLoading(false);
    }
  }, [dirFilters]);

  useEffect(() => {
    loadEmployees(1);
  }, [loadEmployees]);

  async function handleViewProfile(employee) {
    const accessToken = localStorage.getItem("access_token");
    const id = employee.employee_id || employee.id || employee.email;
    if (!id) {
      setError("This employee record has no ID to open.");
      return;
    }
    try {
      const data = await getEmployeeDetail(id, accessToken);
      setSelectedEmployee(data.employee);
      setCareerForm({
        event_type: "promoted",
        effective_date: new Date().toISOString().slice(0, 10),
        to_title: data.employee.job_title || "",
        to_department: data.employee.department || "",
        to_manager: data.employee.reporting_manager || "",
        note: "",
      });
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not open employee profile."));
    }
  }

  async function handleExport() {
    const accessToken = localStorage.getItem("access_token");
    const blob = await exportEmployeesCsv(accessToken, {
      q: dirFilters.q || undefined,
      department: dirFilters.department || undefined,
      job_title: dirFilters.job_title || undefined,
      status: dirFilters.status || undefined,
      employee_id: dirFilters.employee_id || undefined,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "employees.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleSaveCareerEvent() {
    const accessToken = localStorage.getItem("access_token");
    if (!selectedEmployee) return;
    const data = await addCareerEvent(selectedEmployee.employee_id, {
      event_type: careerForm.event_type,
      effective_date: careerForm.effective_date,
      to_title: careerForm.to_title || null,
      to_department: careerForm.to_department || null,
      to_manager: careerForm.to_manager || null,
      note: careerForm.note || null,
    }, accessToken);
    setSelectedEmployee({ ...selectedEmployee, career: data.events });
    await loadEmployees(employeePage);
  }

  return (
    <RecruiterShell activeKey="employees" title="Employee directory" subtitle="Search, filter, export, and review employee profiles">
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
              <input value={dirFilters.department} onChange={(e) => setDirFilters({ ...dirFilters, department: e.target.value })} />
            </label>
            <label className={styles.field}>
              <span>Designation</span>
              <input value={dirFilters.job_title} onChange={(e) => setDirFilters({ ...dirFilters, job_title: e.target.value })} />
            </label>
            <label className={styles.field}>
              <span>Status</span>
              <select value={dirFilters.status} onChange={(e) => setDirFilters({ ...dirFilters, status: e.target.value })}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="on_leave">On leave</option>
                <option value="">All statuses</option>
              </select>
            </label>
            <div className={styles.actions}>
              <button type="button" className={styles.primaryButton} onClick={() => loadEmployees(1, dirFilters)}>Apply filters</button>
              <button type="button" className={styles.secondaryButton} onClick={handleExport}>Export CSV</button>
            </div>
          </div>
          {loading ? <p className={styles.emptySub}>Loading…</p> : employees.length ? (
            <>
              <ul className={styles.miniList}>
                {employees.map((employee) => (
                  <li className={styles.miniListItem} key={employee.employee_id || employee.id}>
                    <div>
                      <strong>{employee.full_name}</strong>
                      <div className={styles.mutedText}>{employee.employee_id} · {employee.email} · {employee.job_title} · {employee.department}</div>
                    </div>
                    <button type="button" className={styles.secondaryButton} onClick={() => handleViewProfile(employee)}>View profile</button>
                  </li>
                ))}
              </ul>
              <div className={styles.actions} style={{ marginTop: 12 }}>
                <button type="button" className={styles.secondaryButton} disabled={employeePage <= 1} onClick={() => loadEmployees(employeePage - 1)}>Previous</button>
                <span className={styles.mutedText}>Page {employeePage} / {employeePages}</span>
                <button type="button" className={styles.secondaryButton} disabled={employeePage >= employeePages} onClick={() => loadEmployees(employeePage + 1)}>Next</button>
              </div>
            </>
          ) : <p className={styles.emptySub}>No employees match these filters.</p>}
        </div>
      </div>

      {selectedEmployee && (
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionHeadLeft}>
              <div className={`${styles.bar} ${styles.purple}`} />
              <div>
                <div className={styles.sectionTitle}>{selectedEmployee.full_name}</div>
                <div className={styles.sectionDesc}>{selectedEmployee.employee_id} · {selectedEmployee.job_title} · {selectedEmployee.department}</div>
              </div>
            </div>
          </div>
          <div className={styles.sectionBody}>
            <p className={styles.instruction}>Manager: {selectedEmployee.reporting_manager || "—"} · Joined: {formatDate(selectedEmployee.start_date)} · Status: {selectedEmployee.status}</p>
            <h3 className={styles.sectionTitle} style={{ fontSize: 14, marginBottom: 10 }}>Career timeline</h3>
            <ul className={styles.miniList}>
              {(selectedEmployee.career || []).map((event) => (
                <li className={styles.miniListItem} key={event.id}>
                  <div>
                    <strong>{event.event_type}</strong>
                    <div className={styles.mutedText}>{event.effective_date} · {event.to_title || event.to_department || event.note || "—"}</div>
                  </div>
                </li>
              ))}
            </ul>
            <h3 className={styles.sectionTitle} style={{ fontSize: 14, marginTop: 16, marginBottom: 10 }}>Add career event</h3>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span>Event type</span>
                <select value={careerForm.event_type} onChange={(e) => setCareerForm({ ...careerForm, event_type: e.target.value })}>
                  <option value="promoted">Promoted</option>
                  <option value="title_change">Title change</option>
                  <option value="department_change">Department change</option>
                  <option value="manager_change">Manager change</option>
                  <option value="status_change">Status change</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>Effective date</span>
                <input type="date" value={careerForm.effective_date} onChange={(e) => setCareerForm({ ...careerForm, effective_date: e.target.value })} />
              </label>
              <label className={styles.field}>
                <span>New title</span>
                <input value={careerForm.to_title} onChange={(e) => setCareerForm({ ...careerForm, to_title: e.target.value })} />
              </label>
              <label className={styles.field}>
                <span>New department</span>
                <input value={careerForm.to_department} onChange={(e) => setCareerForm({ ...careerForm, to_department: e.target.value })} />
              </label>
              <label className={styles.field}>
                <span>New manager</span>
                <input value={careerForm.to_manager} onChange={(e) => setCareerForm({ ...careerForm, to_manager: e.target.value })} />
              </label>
              <label className={styles.field}>
                <span>Note</span>
                <input value={careerForm.note} onChange={(e) => setCareerForm({ ...careerForm, note: e.target.value })} />
              </label>
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={() => setSelectedEmployee(null)}>Close</button>
              <button type="button" className={styles.primaryButton} onClick={handleSaveCareerEvent}>Save event</button>
            </div>
          </div>
        </div>
      )}
    </RecruiterShell>
  );
}

function formatDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

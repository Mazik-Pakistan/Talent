"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import RecruiterShell from "@/components/recruiter/RecruiterShell";
import RecruiterLoader from "@/components/recruiter/RecruiterLoader";
import ProtectedRecruiterRoute from "@/components/ProtectedRecruiterRoute";
import { useOrgFrameworkOptions } from "@/hooks/useOrgFrameworkOptions";
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
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Mail,
  Search,
  UserCheck,
  Users,
  Filter,
  RotateCcw,
} from "lucide-react";
import s from "./employees.module.css";

const COLUMNS = [
  { key: "full_name", label: "Employee" },
  { key: "employee_id", label: "ID" },
  { key: "department", label: "Department" },
  { key: "job_title", label: "Designation" },
  { key: "status", label: "Status" },
  { key: "profile_status", label: "Profile" },
];

function getInitials(name) {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function statusPill(status) {
  const map = {
    active: { cls: s.pillGreen, label: "Active" },
    inactive: { cls: s.pillNeutral, label: "Inactive" },
    on_leave: { cls: s.pillOrange, label: "On Leave" },
    resigned: { cls: s.pillBlue, label: "Resigned" },
    terminated: { cls: s.pillRed, label: "Terminated" },
    exited: { cls: s.pillRed, label: "Exited" },
  };
  return map[status] || { cls: s.pillNeutral, label: status || "—" };
}

function profilePill(status) {
  if (status === "incomplete") return { cls: s.pillOrange, label: "Incomplete" };
  if (status === "complete") return { cls: s.pillGreen, label: "Complete" };
  return null;
}

export default function RecruiterEmployeesPage() {
  return (
    <ProtectedRecruiterRoute requiredCapability="employees">
      <RecruiterEmployeesPageContent />
    </ProtectedRecruiterRoute>
  );
}

function RecruiterEmployeesPageContent() {
  const router = useRouter();
  const { departments: departmentOptions, roleNames: designationOptions } =
    useOrgFrameworkOptions();

  const [employees, setEmployees] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reminderTarget, setReminderTarget] = useState(null);

  const [filters, setFilters] = useState({
    q: "",
    department: "",
    job_title: "",
    status: "active",
    employee_id: "",
    profile_status: "",
    history_bucket: "active",
  });

  const [sortKey, setSortKey] = useState("full_name");
  const [sortDir, setSortDir] = useState("asc");

  useEffect(() => {
    publishRecruiterContext({
      section: "employee_directory",
      hint: "Filter the directory, export CSV, or open a profile. Career timeline, resign/exit, and prior tenures live inside View profile → Career.",
      fields: ["q", "employee_id", "department", "job_title", "status", "profile_status"],
    });
    return () => clearRecruiterContext();
  }, []);

  const loadEmployees = useCallback(
    async (p = 1, f = filters) => {
      const token = localStorage.getItem("access_token");
      if (!token) return;
      try {
        const data = await listEmployees(token, {
          q: f.q || undefined,
          department: f.department || undefined,
          job_title: f.job_title || undefined,
          status: f.status || undefined,
          employee_id: f.employee_id || undefined,
          profile_status: f.profile_status || undefined,
          history_bucket: f.history_bucket || "active",
          page: p,
          page_size: 15,
          sort: sortKey,
        });
        setEmployees(data.employees || []);
        setTotal(data.total || 0);
        setPage(data.page || 1);
        setPages(data.pages || 1);
        setError("");
      } catch (err) {
        setError(getApiErrorMessage(err, "Could not load employees."));
      } finally {
        if (loading) setLoading(false);
      }
    },
    [filters, sortKey, loading],
  );

  useEffect(() => {
    const timer = setTimeout(() => loadEmployees(1), 0);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSort(key) {
    let nextDir = sortDir;
    if (key === sortKey) {
      nextDir = sortDir === "asc" ? "desc" : "asc";
    } else {
      nextDir = "asc";
    }
    setSortKey(key);
    setSortDir(nextDir);
  }

  function handleApplyFilters() {
    loadEmployees(1, filters);
  }

  function handleResetFilters() {
    const reset = {
      q: "",
      department: "",
      job_title: "",
      status: "active",
      employee_id: "",
      profile_status: "",
      history_bucket: "active",
    };
    setFilters(reset);
    loadEmployees(1, reset);
  }

  function switchBucket(bucket) {
    const next = {
      ...filters,
      history_bucket: bucket,
      status: bucket === "active" ? "active" : "",
    };
    setFilters(next);
    loadEmployees(1, next);
  }

  async function handleExport() {
    const token = localStorage.getItem("access_token");
    const blob = await exportEmployeesCsv(token, {
      q: filters.q || undefined,
      department: filters.department || undefined,
      job_title: filters.job_title || undefined,
      status: filters.status || undefined,
      employee_id: filters.employee_id || undefined,
      history_bucket: filters.history_bucket || undefined,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "employees.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const sortVersion = `${sortKey}:${sortDir}`;
  useEffect(() => {
    if (!loading) {
      const timer = setTimeout(() => loadEmployees(1), 0);
      return () => clearTimeout(timer);
    }
  }, [sortVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const SortIcon = ({ colKey }) => {
    if (sortKey !== colKey) return <ArrowUpDown size={12} />;
    return sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
  };

  const empId = (e) => e.employee_id || e.id;

  if (loading) {
    return (
      <RecruiterShell
        activeKey="employees"
        capability="employees"
        title="Employee directory"
        subtitle="Loading..."
      >
        <RecruiterLoader />
      </RecruiterShell>
    );
  }

  return (
    <RecruiterShell
      activeKey="employees"
      capability="employees"
      title={
        filters.history_bucket === "historical"
          ? "Historical employees"
          : "Employee directory"
      }
      subtitle={
        filters.history_bucket === "historical"
          ? "Former employees — open a profile for career timeline, or invite again with the same email"
          : `Manage ${total} employees. Search, filter, export, and open profiles.`
      }
    >
      {error && (
        <div
          style={{
            padding: "10px 16px",
            borderRadius: 10,
            background: "var(--red-light)",
            color: "var(--red)",
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 14,
          }}
          role="alert"
        >
          {error}
        </div>
      )}

      <div>
        {/* Filter Bar */}
        <div className={s.filterBar}>
          <label className={`${s.filterField} ${s.search}`}>
            <span>Search</span>
            <div style={{ position: "relative" }}>
              <Search
                size={14}
                style={{
                  position: "absolute",
                  left: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--text-faint)",
                }}
              />
              <input
                value={filters.q}
                onChange={(e) =>
                  setFilters({ ...filters, q: e.target.value })
                }
                placeholder="Name, email, employee ID..."
                onKeyDown={(e) => e.key === "Enter" && handleApplyFilters()}
                style={{ paddingLeft: 32 }}
              />
            </div>
          </label>
          <label className={s.filterField}>
            <span>Employee ID</span>
            <input
              value={filters.employee_id}
              onChange={(e) =>
                setFilters({ ...filters, employee_id: e.target.value })
              }
              placeholder="EMP-..."
              onKeyDown={(e) => e.key === "Enter" && handleApplyFilters()}
            />
          </label>
          <label className={s.filterField}>
            <span>Department</span>
            <select
              value={filters.department}
              onChange={(e) =>
                setFilters({ ...filters, department: e.target.value })
              }
            >
              <option value="">All departments</option>
              {departmentOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className={s.filterField}>
            <span>Designation</span>
            <select
              value={filters.job_title}
              onChange={(e) =>
                setFilters({ ...filters, job_title: e.target.value })
              }
            >
              <option value="">All designations</option>
              {designationOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className={s.filterField}>
            <span>Status</span>
            <select
              value={filters.status}
              onChange={(e) =>
                setFilters({ ...filters, status: e.target.value })
              }
            >
              {filters.history_bucket === "historical" ? (
                <>
                  <option value="">All</option>
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
          <label className={s.filterField}>
            <span>Profile</span>
            <select
              value={filters.profile_status}
              onChange={(e) =>
                setFilters({ ...filters, profile_status: e.target.value })
              }
            >
              <option value="">All</option>
              <option value="incomplete">Incomplete</option>
              <option value="complete">Complete</option>
            </select>
          </label>
          <div className={s.filterActions}>
            <button
              type="button"
              className="btn btnPrimary"
              style={{
                fontSize: 12,
                padding: "7px 14px",
                minHeight: 32,
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
              onClick={handleApplyFilters}
            >
              <Filter size={13} /> Apply
            </button>
            <button
              type="button"
              className="btn btnGhost"
              style={{ fontSize: 12, padding: "7px 10px", minHeight: 32 }}
              onClick={handleResetFilters}
            >
              <RotateCcw size={13} />
            </button>
            <button
              type="button"
              className="btn btnSecondary"
              style={{
                fontSize: 12,
                padding: "7px 14px",
                minHeight: 32,
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
              onClick={handleExport}
            >
              <Download size={13} /> Export
            </button>
          </div>
        </div>

        {/* Table Card */}
        <div className={s.tableCard}>
          {/* Active / Historical toggle */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 16px",
              borderBottom: "1px solid var(--border-soft)",
            }}
          >
            <div className={s.tabGroup}>
              <button
                type="button"
                className={`${s.tabBtn} ${filters.history_bucket === "active" ? s.tabBtnActive : ""}`}
                onClick={() => switchBucket("active")}
              >
                <UserCheck
                  size={13}
                  style={{ marginRight: 5, verticalAlign: -2 }}
                />
                Active
              </button>
              <button
                type="button"
                className={`${s.tabBtn} ${filters.history_bucket === "historical" ? s.tabBtnActive : ""}`}
                onClick={() => switchBucket("historical")}
              >
                <Users
                  size={13}
                  style={{ marginRight: 5, verticalAlign: -2 }}
                />
                Historical
              </button>
            </div>
            <span className={s.muted}>
              {total} record{total !== 1 ? "s" : ""}
            </span>
          </div>

          {employees.length > 0 ? (
            <>
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      {COLUMNS.map((col) => (
                        <th
                          key={col.key}
                          className={
                            sortKey === col.key ? s.sorted : undefined
                          }
                          onClick={() => handleSort(col.key)}
                        >
                          {col.label}
                          <span className={s.sortIcon}>
                            <SortIcon colKey={col.key} />
                          </span>
                        </th>
                      ))}
                      <th style={{ textAlign: "right", cursor: "default" }}>
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((emp) => {
                      const sp = statusPill(emp.status);
                      const pp = profilePill(emp.profile_status);
                      return (
                        <tr key={empId(emp)}>
                          <td>
                            <div className={s.avatarCell}>
                              <div className={s.avatar}>
                                {getInitials(emp.full_name)}
                              </div>
                              <div>
                                <div className={s.avatarName}>
                                  {emp.full_name}
                                </div>
                                <div className={s.avatarEmail}>{emp.email}</div>
                              </div>
                            </div>
                          </td>
                          <td className={s.muted}>{emp.employee_id}</td>
                          <td>
                            <span className={`${s.pill} ${s.pillBlue}`}>
                              {emp.department || "—"}
                            </span>
                          </td>
                          <td>{emp.job_title || "—"}</td>
                          <td>
                            <span className={`${s.pill} ${sp.cls}`}>
                              {sp.label}
                            </span>
                          </td>
                          <td>
                            {pp ? (
                              <span className={`${s.pill} ${pp.cls}`}>
                                {pp.label}
                              </span>
                            ) : (
                              <span className={s.muted}>—</span>
                            )}
                          </td>
                          <td>
                            <div className={s.actionsCell}>
                              {filters.history_bucket !== "historical" && (
                                <button
                                  type="button"
                                  className="btn btnGhost"
                                  style={{
                                    fontSize: 11,
                                    padding: "4px 8px",
                                    minHeight: 26,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 4,
                                  }}
                                  onClick={() =>
                                    setReminderTarget({
                                      id: empId(emp),
                                      full_name: emp.full_name,
                                      role: "employee",
                                    })
                                  }
                                >
                                  <Mail size={12} /> Remind
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn btnPrimary"
                                style={{
                                  fontSize: 11,
                                  padding: "4px 10px",
                                  minHeight: 26,
                                  borderRadius: 7,
                                }}
                                onClick={() =>
                                  router.push(
                                    `/dashboard/recruiter/employees/${empId(emp)}`,
                                  )
                                }
                              >
                                View
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination Footer */}
              <div className={s.footer}>
                <div className={s.footerLeft}>
                  Page {page} of {pages}
                </div>
                <div className={s.footerPagination}>
                  <button
                    type="button"
                    className={s.pageBtn}
                    disabled={page <= 1}
                    onClick={() => loadEmployees(page - 1)}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  {Array.from({ length: Math.min(pages, 5) }, (_, i) => {
                    let pNum;
                    if (pages <= 5) {
                      pNum = i + 1;
                    } else if (page <= 3) {
                      pNum = i + 1;
                    } else if (page >= pages - 2) {
                      pNum = pages - 4 + i;
                    } else {
                      pNum = page - 2 + i;
                    }
                    return (
                      <button
                        key={pNum}
                        type="button"
                        className={`${s.pageBtn} ${pNum === page ? s.pageBtnActive : ""}`}
                        onClick={() => loadEmployees(pNum)}
                      >
                        {pNum}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className={s.pageBtn}
                    disabled={page >= pages}
                    onClick={() => loadEmployees(page + 1)}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className={s.emptyState}>
              <Users
                size={40}
                style={{ marginBottom: 12, color: "var(--text-faint)" }}
              />
              <div style={{ fontWeight: 650, color: "var(--navy)", fontSize: 14 }}>
                No employees found
              </div>
              <div style={{ marginTop: 4 }}>
                Try adjusting your filters or search query.
              </div>
            </div>
          )}
        </div>
      </div>

      <SendReminderModal
        open={Boolean(reminderTarget)}
        target={reminderTarget}
        accessToken={
          typeof window !== "undefined"
            ? localStorage.getItem("access_token")
            : null
        }
        defaultKind={reminderTarget?.defaultKind || "profile"}
        onClose={() => setReminderTarget(null)}
        onSent={(data) => toast.success(data?.message || "Reminder sent.")}
      />
    </RecruiterShell>
  );
}

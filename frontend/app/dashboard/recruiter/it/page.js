"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import RecruiterShell from "@/components/recruiter/RecruiterShell";
import RecruiterLoader from "@/components/recruiter/RecruiterLoader";
import ProtectedRecruiterRoute from "@/components/ProtectedRecruiterRoute";
import ConfirmDialog from "@/components/ConfirmDialog";
import styles from "@/components/recruiter/recruiter-shell.module.css";
import {
  cancelItServiceRequest,
  createItServiceRequest,
  getApiErrorMessage,
  getItOfficersOverview,
  listEmployees,
  listItServiceRequests,
  sendItServiceRequest,
} from "@/services/authService";
import { parseFieldErrors } from "@/lib/apiFieldErrors";
import FieldError, { INPUT_ERROR_STYLE } from "@/lib/formFeedback";
import { Settings, Wrench, ChevronDown, ChevronUp, Users, Search as SearchIcon } from "lucide-react";
import s from "./it.module.css";

const STATUS_LABELS = {
  draft: "Waiting for HR",
  reviewing: "HR reviewing",
  sent: "With IT",
  fulfilled: "Awaiting employee",
  closed: "Closed",
  cancelled: "Cancelled",
};
const STATUS_COLORS = {
  draft: { bg: "#eef2f7", color: "#475569" },
  reviewing: { bg: "#e8f0fd", color: "#1d4ed8" },
  sent: { bg: "#fff3d6", color: "#92610a" },
  fulfilled: { bg: "#e8f0fd", color: "#1d4ed8" },
  closed: { bg: "#def3ed", color: "#087a55" },
  cancelled: { bg: "#f1f1f3", color: "#8b8b94" },
};
const PROVISIONING_STATUS_LABELS = {
  pending: "Waiting for IT",
  submitted: "Ready to activate",
  applied: "Activated",
};
const TYPE_LABELS = {
  new_asset: "New asset",
  replacement: "Replacement",
  license: "License",
  access: "Access",
  other: "Other",
};
/** Nested lists inside an officer card — keep the page usable with 100+ items. */
const NESTED_LIST_PREVIEW = 8;

function StatusChip({ status }) {
  const cls = { draft: s.pillDraft, reviewing: s.pillReviewing, sent: s.pillSent, fulfilled: s.pillFulfilled, closed: s.pillClosed, cancelled: s.pillCancelled };
  return <span className={`${s.pill} ${cls[status] || s.pillDraft}`}>{STATUS_LABELS[status] || status}</span>;
}

function RequestTimeline({ r }) {
  const isCancelled = r.status === "cancelled";
  const steps = [
    {
      key: "submitted",
      label: "Submitted",
      ts: r.created_at,
      done: true,
    },
    {
      key: "reviewing",
      label: "HR reviewing",
      ts: r.reviewed_at,
      done: !!r.reviewed_at,
    },
    {
      key: "sent",
      label: "Sent to IT",
      ts: r.sent_at,
      done: !!r.sent_at,
    },
    {
      key: "resolved",
      label: "Resolved by IT",
      ts: r.fulfilled_at,
      done: r.status === "fulfilled" || r.status === "closed",
    },
    {
      key: "closed",
      label: "Closed by employee",
      ts: r.closed_at,
      done: r.status === "closed",
    },
  ];

  return (
    <div style={{ marginTop: 12, padding: "6px 0" }}>
      {isCancelled ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            borderRadius: 10,
            background: "#f8f8fa",
            border: "1px solid #e2e8f0",
          }}
        >
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: "#e2e8f0",
              color: "#8b8b94",
              display: "grid",
              placeItems: "center",
              fontSize: 14,
              fontWeight: 800,
              flexShrink: 0,
            }}
          >
            ✕
          </span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#475569" }}>Cancelled</div>
            {r.cancel_reason && (
              <div style={{ fontSize: 12, color: "#8b8b94", marginTop: 2 }}>{r.cancel_reason}</div>
            )}
            {r.cancelled_at && (
              <div style={{ fontSize: 11, color: "#aab4bf", marginTop: 2 }}>{fmt(r.cancelled_at)}</div>
            )}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {steps.map((step, i) => {
            const isLast = i === steps.length - 1;
            // Last step done = fully complete (green ✓), not "current" (blue ●).
            const isActive = step.done && !isLast && !steps[i + 1]?.done;
            const fmt = (iso) => {
              if (!iso) return "";
              const d = new Date(iso);
              if (isNaN(d.getTime())) return "";
              return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) +
                " · " +
                d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
            };
            return (
              <div key={step.key} style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    width: 28,
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      background: step.done
                        ? isActive
                          ? "#0d5c91"
                          : "#def3ed"
                        : "#eef2f7",
                      border: step.done
                        ? isActive
                          ? "2px solid #0d5c91"
                          : "2px solid #087a55"
                        : "2px solid #d1dce6",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 13,
                      fontWeight: 800,
                      color: step.done
                        ? isActive
                          ? "#fff"
                          : "#087a55"
                        : "#aab4bf",
                      flexShrink: 0,
                    }}
                  >
                    {step.done ? (isActive ? "●" : "✓") : "○"}
                  </div>
                  {!isLast && (
                    <div
                      style={{
                        flex: 1,
                        width: 2,
                        background: steps[i + 1]?.done ? "#087a55" : "#e2e8f0",
                        minHeight: 20,
                        margin: "2px 0",
                      }}
                    />
                  )}
                </div>
                <div style={{ paddingBottom: isLast ? 0 : 16, paddingTop: 2, flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: step.done ? (isActive ? "#0d5c91" : "#1a1a2e") : "#aab4bf",
                    }}
                  >
                    {step.label}
                  </div>
                  {step.ts && (
                    <div style={{ fontSize: 11, color: "#aab4bf", marginTop: 2 }}>{fmt(step.ts)}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function fmt(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) +
    " · " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function RecruiterItHubPage() {
  return (
    <ProtectedRecruiterRoute requiredCapability="it">
      <RecruiterItHubPageContent />
    </ProtectedRecruiterRoute>
  );
}

function RecruiterItHubPageContent() {
  const [tab, setTab] = useState("officers");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [officers, setOfficers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [requestFilter, setRequestFilter] = useState("");
  const [requestSearch, setRequestSearch] = useState("");
  const [officerSearch, setOfficerSearch] = useState("");
  const [expandedOfficer, setExpandedOfficer] = useState("");
  const [expandedRequest, setExpandedRequest] = useState("");
  /** Keys like `${email}:people` / `${email}:tickets` — show full nested list. */
  const [officerListAll, setOfficerListAll] = useState({});
  const [showCreate, setShowCreate] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [sendTarget, setSendTarget] = useState(null);
  const [sendItEmail, setSendItEmail] = useState("");
  const [cancelTarget, setCancelTarget] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [sendErrors, setSendErrors] = useState({});
  const [form, setForm] = useState({
    employee_id: "",
    request_type: "replacement",
    title: "",
    description: "",
    it_manager_email: "",
  });

  const loadOfficers = useCallback(async () => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    try {
      const data = await getItOfficersOverview(token);
      setOfficers(data.officers || []);
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not load IT officers."));
    }
  }, []);

  const loadRequests = useCallback(async () => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    try {
      const data = await listItServiceRequests(token, requestFilter || undefined);
      setRequests(data.requests || []);
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not load IT requests."));
    }
  }, [requestFilter]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    await Promise.all([loadOfficers(), loadRequests()]);
    setLoading(false);
  }, [loadOfficers, loadRequests]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function handleCreate() {
    const token = localStorage.getItem("access_token");
    if (!token || sending) return;
    const errors = {};
    if (!form.employee_id) errors.employee_id = "Select an employee.";
    if (!form.title.trim()) errors.title = "What's needed is required.";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSending(true);
    try {
      const payload = {
        employee_id: form.employee_id,
        request_type: form.request_type,
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        it_manager_email: form.it_manager_email.trim() || undefined,
      };
      const result = await createItServiceRequest(payload, token);
      toast.success(result.message || "IT request created successfully.");
      setFieldErrors({});
      setShowCreate(false);
      setForm({ employee_id: "", request_type: "replacement", title: "", description: "", it_manager_email: "" });
      await Promise.all([loadRequests(), loadOfficers()]);
    } catch (err) {
      const { fieldErrors: fe, general } = parseFieldErrors(err, [
        "employee_id",
        "request_type",
        "title",
        "description",
        "it_manager_email",
      ]);
      setFieldErrors(fe);
      if (general) {
        toast.error(general);
      } else if (Object.keys(fe).length === 0) {
        toast.error(getApiErrorMessage(err, "Failed to submit IT request. Please try again."));
      }
    } finally {
      setSending(false);
    }
  }

  async function handleSend() {
    const token = localStorage.getItem("access_token");
    if (!token || !sendTarget) return;
    const errors = {};
    if (!sendItEmail.trim()) errors.it_manager_email = "Enter the IT officer email.";
    setSendErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSending(true);
    try {
      await sendItServiceRequest(
        { request_id: sendTarget.request_id, it_manager_email: sendItEmail.trim() },
        token
      );
      toast.success("Request sent to IT successfully.");
      setSendErrors({});
      setSendTarget(null);
      setSendItEmail("");
      await Promise.all([loadRequests(), loadOfficers()]);
    } catch (err) {
      const { fieldErrors: fe, general } = parseFieldErrors(err, ["request_id", "it_manager_email", "note"]);
      setSendErrors(fe);
      if (general) {
        toast.error(general);
      } else if (Object.keys(fe).length === 0) {
        toast.error(getApiErrorMessage(err, "Could not send the IT request."));
      }
    } finally {
      setSending(false);
    }
  }

  async function handleCancel() {
    const token = localStorage.getItem("access_token");
    if (!token || !cancelTarget) return;
    try {
      await cancelItServiceRequest(cancelTarget.request_id, { reason: "Cancelled by recruiter" }, token);
      toast.success("IT request cancelled.");
      setCancelTarget(null);
      await Promise.all([loadRequests(), loadOfficers()]);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not cancel the IT request."));
      setCancelTarget(null);
    }
  }

  async function openCreate() {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setForm({ employee_id: "", request_type: "replacement", title: "", description: "", it_manager_email: "" });
    setFieldErrors({});
    setShowCreate(true);
    try {
      const data = await listEmployees(token, { status: "active" });
      setEmployees(data.employees || []);
    } catch {
      setEmployees([]);
    }
  }

  const filteredEmployees = employees.filter(
    (e) =>
      !employeeSearch.trim() ||
      `${e.full_name || ""} ${e.email || ""} ${e.employee_id || ""}`
        .toLowerCase()
        .includes(employeeSearch.trim().toLowerCase())
  );

  const officerQ = officerSearch.trim().toLowerCase();
  const filteredOfficers = officers.filter(
    (o) =>
      !officerQ ||
      (o.email || "").toLowerCase().includes(officerQ) ||
      (o.provisioned_people || []).some(
        (p) =>
          `${p.full_name || ""} ${p.company_email || ""}`.toLowerCase().includes(officerQ)
      ) ||
      (o.service_requests || []).some(
        (r) =>
          `${r.title || ""} ${r.employee_name || ""} ${r.employee_email || ""}`
            .toLowerCase()
            .includes(officerQ)
      )
  );

  const requestQ = requestSearch.trim().toLowerCase();
  const filteredRequests = requests.filter(
    (r) =>
      !requestQ ||
      `${r.title || ""} ${r.employee_name || ""} ${r.employee_email || ""} ${r.it_manager_email || ""} ${r.description || ""}`
        .toLowerCase()
        .includes(requestQ)
  );

  function toggleOfficerList(key) {
    setOfficerListAll((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <RecruiterShell
      capability="it"
      title="IT Support"
      subtitle="Track the IT officers you work with, the people they provisioned, and support requests"
    >
      <div className={styles.content}>
        <div className={styles.hero} style={{ marginBottom: 20 }}>
          <div className={styles.heroEyebrow}>Recruiter IT Center</div>
          <h1>IT Support</h1>
          <div className={styles.heroMeta}>Track the IT officers you work with, the people they provisioned, and support requests</div>
        </div>

        {error && (
          <div style={{ padding: "10px 16px", borderRadius: 10, background: "var(--red-light)", color: "var(--red)", fontSize: 13, fontWeight: 600, marginBottom: 14 }} role="alert">
            {error}
          </div>
        )}

        <div className={s.sectionCard}>
          <div className={s.sectionHead}>
            <div className={s.sectionHeadLeft}>
              <div className={s.officerAvatar}><Settings size={18} /></div>
              <div>
                <div className={s.sectionTitle}>IT provisioning & support</div>
                <div className={s.sectionDesc}>
                  Track the IT officers you work with, the people they provisioned, and support requests.
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <Link href="/dashboard/recruiter/it-kits" className={`${s.tabBtn} ${s.tabBtnActive}`} style={{ textDecoration: "none" }}>Manage kits</Link>
              <button type="button" className={`${s.tabBtn} ${s.tabBtnActive}`} onClick={openCreate}>
                <Wrench size={13} style={{ marginRight: 5, verticalAlign: -2 }} /> Request IT help
              </button>
            </div>
          </div>

          <div className={s.sectionBody}>
            <div className={s.tabGroup}>
              <button type="button" className={`${s.tabBtn} ${tab === "officers" ? s.tabBtnActive : ""}`} onClick={() => setTab("officers")}>
                <Settings size={13} style={{ marginRight: 5, verticalAlign: -2 }} /> IT Officers
              </button>
              <button type="button" className={`${s.tabBtn} ${tab === "requests" ? s.tabBtnActive : ""}`} onClick={() => setTab("requests")}>
                <Wrench size={13} style={{ marginRight: 5, verticalAlign: -2 }} /> Requests
              </button>
            </div>

            {tab === "officers" && !loading && (
              <div className={s.kpiGrid}>
                <div className={s.kpiCard}>
                  <div className={`${s.kpiIcon} ${s.navy}`}><Users size={18} /></div>
                  <div><div className={s.kpiValue}>{officers.length}</div><div className={s.kpiLabel}>IT Officers</div></div>
                </div>
                <div className={s.kpiCard}>
                  <div className={`${s.kpiIcon} ${s.orange}`}><Wrench size={18} /></div>
                  <div><div className={s.kpiValue}>{officers.reduce((sum, o) => sum + (o.service_open || 0), 0)}</div><div className={s.kpiLabel}>Open tickets</div></div>
                </div>
                <div className={s.kpiCard}>
                  <div className={`${s.kpiIcon} ${s.green}`}><Settings size={18} /></div>
                  <div><div className={s.kpiValue}>{officers.reduce((sum, o) => sum + (o.provisioning_pending || 0), 0)}</div><div className={s.kpiLabel}>Pending setups</div></div>
                </div>
              </div>
            )}

            {tab === "requests" && !loading && (
              <div className={s.kpiGrid}>
                <div className={s.kpiCard}>
                  <div className={`${s.kpiIcon} ${s.navy}`}><Wrench size={18} /></div>
                  <div><div className={s.kpiValue}>{requests.length}</div><div className={s.kpiLabel}>Total requests</div></div>
                </div>
                <div className={s.kpiCard}>
                  <div className={`${s.kpiIcon} ${s.orange}`}><Wrench size={18} /></div>
                  <div><div className={s.kpiValue}>{requests.filter(r => r.status === "sent").length}</div><div className={s.kpiLabel}>With IT</div></div>
                </div>
                <div className={s.kpiCard}>
                  <div className={`${s.kpiIcon} ${s.green}`}><Settings size={18} /></div>
                  <div><div className={s.kpiValue}>{requests.filter(r => r.status === "closed").length}</div><div className={s.kpiLabel}>Closed</div></div>
                </div>
              </div>
            )}

            {loading ? (
              <RecruiterLoader />
            ) : tab === "officers" ? (
              officers.length === 0 ? (
                <div className={s.emptyState}>
                  <Users size={40} />
                  <div className={s.emptyStateTitle}>No IT officers yet</div>
                  <div className={s.emptyStateDesc}>Send an IT provisioning request or raise a support request to see them here.</div>
                </div>
              ) : (
                <div>
                  {officers.length > 6 ? (
                    <div className={s.filterBar}>
                      <label className={`${s.filterField} ${s.flex}`}>
                        <SearchIcon size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-faint)" }} />
                        <input value={officerSearch} onChange={(e) => setOfficerSearch(e.target.value)} placeholder="Search officers, people, or tickets…" style={{ paddingLeft: 32, position: "relative" }} />
                      </label>
                    </div>
                  ) : null}
                  {filteredOfficers.length === 0 ? (
                    <div className={s.emptyState}>
                      <SearchIcon size={36} />
                      <div className={s.emptyStateTitle}>No officers match your search</div>
                    </div>
                  ) : null}
                  {filteredOfficers.map((o) => {
                    const supportParts = [`${o.service_open || 0} open`, `${o.service_fulfilled || 0} awaiting employee`, `${o.service_closed || 0} closed`];
                    if ((o.service_cancelled || 0) > 0) supportParts.push(`${o.service_cancelled} cancelled`);
                    const isOpen = expandedOfficer === o.email;
                    const people = o.provisioned_people || [];
                    const tickets = o.service_requests || [];
                    const peopleKey = `${o.email}:people`;
                    const ticketsKey = `${o.email}:tickets`;
                    const showAllPeople = !!officerListAll[peopleKey];
                    const showAllTickets = !!officerListAll[ticketsKey];
                    const visiblePeople = showAllPeople ? people : people.slice(0, NESTED_LIST_PREVIEW);
                    const visibleTickets = showAllTickets ? tickets : tickets.slice(0, NESTED_LIST_PREVIEW);
                    return (
                      <div key={o.email} className={s.officerCard}>
                        <div className={s.officerHead} onClick={() => setExpandedOfficer(isOpen ? "" : o.email)}>
                          <div className={s.officerAvatar}>{(o.email || "?")[0].toUpperCase()}</div>
                          <div className={s.officerInfo}>
                            <div className={s.officerEmail}>{o.email}</div>
                            <div className={s.officerMeta}>{o.provisioning_total} new-hire setup{o.provisioning_total === 1 ? "" : "s"} · {o.service_total} support ticket{o.service_total === 1 ? "" : "s"}</div>
                          </div>
                          <div className={s.officerChevron}>{isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</div>
                        </div>
                        {isOpen && (
                          <div className={s.officerBody}>
                            <div className={s.officerStats}>
                              <div className={s.statCard}>
                                <div className={s.statCardLabel}>New-hire provisioning</div>
                                <div className={s.statCardDesc}>IT setting up accounts before activation</div>
                                <div className={s.statCardValues}><strong>{o.provisioning_pending}</strong> waiting · <strong>{o.provisioning_submitted}</strong> ready · <strong>{o.provisioning_applied}</strong> activated</div>
                              </div>
                              <div className={s.statCard}>
                                <div className={s.statCardLabel}>Support tickets</div>
                                <div className={s.statCardDesc}>Help requests for people with accounts</div>
                                <div className={s.statCardValues}>{supportParts.map((part, i) => (<span key={part}>{i > 0 ? " · " : ""}<strong>{part.split(" ")[0]}</strong> {part.split(" ").slice(1).join(" ")}</span>))}</div>
                              </div>
                            </div>

                            <div className={s.nestedSection}>
                              <div className={s.nestedTitle}><Users size={14} /> Provisioned people ({people.length})</div>
                              {people.length ? (<>
                                {visiblePeople.map((p, i) => (
                                  <div key={i} className={s.nestedItem}>
                                    <div className={s.nestedItemLeft}>
                                      <div className={s.nestedItemName}>{p.full_name || "—"}</div>
                                      {p.company_email && <div className={s.nestedItemMeta}>{p.company_email}</div>}
                                    </div>
                                    <StatusChip status={p.status === "pending" ? "draft" : p.status === "submitted" ? "reviewing" : "closed"} />
                                  </div>
                                ))}
                                {people.length > NESTED_LIST_PREVIEW ? (<button type="button" className={s.nestedToggle} onClick={() => toggleOfficerList(peopleKey)}>{showAllPeople ? "Show less" : `Show all ${people.length} people`}</button>) : null}
                              </>) : <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>None yet.</div>}
                            </div>

                            <div className={s.nestedSection}>
                              <div className={s.nestedTitle}><Wrench size={14} /> Support tickets ({tickets.length})</div>
                              {tickets.length ? (<>
                                {visibleTickets.map((r) => (
                                  <div key={r.request_id} className={s.nestedItem}>
                                    <div className={s.nestedItemLeft}>
                                      <div className={s.nestedItemName}>{r.title || TYPE_LABELS[r.request_type] || "Support request"}</div>
                                      <div className={s.nestedItemMeta}>{r.employee_name || r.employee_email || "Employee"}{r.request_type ? ` · ${TYPE_LABELS[r.request_type] || r.request_type}` : ""}</div>
                                    </div>
                                    <StatusChip status={r.status} />
                                  </div>
                                ))}
                                {tickets.length > NESTED_LIST_PREVIEW ? (<button type="button" className={s.nestedToggle} onClick={() => toggleOfficerList(ticketsKey)}>{showAllTickets ? "Show less" : `Show all ${tickets.length} tickets`}</button>) : null}
                              </>) : <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>No support tickets for this officer.</div>}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            ) : (
              <>
                <div className={s.filterTabs}>
                  {["", "draft", "reviewing", "sent", "fulfilled", "closed", "cancelled"].map((st) => (
                    <button key={st || "all"} type="button" className={`${s.filterTab} ${requestFilter === st ? s.filterTabActive : ""}`} onClick={() => { setRequestFilter(st); setExpandedRequest(""); }}>
                      {st === "" ? "All" : STATUS_LABELS[st]}
                    </button>
                  ))}
                </div>
                {requests.length > 6 ? (
                  <div className={s.filterBar}>
                    <label className={`${s.filterField} ${s.flex}`}>
                      <input value={requestSearch} onChange={(e) => setRequestSearch(e.target.value)} placeholder="Search by title, employee, or IT email…" />
                    </label>
                  </div>
                ) : null}
                {filteredRequests.length === 0 ? (
                  <div className={s.emptyState}>
                    <SearchIcon size={36} />
                    <div className={s.emptyStateTitle}>{requests.length === 0 ? "No IT support requests" : "No requests match your search"}</div>
                  </div>
                ) : (
                  <div className={s.requestCards}>
                    {filteredRequests.map((r) => {
                      const isOpen = expandedRequest === r.request_id;
                      const canSend = r.status === "draft" || r.status === "reviewing";
                      const canCancel = r.status === "draft" || r.status === "reviewing" || r.status === "sent";
                      return (
                        <div key={r.request_id} className={s.requestCard}>
                          <div className={s.requestHead} onClick={() => setExpandedRequest(isOpen ? "" : r.request_id)}>
                            <div className={s.requestInfo}>
                              <div className={s.requestTitle}>
                                <strong>{r.title}</strong>
                                <StatusChip status={r.status} />
                                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{TYPE_LABELS[r.request_type] || r.request_type}</span>
                              </div>
                              <div className={s.requestMeta}>{r.employee_name}{r.employee_email ? ` (${r.employee_email})` : ""}{r.job_title || r.department ? ` · ${[r.job_title, r.department].filter(Boolean).join(" · ")}` : ""}</div>
                              {!isOpen && r.it_manager_email && <div className={s.requestIT}>→ {r.it_manager_email}</div>}
                            </div>
                            <div className={s.requestActions} onClick={(e) => e.stopPropagation()}>
                              {canSend && <button type="button" className="btn btnPrimary" style={{ fontSize: 11, padding: "5px 10px", minHeight: 28, borderRadius: 7 }} onClick={() => { setSendErrors({}); setSendTarget(r); setSendItEmail(r.it_manager_email || ""); }}>Send to IT</button>}
                              {canCancel && <button type="button" className="btn btnGhost" style={{ fontSize: 11, padding: "5px 8px", minHeight: 28 }} onClick={() => setCancelTarget(r)}>Cancel</button>}
                              <span style={{ color: "var(--text-faint)" }}>{isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
                            </div>
                          </div>
                          {isOpen && (
                            <div className={s.requestBody}>
                              {r.description && <div className={s.requestNote}>{r.description}</div>}
                              {r.it_manager_email && <div className={s.requestNote} style={{ color: "var(--blue-strong)" }}>→ {r.it_manager_email}</div>}
                              {r.fulfillment_note && <div className={s.requestFulfill}>Fulfilled: {r.fulfillment_note}{r.serial_number ? ` · Serial: ${r.serial_number}` : ""}</div>}
                              <RequestTimeline r={r} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {showCreate && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,25,45,0.45)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "40px 16px",
            zIndex: 60,
            overflow: "auto",
          }}
        >
          <div style={{ background: "#fff", borderRadius: 16, width: "min(100%, 620px)", padding: 24 }}>
            <h3 style={{ margin: "0 0 16px" }}>Request IT help for an employee</h3>
            <label className={styles.field}>
              <span className={styles.label}>Employee</span>
              <input
                className={styles.input}
                value={employeeSearch}
                onChange={(e) => setEmployeeSearch(e.target.value)}
                placeholder="Search by name, email, or EMP id"
                style={{ marginBottom: 8 }}
              />
              <select
                className={styles.input}
                name="employee_id"
                value={form.employee_id}
                aria-invalid={Boolean(fieldErrors.employee_id)}
                style={fieldErrors.employee_id ? INPUT_ERROR_STYLE : undefined}
                onChange={(e) => {
                  setFieldErrors((f) => (f.employee_id ? { ...f, employee_id: undefined } : f));
                  setForm((f) => ({ ...f, employee_id: e.target.value }));
                }}
              >
                <option value="">Select employee…</option>
                {filteredEmployees.map((e) => (
                  <option key={e.employee_id} value={e.employee_id}>
                    {e.full_name || e.email} ({e.employee_id})
                  </option>
                ))}
              </select>
              {fieldErrors.employee_id && <FieldError>{fieldErrors.employee_id}</FieldError>}
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Type</span>
              <select
                className={styles.input}
                name="request_type"
                value={form.request_type}
                aria-invalid={Boolean(fieldErrors.request_type)}
                style={fieldErrors.request_type ? INPUT_ERROR_STYLE : undefined}
                onChange={(e) => {
                  setFieldErrors((f) => (f.request_type ? { ...f, request_type: undefined } : f));
                  setForm((f) => ({ ...f, request_type: e.target.value }));
                }}
              >
                {Object.entries(TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              {fieldErrors.request_type && <FieldError>{fieldErrors.request_type}</FieldError>}
            </label>
            <label className={styles.field}>
              <span className={styles.label}>What&apos;s needed</span>
              <input
                className={styles.input}
                name="it_request_title"
                value={form.title}
                aria-invalid={Boolean(fieldErrors.title)}
                style={fieldErrors.title ? INPUT_ERROR_STYLE : undefined}
                onChange={(e) => {
                  setFieldErrors((f) => (f.title ? { ...f, title: undefined } : f));
                  setForm((f) => ({ ...f, title: e.target.value }));
                }}
                placeholder="e.g. New laptop — current one is not working"
              />
              {fieldErrors.title && <FieldError>{fieldErrors.title}</FieldError>}
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Details (optional)</span>
              <textarea
                className={styles.input}
                name="it_request_description"
                rows={3}
                value={form.description}
                aria-invalid={Boolean(fieldErrors.description)}
                style={fieldErrors.description ? INPUT_ERROR_STYLE : undefined}
                onChange={(e) => {
                  setFieldErrors((f) => (f.description ? { ...f, description: undefined } : f));
                  setForm((f) => ({ ...f, description: e.target.value }));
                }}
                placeholder="What's wrong and what does IT need to know?"
              />
              {fieldErrors.description && <FieldError>{fieldErrors.description}</FieldError>}
            </label>
            <label className={styles.field}>
              <span className={styles.label}>IT officer email (optional — leave blank to save as draft)</span>
              <input
                className={styles.input}
                name="it_manager_email"
                type="email"
                value={form.it_manager_email}
                aria-invalid={Boolean(fieldErrors.it_manager_email)}
                style={fieldErrors.it_manager_email ? INPUT_ERROR_STYLE : undefined}
                onChange={(e) => {
                  setFieldErrors((f) => (f.it_manager_email ? { ...f, it_manager_email: undefined } : f));
                  setForm((f) => ({ ...f, it_manager_email: e.target.value }));
                }}
                placeholder="it.support@company.com"
              />
              {fieldErrors.it_manager_email && <FieldError>{fieldErrors.it_manager_email}</FieldError>}
            </label>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
              <button type="button" className={styles.secondaryButton} onClick={() => setShowCreate(false)}>
                Cancel
              </button>
              <button type="button" className={styles.primaryButton} disabled={sending} onClick={handleCreate}>
                {sending ? "Creating…" : "Create request"}
              </button>
            </div>
          </div>
        </div>
      )}

      {sendTarget && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,25,45,0.45)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "40px 16px",
            zIndex: 60,
            overflow: "auto",
          }}
        >
          <div style={{ background: "#fff", borderRadius: 16, width: "min(100%, 460px)", padding: 24 }}>
            <h3 style={{ margin: "0 0 12px" }}>Send to IT</h3>
            <p style={{ margin: "0 0 14px", fontSize: 14, color: "#475569" }}>
              Email &quot;{sendTarget.title}&quot; to the IT officer. They fulfill it from a link in the
              email.
            </p>
            <label className={styles.field}>
              <span>IT officer email</span>
              <input
                type="email"
                value={sendItEmail}
                aria-invalid={Boolean(sendErrors.it_manager_email)}
                style={sendErrors.it_manager_email ? INPUT_ERROR_STYLE : undefined}
                onChange={(e) => {
                  setSendErrors((f) => (f.it_manager_email ? { ...f, it_manager_email: undefined } : f));
                  setSendItEmail(e.target.value);
                }}
                placeholder="it.support@company.com"
              />
              {sendErrors.it_manager_email && <FieldError>{sendErrors.it_manager_email}</FieldError>}
            </label>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
              <button type="button" className={styles.secondaryButton} onClick={() => setSendTarget(null)}>
                Cancel
              </button>
              <button type="button" className={styles.primaryButton} disabled={sending} onClick={handleSend}>
                {sending ? "Sending…" : "Send to IT"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        title="Cancel request"
        message={`Cancel "${cancelTarget?.title}"? The employee will be notified.`}
        confirmLabel="Cancel request"
        onConfirm={handleCancel}
        onCancel={() => setCancelTarget(null)}
      />
    </RecruiterShell>
  );
}
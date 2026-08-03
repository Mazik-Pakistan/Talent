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
  const colors = STATUS_COLORS[status] || STATUS_COLORS.draft;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 800,
        background: colors.bg,
        color: colors.color,
      }}
    >
      {STATUS_LABELS[status] || status}
    </span>
  );
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
    if (!form.employee_id || !form.title.trim()) {
      toast.error("Pick an employee and give the request a title.");
      return;
    }
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
      toast.success(result.message || "IT request created.");
      setShowCreate(false);
      setForm({ employee_id: "", request_type: "replacement", title: "", description: "", it_manager_email: "" });
      await Promise.all([loadRequests(), loadOfficers()]);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not create the IT request."));
    } finally {
      setSending(false);
    }
  }

  async function handleSend() {
    const token = localStorage.getItem("access_token");
    if (!token || !sendTarget) return;
    if (!sendItEmail.trim()) {
      toast.error("Enter the IT officer email.");
      return;
    }
    setSending(true);
    try {
      await sendItServiceRequest(
        { request_id: sendTarget.request_id, it_manager_email: sendItEmail.trim() },
        token
      );
      toast.success("IT request sent.");
      setSendTarget(null);
      setSendItEmail("");
      await Promise.all([loadRequests(), loadOfficers()]);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not send the IT request."));
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
    <RecruiterShell>
      <div className={styles.content}>
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionHeadLeft}>
              <div className={`${styles.bar} ${styles.green}`} />
              <div>
                <div className={styles.sectionTitle}>IT provisioning & support</div>
                <div className={styles.sectionDesc}>
                  Track the IT officers you work with, the people they provisioned, and support requests
                  (e.g. replacement laptops).
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href="/dashboard/recruiter/it-kits" className={styles.secondaryButton}>
                Manage kits
              </Link>
              <button type="button" className={styles.primaryButton} onClick={openCreate}>
                Request IT help
              </button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, padding: "0 18px" }}>
            {[
              { key: "officers", label: "IT officers" },
              { key: "requests", label: "Requests" },
            ].map((t) => (
              <button
                key={t.key}
                type="button"
                className={styles.secondaryButton}
                style={{
                  background: tab === t.key ? "#e7f1f9" : "#fff",
                  borderColor: tab === t.key ? "#0d5c91" : undefined,
                  color: tab === t.key ? "#0d5c91" : undefined,
                }}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className={styles.sectionBody}>
            {error && <p style={{ color: "var(--danger, #c0392b)", marginBottom: 12 }}>{error}</p>}
            {loading ? (
              <RecruiterLoader />
            ) : tab === "officers" ? (
              officers.length === 0 ? (
                <p className={styles.emptySub}>
                  No IT officers yet. Send an IT provisioning request or raise a support request to see them here.
                </p>
              ) : (
                <div style={{ display: "grid", gap: 14 }}>
                  {officers.length > 6 ? (
                    <input
                      className={styles.input}
                      value={officerSearch}
                      onChange={(e) => setOfficerSearch(e.target.value)}
                      placeholder="Search officers, people, or tickets…"
                      style={{ maxWidth: 420 }}
                    />
                  ) : null}
                  {filteredOfficers.length === 0 ? (
                    <p className={styles.emptySub}>No officers match your search.</p>
                  ) : null}
                  {filteredOfficers.map((o) => {
                    const supportParts = [
                      `${o.service_open || 0} open`,
                      `${o.service_fulfilled || 0} awaiting employee`,
                      `${o.service_closed || 0} closed`,
                    ];
                    if ((o.service_cancelled || 0) > 0) {
                      supportParts.push(`${o.service_cancelled} cancelled`);
                    }
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
                      <div
                        key={o.email}
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: 12,
                          padding: 16,
                          background: "#fff",
                        }}
                      >
                        <div
                          style={{ display: "flex", justifyContent: "space-between", gap: 12, cursor: "pointer" }}
                          onClick={() => setExpandedOfficer(isOpen ? "" : o.email)}
                        >
                          <div>
                            <strong style={{ fontSize: 15 }}>{o.email}</strong>
                            <div style={{ fontSize: 12, color: "#6b7a8f", marginTop: 2 }}>
                              {o.provisioning_total} new-hire setup
                              {o.provisioning_total === 1 ? "" : "s"} · {o.service_total} support ticket
                              {o.service_total === 1 ? "" : "s"}
                            </div>
                          </div>
                          <span style={{ fontSize: 13, color: "#0d5c91", fontWeight: 700 }}>
                            {isOpen ? "▲" : "▼"}
                          </span>
                        </div>
                        {isOpen && (
                          <div style={{ marginTop: 12, borderTop: "1px solid #eef2f7", paddingTop: 14, display: "grid", gap: 16 }}>
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                                gap: 12,
                              }}
                            >
                              <div
                                style={{
                                  padding: "12px 14px",
                                  borderRadius: 10,
                                  background: "#f7fafc",
                                  border: "1px solid #e8eef5",
                                }}
                              >
                                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.04em", color: "#64748b", textTransform: "uppercase" }}>
                                  New-hire provisioning
                                </div>
                                <div style={{ fontSize: 12, color: "#6b7a8f", marginTop: 4, marginBottom: 8 }}>
                                  IT setting up accounts for people before activation
                                </div>
                                <div style={{ fontSize: 13, color: "#1e293b", lineHeight: 1.55 }}>
                                  <strong>{o.provisioning_pending}</strong> waiting ·{" "}
                                  <strong>{o.provisioning_submitted}</strong> ready ·{" "}
                                  <strong>{o.provisioning_applied}</strong> activated
                                </div>
                              </div>
                              <div
                                style={{
                                  padding: "12px 14px",
                                  borderRadius: 10,
                                  background: "#f7fafc",
                                  border: "1px solid #e8eef5",
                                }}
                              >
                                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.04em", color: "#64748b", textTransform: "uppercase" }}>
                                  Support tickets
                                </div>
                                <div style={{ fontSize: 12, color: "#6b7a8f", marginTop: 4, marginBottom: 8 }}>
                                  Help requests for people who already have accounts
                                </div>
                                <div style={{ fontSize: 13, color: "#1e293b", lineHeight: 1.55 }}>
                                  {supportParts.map((part, i) => (
                                    <span key={part}>
                                      {i > 0 ? " · " : ""}
                                      <strong>{part.split(" ")[0]}</strong> {part.split(" ").slice(1).join(" ")}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </div>

                            <div>
                              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                                Provisioned people ({people.length})
                              </div>
                              {people.length ? (
                                <>
                                  {visiblePeople.map((p, i) => (
                                    <div key={i} style={{ fontSize: 13, lineHeight: 1.7, color: "#334155" }}>
                                      • {p.full_name || "—"}
                                      {p.company_email ? ` (${p.company_email})` : ""} —{" "}
                                      {PROVISIONING_STATUS_LABELS[p.status] || p.status}
                                    </div>
                                  ))}
                                  {people.length > NESTED_LIST_PREVIEW ? (
                                    <button
                                      type="button"
                                      onClick={() => toggleOfficerList(peopleKey)}
                                      style={{
                                        marginTop: 6,
                                        border: "none",
                                        background: "none",
                                        color: "#0d5c91",
                                        fontWeight: 700,
                                        fontSize: 12.5,
                                        cursor: "pointer",
                                        padding: 0,
                                      }}
                                    >
                                      {showAllPeople
                                        ? "Show less"
                                        : `Show all ${people.length} people`}
                                    </button>
                                  ) : null}
                                </>
                              ) : (
                                <div style={{ fontSize: 13, color: "#999" }}>None yet.</div>
                              )}
                            </div>

                            <div>
                              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                                Support tickets ({tickets.length})
                              </div>
                              {tickets.length ? (
                                <>
                                  {visibleTickets.map((r) => (
                                    <div
                                      key={r.request_id}
                                      style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        gap: 12,
                                        alignItems: "center",
                                        fontSize: 13,
                                        lineHeight: 1.6,
                                        padding: "6px 0",
                                        borderBottom: "1px solid #f1f5f9",
                                      }}
                                    >
                                      <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: 600, color: "#1e293b" }}>
                                          {r.title || TYPE_LABELS[r.request_type] || "Support request"}
                                        </div>
                                        <div style={{ fontSize: 12, color: "#6b7a8f" }}>
                                          {r.employee_name || r.employee_email || "Employee"}
                                          {r.request_type ? ` · ${TYPE_LABELS[r.request_type] || r.request_type}` : ""}
                                        </div>
                                      </div>
                                      <StatusChip status={r.status} />
                                    </div>
                                  ))}
                                  {tickets.length > NESTED_LIST_PREVIEW ? (
                                    <button
                                      type="button"
                                      onClick={() => toggleOfficerList(ticketsKey)}
                                      style={{
                                        marginTop: 8,
                                        border: "none",
                                        background: "none",
                                        color: "#0d5c91",
                                        fontWeight: 700,
                                        fontSize: 12.5,
                                        cursor: "pointer",
                                        padding: 0,
                                      }}
                                    >
                                      {showAllTickets
                                        ? "Show less"
                                        : `Show all ${tickets.length} tickets`}
                                    </button>
                                  ) : null}
                                </>
                              ) : (
                                <div style={{ fontSize: 13, color: "#999" }}>No support tickets for this officer.</div>
                              )}
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
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
                  {["", "draft", "reviewing", "sent", "fulfilled", "closed", "cancelled"].map((s) => (
                    <button
                      key={s || "all"}
                      type="button"
                      className={styles.secondaryButton}
                      style={{
                        background: requestFilter === s ? "#e7f1f9" : "#fff",
                        borderColor: requestFilter === s ? "#0d5c91" : undefined,
                      }}
                      onClick={() => {
                        setRequestFilter(s);
                        setExpandedRequest("");
                      }}
                    >
                      {s === "" ? "All" : STATUS_LABELS[s]}
                    </button>
                  ))}
                </div>
                {requests.length > 6 ? (
                  <input
                    className={styles.input}
                    value={requestSearch}
                    onChange={(e) => setRequestSearch(e.target.value)}
                    placeholder="Search by title, employee, or IT email…"
                    style={{ maxWidth: 420, marginBottom: 14 }}
                  />
                ) : null}
                {filteredRequests.length === 0 ? (
                  <p className={styles.emptySub}>
                    {requests.length === 0
                      ? "No IT support requests match this filter."
                      : "No requests match your search."}
                  </p>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {filteredRequests.map((r) => {
                      const isOpen = expandedRequest === r.request_id;
                      const canSend = r.status === "draft" || r.status === "reviewing";
                      const canCancel =
                        r.status === "draft" || r.status === "reviewing" || r.status === "sent";
                      return (
                        <div
                          key={r.request_id}
                          style={{
                            border: "1px solid var(--border)",
                            borderRadius: 12,
                            padding: 14,
                            background: "#fff",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 12,
                              alignItems: "flex-start",
                              cursor: "pointer",
                            }}
                            onClick={() => setExpandedRequest(isOpen ? "" : r.request_id)}
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                <strong style={{ fontSize: 14 }}>{r.title}</strong>
                                <StatusChip status={r.status} />
                                <span style={{ fontSize: 11, color: "#6b7a8f" }}>
                                  {TYPE_LABELS[r.request_type] || r.request_type}
                                </span>
                              </div>
                              <div style={{ fontSize: 12.5, color: "#475569", marginTop: 4 }}>
                                {r.employee_name}
                                {r.employee_email ? ` (${r.employee_email})` : ""}
                                {r.job_title || r.department
                                  ? ` · ${[r.job_title, r.department].filter(Boolean).join(" · ")}`
                                  : ""}
                              </div>
                              {!isOpen && r.it_manager_email ? (
                                <div style={{ fontSize: 12, color: "#0d5c91", marginTop: 3 }}>
                                  → {r.it_manager_email}
                                </div>
                              ) : null}
                            </div>
                            <div
                              style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {canSend ? (
                                <button
                                  type="button"
                                  className={styles.primaryButton}
                                  onClick={() => {
                                    setSendTarget(r);
                                    setSendItEmail(r.it_manager_email || "");
                                  }}
                                >
                                  Send to IT
                                </button>
                              ) : null}
                              {canCancel ? (
                                <button
                                  type="button"
                                  className={styles.secondaryButton}
                                  onClick={() => setCancelTarget(r)}
                                >
                                  Cancel
                                </button>
                              ) : null}
                              <span style={{ fontSize: 13, color: "#0d5c91", fontWeight: 700, minWidth: 16 }}>
                                {isOpen ? "▲" : "▼"}
                              </span>
                            </div>
                          </div>
                          {isOpen ? (
                            <div
                              style={{
                                marginTop: 12,
                                borderTop: "1px solid #eef2f7",
                                paddingTop: 12,
                              }}
                            >
                              {r.description ? (
                                <div style={{ fontSize: 12.5, color: "#6b7a8f", marginBottom: 8 }}>
                                  {r.description}
                                </div>
                              ) : null}
                              {r.it_manager_email ? (
                                <div style={{ fontSize: 12, color: "#0d5c91", marginBottom: 6 }}>
                                  → {r.it_manager_email}
                                </div>
                              ) : null}
                              {r.fulfillment_note ? (
                                <div style={{ fontSize: 12.5, color: "#087a55", marginBottom: 8 }}>
                                  Fulfilled: {r.fulfillment_note}
                                  {r.serial_number ? ` · Serial: ${r.serial_number}` : ""}
                                </div>
                              ) : null}
                              <RequestTimeline r={r} />
                            </div>
                          ) : null}
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
                onChange={(e) => setForm((f) => ({ ...f, employee_id: e.target.value }))}
              >
                <option value="">Select employee…</option>
                {filteredEmployees.map((e) => (
                  <option key={e.employee_id} value={e.employee_id}>
                    {e.full_name || e.email} ({e.employee_id})
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Type</span>
              <select
                className={styles.input}
                name="request_type"
                value={form.request_type}
                onChange={(e) => setForm((f) => ({ ...f, request_type: e.target.value }))}
              >
                {Object.entries(TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>What&apos;s needed</span>
              <input
                className={styles.input}
                name="it_request_title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. New laptop — current one is not working"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Details (optional)</span>
              <textarea
                className={styles.input}
                name="it_request_description"
                rows={3}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="What's wrong and what does IT need to know?"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>IT officer email (optional — leave blank to save as draft)</span>
              <input
                className={styles.input}
                name="it_manager_email"
                type="email"
                value={form.it_manager_email}
                onChange={(e) => setForm((f) => ({ ...f, it_manager_email: e.target.value }))}
                placeholder="it.support@company.com"
              />
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
                onChange={(e) => setSendItEmail(e.target.value)}
                placeholder="it.support@company.com"
              />
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

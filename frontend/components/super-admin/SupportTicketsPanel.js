/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import s from "./SupportTicketsPanel.module.css";
import { downloadCsv } from "@/utils/downloadCsv";
import {
  adminListTickets,
  adminGetTicketStats,
  adminGetTicket,
  adminAssignTicket,
  adminUpdateTicketStatus,
  adminUpdateTicketPriority,
  adminReplyToTicket,
  adminCloseTicket,
  adminResolveTicket,
  adminReopenTicket,
  adminDeleteTicket,
  adminGetTicketActivity,
  adminGetTicketAudit,
  getApiErrorMessage,
} from "@/services/authService";

const CATEGORIES = {
  bug_report: "Bug Report",
  feature_request: "Feature Request",
  performance: "Performance",
  ui_issue: "UI Issue",
  login_issue: "Login Issue",
  permission_issue: "Permission Issue",
  ai_assistant: "AI Assistant",
  recruitment: "Recruitment",
  employee_module: "Employee Module",
  learning: "Learning",
  analytics: "Analytics",
  billing: "Billing",
  security: "Security",
  integration: "Integration",
  api: "API",
  other: "Other",
};

const PRIORITIES = { low: "Low", medium: "Medium", high: "High", critical: "Critical" };
const STATUSES = { open: "Open", in_progress: "In Progress", waiting: "Waiting", resolved: "Resolved", closed: "Closed" };

const SORT_OPTIONS = { newest: "-created_at", oldest: "created_at", priority: "priority", updated: "-updated_at" };
const PRIORITY_RANK = { critical: 1, high: 2, medium: 3, low: 4 };
const EXPORT_HEADERS = [
  "ticket_id",
  "subject",
  "status",
  "priority",
  "category",
  "module",
  "reporter",
  "reporter_email",
  "organization",
  "assignee",
  "created_at",
  "updated_at",
];

const svgProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

const ICONS = {
  ticket: (
    <svg {...svgProps}>
      <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2.5a2 2 0 0 0 0 5V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2.5a2 2 0 0 0 0-5V7z" />
      <path d="M13 5v2M13 17v2M13 11v2" />
    </svg>
  ),
  open: (
    <svg {...svgProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  progress: (
    <svg {...svgProps}>
      <path d="M21 12a9 9 0 1 1-6.2-8.56" />
      <path d="M21 4v5h-5" />
    </svg>
  ),
  check: (
    <svg {...svgProps}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  ),
  closed: (
    <svg {...svgProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </svg>
  ),
  alert: (
    <svg {...svgProps}>
      <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  ),
  search: (
    <svg {...svgProps}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  ),
  download: (
    <svg {...svgProps}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5M12 15V3" />
    </svg>
  ),
  x: (
    <svg {...svgProps}>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  ),
  eye: (
    <svg {...svgProps}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  trash: (
    <svg {...svgProps}>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  ),
  send: (
    <svg {...svgProps}>
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  ),
  users: (
    <svg {...svgProps}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  chevronLeft: (
    <svg {...svgProps}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  ),
  chevronRight: (
    <svg {...svgProps}>
      <path d="M9 18l6-6-6-6" />
    </svg>
  ),
  activity: (
    <svg {...svgProps}>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  ),
  list: (
    <svg {...svgProps}>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  ),
};

function statusClass(status) {
  return (
    {
      open: s.statusOpen,
      in_progress: s.statusInProgress,
      waiting: s.statusWaiting,
      resolved: s.statusResolved,
      closed: s.statusClosed,
    }[status] || ""
  );
}

function priorityClass(priority) {
  return { low: s.priorityLow, medium: s.priorityMedium, high: s.priorityHigh, critical: s.priorityCritical }[priority] || "";
}

function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function initials(name) {
  return (name || "?").trim().charAt(0).toUpperCase() || "?";
}

function formatAuditValue(value) {
  if (value == null || value === "") return "—";
  const str = typeof value === "object" ? JSON.stringify(value) : String(value);
  return str && str.length > 120 ? `${str.slice(0, 120)}…` : str;
}

function getAccessToken() {
  return localStorage.getItem("access_token");
}

function readStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("user") || "null");
  } catch {
    return null;
  }
}

export default function SupportTicketsPanel({ onNavigateToRecruiters = () => {} }) {
  const [tickets, setTickets] = useState([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [ticketsError, setTicketsError] = useState("");
  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);

  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const [selectedTicket, setSelectedTicket] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("conversation");
  const [detail, setDetail] = useState(null);
  const [activity, setActivity] = useState(null);
  const [audit, setAudit] = useState(null);
  const [panelLoading, setPanelLoading] = useState(false);
  const [panelError, setPanelError] = useState("");
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionNonce, setActionNonce] = useState(0);

  const loadStats = useCallback(async () => {
    const token = getAccessToken();
    if (!token) return;
    try {
      const data = await adminGetTicketStats(token);
      setStats(data);
      setStatsError("");
    } catch (err) {
      setStatsError(getApiErrorMessage(err, "Could not load ticket statistics."));
    }
  }, []);

  const loadTickets = useCallback(
    async ({ silent = false } = {}) => {
      const token = getAccessToken();
      if (!token) return;
      if (!silent) setTicketsLoading(true);
      setTicketsError("");
      try {
        const params = { page: 1, page_size: 100, sort: SORT_OPTIONS[sortBy] || "-created_at" };
        if (statusFilter) params.status = statusFilter;
        if (priorityFilter) params.priority = priorityFilter;
        if (categoryFilter) params.category = categoryFilter;
        const data = await adminListTickets(token, params);
        setTickets(data.tickets || []);
      } catch (err) {
        setTicketsError(getApiErrorMessage(err, "Could not load support tickets."));
      } finally {
        if (!silent) setTicketsLoading(false);
      }
    },
    [sortBy, statusFilter, priorityFilter, categoryFilter]
  );

  const loadInitialData = useCallback(async () => {
    await Promise.all([loadTickets(), loadStats()]);
    const id = setInterval(() => {
      loadTickets({ silent: true });
      loadStats();
    }, 60000);
    return () => clearInterval(id);
  }, [loadTickets, loadStats]);

  useEffect(() => {
    let cleanup;
    loadInitialData().then((fn) => { cleanup = fn; });
    return () => { if (cleanup) cleanup(); };
  }, [loadInitialData]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim().toLowerCase());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") setPanelOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen]);

  const loadDetail = useCallback(async (ticketId) => {
    const token = getAccessToken();
    if (!token) return;
    setPanelLoading(true);
    setPanelError("");
    try {
      const [detailData, activityData, auditData] = await Promise.all([
        adminGetTicket(ticketId, token),
        adminGetTicketActivity(ticketId, token),
        adminGetTicketAudit(ticketId, token),
      ]);
      setDetail(detailData);
      setActivity(activityData);
      setAudit(auditData);
    } catch (err) {
      setPanelError(getApiErrorMessage(err, "Could not load ticket details."));
    } finally {
      setPanelLoading(false);
    }
  }, []);

  const refreshDetail = useCallback(async (ticketId) => {
    const token = getAccessToken();
    if (!token) return;
    try {
      const [detailData, activityData, auditData] = await Promise.all([
        adminGetTicket(ticketId, token),
        adminGetTicketActivity(ticketId, token),
        adminGetTicketAudit(ticketId, token),
      ]);
      setDetail(detailData);
      setActivity(activityData);
      setAudit(auditData);
      if (detailData && detailData.ticket) {
        const updated = detailData.ticket;
        setSelectedTicket(updated);
        setTickets((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      }
    } catch {
      // keep the existing panel content; the next refresh will retry
    }
  }, []);

  function openTicket(ticket) {
    setSelectedTicket(ticket);
    setActiveTab("conversation");
    setDetail(null);
    setActivity(null);
    setAudit(null);
    setReplyText("");
    setPanelError("");
    setActionError("");
    setPanelOpen(true);
    loadDetail(ticket.id);
  }

  function closePanel() {
    setPanelOpen(false);
  }

  const filteredTickets = useMemo(() => {
    let list = tickets;
    if (debouncedSearch) {
      list = list.filter((t) => {
        const haystack = [t.ticket_id, t.subject, t.description, t.created_by_name, t.created_by_email]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(debouncedSearch);
      });
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sortBy) {
        case "oldest":
          return (a.created_at || "").localeCompare(b.created_at || "");
        case "priority":
          return (
            (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
            (b.created_at || "").localeCompare(a.created_at || "")
          );
        case "updated":
          return (b.updated_at || "").localeCompare(a.updated_at || "");
        default:
          return (b.created_at || "").localeCompare(a.created_at || "");
      }
    });
    return sorted;
  }, [tickets, debouncedSearch, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredTickets.length / pageSize));
  const pagedTickets = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredTickets.slice(start, start + pageSize);
  }, [filteredTickets, page, pageSize]);

  useEffect(() => {
    if (page > totalPages && totalPages > 0) {
      const timer = setTimeout(() => setPage(totalPages), 0);
      return () => clearTimeout(timer);
    }
  }, [page, totalPages]);

  const kpis = useMemo(
    () => [
      { key: "total", label: "Total Tickets", value: stats?.total ?? 0, tone: "blue", icon: ICONS.ticket },
      { key: "open", label: "Open", value: stats?.by_status?.open ?? 0, tone: "orange", icon: ICONS.open },
      { key: "in_progress", label: "In Progress", value: stats?.by_status?.in_progress ?? 0, tone: "cyan", icon: ICONS.progress },
      { key: "resolved", label: "Resolved", value: stats?.by_status?.resolved ?? 0, tone: "green", icon: ICONS.check },
      { key: "closed", label: "Closed", value: stats?.by_status?.closed ?? 0, tone: "grey", icon: ICONS.closed },
      { key: "critical", label: "Critical", value: stats?.by_priority?.critical ?? 0, tone: "red", icon: ICONS.alert },
    ],
    [stats]
  );

  const toneClass = { blue: s.kpiBlue, orange: s.kpiOrange, cyan: s.kpiCyan, green: s.kpiGreen, grey: s.kpiGrey, red: s.kpiRed };

  const assigneeOptions = useMemo(() => {
    const map = new Map();
    tickets.forEach((t) => {
      if (t.assignee_id && t.assignee_name) map.set(t.assignee_id, t.assignee_name);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [tickets]);

  const visibleIds = useMemo(() => pagedTickets.map((t) => t.id), [pagedTickets]);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someSelected = !allSelected && visibleIds.some((id) => selectedIds.has(id));

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      if (visibleIds.length && visibleIds.every((id) => prev.has(id))) return new Set();
      return new Set(visibleIds);
    });
  }

  async function handleExportCsv() {
    const token = getAccessToken();
    if (!token || exporting) return;
    setExporting(true);
    setExportError("");
    try {
      const params = { page: 1, page_size: 2000, sort: SORT_OPTIONS[sortBy] || "-created_at" };
      if (statusFilter) params.status = statusFilter;
      if (priorityFilter) params.priority = priorityFilter;
      if (categoryFilter) params.category = categoryFilter;
      const data = await adminListTickets(token, params);
      const rows = (data.tickets || []).map((t) => ({
        ticket_id: t.ticket_id || "",
        subject: t.subject || "",
        status: t.status || "",
        priority: t.priority || "",
        category: t.category || "",
        module: t.affected_module || "",
        reporter: t.created_by_name || "",
        reporter_email: t.created_by_email || "",
        organization: t.organization_name || "",
        assignee: t.assignee_name || "",
        created_at: t.created_at || "",
        updated_at: t.updated_at || "",
      }));
      downloadCsv("support-tickets.csv", EXPORT_HEADERS, rows);
    } catch (err) {
      setExportError(getApiErrorMessage(err, "Could not export tickets."));
    } finally {
      setExporting(false);
    }
  }

  async function runMutation(fn) {
    if (!selectedTicket || actionBusy) return;
    const token = getAccessToken();
    if (!token) return;
    setActionBusy(true);
    setActionError("");
    try {
      await fn(selectedTicket, token);
      await refreshDetail(selectedTicket.id);
      loadStats();
    } catch (err) {
      setActionError(getApiErrorMessage(err, "That action could not be completed."));
    } finally {
      setActionBusy(false);
      setActionNonce((n) => n + 1);
    }
  }

  async function handleAssign(assigneeId) {
    if (!assigneeId || !selectedTicket || actionBusy) return;
    let resolvedId = assigneeId;
    if (assigneeId === "__me__") {
      const storedUser = readStoredUser();
      if (!storedUser?.id) {
        setActionError("Could not determine your admin id for assignment.");
        return;
      }
      resolvedId = storedUser.id;
    }
    await runMutation((ticket, token) => adminAssignTicket(ticket.id, { assignee_id: resolvedId }, token));
  }

  async function handleStatusChange(status) {
    if (!status) return;
    await runMutation((ticket, token) => adminUpdateTicketStatus(ticket.id, { status }, token));
  }

  async function handlePriorityChange(priority) {
    if (!priority) return;
    await runMutation((ticket, token) => adminUpdateTicketPriority(ticket.id, { priority }, token));
  }

  async function handleResolve() {
    await runMutation((ticket, token) => adminResolveTicket(ticket.id, token));
  }

  async function handleClose() {
    await runMutation((ticket, token) => adminCloseTicket(ticket.id, token));
  }

  async function handleReopen() {
    await runMutation((ticket, token) => adminReopenTicket(ticket.id, token));
  }

  async function handleSendReply() {
    const message = replyText.trim();
    if (!selectedTicket || replying || !message) return;
    const token = getAccessToken();
    if (!token) return;
    setReplying(true);
    setActionError("");
    try {
      await adminReplyToTicket(selectedTicket.id, { message }, token);
      setReplyText("");
      await refreshDetail(selectedTicket.id);
    } catch (err) {
      setActionError(getApiErrorMessage(err, "Could not send reply."));
    } finally {
      setReplying(false);
    }
  }

  function handleReplyKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSendReply();
    }
  }

  async function handleDelete() {
    if (!selectedTicket || actionBusy) return;
    if (!window.confirm(`Delete ticket ${selectedTicket.ticket_id || selectedTicket.id}? This cannot be undone.`)) return;
    const token = getAccessToken();
    if (!token) return;
    setActionBusy(true);
    setActionError("");
    try {
      await adminDeleteTicket(selectedTicket.id, token);
      setPanelOpen(false);
      setSelectedTicket(null);
      setTickets((prev) => prev.filter((t) => t.id !== selectedTicket.id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(selectedTicket.id);
        return next;
      });
      loadTickets({ silent: true });
      loadStats();
    } catch (err) {
      setActionError(getApiErrorMessage(err, "Could not delete ticket."));
    } finally {
      setActionBusy(false);
      setActionNonce((n) => n + 1);
    }
  }

  async function handleQuickDelete(ticket) {
    if (actionBusy) return;
    if (!window.confirm(`Delete ticket ${ticket.ticket_id || ticket.id}? This cannot be undone.`)) return;
    const token = getAccessToken();
    if (!token) return;
    setActionBusy(true);
    setTicketsError("");
    try {
      await adminDeleteTicket(ticket.id, token);
      if (selectedTicket && selectedTicket.id === ticket.id) {
        setPanelOpen(false);
        setSelectedTicket(null);
      }
      setTickets((prev) => prev.filter((t) => t.id !== ticket.id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(ticket.id);
        return next;
      });
      loadTickets({ silent: true });
      loadStats();
    } catch (err) {
      setTicketsError(getApiErrorMessage(err, "Could not delete ticket."));
    } finally {
      setActionBusy(false);
    }
  }

  function clearFilters() {
    setSearch("");
    setDebouncedSearch("");
    setStatusFilter("");
    setPriorityFilter("");
    setCategoryFilter("");
    setPage(1);
  }

  function renderStatusBadge(status) {
    return <span className={`${s.statusBadge} ${statusClass(status)}`}>{STATUSES[status] || status || "—"}</span>;
  }

  function renderPriorityBadge(priority) {
    return <span className={`${s.priorityBadge} ${priorityClass(priority)}`}>{PRIORITIES[priority] || priority || "—"}</span>;
  }

  function renderCheckbox(checked, onChange, label = "Select") {
    return (
      <label className={s.checkbox} onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          className={s.checkboxInput}
          checked={checked}
          onChange={onChange}
          onClick={(e) => e.stopPropagation()}
          aria-label={label}
        />
        <span className={s.checkboxMark}>{checked ? ICONS.check : null}</span>
      </label>
    );
  }

  function renderHeaderCheckbox() {
    return (
      <label className={`${s.checkbox} ${someSelected ? s.checkboxIndeterminate : ""}`} onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          className={s.checkboxInput}
          checked={allSelected}
          onChange={toggleSelectAll}
          aria-label="Select all visible tickets"
        />
        <span className={s.checkboxMark}>
          {allSelected ? ICONS.check : someSelected ? <span className={s.checkboxDash} /> : null}
        </span>
      </label>
    );
  }

  function renderTable() {
    return (
      <div className={s.tableWrap}>
        <table className={s.orgTable}>
          <thead className={s.thead}>
            <tr>
              <th className={s.th} style={{ width: 44 }}>
                {renderHeaderCheckbox()}
              </th>
              <th className={s.th}>Ticket ID</th>
              <th className={s.th}>Subject</th>
              <th className={s.th}>Reporter</th>
              <th className={s.th}>Priority</th>
              <th className={s.th}>Status</th>
              <th className={s.th}>Category</th>
              <th className={s.th}>Assigned</th>
              <th className={s.th}>Created</th>
              <th className={s.th}>Updated</th>
              <th className={`${s.th} ${s.actionsCell}`}>Actions</th>
            </tr>
          </thead>
          <tbody className={s.tbody}>
            {pagedTickets.map((ticket) => (
              <tr
                key={ticket.id}
                className={`${s.tr} ${selectedIds.has(ticket.id) ? s.trSelected : ""}`}
                onClick={() => openTicket(ticket)}
              >
                <td className={s.td}>{renderCheckbox(selectedIds.has(ticket.id), () => toggleSelect(ticket.id), `Select ${ticket.ticket_id || ticket.id}`)}</td>
                <td className={`${s.td} ${s.idCell}`}>
                  <span className={s.ticketId}>{ticket.ticket_id || ticket.id}</span>
                </td>
                <td className={s.td}>
                  <div className={s.subjectCell}>
                    <div className={s.subjectText}>{ticket.subject || "Untitled ticket"}</div>
                  </div>
                </td>
                <td className={s.td}>
                  <div className={s.reporterCell}>
                    <span className={`${s.avatar} ${s.avatarSmall}`}>{initials(ticket.created_by_name)}</span>
                    <div className={s.reporterText}>
                      <div className={s.reporterName}>{ticket.created_by_name || "Unknown"}</div>
                      <div className={s.reporterEmail}>{ticket.created_by_email || "—"}</div>
                    </div>
                  </div>
                </td>
                <td className={s.td}>{renderPriorityBadge(ticket.priority)}</td>
                <td className={s.td}>{renderStatusBadge(ticket.status)}</td>
                <td className={s.td}>
                  <span className={s.categoryCell}>{CATEGORIES[ticket.category] || ticket.category || "—"}</span>
                </td>
                <td className={s.td}>
                  <span className={`${s.assignedCell} ${ticket.assignee_id ? "" : s.unassigned}`}>
                    {ticket.assignee_name || "Unassigned"}
                  </span>
                </td>
                <td className={s.td}>
                  <span className={s.dateCell}>{formatDateTime(ticket.created_at)}</span>
                </td>
                <td className={s.td}>
                  <span className={s.dateCell}>{formatDateTime(ticket.updated_at)}</span>
                </td>
                <td className={`${s.td} ${s.actionsCell}`}>
                  <div className={s.actions}>
                    <button
                      type="button"
                      className={s.btnIcon}
                      title="View ticket"
                      onClick={(e) => {
                        e.stopPropagation();
                        openTicket(ticket);
                      }}
                    >
                      {ICONS.eye}
                    </button>
                    <button
                      type="button"
                      className={`${s.btnIcon} ${s.btnIconDanger}`}
                      title="Delete ticket"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleQuickDelete(ticket);
                      }}
                    >
                      {ICONS.trash}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderPagination() {
    if (!filteredTickets.length) return null;
    const start = (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, filteredTickets.length);
    return (
      <div className={s.pagination}>
        <span className={s.pageInfo}>
          Showing {start}–{end} of {filteredTickets.length} ticket{filteredTickets.length === 1 ? "" : "s"}
        </span>
        <div className={s.pageControls}>
          <button type="button" className={s.pageBtn} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {ICONS.chevronLeft}
            Prev
          </button>
          <span className={s.pageCurrent}>
            Page {page} of {totalPages}
          </span>
          <button type="button" className={s.pageBtn} disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
            {ICONS.chevronRight}
          </button>
        </div>
      </div>
    );
  }

  function renderActionBar() {
    const ticket = selectedTicket;
    const disabled = !ticket || actionBusy;
    return (
      <>
        <select
          key={`assign-${actionNonce}`}
          className={s.actionSelect}
          value={ticket?.assignee_id || ""}
          onChange={(e) => handleAssign(e.target.value)}
          disabled={disabled}
          aria-label="Assign ticket"
          title="Assign ticket"
        >
          <option value="">Assign to…</option>
          <option value="__me__">Assign to me</option>
          {assigneeOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <select
          key={`status-${actionNonce}`}
          className={s.actionSelect}
          value={ticket?.status || ""}
          onChange={(e) => handleStatusChange(e.target.value)}
          disabled={disabled}
          aria-label="Change status"
          title="Change status"
        >
          <option value="">Change status…</option>
          {Object.entries(STATUSES).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select
          key={`priority-${actionNonce}`}
          className={s.actionSelect}
          value={ticket?.priority || ""}
          onChange={(e) => handlePriorityChange(e.target.value)}
          disabled={disabled}
          aria-label="Change priority"
          title="Change priority"
        >
          <option value="">Change priority…</option>
          {Object.entries(PRIORITIES).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`${s.btnSmall} ${s.btnSmallGreen}`}
          onClick={handleResolve}
          disabled={disabled || ticket?.status === "resolved"}
        >
          Resolve
        </button>
        <button
          type="button"
          className={`${s.btnSmall} ${s.btnSmallGrey}`}
          onClick={handleClose}
          disabled={disabled || ticket?.status === "closed"}
        >
          Close
        </button>
        <button
          type="button"
          className={s.btnSmall}
          onClick={handleReopen}
          disabled={disabled || (ticket?.status !== "resolved" && ticket?.status !== "closed")}
        >
          Reopen
        </button>
        <button type="button" className={`${s.btnSmall} ${s.btnSmallDanger}`} onClick={handleDelete} disabled={disabled}>
          Delete
        </button>
      </>
    );
  }

  function renderConversation() {
    const ticket = selectedTicket;
    const replies = detail?.replies || [];
    return (
      <div className={s.conversation}>
        <div className={s.chatMessages}>
          <div className={`${s.chatMsg} ${s.chatMsgUser}`}>
            <div className={s.chatMeta}>
              <span className={s.chatAuthor}>{ticket.created_by_name || "Reporter"}</span>
              <span className={s.chatTag}>Reporter</span>
              <span className={s.chatTime}>{formatDateTime(ticket.created_at)}</span>
            </div>
            <div className={s.chatText}>{ticket.description || "No description provided."}</div>
          </div>
          {replies.map((reply) => (
            <div key={reply.id} className={`${s.chatMsg} ${reply.is_admin ? s.chatMsgAdmin : s.chatMsgUser}`}>
              <div className={s.chatMeta}>
                <span className={s.chatAuthor}>{reply.sender_name || (reply.is_admin ? "Admin" : "Reporter")}</span>
                <span className={s.chatTag}>{reply.is_admin ? "Admin" : "Reporter"}</span>
                <span className={s.chatTime}>{formatDateTime(reply.created_at)}</span>
              </div>
              <div className={s.chatText}>{reply.message}</div>
            </div>
          ))}
        </div>
        <div className={s.conversationActions}>
          <button
            type="button"
            className={`${s.btnSmall} ${s.btnSmallGreen}`}
            onClick={handleResolve}
            disabled={actionBusy || ticket?.status === "resolved"}
          >
            Resolve
          </button>
          <button
            type="button"
            className={`${s.btnSmall} ${s.btnSmallGrey}`}
            onClick={handleClose}
            disabled={actionBusy || ticket?.status === "closed"}
          >
            Close
          </button>
        </div>
        <div className={s.replyArea}>
          <textarea
            className={s.replyInput}
            rows={2}
            placeholder="Write a reply… (Ctrl+Enter to send)"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={handleReplyKeyDown}
            disabled={replying}
            aria-label="Admin reply"
          />
          <button type="button" className={s.sendBtn} onClick={handleSendReply} disabled={replying || !replyText.trim()}>
            {ICONS.send}
            {replying ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    );
  }

  function renderOverview() {
    const t = selectedTicket;
    const fields = [
      ["Reporter", t.created_by_name || "—"],
      ["Org", t.organization_name || "—"],
      ["Category", CATEGORIES[t.category] || t.category || "—"],
      ["Priority", PRIORITIES[t.priority] || t.priority || "—"],
      ["Module", t.affected_module || "—"],
      ["Status", renderStatusBadge(t.status)],
      ["Assigned To", t.assignee_name || "Unassigned"],
      ["Created", formatDateTime(t.created_at)],
      ["Updated", formatDateTime(t.updated_at)],
      ["Browser", t.browser || "—"],
      ["OS", t.os || "—"],
    ];
    return (
      <div className={s.infoGrid}>
        {fields.map(([label, value]) => (
          <div key={label} className={s.infoCard}>
            <span className={s.infoLabel}>{label}</span>
            <span className={s.infoValue}>{value}</span>
          </div>
        ))}
        <div className={`${s.infoCard} ${s.infoCardWide}`}>
          <span className={s.infoLabel}>Steps to Reproduce</span>
          <span className={s.infoValue}>{t.steps_to_reproduce || "—"}</span>
        </div>
        <div className={`${s.infoCard} ${s.infoCardWide}`}>
          <span className={s.infoLabel}>Expected Behaviour</span>
          <span className={s.infoValue}>{t.expected_behaviour || "—"}</span>
        </div>
        <div className={`${s.infoCard} ${s.infoCardWide}`}>
          <span className={s.infoLabel}>Actual Behaviour</span>
          <span className={s.infoValue}>{t.actual_behaviour || "—"}</span>
        </div>
        {t.additional_notes ? (
          <div className={`${s.infoCard} ${s.infoCardWide}`}>
            <span className={s.infoLabel}>Additional Notes</span>
            <span className={s.infoValue}>{t.additional_notes}</span>
          </div>
        ) : null}
      </div>
    );
  }

  function renderActivity() {
    const items = activity?.activity || [];
    if (!items.length) {
      return (
        <div className={s.panelEmpty}>
          {ICONS.activity}
          <p>No activity recorded for this ticket yet.</p>
        </div>
      );
    }
    return (
      <div className={s.timeline}>
        {items.map((item) => (
          <div key={item.id} className={s.timelineItem}>
            <span className={s.timelineDot} />
            <div className={s.timelineContent}>
              <div className={s.timelineTitle}>{item.description || item.action}</div>
              <div className={s.timelineMeta}>
                {item.actor_email || "System"} · {formatDateTime(item.created_at)}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderAudit() {
    const items = audit?.audit_logs || [];
    if (!items.length) {
      return (
        <div className={s.panelEmpty}>
          {ICONS.list}
          <p>No audit entries for this ticket yet.</p>
        </div>
      );
    }
    return (
      <div className={s.auditTableWrap}>
        <table className={s.auditTable}>
          <thead>
            <tr>
              <th>Actor</th>
              <th>Action</th>
              <th>Old Value</th>
              <th>New Value</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className={s.auditActor}>{item.actor_email || "—"}</td>
                <td>
                  <span className={s.auditAction}>{item.action}</span>
                </td>
                <td className={s.auditValue}>{formatAuditValue(item.old_value)}</td>
                <td className={s.auditValue}>{formatAuditValue(item.new_value)}</td>
                <td className={s.auditTime}>{formatDateTime(item.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderPanelSkeleton() {
    return (
      <div className={s.panelSkeleton}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className={`${s.skeleton} ${s.skeletonPulse}`} style={{ height: 14 }} />
        ))}
      </div>
    );
  }

  function renderSkeleton() {
    return (
      <>
        <div className={s.kpiRow}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className={`${s.kpiCard} ${s.skeletonCard}`}>
              <div className={`${s.skeleton} ${s.skeletonPulse}`} style={{ height: 56, width: "100%" }} />
            </div>
          ))}
        </div>
        <div className={`${s.tableWrap} ${s.skeletonTable}`}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={s.skeletonRow}>
              <div className={`${s.skeleton} ${s.skeletonPulse}`} style={{ width: "12%", height: 16 }} />
              <div className={`${s.skeleton} ${s.skeletonPulse}`} style={{ width: "26%", height: 16 }} />
              <div className={`${s.skeleton} ${s.skeletonPulse}`} style={{ width: "16%", height: 16 }} />
              <div className={`${s.skeleton} ${s.skeletonPulse}`} style={{ width: "14%", height: 16 }} />
              <div className={`${s.skeleton} ${s.skeletonPulse}`} style={{ width: "16%", height: 16 }} />
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <div className={s.page}>
      <header className={s.pageHeader}>
        <div>
          <h1 className={s.pageTitle}>Support Tickets</h1>
          <p className={s.pageSubtitle}>Manage support requests submitted by recruiters across all organizations.</p>
        </div>
        <div className={s.headerActions}>
          <button type="button" className={s.btnGhost} onClick={handleExportCsv} disabled={exporting}>
            {ICONS.download}
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </header>

      {exportError && (
        <div className={s.inlineBanner}>
          {exportError}
          <button type="button" className={s.retryBtn} onClick={handleExportCsv}>
            Retry
          </button>
        </div>
      )}

      {statsError && <div className={s.inlineBanner}>{statsError}</div>}

      {ticketsLoading && !tickets.length ? (
        renderSkeleton()
      ) : (
        <>
          <div className={s.kpiRow}>
            {kpis.map((kpi) => (
              <div key={kpi.key} className={`${s.kpiCard} ${toneClass[kpi.tone]}`}>
                <div className={s.kpiIcon}>{kpi.icon}</div>
                <div className={s.kpiText}>
                  <div className={s.kpiValue}>{kpi.value}</div>
                  <div className={s.kpiLabel}>{kpi.label}</div>
                </div>
              </div>
            ))}
          </div>

          <div className={s.toolbar}>
            <div className={s.toolbarLeft}>
              <div className={s.searchWrap}>
                <span className={s.searchIcon}>{ICONS.search}</span>
                <input
                  type="search"
                  className={s.searchInput}
                  placeholder="Search tickets, reporters…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select
                className={s.filterSelect}
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                aria-label="Filter by status"
              >
                <option value="">All statuses</option>
                {Object.entries(STATUSES).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                className={s.filterSelect}
                value={priorityFilter}
                onChange={(e) => {
                  setPriorityFilter(e.target.value);
                  setPage(1);
                }}
                aria-label="Filter by priority"
              >
                <option value="">All priorities</option>
                {Object.entries(PRIORITIES).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                className={s.filterSelect}
                value={categoryFilter}
                onChange={(e) => {
                  setCategoryFilter(e.target.value);
                  setPage(1);
                }}
                aria-label="Filter by category"
              >
                <option value="">All categories</option>
                {Object.entries(CATEGORIES).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                className={s.filterSelect}
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value);
                  setPage(1);
                }}
                aria-label="Sort tickets"
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="priority">Priority</option>
                <option value="updated">Updated</option>
              </select>
            </div>
          </div>

          {ticketsError && (
            <div className={s.inlineBanner}>
              {ticketsError}
              <button type="button" className={s.retryBtn} onClick={() => loadTickets()}>
                Retry
              </button>
            </div>
          )}

          {!ticketsLoading && tickets.length === 0 ? (
            <div className={s.emptyState}>
              <div className={s.emptyIcon}>{ICONS.ticket}</div>
              <h3 className={s.emptyTitle}>No Support Tickets Yet</h3>
              <p className={s.emptyDesc}>
                Support requests submitted by recruiters will appear here. Invite recruiters to start using the platform
                so their questions reach your team.
              </p>
              <button type="button" className={s.btnPrimary} onClick={onNavigateToRecruiters}>
                {ICONS.users}
                Invite Recruiters
              </button>
            </div>
          ) : filteredTickets.length === 0 ? (
            <div className={s.emptyState}>
              <div className={s.emptyIcon}>{ICONS.search}</div>
              <h3 className={s.emptyTitle}>No matching tickets</h3>
              <p className={s.emptyDesc}>No tickets match your search or filters. Try adjusting your criteria.</p>
              <button type="button" className={s.btnGhost} onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          ) : (
            <>
              {selectedIds.size > 0 && (
                <div className={s.bulkBar}>
                  <div className={s.bulkBarLeft}>
                    <span className={s.bulkCount}>
                      {selectedIds.size} selected
                    </span>
                    <button type="button" className={s.bulkAction} onClick={toggleSelectAll}>
                      {allSelected ? "Deselect all" : "Select all visible"}
                    </button>
                  </div>
                  <div className={s.bulkBarRight}>
                    <button type="button" className={s.bulkAction} onClick={() => setSelectedIds(new Set())}>
                      Clear selection
                    </button>
                  </div>
                </div>
              )}
              {renderTable()}
              {renderPagination()}
            </>
          )}
        </>
      )}

      {panelOpen && <div className={s.panelOverlay} onClick={closePanel} />}
      <aside className={`${s.panel} ${panelOpen ? s.panelOpen : s.panelClosed}`} aria-hidden={!panelOpen} aria-label="Ticket detail">
        {selectedTicket && (
          <>
            <div className={s.panelHeader}>
              <div className={s.panelHeaderInfo}>
                <div className={s.panelTitle}>{selectedTicket.ticket_id || "Ticket"}</div>
                <div className={s.panelBadges}>
                  {renderStatusBadge(selectedTicket.status)}
                  {renderPriorityBadge(selectedTicket.priority)}
                </div>
              </div>
              <button type="button" className={s.closeBtn} onClick={closePanel} aria-label="Close detail panel">
                {ICONS.x}
              </button>
            </div>
            <div className={s.actionBar}>{renderActionBar()}</div>
            {actionError && <div className={s.actionError}>{actionError}</div>}
            <div className={s.tabs} role="tablist">
              <button
                type="button"
                role="tab"
                className={`${s.tab} ${activeTab === "conversation" ? s.tabActive : ""}`}
                onClick={() => setActiveTab("conversation")}
              >
                Conversation
              </button>
              <button
                type="button"
                role="tab"
                className={`${s.tab} ${activeTab === "overview" ? s.tabActive : ""}`}
                onClick={() => setActiveTab("overview")}
              >
                Overview
              </button>
              <button
                type="button"
                role="tab"
                className={`${s.tab} ${activeTab === "activity" ? s.tabActive : ""}`}
                onClick={() => setActiveTab("activity")}
              >
                Activity{activity?.count != null ? ` (${activity.count})` : ""}
              </button>
              <button
                type="button"
                role="tab"
                className={`${s.tab} ${activeTab === "audit" ? s.tabActive : ""}`}
                onClick={() => setActiveTab("audit")}
              >
                Audit{audit?.count != null ? ` (${audit.count})` : ""}
              </button>
            </div>
          </>
        )}
        <div className={s.panelBody}>
          {panelError && (
            <div className={s.panelError}>
              {panelError}
              <button type="button" className={s.retryBtn} onClick={() => loadDetail(selectedTicket.id)}>
                Retry
              </button>
            </div>
          )}
          {selectedTicket && panelLoading && !detail ? renderPanelSkeleton() : null}
          {selectedTicket && !panelLoading && (
            <>
              {activeTab === "conversation" && renderConversation()}
              {activeTab === "overview" && renderOverview()}
              {activeTab === "activity" && renderActivity()}
              {activeTab === "audit" && renderAudit()}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

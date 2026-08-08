"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import RecruiterShell from "@/components/recruiter/RecruiterShell";
import ProtectedRecruiterRoute from "@/components/ProtectedRecruiterRoute";
import styles from "@/components/recruiter/recruiter-shell.module.css";
import support from "./support.module.css";
import {
  closeTicket,
  createTicket,
  getApiErrorMessage,
  getMyTicketStats,
  getTicket,
  listMyTickets,
  replyToTicket,
} from "@/services/authService";
import { clearRecruiterContext, publishRecruiterContext } from "@/lib/ai/recruiterContext";

const CATEGORIES = { bug_report: "Bug Report", feature_request: "Feature Request", performance: "Performance", ui_issue: "UI Issue", login_issue: "Login Issue", permission_issue: "Permission Issue", ai_assistant: "AI Assistant", recruitment: "Recruitment", employee_module: "Employee Module", learning: "Learning", analytics: "Analytics", billing: "Billing", security: "Security", integration: "Integration", api: "API", other: "Other" };
const PRIORITIES = { low: "Low", medium: "Medium", high: "High", critical: "Critical" };
const STATUSES = { open: "Open", in_progress: "In Progress", waiting: "Waiting", resolved: "Resolved", closed: "Closed" };
const MODULES = { recruitment: "Recruitment", employees: "Employees", learning: "Learning", analytics: "Analytics", ai: "AI", reports: "Reports", dashboard: "Dashboard", organization: "Organization", settings: "Settings", system: "System" };

const PAGE_SIZE = 8;

const EMPTY_FORM = {
  subject: "",
  category: "",
  priority: "",
  affected_module: "",
  description: "",
};

const ICONS = {
  open: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8M8 17h5" />
    </svg>
  ),
  inProgress: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  ),
  resolved: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 12l2 2 4-4" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  ),
  total: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
};

export default function RecruiterSupportPage() {
  return (
    <ProtectedRecruiterRoute requiredCapability="support">
      <RecruiterSupportPageContent />
    </ProtectedRecruiterRoute>
  );
}

function RecruiterSupportPageContent() {
  const [tickets, setTickets] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [createMode, setCreateMode] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [ticketDetail, setTicketDetail] = useState(null);
  const [detailTab, setDetailTab] = useState("conversation");
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [closing, setClosing] = useState(false);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      const data = await listMyTickets(accessToken, {
        search: search.trim() || undefined,
        status: statusFilter || undefined,
        priority: priorityFilter || undefined,
        page,
        page_size: PAGE_SIZE,
      });
      setTickets(data.tickets || []);
      setTotal(data.total || 0);
      setError("");
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not load support tickets."));
    } finally {
      setLoading(false);
    }
    try {
      const statsData = await getMyTicketStats(accessToken);
      setStats(statsData);
    } catch (err) {
      setStats(null);
    }
  }, [search, statusFilter, priorityFilter, page]);

  useEffect(() => {
    const timer = setTimeout(loadTickets, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [loadTickets, search]);

  function closePanels() {
    setCreateMode(false);
    setSelectedTicket(null);
    setTicketDetail(null);
    setDetailTab("conversation");
    setReplyText("");
  }

  async function openTicket(ticket) {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setSelectedTicket(ticket);
    setTicketDetail(null);
    setDetailTab("conversation");
    setReplyText("");
    setError("");
    try {
      const data = await getTicket(ticket.ticket_id || ticket.id, accessToken);
      setTicketDetail({ ticket: data.ticket, replies: data.replies || [] });
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not load ticket details."));
      setSelectedTicket(null);
    }
  }

  async function handleCreate(event) {
    event.preventDefault();
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setCreating(true);
    try {
      const ticketPromise = createTicket(
        {
          subject: form.subject.trim(),
          category: form.category,
          priority: form.priority,
          affected_module: form.affected_module,
          description: form.description.trim(),
        },
        accessToken
      );
      const ticket = await toast.promise(ticketPromise, {
        pending: "Creating support ticket...",
        success: "Support ticket sent.",
        error: {
          render({ data }) {
            return getApiErrorMessage(data, "Could not create the support ticket.");
          },
        },
      });
      setForm(EMPTY_FORM);
      setCreateMode(false);
      if (page !== 1) setPage(1);
      await loadTickets();
      openTicket(ticket);
    } catch (err) {
      if (String(err?.message || "").includes("toast")) return;
      setError(getApiErrorMessage(err, "Could not create the support ticket."));
    } finally {
      setCreating(false);
    }
  }

  async function handleSendReply() {
    const message = replyText.trim();
    if (!message || !ticketDetail) return;
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setSendingReply(true);
    try {
      const data = await replyToTicket(ticketDetail.ticket.ticket_id || ticketDetail.ticket.id, { message }, accessToken);
      setTicketDetail((current) => ({
        ...current,
        replies: [...current.replies, data.reply],
      }));
      setReplyText("");
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not send your reply."));
    } finally {
      setSendingReply(false);
    }
  }

  async function handleCloseTicket() {
    if (!ticketDetail) return;
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setClosing(true);
    try {
      const data = await closeTicket(ticketDetail.ticket.ticket_id || ticketDetail.ticket.id, accessToken);
      setTicketDetail((current) => ({ ...current, ticket: data.ticket || current.ticket }));
      setSelectedTicket((current) => (current ? { ...current, status: data.ticket?.status || current.status } : current));
      await loadTickets();
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not close the ticket."));
    } finally {
      setClosing(false);
    }
  }

  const hasFilters = Boolean(search.trim() || statusFilter || priorityFilter);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    const body = document.body;
    const shouldElevateMascot = createMode || Boolean(selectedTicket);
    if (shouldElevateMascot) {
      body.classList.add("support-mascot-high");
    } else {
      body.classList.remove("support-mascot-high");
    }
    return () => {
      body.classList.remove("support-mascot-high");
    };
  }, [createMode, selectedTicket]);

  useEffect(() => {
    if (createMode) {
      publishRecruiterContext({
        section: "create_ticket",
        label: "Create support ticket",
        hint: "Fill the ticket subject first, then pick category, priority, affected module, and describe the issue clearly.",
        fields: ["subject", "category", "priority", "affected_module", "description"],
      });
      return () => clearRecruiterContext();
    }

    if (selectedTicket) {
      publishRecruiterContext({
        section: "ticket_details",
        label: selectedTicket.subject || selectedTicket.ticket_id || "Ticket details",
        hint: detailTab === "conversation"
          ? "Read the thread, reply with the next update, or close the ticket when it is done."
          : "Review the ticket details and status before replying or closing.",
        fields: detailTab === "conversation" ? ["reply"] : [],
      });
      return () => clearRecruiterContext();
    }

    publishRecruiterContext({
      section: "support_center",
      label: "Support Center",
      hint: "Use Create Ticket to file an issue, or open any ticket below to reply and track progress.",
      fields: [],
    });
    return () => clearRecruiterContext();
  }, [createMode, selectedTicket, detailTab]);

  function buildMessages() {
    if (!ticketDetail) return [];
    const messages = [];
    const ticket = ticketDetail.ticket;
    if (ticket.description) {
      messages.push({
        id: "description",
        message: ticket.description,
        is_admin: false,
        sender_name: ticket.created_by_name || "You",
        created_at: ticket.created_at,
      });
    }
    for (const reply of ticketDetail.replies) {
      messages.push({
        id: reply.id,
        message: reply.message,
        is_admin: Boolean(reply.is_admin),
        sender_name: reply.sender_name || (reply.is_admin ? "Support team" : "You"),
        created_at: reply.created_at,
      });
    }
    return messages;
  }

  const conversation = buildMessages();

  return (
    <RecruiterShell
      activeKey="support"
      capability="support"
      title="Support Center"
      subtitle="Submit a support request or track your existing tickets"
    >
      <div className={support.page}>
        {error && (
          <div className={styles.formMessage} role="alert">
            {error}
          </div>
        )}

        <div className={styles.hero} style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div className={styles.heroEyebrow}>Recruiter Support Center</div>
            <h1>Support Center</h1>
            <div className={styles.heroMeta}>Submit a support request or track your existing tickets</div>
          </div>
          {!createMode && !selectedTicket && (
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => { setError(""); setCreateMode(true); }}
              style={{ position: "relative", zIndex: 2 }}
            >
              + Create Ticket
            </button>
          )}
        </div>

        <div className={styles.stats}>
          <StatCard tone="green" value={stats ? stats.open ?? 0 : "—"} label="Open" icon={ICONS.open} />
          <StatCard tone="orange" value={stats ? stats.by_status?.in_progress ?? 0 : "—"} label="In Progress" icon={ICONS.inProgress} />
          <StatCard tone="cyan" value={stats ? stats.resolved ?? 0 : "—"} label="Resolved" icon={ICONS.resolved} />
          <StatCard tone="navy" value={stats ? stats.total ?? 0 : "—"} label="Total" icon={ICONS.total} />
        </div>

        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionHeadLeft}>
              <div className={`${styles.bar} ${styles.cyan}`} />
              <div>
                <div className={styles.sectionTitle}>My tickets</div>
                <div className={styles.sectionDesc}>
                  {total} ticket{total === 1 ? "" : "s"} · search, filter, and open any ticket to reply or track it
                </div>
              </div>
            </div>
          </div>
          <div className={styles.sectionBody}>
            <div className={support.filterBar}>
              <div className={support.searchWrap}>
                <span className={support.searchIcon}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                    <circle cx="11" cy="11" r="7" />
                    <path d="M21 21l-4.35-4.35" />
                  </svg>
                </span>
                <input
                  className={support.filterInput}
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  placeholder="Search tickets by subject…"
                  aria-label="Search tickets"
                />
              </div>
              <select className={support.filterSelect} value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} aria-label="Filter by status">
                <option value="">All statuses</option>
                {Object.entries(STATUSES).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <select className={support.filterSelect} value={priorityFilter} onChange={(e) => { setPriorityFilter(e.target.value); setPage(1); }} aria-label="Filter by priority">
                <option value="">All priorities</option>
                {Object.entries(PRIORITIES).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            <div className={support.tableWrap}>
              {loading && tickets.length === 0 ? (
                <div className={support.emptyState}>
                  <div className={support.emptyTitle}>Loading…</div>
                </div>
              ) : tickets.length ? (
                <>
                  <div style={{ overflowX: "auto" }}>
                    <table className={support.table}>
                      <thead className={support.thead}>
                        <tr>
                          <th className={support.th}>Ticket ID</th>
                          <th className={support.th}>Subject</th>
                          <th className={support.th}>Category</th>
                          <th className={support.th}>Priority</th>
                          <th className={support.th}>Status</th>
                          <th className={support.th}>Created</th>
                          <th className={support.th}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tickets.map((ticket) => (
                          <tr className={support.tr} key={ticket.id}>
                            <td className={support.td}>
                              <span style={{ fontWeight: 700, color: "#2563eb", whiteSpace: "nowrap" }}>{ticket.ticket_id}</span>
                            </td>
                            <td className={support.td}>
                              <span style={{ fontWeight: 600, color: "#111827" }}>{ticket.subject}</span>
                            </td>
                            <td className={support.td}>{CATEGORIES[ticket.category] || ticket.category || "—"}</td>
                            <td className={support.td}>
                              <span className={`${support.badge} ${priorityClass(ticket.priority)}`}>
                                {PRIORITIES[ticket.priority] || ticket.priority}
                              </span>
                            </td>
                            <td className={support.td}>
                              <span className={`${support.badge} ${statusClass(ticket.status)}`}>
                                {STATUSES[ticket.status] || ticket.status}
                              </span>
                            </td>
                            <td className={support.td} style={{ color: "#64748b", whiteSpace: "nowrap" }}>{formatDate(ticket.created_at)}</td>
                            <td className={support.td}>
                              <button type="button" className={styles.secondaryButton} onClick={() => openTicket(ticket)}>
                                Open
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className={support.pagination}>
                    <button type="button" className={support.pageBtn} disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                      Previous
                    </button>
                    <span className={support.pageInfo}>
                      Page {page} of {totalPages}
                    </span>
                    <button type="button" className={support.pageBtn} disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>
                      Next
                    </button>
                  </div>
                </>
              ) : (
                <div className={support.emptyState}>
                  <div className={support.emptyTitle}>
                    {hasFilters ? "No tickets match your filters" : "No tickets yet — create your first support ticket"}
                  </div>
                  <div className={support.emptyDesc}>
                    {hasFilters
                      ? "Try clearing the search or filters to see all your tickets."
                      : "Submit a support request and the support team will pick it up here."}
                  </div>
                  {!hasFilters && (
                    <button
                      type="button"
                      className={support.btnPrimary}
                      onClick={() => { setError(""); setCreateMode(true); }}
                      style={{ position: "relative", zIndex: 2 }}
                    >
                      Create Ticket
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {(createMode || selectedTicket) && (
          <div
            className={support.panelOverlay}
            onClick={closePanels}
            style={{ opacity: createMode || selectedTicket ? 1 : 0 }}
          />
        )}

        <div className={`${support.panel} ${createMode ? support.panelOpen : support.panelClosed}`} role="dialog" aria-modal="true" aria-label="Create support ticket">
          <div className={support.panelHeader}>
            <div className={support.panelTitle}>Create support ticket</div>
            <button
              type="button"
              onClick={closePanels}
              disabled={creating}
              style={{ background: "transparent", border: "none", fontSize: 24, color: "#94a3b8", cursor: "pointer", lineHeight: 1, padding: 0 }}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <form
            data-partner-coach
            onSubmit={handleCreate}
            data-mascot-command={!createMode ? "" : undefined}
            style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
          >
            <div className={support.panelBody}>
              <div className={support.formField}>
                <label className={support.formLabel} htmlFor="ticket-subject">Subject</label>
                <input
                  data-field-key="subject"
                  id="ticket-subject"
                  className={support.formInput}
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  required
                  minLength={3}
                  maxLength={150}
                  placeholder="e.g. Can't open the candidate list"
                />
              </div>
              <div className={support.formField}>
                <label className={support.formLabel} htmlFor="ticket-category">Category</label>
                <select
                  data-field-key="category"
                  id="ticket-category"
                  className={support.formSelect}
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  required
                >
                  <option value="" disabled>Select a category</option>
                  {Object.entries(CATEGORIES).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div className={support.formField}>
                <label className={support.formLabel} htmlFor="ticket-priority">Priority</label>
                <select
                  data-field-key="ticket_priority"
                  id="ticket-priority"
                  className={support.formSelect}
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  required
                >
                  <option value="" disabled>Select a priority</option>
                  {Object.entries(PRIORITIES).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div className={support.formField}>
                <label className={support.formLabel} htmlFor="ticket-module">Affected Module</label>
                <select
                  data-field-key="affected_module"
                  id="ticket-module"
                  className={support.formSelect}
                  value={form.affected_module}
                  onChange={(e) => setForm({ ...form, affected_module: e.target.value })}
                  required
                >
                  <option value="" disabled>Select an affected module</option>
                  {Object.entries(MODULES).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div className={support.formField}>
                <label className={support.formLabel} htmlFor="ticket-description">Description</label>
                <textarea
                  data-field-key="ticket_description"
                  id="ticket-description"
                  className={support.formTextarea}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  required
                  minLength={10}
                  maxLength={4000}
                  rows={6}
                  placeholder="Describe the issue, what you expected, and any steps to reproduce it…"
                />
              </div>
            </div>
            <div className={support.panelFooter}>
              <button type="button" className={support.btnGhost} onClick={closePanels} disabled={creating}>
                Cancel
              </button>
              <button type="submit" className={support.btnPrimary} disabled={creating}>
                {creating && <span className={support.spinner} style={{ marginRight: 8 }} />}
                {creating ? "Creating…" : "Submit ticket"}
              </button>
            </div>
          </form>
        </div>

        <div className={`${support.panel} ${selectedTicket ? support.panelOpen : support.panelClosed}`} role="dialog" aria-modal="true" aria-label="Ticket details">
          <div className={support.panelHeader}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className={support.panelTitle}>{selectedTicket?.ticket_id || "Ticket"}</div>
              <div style={{ fontSize: 13, color: "#64748b", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {selectedTicket?.subject || ""}
              </div>
            </div>
            {selectedTicket && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <span className={`${support.badge} ${priorityClass(selectedTicket.priority)}`}>
                  {PRIORITIES[selectedTicket.priority] || selectedTicket.priority}
                </span>
                <span className={`${support.badge} ${statusClass(selectedTicket.status)}`}>
                  {STATUSES[selectedTicket.status] || selectedTicket.status}
                </span>
                <button
                  type="button"
                  onClick={closePanels}
                  style={{ background: "transparent", border: "none", fontSize: 24, color: "#94a3b8", cursor: "pointer", lineHeight: 1, padding: 0, marginLeft: 4 }}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            )}
          </div>

          <div className={support.panelBody}>
            <div className={support.tabs}>
              <button type="button" className={`${support.tab} ${detailTab === "conversation" ? support.tabActive : ""}`} onClick={() => setDetailTab("conversation")}>
                Conversation
              </button>
              <button type="button" className={`${support.tab} ${detailTab === "details" ? support.tabActive : ""}`} onClick={() => setDetailTab("details")}>
                Details
              </button>
            </div>

            {!ticketDetail ? (
              <div className={support.emptyState}>
                <div className={support.emptyTitle}>Loading…</div>
              </div>
            ) : detailTab === "conversation" ? (
              <>
                <div className={support.chatMessages}>
                  {conversation.length ? (
                    conversation.map((message) => (
                      <div
                        key={message.id}
                        className={`${support.chatMsg} ${message.is_admin ? support.chatMsgAdmin : support.chatMsgUser}`}
                      >
                        <div>{message.message}</div>
                        <div className={support.chatMeta}>
                          {message.is_admin ? "Support team" : message.sender_name} · {formatDateTime(message.created_at)}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p style={{ fontSize: 13, color: "#94a3b8" }}>No messages yet — the support team will respond shortly.</p>
                  )}
                </div>
                <form data-partner-coach className={support.replyArea} onSubmit={(e) => { e.preventDefault(); handleSendReply(); }}>
                  <textarea
                    data-field-key="reply"
                    className={support.replyInput}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Write a reply…"
                    rows={2}
                    aria-label="Reply message"
                  />
                  <button
                    type="submit"
                    className={support.sendBtn}
                    disabled={sendingReply || !replyText.trim()}
                  >
                    {sendingReply ? <span className={support.spinner} /> : "Send"}
                  </button>
                </form>
              </>
            ) : (
              <div className={support.detailGrid}>
                <div className={support.detailItem}>
                  <div className={support.detailLabel}>Ticket ID</div>
                  <div className={support.detailValue}>{ticketDetail.ticket.ticket_id}</div>
                </div>
                <div className={support.detailItem}>
                  <div className={support.detailLabel}>Status</div>
                  <div className={support.detailValue}>{STATUSES[ticketDetail.ticket.status] || ticketDetail.ticket.status}</div>
                </div>
                <div className={support.detailItem}>
                  <div className={support.detailLabel}>Category</div>
                  <div className={support.detailValue}>{CATEGORIES[ticketDetail.ticket.category] || ticketDetail.ticket.category}</div>
                </div>
                <div className={support.detailItem}>
                  <div className={support.detailLabel}>Priority</div>
                  <div className={support.detailValue}>{PRIORITIES[ticketDetail.ticket.priority] || ticketDetail.ticket.priority}</div>
                </div>
                <div className={support.detailItem}>
                  <div className={support.detailLabel}>Affected Module</div>
                  <div className={support.detailValue}>{MODULES[ticketDetail.ticket.affected_module] || ticketDetail.ticket.affected_module || "—"}</div>
                </div>
                <div className={support.detailItem}>
                  <div className={support.detailLabel}>Created by</div>
                  <div className={support.detailValue}>{ticketDetail.ticket.created_by_name || "—"}</div>
                </div>
                <div className={support.detailItem}>
                  <div className={support.detailLabel}>Assignee</div>
                  <div className={support.detailValue}>{ticketDetail.ticket.assignee_name || "Unassigned"}</div>
                </div>
                <div className={support.detailItem}>
                  <div className={support.detailLabel}>Created</div>
                  <div className={support.detailValue}>{formatDateTime(ticketDetail.ticket.created_at)}</div>
                </div>
                <div className={support.detailItem}>
                  <div className={support.detailLabel}>Updated</div>
                  <div className={support.detailValue}>{formatDateTime(ticketDetail.ticket.updated_at)}</div>
                </div>
                <div className={support.detailItem}>
                  <div className={support.detailLabel}>Resolved</div>
                  <div className={support.detailValue}>{formatDateTime(ticketDetail.ticket.resolved_at)}</div>
                </div>
                <div className={support.detailItem}>
                  <div className={support.detailLabel}>Closed</div>
                  <div className={support.detailValue}>{formatDateTime(ticketDetail.ticket.closed_at)}</div>
                </div>
                <div className={support.detailItem} style={{ gridColumn: "1 / -1" }}>
                  <div className={support.detailLabel}>Description</div>
                  <div className={support.detailValue} style={{ fontWeight: 400, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                    {ticketDetail.ticket.description || "—"}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className={support.panelFooter}>
            {selectedTicket && ["open", "in_progress"].includes(selectedTicket.status) && (
              <button type="button" className={support.btnDanger} onClick={handleCloseTicket} disabled={closing}>
                {closing && <span className={support.spinner} style={{ marginRight: 8 }} />}
                {closing ? "Closing…" : "Close Ticket"}
              </button>
            )}
            <button type="button" className={support.btnGhost} onClick={closePanels}>
              Close
            </button>
          </div>
        </div>
      </div>
    </RecruiterShell>
  );
}

function StatCard({ icon, tone, value, label }) {
  return (
    <div className={styles.statCard}>
      <div className={`${styles.statIcon} ${styles[tone]}`}>{icon}</div>
      <div className={styles.statText}>
        <div className={styles.statValue}>{value}</div>
        <div className={styles.statLabel}>{label}</div>
      </div>
    </div>
  );
}

function priorityClass(priority) {
  switch (priority) {
    case "low": return support.priorityLow;
    case "medium": return support.priorityMedium;
    case "high": return support.priorityHigh;
    case "critical": return support.priorityCritical;
    default: return "";
  }
}

function statusClass(status) {
  switch (status) {
    case "open": return support.statusOpen;
    case "in_progress": return support.statusInProgress;
    case "waiting": return support.statusWaiting;
    case "resolved": return support.statusResolved;
    case "closed": return support.statusClosed;
    default: return "";
  }
}

function formatDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

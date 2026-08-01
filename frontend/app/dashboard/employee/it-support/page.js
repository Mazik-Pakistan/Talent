"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import EmployeeShell from "@/components/employee/EmployeeShell";
import RecruiterLoader from "@/components/recruiter/RecruiterLoader";
import dashStyles from "@/app/dashboard/employee/employee-dashboard.module.css";
import {
  createMyItServiceRequest,
  getApiErrorMessage,
  listMyItServiceRequests,
} from "@/services/authService";

const TYPE_LABELS = {
  new_asset: "New asset",
  replacement: "Replacement",
  license: "Software license",
  access: "Access / permissions",
  other: "Other",
};

const TYPE_FORM_LABELS = {
  new_asset: "New asset (e.g. a monitor)",
  replacement: "Replacement (e.g. laptop not working)",
  license: "Software license",
  access: "Access / permissions",
  other: "Something else",
};

const inputStyle = {
  width: "100%",
  border: "1px solid #bed0dc",
  borderRadius: 8,
  padding: "11px 13px",
  font: "inherit",
  background: "#fff",
  color: "inherit",
};

function fmt(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) +
    " · " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function RequestTimeline({ r }) {
  const isCancelled = r.status === "cancelled";

  const steps = [
    {
      key: "submitted",
      label: "Submitted",
      desc: "Your request reached HR.",
      ts: r.created_at,
      done: true,
    },
    {
      key: "reviewing",
      label: "HR reviewing",
      desc: "HR has seen your request and is reviewing it.",
      ts: r.reviewed_at,
      done: !!r.reviewed_at,
    },
    {
      key: "sent",
      label: "Forwarded to IT",
      desc: r.it_manager_email
        ? `HR forwarded this to ${r.it_manager_email}.`
        : "HR forwarded this to the IT officer.",
      ts: r.sent_at,
      done: !!r.sent_at,
    },
    {
      key: "resolved",
      label: "Resolved",
      desc: r.fulfillment_note
        ? `IT resolved this: ${r.fulfillment_note}${r.serial_number ? ` (Serial: ${r.serial_number})` : ""}`
        : "IT has resolved your request.",
      ts: r.fulfilled_at,
      done: r.status === "fulfilled",
    },
  ];

  return (
    <div style={{ marginTop: 14, padding: "4px 0" }}>
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
            const isActive = step.done && (isLast || !steps[i + 1]?.done);
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
                      transition: "all 0.2s",
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
                  {step.done && (
                    <div style={{ fontSize: 12, color: "#6b7a8f", marginTop: 1, lineHeight: 1.5 }}>
                      {step.desc}
                    </div>
                  )}
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

export default function EmployeeItSupportPage() {
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [form, setForm] = useState({ request_type: "replacement", title: "", description: "" });

  const load = useCallback(async () => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    try {
      const data = await listMyItServiceRequests(token);
      setRequests(data.requests || []);
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not load your IT requests."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate() {
    const token = localStorage.getItem("access_token");
    if (!token || submitting) return;
    if (!form.title.trim()) {
      toast.error("Tell us what you need.");
      return;
    }
    setSubmitting(true);
    try {
      await createMyItServiceRequest(
        {
          request_type: form.request_type,
          title: form.title.trim(),
          description: form.description.trim() || undefined,
        },
        token
      );
      toast.success("Request sent to HR. They will review it and forward to IT.");
      setForm({ request_type: "replacement", title: "", description: "" });
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not submit the request."));
    } finally {
      setSubmitting(false);
    }
  }

  function statusSummary(r) {
    if (r.status === "fulfilled") return { label: "Resolved", bg: "#def3ed", color: "#087a55" };
    if (r.status === "cancelled") return { label: "Cancelled", bg: "#f1f1f3", color: "#8b8b94" };
    if (r.status === "sent") return { label: "With IT", bg: "#fff3d6", color: "#92610a" };
    if (r.reviewed_at) return { label: "HR reviewing", bg: "#e8f0fd", color: "#1d4ed8" };
    return { label: "Waiting for HR", bg: "#eef2f7", color: "#475569" };
  }

  return (
    <EmployeeShell
      activeKey="it-support"
      title="IT support"
      subtitle="Need a new laptop, software, or access? Ask HR here — they pass your request to IT."
      permissions={["profile.view"]}
    >
      <div className={dashStyles.content}>
        <div className={dashStyles.section}>
          <div className={dashStyles.sectionHead}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div className={`${dashStyles.bar} ${dashStyles.navy}`} />
              <div>
                <div className={dashStyles.sectionTitle}>New IT request</div>
                <div style={{ fontSize: 12.5, color: "#6b7a8f" }}>
                  HR reviews your request and sends it to IT, who fulfills it.
                </div>
              </div>
            </div>
          </div>
          <div style={{ padding: "4px 18px 18px" }}>
            {error && <p style={{ color: "#c0392b", marginBottom: 12 }}>{error}</p>}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <label style={{ display: "block" }}>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#475569",
                    display: "block",
                    marginBottom: 6,
                  }}
                >
                  What do you need?
                </span>
                <select
                  style={inputStyle}
                  value={form.request_type}
                  onChange={(e) => setForm((f) => ({ ...f, request_type: e.target.value }))}
                >
                  {Object.entries(TYPE_FORM_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "block" }}>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#475569",
                    display: "block",
                    marginBottom: 6,
                  }}
                >
                  Short title
                </span>
                <input
                  style={inputStyle}
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Laptop not turning on, need replacement"
                />
              </label>
            </div>
            <label style={{ display: "block", marginBottom: 14 }}>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#475569",
                  display: "block",
                  marginBottom: 6,
                }}
              >
                Details (optional)
              </span>
              <textarea
                style={{ ...inputStyle, resize: "vertical" }}
                rows={3}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="What's wrong and what should IT know?"
              />
            </label>
            <button
              type="button"
              disabled={submitting}
              onClick={handleCreate}
              style={{
                width: "100%",
                border: "none",
                borderRadius: 10,
                padding: "13px 18px",
                background: "linear-gradient(135deg, #1e3a5f 0%, #2d6cdf 100%)",
                color: "#fff",
                fontSize: 15,
                fontWeight: 700,
                cursor: submitting ? "not-allowed" : "pointer",
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? "Submitting…" : "Send request to HR"}
            </button>
          </div>
        </div>

        <div className={dashStyles.section}>
          <div className={dashStyles.sectionHead}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div className={`${dashStyles.bar} ${dashStyles.cyan}`} />
              <div>
                <div className={dashStyles.sectionTitle}>My requests</div>
                <div style={{ fontSize: 12.5, color: "#6b7a8f" }}>
                  Click any request to see its full progress timeline.
                </div>
              </div>
            </div>
          </div>
          <div style={{ padding: "4px 18px 18px", display: "grid", gap: 10 }}>
            {loading ? (
              <RecruiterLoader />
            ) : requests.length === 0 ? (
              <p style={{ color: "#8b8b94", fontSize: 14 }}>
                No IT requests yet. Submit one above.
              </p>
            ) : (
              requests.map((r) => {
                const summary = statusSummary(r);
                const isOpen = expanded === r.request_id;
                return (
                  <div
                    key={r.request_id}
                    style={{
                      border: "1px solid var(--border, #e2e8f0)",
                      borderRadius: 12,
                      background: "#fff",
                      overflow: "hidden",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : r.request_id)}
                      style={{
                        width: "100%",
                        background: "none",
                        border: "none",
                        padding: "12px 14px",
                        cursor: "pointer",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                        textAlign: "left",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            alignItems: "center",
                            flexWrap: "wrap",
                            marginBottom: 3,
                          }}
                        >
                          <strong style={{ fontSize: 14, color: "#0f172a" }}>{r.title}</strong>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "2px 9px",
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: 800,
                              background: summary.bg,
                              color: summary.color,
                            }}
                          >
                            {summary.label}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: "#6b7a8f" }}>
                          {TYPE_LABELS[r.request_type] || r.request_type}
                          {r.created_at ? ` · ${fmt(r.created_at)}` : ""}
                        </div>
                      </div>
                      <span style={{ fontSize: 12, color: "#aab4bf", flexShrink: 0 }}>
                        {isOpen ? "▲" : "▼"}
                      </span>
                    </button>

                    {isOpen && (
                      <div
                        style={{
                          borderTop: "1px solid #eef2f7",
                          padding: "12px 14px 16px",
                        }}
                      >
                        {r.description && (
                          <p
                            style={{
                              margin: "0 0 12px",
                              fontSize: 13,
                              color: "#475569",
                              background: "#f7f9fc",
                              borderRadius: 8,
                              padding: "8px 12px",
                            }}
                          >
                            {r.description}
                          </p>
                        )}
                        <RequestTimeline r={r} />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </EmployeeShell>
  );
}

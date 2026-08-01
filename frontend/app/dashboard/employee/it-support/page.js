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
  new_asset: "New asset (e.g. a monitor)",
  replacement: "Replacement (e.g. laptop not working)",
  license: "Software license",
  access: "Access / permissions",
  other: "Something else",
};
const STATUS_LABELS = {
  draft: "Waiting for HR to send",
  sent: "Sent to IT — in progress",
  fulfilled: "Done",
  cancelled: "Cancelled",
};
const STATUS_COLORS = {
  draft: { bg: "#eef2f7", color: "#475569" },
  sent: { bg: "#fff3d6", color: "#92610a" },
  fulfilled: { bg: "#def3ed", color: "#087a55" },
  cancelled: { bg: "#f1f1f3", color: "#8b8b94" },
};

function chip(status) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.draft;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 800,
        background: c.bg,
        color: c.color,
      }}
    >
      {STATUS_LABELS[status] || status}
    </span>
  );
}

const inputStyle = {
  width: "100%",
  border: "1px solid #bed0dc",
  borderRadius: 8,
  padding: "11px 13px",
  font: "inherit",
  background: "#fff",
  color: "inherit",
};

export default function EmployeeItSupportPage() {
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
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
      const result = await createMyItServiceRequest(
        {
          request_type: form.request_type,
          title: form.title.trim(),
          description: form.description.trim() || undefined,
        },
        token
      );
      toast.success("Request sent to HR. They will forward it to IT.");
      setForm({ request_type: "replacement", title: "", description: "" });
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not submit the request."));
    } finally {
      setSubmitting(false);
    }
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
                <div className={dashStyles.sectionTitle}>Request IT help</div>
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
                <span style={{ fontSize: 12, fontWeight: 700, color: "#475569", display: "block", marginBottom: 6 }}>
                  What do you need?
                </span>
                <select
                  style={inputStyle}
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
              <label style={{ display: "block" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#475569", display: "block", marginBottom: 6 }}>
                  Short title
                </span>
                <input
                  style={inputStyle}
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. New laptop — current one is not working"
                />
              </label>
            </div>
            <label style={{ display: "block", marginBottom: 14 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#475569", display: "block", marginBottom: 6 }}>
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
                cursor: "pointer",
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
                <div style={{ fontSize: 12.5, color: "#6b7a8f" }}>Track the status of your IT help requests.</div>
              </div>
            </div>
          </div>
          <div style={{ padding: "4px 18px 18px", display: "grid", gap: 12 }}>
            {loading ? (
              <RecruiterLoader />
            ) : requests.length === 0 ? (
              <p style={{ color: "#8b8b94", fontSize: 14 }}>No IT requests yet. Submit one above.</p>
            ) : (
              requests.map((r) => (
                <div
                  key={r.request_id}
                  style={{
                    border: "1px solid var(--border, #e2e8f0)",
                    borderRadius: 12,
                    padding: 14,
                    background: "#fff",
                  }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 14 }}>{r.title}</strong>
                    {chip(r.status)}
                    <span style={{ fontSize: 11, color: "#6b7a8f" }}>
                      {TYPE_LABELS[r.request_type] || r.request_type} · {r.created_at ? r.created_at.slice(0, 10) : ""}
                    </span>
                  </div>
                  {r.description && (
                    <div style={{ fontSize: 13, color: "#475569", marginTop: 6 }}>{r.description}</div>
                  )}
                  {r.it_manager_email && (
                    <div style={{ fontSize: 12, color: "#0d5c91", marginTop: 6 }}>
                      Assigned IT: {r.it_manager_email}
                    </div>
                  )}
                  {r.status === "fulfilled" && (
                    <div style={{ fontSize: 13, color: "#087a55", marginTop: 6 }}>
                      IT resolved this: {r.fulfillment_note || "Done."}
                      {r.serial_number ? ` (Serial: ${r.serial_number})` : ""}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </EmployeeShell>
  );
}

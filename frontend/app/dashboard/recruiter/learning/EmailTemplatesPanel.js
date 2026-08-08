"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { getApiErrorMessage } from "@/services/authService";
import {
  listEmailTemplates,
  saveEmailTemplate,
  resetEmailTemplate,
} from "@/services/orgFrameworkService";
import { Mail, Pencil, RotateCcw, X, Check } from "lucide-react";
import s from "./OrgFrameworkTab.module.css";

export default function EmailTemplatesPanel() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [formSubject, setFormSubject] = useState("");
  const [formBody, setFormBody] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listEmailTemplates();
      setTemplates(data.templates || []);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not load email templates."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openEditor = (tpl) => {
    setEditing(tpl);
    setFormSubject(tpl.subject);
    setFormBody(tpl.body_html);
  };

  const handleSave = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await saveEmailTemplate(editing.key, { subject: formSubject, body_html: formBody });
      toast.success(`"${editing.name}" saved.`);
      setEditing(null);
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Save failed."));
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    if (!editing) return;
    if (!confirm(`Reset "${editing.name}" to the system default? Your customizations will be removed.`)) return;
    setBusy(true);
    try {
      await resetEmailTemplate(editing.key);
      toast.info(`"${editing.name}" reset to default.`);
      setEditing(null);
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Reset failed."));
    } finally {
      setBusy(false);
    }
  };

  const categories = [...new Set(templates.map((t) => t.category))];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 17, fontWeight: 800, color: "var(--navy)", fontFamily: "'Sora', system-ui", margin: "0 0 4px" }}>
          Email Templates
        </h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
          Customize the emails your organization sends. Other organizations use their own defaults.
        </p>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading templates…</div>
      ) : templates.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>No templates available.</div>
      ) : (
        categories.map((cat) => (
          <div key={cat} style={{ marginBottom: 28 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.8, margin: "0 0 10px" }}>
              {cat}
            </h3>
            <div className={s.tableContainer}>
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th>Template</th>
                      <th>Description</th>
                      <th>Status</th>
                      <th style={{ textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {templates
                      .filter((t) => t.category === cat)
                      .map((tpl) => (
                        <tr key={tpl.key}>
                          <td style={{ fontWeight: 650, color: "var(--navy)" }}>{tpl.name}</td>
                          <td style={{ fontSize: 13, color: "var(--text-muted)" }}>{tpl.description}</td>
                          <td>
                            {tpl.is_custom ? (
                              <span className={`${s.statusPill} ${s.green}`}>Customized</span>
                            ) : (
                              <span className={`${s.statusPill} ${s.neutral}`}>Default</span>
                            )}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <button
                              type="button"
                              className={`${s.btn} ${s.btnGhost}`}
                              onClick={() => openEditor(tpl)}
                            >
                              <Pencil aria-hidden="true" style={{ width: 12, height: 12 }} />
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ))
      )}

      {/* Edit modal */}
      {editing && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
          onClick={() => !busy && setEditing(null)}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 16,
              width: "min(720px, 94vw)",
              maxHeight: "88vh",
              overflow: "auto",
              boxShadow: "0 12px 64px rgba(0,0,0,0.18)",
              padding: 28,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 17, fontWeight: 800, color: "var(--navy)", margin: "0 0 4px", fontFamily: "'Sora', system-ui" }}>
                  Edit: {editing.name}
                </h3>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
                  Use {"{{variable}}"} syntax in the body. Only your organization is affected.
                </p>
              </div>
              <button
                type="button"
                className={`${s.btn} ${s.btnGhost}`}
                onClick={() => !busy && setEditing(null)}
                aria-label="Close"
              >
                <X style={{ width: 18, height: 18 }} />
              </button>
            </div>

            {/* Variables chips */}
            {editing.variables?.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.6, margin: "0 0 6px" }}>
                  Available Variables
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {editing.variables.map((v) => (
                    <span
                      key={v.name}
                      title={v.label}
                      style={{
                        padding: "3px 9px",
                        fontSize: 11.5,
                        fontWeight: 600,
                        borderRadius: 6,
                        background: "var(--blue-light, #e8f0fe)",
                        color: "var(--blue-strong, #0D5C91)",
                        cursor: "default",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {`{{${v.name}}}`}
                      <span style={{ fontWeight: 400, marginLeft: 4, opacity: 0.7 }}>{v.label}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Subject */}
            <label style={{ display: "block", marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--navy)", display: "block", marginBottom: 4 }}>Subject</span>
              <input
                type="text"
                value={formSubject}
                onChange={(e) => setFormSubject(e.target.value)}
                disabled={busy}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  fontSize: 14,
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </label>

            {/* Body */}
            <label style={{ display: "block", marginBottom: 16 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--navy)", display: "block", marginBottom: 4 }}>Body (HTML content)</span>
              <textarea
                value={formBody}
                onChange={(e) => setFormBody(e.target.value)}
                disabled={busy}
                rows={12}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  fontSize: 13,
                  fontFamily: "Consolas, Menlo, monospace",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  outline: "none",
                  resize: "vertical",
                  boxSizing: "border-box",
                  lineHeight: 1.5,
                }}
              />
            </label>

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
              <button
                type="button"
                className={`${s.btn} ${s.btnGhost}`}
                onClick={handleReset}
                disabled={busy || !editing.is_custom}
                style={{ opacity: editing.is_custom ? 1 : 0.4 }}
              >
                <RotateCcw style={{ width: 13, height: 13, marginRight: 4 }} /> Reset to default
              </button>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className={`${s.btn} ${s.btnSecondary}`}
                  onClick={() => !busy && setEditing(null)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={`${s.btn} ${s.btnPrimary}`}
                  onClick={handleSave}
                  disabled={busy || !formSubject.trim()}
                >
                  {busy ? "Saving…" : <><Check style={{ width: 13, height: 13, marginRight: 4 }} /> Save</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

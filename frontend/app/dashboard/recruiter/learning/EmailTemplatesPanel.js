"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import { getApiErrorMessage } from "@/services/authService";
import {
  listEmailTemplates,
  saveEmailTemplate,
  resetEmailTemplate,
} from "@/services/orgFrameworkService";
import {
  Braces,
  Check,
  Eye,
  Mail,
  MailOpen,
  Pencil,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import s from "./OrgFrameworkTab.module.css";

const SAMPLE_VALUES = {
  full_name: "Alex Carter",
  employee_name: "Alex Carter",
  candidate_name: "Alex Carter",
  job_title: "Software Engineer",
  department: "Engineering",
  company_name: "Mazik Global",
  invite_link: "https://app.mazikglobal.com/invite/abc123",
  expires_at: "Aug 22, 2026",
  start_date: "Sep 1, 2026",
  currency: "PKR",
  salary: "250,000",
  employee_id: "EMP-1042",
  title: "Laptop battery replacement",
  description: "My laptop battery lasts under an hour and needs replacement.",
  link: "https://app.mazikglobal.com/portal",
  notes: "Please complete this within 5 working days.",
  due_date: "Aug 15, 2026",
  asset_name: "MacBook Pro 14",
  asset_serial: "C02XL0ABCDFG",
  assets_count: "3",
  licenses_count: "2",
  bank_name: "HBL",
  account_holder_name: "Alex Carter",
  masked_iban: "PK36 HBLB **** **** 1234",
  company_email: "alex.carter@mazikglobal.com",
  orientation_date: "Sep 2, 2026",
  orientation_time: "10:00 AM",
  orientation_location: "Office HQ, Floor 2",
  announcement_title: "Company-wide announcement",
  message: "This is a sample message preview.",
  admin_name: "Sarah Ahmed",
  admin_email: "sarah.ahmed@mazikglobal.com",
  custom_message: "Your weekly reminders are set.",
  role: "Software Engineer",
  position: "Software Engineer",
  onboarding_link: "https://app.mazikglobal.com/onboarding",
  password: "••••••••",
  contact_email: "hr@mazikglobal.com",
};

function sampleValue(varName, label) {
  if (SAMPLE_VALUES[varName]) return SAMPLE_VALUES[varName];
  return `[${label || varName}]`;
}

function fillPreview(html, variables) {
  return html.replace(/\{\{\s*([\w]+)\s*\}\}/g, (_m, name) => {
    const meta = (variables || []).find((v) => v.name === name);
    return sampleValue(name, meta?.label);
  });
}

function TemplateBadge({ custom }) {
  return custom ? (
    <span className={`${s.statusPill} ${s.green}`}>Customized</span>
  ) : (
    <span className={`${s.statusPill} ${s.neutral}`}>Default</span>
  );
}

export default function EmailTemplatesPanel() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [formSubject, setFormSubject] = useState("");
  const [formBody, setFormBody] = useState("");
  const [mode, setMode] = useState("edit");
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef(null);

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
    setMode("edit");
  };

  const closeEditor = () => {
    if (busy) return;
    setEditing(null);
    setMode("edit");
  };

  const insertVariable = (varName) => {
    const token = `{{${varName}}}`;
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart ?? formBody.length;
    const end = el.selectionEnd ?? formBody.length;
    const next = formBody.slice(0, start) + token + formBody.slice(end);
    setFormBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const handleSave = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await saveEmailTemplate(editing.key, { subject: formSubject, body_html: formBody });
      toast.success(`"${editing.name}" saved.`);
      closeEditor();
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
      closeEditor();
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Reset failed."));
    } finally {
      setBusy(false);
    }
  };

  const categories = [...new Set(templates.map((t) => t.category))];

  const inputBase = {
    width: "100%",
    padding: "11px 14px",
    fontSize: 14,
    color: "var(--navy-2)",
    border: "1.5px solid var(--border)",
    borderRadius: 12,
    outline: "none",
    boxSizing: "border-box",
    background: "#fff",
    transition: "border-color 0.15s, box-shadow 0.15s",
  };

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
          padding: "18px 20px",
          borderRadius: 16,
          background: "linear-gradient(120deg, rgba(56,162,255,0.10), rgba(24,42,94,0.06))",
          border: "1px solid rgba(56,162,255,0.18)",
        }}
      >
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "linear-gradient(135deg, var(--blue), var(--blue-strong) 60%, var(--navy-2))",
            color: "#fff",
            boxShadow: "0 8px 18px -8px rgba(56,162,255,0.8)",
            flexShrink: 0,
          }}
        >
          <MailOpen style={{ width: 20, height: 20 }} />
        </div>
        <div>
          <h2 style={{ fontSize: 17, fontWeight: 800, color: "var(--navy)", fontFamily: "'Sora', system-ui", margin: "0 0 3px" }}>
            Email Templates
          </h2>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
            Personalize the emails your organization sends. Customizations only apply to your organization.
          </p>
        </div>
      </div>

      {/* ── List ───────────────────────────────────────────────── */}
      {loading ? (
        <div style={{ padding: 48, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>Loading templates…</div>
      ) : templates.length === 0 ? (
        <div style={{ padding: 48, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>No templates available.</div>
      ) : (
        categories.map((cat) => (
          <div key={cat} style={{ marginBottom: 26 }}>
            <h3
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: 1,
                margin: "0 0 10px",
              }}
            >
              {cat}
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
              {templates
                .filter((t) => t.category === cat)
                .map((tpl) => (
                  <div
                    key={tpl.key}
                    style={{
                      background: "#fff",
                      border: "1px solid var(--border)",
                      borderRadius: 14,
                      padding: "14px 16px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                      transition: "box-shadow 0.15s, transform 0.15s, border-color 0.15s",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.boxShadow = "0 10px 24px -12px rgba(24,42,94,0.25)";
                      e.currentTarget.style.transform = "translateY(-1px)";
                      e.currentTarget.style.borderColor = "rgba(56,162,255,0.4)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = "none";
                      e.currentTarget.style.transform = "none";
                      e.currentTarget.style.borderColor = "var(--border)";
                    }}
                    onClick={() => openEditor(tpl)}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                        <div
                          style={{
                            width: 30,
                            height: 30,
                            borderRadius: 9,
                            flexShrink: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: tpl.is_custom
                              ? "linear-gradient(135deg, rgba(56,162,255,0.18), rgba(24,42,94,0.10))"
                              : "rgba(24,42,94,0.05)",
                            color: tpl.is_custom ? "var(--blue-strong)" : "var(--text-muted)",
                          }}
                        >
                          <Mail style={{ width: 15, height: 15 }} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--navy)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {tpl.name}
                          </div>
                          <div style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {tpl.description}
                          </div>
                        </div>
                      </div>
                      <TemplateBadge custom={tpl.is_custom} />
                    </div>

                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--text-muted)",
                        background: "rgba(24,42,94,0.03)",
                        border: "1px solid rgba(24,42,94,0.06)",
                        borderRadius: 9,
                        padding: "7px 10px",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      title={tpl.subject}
                    >
                      <span style={{ opacity: 0.75, fontWeight: 600, marginRight: 5 }}>Subject:</span>
                      {tpl.subject}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ fontSize: 11.5, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
                        <Braces style={{ width: 12, height: 12 }} />
                        {tpl.variables?.length || 0} variables
                      </div>
                      <button
                        type="button"
                        className={`${s.btn} ${s.btnSecondary}`}
                        onClick={(e) => { e.stopPropagation(); openEditor(tpl); }}
                        style={{ fontSize: 12, padding: "6px 12px", minHeight: 30 }}
                      >
                        <Pencil style={{ width: 12, height: 12, marginRight: 5 }} />
                        {tpl.is_custom ? "Edit" : "Customize"}
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))
      )}

      {/* ── Editor modal ───────────────────────────────────────── */}
      {editing && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(10,18,38,0.55)",
            backdropFilter: "blur(3px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
          onClick={closeEditor}
        >
          <div
            style={{
              background: "linear-gradient(180deg, #f7f9fc 0%, #fff 130px)",
              borderRadius: 20,
              width: "min(860px, 95vw)",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 24px 80px rgba(0,0,0,0.28)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "18px 24px",
                borderBottom: "1px solid var(--border)",
                background: "#fff",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 11,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "linear-gradient(135deg, var(--blue), var(--blue-strong) 60%, var(--navy-2))",
                    color: "#fff",
                    flexShrink: 0,
                  }}
                >
                  <Mail style={{ width: 18, height: 18 }} />
                </div>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 800, color: "var(--navy)", margin: 0, fontFamily: "'Sora', system-ui" }}>
                    {editing.name}
                  </h3>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{editing.category}</span>
                    <span style={{ color: "var(--border)" }}>•</span>
                    <TemplateBadge custom={editing.is_custom} />
                  </div>
                </div>
              </div>
              <button
                type="button"
                className={`${s.btn} ${s.btnGhost}`}
                onClick={closeEditor}
                aria-label="Close"
                style={{ width: 32, height: 32, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <X style={{ width: 16, height: 16 }} />
              </button>
            </div>

            {/* Mode tabs */}
            <div style={{ display: "flex", gap: 4, padding: "12px 24px 0", background: "#fff" }}>
              {[
                { key: "edit", label: "Content", icon: <Pencil style={{ width: 13, height: 13 }} /> },
                { key: "preview", label: "Preview", icon: <Eye style={{ width: 13, height: 13 }} /> },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setMode(tab.key)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 14px",
                    fontSize: 12.5,
                    fontWeight: 700,
                    border: "none",
                    borderBottom: mode === tab.key ? "2px solid var(--blue-strong)" : "2px solid transparent",
                    background: "transparent",
                    color: mode === tab.key ? "var(--blue-strong)" : "var(--text-muted)",
                    cursor: "pointer",
                    borderRadius: "8px 8px 0 0",
                  }}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Scrollable body */}
            <div style={{ padding: "18px 24px 22px", overflowY: "auto" }}>
              {mode === "preview" ? (
                /* ── Preview mode ── */
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 12,
                      padding: "9px 12px",
                      borderRadius: 10,
                      background: "rgba(56,162,255,0.08)",
                      border: "1px solid rgba(56,162,255,0.2)",
                      fontSize: 12.5,
                      color: "var(--blue-strong)",
                    }}
                  >
                    <Sparkles style={{ width: 14, height: 14, flexShrink: 0 }} />
                    Live preview with sample values — variables are replaced for visualization only.
                  </div>

                  {/* Email device frame */}
                  <div
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 14,
                      overflow: "hidden",
                      background: "#fff",
                      boxShadow: "0 14px 40px -18px rgba(24,42,94,0.3)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "10px 14px",
                        background: "#f1f4f9",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      <div style={{ display: "flex", gap: 5 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 50, background: "#ff5f57" }} />
                        <span style={{ width: 10, height: 10, borderRadius: 50, background: "#febc2e" }} />
                        <span style={{ width: 10, height: 10, borderRadius: 50, background: "#28c840" }} />
                      </div>
                      <div
                        style={{
                          flex: 1,
                          marginLeft: 6,
                          fontSize: 11.5,
                          color: "var(--text-muted)",
                          background: "#fff",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          padding: "3px 10px",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {formSubject || "(no subject)"}
                      </div>
                    </div>
                    <div
                      style={{
                        minHeight: 220,
                        padding: "22px 26px",
                        background: "linear-gradient(180deg, #ffffff, #fafbfd)",
                      }}
                      dangerouslySetInnerHTML={{ __html: fillPreview(formBody, editing.variables) }}
                    />
                  </div>
                </div>
              ) : (
                /* ── Edit mode ── */
                <div>
                  {/* Variables chips */}
                  {editing.variables?.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <p
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "var(--text-muted)",
                          textTransform: "uppercase",
                          letterSpacing: 0.6,
                          margin: "0 0 7px",
                        }}
                      >
                        Click a variable to insert
                      </p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {editing.variables.map((v) => (
                          <button
                            key={v.name}
                            type="button"
                            onClick={() => insertVariable(v.name)}
                            title={`Insert {{${v.name}}} — ${v.label}`}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              padding: "4px 10px",
                              fontSize: 11.5,
                              fontWeight: 600,
                              borderRadius: 8,
                              background: "rgba(56,162,255,0.10)",
                              color: "var(--blue-strong)",
                              border: "1px solid rgba(56,162,255,0.25)",
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                              transition: "background 0.15s, transform 0.1s",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = "rgba(56,162,255,0.20)";
                              e.currentTarget.style.transform = "translateY(-1px)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = "rgba(56,162,255,0.10)";
                              e.currentTarget.style.transform = "none";
                            }}
                          >
                            {`{{${v.name}}}`}
                            <span style={{ fontWeight: 400, opacity: 0.7 }}>{v.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Subject */}
                  <label style={{ display: "block", marginBottom: 14 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--navy)", display: "block", marginBottom: 5 }}>
                      Subject line
                    </span>
                    <input
                      type="text"
                      value={formSubject}
                      onChange={(e) => setFormSubject(e.target.value)}
                      disabled={busy}
                      style={{ ...inputBase, fontFamily: "'Sora', system-ui" }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = "var(--blue-mid)";
                        e.currentTarget.style.boxShadow = "0 0 0 3px rgba(56,162,255,0.15)";
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = "var(--border)";
                        e.currentTarget.style.boxShadow = "none";
                      }}
                    />
                  </label>

                  {/* Body */}
                  <label style={{ display: "block", marginBottom: 14 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--navy)", display: "block", marginBottom: 5 }}>
                      Email content (HTML)
                    </span>
                    <textarea
                      ref={bodyRef}
                      value={formBody}
                      onChange={(e) => setFormBody(e.target.value)}
                      disabled={busy}
                      rows={13}
                      style={{
                        ...inputBase,
                        fontFamily: "Consolas, Menlo, monospace",
                        fontSize: 12.5,
                        lineHeight: 1.55,
                        resize: "vertical",
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = "var(--blue-mid)";
                        e.currentTarget.style.boxShadow = "0 0 0 3px rgba(56,162,255,0.15)";
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = "var(--border)";
                        e.currentTarget.style.boxShadow = "none";
                      }}
                    />
                  </label>
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "space-between",
                alignItems: "center",
                padding: "14px 24px",
                borderTop: "1px solid var(--border)",
                background: "#fff",
              }}
            >
              <button
                type="button"
                className={`${s.btn} ${s.btnGhost}`}
                onClick={handleReset}
                disabled={busy || !editing.is_custom}
                style={{ opacity: editing.is_custom ? 1 : 0.4 }}
              >
                <RotateCcw style={{ width: 13, height: 13, marginRight: 5 }} /> Reset to default
              </button>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className={`${s.btn} ${s.btnSecondary}`}
                  onClick={closeEditor}
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
                  {busy ? "Saving…" : <><Check style={{ width: 13, height: 13, marginRight: 5 }} /> Save changes</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

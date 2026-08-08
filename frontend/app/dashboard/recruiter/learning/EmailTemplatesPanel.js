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
  Bold,
  Braces,
  Check,
  Code,
  Eye,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Mail,
  MailOpen,
  Pencil,
  Redo2,
  RotateCcw,
  Sparkles,
  Underline,
  Undo2,
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
  const [showHtml, setShowHtml] = useState(false);
  const [busy, setBusy] = useState(false);
  const editorRef = useRef(null);

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
    setShowHtml(false);
  };

  const closeEditor = () => {
    if (busy) return;
    setEditing(null);
    setMode("edit");
    setShowHtml(false);
  };

  // Keep the rich editor's DOM in sync with formBody whenever it changes
  // from outside (openEditor, HTML-mode edits, reset).
  useEffect(() => {
    const el = editorRef.current;
    if (el && document.activeElement !== el) {
      el.innerHTML = formBody;
    }
  }, [formBody, mode, showHtml, editing]);

  const exec = (command, value = null) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    document.execCommand(command, false, value);
    if (editorRef.current) setFormBody(editorRef.current.innerHTML);
  };

  const insertVariable = (varName) => {
    const el = editorRef.current;
    if (el) {
      el.focus();
      document.execCommand("insertText", false, `{{${varName}}}`);
      setFormBody(el.innerHTML);
      return;
    }
    const token = `{{${varName}}}`;
    setFormBody((prev) => prev + token);
  };

  const insertLink = () => {
    const url = window.prompt("Link URL:", "https://");
    if (!url) return;
    exec("createLink", url);
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

  const toolbarBtn = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 30,
    height: 30,
    borderRadius: 8,
    border: "none",
    background: "transparent",
    color: "var(--navy-2)",
    cursor: "pointer",
    transition: "background 0.12s, color 0.12s",
  };

  const TOOLBAR = [
    { icon: <Bold style={{ width: 14, height: 14 }} />, cmd: "bold", label: "Bold" },
    { icon: <Italic style={{ width: 14, height: 14 }} />, cmd: "italic", label: "Italic" },
    { icon: <Underline style={{ width: 14, height: 14 }} />, cmd: "underline", label: "Underline" },
    { icon: <Heading2 style={{ width: 15, height: 15 }} />, cmd: "formatBlock", value: "h2", label: "Heading" },
    { icon: <List style={{ width: 15, height: 15 }} />, cmd: "insertUnorderedList", label: "Bullet list" },
    { icon: <ListOrdered style={{ width: 15, height: 15 }} />, cmd: "insertOrderedList", label: "Numbered list" },
    { icon: <Link2 style={{ width: 14, height: 14 }} />, action: "link", label: "Insert link" },
  ];

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
              width: "min(880px, 95vw)",
              maxHeight: "92vh",
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

                  {/* Variables */}
                  {editing.variables?.length > 0 && (
                    <div style={{ marginBottom: 14 }}>
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
                        Click a variable to insert at the cursor
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

                  {/* Body */}
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--navy)", display: "block" }}>
                        Email content
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (editorRef.current && !showHtml) setFormBody(editorRef.current.innerHTML);
                          setShowHtml(!showHtml);
                        }}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          fontSize: 11.5,
                          fontWeight: 600,
                          padding: "4px 10px",
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          background: showHtml ? "rgba(56,162,255,0.10)" : "#fff",
                          color: showHtml ? "var(--blue-strong)" : "var(--text-muted)",
                          cursor: "pointer",
                        }}
                      >
                        <Code style={{ width: 12, height: 12 }} />
                        {showHtml ? "Rich editor" : "HTML source"}
                      </button>
                    </div>

                    {showHtml ? (
                      /* Raw HTML view */
                      <textarea
                        value={formBody}
                        onChange={(e) => setFormBody(e.target.value)}
                        disabled={busy}
                        rows={14}
                        style={{
                          width: "100%",
                          padding: "12px 14px",
                          fontFamily: "Consolas, Menlo, monospace",
                          fontSize: 12.5,
                          lineHeight: 1.55,
                          color: "var(--navy-2)",
                          border: "1.5px solid var(--border)",
                          borderRadius: 12,
                          outline: "none",
                          resize: "vertical",
                          boxSizing: "border-box",
                        }}
                      />
                    ) : (
                      /* Rich editor */
                      <div
                        style={{
                          border: "1.5px solid var(--border)",
                          borderRadius: 12,
                          overflow: "hidden",
                          background: "#fff",
                          transition: "border-color 0.15s, box-shadow 0.15s",
                        }}
                        onFocusCapture={(e) => {
                          e.currentTarget.style.borderColor = "var(--blue-mid)";
                          e.currentTarget.style.boxShadow = "0 0 0 3px rgba(56,162,255,0.15)";
                        }}
                        onBlurCapture={(e) => {
                          e.currentTarget.style.borderColor = "var(--border)";
                          e.currentTarget.style.boxShadow = "none";
                        }}
                      >
                        {/* Toolbar */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 2,
                            padding: "6px 8px",
                            background: "#f6f8fb",
                            borderBottom: "1px solid var(--border)",
                            flexWrap: "wrap",
                          }}
                        >
                          {TOOLBAR.map((btn, i) => (
                            <button
                              key={btn.label}
                              type="button"
                              title={btn.label}
                              aria-label={btn.label}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => (btn.action === "link" ? insertLink() : exec(btn.cmd, btn.value))}
                              style={{
                                ...toolbarBtn,
                                marginRight: i === 3 ? 8 : 0,
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = "rgba(56,162,255,0.12)";
                                e.currentTarget.style.color = "var(--blue-strong)";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = "transparent";
                                e.currentTarget.style.color = "var(--navy-2)";
                              }}
                            >
                              {btn.icon}
                            </button>
                          ))}
                          <div style={{ flex: 1 }} />
                          <button
                            type="button"
                            title="Undo"
                            aria-label="Undo"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => exec("undo")}
                            style={toolbarBtn}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = "rgba(56,162,255,0.12)";
                              e.currentTarget.style.color = "var(--blue-strong)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = "transparent";
                              e.currentTarget.style.color = "var(--navy-2)";
                            }}
                          >
                            <Undo2 style={{ width: 14, height: 14 }} />
                          </button>
                          <button
                            type="button"
                            title="Redo"
                            aria-label="Redo"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => exec("redo")}
                            style={toolbarBtn}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = "rgba(56,162,255,0.12)";
                              e.currentTarget.style.color = "var(--blue-strong)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = "transparent";
                              e.currentTarget.style.color = "var(--navy-2)";
                            }}
                          >
                            <Redo2 style={{ width: 14, height: 14 }} />
                          </button>
                        </div>

                        {/* Editable area */}
                        <div
                          ref={editorRef}
                          contentEditable
                          suppressContentEditableWarning
                          onInput={() => {
                            if (editorRef.current) setFormBody(editorRef.current.innerHTML);
                          }}
                          onBlur={() => {
                            if (editorRef.current) setFormBody(editorRef.current.innerHTML);
                          }}
                          style={{
                            minHeight: 260,
                            maxHeight: 320,
                            overflowY: "auto",
                            padding: "14px 16px",
                            fontSize: 14,
                            lineHeight: 1.6,
                            color: "var(--navy-2)",
                            outline: "none",
                            fontFamily: "'Inter', system-ui, sans-serif",
                          }}
                        />
                      </div>
                    )}
                    <div style={{ marginTop: 7, fontSize: 11.5, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 5 }}>
                      <Braces style={{ width: 12, height: 12 }} />
                      Variables auto-fill with each recipient's real data when the email is sent.
                    </div>
                  </div>
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

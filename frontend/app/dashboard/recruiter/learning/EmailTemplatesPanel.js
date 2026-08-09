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

  const TOOLBAR = [
    { icon: <Bold style={{ width: 14, height: 14 }} />, cmd: "bold", label: "Bold" },
    { icon: <Italic style={{ width: 14, height: 14 }} />, cmd: "italic", label: "Italic" },
    { icon: <Underline style={{ width: 14, height: 14 }} />, cmd: "underline", label: "Underline" },
    { icon: <Heading2 style={{ width: 15, height: 15 }} />, cmd: "formatBlock", value: "h2", label: "Heading", gapAfter: true },
    { icon: <List style={{ width: 15, height: 15 }} />, cmd: "insertUnorderedList", label: "Bullet list" },
    { icon: <ListOrdered style={{ width: 15, height: 15 }} />, cmd: "insertOrderedList", label: "Numbered list" },
    { icon: <Link2 style={{ width: 14, height: 14 }} />, action: "link", label: "Insert link" },
  ];

  return (
    <div>
      <div className={s.sectionHero}>
        <div className={s.sectionHeroIcon}>
          <MailOpen aria-hidden="true" />
        </div>
        <div>
          <h2 className={s.pageTitle}>Email Templates</h2>
          <p className={s.pageSubtitle} style={{ marginTop: 3 }}>
            Personalize the emails your organization sends. Customizations only apply to your organization.
          </p>
        </div>
      </div>

      {loading ? (
        <div className={s.loadingState}>Loading templates…</div>
      ) : templates.length === 0 ? (
        <div className={s.emptyState}>
          <div className={s.emptyIcon}>
            <Mail aria-hidden="true" />
          </div>
          <div className={s.emptyTitle}>No templates available</div>
          <p className={s.emptyText}>Email templates will appear here once configured for your organization.</p>
        </div>
      ) : (
        categories.map((cat) => (
          <div key={cat} className={s.emailCatBlock}>
            <h3 className={s.emailCatTitle}>{cat}</h3>
            <div className={s.emailCardGrid}>
              {templates
                .filter((t) => t.category === cat)
                .map((tpl) => (
                  <div
                    key={tpl.key}
                    className={s.emailCard}
                    role="button"
                    tabIndex={0}
                    onClick={() => openEditor(tpl)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openEditor(tpl);
                      }
                    }}
                  >
                    <div className={s.emailCardTop}>
                      <div className={s.emailCardIdentity}>
                        <div className={`${s.emailCardIcon} ${tpl.is_custom ? s.emailCardIconCustom : ""}`}>
                          <Mail style={{ width: 15, height: 15 }} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div className={s.emailCardName}>{tpl.name}</div>
                          <div className={s.emailCardDesc}>{tpl.description}</div>
                        </div>
                      </div>
                      <TemplateBadge custom={tpl.is_custom} />
                    </div>

                    <div className={s.emailCardSubject} title={tpl.subject}>
                      <span className={s.emailCardSubjectLabel}>Subject:</span>
                      {tpl.subject}
                    </div>

                    <div className={s.emailCardFooter}>
                      <div className={s.emailCardVars}>
                        <Braces style={{ width: 12, height: 12 }} />
                        {tpl.variables?.length || 0} variables
                      </div>
                      <button
                        type="button"
                        className={`${s.btn} ${s.btnSecondary} ${s.btnCompact}`}
                        onClick={(e) => { e.stopPropagation(); openEditor(tpl); }}
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

      {editing && (
        <div className={s.emailModalOverlay} onClick={closeEditor}>
          <div className={s.emailModal} onClick={(e) => e.stopPropagation()}>
            <div className={s.emailModalHead}>
              <div className={s.emailModalHeadLeft}>
                <div className={s.emailModalIcon}>
                  <Mail style={{ width: 18, height: 18 }} />
                </div>
                <div>
                  <h3 className={s.emailModalTitle}>{editing.name}</h3>
                  <div className={s.emailModalMeta}>
                    <span>{editing.category}</span>
                    <span style={{ color: "var(--border)" }}>•</span>
                    <TemplateBadge custom={editing.is_custom} />
                  </div>
                </div>
              </div>
              <button
                type="button"
                className={`${s.btn} ${s.btnGhost} ${s.emailModalClose}`}
                onClick={closeEditor}
                aria-label="Close"
              >
                <X style={{ width: 16, height: 16 }} />
              </button>
            </div>

            <div className={s.emailModeTabs}>
              {[
                { key: "edit", label: "Content", icon: <Pencil style={{ width: 13, height: 13 }} /> },
                { key: "preview", label: "Preview", icon: <Eye style={{ width: 13, height: 13 }} /> },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setMode(tab.key)}
                  className={`${s.emailModeTab} ${mode === tab.key ? s.emailModeTabActive : ""}`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>

            <div className={s.emailModalBody}>
              {mode === "preview" ? (
                <div>
                  <div className={s.emailPreviewBanner}>
                    <Sparkles style={{ width: 14, height: 14, flexShrink: 0 }} />
                    Live preview with sample values — variables are replaced for visualization only.
                  </div>

                  <div className={s.emailDevice}>
                    <div className={s.emailDeviceBar}>
                      <div className={s.emailDeviceDots}>
                        <span className={`${s.emailDeviceDot} ${s.emailDeviceDotRed}`} />
                        <span className={`${s.emailDeviceDot} ${s.emailDeviceDotYellow}`} />
                        <span className={`${s.emailDeviceDot} ${s.emailDeviceDotGreen}`} />
                      </div>
                      <div className={s.emailDeviceSubject}>
                        {formSubject || "(no subject)"}
                      </div>
                    </div>
                    <div
                      className={s.emailDeviceBody}
                      dangerouslySetInnerHTML={{ __html: fillPreview(formBody, editing.variables) }}
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className={s.emailFieldLabel}>
                    <span className={s.emailFieldLabelText}>Subject line</span>
                    <input
                      type="text"
                      value={formSubject}
                      onChange={(e) => setFormSubject(e.target.value)}
                      disabled={busy}
                      className={s.emailInput}
                    />
                  </label>

                  {editing.variables?.length > 0 && (
                    <div className={s.emailVarsBlock}>
                      <p className={s.emailVarsHint}>
                        Click a variable to insert at the cursor
                      </p>
                      <div className={s.emailVarsWrap}>
                        {editing.variables.map((v) => (
                          <button
                            key={v.name}
                            type="button"
                            onClick={() => insertVariable(v.name)}
                            title={`Insert {{${v.name}}} — ${v.label}`}
                            className={s.emailVarChip}
                          >
                            {`{{${v.name}}}`}
                            <span className={s.emailVarChipLabel}>{v.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{ marginBottom: 14 }}>
                    <div className={s.emailBodyHead}>
                      <span className={s.emailFieldLabelText} style={{ marginBottom: 0 }}>
                        Email content
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (editorRef.current && !showHtml) setFormBody(editorRef.current.innerHTML);
                          setShowHtml(!showHtml);
                        }}
                        className={`${s.emailHtmlToggle} ${showHtml ? s.emailHtmlToggleOn : ""}`}
                      >
                        <Code style={{ width: 12, height: 12 }} />
                        {showHtml ? "Rich editor" : "HTML source"}
                      </button>
                    </div>

                    {showHtml ? (
                      <textarea
                        value={formBody}
                        onChange={(e) => setFormBody(e.target.value)}
                        disabled={busy}
                        rows={14}
                        className={s.emailHtmlArea}
                      />
                    ) : (
                      <div className={s.emailEditorShell}>
                        <div className={s.emailToolbar}>
                          {TOOLBAR.map((btn) => (
                            <button
                              key={btn.label}
                              type="button"
                              title={btn.label}
                              aria-label={btn.label}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => (btn.action === "link" ? insertLink() : exec(btn.cmd, btn.value))}
                              className={`${s.emailToolbarBtn} ${btn.gapAfter ? s.emailToolbarGap : ""}`}
                            >
                              {btn.icon}
                            </button>
                          ))}
                          <div className={s.emailToolbarSpacer} />
                          <button
                            type="button"
                            title="Undo"
                            aria-label="Undo"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => exec("undo")}
                            className={s.emailToolbarBtn}
                          >
                            <Undo2 style={{ width: 14, height: 14 }} />
                          </button>
                          <button
                            type="button"
                            title="Redo"
                            aria-label="Redo"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => exec("redo")}
                            className={s.emailToolbarBtn}
                          >
                            <Redo2 style={{ width: 14, height: 14 }} />
                          </button>
                        </div>

                        <div
                          ref={editorRef}
                          contentEditable
                          suppressContentEditableWarning
                          className={s.emailEditable}
                          onInput={() => {
                            if (editorRef.current) setFormBody(editorRef.current.innerHTML);
                          }}
                          onBlur={() => {
                            if (editorRef.current) setFormBody(editorRef.current.innerHTML);
                          }}
                        />
                      </div>
                    )}
                    <div className={s.emailBodyHint}>
                      <Braces style={{ width: 12, height: 12 }} />
                      Variables auto-fill with each recipient&apos;s real data when the email is sent.
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className={s.emailModalFooter}>
              <button
                type="button"
                className={`${s.btn} ${s.btnGhost} ${editing.is_custom ? "" : s.emailResetDim}`}
                onClick={handleReset}
                disabled={busy || !editing.is_custom}
              >
                <RotateCcw style={{ width: 13, height: 13, marginRight: 5 }} /> Reset to default
              </button>
              <div className={s.emailModalFooterRight}>
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

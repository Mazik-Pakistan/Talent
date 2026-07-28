"use client";

import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "react-toastify";
import {
  downloadBulkInviteTemplate,
  getApiErrorMessage,
  previewBulkInvitations,
  sendBulkInvitations,
} from "@/services/authService";

const ease = [0.22, 1, 0.36, 1];

const fadeUp = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.35, ease } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.2 } },
};

const stagger = {
  animate: { transition: { staggerChildren: 0.05 } },
};

function formatMoney(currency, amount) {
  if (amount == null || amount === "") return "—";
  const n = Number(amount);
  if (Number.isNaN(n)) return String(amount);
  return `${currency || "PKR"} ${n.toLocaleString("en-US")}`;
}

function StatusPill({ tone, children }) {
  const colors = {
    ready: { bg: "var(--green-light)", color: "var(--green)" },
    blocked: { bg: "var(--orange-light)", color: "var(--orange)" },
    incomplete: { bg: "#fee2e2", color: "#b42318" },
    muted: { bg: "var(--bg)", color: "var(--text-muted)" },
    info: { bg: "#e0f2fe", color: "#0369a1" },
  };
  const c = colors[tone] || colors.muted;
  return (
    <span
      style={{
        background: c.bg,
        color: c.color,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}

function StepCard({ step, title, body, active, done }) {
  return (
    <motion.div
      variants={fadeUp}
      style={{
        flex: 1,
        minWidth: 160,
        padding: "14px 16px",
        borderRadius: 14,
        border: `1.5px solid ${active ? "var(--blue)" : "var(--border)"}`,
        background: active
          ? "linear-gradient(145deg, #f0f7ff 0%, #ffffff 70%)"
          : done
          ? "#f8fafc"
          : "#fff",
        boxShadow: active ? "0 8px 24px rgba(15, 76, 129, 0.12)" : "none",
        transition: "border-color 0.25s ease, box-shadow 0.25s ease",
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 9,
          display: "grid",
          placeItems: "center",
          fontSize: 13,
          fontWeight: 700,
          marginBottom: 8,
          background: done || active ? "var(--navy)" : "#e2e8f0",
          color: done || active ? "#fff" : "#64748b",
        }}
      >
        {done ? "✓" : step}
      </div>
      <div style={{ fontWeight: 650, fontSize: 14, color: "var(--navy)" }}>{title}</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.45 }}>
        {body}
      </div>
    </motion.div>
  );
}

function RowCard({ row, index, onToggle, styles }) {
  const [open, setOpen] = useState(false);
  const history = row.person_history;
  const conflict = history?.active_conflict;
  const tone = row.can_send ? "ready" : row.valid ? "blocked" : "incomplete";
  const breakdown = row.salary_breakdown || [];

  return (
    <motion.li
      layout
      variants={fadeUp}
      style={{
        listStyle: "none",
        border: "1px solid var(--border)",
        borderRadius: 16,
        background: "#fff",
        overflow: "hidden",
        boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
          padding: "14px 16px",
          flexWrap: "wrap",
        }}
      >
        <label style={{ display: "flex", gap: 12, flex: 1, minWidth: 220, cursor: row.can_send ? "pointer" : "default" }}>
          <input
            type="checkbox"
            disabled={!row.can_send}
            checked={Boolean(row.selected && row.can_send)}
            onChange={(e) => onToggle(index, e.target.checked)}
            style={{ marginTop: 5, width: 16, height: 16 }}
          />
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <strong style={{ fontSize: 15 }}>
                Row {row.row}: {row.full_name || "—"}
              </strong>
              <StatusPill tone={tone}>
                {row.can_send ? "Ready" : row.valid ? "Blocked" : "Incomplete"}
              </StatusPill>
              {history?.matches?.length ? <StatusPill tone="info">History found</StatusPill> : null}
            </div>
            <div className={styles.mutedText} style={{ marginTop: 4 }}>
              {row.email || "no email"} · {row.job_title || "—"} · {row.department || "—"}
            </div>
            <div className={styles.mutedText} style={{ marginTop: 2, fontSize: 12 }}>
              {formatMoney(row.currency, row.monthly_salary)}
              {row.start_date ? ` · start ${row.start_date}` : ""}
              {row.reporting_manager ? ` · mgr ${row.reporting_manager}` : ""}
            </div>
            {row.block_reason ? (
              <div style={{ color: "#b42318", fontSize: 13, marginTop: 6 }}>{row.block_reason}</div>
            ) : null}
            {conflict ? (
              <div style={{ color: "#b42318", fontSize: 13, marginTop: 6 }}>{conflict.message}</div>
            ) : null}
          </div>
        </label>

        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => setOpen((v) => !v)}
          style={{ whiteSpace: "nowrap" }}
        >
          {open ? "Hide offer" : "View offer"}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1, transition: { duration: 0.28, ease } }}
            exit={{ height: 0, opacity: 0, transition: { duration: 0.2 } }}
            style={{ overflow: "hidden", borderTop: "1px solid var(--border)" }}
          >
            <div
              style={{
                padding: 16,
                display: "grid",
                gap: 14,
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                background: "linear-gradient(180deg, #f8fafc 0%, #fff 100%)",
              }}
            >
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", color: "#64748b", textTransform: "uppercase" }}>
                  Compensation
                </div>
                <div style={{ marginTop: 8, fontWeight: 650 }}>
                  {formatMoney(row.currency, row.monthly_salary)} / month
                </div>
                {breakdown.length ? (
                  <ul style={{ margin: "8px 0 0", paddingLeft: 16, fontSize: 13, color: "var(--text-muted)" }}>
                    {breakdown.map((item) => (
                      <li key={item.label}>
                        {item.label}: {formatMoney(row.currency, item.amount)}
                      </li>
                    ))}
                    {row.breakdown_total != null ? (
                      <li style={{ fontWeight: 600, color: "var(--navy)" }}>
                        Total: {formatMoney(row.currency, row.breakdown_total)}
                      </li>
                    ) : null}
                  </ul>
                ) : (
                  <div className={styles.mutedText} style={{ marginTop: 6, fontSize: 13 }}>
                    No breakdown in sheet — gross only
                  </div>
                )}
              </div>

              <div>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", color: "#64748b", textTransform: "uppercase" }}>
                  Benefits
                </div>
                <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {(row.benefits || []).length ? (
                    row.benefits.map((b) => (
                      <span
                        key={b}
                        style={{
                          fontSize: 12,
                          padding: "4px 8px",
                          borderRadius: 8,
                          background: "#ecfdf5",
                          color: "#047857",
                          border: "1px solid #a7f3d0",
                        }}
                      >
                        ✓ {b}
                      </span>
                    ))
                  ) : (
                    <span className={styles.mutedText} style={{ fontSize: 13 }}>
                      Defaults will apply
                    </span>
                  )}
                </div>
              </div>

              {!conflict && history?.suggestion_summary ? (
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", color: "#64748b", textTransform: "uppercase" }}>
                    AI history suggestion
                  </div>
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    style={{
                      marginTop: 8,
                      padding: "12px 14px",
                      borderRadius: 12,
                      background: "linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)",
                      border: "1px solid #fed7aa",
                      fontSize: 13,
                      lineHeight: 1.5,
                    }}
                  >
                    {history.suggestion_summary}
                    {history.matches?.length ? (
                      <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                        {history.matches.slice(0, 4).map((match) => (
                          <li key={`${match.type}-${match.id}`}>
                            {match.type === "converted_candidate"
                              ? "candidate → employee"
                              : match.record_type || match.type}
                            {match.employee_id ? ` · ${match.employee_id}` : ""}
                            {match.outcome ? ` · ${match.outcome}` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </motion.div>
                </div>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.li>
  );
}

export default function BulkInvitePanel({ styles }) {
  const [preview, setPreview] = useState(null);
  const [fileName, setFileName] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const rows = preview?.rows || [];
  const selectedCount = rows.filter((r) => r.selected && r.can_send).length;
  const step = result ? 3 : rows.length ? 2 : 1;

  const summaryChips = useMemo(() => {
    if (!preview?.summary) return [];
    const s = preview.summary;
    return [
      { label: `${s.total} rows`, tone: "muted" },
      { label: `${s.valid} ready`, tone: "ready" },
      { label: `${s.blocked} blocked`, tone: "blocked" },
      { label: `${s.rehire_suggested} with history`, tone: "info" },
      { label: `${s.invalid} incomplete`, tone: "incomplete" },
    ];
  }, [preview]);

  async function handleDownloadTemplate() {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    try {
      const blob = await downloadBulkInviteTemplate(accessToken);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "bulk-invite-template.xlsx";
      a.click();
      URL.revokeObjectURL(url);
      toast.info("Template downloaded — includes salary breakdown + benefit ticks.");
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not download template."));
    }
  }

  async function processFile(file) {
    if (!file) return;
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setLoadingPreview(true);
    setResult(null);
    setFileName(file.name);
    try {
      const data = await previewBulkInvitations(file, accessToken);
      setPreview(data);
      if (!data.ok) {
        toast.error(data.message || "Spreadsheet validation failed.");
      } else {
        toast.success(data.message || "Roster reviewed.");
      }
    } catch (err) {
      setPreview(null);
      toast.error(getApiErrorMessage(err, "Could not preview spreadsheet."));
    } finally {
      setLoadingPreview(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleFileChange(event) {
    processFile(event.target.files?.[0]);
  }

  function toggleRow(index, checked) {
    setPreview((current) => {
      if (!current?.rows) return current;
      return {
        ...current,
        rows: current.rows.map((row, i) =>
          i === index ? { ...row, selected: Boolean(checked) && Boolean(row.can_send) } : row
        ),
      };
    });
  }

  function selectAllSendable(checked) {
    setPreview((current) => {
      if (!current?.rows) return current;
      return {
        ...current,
        rows: current.rows.map((row) => ({
          ...row,
          selected: checked ? Boolean(row.can_send) : false,
        })),
      };
    });
  }

  async function handleSendSelected() {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken || !preview?.rows?.length) return;
    const toSend = preview.rows.filter((r) => r.selected && r.can_send);
    if (!toSend.length) {
      toast.info("Select at least one ready row.");
      return;
    }
    setSending(true);
    setResult(null);
    try {
      const data = await sendBulkInvitations(toSend, accessToken);
      setResult(data);
      toast.success(data.message || "Bulk invitations sent.");
      setPreview((current) =>
        current
          ? {
              ...current,
              rows: current.rows.map((row) =>
                toSend.some((s) => s.row === row.row && s.email === row.email)
                  ? {
                      ...row,
                      selected: false,
                      can_send: false,
                      block_reason: "Already invited in this batch",
                    }
                  : row
              ),
            }
          : current
      );
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Bulk invite failed."));
    } finally {
      setSending(false);
    }
  }

  return (
    <motion.div initial="initial" animate="animate" variants={stagger}>
      <motion.div
        variants={fadeUp}
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 18,
        }}
      >
        <StepCard
          step={1}
          title="Download & fill"
          body="Template mirrors single invite: salary breakdown + benefit Yes/No."
          active={step === 1}
          done={step > 1}
        />
        <StepCard
          step={2}
          title="Review with AI history"
          body="Rehire suggestions and conflict blocks before anything is emailed."
          active={step === 2}
          done={step > 2}
        />
        <StepCard
          step={3}
          title="Send selected"
          body="Same offer invitation flow as manual mode — one click for many."
          active={step === 3}
          done={Boolean(result?.sent?.length)}
        />
      </motion.div>

      <motion.div
        variants={fadeUp}
        style={{
          borderRadius: 18,
          border: `1.5px dashed ${dragOver ? "var(--blue)" : "var(--border)"}`,
          background: dragOver
            ? "linear-gradient(145deg, #eff6ff 0%, #f8fafc 100%)"
            : "linear-gradient(160deg, #f8fafc 0%, #ffffff 55%)",
          padding: 22,
          marginBottom: 16,
          transition: "border-color 0.2s ease, background 0.2s ease",
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          processFile(e.dataTransfer.files?.[0]);
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ maxWidth: 520 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: "var(--navy)" }}>
              Drop spreadsheet or upload
            </div>
            <p className={styles.mutedText} style={{ margin: "8px 0 0", lineHeight: 1.5 }}>
              Includes <strong>Pay: Basic / Housing / Transport</strong> columns (same as manual
              salary breakdown) and <strong>Benefit: …</strong> Yes/No ticks. Drag & drop supported.
            </p>
            {fileName ? (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className={styles.mutedText}
                style={{ marginTop: 10 }}
              >
                File: <strong>{fileName}</strong>
                {preview?.pay_columns?.length
                  ? ` · pay cols: ${preview.pay_columns.join(", ")}`
                  : ""}
              </motion.p>
            ) : null}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-start" }}>
            <button type="button" className={styles.secondaryButton} onClick={handleDownloadTemplate}>
              Download template
            </button>
            <label
              className={styles.primaryButton}
              style={{
                cursor: loadingPreview ? "wait" : "pointer",
                margin: 0,
                opacity: loadingPreview ? 0.75 : 1,
              }}
            >
              {loadingPreview ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <motion.span
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 0.9, ease: "linear" }}
                    style={{
                      width: 14,
                      height: 14,
                      border: "2px solid rgba(255,255,255,0.35)",
                      borderTopColor: "#fff",
                      borderRadius: "50%",
                      display: "inline-block",
                    }}
                  />
                  Reading sheet…
                </span>
              ) : (
                "Upload spreadsheet"
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xlsm,.csv"
                hidden
                disabled={loadingPreview}
                onChange={handleFileChange}
              />
            </label>
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {preview?.missing_headers?.length ? (
          <motion.div
            key="missing"
            {...fadeUp}
            className={styles.formMessage}
            role="alert"
            style={{ marginBottom: 16 }}
          >
            Missing columns: {preview.missing_headers.join(", ")}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {summaryChips.length ? (
          <motion.div
            key="chips"
            {...fadeUp}
            style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}
          >
            {summaryChips.map((chip) => (
              <StatusPill key={chip.label} tone={chip.tone}>
                {chip.label}
              </StatusPill>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {rows.length ? (
          <motion.div key="rows" {...fadeUp}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                alignItems: "center",
                marginBottom: 12,
                position: "sticky",
                top: 8,
                zIndex: 2,
                padding: "10px 12px",
                borderRadius: 14,
                background: "rgba(255,255,255,0.92)",
                backdropFilter: "blur(8px)",
                border: "1px solid var(--border)",
                boxShadow: "0 8px 24px rgba(15, 23, 42, 0.06)",
              }}
            >
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                <input
                  type="checkbox"
                  checked={
                    selectedCount > 0 && selectedCount === rows.filter((r) => r.can_send).length
                  }
                  onChange={(e) => selectAllSendable(e.target.checked)}
                />
                Select all ready ({selectedCount} selected)
              </label>
              <motion.button
                type="button"
                className={styles.primaryButton}
                disabled={sending || selectedCount === 0}
                onClick={handleSendSelected}
                whileTap={selectedCount && !sending ? { scale: 0.98 } : undefined}
              >
                {sending
                  ? "Sending offers…"
                  : `Send ${selectedCount} invitation${selectedCount === 1 ? "" : "s"}`}
              </motion.button>
            </div>

            <motion.ul
              variants={stagger}
              initial="initial"
              animate="animate"
              style={{ display: "grid", gap: 10, margin: 0, padding: 0 }}
            >
              {rows.map((row, index) => (
                <RowCard
                  key={`${row.row}-${row.email || index}`}
                  row={row}
                  index={index}
                  onToggle={toggleRow}
                  styles={styles}
                />
              ))}
            </motion.ul>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {result ? (
          <motion.div
            key="result"
            {...fadeUp}
            style={{
              marginTop: 18,
              borderRadius: 16,
              border: "1px solid var(--border)",
              padding: 18,
              background: "linear-gradient(160deg, #ecfdf5 0%, #ffffff 45%)",
            }}
          >
            <div style={{ fontWeight: 700, color: "var(--navy)", marginBottom: 6 }}>Results</div>
            <p className={styles.mutedText} style={{ marginTop: 0 }}>
              {result.message}
            </p>
            {result.sent?.length ? (
              <ul className={styles.miniList}>
                {result.sent.map((item) => (
                  <li className={styles.miniListItem} key={`sent-${item.email}`}>
                    <div>
                      <strong>{item.full_name || item.email}</strong>
                      <div className={styles.mutedText}>
                        {item.email}
                        {item.email_sent ? " · emailed" : " · created (email failed)"}
                        {item.reinvite_from_history ? " · rehire cycle" : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
            {result.failed?.length ? (
              <ul className={styles.miniList} style={{ marginTop: 8 }}>
                {result.failed.map((item, i) => (
                  <li className={styles.miniListItem} key={`fail-${item.email || i}`}>
                    <div>
                      <strong>{item.email || `Row ${item.row}`}</strong>
                      <div style={{ color: "#b42318", fontSize: 13 }}>{item.error}</div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

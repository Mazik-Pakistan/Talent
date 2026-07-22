"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import RecruiterShell from "@/components/recruiter/RecruiterShell";
import ChatWindow from "@/components/aiCoach/ChatWindow";
import { getApiErrorMessage } from "@/services/authService";
import { deleteKnowledge, ingestKnowledge, listKnowledge } from "@/services/aiCoachService";
import styles from "./ai-assistant.module.css";

const SUGGESTIONS = [
  "What's our process for promoting an employee?",
  "How should I evaluate promotion readiness?",
  "What learning & development programs do we offer?",
  "Summarize our career-ladder policy",
];

const TABS = [
  { key: "chat", label: "AI Assistant" },
  { key: "knowledge", label: "Knowledge Base" },
];

export default function RecruiterAiAssistantPage() {
  const [tab, setTab] = useState("chat");

  return (
    <RecruiterShell activeKey="ai-assistant" title="AI Assistant" subtitle="Hiring, policy, and L&D assistant for your team">
      <div className={styles.tabBar}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`${styles.tabBtn} ${tab === t.key ? styles.tabActive : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "chat" ? (
        <ChatWindow
          title="AI Assistant"
          subtitle="Grounded in your company's career/hiring policy documents. It won't answer with any individual employee's private data."
          suggestions={SUGGESTIONS}
        />
      ) : (
        <KnowledgeBaseTab />
      )}
    </RecruiterShell>
  );
}

function KnowledgeBaseTab() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: "", text: "", role_scope: ["employee", "recruiter"] });

  const load = useCallback(async () => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    try {
      const data = await listKnowledge(token);
      setDocs(data.documents || []);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not load knowledge base documents."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function toggleScope(scope) {
    setForm((f) => {
      const has = f.role_scope.includes(scope);
      const next = has ? f.role_scope.filter((s) => s !== scope) : [...f.role_scope, scope];
      return { ...f, role_scope: next };
    });
  }

  async function handleUpload(e) {
    e.preventDefault();
    const token = localStorage.getItem("access_token");
    if (!token) return;
    if (form.title.trim().length < 3 || form.text.trim().length < 20) {
      toast.error("Give the document a title (3+ chars) and at least a short paragraph of content.");
      return;
    }
    setSaving(true);
    try {
      await ingestKnowledge(token, form);
      toast.success("Document added to the knowledge base.");
      setForm({ title: "", text: "", role_scope: ["employee", "recruiter"] });
      load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not save this document."));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(title) {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    try {
      await deleteKnowledge(token, title);
      toast.success("Document removed.");
      load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not remove this document."));
    }
  }

  return (
    <div className={styles.kbWrap}>
      <div className={styles.kbForm}>
        <h3 className={styles.kbHeading}>Add a policy / career-ladder document</h3>
        <p className={styles.kbHint}>
          Paste in company career-progression policy, promotion criteria, or L&D program text. It will be
          chunked and made available to the AI Coach / AI Assistant for whichever roles you select below.
        </p>
        <form onSubmit={handleUpload} className={styles.kbFormBody}>
          <input
            className={styles.kbInput}
            placeholder="Document title, e.g. 'Engineering Career Ladder 2026'"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            maxLength={200}
          />
          <textarea
            className={styles.kbTextarea}
            placeholder="Paste the policy document text here…"
            value={form.text}
            onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))}
            rows={10}
          />
          <div className={styles.kbScopeRow}>
            <span className={styles.kbScopeLabel}>Visible to:</span>
            <label className={styles.kbCheckbox}>
              <input
                type="checkbox"
                checked={form.role_scope.includes("employee")}
                onChange={() => toggleScope("employee")}
              />
              Employees (AI Coach)
            </label>
            <label className={styles.kbCheckbox}>
              <input
                type="checkbox"
                checked={form.role_scope.includes("recruiter")}
                onChange={() => toggleScope("recruiter")}
              />
              Recruiters (AI Assistant)
            </label>
          </div>
          <button type="submit" className={styles.kbSubmit} disabled={saving}>
            {saving ? "Saving…" : "Add to knowledge base"}
          </button>
        </form>
      </div>

      <div className={styles.kbList}>
        <h3 className={styles.kbHeading}>Existing documents</h3>
        {loading ? (
          <p className={styles.kbHint}>Loading…</p>
        ) : docs.length === 0 ? (
          <p className={styles.kbHint}>No documents uploaded yet — a default general career-ladder guide is used until you add your own.</p>
        ) : (
          <ul className={styles.kbDocList}>
            {docs.map((d) => (
              <li key={d.id} className={styles.kbDocRow}>
                <div>
                  <div className={styles.kbDocTitle}>{d.title}</div>
                  <div className={styles.kbDocMeta}>
                    {d.chunk_count} chunk{d.chunk_count === 1 ? "" : "s"} · visible to {(d.role_scope || []).join(", ")}
                  </div>
                </div>
                <button type="button" className={styles.kbDeleteBtn} onClick={() => handleDelete(d.title)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

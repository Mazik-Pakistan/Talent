"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "react-toastify";

import RecruiterShell from "@/components/recruiter/RecruiterShell";
import { getApiErrorMessage } from "@/services/authService";
import {
  closeHrThread,
  getHrThread,
  listHrThreads,
  replyHrThread,
  startHrMessage,
} from "@/services/messageService";
import styles from "@/app/dashboard/messages.module.css";

function formatWhen(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export default function RecruiterMessagesPage() {
  return (
    <Suspense fallback={<p style={{ textAlign: "center", marginTop: "2rem" }}>Loading inbox…</p>}>
      <RecruiterMessagesInner />
    </Suspense>
  );
}

function RecruiterMessagesInner() {
  const searchParams = useSearchParams();
  const initialThread = searchParams.get("thread") || "";
  const employeeFilter = searchParams.get("employee_id") || "";

  const [threads, setThreads] = useState([]);
  const [selectedId, setSelectedId] = useState(initialThread);
  const [thread, setThread] = useState(null);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;

  const loadThreads = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await listHrThreads(token);
      setThreads(data.threads || []);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not load inbox."));
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadThread = useCallback(
    async (id) => {
      if (!token || !id) {
        setThread(null);
        return;
      }
      try {
        const data = await getHrThread(id, token);
        setThread(data.thread || null);
      } catch (err) {
        toast.error(getApiErrorMessage(err, "Could not open conversation."));
        setThread(null);
      }
    },
    [token]
  );

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  const filteredThreads = useMemo(() => {
    if (!employeeFilter) return threads;
    const key = employeeFilter.toLowerCase();
    return threads.filter(
      (t) =>
        String(t.employee_id || "").toLowerCase() === key ||
        String(t.employee_user_id || "").toLowerCase() === key ||
        String(t.id || "") === employeeFilter
    );
  }, [threads, employeeFilter]);

  useEffect(() => {
    if (initialThread) {
      setSelectedId(initialThread);
      setComposing(false);
      return;
    }
    if (employeeFilter && filteredThreads.length > 0 && !selectedId) {
      setSelectedId(filteredThreads[0].id);
      setComposing(false);
      return;
    }
    if (employeeFilter && filteredThreads.length === 0) {
      setComposing(true);
      setSelectedId("");
    }
  }, [initialThread, employeeFilter, filteredThreads, selectedId]);

  useEffect(() => {
    if (selectedId) {
      setComposing(false);
      loadThread(selectedId);
    } else if (!composing) {
      setThread(null);
    }
  }, [selectedId, loadThread, composing]);

  async function handleReply(e) {
    e.preventDefault();
    if (!token || !body.trim() || !selectedId) return;
    setSending(true);
    setError("");
    try {
      const data = await replyHrThread(selectedId, body.trim(), token);
      setBody("");
      setThread(data.thread || null);
      await loadThreads();
      toast.success("Reply sent.");
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not send reply."));
    } finally {
      setSending(false);
    }
  }

  async function handleStart(e) {
    e.preventDefault();
    if (!token || !body.trim() || !employeeFilter) return;
    setSending(true);
    setError("");
    try {
      const data = await startHrMessage(
        {
          employee_id: employeeFilter,
          body: body.trim(),
          subject: subject.trim() || undefined,
        },
        token
      );
      const next = data.thread;
      setBody("");
      setSubject("");
      setComposing(false);
      if (next?.id) {
        setSelectedId(next.id);
        setThread(next);
      }
      await loadThreads();
      toast.success("Message sent.");
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not send message."));
    } finally {
      setSending(false);
    }
  }

  async function handleClose() {
    if (!token || !selectedId) return;
    try {
      await closeHrThread(selectedId, token);
      toast.success("Conversation closed.");
      await loadThreads();
      await loadThread(selectedId);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not close conversation."));
    }
  }

  return (
    <RecruiterShell
      activeKey="messages"
      title="Messages"
      subtitle="Employee conversations — replies also go by email and notification."
    >
      <div className={styles.layout}>
        <aside className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <div className={styles.panelTitle}>Inbox</div>
              <p className={styles.panelHint}>
                {employeeFilter ? `Filtered · ${filteredThreads.length}` : `${filteredThreads.length} conversations`}
              </p>
            </div>
            {employeeFilter ? (
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => {
                  setComposing(true);
                  setSelectedId("");
                  setThread(null);
                }}
              >
                Message
              </button>
            ) : null}
          </div>
          <div className={styles.threadList}>
            {loading && <p className={styles.empty}>Loading…</p>}
            {!loading && filteredThreads.length === 0 && (
              <p className={styles.empty}>
                {employeeFilter
                  ? "No conversation yet for this employee. Send the first message."
                  : "No employee messages yet."}
              </p>
            )}
            {filteredThreads.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`${styles.threadItem} ${selectedId === t.id && !composing ? styles.threadItemActive : ""}`}
                onClick={() => {
                  setSelectedId(t.id);
                  setComposing(false);
                }}
              >
                <div className={styles.threadSubject}>{t.subject || "HR conversation"}</div>
                <div className={styles.threadMeta}>
                  {t.employee_name || t.employee_id || "Employee"} · {formatWhen(t.updated_at)}
                  {" · "}
                  <span className={`${styles.statusChip} ${t.status === "closed" ? styles.statusClosed : ""}`}>
                    {t.status}
                  </span>
                </div>
                {t.last_message?.body ? <div className={styles.threadPreview}>{t.last_message.body}</div> : null}
              </button>
            ))}
          </div>
        </aside>

        <section className={styles.panel}>
          {composing && employeeFilter ? (
            <form className={styles.newForm} onSubmit={handleStart}>
              <div className={styles.panelTitle}>Message employee</div>
              <p className={styles.panelHint}>Employee ID: {employeeFilter}</p>
              <input
                className={styles.input}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject (optional)"
              />
              <textarea
                className={styles.textarea}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write your message…"
                required
              />
              {error ? <p className={styles.error}>{error}</p> : null}
              <div className={styles.composeRow}>
                <button
                  type="button"
                  className={styles.ghostBtn}
                  onClick={() => setComposing(false)}
                  disabled={filteredThreads.length === 0}
                >
                  Cancel
                </button>
                <button type="submit" className={styles.primaryBtn} disabled={sending || !body.trim()}>
                  {sending ? "Sending…" : "Send"}
                </button>
              </div>
            </form>
          ) : !selectedId ? (
            <p className={styles.empty}>Select a conversation from the inbox.</p>
          ) : !thread ? (
            <p className={styles.empty}>Loading conversation…</p>
          ) : (
            <>
              <div className={styles.panelHead}>
                <div>
                  <div className={styles.panelTitle}>{thread.subject || "HR conversation"}</div>
                  <p className={styles.panelHint}>
                    {thread.employee_name || thread.employee_id} · {thread.status}
                  </p>
                </div>
                {thread.status !== "closed" ? (
                  <button type="button" className={styles.ghostBtn} onClick={handleClose}>
                    Close
                  </button>
                ) : null}
              </div>
              <div className={styles.messages}>
                {(thread.messages || []).map((m) => {
                  const mine = m.sender_role === "recruiter";
                  return (
                    <div key={m.id} className={`${styles.bubble} ${mine ? styles.bubbleMine : styles.bubbleTheirs}`}>
                      <div className={styles.bubbleMeta}>
                        {m.sender_name || m.sender_role} · {formatWhen(m.created_at)}
                      </div>
                      <div className={styles.bubbleBody}>{m.body}</div>
                    </div>
                  );
                })}
              </div>
              {thread.status !== "closed" ? (
                <form className={styles.compose} onSubmit={handleReply}>
                  <textarea
                    className={styles.textarea}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Write a reply…"
                    required
                  />
                  {error ? <p className={styles.error}>{error}</p> : null}
                  <div className={styles.composeRow}>
                    <button type="submit" className={styles.primaryBtn} disabled={sending || !body.trim()}>
                      {sending ? "Sending…" : "Reply"}
                    </button>
                  </div>
                </form>
              ) : (
                <p className={styles.empty}>This conversation is closed.</p>
              )}
            </>
          )}
        </section>
      </div>
    </RecruiterShell>
  );
}

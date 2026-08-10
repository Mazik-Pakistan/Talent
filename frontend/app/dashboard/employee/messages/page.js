"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "react-toastify";

import EmployeeShell from "@/components/employee/EmployeeShell";
import RecruiterLoader from "@/components/recruiter/RecruiterLoader";
import { getApiErrorMessage } from "@/services/authService";
import {
  closeHrThread,
  getHrThread,
  listHrThreads,
  sendHrMessage,
} from "@/services/messageService";
import { publishGuideContext } from "@/lib/ai/guideContext";
import styles from "@/app/dashboard/messages.module.css";

function formatWhen(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export default function EmployeeMessagesPage() {
  return (
    <Suspense fallback={<RecruiterLoader />}>
      <EmployeeMessagesInner />
    </Suspense>
  );
}

function EmployeeMessagesInner() {
  const searchParams = useSearchParams();
  const initialThread = searchParams.get("thread") || "";

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

  useEffect(() => {
    publishGuideContext({
      pathname: "/dashboard/employee/messages",
      section: composing ? "compose" : selectedId ? "thread" : "inbox",
      label: composing ? "New message" : thread?.subject || "Message HR",
      hint: composing
        ? "Write a clear subject and message — your recruiter gets this in-app and by email."
        : selectedId
          ? "Reply here to continue the thread, or Close when the topic is done."
          : "Pick a conversation or start a new one with HR.",
    });
  }, [composing, selectedId, thread?.subject]);

  const loadThreads = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await listHrThreads(token);
      setThreads(data.threads || []);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not load conversations."));
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

  useEffect(() => {
    if (selectedId) {
      setComposing(false);
      loadThread(selectedId);
    } else {
      setThread(null);
    }
  }, [selectedId, loadThread]);

  const openThreads = useMemo(() => threads.filter((t) => t.status !== "closed"), [threads]);

  async function handleSend(e) {
    e.preventDefault();
    if (!token || !body.trim()) return;
    setSending(true);
    setError("");
    try {
      const payload = {
        body: body.trim(),
        subject: composing ? subject.trim() || undefined : undefined,
        thread_id: composing ? undefined : selectedId || undefined,
      };
      const data = await sendHrMessage(payload, token);
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
    <EmployeeShell
      activeKey="messages"
      title="Message HR"
      subtitle="Start or continue a conversation with your recruiter — they also get an email copy."
      permissions={["profile.view"]}
    >
      <div className={styles.layout}>
        <aside className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <div className={styles.panelTitle}>Conversations</div>
              <p className={styles.panelHint}>{openThreads.length} open</p>
            </div>
            <button
              type="button"
              className={`${styles.primaryBtn} ${styles.newBtn}`}
              onClick={() => {
                setComposing(true);
                setSelectedId("");
                setThread(null);
                setError("");
              }}
            >
              New
            </button>
          </div>
          <div className={styles.threadList}>
            {!loading && threads.length === 0 && (
              <p className={styles.empty}>No messages yet. Start a conversation with HR.</p>
            )}
            {threads.map((t) => (
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
                  {t.recruiter_name || "HR"} · {formatWhen(t.updated_at)}
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
          {composing ? (
            <form className={styles.newForm} onSubmit={handleSend}>
              <div className={styles.panelTitle}>New message to HR</div>
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
                <button type="button" className={styles.ghostBtn} onClick={() => setComposing(false)}>
                  Cancel
                </button>
                <button type="submit" className={`${styles.primaryBtn} ${styles.newBtn}`} disabled={sending || !body.trim()}>
                  {sending ? "Sending…" : "Send"}
                </button>
              </div>
            </form>
          ) : !selectedId ? (
            <p className={styles.empty}>Select a conversation or start a new one.</p>
          ) : !thread ? (
            null
          ) : (
            <>
              <div className={styles.panelHead}>
                <div>
                  <div className={styles.panelTitle}>{thread.subject || "HR conversation"}</div>
                  <p className={styles.panelHint}>
                    with {thread.recruiter_name || "HR"} · {thread.status}
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
                  const mine = m.sender_role === "employee";
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
                <form className={styles.compose} onSubmit={handleSend}>
                  <textarea
                    className={styles.textarea}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Write a reply…"
                    required
                  />
                  {error ? <p className={styles.error}>{error}</p> : null}
                  <div className={styles.composeRow}>
                    <button type="submit" className={`${styles.primaryBtn} ${styles.newBtn}`} disabled={sending || !body.trim()}>
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
    </EmployeeShell>
  );
}



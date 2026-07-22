"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";

import { clearHistory, getHistory, sendMessage } from "@/services/aiCoachService";
import { getApiErrorMessage } from "@/services/authService";
import styles from "./chat-window.module.css";

export default function ChatWindow({ title, subtitle, suggestions = [] }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const bottomRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    (async () => {
      try {
        const data = await getHistory(token);
        setMessages(data.messages || []);
      } catch (error) {
        // silent — empty history is a fine default
      } finally {
        setLoadingHistory(false);
        scrollToBottom();
      }
    })();
  }, [scrollToBottom]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const submit = useCallback(
    async (text) => {
      const trimmed = (text ?? input).trim();
      if (!trimmed || loading) return;
      const token = localStorage.getItem("access_token");
      if (!token) {
        toast.error("Your session expired. Please log in again.");
        return;
      }

      setMessages((prev) => [
        ...prev,
        { id: `local-${Date.now()}`, role: "user", content: trimmed, created_at: new Date().toISOString() },
      ]);
      setInput("");
      setLoading(true);
      try {
        const reply = await sendMessage(token, trimmed);
        setMessages((prev) => [...prev, reply]);
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Something went wrong. Please try again."));
      } finally {
        setLoading(false);
      }
    },
    [input, loading]
  );

  const handleClear = useCallback(async () => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    try {
      await clearHistory(token);
      setMessages([]);
      toast.success("Conversation cleared.");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Couldn't clear the conversation."));
    }
  }, []);

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>{title}</h2>
          {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
        </div>
        {messages.length > 0 ? (
          <button type="button" className={styles.clearBtn} onClick={handleClear}>
            Clear chat
          </button>
        ) : null}
      </div>

      <div className={styles.messages}>
        {loadingHistory ? (
          <div className={styles.emptyState}>Loading conversation…</div>
        ) : messages.length === 0 ? (
          <div className={styles.emptyState}>
            <p>Ask me anything about your career growth, skills, or courses.</p>
            {suggestions.length > 0 ? (
              <div className={styles.suggestions}>
                {suggestions.map((s) => (
                  <button key={s} type="button" className={styles.suggestionChip} onClick={() => submit(s)}>
                    {s}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={m.role === "user" ? styles.userRow : styles.assistantRow}>
              <div className={m.role === "user" ? styles.userBubble : styles.assistantBubble}>
                <p className={styles.bubbleText}>{m.content}</p>

                {m.suggested_courses && m.suggested_courses.length > 0 ? (
                  <div className={styles.courseList}>
                    {m.suggested_courses.map((c) => (
                      <a key={c.uid} href={c.url} target="_blank" rel="noreferrer" className={styles.courseCard}>
                        <span className={styles.courseType}>{c.type || "course"}</span>
                        <span className={styles.courseTitle}>{c.title}</span>
                      </a>
                    ))}
                  </div>
                ) : null}

                {m.sources && m.sources.length > 0 ? (
                  <div className={styles.sources}>
                    Sources: {m.sources.map((s) => s.title).filter(Boolean).join(", ")}
                  </div>
                ) : null}
              </div>
            </div>
          ))
        )}
        {loading ? (
          <div className={styles.assistantRow}>
            <div className={styles.assistantBubble}>
              <span className={styles.typingDot} />
              <span className={styles.typingDot} />
              <span className={styles.typingDot} />
            </div>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      <form
        className={styles.inputRow}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          className={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. How do I become a Senior Full Stack Developer?"
          maxLength={2000}
          disabled={loading}
        />
        <button type="submit" className={styles.sendBtn} disabled={loading || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

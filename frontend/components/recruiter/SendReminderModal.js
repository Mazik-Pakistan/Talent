"use client";

import { useEffect, useMemo, useState } from "react";

import { getApiErrorMessage, remindCandidateOnboarding, remindEmployee } from "@/services/authService";
import styles from "./SendReminderModal.module.css";

const EMPLOYEE_KINDS = [
  { value: "profile", label: "Complete profile" },
  { value: "reupload", label: "Document re-upload" },
  { value: "course", label: "Assigned courses" },
  { value: "general", label: "General note" },
];

const CANDIDATE_KINDS = [
  { value: "onboarding", label: "Finish onboarding" },
  { value: "reupload", label: "Document re-upload" },
  { value: "general", label: "General note" },
];

/**
 * Shared recruiter modal to send email + in-app reminders with an optional note.
 *
 * props:
 * - open, onClose, onSent
 * - target: { id, full_name, role: 'employee'|'candidate' }
 * - accessToken
 * - defaultKind
 */
export default function SendReminderModal({ open, onClose, onSent, target, accessToken, defaultKind }) {
  const kinds = target?.role === "candidate" ? CANDIDATE_KINDS : EMPLOYEE_KINDS;
  const initialKind = useMemo(() => {
    if (defaultKind && kinds.some((k) => k.value === defaultKind)) return defaultKind;
    return kinds[0]?.value;
  }, [defaultKind, kinds]);

  const [kind, setKind] = useState(initialKind);
  const [note, setNote] = useState("");
  const [force, setForce] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setKind(initialKind);
      setNote("");
      setForce(false);
      setError("");
    }
  }, [open, initialKind]);

  if (!open || !target) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!accessToken) return;
    if (kind === "general" && !note.trim()) {
      setError("Add a note for general reminders.");
      return;
    }
    setSending(true);
    setError("");
    try {
      const payload = { kind, note: note.trim() || undefined, force };
      let data;
      if (target.role === "candidate") {
        data = await remindCandidateOnboarding(target.id, payload, accessToken);
      } else {
        data = await remindEmployee(target.id, payload, accessToken);
      }
      onSent?.(data);
      onClose?.();
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not send reminder."));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={styles.backdrop} role="presentation" onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="remind-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.head}>
          <h2 id="remind-title">Send reminder</h2>
          <p>
            To <strong>{target.full_name || "recipient"}</strong> — email + in-app notification
          </p>
        </div>
        <form className={styles.form} onSubmit={handleSubmit}>
          <label>
            Reminder type
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {kinds.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Note {kind === "general" ? "(required)" : "(optional)"}
            <textarea
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add context the person will see in email and notifications"
            />
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            Resend even if a reminder was sent in the last hour
          </label>
          {error ? <div className={styles.error}>{error}</div> : null}
          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={onClose} disabled={sending}>
              Cancel
            </button>
            <button type="submit" className={styles.primary} disabled={sending}>
              {sending ? "Sending…" : "Send reminder"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

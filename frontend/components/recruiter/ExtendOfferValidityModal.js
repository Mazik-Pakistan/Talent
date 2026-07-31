"use client";

import { useEffect, useState } from "react";

import { extendOfferValidity, getApiErrorMessage } from "@/services/authService";
import styles from "./SendReminderModal.module.css";

/**
 * Modal for extending an expired unsigned offer — days + optional recruiter note.
 * Triggers email, in-app notification, and updates the offer letter expiry date.
 */
export default function ExtendOfferValidityModal({ open, onClose, onExtended, offer, accessToken }) {
  const [extraDays, setExtraDays] = useState(7);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setExtraDays(7);
      setNote("");
      setError("");
    }
  }, [open, offer?.id]);

  if (!open || !offer) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!accessToken) return;
    const days = Number(extraDays);
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      setError("Enter a whole number of days between 1 and 90.");
      return;
    }
    setSending(true);
    setError("");
    try {
      const payload = {
        extra_days: days,
        note: note.trim() || undefined,
      };
      const data = await extendOfferValidity(offer.id, payload, accessToken);
      onExtended?.(data);
      onClose?.();
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not extend offer validity."));
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
        aria-labelledby="extend-offer-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.head}>
          <h2 id="extend-offer-title">Extend offer validity</h2>
          <p>
            For <strong>{offer.candidate_name || "candidate"}</strong>
            {offer.job_title ? ` · ${offer.job_title}` : ""}. Updates the offer letter expiry,
            emails the candidate, and posts a dashboard notice.
          </p>
        </div>
        <form className={styles.form} onSubmit={handleSubmit}>
          <label>
            Extend by (days)
            <input
              type="number"
              min={1}
              max={90}
              value={extraDays}
              onChange={(e) => setExtraDays(e.target.value)}
              style={{
                border: "1px solid #dbe3f2",
                borderRadius: 10,
                padding: "10px 12px",
                font: "inherit",
              }}
            />
          </label>
          <label>
            Note to candidate (optional)
            <textarea
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
              placeholder="e.g. We’ve extended your window so you can review and sign — reach out if you have questions."
            />
          </label>
          {error ? <div className={styles.error}>{error}</div> : null}
          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={onClose} disabled={sending}>
              Cancel
            </button>
            <button type="submit" className={styles.primary} disabled={sending}>
              {sending ? "Extending…" : "Extend & notify"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

import styles from "./OrganizationDeleteModal.module.css";

/**
 * Destructive confirmation dialog for deleting an organization.
 *
 * Follows the project's modal design language (fixed backdrop + centered card,
 * header row, explicit footer actions) and adds a type-to-confirm guard so a
 * wipe can never be triggered by a single accidental click.
 *
 * props:
 * - open, onClose
 * - org: { id, name } | null
 * - recruiterCount: number of recruiters bound to the org (shown as context)
 * - busy: true while the delete request is in flight
 * - error: optional message shown inside the dialog
 * - onConfirm: called with the typed name once it matches org.name
 */
export default function OrganizationDeleteModal({ open, onClose, org, recruiterCount = 0, busy = false, error = "", onConfirm }) {
  const [typedName, setTypedName] = useState("");

  useEffect(() => {
    if (open) {
      setTypedName("");
    }
  }, [open]);

  if (!open || !org) return null;

  const match = typedName.trim() === org.name;

  function handleConfirm() {
    if (!match || busy) return;
    onConfirm(org.name);
  }

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="org-delete-title"
        aria-describedby="org-delete-desc"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.iconRow} aria-hidden="true">
          <div className={styles.iconBubble}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10.3 3.9L2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
          </div>
        </div>

        <div className={styles.head}>
          <h2 id="org-delete-title">Delete organization?</h2>
          <p id="org-delete-desc">
            This permanently wipes <strong>{org.name}</strong> and everything inside it. This
            action cannot be undone.
          </p>
        </div>

        <div className={styles.body}>
          <div className={styles.orgName}>{org.name}</div>

          <ul className={styles.wipeList}>
            <li>All recruiters and their login accounts{recruiterCount ? ` (${recruiterCount} on file)` : ""}</li>
            <li>All candidates and employees</li>
            <li>All invitations, offers, documents, IT, learning, and messages</li>
          </ul>

          <label className={styles.confirmLabel} htmlFor="org-delete-confirm">
            Type <strong>{org.name}</strong> to confirm
            <input
              id="org-delete-confirm"
              type="text"
              value={typedName}
              onChange={(event) => setTypedName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleConfirm();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  if (!busy) onClose();
                }
              }}
              placeholder={org.name}
              autoComplete="off"
              autoFocus
              disabled={busy}
            />
          </label>

          {error ? (
            <div className={styles.error} role="alert">
              {error}
            </div>
          ) : null}
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.destructive}
            onClick={handleConfirm}
            disabled={!match || busy}
          >
            {busy ? "Deleting…" : "Delete organization"}
          </button>
        </div>
      </div>
    </div>
  );
}

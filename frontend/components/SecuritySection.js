"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";
import { toast } from "react-toastify";

import { changePassword, clearLocalSession, getApiErrorMessage } from "@/services/authService";

const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s])(?!.*\s).{8,}$/;

export default function SecuritySection() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");
    setError("");

    if (!currentPassword || !newPassword || !confirmNewPassword) {
      setError("All fields are required.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError("New password confirmation does not match.");
      return;
    }
    if (!PASSWORD_PATTERN.test(newPassword)) {
      setError(
        "Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character."
      );
      return;
    }

    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) {
      setError("Your session expired. Please sign in again.");
      return;
    }

    setBusy(true);
    try {
      await changePassword(
        {
          current_password: currentPassword,
          new_password: newPassword,
          confirm_new_password: confirmNewPassword,
        },
        accessToken
      );
      toast.success("Password updated successfully. Please sign in again.");
      clearLocalSession();
      setTimeout(() => {
        router.push("/login?reason=password_changed");
      }, 1500);
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not update your password."));
    } finally {
      setBusy(false);
    }
  }

  const field = {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginBottom: 12,
    fontSize: 13,
    fontWeight: 600,
    color: "#475569",
    minWidth: 0,
  };
  const inputWrap = {
    position: "relative",
    display: "flex",
    alignItems: "center",
  };
  const input = {
    width: "100%",
    border: "1px solid #bed0dc",
    borderRadius: 8,
    padding: "10px 40px 10px 12px",
    font: "inherit",
    background: "#fff",
    outline: "none",
    boxSizing: "border-box",
  };
  const inputFocus = { borderColor: "#38a2ff", boxShadow: "0 0 0 3px rgb(56 162 255 / .16)" };
  const eyeBtn = {
    position: "absolute",
    right: 10,
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
    color: "#94a3b8",
    display: "flex",
    alignItems: "center",
  };

  function EyeIcon({ open }) {
    return open ? (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ) : (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
    );
  }

  return (
    <div style={{ maxWidth: 460 }}>
      <h2 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700, color: "#1e293b" }}>
        Security
      </h2>
      <p style={{ margin: "0 0 20px", fontSize: 13, color: "#64748b", lineHeight: 1.55 }}>
        Manage your password and keep your account secure.
      </p>

      <form onSubmit={handleSubmit} noValidate data-partner-coach>
        <label style={field}>
          <span>Current password</span>
          <div style={inputWrap}>
            <input
              type={showCurrent ? "text" : "password"}
              name="current_password"
              data-field-key="current_password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="Enter your current password"
              style={input}
              onFocus={(e) => Object.assign(e.target.style, inputFocus)}
              onBlur={(e) => Object.assign(e.target.style, { borderColor: "#bed0dc", boxShadow: "none" })}
            />
            <button type="button" style={eyeBtn} onClick={() => setShowCurrent((v) => !v)} tabIndex={-1} aria-label={showCurrent ? "Hide password" : "Show password"}>
              <EyeIcon open={showCurrent} />
            </button>
          </div>
        </label>

        <label style={field}>
          <span>New password</span>
          <div style={inputWrap}>
            <input
              type={showNew ? "text" : "password"}
              name="new_password"
              data-field-key="new_password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              style={input}
              onFocus={(e) => Object.assign(e.target.style, inputFocus)}
              onBlur={(e) => Object.assign(e.target.style, { borderColor: "#bed0dc", boxShadow: "none" })}
            />
            <button type="button" style={eyeBtn} onClick={() => setShowNew((v) => !v)} tabIndex={-1} aria-label={showNew ? "Hide password" : "Show password"}>
              <EyeIcon open={showNew} />
            </button>
          </div>
        </label>

        <label style={field}>
          <span>Confirm new password</span>
          <div style={inputWrap}>
            <input
              type={showConfirm ? "text" : "password"}
              name="confirm_new_password"
              data-field-key="confirm_new_password"
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="Re-enter your new password"
              style={input}
              onFocus={(e) => Object.assign(e.target.style, inputFocus)}
              onBlur={(e) => Object.assign(e.target.style, { borderColor: "#bed0dc", boxShadow: "none" })}
            />
            <button type="button" style={eyeBtn} onClick={() => setShowConfirm((v) => !v)} tabIndex={-1} aria-label={showConfirm ? "Hide password" : "Show password"}>
              <EyeIcon open={showConfirm} />
            </button>
          </div>
        </label>

        {message && (
          <p
            role="status"
            style={{
              margin: "0 0 12px",
              padding: "10px 12px",
              borderRadius: 10,
              background: "#ecfdf5",
              border: "1px solid #a7f3d0",
              color: "#065f46",
              fontSize: 13,
            }}
          >
            {message}
          </p>
        )}
        {error && (
          <p
            role="alert"
            style={{
              margin: "0 0 12px",
              padding: "10px 12px",
              borderRadius: 10,
              background: "#fef2f2",
              border: "1px solid #fecaca",
              color: "#991b1b",
              fontSize: 13,
            }}
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          style={{
            border: "none",
            borderRadius: 10,
            padding: "12px 18px",
            background: "linear-gradient(135deg, #38a2ff, #1f7fe0 60%, #153d5e)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 700,
            cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? "Updating…" : "Change password"}
        </button>
      </form>
    </div>
  );
}

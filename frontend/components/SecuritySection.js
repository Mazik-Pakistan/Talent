"use client";

import { useState } from "react";

import { changePassword, getApiErrorMessage } from "@/services/authService";
import PasswordToggle from "@/components/PasswordToggle";

/**
 * Security > Change Password section for authenticated users (employee,
 * recruiter, candidate). There is exactly ONE password per account — it
 * covers both the personal email and the company email sign-in, so changing
 * it here updates both login methods at once. No OTP is needed because the
 * user already knows their current password.
 */
export default function SecuritySection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }

    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) {
      setError("Your session expired. Please sign in again.");
      return;
    }

    setBusy(true);
    try {
      const data = await changePassword(
        {
          current_password: currentPassword,
          new_password: newPassword,
          confirm_new_password: confirmNewPassword,
        },
        accessToken
      );
      setMessage(data.message || "Password updated successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
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
  const control = {
    position: "relative",
    display: "flex",
    alignItems: "center",
  };
  const toggleStyle = {
    position: "absolute",
    right: 4,
    top: "50%",
    transform: "translateY(-50%)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    border: 0,
    borderRadius: 6,
    background: "transparent",
    color: "#2d6cdf",
    cursor: "pointer",
  };

  return (
    <div style={{ maxWidth: 460 }}>
      <p style={{ margin: "0 0 14px", fontSize: 13, color: "#64748b", lineHeight: 1.55 }}>
        Your password is shared across both your personal and company email sign-in —
        changing it here updates both at once. No verification code is needed.
      </p>

      <form onSubmit={handleSubmit} noValidate>
        <label style={field}>
          <span>Current password</span>
          <div style={control}>
            <input
              type={showCurrent ? "text" : "password"}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="Your current password"
              style={input}
              onFocus={(e) => Object.assign(e.target.style, inputFocus)}
              onBlur={(e) => Object.assign(e.target.style, { borderColor: "#bed0dc", boxShadow: "none" })}
              required
            />
            <PasswordToggle visible={showCurrent} onToggle={() => setShowCurrent((v) => !v)} style={toggleStyle} />
          </div>
        </label>

        <label style={field}>
          <span>New password</span>
          <div style={control}>
            <input
              type={showNew ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              style={input}
              onFocus={(e) => Object.assign(e.target.style, inputFocus)}
              onBlur={(e) => Object.assign(e.target.style, { borderColor: "#bed0dc", boxShadow: "none" })}
              required
            />
            <PasswordToggle visible={showNew} onToggle={() => setShowNew((v) => !v)} style={toggleStyle} />
          </div>
        </label>

        <label style={field}>
          <span>Confirm new password</span>
          <div style={control}>
            <input
              type={showConfirm ? "text" : "password"}
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="Re-enter the new password"
              style={input}
              onFocus={(e) => Object.assign(e.target.style, inputFocus)}
              onBlur={(e) => Object.assign(e.target.style, { borderColor: "#bed0dc", boxShadow: "none" })}
              required
            />
            <PasswordToggle visible={showConfirm} onToggle={() => setShowConfirm((v) => !v)} style={toggleStyle} />
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
            background: "linear-gradient(135deg, #1e3a5f 0%, #2d6cdf 100%)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? "Updating…" : "Change password"}
        </button>
      </form>
    </div>
  );
}

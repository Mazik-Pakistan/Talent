"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";

import { parseFieldErrors } from "@/lib/apiFieldErrors";
import { PASSWORD_REGEX, PASSWORD_HINT_TEXT } from "@/utils/validation";
import PasswordToggle from "@/components/PasswordToggle";
import FieldError, { INPUT_ERROR_STYLE } from "@/lib/formFeedback";
import { changePassword, clearLocalSession, getApiErrorMessage } from "@/services/authService";

const PASSWORD_HINT = PASSWORD_HINT_TEXT ||
  "At least 8 characters with an uppercase letter, a lowercase letter, a number, and a special character.";

export default function SecuritySection() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState("");

  function validate() {
    const errors = {};
    if (!currentPassword) {
      errors.current_password = "Current password is required.";
    }
    if (!newPassword) {
      errors.new_password = "New password is required.";
    } else if (!PASSWORD_REGEX.test(newPassword)) {
      errors.new_password = PASSWORD_HINT;
    } else if (newPassword === currentPassword) {
      errors.new_password = "New password must be different from the current one.";
    }
    if (!confirmNewPassword) {
      errors.confirm_new_password = "Please confirm your new password.";
    } else if (newPassword && confirmNewPassword !== newPassword) {
      errors.confirm_new_password = "New password confirmation does not match.";
    }
    return errors;
  }

  function clearFieldError(field) {
    setFieldErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    const validationErrors = validate();
    setFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

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
      const status = err?.response?.status;
      if (status === 400 || status === 422) {
        const { fieldErrors, general } = parseFieldErrors(err, [
          "current_password",
          "new_password",
          "confirm_new_password",
        ]);
        if (Object.keys(fieldErrors).length > 0) {
          setFieldErrors((current) => ({ ...current, ...fieldErrors }));
        }
        if (general) {
          toast.error(general);
        } else if (Object.keys(fieldErrors).length === 0) {
          setError(getApiErrorMessage(err, "Could not update your password."));
        }
      } else {
        setError(getApiErrorMessage(err, "Could not update your password."));
      }
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
              onChange={(e) => {
                setCurrentPassword(e.target.value);
                clearFieldError("current_password");
              }}
              autoComplete="current-password"
              placeholder="Enter your current password"
              aria-invalid={Boolean(fieldErrors.current_password)}
              style={{
                ...input,
                ...(fieldErrors.current_password ? INPUT_ERROR_STYLE : {}),
              }}
              onFocus={(e) => Object.assign(e.target.style, inputFocus)}
              onBlur={(e) =>
                Object.assign(e.target.style, {
                  borderColor: fieldErrors.current_password ? "#dc2626" : "#bed0dc",
                  boxShadow: "none",
                })
              }
            />
            <PasswordToggle visible={showCurrent} onToggle={() => setShowCurrent((v) => !v)} style={toggleStyle} />
          </div>
          {fieldErrors.current_password && <FieldError>{fieldErrors.current_password}</FieldError>}
        </label>

        <label style={field}>
          <span>New password</span>
          <div style={inputWrap}>
            <input
              type={showNew ? "text" : "password"}
              name="new_password"
              data-field-key="new_password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                clearFieldError("new_password");
                if (fieldErrors.confirm_new_password) {
                  setFieldErrors((current) => ({ ...current, confirm_new_password: undefined }));
                }
              }}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              aria-invalid={Boolean(fieldErrors.new_password)}
              style={{
                ...input,
                ...(fieldErrors.new_password ? INPUT_ERROR_STYLE : {}),
              }}
              onFocus={(e) => Object.assign(e.target.style, inputFocus)}
              onBlur={(e) =>
                Object.assign(e.target.style, {
                  borderColor: fieldErrors.new_password ? "#dc2626" : "#bed0dc",
                  boxShadow: "none",
                })
              }
            />
            <PasswordToggle visible={showNew} onToggle={() => setShowNew((v) => !v)} style={toggleStyle} />
          </div>
          {fieldErrors.new_password && <FieldError>{fieldErrors.new_password}</FieldError>}
        </label>

        <label style={field}>
          <span>Confirm new password</span>
          <div style={inputWrap}>
            <input
              type={showConfirm ? "text" : "password"}
              name="confirm_new_password"
              data-field-key="confirm_new_password"
              value={confirmNewPassword}
              onChange={(e) => {
                setConfirmNewPassword(e.target.value);
                clearFieldError("confirm_new_password");
              }}
              autoComplete="new-password"
              placeholder="Re-enter your new password"
              aria-invalid={Boolean(fieldErrors.confirm_new_password)}
              style={{
                ...input,
                ...(fieldErrors.confirm_new_password ? INPUT_ERROR_STYLE : {}),
              }}
              onFocus={(e) => Object.assign(e.target.style, inputFocus)}
              onBlur={(e) =>
                Object.assign(e.target.style, {
                  borderColor: fieldErrors.confirm_new_password ? "#dc2626" : "#bed0dc",
                  boxShadow: "none",
                })
              }
            />
            <PasswordToggle visible={showConfirm} onToggle={() => setShowConfirm((v) => !v)} style={toggleStyle} />
          </div>
          {fieldErrors.confirm_new_password && <FieldError>{fieldErrors.confirm_new_password}</FieldError>}
        </label>

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

"use client";

import { useEffect, useRef, useState } from "react";

import { deleteProfileImage, getApiErrorMessage, uploadProfileImage } from "@/services/authService";

const ALLOWED_HINT = "JPG, PNG, WEBP up to 5 MB";

export default function ProfileImageControl({
  user,
  profileImage,
  onChange,
  accessToken,
  allowDelete = false,
  required = false,
  label = "Profile image",
  description = "",
  size = 88,
}) {
  const inputRef = useRef(null);
  const [localPreview, setLocalPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    return () => {
      if (localPreview?.startsWith("blob:")) {
        URL.revokeObjectURL(localPreview);
      }
    };
  }, [localPreview]);

  const imageSrc = localPreview || profileImage?.secure_url || "";
  const hasImage = Boolean(profileImage?.secure_url || localPreview);
  const initials = initialsFor(user?.full_name);

  function getAccessToken() {
    if (accessToken) return accessToken;
    try {
      return localStorage.getItem("access_token");
    } catch {
      return "";
    }
  }

  async function handleFileSelect(event) {
    const file = event.target.files?.[0];
    const token = getAccessToken();
    if (!file || !token) return;
    setMessage("");
    setBusy(true);
    const previewUrl = URL.createObjectURL(file);
    setLocalPreview(previewUrl);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const data = await uploadProfileImage(formData, token);
      persistStoredUser(data.profileImage);
      onChange?.(data.profileImage);
      setMessage("Profile image saved.");
      setLocalPreview("");
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Could not upload profile image."));
      if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
      setLocalPreview("");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function handleDelete() {
    const token = getAccessToken();
    if (!token) return;
    setMessage("");
    setBusy(true);
    try {
      const data = await deleteProfileImage(token);
      persistStoredUser(data.profileImage);
      onChange?.(data.profileImage);
      setMessage("Profile image removed.");
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Could not remove profile image."));
    } finally {
      setBusy(false);
    }
  }

  function openPicker() {
    inputRef.current?.click();
  }

  return (
    <div style={containerStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ ...avatarWrapStyle, width: size, height: size }}>
          {imageSrc ? (
            <img
              src={imageSrc}
              alt={label}
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          ) : (
            <span style={initialsStyle}>{initials}</span>
          )}
        </div>
        <div style={{ minWidth: 0, flex: "1 1 220px" }}>
          <div style={titleStyle}>{label}{required ? " *" : ""}</div>
          <div style={descStyle}>{description || ALLOWED_HINT}</div>
          {message && <div style={messageStyle}>{message}</div>}
        </div>
        <div style={actionsStyle}>
          <input ref={inputRef} type="file" accept=".jpg,.jpeg,.png,.webp" onChange={handleFileSelect} hidden />
          <button type="button" className="secondary-button" onClick={openPicker} disabled={busy}>
            {hasImage ? "Replace image" : "Upload image"}
          </button>
          {allowDelete && hasImage && (
            <button type="button" className="secondary-button" onClick={handleDelete} disabled={busy}>
              Remove image
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function persistStoredUser(profileImage) {
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return;
    const user = JSON.parse(raw);
    localStorage.setItem("user", JSON.stringify({ ...user, profileImage }));
    window.dispatchEvent(new Event("profile-image-updated"));
  } catch {
    // Ignore local session sync issues.
  }
}

function initialsFor(name) {
  if (!name) return "??";
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "??";
}

const containerStyle = {
  border: "1px solid var(--border)",
  borderRadius: 12,
  background: "#fff",
  padding: 16,
};

const avatarWrapStyle = {
  borderRadius: "50%",
  overflow: "hidden",
  background: "linear-gradient(135deg, var(--navy), var(--cyan))",
  display: "grid",
  placeItems: "center",
  flex: "none",
};

const initialsStyle = {
  color: "#fff",
  fontWeight: 800,
  fontFamily: "'Sora', system-ui, sans-serif",
  fontSize: "1.15rem",
};

const titleStyle = {
  fontSize: "0.95rem",
  fontWeight: 700,
  color: "var(--navy)",
};

const descStyle = {
  fontSize: "0.82rem",
  color: "var(--text-muted)",
  marginTop: 2,
};

const messageStyle = {
  fontSize: "0.82rem",
  color: "var(--green)",
  marginTop: 6,
};

const actionsStyle = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  marginLeft: "auto",
};

"use client";

import { useRef, useState } from "react";
import ProfileAvatar from "./ProfileAvatar";
import styles from "./ProfilePhotoEditor.module.css";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/jpg", "image/webp"];

/**
 * Editable profile photo with change / remove actions.
 * onUpload(file) and onRemove() should return promises; parent handles API + toast.
 */
export default function ProfilePhotoEditor({
  src,
  name,
  onUpload,
  onRemove,
  size = "xl",
  busy = false,
}) {
  const inputRef = useRef(null);
  const [localError, setLocalError] = useState("");
  const [uploading, setUploading] = useState(false);

  const isBusy = busy || uploading;

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setLocalError("");
    if (!ALLOWED.includes(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name)) {
      setLocalError("Use a PNG, JPG, or WEBP image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setLocalError("Photo must be 5 MB or smaller.");
      return;
    }

    setUploading(true);
    try {
      await onUpload?.(file);
    } catch (error) {
      setLocalError(error?.message || "Could not upload photo.");
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove() {
    if (!src || isBusy) return;
    setLocalError("");
    setUploading(true);
    try {
      await onRemove?.();
    } catch (error) {
      setLocalError(error?.message || "Could not remove photo.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.avatarFrame}>
        <ProfileAvatar src={src} name={name} size={size} />
        {isBusy && <div className={styles.busyOverlay}>Uploading…</div>}
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          disabled={isBusy}
          onClick={() => inputRef.current?.click()}
        >
          {src ? "Change photo" : "Upload photo"}
        </button>
        {src && (
          <button type="button" className={styles.secondary} disabled={isBusy} onClick={handleRemove}>
            Remove
          </button>
        )}
        <p className={styles.hint}>PNG, JPG or WEBP · max 5 MB</p>
        {localError && (
          <p className={styles.error} role="alert">
            {localError}
          </p>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
        className={styles.hiddenInput}
        onChange={handleFileChange}
      />
    </div>
  );
}

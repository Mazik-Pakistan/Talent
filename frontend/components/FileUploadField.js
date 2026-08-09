"use client";

import { forwardRef } from "react";

/**
 * Reusable file chooser rendered as a visible button.
 * The native <input type="file"> stays in the DOM (visually clipped) so label
 * click-to-open, `required`, and refs to reset the value keep working.
 */
const FileUploadField = forwardRef(function FileUploadField(
  {
    accept,
    label = "Choose file",
    replaceLabel = "Replace file",
    selected = false,
    disabled,
    required,
    onChange,
    caption,
    hint,
    className = "",
    buttonStyle,
  },
  ref
) {
  return (
    <span className={`file-upload-field ${className}`}>
      {caption ? <span className="file-upload-caption">{caption}</span> : null}
      <label className={`file-upload-btn${disabled ? " file-upload-btn-disabled" : ""}`} style={buttonStyle}>
        <input
          ref={ref}
          type="file"
          accept={accept}
          disabled={disabled}
          required={required}
          onChange={onChange}
          className="file-upload-input"
        />
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        {selected ? replaceLabel : label}
      </label>
      {hint ? <span className="file-upload-hint">{hint}</span> : null}
    </span>
  );
});

export default FileUploadField;

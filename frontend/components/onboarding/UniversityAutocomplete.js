"use client";

/**
 * UniversityAutocomplete
 *
 * Autocomplete input for the Candidate Onboarding → Education → Institute/University field.
 * Queries GET /api/universities/search?q=<term> (no auth required).
 *
 * Props:
 *   value        {string}   controlled value
 *   onChange     {fn}       called with the new string value when selection or typing changes
 *   disabled     {boolean}  disables the input
 *   error        {boolean}  highlights the field in error state
 *   styles       {object}   CSS-module classes from the onboarding page (field, fieldError, fieldErrorText)
 *   fillAnimClass {string}  OCR animation class (passed straight through to the wrapper label)
 *   fillAnimStyle {object}  OCR animation style (passed straight through to the wrapper label)
 *   dataOcrKey   {string}   data-ocr-key attribute for OCR autofill targeting
 */

import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
const DEBOUNCE_MS = 220;
const MIN_CHARS = 1;

export default function UniversityAutocomplete({
  value = "",
  onChange,
  disabled = false,
  error = false,
  styles = {},
  fillAnimClass = "",
  fillAnimStyle = {},
  dataOcrKey,
}) {
  const [query, setQuery]         = useState(value);
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen]           = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [loading, setLoading]     = useState(false);

  const debounceTimer  = useRef(null);
  const containerRef   = useRef(null);
  const inputRef       = useRef(null);
  // Track whether the current value was set by selecting from the list
  const selectedRef    = useRef(false);

  // Keep local query in sync when parent resets the value (e.g. OCR autofill)
  useEffect(() => {
    setQuery(value);
  }, [value]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handlePointerDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  const fetchSuggestions = useCallback(async (term) => {
    if (term.length < MIN_CHARS) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/universities/search?q=${encodeURIComponent(term)}`,
        { headers: { "ngrok-skip-browser-warning": "true" } }
      );
      if (!res.ok) throw new Error("search failed");
      const data = await res.json();
      setSuggestions(data);
      setOpen(data.length > 0);
      setActiveIdx(-1);
    } catch {
      setSuggestions([]);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleInputChange(e) {
    const val = e.target.value;
    selectedRef.current = false;
    setQuery(val);
    onChange(val);

    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => fetchSuggestions(val), DEBOUNCE_MS);
  }

  function handleSelect(uni) {
    selectedRef.current = true;
    setQuery(uni.name);
    onChange(uni.name);
    setSuggestions([]);
    setOpen(false);
    setActiveIdx(-1);
  }

  function handleKeyDown(e) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      handleSelect(suggestions[activeIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const wrapperClass = [
    styles.field || "",
    error ? (styles.fieldError || "") : "",
    fillAnimClass,
  ].filter(Boolean).join(" ");

  return (
    <label
      ref={containerRef}
      className={wrapperClass}
      style={{ ...fillAnimStyle, position: "relative" }}
      data-ocr-key={dataOcrKey}
      data-field-error={error ? "true" : undefined}
    >
      <span>
        Institute / University{" "}
        <span style={{ color: "red", marginLeft: 4 }}>*</span>
      </span>

      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        disabled={disabled}
        autoComplete="off"
        placeholder="Type to search universities…"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls="uni-suggestions"
        aria-activedescendant={activeIdx >= 0 ? `uni-opt-${activeIdx}` : undefined}
      />

      {open && (
        <ul
          id="uni-suggestions"
          role="listbox"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 999,
            margin: 0,
            padding: 0,
            listStyle: "none",
            background: "#fff",
            border: "1px solid #d1d5db",
            borderRadius: 8,
            boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
            maxHeight: 280,
            overflowY: "auto",
          }}
        >
          {suggestions.map((uni, idx) => (
            <li
              key={uni.name}
              id={`uni-opt-${idx}`}
              role="option"
              aria-selected={idx === activeIdx}
              onPointerDown={(e) => {
                // Prevent the input from losing focus before click fires
                e.preventDefault();
                handleSelect(uni);
              }}
              style={{
                padding: "9px 14px",
                cursor: "pointer",
                background: idx === activeIdx ? "#f0f4ff" : "transparent",
                borderBottom: idx < suggestions.length - 1 ? "1px solid #f3f4f6" : "none",
              }}
            >
              <span style={{ fontWeight: 500, fontSize: 14 }}>{uni.name}</span>
              {uni.country && (
                <span style={{ marginLeft: 8, fontSize: 12, color: "#6b7280" }}>
                  {uni.country}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {loading && (
        <span
          style={{
            position: "absolute",
            right: 12,
            top: "50%",
            transform: "translateY(-50%)",
            fontSize: 11,
            color: "#9ca3af",
            pointerEvents: "none",
          }}
        >
          …
        </span>
      )}

      {error && (
        <em className={styles.fieldErrorText || ""}>Required</em>
      )}
    </label>
  );
}

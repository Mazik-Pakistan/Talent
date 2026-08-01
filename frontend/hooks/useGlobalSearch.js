"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { globalSearch } from "@/services/authService";

const DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 2;

/**
 * Debounced global search (candidates/employees). Extracted from
 * RecruiterShell so any shell can opt in to the same search box.
 */
export function useGlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const timerRef = useRef(null);

  const run = useCallback(async (raw) => {
    const trimmed = raw.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setSearching(false);
      return;
    }
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken) return;
    setSearching(true);
    try {
      const data = await globalSearch(trimmed, accessToken);
      setResults(data.results || []);
      setOpen(true);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setSearching(false);
      return undefined;
    }
    timerRef.current = setTimeout(() => run(trimmed), DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, run]);

  const submitNow = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    run(query);
  }, [query, run]);

  return {
    query,
    setQuery,
    results,
    open,
    setOpen,
    searching,
    selected,
    setSelected,
    submitNow,
  };
}

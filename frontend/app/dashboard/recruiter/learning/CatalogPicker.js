"use client";

import { useCallback, useEffect, useState } from "react";
import { getApiErrorMessage } from "@/services/authService";
import { browseCatalog, getCatalogSources } from "@/services/learningService";
import { Check, Plus, Search, X } from "lucide-react";
import s from "./OrgFrameworkTab.module.css";

function fmtDuration(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Normalize catalog item type for badges and filters. */
export function catalogTypeKey(item) {
  const raw = String(item?.catalog_type || item?.type || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw.includes("cert")) return "certification";
  if (raw === "learningpath" || raw === "learning_path" || raw === "learning path" || raw === "path") {
    return "learningPath";
  }
  if (raw === "module" || raw === "modules") return "module";
  if (raw === "course" || raw === "courses") return "course";
  return raw;
}

const TYPE_META = {
  certification: { label: "Cert", pill: "orange" },
  learningPath: { label: "Learning path", pill: "blue" },
  module: { label: "Module", pill: "green" },
  course: { label: "Course", pill: "blue" },
};

const TYPE_FILTERS = [
  { value: "", label: "All types" },
  { value: "module", label: "Modules" },
  { value: "learningPath", label: "Learning paths" },
  { value: "course", label: "Courses" },
  { value: "certification", label: "Certifications" },
];

export function CatalogTypeBadge({ item, style }) {
  const key = catalogTypeKey(item);
  if (!key) return null;
  const meta = TYPE_META[key] || {
    label: key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
    pill: "neutral",
  };
  const pillClass = s[meta.pill] || s.neutral;
  return (
    <span className={`${s.statusPill} ${pillClass}`} style={{ fontSize: 10, ...(style || {}) }}>
      {meta.label}
    </span>
  );
}

/** Provider-agnostic skill tags from any catalog item / roadmap entry. */
export function courseSkills(course) {
  const out = [];
  const push = (value) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    const text = String(value).trim();
    if (text && !out.includes(text)) out.push(text);
  };
  // Same field set the backend uses — works for every catalog provider.
  push(course?.skills);
  push(course?.skills_covered);
  push(course?.tags);
  push(course?.competency);
  push(course?.subjects);
  push(course?.products);
  if (out.length === 0) push(course?.category);
  return out;
}

/** Provider-agnostic certification labels from any catalog item / roadmap entry. */
export function courseCerts(course) {
  const out = [];
  const push = (value) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    const text = String(value).trim();
    if (text && !out.includes(text)) out.push(text);
  };
  push(course?.certifications);
  push(course?.required_certifications);
  if (catalogTypeKey(course) === "certification" && course?.title) push(course.title);
  return out;
}

/**
 * Modal for browsing the Learning module catalog and picking items one by one.
 * Used by Career Roadmaps — modules, learning paths, courses, and certifications
 * all come from the same catalogs and show a type badge on the roadmap.
 */
export default function CatalogPicker({
  title,
  onClose,
  isAdded,
  onPick,
  pickLabel = "Add",
}) {
  const [sources, setSources] = useState([]);
  const [source, setSource] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [q, setQ] = useState("");
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const token = () => localStorage.getItem("access_token");

  const fetchCourses = useCallback(async (src, query, type) => {
    if (!src) return;
    setLoading(true);
    setError("");
    try {
      const resp = await browseCatalog(token(), {
        source: src,
        q: query || undefined,
        type: type || undefined,
        page: 1,
        page_size: 60,
        sort_by: "title_asc",
      });
      setCourses(resp.courses || resp.items || resp.results || []);
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not load this catalog."));
      setCourses([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getCatalogSources(token());
        if (cancelled) return;
        const list = data.sources || [];
        setSources(list);
        if (list.length > 0) {
          setSource(list[0].key);
          fetchCourses(list[0].key, "", "");
        }
      } catch (err) {
        if (!cancelled) setError(getApiErrorMessage(err, "Could not load catalogs."));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePick = async (course) => {
    if (busyId) return;
    setBusyId(course.uid);
    try {
      await onPick(course);
    } catch {
      // Errors are toasted by the caller.
    } finally {
      setBusyId(null);
    }
  };

  const visibleCourses = courses.filter((c) => {
    if (!c || !c.title || !c.uid) return false;
    if (!typeFilter) return true;
    // Client-side fallback when a provider ignores the type query param.
    return catalogTypeKey(c) === typeFilter;
  });

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,31,41,0.45)",
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          width: 720,
          maxWidth: "100%",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 60px -12px rgba(15,43,64,0.45)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border-soft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--navy)", fontFamily: "'Sora', system-ui" }}>{title}</div>
          <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={onClose} aria-label="Close">
            <X aria-hidden="true" style={{ width: 16, height: 16 }} />
          </button>
        </div>

        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid var(--border-soft)",
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "end",
          }}
        >
          <label className={s.fieldLabel} style={{ margin: 0, flex: "1 1 180px" }}>
            Catalog
            <select
              value={source}
              onChange={(e) => {
                const v = e.target.value;
                setSource(v);
                setQ("");
                fetchCourses(v, "", typeFilter);
              }}
            >
              {sources.length === 0 && <option value="">Loading…</option>}
              {sources.map((src) => (
                <option key={src.key} value={src.key}>
                  {src.label}
                  {src.course_count != null ? ` (${src.course_count})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className={s.fieldLabel} style={{ margin: 0, flex: "1 1 140px" }}>
            Type
            <select
              value={typeFilter}
              onChange={(e) => {
                const v = e.target.value;
                setTypeFilter(v);
                fetchCourses(source, q, v);
              }}
            >
              {TYPE_FILTERS.map((opt) => (
                <option key={opt.value || "all"} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <label className={s.fieldLabel} style={{ margin: 0, flex: "1 1 180px" }}>
            Name
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") fetchCourses(source, q, typeFilter);
              }}
              placeholder="Search by name…"
            />
          </label>
          <button
            type="button"
            className={`${s.btn} ${s.btnSecondary}`}
            onClick={() => fetchCourses(source, q, typeFilter)}
            disabled={!source}
          >
            <Search aria-hidden="true" style={{ width: 13, height: 13 }} /> Search
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
          {loading && (
            <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Loading catalog…</div>
          )}
          {!loading && error && (
            <div style={{ padding: 16, fontSize: 12.5, color: "var(--red)" }}>{error}</div>
          )}
          {!loading && !error && visibleCourses.map((c) => {
            const added = !!isAdded && isAdded(c);
            const skills = courseSkills(c);
            const certs = courseCerts(c);
            return (
              <div
                key={c.uid}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--border-soft)",
                  marginBottom: 6,
                  background: "#fbfcfe",
                }}
              >
                <div style={{ paddingTop: 2 }}>
                  <CatalogTypeBadge item={c} style={{ fontSize: 9 }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 650, color: "var(--navy)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", gap: 10, flexWrap: "wrap", marginTop: 2 }}>
                    {c.category ? <span>{c.category}</span> : c.source ? <span>{c.source}</span> : null}
                    {fmtDuration(c.duration_minutes) ? <span>{fmtDuration(c.duration_minutes)}</span> : null}
                  </div>
                  {skills.length > 0 ? (
                    <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".03em" }}>Skills</span>
                      {skills.slice(0, 4).map((skill) => (
                        <span key={skill} className={`${s.statusPill} ${s.green}`} style={{ fontSize: 9 }}>{skill}</span>
                      ))}
                      {skills.length > 4 ? <span style={{ fontSize: 10, color: "var(--text-muted)" }}>+{skills.length - 4}</span> : null}
                    </div>
                  ) : (
                    <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-faint)" }}>No skills listed in this catalog for this item</div>
                  )}
                  {certs.length > 0 ? (
                    <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".03em" }}>Cert</span>
                      {certs.slice(0, 2).map((cert) => (
                        <span key={cert} className={`${s.statusPill} ${s.orange}`} style={{ fontSize: 9 }}>{cert}</span>
                      ))}
                    </div>
                  ) : (
                    <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-faint)" }}>No certification attached in catalog</div>
                  )}
                </div>
                <button
                  type="button"
                  className={`${s.btn} ${added ? s.btnGhost : s.btnPrimary}`}
                  disabled={added || busyId === c.uid}
                  onClick={() => handlePick(c)}
                  style={added ? { marginTop: 2 } : { minHeight: 30, padding: "6px 12px", fontSize: 12, marginTop: 2 }}
                >
                  {busyId === c.uid ? (
                    "Adding…"
                  ) : added ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <Check aria-hidden="true" style={{ width: 12, height: 12 }} /> Added
                    </span>
                  ) : (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <Plus aria-hidden="true" style={{ width: 12, height: 12 }} /> {pickLabel}
                    </span>
                  )}
                </button>
              </div>
            );
          })}
          {!loading && !error && visibleCourses.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              No items found. Try another catalog, type filter, or search term.
            </div>
          )}
        </div>

        <div style={{ padding: "10px 20px", borderTop: "1px solid var(--border-soft)", textAlign: "right" }}>
          <button type="button" className={`${s.btn} ${s.btnSecondary}`} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

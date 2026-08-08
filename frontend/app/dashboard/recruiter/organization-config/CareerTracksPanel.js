"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { getApiErrorMessage } from "@/services/authService";
import {
  listCareerTracks,
  createCareerTrack,
  listCareerLevels,
  createCareerLevel,
  deleteCareerLevel,
} from "@/services/careerService";
import { Plus, Trash2 } from "lucide-react";
import s from "../learning/OrgFrameworkTab.module.css";

/**
 * Career tracks & levels for promotion assign (career-framework API).
 * Lives in Organization Setup — not in Talent Intelligence.
 */
export default function CareerTracksPanel({ departments = [] }) {
  const [tracks, setTracks] = useState([]);
  const [levels, setLevels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [trackForm, setTrackForm] = useState({ track_name: "", department: "" });
  const [levelForm, setLevelForm] = useState({
    track_id: "",
    level_number: 1,
    role_title: "",
  });
  const [saving, setSaving] = useState(false);

  const token = () => localStorage.getItem("access_token");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, l] = await Promise.all([
        listCareerTracks(token()),
        listCareerLevels(token()),
      ]);
      setTracks(t.tracks || t || []);
      setLevels(l.levels || l || []);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not load career tracks."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreateTrack(e) {
    e.preventDefault();
    if (!trackForm.track_name.trim() || !trackForm.department) {
      toast.warn("Track name and department are required.");
      return;
    }
    setSaving(true);
    try {
      await createCareerTrack(token(), {
        track_name: trackForm.track_name.trim(),
        department: trackForm.department,
      });
      toast.success("Track created.");
      setTrackForm({ track_name: "", department: "" });
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not create track."));
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateLevel(e) {
    e.preventDefault();
    if (!levelForm.track_id || !levelForm.role_title.trim()) {
      toast.warn("Track and role title are required.");
      return;
    }
    const track = tracks.find((t) => String(t.id) === String(levelForm.track_id));
    if (!track) {
      toast.warn("Select a valid track.");
      return;
    }
    setSaving(true);
    try {
      await createCareerLevel(token(), {
        track_name: track.track_name || track.name,
        department: track.department,
        level_number: Number(levelForm.level_number) || 1,
        role_title: levelForm.role_title.trim(),
      });
      toast.success("Level created.");
      setLevelForm({ track_id: levelForm.track_id, level_number: 1, role_title: "" });
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not create level."));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteLevel(id) {
    if (!confirm("Delete this career level?")) return;
    try {
      await deleteCareerLevel(token(), id);
      toast.success("Level deleted.");
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not delete level."));
    }
  }

  if (loading) {
    return <div style={{ padding: 24, color: "var(--text-muted)" }}>Loading career tracks…</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h3 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 750, color: "var(--navy)" }}>
          Career tracks & levels
        </h3>
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-muted)", maxWidth: 560 }}>
          Used by Talent → Promotion Pipeline when assigning a target level. Structure departments and roles above; manage progression tracks here.
        </p>
      </div>

      <form data-partner-coach onSubmit={handleCreateTrack} style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
        <label className={s.fieldLabel} style={{ margin: 0, minWidth: 180 }}>
          New track name
          <input
            data-field-key="track_name"
            value={trackForm.track_name}
            onChange={(e) => setTrackForm((f) => ({ ...f, track_name: e.target.value }))}
            placeholder="e.g. Engineering ladder"
          />
        </label>
        <label className={s.fieldLabel} style={{ margin: 0, minWidth: 160 }}>
          Department
          <select
            data-field-key="department"
            value={trackForm.department}
            onChange={(e) => setTrackForm((f) => ({ ...f, department: e.target.value }))}
          >
            <option value="">Select</option>
            {departments.map((d) => (
              <option key={d.id || d.name} value={d.name}>{d.name}</option>
            ))}
          </select>
        </label>
        <button type="submit" className={`${s.btn} ${s.btnPrimary}`} disabled={saving || departments.length === 0}>
          <Plus size={14} aria-hidden="true" /> Add track
        </button>
      </form>

      {tracks.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          No tracks yet. Add a department first if the list is empty, then create a track.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {tracks.map((t) => (
            <div
              key={t.id}
              style={{
                padding: "12px 14px",
                border: "1px solid var(--border)",
                borderRadius: 10,
                background: "#fff",
              }}
            >
              <div style={{ fontWeight: 700, color: "var(--navy)", fontSize: 13.5 }}>
                {t.track_name || t.name}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                {t.department || "—"} · {levels.filter((l) => (l.track_name || "") === (t.track_name || t.name) && (l.department || "") === (t.department || "")).length} levels
              </div>
            </div>
          ))}
        </div>
      )}

      <form data-partner-coach onSubmit={handleCreateLevel} style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
        <label className={s.fieldLabel} style={{ margin: 0, minWidth: 180 }}>
          Track
          <select
            data-field-key="track_id"
            value={levelForm.track_id}
            onChange={(e) => setLevelForm((f) => ({ ...f, track_id: e.target.value }))}
          >
            <option value="">Select track</option>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>{t.track_name || t.name} ({t.department})</option>
            ))}
          </select>
        </label>
        <label className={s.fieldLabel} style={{ margin: 0, width: 90 }}>
          Level #
          <input
            data-field-key="level_number"
            type="number"
            min="1"
            value={levelForm.level_number}
            onChange={(e) => setLevelForm((f) => ({ ...f, level_number: e.target.value }))}
          />
        </label>
        <label className={s.fieldLabel} style={{ margin: 0, minWidth: 160 }}>
          Role title
          <input
            data-field-key="role_title"
            value={levelForm.role_title}
            onChange={(e) => setLevelForm((f) => ({ ...f, role_title: e.target.value }))}
            placeholder="Senior Engineer"
          />
        </label>
        <button type="submit" className={`${s.btn} ${s.btnPrimary}`} disabled={saving || tracks.length === 0}>
          <Plus size={14} aria-hidden="true" /> Add level
        </button>
      </form>

      {levels.length > 0 && (
        <table className={s.table}>
          <thead>
            <tr>
              <th>Level</th>
              <th>Role</th>
              <th>Department</th>
              <th>Track</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {levels.map((l) => {
              return (
                <tr key={l.id}>
                  <td>L{l.level_number}</td>
                  <td>{l.role_title}</td>
                  <td>{l.department || "—"}</td>
                  <td>{l.track_name || "—"}</td>
                  <td>
                    <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={() => handleDeleteLevel(l.id)} aria-label="Delete level">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

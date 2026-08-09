"use client";

import { useMemo, useState } from "react";
import styles from "@/app/dashboard/recruiter/talent/talent.module.css";

const PROF_RANK = { Beginner: 1, Intermediate: 2, Advanced: 3, Expert: 4 };
const PROF_PCT = { Beginner: 25, Intermediate: 50, Advanced: 75, Expert: 100 };
const PROF_COLS = ["Beginner", "Intermediate", "Advanced", "Expert"];
const PROF_SHORT = { Beginner: "Beg", Intermediate: "Int", Advanced: "Adv", Expert: "Exp" };
const PROF_CLASS = {
  Beginner: "skillMatrixFillBeginner",
  Intermediate: "skillMatrixFillIntermediate",
  Advanced: "skillMatrixFillAdvanced",
  Expert: "skillMatrixFillExpert",
};

function isOwnedSkill(s) {
  if (s == null) return false;
  if (typeof s === "string") return s.trim().length > 0;
  // Enrollment/assignment rows are not skills — real skills may have source "course"
  // after certificate verify (one row per skill, proficiency upgraded in place).
  if (s.enrollment_id || s.assignment_id) return false;
  if (s.progress_percent != null && !s.skill_name && !s.name && !s.skill) return false;
  const source = String(s.source || "").toLowerCase();
  if (["enrollment", "assignment", "certificate_enrollment"].includes(source)) {
    return false;
  }
  return Boolean((s.skill_name || s.name || s.skill || "").trim());
}

function skillName(s) {
  if (typeof s === "string") return s.trim();
  return (s.skill_name || s.name || s.skill || "Skill").trim() || "Skill";
}

function skillProficiency(s) {
  if (typeof s === "string") return "Beginner";
  const raw = (s.proficiency || "Beginner").toString();
  const key = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  return PROF_RANK[key] != null ? key : (PROF_RANK[raw] != null ? raw : "Beginner");
}

function skillCategory(s) {
  if (typeof s !== "object") return "Other";
  return (s.category || s.skill_category || "Other").toString();
}

/** Normalize to owned skill rows only (never courses / cert enrollments). */
export function normalizeOwnedSkills(skills) {
  if (!skills) return [];
  let list = [];
  if (Array.isArray(skills)) list = skills;
  else if (Array.isArray(skills.categories)) {
    list = skills.categories.flatMap((c) =>
      (c.skills || []).map((s) => ({
        ...s,
        category: s.category || c.category || c.name || "Other",
      }))
    );
  } else if (Array.isArray(skills.items)) list = skills.items;
  else if (Array.isArray(skills.skills)) list = skills.skills;

  const best = new Map();
  for (const s of list.filter(isOwnedSkill)) {
    const name = skillName(s);
    const key = name.toLowerCase();
    const prof = skillProficiency(s);
    const prev = best.get(key);
    if (!prev || (PROF_RANK[prof] || 0) > (PROF_RANK[skillProficiency(prev)] || 0)) {
      best.set(key, typeof s === "string" ? { skill_name: s, proficiency: "Beginner" } : { ...s, skill_name: name });
    }
  }
  return [...best.values()].sort((a, b) => {
    const cat = skillCategory(a).localeCompare(skillCategory(b));
    if (cat !== 0) return cat;
    const pr = (PROF_RANK[skillProficiency(b)] || 0) - (PROF_RANK[skillProficiency(a)] || 0);
    if (pr !== 0) return pr;
    return skillName(a).localeCompare(skillName(b));
  });
}

function groupByCategory(rows) {
  const groups = new Map();
  for (const s of rows) {
    const cat = skillCategory(s);
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(s);
  }
  return [...groups.entries()];
}

/**
 * Classic skill matrix: skill name × proficiency level bar (Beg→Exp).
 * Bars encode proficiency level — not course completion %.
 */
export default function SkillMatrixBars({
  skills,
  emptyMessage = "No owned skills on file yet.",
  max = 80,
  previewCount = 24,
  requiredSkills = [],
}) {
  const rows = useMemo(() => normalizeOwnedSkills(skills).slice(0, max), [skills, max]);
  const [expanded, setExpanded] = useState(false);

  const requiredKeys = useMemo(() => {
    return new Set(
      (requiredSkills || [])
        .map((s) => (typeof s === "string" ? s : s.name || s.skill_name || s.skill || "").trim().toLowerCase())
        .filter(Boolean)
    );
  }, [requiredSkills]);

  const counts = useMemo(() => {
    const c = { Beginner: 0, Intermediate: 0, Advanced: 0, Expert: 0 };
    for (const s of rows) c[skillProficiency(s)] += 1;
    return c;
  }, [rows]);

  if (rows.length === 0) {
    return (
      <div className={styles.skillMatrixEmpty}>
        <div className={styles.skillMatrixEmptyTitle}>No skills on file</div>
        <p className={styles.skillMatrixEmptyHint}>{emptyMessage}</p>
      </div>
    );
  }

  const groups = groupByCategory(rows);
  let shown = 0;
  const visibleGroups = [];
  const limit = expanded ? rows.length : previewCount;
  for (const [cat, items] of groups) {
    if (shown >= limit) break;
    const slice = items.slice(0, Math.max(0, limit - shown));
    if (slice.length) {
      visibleGroups.push([cat, slice, items.length]);
      shown += slice.length;
    }
  }
  const hidden = Math.max(0, rows.length - shown);

  return (
    <div className={styles.skillMatrixPanel}>
      <div className={styles.skillMatrixToolbar}>
        <div className={styles.skillMatrixToolbarLeft}>
          <span className={styles.skillMatrixTitle}>Skill matrix</span>
          <span className={styles.skillMatrixCount}>{rows.length} skills</span>
        </div>
        <div className={styles.skillMatrixScale}>
          {PROF_COLS.map((p) => (
            <span key={p} className={styles.skillMatrixScaleItem}>
              <i className={styles[PROF_CLASS[p]]} />
              {PROF_SHORT[p]} <b>{counts[p]}</b>
            </span>
          ))}
        </div>
      </div>

      <div className={styles.skillMatrixAxis}>
        <span>Skill</span>
        <div className={styles.skillMatrixAxisTicks}>
          <span>Beg</span>
          <span>Int</span>
          <span>Adv</span>
          <span>Exp</span>
        </div>
        <span className={styles.skillMatrixAxisLevel}>Level</span>
      </div>

      <div className={styles.skillMatrixBody}>
        {visibleGroups.map(([category, items, totalInCat]) => (
          <div key={category} className={styles.skillMatrixCatBlock}>
            <div className={styles.skillMatrixCatLabel}>
              {category}
              <em>{totalInCat}</em>
            </div>
            {items.map((s, i) => {
              const name = skillName(s);
              const proficiency = skillProficiency(s);
              const pct = PROF_PCT[proficiency] || 25;
              const isRequired = requiredKeys.has(name.toLowerCase());
              return (
                <div key={`${category}-${name}-${i}`} className={styles.skillMatrixRow}>
                  <div className={styles.skillMatrixLabelCol}>
                    <span className={styles.skillMatrixName} title={name}>
                      {name}
                      {isRequired ? <em className={styles.skillMatrixReqMark}>role</em> : null}
                    </span>
                  </div>
                  <div className={styles.skillMatrixTrack} aria-hidden="true">
                    <div className={styles.skillMatrixTicks}>
                      <i /><i /><i /><i />
                    </div>
                    <div
                      className={`${styles.skillMatrixFill} ${styles[PROF_CLASS[proficiency]]}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className={`${styles.skillMatrixProf} ${styles[`skillMatrixProf${proficiency}`]}`}>
                    {proficiency}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {hidden > 0 && (
        <button
          type="button"
          className={styles.skillMatrixMoreBtn}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show less" : `Show all ${rows.length} skills`}
        </button>
      )}
    </div>
  );
}

export function roleSkillCoverage(requiredSkills, employeeSkillLists) {
  const required = (requiredSkills || [])
    .map((s) => (typeof s === "string" ? s : s.name || s.skill_name || s.skill || "").trim())
    .filter(Boolean);
  if (!required.length) return [];

  const holders = employeeSkillLists || [];
  return required.map((name) => {
    const key = name.toLowerCase();
    let have = 0;
    for (const list of holders) {
      const names = normalizeOwnedSkills(list).map((s) => skillName(s).toLowerCase());
      if (names.includes(key)) have += 1;
    }
    return {
      name,
      have,
      total: holders.length,
      coverage: holders.length ? Math.round((100 * have) / holders.length) : 0,
    };
  });
}

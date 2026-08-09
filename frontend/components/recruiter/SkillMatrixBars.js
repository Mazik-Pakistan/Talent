"use client";

import styles from "@/app/dashboard/recruiter/talent/talent.module.css";

const PROF = { Beginner: 25, Intermediate: 50, Advanced: 75, Expert: 100 };

function normalizeSkills(skills) {
  if (!skills) return [];
  if (Array.isArray(skills)) return skills;
  if (Array.isArray(skills.categories)) {
    return skills.categories.flatMap((c) => c.skills || []);
  }
  if (Array.isArray(skills.items)) return skills.items;
  return [];
}

/**
 * Shared skill-matrix proficiency bars for Talent CIC / learning panels.
 */
export default function SkillMatrixBars({
  skills,
  emptyMessage = "Skill matrix not assessed / no skills data yet.",
  max = 16,
}) {
  const rows = normalizeSkills(skills).slice(0, max);

  if (rows.length === 0) {
    return <p className={styles.inlineNote}>{emptyMessage}</p>;
  }

  return (
    <div className={styles.skillMatrixList}>
      {rows.map((s, i) => {
        const name = typeof s === "string" ? s : (s.skill_name || s.name || s.skill || "Skill");
        const proficiency = typeof s === "string" ? "Beginner" : (s.proficiency || "Beginner");
        const pct = PROF[proficiency] || (typeof s.level === "number" ? s.level : 25);
        return (
          <div key={s.id || `${name}-${i}`} className={styles.skillMatrixRow}>
            <span className={styles.skillMatrixName} title={name}>{name}</span>
            <div className={styles.skillMatrixTrack}>
              <div className={styles.skillMatrixFill} style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
            <span className={styles.skillMatrixProf}>{proficiency}</span>
          </div>
        );
      })}
    </div>
  );
}

export function roleSkillCoverage(requiredSkills, employeeSkillLists) {
  const required = (requiredSkills || [])
    .map((s) => (typeof s === "string" ? s : s.name || s.skill_name || s.skill || "").trim())
    .filter(Boolean);
  if (!required.length) return [];

  const holders = employeeSkillLists || [];
  const total = holders.length || 1;

  return required.map((name) => {
    const key = name.toLowerCase();
    let have = 0;
    for (const list of holders) {
      const names = normalizeSkills(list).map((s) =>
        (typeof s === "string" ? s : s.skill_name || s.name || s.skill || "").trim().toLowerCase()
      );
      if (names.includes(key)) have += 1;
    }
    return {
      name,
      have,
      total: holders.length,
      coverage: holders.length ? Math.round((100 * have) / total) : 0,
    };
  });
}

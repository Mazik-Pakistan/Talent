"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import EmployeeShell from "@/components/employee/EmployeeShell";
import dashStyles from "@/app/dashboard/employee/employee-dashboard.module.css";
import styles from "./talent.module.css";
import { getApiErrorMessage } from "@/services/authService";
import {
  applyToOpportunity,
  browseOpportunities,
  getAchievements,
  getJourneyTimeline,
} from "@/services/talentService";

const TABS = [
  { key: "journey", label: "Journey" },
  { key: "achievements", label: "Achievements" },
  { key: "opportunities", label: "Internal Opportunities" },
];

export default function EmployeeTalentPage() {
  const [tab, setTab] = useState("journey");

  return (
    <EmployeeShell activeKey="talent" title="My Talent" subtitle="Career journey, achievements & internal opportunities">
      <div className={styles.tabBar}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`${styles.tabBtn} ${tab === t.key ? styles.tabActive : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "journey" && <JourneyTab />}
      {tab === "achievements" && <AchievementsTab />}
      {tab === "opportunities" && <OpportunitiesTab />}
    </EmployeeShell>
  );
}

const EVENT_LABELS = {
  joined: "All",
  certification: "Certifications",
  course_completed: "Courses",
  skill_improvement: "Skills",
  promoted: "Career events",
  title_change: "Career events",
  department_change: "Career events",
  manager_change: "Career events",
};

const FILTERS = [
  { key: "all", label: "All", types: null },
  { key: "career", label: "Career events", types: "promoted,title_change,department_change,manager_change,joined" },
  { key: "certification", label: "Certifications", types: "certification" },
  { key: "course_completed", label: "Courses", types: "course_completed" },
  { key: "skill_improvement", label: "Skills", types: "skill_improvement" },
];

// ---------------------------------------------------------------------- //
// US-094: Chronological employee journey timeline
// ---------------------------------------------------------------------- //
function JourneyTab() {
  const [filter, setFilter] = useState("all");
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback((filterKey) => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    const types = FILTERS.find((f) => f.key === filterKey)?.types;
    getJourneyTimeline(token, types)
      .then((data) => setTimeline(data.timeline || []))
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not load your journey.")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(filter); }, [filter, load]);

  return (
    <div className={dashStyles.section}>
      <div className={dashStyles.sectionHead}>
        <div className={dashStyles.sectionHeadLeft}>
          <span className={`${dashStyles.bar} ${dashStyles.navy}`} />
          <div>
            <div className={dashStyles.sectionTitle}>Your journey</div>
            <p className={dashStyles.sectionDesc}>
              Joining, promotions, certifications, completed courses, and skill growth — sorted chronologically.
            </p>
          </div>
        </div>
      </div>
      <div className={dashStyles.sectionBody}>
        <div className={styles.filterRow}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`${styles.filterChip} ${filter === f.key ? styles.filterChipActive : ""}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading && <p className={styles.inlineNote}>Loading…</p>}
        {!loading && timeline.length === 0 && (
          <div className={dashStyles.emptyState}>
            <div className={dashStyles.emptyTitle}>Nothing here yet</div>
            <div className={dashStyles.emptySub}>Complete courses, earn certifications, or add skills to build your timeline.</div>
          </div>
        )}
        {!loading && timeline.length > 0 && (
          <div className={styles.timeline}>
            {timeline
              .slice()
              .reverse()
              .map((event, idx, arr) => (
                <div key={`${event.type}-${event.date}-${idx}`} className={styles.timelineItem}>
                  <div className={styles.timelineMarkerWrap}>
                    <div className={`${styles.timelineDot} ${styles[event.type] || ""}`} />
                    {idx < arr.length - 1 && <div className={styles.timelineLine} />}
                  </div>
                  <div className={styles.timelineBody}>
                    <div className={styles.timelineTitle}>{event.title}</div>
                    {event.detail && <div className={styles.timelineDetail}>{event.detail}</div>}
                    <div className={styles.timelineDate}>
                      {new Date(event.date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------- //
// US-101: Achievements
// ---------------------------------------------------------------------- //
function AchievementsTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    getAchievements(token)
      .then(setData)
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not load achievements.")))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className={dashStyles.section}>
      <div className={dashStyles.sectionHead}>
        <div className={dashStyles.sectionHeadLeft}>
          <span className={`${dashStyles.bar} ${dashStyles.green}`} />
          <div>
            <div className={dashStyles.sectionTitle}>Achievements</div>
            <p className={dashStyles.sectionDesc}>
              {data ? `${data.total_certifications} certifications · ${data.total_completed_courses} courses completed` : "Your certifications, completed courses, and milestones."}
            </p>
          </div>
        </div>
      </div>
      <div className={dashStyles.sectionBody}>
        {loading && <p className={styles.inlineNote}>Loading…</p>}
        {!loading && (!data?.achievements || data.achievements.length === 0) && (
          <div className={dashStyles.emptyState}>
            <div className={dashStyles.emptyTitle}>No achievements yet</div>
            <div className={dashStyles.emptySub}>Complete a course or earn a verified certification to see it here.</div>
          </div>
        )}
        {!loading && data?.achievements?.length > 0 && (
          <div className={styles.achievementGrid}>
            {data.achievements.map((a, idx) => (
              <div key={idx} className={styles.achievementCard}>
                <div className={`${styles.achievementIcon} ${a.type === "certification" ? styles.certification : ""}`}>
                  {a.type === "certification" ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="6" /><path d="M9 14l-1.5 7L12 19l4.5 2L15 14" /></svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
                  )}
                </div>
                <div>
                  <div className={styles.achievementTitle}>{a.title}</div>
                  <div className={styles.achievementMeta}>
                    {a.issuer ? `${a.issuer} · ` : ""}
                    {a.date ? new Date(a.date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------- //
// US-095: Internal opportunities
// ---------------------------------------------------------------------- //
function OpportunitiesTab() {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [applyingId, setApplyingId] = useState("");

  const load = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    browseOpportunities(token, { q: q || undefined, type: type || undefined, status: "open" })
      .then((data) => setItems(data.opportunities || []))
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not load opportunities.")))
      .finally(() => setLoading(false));
  }, [q, type]);

  useEffect(() => {
    const timeout = setTimeout(load, 250);
    return () => clearTimeout(timeout);
  }, [load]);

  async function handleApply(opp) {
    const token = localStorage.getItem("access_token");
    setApplyingId(opp.id);
    try {
      const res = await applyToOpportunity(token, opp.id);
      toast.success(res.eligible ? "Applied! You meet the eligibility criteria." : "Applied — note: this role's core requirements don't fully match your current profile yet.");
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not apply to this opportunity."));
    } finally {
      setApplyingId("");
    }
  }

  return (
    <div className={dashStyles.section}>
      <div className={dashStyles.sectionHead}>
        <div className={dashStyles.sectionHeadLeft}>
          <span className={`${dashStyles.bar} ${dashStyles.orange}`} />
          <div>
            <div className={dashStyles.sectionTitle}>Internal opportunities</div>
            <p className={dashStyles.sectionDesc}>Projects, cross-functional work, temporary assignments, and open positions within the organization.</p>
          </div>
        </div>
      </div>
      <div className={dashStyles.sectionBody}>
        <div className={styles.filterRow}>
          <input
            className={styles.smallBtn}
            style={{ minWidth: 220, cursor: "text", textAlign: "left", fontWeight: 500 }}
            placeholder="Search opportunities…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {[
            { key: "", label: "All types" },
            { key: "internal_project", label: "Projects" },
            { key: "cross_functional", label: "Cross-functional" },
            { key: "temporary_assignment", label: "Temporary" },
            { key: "open_position", label: "Open positions" },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              className={`${styles.filterChip} ${type === t.key ? styles.filterChipActive : ""}`}
              onClick={() => setType(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading && <p className={styles.inlineNote}>Loading…</p>}
        {!loading && items.length === 0 && (
          <div className={dashStyles.emptyState}>
            <div className={dashStyles.emptyTitle}>No open opportunities right now</div>
            <div className={dashStyles.emptySub}>Check back later, or ask your recruiter about upcoming openings.</div>
          </div>
        )}
        <div className={styles.oppGrid}>
          {items.map((opp) => (
            <div key={opp.id} className={styles.oppCard}>
              <span className={styles.oppType}>{opp.type?.replace(/_/g, " ")}</span>
              <div className={styles.oppTitle}>{opp.title}</div>
              <div className={styles.oppMeta}>
                {opp.department}
                {opp.location ? ` · ${opp.location}` : ""}
                {opp.commitment ? ` · ${opp.commitment}` : ""}
              </div>
              <p className={styles.oppDesc}>{opp.description}</p>
              {opp.required_skills?.length > 0 && (
                <div className={styles.oppSkills}>
                  {opp.required_skills.map((s, i) => (
                    <span key={`${s}-${i}`} className={styles.oppSkillTag}>{s}</span>
                  ))}
                </div>
              )}
              <div className={styles.oppFooter}>
                {opp.already_applied ? (
                  <span className={styles.oppApplied}>✓ Applied</span>
                ) : (
                  <button
                    type="button"
                    className={styles.smallBtnPrimary}
                    disabled={applyingId === opp.id}
                    onClick={() => handleApply(opp)}
                  >
                    {applyingId === opp.id ? "Applying…" : "Apply"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

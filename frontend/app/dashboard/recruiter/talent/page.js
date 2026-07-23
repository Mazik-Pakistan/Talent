"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";

import RecruiterShell from "@/components/recruiter/RecruiterShell";
import shellStyles from "@/components/recruiter/recruiter-shell.module.css";
import styles from "./talent.module.css";
import { getApiErrorMessage } from "@/services/authService";
import { getOrgTaxonomy } from "@/services/learningService";
import { downloadCsv } from "@/utils/downloadCsv";
import {
  browseOpportunities,
  createOpportunity,
  getOpportunityApplicants,
  getTalentMetrics,
  searchTalent,
  updateOpportunity,
} from "@/services/talentService";

const TABS = [
  { key: "metrics", label: "Talent Metrics" },
  { key: "search", label: "Talent Search" },
  { key: "opportunities", label: "Internal Opportunities" },
];

export default function RecruiterTalentPage() {
  const [tab, setTab] = useState("metrics");

  return (
    <RecruiterShell activeKey="talent" title="Talent Management" subtitle="Organization-wide talent metrics, search, and internal mobility">
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

      {tab === "metrics" && <MetricsTab />}
      {tab === "search" && <SearchTab />}
      {tab === "opportunities" && <OpportunitiesMgmtTab />}
    </RecruiterShell>
  );
}

// ---------------------------------------------------------------------- //
// US-102: Recruiter talent metrics dashboard
// ---------------------------------------------------------------------- //
function MetricsTab() {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [department, setDepartment] = useState("");
  const [taxonomy, setTaxonomy] = useState({ departments: [] });
  const router = useRouter();

  const load = useCallback((force = false) => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    getTalentMetrics(token, department || undefined, { force })
      .then(setMetrics)
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not load talent metrics.")))
      .finally(() => setLoading(false));
  }, [department]);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    getOrgTaxonomy(token).then(setTaxonomy).catch(() => {});
  }, []);

  useEffect(() => { load(false); }, [load]);

  function handleExport() {
    if (!metrics) return;
    downloadCsv(
      `talent-skill-distribution${department ? `-${department}` : ""}.csv`,
      ["category", "count"],
      (metrics.skill_distribution || []).map((s) => ({ category: s.category, count: s.count }))
    );
    downloadCsv(
      `talent-department-analysis${department ? `-${department}` : ""}.csv`,
      ["department", "headcount", "skills_tracked"],
      (metrics.department_skill_analysis || []).map((d) => ({
        department: d.department,
        headcount: d.headcount,
        skills_tracked: d.skills_tracked,
      }))
    );
    downloadCsv(
      `talent-high-potential${department ? `-${department}` : ""}.csv`,
      ["employee_id", "full_name", "job_title", "department", "skill_count", "verified_certifications"],
      (metrics.high_potential_employees || []).map((e) => ({
        employee_id: e.employee_id,
        full_name: e.full_name,
        job_title: e.job_title,
        department: e.department,
        skill_count: e.skill_count,
        verified_certifications: e.verified_certifications,
      }))
    );
    toast.success("Talent metrics exported.");
  }

  if (loading) return <p className={styles.inlineNote}>Loading talent metrics…</p>;
  if (!metrics) return null;

  const maxSkillCount = Math.max(1, ...(metrics.skill_distribution.length ? metrics.skill_distribution.map((s) => s.count) : [1]));

  return (
    <>
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <select className={styles.filterSelect} value={department} onChange={(e) => setDepartment(e.target.value)}>
          <option value="">All departments</option>
          {(taxonomy.departments || []).map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <button type="button" className={styles.smallBtn} onClick={() => load(true)}>Refresh</button>
        <button type="button" className={styles.smallBtn} onClick={handleExport}>Export CSV</button>
      </div>

      <div className={styles.metricGrid}>
        <div className={styles.metricCard}>
          <div className={styles.metricValue}>{metrics.headcount}</div>
          <div className={styles.metricLabel}>Headcount</div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricValue}>{metrics.certification_stats.certification_rate}%</div>
          <div className={styles.metricLabel}>Certification rate</div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricValue}>{metrics.learning_completion_rate}%</div>
          <div className={styles.metricLabel}>Learning completion</div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricValue}>{metrics.promotion_readiness_count}</div>
          <div className={styles.metricLabel}>Promotion-ready</div>
        </div>
      </div>

      <div className={shellStyles.section}>
        <div className={shellStyles.sectionHead}>
          <div className={shellStyles.sectionHeadLeft}>
            <span className={`${shellStyles.bar} ${shellStyles.cyan}`} />
            <div>
              <div className={shellStyles.sectionTitle}>Skill distribution</div>
              <p className={shellStyles.sectionDesc}>Tracked skills across your employees, by category</p>
            </div>
          </div>
        </div>
        <div className={shellStyles.sectionBody}>
          {metrics.skill_distribution.length === 0 && <p className={shellStyles.emptySub}>No skills tracked yet.</p>}
          <div className={styles.barList}>
            {metrics.skill_distribution.map((s) => (
              <div key={s.category} className={styles.barRow}>
                <span className={styles.barLabel}>{s.category}</span>
                <div className={styles.barTrack}>
                  <div className={styles.barFill} style={{ width: `${(100 * s.count) / maxSkillCount}%` }} />
                </div>
                <span className={styles.barValue}>{s.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={shellStyles.section}>
        <div className={shellStyles.sectionHead}>
          <div className={shellStyles.sectionHeadLeft}>
            <span className={`${shellStyles.bar} ${shellStyles.green}`} />
            <div>
              <div className={shellStyles.sectionTitle}>High potential employees</div>
              <p className={shellStyles.sectionDesc}>5+ tracked skills and at least one verified certification</p>
            </div>
          </div>
        </div>
        <div className={shellStyles.sectionBody}>
          {metrics.high_potential_employees.length === 0 && <p className={shellStyles.emptySub}>No matches yet.</p>}
          {metrics.high_potential_employees.map((e) => (
            <div key={e.employee_id} className={styles.employeeMiniRow}>
              <div>
                <div className={styles.employeeMiniName}>{e.full_name}</div>
                <div className={styles.employeeMiniMeta}>{e.job_title} · {e.department}</div>
              </div>
              <button type="button" className={styles.smallBtn} onClick={() => router.push(`/dashboard/recruiter/employees/${e.employee_id}`)}>
                {e.skill_count} skills · {e.verified_certifications} certs
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className={shellStyles.section}>
        <div className={shellStyles.sectionHead}>
          <div className={shellStyles.sectionHeadLeft}>
            <span className={`${shellStyles.bar} ${shellStyles.orange}`} />
            <div>
              <div className={shellStyles.sectionTitle}>Department skill analysis</div>
              <p className={shellStyles.sectionDesc}>Headcount and tracked skills per department</p>
            </div>
          </div>
        </div>
        <div className={shellStyles.sectionBody}>
          {metrics.department_skill_analysis.map((d) => (
            <div key={d.department} className={styles.employeeMiniRow}>
              <div className={styles.employeeMiniName}>{d.department}</div>
              <div className={styles.employeeMiniMeta}>{d.headcount} employees · {d.skills_tracked} skills tracked</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------- //
// US-100: Talent search
// ---------------------------------------------------------------------- //
function SearchTab() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [department, setDepartment] = useState("");
  const [skillsInput, setSkillsInput] = useState("");
  const [certsInput, setCertsInput] = useState("");
  const [minProgress, setMinProgress] = useState("");
  const [minExperience, setMinExperience] = useState("");
  const [minCompetency, setMinCompetency] = useState("");
  const [semantic, setSemantic] = useState(false);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);

  const runSearch = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    searchTalent(token, {
      q: q || null,
      department: department || null,
      skills: skillsInput ? skillsInput.split(",").map((s) => s.trim()).filter(Boolean) : [],
      certifications: certsInput ? certsInput.split(",").map((s) => s.trim()).filter(Boolean) : [],
      min_learning_progress: minProgress ? Number(minProgress) : null,
      min_experience_years: minExperience ? Number(minExperience) : null,
      min_competency_score: minCompetency ? Number(minCompetency) : null,
      semantic,
      page: 1,
      page_size: 30,
    })
      .then(setResults)
      .catch((err) => toast.error(getApiErrorMessage(err, "Search failed.")))
      .finally(() => setLoading(false));
  }, [q, department, skillsInput, certsInput, minProgress, minExperience, minCompetency, semantic]);

  useEffect(() => { runSearch(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={shellStyles.section}>
      <div className={shellStyles.sectionHead}>
        <div className={shellStyles.sectionHeadLeft}>
          <span className={`${shellStyles.bar} ${shellStyles.navy}`} />
          <div>
            <div className={shellStyles.sectionTitle}>Search employees</div>
            <p className={shellStyles.sectionDesc}>By skills, certifications, department, experience, competency, and learning progress</p>
          </div>
        </div>
      </div>
      <div className={shellStyles.sectionBody}>
        <div className={styles.filterBar}>
          <input
            className={styles.searchInput}
            placeholder="Search by name, title, skill, or certification…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
          />
          <input
            className={styles.filterSelect}
            style={{ width: 140 }}
            placeholder="Department"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          />
          <input
            className={styles.filterSelect}
            style={{ width: 180 }}
            placeholder="Skills (comma-separated)"
            value={skillsInput}
            onChange={(e) => setSkillsInput(e.target.value)}
          />
          <input
            className={styles.filterSelect}
            style={{ width: 180 }}
            placeholder="Certs (comma-separated)"
            value={certsInput}
            onChange={(e) => setCertsInput(e.target.value)}
          />
          <input
            className={styles.filterSelect}
            style={{ width: 110 }}
            type="number"
            min="0"
            max="100"
            placeholder="Min progress %"
            value={minProgress}
            onChange={(e) => setMinProgress(e.target.value)}
          />
          <input
            className={styles.filterSelect}
            style={{ width: 100 }}
            type="number"
            min="0"
            placeholder="Min years"
            value={minExperience}
            onChange={(e) => setMinExperience(e.target.value)}
          />
          <input
            className={styles.filterSelect}
            style={{ width: 120 }}
            type="number"
            min="1"
            max="5"
            step="0.1"
            placeholder="Min competency"
            value={minCompetency}
            onChange={(e) => setMinCompetency(e.target.value)}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, whiteSpace: "nowrap" }}>
            <input type="checkbox" checked={semantic} onChange={(e) => setSemantic(e.target.checked)} />
            Semantic
          </label>
          <button type="button" className={styles.smallBtnPrimary} onClick={runSearch} disabled={loading}>
            {loading ? "Searching…" : "Search"}
          </button>
        </div>

        {loading && <p className={styles.inlineNote}>Searching…</p>}
        {!loading && results && results.employees.length === 0 && (
          <div className={shellStyles.emptySub}>No employees match these filters.</div>
        )}
        {!loading && results && results.employees.length > 0 && (
          <div className={styles.resultGrid}>
            {results.employees.map((e) => (
              <div key={e.employee_id} className={styles.resultCard} style={{ cursor: "pointer" }} onClick={() => router.push(`/dashboard/recruiter/employees/${e.employee_id}`)}>
                <div className={styles.resultName}>{e.full_name}</div>
                <div className={styles.resultMeta}>{e.job_title} · {e.department}</div>
                <div className={styles.resultTags}>
                  {(e.skills || []).slice(0, 6).map((s) => <span key={s} className={styles.resultTag}>{s}</span>)}
                </div>
                <div className={styles.resultStats}>
                  Learning progress: {e.learning_progress}%
                  {e.years_experience != null ? ` · ${e.years_experience} yrs exp.` : ""}
                  {e.competency_score != null ? ` · Competency ${e.competency_score}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
        {results && (
          <p className={styles.inlineNote} style={{ marginTop: 12 }}>
            {results.total} matching employees ({results.search_mode || "keyword"} search)
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------- //
// US-095: Internal opportunities — recruiter management
// ---------------------------------------------------------------------- //
const OPP_TYPES = [
  { key: "internal_project", label: "Internal project" },
  { key: "cross_functional", label: "Cross-functional" },
  { key: "temporary_assignment", label: "Temporary assignment" },
  { key: "open_position", label: "Open position" },
];

function OpportunitiesMgmtTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applicants, setApplicants] = useState({});
  const [form, setForm] = useState({
    title: "",
    type: "internal_project",
    department: "",
    description: "",
    required_skills: "",
    location: "",
    commitment: "",
  });

  const load = useCallback((force = false) => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    browseOpportunities(token, { status: "all", page_size: 60 }, { force })
      .then((data) => setItems(data.opportunities || []))
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not load opportunities.")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(false); }, [load]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.department.trim() || !form.description.trim()) return;
    const token = localStorage.getItem("access_token");
    setSaving(true);
    try {
      await createOpportunity(token, {
        title: form.title.trim(),
        type: form.type,
        department: form.department.trim(),
        description: form.description.trim(),
        required_skills: form.required_skills ? form.required_skills.split(",").map((s) => s.trim()).filter(Boolean) : [],
        location: form.location.trim() || null,
        commitment: form.commitment.trim() || null,
      });
      setForm({ title: "", type: "internal_project", department: "", description: "", required_skills: "", location: "", commitment: "" });
      toast.success("Opportunity posted.");
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not post opportunity."));
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(opp) {
    const token = localStorage.getItem("access_token");
    try {
      await updateOpportunity(token, opp.id, { status: opp.status === "open" ? "closed" : "open" });
      load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not update opportunity."));
    }
  }

  async function toggleApplicants(opp) {
    if (applicants[opp.id]) {
      setApplicants((a) => ({ ...a, [opp.id]: null }));
      return;
    }
    const token = localStorage.getItem("access_token");
    try {
      const data = await getOpportunityApplicants(token, opp.id);
      setApplicants((a) => ({ ...a, [opp.id]: data.applicants }));
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not load applicants."));
    }
  }

  return (
    <div className={shellStyles.section}>
      <div className={shellStyles.sectionHead}>
        <div className={shellStyles.sectionHeadLeft}>
          <span className={`${shellStyles.bar} ${shellStyles.orange}`} />
          <div>
            <div className={shellStyles.sectionTitle}>Internal opportunities</div>
            <p className={shellStyles.sectionDesc}>Post projects, cross-functional work, temporary assignments, and open positions</p>
          </div>
        </div>
        <button type="button" className={styles.smallBtn} onClick={() => load(true)}>Refresh</button>
      </div>
      <div className={shellStyles.sectionBody}>
        <form className={styles.oppForm} onSubmit={handleCreate}>
          <label className={styles.wide}>
            Title
            <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Internal AI Tooling Squad" required />
          </label>
          <label>
            Type
            <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
              {OPP_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </label>
          <label>
            Department
            <input value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} placeholder="Engineering" required />
          </label>
          <label className={styles.wide}>
            Description
            <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="What this opportunity involves…" required />
          </label>
          <label>
            Required skills (comma-separated)
            <input value={form.required_skills} onChange={(e) => setForm((f) => ({ ...f, required_skills: e.target.value }))} placeholder="React, Docker" />
          </label>
          <label>
            Location
            <input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder="Remote / Karachi" />
          </label>
          <label className={styles.wide}>
            Commitment
            <input value={form.commitment} onChange={(e) => setForm((f) => ({ ...f, commitment: e.target.value }))} placeholder="~5 hrs/week for 6 weeks" />
          </label>
          <div className={styles.wide}>
            <button type="submit" className={styles.smallBtnPrimary} disabled={saving}>{saving ? "Posting…" : "Post opportunity"}</button>
          </div>
        </form>

        {loading && <p className={styles.inlineNote}>Loading…</p>}
        {!loading && items.length === 0 && <p className={shellStyles.emptySub}>No opportunities posted yet.</p>}
        {items.map((opp) => (
          <div key={opp.id} className={styles.oppMgmtCard}>
            <div className={styles.oppMgmtHead}>
              <div>
                <div className={styles.oppMgmtTitle}>{opp.title}</div>
                <div className={styles.inlineNote}>{opp.department} · {OPP_TYPES.find((t) => t.key === opp.type)?.label || opp.type}</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className={`${styles.oppStatus} ${styles[opp.status] || ""}`}>{opp.status}</span>
                <button type="button" className={styles.smallBtn} onClick={() => toggleStatus(opp)}>
                  {opp.status === "open" ? "Close" : "Reopen"}
                </button>
                <button type="button" className={styles.smallBtn} onClick={() => toggleApplicants(opp)}>
                  {applicants[opp.id] ? "Hide applicants" : "View applicants"}
                </button>
              </div>
            </div>
            {applicants[opp.id] && (
              <div style={{ marginTop: 10 }}>
                {applicants[opp.id].length === 0 && <p className={styles.inlineNote}>No applicants yet.</p>}
                {applicants[opp.id].map((a) => (
                  <div key={a.employee_id} className={styles.employeeMiniRow}>
                    <div className={styles.employeeMiniName}>{a.employee_name}</div>
                    <div className={styles.employeeMiniMeta}>
                      {a.eligible ? "Eligible" : "Partial match"} · Applied {new Date(a.applied_at).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

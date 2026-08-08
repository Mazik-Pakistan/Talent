"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import shellStyles from "@/components/recruiter/recruiter-shell.module.css";
import styles from "./talent.module.css";
import ListPager from "./ListPager";
import { getApiErrorMessage } from "@/services/authService";
import {
  browseOpportunities,
  createOpportunity,
  getOpportunityApplicants,
  updateOpportunity,
} from "@/services/talentService";
import { Lightbulb, Search as SearchIcon } from "lucide-react";

const OPP_TYPES = [
  { key: "internal_project", label: "Internal project" },
  { key: "cross_functional", label: "Cross-functional" },
  { key: "temporary_assignment", label: "Temporary assignment" },
  { key: "open_position", label: "Open position" },
];

const PAGE_SIZE = 25;

export default function InternalOpportunities({ departmentNames = [], onNavigate }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applicants, setApplicants] = useState({});
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [department, setDepartment] = useState("");
  const [form, setForm] = useState({
    title: "",
    type: "internal_project",
    department: "",
    description: "",
    required_skills: "",
    location: "",
    commitment: "",
  });

  const load = useCallback((nextPage = 1, force = false) => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    browseOpportunities(
      token,
      {
        status,
        page: nextPage,
        page_size: PAGE_SIZE,
        q: q.trim() || undefined,
        department: department || undefined,
      },
      { force }
    )
      .then((data) => {
        setItems(data.opportunities || []);
        setTotal(data.total ?? (data.opportunities || []).length);
        setPages(Math.max(1, data.pages || 1));
        setPage(data.page || nextPage);
      })
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not load opportunities.")))
      .finally(() => setLoading(false));
  }, [status, q, department]);

  useEffect(() => {
    const t = setTimeout(() => load(1, false), 250);
    return () => clearTimeout(t);
  }, [load]);

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
      load(1, true);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not post opportunity."));
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(opp) {
    const token = localStorage.getItem("access_token");
    try {
      const nextStatus = opp.status === "open" ? "closed" : "open";
      await updateOpportunity(token, opp.id, { status: nextStatus });
      load(page, true);
      toast.success(nextStatus === "open" ? "Opportunity opened." : "Opportunity closed.");
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
            <p className={shellStyles.sectionDesc}>
              Post projects and openings — paginated for large catalogs
            </p>
          </div>
        </div>
        <button type="button" className={styles.smallBtn} onClick={() => load(page, true)}>Refresh</button>
      </div>
      <div className={shellStyles.sectionBody}>
        {departmentNames.length === 0 && (
          <p className={styles.inlineNote} style={{ marginBottom: 12 }}>
            No departments from Organization Setup yet —{" "}
            <button type="button" className={styles.textLink} onClick={() => onNavigate({ path: "/dashboard/recruiter/organization-config" })}>
              configure structure
            </button>{" "}
            before posting department-scoped opportunities.
          </p>
        )}
        <form data-partner-coach className={styles.oppForm} onSubmit={handleCreate}>
          <label className={styles.wide}>
            Title
            <input data-field-key="title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Internal AI Tooling Squad" required />
          </label>
          <label>
            Type
            <select data-field-key="opportunity_type" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
              {OPP_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </label>
          <label>
            Department
            <select data-field-key="department" value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} required>
              <option value="">Select department</option>
              {departmentNames.map((departmentName) => (
                <option key={departmentName} value={departmentName}>{departmentName}</option>
              ))}
            </select>
          </label>
          <label className={styles.wide}>
            Description
            <textarea data-field-key="description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="What this opportunity involves…" required />
          </label>
          <label>
            Required skills (comma-separated)
            <input data-field-key="required_skills" value={form.required_skills} onChange={(e) => setForm((f) => ({ ...f, required_skills: e.target.value }))} placeholder="React, Docker" />
          </label>
          <label>
            Location
            <input data-field-key="location" value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder="Remote / Karachi" />
          </label>
          <label className={styles.wide}>
            Commitment
            <input data-field-key="commitment" value={form.commitment} onChange={(e) => setForm((f) => ({ ...f, commitment: e.target.value }))} placeholder="~5 hrs/week for 6 weeks" />
          </label>
          <div className={styles.wide}>
            <button type="submit" className={styles.smallBtnPrimary} disabled={saving || departmentNames.length === 0}>
              {saving ? "Posting…" : "Post opportunity"}
            </button>
          </div>
        </form>

        <div className={styles.filterBar}>
          <input
            className={styles.searchInput}
            placeholder="Search opportunities…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load(1, true)}
          />
          <select
            className={`${styles.filterSelect} ${styles.w120}`}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
          <select
            className={`${styles.filterSelect} ${styles.w140}`}
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          >
            <option value="">All departments</option>
            {departmentNames.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <button type="button" className={styles.smallBtnPrimary} onClick={() => load(1, true)} disabled={loading}>
            <SearchIcon size={14} aria-hidden="true" /> {loading ? "Searching…" : "Search"}
          </button>
        </div>

        {items.length === 0 && (
          <div className={styles.emptyState}>
            <div className={styles.emptyStateIcon}><Lightbulb aria-hidden="true" /></div>
            <div className={styles.emptyStateTitle}>No opportunities found</div>
            <p className={styles.emptyStateHint}>
              {q || department || status !== "all"
                ? "Try broadening search or filters."
                : "Use the form above to post an internal project or open position."}
            </p>
          </div>
        )}
        {!loading && items.length > 0 && (
          <div className={styles.scrollList}>
            {items.map((opp) => (
              <div key={opp.id} className={styles.oppMgmtCard}>
                <div className={styles.oppMgmtHead}>
                  <div>
                    <div className={styles.oppMgmtTitle}>{opp.title}</div>
                    <div className={styles.inlineNote}>{opp.department} · {OPP_TYPES.find((t) => t.key === opp.type)?.label || opp.type}</div>
                  </div>
                  <div className={styles.oppMgmtActions}>
                    <span className={`${styles.oppStatus} ${opp.status === "open" ? styles.oppStatusOpen : styles.oppStatusClosed}`}>
                      {opp.status}
                    </span>
                    <button type="button" className={styles.smallBtn} onClick={() => toggleStatus(opp)}>
                      {opp.status === "open" ? "Close" : "Reopen"}
                    </button>
                    <button type="button" className={styles.smallBtn} onClick={() => toggleApplicants(opp)}>
                      {applicants[opp.id] ? "Hide applicants" : "View applicants"}
                    </button>
                  </div>
                </div>
                {applicants[opp.id] && (
                  <div className={styles.oppApplicants}>
                    {applicants[opp.id].length === 0 && <p className={styles.inlineNote}>No applicants yet.</p>}
                    {applicants[opp.id].map((a) => (
                      <button
                        key={a.employee_id}
                        type="button"
                        className={styles.listRowBtn}
                        onClick={() => onNavigate({
                          view: "profile",
                          employee: a.employee_id,
                          department: opp.department || null,
                        })}
                      >
                        <span>
                          <span className={styles.listRowTitle}>{a.employee_name}</span>
                          <span className={styles.listRowMeta}>
                            {a.eligible ? "Eligible" : "Partial match"} · Applied {new Date(a.applied_at).toLocaleDateString()}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <ListPager
          page={page}
          pages={pages}
          total={total}
          pageSize={PAGE_SIZE}
          loading={loading}
          onPageChange={(p) => load(p, true)}
          label="opportunities"
        />
      </div>
    </div>
  );
}

"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import s from "./RecruitersPanel.module.css";

const CAPABILITY_LABELS = {
  overview: "Overview dashboard",
  candidates: "Candidates",
  invite: "Invite & offer",
  employees: "Employees",
  talent: "Talent analytics",
  learning: "Learning",
  assistant: "AI assistant",
  messages: "Messages",
  announcements: "Announcements",
  it: "IT & support",
  reporting: "Activity & reporting",
  profile: "Profile",
};
const CAPABILITY_ICONS = {
  overview: "📊",
  candidates: "👥",
  invite: "✉️",
  employees: "💼",
  talent: "⭐",
  learning: "📚",
  assistant: "🤖",
  messages: "💬",
  announcements: "📢",
  it: "🖥️",
  reporting: "📈",
  profile: "👤",
};
const CAPABILITY_KEYS = Object.keys(CAPABILITY_LABELS);

const svgProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

const ICONS = {
  users: (
    <svg {...svgProps}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  active: (
    <svg {...svgProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </svg>
  ),
  clock: (
    <svg {...svgProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  ),
  card: (
    <svg {...svgProps}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <circle cx="8" cy="11" r="2" />
      <path d="M6 16c0-1.5 1-2.5 2-2.5s2 1 2 2.5" />
      <path d="M14 10h4M14 13h4" />
    </svg>
  ),
  building: (
    <svg {...svgProps}>
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01" />
    </svg>
  ),
  search: (
    <svg {...svgProps}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  ),
  mail: (
    <svg {...svgProps}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M22 7l-10 6L2 7" />
    </svg>
  ),
  refresh: (
    <svg {...svgProps}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  ),
  edit: (
    <svg {...svgProps}>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  ),
  trash: (
    <svg {...svgProps}>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  ),
  chevron: (
    <svg {...svgProps}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  ),
};

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function initials(name) {
  return (name || "?").trim().charAt(0).toUpperCase() || "?";
}

function templateLabel(key) {
  return key
    .split("_")
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function countCapabilities(recruiter) {
  return CAPABILITY_KEYS.filter((key) => recruiter.capabilities?.[key] ?? true).length;
}

export default function RecruitersPanel({
  recruiters = [],
  recruitersLoading = false,
  organizations = [],
  searchTerm = "",
  setSearchTerm = () => {},
  statusFilter = "",
  setStatusFilter = () => {},
  orgFilter = "",
  setOrgFilter = () => {},
  bulkSelected = [],
  toggleBulkSelect = () => {},
  toggleBulkSelectAll = () => {},
  bulkTemplate = "",
  setBulkTemplate = () => {},
  handleBulkApply = () => {},
  bulkBusy = false,
  bulkMessage = "",
  templates = {},
  startEdit = () => {},
  editingId = null,
  editForm = {},
  setEditForm = () => {},
  saveEdit = () => {},
  cancelEdit = () => {},
  editSaving = false,
  toggleCapability = () => {},
  quickDeleteRecruiter = () => {},
  onTabChange = () => {},
}) {
  const [expandedId, setExpandedId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const headerCheckRef = useRef(null);

  const filtered = useMemo(() => {
    return recruiters.filter((r) => {
      const q = searchTerm.toLowerCase();
      const matchesQ =
        !searchTerm ||
        (r.full_name || "").toLowerCase().includes(q) ||
        (r.email || "").toLowerCase().includes(q) ||
        (r.department || "").toLowerCase().includes(q) ||
        (r.job_title || "").toLowerCase().includes(q);
      const matchesStatus = !statusFilter || r.status === statusFilter;
      const matchesOrg = !orgFilter || r.organization_id === orgFilter;
      return matchesQ && matchesStatus && matchesOrg;
    });
  }, [recruiters, searchTerm, statusFilter, orgFilter]);

  const allSelected = filtered.length > 0 && filtered.every((r) => bulkSelected.includes(r.id));
  const someSelected = !allSelected && filtered.some((r) => bulkSelected.includes(r.id));

  useEffect(() => {
    if (headerCheckRef.current) {
      headerCheckRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  const toneClass = {
    blue: s.kpiBlue,
    green: s.kpiGreen,
    orange: s.kpiOrange,
    purple: s.kpiPurple,
    red: s.kpiRed,
  };

  const kpis = [
    { key: "total", label: "Total Recruiters", value: recruiters.length, tone: "blue", icon: ICONS.users },
    {
      key: "active",
      label: "Active",
      value: recruiters.filter((r) => r.is_active === true).length,
      tone: "green",
      icon: ICONS.active,
    },
    {
      key: "pending",
      label: "Pending",
      value: recruiters.filter((r) => r.status === "pending").length,
      tone: "orange",
      icon: ICONS.clock,
    },
    {
      key: "dual",
      label: "Dual Role",
      value: recruiters.filter((r) => r.has_employee_profile === true).length,
      tone: "purple",
      icon: ICONS.card,
    },
    {
      key: "orgs",
      label: "Organizations Covered",
      value: new Set(recruiters.map((r) => r.organization_id).filter(Boolean)).size,
      tone: "red",
      icon: ICONS.building,
    },
  ];

  function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    window.setTimeout(() => window.location.reload(), 350);
  }

  function handleRowClick(id) {
    setExpandedId((current) => (current === id ? null : id));
  }

  function clearFilters() {
    setSearchTerm("");
    setStatusFilter("");
    setOrgFilter("");
  }

  function clearSelection() {
    bulkSelected.forEach((id) => toggleBulkSelect(id));
  }

  function orgName(recruiter) {
    const org = organizations.find((o) => o.id === recruiter.organization_id);
    return org ? org.name : "—";
  }

  function orgEmail(recruiter) {
    const org = organizations.find((o) => o.id === recruiter.organization_id);
    return org && org.contact_email ? org.contact_email : "";
  }

  function renderStatusBadge(status) {
    const tone =
      status === "active" ? s.statusActive : status === "pending" ? s.statusPending : s.statusInactive;
    const label = status === "active" ? "Active" : status === "pending" ? "Pending" : "Inactive";
    return <span className={`${s.statusBadge} ${tone}`}>{label}</span>;
  }

  function renderExpanded(recruiter) {
    const isEditing = editingId === recruiter.id;
    const hasOrg = Boolean(recruiter.organization_id);
    const orgModules = hasOrg
      ? organizations.find((o) => o.id === recruiter.organization_id)?.modules || {}
      : {};
    const visibleCaps = CAPABILITY_KEYS.filter((key) => !hasOrg || orgModules[key] !== false);

    return (
      <div>
        <div className={s.expandedHeader}>
          <span className={s.avatar}>{initials(recruiter.full_name)}</span>
          <div className={s.expandedSummary}>
            <div className={s.expandedName}>{recruiter.full_name || "Unnamed recruiter"}</div>
            <div className={s.expandedMeta}>{recruiter.email || "No email on file"}</div>
          </div>
          <div className={s.expandedMetaGroup}>
            <span className={s.expandedMetaLabel}>Status</span>
            {renderStatusBadge(recruiter.status)}
          </div>
          <div className={s.expandedMetaGroup}>
            <span className={s.expandedMetaLabel}>Organization</span>
            <span className={s.expandedMeta}>{orgName(recruiter)}</span>
          </div>
          <div className={s.expandedMetaGroup}>
            <span className={s.expandedMetaLabel}>Invited</span>
            <span className={s.expandedMeta}>{formatDate(recruiter.created_at)}</span>
          </div>
          <div className={s.expandedMetaGroup}>
            <span className={s.expandedMetaLabel}>Expires</span>
            <span className={s.expandedMeta}>{formatDate(recruiter.expires_at)}</span>
          </div>
        </div>

        <div className={s.expandedActions}>
          {isEditing ? (
            <div className={s.editActions}>
              <button
                type="button"
                className={s.btnPrimary}
                disabled={editSaving}
                onClick={() => saveEdit(recruiter.id)}
              >
                {editSaving ? <span className={s.spinnerSmall} /> : null}
                {editSaving ? "Saving…" : "Save Changes"}
              </button>
              <button type="button" className={s.btnGhost} onClick={cancelEdit}>
                Cancel
              </button>
            </div>
          ) : (
            <>
              <button type="button" className={s.btnGhost} onClick={() => startEdit(recruiter)}>
                {ICONS.edit}
                Edit
              </button>
              <button
                type="button"
                className={s.btnDanger}
                onClick={() => quickDeleteRecruiter(recruiter.id, recruiter.full_name)}
              >
                {ICONS.trash}
                Delete
              </button>
            </>
          )}
        </div>

        {isEditing && (
          <div className={s.editGrid}>
            <label className={s.editField}>
              <span className={s.editLabel}>Job Title</span>
              <input
                type="text"
                className={s.editInput}
                value={editForm?.job_title || ""}
                onChange={(e) => setEditForm({ ...(editForm || {}), job_title: e.target.value })}
                aria-label="Job title"
              />
            </label>
            <label className={s.editField}>
              <span className={s.editLabel}>Department</span>
              <input
                type="text"
                className={s.editInput}
                value={editForm?.department || ""}
                onChange={(e) => setEditForm({ ...(editForm || {}), department: e.target.value })}
                aria-label="Department"
              />
            </label>
            <label className={s.editField}>
              <span className={s.editLabel}>Office Location</span>
              <input
                type="text"
                className={s.editInput}
                value={editForm?.office_location || ""}
                onChange={(e) => setEditForm({ ...(editForm || {}), office_location: e.target.value })}
                aria-label="Office location"
              />
            </label>
            <label className={s.editField}>
              <span className={s.editLabel}>Status</span>
              {recruiter.recruiter_id ? (
                <select
                  className={s.editInput}
                  value={editForm?.status || "active"}
                  onChange={(e) => setEditForm({ ...(editForm || {}), status: e.target.value })}
                  aria-label="Recruiter status"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              ) : (
                <select
                  className={s.editInput}
                  value="pending"
                  disabled
                  aria-label="Recruiter status"
                >
                  <option value="pending">Pending</option>
                </select>
              )}
            </label>
          </div>
        )}

        <div className={s.capsSection}>
          <h4 className={s.capsTitle}>Module Capabilities</h4>
          <div className={s.capsGrid}>
            {visibleCaps.map((key) => {
              const enabled = recruiter.capabilities?.[key] ?? true;
              return (
                <div key={key} className={s.capTile}>
                  <span className={s.capIcon}>{CAPABILITY_ICONS[key]}</span>
                  <span className={s.capLabel}>{CAPABILITY_LABELS[key]}</span>
                  <label className={s.capToggle}>
                    <input
                      type="checkbox"
                      className={s.capToggleInput}
                      checked={Boolean(enabled)}
                      onChange={() => toggleCapability(recruiter.id, key, enabled)}
                      aria-label={`Toggle ${CAPABILITY_LABELS[key]}`}
                    />
                    <span className={s.capToggleTrack}>
                      <span className={s.capToggleThumb} />
                    </span>
                  </label>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  function renderTable() {
    return (
      <div className={s.tableWrap}>
        <table className={s.orgTable}>
          <thead className={s.thead}>
            <tr>
              <th className={s.th} style={{ width: 48 }}>
                <input
                  ref={headerCheckRef}
                  type="checkbox"
                  className={s.checkbox}
                  checked={allSelected}
                  onChange={toggleBulkSelectAll}
                  aria-label="Select all recruiters"
                />
              </th>
              <th className={s.th}>Recruiter</th>
              <th className={s.th}>Role</th>
              <th className={s.th}>Status</th>
              <th className={s.th}>Organization</th>
              <th className={s.th}>Department</th>
              <th className={s.th}>Invited</th>
              <th className={s.th}>Access</th>
              <th className={`${s.th} ${s.actionsCell}`}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((recruiter) => {
              const expanded = expandedId === recruiter.id;
              const capCount = countCapabilities(recruiter);
              const capTotal = CAPABILITY_KEYS.length;
              const pct = Math.round((capCount / capTotal) * 100);
              return (
                <Fragment key={recruiter.id}>
                  <tr
                    className={`${s.tr} ${expanded ? s.trExpanded : ""}`}
                    onClick={() => handleRowClick(recruiter.id)}
                  >
                    <td className={s.td} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className={s.checkbox}
                        checked={bulkSelected.includes(recruiter.id)}
                        onChange={() => toggleBulkSelect(recruiter.id)}
                        aria-label={`Select ${recruiter.full_name || recruiter.email || recruiter.id}`}
                      />
                    </td>
                    <td className={s.td}>
                      <div className={s.recruiterCell}>
                        <span className={s.avatar}>{initials(recruiter.full_name)}</span>
                        <div className={s.recruiterCellText}>
                          <div className={s.recruiterName}>{recruiter.full_name || "Unnamed recruiter"}</div>
                          <div className={s.recruiterEmail}>{recruiter.email || "No email on file"}</div>
                        </div>
                      </div>
                    </td>
                    <td className={s.td}>
                      <span className={s.roleText}>{recruiter.employee_id || "—"}</span>
                      {recruiter.has_employee_profile && <span className={s.dualBadge}>Dual Role</span>}
                    </td>
                    <td className={s.td}>{renderStatusBadge(recruiter.status)}</td>
                    <td className={s.td}>
                      <div className={s.orgCell}>
                        <span className={s.orgName}>{orgName(recruiter)}</span>
                        {orgEmail(recruiter) && <span className={s.orgEmail}>{orgEmail(recruiter)}</span>}
                      </div>
                    </td>
                    <td className={s.td}>
                      <span className={s.deptCell}>{recruiter.department || "—"}</span>
                    </td>
                    <td className={s.td}>
                      <span className={s.dateCell}>{formatDate(recruiter.created_at)}</span>
                    </td>
                    <td className={s.td}>
                      <div className={s.accessCell}>
                        <span className={s.accessCount}>
                          {capCount}/{capTotal}
                        </span>
                        <div className={s.progressTrack}>
                          <div className={s.progressBar} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className={`${s.td} ${s.actionsCell}`}>
                      <div className={s.actions}>
                        <button
                          type="button"
                          className={s.btnIcon}
                          title="Edit recruiter"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedId(recruiter.id);
                            startEdit(recruiter);
                          }}
                        >
                          {ICONS.edit}
                        </button>
                        <button
                          type="button"
                          className={`${s.btnIcon} ${s.btnIconDanger}`}
                          title="Delete recruiter"
                          onClick={(e) => {
                            e.stopPropagation();
                            quickDeleteRecruiter(recruiter.id, recruiter.full_name);
                          }}
                        >
                          {ICONS.trash}
                        </button>
                        <span className={`${s.chevron} ${expanded ? s.chevronOpen : ""}`}>{ICONS.chevron}</span>
                      </div>
                    </td>
                  </tr>
                  {expanded && (
                    <tr className={s.expandedRow}>
                      <td colSpan={10} className={s.expandedCell}>
                        {renderExpanded(recruiter)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  function renderBulkBar() {
    return (
      <div className={s.bulkBar}>
        <span className={s.bulkCount}>
          {bulkSelected.length} selected
        </span>
        <div className={s.bulkActions}>
          {bulkMessage && <span className={s.bulkMsg}>{bulkMessage}</span>}
          <form
            className={s.bulkForm}
            onSubmit={(e) => {
              e.preventDefault();
              handleBulkApply();
            }}
          >
            <select
              className={s.bulkSelect}
              value={bulkTemplate}
              onChange={(e) => setBulkTemplate(e.target.value)}
              aria-label="Role template for bulk apply"
            >
              <option value="">Apply role template…</option>
              {Object.keys(templates || {}).map((key) => (
                <option key={key} value={key}>
                  {templateLabel(key)}
                </option>
              ))}
            </select>
            <button type="submit" className={s.btnPrimary} disabled={bulkBusy || !bulkTemplate}>
              {bulkBusy ? <span className={s.spinnerSmall} /> : null}
              {bulkBusy ? "Applying…" : "Apply Template"}
            </button>
          </form>
          <button type="button" className={s.bulkClear} onClick={clearSelection}>
            Clear selection
          </button>
        </div>
      </div>
    );
  }

  function renderSkeleton() {
    return (
      <>
        <div className={s.kpiRow}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={s.kpiCard}>
              <div className={`${s.skeleton} ${s.skeletonPulse}`} style={{ height: 56, width: "100%" }} />
            </div>
          ))}
        </div>
        <div className={s.tableWrap}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className={s.skeletonRow}>
              <div className={`${s.skeleton} ${s.skeletonPulse}`} style={{ width: "34%", height: 16 }} />
              <div className={`${s.skeleton} ${s.skeletonPulse}`} style={{ width: "20%", height: 16 }} />
              <div className={`${s.skeleton} ${s.skeletonPulse}`} style={{ width: "16%", height: 16 }} />
              <div className={`${s.skeleton} ${s.skeletonPulse}`} style={{ width: "22%", height: 16 }} />
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <div className={s.page}>
      <header className={s.pageHeader}>
        <div>
          <h1 className={s.pageTitle}>Recruiters</h1>
          <p className={s.pageSubtitle}>
            Manage recruiter accounts, invitations, permissions, module access, and activity across all
            organizations.
          </p>
        </div>
        <div className={s.headerActions}>
          <button type="button" className={s.btnPrimary} onClick={() => onTabChange("invite")}>
            {ICONS.mail}
            Invite Recruiter
          </button>
          <button type="button" className={s.btnGhost} onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? <span className={s.spinnerSmall} /> : ICONS.refresh}
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {recruitersLoading ? (
        renderSkeleton()
      ) : (
        <>
          <div className={s.kpiRow}>
            {kpis.map((kpi) => (
              <div key={kpi.key} className={`${s.kpiCard} ${toneClass[kpi.tone]}`}>
                <div className={s.kpiIcon}>{kpi.icon}</div>
                <div>
                  <div className={s.kpiValue}>{kpi.value}</div>
                  <div className={s.kpiLabel}>{kpi.label}</div>
                </div>
              </div>
            ))}
          </div>

          <div className={s.toolbar}>
            <div className={s.searchWrap}>
              <span className={s.searchIcon}>{ICONS.search}</span>
              <input
                type="search"
                className={s.searchInput}
                placeholder="Search by name, email, department..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                aria-label="Search recruiters"
              />
            </div>
            <select
              className={s.filterSelect}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="inactive">Inactive</option>
            </select>
            <select
              className={s.filterSelect}
              value={orgFilter}
              onChange={(e) => setOrgFilter(e.target.value)}
              aria-label="Filter by organization"
            >
              <option value="">All organizations</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </div>

          {recruiters.length === 0 ? (
            <div className={s.emptyState}>
              <div className={s.emptyIcon}>{ICONS.users}</div>
              <h3 className={s.emptyTitle}>No Recruiters Yet</h3>
              <p className={s.emptyDesc}>
                Invite your first recruiter to start managing hiring teams, permissions, and module access
                across your organizations.
              </p>
              <button type="button" className={s.btnPrimary} onClick={() => onTabChange("invite")}>
                {ICONS.mail}
                Invite Recruiter
              </button>
            </div>
          ) : (
            <>
              {bulkSelected.length > 0 && renderBulkBar()}
              {filtered.length === 0 ? (
                <div className={s.emptyState}>
                  <div className={s.emptyIcon}>{ICONS.search}</div>
                  <h3 className={s.emptyTitle}>No matching recruiters</h3>
                  <p className={s.emptyDesc}>
                    No recruiters match your search or filters. Try adjusting your criteria.
                  </p>
                  <button type="button" className={s.btnGhost} onClick={clearFilters}>
                    Clear filters
                  </button>
                </div>
              ) : (
                renderTable()
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

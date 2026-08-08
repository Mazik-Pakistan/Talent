"use client";

import { Fragment, useMemo, useState } from "react";
import s from "./OrganizationsPanel.module.css";
import StatsCard from "@/components/super-admin/StatsCard";

const MODULE_LABELS = {
  overview: "Overview dashboard",
  candidates: "Candidates",
  invite: "Invite & offer",
  employees: "Employees",
  talent: "Talent analytics",
  learning: "Learning",
  org_config: "Organization Setup",
  assistant: "AI assistant",
  messages: "Messages",
  announcements: "Announcements",
  it: "IT & support",
  reporting: "Activity & reporting",
  profile: "Profile",
  support: "Support tickets",
};
const MODULE_KEYS = Object.keys(MODULE_LABELS);

const svgProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

const ICONS = {
  building: (
    <svg {...svgProps}>
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01" />
    </svg>
  ),
  active: (
    <svg {...svgProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </svg>
  ),
  users: (
    <svg {...svgProps}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  sliders: (
    <svg {...svgProps}>
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
      <path d="M1 14h6M9 8h6M17 16h6" />
    </svg>
  ),
  search: (
    <svg {...svgProps}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  ),
  plus: (
    <svg {...svgProps}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  table: (
    <svg {...svgProps}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M9 4v16" />
    </svg>
  ),
  grid: (
    <svg {...svgProps}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  eye: (
    <svg {...svgProps}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
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
  check: (
    <svg {...svgProps}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  ),
  calendar: (
    <svg {...svgProps}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
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

export default function OrganizationsPanel(props) {
  const {
    organizations = [],
    recruiters = [],
    orgsLoading = false,
    openCreateOrg = () => {},
    handleOrgDelete = () => {},
    setEditOrgModules = () => {},
    editOrgModules = {},
    toggleOrgModule = () => {},
    saveOrgModules = () => {},
    cancelOrgEdit = () => {},
    expandedOrgs = {},
    toggleOrgExpansion = () => {},
  } = props;

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [viewMode, setViewMode] = useState("table");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [expandedDetail, setExpandedDetail] = useState({ orgId: null, tab: "overview" });

  function countEnabledModules(org) {
    return MODULE_KEYS.filter((key) => Boolean(org.modules?.[key])).length;
  }

  function moduleStats(org) {
    const enabled = countEnabledModules(org);
    const total = MODULE_KEYS.length;
    return { enabled, total, pct: total ? Math.round((enabled / total) * 100) : 0 };
  }

  function recruitersFor(org) {
    return recruiters.filter((recruiter) => recruiter.organization_id === org.id);
  }

  const filteredOrgs = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return organizations.filter((org) => {
      const matchesSearch =
        !term ||
        (org.name || "").toLowerCase().includes(term) ||
        (org.contact_email || "").toLowerCase().includes(term);
      const matchesStatus = !statusFilter || org.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [organizations, searchTerm, statusFilter]);

  const orgIdSet = useMemo(() => new Set(organizations.map((org) => org.id)), [organizations]);

  const activeCount = organizations.filter((org) => org.status === "active").length;
  const recruiterTotal = recruiters.filter((recruiter) => orgIdSet.has(recruiter.organization_id)).length;
  const modulesEnabledTotal = organizations.reduce((sum, org) => sum + countEnabledModules(org), 0);

  const allSelected = filteredOrgs.length > 0 && filteredOrgs.every((org) => selectedIds.has(org.id));
  const someSelected = !allSelected && filteredOrgs.some((org) => selectedIds.has(org.id));

  function toggleSelect(orgId) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(orgId)) {
        next.delete(orgId);
      } else {
        next.add(orgId);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      if (filteredOrgs.length && filteredOrgs.every((org) => prev.has(org.id))) {
        return new Set();
      }
      return new Set(filteredOrgs.map((org) => org.id));
    });
  }

  function handleRowClick(org) {
    const willExpand = !expandedOrgs[org.id];
    toggleOrgExpansion(org.id);
    if (willExpand) {
      setExpandedDetail((detail) => ({ orgId: org.id, tab: detail && detail.orgId === org.id ? detail.tab : "overview" }));
    } else if (expandedDetail && expandedDetail.orgId === org.id) {
      setExpandedDetail((detail) => ({ orgId: null, tab: detail ? detail.tab : "overview" }));
    }
  }

  function setTab(orgId, tab) {
    setExpandedDetail({ orgId, tab });
  }

  function bulkToggleExpand() {
    const selected = filteredOrgs.filter((org) => selectedIds.has(org.id));
    if (!selected.length) return;
    const allExpanded = selected.every((org) => expandedOrgs[org.id]);
    selected.forEach((org) => {
      const shouldExpand = !allExpanded;
      if (Boolean(expandedOrgs[org.id]) !== shouldExpand) toggleOrgExpansion(org.id);
    });
    if (!allExpanded) setExpandedDetail({ orgId: selected[0].id, tab: "overview" });
  }

  const kpis = [
    { key: "total", label: "Total Organizations", value: organizations.length, tone: "blue", icon: ICONS.building },
    { key: "active", label: "Active", value: activeCount, tone: "green", icon: ICONS.active },
    { key: "recruiters", label: "Recruiters", value: recruiterTotal, tone: "orange", icon: ICONS.users },
    { key: "modules", label: "Modules Enabled", value: modulesEnabledTotal, tone: "purple", icon: ICONS.sliders },
  ];

  function renderCheckbox(checked, onChange, label = "Select") {
    return (
      <label className={s.checkbox} onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          className={s.checkboxInput}
          checked={checked}
          onChange={onChange}
          onClick={(e) => e.stopPropagation()}
          aria-label={label}
        />
        <span className={s.checkboxMark}>{checked ? ICONS.check : null}</span>
      </label>
    );
  }

  function renderHeaderCheckbox() {
    return (
      <label className={`${s.checkbox} ${someSelected ? s.checkboxIndeterminate : ""}`} onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          className={s.checkboxInput}
          checked={allSelected}
          onChange={toggleSelectAll}
          aria-label="Select all organizations"
        />
        <span className={s.checkboxMark}>
          {allSelected ? ICONS.check : someSelected ? <span className={s.checkboxDash} /> : null}
        </span>
      </label>
    );
  }

  function renderStatusBadge(status) {
    return (
      <span className={`${s.statusBadge} ${status === "active" ? s.statusActive : s.statusInactive}`}>
        {status === "active" ? "Active" : "Inactive"}
      </span>
    );
  }

  function renderDetail(org) {
    const tab = expandedDetail && expandedDetail.orgId === org.id ? expandedDetail.tab : "overview";
    const orgRecruiters = recruitersFor(org);
    const isEditing = Boolean(editOrgModules[org.id]);
    const { enabled, total } = moduleStats(org);

    return (
      <div className={s.tabContent}>
        <div className={s.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            className={`${s.tab} ${tab === "overview" ? s.tabActive : ""}`}
            onClick={() => setTab(org.id, "overview")}
          >
            Overview
          </button>
          <button
            type="button"
            role="tab"
            className={`${s.tab} ${tab === "modules" ? s.tabActive : ""}`}
            onClick={() => setTab(org.id, "modules")}
          >
            Modules <span className={s.tabCount}>{enabled}/{total}</span>
          </button>
          <button
            type="button"
            role="tab"
            className={`${s.tab} ${tab === "recruiters" ? s.tabActive : ""}`}
            onClick={() => setTab(org.id, "recruiters")}
          >
            Recruiters <span className={s.tabCount}>{orgRecruiters.length}</span>
          </button>
        </div>

        {tab === "overview" && (
          <div className={s.detailGrid}>
            <div className={s.detailCard}>
              <span className={s.detailLabel}>Organization ID</span>
              <span className={s.detailValue}>{org.id}</span>
            </div>
            <div className={s.detailCard}>
              <span className={s.detailLabel}>Contact Email</span>
              <span className={s.detailValue}>{org.contact_email || "—"}</span>
            </div>
            <div className={s.detailCard}>
              <span className={s.detailLabel}>Status</span>
              <span className={s.detailValue}>{renderStatusBadge(org.status)}</span>
            </div>
            <div className={s.detailCard}>
              <span className={s.detailLabel}>Created</span>
              <span className={s.detailValue}>{formatDate(org.created_at)}</span>
            </div>
            <div className={`${s.detailCard} ${s.detailCardWide}`}>
              <span className={s.detailLabel}>Description</span>
              <span className={s.detailValue}>{org.description || "No description provided."}</span>
            </div>
          </div>
        )}

        {tab === "modules" && (
          <>
            <div className={s.modulesTabHeader}>
              <div>
                <div className={s.moduleHeadTitle}>Module Permissions</div>
                <p className={s.modulesTabHint}>Recruiters can only use modules their organization has purchased.</p>
              </div>
              <div className={s.actions}>
                {isEditing ? (
                  <>
                    <button type="button" className={s.btnPrimary} onClick={() => saveOrgModules(org.id)}>
                      Save Changes
                    </button>
                    <button type="button" className={s.btnGhost} onClick={() => cancelOrgEdit(org.id)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className={s.btnGhost}
                      onClick={() => setEditOrgModules((prev) => ({ ...prev, [org.id]: { ...org.modules } }))}
                    >
                      Edit Modules
                    </button>
                    <button type="button" className={s.btnDanger} onClick={() => handleOrgDelete(org)}>
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className={s.moduleGrid2}>
              {MODULE_KEYS.map((key) => {
                const currentValue = isEditing ? editOrgModules[org.id][key] : org.modules?.[key];
                return (
                  <div key={key} className={s.moduleToggle}>
                    <div className={s.moduleToggleInfo}>
                      <span className={s.moduleToggleLabel}>{MODULE_LABELS[key]}</span>
                      <span className={`${s.moduleStatus} ${currentValue ? s.moduleStatusEnabled : s.moduleStatusDisabled}`}>
                        {currentValue ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                    {isEditing ? (
                      <label className={s.toggle}>
                        <input
                          type="checkbox"
                          className={s.toggleInput}
                          checked={Boolean(currentValue)}
                          onChange={() => toggleOrgModule(org.id, key, currentValue)}
                        />
                        <span className={s.toggleTrack}>
                          <span className={s.toggleThumb} />
                        </span>
                      </label>
                    ) : (
                      <span className={`${s.staticDot} ${currentValue ? s.staticDotOn : ""}`}>
                        {currentValue ? ICONS.check : null}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {tab === "recruiters" &&
          (orgRecruiters.length ? (
            <ul className={s.recruiterList}>
              {orgRecruiters.map((recruiter) => (
                <li key={recruiter.id} className={s.recruiterItem}>
                  <span className={s.avatar}>{initials(recruiter.full_name)}</span>
                  <div className={s.recruiterInfo}>
                    <span className={s.recruiterName}>{recruiter.full_name || "Unnamed recruiter"}</span>
                    <span className={s.recruiterEmail}>{recruiter.email || "No email on file"}</span>
                  </div>
                  <span className={s.recruiterMeta}>{recruiter.job_title || "Recruiter"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className={s.recruiterEmpty}>
              {ICONS.users}
              <p>No recruiters assigned to this organization yet.</p>
            </div>
          ))}
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
                {renderHeaderCheckbox()}
              </th>
              <th className={s.th}>Organization</th>
              <th className={s.th}>Status</th>
              <th className={s.th}>Recruiters</th>
              <th className={s.th}>Modules</th>
              <th className={s.th}>Created</th>
              <th className={`${s.th} ${s.actionsCell}`}>Actions</th>
            </tr>
          </thead>
          <tbody className={s.tbody}>
            {filteredOrgs.map((org) => {
              const { enabled, total, pct } = moduleStats(org);
              const expanded = Boolean(expandedOrgs[org.id]);
              return (
                <Fragment key={org.id}>
                  <tr className={`${s.tr} ${expanded ? s.trExpanded : ""}`} onClick={() => handleRowClick(org)}>
                    <td className={s.td}>{renderCheckbox(selectedIds.has(org.id), () => toggleSelect(org.id), `Select ${org.name || org.id}`)}</td>
                    <td className={s.td}>
                      <div className={s.orgCell}>
                        <span className={s.avatar}>{initials(org.name)}</span>
                        <div className={s.orgCellText}>
                          <div className={s.orgName}>{org.name || "Untitled organization"}</div>
                          <div className={s.orgEmail}>{org.contact_email || "No contact email"}</div>
                        </div>
                      </div>
                    </td>
                    <td className={s.td}>{renderStatusBadge(org.status)}</td>
                    <td className={s.td}>
                      <span className={s.countCell}>{recruitersFor(org).length}</span>
                    </td>
                    <td className={s.td}>
                      <div className={s.progressWrap}>
                        <div className={s.progressTrack}>
                          <div className={s.progressBar} style={{ width: `${pct}%` }} />
                        </div>
                        <span className={s.progressText}>{enabled}/{total}</span>
                      </div>
                    </td>
                    <td className={s.td}>
                      <span className={s.dateCell}>{formatDate(org.created_at)}</span>
                    </td>
                    <td className={`${s.td} ${s.actionsCell}`}>
                      <div className={s.actions}>
                        <button
                          type="button"
                          className={s.btnIcon}
                          title={expanded ? "Collapse" : "View details"}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRowClick(org);
                          }}
                        >
                          {ICONS.eye}
                        </button>
                        <button
                          type="button"
                          className={`${s.btnIcon} ${s.btnIconDanger}`}
                          title="Delete organization"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOrgDelete(org);
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
                      <td colSpan={7} className={s.expandedCell}>
                        {renderDetail(org)}
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

  function renderCards() {
    return (
      <div className={s.cardGrid}>
        {filteredOrgs.map((org) => {
          const { enabled, total, pct } = moduleStats(org);
          const expanded = Boolean(expandedOrgs[org.id]);
          const count = recruitersFor(org).length;
          return (
            <div key={org.id} className={s.cardItem}>
              <div className={s.cardTop} onClick={() => handleRowClick(org)}>
                <div className={s.cardCheck}>{renderCheckbox(selectedIds.has(org.id), () => toggleSelect(org.id), `Select ${org.name || org.id}`)}</div>
                <span className={s.avatar}>{initials(org.name)}</span>
                <div className={s.cardInfo}>
                  <div className={s.cardNameRow}>
                    <span className={s.orgName}>{org.name || "Untitled organization"}</span>
                    {renderStatusBadge(org.status)}
                  </div>
                  <span className={s.orgEmail}>{org.contact_email || "No contact email"}</span>
                </div>
                <span className={`${s.chevron} ${expanded ? s.chevronOpen : ""}`}>{ICONS.chevron}</span>
              </div>
              <div className={s.cardBody}>
                <div className={s.cardMeta}>
                  <span className={s.cardMetaItem}>
                    {ICONS.users}
                    {count} recruiter{count === 1 ? "" : "s"}
                  </span>
                  <span className={s.cardMetaItem}>
                    {ICONS.calendar}
                    {formatDate(org.created_at)}
                  </span>
                </div>
                <div className={s.progressWrap}>
                  <div className={s.progressLabelRow}>
                    <span className={s.progressLabel}>Modules</span>
                    <span className={s.progressText}>{enabled}/{total}</span>
                  </div>
                  <div className={s.progressTrack}>
                    <div className={s.progressBar} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </div>
              <div className={s.cardActions}>
                <button type="button" className={s.btnGhost} onClick={() => handleRowClick(org)}>
                  {ICONS.eye}
                  {expanded ? "Collapse" : "View"}
                </button>
                <button type="button" className={`${s.btnGhost} ${s.btnDanger}`} onClick={() => handleOrgDelete(org)}>
                  {ICONS.trash}
                  Delete
                </button>
              </div>
              {expanded && <div className={s.cardDetail}>{renderDetail(org)}</div>}
            </div>
          );
        })}
      </div>
    );
  }

  function renderSkeleton() {
    return (
      <>
        <div className={s.kpiRow}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`${s.kpiCard} ${s.skeletonCard}`}>
              <div className={`${s.skeleton} ${s.skeletonPulse}`} style={{ height: 64, width: "100%" }} />
            </div>
          ))}
        </div>
        <div className={`${s.tableWrap} ${s.skeletonTable}`}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={s.skeletonRow}>
              <div className={`${s.skeleton} ${s.skeletonPulse}`} style={{ width: "42%", height: 16 }} />
              <div className={`${s.skeleton} ${s.skeletonPulse}`} style={{ width: "18%", height: 16 }} />
              <div className={`${s.skeleton} ${s.skeletonPulse}`} style={{ width: "24%", height: 16 }} />
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
          <h1 className={s.pageTitle}>Organizations</h1>
          <p className={s.pageSubtitle}>
            Manage companies, their module entitlements, and the recruiters assigned to them.
          </p>
        </div>
        <div className={s.toolbarRight}>
          <button type="button" className={s.btnPrimary} onClick={openCreateOrg}>
            {ICONS.plus}
            New Organization
          </button>
        </div>
      </header>

      <div className={s.toolbar}>
        <div className={s.toolbarLeft}>
          <div className={s.searchWrap}>
            <span className={s.searchIcon}>{ICONS.search}</span>
            <input
              type="search"
              className={s.searchInput}
              placeholder="Search by name or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
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
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div className={s.toolbarRight}>
          <div className={s.viewToggle}>
            <button
              type="button"
              className={`${s.viewBtn} ${viewMode === "table" ? s.viewBtnActive : ""}`}
              onClick={() => setViewMode("table")}
              title="Table view"
              aria-label="Table view"
            >
              {ICONS.table}
            </button>
            <button
              type="button"
              className={`${s.viewBtn} ${viewMode === "card" ? s.viewBtnActive : ""}`}
              onClick={() => setViewMode("card")}
              title="Card view"
              aria-label="Card view"
            >
              {ICONS.grid}
            </button>
          </div>
        </div>
      </div>

      {orgsLoading ? (
        renderSkeleton()
      ) : (
        <>
          <div className={s.kpiRow}>
            {kpis.map((kpi) => (
              <StatsCard
                key={kpi.key}
                variant="spacious"
                tone={kpi.tone}
                value={kpi.value}
                label={kpi.label}
                icon={kpi.icon}
              />
            ))}
          </div>

          {organizations.length === 0 ? (
            <div className={s.emptyState}>
              <div className={s.emptyIcon}>{ICONS.building}</div>
              <h3 className={s.emptyTitle}>No Organizations Yet</h3>
              <p className={s.emptyDesc}>
                Create your first organization to start granting module access and assigning recruiters.
              </p>
              <button type="button" className={s.btnPrimary} onClick={openCreateOrg}>
                {ICONS.plus}
                Create Organization
              </button>
            </div>
          ) : (
            <>
              {selectedIds.size > 0 && (
                <div className={s.bulkBar}>
                  <div className={s.bulkBarLeft}>
                    <span className={s.bulkCount}>{selectedIds.size} selected</span>
                    <button type="button" className={s.bulkAction} onClick={toggleSelectAll}>
                      {allSelected ? "Deselect all" : "Select all visible"}
                    </button>
                  </div>
                  <div className={s.bulkBarRight}>
                    <button type="button" className={s.bulkAction} onClick={bulkToggleExpand}>
                      Expand / collapse
                    </button>
                    <button type="button" className={s.bulkAction} onClick={() => setSelectedIds(new Set())}>
                      Clear selection
                    </button>
                  </div>
                </div>
              )}

              {filteredOrgs.length === 0 ? (
                <div className={s.emptyState}>
                  <div className={s.emptyIcon}>{ICONS.search}</div>
                  <h3 className={s.emptyTitle}>No matching organizations</h3>
                  <p className={s.emptyDesc}>
                    No organizations match your search or filter. Try adjusting your criteria.
                  </p>
                  <button
                    type="button"
                    className={s.btnGhost}
                    onClick={() => {
                      setSearchTerm("");
                      setStatusFilter("");
                    }}
                  >
                    Clear filters
                  </button>
                </div>
              ) : viewMode === "table" ? (
                renderTable()
              ) : (
                renderCards()
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

"use client";

import { useState, useMemo, useCallback } from "react";

import s from "./InviteRecruiter.module.css";

const ROLE_TEMPLATES = {
  standard_recruiter: {
    label: "Super Recruiter",
    desc: "Full recruitment and employee management access",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="28" height="28">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  hiring_only: {
    label: "Hiring Only",
    desc: "Candidate pipeline and invitation management",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="28" height="28">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M12 18v-6" /><path d="M9 15h6" />
      </svg>
    ),
  },
  people_ops: {
    label: "People Ops",
    desc: "Employee lifecycle, learning, and onboarding",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="28" height="28">
        <rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
      </svg>
    ),
  },
  it_admin: {
    label: "IT Admin",
    desc: "IT provisioning and system administration",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="28" height="28">
        <rect x="2" y="7" width="20" height="14" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M2 13h20" />
      </svg>
    ),
  },
  viewer: {
    label: "Viewer",
    desc: "Read-only access to dashboards and reports",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="28" height="28">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
};

const CAPABILITY_LABELS = {
  overview: "Overview Dashboard",
  candidates: "Candidates",
  invite: "Invite & Offer",
  employees: "Employees",
  talent: "Talent Analytics",
  learning: "Learning",
  org_config: "Organization Setup",
  assistant: "AI Assistant",
  messages: "Messages",
  announcements: "Announcements",
  it: "IT Support",
  reporting: "Activity & Reporting",
  profile: "Profile",
  support: "Support Tickets",
};

const CAPABILITY_ICONS = {
  overview: "📊",
  candidates: "👥",
  invite: "✉️",
  employees: "💼",
  talent: "⭐",
  learning: "📚",
  org_config: "🏢",
  assistant: "🤖",
  messages: "💬",
  announcements: "📢",
  it: "🖥️",
  reporting: "📈",
  profile: "👤",
  support: "🎫",
};

const CAPABILITY_DESCS = {
  overview: "Platform overview and KPIs",
  candidates: "Candidate pipeline management",
  invite: "Send invitations and offers",
  employees: "Employee directory and profiles",
  talent: "Talent pool analytics",
  learning: "Learning modules and courses",
  org_config: "Departments, roles, skills, and career tracks",
  assistant: "AI-powered hiring assistant",
  messages: "Internal messaging system",
  announcements: "Platform announcements",
  it: "IT asset provisioning",
  reporting: "Activity and audit logs",
  profile: "Profile management",
  support: "Support ticket management",
};

const MODULE_CATEGORIES = [
  {
    label: "Recruitment",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="18" height="18">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      </svg>
    ),
    keys: ["overview", "candidates", "invite", "reporting"],
  },
  {
    label: "Employee Management",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="18" height="18">
        <rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
      </svg>
    ),
    keys: ["employees", "profile"],
  },
  {
    label: "Analytics",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="18" height="18">
        <path d="M12 2l2.9 6.3L22 9.3l-5 4.9 1.2 6.9L12 17.8 5.8 21.1 7 14.2 2 9.3l7.1-1z" />
      </svg>
    ),
    keys: ["talent"],
  },
  {
    label: "AI & Communication",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="18" height="18">
        <path d="M12 2a5 5 0 0 1 5 5v2a5 5 0 0 1-10 0V7a5 5 0 0 1 5-5z" /><path d="M19 11a7 7 0 0 1-14 0" />
      </svg>
    ),
    keys: ["assistant", "messages"],
  },
  {
    label: "Operations",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="18" height="18">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
    keys: ["learning", "announcements", "it"],
  },
  {
    label: "Platform & Support",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="18" height="18">
        <path d="M21.2 15.9A10 10 0 1 1 8 2.8" /><path d="M22 12A10 10 0 0 1 12 22" /><path d="M8 15.5V9.5l5 3z" />
      </svg>
    ),
    keys: ["org_config", "support"],
  },
];

function allCapabilityFlags(source = {}, fallback = true) {
  return Object.keys(CAPABILITY_LABELS).reduce((acc, key) => {
    acc[key] = source[key] ?? fallback;
    return acc;
  }, {});
}

function orgPurchasedModules(organizations, organizationId) {
  if (!organizationId) return allCapabilityFlags({}, true);
  const org = organizations.find((o) => o.id === organizationId);
  if (!org) return allCapabilityFlags({}, true);
  return allCapabilityFlags(org.modules || {}, true);
}

function clampCapsToOrg(caps, orgModules) {
  return Object.keys(CAPABILITY_LABELS).reduce((acc, key) => {
    acc[key] = orgModules[key] === false ? false : (caps[key] ?? true);
    return acc;
  }, {});
}

export default function InviteRecruiter({
  inviteForm,
  setInviteForm,
  inviteCaps,
  setInviteCaps,
  inviteSubmitting,
  handleInvite,
  feedback,
  onClearFeedback,
  errors = {},
  onClearError,
  organizations,
  templates,
  activeTemplate,
  setActiveTemplate,
  applyTemplate,
}) {
  const [moduleSearch, setModuleSearch] = useState("");

  const selectedOrg = useMemo(
    () => organizations.find((o) => o.id === inviteForm.organization_id) || null,
    [organizations, inviteForm.organization_id]
  );

  const orgModules = useMemo(
    () => orgPurchasedModules(organizations, inviteForm.organization_id),
    [organizations, inviteForm.organization_id]
  );

  const enabledCount = useMemo(() => {
    return Object.entries(inviteCaps).filter(([k]) => orgModules[k] !== false && inviteCaps[k]).length;
  }, [inviteCaps, orgModules]);

  const enabledModules = useMemo(
    () => Object.entries(inviteCaps).filter(([k]) => inviteCaps[k] && orgModules[k] !== false).map(([k]) => CAPABILITY_LABELS[k]),
    [inviteCaps, orgModules]
  );

  const filteredCategories = useMemo(() => {
    if (!moduleSearch.trim()) return MODULE_CATEGORIES;
    const needle = moduleSearch.toLowerCase();
    return MODULE_CATEGORIES.map((cat) => ({
      ...cat,
      keys: cat.keys.filter(
        (k) =>
          CAPABILITY_LABELS[k].toLowerCase().includes(needle) ||
          (CAPABILITY_DESCS[k] || "").toLowerCase().includes(needle)
      ),
    })).filter((cat) => cat.keys.length > 0);
  }, [moduleSearch]);

  const handleOrgChange = useCallback(
    (e) => {
      onClearFeedback?.();
      const organization_id = e.target.value;
      setInviteForm((prev) => ({ ...prev, organization_id }));
      const orgMods = orgPurchasedModules(organizations, organization_id);
      setInviteCaps((prev) => clampCapsToOrg(prev, orgMods));
      setActiveTemplate("");
    },
    [organizations, setInviteForm, setInviteCaps, setActiveTemplate, onClearFeedback]
  );

  return (
    <div className={s.page}>
      {/* Header */}
      <div className={s.pageHeader}>
        <div>
          <h1 className={s.pageTitle}>Invite Recruiter</h1>
          <p className={s.pageSubtitle}>Create a recruiter account and configure permissions before sending an invitation.</p>
        </div>
        <div className={s.headerActions}>
          <button type="button" className={s.btnGhost}>Cancel</button>
          <button type="button" className={s.btnPrimary} disabled={inviteSubmitting} onClick={handleInvite}>
            {inviteSubmitting ? (
              <span className={s.spinnerSmall} />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            )}
            {inviteSubmitting ? "Sending…" : "Send Invitation"}
          </button>
        </div>
      </div>

      {/* Inline invitation result — always visible in the page flow, cannot be
          clipped by overlay/z-index or missed by the user. */}
      {feedback && (
        <div
          className={`${s.feedbackBanner} ${feedback.type === "success" ? s.feedbackBannerSuccess : feedback.type === "warning" ? s.feedbackBannerWarning : s.feedbackBannerError}`}
          role={feedback.type === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          <span className={s.feedbackIcon}>
            {feedback.type === "success" ? "✓" : feedback.type === "warning" ? "!" : "✕"}
          </span>
          <span className={s.feedbackText}>{feedback.message}</span>
          {onClearFeedback && (
            <button type="button" className={s.feedbackDismiss} onClick={onClearFeedback} aria-label="Dismiss message">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Two-column layout */}
      <div className={s.twoCol}>
        {/* Left column */}
        <div className={s.leftCol}>
          <form id="invite-form" onSubmit={handleInvite}>
            {/* Card 1: Recruiter Information */}
            <div className={s.card}>
              <div className={s.cardHeader}>
                <div className={s.cardHeaderIcon}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="20" height="20">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                  </svg>
                </div>
                <div>
                  <h2 className={s.cardTitle}>Recruiter Information</h2>
                  <p className={s.cardDesc}>Basic account details for the new recruiter</p>
                </div>
              </div>
              <div className={s.cardBody}>
                <div className={s.fieldGrid2}>
                  <div className={s.fieldGroup}>
                    <label className={s.fieldLabel}>Full Name <span className={s.required}>*</span></label>
                    <div className={s.inputWrap}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="16" height="16" className={s.inputIcon}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                      <input type="text" className={`${s.input} ${errors.full_name ? s.inputError : ""}`} placeholder="John Smith" value={inviteForm.full_name || ""} aria-invalid={Boolean(errors.full_name)} onChange={(e) => { onClearFeedback?.(); onClearError?.("full_name"); setInviteForm({ ...inviteForm, full_name: e.target.value }); }} required />
                    </div>
                    {errors.full_name && <small className={s.fieldError} role="alert">{errors.full_name}</small>}
                  </div>
                  <div className={s.fieldGroup}>
                    <label className={s.fieldLabel}>Email Address <span className={s.required}>*</span></label>
                    <div className={s.inputWrap}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="16" height="16" className={s.inputIcon}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><path d="M22 6l-10 7L2 6" /></svg>
                      <input type="email" className={`${s.input} ${errors.email ? s.inputError : ""}`} placeholder="john@company.com" value={inviteForm.email || ""} aria-invalid={Boolean(errors.email)} onChange={(e) => { onClearFeedback?.(); onClearError?.("email"); setInviteForm({ ...inviteForm, email: e.target.value }); }} required />
                    </div>
                    {errors.email && <small className={s.fieldError} role="alert">{errors.email}</small>}
                  </div>
                </div>
                <div className={s.fieldGrid2}>
                  <div className={s.fieldGroup}>
                    <label className={s.fieldLabel}>Job Title <span className={s.required}>*</span></label>
                    <div className={s.inputWrap}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="16" height="16" className={s.inputIcon}><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /></svg>
                      <input type="text" className={`${s.input} ${errors.job_title ? s.inputError : ""}`} placeholder="Senior Recruiter" value={inviteForm.job_title || ""} aria-invalid={Boolean(errors.job_title)} onChange={(e) => { onClearFeedback?.(); onClearError?.("job_title"); setInviteForm({ ...inviteForm, job_title: e.target.value }); }} required />
                    </div>
                    {errors.job_title && <small className={s.fieldError} role="alert">{errors.job_title}</small>}
                  </div>
                  <div className={s.fieldGroup}>
                    <label className={s.fieldLabel}>Department <span className={s.required}>*</span></label>
                    <div className={s.inputWrap}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="16" height="16" className={s.inputIcon}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>
                      <input type="text" className={`${s.input} ${errors.department ? s.inputError : ""}`} placeholder="Human Resources" value={inviteForm.department || ""} aria-invalid={Boolean(errors.department)} onChange={(e) => { onClearFeedback?.(); onClearError?.("department"); setInviteForm({ ...inviteForm, department: e.target.value }); }} required />
                    </div>
                    {errors.department && <small className={s.fieldError} role="alert">{errors.department}</small>}
                  </div>
                </div>
                <div className={s.fieldGrid2}>
                  <div className={s.fieldGroup}>
                    <label className={s.fieldLabel}>Office Location</label>
                    <div className={s.inputWrap}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="16" height="16" className={s.inputIcon}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
                      <input type="text" className={`${s.input} ${errors.office_location ? s.inputError : ""}`} placeholder="New York, NY" value={inviteForm.office_location || ""} aria-invalid={Boolean(errors.office_location)} onChange={(e) => { onClearFeedback?.(); onClearError?.("office_location"); setInviteForm({ ...inviteForm, office_location: e.target.value }); }} />
                    </div>
                    {errors.office_location && <small className={s.fieldError} role="alert">{errors.office_location}</small>}
                  </div>
                  <div className={s.fieldGroup}>
                    <label className={s.fieldLabel}>Organization</label>
                    <div className={s.inputWrap}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="16" height="16" className={s.inputIcon}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 22V12h6v10" /></svg>
                      <select className={`${s.input} ${errors.organization_id ? s.inputError : ""}`} value={inviteForm.organization_id || ""} aria-invalid={Boolean(errors.organization_id)} onChange={(e) => { onClearError?.("organization_id"); handleOrgChange(e); }}>
                        <option value="">Auto (default)</option>
                        {organizations.map((org) => (
                          <option key={org.id} value={org.id}>{org.name}</option>
                        ))}
                      </select>
                    </div>
                    {errors.organization_id && <small className={s.fieldError} role="alert">{errors.organization_id}</small>}
                  </div>
                </div>
                <div className={s.switchRow}>
                  <div>
                    <span className={s.switchLabel}>Remote Employee</span>
                    <span className={s.switchHint}>Recruiter works fully remote</span>
                  </div>
                  <label className={s.switch}>
                    <input type="checkbox" checked={Boolean(inviteForm.is_remote)} onChange={(e) => { onClearFeedback?.(); setInviteForm({ ...inviteForm, is_remote: e.target.checked }); }} />
                    <span className={s.switchTrack}><span className={s.switchThumb} /></span>
                  </label>
                </div>
              </div>
            </div>

            {/* Card 2: Role Selection */}
            <div className={s.card}>
              <div className={s.cardHeader}>
                <div className={s.cardHeaderIcon}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="20" height="20">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </div>
                <div>
                  <h2 className={s.cardTitle}>Recruiter Role</h2>
                  <p className={s.cardDesc}>Select a role template to auto-configure module permissions</p>
                </div>
              </div>
              <div className={s.cardBody}>
                <div className={s.roleGrid}>
                  {Object.entries(ROLE_TEMPLATES).map(([key, role], index) => {
                    const isActive = activeTemplate === key;
                    const moduleCount = templates[key]
                      ? Object.values(templates[key]).filter(Boolean).length
                      : 0;
                    return (
                      <button key={`${key}-${index}`} type="button" className={`${s.roleCard} ${isActive ? s.roleCardActive : ""}`} onClick={() => applyTemplate(key)}>
                        <div className={s.roleCardIcon}>{role.icon}</div>
                        <div className={s.roleCardBody}>
                          <span className={s.roleCardTitle}>{role.label}</span>
                          <span className={s.roleCardDesc}>{role.desc}</span>
                        </div>
                        <div className={s.roleCardMeta}>
                          <span className={s.roleBadge}>{moduleCount} Modules</span>
                          {isActive && (
                            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" className={s.roleCheck}>
                              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                            </svg>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Card 3: Module Permissions */}
            <div className={s.card}>
              <div className={s.cardHeader}>
                <div className={s.cardHeaderIcon}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="20" height="20">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </div>
                <div>
                  <h2 className={s.cardTitle}>Module Permissions</h2>
                  <p className={s.cardDesc}>Configure which modules this recruiter can access</p>
                </div>
              </div>
              <div className={s.cardBody}>
                <div className={s.moduleSearchWrap}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="16" height="16" className={s.moduleSearchIcon}>
                    <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                  </svg>
                  <input type="text" className={s.moduleSearch} placeholder="Search modules…" value={moduleSearch} onChange={(e) => setModuleSearch(e.target.value)} />
                </div>
                {filteredCategories.map((cat, catIndex) => (
                  <div key={`${cat.label}-${catIndex}`} className={s.permCategory}>
                    <div className={s.permCatHeader}>
                      <span className={s.permCatIcon}>{cat.icon}</span>
                      <span className={s.permCatLabel}>{cat.label}</span>
                    </div>
                    <div className={s.permGrid}>
                      {cat.keys.map((key, keyIndex) => {
                        const orgAllows = orgModules[key] !== false;
                        const isEnabled = Boolean(inviteCaps[key]);
                        return (
                          <button key={`${key}-${keyIndex}`} type="button" disabled={!orgAllows} className={`${s.permTile} ${isEnabled ? s.permTileOn : ""} ${!orgAllows ? s.permTileDisabled : ""}`}                             onClick={() => { onClearFeedback?.(); setInviteCaps((prev) => ({ ...prev, [key]: !prev[key] })); }}>
                            <span className={s.permTileIcon}>{CAPABILITY_ICONS[key]}</span>
                            <span className={s.permTileBody}>
                              <span className={s.permTileLabel}>{CAPABILITY_LABELS[key]}</span>
                              <span className={s.permTileDesc}>{CAPABILITY_DESCS[key]}</span>
                            </span>
                            <span className={`${s.permTileCheck} ${isEnabled ? s.permTileCheckOn : ""}`}>
                              {isEnabled ? (
                                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>
                              ) : null}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {Object.values(orgModules).some((v) => v === false) && (
                  <div className={s.infoBanner}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
                    <span>Modules not purchased by the selected organization are hidden. Enable them under Organizations first.</span>
                  </div>
                )}
              </div>
            </div>

            <div className={s.infoBanner}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
              <span>You can fine-tune module-level permissions after the recruiter accepts the invitation.</span>
            </div>
          </form>
        </div>

        {/* Right column: Access Summary */}
        <div className={s.rightCol}>
          <div className={s.summaryPanel}>
            <div className={s.summaryHeader}>
              <h3 className={s.summaryTitle}>Access Summary</h3>
            </div>
            <div className={s.summaryBody}>
              <div className={s.summarySection}>
                <span className={s.summaryLabel}>Organization</span>
                <span className={s.summaryValue}>{selectedOrg?.name || "Default"}</span>
                {selectedOrg && <span className={s.planBadge}>Enterprise</span>}
              </div>
              <div className={s.summarySection}>
                <span className={s.summaryLabel}>Selected Role</span>
                <span className={s.summaryValue}>{activeTemplate ? ROLE_TEMPLATES[activeTemplate]?.label : "None"}</span>
              </div>
              <div className={s.summarySection}>
                <span className={s.summaryLabel}>Modules Enabled</span>
                <span className={s.summaryValue}>{enabledCount} / {Object.keys(CAPABILITY_LABELS).length}</span>
                <div className={s.progressTrack}>
                  <div className={s.progressBar} style={{ width: `${(enabledCount / Object.keys(CAPABILITY_LABELS).length) * 100}%` }} />
                </div>
              </div>
              <div className={s.summarySection}>
                <span className={s.summaryLabel}>Invitation</span>
                <span className={s.summaryEmail}>{inviteForm.email || "—"}</span>
                <span className={s.summaryStatus}>Ready to Send</span>
              </div>
              <div className={s.summarySection}>
                <span className={s.summaryLabel}>Acceptance Period</span>
                <span className={s.summaryValue}>7 days</span>
              </div>
              <div className={s.summaryDivider} />
              <div className={s.summarySection}>
                <span className={s.summaryLabel}>Enabled Modules</span>
                <div className={s.moduleTagList}>
                  {enabledModules.length > 0 ? (
                    enabledModules.map((m, index) => <span key={`${m}-${index}`} className={s.moduleTag}>{m}</span>)
                  ) : (
                    <span className={s.summaryMuted}>No modules enabled</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

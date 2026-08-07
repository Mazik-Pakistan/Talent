"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import shellStyles from "@/components/recruiter/recruiter-shell.module.css";
import styles from "./talent.module.css";
import { getApiErrorMessage, listEmployees } from "@/services/authService";
import {
  AlertTriangle,
  Award,
  BookOpen,
  Building2,
  ChevronRight,
  Target,
  Users,
} from "lucide-react";

function fmt(n, suffix = "") {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n}${suffix}`;
}

function Breadcrumbs({ crumbs }) {
  return (
    <nav className={styles.breadcrumbs} aria-label="Overview breadcrumb">
      {crumbs.map((c, i) => (
        <span key={c.key} className={styles.breadcrumbItem}>
          {i > 0 && <ChevronRight size={14} className={styles.breadcrumbSep} aria-hidden="true" />}
          {c.onClick ? (
            <button type="button" className={styles.breadcrumbLink} onClick={c.onClick}>{c.label}</button>
          ) : (
            <span className={styles.breadcrumbCurrent}>{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

function SubTabs({ tabs, active, onChange }) {
  return (
    <div className={styles.subTabBar} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={active === t.key}
          className={`${styles.subTabBtn} ${active === t.key ? styles.subTabActive : ""}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export default function OrganizationView({
  data,
  loading,
  hasStructure,
  departmentName,
  roleName,
  onNavigate,
}) {
  if (loading && !data) {
    return <p className={styles.inlineNote}>Loading…</p>;
  }

  if (roleName && departmentName) {
    return (
      <RoleDetail
        data={data}
        departmentName={departmentName}
        roleName={roleName}
        onNavigate={onNavigate}
      />
    );
  }

  if (departmentName) {
    return (
      <DepartmentDetail
        data={data}
        departmentName={departmentName}
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <OrganizationBrowser
      data={data}
      hasStructure={hasStructure}
      onNavigate={onNavigate}
    />
  );
}

function OrganizationBrowser({ data, hasStructure, onNavigate }) {
  const cards = data?.departmentCards || [];

  return (
    <div className={styles.intelStack}>
      <Breadcrumbs
        crumbs={[
          { key: "org", label: "Organization" },
        ]}
      />

      {!hasStructure && (
        <div className={styles.infoCard}>
          <div className={styles.infoCardText}>
            <h3 className={styles.infoCardTitle}>No structure configured</h3>
            <p className={styles.infoCardDesc}>
              Add departments and roles in Organization Setup. Talent Intelligence reads them live — nothing is hardcoded.
            </p>
          </div>
          <button type="button" className={styles.modeBtn} onClick={() => onNavigate({ path: "/dashboard/recruiter/organization-config" })}>
            Organization Setup
          </button>
        </div>
      )}

      {cards.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyStateIcon}><Building2 aria-hidden="true" /></div>
          <div className={styles.emptyStateTitle}>No departments yet</div>
          <p className={styles.emptyStateHint}>Configure structure in Organization Setup, or assign employees to departments.</p>
        </div>
      ) : (
        <div className={styles.deptCardGrid}>
          {cards.map((d) => (
            <button
              key={d.name}
              type="button"
              className={styles.deptCard}
              onClick={() => onNavigate({ view: "dashboard", department: d.name })}
            >
              <div className={styles.deptCardTitle}>{d.name}</div>
              {d.description ? <p className={styles.deptCardDesc}>{d.description}</p> : null}
              <div className={styles.deptCardMeta}>
                <span>{fmt(d.employeeCount)} people</span>
                <span>{fmt(d.roleCount)} roles</span>
                <span>Progress {fmt(d.avgProgress, "%")}</span>
                <span>Learn {fmt(d.learningCompletion, "%")}</span>
              </div>
              <span className={styles.deptCardCta}>Open department <ChevronRight size={14} aria-hidden="true" /></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DepartmentDetail({ data, departmentName, onNavigate }) {
  const [sub, setSub] = useState("overview");
  const [employees, setEmployees] = useState([]);
  const [empLoading, setEmpLoading] = useState(false);

  const card = useMemo(
    () => (data?.departmentCards || []).find((d) => d.name === departmentName),
    [data, departmentName]
  );
  const roles = card?.roles || data?.rolesByDept?.[departmentName] || [];

  const loadEmployees = useCallback(() => {
    const token = localStorage.getItem("access_token");
    if (!token || !departmentName) return;
    setEmpLoading(true);
    listEmployees(token, { department: departmentName, page_size: 50 })
      .then((res) => setEmployees(res.employees || []))
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not load employees.")))
      .finally(() => setEmpLoading(false));
  }, [departmentName]);

  useEffect(() => {
    if (sub === "employees" || sub === "overview") loadEmployees();
  }, [sub, loadEmployees]);

  const crumbs = [
    { key: "org", label: "Overview", onClick: () => onNavigate({ view: "dashboard", department: null, role: null }) },
    { key: "dept", label: departmentName },
  ];

  return (
    <div className={styles.intelStack}>
      <Breadcrumbs crumbs={crumbs} />

      <div className={styles.detailHero}>
        <div>
          <h2 className={styles.detailTitle}>{departmentName}</h2>
          {card?.description ? <p className={styles.detailDesc}>{card.description}</p> : null}
        </div>
        <div className={styles.detailStatRow}>
          <span><Users size={14} aria-hidden="true" /> {fmt(card?.employeeCount ?? employees.length)} people</span>
          <span><Target size={14} aria-hidden="true" /> {fmt(card?.roleCount ?? roles.length)} roles</span>
          <span><BookOpen size={14} aria-hidden="true" /> Learn {fmt(card?.learningCompletion, "%")}</span>
          <span><Award size={14} aria-hidden="true" /> Cert {fmt(card?.certificationRate, "%")}</span>
        </div>
      </div>

      <SubTabs
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "roles", label: "Roles" },
          { key: "employees", label: "Employees" },
          { key: "analytics", label: "Analytics" },
        ]}
        active={sub}
        onChange={setSub}
      />

      {sub === "overview" && (
        <div className={styles.detailPanels}>
          <div className={shellStyles.section}>
            <div className={shellStyles.sectionHead}>
              <div className={shellStyles.sectionHeadLeft}>
                <span className={`${shellStyles.bar} ${shellStyles.cyan}`} />
                <div>
                  <div className={shellStyles.sectionTitle}>Roles in this department</div>
                </div>
              </div>
            </div>
            <div className={shellStyles.sectionBody}>
              {roles.length === 0 ? (
                <p className={styles.inlineNote}>No roles linked to this department yet.</p>
              ) : (
                roles.slice(0, 6).map((r) => (
                  <button
                    key={r.id || r.name}
                    type="button"
                    className={styles.listRowBtn}
                    onClick={() => onNavigate({ view: "dashboard", department: departmentName, role: r.name })}
                  >
                    <span className={styles.listRowTitle}>{r.name}</span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                ))
              )}
            </div>
          </div>
          <div className={shellStyles.section}>
            <div className={shellStyles.sectionHead}>
              <div className={shellStyles.sectionHeadLeft}>
                <span className={`${shellStyles.bar} ${shellStyles.green}`} />
                <div>
                  <div className={shellStyles.sectionTitle}>People snapshot</div>
                </div>
              </div>
              <button type="button" className={styles.smallBtn} onClick={() => setSub("employees")}>See all</button>
            </div>
            <div className={shellStyles.sectionBody}>
              {empLoading && <p className={styles.inlineNote}>Loading…</p>}
              {!empLoading && employees.length === 0 && (
                <p className={styles.inlineNote}>No employees in this department.</p>
              )}
              {employees.slice(0, 5).map((e) => (
                <button
                  key={e.employee_id}
                  type="button"
                  className={styles.listRowBtn}
                  onClick={() => onNavigate({ view: "profile", employee: e.employee_id, department: departmentName })}
                >
                  <span>
                    <span className={styles.listRowTitle}>{e.full_name}</span>
                    <span className={styles.listRowMeta}>{e.job_title || "—"}</span>
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {sub === "roles" && (
        <div className={shellStyles.section}>
          <div className={shellStyles.sectionBody}>
            {roles.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyStateTitle}>No roles</div>
                <p className={styles.emptyStateHint}>Add roles for this department in Organization Setup.</p>
              </div>
            ) : (
              roles.map((r) => (
                <button
                  key={r.id || r.name}
                  type="button"
                  className={styles.listRowBtn}
                  onClick={() => onNavigate({ view: "dashboard", department: departmentName, role: r.name })}
                >
                  <span>
                    <span className={styles.listRowTitle}>{r.name}</span>
                    <span className={styles.listRowMeta}>{r.description || "Role in org framework"}</span>
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {sub === "employees" && (
        <div className={shellStyles.section}>
          <div className={shellStyles.sectionBody}>
            {empLoading && <p className={styles.inlineNote}>Loading employees…</p>}
            {!empLoading && employees.length === 0 && (
              <div className={styles.emptyState}>
                <div className={styles.emptyStateTitle}>No employees</div>
                <p className={styles.emptyStateHint}>No people currently assigned to this department.</p>
              </div>
            )}
            {employees.map((e) => (
              <button
                key={e.employee_id}
                type="button"
                className={styles.listRowBtn}
                onClick={() => onNavigate({ view: "profile", employee: e.employee_id, department: departmentName })}
              >
                <span>
                  <span className={styles.listRowTitle}>{e.full_name}</span>
                  <span className={styles.listRowMeta}>{e.job_title || "—"} · {e.employee_id}</span>
                </span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      )}

      {sub === "analytics" && (
        <div className={styles.metricGrid}>
          {[
            { label: "Headcount", value: fmt(card?.employeeCount), icon: Users, color: "navy" },
            { label: "Avg career progress", value: fmt(card?.avgProgress, "%"), icon: Target, color: "cyan" },
            { label: "On track", value: fmt(card?.onTrack), icon: Award, color: "green" },
            { label: "Behind", value: fmt(card?.behind), icon: AlertTriangle, color: "red" },
            { label: "Learning completion", value: fmt(card?.learningCompletion, "%"), icon: BookOpen, color: "blue" },
            { label: "Certification rate", value: fmt(card?.certificationRate, "%"), icon: Award, color: "orange" },
          ].map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className={shellStyles.statCard}>
                <span className={`${shellStyles.statIcon} ${shellStyles[s.color]}`}>
                  <Icon aria-hidden="true" />
                </span>
                <div className={shellStyles.statText}>
                  <div className={shellStyles.statValue}>{s.value}</div>
                  <div className={shellStyles.statLabel}>{s.label}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RoleDetail({ data, departmentName, roleName, onNavigate }) {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);

  const role = useMemo(() => {
    const all = data?.roles || [];
    return all.find((r) => r.name === roleName && (!departmentName || r.department === departmentName))
      || all.find((r) => r.name === roleName);
  }, [data, roleName, departmentName]);

  const roadmap = useMemo(() => {
    const maps = data?.roadmaps || [];
    return maps.find((m) => m.role_name === roleName || m.role === roleName || m.name === roleName) || null;
  }, [data, roleName]);

  const skills = useMemo(() => {
    const list = data?.skills || [];
    return list.filter((s) => {
      const roles = s.roles || s.role_names || [];
      if (Array.isArray(roles) && roles.length) return roles.includes(roleName);
      return s.role === roleName || s.department === departmentName;
    });
  }, [data, roleName, departmentName]);

  const certs = useMemo(() => {
    const list = data?.certifications || [];
    return list.filter((c) => {
      const roles = c.roles || c.role_names || [];
      if (Array.isArray(roles) && roles.length) return roles.includes(roleName);
      return c.role === roleName || c.department === departmentName;
    });
  }, [data, roleName, departmentName]);

  const rule = useMemo(() => {
    const rules = data?.promotionRules || [];
    return rules.find((r) => r.role_name === roleName || r.role === roleName || r.from_role === roleName) || null;
  }, [data, roleName]);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    listEmployees(token, { department: departmentName || undefined, page_size: 100 })
      .then((res) => {
        const all = res.employees || [];
        const matched = all.filter((e) => {
          const title = (e.job_title || "").trim().toLowerCase();
          return title === roleName.trim().toLowerCase();
        });
        setEmployees(matched);
      })
      .catch((err) => toast.error(getApiErrorMessage(err, "Could not load role employees.")))
      .finally(() => setLoading(false));
  }, [departmentName, roleName]);

  const crumbs = [
    { key: "org", label: "Overview", onClick: () => onNavigate({ view: "dashboard", department: null, role: null }) },
    { key: "dept", label: departmentName, onClick: () => onNavigate({ view: "dashboard", department: departmentName, role: null }) },
    { key: "role", label: roleName },
  ];

  return (
    <div className={styles.intelStack}>
      <Breadcrumbs crumbs={crumbs} />

      <div className={styles.detailHero}>
        <div>
          <h2 className={styles.detailTitle}>{roleName}</h2>
          <p className={styles.detailDesc}>{role?.description || `${departmentName} · role from Organization Setup`}</p>
        </div>
      </div>

      <div className={styles.detailPanels}>
        <div className={shellStyles.section}>
          <div className={shellStyles.sectionHead}>
            <div className={shellStyles.sectionHeadLeft}>
              <span className={`${shellStyles.bar} ${shellStyles.navy}`} />
              <div>
                <div className={shellStyles.sectionTitle}>Employees in this role</div>
                <p className={styles.sectionDescSoft}>Matched by job title</p>
              </div>
            </div>
          </div>
          <div className={shellStyles.sectionBody}>
            {loading && <p className={styles.inlineNote}>Loading…</p>}
            {!loading && employees.length === 0 && (
              <p className={styles.inlineNote}>No employees with this job title in the department.</p>
            )}
            {employees.map((e) => (
              <button
                key={e.employee_id}
                type="button"
                className={styles.listRowBtn}
                onClick={() => onNavigate({
                  view: "profile",
                  employee: e.employee_id,
                  department: departmentName,
                  role: roleName,
                })}
              >
                <span>
                  <span className={styles.listRowTitle}>{e.full_name}</span>
                  <span className={styles.listRowMeta}>{e.employee_id}</span>
                </span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>

        <div className={shellStyles.section}>
          <div className={shellStyles.sectionHead}>
            <div className={shellStyles.sectionHeadLeft}>
              <span className={`${shellStyles.bar} ${shellStyles.cyan}`} />
              <div>
                <div className={shellStyles.sectionTitle}>Skills & certifications</div>
              </div>
            </div>
          </div>
          <div className={shellStyles.sectionBody}>
            {skills.length === 0 && certs.length === 0 && (
              <p className={styles.inlineNote}>No skills or certs linked to this role in Organization Setup.</p>
            )}
            <div className={styles.chipRow}>
              {skills.map((s) => (
                <span key={s.id || s.name} className={styles.softChip}>{s.name}</span>
              ))}
              {certs.map((c) => (
                <span key={c.id || c.name} className={`${styles.softChip} ${styles.softChipAccent}`}>{c.name}</span>
              ))}
            </div>
          </div>
        </div>

        {(roadmap || rule) && (
          <div className={shellStyles.section}>
            <div className={shellStyles.sectionHead}>
              <div className={shellStyles.sectionHeadLeft}>
                <span className={`${shellStyles.bar} ${shellStyles.orange}`} />
                <div>
                  <div className={shellStyles.sectionTitle}>Roadmap & promotion</div>
                </div>
              </div>
            </div>
            <div className={shellStyles.sectionBody}>
              {roadmap && (
                <p className={styles.inlineNote}>
                  Roadmap: {roadmap.name || roadmap.title || "Configured"}
                  {roadmap.description ? ` — ${roadmap.description}` : ""}
                </p>
              )}
              {rule && (
                <p className={styles.inlineNote}>
                  Promotion rule: {rule.name || rule.to_role || rule.target_role || "Configured"}
                  {rule.min_readiness != null ? ` (min readiness ${rule.min_readiness}%)` : ""}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

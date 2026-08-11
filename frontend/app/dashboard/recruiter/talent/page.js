"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import RecruiterShell from "@/components/recruiter/RecruiterShell";
import ProtectedRecruiterRoute from "@/components/ProtectedRecruiterRoute";
import styles from "./talent.module.css";
import TalentDashboard from "./TalentDashboard";
import TalentEmployees from "./TalentEmployees";
import TalentProfileView from "./TalentProfileView";
import PromotionPipeline from "./PromotionPipeline";
import InternalOpportunities from "./InternalOpportunities";
import { useTalentIntelligenceData } from "@/hooks/useTalentIntelligenceData";
import {
  clearRecruiterContext,
  publishRecruiterContext,
} from "@/lib/ai/recruiterContext";
import { TALENT_TAB_HELP } from "@/lib/ai/recruiterFieldHelp";
import {
  BarChart3,
  Lightbulb,
  TrendingUp,
  Users,
} from "lucide-react";

const VIEWS = [
  { key: "dashboard", label: "Overview", icon: BarChart3 },
  { key: "employees", label: "Employees", icon: Users },
  { key: "pipeline", label: "Pipeline", icon: TrendingUp },
  { key: "opportunities", label: "Opportunities", icon: Lightbulb },
];

const FOCUSES = new Set([
  "all",
  "employees",
  "ready",
  "almost",
  "behind",
  "high_potential",
  "departments",
  "roles",
  "certifications",
  "learning",
  "incomplete",
]);

const LEGACY_TAB_MAP = {
  overview: "dashboard",
  organization: "dashboard",
  "career-paths": "employees",
  "promotion-readiness": "pipeline",
  search: "employees",
  opportunities: "opportunities",
  "career-framework": "dashboard",
};

function parseView(searchParams) {
  if (searchParams.get("employee")) return "profile";
  const raw = searchParams.get("view") || searchParams.get("tab");
  if (!raw) return "dashboard";
  if (VIEWS.some((v) => v.key === raw) || raw === "profile") return raw;
  return LEGACY_TAB_MAP[raw] || "dashboard";
}

export default function RecruiterTalentPage() {
  return (
    <ProtectedRecruiterRoute requiredCapability="talent">
      <RecruiterTalentPageContent />
    </ProtectedRecruiterRoute>
  );
}

function RecruiterTalentPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    data,
    loading,
    error,
    refresh,
    departmentNames,
    roleNames,
    hasStructure,
  } = useTalentIntelligenceData();

  const view = parseView(searchParams);
  const department = searchParams.get("department") || "";
  const role = searchParams.get("role") || "";
  const employee = searchParams.get("employee") || "";
  const focusRaw = searchParams.get("focus") || "all";
  const focus = FOCUSES.has(focusRaw) ? focusRaw : "all";

  const chromeView = view === "profile" ? "employees" : view;

  const navigate = useCallback(
    (patch) => {
      if (patch.path) {
        router.push(patch.path);
        return;
      }

      const params = new URLSearchParams(searchParams.toString());
      params.delete("tab");

      let nextView = patch.view !== undefined ? patch.view : view;
      if (nextView === "organization") nextView = "dashboard";

      let nextDept = patch.department !== undefined ? patch.department : department;
      let nextRole = patch.role !== undefined ? patch.role : role;
      let nextFocus = patch.focus !== undefined ? patch.focus : focus;
      const nextEmp = patch.employee !== undefined ? patch.employee : employee;

      if (nextView === "pipeline" || nextView === "opportunities") {
        nextDept = null;
        nextRole = null;
        nextFocus = "all";
      }
      if (nextView === "employees" && !nextEmp) {
        nextRole = null;
      }
      if (
        nextView === "dashboard" &&
        patch.view === "dashboard" &&
        patch.department === null &&
        patch.role === null &&
        patch.employee === null &&
        patch.focus === undefined
      ) {
        nextDept = null;
        nextRole = null;
        nextFocus = "all";
      }

      if (nextView && nextView !== "dashboard") params.set("view", nextView);
      else params.delete("view");

      if (nextDept) params.set("department", nextDept);
      else params.delete("department");

      if (nextRole) params.set("role", nextRole);
      else params.delete("role");

      params.delete("panel");
      // Keep focus on Overview KPIs and Employees incomplete filter.
      if (
        (nextView === "dashboard" || nextView === "employees")
        && nextFocus
        && nextFocus !== "all"
      ) {
        params.set("focus", nextFocus);
      } else {
        params.delete("focus");
      }

      if (nextEmp) {
        params.set("employee", nextEmp);
        params.set("view", "profile");
      } else {
        params.delete("employee");
        if (nextView === "profile") {
          params.set("view", "employees");
        }
      }

      const qs = params.toString();
      router.push(qs ? `/dashboard/recruiter/talent?${qs}` : "/dashboard/recruiter/talent");
    },
    [router, searchParams, view, department, role, employee, focus]
  );

  useEffect(() => {
    const helpKey = view === "profile" ? "profile" : view;
    const help = TALENT_TAB_HELP[helpKey] || TALENT_TAB_HELP.dashboard || {};
    publishRecruiterContext({
      tab: helpKey,
      section: helpKey,
      hint: help.hint || null,
      fields: help.fields || [],
    });
    return () => clearRecruiterContext();
  }, [view]);

  const subtitle = useMemo(() => {
    if (view === "profile") return "Employee talent profile · requirements, skills, path";
    if (view === "dashboard" && role && department) return `${department} · ${role} · role progress`;
    if (view === "dashboard" && department) return `${department} · department progress`;
    if (view === "dashboard") return "Org → department → role → employee progress";
    if (view === "pipeline") return "Promotion readiness and career path assign";
    if (view === "opportunities") return "Internal projects and open roles";
    if (view === "employees") {
      return focus === "incomplete"
        ? "Employees with incomplete requirements"
        : "Search and filter talent";
    }
    return "Talent Intelligence Center";
  }, [view, department, role, focus]);

  return (
    <RecruiterShell
      activeKey="talent"
      capability="talent"
      title="Talent Intelligence Center"
      subtitle={subtitle}
    >
      <div className={styles.tabBar} role="tablist" aria-label="Talent Intelligence surfaces">
        {VIEWS.map((t) => {
          const Icon = t.icon;
          const active = chromeView === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              className={`${styles.tabBtn} ${active ? styles.tabActive : ""}`}
              onClick={() => navigate({
                view: t.key,
                department: null,
                role: null,
                employee: null,
                focus: "all",
              })}
            >
              <span className={styles.tabIcon}>
                <Icon aria-hidden="true" />
              </span>
              {t.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div className={styles.infoCard} style={{ marginBottom: 16 }}>
          <div className={styles.infoCardText}>
            <h3 className={styles.infoCardTitle}>Could not load some talent data</h3>
            <p className={styles.infoCardDesc}>{error}</p>
          </div>
          <button type="button" className={styles.modeBtn} onClick={refresh}>Retry</button>
        </div>
      )}

      {view === "dashboard" && (
        <TalentDashboard
          data={data}
          loading={loading}
          hasStructure={hasStructure}
          department={department}
          role={role}
          focus={focus}
          onNavigate={navigate}
        />
      )}

      {view === "employees" && (
        <TalentEmployees
          departmentNames={departmentNames}
          roleNames={roleNames}
          metrics={data?.metrics}
          promotion={data?.promotion}
          requirements={data?.requirements}
          initialDepartment={department}
          initialIncompleteOnly={focus === "incomplete"}
          onNavigate={navigate}
        />
      )}

      {view === "profile" && employee && (
        <TalentProfileView
          employeeId={employee}
          departmentName={department || null}
          roleName={role || null}
          onNavigate={navigate}
        />
      )}

      {view === "profile" && !employee && (
        <div className={styles.emptyState}>
          <div className={styles.emptyStateTitle}>No employee selected</div>
          <p className={styles.emptyStateHint}>Open someone from Overview or Employees.</p>
          <button type="button" className={styles.modeBtn} onClick={() => navigate({ view: "employees", employee: null })}>
            Go to Employees
          </button>
        </div>
      )}

      {view === "pipeline" && (
        <PromotionPipeline
          departmentNames={departmentNames}
          onNavigate={navigate}
          onRefreshIntel={refresh}
        />
      )}

      {view === "opportunities" && (
        <InternalOpportunities departmentNames={departmentNames} onNavigate={navigate} />
      )}
    </RecruiterShell>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getFrameworkSummary,
  getOrgStructureOptions,
  listOrgDepartments,
  listOrgRoles,
  listOrgSkills,
  listOrgCertifications,
  listOrgRoadmaps,
  listOrgPromotionRules,
} from "@/services/orgFrameworkService";
import { getTalentMetrics, getTalentRequirementsStatus } from "@/services/talentService";
import {
  getPromotionReadiness,
  getCareerProgressReport,
} from "@/services/careerService";
import { getLearningAnalytics } from "@/services/learningService";
import { onFrameworkInvalidated } from "@/lib/frameworkEvents";

function careerAvgProgress(career) {
  if (!career) return null;
  const raw =
    career.avg_progress_percent ??
    career.average_progress ??
    career.avg_progress ??
    career.avg_readiness_score;
  if (raw == null || Number.isNaN(Number(raw))) return null;
  return Number(raw);
}

function learningCertRate(learn, orgLearning) {
  if (learn?.certification_rate != null) return learn.certification_rate;
  // Per-dept cert rate is not in department_comparison — fall back to org rate.
  if (orgLearning?.certification_rate != null) return orgLearning.certification_rate;
  return null;
}

/**
 * Session-cached Talent Intelligence aggregates.
 * Structure comes from Organization Setup; people metrics from existing talent/career/learning APIs.
 * No hardcoded departments/roles.
 */

let cache = null;
let cachePromise = null;

export function bustTalentIntelligenceCache() {
  cache = null;
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.results)) return value.results;
  if (Array.isArray(value.data)) return value.data;
  if (Array.isArray(value.departments)) return value.departments;
  if (Array.isArray(value.roles)) return value.roles;
  if (Array.isArray(value.skills)) return value.skills;
  if (Array.isArray(value.certifications)) return value.certifications;
  if (Array.isArray(value.roadmaps)) return value.roadmaps;
  if (Array.isArray(value.rules) || Array.isArray(value.promotion_rules)) {
    return value.rules || value.promotion_rules;
  }
  return [];
}

async function fetchBundle(force = false) {
  if (!force && cache) return cache;
  if (!force && cachePromise) return cachePromise;

  const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
  if (!token) return null;

  cachePromise = Promise.allSettled([
    getFrameworkSummary(token),
    listOrgDepartments(token),
    listOrgRoles(token),
    listOrgSkills(token),
    listOrgCertifications(token),
    listOrgRoadmaps(token),
    listOrgPromotionRules(token),
    getTalentMetrics(token, undefined, { force }),
    getPromotionReadiness(token),
    getCareerProgressReport(token),
    getLearningAnalytics(token, undefined, { force }),
    getOrgStructureOptions(token),
    getTalentRequirementsStatus(token, { page_size: 200 }),
  ]).then((results) => {
    const val = (i, fallback) =>
      results[i].status === "fulfilled" ? results[i].value : fallback;

    const structureOptions = val(11, null);
    const requirements = val(12, null);
    let departments = asList(val(1, []));
    let roles = asList(val(2, []));

    // Prefer /options when list endpoints fail or return empty — same org-framework source.
    if (departments.length === 0 && Array.isArray(structureOptions?.departments)) {
      departments = structureOptions.departments
        .filter(Boolean)
        .map((name) => (typeof name === "string" ? { name } : name));
    }
    if (roles.length === 0 && Array.isArray(structureOptions?.roles)) {
      roles = structureOptions.roles.filter((r) => r && (r.name || typeof r === "string")).map((r) => (
        typeof r === "string" ? { name: r, department: "" } : r
      ));
    }

    const skills = asList(val(3, []));
    const certifications = asList(val(4, []));
    const roadmaps = asList(val(5, []));
    const promotionRules = asList(val(6, []));
    const metrics = val(7, null);
    const promotion = val(8, null);
    const careerProgress = val(9, null);
    const learning = val(10, null);
    const summary = val(0, null);

    const deptAnalysis = {};
    for (const row of metrics?.department_skill_analysis || []) {
      if (row?.department) deptAnalysis[row.department] = row;
    }

    const careerByDept = {};
    const deptRows = careerProgress?.by_department || careerProgress?.departments || [];
    if (Array.isArray(deptRows)) {
      for (const row of deptRows) {
        const name = row.department || row.name;
        if (name) careerByDept[name] = row;
      }
    } else if (deptRows && typeof deptRows === "object") {
      Object.assign(careerByDept, deptRows);
    }

    const learningByDept = {};
    for (const row of learning?.department_comparison || []) {
      if (row?.department) learningByDept[row.department] = row;
    }

    const rolesByDept = {};
    for (const role of roles) {
      const d = role.department || "Unassigned";
      if (!rolesByDept[d]) rolesByDept[d] = [];
      rolesByDept[d].push(role);
    }

    function rolesForDepartment(name) {
      if (!name) return roles;
      const key = name.trim().toLowerCase();
      return roles.filter((r) => (r.department || "").trim().toLowerCase() === key);
    }

    const incompleteByDept = {};
    for (const row of requirements?.by_department || []) {
      if (row?.department) incompleteByDept[row.department] = row;
    }
    const incompleteByEmployee = {};
    for (const row of requirements?.employees || []) {
      if (row?.employee_id) incompleteByEmployee[row.employee_id] = row;
    }

    function buildCard(name, description, fromMetricsOnly = false) {
      const analysis = deptAnalysis[name];
      const career = careerByDept[name];
      const learn = learningByDept[name];
      const deptRoles = rolesForDepartment(name);
      const req = incompleteByDept[name];
      return {
        name,
        description: description || "",
        employeeCount: analysis?.headcount ?? req?.employee_count ?? null,
        roleCount: deptRoles.length,
        skillsTracked: analysis?.skills_tracked ?? null,
        avgProgress: careerAvgProgress(career),
        avgReadiness: career?.avg_readiness_score ?? null,
        onTrack: career?.on_track_count ?? null,
        behind: career?.behind_count ?? null,
        learningCompletion: learn?.completion_rate ?? learn?.learning_completion_rate ?? null,
        certificationRate: learningCertRate(learn, learning),
        incompleteRequirements: req?.incomplete_count ?? 0,
        incompleteHigh: req?.incomplete_high ?? 0,
        roles: deptRoles,
        ...(fromMetricsOnly ? { fromMetricsOnly: true } : {}),
      };
    }

    const departmentCards = departments.map((d) => {
      const name = typeof d === "string" ? d : d?.name;
      if (!name) return null;
      return buildCard(name, typeof d === "string" ? "" : d?.description);
    }).filter(Boolean);

    // Include departments that appear in metrics but not yet in framework (still dynamic, not hardcoded)
    for (const name of Object.keys(deptAnalysis)) {
      if (!departmentCards.some((c) => c.name === name)) {
        departmentCards.push(buildCard(name, "", true));
      }
    }
    for (const name of Object.keys(incompleteByDept)) {
      if (!departmentCards.some((c) => c.name === name)) {
        departmentCards.push(buildCard(name, "", true));
      }
    }

    departmentCards.sort((a, b) => {
      // Rank: higher avg progress first; then fewer incomplete; then name
      const ap = a.avgProgress ?? -1;
      const bp = b.avgProgress ?? -1;
      if (bp !== ap) return bp - ap;
      const ai = a.incompleteHigh ?? 0;
      const bi = b.incompleteHigh ?? 0;
      if (ai !== bi) return ai - bi;
      return a.name.localeCompare(b.name);
    });

    cache = {
      summary,
      departments,
      roles,
      skills,
      certifications,
      roadmaps,
      promotionRules,
      metrics,
      promotion,
      careerProgress,
      learning,
      requirements,
      incompleteByEmployee,
      departmentCards,
      rolesByDept,
      errors: results
        .map((r, i) => (r.status === "rejected" ? { index: i, reason: r.reason } : null))
        .filter(Boolean),
      loadedAt: Date.now(),
    };
    return cache;
  }).finally(() => {
    cachePromise = null;
  });

  return cachePromise;
}

export function useTalentIntelligenceData() {
  const [data, setData] = useState(cache);
  const [loading, setLoading] = useState(!cache);
  const [error, setError] = useState(null);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      if (force) bustTalentIntelligenceCache();
      const bundle = await fetchBundle(force);
      setData(bundle);
      if (!bundle) setError("Not signed in.");
    } catch (err) {
      setError(err?.message || "Could not load talent intelligence.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchBundle(false).then((bundle) => {
      if (cancelled) return;
      setData(bundle);
      setLoading(false);
    }).catch((err) => {
      if (cancelled) return;
      setError(err?.message || "Could not load talent intelligence.");
      setLoading(false);
    });
    const unsub = onFrameworkInvalidated(() => {
      bustTalentIntelligenceCache();
      fetchBundle(false).then((bundle) => {
        if (cancelled) return;
        setData(bundle);
      }).catch(() => {});
    });
    return () => { cancelled = true; unsub(); };
  }, []);

  const departmentNames = useMemo(() => {
    const fromFramework = (data?.departments || [])
      .map((d) => (typeof d === "string" ? d : d?.name))
      .filter(Boolean);
    if (fromFramework.length) {
      return [...new Set(fromFramework)].sort((a, b) => a.localeCompare(b));
    }
    return (data?.departmentCards || []).map((d) => d.name).filter(Boolean);
  }, [data]);

  const roleNames = useMemo(() => {
    const names = [...new Set((data?.roles || []).map((r) => r.name || (typeof r === "string" ? r : "")).filter(Boolean))];
    return names.sort((a, b) => a.localeCompare(b));
  }, [data]);

  return {
    data,
    loading,
    error,
    refresh: () => load(true),
    departmentNames,
    roleNames,
    hasStructure: (data?.departments?.length || 0) > 0 || (data?.roles?.length || 0) > 0,
  };
}

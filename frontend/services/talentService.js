import apiClient from "@/lib/apiClient";
import { CacheKeys, cachedFetch, invalidateCachePrefix } from "@/utils/recruiterCache";

function invalidateTalentCaches() {
  invalidateCachePrefix("talent-");
}

// ─── Employee self-service (US-090/091/093/094/101) ──────────────────────────

export async function getSkillMatrix(accessToken) {
  const { data } = await apiClient.get("/api/talent/skill-matrix");
  return data;
}

export async function getCareerProgression(accessToken) {
  const { data } = await apiClient.get("/api/talent/career-progression");
  return data;
}

export async function getJourneyTimeline(accessToken, types) {
  const { data } = await apiClient.get("/api/talent/journey", {
    params: types ? { types } : {},
  });
  return data;
}

export async function getAchievements(accessToken) {
  const { data } = await apiClient.get("/api/talent/achievements");
  return data;
}

// ─── Internal opportunities (US-095) ──────────────────────────────────────────

export async function browseOpportunities(accessToken, params = {}, { force = false } = {}) {
  const key = CacheKeys.opportunities;
  // Only cache the default first-page list; search / filters / later pages skip cache.
  const page = params.page == null || params.page === 1;
  const useCache =
    page &&
    !params.q &&
    !params.department &&
    !params.type &&
    (params.status === "all" || params.status === "open" || !params.status);
  if (!useCache) {
    const { data } = await apiClient.get("/api/talent/opportunities", { params });
    return data;
  }
  const { data } = await cachedFetch(
    `${key}:${params.status || "open"}:p${params.page || 1}:s${params.page_size || 20}`,
    async () => {
      const res = await apiClient.get("/api/talent/opportunities", { params });
      return res.data;
    },
    { force }
  );
  return data;
}

export async function createOpportunity(accessToken, payload) {
  const { data } = await apiClient.post("/api/talent/opportunities", payload);
  invalidateTalentCaches();
  return data;
}

export async function updateOpportunity(accessToken, opportunityId, payload) {
  const { data } = await apiClient.put(
    `/api/talent/opportunities/${encodeURIComponent(opportunityId)}`,
    payload
  );
  invalidateTalentCaches();
  return data;
}

export async function applyToOpportunity(accessToken, opportunityId) {
  const { data } = await apiClient.post(
    `/api/talent/opportunities/${encodeURIComponent(opportunityId)}/apply`,
    {}
  );
  return data;
}

export async function getOpportunityApplicants(accessToken, opportunityId) {
  const { data } = await apiClient.get(
    `/api/talent/opportunities/${encodeURIComponent(opportunityId)}/applicants`
  );
  return data;
}

// ─── Competency evaluation (US-099) ───────────────────────────────────────────

export async function submitCompetencyEvaluation(accessToken, employeeId, payload) {
  const { data } = await apiClient.post(
    `/api/talent/competency/${encodeURIComponent(employeeId)}`,
    payload
  );
  invalidateTalentCaches();
  return data;
}

export async function getCompetencyHistory(accessToken, employeeId) {
  const { data } = await apiClient.get(`/api/talent/competency/${encodeURIComponent(employeeId)}`);
  return data;
}

// ─── Talent search (US-100) ───────────────────────────────────────────────────

export async function searchTalent(accessToken, payload) {
  const { data } = await apiClient.post("/api/talent/search", payload);
  return data;
}

// ─── Recruiter talent metrics dashboard (US-102) ──────────────────────────────

export async function getTalentMetrics(accessToken, department, { force = false } = {}) {
  const { data } = await cachedFetch(
    CacheKeys.talentMetrics(department || ""),
    async () => {
      const res = await apiClient.get("/api/talent/metrics", {
        params: department ? { department } : {},
      });
      return res.data;
    },
    { force }
  );
  return data;
}

// ─── Requirements not fulfilled (Talent Progress CIC) ─────────────────────────

export async function getTalentRequirementsStatus(accessToken, params = {}) {
  const { data } = await apiClient.get("/api/talent/requirements-status", {
    params: {
      department: params.department || undefined,
      role: params.role || undefined,
      employee_id: params.employee_id || undefined,
      page: params.page || 1,
      page_size: params.page_size || 50,
    },
  });
  return data;
}

// ─── Development plan (US-103) ────────────────────────────────────────────────

export async function getDevelopmentPlan(accessToken, employeeId) {
  const { data } = await apiClient.get(`/api/talent/development-plan/${encodeURIComponent(employeeId)}`);
  return data;
}

export async function updateDevelopmentPlan(accessToken, employeeId, payload) {
  const { data } = await apiClient.put(
    `/api/talent/development-plan/${encodeURIComponent(employeeId)}`,
    payload
  );
  invalidateTalentCaches();
  return data;
}

// ─── 360° profile (US-104) ────────────────────────────────────────────────────

export async function getTalentProfile(accessToken, employeeId) {
  const { data } = await apiClient.get(`/api/talent/profile/${encodeURIComponent(employeeId)}`);
  return data;
}

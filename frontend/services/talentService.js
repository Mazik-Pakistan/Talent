import axios from "axios";
import { CacheKeys, cachedFetch, invalidateCachePrefix } from "@/utils/recruiterCache";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

const client = axios.create({
  baseURL: apiBaseUrl,
  headers: {
    "Content-Type": "application/json",
    "ngrok-skip-browser-warning": "true",
  },
});

function auth(accessToken) {
  return { headers: { Authorization: `Bearer ${accessToken}` } };
}

function invalidateTalentCaches() {
  invalidateCachePrefix("talent-");
}

// ─── Employee self-service (US-090/091/093/094/101) ──────────────────────────

export async function getSkillMatrix(accessToken) {
  const { data } = await client.get("/api/talent/skill-matrix", auth(accessToken));
  return data;
}

export async function getCareerProgression(accessToken) {
  const { data } = await client.get("/api/talent/career-progression", auth(accessToken));
  return data;
}

export async function getJourneyTimeline(accessToken, types) {
  const { data } = await client.get("/api/talent/journey", {
    ...auth(accessToken),
    params: types ? { types } : {},
  });
  return data;
}

export async function getAchievements(accessToken) {
  const { data } = await client.get("/api/talent/achievements", auth(accessToken));
  return data;
}

// ─── Internal opportunities (US-095) ──────────────────────────────────────────

export async function browseOpportunities(accessToken, params = {}, { force = false } = {}) {
  const key = CacheKeys.opportunities;
  // Only cache the default recruiter list; filtered/search queries bypass cache.
  const useCache = !params.q && (params.status === "all" || params.status === "open" || !params.status);
  if (!useCache) {
    const { data } = await client.get("/api/talent/opportunities", { ...auth(accessToken), params });
    return data;
  }
  const { data } = await cachedFetch(
    `${key}:${params.status || "open"}`,
    async () => {
      const res = await client.get("/api/talent/opportunities", { ...auth(accessToken), params });
      return res.data;
    },
    { force }
  );
  return data;
}

export async function createOpportunity(accessToken, payload) {
  const { data } = await client.post("/api/talent/opportunities", payload, auth(accessToken));
  invalidateTalentCaches();
  return data;
}

export async function updateOpportunity(accessToken, opportunityId, payload) {
  const { data } = await client.put(
    `/api/talent/opportunities/${encodeURIComponent(opportunityId)}`,
    payload,
    auth(accessToken)
  );
  invalidateTalentCaches();
  return data;
}

export async function applyToOpportunity(accessToken, opportunityId) {
  const { data } = await client.post(
    `/api/talent/opportunities/${encodeURIComponent(opportunityId)}/apply`,
    {},
    auth(accessToken)
  );
  return data;
}

export async function getOpportunityApplicants(accessToken, opportunityId) {
  const { data } = await client.get(
    `/api/talent/opportunities/${encodeURIComponent(opportunityId)}/applicants`,
    auth(accessToken)
  );
  return data;
}

// ─── Competency evaluation (US-099) ───────────────────────────────────────────

export async function submitCompetencyEvaluation(accessToken, employeeId, payload) {
  const { data } = await client.post(
    `/api/talent/competency/${encodeURIComponent(employeeId)}`,
    payload,
    auth(accessToken)
  );
  invalidateTalentCaches();
  return data;
}

export async function getCompetencyHistory(accessToken, employeeId) {
  const { data } = await client.get(`/api/talent/competency/${encodeURIComponent(employeeId)}`, auth(accessToken));
  return data;
}

// ─── Talent search (US-100) ───────────────────────────────────────────────────

export async function searchTalent(accessToken, payload) {
  const { data } = await client.post("/api/talent/search", payload, auth(accessToken));
  return data;
}

// ─── Recruiter talent metrics dashboard (US-102) ──────────────────────────────

export async function getTalentMetrics(accessToken, department, { force = false } = {}) {
  const { data } = await cachedFetch(
    CacheKeys.talentMetrics(department || ""),
    async () => {
      const res = await client.get("/api/talent/metrics", {
        ...auth(accessToken),
        params: department ? { department } : {},
      });
      return res.data;
    },
    { force }
  );
  return data;
}

// ─── Development plan (US-103) ────────────────────────────────────────────────

export async function getDevelopmentPlan(accessToken, employeeId) {
  const { data } = await client.get(`/api/talent/development-plan/${encodeURIComponent(employeeId)}`, auth(accessToken));
  return data;
}

export async function updateDevelopmentPlan(accessToken, employeeId, payload) {
  const { data } = await client.put(
    `/api/talent/development-plan/${encodeURIComponent(employeeId)}`,
    payload,
    auth(accessToken)
  );
  invalidateTalentCaches();
  return data;
}

// ─── 360° profile (US-104) ────────────────────────────────────────────────────

export async function getTalentProfile(accessToken, employeeId) {
  const { data } = await client.get(`/api/talent/profile/${encodeURIComponent(employeeId)}`, auth(accessToken));
  return data;
}

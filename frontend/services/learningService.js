import axios from "axios";

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

// ─── Catalog (US-065 / US-066 / US-072) ──────────────────────────────────────

export async function browseCatalog(accessToken, params = {}) {
  const { data } = await client.get("/api/learning/catalog", { ...auth(accessToken), params });
  return data;
}

export async function getCatalogFacets(accessToken, source = "microsoft_learn") {
  const { data } = await client.get("/api/learning/catalog/facets", { ...auth(accessToken), params: { source } });
  return data;
}

export async function getSoftSkillCategories(accessToken) {
  const { data } = await client.get("/api/learning/catalog/soft-skills/categories", auth(accessToken));
  return data;
}

export async function getCourseDetail(accessToken, uid) {
  const { data } = await client.get(`/api/learning/catalog/${encodeURIComponent(uid)}`, auth(accessToken));
  return data;
}

export async function startCourse(accessToken, uid) {
  const { data } = await client.post(`/api/learning/catalog/${encodeURIComponent(uid)}/start`, {}, auth(accessToken));
  return data;
}

export async function updateCourseProgress(accessToken, uid, payload) {
  const { data } = await client.put(`/api/learning/catalog/${encodeURIComponent(uid)}/progress`, payload, auth(accessToken));
  return data;
}

// ─── My learning (US-069) ────────────────────────────────────────────────────

export async function getLearningDashboard(accessToken) {
  const { data } = await client.get("/api/learning/my/dashboard", auth(accessToken));
  return data;
}

export async function listMyCourses(accessToken, status) {
  const { data } = await client.get("/api/learning/my/courses", {
    ...auth(accessToken),
    params: status ? { status } : {},
  });
  return data;
}

// ─── Bookmarks (US-073) ──────────────────────────────────────────────────────

export async function listBookmarks(accessToken) {
  const { data } = await client.get("/api/learning/bookmarks", auth(accessToken));
  return data;
}

export async function addBookmark(accessToken, payload) {
  const { data } = await client.post("/api/learning/bookmarks", payload, auth(accessToken));
  return data;
}

export async function removeBookmark(accessToken, uid) {
  const { data } = await client.delete(`/api/learning/bookmarks/${encodeURIComponent(uid)}`, auth(accessToken));
  return data;
}

// ─── Certificates ─────────────────────────────────────────────────────────────

export async function uploadCertificate(accessToken, formData) {
  const { data } = await client.post("/api/learning/certificates", formData, {
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function listMyCertificates(accessToken) {
  const { data } = await client.get("/api/learning/certificates", auth(accessToken));
  return data;
}

export async function listPendingCertificates(accessToken) {
  const { data } = await client.get("/api/learning/certificates/pending", auth(accessToken));
  return data;
}

export async function verifyCertificate(accessToken, certificateId, payload) {
  const { data } = await client.put(`/api/learning/certificates/${certificateId}/verify`, payload, auth(accessToken));
  return data;
}

// ─── Skill matrix (US-092 / US-093 / US-094) ─────────────────────────────────

export async function getSkillCategories(accessToken) {
  const { data } = await client.get("/api/learning/skills/categories", auth(accessToken));
  return data;
}

export async function listSkills(accessToken) {
  const { data } = await client.get("/api/learning/skills", auth(accessToken));
  return data;
}

export async function upsertSkill(accessToken, payload) {
  const { data } = await client.post("/api/learning/skills", payload, auth(accessToken));
  return data;
}

export async function assessSkills(accessToken, refresh = false, lazy = false) {
  const { data } = await client.post(
    `/api/learning/skills/assess?refresh=${refresh ? "true" : "false"}&lazy=${lazy ? "true" : "false"}`,
    {},
    auth(accessToken)
  );
  return data;
}

export async function deleteSkill(accessToken, skillId) {
  const { data } = await client.delete(`/api/learning/skills/${skillId}`, auth(accessToken));
  return data;
}

// ─── Skill gap + career path (US-075 / US-095 / US-099 / US-100) ────────────

export async function getSkillGap(accessToken, targetRole, refresh = false) {
  const { data } = await client.get("/api/learning/skill-gap", {
    ...auth(accessToken),
    params: {
      ...(targetRole ? { target_role: targetRole } : {}),
      ...(refresh ? { refresh: true } : {}),
    },
  });
  return data;
}

export async function getCareerGoal(accessToken) {
  const { data } = await client.get("/api/learning/career-goal", auth(accessToken));
  return data;
}

export async function setCareerGoal(accessToken, targetRole) {
  const { data } = await client.post("/api/learning/career-goal", { target_role: targetRole }, auth(accessToken));
  return data;
}

export async function getCareerPath(accessToken, refresh = false) {
  const { data } = await client.get("/api/learning/career-path", { ...auth(accessToken), params: { refresh } });
  return data;
}

export async function getRoleMatches(accessToken, refresh = false) {
  const { data } = await client.get("/api/learning/role-matches", { ...auth(accessToken), params: { refresh } });
  return data;
}

// ─── AI recommendations (US-074) ─────────────────────────────────────────────

export async function getRecommendations(accessToken, refresh = false) {
  const { data } = await client.get("/api/learning/recommendations", { ...auth(accessToken), params: { refresh } });
  return data;
}

// ─── Recruiter Knowledge Base ────────────────────────────────────────────────

export async function listKbRoles(accessToken) {
  const { data } = await client.get("/api/learning/knowledge-base/roles", auth(accessToken));
  return data;
}

export async function createKbRole(accessToken, payload) {
  const { data } = await client.post("/api/learning/knowledge-base/roles", payload, auth(accessToken));
  return data;
}

export async function updateKbRole(accessToken, roleId, payload) {
  const { data } = await client.put(`/api/learning/knowledge-base/roles/${roleId}`, payload, auth(accessToken));
  return data;
}

export async function deleteKbRole(accessToken, roleId) {
  const { data } = await client.delete(`/api/learning/knowledge-base/roles/${roleId}`, auth(accessToken));
  return data;
}

export async function listKbCertifications(accessToken) {
  const { data } = await client.get("/api/learning/knowledge-base/certifications", auth(accessToken));
  return data;
}

export async function createKbCertification(accessToken, payload) {
  const { data } = await client.post("/api/learning/knowledge-base/certifications", payload, auth(accessToken));
  return data;
}

export async function updateKbCertification(accessToken, certId, payload) {
  const { data } = await client.put(`/api/learning/knowledge-base/certifications/${certId}`, payload, auth(accessToken));
  return data;
}

export async function deleteKbCertification(accessToken, certId) {
  const { data } = await client.delete(`/api/learning/knowledge-base/certifications/${certId}`, auth(accessToken));
  return data;
}

// ─── Recruiter: assign, oversight, analytics (US-068 / US-076) ─────────────

export async function assignCourses(accessToken, payload) {
  const { data } = await client.post("/api/learning/assignments", payload, auth(accessToken));
  return data;
}

export async function listAssignments(accessToken, params = {}) {
  const { data } = await client.get("/api/learning/assignments", { ...auth(accessToken), params });
  return data;
}

export async function getEmployeeLearningProfile(accessToken, employeeId, refresh = false) {
  const { data } = await client.get(`/api/learning/employees/${encodeURIComponent(employeeId)}/profile`, {
    ...auth(accessToken),
    params: refresh ? { refresh: true } : {},
  });
  return data;
}

export async function getLearningAnalytics(accessToken) {
  const { data } = await client.get("/api/learning/analytics", auth(accessToken));
  return data;
}

export async function getOrgTaxonomy(accessToken) {
  const { data } = await client.get("/api/learning/org-taxonomy", auth(accessToken));
  return data;
}

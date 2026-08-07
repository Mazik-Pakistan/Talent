import axios from "axios";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

const client = axios.create({
  baseURL: apiBaseUrl,
  headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
});

function auth(accessToken) {
  return { headers: { Authorization: `Bearer ${accessToken}` } };
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

export async function getFrameworkSummary(accessToken) {
  const { data } = await client.get("/api/org-framework/summary", auth(accessToken));
  return data;
}

// ─── Org structure options (single source of truth for dropdowns) ───────────

export async function getOrgStructureOptions(accessToken) {
  const { data } = await client.get("/api/org-framework/options", auth(accessToken));
  return data;
}

// ─── Seed from existing records ───────────────────────────────────────────────

export async function seedOrgFramework(accessToken) {
  const { data } = await client.post("/api/org-framework/seed", null, auth(accessToken));
  return data;
}

// ─── Departments ────────────────────────────────────────────────────────────

export async function listOrgDepartments(accessToken) {
  const { data } = await client.get("/api/org-framework/departments", auth(accessToken));
  return data;
}

export async function createOrgDepartment(accessToken, payload) {
  const { data } = await client.post("/api/org-framework/departments", payload, auth(accessToken));
  return data;
}

export async function updateOrgDepartment(accessToken, name, payload) {
  const { data } = await client.put(`/api/org-framework/departments/${encodeURIComponent(name)}`, payload, auth(accessToken));
  return data;
}

export async function deleteOrgDepartment(accessToken, name) {
  const { data } = await client.delete(`/api/org-framework/departments/${encodeURIComponent(name)}`, auth(accessToken));
  return data;
}

// ─── Roles ──────────────────────────────────────────────────────────────────

export async function listOrgRoles(accessToken, department) {
  const params = department ? { department } : {};
  const { data } = await client.get("/api/org-framework/roles", { ...auth(accessToken), params });
  return data;
}

export async function getOrgRole(accessToken, roleId) {
  const { data } = await client.get(`/api/org-framework/roles/${encodeURIComponent(roleId)}`, auth(accessToken));
  return data;
}

export async function createOrgRole(accessToken, payload) {
  const { data } = await client.post("/api/org-framework/roles", payload, auth(accessToken));
  return data;
}

export async function updateOrgRole(accessToken, roleId, payload) {
  const { data } = await client.put(`/api/org-framework/roles/${encodeURIComponent(roleId)}`, payload, auth(accessToken));
  return data;
}

export async function deleteOrgRole(accessToken, roleId) {
  const { data } = await client.delete(`/api/org-framework/roles/${encodeURIComponent(roleId)}`, auth(accessToken));
  return data;
}

// ─── Skills ─────────────────────────────────────────────────────────────────

export async function listOrgSkills(accessToken, roleName) {
  const params = roleName ? { role_name: roleName } : {};
  const { data } = await client.get("/api/org-framework/skills", { ...auth(accessToken), params });
  return data;
}

export async function createOrgSkill(accessToken, payload) {
  const { data } = await client.post("/api/org-framework/skills", payload, auth(accessToken));
  return data;
}

export async function updateOrgSkill(accessToken, skillId, payload) {
  const { data } = await client.put(`/api/org-framework/skills/${encodeURIComponent(skillId)}`, payload, auth(accessToken));
  return data;
}

export async function deleteOrgSkill(accessToken, skillId) {
  const { data } = await client.delete(`/api/org-framework/skills/${encodeURIComponent(skillId)}`, auth(accessToken));
  return data;
}

// ─── Certifications ─────────────────────────────────────────────────────────

export async function listOrgCertifications(accessToken, roleName) {
  const params = roleName ? { role_name: roleName } : {};
  const { data } = await client.get("/api/org-framework/certifications", { ...auth(accessToken), params });
  return data;
}

export async function createOrgCertification(accessToken, payload) {
  const { data } = await client.post("/api/org-framework/certifications", payload, auth(accessToken));
  return data;
}

export async function updateOrgCertification(accessToken, certId, payload) {
  const { data } = await client.put(`/api/org-framework/certifications/${encodeURIComponent(certId)}`, payload, auth(accessToken));
  return data;
}

export async function deleteOrgCertification(accessToken, certId) {
  const { data } = await client.delete(`/api/org-framework/certifications/${encodeURIComponent(certId)}`, auth(accessToken));
  return data;
}

// ─── Courses ────────────────────────────────────────────────────────────────

export async function listOrgCourses(accessToken) {
  const { data } = await client.get("/api/org-framework/courses", auth(accessToken));
  return data;
}

export async function createOrgCourse(accessToken, payload) {
  const { data } = await client.post("/api/org-framework/courses", payload, auth(accessToken));
  return data;
}

export async function updateOrgCourse(accessToken, courseId, payload) {
  const { data } = await client.put(`/api/org-framework/courses/${encodeURIComponent(courseId)}`, payload, auth(accessToken));
  return data;
}

export async function deleteOrgCourse(accessToken, courseId) {
  const { data } = await client.delete(`/api/org-framework/courses/${encodeURIComponent(courseId)}`, auth(accessToken));
  return data;
}

// ─── Roadmaps ───────────────────────────────────────────────────────────────

export async function listOrgRoadmaps(accessToken, roleName) {
  const params = roleName ? { role_name: roleName } : {};
  const { data } = await client.get("/api/org-framework/roadmaps", { ...auth(accessToken), params });
  return data;
}

export async function createOrgRoadmap(accessToken, payload) {
  const { data } = await client.post("/api/org-framework/roadmaps", payload, auth(accessToken));
  return data;
}

export async function updateOrgRoadmap(accessToken, roadmapId, payload) {
  const { data } = await client.put(`/api/org-framework/roadmaps/${encodeURIComponent(roadmapId)}`, payload, auth(accessToken));
  return data;
}

export async function reorderOrgRoadmap(accessToken, roleName, orderedIds) {
  const { data } = await client.put("/api/org-framework/roadmaps/reorder", { role_name: roleName, ordered_ids: orderedIds }, auth(accessToken));
  return data;
}

export async function deleteOrgRoadmap(accessToken, roadmapId) {
  const { data } = await client.delete(`/api/org-framework/roadmaps/${encodeURIComponent(roadmapId)}`, auth(accessToken));
  return data;
}

// ─── Promotion Rules ────────────────────────────────────────────────────────

export async function listOrgPromotionRules(accessToken) {
  const { data } = await client.get("/api/org-framework/promotion-rules", auth(accessToken));
  return data;
}

export async function upsertOrgPromotionRule(accessToken, payload) {
  const { data } = await client.post("/api/org-framework/promotion-rules", payload, auth(accessToken));
  return data;
}

export async function deleteOrgPromotionRule(accessToken, roleName) {
  const { data } = await client.delete(`/api/org-framework/promotion-rules/${encodeURIComponent(roleName)}`, auth(accessToken));
  return data;
}

// ─── Versions ───────────────────────────────────────────────────────────────

export async function listOrgVersions(accessToken) {
  const { data } = await client.get("/api/org-framework/versions", auth(accessToken));
  return data;
}

export async function createOrgVersion(accessToken, label) {
  const { data } = await client.post("/api/org-framework/versions", { label }, auth(accessToken));
  return data;
}

// ─── Excel Export / Import ──────────────────────────────────────────────────

export async function exportOrgFramework(accessToken) {
  const res = await client.get("/api/org-framework/export", {
    ...auth(accessToken),
    responseType: "blob",
  });
  return res.data;
}

export async function validateOrgFrameworkImport(accessToken, file) {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await client.post("/api/org-framework/import/validate", formData, {
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function applyOrgFrameworkImport(accessToken, importData) {
  const { data } = await client.post("/api/org-framework/import/apply", { data: importData }, auth(accessToken));
  return data;
}

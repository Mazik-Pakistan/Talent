import apiClient from "@/lib/apiClient";

// ─── Dashboard ──────────────────────────────────────────────────────────────

export async function getFrameworkSummary(accessToken) {
  const { data } = await apiClient.get("/api/org-framework/summary");
  return data;
}

// ─── Org structure options (single source of truth for dropdowns) ───────────

export async function getOrgStructureOptions(accessToken) {
  const { data } = await apiClient.get("/api/org-framework/options");
  return data;
}

// ─── Seed from existing records ───────────────────────────────────────────────

export async function seedOrgFramework(accessToken) {
  const { data } = await apiClient.post("/api/org-framework/seed", null);
  return data;
}

// ─── Departments ────────────────────────────────────────────────────────────

export async function listOrgDepartments(accessToken) {
  const { data } = await apiClient.get("/api/org-framework/departments");
  return data;
}

export async function createOrgDepartment(accessToken, payload) {
  const { data } = await apiClient.post("/api/org-framework/departments", payload);
  return data;
}

export async function updateOrgDepartment(accessToken, name, payload) {
  const { data } = await apiClient.put(`/api/org-framework/departments/${encodeURIComponent(name)}`, payload);
  return data;
}

export async function deleteOrgDepartment(accessToken, name) {
  const { data } = await apiClient.delete(`/api/org-framework/departments/${encodeURIComponent(name)}`);
  return data;
}

// ─── Roles ──────────────────────────────────────────────────────────────────

export async function listOrgRoles(accessToken, department) {
  const params = department ? { department } : {};
  const { data } = await apiClient.get("/api/org-framework/roles", { params });
  return data;
}

export async function getOrgRole(accessToken, roleId) {
  const { data } = await apiClient.get(`/api/org-framework/roles/${encodeURIComponent(roleId)}`);
  return data;
}

export async function createOrgRole(accessToken, payload) {
  const { data } = await apiClient.post("/api/org-framework/roles", payload);
  return data;
}

export async function updateOrgRole(accessToken, roleId, payload) {
  const { data } = await apiClient.put(`/api/org-framework/roles/${encodeURIComponent(roleId)}`, payload);
  return data;
}

export async function deleteOrgRole(accessToken, roleId) {
  const { data } = await apiClient.delete(`/api/org-framework/roles/${encodeURIComponent(roleId)}`);
  return data;
}

// ─── Skills ─────────────────────────────────────────────────────────────────

export async function listOrgSkills(accessToken, roleName) {
  const params = roleName ? { role_name: roleName } : {};
  const { data } = await apiClient.get("/api/org-framework/skills", { params });
  return data;
}

export async function createOrgSkill(accessToken, payload) {
  const { data } = await apiClient.post("/api/org-framework/skills", payload);
  return data;
}

export async function updateOrgSkill(accessToken, skillId, payload) {
  const { data } = await apiClient.put(`/api/org-framework/skills/${encodeURIComponent(skillId)}`, payload);
  return data;
}

export async function deleteOrgSkill(accessToken, skillId) {
  const { data } = await apiClient.delete(`/api/org-framework/skills/${encodeURIComponent(skillId)}`);
  return data;
}

// ─── Certifications ─────────────────────────────────────────────────────────

export async function listOrgCertifications(accessToken, roleName) {
  const params = roleName ? { role_name: roleName } : {};
  const { data } = await apiClient.get("/api/org-framework/certifications", { params });
  return data;
}

export async function createOrgCertification(accessToken, payload) {
  const { data } = await apiClient.post("/api/org-framework/certifications", payload);
  return data;
}

export async function updateOrgCertification(accessToken, certId, payload) {
  const { data } = await apiClient.put(`/api/org-framework/certifications/${encodeURIComponent(certId)}`, payload);
  return data;
}

export async function deleteOrgCertification(accessToken, certId) {
  const { data } = await apiClient.delete(`/api/org-framework/certifications/${encodeURIComponent(certId)}`);
  return data;
}

// ─── Courses ────────────────────────────────────────────────────────────────

export async function listOrgCourses(accessToken) {
  const { data } = await apiClient.get("/api/org-framework/courses");
  return data;
}

export async function createOrgCourse(accessToken, payload) {
  const { data } = await apiClient.post("/api/org-framework/courses", payload);
  return data;
}

export async function updateOrgCourse(accessToken, courseId, payload) {
  const { data } = await apiClient.put(`/api/org-framework/courses/${encodeURIComponent(courseId)}`, payload);
  return data;
}

export async function deleteOrgCourse(accessToken, courseId) {
  const { data } = await apiClient.delete(`/api/org-framework/courses/${encodeURIComponent(courseId)}`);
  return data;
}

// ─── Roadmaps ───────────────────────────────────────────────────────────────

export async function listOrgRoadmaps(accessToken, roleName) {
  const params = roleName ? { role_name: roleName } : {};
  const { data } = await apiClient.get("/api/org-framework/roadmaps", { params });
  return data;
}

export async function createOrgRoadmap(accessToken, payload) {
  const { data } = await apiClient.post("/api/org-framework/roadmaps", payload);
  return data;
}

export async function updateOrgRoadmap(accessToken, roadmapId, payload) {
  const { data } = await apiClient.put(`/api/org-framework/roadmaps/${encodeURIComponent(roadmapId)}`, payload);
  return data;
}

export async function reorderOrgRoadmap(accessToken, roleName, orderedIds) {
  const { data } = await apiClient.put("/api/org-framework/roadmaps/reorder", { role_name: roleName, ordered_ids: orderedIds });
  return data;
}

export async function deleteOrgRoadmap(accessToken, roadmapId) {
  const { data } = await apiClient.delete(`/api/org-framework/roadmaps/${encodeURIComponent(roadmapId)}`);
  return data;
}

// ─── Promotion Rules ────────────────────────────────────────────────────────

export async function listOrgPromotionRules(accessToken) {
  const { data } = await apiClient.get("/api/org-framework/promotion-rules");
  return data;
}

export async function upsertOrgPromotionRule(accessToken, payload) {
  const { data } = await apiClient.post("/api/org-framework/promotion-rules", payload);
  return data;
}

export async function deleteOrgPromotionRule(accessToken, roleName, department = null) {
  const { data } = await apiClient.delete(
    `/api/org-framework/promotion-rules/${encodeURIComponent(roleName)}`,
    { params: department ? { department } : undefined },
  );
  return data;
}

// ─── Versions ───────────────────────────────────────────────────────────────

export async function listOrgVersions(accessToken) {
  const { data } = await apiClient.get("/api/org-framework/versions");
  return data;
}

export async function createOrgVersion(accessToken, label) {
  const { data } = await apiClient.post("/api/org-framework/versions", { label });
  return data;
}

// ─── Excel Export / Import ──────────────────────────────────────────────────

export async function exportOrgFramework(accessToken) {
  const res = await apiClient.get("/api/org-framework/export", {
    responseType: "blob",
  });
  return res.data;
}

export async function validateOrgFrameworkImport(accessToken, file) {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await apiClient.post("/api/org-framework/import/validate", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function applyOrgFrameworkImport(accessToken, importData) {
  const { data } = await apiClient.post("/api/org-framework/import/apply", { data: importData });
  return data;
}

// ─── Email Templates ────────────────────────────────────────────────────────

export async function listEmailTemplates() {
  const { data } = await apiClient.get("/api/email-templates");
  return data;
}

export async function getEmailTemplate(key) {
  const { data } = await apiClient.get(`/api/email-templates/${encodeURIComponent(key)}`);
  return data;
}

export async function saveEmailTemplate(key, payload) {
  const { data } = await apiClient.put(`/api/email-templates/${encodeURIComponent(key)}`, payload);
  return data;
}

export async function resetEmailTemplate(key) {
  const { data } = await apiClient.delete(`/api/email-templates/${encodeURIComponent(key)}`);
  return data;
}

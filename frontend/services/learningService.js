import apiClient from "@/lib/apiClient";
import { CacheKeys, cachedFetch, invalidateCache, invalidateCachePrefix } from "@/utils/recruiterCache";

const LEARNING_PROVIDERS_UPDATED_EVENT = "learning-providers-updated";
const LEARNING_PROVIDERS_UPDATED_STORAGE_KEY = "learning-providers-updated-at";

function notifyLearningProvidersUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(LEARNING_PROVIDERS_UPDATED_EVENT));
  try {
    window.localStorage.setItem(LEARNING_PROVIDERS_UPDATED_STORAGE_KEY, String(Date.now()));
  } catch {
    // Ignore storage errors in private / restricted sessions.
  }
}

/** Invalidate learning caches after cert verification / KB edits / assignments. */
export function invalidateLearningCaches() {
  invalidateCachePrefix("learning-");
  invalidateCache(CacheKeys.taxonomy);
  invalidateCachePrefix("talent-metrics");
}

// ─── Catalog (US-065 / US-066 / US-072) ──────────────────────────────────────

export async function browseCatalog(accessToken, params = {}) {
  const { data } = await apiClient.get("/api/learning/catalog", { params });
  return data;
}

export async function listManagedCourses(accessToken, params = {}) {
  const { data } = await apiClient.get("/api/learning/managed/courses", { params });
  return data;
}

export async function getManagedFacets(accessToken) {
  const { data } = await apiClient.get("/api/learning/managed/facets");
  return data;
}

export async function listManagedProviders(accessToken) {
  const { data } = await apiClient.get("/api/learning/managed/providers");
  return data;
}

export async function createManagedProvider(accessToken, name) {
  const { data } = await apiClient.post("/api/learning/managed/providers", { name });
  invalidateLearningCaches();
  notifyLearningProvidersUpdated();
  return data;
}

export async function getCatalogFacets(accessToken, source = "microsoft_learn") {
  const { data } = await apiClient.get("/api/learning/catalog/facets", { params: { source } });
  return data;
}

export async function getSoftSkillCategories(accessToken) {
  const { data } = await apiClient.get("/api/learning/catalog/soft-skills/categories");
  return data;
}

export async function getCourseDetail(accessToken, uid) {
  const { data } = await apiClient.get(`/api/learning/catalog/${encodeURIComponent(uid)}`);
  return data;
}

export async function startCourse(accessToken, uid) {
  const { data } = await apiClient.post(`/api/learning/catalog/${encodeURIComponent(uid)}/start`, {});
  return data;
}

export async function updateCourseProgress(accessToken, uid, payload) {
  const { data } = await apiClient.put(`/api/learning/catalog/${encodeURIComponent(uid)}/progress`, payload);
  return data;
}

// ─── My learning (US-069) ────────────────────────────────────────────────────

export async function getLearningDashboard(accessToken) {
  const { data } = await apiClient.get("/api/learning/my/dashboard");
  return data;
}

export async function listMyCourses(accessToken, status) {
  const { data } = await apiClient.get("/api/learning/my/courses", {
    params: status ? { status } : {},
  });
  return data;
}

// ─── Bookmarks (US-073) ──────────────────────────────────────────────────────

export async function listBookmarks(accessToken) {
  const { data } = await apiClient.get("/api/learning/bookmarks");
  return data;
}

export async function addBookmark(accessToken, payload) {
  const { data } = await apiClient.post("/api/learning/bookmarks", payload);
  return data;
}

export async function removeBookmark(accessToken, uid) {
  const { data } = await apiClient.delete(`/api/learning/bookmarks/${encodeURIComponent(uid)}`);
  return data;
}

// ─── Certificates ─────────────────────────────────────────────────────────────

export async function uploadCertificate(accessToken, formData) {
  const { data } = await apiClient.post("/api/learning/certificates", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function listMyCertificates(accessToken) {
  const { data } = await apiClient.get("/api/learning/certificates");
  return data;
}

export async function listPendingCertificates(accessToken) {
  const { data } = await apiClient.get("/api/learning/certificates/pending");
  return data;
}

export async function verifyCertificate(accessToken, certificateId, payload) {
  const { data } = await apiClient.put(`/api/learning/certificates/${certificateId}/verify`, payload);
  invalidateLearningCaches();
  return data;
}

export async function deleteCertificate(accessToken, certificateId) {
  const { data } = await apiClient.delete(`/api/learning/certificates/${certificateId}`);
  invalidateLearningCaches();
  return data;
}

export async function updateCertificate(accessToken, certificateId, payload) {
  const { data } = await apiClient.put(`/api/learning/certificates/${certificateId}`, payload);
  invalidateLearningCaches();
  return data;
}

// ─── Skill matrix (US-092 / US-093 / US-094) ─────────────────────────────────

export async function getSkillCategories(accessToken) {
  const { data } = await apiClient.get("/api/learning/skills/categories");
  return data;
}

export async function listSkills(accessToken) {
  const { data } = await apiClient.get("/api/learning/skills");
  return data;
}

export async function upsertSkill(accessToken, payload) {
  const { data } = await apiClient.post("/api/learning/skills", payload);
  return data;
}

export async function assessSkills(accessToken, refresh = false, lazy = false) {
  const { data } = await apiClient.post(
    `/api/learning/skills/assess?refresh=${refresh ? "true" : "false"}&lazy=${lazy ? "true" : "false"}`,
    {}
  );
  return data;
}

export async function deleteSkill(accessToken, skillId) {
  const { data } = await apiClient.delete(`/api/learning/skills/${skillId}`);
  return data;
}

// ─── Skill gap + career path (US-075 / US-095 / US-099 / US-100) ────────────

export async function getSkillGap(accessToken, targetRole, refresh = false) {
  const { data } = await apiClient.get("/api/learning/skill-gap", {
    params: {
      ...(targetRole ? { target_role: targetRole } : {}),
      ...(refresh ? { refresh: true } : {}),
    },
  });
  return data;
}

export async function getCareerGoal(accessToken) {
  const { data } = await apiClient.get("/api/learning/career-goal");
  return data;
}

export async function setCareerGoal(accessToken, targetRole) {
  const { data } = await apiClient.post("/api/learning/career-goal", { target_role: targetRole });
  return data;
}

export async function getCareerPath(accessToken, refresh = false) {
  const { data } = await apiClient.get("/api/learning/career-path", { params: { refresh } });
  return data;
}

export async function getRoleMatches(accessToken, refresh = false) {
  const { data } = await apiClient.get("/api/learning/role-matches", { params: { refresh } });
  return data;
}

// ─── AI recommendations (US-074) ─────────────────────────────────────────────

export async function getRecommendations(accessToken, refresh = false) {
  const { data } = await apiClient.get("/api/learning/recommendations", { params: { refresh } });
  return data;
}

// ─── Recruiter Knowledge Base ────────────────────────────────────────────────

export async function listKbRoles(accessToken) {
  const { data } = await apiClient.get("/api/learning/knowledge-base/roles");
  return data;
}

export async function createKbRole(accessToken, payload) {
  const { data } = await apiClient.post("/api/learning/knowledge-base/roles", payload);
  invalidateLearningCaches();
  return data;
}

export async function updateKbRole(accessToken, roleId, payload) {
  const { data } = await apiClient.put(`/api/learning/knowledge-base/roles/${roleId}`, payload);
  invalidateLearningCaches();
  return data;
}

export async function deleteKbRole(accessToken, roleId) {
  const { data } = await apiClient.delete(`/api/learning/knowledge-base/roles/${roleId}`);
  invalidateLearningCaches();
  return data;
}

export async function listKbCertifications(accessToken) {
  const { data } = await apiClient.get("/api/learning/knowledge-base/certifications");
  return data;
}

export async function createKbCertification(accessToken, payload) {
  const { data } = await apiClient.post("/api/learning/knowledge-base/certifications", payload);
  invalidateLearningCaches();
  return data;
}

export async function updateKbCertification(accessToken, certId, payload) {
  const { data } = await apiClient.put(`/api/learning/knowledge-base/certifications/${certId}`, payload);
  invalidateLearningCaches();
  return data;
}

export async function deleteKbCertification(accessToken, certId) {
  const { data } = await apiClient.delete(`/api/learning/knowledge-base/certifications/${certId}`);
  invalidateLearningCaches();
  return data;
}

// ─── Recruiter: assign, oversight, analytics (US-067 / US-073) ─────────────

export async function assignCourses(accessToken, payload) {
  const { data } = await apiClient.post("/api/learning/assignments", payload);
  invalidateCachePrefix("learning-assignments");
  invalidateCachePrefix("learning-analytics");
  invalidateCachePrefix("talent-metrics");
  return data;
}

export async function listAssignments(accessToken, params = {}, { force = false } = {}) {
  const status = params.status || "";
  const mandatory = Boolean(params.mandatory);
  const key = CacheKeys.assignments(status, mandatory);
  const { data } = await cachedFetch(
    key,
    async () => {
      const res = await apiClient.get("/api/learning/assignments", { params });
      return res.data;
    },
    { force }
  );
  return data;
}

export async function getEmployeeLearningProfile(accessToken, employeeId, refresh = false) {
  const { data } = await apiClient.get(`/api/learning/employees/${encodeURIComponent(employeeId)}/profile`, {
    params: refresh ? { refresh: true } : {},
  });
  return data;
}

export async function getLearningAnalytics(accessToken, department, { force = false } = {}) {
  const key = CacheKeys.analytics(department || "");
  const { data } = await cachedFetch(
    key,
    async () => {
      const res = await apiClient.get("/api/learning/analytics", {
        params: department ? { department } : {},
      });
      return res.data;
    },
    { force }
  );
  return data;
}

export async function createManagedCourse(accessToken, payload) {
  const { data } = await apiClient.post("/api/learning/managed/courses", payload);
  invalidateLearningCaches();
  notifyLearningProvidersUpdated();
  return data;
}

export async function updateManagedCourse(accessToken, courseId, payload) {
  const { data } = await apiClient.put(`/api/learning/managed/courses/${courseId}`, payload);
  invalidateLearningCaches();
  notifyLearningProvidersUpdated();
  return data;
}

export async function archiveManagedCourse(accessToken, courseId) {
  const { data } = await apiClient.post(`/api/learning/managed/courses/${courseId}/archive`, {});
  invalidateLearningCaches();
  return data;
}

export async function restoreManagedCourse(accessToken, courseId) {
  const { data } = await apiClient.post(`/api/learning/managed/courses/${courseId}/restore`, {});
  invalidateLearningCaches();
  return data;
}

export async function deleteManagedCourse(accessToken, courseId) {
  const { data } = await apiClient.delete(`/api/learning/managed/courses/${courseId}`);
  invalidateLearningCaches();
  notifyLearningProvidersUpdated();
  return data;
}

export async function bulkManagedCourseAction(accessToken, courseIds, action) {
  const { data } = await apiClient.post(
    "/api/learning/managed/courses-bulk/action",
    { course_ids: courseIds, action }
  );
  invalidateLearningCaches();
  notifyLearningProvidersUpdated();
  return data;
}

async function postManagedImport(url, file, accessToken) {
  const formData = new FormData();
  formData.append("file", file, file?.name || "learning-roadmap.xlsx");
  const { data } = await apiClient.post(url, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function previewManagedImport(file, accessToken, provider) {
  const formData = new FormData();
  formData.append("file", file, file?.name || "learning-roadmap.xlsx");
  if (provider) formData.append("provider", provider);
  const { data } = await apiClient.post("/api/learning/managed/import/preview", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function commitManagedImport(file, accessToken, provider) {
  const formData = new FormData();
  formData.append("file", file, file?.name || "learning-roadmap.xlsx");
  if (provider) formData.append("provider", provider);
  const { data } = await apiClient.post("/api/learning/managed/import/commit", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  invalidateLearningCaches();
  notifyLearningProvidersUpdated();
  return data;
}

export async function getOrgTaxonomy(accessToken, { force = false } = {}) {
  const { data } = await cachedFetch(
    CacheKeys.taxonomy,
    async () => {
      const res = await apiClient.get("/api/learning/org-taxonomy");
      return res.data;
    },
    { force }
  );
  return data;
}

export async function addDepartment(accessToken, name) {
  const { data } = await apiClient.post(
    "/api/learning/org-taxonomy/departments",
    { name }
  );
  invalidateLearningCaches();
  return data;
}

export async function updateDepartment(accessToken, oldName, newName) {
  const { data } = await apiClient.put(
    "/api/learning/org-taxonomy/departments",
    { old_name: oldName, new_name: newName }
  );
  invalidateLearningCaches();
  return data;
}

export async function deleteDepartment(accessToken, name) {
  const { data } = await apiClient.delete(
    `/api/learning/org-taxonomy/departments/${encodeURIComponent(name)}`
  );
  invalidateLearningCaches();
  return data;
}

// ─── Catalog sources (dynamic provider tabs) ────────────────────────────────

export async function getCatalogSources(accessToken) {
  const { data } = await apiClient.get("/api/learning/catalog/sources");
  return data;
}

// ─── Generic provider management (Phase 1) ──────────────────────────────────

export async function listProviders(accessToken, params = {}) {
  const { data } = await apiClient.get("/api/learning/providers", { params });
  return data;
}

export async function getProvider(accessToken, providerId) {
  const { data } = await apiClient.get(`/api/learning/providers/${providerId}`);
  return data;
}

export async function createProvider(accessToken, payload) {
  const { data } = await apiClient.post("/api/learning/providers", payload);
  invalidateCachePrefix("learning-providers");
  invalidateCachePrefix("learning-");
  notifyLearningProvidersUpdated();
  return data;
}

export async function updateProvider(accessToken, providerId, payload) {
  const { data } = await apiClient.put(`/api/learning/providers/${providerId}`, payload);
  invalidateCachePrefix("learning-providers");
  invalidateCachePrefix("learning-");
  notifyLearningProvidersUpdated();
  return data;
}

export async function deleteProvider(accessToken, providerId, force = false) {
  const { data } = await apiClient.delete(`/api/learning/providers/${providerId}`, {
    params: force ? { force: "true" } : {},
  });
  invalidateCachePrefix("learning-providers");
  invalidateCachePrefix("learning-");
  notifyLearningProvidersUpdated();
  return data;
}

export async function activateProvider(accessToken, providerId) {
  const { data } = await apiClient.post(`/api/learning/providers/${providerId}/activate`, {});
  invalidateCachePrefix("learning-providers");
  invalidateCachePrefix("learning-");
  notifyLearningProvidersUpdated();
  return data;
}

export async function deactivateProvider(accessToken, providerId) {
  const { data } = await apiClient.post(`/api/learning/providers/${providerId}/deactivate`, {});
  invalidateCachePrefix("learning-providers");
  invalidateCachePrefix("learning-");
  notifyLearningProvidersUpdated();
  return data;
}

// ─── Universal import engine (Phase 2) ────────────────────────────────────

async function postImportFile(url, accessToken, { file, providerId, providerName, missingAction }) {
  const formData = new FormData();
  formData.append("file", file, file?.name || "course-catalog.xlsx");
  if (providerId) formData.append("provider_id", providerId);
  if (providerName) formData.append("provider_name", providerName);
  if (missingAction) formData.append("missing_action", missingAction);
  const { data } = await apiClient.post(url, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function previewImport(accessToken, opts) {
  return postImportFile("/api/learning/import/preview", accessToken, opts);
}

export async function commitImport(accessToken, opts) {
  const data = await postImportFile("/api/learning/import/commit", accessToken, opts);
  invalidateLearningCaches();
  invalidateCachePrefix("learning-providers");
  notifyLearningProvidersUpdated();
  return data;
}

export async function rollbackImport(accessToken, historyId) {
  const { data } = await apiClient.post(`/api/learning/import/${historyId}/rollback`, {});
  invalidateLearningCaches();
  invalidateCachePrefix("learning-providers");
  notifyLearningProvidersUpdated();
  return data;
}

export async function listImportHistory(accessToken, params = {}) {
  const { data } = await apiClient.get("/api/learning/import/history", { params });
  return data;
}

export async function getImportHistory(accessToken, historyId) {
  const { data } = await apiClient.get(`/api/learning/import/history/${historyId}`);
  return data;
}

export async function downloadImportReport(accessToken, historyId) {
  const { data } = await apiClient.get(`/api/learning/import/history/${historyId}/report`, {
    responseType: "blob",
  });
  return data;
}

export async function syncProviderFromApi(accessToken, providerId, missingAction = "keep") {
  const formData = new FormData();
  formData.append("missing_action", missingAction);
  const { data } = await apiClient.post(`/api/learning/import/providers/${providerId}/sync`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  invalidateLearningCaches();
  invalidateCachePrefix("learning-providers");
  notifyLearningProvidersUpdated();
  return data;
}

// ─── Designation requirements & readiness ────────────────────────────────────

export async function getDesignationRequirements(accessToken, targetRole) {
  const { data } = await apiClient.get("/api/learning/designation/requirements", {
    params: { target_role: targetRole },
  });
  return data;
}

export async function getDesignationReadiness(accessToken, targetRole) {
  const { data } = await apiClient.get("/api/learning/designation/readiness", {
    params: targetRole ? { target_role: targetRole } : {},
  });
  return data;
}

export async function getEmployeeDesignationReadiness(accessToken, employeeId, targetRole) {
  const { data } = await apiClient.get(`/api/learning/employees/${employeeId}/designation-readiness`, {
    params: targetRole ? { target_role: targetRole } : {},
  });
  return data;
}

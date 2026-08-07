import apiClient from "@/lib/apiClient";

// ─── Career Tracks ──────────────────────────────────────────────────────────

export async function listCareerTracks(accessToken, department = null) {
  const params = {};
  if (department) params.department = department;
  const { data } = await apiClient.get("/api/career-framework/tracks", { params });
  return data;
}

export async function getCareerTrack(accessToken, trackId) {
  const { data } = await apiClient.get(`/api/career-framework/tracks/${trackId}`);
  return data;
}

export async function createCareerTrack(accessToken, payload) {
  const { data } = await apiClient.post("/api/career-framework/tracks", payload);
  return data;
}

export async function updateCareerTrack(accessToken, trackId, payload) {
  const { data } = await apiClient.put(`/api/career-framework/tracks/${trackId}`, payload);
  return data;
}

export async function deleteCareerTrack(accessToken, trackId) {
  const { data } = await apiClient.delete(`/api/career-framework/tracks/${trackId}`);
  return data;
}

// ─── Career Levels ──────────────────────────────────────────────────────────

export async function listCareerLevels(accessToken, department = null, trackId = null) {
  const params = {};
  if (department) params.department = department;
  if (trackId) params.track_id = trackId;
  const { data } = await apiClient.get("/api/career-framework/levels", { params });
  return data;
}

export async function getCareerLevel(accessToken, levelId) {
  const { data } = await apiClient.get(`/api/career-framework/levels/${levelId}`);
  return data;
}

export async function createCareerLevel(accessToken, payload) {
  const { data } = await apiClient.post("/api/career-framework/levels", payload);
  return data;
}

export async function updateCareerLevel(accessToken, levelId, payload) {
  const { data } = await apiClient.put(`/api/career-framework/levels/${levelId}`, payload);
  return data;
}

export async function deleteCareerLevel(accessToken, levelId) {
  const { data } = await apiClient.delete(`/api/career-framework/levels/${levelId}`);
  return data;
}

// ─── Employee Career Assignment ─────────────────────────────────────────────

export async function assignEmployeeCareer(accessToken, employeeId, payload) {
  const { data } = await apiClient.post(`/api/career-framework/employees/${employeeId}/assign`, {
    employee_id: employeeId,
    ...payload,
  });
  return data;
}

export async function getEmployeeCareer(accessToken, employeeId) {
  const { data } = await apiClient.get(`/api/career-framework/employees/${employeeId}`);
  return data;
}

export async function updateEmployeeCareer(accessToken, employeeId, payload) {
  const { data } = await apiClient.put(`/api/career-framework/employees/${employeeId}`, payload);
  return data;
}

export async function logCareerDiscussion(accessToken, employeeId, payload) {
  const { data } = await apiClient.post(`/api/career-framework/employees/${employeeId}/discussion`, payload);
  return data;
}

export async function bulkAssignCareer(accessToken, payload) {
  const { data } = await apiClient.post("/api/career-framework/bulk-assign", payload);
  return data;
}

export async function listCareerAssignments(accessToken, department = null, status = null) {
  const params = {};
  if (department) params.department = department;
  if (status) params.status = status;
  const { data } = await apiClient.get("/api/career-framework/assignments", { params });
  return data;
}

// ─── Employee Self-Service ─────────────────────────────────────────────────

export async function getMyCareer(accessToken) {
  const { data } = await apiClient.get("/api/career-framework/my-career");
  return data;
}

export async function getMyCareerProgress(accessToken) {
  const { data } = await apiClient.get("/api/career-framework/my-career/progress");
  return data;
}

// ─── Reports ────────────────────────────────────────────────────────────────

export async function getPromotionReadiness(accessToken, department = null) {
  const params = {};
  if (department) params.department = department;
  const { data } = await apiClient.get("/api/career-framework/reports/promotion-readiness", { params });
  return data;
}

export async function getCareerProgressReport(accessToken) {
  const { data } = await apiClient.get("/api/career-framework/reports/career-progress");
  return data;
}

// ─── CSV Import/Export ──────────────────────────────────────────────────────

export async function exportCareerFramework(accessToken) {
  const { data } = await apiClient.get("/api/career-framework/export", {
    responseType: "blob",
  });
  return data;
}

export async function importCareerFramework(accessToken, file) {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await apiClient.post("/api/career-framework/import", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  return data;
}

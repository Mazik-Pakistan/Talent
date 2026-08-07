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

// ─── Career Tracks ──────────────────────────────────────────────────────────

export async function listCareerTracks(accessToken, department = null) {
  const params = {};
  if (department) params.department = department;
  const { data } = await client.get("/api/career-framework/tracks", { ...auth(accessToken), params });
  return data;
}

export async function getCareerTrack(accessToken, trackId) {
  const { data } = await client.get(`/api/career-framework/tracks/${trackId}`, auth(accessToken));
  return data;
}

export async function createCareerTrack(accessToken, payload) {
  const { data } = await client.post("/api/career-framework/tracks", payload, auth(accessToken));
  return data;
}

export async function updateCareerTrack(accessToken, trackId, payload) {
  const { data } = await client.put(`/api/career-framework/tracks/${trackId}`, payload, auth(accessToken));
  return data;
}

export async function deleteCareerTrack(accessToken, trackId) {
  const { data } = await client.delete(`/api/career-framework/tracks/${trackId}`, auth(accessToken));
  return data;
}

// ─── Career Levels ──────────────────────────────────────────────────────────

export async function listCareerLevels(accessToken, department = null, trackId = null) {
  const params = {};
  if (department) params.department = department;
  if (trackId) params.track_id = trackId;
  const { data } = await client.get("/api/career-framework/levels", { ...auth(accessToken), params });
  return data;
}

export async function getCareerLevel(accessToken, levelId) {
  const { data } = await client.get(`/api/career-framework/levels/${levelId}`, auth(accessToken));
  return data;
}

export async function createCareerLevel(accessToken, payload) {
  const { data } = await client.post("/api/career-framework/levels", payload, auth(accessToken));
  return data;
}

export async function updateCareerLevel(accessToken, levelId, payload) {
  const { data } = await client.put(`/api/career-framework/levels/${levelId}`, payload, auth(accessToken));
  return data;
}

export async function deleteCareerLevel(accessToken, levelId) {
  const { data } = await client.delete(`/api/career-framework/levels/${levelId}`, auth(accessToken));
  return data;
}

// ─── Employee Career Assignment ─────────────────────────────────────────────

export async function assignEmployeeCareer(accessToken, employeeId, payload) {
  const { data } = await client.post(`/api/career-framework/employees/${employeeId}/assign`, {
    employee_id: employeeId,
    ...payload,
  }, auth(accessToken));
  return data;
}

export async function getEmployeeCareer(accessToken, employeeId) {
  const { data } = await client.get(`/api/career-framework/employees/${employeeId}`, auth(accessToken));
  return data;
}

export async function updateEmployeeCareer(accessToken, employeeId, payload) {
  const { data } = await client.put(`/api/career-framework/employees/${employeeId}`, payload, auth(accessToken));
  return data;
}

export async function logCareerDiscussion(accessToken, employeeId, payload) {
  const { data } = await client.post(`/api/career-framework/employees/${employeeId}/discussion`, payload, auth(accessToken));
  return data;
}

export async function bulkAssignCareer(accessToken, payload) {
  const { data } = await client.post("/api/career-framework/bulk-assign", payload, auth(accessToken));
  return data;
}

export async function listCareerAssignments(accessToken, department = null, status = null) {
  const params = {};
  if (department) params.department = department;
  if (status) params.status = status;
  const { data } = await client.get("/api/career-framework/assignments", { ...auth(accessToken), params });
  return data;
}

// ─── Employee Self-Service ─────────────────────────────────────────────────

export async function getMyCareer(accessToken) {
  const { data } = await client.get("/api/career-framework/my-career", auth(accessToken));
  return data;
}

export async function getMyCareerProgress(accessToken) {
  const { data } = await client.get("/api/career-framework/my-career/progress", auth(accessToken));
  return data;
}

// ─── Reports ────────────────────────────────────────────────────────────────

export async function getPromotionReadiness(accessToken, department = null) {
  const params = {};
  if (department) params.department = department;
  const { data } = await client.get("/api/career-framework/reports/promotion-readiness", { ...auth(accessToken), params });
  return data;
}

export async function getCareerProgressReport(accessToken) {
  const { data } = await client.get("/api/career-framework/reports/career-progress", auth(accessToken));
  return data;
}

// ─── CSV Import/Export ──────────────────────────────────────────────────────

export async function exportCareerFramework(accessToken) {
  const { data } = await client.get("/api/career-framework/export", {
    ...auth(accessToken),
    responseType: "blob",
  });
  return data;
}

export async function importCareerFramework(accessToken, file) {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await client.post("/api/career-framework/import", formData, {
    ...auth(accessToken),
    headers: {
      ...auth(accessToken).headers,
      "Content-Type": "multipart/form-data",
    },
  });
  return data;
}

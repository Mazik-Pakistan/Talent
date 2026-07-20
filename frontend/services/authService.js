import axios from "axios";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

if (!apiBaseUrl) {
  throw new Error("NEXT_PUBLIC_API_BASE_URL must be configured.");
}

const apiClient = axios.create({
  baseURL: apiBaseUrl,
  headers: {
    "Content-Type": "application/json",
    // ngrok's free tunnel can serve an interstitial page to browser requests.
    // This header makes API requests pass through to the FastAPI application.
    "ngrok-skip-browser-warning": "true",
  },
});

// ─── Registration ────────────────────────────────────────────────────────────

export async function register(payload) {
  const { data } = await apiClient.post("/api/auth/register", payload);
  return data;
}

export async function candidateRegister(payload) {
  const { data } = await apiClient.post("/api/auth/candidate/register", payload);
  return data;
}

// ─── OTP Verification ────────────────────────────────────────────────────────

/**
 * Verify signup OTP.
 * @param {string} email
 * @param {string} otp  6-digit code
 */
export async function verifyOtp(email, otp) {
  const { data } = await apiClient.post("/api/auth/verify-otp", { email, otp });
  return data;
}

/**
 * Legacy alias — now routes to the OTP endpoint when email+otp are provided.
 * Kept so existing pages that import verifyEmail continue to work.
 */
export async function verifyEmail(email, otp) {
  return verifyOtp(email, otp);
}

// ─── Resend OTP ──────────────────────────────────────────────────────────────

export async function resendOtp(email) {
  const { data } = await apiClient.post("/api/auth/resend-otp", { email });
  return data;
}

/** Backward-compatible alias */
export async function resendVerification(email) {
  return resendOtp(email);
}

// ─── Login ───────────────────────────────────────────────────────────────────

export async function login(payload) {
  const { data } = await apiClient.post("/api/auth/login", payload);
  return data;
}

// ─── Logout ──────────────────────────────────────────────────────────────────

/**
 * US-008: Ask the server to revoke the session (refresh token) and record an audit log.
 * Best-effort — if the network call fails we still clear the local session.
 */
export async function logout(accessToken) {
  if (!accessToken) return;
  try {
    await apiClient.post(
      "/api/auth/logout",
      {},
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
  } catch {
    // Ignore — local session is cleared regardless by the caller.
  }
}

/** Clears every piece of session state stored in the browser. */
export function clearLocalSession() {
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
  localStorage.removeItem("user");
  localStorage.removeItem("session_last_active");
}

// ─── Super Admin Bootstrap ───────────────────────────────────────────────────

export async function bootstrapSuperAdmin(payload) {
  const { data } = await apiClient.post("/api/auth/bootstrap-super-admin", payload);
  return data;
}

// ─── Token Refresh ───────────────────────────────────────────────────────────

export async function refreshToken(refreshTokenValue) {
  const { data } = await apiClient.post("/api/auth/refresh", { refresh_token: refreshTokenValue });
  return data;
}

// ─── Forgot / Reset Password ─────────────────────────────────────────────────

/**
 * Send OTP to user's email for password reset.
 */
export async function forgotPassword(email) {
  const { data } = await apiClient.post("/api/auth/forgot-password", { email });
  return data;
}

/**
 * Reset password using OTP code.
 * @param {{ email: string, otp: string, password: string, confirm_password: string }} payload
 */
export async function resetPassword(payload) {
  const { data } = await apiClient.post("/api/auth/reset-password", payload);
  return data;
}

/**
 * Change password (authenticated user).
 * @param {{ current_password: string, new_password: string, confirm_new_password: string }} payload
 * @param {string} accessToken
 */
export async function changePassword(payload, accessToken) {
  const { data } = await apiClient.post("/api/auth/change-password", payload, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

// ─── Invitations ─────────────────────────────────────────────────────────────

export async function getInvitation(token) {
  const { data } = await apiClient.get(`/api/invitations/${token}`);
  return data;
}

export async function createInvitation(payload, accessToken) {
  const { data } = await apiClient.post("/api/invitations", payload, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

// ─── Onboarding ──────────────────────────────────────────────────────────────

export async function getOnboarding(accessToken) {
  const { data } = await apiClient.get("/api/onboarding", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

export async function saveOnboarding(payload, accessToken) {
  const { data } = await apiClient.put("/api/onboarding", payload, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

// ─── Onboarding Progress ─────────────────────────────────────────────────────

export async function getOnboardingProgress(accessToken) {
  const { data } = await apiClient.get("/api/onboarding/progress", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return data;
}

// ─── Recruiter Dashboard ─────────────────────────────────────────────────────

export async function getDashboardSummary(accessToken) {
  const { data } = await apiClient.get("/api/dashboard/summary", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return data;
}

export async function getDashboardActivity(accessToken, limit = 20) {
  const { data } = await apiClient.get("/api/dashboard/activity", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    params: {
      limit,
    },
  });

  return data;
}

export async function getRecruiterActivity(accessToken, limit = 20) {
  return getDashboardActivity(accessToken, limit);
}

// ─── Candidate Dashboard ─────────────────────────────────────────────────────

export async function getCandidateDashboard(accessToken) {
  const { data } = await apiClient.get("/api/dashboard/candidate", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return data;
}

// ─── Notifications ───────────────────────────────────────────────────────────

export async function getNotifications(accessToken, limit = 30) {
  const { data } = await apiClient.get("/api/notifications", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    params: {
      limit,
    },
  });

  return data;
}

export async function markNotificationsRead(payload, accessToken) {
  const { data } = await apiClient.put(
    "/api/notifications/read",
    payload,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  return data;
}

// ─── Global Search ───────────────────────────────────────────────────────────

export async function globalSearch(query, accessToken) {
  const { data } = await apiClient.get("/api/search", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    params: {
      q: query,
    },
  });

  return data;
}

// ─── Announcements ───────────────────────────────────────────────────────────

export async function getAnnouncements(accessToken, limit = 20) {
  const { data } = await apiClient.get("/api/announcements", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    params: {
      limit,
    },
  });

  return data;
}

export async function createAnnouncement(payload, accessToken) {
  const { data } = await apiClient.post("/api/announcements", payload, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return data;
}

export async function updateAnnouncement(announcementId, payload, accessToken) {
  const { data } = await apiClient.put(`/api/announcements/${announcementId}`, payload, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  return data;
}

export async function deleteAnnouncement(announcementId, accessToken) {
  const { data } = await apiClient.delete(`/api/announcements/${announcementId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  return data;
}

export async function getRecruiterProfile(accessToken) {
  const { data } = await apiClient.get("/api/recruiters/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

export async function updateRecruiterProfile(payload, accessToken) {
  const { data } = await apiClient.put("/api/recruiters/me", payload, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

export async function uploadRecruiterPhoto(file, accessToken) {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await apiClient.post("/api/recruiters/me/photo", formData, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "multipart/form-data",
    },
  });
  return data;
}

export async function removeRecruiterPhoto(accessToken) {
  const { data } = await apiClient.delete("/api/recruiters/me/photo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

// ─── Employees (US-023 / US-024) ─────────────────────────────────────────────

export async function getReadyForConversion(accessToken) {
  const { data } = await apiClient.get("/api/employees/ready-for-conversion", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

export async function getPendingReview(accessToken) {
  const { data } = await apiClient.get("/api/employees/pending-review", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

export async function getOnboardingInProgress(accessToken) {
  const { data } = await apiClient.get("/api/employees/onboarding-in-progress", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

export async function listEmployees(accessToken, params = {}) {
  const { data } = await apiClient.get("/api/employees", {
    headers: { Authorization: `Bearer ${accessToken}` },
    params,
  });
  return data;
}

export async function exportEmployeesCsv(accessToken, params = {}) {
  const response = await apiClient.get("/api/employees/export.csv", {
    headers: { Authorization: `Bearer ${accessToken}` },
    params,
    responseType: "blob",
  });
  return response.data;
}

export async function getEmployeeDetail(employeeId, accessToken) {
  const id = encodeURIComponent(String(employeeId || "").trim());
  const { data } = await apiClient.get(`/api/employees/detail/${id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

export async function listCareerEvents(employeeId, accessToken) {
  const id = encodeURIComponent(String(employeeId || "").trim());
  const { data } = await apiClient.get(`/api/employees/${id}/career`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

export async function addCareerEvent(employeeId, payload, accessToken) {
  const id = encodeURIComponent(String(employeeId || "").trim());
  const { data } = await apiClient.post(`/api/employees/${id}/career`, payload, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

export async function generateEmployeeId(accessToken, year) {
  const { data } = await apiClient.post(
    "/api/employees/generate-id",
    year ? { year } : {},
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return data;
}

export async function createEmployeeFromCandidate(candidateId, accessToken) {
  const { data } = await apiClient.post(
    "/api/employees/create-from-candidate",
    { candidate_id: candidateId },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return data;
}

export async function getCandidateDetail(candidateId, accessToken) {
  const { data } = await apiClient.get(`/api/employees/candidates/${candidateId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

export async function getMyEmployeeProfile(accessToken) {
  const { data } = await apiClient.get("/api/employees/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

export async function uploadEmployeePhoto(file, accessToken) {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await apiClient.post("/api/employees/me/photo", formData, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "multipart/form-data",
    },
  });
  return data;
}

export async function removeEmployeePhoto(accessToken) {
  const { data } = await apiClient.delete("/api/employees/me/photo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

export async function uploadOnboardingFile(formData, accessToken) {
  const { data } = await apiClient.post("/api/employees/upload", formData, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "multipart/form-data",
    },
  });
  return data;
}

// ─── Error Helpers ───────────────────────────────────────────────────────────

export function getApiErrorMessage(error, fallbackMessage) {
  if (!error) return fallbackMessage;

  if (!error.response) {
    if (error.code === "ECONNABORTED") {
      return "The request timed out. Please try again.";
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      return "You appear to be offline. Check your connection and try again.";
    }
    return "Unable to reach the server. Please try again in a moment.";
  }

  const status = error.response?.status;
  const detail = error.response?.data?.detail;

  if (Array.isArray(detail)) {
    const first = detail[0];
    const msg = first?.msg || first?.message;
    if (msg) {
      return String(msg).replace(/^Value error,\s*/i, "").replace(/^Assertion failed,\s*/i, "");
    }
    return fallbackMessage;
  }

  if (typeof detail === "string" && detail.trim()) {
    return detail.trim();
  }

  if (typeof detail === "object" && detail?.msg) {
    return String(detail.msg);
  }

  if (status === 401) return "Your session expired. Please sign in again.";
  if (status === 403) return "You do not have permission to do that.";
  if (status === 404) return "We could not find what you were looking for.";
  if (status === 413) return "That file is too large. Please choose a smaller one.";
  if (status === 429) return "Too many attempts. Please wait a moment and try again.";
  if (status >= 500) return "Something went wrong on our side. Please try again shortly.";

  return fallbackMessage;
}

/** Persist profile_picture (and related fields) onto the local session user. */
export function patchLocalUser(partial) {
  try {
    const stored = JSON.parse(localStorage.getItem("user") || "{}");
    const next = { ...stored, ...partial };
    localStorage.setItem("user", JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
}

// ─── Offer Letters ───────────────────────────────────────────────────────────

export async function createOffer(payload, accessToken) {
  const { data } = await apiClient.post("/api/offers", payload, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

export async function getMyOffer(accessToken) {
  const { data } = await apiClient.get("/api/offers/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

export async function listOffersForCandidate(candidateId, accessToken) {
  const { data } = await apiClient.get(`/api/offers/candidate/${candidateId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

export async function signOffer(offerId, payload, accessToken) {
  const { data } = await apiClient.post(`/api/offers/${offerId}/sign`, payload, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

export async function declineOffer(offerId, payload, accessToken) {
  const { data } = await apiClient.post(`/api/offers/${offerId}/decline`, payload, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

export async function approveOffer(offerId, payload, accessToken) {
  const { data } = await apiClient.post(`/api/offers/${offerId}/approve`, payload, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

// ─── Documents (Epic 4 — OCR-backed document management) ────────────────────

export async function uploadDocument(formData, accessToken) {
  const { data } = await apiClient.post("/api/documents/upload", formData, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "multipart/form-data",
    },
  });
  return data;
}

export async function listMyDocuments(accessToken) {
  const { data } = await apiClient.get("/api/documents/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

export async function listOwnerDocuments(ownerId, accessToken) {
  const { data } = await apiClient.get(`/api/documents/owner/${ownerId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

export async function verifyDocument(documentId, payload, accessToken) {
  const { data } = await apiClient.put(`/api/documents/${documentId}/verify`, payload, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

export async function reextractDocument(documentId, accessToken) {
  const { data } = await apiClient.post(`/api/documents/${documentId}/reextract`, null, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

export async function deleteDocument(documentId, accessToken) {
  const { data } = await apiClient.delete(`/api/documents/${documentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

export async function getDocumentDownloadUrl(documentId, accessToken) {
  const { data } = await apiClient.get(`/api/documents/${documentId}/download`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

// ─── Employee profile completion (post-hire "Profile Incomplete" flow) ──────

export async function getProfileCompletion(accessToken) {
  const { data } = await apiClient.get("/api/employees/profile-completion", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

export async function saveProfileCompletion(payload, accessToken) {
  const { data } = await apiClient.put("/api/employees/profile-completion", payload, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}
// ─── Recruiter onboarding assignments (company email / assets / orientation) ─

export async function setEmployeeCompanyEmail(employeeId, payload, accessToken) {
  const { data } = await apiClient.put(`/api/employees/detail/${employeeId}/company-email`, payload, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

export async function assignEmployeeAsset(employeeId, payload, accessToken) {
  const { data } = await apiClient.post(`/api/employees/detail/${employeeId}/assets`, payload, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

export async function updateEmployeeAsset(employeeId, assetId, payload, accessToken) {
  const { data } = await apiClient.put(
    `/api/employees/detail/${employeeId}/assets/${assetId}`,
    payload,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return data;
}

export async function removeEmployeeAsset(employeeId, assetId, accessToken) {
  const { data } = await apiClient.delete(`/api/employees/detail/${employeeId}/assets/${assetId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

export async function scheduleEmployeeOrientation(employeeId, payload, accessToken) {
  const { data } = await apiClient.put(`/api/employees/detail/${employeeId}/orientation`, payload, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

import axios from "axios";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

if (!apiBaseUrl) {
  throw new Error("NEXT_PUBLIC_API_BASE_URL must be configured.");
}

const apiClient = axios.create({
  baseURL: apiBaseUrl,
  headers: { "Content-Type": "application/json" },
});

export async function register(payload) {
  const { data } = await apiClient.post("/api/auth/register", payload);
  return data;
}

export async function candidateRegister(payload) {
  const { data } = await apiClient.post("/api/auth/candidate/register", payload);
  return data;
}

export async function verifyEmail(accessToken) {
  const { data } = await apiClient.post("/api/auth/verify-email", { access_token: accessToken });
  return data;
}

export async function resendVerification(email) {
  const { data } = await apiClient.post("/api/auth/resend-verification", { email });
  return data;
}

export async function login(payload) {
  const { data } = await apiClient.post("/api/auth/login", payload);
  return data;
}

/**
 * US-008: Ask the server to revoke the session (refresh token) and record an audit log.
 * Best-effort — if the network call fails (e.g. the token already expired) we still
 * want the caller to proceed with clearing the local session.
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

export async function bootstrapSuperAdmin(payload) {
  const { data } = await apiClient.post("/api/auth/bootstrap-super-admin", payload);
  return data;
}

export async function refreshToken(refreshTokenValue) {
  const { data } = await apiClient.post("/api/auth/refresh", { refresh_token: refreshTokenValue });
  return data;
}

export async function forgotPassword(email) {
  const { data } = await apiClient.post("/api/auth/forgot-password", { email });
  return data;
}

export async function resetPassword(payload) {
  const { data } = await apiClient.post("/api/auth/reset-password", payload);
  return data;
}

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

export function getApiErrorMessage(error, fallbackMessage) {
  const detail = error.response?.data?.detail;
  if (Array.isArray(detail)) {
    return detail[0]?.msg || fallbackMessage;
  }
  return detail || fallbackMessage;
}
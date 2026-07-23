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

/**
 * Send a message to the role-appropriate AI Agent (recruiter hiring
 * automation, or candidate/employee onboarding automation).
 * @param {string} accessToken
 * @param {string} message
 * @param {string|null} sessionId
 */
export async function sendAgentMessage(accessToken, message, sessionId) {
  const { data } = await client.post(
    "/api/agent/chat",
    { message, session_id: sessionId || null },
    auth(accessToken)
  );
  return data;
}

export async function getAgentHistory(accessToken, sessionId) {
  const { data } = await client.get("/api/agent/history", {
    ...auth(accessToken),
    params: { session_id: sessionId },
  });
  return data;
}

export async function listAgentSessions(accessToken) {
  const { data } = await client.get("/api/agent/sessions", auth(accessToken));
  return data;
}

export async function resetAgentSession(accessToken, sessionId) {
  const { data } = await client.post(
    "/api/agent/reset",
    { session_id: sessionId || null },
    auth(accessToken)
  );
  return data;
}

/** Recruiter: upload a .xlsx roster and invite every row in one go. */
export async function bulkInviteSpreadsheet(accessToken, file, sessionId) {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await client.post("/api/agent/recruiter/bulk-invite", formData, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "multipart/form-data",
    },
    params: sessionId ? { session_id: sessionId } : undefined,
  });
  return data;
}

export function getAgentErrorMessage(error, fallback) {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg;
  return fallback || "Something went wrong. Please try again.";
}
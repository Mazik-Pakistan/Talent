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

/** Recruiter: upload a .xlsx/.csv roster and invite every row in one go. */
export async function bulkInviteSpreadsheet(accessToken, file, sessionId) {
  const formData = new FormData();
  formData.append("file", file, file?.name || "roster.xlsx");
  if (sessionId) formData.append("session_id", sessionId);

  // Use fetch (not axios) so the browser sets multipart/form-data WITH boundary.
  // Axios instance defaults to application/json and often drops the file → FastAPI 422.
  const url = new URL(`${apiBaseUrl.replace(/\/$/, "")}/api/agent/recruiter/bulk-invite`);
  if (sessionId) url.searchParams.set("session_id", sessionId);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "ngrok-skip-browser-warning": "true",
    },
    body: formData,
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const detail = data?.detail;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail) && detail[0]?.msg
          ? detail.map((d) => d.msg).join("; ")
          : `Upload failed (${response.status})`;
    const error = new Error(message);
    error.response = { status: response.status, data };
    throw error;
  }

  return data;
}

export function getAgentErrorMessage(error, fallback) {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg;
  return fallback || "Something went wrong. Please try again.";
}
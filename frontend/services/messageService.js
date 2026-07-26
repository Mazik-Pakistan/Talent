import axios from "axios";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

const apiClient = axios.create({
  baseURL: apiBaseUrl,
  headers: {
    "Content-Type": "application/json",
    "ngrok-skip-browser-warning": "true",
  },
});

function auth(accessToken) {
  return { headers: { Authorization: `Bearer ${accessToken}` } };
}

export async function listHrThreads(accessToken) {
  const { data } = await apiClient.get("/api/messages", auth(accessToken));
  return data;
}

export async function getHrThread(threadId, accessToken) {
  const { data } = await apiClient.get(`/api/messages/${encodeURIComponent(threadId)}`, auth(accessToken));
  return data;
}

export async function sendHrMessage(payload, accessToken) {
  const { data } = await apiClient.post("/api/messages", payload || {}, auth(accessToken));
  return data;
}

export async function startHrMessage(payload, accessToken) {
  const { data } = await apiClient.post("/api/messages/start", payload || {}, auth(accessToken));
  return data;
}

export async function replyHrThread(threadId, body, accessToken) {
  const { data } = await apiClient.post(
    `/api/messages/${encodeURIComponent(threadId)}/reply`,
    { body },
    auth(accessToken)
  );
  return data;
}

export async function closeHrThread(threadId, accessToken) {
  const { data } = await apiClient.post(
    `/api/messages/${encodeURIComponent(threadId)}/close`,
    {},
    auth(accessToken)
  );
  return data;
}

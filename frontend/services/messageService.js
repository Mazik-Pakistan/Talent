import apiClient from "@/lib/apiClient";

export async function listHrThreads(accessToken) {
  const { data } = await apiClient.get("/api/messages");
  return data;
}

export async function getHrThread(threadId, accessToken) {
  const { data } = await apiClient.get(`/api/messages/${encodeURIComponent(threadId)}`);
  return data;
}

export async function sendHrMessage(payload, accessToken) {
  const { data } = await apiClient.post("/api/messages", payload || {});
  return data;
}

export async function startHrMessage(payload, accessToken) {
  const { data } = await apiClient.post("/api/messages/start", payload || {});
  return data;
}

export async function replyHrThread(threadId, body, accessToken) {
  const { data } = await apiClient.post(
    `/api/messages/${encodeURIComponent(threadId)}/reply`,
    { body }
  );
  return data;
}

export async function closeHrThread(threadId, accessToken) {
  const { data } = await apiClient.post(
    `/api/messages/${encodeURIComponent(threadId)}/close`,
    {}
  );
  return data;
}

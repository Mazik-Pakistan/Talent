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

export async function sendMessage(accessToken, message) {
  const { data } = await client.post("/api/ai-coach/chat", { message }, auth(accessToken));
  return data;
}

export async function getHistory(accessToken, limit = 50) {
  const { data } = await client.get("/api/ai-coach/history", {
    ...auth(accessToken),
    params: { limit },
  });
  return data;
}

export async function clearHistory(accessToken) {
  const { data } = await client.delete("/api/ai-coach/history", auth(accessToken));
  return data;
}

// ─── Knowledge base management (recruiter / super admin) ────────────────────

export async function ingestKnowledge(accessToken, payload) {
  const { data } = await client.post("/api/ai-coach/knowledge", payload, auth(accessToken));
  return data;
}

export async function listKnowledge(accessToken) {
  const { data } = await client.get("/api/ai-coach/knowledge", auth(accessToken));
  return data;
}

export async function deleteKnowledge(accessToken, title) {
  const { data } = await client.delete(`/api/ai-coach/knowledge/${encodeURIComponent(title)}`, auth(accessToken));
  return data;
}

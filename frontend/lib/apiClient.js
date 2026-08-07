import axios from "axios";
import { clearLocalSession } from "@/services/authService";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

if (!apiBaseUrl) {
  throw new Error("NEXT_PUBLIC_API_BASE_URL must be configured.");
}

const apiClient = axios.create({
  baseURL: apiBaseUrl,
  headers: {
    "Content-Type": "application/json",
    "ngrok-skip-browser-warning": "true",
  },
});

function getAccessToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("access_token");
}

function getRefreshToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("refresh_token");
}

let isRefreshing = false;
let refreshPromise = null;

const rawClient = axios.create({
  baseURL: apiBaseUrl,
  headers: {
    "Content-Type": "application/json",
    "ngrok-skip-browser-warning": "true",
  },
});

async function doRefresh() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshTokenValue = getRefreshToken();
      if (!refreshTokenValue) {
        throw new Error("No refresh token available.");
      }
      const { data } = await rawClient.post("/api/auth/refresh", {
        refresh_token: refreshTokenValue,
      });
      const session = data.session || data;
      if (session?.access_token) {
        localStorage.setItem("access_token", session.access_token);
      }
      if (session?.refresh_token) {
        localStorage.setItem("refresh_token", session.refresh_token);
      }
      if (session?.expires_in) {
        localStorage.setItem("token_expires_at", String(Date.now() + session.expires_in * 1000));
      }
      return session;
    })();
  }
  return refreshPromise;
}

apiClient.interceptors.request.use(
  (config) => {
    const token = getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const status = error.response?.status;

    if (status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        try {
          await doRefresh();
          const newToken = getAccessToken();
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          return apiClient(originalRequest);
        } catch {
          clearLocalSession();
          if (typeof window !== "undefined") {
            window.location.href = "/login";
          }
          return Promise.reject(error);
        }
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        await doRefresh();
        const newToken = getAccessToken();
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return apiClient(originalRequest);
      } catch {
        clearLocalSession();
        if (typeof window !== "undefined") {
          window.location.href = "/login";
        }
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;

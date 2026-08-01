"use client";

import { useRouter } from "next/navigation";

import { clearLocalSession, logout } from "@/services/authService";

/**
 * Identical in all three shells: hit the logout endpoint (best-effort),
 * clear the local session, and bounce to /login.
 */
export function useLogout() {
  const router = useRouter();

  return async function handleLogout() {
    const accessToken = localStorage.getItem("access_token");
    await logout(accessToken);
    clearLocalSession();
    router.replace("/login");
  };
}

"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";

import {
  getApiErrorMessage,
  persistLoginSession,
  switchRole as switchRoleRequest,
} from "@/services/authService";

const ROLE_LABELS = {
  employee: "Employee",
  recruiter: "Recruiter",
};

/**
 * Dual-role accounts (an employee who is also a recruiter) get a control to
 * flip between the two without re-entering credentials. `user` is the
 * session object from useUserSession() — it carries `available_roles` set
 * by login/switch-role. Single-role accounts simply have no "other" role,
 * so `canSwitch` is false and callers should render nothing.
 */
export function useRoleSwitch(user) {
  const router = useRouter();
  const [switching, setSwitching] = useState(false);

  const availableRoles = user?.available_roles || (user?.role ? [user.role] : []);
  const otherRole = availableRoles.find((role) => role !== user?.role) || null;

  const switchTo = useCallback(
    async (targetRole) => {
      if (!targetRole || switching) return;
      const accessToken = localStorage.getItem("access_token");
      if (!accessToken) {
        router.replace("/login");
        return;
      }
      setSwitching(true);
      try {
        const data = await switchRoleRequest(targetRole, accessToken);
        persistLoginSession(data.session, data.user, {
          rememberMe: Boolean(data.session?.remember_me),
          email: data.user?.email || "",
        });
        window.dispatchEvent(new Event("talent-user-updated"));
        toast.success(data.message || `Switched to ${ROLE_LABELS[targetRole] || targetRole}.`);
        router.push(data.redirect_to);
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Could not switch roles. Please try again."));
      } finally {
        setSwitching(false);
      }
    },
    [router, switching]
  );

  return {
    otherRole,
    otherRoleLabel: otherRole ? ROLE_LABELS[otherRole] : null,
    canSwitch: Boolean(otherRole),
    switching,
    switchTo: () => switchTo(otherRole),
  };
}

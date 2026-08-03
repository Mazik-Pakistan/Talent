/** US-012: Client-side role permissions (mirrors backend RBAC). */

import * as authService from "./authService";

export const ROLE_PERMISSIONS = {
  super_admin: [
    "recruitment.view",
    "recruitment.invite",
    "onboarding.self",
    "onboarding.manage",
    "learning.access",
    "ai.access",
    "ai.coach",
    "reporting.view",
    "profile.view",
    "admin.access",
  ],
  recruiter: [
    "recruitment.view",
    "recruitment.invite",
    "onboarding.manage",
    "learning.access",
    "ai.access",
    "reporting.view",
    "profile.view",
  ],
  candidate: ["onboarding.self", "profile.view"],
  employee: ["onboarding.self", "learning.access", "ai.coach", "profile.view"],
};

export const ROLE_HOME = {
  super_admin: "/dashboard/super-admin",
  recruiter: "/dashboard/recruiter",
  candidate: "/dashboard/candidate",
  employee: "/dashboard/employee",
};

export function getStoredUser() {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("user");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getRolePermissions(role) {
  return ROLE_PERMISSIONS[role] || [];
}

export function can(roleOrUser, permission) {
  const role = typeof roleOrUser === "string" ? roleOrUser : roleOrUser?.role;
  return getRolePermissions(role).includes(permission);
}

export function canAny(roleOrUser, permissions) {
  return permissions.some((permission) => can(roleOrUser, permission));
}

export function moduleAccess(role) {
  return {
    recruitment: canAny(role, ["recruitment.view", "recruitment.invite"]),
    onboarding: canAny(role, ["onboarding.self", "onboarding.manage"]),
    learning: can(role, "learning.access"),
    ai: canAny(role, ["ai.access", "ai.coach"]),
    reporting: can(role, "reporting.view"),
    profile: can(role, "profile.view"),
    admin: can(role, "admin.access"),
  };
}

/** ─── RECRUITER CAPABILITIES (Module Access Control) ─── */

/**
 * Get stored recruiter capabilities.
 * @returns {Object} Object with capability flags (e.g., { recruitment: true, learning: false })
 */
export function getStoredCapabilities() {
  return authService.getStoredCapabilities();
}

/**
 * Check if recruiter has a specific capability enabled.
 * Super admins always have all capabilities.
 * @param {string} capability - Capability name (e.g., 'learning', 'documents', 'it')
 * @returns {boolean}
 */
export function hasCapability(capability) {
  const user = getStoredUser();
  
  // Super admins always have all capabilities
  if (user?.role === "super_admin") {
    return true;
  }
  
  // Non-recruiters don't have module capability restrictions
  if (user?.role !== "recruiter") {
    return true;
  }
  
  return authService.hasCapability(capability);
}

/**
 * Check if recruiter has any of the specified capabilities.
 * @param {string[]} capabilities - Array of capability names
 * @returns {boolean}
 */
export function hasAnyCapability(capabilities = []) {
  const user = getStoredUser();
  
  if (user?.role === "super_admin") {
    return true;
  }
  
  if (user?.role !== "recruiter") {
    return true;
  }
  
  return authService.hasAnyCapability(capabilities);
}

/**
 * Get which modules are actually accessible for the recruiter.
 * Combines role-based permissions with recruiter capabilities.
 * @returns {Object} Object with module availability flags
 */
export function getAccessibleModules() {
  const user = getStoredUser();
  const baseModules = moduleAccess(user?.role);
  
  // For recruiters, also check capabilities
  if (user?.role === "recruiter") {
    const capabilities = getStoredCapabilities();
    return {
      recruitment: baseModules.recruitment && (capabilities.recruitment || capabilities.invite),
      onboarding: baseModules.onboarding && (capabilities.employees || capabilities.recruitment),
      learning: baseModules.learning && capabilities.learning,
      ai: baseModules.ai && capabilities.recruitment,
      reporting: baseModules.reporting && capabilities.reporting,
      messages: baseModules.profile && capabilities.messages,
      documents: baseModules.profile && capabilities.documents,
      it: baseModules.profile && capabilities.it,
      employees: baseModules.profile && capabilities.employees,
      profile: baseModules.profile,
    };
  }
  
  // Super admin and other roles have full access
  return baseModules;
}

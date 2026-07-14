/** US-012: Client-side role permissions (mirrors backend RBAC). */

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
  candidate: ["onboarding.self", "learning.access", "ai.coach", "profile.view"],
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

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { ROLE_HOME, can, canAny, getStoredUser, moduleAccess } from "@/services/rbac";

/**
 * US-012 UI guard — redirects unauthorized roles and only renders children when allowed.
 */
export default function RequireAccess({
  permission,
  anyOf,
  roles,
  children,
  fallback = null,
}) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const user = getStoredUser();
    const token = localStorage.getItem("access_token");
    if (!user || !token) {
      router.replace("/login");
      return;
    }

    let ok = true;
    if (roles?.length) ok = roles.includes(user.role);
    if (ok && permission) ok = can(user, permission);
    if (ok && anyOf?.length) ok = canAny(user, anyOf);

    if (!ok) {
      router.replace(ROLE_HOME[user.role] || "/login");
      return;
    }
    setAllowed(true);
  }, [permission, anyOf, roles, router]);

  if (!allowed) {
    return fallback || <p style={{ textAlign: "center", marginTop: "2rem" }}>Checking access…</p>;
  }
  return children;
}

export function ModuleNav({ role }) {
  const modules = moduleAccess(role);
  const items = [
    { key: "recruitment", label: "Recruitment", href: "/dashboard/recruiter", show: modules.recruitment },
    { key: "onboarding", label: "Onboarding", href: role === "candidate" || role === "employee" ? "/onboarding" : "/dashboard/recruiter", show: modules.onboarding },
    { key: "learning", label: "Learning", href: "#", show: modules.learning },
    { key: "ai", label: "AI", href: "#", show: modules.ai },
    { key: "reporting", label: "Reporting", href: "#", show: modules.reporting },
    { key: "profile", label: "Profile", href: ROLE_HOME[role] || "/dashboard", show: modules.profile },
    { key: "admin", label: "Admin", href: "/dashboard/super-admin", show: modules.admin },
  ].filter((item) => item.show);

  if (!items.length) return null;

  return (
    <nav className="module-nav" aria-label="Authorized modules">
      {items.map((item) =>
        item.href === "#" ? (
          <span key={item.key} className="module-nav-item muted">{item.label}</span>
        ) : (
          <a key={item.key} className="module-nav-item" href={item.href}>
            {item.label}
          </a>
        )
      )}
    </nav>
  );
}

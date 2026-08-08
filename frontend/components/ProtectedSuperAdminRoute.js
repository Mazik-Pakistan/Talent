"use client";

import { useEffect, useState } from "react";
import { getStoredUser } from "@/services/rbac";
import ModuleNotAvailable from "@/components/ModuleNotAvailable";

export default function ProtectedSuperAdminRoute({ children }) {
  const [isAuthorized, setIsAuthorized] = useState(null);

  useEffect(() => {
    const user = getStoredUser();

    if (!user || user.role !== "super_admin") {
      setIsAuthorized(false);
      return;
    }

    setIsAuthorized(true);
  }, []);

  if (isAuthorized === null) return null;

  if (!isAuthorized) {
    return <ModuleNotAvailable capability="super_admin" />;
  }

  return children;
}

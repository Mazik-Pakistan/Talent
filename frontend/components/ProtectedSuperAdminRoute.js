"use client";

import { useEffect, useState } from "react";
import { getStoredUser } from "@/services/rbac";
import ModuleNotAvailable from "@/components/ModuleNotAvailable";

export default function ProtectedSuperAdminRoute({ children }) {
  const [isAuthorized, setIsAuthorized] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const user = getStoredUser();

    if (!user || user.role !== "super_admin") {
      setIsAuthorized(false);
      setLoading(false);
      return;
    }

    setIsAuthorized(true);
    setLoading(false);
  }, []);

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
        <div>Loading...</div>
      </div>
    );
  }

  if (!isAuthorized) {
    return <ModuleNotAvailable capability="super_admin" />;
  }

  return children;
}

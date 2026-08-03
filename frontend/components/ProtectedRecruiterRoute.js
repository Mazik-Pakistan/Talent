"use client";

import { useEffect, useState } from "react";
import { getStoredUser } from "@/services/rbac";
import { resolveRecruiterCapabilities } from "@/services/authService";
import ModuleNotAvailable from "@/components/ModuleNotAvailable";

/**
 * Route guard component for recruiter pages.
 * Checks if recruiter has the required capability.
 * If not, shows a friendly "Module not available" message.
 *
 * @param {string} requiredCapability - Capability name (e.g., 'learning', 'documents')
 * @param {React.ReactNode} children - Page content to render if access granted
 * @returns {React.ReactNode}
 */
export default function ProtectedRecruiterRoute({ requiredCapability, children }) {
  const [isAuthorized, setIsAuthorized] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const user = getStoredUser();

    // If not a recruiter, allow (super admin and other roles have full access)
    if (!user || user.role !== "recruiter") {
      setIsAuthorized(true);
      setLoading(false);
      return;
    }

    const capabilities = resolveRecruiterCapabilities(user);

    // Backward compatible: no stored capabilities = not restricted yet.
    if (!capabilities || Object.keys(capabilities).length === 0) {
      setIsAuthorized(true);
      setLoading(false);
      return;
    }

    const allowed = capabilities[requiredCapability] !== false;

    setIsAuthorized(allowed);
    setLoading(false);
  }, [requiredCapability]);

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
        <div>Loading...</div>
      </div>
    );
  }

  if (!isAuthorized) {
    return <ModuleNotAvailable capability={requiredCapability} />;
  }

  return children;
}

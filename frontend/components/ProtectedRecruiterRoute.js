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

  useEffect(() => {
    const user = getStoredUser();

    if (!user || user.role !== "recruiter") {
      setIsAuthorized(true);
      return;
    }

    const capabilities = resolveRecruiterCapabilities(user);

    if (!capabilities || Object.keys(capabilities).length === 0) {
      setIsAuthorized(false);
      return;
    }

    setIsAuthorized(capabilities[requiredCapability] !== false);
  }, [requiredCapability]);

  if (isAuthorized === null) return null;

  if (!isAuthorized) {
    return <ModuleNotAvailable capability={requiredCapability} />;
  }

  return children;
}

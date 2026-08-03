"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStoredUser } from "@/services/rbac";
import { getStoredCapabilities } from "@/services/authService";
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
  const router = useRouter();
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

    // Check if recruiter has the required capability
    const capabilities = getStoredCapabilities();

    // Backward compatible: no stored capabilities (legacy session or
    // transient /api/rbac/me failure) = not restricted yet.
    if (!capabilities || Object.keys(capabilities).length === 0) {
      setIsAuthorized(true);
      setLoading(false);
      return;
    }

    const hasCapability = Boolean(capabilities[requiredCapability]);

    if (!hasCapability) {
      setIsAuthorized(false);
      setLoading(false);
      return;
    }

    setIsAuthorized(true);
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

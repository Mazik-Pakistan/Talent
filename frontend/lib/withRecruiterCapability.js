"use client";

import ProtectedRecruiterRoute from "@/components/ProtectedRecruiterRoute";

/**
 * Higher-order component that wraps a recruiter page with capability protection.
 * 
 * Usage:
 * export default withRecruiterCapability("learning")(YourPage)
 * 
 * @param {string} requiredCapability - The capability required to access this page
 * @returns {Function} HOC that wraps a component
 */
export function withRecruiterCapability(requiredCapability) {
  return function WrappedComponent(Component) {
    return function ProtectedComponent(props) {
      return (
        <ProtectedRecruiterRoute requiredCapability={requiredCapability}>
          <Component {...props} />
        </ProtectedRecruiterRoute>
      );
    };
  };
}

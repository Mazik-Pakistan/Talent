"use client";

import BaseMascot from "@/components/mascot/BaseMascot";
import {
  buildIdleInsights,
  buildSuperAdminInsights,
  invalidateSuperAdminInsightCache,
  SUPER_ADMIN_INSIGHTS_REFRESH_EVENT,
} from "@/lib/ai/superAdminInsights";
import {
  SUPER_ADMIN_CONTEXT_EVENT,
  markMascotGreeted,
  readMascotGreeted,
  readSuperAdminContext,
} from "@/lib/ai/superAdminContext";
import {
  superAdminFieldHelpFor,
  superAdminPageSummaryFor,
} from "@/lib/ai/superAdminFieldHelp";

// Stable identities — inline defaults in BaseMascot would re-create these
// every render and trigger infinite refresh loops.
const ROUTE_PREFIXES = ["/dashboard/super-admin"];

function welcomeMessage(firstName) {
  return `Welcome, ${firstName || "Admin"}! This is your platform command center — I'm here to guide you across recruiters, organizations, and support.`;
}

function updateMemory() {
  return { prev: null, next: null };
}

function buildContinuityMessage() {
  return null;
}

/**
 * Super Admin partner mascot — page/field guidance only.
 * Autonomous admin actions live on /dashboard/super-admin/ai-assistant.
 */
export default function SuperAdminMascot() {
  return (
    <BaseMascot
      roleLabel="Platform Admin"
      fabStorageKey="mascot_fab_pos_super_admin"
      routePrefixes={ROUTE_PREFIXES}
      contextEvent={SUPER_ADMIN_CONTEXT_EVENT}
      refreshEvent={SUPER_ADMIN_INSIGHTS_REFRESH_EVENT}
      readContext={readSuperAdminContext}
      readGreeted={readMascotGreeted}
      markGreeted={markMascotGreeted}
      updateMemory={updateMemory}
      buildContinuityMessage={buildContinuityMessage}
      welcomeMessage={welcomeMessage}
      buildInsights={buildSuperAdminInsights}
      buildIdleInsights={buildIdleInsights}
      invalidateCache={invalidateSuperAdminInsightCache}
      resolveFieldHelp={superAdminFieldHelpFor}
      resolvePageSummary={superAdminPageSummaryFor}
      enableCommands={false}
    />
  );
}

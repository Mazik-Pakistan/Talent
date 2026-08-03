/**
 * Recruiter page to capability mapping.
 * Maps each recruiter dashboard page to its required capability.
 */

export const RECRUITER_PAGE_CAPABILITIES = {
  overview: "overview",
  candidates: "candidates",
  invite: "invite",
  employees: "employees",
  learning: "learning",
  talent: "talent",
  messages: "messages",
  announcements: "announcements",
  "it-provisioning": "it",
  "it-kits": "it",
  activity: "reporting",
  "ai-assistant": "assistant",
  profile: "profile",
};

/**
 * Get required capability for a given page key.
 * @param {string} pageKey - Page key from URL (e.g., 'learning', 'documents')
 * @returns {string|null} Required capability or null if no restriction
 */
export function getRequiredCapability(pageKey) {
  return RECRUITER_PAGE_CAPABILITIES[pageKey] || null;
}

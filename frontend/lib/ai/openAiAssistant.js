/**
 * Seed a one-shot prompt for the role AI Assistant chat page, then navigate.
 * The chat page consumes and clears the seed on mount.
 */
export const AI_ASSISTANT_SEED_KEY = "ai_assistant_seed_prompt_v1";

export function seedAiAssistantPrompt(prompt) {
  if (typeof window === "undefined") return;
  const text = String(prompt || "").trim();
  if (!text) return;
  try {
    sessionStorage.setItem(AI_ASSISTANT_SEED_KEY, text);
  } catch {
    // ignore private-mode failures
  }
}

export function consumeAiAssistantSeedPrompt() {
  if (typeof window === "undefined") return null;
  try {
    const text = sessionStorage.getItem(AI_ASSISTANT_SEED_KEY);
    if (text) sessionStorage.removeItem(AI_ASSISTANT_SEED_KEY);
    return text?.trim() || null;
  } catch {
    return null;
  }
}

export function openAiAssistantChat(router, { href, prompt }) {
  seedAiAssistantPrompt(prompt);
  router.push(href);
}

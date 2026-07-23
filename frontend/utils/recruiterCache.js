/**
 * Per-recruiter session cache for heavy Phase 3 pages.
 *
 * Matches existing architecture (no React Query / SWR / Redux):
 * - Keyed by logged-in user id from localStorage `user`
 * - Stored in sessionStorage so it survives tab switches within the session
 * - Explicit Refresh / mutations invalidate keys
 */

const PREFIX = "recruiter_cache_v1";
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

function currentUserId() {
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return "anon";
    const user = JSON.parse(raw);
    return String(user?.id || user?._id || user?.email || "anon");
  } catch {
    return "anon";
  }
}

function storageKey(key) {
  return `${PREFIX}:${currentUserId()}:${key}`;
}

export function getCached(key, { maxAgeMs = DEFAULT_TTL_MS } = {}) {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (Date.now() - (parsed.ts || 0) > maxAgeMs) {
      sessionStorage.removeItem(storageKey(key));
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function setCached(key, data) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(storageKey(key), JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // Quota / private mode — ignore
  }
}

export function invalidateCache(key) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(storageKey(key));
  } catch {
    // ignore
  }
}

/** Invalidate every cache entry for the current recruiter (or all if prefix match). */
export function invalidateCachePrefix(prefix = "") {
  if (typeof window === "undefined") return;
  const needle = `${PREFIX}:${currentUserId()}:${prefix}`;
  try {
    const toRemove = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(needle)) toRemove.push(k);
    }
    toRemove.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // ignore
  }
}

export function clearRecruiterCache() {
  invalidateCachePrefix("");
}

/**
 * Fetch-through cache helper.
 * @param {string} key
 * @param {() => Promise<any>} fetcher
 * @param {{ force?: boolean, maxAgeMs?: number }} [opts]
 */
export async function cachedFetch(key, fetcher, opts = {}) {
  const { force = false, maxAgeMs = DEFAULT_TTL_MS } = opts;
  if (!force) {
    const hit = getCached(key, { maxAgeMs });
    if (hit != null) return { data: hit, fromCache: true };
  }
  const data = await fetcher();
  setCached(key, data);
  return { data, fromCache: false };
}

/** Stable cache keys used across recruiter Phase 3 pages. */
export const CacheKeys = {
  taxonomy: "org-taxonomy",
  analytics: (department = "") => `learning-analytics:${department || "all"}`,
  assignments: (status = "", mandatory = false) =>
    `learning-assignments:${status || "all"}:${mandatory ? "mandatory" : "any"}`,
  talentMetrics: (department = "") => `talent-metrics:${department || "all"}`,
  opportunities: "talent-opportunities",
};

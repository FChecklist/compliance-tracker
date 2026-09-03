// R67 F-27 (audit recommendation R-243) -- the per-project dashboard's 60 s
// cache, and the ONE place a write says "that figure moved".
//
// WHY A SEPARATE MODULE. The obvious home for this is
// construction-dashboard-service.ts, but the write paths that have to bust it
// are construction-progress-service.ts, construction-boq-service.ts and
// construction-expense-service.ts -- and the dashboard service already imports
// construction-reports-service.ts, which imports the dashboard service back
// (a real, deliberate cycle documented in both files). Adding three more edges
// into that knot to reach a Map would be a genuinely bad trade. This module
// imports NOTHING, so every writer can depend on it and nothing depends on a
// writer.
//
// WHY 60 SECONDS. The per-project dashboard is the screen a PM leaves open and
// re-opens all morning. Its figures are aggregates over rows that change a few
// times a day, and every read of them is ten aggregate queries against a remote
// pooler. Sixty seconds turns "re-opened the tab" into a free read while
// keeping "I just logged progress, where is it?" honest -- because the write
// paths bust the entry outright rather than waiting for it to expire.
//
// WHY IN-MEMORY IS THE RIGHT SCOPE, STATED PLAINLY. This is a per-instance
// Map. A second serverless instance has its own, so a bust on instance A does
// not reach instance B, and B may serve a figure up to 60 s stale. That is the
// same guarantee every other in-process cache in this codebase gives, and it
// is acceptable HERE precisely because the window is short, the data is a
// summary rather than a source of truth, and nothing writes back through it.
// It would NOT be acceptable for a balance, a permission or a lock.

export type CachedDashboard<T> = { value: T; expiresAt: number };

export const DASHBOARD_CACHE_TTL_MS = 60_000;

/** The cache key. Org FIRST, so a scan of the map for one org is a prefix. */
export function dashboardCacheKey(orgId: string, projectId: string): string {
  return `${orgId}:${projectId}`;
}

const store = new Map<string, CachedDashboard<unknown>>();

/**
 * A live entry, or null. An EXPIRED entry is deleted on the way out rather than
 * left to accumulate -- a dashboard is read per project, so a long-lived
 * instance would otherwise hold one dead entry per project it ever served.
 */
export function readDashboardCache<T>(orgId: string, projectId: string, now = Date.now()): T | null {
  const key = dashboardCacheKey(orgId, projectId);
  const hit = store.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= now) {
    store.delete(key);
    return null;
  }
  return hit.value as T;
}

export function writeDashboardCache<T>(orgId: string, projectId: string, value: T, now = Date.now()): void {
  store.set(dashboardCacheKey(orgId, projectId), { value, expiresAt: now + DASHBOARD_CACHE_TTL_MS });
}

/**
 * THE ONE CACHE-BUST HELPER. Every write that moves a figure on the project
 * dashboard -- progress, BOQ, expense, permit -- calls this and nothing else.
 *
 * `projectId` omitted busts every project in the org: a write whose project is
 * not resolvable (an org-wide setting, a document whose link was cleared) must
 * never leave a stale figure behind, and over-busting costs one recomputation.
 * Returns how many entries it dropped, so a caller can log it.
 */
export function bustProjectDashboardCache(orgId: string, projectId?: string | null): number {
  if (projectId) {
    return store.delete(dashboardCacheKey(orgId, projectId)) ? 1 : 0;
  }
  const prefix = `${orgId}:`;
  let dropped = 0;
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) {
      store.delete(key);
      dropped += 1;
    }
  }
  return dropped;
}

/** Test seam: empty the whole cache. Never called by product code. */
export function resetDashboardCache(): void {
  store.clear();
}

/** How many entries are held right now -- for tests and for logging. */
export function dashboardCacheSize(): number {
  return store.size;
}

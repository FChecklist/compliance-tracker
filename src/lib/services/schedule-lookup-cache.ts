// R67 F-33 (audit recommendation R-278) -- the org-level lookup cache the
// schedule task create path reads instead of asking Postgres the same two
// questions on every POST.
//
// WHAT IT HOLDS, AND WHY ONLY THESE TWO THINGS. Creating a task needs three
// facts that do not depend on the task being created: which issue TYPE to file
// it under when the caller did not say (PROJEXA's "New Task" dialog never
// says), which STATUS a new task starts in, and what NUMBER it gets. The third
// is a counter and can never be cached -- it is claimed atomically inside the
// insert's own transaction. The first two are org/project configuration that
// changes when an admin edits it and at no other time, and each of them cost a
// round trip -- the issue-type lookup cost a WHOLE EXTRA TRANSACTION, opened
// before the create's own, because listIssueTypes() opens its own
// withTenantContext.
//
// WHY A SEPARATE MODULE. Same reason project-dashboard-cache.ts is one: the
// reader (pms-issue-service.ts) and the busting writers (pms-taxonomy-service.ts)
// already import each other, and hanging a Map off either would tighten a knot
// rather than loosen it. This module imports NOTHING.
//
// WHY 60 SECONDS, AND WHY A STALE ENTRY IS SAFE HERE. An entry holds an id, and
// the writers that can invalidate it -- createIssueType(), createIssueStatus() --
// bust it outright in the same process, so the TTL only matters across
// instances. A second serverless instance can therefore keep filing tasks under
// the previous default type for up to a minute after an admin adds a new one.
// That is a visible-but-harmless staleness: the task is filed under a REAL
// type, it is not lost, and re-filing it is one edit. Stated plainly because
// the same trade would NOT be acceptable for a permission, a price or a lock.
//
// WHAT IS DELIBERATELY NOT CACHED: a MISS. "This org has no issue types" is the
// answer that makes the route refuse the write, and caching it would keep
// refusing for a minute after an admin fixed it. Only a resolved id is stored.

export const SCHEDULE_LOOKUP_TTL_MS = 60_000;

type Entry = { value: string; expiresAt: number };

const store = new Map<string, Entry>();

/** Org FIRST in every key, so busting an org is a prefix scan. */
export function issueTypeCacheKey(orgId: string): string {
  return `${orgId}:issue-type:default`;
}

export function issueStatusCacheKey(orgId: string, projectId: string): string {
  return `${orgId}:issue-status:${projectId}`;
}

/**
 * A live entry, or null. An EXPIRED entry is deleted on the way out rather than
 * left behind -- a long-lived instance would otherwise hold one dead entry per
 * project it ever created a task in.
 */
export function readScheduleLookup(key: string, now = Date.now()): string | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= now) {
    store.delete(key);
    return null;
  }
  return hit.value;
}

export function writeScheduleLookup(key: string, value: string, now = Date.now()): void {
  store.set(key, { value, expiresAt: now + SCHEDULE_LOOKUP_TTL_MS });
}

/**
 * THE ONE BUST HELPER. Every write that can change which type or status a new
 * task would be filed under calls this and nothing else.
 *
 * With no `key`, drops every entry for the org: a taxonomy edit whose blast
 * radius is not obvious must never leave a stale id behind, and over-busting
 * costs one lookup. Returns how many entries it dropped so a caller can log it.
 */
export function bustScheduleLookupCache(orgId: string, key?: string): number {
  if (key) return store.delete(key) ? 1 : 0;
  const prefix = `${orgId}:`;
  let dropped = 0;
  for (const existing of [...store.keys()]) {
    if (existing.startsWith(prefix)) {
      store.delete(existing);
      dropped += 1;
    }
  }
  return dropped;
}

/** Test seam: empty the whole cache. Never called by product code. */
export function resetScheduleLookupCache(): void {
  store.clear();
}

/** How many entries are held right now -- for tests and for logging. */
export function scheduleLookupCacheSize(): number {
  return store.size;
}

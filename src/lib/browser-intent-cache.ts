"use client";

// Browser Intent Cache -- Owner spec 2026-07-14 (CONTROLLER.yaml PALETTE-01):
// client-only recall of the user's own past VeriComposer submissions (mode
// pill + chain path + chat text), so a repeated workflow can be restored in
// one click instead of re-clicked/re-typed. Deliberately IndexedDB, not a
// server table: zero AI cost, zero network round-trip, works offline -- the
// same class of "real, testable, no-LLM proxy" this codebase already
// practices in chain-usage-ranking.ts's server-side per-user library, which
// this module is the offline-first counterpart to (see IntentCommandPalette.tsx
// for how the two are blended).
//
// Ranking mirrors chain-usage-ranking.ts's own recency-weighted-frequency
// proxy (same exponential half-life shape) rather than inventing a second
// scoring philosophy -- score = timesUsed decayed by age since last use.
// Honest scope, matching this codebase's own established discipline of
// naming what a ranking proxy does NOT cover (chain-usage-ranking.ts's own
// header does the same): built here are recency, frequency, same-mode, and
// pin/favorite. NOT built: same-project/same-client/time-of-day/day-of-week
// signals from the Owner's spec -- those need data this module doesn't have
// (VeriComposer carries no first-class "client" concept, and time-of-day/
// day-of-week personalization is a real separate ranking model, not a
// narrow extension of this proxy).
//
// "encrypted: true" from the Owner's spec is NOT implemented as literal
// encryption-at-rest. A client-side encryption layer needs a real key
// source; the only ones available in a browser with no server round-trip
// (a hardcoded key, or one derived from something already readable in the
// same origin) provide no actual protection against anything that can
// already read IndexedDB for this origin -- security theater, not security.
// The real protection already in place is what IndexedDB always provides:
// origin isolation (no other site can read this store) plus device-local
// storage (never leaves the browser, never synced to VERIDIAN's servers).
import type { PathSegment } from "@/components/veri-chat/veri-chat-context";

const DB_NAME = "veridian-intent-cache";
const DB_VERSION = 1;
const STORE = "intents";

/** Same half-life as chain-usage-ranking.ts's USAGE_HALF_LIFE_DAYS -- one documented decay constant, not two different tuning knobs for what is conceptually the same proxy. */
const HALF_LIFE_DAYS = 30;

const UNUSED_ARCHIVE_DAYS = 180;
const UNUSED_DELETE_DAYS = 365;

export type CachedIntent = {
  intentId: string;
  composerMode: string;
  selectedPath: PathSegment[];
  /** Resolved breadcrumb (real node labels, not raw keys) captured at save time -- cheap to store once rather than re-walking the capability tree on every palette render. */
  displayLabel: string;
  chatMessage: string;
  createdAt: string;
  lastUsed: string;
  timesUsed: number;
  favorite: boolean;
  pinned: boolean;
  archived: boolean;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable (SSR or unsupported browser)"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "intentId" });
        store.createIndex("composerMode", "composerMode", { unique: false });
        store.createIndex("lastUsed", "lastUsed", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const req = run(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function allFromStore(db: IDBDatabase): Promise<CachedIntent[]> {
  return tx(db, "readonly", (store) => store.getAll());
}

function pathSignature(composerMode: string, path: PathSegment[]): string {
  return `${composerMode}::${JSON.stringify(path)}`;
}

/** Best-effort UUID -- crypto.randomUUID() is available in every browser VERIDIAN targets, but a fallback keeps this module from throwing in an unusual embed context. */
function newIntentId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `intent_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Records (or refreshes) one submitted VeriComposer intent. Dedupes on
 * (composerMode, selectedPath) -- resubmitting the same chain with different
 * chat text updates the existing entry's text/label/usage rather than
 * accumulating near-duplicate rows, matching the Owner spec's step_8
 * ("Latest version replaces or creates a new cached intent").
 */
export async function saveIntent(input: {
  composerMode: string;
  selectedPath: PathSegment[];
  displayLabel: string;
  chatMessage: string;
}): Promise<void> {
  try {
    const db = await openDb();
    const all = await allFromStore(db);
    const sig = pathSignature(input.composerMode, input.selectedPath);
    const existing = all.find((i) => pathSignature(i.composerMode, i.selectedPath) === sig);
    const now = new Date().toISOString();

    const next: CachedIntent = existing
      ? { ...existing, displayLabel: input.displayLabel, chatMessage: input.chatMessage, lastUsed: now, timesUsed: existing.timesUsed + 1, archived: false }
      : {
          intentId: newIntentId(), composerMode: input.composerMode, selectedPath: input.selectedPath,
          displayLabel: input.displayLabel, chatMessage: input.chatMessage,
          createdAt: now, lastUsed: now, timesUsed: 1, favorite: false, pinned: false, archived: false,
        };

    await tx(db, "readwrite", (store) => store.put(next));
  } catch {
    // Never let a caching failure block the real send -- this is a UX
    // convenience layer, not a critical path. Silent no-op, same posture
    // as this codebase's fire-and-forget metrics writes (e.g.
    // recordPromptCacheMetric()).
  }
}

function score(intent: CachedIntent, now: number): number {
  if (intent.pinned) return Number.POSITIVE_INFINITY;
  const ageDays = Math.max(0, (now - new Date(intent.lastUsed).getTime()) / 86_400_000);
  const weight = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
  const base = intent.timesUsed * weight;
  return intent.favorite ? base * 2 : base;
}

export type QueryOptions = { composerMode?: string; limit?: number; searchText?: string };

/** Ranked, non-archived intents -- pinned first (always), then favorite/frequency/recency-weighted score. */
export async function queryIntents(opts: QueryOptions = {}): Promise<CachedIntent[]> {
  try {
    const db = await openDb();
    const all = await allFromStore(db);
    const now = Date.now();
    const q = opts.searchText?.trim().toLowerCase();
    return all
      .filter((i) => !i.archived)
      .filter((i) => !opts.composerMode || i.composerMode === opts.composerMode)
      .filter((i) => !q || i.displayLabel.toLowerCase().includes(q) || i.chatMessage.toLowerCase().includes(q))
      .sort((a, b) => score(b, now) - score(a, now))
      .slice(0, opts.limit ?? 20);
  } catch {
    return [];
  }
}

export async function deleteIntent(intentId: string): Promise<void> {
  try {
    const db = await openDb();
    await tx(db, "readwrite", (store) => store.delete(intentId));
  } catch {
    // best-effort
  }
}

export async function toggleField(intentId: string, field: "pinned" | "favorite"): Promise<void> {
  try {
    const db = await openDb();
    const all = await allFromStore(db);
    const found = all.find((i) => i.intentId === intentId);
    if (!found) return;
    await tx(db, "readwrite", (store) => store.put({ ...found, [field]: !found[field] }));
  } catch {
    // best-effort
  }
}

export async function renameIntent(intentId: string, displayLabel: string): Promise<void> {
  try {
    const db = await openDb();
    const all = await allFromStore(db);
    const found = all.find((i) => i.intentId === intentId);
    if (!found) return;
    await tx(db, "readwrite", (store) => store.put({ ...found, displayLabel }));
  } catch {
    // best-effort
  }
}

/**
 * Owner spec's expiration table: unused 90d lowers rank (handled implicitly
 * by the recency decay above, no separate step needed), unused 180d
 * archives (excluded from queryIntents but not deleted), unused 365d
 * deletes unless pinned. Cheap enough to run on every palette open rather
 * than needing a scheduled job -- this is a client-side, per-device store,
 * not something a server cron can reach anyway.
 */
export async function runExpirationSweep(): Promise<void> {
  try {
    const db = await openDb();
    const all = await allFromStore(db);
    const now = Date.now();
    for (const intent of all) {
      if (intent.pinned) continue;
      const ageDays = (now - new Date(intent.lastUsed).getTime()) / 86_400_000;
      if (ageDays >= UNUSED_DELETE_DAYS) {
        await tx(db, "readwrite", (store) => store.delete(intent.intentId));
      } else if (ageDays >= UNUSED_ARCHIVE_DAYS && !intent.archived) {
        await tx(db, "readwrite", (store) => store.put({ ...intent, archived: true }));
      }
    }
  } catch {
    // best-effort
  }
}

export function clearAllIntents(): Promise<void> {
  return openDb().then((db) => tx(db, "readwrite", (store) => store.clear()));
}

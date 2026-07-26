import { beforeEach, describe, expect, test } from "bun:test";
import { CACHE_TTL_MS, getCachedOutcome, isFresh, putCachedOutcome, resetInMemoryCacheForTests } from "./storage-cache";

beforeEach(() => resetInMemoryCacheForTests());
import type { BrowserExecutionOutcome } from "./types";

const SAMPLE_OUTCOME: BrowserExecutionOutcome = {
  machinePrompt: "TASK:create_x",
  contentHash: "hash-a",
  fingerprint: "fp-a",
  complexityTier: "mechanical",
  tierUsed: "deterministic",
  attempts: [],
  cacheHit: false,
  totalMs: 5,
};

describe("isFresh", () => {
  test("true when within the TTL", () => {
    expect(isFresh({ outcome: SAMPLE_OUTCOME, cachedAt: 1000 }, 1000 + CACHE_TTL_MS - 1)).toBe(true);
  });
  test("false once the TTL has elapsed", () => {
    expect(isFresh({ outcome: SAMPLE_OUTCOME, cachedAt: 1000 }, 1000 + CACHE_TTL_MS + 1)).toBe(false);
  });
});

// bun test has no indexedDB global, so these exercise the in-memory
// fallback path -- the real IndexedDB path is the same put/get contract,
// proven end-to-end in a real browser by e2e/browser-execution.spec.ts.
describe("getCachedOutcome/putCachedOutcome (in-memory fallback, no indexedDB in this test runtime)", () => {
  test("returns null for a key that was never stored", async () => {
    expect(await getCachedOutcome("never-stored-key")).toBe(null);
  });

  test("round-trips a stored outcome within the TTL", async () => {
    await putCachedOutcome("round-trip-key", SAMPLE_OUTCOME, 5000);
    expect(await getCachedOutcome("round-trip-key", 5000 + 1000)).toEqual(SAMPLE_OUTCOME);
  });

  test("expires a stored outcome once the TTL elapses", async () => {
    await putCachedOutcome("expiring-key", SAMPLE_OUTCOME, 5000);
    expect(await getCachedOutcome("expiring-key", 5000 + CACHE_TTL_MS + 1)).toBe(null);
  });
});

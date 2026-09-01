/// <reference types="bun-types" />
// R65 Part D -- unit tests for reuse-cache.ts. computeReuseCacheKey() is
// pure; resolveMissesWithReuseCache() takes an injected fake ReuseCacheRepo
// AND an injected fake runLevel1Fn (see that function's own header for why
// the AI-call seam is injectable), so this file needs neither a real DB nor
// a real AI provider -- same testability pattern level0.test.ts already
// established for classifyL0()/L0Repo.
import { describe, expect, test } from "bun:test";
import { computeReuseCacheKey, resolveMissesWithReuseCache, type ReuseCacheRepo } from "./reuse-cache";
import type { Level1Context, Level1Outcome } from "./level1";
import type { ResolvedFunction } from "./classify";

const CTX: Level1Context = { orgId: "org_1", userId: "user_1", projectId: "proj_1", candidateFunctionIds: ["record_work_progress"] };

function fakeRepo(overrides: Partial<ReuseCacheRepo> = {}): ReuseCacheRepo {
  return {
    findReuseHit: async () => null,
    recordReuseHit: async () => {},
    ...overrides,
  };
}

describe("computeReuseCacheKey -- pure, deterministic", () => {
  test("same text + same project -> same key", () => {
    expect(computeReuseCacheKey("PP1 is 50% done", "proj_1")).toBe(computeReuseCacheKey("PP1 is 50% done", "proj_1"));
  });

  test("case/whitespace/trailing punctuation differences collapse, same as normaliseForMatch", () => {
    expect(computeReuseCacheKey("PP1 is 50% done", "proj_1")).toBe(computeReuseCacheKey("  pp1 is 50% done.  ", "proj_1"));
  });

  test("same text, DIFFERENT project -> different key (no cross-project reuse)", () => {
    expect(computeReuseCacheKey("PP1 is 50% done", "proj_1")).not.toBe(computeReuseCacheKey("PP1 is 50% done", "proj_2"));
  });

  test("null project id is its own stable key, distinct from any real project id", () => {
    expect(computeReuseCacheKey("PP1 is 50% done", null)).not.toBe(computeReuseCacheKey("PP1 is 50% done", "proj_1"));
    expect(computeReuseCacheKey("PP1 is 50% done", null)).toBe(computeReuseCacheKey("PP1 is 50% done", null));
  });

  test("different text -> different key", () => {
    expect(computeReuseCacheKey("PP1 is 50% done", "proj_1")).not.toBe(computeReuseCacheKey("PP2 is 50% done", "proj_1"));
  });
});

describe("resolveMissesWithReuseCache -- cache hit skips the model entirely", () => {
  test("a cache hit for every text makes ZERO calls to runLevel1Fn", async () => {
    let level1Calls = 0;
    const repo = fakeRepo({
      findReuseHit: async () => ({ functionId: "record_work_progress", params: { itemCode: "PP1", percent: 50 } }),
    });
    const fakeLevel1 = async (): Promise<Level1Outcome> => {
      level1Calls++;
      return { resolutions: [], reasons: [], modelCalls: 1 };
    };

    const out = await resolveMissesWithReuseCache(["PP1 is 50% done"], CTX, repo, fakeLevel1);

    expect(level1Calls).toBe(0);
    expect(out.modelCalls).toBe(0);
    expect(out.cacheHits).toBe(1);
    expect(out.resolutions).toEqual([{ functionId: "record_work_progress", params: { itemCode: "PP1", percent: 50 }, source: "reuse_cache", level: 0 }]);
  });

  test("a cache MISS calls runLevel1Fn with exactly the missing texts, in order", async () => {
    const seen: string[] = [];
    const repo = fakeRepo(); // always misses
    const fakeLevel1 = async (texts: string[]): Promise<Level1Outcome> => {
      seen.push(...texts);
      return {
        resolutions: texts.map((t) => ({ functionId: "record_work_progress", params: { note: t }, source: "level1" as const, level: 1 as const })),
        reasons: texts.map(() => null),
        modelCalls: 1,
      };
    };

    const out = await resolveMissesWithReuseCache(["a", "b"], CTX, repo, fakeLevel1);

    expect(seen).toEqual(["a", "b"]);
    expect(out.modelCalls).toBe(1);
    expect(out.cacheHits).toBe(0);
    expect(out.resolutions.map((r) => r?.functionId)).toEqual(["record_work_progress", "record_work_progress"]);
  });

  test("MIXED: cache hits and cache misses in the same batch -- only the misses reach runLevel1Fn, order preserved", async () => {
    const seen: string[] = [];
    const repo = fakeRepo({
      findReuseHit: async (inputHash) => (inputHash === computeReuseCacheKey("cached", CTX.projectId) ? { functionId: "cached_fn", params: {} } : null),
    });
    const fakeLevel1 = async (texts: string[]): Promise<Level1Outcome> => {
      seen.push(...texts);
      return {
        resolutions: texts.map(() => ({ functionId: "fresh_fn", params: {}, source: "level1" as const, level: 1 as const })),
        reasons: texts.map(() => null),
        modelCalls: 1,
      };
    };

    const out = await resolveMissesWithReuseCache(["cached", "not cached"], CTX, repo, fakeLevel1);

    expect(seen).toEqual(["not cached"]); // "cached" never reached the model
    expect(out.cacheHits).toBe(1);
    expect(out.modelCalls).toBe(1);
    expect(out.resolutions[0]).toEqual({ functionId: "cached_fn", params: {}, source: "reuse_cache", level: 0 });
    expect(out.resolutions[1]?.functionId).toBe("fresh_fn");
  });

  test("no texts -> zero repo calls, zero model calls", async () => {
    let repoCalls = 0;
    let level1Calls = 0;
    const repo = fakeRepo({ findReuseHit: async () => { repoCalls++; return null; } });
    const fakeLevel1 = async (): Promise<Level1Outcome> => {
      level1Calls++;
      return { resolutions: [], reasons: [], modelCalls: 0 };
    };

    const out = await resolveMissesWithReuseCache([], CTX, repo, fakeLevel1);

    expect(repoCalls).toBe(0);
    expect(level1Calls).toBe(0);
    expect(out).toEqual({ resolutions: [], reasons: [], modelCalls: 0, cacheHits: 0 });
  });
});

describe("resolveMissesWithReuseCache -- recording a new resolution back into the cache", () => {
  test("a successful Level 1 resolution IS recorded when record defaults to true", async () => {
    const recorded: { inputHash: string; functionId: string; params: Record<string, unknown> }[] = [];
    const repo = fakeRepo({
      recordReuseHit: async (inputHash, functionId, params) => {
        recorded.push({ inputHash, functionId, params });
      },
    });
    const resolved: ResolvedFunction = { functionId: "record_work_progress", params: { itemCode: "PP1", percent: 50 }, source: "level1", level: 1 };
    const fakeLevel1 = async (): Promise<Level1Outcome> => ({ resolutions: [resolved], reasons: [null], modelCalls: 1 });

    await resolveMissesWithReuseCache(["PP1 is 50% done"], CTX, repo, fakeLevel1);

    expect(recorded).toEqual([{ inputHash: computeReuseCacheKey("PP1 is 50% done", "proj_1"), functionId: "record_work_progress", params: { itemCode: "PP1", percent: 50 } }]);
  });

  test("a NULL Level 1 resolution (unmapped/failed) is never recorded -- nothing to reuse", async () => {
    let recordCalls = 0;
    const repo = fakeRepo({ recordReuseHit: async () => { recordCalls++; } });
    const fakeLevel1 = async (): Promise<Level1Outcome> => ({ resolutions: [null], reasons: ["could not map"], modelCalls: 1 });

    const out = await resolveMissesWithReuseCache(["gibberish"], CTX, repo, fakeLevel1);

    expect(recordCalls).toBe(0);
    expect(out.resolutions).toEqual([null]);
    expect(out.reasons).toEqual(["could not map"]);
  });

  test("record: false (the future classify-only.ts opt-in point) skips writing, but still reads and still resolves", async () => {
    let recordCalls = 0;
    const repo = fakeRepo({ recordReuseHit: async () => { recordCalls++; } });
    const resolved: ResolvedFunction = { functionId: "record_work_progress", params: {}, source: "level1", level: 1 };
    const fakeLevel1 = async (): Promise<Level1Outcome> => ({ resolutions: [resolved], reasons: [null], modelCalls: 1 });

    const out = await resolveMissesWithReuseCache(["PP1 is 50% done"], CTX, repo, fakeLevel1, { record: false });

    expect(recordCalls).toBe(0);
    expect(out.resolutions[0]?.functionId).toBe("record_work_progress");
  });
});

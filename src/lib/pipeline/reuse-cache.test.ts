/// <reference types="bun-types" />
// R65 Part D -- unit tests for reuse-cache.ts. computeReuseCacheKey() is
// pure; resolveMissesWithReuseCache() takes an injected fake ReuseCacheRepo
// AND an injected fake runLevel1Fn (see that function's own header for why
// the AI-call seam is injectable), so this file needs neither a real DB nor
// a real AI provider -- same testability pattern level0.test.ts already
// established for classifyL0()/L0Repo.
import { describe, expect, test } from "bun:test";
import { computeReuseCacheKey, resolveMissesWithReuseCache, type ReuseCacheRepo } from "./reuse-cache";
import type { PhraseFuzzyRepo, PhraseFuzzyMatch } from "./phrase-fuzzy";
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

function fakeFuzzyRepo(byText: Record<string, PhraseFuzzyMatch | null>): PhraseFuzzyRepo {
  return { findBestMatch: async (text: string) => byText[text] ?? null };
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
    expect(out).toEqual({ resolutions: [], reasons: [], modelCalls: 0, cacheHits: 0, fuzzyHits: 0, fuzzyAskHits: 0 });
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

describe("P1.2/P1.3 -- the trigram fuzzy tier, checked after reuse_cache and before Level 1", () => {
  test("no fuzzyRepo injected (every pre-P1.2 call site) is behaviour-identical: falls straight through to Level 1", async () => {
    let level1Calls = 0;
    const repo = fakeRepo();
    const fakeLevel1 = async (texts: string[]): Promise<Level1Outcome> => {
      level1Calls++;
      return { resolutions: texts.map(() => null), reasons: texts.map(() => "no fuzzy match"), modelCalls: 1 };
    };

    const out = await resolveMissesWithReuseCache(["PP1 is 50% done"], CTX, repo, fakeLevel1);

    expect(level1Calls).toBe(1);
    expect(out.fuzzyHits).toBe(0);
  });

  test("a fuzzy match resolves with ZERO calls to Level 1 -- the mechanism that moves 95/5", async () => {
    let level1Calls = 0;
    const repo = fakeRepo();
    const fuzzyRepo = fakeFuzzyRepo({ "PP1 is 51% done": { functionId: "record_work_progress", fixedParams: { itemCode: "PP1" }, score: 0.9 } });
    const fakeLevel1 = async (): Promise<Level1Outcome> => {
      level1Calls++;
      return { resolutions: [], reasons: [], modelCalls: 1 };
    };

    const out = await resolveMissesWithReuseCache(["PP1 is 51% done"], CTX, repo, fakeLevel1, {}, fuzzyRepo);

    expect(level1Calls).toBe(0);
    expect(out.modelCalls).toBe(0);
    expect(out.fuzzyHits).toBe(1);
    expect(out.resolutions[0]).toEqual({ functionId: "record_work_progress", params: { itemCode: "PP1" }, source: "phrase_fuzzy", level: 0 });
  });

  test("a fuzzy miss (null fixedParams too) falls through to Level 1, and only the miss reaches it", async () => {
    const seenByLevel1: string[] = [];
    const repo = fakeRepo();
    const fuzzyRepo = fakeFuzzyRepo({ matched: { functionId: "record_work_progress", fixedParams: null, score: 0.95 } });
    const fakeLevel1 = async (texts: string[]): Promise<Level1Outcome> => {
      seenByLevel1.push(...texts);
      return { resolutions: texts.map(() => null), reasons: texts.map(() => "unresolved"), modelCalls: 1 };
    };

    const out = await resolveMissesWithReuseCache(["matched", "unmatched"], CTX, repo, fakeLevel1, {}, fuzzyRepo);

    expect(seenByLevel1).toEqual(["unmatched"]);
    expect(out.fuzzyHits).toBe(1);
    expect(out.resolutions[0]).toEqual({ functionId: "record_work_progress", params: {}, source: "phrase_fuzzy", level: 0 });
    expect(out.modelCalls).toBe(1);
  });

  test("reuse_cache is still checked FIRST -- a cache hit never reaches the fuzzy repo at all", async () => {
    let fuzzyCalls = 0;
    const repo = fakeRepo({ findReuseHit: async () => ({ functionId: "record_work_progress", params: { itemCode: "PP1" } }) });
    const fuzzyRepo: PhraseFuzzyRepo = { findBestMatch: async () => { fuzzyCalls++; return null; } };
    const fakeLevel1 = async (): Promise<Level1Outcome> => ({ resolutions: [], reasons: [], modelCalls: 1 });

    const out = await resolveMissesWithReuseCache(["PP1 is 50% done"], CTX, repo, fakeLevel1, {}, fuzzyRepo);

    expect(fuzzyCalls).toBe(0);
    expect(out.cacheHits).toBe(1);
    expect(out.fuzzyHits).toBe(0);
  });

  test("when every miss is resolved by the fuzzy tier, Level 1 is never called (mirrors the all-cache-hit case)", async () => {
    let level1Calls = 0;
    const repo = fakeRepo();
    const fuzzyRepo = fakeFuzzyRepo({
      a: { functionId: "record_work_progress", fixedParams: {}, score: 0.9 },
      b: { functionId: "record_work_progress", fixedParams: {}, score: 0.87 },
    });
    const fakeLevel1 = async (): Promise<Level1Outcome> => {
      level1Calls++;
      return { resolutions: [], reasons: [], modelCalls: 1 };
    };

    const out = await resolveMissesWithReuseCache(["a", "b"], CTX, repo, fakeLevel1, {}, fuzzyRepo);

    expect(level1Calls).toBe(0);
    expect(out.fuzzyHits).toBe(2);
    expect(out.modelCalls).toBe(0);
  });
});

describe("PM-T2 -- the middle confidence band (LOW <= score < HIGH -> needsConfirmation, not resolved and not escalated)", () => {
  test("a middle-band score resolves with needsConfirmation=true, ZERO model calls, and is counted in fuzzyAskHits not fuzzyHits", async () => {
    let level1Calls = 0;
    const repo = fakeRepo();
    // 0.60 is below the real default HIGH (0.70, PM-T1) and above the real
    // default LOW (0.55) -- squarely the middle band with the shipped
    // config, not a threshold this test invents its own value for.
    const fuzzyRepo = fakeFuzzyRepo({ "mark the boq line done": { functionId: "record_work_progress", fixedParams: { itemCode: "PP1" }, score: 0.60 } });
    const fakeLevel1 = async (): Promise<Level1Outcome> => {
      level1Calls++;
      return { resolutions: [], reasons: [], modelCalls: 1 };
    };

    const out = await resolveMissesWithReuseCache(["mark the boq line done"], CTX, repo, fakeLevel1, {}, fuzzyRepo);

    expect(level1Calls).toBe(0); // NOT escalated to AI either -- a human confirms, not a model
    expect(out.modelCalls).toBe(0);
    expect(out.fuzzyHits).toBe(0);
    expect(out.fuzzyAskHits).toBe(1);
    expect(out.resolutions[0]).toEqual({ functionId: "record_work_progress", params: { itemCode: "PP1" }, source: "phrase_fuzzy", level: 0, needsConfirmation: true });
  });

  test("a HIGH-band score does NOT set needsConfirmation -- the P1.2 behaviour is unchanged by PM-T2's addition", async () => {
    const repo = fakeRepo();
    const fuzzyRepo = fakeFuzzyRepo({ "record 50 percent progress": { functionId: "record_work_progress", fixedParams: {}, score: 0.92 } });
    const fakeLevel1 = async (): Promise<Level1Outcome> => ({ resolutions: [], reasons: [], modelCalls: 1 });

    const out = await resolveMissesWithReuseCache(["record 50 percent progress"], CTX, repo, fakeLevel1, {}, fuzzyRepo);

    expect(out.fuzzyHits).toBe(1);
    expect(out.fuzzyAskHits).toBe(0);
    expect(out.resolutions[0]?.needsConfirmation).toBeUndefined();
  });

  test("below LOW still falls through to Level 1 exactly as before PM-T2 -- the low band is a floor, not a wider net that swallows genuine escalations", async () => {
    let level1Calls = 0;
    const repo = fakeRepo();
    const fuzzyRepo = fakeFuzzyRepo({}); // no match at all, i.e. below LOW
    const fakeLevel1 = async (texts: string[]): Promise<Level1Outcome> => {
      level1Calls++;
      return { resolutions: texts.map(() => null), reasons: texts.map(() => "unresolved"), modelCalls: 1 };
    };

    const out = await resolveMissesWithReuseCache(["totally unrelated free text"], CTX, repo, fakeLevel1, {}, fuzzyRepo);

    expect(level1Calls).toBe(1);
    expect(out.fuzzyHits).toBe(0);
    expect(out.fuzzyAskHits).toBe(0);
  });

  test("a mixed batch splits three ways in one call: resolved, asked, and escalated", async () => {
    let level1Texts: string[] = [];
    const repo = fakeRepo();
    const fuzzyRepo = fakeFuzzyRepo({
      high: { functionId: "record_work_progress", fixedParams: {}, score: 0.9 },
      middle: { functionId: "record_work_progress", fixedParams: {}, score: 0.6 },
    });
    const fakeLevel1 = async (texts: string[]): Promise<Level1Outcome> => {
      level1Texts = texts;
      return { resolutions: texts.map(() => null), reasons: texts.map(() => "unresolved"), modelCalls: 1 };
    };

    const out = await resolveMissesWithReuseCache(["high", "middle", "escalates"], CTX, repo, fakeLevel1, {}, fuzzyRepo);

    expect(out.fuzzyHits).toBe(1);
    expect(out.fuzzyAskHits).toBe(1);
    expect(level1Texts).toEqual(["escalates"]);
    expect(out.resolutions[0]?.needsConfirmation).toBeUndefined();
    expect(out.resolutions[1]?.needsConfirmation).toBe(true);
  });
});

// P1.4R -- the real confidence-driven escalation capability, in place of
// building out escalation-tier-catalog.ts's PERCEPTION/REASONING/AUTHORITY
// (retired, P1.4: zero production importers, unwired by its own header, its
// own test admitted 2/3 models don't exist in the live roster, "L3" already
// means a human approver elsewhere, and a 3rd AI-tier-to-AI-tier catalog
// inverts the actual directive of AI-escalation-last). The real escalation
// axis in this pipeline is software -> AI, gated by a software-computed
// confidence score (phrase-fuzzy.ts's trigram similarity) computed BEFORE
// any model call -- exactly what a confidence-driven (non-boolean) gate
// requires, unlike MIN_CONFIDENCE (the model's own post-hoc self-report).
// Three paths, matching the original step's own framing:
describe("P1.4R -- confidence-driven escalation: three paths", () => {
  test("path 1: resolved on the cheap path -- a high-confidence trigram match resolves with ZERO model calls", async () => {
    let level1Calls = 0;
    const repo = fakeRepo();
    const fuzzyRepo = fakeFuzzyRepo({ "PP1 is 51% done": { functionId: "record_work_progress", fixedParams: { itemCode: "PP1" }, score: 0.92 } });
    const fakeLevel1 = async (): Promise<Level1Outcome> => {
      level1Calls++;
      return { resolutions: [], reasons: [], modelCalls: 1 };
    };

    const out = await resolveMissesWithReuseCache(["PP1 is 51% done"], CTX, repo, fakeLevel1, {}, fuzzyRepo);

    expect(level1Calls).toBe(0);
    expect(out.modelCalls).toBe(0);
    expect(out.fuzzyHits).toBe(1);
    expect(out.resolutions[0]?.source).toBe("phrase_fuzzy");
  });

  test("path 2: escalated once, and the model resolves it -- confidence was too low for the cheap path, one model call succeeds", async () => {
    let level1Calls = 0;
    const repo = fakeRepo();
    const fuzzyRepo = fakeFuzzyRepo({}); // no confident match anywhere -- always escalates
    const resolved: ResolvedFunction = { functionId: "record_work_progress", params: { itemCode: "PP9" }, source: "level1", level: 1 };
    const fakeLevel1 = async (texts: string[]): Promise<Level1Outcome> => {
      level1Calls++;
      return { resolutions: texts.map(() => resolved), reasons: texts.map(() => null), modelCalls: 1 };
    };

    const out = await resolveMissesWithReuseCache(["PP9 is nearly done, mark it"], CTX, repo, fakeLevel1, {}, fuzzyRepo);

    expect(level1Calls).toBe(1);
    expect(out.modelCalls).toBe(1);
    expect(out.fuzzyHits).toBe(0);
    expect(out.resolutions[0]).toEqual(resolved);
  });

  test("path 3: escalated to the model, and it does NOT resolve -- escalation is a real call with a real outcome, not a guaranteed hit", async () => {
    let level1Calls = 0;
    const repo = fakeRepo();
    const fuzzyRepo = fakeFuzzyRepo({}); // no confident match -- escalates
    const fakeLevel1 = async (texts: string[]): Promise<Level1Outcome> => {
      level1Calls++;
      return { resolutions: texts.map(() => null), reasons: texts.map(() => "Level 1 could not map this to any known function"), modelCalls: 1 };
    };

    const out = await resolveMissesWithReuseCache(["completely unmappable gibberish input"], CTX, repo, fakeLevel1, {}, fuzzyRepo);

    expect(level1Calls).toBe(1); // the escalation genuinely happened
    expect(out.modelCalls).toBe(1);
    expect(out.fuzzyHits).toBe(0);
    expect(out.resolutions[0]).toBeNull(); // ...and still didn't resolve -- a real miss, not a fabricated pass
    expect(out.reasons[0]).toBe("Level 1 could not map this to any known function");
  });
});

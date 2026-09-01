/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { classifyL0, type L0Repo } from "./level0";

function fakeRepo(overrides: Partial<L0Repo> = {}): L0Repo {
  return {
    findPhraseMapMatch: async () => null,
    findLastPillUse: async () => null,
    ...overrides,
  };
}

const CTX = { orgId: "org_1", userId: "user_1" };

describe("classifyL0 -- the L0 ladder stops at the first hit", () => {
  test("tier 1: acknowledgement -> CHAT, never reaches phrase_map", async () => {
    let phraseMapCalled = false;
    const repo = fakeRepo({ findPhraseMapMatch: async () => { phraseMapCalled = true; return null; } });
    const r = await classifyL0("thanks", CTX, repo);
    expect(r).toEqual({ kind: "chat" });
    expect(phraseMapCalled).toBe(false);
  });

  test('"thanks" variants all classify as chat (case/punctuation insensitive)', async () => {
    const repo = fakeRepo();
    for (const text of ["Thanks", "THANKS!", "  thanks.  ", "ok", "Got it", "noted.", "sure"]) {
      const r = await classifyL0(text, CTX, repo);
      expect(r).toEqual({ kind: "chat" });
    }
  });

  test("tier 2: phrase_map EXACT hit wins over a structural pattern in the same text", async () => {
    const repo = fakeRepo({
      findPhraseMapMatch: async (orgId, phrase) => {
        if (orgId === "org_1" && phrase === "cdr-001 50% done") {
          return { functionId: "custom_promoted_function", fixedParams: { note: "promoted" } };
        }
        return null;
      },
    });
    const r = await classifyL0("CDR-001 50% done", CTX, repo);
    expect(r).toEqual({ kind: "match", functionId: "custom_promoted_function", params: { note: "promoted" }, source: "phrase_map" });
  });

  test("phrase_map lookup is EXACT match only -- a near-miss does not hit", async () => {
    const repo = fakeRepo({
      findPhraseMapMatch: async (_orgId, phrase) => (phrase === "exact phrase" ? { functionId: "fn", fixedParams: null } : null),
    });
    const r = await classifyL0("exact phrase extra words", CTX, repo);
    expect(r.kind).not.toBe("match");
  });

  test("tier 3: structural pattern -- item code + percent, no phrase_map hit", async () => {
    const repo = fakeRepo();
    const r = await classifyL0("CDR-001 is 50% done", CTX, repo);
    expect(r).toEqual({ kind: "match", functionId: "record_work_progress", params: { itemCode: "CDR-001", percent: 50 }, source: "structural" });
  });

  test("tier 3 recognises a decimal BOQ item code (1.01) as the item code, not the percent", async () => {
    const repo = fakeRepo();
    const r = await classifyL0("1.01 progress is 60%", CTX, repo);
    expect(r.kind).toBe("match");
    if (r.kind === "match") {
      expect(r.params.itemCode).toBe("1.01");
      expect(r.params.percent).toBe(60);
    }
  });

  test("tier 3 does not fire without BOTH an item code and a percent", async () => {
    const repo = fakeRepo();
    expect((await classifyL0("CDR-001 is done", CTX, repo)).kind).toBe("miss");
    // "50%" alone with no prior task and no item code has nothing to recall -> miss
    expect((await classifyL0("50% overall", CTX, repo)).kind).toBe("miss");
  });

  test("tier 4: last-action recall reuses the prior task's function + context, overriding only percent", async () => {
    const repo = fakeRepo({
      findLastPillUse: async (orgId, userId) => {
        if (orgId === "org_1" && userId === "user_1") {
          return { functionId: "record_work_progress", params: { itemCode: "BBC-005", percent: 30 } };
        }
        return null;
      },
    });
    const r = await classifyL0("70% now", CTX, repo);
    expect(r).toEqual({ kind: "match", functionId: "record_work_progress", params: { itemCode: "BBC-005", percent: 70 }, source: "last_action" });
  });

  test("tier 4 is a miss when there is no prior task", async () => {
    const repo = fakeRepo({ findLastPillUse: async () => null });
    const r = await classifyL0("70% now", CTX, repo);
    expect(r.kind).toBe("miss");
  });

  test("tier 4 never fires when the prior task carries no function_id", async () => {
    const repo = fakeRepo({ findLastPillUse: async () => ({ functionId: null, params: {} }) });
    const r = await classifyL0("70% now", CTX, repo);
    expect(r.kind).toBe("miss");
  });

  test("a genuine miss: no acknowledgement, no phrase_map hit, no structural pattern, no prior task", async () => {
    const repo = fakeRepo();
    const r = await classifyL0("please look into this when you can", CTX, repo);
    expect(r).toEqual({ kind: "miss" });
  });

  test("ladder order: structural beats last-action even when both could theoretically apply", async () => {
    const repo = fakeRepo({
      findLastPillUse: async () => ({ functionId: "some_other_function", params: { itemCode: "SHOULD-NOT-BE-USED" } }),
    });
    const r = await classifyL0("MVT-002 is 40% done", CTX, repo);
    expect(r.kind).toBe("match");
    if (r.kind === "match") {
      expect(r.source).toBe("structural");
      expect(r.params.itemCode).toBe("MVT-002");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// R53: the two defects a LIVE run found on 26 Aug 2026, both fixed here.
//
// compliance.submissions igtnbo6sj5a2wsagy0fe4g7k reads
// "ZZ-AUDIT1-999R 15% done". The old single item-code pattern could not
// match that shape at all, so the structural tier missed, the ladder fell
// through to last-action recall, and recall returned the user's most recent
// pill -- which was the READ-ONLY budget function. The result was a budget
// lookup carrying percent=15: not a wrong answer so much as a meaningless
// one, produced silently.
// ─────────────────────────────────────────────────────────────────────────
describe("classifyL0 -- structural tier, every real item-code shape", () => {
  const emptyRepo: L0Repo = {
    async findPhraseMapMatch() { return null; },
    async findLastPillUse() { return null; },
  };
  const ctx = { orgId: "org1", userId: "u1" };

  // Shapes measured on compliance.construction_boq_line_items.item_code,
  // plus the ZZ-AUDIT fixture shape that appears in the live submissions.
  const cases: Array<[string, string, number]> = [
    ["PP1 is 50% done", "PP1", 50],
    ["F01 is 50% done", "F01", 50],
    ["M9 is 20% done", "M9", 20],
    ["M9-A is 20% done", "M9-A", 20],
    ["CDR-001 is 75% done", "CDR-001", 75],
    ["HLW-BOQ-999 is 10% done", "HLW-BOQ-999", 10],
    ["ZZ-AUDIT1-999R 15% done", "ZZ-AUDIT1-999R", 15],
    ["ZZ-AUDIT5-999 15 percent done", "ZZ-AUDIT5-999", 15],
    ["item 1.01 is at 50 percent", "1.01", 50],
    ["4.04 is 65% done", "4.04", 65],
    ["99 is 30% done", "99", 30],
  ];

  for (const [input, expectedCode, expectedPercent] of cases) {
    test(`"${input}" -> record_work_progress(${expectedCode}, ${expectedPercent})`, async () => {
      const r = await classifyL0(input, ctx, emptyRepo);
      expect(r.kind).toBe("match");
      if (r.kind !== "match") return;
      expect(r.functionId).toBe("record_work_progress");
      expect(r.source).toBe("structural");
      expect(r.params.itemCode).toBe(expectedCode);
      expect(r.params.percent).toBe(expectedPercent);
    });
  }

  test("the percentage is never mistaken for the item code", async () => {
    const r = await classifyL0("50% done on CDR-001", ctx, emptyRepo);
    expect(r.kind).toBe("match");
    if (r.kind !== "match") return;
    expect(r.params.itemCode).toBe("CDR-001");
    expect(r.params.percent).toBe(50);
  });

  test('a word with no digit is not an item code -- "frame" alone does not match', async () => {
    const r = await classifyL0("frame is 50% done", ctx, emptyRepo);
    // no code at all in the sentence -> structural misses, ladder falls through
    expect(r.kind).toBe("miss");
  });

  test("a percent outside 0-100 is refused rather than clamped", async () => {
    expect((await classifyL0("PP1 is 150% done", ctx, emptyRepo)).kind).toBe("miss");
  });
});

describe("classifyL0 -- last-action recall reuses only a WRITE action", () => {
  const ctx = { orgId: "org1", userId: "u1" };

  test("a bare percent follow-up reuses the last WRITE action", async () => {
    const repo: L0Repo = {
      async findPhraseMapMatch() { return null; },
      async findLastPillUse() { return { functionId: "record_work_progress", params: { itemCode: "CDR-001", percent: 50 } }; },
    };
    const r = await classifyL0("60% now", ctx, repo);
    expect(r.kind).toBe("match");
    if (r.kind !== "match") return;
    expect(r.functionId).toBe("record_work_progress");
    expect(r.source).toBe("last_action");
    expect(r.params.itemCode).toBe("CDR-001");
    expect(r.params.percent).toBe(60);
  });

  // The repo is what filters reads out (it is the layer that knows which
  // functions write). With nothing recallable it must MISS and escalate --
  // never invent, never reach for whatever happens to be most recent.
  test("with no recallable write action, a bare percent is a MISS, not a guess", async () => {
    const repo: L0Repo = {
      async findPhraseMapMatch() { return null; },
      async findLastPillUse() { return null; },
    };
    expect((await classifyL0("60% now", ctx, repo)).kind).toBe("miss");
  });
});

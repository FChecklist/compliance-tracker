/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { classifyL0, tryTimesheetMatch, type L0Repo } from "./level0";

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

// R67 C-03 -- Tier 3b, the timesheet pattern. `now` is pinned in every case:
// a tier that resolves "today" by reading the clock is a tier whose test
// passes at 09:00 and fails at 23:59 UTC.
const NOW = new Date("2026-09-02T14:00:00.000Z");

describe("tryTimesheetMatch -- deterministic, no model, and the verb is required", () => {
  test("C-03's own sentence resolves with every slot filled", () => {
    const m = tryTimesheetMatch("log 3 hours on joinery drawings today", NOW);
    expect(m).not.toBeNull();
    expect(m!.functionId).toBe("record_timesheet");
    expect(m!.params.hours).toBe(3);
    expect(m!.params.spentOn).toBe("2026-09-02");
    expect(m!.params.task).toBe("joinery drawings");
    expect(m!.missingParams).toEqual([]);
  });

  test("the composer's own placeholder sentence resolves too", () => {
    const m = tryTimesheetMatch("3 hours on #12 joinery shop drawings today", NOW);
    expect(m).toBeNull(); // no logging verb: see the next test for why
    const withVerb = tryTimesheetMatch("logged 3 hours on #12 joinery shop drawings today", NOW);
    expect(withVerb!.params.task).toBe("#12 joinery shop drawings");
  });

  test("*** A DURATION WITHOUT A LOGGING VERB IS NEVER A TIMESHEET ENTRY ***", () => {
    expect(tryTimesheetMatch("the slab took 3 hours to cure", NOW)).toBeNull();
    expect(tryTimesheetMatch("delivery is 2 hours late", NOW)).toBeNull();
  });

  // *** FIX PASS -- A DURATION AND A VERB, WITH NOTHING LOGGED AGAINST, IS
  // NOT A TIMESHEET ENTRY EITHER. ***
  //
  // This tier used to return a proposal with `task` missing whenever a verb
  // and a duration appeared, and the verb list is broad ("spent", "worked",
  // "booked"). So a plain observation -- "we spent 3 hrs waiting for the
  // crane" -- resolved at Level 0 to record_timesheet with a hole in it: a
  // chat sentence promoted to a WRITE PROPOSAL, ahead of last-action recall.
  // The task clause is what makes the sentence an entry, so without one there
  // is nothing to propose and it falls through to Level 1.
  test("*** A LOGGING VERB WITH NOTHING LOGGED AGAINST IT IS NOT A MATCH ***", () => {
    expect(tryTimesheetMatch("log 3 hours today", NOW)).toBeNull();
    expect(tryTimesheetMatch("we spent 3 hrs waiting for the crane", NOW)).toBeNull();
    // " on " present but empty after the pattern's own tokens are cut out.
    expect(tryTimesheetMatch("logged 3 hours on today", NOW)).toBeNull();
  });

  test("the sentence that IS an entry still matches, and reports nothing missing", () => {
    const m = tryTimesheetMatch("spent 3 hrs on the crane platform", NOW);
    expect(m).not.toBeNull();
    expect(m!.params.hours).toBe(3);
    expect(m!.params.task).toBe("the crane platform");
    // projectId is a declared required param of record_timesheet, but Level 0
    // has no project context -- the composer's top rail supplies it -- so it
    // is deliberately not reported as a question here.
    expect(m!.missingParams).toEqual([]);
  });

  test("yesterday, an explicit ISO date, and no day at all", () => {
    expect(tryTimesheetMatch("logged 2 hours on cladding yesterday", NOW)!.params.spentOn).toBe("2026-09-01");
    expect(tryTimesheetMatch("logged 2 hours on cladding 2026-08-14", NOW)!.params.spentOn).toBe("2026-08-14");
    // No day word: the executor defaults it to today rather than this tier
    // guessing, so the param is simply absent here.
    expect(tryTimesheetMatch("logged 2 hours on cladding", NOW)!.params.spentOn).toBeUndefined();
  });

  test("fractional and short forms of the duration", () => {
    expect(tryTimesheetMatch("spent 2.5 hrs on cladding", NOW)!.params.hours).toBe(2.5);
    expect(tryTimesheetMatch("worked 8h on cladding", NOW)!.params.hours).toBe(8);
  });

  test("an impossible duration is not a match at all", () => {
    expect(tryTimesheetMatch("logged 0 hours on cladding", NOW)).toBeNull();
    expect(tryTimesheetMatch("logged 99 hours on cladding", NOW)).toBeNull();
  });
});

describe("classifyL0 -- the timesheet tier sits after progress and before recall", () => {
  const ctx = { orgId: "org1", userId: "u1", now: NOW };

  test("a timesheet sentence resolves at Level 0, so it costs no model call", async () => {
    const r = await classifyL0("log 3 hours on joinery drawings today", ctx, fakeRepo());
    expect(r.kind).toBe("match");
    if (r.kind !== "match") return;
    expect(r.functionId).toBe("record_timesheet");
    expect(r.source).toBe("structural");
    expect(r.missingParams).toEqual([]);
  });

  test("progress still wins when the sentence is a progress sentence", async () => {
    const r = await classifyL0("PP1 is 50% done", ctx, fakeRepo());
    expect(r.kind).toBe("match");
    if (r.kind !== "match") return;
    expect(r.functionId).toBe("record_work_progress");
  });

  test("a timesheet sentence never falls through to last-action recall", async () => {
    const repo = fakeRepo({
      findLastPillUse: async () => ({ functionId: "record_work_progress", params: { itemCode: "CDR-001" } }),
    });
    const r = await classifyL0("log 3 hours on joinery drawings today", ctx, repo);
    expect(r.kind).toBe("match");
    if (r.kind !== "match") return;
    expect(r.functionId).toBe("record_timesheet");
  });
});

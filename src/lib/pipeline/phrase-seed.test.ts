/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { seedPhrases, seedSources } from "./phrase-seed";
import { normaliseForMatch } from "./classify";
import { EXECUTABLE_FUNCTION_IDS, functionWrites } from "./executor";
import { NAV_PATH_BY_FUNCTION } from "./derive-chain";

// R53 Phase 7. compliance.phrase_map had 0 rows, so Level 0's phrase tier
// could never hit and every segment paid for a model call. l0_hit_rate was 0
// by construction, not by measurement.

describe("seedPhrases() -- the scope boundary", () => {
  // REGISTER NO FUNCTION OUTSIDE THE 70. The uat_function catalogue is the
  // boundary; NAV_PATH_BY_FUNCTION is the join to it, each entry citing its
  // row. A function in neither is out of scope, whatever else it can do.
  test("every seeded function is one the pipeline can actually execute", () => {
    for (const { functionId } of seedPhrases()) {
      expect(EXECUTABLE_FUNCTION_IDS).toContain(functionId);
    }
  });

  test("every seeded function is inside the uat_function catalogue", () => {
    for (const { functionId } of seedPhrases()) {
      expect(Object.keys(NAV_PATH_BY_FUNCTION)).toContain(functionId);
    }
  });

  test("every seeded function cites the catalogue row it came from", () => {
    for (const s of seedSources()) {
      expect(s.source).toMatch(/^F\d{3} \/ R-/);
      expect(s.phraseCount).toBeGreaterThan(0);
    }
  });
});

describe("seedPhrases() -- exact match or miss", () => {
  test("every phrase is stored already normalised, so the lookup can be an equality test", () => {
    for (const { phrase } of seedPhrases()) {
      expect(phrase).toBe(normaliseForMatch(phrase));
      expect(phrase).toBe(phrase.toLowerCase());
      expect(phrase).not.toMatch(/\s{2,}/);
      expect(phrase).not.toMatch(/[.!?]$/);
    }
  });

  test("no phrase is claimed by two different functions", () => {
    const seen = new Map<string, string>();
    for (const { phrase, functionId } of seedPhrases()) {
      expect(seen.has(phrase)).toBe(false);
      seen.set(phrase, functionId);
    }
  });

  test("no phrase is empty or whitespace", () => {
    for (const { phrase } of seedPhrases()) {
      expect(phrase.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("seedPhrases() -- what is deliberately NOT seeded", () => {
  // A phrase_map entry pointing at a WRITE function resolves with whatever
  // fixed params the row carries -- which for a bare phrase is none. It could
  // only ever produce a task that asks for two missing values. That is noise,
  // not a hit, and the structural tier already handles the real shape
  // ("PP1 is 50% done") deterministically and for free.
  test("no seeded phrase resolves to a write function", () => {
    for (const { functionId } of seedPhrases()) {
      expect(functionWrites(functionId)).toBe(false);
    }
  });

  test("record_work_progress is not seeded", () => {
    expect(seedPhrases().some((p) => p.functionId === "record_work_progress")).toBe(false);
  });
});

describe("seedPhrases() -- the phrases the live failures need", () => {
  const byPhrase = new Map(seedPhrases().map((p) => [p.phrase, p.functionId]));

  // compliance.submissions dug0ytanzzdoa7dve35hu99l and
  // v9f7azoo3x5okh7v0jnpn2bk: "PP1 is 50% done and show me the budget".
  // Phase 3 splits it; this is what the second half has to land on.
  test('"show me the budget" resolves to the budget function', () => {
    expect(byPhrase.get("show me the budget")).toBe("get_construction_budget_status");
  });

  // compliance.submissions ox842p0zl4nkpxow35ds7p8o -- resolved via a paid
  // Level 1 call on 24 Aug. It is free from now on.
  test('"how is this project doing overall" resolves to the dashboard', () => {
    expect(byPhrase.get("how is this project doing overall")).toBe("get_construction_project_dashboard");
  });

  test("the phrases survive real user punctuation and casing", () => {
    for (const typed of ["Show me the budget.", "SHOW ME THE BUDGET", "  show   me  the budget  "]) {
      expect(byPhrase.get(normaliseForMatch(typed))).toBe("get_construction_budget_status");
    }
  });
});

describe("seedPhrases() -- size", () => {
  test("the seed is a real catalogue, not a token one", () => {
    expect(seedPhrases().length).toBeGreaterThanOrEqual(40);
  });

  test("it is deterministic -- two calls produce the same rows in the same order", () => {
    expect(seedPhrases()).toEqual(seedPhrases());
  });
});

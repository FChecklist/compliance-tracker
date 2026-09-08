/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { executorFor } from "./run-submission";
import type { ResolutionSource } from "./classify";

// G-02: "whether the AI acted must be recoverable".
//
// pipeline_tasks.executor exists to answer exactly that question, and every row
// was written with a hardcoded "software" -- including the rows whose function
// and parameters a MODEL chose. A column that answers "software" every time is
// worse than a null one, because a wrong answer is not obviously missing.
//
// These assertions are about PROVENANCE, so they are deliberately written
// against the resolution SOURCE and not against `level`. That distinction is
// the whole finding: see the reuse_cache case below.

const SOURCE = readFileSync(join(import.meta.dir, "run-submission.ts"), "utf8");

describe("G-02: an executed write records whether a model chose it", () => {
  test("*** THE REQUIRED PROOF: a model-resolved segment is recorded as ai ***", () => {
    expect(executorFor("level1")).toBe("ai");
  });

  test("every deterministic Level 0 source is recorded as software", () => {
    const deterministic: ResolutionSource[] = ["phrase_map", "structural", "last_action"];
    for (const source of deterministic) {
      expect(`${source}=${executorFor(source)}`).toBe(`${source}=software`);
    }
  });

  test("a reuse_cache replay is software, and that is a judgement, not an oversight", () => {
    // No model ran for THIS write, so "the AI acted" is false for this request.
    // The mapping being replayed was chosen by a model earlier, and that
    // provenance is not lost: it lives in compliance.reuse_cache, keyed by the
    // same user+project+normalised text. If G-02 is ever read as "was this
    // write's SHAPE ever decided by a model", this is the line to change --
    // and the enum has no third value to change it to.
    expect(executorFor("reuse_cache")).toBe("software");
  });

  test("an unresolved segment is software, never ai", () => {
    // "none" reaches mintTask only if a caller ever mints a task for a segment
    // that resolved to nothing. It must not default to ai.
    expect(executorFor("none")).toBe("software");
  });

  test("*** the column is no longer hardcoded ***", () => {
    // The defect was a literal. If it comes back, every row is "software"
    // again and every assertion above still passes, because they test the
    // helper rather than the insert.
    //
    // Matched on whole LINES, not as a substring: the doc comment above
    // mintTask quotes the defect verbatim in order to describe it, and a
    // substring check cannot tell the description from the thing.
    const codeLines = SOURCE.split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => !l.startsWith("*") && !l.startsWith("//"));
    expect(codeLines).not.toContain('executor: "software",');
    expect(codeLines).toContain("executor: executorFor(source),");
  });

  test("`level` is NOT what the executor is derived from", () => {
    // reuse-cache.ts:118 sets level 0 on a replayed Level 1 answer on purpose
    // -- "a real $0 software hit by directive section 10's own definition".
    // That is billing truth. Deriving provenance from it would record a
    // model-chosen mapping as software for the wrong reason, and would keep
    // doing so silently if the billing rule ever changed.
    expect(SOURCE).toContain("function executorFor(source: ResolutionSource");
    expect(SOURCE).not.toContain("executorFor(c.level");
  });

  test("both mint sites pass a real source rather than a constant ai", () => {
    // The pill path is the user naming the function, so it is software by
    // construction; the classified path must forward the segment's own source.
    expect(SOURCE).toContain("derived, c.source)");
    expect(SOURCE).toContain('derived, "phrase_map")');
  });
});

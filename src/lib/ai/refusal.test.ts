/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { NO_COMMENTARY_SENTENCE } from "./refusal";

// R67 FIX PASS -- a sibling test for the one-constant leaf module B-05 added.
// A constant is small, but this one is a CONTRACT between two layers that
// cannot see each other: adapter.ts throws it, dry-run.ts returns the records
// under it. If either drifted, the product would say two different things
// about the same condition, which is the exact defect B-05 exists to fix.
describe("NO_COMMENTARY_SENTENCE -- what a model refusal is allowed to say", () => {
  test("it is the exact shared sentence", () => {
    expect(NO_COMMENTARY_SENTENCE).toBe("VERI can't add commentary right now - here is what the records say");
  });

  test("it replaces R66's dead end -- it never says the account has no AI", () => {
    expect(NO_COMMENTARY_SENTENCE).not.toMatch(/not available for this account/i);
    expect(NO_COMMENTARY_SENTENCE).not.toMatch(/not enabled/i);
  });

  test("it promises the answer rather than only refusing", () => {
    expect(NO_COMMENTARY_SENTENCE).toMatch(/here is what the records say/);
  });

  test("it obeys the three D-03 rules a user-facing sentence obeys", () => {
    // no camelCase, no snake_case function id, no host:port
    expect(NO_COMMENTARY_SENTENCE).not.toMatch(/[a-z][A-Z]/);
    expect(NO_COMMENTARY_SENTENCE).not.toMatch(/_/);
    expect(NO_COMMENTARY_SENTENCE).not.toMatch(/\d+\.\d+\.\d+\.\d+:\d+/);
  });

  test("the module is a leaf -- it imports nothing, so neither layer gains a cycle", async () => {
    const source = await Bun.file(new URL("./refusal.ts", import.meta.url).pathname.replace(/^\//, "")).text();
    expect(source).not.toMatch(/^\s*import\s/m);
  });
});

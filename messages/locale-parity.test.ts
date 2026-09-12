// R75 Part 4, review item #6: "i18n keys both directions" -- a permanent
// regression guard for the one direction that is cheap and 100% reliable to
// check mechanically (structural key-set comparison between the two locale
// files). This is deliberately narrow: it does NOT attempt to verify code
// usage vs messages/en.json (that direction was swept once by hand this
// session -- see platform.claude_log, R75 Part 4 -- but a reliable
// code-usage check needs real per-variable useTranslations() binding
// tracking, which is not something worth hand-rolling into a CI-blocking
// test without a proper AST parse; a naive regex version produces false
// positives on any file with two differently-named hook bindings and would
// make this test untrustworthy rather than useful).
//
// What this DOES catch, cheaply and reliably, forever: a key added to one
// locale file and forgotten in the other. That drift was previously only
// caught by an ad hoc one-off script; it now fails CI the moment it happens.
import { describe, expect, test } from "bun:test";
import en from "./en.json";
import hi from "./hi.json";

function flatten(obj: unknown, prefix = ""): Set<string> {
  const out = new Set<string>();
  if (obj === null || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const c of flatten(v, key)) out.add(c);
    } else {
      out.add(key);
    }
  }
  return out;
}

describe("messages/en.json <-> messages/hi.json: leaf-key parity", () => {
  test("every key in en.json exists in hi.json", () => {
    const enKeys = flatten(en);
    const hiKeys = flatten(hi);
    const missingFromHi = [...enKeys].filter((k) => !hiKeys.has(k));
    expect(missingFromHi).toEqual([]);
  });

  test("every key in hi.json exists in en.json (no drifted/orphaned translation)", () => {
    const enKeys = flatten(en);
    const hiKeys = flatten(hi);
    const missingFromEn = [...hiKeys].filter((k) => !enKeys.has(k));
    expect(missingFromEn).toEqual([]);
  });

  test("neither file is empty (a parse/import failure would silently produce {})", () => {
    expect(flatten(en).size).toBeGreaterThan(100);
    expect(flatten(hi).size).toBeGreaterThan(100);
  });
});

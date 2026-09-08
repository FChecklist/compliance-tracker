/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// A Tailwind colour utility whose token does not exist is not an error. It is
// SILENT: the class emits no rule, the element falls back to whatever it would
// have inherited, and the result reads as "plain" rather than "broken". Nobody
// files a bug against a badge that looks slightly flat.
//
// FOUND THE EXPENSIVE WAY, 2026-09-09. Chasing a /pricing contrast failure led
// to `bg-ct-accent` on the "Pricing" badge, and `--color-ct-accent` is defined
// NOWHERE -- not in globals.css, not in @fchecklist/veridian-ui-kit. Confirmed
// against the PRODUCTION stylesheet rather than reasoned about: `next build`
// then grep, and the string "ct-accent" appears zero times in the emitted CSS
// while "ct-teal" appears 24 times. (The contrast failure turned out to be
// something else entirely -- axe scanning mid-animation -- so this defect was
// found beside the bug, not as it.)
//
// WHY THIS IS AN INVENTORY AND NOT `expect(dead).toEqual([])`. Two classes are
// dead across 67 files. Replacing them means choosing colours for 67 files'
// worth of UI at a glance, unverified, which is exactly the broad unreviewed
// sweep this codebase's own token comments argue against (see globals.css on
// why --color-ct-saffron was scoped rather than changed). So the list is
// enforced in BOTH directions, the way KNOWN_OPEN_NESTING is: a NEW dead class
// fails immediately, and REMOVING one from the code also fails, which is the
// prompt to delete it from here. Neither can drift silently.

const SRC = join(import.meta.dir, "..");
const GLOBALS = join(SRC, "app", "globals.css");
const UI_KIT = join(
  SRC, "..", "node_modules", "@fchecklist", "veridian-ui-kit", "src", "tokens", "globals.css",
);

/** Every `--color-ct-*` token, from BOTH files globals.css composes. */
function definedTokens(): Set<string> {
  const out = new Set<string>();
  for (const file of [GLOBALS, UI_KIT]) {
    let css: string;
    try {
      css = readFileSync(file, "utf8");
    } catch {
      // The ui-kit is a dependency; if it is missing the run is not measuring
      // what it claims to and must say so rather than report a clean sweep.
      throw new Error(`design-token-integrity: cannot read ${file} -- token set would be incomplete`);
    }
    for (const m of css.matchAll(/--color-(ct-[a-z0-9-]+)\s*:/g)) out.add(m[1]);
  }
  return out;
}

/** Every ct-* colour name referenced by a Tailwind utility in the app source. */
function usedNames(): Map<string, Set<string>> {
  const utility =
    /\b(?:bg|text|border|ring|fill|stroke|from|via|to|shadow|outline|decoration|accent|caret|divide|placeholder)-(ct-[a-z0-9-]+)/g;
  const used = new Map<string, Set<string>>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "node_modules" || entry === ".next") continue;
        walk(full);
        continue;
      }
      if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
      if (entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) continue;
      const text = readFileSync(full, "utf8");
      for (const m of text.matchAll(utility)) {
        const name = m[1].split("/")[0]; // strip an opacity suffix
        if (!used.has(name)) used.set(name, new Set());
        used.get(name)!.add(full.slice(SRC.length + 1).split("\\").join("/"));
      }
    }
  };
  walk(SRC);
  return used;
}

/**
 * Colour names used in class strings for which NO --color-ct-* token exists.
 * Verified against the production stylesheet on 2026-09-09: neither string
 * appears in the emitted CSS at all.
 */
const KNOWN_DEAD: ReadonlyArray<{ name: string; approxFiles: number; note: string }> = [
  {
    name: "ct-accent",
    approxFiles: 21,
    note: 'no --color-ct-accent anywhere. globals.css defines --color-accent (#FEF3E2); there is no ct- variant. Every `bg-ct-accent` renders NO background, so elements meant to carry the accent tint show the page colour instead. The pricing badge is one.',
  },
  {
    name: "ct-teal-hover",
    approxFiles: 46,
    note: 'no --color-ct-teal-hover, though --color-ct-teal exists and works (24 occurrences in the built CSS). So `hover:bg-ct-teal-hover` is a hover state that does not change anything -- the affordance is declared and absent.',
  },
];

describe("design tokens: a ct-* colour class must resolve to a real token", () => {
  test("the scan actually read the source -- an empty walk would pass everything", () => {
    const used = usedNames();
    expect(used.size).toBeGreaterThan(20);
    expect(definedTokens().size).toBeGreaterThan(30);
    // ct-navy is used everywhere and definitely works; if the scan cannot see
    // it, the scan is broken rather than the tokens.
    expect(used.has("ct-navy")).toBe(true);
    expect(definedTokens().has("ct-navy")).toBe(true);
  });

  test("*** THE REQUIRED PROOF: no NEW dead colour class has appeared ***", () => {
    const defined = definedTokens();
    const dead = [...usedNames().keys()].filter((n) => !defined.has(n)).sort();
    const known = KNOWN_DEAD.map((d) => d.name).sort();
    // If this fails with something new in `dead`, a class was written against a
    // token that does not exist and the element it styles is silently unstyled.
    // Do not add it here to make the test pass -- either define the token or
    // use one that exists.
    expect(dead).toEqual(known);
  });

  test("every known-dead entry is still dead, so this list cannot outlive the defect", () => {
    const defined = definedTokens();
    const used = usedNames();
    const stale = KNOWN_DEAD.filter((d) => defined.has(d.name) || !used.has(d.name)).map((d) => d.name);
    // A fixed entry must be REMOVED from KNOWN_DEAD. Leaving it here would let
    // the list quietly describe a world that has moved on -- the same failure
    // the tenant-scoped.ts nesting comment had before it became a test.
    expect(stale).toEqual([]);
  });

  test("each known-dead class still affects roughly the number of files recorded", () => {
    const used = usedNames();
    for (const entry of KNOWN_DEAD) {
      const actual = used.get(entry.name)?.size ?? 0;
      // Loose bound on purpose: the point is that the blast radius has not
      // silently multiplied, not that a file count is frozen.
      expect(`${entry.name}:${actual <= entry.approxFiles * 2 ? "ok" : actual}`).toBe(`${entry.name}:ok`);
    }
  });
});

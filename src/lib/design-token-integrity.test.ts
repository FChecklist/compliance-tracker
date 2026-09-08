/// <reference types="bun-types" />
// R81 -- a colour utility that resolves to nothing renders as nothing.
//
// WHY THIS EXISTS. `bg-ct-accent` is used in 20 files. `--color-ct-accent` is
// defined in neither this app's CSS nor the veridian-ui-kit's. Tailwind v4
// generates a utility only for a token that exists, so `bg-ct-accent` is a
// NO-OP CLASS: every element intended to carry an accent background renders with
// no background at all. Nobody noticed for the reason these are always missed --
// the fallback is the page colour, so it looks plain rather than broken. It
// surfaced only when an accessibility check computed a real contrast ratio and
// found near-white text on cream at 1.06:1, i.e. invisible.
//
// The second one is worse and nobody had found it: `bg-ct-teal-hover` is used in
// 45 files -- more than twice the footprint -- and is equally undefined. Its
// sibling `--color-ct-saffron-hover` IS defined, which is exactly why the
// omission survives review: the pattern looks established.
//
// WHAT MAKES THIS CLASS OF BUG INVISIBLE. There is no error anywhere. Not at
// build time (an unknown utility is simply not emitted), not at type-check time
// (it is a string in a className), not at runtime (the element renders, just
// unstyled), and not in a screenshot review unless someone knows what the accent
// was meant to look like. The only signal is a human noticing an element looks
// plainer than intended -- which is why one of these survived across 20 files and
// the other across 45.
//
// WHY THE TWO KNOWN ONES ARE ALLOW-LISTED RATHER THAN FAILING. Defining them
// means choosing colour VALUES, and brand colours are not this session's to
// invent. Listing them keeps the debt visible and named while making any NEW
// undefined token fail immediately -- which is the regression this exists to
// stop. Emptying ALLOWED is how this closes.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..", "..");
const SRC = path.join(ROOT, "src");
const UI_KIT_TOKENS = path.join(
  ROOT, "node_modules", "@fchecklist", "veridian-ui-kit", "src", "tokens", "globals.css",
);

/**
 * Known-undefined tokens. Each needs a colour VALUE decided by whoever owns the
 * brand palette, not invented here. A new entry must not be added to silence a
 * failure -- define the token instead.
 */
const ALLOWED_UNDEFINED = new Map<string, string>([
  ["ct-accent", "20 files. Sibling --color-accent (#FEF3E2) exists but there is no ct- variant; needs an owner decision on whether ct-accent should alias it."],
  ["ct-teal-hover", "45 files. --color-ct-teal and --color-ct-saffron-hover both exist, so the naming pattern implies this should too."],
]);

/** Tailwind utilities that take a colour token. */
const COLOUR_UTILITIES =
  "(?:bg|text|border|ring|from|to|via|fill|stroke|divide|outline|shadow|accent|decoration|caret|placeholder)";

function walk(dir: string, match: (f: string) => boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, match, out);
    else if (match(entry)) out.push(p);
  }
  return out;
}

/** Tokens actually DEFINED, from every CSS source the app resolves against. */
function definedTokens(): Map<string, string> {
  const found = new Map<string, string>();
  const files = walk(SRC, (f) => f.endsWith(".css"));
  if (existsSync(UI_KIT_TOKENS)) files.push(UI_KIT_TOKENS);
  for (const file of files) {
    // Comments must be stripped first: globals.css DISCUSSES several tokens in
    // prose ("...for --color-ct-muted (imported from...)") and counting those as
    // definitions is how an earlier version of this scan reported 14 undefined
    // tokens that were all fine.
    const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of css.matchAll(/--color-(ct-[a-z0-9-]+)\s*:/g)) {
      if (!found.has(m[1])) found.set(m[1], file);
    }
  }
  return found;
}

/** Tokens USED by a colour utility anywhere in the app source. */
function usedTokens(): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>();
  const re = new RegExp(`${COLOUR_UTILITIES}-(ct-[a-z0-9-]+)`, "g");
  for (const file of walk(SRC, (f) => (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.includes(".test."))) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(re)) {
      if (!used.has(m[1])) used.set(m[1], new Set());
      used.get(m[1])!.add(path.relative(ROOT, file));
    }
  }
  return used;
}

describe("design tokens: a colour class that resolves to nothing renders as nothing", () => {
  test("every ct- colour utility in use resolves to a defined --color-ct-* token", () => {
    const defined = definedTokens();
    const used = usedTokens();

    // Guard the guard, twice. If either scan comes back empty the check has
    // silently stopped examining anything, which is the exact failure mode it
    // exists to catch -- and it would report success for ever.
    expect(defined.size, "found no --color-ct-* definitions at all -- the CSS scan is broken, not the codebase").toBeGreaterThan(20);
    expect(used.size, "found no ct- colour utilities at all -- the source scan is broken").toBeGreaterThan(10);

    const undefinedTokens = [...used.keys()].filter((t) => !defined.has(t)).sort();
    const unexpected = undefinedTokens.filter((t) => !ALLOWED_UNDEFINED.has(t));

    expect(
      unexpected,
      `these colour utilities reference tokens that are defined nowhere, so they render with NO colour at all: ` +
        unexpected.map((t) => `${t} (${used.get(t)!.size} files)`).join(", ") +
        `. Tailwind emits a utility only for a token that exists, so there is no build error, no type error and ` +
        `no runtime error -- the element simply renders unstyled. Define --color-${unexpected[0] ?? "ct-x"} in ` +
        `src/app/globals.css, or fix the class name.`,
    ).toEqual([]);
  });

  test("the allow-list stays honest -- no stale entries", () => {
    const defined = definedTokens();
    const used = usedTokens();
    for (const [token, why] of ALLOWED_UNDEFINED) {
      expect(
        defined.has(token),
        `${token} is now DEFINED, so its allow-list entry is spent. Remove it. (${why})`,
      ).toBe(false);
      expect(
        used.has(token),
        `${token} is allow-listed as known-undefined but nothing uses it any more. Remove the entry. (${why})`,
      ).toBe(true);
    }
  });
});

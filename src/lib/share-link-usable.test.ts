/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { isShareLinkUsable } from "./share-link-usable";

// The public share surfaces are the ONLY routes in either repo that serve
// customer data with no authentication of any kind: /share/report/[token],
// /share/attendance/[token], /shared/mom/[token], /invite/[token], and the
// guest-chat links. Every one is gated on the same two conditions, and until
// 2026-09-09 each resolver stated them itself. I first found FOUR and the
// sweep below found SEVEN -- erp-procurement-workflow, erp-vendor-master and
// firm-client-portal each carry a public token surface too, and I had missed
// all three by enumerating from the routes I already knew about.
//
// All seven were CORRECT. That is exactly why this file exists: a security
// predicate copied into seven places is not wrong today, it is a thing that goes
// wrong quietly later when one copy is edited and the others are not -- and the
// failure direction is fail-OPEN. A resolver that stops checking `revokedAt`
// keeps serving a link its owner believes they revoked, and nothing errors.

const LIB = import.meta.dir;
const SRC = join(LIB, "..");

const live = (over: Partial<{ revokedAt: Date | null; expiresAt: Date }> = {}) => ({
  revokedAt: null as Date | null,
  expiresAt: new Date("2030-01-01"),
  ...over,
});
const NOW = new Date("2026-09-09");

describe("isShareLinkUsable: the one rule for an unauthenticated token", () => {
  test("a live, unrevoked, unexpired link is usable", () => {
    expect(isShareLinkUsable(live(), NOW)).toBe(true);
  });

  test("*** a REVOKED link is refused even if it has not expired ***", () => {
    // The case that matters most: an owner clicked revoke and believes the link
    // is dead. Expiry alone would keep serving it for hours or days.
    expect(isShareLinkUsable(live({ revokedAt: new Date("2026-01-01") }), NOW)).toBe(false);
  });

  test("an EXPIRED link is refused even if it was never revoked", () => {
    expect(isShareLinkUsable(live({ expiresAt: new Date("2026-01-01") }), NOW)).toBe(false);
  });

  test("expiry is inclusive of the exact instant, not off by one", () => {
    expect(isShareLinkUsable(live({ expiresAt: NOW }), NOW)).toBe(true);
    expect(isShareLinkUsable(live({ expiresAt: new Date(NOW.getTime() - 1) }), NOW)).toBe(false);
  });

  test("a token that does not exist is refused, and reaches the reader as the same answer", () => {
    // null and undefined must both be false. A resolver that distinguished
    // "no such token" from "token expired" would tell an anonymous caller
    // which tokens exist.
    expect(isShareLinkUsable(null, NOW)).toBe(false);
    expect(isShareLinkUsable(undefined, NOW)).toBe(false);
  });

  test("it narrows the type, so a caller does not reach for a non-null assertion", () => {
    const row: { revokedAt: Date | null; expiresAt: Date; token: string } | undefined = {
      ...live(),
      token: "abc",
    };
    if (!isShareLinkUsable(row, NOW)) throw new Error("unreachable");
    // If this stops compiling, the predicate lost its `link is T` and every
    // caller will be tempted to paper over it with `!`.
    expect(row.token).toBe("abc");
  });
});

describe("no public resolver may hand-roll the rule again", () => {
  /** Every service file, read once. */
  function serviceSources(): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry === "node_modules") continue;
          walk(full);
          continue;
        }
        if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
        if (entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) continue;
        // The definition itself quotes the condition it replaces, in prose, so
        // a reader can see what was consolidated. Skip the file, and strip
        // comments everywhere else -- a rule QUOTED in a comment is not a rule
        // RESTATED in code, and a sweep that cannot tell them apart teaches
        // people to stop explaining themselves.
        if (entry === "share-link-usable.ts") continue;
        const raw = readFileSync(full, "utf8");
        const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
        out.push([full.slice(SRC.length + 1).split("\\").join("/"), code]);
      }
    };
    walk(SRC);
    return out;
  }

  test("the sweep reads real files -- an empty walk would pass this vacuously", () => {
    const files = serviceSources();
    expect(files.length).toBeGreaterThan(500);
    expect(files.some(([p]) => p === "lib/services/veri-chat-service.ts")).toBe(true);
  });

  test("*** THE REQUIRED PROOF: nobody restates revokedAt-and-expiresAt inline ***", () => {
    // The exact shape that was duplicated seven times, in either variable
    // ordering. A new one means an eighth copy of a fail-open security check.
    const handRolled = /\.revokedAt\s*\|\|[^;\n]*\.expiresAt\s*<|\.expiresAt\s*<[^;\n]*\|\|[^;\n]*\.revokedAt/;
    const offenders = serviceSources()
      .filter(([, src]) => handRolled.test(src))
      .map(([p]) => p)
      .sort();
    // If this fails: import isShareLinkUsable from @/lib/share-link-usable
    // rather than writing the condition again.
    expect(offenders).toEqual([]);
  });

  test("every resolver that needs it actually imports it", () => {
    const byPath = new Map(serviceSources());
    for (const p of [
      "lib/services/report-share-service.ts",
      "lib/services/veri-meeting-service.ts",
      "lib/services/veri-chat-service.ts",
      "lib/services/erp-procurement-workflow-service.ts",
      "lib/services/erp-vendor-master-service.ts",
      "lib/services/firm-client-portal-service.ts",
    ]) {
      const src = byPath.get(p);
      expect(`${p}:${src === undefined ? "MISSING" : src.includes("share-link-usable") ? "ok" : "NOT IMPORTED"}`)
        .toBe(`${p}:ok`);
    }
  });
});

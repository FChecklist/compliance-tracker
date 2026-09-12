/// <reference types="bun-types" />
// R80 Part 2 / W-ROUTER PM-T1 -- the trigram threshold's own calibration
// fixture, as a re-runnable regression guard, not a one-off report.
//
// WHAT THIS PROVES, every time it runs against live data: the currently
// shipped resolvePhraseFuzzyHighThreshold() has ZERO false positives against
// every real same-org pair of promoted phrase_map rows on this Supabase
// project. If a future phrase_map addition ever produces a same-org pair of
// DIFFERENT-intent phrases that score at or above the shipped threshold,
// this test goes red -- that is the recalibration trigger, not a human
// remembering to re-run a script.
//
// METHODOLOGY, see phrase-fuzzy.ts's own header for the full writeup and the
// 2026-09-10 result (0.70 shipped, cross-checked against real gap_log
// misses). Same-org pairs only (a fuzzy match is always scoped to one org's
// phrase_map -- see phrase-fuzzy.ts's WHERE org_id = ...), non-test orgs
// only (test- prefixed orgs are this session's own throwaway fixtures, not
// real signal), promoted rows only (unpromoted candidates are excluded from
// the real query too).
//
// WHY IT SKIPS INSTEAD OF FAILING WITHOUT A DATABASE. Same probe-and-skip
// pattern as phrase-fuzzy.test.ts and erp-goods-receipt-nested-transaction.
// test.ts (both read in full before writing this) -- CI's placeholder DB env
// has nothing listening, and a calibration fixture with no real phrase_map
// to read is not a meaningful skip condition, it's a missing precondition.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { sql } from "drizzle-orm";
import { resolvePhraseFuzzyHighThreshold } from "./phrase-fuzzy";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

function loadDbEnvFromEnvLocalIfAbsent(): void {
  const path = join(REPO_ROOT, ".env.local");
  if (!existsSync(path)) return;
  const wanted = new Set(["APP_RUNTIME_DATABASE_URL", "DATABASE_URL"]);
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    if (!wanted.has(key) || process.env[key]) continue;
    let value = match[2].trim();
    const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);
    if (value.length > 0) process.env[key] = value;
  }
}
loadDbEnvFromEnvLocalIfAbsent();

async function probeDatabase(): Promise<string | null> {
  const url = process.env.APP_RUNTIME_DATABASE_URL;
  if (!url) return "APP_RUNTIME_DATABASE_URL is not set";
  const postgres = (await import("postgres")).default;
  let lastError = "unknown error";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const probe = postgres(url, { prepare: false, ssl: { rejectUnauthorized: false }, max: 1, connect_timeout: 5, idle_timeout: 1 });
    try {
      await probe`select 1`;
      await probe.end({ timeout: 5 });
      return null;
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      const message = error instanceof Error ? error.message : String(error);
      lastError = [code, message].filter((part) => part !== undefined && part !== "").join(" ") || "unknown error";
      try {
        await probe.end({ timeout: 5 });
      } catch {
        // the probe already failed; how it closes is not interesting
      }
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return `no reachable database after 3 attempts (${lastError})`;
}

const skipReason = await probeDatabase();
if (skipReason) {
  console.warn(`[phrase-fuzzy-calibration.test.ts] SKIPPED -- ${skipReason}.`);
}

type PairRow = { same_intent: boolean; score: number };

// RLS on compliance.phrase_map scopes every read to app.current_org_id --
// there is no app_runtime-safe way to read across orgs in one query (a
// service-role bypass would be the wrong tool for a routine test, and this
// repo's own memory-write-path-guard.test.ts establishes the same posture
// for a different table). So this loops one withTenantContext per known
// real org and combines the same-org self-join in JS instead of SQL --
// fully RLS-compliant, no bypass, at the cost of the org list being
// hardcoded rather than self-discovering. DISCLOSED LIMITATION: a new real
// org's phrase_map rows will not appear in this fixture until its id is
// added here. Known real (non-test) orgs with promoted phrase_map rows as
// of 2026-09-10 (see phrase-fuzzy.ts's own calibration note for the
// methodology this list feeds):
const KNOWN_REAL_ORG_IDS = ["01d6d4ff-8324-41ca-8836-5e3102eaf589", "f339187c-eaa1-4254-af37-d417b45c1427", "ve45lczmkodbiq1m20fy48r5"];

describe.skipIf(skipReason !== null)("PM-T1 -- trigram threshold calibration against real promoted phrase_map pairs", () => {
  test("the shipped threshold has ZERO false positives on the real, non-test corpus", async () => {
    const threshold = resolvePhraseFuzzyHighThreshold();

    const perOrgResults = await Promise.all(
      KNOWN_REAL_ORG_IDS.map((orgId) =>
        withTenantContext({ orgId }, async (db) => {
          // Same-org self-join only -- a fuzzy match is always scoped to
          // one org (phrase-fuzzy.ts's own WHERE org_id = ...), so cross-org
          // pairs are not a real scenario this needs to cover.
          return db.execute(sql`
            SELECT (a.function_id = b.function_id) AS same_intent,
                   extensions.similarity(a.normalised_phrase, b.normalised_phrase) AS score
            FROM compliance.phrase_map a
            JOIN compliance.phrase_map b
              ON a.org_id = ${orgId} AND b.org_id = ${orgId} AND a.normalised_phrase < b.normalised_phrase
            WHERE a.promoted_at IS NOT NULL AND b.promoted_at IS NOT NULL
          `);
        })
      )
    );

    const pairs = perOrgResults.flat() as unknown as PairRow[];
    if (pairs.length === 0) {
      console.warn("[PM-T1] no real (non-test) promoted phrase_map pairs exist -- calibration fixture is currently empty, cannot assert anything. This is a data precondition, not a code failure.");
      return;
    }

    const positives = pairs.filter((p) => p.same_intent);
    const falsePositives = pairs.filter((p) => !p.same_intent && Number(p.score) >= threshold);
    const truePositives = positives.filter((p) => Number(p.score) >= threshold);
    const maxNegativeScore = Math.max(0, ...pairs.filter((p) => !p.same_intent).map((p) => Number(p.score)));
    const recall = positives.length > 0 ? truePositives.length / positives.length : 0;

    console.log(
      `[PM-T1] threshold=${threshold} pairs=${pairs.length} positives=${positives.length} ` +
        `tp=${truePositives.length} fp=${falsePositives.length} recall=${(recall * 100).toFixed(1)}% ` +
        `max_negative_score=${maxNegativeScore.toFixed(3)}`
    );

    // THE REGRESSION GUARD. A future phrase_map addition that creates a
    // same-org, different-intent pair scoring >= threshold fails this test
    // -- that is the signal to recalibrate, not a human noticing later.
    expect(falsePositives.length).toBe(0);
    // Sanity floor, not a target: the threshold should not be so high it is
    // functionally inert against real data. 2026-09-10's real corpus clears
    // this by a wide margin (61/632 = 9.7% at the empirical zero-FP
    // boundary, 46/632 = 7.3% at the shipped 0.70).
    expect(recall).toBeGreaterThan(0);
  });
});

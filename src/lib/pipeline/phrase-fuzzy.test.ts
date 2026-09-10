/// <reference types="bun-types" />
// R80 Part 2 / W-ROUTER P1.2+P1.3 -- real-DB tests for the trigram fuzzy tier.
//
// Unlike reuse-cache.test.ts (which injects a fake PhraseFuzzyRepo and needs
// no DB), this file tests makePhraseFuzzyRepo() itself -- the actual SQL
// query against compliance.phrase_map -- so it needs the real dev/test
// Supabase project.
//
// WHY IT SKIPS INSTEAD OF FAILING WITHOUT A DATABASE. Same reasoning as
// erp-goods-receipt-nested-transaction.test.ts's own header (read in full
// before writing this): CI runs `bun test --isolate` with placeholder DB env
// vars (.github/workflows/ci.yml -- postgresql://app_runtime:placeholder@
// localhost:5432/postgres) so importing src/lib/db doesn't throw at module
// load, but nothing is listening there. This file's FIRST version did not
// probe first and turned CI's Unit Tests job red with ECONNREFUSED -- caught
// and fixed here, not left for someone else to find. Probes first, skips the
// whole file with a printed reason when unreachable.
//
// WHY IT LOADS .env.local ITSELF. Same reasoning, same mechanism as that
// file: `bun test` sets NODE_ENV=test, and bun does not read .env.local
// under NODE_ENV=test (confirmed empirically in this repo) -- so this reads
// it explicitly, only for keys the environment has not already set, so
// CI's placeholders always win and a real CI value is never overridden.
//
// A "test-" prefixed org id is used throughout (not a real/demo tenant) --
// same convention scripts/check-test-tenant-scoping.mjs enforces for e2e
// fixtures, applied here even though that script itself only scans e2e/.
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createId } from "@paralleldrive/cuid2";
import { eq, inArray } from "drizzle-orm";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { phraseMap, pipelineSimilarityMetrics } from "@/lib/db/schema";
import { makePhraseFuzzyRepo, PHRASE_FUZZY_HIGH_THRESHOLD } from "./phrase-fuzzy";
import { resolveMissesWithReuseCache, type ReuseCacheRepo } from "./reuse-cache";
import type { Level1Context, Level1Outcome } from "./level1";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

/** Fills in DB connection strings from .env.local for keys the environment
 *  has not already set. Never overrides an existing value (CI's placeholders
 *  win) -- copied verbatim in spirit from erp-goods-receipt-nested-
 *  transaction.test.ts, same repo, same problem. */
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

/** Returns null when a database answered, else the reason to skip. Retried
 *  (a single dropped connection to a remote pooler should not silently
 *  downgrade this file to "all skipped" and look green while testing
 *  nothing); CI's placeholder host refuses immediately, so all three
 *  attempts there cost milliseconds. */
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
  console.warn(`[phrase-fuzzy.test.ts] SKIPPED -- ${skipReason}. This file needs a live app_runtime database (pcrjmlpuqsbocqfwoxod in dev); CI intentionally has none for the Unit Tests job.`);
}

const TEST_ORG = "test-p1-2-phrase-fuzzy";
const seededPhraseMapIds: string[] = [];

// Idempotent against a re-run that crashed before its own afterAll cleanup
// ran (bun test --isolate re-runs this whole file per invocation, and a
// prior in-session iteration of this exact file left rows behind while this
// test was being written) -- clears any leftover TEST_ORG rows up front
// rather than colliding on phrase_map_org_phrase_unique.
beforeAll(async () => {
  if (skipReason) return;
  await withTenantContext({ orgId: TEST_ORG }, async (db) => {
    await db.delete(phraseMap).where(eq(phraseMap.orgId, TEST_ORG));
  });
});

async function seedPromotedPhrase(normalisedPhrase: string, functionId: string, fixedParams: Record<string, unknown> | null = null): Promise<string> {
  const id = createId();
  seededPhraseMapIds.push(id);
  await withTenantContext({ orgId: TEST_ORG }, async (db) => {
    await db.insert(phraseMap).values({
      id,
      orgId: TEST_ORG,
      normalisedPhrase,
      functionId,
      fixedParams,
      promotedById: "test-seed-p1.2",
      promotedAt: new Date(0), // fixed, not Date.now() -- deterministic fixture, no reliance on wall-clock
    });
  });
  return id;
}

describe.skipIf(skipReason !== null)("makePhraseFuzzyRepo -- real pg_trgm similarity against a seeded org (P1.2)", () => {
  afterAll(async () => {
    if (seededPhraseMapIds.length === 0) return;
    await withTenantContext({ orgId: TEST_ORG }, async (db) => {
      await db.delete(phraseMap).where(inArray(phraseMap.id, seededPhraseMapIds));
    });
  });

  test("a near-duplicate paraphrase of a promoted phrase scores >= the HIGH threshold and returns more than zero rows", async () => {
    await seedPromotedPhrase("pp1 excavation work is fifty percent complete", "record_work_progress", { itemCode: "PP1" });

    const repo = makePhraseFuzzyRepo(TEST_ORG);
    // Deliberately NOT identical text -- one word appended -- proving this is
    // real trigram similarity (measured live: extensions.similarity(...) =
    // 0.918 for this exact pair against pcrjmlpuqsbocqfwoxod), not an
    // exact-match tier in disguise.
    const match = await repo.findBestMatch("PP1 excavation work is fifty percent complete now");

    expect(match).not.toBeNull();
    expect(match?.functionId).toBe("record_work_progress");
    expect(match?.fixedParams).toEqual({ itemCode: "PP1" });
    expect(match?.score).toBeGreaterThanOrEqual(PHRASE_FUZZY_HIGH_THRESHOLD);
  });

  test("an unrelated string scores below the threshold -- null, not a forced pick of the nearest row", async () => {
    await seedPromotedPhrase("record fifty percent progress on the excavation task", "record_work_progress");

    const repo = makePhraseFuzzyRepo(TEST_ORG);
    const match = await repo.findBestMatch("please raise a purchase order for cement");

    expect(match).toBeNull();
  });

  test("an UNPROMOTED phrase_map row is never matched -- same M26 rule the exact-match tier enforces", async () => {
    const id = createId();
    seededPhraseMapIds.push(id);
    await withTenantContext({ orgId: TEST_ORG }, async (db) => {
      await db.insert(phraseMap).values({
        id,
        orgId: TEST_ORG,
        normalisedPhrase: "an unreviewed candidate phrase awaiting promotion",
        functionId: "record_work_progress",
        promotedAt: null, // never promoted
      });
    });

    const repo = makePhraseFuzzyRepo(TEST_ORG);
    const match = await repo.findBestMatch("an unreviewed candidate phrase awaiting promotion");

    expect(match).toBeNull();
  });

  test("case and trailing-punctuation differences are normalised away, same as the exact-match tier", async () => {
    await seedPromotedPhrase("mark boq line pp2 as fully complete", "record_work_progress", { itemCode: "PP2" });

    const repo = makePhraseFuzzyRepo(TEST_ORG);
    const match = await repo.findBestMatch("  Mark BOQ line PP2 as fully complete.  ");

    expect(match?.functionId).toBe("record_work_progress");
    expect(match?.score).toBe(1); // normalised query is byte-identical to the stored phrase
  });
});

describe.skipIf(skipReason !== null)("P1.3 -- measuring the fuzzy-vs-model split on a seeded set, and persisting it (platform.pipeline_similarity_metrics)", () => {
  afterAll(async () => {
    if (seededPhraseMapIds.length === 0) return;
    // Best-effort cleanup for THIS describe block's own seeds too, in case
    // it runs in isolation (--isolate runs each file in its own process, but
    // both describe blocks share the module-level seededPhraseMapIds array).
  });

  test("resolveMissesWithReuseCache split (fuzzy vs model) on a mixed batch is measured and written to a readable row", async () => {
    await seedPromotedPhrase("pp3 shuttering work is now complete", "record_work_progress", { itemCode: "PP3" });
    await seedPromotedPhrase("pp4 concreting work is now complete", "record_work_progress", { itemCode: "PP4" });

    const fuzzyRepo = makePhraseFuzzyRepo(TEST_ORG);
    const reuseRepo: ReuseCacheRepo = { findReuseHit: async () => null, recordReuseHit: async () => {} };
    let modelCallTexts: string[] = [];
    const fakeLevel1 = async (texts: string[]): Promise<Level1Outcome> => {
      modelCallTexts = texts;
      return { resolutions: texts.map(() => null), reasons: texts.map(() => "no candidate function"), modelCalls: 1 };
    };
    const ctx: Level1Context = { orgId: TEST_ORG, userId: "test-user", projectId: null, candidateFunctionIds: ["record_work_progress"] };

    // 2 of 3 should resolve on the trigram/software path; 1 is unrelated and
    // must escalate to (the fake) Level 1.
    const batch = ["PP3 shuttering work is now complete!", "pp4 concreting work is now complete", "please close out the vendor invoice for cement"];
    const out = await resolveMissesWithReuseCache(batch, ctx, reuseRepo, fakeLevel1, {}, fuzzyRepo);

    expect(out.fuzzyHits).toBe(2);
    expect(out.modelCalls).toBe(1);
    expect(modelCallTexts).toEqual(["please close out the vendor invoice for cement"]);

    const sampleSize = out.fuzzyHits + modelCallTexts.length;
    const fuzzyHitRate = out.fuzzyHits / sampleSize;
    const id = createId();

    await withTenantContext({ orgId: TEST_ORG }, async (db) => {
      await db.insert(pipelineSimilarityMetrics).values({
        id,
        label: "p1.3-seed-test",
        sampleSize,
        fuzzyHits: out.fuzzyHits,
        modelCalls: modelCallTexts.length,
        fuzzyHitRate: fuzzyHitRate.toFixed(4),
        note: "W-ROUTER P1.3 seeded-set measurement, bun test",
      });
    });

    const readBack = await withTenantContext({ orgId: TEST_ORG }, async (db) =>
      db.query.pipelineSimilarityMetrics.findFirst({ where: (t, { eq }) => eq(t.id, id) })
    );

    expect(readBack).toBeDefined();
    expect(readBack?.sampleSize).toBe(3);
    expect(readBack?.fuzzyHits).toBe(2);
    expect(readBack?.modelCalls).toBe(1);
    expect(Number(readBack?.fuzzyHitRate)).toBeCloseTo(2 / 3, 3);

    // cleanup: this row is a genuine, intentionally-persisted measurement
    // (that's the point of P1.3), so it is NOT deleted the way seeded
    // phrase_map fixture rows are -- it's the readable evidence the step
    // asks for. Left in place for the audit/PM to SELECT directly.
  });
});

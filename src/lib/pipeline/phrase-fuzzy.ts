// R80 Part 2 / W-ROUTER P1.2+P1.3 -- the trigram-similarity tier, merged with
// the pre-escalation confidence gate (R80_PART2_BUILD_PLAN.md's own Step 2:
// "Items 2 and 3 are one build, and 3 must land first").
//
// WHY TRIGRAM AND NOT EMBEDDINGS. See R80_PART2_BUILD_PLAN.md section 0(B):
// compliance.phrase_map is 186 rows / 80 distinct normalised_phrase values
// per org, mean length 18 chars -- cosine similarity in a 1536-dim space over
// four-to-thirty-three-character strings is noise, findSimilar() (embeddings.ts)
// returns zero rows for every query by construction, and it costs a live,
// uncached network round trip on a max:2 connection pool. pg_trgm is already
// installed (verified via list_extensions before this file was written, and
// again by this phase's migration), runs inside the request's existing
// withTenantContext connection, costs zero network round trips, and is
// deterministic.
//
// WHY THIS *IS* THE CONFIDENCE GATE (item 2), not a separate mechanism.
// MIN_CONFIDENCE (level1.ts:28) is the model's OWN self-reported number,
// read only AFTER the model has already been called -- structurally
// incapable of deciding whether to make that call. `score` here is a
// software-computed number that exists BEFORE any model call, which is what
// a pre-escalation confidence gate requires.
//
// SCOPE, deliberately narrowed from the build plan's full Step 2 for this
// phase: only the HIGH branch (score >= PHRASE_FUZZY_HIGH_THRESHOLD) is
// wired in -- resolved as a software (level 0) hit, exactly like
// reuse-cache.ts's replay of an earlier Level 1 answer. The build plan's
// middle band (LOW <= score < HIGH -> a "did you mean" ask instead of an AI
// call) is NOT built here: it requires a new Classification/verdict shape
// (a needs_input-style ask) that touches confirmSubmission's re-derivation
// guard and the wire contract to PROJEXA (verdict.ts, M24Shell.tsx), which
// is real, cross-repo blast radius this phase's surface does not cover. A
// score below HIGH falls through to Level 1 exactly as before this phase --
// behaviour-identical to the pre-P1.2 pipeline for that band, not a
// regression, just not yet the full 3-way gate. Recorded honestly, not
// silently narrowed.
//
// THRESHOLD (PM-T1, calibrated 2026-09-10): 0.70, not the build plan's
// original 0.85 placeholder. Measured against a REAL fixture, not invented
// strings: every same-org pair of promoted, non-test phrase_map rows across
// the 3 real orgs on pcrjmlpuqsbocqfwoxod, labelled positive when both rows
// share a function_id (632 pairs) and negative otherwise (5284 pairs) --
// same_intent = same function_id is this codebase's own operational
// definition everywhere else (reuse_cache, L0 exact match), not invented
// for this calibration.
//
// Result: the highest-scoring NEGATIVE pair in the whole fixture is 0.636
// similarity, so every threshold from 0.64 up to 1.0 scores ZERO false
// positives on this data -- 0.85 was never wrong, just far more
// conservative than the data supports. True-positive counts at zero FP:
// 0.64->61, 0.70->46, 0.75->30, 0.80->18, 0.85->6 (recall over 632
// positives: 9.7%, 7.3%, 4.7%, 2.8%, 0.95%). 0.70 is shipped rather than
// the knife-edge 0.64 boundary itself, for margin against a single
// borderline example moving the ceiling as phrase_map grows -- 0.70 still
// recovers 7.7x the recall of 0.85 at identical (zero) measured FP.
// Cross-checked against real negative controls: the 8 real compliance.
// gap_log rows (genuine unresolved user input, never invented) score at
// most 0.358 against any real promoted phrase -- comfortably below even
// the 0.64 boundary, so lowering the threshold does not risk absorbing a
// genuine gap as a false match.
//
// DISCLOSED LIMITATION: 2 of the 3 orgs (01d6d4ff-..., f339187c-...) carry
// byte-identical phrase sets, so the 632/5284 pair counts overstate
// independent evidence -- genuine diversity is closer to 2 phrase
// universes (a 53-phrase construction-only set, replicated, and a
// 121-phrase richer set with CRM/GST functions added) than 3. Still real
// production data, not fabricated, but modest; re-run this calibration
// (phrase-fuzzy-calibration.test.ts) once L2 promotion has grown
// phrase_map meaningfully past its 2026-09-10 size.
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { sql } from "drizzle-orm";
import { normaliseForMatch } from "./classify";

export const DEFAULT_PHRASE_FUZZY_HIGH_THRESHOLD = 0.70;

/**
 * Config-driven so a calibrated value can be deployed without a code
 * change -- read fresh on every call (not cached) so a redeploy-only config
 * change takes effect immediately, same posture as AI_PROVIDER in
 * provider-config.ts. Throws on an out-of-range or non-numeric value rather
 * than silently falling back to the default -- a typo'd threshold should
 * fail loudly, not quietly resolve every request through Level 1.
 */
export function resolvePhraseFuzzyHighThreshold(): number {
  const raw = process.env.PHRASE_FUZZY_HIGH_THRESHOLD;
  if (raw === undefined || raw.trim() === "") return DEFAULT_PHRASE_FUZZY_HIGH_THRESHOLD;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`PHRASE_FUZZY_HIGH_THRESHOLD="${raw}" is not a valid similarity threshold -- must be a number in [0, 1].`);
  }
  return parsed;
}

export type PhraseFuzzyMatch = {
  functionId: string;
  fixedParams: Record<string, unknown> | null;
  score: number;
};

export type PhraseFuzzyRepo = {
  /** Null on a miss (no promoted phrase in this org scores >= the caller's threshold). A cold/empty corpus is normal, never an error. */
  findBestMatch(text: string): Promise<PhraseFuzzyMatch | null>;
};

/**
 * Real, DB-backed PhraseFuzzyRepo. One indexed query per call, inside the
 * connection the request already holds (not the embeddings max:2 pool).
 * Only PROMOTED phrases count -- same M26 rule L0's exact-match tier
 * enforces (repos.ts's makeL0Repo), so an unreviewed L2 candidate cannot
 * resolve a live request just because it happens to be a close string match.
 */
export function makePhraseFuzzyRepo(orgId: string): PhraseFuzzyRepo {
  return {
    async findBestMatch(text: string): Promise<PhraseFuzzyMatch | null> {
      // Same normalisation L0's exact-match tier requires at its call site
      // (level0.ts) and reuse-cache.ts applies internally -- phrase_map's own
      // normalised_phrase column is stored normalised, so comparing it
      // against a raw, differently-cased/punctuated query would understate
      // similarity for what is otherwise an identical phrase.
      const normalised = normaliseForMatch(text);
      const threshold = resolvePhraseFuzzyHighThreshold();
      return withTenantContext({ orgId }, async (db) => {
        // extensions.similarity(), schema-qualified: pg_trgm is installed
        // into the `extensions` schema (see this file's own header + the
        // migration), which is not on this connection's default search_path
        // -- an unqualified similarity(...) call fails with "function
        // similarity(text, unknown) does not exist" (42883), confirmed live
        // against pcrjmlpuqsbocqfwoxod while writing this file's own test.
        const rows = await db.execute(sql`
          SELECT function_id, fixed_params, extensions.similarity(normalised_phrase, ${normalised}) AS score
          FROM compliance.phrase_map
          WHERE org_id = ${orgId} AND promoted_at IS NOT NULL
            AND extensions.similarity(normalised_phrase, ${normalised}) >= ${threshold}
          ORDER BY score DESC
          LIMIT 1
        `);
        const row = (rows as unknown as { function_id: string; fixed_params: Record<string, unknown> | null; score: number }[])[0];
        if (!row) return null;
        return { functionId: row.function_id, fixedParams: row.fixed_params ?? null, score: Number(row.score) };
      });
    },
  };
}

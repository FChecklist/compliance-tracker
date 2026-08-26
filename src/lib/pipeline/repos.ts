// R53 Phase 6 -- the pipeline's DB reads, in ONE place.
//
// run-submission.ts (which executes) and classify-only.ts (which never does)
// must resolve a phrase IDENTICALLY, or the classify endpoint becomes a
// prediction of a different system than the one that runs. Two copies of
// these four functions is how that drift starts, so there is one copy.
//
// Everything here is org-scoped through withTenantContext, so RLS is doing
// the isolation and this file is not trusted to remember to filter.
import { and, desc, eq } from "drizzle-orm";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { gapLog, phraseMap, pillUsage, projects, screenDefinitions } from "@/lib/db/schema";
import type { L0Repo } from "./level0";
import type { ChainRepo } from "./derive-chain";

export function makeL0Repo(orgId: string, userId: string): L0Repo {
  return {
    async findPhraseMapMatch(_orgId, normalisedPhrase) {
      return withTenantContext({ orgId }, async (db) => {
        // EXACT MATCH ONLY (M26). No ILIKE, no similarity, no trigram. A
        // fuzzy hit is a wrong answer with no audit trail; a miss escalates
        // to Level 1, which is cheap and honest.
        //
        // Only a PROMOTED phrase counts. Level 2's own candidates land in
        // this same table unpromoted, and without this filter an unreviewed
        // AI proposal would go live the instant it was written, skipping the
        // human approval step M26 requires.
        const row = await db.query.phraseMap.findFirst({
          where: and(eq(phraseMap.orgId, orgId), eq(phraseMap.normalisedPhrase, normalisedPhrase)),
        });
        if (!row || !row.promotedAt) return null;
        return { functionId: row.functionId, fixedParams: (row.fixedParams as Record<string, unknown> | null) ?? null };
      });
    },
    async findLastPillUse(_orgId, _userId) {
      return withTenantContext({ orgId }, async (db) => {
        // PER USER. Reading the org's newest task instead would let one
        // engineer's bare "60% now" inherit a different engineer's last
        // action and write against the wrong line.
        const row = await db.query.pillUsage.findFirst({
          where: and(eq(pillUsage.orgId, orgId), eq(pillUsage.userId, userId)),
          orderBy: [desc(pillUsage.lastUsedAt)],
        });
        if (!row || !row.functionId) return null;
        const chain = row.derivedChain as { params?: Record<string, unknown> } | null;
        return { functionId: row.functionId, params: chain?.params ?? {} };
      });
    },
  };
}

/**
 * compliance.screen_definitions is READ ONLY to R53 -- R52 owns every write.
 * This repo only ever SELECTs. Rows may be global (org_id NULL) or
 * org-specific; the org-specific one wins when both exist.
 */
export function makeChainRepo(orgId: string): ChainRepo {
  return {
    async findScreen(functionId: string) {
      return withTenantContext({ orgId }, async (db) => {
        const rows = await db.query.screenDefinitions.findMany({
          where: eq(screenDefinitions.functionId, functionId),
        });
        if (rows.length === 0) return null;
        const row = rows.find((r) => r.orgId === orgId) ?? rows[0];
        return {
          functionId: row.functionId,
          breadcrumbTemplate: row.breadcrumbTemplate ?? null,
          flowParent: row.flowParent ?? null,
        };
      });
    },
  };
}

/**
 * The chain's ROOT is the entity's own NAME, never its id. M24 keeps the
 * project visible at all times because "logging progress or a variation
 * against the wrong project is the most expensive mistake available in this
 * product" -- a chain rooted on "upv2q7pv8qcwdayybvu74egm" would defeat that
 * entirely.
 */
export async function resolveRootLabel(orgId: string, projectId: string | null): Promise<string | null> {
  if (!projectId) return null;
  return withTenantContext({ orgId }, async (db) => {
    const row = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
    return row?.name ?? null;
  });
}

/**
 * gap_log is the ONLY place a missing capability is ever noticed, and the
 * only input Phase 7's promotion loop has. A segment that resolved to
 * nothing, and a segment Level 1 had to pay for, both belong here.
 */
export async function logGapRow(
  orgId: string,
  userId: string,
  submissionId: string | null,
  segmentText: string,
  normalisedIntent: string | null,
  reason: string
): Promise<void> {
  await withTenantContext({ orgId, userId }, (db) =>
    db.insert(gapLog).values({ orgId, userId, submissionId, segmentText, normalisedIntent, reason })
  );
}

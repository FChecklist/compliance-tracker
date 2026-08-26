// R42 seq15 (M26 P6) -- the L2 nightly batch + phrase_map promotion loop.
// NIGHTLY ONLY, never in-request (M27: L2 is "not escalated to in-request").
// This file is the ONE exception to v5 P-1's "no new queue/worker/scheduler"
// rule -- authorised explicitly by the work order for this seq, via a
// Vercel cron (see vercel.json + the /api/internal/l2-phrase-promotion/run
// route this drives), not a new bespoke scheduler.
import { sql, gte, and, eq, isNull } from "drizzle-orm";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { gapLog, phraseMap } from "@/lib/db/schema";
import { getAiProvider, type Artifact } from "@/lib/ai/adapter";
import { normalisePhrase } from "@/lib/pipeline/run-submission";
import { db as rawDb } from "@/lib/db"; // read-only, cross-org: only used to discover WHICH orgs have gap_log activity; every per-org read/write below still goes through withTenantContext
// R46 P9 seq33: report_definition artifacts now become real, immediately
// runnable rows (compliance.report_definitions) via this existing service --
// previously they only reached otherArtifacts (this file's return value),
// which the cron route (l2-phrase-promotion/run/route.ts) just serialised
// into a JSON response and discarded. Only createReportDefinition +
// validateReportDefinitionInput + TABLE_REGISTRY are imported: this file
// still never runs arbitrary SQL -- TABLE_REGISTRY is the same code-reviewed
// whitelist deterministic_aggregation/ai_recipe execution already goes
// through (report-engine-service.ts's own header).
import { createReportDefinition, validateReportDefinitionInput, TABLE_REGISTRY, type CreateReportDefinitionInput } from "@/lib/services/report-engine-service";

const MIN_CLUSTER_FREQUENCY = 3; // M26: "clusters with frequency >= 3 only -- one user's one-off is not a product signal"

type GapCluster = {
  normalisedPhrase: string;
  frequency: number;
  gapLogIds: string[];
  sampleReason: string;
};

// A defensive guard on whatever SQL the model itself hands back inside an
// artifact (M26: "SQL it emits is SELECT-only and org-scoped... must NEVER
// state a figure -- emit the query, not the answer"). This file's own real
// DB writes (the phrase_map INSERT below) are software, not model output,
// and are not what this check is about.
export const FORBIDDEN_SQL_PATTERN = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke)\b/i;

export function findEmbeddedSql(artifact: Artifact): string | null {
  const candidate = (artifact as Record<string, unknown>).query ?? (artifact as Record<string, unknown>).sql;
  return typeof candidate === "string" ? candidate : null;
}

export type L2BatchResult = {
  ranAt: string;
  orgsProcessed: number;
  clustersAnalysed: number;
  phraseMapCandidatesCreated: number;
  reportDefinitionsCreated: number; // R46 P9 seq33: report_definition artifacts persisted as real, runnable compliance.report_definitions rows (createdBy:'ai') -- no deploy required
  otherArtifacts: Artifact[]; // capability_gap/no_action, plus any report_definition artifact whose shape didn't validate (kept here, never silently dropped)
  rejectedForEmbeddedDml: Artifact[]; // artifacts whose own SQL field failed the SELECT-only check -- never written anywhere
};

// A report_definition artifact's `definition` field is model output (free-
// form JSON), so this is a defensive mapper, not a trust boundary widening:
// createReportDefinition() below still runs validateReportDefinitionInput
// (M26/M27's own validation), and any deterministic_aggregation config still
// must resolve a real TABLE_REGISTRY entry (report-engine-service.ts's
// whitelist) before executeReportDefinition() can ever run it -- an
// unresolved tableKey throws at run time rather than executing anything.
// Anything that doesn't validate falls through to otherArtifacts unchanged
// (M26: "never state a figure -- emit the query/definition, not the
// answer", and never silently drop a model artifact).
export function toReportDefinitionInput(
  artifact: Extract<Artifact, { kind: "report_definition" }>,
  promotedFromContext: string
): CreateReportDefinitionInput | null {
  const d = artifact.definition as Record<string, unknown>;
  const classifications = Array.isArray(d.classifications) ? (d.classifications as unknown[]).filter((c): c is string => typeof c === "string") : [];
  const executionType = d.executionType;
  const executionConfig = d.executionConfig as Record<string, unknown> | undefined;
  if (executionType !== "deterministic_aggregation" || !executionConfig || executionConfig.kind !== "aggregation") {
    // Only the fully-deterministic, whitelist-checkable shape is ever
    // auto-promoted to a live row -- ai_recipe/formula/external_service
    // artifacts from a nightly batch (no human in the loop) stay in
    // otherArtifacts for a real person to review before they go live.
    return null;
  }
  const tableKey = typeof executionConfig.tableKey === "string" ? executionConfig.tableKey : null;
  if (!tableKey || !(tableKey in TABLE_REGISTRY)) return null; // unresolvable against the real whitelist -- never insert a definition that can only 500 at run time

  const input: CreateReportDefinitionInput = {
    name: artifact.title,
    description: typeof d.description === "string" ? d.description : artifact.title,
    // report-taxonomy.ts CATEGORY 5 ("ai_new_report_promoted": "originated
    // as an ad-hoc AI report-builder proposal, then promoted into a
    // reusable report_definitions row so it's deterministic from then on")
    // describes this exact code path verbatim -- hardcoded, never trusted
    // from the model's own free-form JSON, since only this file's own
    // gap_log->cluster->promotion flow can honestly claim that category.
    category: "ai_new_report_promoted",
    classifications,
    executionType: "deterministic_aggregation",
    executionConfig: executionConfig as CreateReportDefinitionInput["executionConfig"],
    status: "built",
    createdBy: "ai",
    promotedFromContext,
  };
  return validateReportDefinitionInput(input).valid ? input : null;
}

type GapLogRow = { id: string; segmentText: string; reason: string };

// Pure, DB-free aggregation (this repo's established convention -- e.g.
// aggregateDesignerTimesheetCosts in construction-reports-service.ts --
// keeps the clustering logic separately unit-testable from the DB fetch).
export function clusterGaps(rows: GapLogRow[]): GapCluster[] {
  const byPhrase = new Map<string, GapCluster>();
  for (const row of rows) {
    const phrase = normalisePhrase(row.segmentText);
    const existing = byPhrase.get(phrase);
    if (existing) {
      existing.frequency += 1;
      existing.gapLogIds.push(row.id);
    } else {
      byPhrase.set(phrase, { normalisedPhrase: phrase, frequency: 1, gapLogIds: [row.id], sampleReason: row.reason });
    }
  }
  return [...byPhrase.values()].filter((c) => c.frequency >= MIN_CLUSTER_FREQUENCY);
}

async function clusterGapsForOrg(orgId: string): Promise<GapCluster[]> {
  return withTenantContext({ orgId }, async (db) => {
    const rows = await db.query.gapLog.findMany({
      where: and(eq(gapLog.orgId, orgId), gte(gapLog.createdAt, sql`now() - interval '24 hours'`)),
      columns: { id: true, segmentText: true, reason: true },
    });
    return clusterGaps(rows);
  });
}

async function upsertPhraseMapCandidate(orgId: string, artifact: Extract<Artifact, { kind: "phrase_map_candidate" }>): Promise<boolean> {
  return withTenantContext({ orgId }, async (db) => {
    // Never overwrite an already-promoted row -- a real human decision (M26
    // Level 3) outranks a fresh nightly proposal for the same phrase.
    const existing = await db.query.phraseMap.findFirst({
      where: and(eq(phraseMap.orgId, orgId), eq(phraseMap.normalisedPhrase, artifact.normalisedPhrase)),
    });
    if (existing) {
      if (existing.promotedAt) return false; // already promoted, leave it alone
      await db.update(phraseMap).set({ hitCount: artifact.frequency, functionId: artifact.functionId, fixedParams: artifact.fixedParams ?? null }).where(eq(phraseMap.id, existing.id));
      return true;
    }
    // promotedById/promotedAt left NULL -- a CANDIDATE, not yet live at L0
    // (pipeline.ts's makeL0Repo only matches promoted rows).
    await db.insert(phraseMap).values({
      orgId,
      normalisedPhrase: artifact.normalisedPhrase,
      functionId: artifact.functionId,
      fixedParams: artifact.fixedParams ?? null,
      hitCount: artifact.frequency,
    });
    return true;
  });
}

export async function runL2Batch(): Promise<L2BatchResult> {
  // Cross-org discovery only (which orgs have any gap_log activity at all in
  // the window) -- every actual read/write of that org's own rows still
  // happens inside withTenantContext, org-scoped, above.
  // REAL BUG FOUND LIVE (R42 seq15 follow-up): a plain cross-org SELECT
  // through this file's "raw" db client silently returned zero rows in
  // production. lib/db/index.ts's own header comment describes DATABASE_URL
  // as RLS-bypassing, but a live diagnostic proved it actually authenticates
  // as app_runtime here (not postgres), which does NOT bypass RLS -- so the
  // query always matched nothing, indistinguishable from "no gap_log
  // activity" without checking runtime logs. Fixed with a narrowly-scoped
  // SECURITY DEFINER function (owned by postgres, which does bypass RLS)
  // rather than widening any role's RLS bypass.
  const orgRows = (await rawDb.execute(sql`select * from compliance.gap_log_orgs_with_recent_activity()`)) as { org_id: string }[];
  const orgIds = orgRows.map((r) => r.org_id);

  let clustersAnalysed = 0;
  let phraseMapCandidatesCreated = 0;
  let reportDefinitionsCreated = 0;
  const otherArtifacts: Artifact[] = [];
  const rejectedForEmbeddedDml: Artifact[] = [];

  for (const orgId of orgIds) {
    const clusters = await clusterGapsForOrg(orgId);
    if (clusters.length === 0) continue;
    clustersAnalysed += clusters.length;

    const provider = getAiProvider();
    // NOTE: L2 never calls assertAiProviderAllowed -- that gate is specific
    // to L1's per-request, per-user posture (M27). L2 is a system batch job
    // with no requesting user to check; AI_PROVIDER=claude-cli would still
    // correctly fail here on a serverless runtime with no `claude` binary,
    // same as any other environment without it (an honest failure, not a
    // bypass of the tripwire's intent).
    const artifacts = await provider.analyse({ orgId, clusters });

    for (const artifact of artifacts) {
      const embeddedSql = findEmbeddedSql(artifact);
      if (embeddedSql && FORBIDDEN_SQL_PATTERN.test(embeddedSql)) {
        rejectedForEmbeddedDml.push(artifact);
        continue;
      }
      if (artifact.kind === "phrase_map_candidate") {
        const created = await upsertPhraseMapCandidate(orgId, artifact);
        if (created) phraseMapCandidatesCreated += 1;
      } else if (artifact.kind === "report_definition") {
        // Artifact has no back-reference to a specific cluster (provider.analyse
        // takes the whole org batch), so promotedFromContext cites every
        // gap_log id considered in this org's run -- traceable, not precise
        // to one cluster; a real reviewer can still open every cited row.
        const promotedFromContext = `l2_batch:gap_log:${clusters.flatMap((c) => c.gapLogIds).join(",")}`;
        const input = toReportDefinitionInput(artifact, promotedFromContext);
        if (input) {
          await createReportDefinition({ orgId }, input); // createReportDefinition already runs its own withTenantContext (report-engine-service.ts)
          reportDefinitionsCreated += 1;
        } else {
          otherArtifacts.push(artifact); // didn't resolve to a whitelisted, runnable shape -- surfaced for human review, never silently dropped
        }
      } else {
        otherArtifacts.push(artifact);
      }
    }
  }

  return {
    ranAt: new Date().toISOString(),
    orgsProcessed: orgIds.length,
    clustersAnalysed,
    phraseMapCandidatesCreated,
    reportDefinitionsCreated,
    otherArtifacts,
    rejectedForEmbeddedDml,
  };
}

// L3 (a real human -- Rajat today) approves a candidate into a live L0
// phrase (M26). Exported here rather than only reachable via a route so it
// can be called directly in tests/scripts too.
export async function promotePhraseMapCandidate(orgId: string, id: string, promotedById: string) {
  return withTenantContext({ orgId }, async (db) => {
    const [row] = await db
      .update(phraseMap)
      .set({ promotedById, promotedAt: new Date() })
      .where(and(eq(phraseMap.id, id), eq(phraseMap.orgId, orgId), isNull(phraseMap.promotedAt)))
      .returning();
    return row ?? null;
  });
}

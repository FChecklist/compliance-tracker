// R67 Part B Phase 3.6, Wave 1 -- shadow-diff equivalence gate
// (ROUTER_RECONCILIATION_PLAN.md sec 5 step 3). One-time verification infra,
// NOT part of the app runtime -- matches scripts/backfill-platform-assets.ts's
// established shape (plain `bun run`, no dev server, reads .env.local
// automatically).
//
// For a fixed sample of real org IDs spanning both BYO-configured
// (customer_model_config.isActive = true) and platform-default orgs, calls
// both the pre-migration resolver (orchestra-model-resolver.ts's
// resolveModelConfig()) and the post-migration path (mother-router.ts's
// resolveModel({scope:'end_user_org', ...}).resolvedConfig) for every
// layerKey/sourceType combination Wave 1's migrated call site actually uses,
// and asserts the returned provider/model/apiKey/fallback/isCustomerConfigured
// fields are identical.
//
// SCOPE NOTE: of the 3 files named in Wave 1's task scope, only
// instruction-mismatch-audit.ts:45 actually calls resolveModelConfig(orgId,
// layerKey, sourceType) -- the function this migration targets. The other two
// (loop-engineering-audit.ts:74, dispatch-completion-monitor.ts:141) call
// resolvePlatformModelConfig(layerKey) instead: a platform-scoped resolver
// with NO orgId and NO Mother Router equivalent (MotherRouterContext only has
// software_team / end_user_org / sales_marketing / customer_success scopes --
// no "platform" scope exists). Those 2 sites were NOT migrated -- see this
// task's final report / PR body. This script therefore covers exactly the one
// layerKey combination the one real migrated call site uses:
// layerKey="task_oa", sourceType=undefined.
import { db, customerModelConfig } from "../src/lib/db"
import { eq } from "drizzle-orm"
import { resolveModelConfig } from "../src/lib/orchestra-model-resolver"
import { resolveModel } from "../src/lib/ai-router/mother-router"

const SAMPLE_PER_GROUP = 5

// Real org IDs, pulled once via the Supabase MCP (service_role, bypasses RLS)
// against project pcrjmlpuqsbocqfwoxod's compliance.organisations table --
// this script's own `db` client cannot enumerate orgs itself (see note
// below), so this is the one place a fixed list is hardcoded rather than
// discovered live. A mix of demo and real-looking org IDs; demo orgs are
// real rows in this table, not synthetic test fixtures.
const FALLBACK_PLATFORM_DEFAULT_ORG_IDS = [
  "org_001",
  "demo_co_1_sharma",
  "y4r0ub1w3e1mpenntcycw9hw",
  "4ecc472f-4152-4310-ae8d-cf8b7c52ab6d",
  "lmru1irvf7icjr5bsgcxc758",
]

// The exact (layerKey, sourceType) combinations Wave 1's one real migrated
// call site (instruction-mismatch-audit.ts:45) uses.
const COMBINATIONS: { layerKey: string; sourceType: string | undefined }[] = [{ layerKey: "task_oa", sourceType: undefined }]

type DiffResult = {
  orgId: string
  group: "byo" | "platform_default"
  layerKey: string
  sourceType: string | undefined
  match: boolean
  oldResult: unknown
  newResult: unknown
  detail?: string
}

function summarize(config: Awaited<ReturnType<typeof resolveModelConfig>>) {
  if (!config) return null
  return {
    provider: config.provider,
    model: config.model,
    apiKey: config.apiKey,
    fallback: config.fallback ?? null,
    isCustomerConfigured: config.isCustomerConfigured ?? null,
  }
}

function fieldsEqual(a: ReturnType<typeof summarize>, b: ReturnType<typeof summarize>): boolean {
  if (a === null && b === null) return true
  if (a === null || b === null) return false
  return (
    a.provider === b.provider &&
    a.model === b.model &&
    a.apiKey === b.apiKey &&
    JSON.stringify(a.fallback) === JSON.stringify(b.fallback) &&
    a.isCustomerConfigured === b.isCustomerConfigured
  )
}

// NOTE on RLS: this script's `db` client connects as `app_runtime`, the same
// role/connection resolveModelConfig() and resolveModel() themselves use.
// `compliance.organisations` and `compliance.customer_model_config` both
// carry an app_runtime RLS policy gated on `compliance.current_org_id()`
// (SELECT NULLIF(current_setting('app.current_org_id', true), '')) -- a
// per-transaction session GUC set only inside withTenantContext(). None of
// this script, resolveModelConfig(), or resolveModel() ever open a
// withTenantContext, so `current_org_id()` is NULL for every query here,
// and `org_id = NULL` is never true. Concretely: a bare `db.query.organisations
// .findMany()` / `db.query.customerModelConfig.findMany()` through this role
// returns 0 rows regardless of what really exists (verified live) -- NOT a
// bug in this script, but the same real constraint every one of the 3 Wave 1
// callers already operates under in production (they call resolveModelConfig()
// directly via the raw `db` client, outside any withTenantContext). One real,
// separate consequence worth flagging: for these background/cron callers, the
// customer_model_config (BYO) branch is structurally unreachable today --
// resolveModelConfig() will always fall through to the platform-default
// branch no matter what an org has configured. That is orthogonal to this
// migration (both the old and new code paths share the exact same `db`
// client and RLS gate, so it affects them identically) but is worth the
// programme owner's attention separately.
//
// A live query via the Supabase MCP (service_role, bypasses RLS) confirmed
// separately that compliance.customer_model_config currently has ZERO
// is_active=true rows platform-wide -- so even a caller that DID run inside
// a tenant context would find no BYO-configured orgs to sample right now.
// The BYO group below is therefore genuinely empty today, not an artifact of
// this script's own DB role.
async function pickSampleOrgIds(): Promise<{ byo: string[]; platformDefault: string[] }> {
  const byoRows = await db.query.customerModelConfig.findMany({
    where: eq(customerModelConfig.isActive, true),
    columns: { orgId: true },
    limit: SAMPLE_PER_GROUP * 3, // over-fetch, dedupe below
  })
  const byoOrgIds = [...new Set(byoRows.map((r) => r.orgId))].slice(0, SAMPLE_PER_GROUP)

  // Fixed real org ID sample (see module-level comment) -- this script's own
  // `db` client cannot enumerate compliance.organisations under RLS with no
  // tenant context open, the same constraint the migrated call site itself
  // operates under.
  const platformDefaultOrgIds = FALLBACK_PLATFORM_DEFAULT_ORG_IDS.slice(0, SAMPLE_PER_GROUP)

  return { byo: byoOrgIds, platformDefault: platformDefaultOrgIds }
}

async function main() {
  const { byo, platformDefault } = await pickSampleOrgIds()
  console.log(`Sampled ${byo.length} BYO-configured orgs, ${platformDefault.length} platform-default orgs.`)
  if (byo.length === 0) console.warn("WARNING: no active customer_model_config rows found -- BYO group is empty, gate will only cover the platform-default branch.")
  if (platformDefault.length === 0) console.warn("WARNING: no platform-default orgs found in sample.")

  const results: DiffResult[] = []

  for (const group of [
    { name: "byo" as const, ids: byo },
    { name: "platform_default" as const, ids: platformDefault },
  ]) {
    for (const orgId of group.ids) {
      for (const combo of COMBINATIONS) {
        let oldConfig: Awaited<ReturnType<typeof resolveModelConfig>> = null
        let newConfig: Awaited<ReturnType<typeof resolveModelConfig>> = null
        let detail: string | undefined
        try {
          oldConfig = await resolveModelConfig(orgId, combo.layerKey, combo.sourceType)
        } catch (err) {
          detail = `old resolver threw: ${err instanceof Error ? err.message : String(err)}`
        }
        try {
          const resolution = await resolveModel({ scope: "end_user_org", orgId, layerKey: combo.layerKey, sourceType: combo.sourceType })
          newConfig = resolution.resolvedConfig ?? null
        } catch (err) {
          detail = `${detail ? detail + " | " : ""}new resolver threw: ${err instanceof Error ? err.message : String(err)}`
        }

        const oldSummary = summarize(oldConfig)
        const newSummary = summarize(newConfig)
        const match = fieldsEqual(oldSummary, newSummary)
        results.push({
          orgId,
          group: group.name,
          layerKey: combo.layerKey,
          sourceType: combo.sourceType,
          match,
          oldResult: oldSummary,
          newResult: newSummary,
          detail,
        })
      }
    }
  }

  console.log("\n--- Shadow-diff results ---")
  let mismatchCount = 0
  for (const r of results) {
    const status = r.match ? "MATCH" : "MISMATCH"
    if (!r.match) mismatchCount++
    console.log(`[${status}] org=${r.orgId} group=${r.group} layerKey=${r.layerKey} sourceType=${r.sourceType ?? "(none)"}`)
    if (!r.match) {
      console.log(`  old: ${JSON.stringify(r.oldResult)}`)
      console.log(`  new: ${JSON.stringify(r.newResult)}`)
      if (r.detail) console.log(`  detail: ${r.detail}`)
    }
  }

  console.log(`\n${results.length} comparisons run, ${results.length - mismatchCount} matched, ${mismatchCount} mismatched.`)
  if (mismatchCount > 0) {
    console.error("SHADOW-DIFF FAILED: at least one org/layerKey combination produced a real behavioral difference. Per the migration plan (sec 5 step 3), STOP -- do not migrate the corresponding call site.")
    process.exit(1)
  }
  console.log("SHADOW-DIFF PASSED: resolveModel({scope:'end_user_org', ...}).resolvedConfig is identical to resolveModelConfig() for every sampled org/layerKey combination.")
  process.exit(0)
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Shadow-diff script failed to run:", err)
    process.exit(1)
  })
}

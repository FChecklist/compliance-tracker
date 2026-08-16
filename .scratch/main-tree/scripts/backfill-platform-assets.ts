// One-off backfill script -- Priority 3 UMR (tree4-unified/50-completion-
// plan/08-priority3-umr-tracker.yaml, agent 1/umr-core). Registers every
// existing row from the 4 source tables named in this pass's scope
// (worker_agents ~57, computation_engines ~247, prompt_templates ~189,
// dynamic_chains) into compliance.platform_assets via
// asset-registry-service.ts's registerAsset(). Not part of the app
// runtime. Matches scripts/generate-missing-prompt-templates.ts's
// established shape for a one-off seeding script.
//
// SAFETY: defaults to --dry-run (no writes). Pass --execute to actually
// insert. Per the dispatch contract for this build, this script is NOT to
// be run against the live database by the agent that wrote it -- it's
// written, its logic is verified by
// scripts/backfill-platform-assets.test.ts (the 4 pure buildXInput()
// mapping functions below) and by `tsc --noEmit`, and is left ready for
// the Super Boss to run against real data: `bun run
// scripts/backfill-platform-assets.ts --execute` (reads .env.local
// automatically, same as `bun run dev`).
//
// Retrofitting the remaining ~330 tables beyond these 4 is explicitly out
// of scope for this pass -- see the tracker doc's "follow-on" note.
import { db, workerAgents, computationEngines, promptTemplates, dynamicChains } from "../src/lib/db"
import { registerAsset, getAssetBySource, ServiceError, type RegisterAssetInput } from "../src/lib/services/asset-registry-service"

const EXECUTE = process.argv.includes("--execute")

// ─── Pure mapping functions (unit tested in backfill-platform-assets.test.ts) ───

export function mapWorkerAgentLifecycleStatus(lifecycleStatus: string): "draft" | "active" | "archived" | "deleted" {
  if (lifecycleStatus === "published") return "active"
  if (lifecycleStatus === "retired") return "archived"
  // 'draft' | 'proposed' | 'approved' -- none of these are live/dispatchable yet
  return "draft"
}

export function mapComputationEngineStatus(status: string): "draft" | "active" | "archived" | "deleted" {
  if (status === "implemented") return "active"
  // 'partial' | 'not_started' -- not a real usable engine yet
  return "draft"
}

export function mapDynamicChainStatus(status: string): "draft" | "active" | "archived" | "deleted" {
  if (status === "approved") return "active"
  if (status === "retired") return "archived"
  // 'draft' | 'proposed'
  return "draft"
}

export function buildWorkerAgentAssetInput(row: typeof workerAgents.$inferSelect): RegisterAssetInput {
  return {
    name: row.name,
    assetType: "ai_agent",
    sourceTable: "worker_agents",
    sourceId: row.id,
    module: row.domain ?? null,
    ownerId: null, // 'System' -- worker_agents has no single human owner column
    status: mapWorkerAgentLifecycleStatus(row.lifecycleStatus),
    createdBy: row.proposedById ?? null,
    version: String(row.version),
    aiEnabled: true,
    purpose: row.description ?? null,
    searchKeywords: row.domain ?? null,
    orgId: row.orgId ?? null, // 'global' tier rows genuinely have orgId null
  }
}

export function buildComputationEngineAssetInput(row: typeof computationEngines.$inferSelect): RegisterAssetInput {
  return {
    name: row.name,
    assetType: "computation_engine",
    sourceTable: "computation_engines",
    sourceId: row.id,
    module: row.category,
    ownerId: null,
    status: mapComputationEngineStatus(row.status),
    aiEnabled: false, // deterministic compute, not an AI call -- VCEL's own design intent
    purpose: row.description ?? null,
    searchKeywords: row.engineKey,
    orgId: null, // platform-wide, not org-scoped
  }
}

export function buildPromptTemplateAssetInput(row: typeof promptTemplates.$inferSelect): RegisterAssetInput {
  return {
    name: row.displayName,
    assetType: "prompt",
    sourceTable: "prompt_templates",
    sourceId: row.id,
    ownerId: null,
    status: "active", // prompt_templates has no lifecycle column of its own; every row that exists is in live use via resolvePromptTemplate()
    aiEnabled: true,
    purpose: row.description ?? null,
    searchKeywords: row.templateKey,
    orgId: null, // platform-wide
  }
}

export function buildDynamicChainAssetInput(row: typeof dynamicChains.$inferSelect): RegisterAssetInput {
  const pathLabels = Array.isArray(row.pathLabels) ? (row.pathLabels as string[]) : []
  const name = pathLabels.length > 0 ? pathLabels.join(" > ") : row.modePill
  return {
    name,
    assetType: "dynamic_chain",
    sourceTable: "dynamic_chains",
    sourceId: row.id,
    module: row.moduleRef ?? null,
    ownerId: null,
    status: mapDynamicChainStatus(row.status),
    createdBy: row.createdById ?? null,
    purpose: row.description ?? null,
    orgId: row.orgId, // dynamic_chains.orgId is NOT NULL -- always org-scoped
  }
}

// ─── Backfill runner ───

type BackfillResult = { sourceTable: string; total: number; registered: number; alreadyRegistered: number; failed: number }

async function backfillTable<Row>(
  sourceTable: string,
  rows: Row[],
  buildInput: (row: Row) => RegisterAssetInput,
  getSourceId: (row: Row) => string
): Promise<BackfillResult> {
  const result: BackfillResult = { sourceTable, total: rows.length, registered: 0, alreadyRegistered: 0, failed: 0 }

  for (const row of rows) {
    const sourceId = getSourceId(row)
    const input = buildInput(row)

    if (!EXECUTE) {
      console.log(`[dry-run] would register ${sourceTable}:${sourceId} -> assetType=${input.assetType} name=${JSON.stringify(input.name)}`)
      result.registered++
      continue
    }

    try {
      const existing = await getAssetBySource(sourceTable, sourceId)
      if (existing) {
        result.alreadyRegistered++
        continue
      }
      const created = await registerAsset(input)
      console.log(`registered: ${sourceTable}:${sourceId} -> ${created.assetId}`)
      result.registered++
    } catch (err) {
      const message = err instanceof ServiceError ? err.message : String(err)
      console.error(`FAILED to register ${sourceTable}:${sourceId}: ${message}`)
      result.failed++
    }
  }

  return result
}

async function main() {
  console.log(EXECUTE ? "Running LIVE (writes will happen)." : "Running in --dry-run mode (no writes). Pass --execute to actually insert.")

  const [workerAgentRows, computationEngineRows, promptTemplateRows, dynamicChainRows] = await Promise.all([
    db.query.workerAgents.findMany(),
    db.query.computationEngines.findMany(),
    db.query.promptTemplates.findMany(),
    db.query.dynamicChains.findMany(),
  ])

  const results = [
    await backfillTable("worker_agents", workerAgentRows, buildWorkerAgentAssetInput, (r) => r.id),
    await backfillTable("computation_engines", computationEngineRows, buildComputationEngineAssetInput, (r) => r.id),
    await backfillTable("prompt_templates", promptTemplateRows, buildPromptTemplateAssetInput, (r) => r.id),
    await backfillTable("dynamic_chains", dynamicChainRows, buildDynamicChainAssetInput, (r) => r.id),
  ]

  console.log("\n--- Backfill summary ---")
  let grandTotal = 0
  for (const r of results) {
    console.log(`${r.sourceTable}: total=${r.total} registered=${r.registered} alreadyRegistered=${r.alreadyRegistered} failed=${r.failed}`)
    grandTotal += r.total
  }
  console.log(`Grand total rows considered: ${grandTotal}`)
  process.exit(results.some((r) => r.failed > 0) ? 1 : 0)
}

// import.meta.main (Bun's supported entrypoint check) instead of Node's
// require.main === module -- this file runs under `bun run`, and the
// pure buildXAssetInput()/mapXStatus() functions above need to be
// importable by backfill-platform-assets.test.ts without triggering a
// live DB connection.
if (import.meta.main) {
  main().catch((err) => {
    console.error("Backfill failed:", err)
    process.exit(1)
  })
}

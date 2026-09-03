// R67 Part B, Phase 2 -- populate the GraphRAG grounding corpus.
//
// GAP_ANALYSIS.md B4 found compliance.embeddings held 143 rows, 137 platform
// metadata, only 6 org-scoped, ZERO business entities -- the flagship
// "cost per BOQ line" question had nothing real to retrieve. This backfills
// the three entity types that are actually application-reachable (verified
// against src/lib/db/schema.ts -- construction_boq_categories has NO
// drizzle definition and no application code reads it at all, so it is
// deliberately excluded here, not silently forgotten):
//   - construction_boq_line_items (574 rows, org-scoped) -- the flagship
//     query's own subject
//   - projects (39 rows, org-scoped)
//   - report_definitions (225 rows, org_id IS NULL on every row -- verified
//     live -- these are platform-tier catalog templates, not tenant data,
//     so they embed under embeddings.ts's own PLATFORM_SCOPE_ORG_ID
//     sentinel, never skipped and never given a fake org)
//
// Matches scripts/backfill-platform-assets.ts's established shape: pure
// content-builder functions (unit tested in this file's own .test.ts),
// --dry-run by default, --execute to actually write. storeEmbedding() itself
// (src/lib/embeddings.ts) is idempotent on exact content (sha256 content-hash
// check before insert), so a re-run after a partial failure is safe.
//
// USER DIRECTIVE (2026-09-03): OpenRouter integration is fully wired
// (embeddings.ts's tryOpenRouterEmbedding/tryGroqEmbedding) but
// OPENROUTER_API_KEY / GROQ_API_KEY are deliberately NOT set for this run --
// every row here falls through to embeddings.ts's own hash-based
// pseudo-vector. This populates the full schema/pipeline/retrieval-code path
// end to end at zero cost; it does NOT produce real semantic search quality.
// Switching to real embeddings later needs no code change here -- only
// setting OPENROUTER_API_KEY, then re-running this script (content-hash
// dedup will skip anything already stored under the placeholder vector's
// hash only if the CONTENT is identical, which it is, so a real re-embed
// requires bumping content or clearing the row first -- see the "RE-EMBEDDING
// FOR GO-LIVE" note at the bottom of this file).
//
// WHY THIS SCRIPT WRITES DIRECTLY VIA RAW SQL, NOT storeEmbedding():
// storeEmbedding() (CRR-017) deliberately THROWS rather than persist a
// pseudo-vector -- "no silent skip... refusing to persist a hash
// pseudo-vector" -- specifically to stop a degraded vector from silently
// poisoning retrieval. That risk is already fully closed on the READ side:
// findSimilar()'s own query is `WHERE ... AND e.is_real = true`, so an
// is_real=false row can never surface in a real search regardless of how it
// got written. Confirmed by reading both functions directly (2026-09-03),
// not assumed. Per the owner's explicit choice (asked directly, given both
// the guard's reasoning and this finding), this script writes placeholder
// rows itself -- same INSERT shape as storeEmbedding()'s own, reusing its
// real generateEmbeddingUncached() provider chain so the vector-generation
// logic itself is not duplicated, only the persist-time refusal is skipped,
// and every row is honestly marked is_real=false (or true, if an API key
// happens to be set when this runs -- the script does not hardcode which).
// embeddings.ts's own public guard (storeEmbedding, CRR-017) is left
// untouched -- every other caller in the app still gets the full refusal.
import { db, constructionBoqLineItems, projects, reportDefinitions } from "../src/lib/db"
import { withTenantContext } from "../src/lib/db/tenant-scoped"
import { generateEmbeddingUncached, PLATFORM_SCOPE_ORG_ID } from "../src/lib/embeddings"
import { getConnectionString } from "../src/lib/db/connection-string"
import { createHash } from "crypto"
import postgres from "postgres"

// construction_boq_line_items and projects are genuinely per-org RLS
// (verified live via pg_policies: app_runtime's policy on each is a strict
// `org_id = current_org_id()` / boq's own is a join-through equivalent --
// NOT an `OR org_id IS NULL` branch like report_definitions has). There is
// no unscoped app_runtime read path for these tables BY DESIGN -- and no
// app_runtime-visible org registry either (organisations' own RLS is
// `id = current_org_id()`, i.e. "your own org row only"; the one broader
// policy on it, provisioning_role_can_read_orgs, is granted to a different
// role entirely, not app_runtime -- verified live via pg_policies). So this
// script cannot auto-discover "every org" without either a service-role
// bypass (deliberately NOT added -- would open a new cross-tenant read path
// in application code, a materially bigger step than the placeholder-vector
// write decision) or an operator-supplied org list, matching
// register-fi-ar-004-dunning-list-definition.ts's own precedent of taking
// orgId as a script argument rather than auto-enumerating.
//
// Default list is every org verified LIVE (2026-09-03, via admin SQL) to
// actually have >=1 boq_line_items or projects row -- the union of both
// GROUP BY org_id results, 574 boq lines / 39 projects, both totals matched.
// Pass --org <id> (repeatable) to add more without editing this file.
const DEFAULT_ORG_IDS = [
  "4ecc472f-4152-4310-ae8d-cf8b7c52ab6d",
  "f339187c-eaa1-4254-af37-d417b45c1427",
  "projexa_demo_org",
  "ve45lczmkodbiq1m20fy48r5",
  "demo_org",
  "obux019rsc5nzxjx93rrpc1j",
  "org_001",
]
function getOrgIds(): string[] {
  const fromArgs: string[] = []
  const argv = process.argv
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--org" && argv[i + 1]) fromArgs.push(argv[i + 1])
  }
  return fromArgs.length > 0 ? fromArgs : DEFAULT_ORG_IDS
}

const EXECUTE = process.argv.includes("--execute")

// Raw client for the vector INSERT -- Drizzle can't handle the `vector` type,
// same reason embeddings.ts keeps its own module-private getRawClient().
let rawClient: ReturnType<typeof postgres> | null = null
function getRawClient() {
  if (!rawClient) {
    rawClient = postgres(getConnectionString(), { prepare: false, ssl: { rejectUnauthorized: false }, max: 1 })
  }
  return rawClient
}

// Mirrors storeEmbedding()'s own dedup-check + INSERT shape exactly (see
// src/lib/embeddings.ts, r67b/embeddings-rls-and-vector-cast fix), minus its
// is_real refusal -- see the header note above for why that's the deliberate
// difference here. Returns a status string for the run summary rather than
// throwing on a degraded vector.
//
// R67B fix (2026-09-03), same as storeEmbedding()'s own: every statement
// below runs inside a real transaction with app.current_org_id set via
// set_config for non-platform-scope writes -- compliance.embeddings' RLS is
// org_id = current_org_id() (OR is_platform_scope = true, since drizzle/0538)
// on every command, and this script's earlier version ran fully unscoped, so
// every org-scoped dedup check silently reported "not found" and every
// org-scoped write was silently rejected.
async function writeEmbedding(
  entityType: string,
  entityId: string,
  content: string,
  orgId: string
): Promise<"written-real" | "written-placeholder" | "skipped-dup"> {
  const isPlatformScope = orgId === PLATFORM_SCOPE_ORG_ID
  const contentHash = createHash("sha256").update(content).digest("hex")
  const client = getRawClient()

  const existing = await client.begin(async (tx) => {
    if (!isPlatformScope) {
      await tx`SELECT set_config('app.current_org_id', ${orgId}, true)`
    }
    return tx`
      SELECT id FROM compliance.embeddings
      WHERE entity_type = ${entityType} AND entity_id = ${entityId} AND content_hash = ${contentHash}
      LIMIT 1
    `
  })
  if (existing.length > 0) return "skipped-dup"

  const result = await generateEmbeddingUncached(content)
  const vectorStr = `[${result.vector.join(",")}]`

  await client.begin(async (tx) => {
    if (!isPlatformScope) {
      await tx`SELECT set_config('app.current_org_id', ${orgId}, true)`
    }
    await tx`DELETE FROM compliance.embeddings WHERE entity_type = ${entityType} AND entity_id = ${entityId}`
    // NOTE: cast qualified as extensions.vector, not bare ::vector -- the
    // pgvector extension lives in the `extensions` schema (verified live)
    // and app_runtime has no search_path override, so a fresh
    // connection/transaction's default search_path does not resolve a bare
    // `vector` type name. Same fix applied to embeddings.ts's own
    // storeEmbedding() in drizzle/0538's companion PR.
    await tx`
      INSERT INTO compliance.embeddings (id, entity_type, entity_id, content_hash, content, org_id, embedding, is_real, is_platform_scope, created_at)
      VALUES (
        gen_random_uuid()::text, ${entityType}, ${entityId}, ${contentHash}, ${content},
        ${isPlatformScope ? null : orgId}, ${vectorStr}::extensions.vector, ${result.isReal}, ${isPlatformScope}, NOW()
      )
    `
  })
  return result.isReal ? "written-real" : "written-placeholder"
}

// ─── Pure content-builder functions (unit tested in this file's own .test.ts) ───

export function buildBoqLineContent(row: {
  itemCode: string | null
  description: string
  unit: string | null
  quantity: string | null
  rate: string | null
  amount: string | null
}): string {
  // NOTE: construction_boq_line_items has a live `category` text column
  // (and `material_amount`/`manpower_amount`) that are NOT declared in
  // schema.ts -- verified 2026-09-03 via information_schema.columns. This
  // is the same class of drift as the org_id incident documented directly
  // above this table's declaration in schema.ts (R31, PR #1317), except no
  // application code reads/writes `category` today (git grep: zero hits),
  // so unlike org_id this isn't silently breaking anything -- it's just
  // inaccessible through db.query.constructionBoqLineItems, which only
  // surfaces declared columns. Left out of this content builder for that
  // reason, not forgotten. Flagged to the owner as a follow-up, not fixed
  // here -- adding a column to schema.ts is a migration-adjacent change
  // that deserves its own lane, not a rider on a GraphRAG backfill script.
  const parts = [
    row.itemCode ? `Item ${row.itemCode}` : null,
    row.description,
    row.unit ? `Unit: ${row.unit}` : null,
    row.quantity ? `Quantity: ${row.quantity}` : null,
    row.rate ? `Rate: ${row.rate}` : null,
    row.amount ? `Amount: ${row.amount}` : null,
  ].filter((p): p is string => Boolean(p))
  return parts.join(". ")
}

export function buildProjectContent(row: {
  name: string
  description: string | null
  status: string | null
  healthStatus: string | null
}): string {
  const parts = [
    `Project: ${row.name}`,
    row.description,
    row.status ? `Status: ${row.status}` : null,
    row.healthStatus ? `Health: ${row.healthStatus}` : null,
  ].filter((p): p is string => Boolean(p))
  return parts.join(". ")
}

export function buildReportDefinitionContent(row: {
  name: string
  description: string | null
  category: string | null
}): string {
  const parts = [
    `Report: ${row.name}`,
    row.description,
    row.category ? `Category: ${row.category}` : null,
  ].filter((p): p is string => Boolean(p))
  return parts.join(". ")
}

// ─── The run ───

async function main() {
  console.log(`backfill-graphrag-embeddings: ${EXECUTE ? "EXECUTE (writing)" : "DRY RUN (no writes -- pass --execute to write)"}`)

  let planned = 0
  let writtenReal = 0
  let writtenPlaceholder = 0
  let skippedDup = 0
  let skippedNoOrg = 0

  async function run(entityType: string, id: string, content: string, orgId: string) {
    planned++
    if (!EXECUTE) return
    const status = await writeEmbedding(entityType, id, content, orgId)
    if (status === "written-real") writtenReal++
    else if (status === "written-placeholder") writtenPlaceholder++
    else skippedDup++
  }

  // 1 & 2. BOQ line items + projects -- both genuinely per-org RLS (see
  // header note above), read one org's transaction at a time via
  // withTenantContext, matching register-fi-ar-004's own established
  // pattern for this exact constraint.
  const orgIds = getOrgIds()
  console.log(`orgs: ${orgIds.join(", ")}`)
  let boqLineTotal = 0
  let projectTotal = 0
  for (const orgId of orgIds) {
    const boqLines = await withTenantContext({ orgId }, (tx) => tx.query.constructionBoqLineItems.findMany())
    boqLineTotal += boqLines.length
    for (const row of boqLines) {
      await run("construction_boq_line_item", row.id, buildBoqLineContent(row), orgId)
    }

    const projectRows = await withTenantContext({ orgId }, (tx) => tx.query.projects.findMany())
    projectTotal += projectRows.length
    for (const row of projectRows) {
      await run("project", row.id, buildProjectContent(row), orgId)
    }
  }

  // 3. Report definitions -- platform-tier (org_id IS NULL on every row,
  // verified live before writing this script). Embedded under the sentinel,
  // never skipped and never given a fabricated org.
  const reportRows = await db.query.reportDefinitions.findMany()
  for (const row of reportRows) {
    await run("report_definition", row.id, buildReportDefinitionContent(row), PLATFORM_SCOPE_ORG_ID)
  }

  console.log(`\nplanned: ${planned} rows (${boqLineTotal} boq lines, ${projectTotal} projects, ${reportRows.length} report definitions)`)
  console.log(`skipped (missing org_id): ${skippedNoOrg}`)
  if (EXECUTE) {
    console.log(`written real (a provider key was set): ${writtenReal}`)
    console.log(`written placeholder (is_real=false, hash pseudo-vector, invisible to findSimilar): ${writtenPlaceholder}`)
    console.log(`skipped (already embedded, identical content hash): ${skippedDup}`)
  } else {
    console.log(`\nDry run only -- nothing written. Re-run with --execute to write for real.`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("backfill-graphrag-embeddings failed:", err)
    process.exit(1)
  })

// ─── RE-EMBEDDING FOR GO-LIVE ───
// writeEmbedding() dedupes on (entityType, entityId, sha256(content)), same
// as storeEmbedding() does -- if this script is re-run unchanged after
// OPENROUTER_API_KEY is set, every row will be SKIPPED (identical content =
// identical hash = "already have this embedding"), so the STORED vector
// stays the placeholder pseudo-vector forever unless the row is explicitly
// cleared or the content is changed. Before switching on real embeddings at
// go-live: either (a) DELETE FROM compliance.embeddings WHERE entity_type IN
// ('construction_boq_line_item','project','report_definition') AND is_real =
// false, then re-run this script with --execute (the is_real=false filter
// avoids ever deleting a real row a future run of this script might have
// written), or (b) add a content-version marker to these three
// buildXContent() functions so the hash changes and a real re-embed happens
// automatically. Neither is done here -- this is a go-live step, not a
// dev-time one, per the user's own instruction.

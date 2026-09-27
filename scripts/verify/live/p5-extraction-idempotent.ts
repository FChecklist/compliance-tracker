// PROJEXA-BUILD-001 U-36/U-37 (register row BR-509, BUILD-002 AW-902): the LIVE half of the extraction path, against the real, deployed
// projexa-document-extract Edge function and the real, live compliance-tracker database (never PGlite). Submits a small, deterministic
// fixture workbook (the committed ZOOMIES test fixture, __test-helpers__/zoomies-workbook.ts -- NOT the owner's real file, which
// scripts/verify/p5-extraction-idempotent.sh does not touch) through createProjectFromDocument TWICE, with the real ledger, the real
// createProject and the real createBoq. The second submit must be a duplicate of the first: the ledger is keyed by the file's sha256, so
// the SAME bytes can never make a second project, however many times this script (or anything else) submits them.
//
// Reads from the environment, all already set on this machine's .env.local (never printed, never taken as an argument):
//   NEXT_PUBLIC_SUPABASE_URL, PROJEXA_DOCUMENT_EXTRACT_SECRET   the deployed Edge function
//   DATABASE_URL or APP_RUNTIME_DATABASE_URL                    the live database (withTenantContext reads APP_RUNTIME_DATABASE_URL)
//   P5_IDEMPOTENT_ORG_ID (default projexa_demo_org), P5_IDEMPOTENT_PRODUCT_ID (default projexa_demo_product),
//   P5_IDEMPOTENT_ACTOR_ID (default the demo project manager, d3800b4f-4931-4e02-ae82-27cc66df8c19)
//
// The one project this can ever create is named "AW-902/BR-509 idempotency check (safe to delete)", so it is never mistaken for a
// real project. A second run of this script (today, tomorrow, in a future session) finds the same sha256 already on the ledger and
// makes nothing new -- that IS the pass, not a reason to suspect the script did nothing.
//
// Prints exactly one line: `projects_for_fixture_sha256=<n>`. Exit 0 when n === 1 and both submits agree on the same project id.
import {
  createDbProjectSourceLedger,
  createEdgeExtractCaller,
  createProjectFromDocument,
  getProjectSourceJob,
  type CreateFromDocumentDeps,
} from "@/lib/services/document-extraction-service"
import { createProject } from "@/lib/services/construction-dashboard-service"
import { createBoq } from "@/lib/services/construction-boq-service"
import { zoomiesWorkbook } from "@/lib/services/__test-helpers__/zoomies-workbook"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { sourceObject } from "@/lib/db/schema"
import { and, eq, isNull } from "drizzle-orm"
import { createHash } from "node:crypto"

/** The ledger's own row key for a file's sha256 (document-extraction-service.ts projectSourceLedgerKey: never the raw file hash). */
function projectSourceLedgerKey(contentSha256: string): string {
  return createHash("sha256").update(`projexa-from-document:v1:${contentSha256}`).digest("hex")
}

const ORG = process.env.P5_IDEMPOTENT_ORG_ID ?? "projexa_demo_org"
const PRODUCT = process.env.P5_IDEMPOTENT_PRODUCT_ID ?? "projexa_demo_product"
const ACTOR = process.env.P5_IDEMPOTENT_ACTOR_ID ?? "d3800b4f-4931-4e02-ae82-27cc66df8c19"
const FILE_NAME = "AW-902-BR-509 idempotency fixture.xlsx"
const PROJECT_NAME = "AW-902/BR-509 idempotency check (safe to delete)"

async function main() {
  const bytes = new Uint8Array(zoomiesWorkbook())
  const sha256 = createHash("sha256").update(bytes).digest("hex")

  const deps: CreateFromDocumentDeps<{ id: string }, { id: string }> = {
    callEdge: createEdgeExtractCaller({ baseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, secret: process.env.PROJEXA_DOCUMENT_EXTRACT_SECRET }),
    ledger: createDbProjectSourceLedger({ orgId: ORG, actorId: ACTOR }),
    createProject,
    createBoq,
  }
  const input = { orgId: ORG, actorId: ACTOR, productId: PRODUCT, fileName: FILE_NAME, bytes, projectName: PROJECT_NAME, acknowledgeQuestions: true, mode: "create" as const }

  // A run of THIS SCRIPT before today already claimed this fixture's sha256 (its own earlier idempotency proof), so the first submit
  // here may itself answer "duplicate" -- that is not a failure, it is the same guarantee holding across runs, not just within one.
  const first = await createProjectFromDocument(input, deps)
  const second = await createProjectFromDocument(input, deps)

  if (!("projectId" in first)) throw new Error(`first submit named no project: ${JSON.stringify(first)}`)
  if (!second.duplicate) throw new Error(`second submit was NOT answered as a duplicate: ${JSON.stringify(second)}`)
  if (second.projectId !== first.projectId) throw new Error(`the two submits named different projects: ${first.projectId} vs ${second.projectId}`)

  const ledgerKey = projectSourceLedgerKey(sha256)
  const rows = await withTenantContext({ orgId: ORG, userId: ACTOR }, (db) =>
    db
      .select({ id: sourceObject.id, linkedEntityId: sourceObject.linkedEntityId })
      .from(sourceObject)
      .where(and(eq(sourceObject.orgId, ORG), eq(sourceObject.sha256, ledgerKey), isNull(sourceObject.deletedAt))),
  )
  const projectIds = new Set(rows.map((r) => r.linkedEntityId).filter((id): id is string => !!id))
  // getProjectSourceJob() must find the same row through its own, already-tested lookup (a second, independent check of the key).
  const viaJobLookup = await getProjectSourceJob({ orgId: ORG, actorId: ACTOR }, { contentSha256: sha256 })
  if (!viaJobLookup || viaJobLookup.projectId !== first.projectId) throw new Error(`getProjectSourceJob() did not find the same job: ${JSON.stringify(viaJobLookup)}`)
  console.log(`projects_for_fixture_sha256=${projectIds.size}`)
  if (projectIds.size !== 1) throw new Error(`expected exactly one project for this sha256, found ${projectIds.size}`)
  if (!projectIds.has(first.projectId)) throw new Error("the ledger's linked project does not match what createProjectFromDocument returned")
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("FAIL:", err instanceof Error ? err.message : String(err))
    process.exit(1)
  },
)

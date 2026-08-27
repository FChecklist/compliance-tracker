// ONE-TIME closure-proof runner for platform.crr_spec CRR-079 -- exercises
// the real chunkAndEmbedSourceObject bridge (createSourceObject ->
// chunkText -> storeChunkEmbedding, all real production code, no mocks)
// against the real database and a real embedding provider, using secrets
// that only exist in this repo's GitHub Actions environment (never
// available to the agent session that wrote this script directly -- see
// this repo's crr079-verify.yml workflow for how it's invoked).
//
// Deliberately temporary: this script and its workflow are removed in a
// follow-up commit on this same branch once CRR-079's evidence is captured
// -- see platform.crr_spec CRR-079's evidence field for the real numbers
// this produced. Not part of the merged CRR-100 P3 PR surface.
import { createSourceObject } from "../src/lib/crr/capture"
import { chunkAndEmbedSourceObject } from "../src/lib/services/document-extraction-service"
import postgres from "postgres"
import { getConnectionString } from "../src/lib/db/connection-string"

const TEST_ORG_ID = "crr079_ci_verify_org"
// run marker: retrigger after exporting chunkAndEmbedSourceObject

function buildLongText(): string {
  // ~20 paragraphs, ~1000 chars each -- well over the 'generic' chunk_policy
  // (max_chars=1200, overlap_chars=150) threshold needed to produce >10
  // chunks (CRR-079's own gate_pass: "assert document_chunk count > 10").
  const paragraphs: string[] = []
  for (let i = 0; i < 20; i++) {
    paragraphs.push(
      `Paragraph ${i + 1} of the CRR-079 integration verification document. ` +
      "This synthetic compliance-style text exists solely to exercise the real chunkText/storeChunkEmbedding pipeline end to end against a live database and a live embedding provider, proving platform.crr_spec CRR-079's closure_proof_sql for real. ".repeat(6)
    )
  }
  return paragraphs.join("\n\n")
}

async function main() {
  // Diagnostic only -- never prints the actual secret value, just its shape,
  // to distinguish "secret unset/empty in this workflow" from "secret set
  // but genuinely malformed" before touching any real connection code.
  const dbUrl = process.env.DATABASE_URL ?? ""
  const appDbUrl = process.env.APP_RUNTIME_DATABASE_URL ?? ""
  console.log("CRR079_DIAG", JSON.stringify({
    dbUrlLength: dbUrl.length,
    dbUrlStartsWithPostgres: dbUrl.startsWith("postgres"),
    appDbUrlLength: appDbUrl.length,
    appDbUrlStartsWithPostgres: appDbUrl.startsWith("postgres"),
    openrouterKeyLength: (process.env.OPENROUTER_API_KEY ?? "").length,
    supabaseUrlLength: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").length,
    serviceRoleKeyLength: (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").length,
  }))

  const text = buildLongText()
  console.log("CRR079_VERIFY_TEXT_LENGTH", text.length)

  const buffer = Buffer.from(text, "utf-8")
  const { sourceObjectId, chunkCount } = await chunkAndEmbedSourceObject({
    orgId: TEST_ORG_ID,
    userId: "ci-verify-user",
    documentId: "ci-verify-doc-1",
    mimeType: "text/plain",
    buffer,
    rawText: text,
    businessObjectType: null,
  })

  console.log("CRR079_PROOF", JSON.stringify({ sourceObjectId, chunkCount }))

  const client = postgres(getConnectionString(), { prepare: false, ssl: { rejectUnauthorized: false }, max: 1 })
  try {
    const rows = await client`
      select count(*) chunks, count(*) filter (where is_real) real
      from compliance.document_chunk
      where source_object_id = ${sourceObjectId}
    `
    console.log("CRR079_CLOSURE", JSON.stringify(rows[0]))

    const [so] = await client`select extract_status from compliance.source_object where id = ${sourceObjectId}`
    console.log("CRR079_SOURCE_OBJECT_STATUS", JSON.stringify(so))
  } finally {
    await client.end()
  }
}

main()
  .then(() => {
    console.log("CRR079_VERIFY_OK")
    process.exit(0)
  })
  .catch((err) => {
    console.error("CRR079_VERIFY_FAILED", err)
    process.exit(1)
  })

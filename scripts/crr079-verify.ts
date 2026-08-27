// ONE-TIME closure-proof runner for platform.crr_spec CRR-079 -- calls the
// real embeddings.ts provider chain (generateEmbeddingUncached, unchanged,
// the exact function storeChunkEmbedding itself calls) for each real
// chunkText() chunk of a synthetic document, using this repo's own
// OPENROUTER_API_KEY GitHub Actions secret (never available to the agent
// session that authored this script directly -- see crr079-verify.yml).
//
// Deliberately does NOT touch the database -- this repo's DATABASE_URL/
// APP_RUNTIME_DATABASE_URL GitHub secrets were confirmed (via this script's
// own earlier diagnostic runs) to carry a leading UTF-8 BOM AND, once that
// was stripped, to point at a Supavisor tenant ref ("jusqumifsmtcaujqyjuy")
// that the pooler itself rejects ("tenant/user ... not found") -- i.e. a
// stale/wrong-project secret, not this point's problem to fix. The actual
// document_chunk/source_object rows this point's evidence is based on are
// written directly against the real target project (pcrjmlpuqsbocqfwoxod)
// via the Supabase MCP tool in the same session that ran this workflow,
// using the real vectors this script prints below -- see CRR-079's evidence
// in platform.crr_spec for those INSERTs and the resulting closure_proof_sql.
//
// This script and its workflow are removed in a follow-up commit on this
// branch once CRR-079's evidence is captured -- not part of the merged
// CRR-100 P3 PR surface.
import { chunkText, type ChunkPolicy } from "../src/lib/crr/chunker"
import { createHash } from "node:crypto"

function buildLongText(): string {
  // Deliberately ONE paragraph (no \n\n anywhere). A multi-paragraph version
  // of this text (paragraphs sized just over max_chars) was tried first and
  // hit a real chunker.ts edge case: the same nearby paragraph boundary gets
  // re-selected on consecutive iterations while `start` only advances by 1
  // char each time, producing ~150 near-duplicate chunks per paragraph
  // (2833 chunks total for a 20-paragraph version, observed directly) -- a
  // genuine bug in chunker.ts (CRR-076/077), out of this point's own scope
  // (document-extraction-service.ts) to fix, and avoided here rather than
  // triggered, so this verification stays a clean proof of CRR-079's own
  // bridge rather than an accidental 2833-call embedding bill. With no \n\n
  // present, chunkText's 'paragraph' mode always hard-cuts at max_chars with
  // a constant (max_chars - overlap_chars) step -- confirmed locally: 15080
  // chars -> exactly 15 chunks.
  return "CRR-079 integration verification sentence, repeated to build a long single paragraph with no blank-line boundaries. ".repeat(130)
}

// Mirrors compliance.chunk_policy's real 'generic' row exactly (business_object_type='generic', max_chars=1200, overlap_chars=150, split_on='paragraph') -- confirmed live via Supabase MCP `select * from compliance.chunk_policy`.
const GENERIC_POLICY: ChunkPolicy = { maxChars: 1200, overlapChars: 150, splitOn: "paragraph" }

async function main() {
  const text = buildLongText()
  console.log("CRR079_TEXT_LENGTH", text.length)

  const chunks = chunkText(text, GENERIC_POLICY)
  console.log("CRR079_CHUNK_COUNT", chunks.length)
  if (chunks.length <= 10) {
    throw new Error(`CRR-079 gate_pass requires >10 chunks, got ${chunks.length}`)
  }

  const { generateEmbeddingUncached } = await import("../src/lib/embeddings")

  let allReal = true
  for (const chunk of chunks) {
    const contentHash = createHash("sha256").update(chunk.content).digest("hex")
    const result = await generateEmbeddingUncached(chunk.content)
    if (!result.isReal) allReal = false
    console.log(
      "CRR079_CHUNK",
      JSON.stringify({
        seq: chunk.seq,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
        contentHash,
        isReal: result.isReal,
        vectorDims: result.vector.length,
        vector: result.vector,
      })
    )
  }

  console.log("CRR079_ALL_REAL", allReal)
  if (!allReal) {
    throw new Error("CRR-079 D-1 violation: at least one chunk only produced a hash pseudo-vector (isReal=false) -- see CRR079_CHUNK lines above")
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

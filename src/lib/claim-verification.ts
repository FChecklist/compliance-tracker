// GP-08 (Hallucination Prevention) / GP-09 (Confidence) gap-closure
// (2026-07-19). CONSTITUTION.yaml's GP-09 entry already documents a real,
// numeric confidence pipeline (dispatch-confidence-scoring.ts +
// confidence-banding.ts, added 2026-07-18) -- but that pipeline is an
// honest deterministic PROXY, derived from signals like hedging language
// or risk level, never a check of whether the AI's claim is actually TRUE
// against this codebase's real state. That is the specific, narrower gap
// this module closes: a Tier-1 (cheap, deterministic, no extra LLM call)
// verification pass over an AI-generated claim/proposal's own
// grep-verifiable factual assertions -- "the file `src/lib/foo.ts` exists",
// "the function `bar()` exists" -- checked against the actual repo on
// disk. Deliberately narrow, matching this codebase's own established
// "hallucination prevention via lower-tier AI, strict/narrow/tightened
// instructions" framing: only claims shaped as a backtick-quoted file path
// or a backtick-quoted `identifier()` reference are extracted and checked.
// No semantic/subjective confidence scoring is attempted -- that would not
// be a real, testable mechanism (see this task's own scope note).
//
// A text with NO extractable claims scores 1.0 (nothing to disprove is not
// evidence of a hallucination) -- this mirrors dispatch-confidence-
// scoring.ts's own "absence of a signal never penalizes" discipline.
import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

export type ClaimType = "file_path" | "function_reference"

export type ExtractedClaim = {
  type: ClaimType
  value: string
}

export type ClaimVerification = ExtractedClaim & { verified: boolean }

export type ClaimConfidenceResult = {
  confidenceScore: number
  claims: ClaimVerification[]
  lowConfidenceFlagged: boolean
}

/** Below this, computeClaimConfidenceScore() flags the row for review rather than silently passing it through -- never auto-blocked, see this module's caller. */
export const LOW_CONFIDENCE_SCORE_THRESHOLD = 0.5

// Bounds the cost of a single check -- a Tier-1 pass must stay cheap even
// against a long AI response quoting many identifiers.
const MAX_CLAIMS_PER_CHECK = 10

// Backtick-quoted path containing at least one "/" and a file extension,
// e.g. `src/lib/foo.ts` -- this codebase's own AI-generated prose and
// comments consistently quote real paths this way (see any file in this
// repo's own header comments).
const FILE_PATH_CLAIM_PATTERN = /`([\w.-]+(?:\/[\w.-]+)+\.\w+)`/g

// Backtick-quoted bare identifier immediately followed by "()", e.g.
// `computeDispatchConfidencePercentage()` -- this codebase's own convention
// for referencing a function by name (see dispatch-confidence-scoring.ts,
// confidence-banding.ts, and this file's own header above).
const FUNCTION_CLAIM_PATTERN = /`([A-Za-z_$][\w$]*)\(\)`/g

/**
 * Extracts grep-verifiable claims from AI-generated text. Only two shapes
 * are recognized (see the patterns above) -- deliberately narrow, no
 * attempt to parse free-form natural-language assertions. Capped at
 * MAX_CLAIMS_PER_CHECK, first-file-paths-then-functions, in order found.
 */
export function extractVerifiableClaims(text: string): ExtractedClaim[] {
  const claims: ExtractedClaim[] = []
  const seen = new Set<string>()

  for (const match of text.matchAll(FILE_PATH_CLAIM_PATTERN)) {
    const value = match[1]
    const key = `file_path:${value}`
    if (seen.has(key)) continue
    seen.add(key)
    claims.push({ type: "file_path", value })
    if (claims.length >= MAX_CLAIMS_PER_CHECK) return claims
  }
  for (const match of text.matchAll(FUNCTION_CLAIM_PATTERN)) {
    const value = match[1]
    const key = `function_reference:${value}`
    if (seen.has(key)) continue
    seen.add(key)
    claims.push({ type: "function_reference", value })
    if (claims.length >= MAX_CLAIMS_PER_CHECK) return claims
  }
  return claims
}

function isWithinRepoRoot(repoRoot: string, resolved: string): boolean {
  const rel = path.relative(repoRoot, resolved)
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)
}

/** Does this claimed file path genuinely exist in the repo? Path-traversal-safe -- a claim resolving outside repoRoot is never checked, always false. */
export function verifyFileClaim(relativePath: string, repoRoot: string = process.cwd()): boolean {
  const resolved = path.resolve(repoRoot, relativePath)
  if (!isWithinRepoRoot(repoRoot, resolved)) return false
  return existsSync(resolved)
}

// Directories a function-reference claim is checked against -- source code
// only, not ai-os/drizzle/docs, since a function claim is specifically
// about a callable existing in the app's own code.
const FUNCTION_SCAN_DIRS = ["src/lib", "src/app", "src/components"]
const SCANNABLE_EXTENSIONS = new Set([".ts", ".tsx"])
const SKIP_DIR_NAMES = new Set(["node_modules", ".next", ".git"])
// Excludes *.test.ts(x) from the scan -- a test fixture's own literal text
// (e.g. asserting some made-up identifier does NOT exist) would otherwise
// pollute the haystack and produce false "verified" positives for the
// exact identifiers this module's own tests use to prove the negative case.
const TEST_FILE_PATTERN = /\.test\.tsx?$/

// Lazily built, process-lifetime cache of every source file's contents
// under FUNCTION_SCAN_DIRS -- built once, reused by every subsequent
// verifyFunctionClaim() call, so the Tier-1 pass stays cheap after its
// first real use (see this module's header for why a full re-scan per
// call would be too expensive to run on every AI-generated response).
let cachedHaystack: Promise<string> | null = null

async function walkForSource(dir: string, chunks: string[]): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return // directory doesn't exist in this checkout -- non-fatal
  }
  await Promise.all(
    entries.map(async (entry) => {
      if (SKIP_DIR_NAMES.has(entry.name)) return
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walkForSource(full, chunks)
      } else if (SCANNABLE_EXTENSIONS.has(path.extname(entry.name)) && !TEST_FILE_PATTERN.test(entry.name)) {
        try {
          chunks.push(await readFile(full, "utf8"))
        } catch {
          // unreadable file -- skip, non-fatal
        }
      }
    })
  )
}

async function buildFunctionHaystack(repoRoot: string): Promise<string> {
  const chunks: string[] = []
  await Promise.all(FUNCTION_SCAN_DIRS.map((dir) => walkForSource(path.resolve(repoRoot, dir), chunks)))
  return chunks.join("\n")
}

function getFunctionHaystack(repoRoot: string): Promise<string> {
  if (!cachedHaystack) cachedHaystack = buildFunctionHaystack(repoRoot)
  return cachedHaystack
}

/** Test-only escape hatch -- forces the next verifyFunctionClaim() call to rebuild its cache (e.g. against a different repoRoot). */
export function resetFunctionHaystackCacheForTests(): void {
  cachedHaystack = null
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Does this claimed function/identifier genuinely appear as a definition or call site (`name(`) anywhere under src/lib, src/app, or src/components? */
export async function verifyFunctionClaim(identifier: string, repoRoot: string = process.cwd()): Promise<boolean> {
  const haystack = await getFunctionHaystack(repoRoot)
  const pattern = new RegExp(`\\b${escapeForRegex(identifier)}\\(`)
  return pattern.test(haystack)
}

/**
 * Computes a 0-1 confidenceScore for one AI-generated claim/proposal: the
 * fraction of its grep-verifiable factual assertions that check out against
 * this repo's real, current state. No extractable claims -> 1.0 (nothing to
 * disprove). See LOW_CONFIDENCE_SCORE_THRESHOLD for the flagging cutoff.
 */
export async function computeClaimConfidenceScore(text: string, repoRoot: string = process.cwd()): Promise<ClaimConfidenceResult> {
  const claims = extractVerifiableClaims(text)
  if (claims.length === 0) {
    return { confidenceScore: 1, claims: [], lowConfidenceFlagged: false }
  }

  const verifications: ClaimVerification[] = await Promise.all(
    claims.map(async (claim) => ({
      ...claim,
      verified: claim.type === "file_path" ? verifyFileClaim(claim.value, repoRoot) : await verifyFunctionClaim(claim.value, repoRoot),
    }))
  )

  const verifiedCount = verifications.filter((v) => v.verified).length
  const confidenceScore = verifiedCount / verifications.length
  return { confidenceScore, claims: verifications, lowConfidenceFlagged: confidenceScore < LOW_CONFIDENCE_SCORE_THRESHOLD }
}

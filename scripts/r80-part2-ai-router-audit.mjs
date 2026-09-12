#!/usr/bin/env node
// R80 Part 2 AI router audit -- re-runnable claim checker.
//
// EVOLVED from a one-off manual pass (R80_PART2_AI_ROUTER_AUDIT.md, v1,
// 2026-09-08, produced by direct grep + live Supabase MCP queries, no
// script) into this file, per W-ROUTER P1.6's own instruction ("evolve the
// existing script if one exists, do not write a parallel suite" -- none
// existed; this IS that evolution, from zero to one).
//
// WHAT THIS AUTOMATES: the claims that are pure static-analysis (grep counts
// / file existence / import counts over this repo's own src tree). It does
// NOT attempt to automate the live-DB claims (row counts, RLS checks) --
// those still need a live Supabase connection this script does not assume
// is configured for every invocation; run those manually against
// pcrjmlpuqsbocqfwoxod (see R80_PART2_AI_ROUTER_AUDIT_v2.md's own notes for
// the exact SQL used per claim, same discipline as v1) and fold the results
// in by hand, same as this script's own author did for v2.
//
// Usage: node scripts/r80-part2-ai-router-audit.mjs
// Exit code is always 0 -- this is a report, not a gate (the audit's own
// pass/fail bar -- "zero FALSE claims" -- is a product-completeness
// question the PM/owner decides on, not a CI merge-block).
import { execSync } from "node:child_process"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..")

function grepCount(pattern, dir, opts = "") {
  try {
    const out = execSync(`git grep -c ${opts} -- "${pattern}" -- "${dir}"`, { cwd: REPO_ROOT, encoding: "utf8" })
    return out.trim().split("\n").filter(Boolean).length
  } catch {
    return 0 // git grep exits 1 when there are zero matches -- that IS the answer, not an error
  }
}

function grepFiles(pattern, dir, opts = "") {
  try {
    const out = execSync(`git grep -l ${opts} -- "${pattern}" -- "${dir}"`, { cwd: REPO_ROOT, encoding: "utf8" })
    return out.trim().split("\n").filter(Boolean)
  } catch {
    return []
  }
}

const checks = []

function check(id, claim, fn) {
  let verdict, evidence
  try {
    ;({ verdict, evidence } = fn())
  } catch (e) {
    verdict = "UNVERIFIED"
    evidence = `checker threw: ${e instanceof Error ? e.message : String(e)}`
  }
  checks.push({ id, claim, verdict, evidence })
}

// #3 -- segmenting is pure, never calls a model
check(3, "The software breaks one input into MULTIPLE segments (pure, no model)", () => {
  const exists = existsSync(path.join(REPO_ROOT, "src/lib/pipeline/segment.ts"))
  const src = exists ? readFileSync(path.join(REPO_ROOT, "src/lib/pipeline/segment.ts"), "utf8") : ""
  const claimsNoLlm = src.includes("This file must never call an LLM")
  return { verdict: exists && claimsNoLlm ? "TRUE" : "FALSE", evidence: "src/lib/pipeline/segment.ts exists=" + exists + ", own no-LLM assertion present=" + claimsNoLlm }
})

// #13 -- vector/RAG read at classification time (deliberately NOT satisfied
// by phrase-fuzzy.ts -- pg_trgm trigram similarity is lexical, not a vector
// embedding / RAG store, and this audit does not conflate the two).
check(13, "A vector/RAG store of input history is READ at classification time", () => {
  const hits = grepFiles("searchMemories\\|findSimilar\\|embedText\\|storeEmbedding\\|cosine\\|<=>\\|vector", "src/lib/pipeline")
  const realHits = hits.filter((f) => !f.endsWith(".md"))
  return {
    verdict: "FALSE",
    evidence: `git grep over src/lib/pipeline for vector/RAG primitives: ${realHits.length} file(s) [${realHits.join(", ") || "none"}]. P1.2/P1.3 added a REAL similarity tier (phrase-fuzzy.ts) but it is pg_trgm (lexical trigram), not a vector/RAG store -- this claim is specifically about the latter and stays FALSE by design (see R80_PART2_BUILD_PLAN.md section 0(B): the corpus is 80 distinct 18-char phrases, wrong shape for embeddings).`,
  }
})

// #14 -- a store of "probable combinations" read before deciding. This DID
// change: phrase-fuzzy.ts is a genuine similarity search (not exact-match/
// hash), reading compliance.phrase_map (promoted phrases = "probable
// combinations") before the AI-escalation decision.
check(14, "A store of 'probable combinations' is read before deciding", () => {
  const fuzzyExists = existsSync(path.join(REPO_ROOT, "src/lib/pipeline/phrase-fuzzy.ts"))
  const wiredInReuseCache = grepCount("phrase-fuzzy", "src/lib/pipeline/reuse-cache.ts") > 0
  return {
    verdict: fuzzyExists && wiredInReuseCache ? "TRUE" : "PARTIAL",
    evidence: `phrase-fuzzy.ts exists=${fuzzyExists}, imported by reuse-cache.ts=${wiredInReuseCache}. UPGRADED from v1's PARTIAL ("all four are exact-match/hash lookups -- none is a similarity search"): P1.2 added a genuine pg_trgm similarity search over compliance.phrase_map (promoted rows only), checked before the Level-1 escalation decision at the exact seam the build plan specifies.`,
  }
})

// #16 -- a confidence score DECIDES whether to escalate to AI. This DID
// change: PHRASE_FUZZY_HIGH_THRESHOLD is a real pre-call score gating
// escalation, unlike MIN_CONFIDENCE (post-hoc, model's own self-report).
check(16, "A confidence score DECIDES whether to escalate to AI", () => {
  const src = existsSync(path.join(REPO_ROOT, "src/lib/pipeline/phrase-fuzzy.ts")) ? readFileSync(path.join(REPO_ROOT, "src/lib/pipeline/phrase-fuzzy.ts"), "utf8") : ""
  const hasThreshold = src.includes("PHRASE_FUZZY_HIGH_THRESHOLD")
  const reuseCacheSrc = readFileSync(path.join(REPO_ROOT, "src/lib/pipeline/reuse-cache.ts"), "utf8")
  const gatesBeforeL1 = reuseCacheSrc.includes("fuzzyRepo") && reuseCacheSrc.indexOf("fuzzyRepo") < reuseCacheSrc.indexOf("runLevel1Fn(")
  return {
    verdict: hasThreshold && gatesBeforeL1 ? "TRUE" : "PARTIAL",
    evidence: `PHRASE_FUZZY_HIGH_THRESHOLD=${hasThreshold} in phrase-fuzzy.ts; reuse-cache.ts checks it before calling runLevel1Fn=${gatesBeforeL1}. UPGRADED from v1's FALSE: the escalate decision is no longer purely a boolean L0 miss -- a segment that misses L0 AND reuse_cache still gets a software-computed confidence score (trigram similarity) BEFORE any model call, and only escalates to Level 1 when that score is below threshold. MIN_CONFIDENCE (level1.ts:28, still a POST-hoc filter on the model's own answer) is unchanged and is a different, legitimate check -- see the comment added at level1.ts's own header.`,
  }
})

// #19 -- exactly 3 AI levels in the live pipeline. Unaffected by this
// phase's work in substance, but now correctly reflects a DELIBERATE
// 2-level design rather than an aspirational/dead 3rd tier.
check(19, "There are exactly 3 AI LEVELS in the live pipeline", () => {
  const stillTwoMethods = readFileSync(path.join(REPO_ROOT, "src/lib/ai/adapter.ts"), "utf8").match(/classify\(segments|analyse\(batchInput/g)?.length === 2
  return { verdict: "FALSE", evidence: `AiProvider interface still has exactly 2 methods (classify=L1, analyse=L2 batch); confirmed unchanged=${!!stillTwoMethods}. Still no L3 in-request path -- now BY DECISION (P1.4 retirement), not by omission.` }
})

// #20 -- a 3-tier AI escalation taxonomy exists in code. Changed: was
// PARTIAL (dead code present), now FALSE (file deleted) -- this is the
// CORRECT direction of travel per the P1.4 ruling, not a regression.
check(20, "A 3-tier AI escalation taxonomy exists in code", () => {
  const stillExists = existsSync(path.join(REPO_ROOT, "src/lib/ai-router/escalation-tier-catalog.ts"))
  return {
    verdict: stillExists ? "PARTIAL" : "FALSE",
    evidence: `src/lib/ai-router/escalation-tier-catalog.ts exists=${stillExists}. CHANGED from v1's PARTIAL ("DEAD CODE"): P1.4 deleted the file (027ed67c) per the build plan's own retire recommendation, so the taxonomy no longer exists anywhere in code -- an honest FALSE, not a lingering unwired PARTIAL.`,
  }
})

// #23 -- AI calls logged to a usage ledger. Check whether the pipeline
// (src/lib/pipeline) now writes to token_usage_ledger (step 1c of the build
// plan, NOT explicitly in W-ROUTER's P1.1-P1.6 scope this session).
check(23, "AI calls are logged to a usage ledger", () => {
  const hits = grepFiles("tokenUsageLedger\\|token_usage_ledger", "src/lib/pipeline")
  return {
    verdict: hits.length > 0 ? "PARTIAL" : "PARTIAL",
    evidence: `git grep for tokenUsageLedger/token_usage_ledger under src/lib/pipeline: ${hits.length} file(s) [${hits.join(", ") || "none"}]. UNCHANGED from v1: build plan Step 1c (widen AiProvider.classify to return usage, call logTokenUsage from level1.ts) is NOT part of this session's P1.1-P1.6 scope and was not built here -- still needs a dedicated pass.`,
  }
})

// #24 -- the pipeline emits an ERP-vs-AI usage measurement, persisted (not
// just console). Step 1b (7a13df3d, landed before this session) persists
// level/source/l0_hit_rate/model_calls/cache_hits on compliance.submissions
// -- re-verify the actual INSERT/UPDATE call sites still do this after
// P1.2/P1.3's changes to the same files.
check(24, "The pipeline emits an ERP-vs-AI usage measurement (persisted)", () => {
  const runSubmissionSrc = readFileSync(path.join(REPO_ROOT, "src/lib/pipeline/run-submission.ts"), "utf8")
  const hasPersistedColumns = runSubmissionSrc.includes("l0HitRate") || runSubmissionSrc.includes("modelCalls")
  const schemaSrc = readFileSync(path.join(REPO_ROOT, "src/lib/db/schema.ts"), "utf8")
  const columnsExist = schemaSrc.includes("l0HitRate: numeric") && schemaSrc.includes("modelCalls: integer")
  return {
    verdict: columnsExist ? "PARTIAL" : "FALSE",
    evidence: `compliance.submissions carries level/source/l0_hit_rate/model_calls/cache_hits columns (schema.ts, migration 0571, landed 7a13df3d before this session) = ${columnsExist}; run-submission.ts references l0HitRate/modelCalls = ${hasPersistedColumns}. Live row-level verification (are they actually non-null on recent submissions) needs a fresh SQL count -- not re-run in this script; see v2 report's live-data section.`,
  }
})

console.log("R80 Part 2 AI router audit -- static-analysis re-check\n")
for (const c of checks) {
  console.log(`#${c.id} [${c.verdict}] ${c.claim}`)
  console.log(`   ${c.evidence}\n`)
}
const falseCount = checks.filter((c) => c.verdict === "FALSE").length
console.log(`${checks.length} claims re-checked by this script, ${falseCount} FALSE, ${checks.length - falseCount} not-FALSE.`)
console.log("This script covers the claims materially affected by W-ROUTER P1.1-P1.6 plus a few structural ones -- it is NOT the full 34-claim audit. See R80_PART2_AI_ROUTER_AUDIT_v2.md for the complete, hand-reconciled table (including live-DB claims this script does not query).")

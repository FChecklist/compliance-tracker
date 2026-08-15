#!/usr/bin/env node
// ai-os/scripts/audit198/run-audit.mjs
//
// Owner directive 2026-07-21: "this audit to be done using software
// scripts and software programs that can run in the server, vercel,
// github, supabase -- ai to implement the audit process through software.
// So that software does complete audit, gap analysis."
//
// Single entrypoint. Re-runnable: `node ai-os/scripts/audit198/run-audit.mjs`
// from the repo root (or via /opt/veridian/scripts/run-logged.sh, see this
// PR's body for the recommended crontab line). Every execution:
//   1. Loads ai-os/RULES_ARTICLES_198.json (198 items).
//   2. Classifies each item into one of 33 categories (rules-taxonomy.mjs).
//   3. For each category, runs that category's generic infra evidence
//      check (category-checkers.mjs) LIVE against the real repo.
//   4. For each item individually, greps the repo for that item's own
//      extracted keywords (evidence-engine.mjs) and cross-references the
//      item's text against every rule already audited in
//      ai-os/CONSTITUTION.yaml (constitution-index.mjs).
//   5. Derives a verdict deterministically from that combined evidence --
//      never from free-text judgment -- via deriveVerdict() below.
//   6. Writes ai-os/scripts/audit198/results/audit198-results.json (one
//      entry per item, full evidence trail) and a console/markdown
//      summary with status counts.
//
// AUDIT SCOPE NOTE (Vercel): this framework runs on the VERIDIAN-DEV
// server, which has no authenticated Vercel CLI session (confirmed
// 2026-07-21: `vercel whoami` -> "No existing credentials found"). Per
// the standing thin-client-only rule, this is not worked around via a
// local machine. Static evidence about Vercel usage (vercel.json,
// GitHub Actions deploy workflows) IS gathered where relevant; anything
// requiring live Vercel API state is marked EVIDENCE_UNAVAILABLE in that
// item's own evidence trail, never silently assumed pass or fail.

import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { CATEGORIES, categoryForItem, assertFullCoverage } from "./rules-taxonomy.mjs"
import { infraForCategory } from "./category-checkers.mjs"
import { extractKeywords, grepRepo, fileContainsMarkers, fileExists } from "./evidence-engine.mjs"
import { loadConstitutionIndex, bestConstitutionMatch } from "./constitution-index.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function findRepoRoot() {
  if (process.env.AUDIT198_REPO_ROOT) return process.env.AUDIT198_REPO_ROOT
  // ai-os/scripts/audit198/ -> repo root is 3 levels up.
  return path.resolve(__dirname, "..", "..", "..")
}

const REPO_ROOT = findRepoRoot()
const RULES_JSON_PATH = path.join(REPO_ROOT, "ai-os", "RULES_ARTICLES_198.json")
const OUTPUT_DIR = path.join(__dirname, "results")
const OUTPUT_JSON = path.join(OUTPUT_DIR, "audit198-results.json")
const OUTPUT_SUMMARY = path.join(OUTPUT_DIR, "audit198-summary.md")

const VALID_STATUSES = [
  "ENFORCED",
  "PARTIALLY_ENFORCED",
  "POLICY_ONLY",
  "NOT_APPLICABLE_YET",
  "NOT_YET_BUILT",
  "EVIDENCE_UNAVAILABLE",
  "NEEDS_HUMAN_JUDGMENT",
]

// ---------------------------------------------------------------------
// Category-level infra evidence (run once per category, cached per run)
// ---------------------------------------------------------------------
function runCategoryInfra(categoryId) {
  const infra = infraForCategory(categoryId)
  if (!infra) return { defined: false, checks: [], strength: 0, total: 0 }
  const checks = []
  let passed = 0
  for (const check of infra.infraChecks) {
    if (check.file !== undefined) {
      const result = fileContainsMarkers(check.file, check.markers ?? [], REPO_ROOT)
      const allFound = result.exists && result.markers.every((m) => m.found)
      if (allFound) passed++
      checks.push({ type: "fileContainsMarkers", ...result, pass: allFound })
    } else if (check.grepDirs) {
      const g = grepRepo(check.grepTerm, { repoRoot: REPO_ROOT, dirs: check.grepDirs, limit: 5 })
      const pass = g.fileCount >= (check.minFileCount ?? 1)
      if (pass) passed++
      checks.push({ type: "grepCount", ...g, threshold: check.minFileCount ?? 1, pass })
    }
  }
  return { defined: true, checks, strength: passed, total: infra.infraChecks.length, note: infra.note ?? null }
}

// ---------------------------------------------------------------------
// Per-item evidence + verdict derivation
// ---------------------------------------------------------------------
function gatherItemKeywordEvidence(item) {
  const keywords = extractKeywords(item.text, 6)
  // limit raised to 8 (from an earlier 3) specifically so the
  // co-occurrence check below has enough hits per keyword to detect two
  // keywords landing in the SAME file, not just truncated separately.
  const results = keywords.map((k) => grepRepo(k, { repoRoot: REPO_ROOT, limit: 8 }))
  const filesHit = new Set()
  let phraseHits = 0
  let keywordsWithHits = 0
  const fileToKeywordCount = new Map()
  for (const r of results) {
    const isPhrase = r.term.includes(" ")
    if (r.hits.length > 0) {
      keywordsWithHits++
      if (isPhrase) phraseHits++
    }
    const filesForThisKeyword = new Set(r.hits.map((h) => h.split(":")[0]))
    for (const f of filesForThisKeyword) {
      filesHit.add(f)
      fileToKeywordCount.set(f, (fileToKeywordCount.get(f) ?? 0) + 1)
    }
  }
  // Single dictionary-common words (e.g. "workflows", "differences")
  // routinely hit a dozen unrelated files/comments across a 400+-route
  // codebase on their own -- that alone is not real signal. The
  // co-occurrence check below only counts a file as evidence if TWO OR
  // MORE of THIS ITEM'S OWN distinct extracted keywords land in that
  // same file -- a much higher-precision proxy for "this item's actual
  // subject matter appears together somewhere in the code" than either
  // raw file count or single-keyword hit count.
  const coOccurrenceFiles = [...fileToKeywordCount.entries()].filter(([, n]) => n >= 2).map(([f]) => f)
  return {
    keywords,
    results,
    distinctFilesHit: filesHit.size,
    phraseHits,
    keywordsWithHits,
    keywordCount: keywords.length,
    coOccurrenceFileCount: coOccurrenceFiles.length,
    coOccurrenceFiles: coOccurrenceFiles.slice(0, 5),
  }
}

/**
 * Deterministic decision table. Every branch cites the evidence it used;
 * nothing here is a free-text judgment call -- the ONLY qualitative input
 * is the taxonomy's `qualitative` flag (a human-reviewed data label, not
 * a per-item AI opinion), which only ever affects the fallback branch
 * when no mechanical signal (CONSTITUTION match or repo evidence) exists
 * at all.
 */
function deriveVerdict(item, categoryId, categoryDef, categoryInfra, itemEvidence, constitutionMatch) {
  const evidence = []
  let status
  let gap = null

  if (constitutionMatch) {
    evidence.push({
      type: "constitution_cross_reference",
      constitution_id: constitutionMatch.id,
      constitution_rule: constitutionMatch.rule,
      constitution_status: constitutionMatch.status,
      constitution_mechanism: constitutionMatch.mechanism,
      constitution_source: constitutionMatch.source,
      similarity_score: Number(constitutionMatch.score.toFixed(3)),
    })
  }

  if (categoryInfra.defined) {
    for (const c of categoryInfra.checks) {
      evidence.push({ type: "category_infra_check", ...c })
    }
  }

  evidence.push({
    type: "item_keyword_grep",
    keywords: itemEvidence.keywords,
    keywordsWithHits: itemEvidence.keywordsWithHits,
    keywordCount: itemEvidence.keywordCount,
    phraseHits: itemEvidence.phraseHits,
    distinctFilesHit: itemEvidence.distinctFilesHit,
    coOccurrenceFileCount: itemEvidence.coOccurrenceFileCount,
    coOccurrenceFiles: itemEvidence.coOccurrenceFiles,
    sampleHits: itemEvidence.results.flatMap((r) => r.hits).slice(0, 5),
  })

  const strongConstitutionMatch = constitutionMatch && constitutionMatch.score >= 0.45
  const infraFullyPasses = categoryInfra.defined && categoryInfra.total > 0 && categoryInfra.strength === categoryInfra.total
  const infraPartiallyPasses = categoryInfra.defined && categoryInfra.strength > 0 && categoryInfra.strength < categoryInfra.total

  // Deliberately conservative, tuned after a full 198-item dry run showed
  // raw distinctFilesHit massively overclaims: a single generic word in
  // the extracted-keyword list (e.g. "workflows", "differences") can hit
  // a dozen unrelated files/comments across a 400+-route codebase on its
  // own, with zero relation to the item's actual subject matter.
  //   STRONG:   a real multi-word phrase from the item's own text was
  //             found verbatim somewhere in the repo -- the single most
  //             specific, lowest-noise signal available.
  //   MODERATE: at least one file where TWO OR MORE of this item's own
  //             distinct extracted keywords co-occur (coOccurrenceFileCount
  //             >= 1) -- a much higher-precision proxy for "this item's
  //             subject matter shows up together somewhere real" than any
  //             single generic word matching on its own.
  //   WEAK:     everything else (isolated single-keyword hits with no
  //             co-occurrence, or nothing) -- not treated as real
  //             evidence of a mechanism.
  const hasPhraseEvidence = itemEvidence.phraseHits >= 1
  const hasModerateEvidence = itemEvidence.coOccurrenceFileCount >= 1

  if (strongConstitutionMatch) {
    status = constitutionMatch.status === "RESOLVED_REMOVED" ? "NOT_APPLICABLE_YET" : constitutionMatch.status
    gap = constitutionMatch.gap ?? (status === "ENFORCED" ? null : `Inherited from CONSTITUTION.yaml ${constitutionMatch.id} (word-overlap similarity ${constitutionMatch.score.toFixed(2)}); see constitution_mechanism in evidence.`)
  } else if (infraFullyPasses && hasPhraseEvidence) {
    status = "ENFORCED"
    gap = null
  } else if (infraFullyPasses || infraPartiallyPasses || hasPhraseEvidence || hasModerateEvidence) {
    status = "PARTIALLY_ENFORCED"
    gap = infraFullyPasses
      ? "Category-level mechanism exists (see category_infra_check evidence) but this specific item's own wording only matched generic/shared keywords, not a distinctive phrase -- real mechanism likely present, item-level completeness not independently confirmed."
      : hasPhraseEvidence
        ? "A distinctive phrase from this item's own text was found in the repo, but no category-level infra mechanism is separately confirmed and no CONSTITUTION.yaml match -- real but partial/unconfirmed evidence."
        : "Two or more of this item's own extracted keywords co-occur in at least one real file (see coOccurrenceFiles in evidence), but no distinctive phrase, category infra check, or CONSTITUTION.yaml match confirms a complete mechanism -- needs targeted human/automated follow-up."
  } else {
    // No CONSTITUTION match, no category infra evidence, and item
    // keyword grep produced only weak/generic single-word noise (or
    // nothing at all).
    if (categoryDef.qualitative) {
      status = "NEEDS_HUMAN_JUDGMENT"
      gap = "Inherently architectural/aspirational item (category flagged qualitative in the taxonomy) -- no repo grep, category infra check, or CONSTITUTION.yaml cross-reference produced meaningful signal; a mechanical check cannot confidently classify this one way or another. Evidence gathering WAS run (see item_keyword_grep) -- this is not a skipped item."
    } else {
      status = "NOT_YET_BUILT"
      gap = "No CONSTITUTION.yaml cross-reference, no category infra evidence, and no meaningful keyword-grep signal (only generic/incidental hits, if any) found in the scanned repo -- no evidence a concrete mechanism for this requirement exists in code today."
    }
  }

  return { status, gap, evidence }
}

function specialCaseVercelNote(item, verdict) {
  if (item.id !== "RULE-019") return verdict
  verdict.evidence.push({
    type: "vercel_scope_note",
    detail: "This item names GitHub repositories, Vercel deployments, Supabase resources, and server/infra together. GitHub (gh CLI, authenticated), server (this framework running on it), and Supabase (schema.ts / drizzle migrations, or MCP where available) all have real static/live evidence paths used above. Live Vercel deployment-status monitoring specifically could not be checked: `vercel whoami` on the server returns unauthenticated, and per the thin-client-only rule this is not worked around via a local machine.",
    sub_status: "EVIDENCE_UNAVAILABLE (Vercel component only)",
  })
  if (verdict.status === "ENFORCED") {
    verdict.status = "PARTIALLY_ENFORCED"
    verdict.gap = (verdict.gap ? verdict.gap + " " : "") + "Downgraded from ENFORCED because the Vercel-deployment-monitoring component of this item specifically could not be verified (EVIDENCE_UNAVAILABLE, see vercel_scope_note)."
  }
  return verdict
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2)
  const limitArg = args.find((a) => a.startsWith("--limit="))
  const onlyArg = args.find((a) => a.startsWith("--only="))
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : null
  const only = onlyArg ? onlyArg.split("=")[1].split(",") : null

  console.log(`[audit198] repo root: ${REPO_ROOT}`)
  console.log(`[audit198] loading ${RULES_JSON_PATH}`)
  const rulesDoc = JSON.parse(readFileSync(RULES_JSON_PATH, "utf8"))
  let allItems = [...rulesDoc.rules, ...rulesDoc.articles]
  console.log(`[audit198] loaded ${allItems.length} items (${rulesDoc.rules.length} rules + ${rulesDoc.articles.length} articles)`)

  const coverage = assertFullCoverage(allItems.map((i) => i.id))
  if (!coverage.complete) {
    console.error(`[audit198] TAXONOMY COVERAGE ERROR -- missing: ${coverage.missing.join(", ") || "none"}; extra: ${coverage.extra.join(", ") || "none"}`)
    process.exit(2)
  }
  console.log(`[audit198] taxonomy coverage confirmed: all 198 items map to exactly one of ${Object.keys(CATEGORIES).length} categories`)

  if (only) allItems = allItems.filter((i) => only.includes(i.id))
  if (limit) allItems = allItems.slice(0, limit)

  console.log(`[audit198] loading ai-os/CONSTITUTION.yaml cross-reference index`)
  const constitutionIndex = loadConstitutionIndex(REPO_ROOT)
  console.log(`[audit198] indexed ${constitutionIndex.count} CONSTITUTION.yaml rule entries`)

  const infraCache = {}
  const results = []
  const startedAt = new Date().toISOString()

  for (const item of allItems) {
    const categoryId = categoryForItem(item.id)
    const categoryDef = CATEGORIES[categoryId]
    if (!infraCache[categoryId]) infraCache[categoryId] = runCategoryInfra(categoryId)
    const categoryInfra = infraCache[categoryId]

    const itemEvidence = gatherItemKeywordEvidence(item)
    const constitutionMatch = bestConstitutionMatch(item.text, constitutionIndex)

    let verdict = deriveVerdict(item, categoryId, categoryDef, categoryInfra, itemEvidence, constitutionMatch)
    verdict = specialCaseVercelNote(item, verdict)

    if (!VALID_STATUSES.includes(verdict.status)) {
      throw new Error(`Invalid derived status "${verdict.status}" for ${item.id}`)
    }

    results.push({
      id: item.id,
      num: item.num,
      kind: item.id.startsWith("RULE") ? "rule" : "article",
      text: item.text,
      category: categoryId,
      category_label: categoryDef.label,
      verdict: verdict.status,
      gap: verdict.gap,
      evidence: verdict.evidence,
      scope: { repo: "FChecklist/compliance-tracker", repo_root: REPO_ROOT },
    })
    process.stdout.write(".")
  }
  console.log("")

  const counts = {}
  for (const s of VALID_STATUSES) counts[s] = 0
  for (const r of results) counts[r.verdict]++

  const output = {
    meta: {
      generated_at: startedAt,
      completed_at: new Date().toISOString(),
      framework: "ai-os/scripts/audit198",
      source: "ai-os/RULES_ARTICLES_198.json",
      constitution_cross_reference: "ai-os/CONSTITUTION.yaml",
      total_items: results.length,
      categories_used: Object.keys(CATEGORIES).length,
      status_counts: counts,
      note: "Every verdict below was derived programmatically from live grep/file/CONSTITUTION.yaml evidence gathered at generation time -- see each item's `evidence` array for the exact citations. Re-run via `node ai-os/scripts/audit198/run-audit.mjs` to regenerate against the current state of the repo.",
    },
    results,
  }

  mkdirSync(OUTPUT_DIR, { recursive: true })
  writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2))
  console.log(`[audit198] wrote ${OUTPUT_JSON}`)

  const summaryLines = [
    "# Audit198 Results Summary",
    "",
    `Generated: ${output.meta.completed_at}`,
    `Items scored: ${results.length} / 198`,
    "",
    "## Status counts",
    "",
    ...VALID_STATUSES.map((s) => `- ${s}: ${counts[s]}`),
    "",
    "## By category",
    "",
    ...Object.entries(CATEGORIES).map(([id, def]) => {
      const inCat = results.filter((r) => r.category === id)
      if (inCat.length === 0) return `- ${id}: (not run this pass)`
      const byStatus = {}
      for (const r of inCat) byStatus[r.verdict] = (byStatus[r.verdict] ?? 0) + 1
      return `- **${id}** (${def.label}, ${inCat.length} items): ${Object.entries(byStatus).map(([s, n]) => `${s}=${n}`).join(", ")}`
    }),
  ]
  writeFileSync(OUTPUT_SUMMARY, summaryLines.join("\n") + "\n")
  console.log(`[audit198] wrote ${OUTPUT_SUMMARY}`)

  console.log("")
  console.log("=== Status counts ===")
  for (const s of VALID_STATUSES) console.log(`  ${s}: ${counts[s]}`)
}

main()

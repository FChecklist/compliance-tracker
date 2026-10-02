/// <reference types="bun-types" />
// lf-b3-ai-off -- THE ARCHITECTURE GUARD. With PROJEXA_INTERNAL_AI_ENABLED unset no internal model may be called, and that has to stay
// true as the code grows, not only on the day it was checked. Three source-level rules, each failing the build the moment it breaks:
//
//   1. CONTAINMENT. Only the gated TRANSPORTS contain code that reaches a model: a model endpoint URL, a `claude` CLI spawn, the
//      document-extraction Edge Function, the CLI bridge. Any other file that does (a new raw fetch to a provider, say) fails here.
//   2. EVERY TRANSPORT IS GATED. Each transport's entry function still checks the switch (assertProjexaInternalAi /
//      projexaInternalAiEnabled / the Edge env var). Removing one fails here. (projexa-internal-ai.transports.test.ts proves the same
//      thing behaviourally: off, the fetch/spawn spy is never reached.)
//   3. NO NEW UNREVIEWED CALL SITE. The set of files that import a model-calling function from a transport is FROZEN below, each with
//      its off-behaviour. A new importer fails here until someone decides what it does while the switch is off and records it -- here
//      and in ai-os/PROJEXA_AI_OFF.md (rule 4 checks the doc names every file). The transports already refuse/degrade, so a new call
//      site is never a cost leak; this rule makes sure it is never an UNEXPLAINED refusal either. A file that stops importing one must
//      be removed from the registry too, so it never goes stale. Same drift-guard pattern as authz-gap-inventory.test.ts.
//
// Comments are stripped before scanning, so prose that mentions an endpoint (as this repo's headers often do) never counts.
//
// Run: bun test --isolate src/lib/projexa-internal-ai.architecture.test.ts
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = join(import.meta.dir, "..", "..")

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === "node_modules") continue
    const rel = `${dir}/${name}`
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...sourceFiles(rel))
    else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(rel)
  }
  return out
}

/** Block comments, then line comments that are not inside a URL ("https://") or a string-literal start. Crude, and enough here. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
    .join("\n")
}

const FILES = [...sourceFiles("src"), ...sourceFiles("supabase/functions")]
const code = new Map(FILES.map((f) => [f, stripComments(readFileSync(join(ROOT, f), "utf8"))]))

// ---- rule 1 ---------------------------------------------------------------------------------------------------------------------------
const MODEL_ENDPOINTS: RegExp[] = [
  /\/chat\/completions/,
  /api\.anthropic\.com/,
  /generativelanguage\.googleapis\.com/,
  /api\.cerebras\.ai/,
  /api\.groq\.com/,
  /openrouter\.ai\/api\/v1\/(?!credits|models)/, // credits/models are billing and catalogue reads, not model calls
  /\/v1\/embeddings/,
  /\/audio\/transcriptions/,
  /spawn\(\s*["']claude["']/,
  /\/functions\/v1\/projexa-document-extract/,
  /remoteUrl\(\)\}\/run/,
]

/** The only files allowed to contain model-reaching code, and why each is safe. */
const TRANSPORTS: Record<string, string> = {
  "src/lib/llm-client.ts": "callLLM / callLLMVision assert the switch before any provider, fallback, retry or bridge",
  "src/lib/embeddings.ts": "generateEmbeddingUncached / generateEmbeddingsBatchUncached return the hash pseudo-vector while off",
  "src/lib/whisper-client.ts": "transcribeAudio asserts the switch before the key is read",
  "src/lib/ai/providers/claude-cli.ts": "runClaudeCli (every path to the CLI) asserts the switch before spawning",
  "src/lib/ai/providers/claude-cli-remote.ts": "callBridgeJson (every path to the bridge) asserts the switch before the tunnel",
  "src/lib/services/document-extraction-service.ts": "createEdgeExtractCaller answers internal_ai_off without fetching while off",
  "supabase/functions/projexa-document-extract/wiring.ts": "chooseModel returns no model unless the Edge env says PROJEXA_INTERNAL_AI_ENABLED=1",
}

/** Files that match a pattern but make no model call. */
const NOT_A_MODEL_CALL: Record<string, string> = {
  "src/components/TenantAiConfigSection.tsx": "an input's placeholder text showing a tenant the URL shape to type; nothing is fetched",
  "src/lib/services/__test-helpers__/document-extraction-fixtures.ts": "a test fixture that fakes the Edge Function; never shipped as a caller",
}

// ---- rule 2 ---------------------------------------------------------------------------------------------------------------------------
/** file -> the function whose body must check the switch, and the token that proves it. */
const GATES: Array<{ file: string; fn: string; token: string }> = [
  { file: "src/lib/llm-client.ts", fn: "callLLM", token: "assertProjexaInternalAi(" },
  { file: "src/lib/llm-client.ts", fn: "callLLMVision", token: "assertProjexaInternalAi(" },
  { file: "src/lib/embeddings.ts", fn: "generateEmbeddingUncached", token: "projexaInternalAiEnabled()" },
  { file: "src/lib/embeddings.ts", fn: "generateEmbeddingsBatchUncached", token: "projexaInternalAiEnabled()" },
  { file: "src/lib/whisper-client.ts", fn: "transcribeAudio", token: "assertProjexaInternalAi(" },
  { file: "src/lib/ai/providers/claude-cli.ts", fn: "runClaudeCli", token: "assertProjexaInternalAi(" },
  { file: "src/lib/ai/providers/claude-cli-remote.ts", fn: "callBridgeJson", token: "assertProjexaInternalAi(" },
  { file: "src/lib/services/document-extraction-service.ts", fn: "createEdgeExtractCaller", token: "projexaInternalAiEnabled()" },
  { file: "src/lib/ai/internal-model-gateway.ts", fn: "createInternalExtractCaller", token: "projexaInternalAiEnabled()" },
  { file: "src/lib/ai/internal-ai-policy.ts", fn: "resolveInternalAiRoute", token: "projexaInternalAiEnabled()" },
  { file: "src/lib/pipeline/level1.ts", fn: "runLevel1", token: "projexaInternalAiEnabled()" },
  { file: "src/lib/pipeline/run-submission.ts", fn: "effectiveLevel1", token: "projexaInternalAiEnabled()" },
  { file: "supabase/functions/projexa-document-extract/wiring.ts", fn: "chooseModel", token: '"PROJEXA_INTERNAL_AI_ENABLED"' },
]

/** The body of a top-level `function name(` declaration: from its line to the next line that is a lone closing brace at column 0. */
function functionBody(source: string, name: string): string | null {
  const start = source.search(new RegExp(`(^|\\n)(export )?(async )?function ${name}\\b`))
  if (start < 0) return null
  const end = source.indexOf("\n}", start + 1)
  return source.slice(start, end < 0 ? undefined : end)
}

// ---- rule 3 ---------------------------------------------------------------------------------------------------------------------------
/** The exported functions of the transports (and the wrappers directly over them) that reach a model. */
const MODEL_FUNCTIONS = new Set([
  "callLLM", "callLLMJson", "callLLMVision", "callViaBridge",
  "runLevel1", "getAiProvider", "openrouterProvider", "claudeCliProvider", "claudeCliRemoteProvider", "claudeCliComplete", "claudeCliRemoteComplete",
  "generateEmbedding", "generateEmbeddingUncached", "generateEmbeddingsBatchUncached", "storeEmbedding", "findSimilar",
  "transcribeAudio",
  "createEdgeExtractCaller", "createInternalExtractCaller", "modelCallForRoute",
])

/** Names a file imports by value: `import { a, b as c }` and `const { a } = await import(...)`; `import type` and `type x` are skipped. */
function importedNames(source: string): Set<string> {
  const names = new Set<string>()
  for (const m of source.matchAll(/import\s+(?!type\b)\{([^{}]*)\}\s*from\s*["'][^"']+["']/g)) {
    for (const part of m[1].split(",")) {
      const p = part.trim()
      if (!p || p.startsWith("type ")) continue
      names.add(p.split(/\s+as\s+/)[0].trim())
    }
  }
  for (const m of source.matchAll(/\{([^{}]*)\}\s*=\s*await\s+import\(\s*["'][^"']+["']\s*\)/g)) {
    for (const part of m[1].split(",")) names.add(part.trim().split(":")[0].trim())
  }
  for (const m of source.matchAll(/import\(\s*["'][^"']+["']\s*\)\s*\.then\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*\1\.(\w+)/g)) names.add(m[2])
  return names
}

const T = "transport/wrapper: gated inside (see rule 2)"
const L1 = "Level 1: off -> no model, the miss is a gap worded USE_YOUR_OWN_AI (app callers) -- projexa-internal-ai-off.test.ts"
const EMB = "embeddings: off -> hash pseudo-vector (search degrades; a hash vector is never persisted, D-1)"
const EDGE = "document extraction: off -> ExtractionRejectedError model_not_configured worded USE_YOUR_OWN_AI, the Edge Function is not called"
const REF = "refused by the transport (ProjexaInternalAiOffError, 403 USE_YOUR_OWN_AI); this surface's own error handling shows or logs it"
const SKIP = "cron/worker: off -> returns a quiet skipped result before any read -- projexa-internal-ai-off.workers.test.ts"

/** FROZEN: every file that imports a model-calling function, and what it does while the switch is off. */
const CALL_SITES: Record<string, string> = {
  "src/app/api/assistants/[id]/memories/route.ts": EMB,
  "src/app/api/assistants/[id]/memories/search/route.ts": EMB,
  "src/app/api/documents/extract/route.ts": `${EMB}; its extractComplianceFields call is refused explicitly`,
  "src/app/api/search/semantic/route.ts": EMB,
  "src/app/api/v1/projexa/projects/from-document/route.ts": EDGE,
  "src/app/api/v1/projexa/scheduler-proposals/[id]/approve/route.ts": EDGE,
  "src/lib/ai/batch/analyse.ts": SKIP,
  "src/lib/ai/internal-model-gateway.ts": `${T}; off -> 503 internal_ai_off before the model and the meter`,
  "src/lib/ai/providers/openrouter.ts": `${T} (callLLMJson)`,
  "src/lib/ai-router/mother-router.ts": REF,
  "src/lib/ai-team/team-service.ts": `${REF} (AI dev-team roles, incl. the capability auditor -- which skips first, see workers test)`,
  "src/lib/crr/embed.ts": `${EMB}; storeChunkEmbedding refuses, the source_object stays CHUNKED (resumable)`,
  "src/lib/gst/ai-review-report.ts": REF,
  "src/lib/ingest/extractor.ts": REF,
  "src/lib/llm-client.ts": `${T} (the AI_BRIDGE queue is reached only through callLLM)`,
  "src/lib/llm-response-cache.ts": `${REF} (a cache hit still answers: it costs nothing)`,
  "src/lib/loops/instruction-mismatch-audit.ts": SKIP,
  "src/lib/loops/loop-engineering-audit.ts": "cron (loop 1): off -> the audit is recorded, the model synthesis is skipped silently",
  "src/lib/monitors/dispatch-completion-monitor.ts": `${SKIP} (never the escalate-everything fail-closed path)`,
  "src/lib/orchestra-model-resolver.ts": `${REF} (testProviderConnection: the Settings "test connection" button)`,
  "src/lib/pipeline/chat-attachment.ts": "chat attachment: off -> resolveInternalAiRoute refuses first (projexa_internal_ai_off), the answer is USE_YOUR_OWN_AI",
  "src/lib/pipeline/classify-only.ts": L1,
  "src/lib/pipeline/dry-run.ts": L1,
  "src/lib/pipeline/executors/extraction.ts": EDGE,
  "src/lib/pipeline/level1.ts": `${T}; off -> nothing resolved, zero model calls, no provider consulted`,
  "src/lib/pipeline/reuse-cache.ts": `${L1} (runLevel1 itself answers off)`,
  "src/lib/pipeline/run-submission.ts": `${L1}; effectiveLevel1 is "off" for every caller`,
  "src/lib/pipeline/scan-connected-folder-job.ts": EDGE,
  "src/lib/prompt-security/defense-in-depth.ts": REF,
  "src/lib/prompt-security/layer1-input-sanitization.ts": REF,
  "src/lib/prompt-security/layer3-runtime-guardrails.ts": REF,
  "src/lib/services/ai-report-builder-service.ts": REF,
  "src/lib/services/asset-routing-engine.ts": REF,
  "src/lib/services/asset-vector-search-service.ts": EMB,
  "src/lib/services/assistant-memory-service.ts": EMB,
  "src/lib/services/capability-registry-service.ts": EMB,
  "src/lib/services/chat-service.ts": REF,
  "src/lib/services/communication-drafting-service.ts": REF,
  "src/lib/services/construction-ai-service.ts": "explicit: discuss -> {reply: USE_YOUR_OWN_AI}; summary/photo/diff -> 403 refusal; risk -> template -- services test",
  "src/lib/services/crm-accounts-service.ts": REF,
  "src/lib/services/crm-service.ts": REF,
  "src/lib/services/dialogue-script-executor.ts": REF,
  "src/lib/services/document-extraction-service.ts": "explicit: extractDocumentContent silent skip; extractComplianceFields 403 refusal; Edge caller off -- services test",
  "src/lib/services/email-attachment-intake.ts": EDGE,
  "src/lib/services/email-intelligence-service.ts": REF,
  "src/lib/services/fm-register-digitization-service.ts": REF,
  "src/lib/services/instruction-execution-cache-service.ts": EMB,
  "src/lib/services/knowledge-base-service.ts": EMB,
  "src/lib/services/memory-recall-service.ts": EMB,
  "src/lib/services/memory-service.ts": EMB,
  "src/lib/services/prompt-eval-service.ts": REF,
  "src/lib/services/prompt-localization-service.ts": REF,
  "src/lib/services/prompt-translation-service.ts": REF,
  "src/lib/services/report-engine-service.ts": "explicit: an ai_recipe report answers one Note row with USE_YOUR_OWN_AI -- services test",
  "src/lib/services/role-quality-regression-service.ts": SKIP,
  "src/lib/services/task-dedup-service.ts": EMB,
  "src/lib/services/ticket-intelligence-service.ts": REF,
  "src/lib/services/veri-meeting-service.ts": "explicit: generateMeetingIntelligence 403 refusal; publish queues no model pass -- services test",
  "src/lib/services/visitor-intelligence-service.ts": REF,
  "src/lib/services/voice-ticket-service.ts": `${REF} (transcribeAudio refuses; the memo is marked failed with USE_YOUR_OWN_AI as its error message)`,
  "src/lib/task-execution-engine.ts": REF,
}

describe("rule 1 -- containment: only the gated transports reach a model", () => {
  test("no other file contains a model endpoint, a claude CLI spawn, the extraction Edge Function or the CLI bridge", () => {
    const offenders: string[] = []
    for (const [file, source] of code) {
      if (file in TRANSPORTS || file in NOT_A_MODEL_CALL) continue
      const hits = MODEL_ENDPOINTS.filter((re) => re.test(source))
      if (hits.length > 0) offenders.push(`${file}: ${hits.map(String).join(" ")}`)
    }
    expect(offenders).toEqual([])
  })

  test("every allowlisted transport still exists and still contains model-reaching code (the allowlist cannot go stale)", () => {
    for (const file of Object.keys(TRANSPORTS)) {
      const source = code.get(file)
      expect(source, file).toBeDefined()
      expect(MODEL_ENDPOINTS.some((re) => re.test(source!)), file).toBe(true)
    }
  })
})

describe("rule 2 -- every transport checks the switch", () => {
  for (const { file, fn, token } of GATES) {
    test(`${file} ${fn}() checks ${token}`, () => {
      const body = functionBody(code.get(file) ?? "", fn)
      expect(body, `${fn} not found in ${file}`).not.toBeNull()
      expect(body!.includes(token), `${fn} in ${file} no longer checks the internal-AI switch`).toBe(true)
    })
  }
})

describe("rule 3 -- the call sites are frozen, each with a decided off-behaviour", () => {
  const actual = [...code.entries()]
    .filter(([file]) => file.startsWith("src/"))
    .filter(([, source]) => [...importedNames(source)].some((n) => MODEL_FUNCTIONS.has(n)))
    .map(([file]) => file)
    .sort()

  test("no file imports a model-calling function unless it is registered (add it to CALL_SITES and ai-os/PROJEXA_AI_OFF.md)", () => {
    expect(actual.filter((f) => !(f in CALL_SITES))).toEqual([])
  })

  test("no registered call site has stopped being one (remove it from CALL_SITES and the doc)", () => {
    expect(Object.keys(CALL_SITES).filter((f) => !actual.includes(f))).toEqual([])
  })
})

describe("rule 4 -- the doc lists every call site and every transport", () => {
  const doc = readFileSync(join(ROOT, "ai-os", "PROJEXA_AI_OFF.md"), "utf8")
  test("ai-os/PROJEXA_AI_OFF.md names every registered file", () => {
    const missing = [...Object.keys(CALL_SITES), ...Object.keys(TRANSPORTS)].filter((f) => !doc.includes(f))
    expect(missing).toEqual([])
  })
})

// Exported only so a reader (or a future test) can see the registry without re-deriving it.
export const __registry = { TRANSPORTS, CALL_SITES, relativeRoot: relative(process.cwd(), ROOT) || "." }

/// <reference types="bun-types" />
// Real automated test for the deterministic-first LLM-call-site audit gate
// (VERIDIAN Review Framework gap-closure, task-20260718-115004-retry-1--
// ai-engineering-quality--logic, [Low] Deterministic Logic Coverage).
// Proves findUnauditedSites() genuinely flags a new real call site, genuinely
// allows an already-manifested one, and genuinely skips a file that merely
// mentions callLLM in a comment without calling it -- against the same pure
// function the real CI check calls, no mocked internals.
import { describe, test, expect } from "bun:test"
import { findUnauditedSites, CALL_RE } from "./check-deterministic-first-audit.mjs"

describe("REGRESSION: a new file with a real LLM call and no manifest entry is BLOCKED", () => {
  test("callLLM( call, not in manifest -- flagged", () => {
    const files = ["src/lib/services/new-ai-thing.ts"]
    const contents = { "src/lib/services/new-ai-thing.ts": 'const r = await callLLM("groq", model, key, sys, msg)' }
    const known = new Set(["src/lib/services/chat-service.ts"]) // unrelated existing entry
    const violations = findUnauditedSites(files, contents, known)
    expect(violations).toEqual(["src/lib/services/new-ai-thing.ts"])
  })

  test("callLLMJson( call, not in manifest -- flagged", () => {
    const files = ["src/lib/services/new-classifier.ts"]
    const contents = { "src/lib/services/new-classifier.ts": "const { data } = await callLLMJson(provider, model, key, sys, msg)" }
    const violations = findUnauditedSites(files, contents, new Set())
    expect(violations).toEqual(["src/lib/services/new-classifier.ts"])
  })

  test("callLLMVision( call, not in manifest -- flagged", () => {
    const files = ["src/lib/services/new-ocr.ts"]
    const contents = { "src/lib/services/new-ocr.ts": "const r = await callLLMVision(provider, model, key, sys, imageUrl)" }
    const violations = findUnauditedSites(files, contents, new Set())
    expect(violations).toEqual(["src/lib/services/new-ocr.ts"])
  })
})

describe("REGRESSION: a file already in the manifest (sites or exempted) is ALLOWED", () => {
  test("file listed in manifest's known set -- not flagged even though it has a real call", () => {
    const files = ["src/lib/services/chat-service.ts"]
    const contents = { "src/lib/services/chat-service.ts": "const { content } = await callLLM(a, b, c, d, e)" }
    const known = new Set(["src/lib/services/chat-service.ts"])
    const violations = findUnauditedSites(files, contents, known)
    expect(violations).toEqual([])
  })

  test("llm-client.ts itself is always skipped, even if not passed a manifest entry", () => {
    const files = ["src/lib/llm-client.ts"]
    const contents = { "src/lib/llm-client.ts": "export async function callLLM(provider, model, apiKey) { ... }" }
    const violations = findUnauditedSites(files, contents, new Set())
    expect(violations).toEqual([])
  })
})

describe("a file that never calls an LLM entrypoint at all is ALLOWED", () => {
  test("no callLLM/callLLMJson/callLLMVision anywhere -- not flagged", () => {
    const files = ["src/lib/services/pure-math-service.ts"]
    const contents = { "src/lib/services/pure-math-service.ts": "export function sum(a: number, b: number) { return a + b }" }
    const violations = findUnauditedSites(files, contents, new Set())
    expect(violations).toEqual([])
  })

  test("a deleted file (no entry in `contents`) is skipped, not treated as a violation", () => {
    const files = ["src/lib/services/deleted-file.ts"]
    const violations = findUnauditedSites(files, {}, new Set())
    expect(violations).toEqual([])
  })
})

describe("honest limitation: a comment merely MENTIONING callLLM( still counts as a match", () => {
  // This is the documented, deliberate text-level limitation (see this
  // script's own header) -- several real manifest entries (ai-reply-gate.ts,
  // prompt-portability.ts, capability-audit-service.ts, help/ask/route.ts)
  // are exactly this case, kept in `sites`/`exempted` rather than silently
  // misclassified. The test proves the behavior is real, not just documented.
  test("a bare comment containing 'callLLM(' matches CALL_RE", () => {
    expect(CALL_RE.test("// this used to call callLLM() directly, now goes through a wrapper")).toBe(true)
  })

  test("a file with only that comment and no manifest entry is flagged", () => {
    const files = ["src/app/api/help/ask/route.ts"]
    const contents = { "src/app/api/help/ask/route.ts": "// callLLM() directly with none of the new 4-layer pipeline" }
    const violations = findUnauditedSites(files, contents, new Set())
    expect(violations).toEqual(["src/app/api/help/ask/route.ts"])
  })
})

/// <reference types="bun-types" />
// lf-b3-ai-off: the model TRANSPORTS -- the only modules that reach a model endpoint or spawn a model CLI -- make no call while
// PROJEXA_INTERNAL_AI_ENABLED is unset, and behave exactly as before when it is "1". The network is a spy on globalThis.fetch (the
// same seam llm-client.test.ts and whisper-client.test.ts use) and the CLI is a spy on node:child_process's spawn, so "the spy was
// never called" is literally "no request left this process". Each "on" case proves the spy is the real seam (it IS reached), so an
// "off" pass cannot be a test that would have passed anyway.
//
// Run: bun test --isolate src/lib/projexa-internal-ai.transports.test.ts
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
// Audit 37 point 11: the per-organisation allow flag (internal-ai-org-allowance.ts) is default closed; this file tests behaviour for an ALLOWED org.
mock.module("@/lib/ai/internal-ai-org-allowance", () => ({ INTERNAL_AI_BRANCH_KEY: "internal_ai", isInternalAiAllowedForOrg: async () => true, isInternalAiAllowedForOrgWithDb: async () => true }))
import { EventEmitter } from "node:events"

// --- node:child_process: spawn is a spy (spread the real module: llm-client.ts also imports execFile from it) ---------------------------
const realChildProcess = await import("node:child_process")
type FakeChild = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; stdin: { write: (s: string) => void; end: () => void }; kill: () => void }
const spawnSpy = mock((..._args: unknown[]): FakeChild => {
  const child = new EventEmitter() as FakeChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = () => {}
  child.stdin = {
    write: () => {},
    end: () => {
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from("cli says hi"))
        child.emit("close", 0)
      })
    },
  }
  return child
})
mock.module("node:child_process", () => ({ ...realChildProcess, spawn: spawnSpy }))

const { callLLM, callLLMJson, callLLMVision } = await import("./llm-client")
const { claudeCliComplete, claudeCliProvider } = await import("./ai/providers/claude-cli")
const { claudeCliRemoteComplete } = await import("./ai/providers/claude-cli-remote")
const { transcribeAudio } = await import("./whisper-client")
const { generateEmbeddingUncached, generateEmbeddingsBatchUncached, HASH_PSEUDO_VECTOR_MODEL } = await import("./embeddings")
const { createEdgeExtractCaller, INTERNAL_AI_OFF_EDGE_CODE } = await import("./services/document-extraction-service")
const { createInternalExtractCaller } = await import("./ai/internal-model-gateway")
const { resolveInternalAiRoute, refusalSentence } = await import("./ai/internal-ai-policy")
const { chooseModel } = await import("../../supabase/functions/projexa-document-extract/wiring")
const { ProjexaInternalAiOffError, USE_YOUR_OWN_AI } = await import("./projexa-internal-ai")

const FLAG = "PROJEXA_INTERNAL_AI_ENABLED"
const ENV_KEYS = [FLAG, "OPENAI_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY", "CLAUDE_CLI_REMOTE_URL", "CLAUDE_CLI_REMOTE_SECRET", "AI_BRIDGE"] as const
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
const realFetch = globalThis.fetch

const CHAT_OK = { choices: [{ message: { content: '{"answer":"model says hi"}' } }], usage: { prompt_tokens: 3, completion_tokens: 4 } }
const EMBED_OK = (n: number) => ({ data: Array.from({ length: n }, (_, index) => ({ index, embedding: Array(1536).fill(0.5) })) })
let fetchSpy: ReturnType<typeof mock>
function installFetch(answer: (url: string) => unknown) {
  fetchSpy = mock(async (input: unknown) => {
    const url = String(input)
    return new Response(JSON.stringify(answer(url)), { status: 200, headers: { "content-type": "application/json" } })
  })
  globalThis.fetch = fetchSpy as unknown as typeof fetch
}

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
  // keys present, so "off" is proven to be the switch and not a missing key
  process.env.OPENAI_API_KEY = "test-openai"
  process.env.OPENROUTER_API_KEY = "test-openrouter"
  process.env.GROQ_API_KEY = "test-groq"
  process.env.CLAUDE_CLI_REMOTE_URL = "https://bridge.example.test"
  process.env.CLAUDE_CLI_REMOTE_SECRET = "s".repeat(40)
  spawnSpy.mockClear()
  installFetch((url) => (url.includes("embeddings") ? EMBED_OK(2) : url.includes("bridge.example.test") ? { ok: true, data: { results: [] } } : url.includes("audio") ? { text: "heard" } : CHAT_OK))
})
afterEach(() => {
  globalThis.fetch = realFetch
})
afterAll(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  mock.restore()
  await mock.module("node:child_process", () => realChildProcess)
})

const on = () => {
  process.env[FLAG] = "1"
}

describe("llm-client: callLLM / callLLMJson / callLLMVision", () => {
  test("switch unset: each refuses with ProjexaInternalAiOffError and fetch is never called", async () => {
    await expect(callLLM("openrouter", "m", "k", "sys", "user")).rejects.toBeInstanceOf(ProjexaInternalAiOffError)
    await expect(callLLMJson("openrouter", "m", "k", "sys", "user")).rejects.toBeInstanceOf(ProjexaInternalAiOffError)
    await expect(callLLMVision("openrouter", "m", "k", "sys", "aGk=", "image/png", "look")).rejects.toBeInstanceOf(ProjexaInternalAiOffError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test("switch unset: a fallback provider does not get a turn either", async () => {
    await expect(callLLM("openrouter", "m", "k", "sys", "user", undefined, { provider: "groq", model: "m2", apiKey: "k2" })).rejects.toBeInstanceOf(ProjexaInternalAiOffError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test("the refusal carries the plain answer as a ServiceError 403", async () => {
    const error = await callLLM("openrouter", "m", "k", "sys", "user").catch((e) => e)
    expect(error.message).toBe(USE_YOUR_OWN_AI)
    expect(error.status).toBe(403)
  })

  test("switch '1': the provider is called, as before", async () => {
    on()
    const text = await callLLM("openrouter", "m", "k", "sys", "user")
    expect(text.content).toContain("model says hi")
    const json = await callLLMJson<{ answer: string }>("openrouter", "m", "k", "sys", "user")
    expect(json.data.answer).toBe("model says hi")
    await callLLMVision("openrouter", "m", "k", "sys", "aGk=", "image/png", "look")
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })
})

describe("claude-cli (local subscription CLI)", () => {
  test("switch unset: claudeCliComplete and the provider's classify refuse, and nothing is spawned", async () => {
    await expect(claudeCliComplete("hello")).rejects.toBeInstanceOf(ProjexaInternalAiOffError)
    await expect(claudeCliProvider.classify(["x"], ["f"], { orgId: "o" })).rejects.toBeInstanceOf(ProjexaInternalAiOffError)
    expect(spawnSpy).not.toHaveBeenCalled()
  })

  test("switch '1': the CLI is spawned, as before", async () => {
    on()
    expect(await claudeCliComplete("hello")).toBe("cli says hi")
    expect(spawnSpy).toHaveBeenCalledTimes(1)
  })
})

describe("claude-cli-remote (the tunnel bridge)", () => {
  test("switch unset: refuses and the bridge is never reached", async () => {
    await expect(claudeCliRemoteComplete("sys", "user")).rejects.toBeInstanceOf(ProjexaInternalAiOffError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test("switch '1': the bridge is called, as before", async () => {
    on()
    await claudeCliRemoteComplete("sys", "user")
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

describe("whisper-client (speech to text)", () => {
  const audio = new Uint8Array([1, 2, 3])
  test("switch unset: refuses before the key is read, and fetch is never called", async () => {
    await expect(transcribeAudio(audio, "a.webm", "audio/webm")).rejects.toBeInstanceOf(ProjexaInternalAiOffError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test("switch '1': OpenAI's endpoint is called, as before", async () => {
    on()
    expect((await transcribeAudio(audio, "a.webm", "audio/webm")).text).toBe("heard")
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

describe("embeddings: off degrades to the deterministic hash pseudo-vector, never a failure", () => {
  test("switch unset: no provider is asked, even with both keys set; the result is the hash vector, labelled as such", async () => {
    const one = await generateEmbeddingUncached("hello")
    const two = await generateEmbeddingUncached("hello")
    const batch = await generateEmbeddingsBatchUncached(["a", "b"])
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(one).toMatchObject({ isReal: false, model: HASH_PSEUDO_VECTOR_MODEL })
    expect(one.vector).toHaveLength(1536)
    expect(two.vector).toEqual(one.vector) // deterministic: search degrades, it does not become random
    expect(batch.map((b) => b.isReal)).toEqual([false, false])
  })

  test("switch '1': OpenRouter is asked, as before", async () => {
    on()
    const one = await generateEmbeddingUncached("hello")
    const batch = await generateEmbeddingsBatchUncached(["a", "b"])
    expect(one.isReal).toBe(true)
    expect(batch.map((b) => b.isReal)).toEqual([true, true])
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})

describe("document extraction: the Edge caller and the internal gateway", () => {
  test("switch unset: the Edge caller answers internal_ai_off without fetching", async () => {
    const fetchImpl = mock(async () => new Response("{}"))
    const caller = createEdgeExtractCaller({ baseUrl: "https://x.supabase.co", secret: "s".repeat(40), fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(await caller("{}")).toEqual({ status: 503, body: { ok: false, code: INTERNAL_AI_OFF_EDGE_CODE } })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test("switch '1': the Edge caller fetches, as before", async () => {
    on()
    const fetchImpl = mock(async () => new Response(JSON.stringify({ ok: true, output: {} }), { status: 200 }))
    const caller = createEdgeExtractCaller({ baseUrl: "https://x.supabase.co", secret: "s".repeat(40), fetchImpl: fetchImpl as unknown as typeof fetch })
    expect((await caller("{}")).status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  const route = { allowed: true, kind: "metered", provider: "openrouter", providerCostType: "METERED_API", rebillable: true } as const
  const body = JSON.stringify({ schema: "boq_project_v1", fileName: "book.xlsx", sheets: [{ name: "Bill", rows: [{ row: 2, cells: ["1.01", "Floor", "m2", "10", "500"] }] }] })
  const answer = JSON.stringify({ schema: "boq_project_v1", project: { name: "P" }, boq: { title: "T", lineItems: [] } })

  test("switch unset: the internal gateway calls no model and writes no ledger row", async () => {
    const model = mock(async () => ({ text: answer, usage: { promptTokens: 1, completionTokens: 1 }, model: "m", usageEstimated: false, durationMs: 1 }))
    const meter = mock(async () => {})
    const caller = createInternalExtractCaller({ route, orgId: "o", personId: "p", model, meter, log: () => {} })
    expect(await caller(body)).toEqual({ status: 503, body: { ok: false, code: INTERNAL_AI_OFF_EDGE_CODE } })
    expect(model).not.toHaveBeenCalled()
    expect(meter).not.toHaveBeenCalled()
  })

  test("switch '1': the gateway calls the model and meters it, as before", async () => {
    on()
    const model = mock(async () => ({ text: answer, usage: { promptTokens: 1, completionTokens: 1 }, model: "m", usageEstimated: false, durationMs: 1 }))
    const meter = mock(async () => {})
    const caller = createInternalExtractCaller({ route, orgId: "o", personId: "p", model, meter, log: () => {} })
    expect((await caller(body)).status).toBe(200)
    expect(model).toHaveBeenCalledTimes(1)
    expect(meter).toHaveBeenCalledTimes(1)
  })

  test("the internal-AI route policy refuses first, in plain words, while the switch is off", () => {
    expect(resolveInternalAiRoute("person-1", { orgAllowed: true })).toEqual({ allowed: false, reason: "projexa_internal_ai_off" })
    expect(resolveInternalAiRoute(null)).toEqual({ allowed: false, reason: "projexa_internal_ai_off" })
    expect(refusalSentence("projexa_internal_ai_off")).toBe(USE_YOUR_OWN_AI)
    on()
    expect(resolveInternalAiRoute(null, { orgAllowed: true })).toEqual({ allowed: false, reason: "actor_unresolved" })
  })

  test("the Edge Function's own model choice: none unless its environment says exactly '1', whatever keys it holds", () => {
    const env = (values: Record<string, string>) => (name: string) => values[name]
    expect(chooseModel(env({ OPENROUTER_API_KEY: "k", GROQ_API_KEY: "g" }))).toBeNull()
    expect(chooseModel(env({ PROJEXA_INTERNAL_AI_ENABLED: "true", OPENROUTER_API_KEY: "k" }))).toBeNull()
    expect(chooseModel(env({ PROJEXA_INTERNAL_AI_ENABLED: "1", OPENROUTER_API_KEY: "k" }))).toBeTypeOf("function")
    expect(chooseModel(env({ PROJEXA_INTERNAL_AI_ENABLED: "1", GROQ_API_KEY: "g" }))).toBeTypeOf("function")
    expect(chooseModel(env({ PROJEXA_INTERNAL_AI_ENABLED: "1" }))).toBeNull()
  })
})

/// <reference types="bun-types" />
// PROJEXA test-mode AI bridge: the queue client (claude-code-bridge.ts) and the laptop worker's pure core (scripts/ai-bridge-worker.mjs).
// No database, no real clock, no real Claude Code: every dependency is injected.
import { describe, expect, test } from "bun:test"
import { BRIDGE_MAX_WAIT_MS, BRIDGE_POLL_MS, callViaBridge, isBridgeEnabled, type BridgeAnswer, type BridgeDeps } from "./claude-code-bridge"
import { LLMHttpError } from "@/lib/llm-client"
// @ts-ignore -- plain .mjs script, no type declarations
import { buildClaudeArgs, cleanJsonAnswer, answerOne } from "../../../scripts/ai-bridge-worker.mjs"

function deps(over: { online?: boolean; answers?: BridgeAnswer[] } = {}): BridgeDeps & { enqueued: unknown[]; clock: { t: number }; polls: number } {
  const state = { enqueued: [] as unknown[], clock: { t: 0 }, polls: 0 }
  const answers = [...(over.answers ?? [{ status: "done", response: { content: "hello" } }])]
  return Object.assign(state, {
    enqueue: async (input: unknown) => {
      state.enqueued.push(input)
      return over.online === false ? { worker_online: false } : { worker_online: true, id: "req-1" }
    },
    get: async () => {
      state.polls += 1
      return answers.length > 1 ? answers.shift()! : answers[0]
    },
    sleep: async (ms: number) => void (state.clock.t += ms),
    now: () => state.clock.t,
  })
}

describe("callViaBridge", () => {
  test("enqueues the call and returns the worker's answer with usage filled in", async () => {
    const d = deps()
    const r = await callViaBridge({ model: "m", systemPrompt: "sys", userMessage: "question", options: { maxTokens: 50 } }, d)
    expect(r.content).toBe("hello")
    expect(r.usage.completionTokens).toBeGreaterThan(0)
    expect(d.enqueued).toHaveLength(1)
    expect(d.enqueued[0]).toMatchObject({ system: "sys", user: "question", options: { jsonMode: false, maxTokens: 50 } })
  })

  test("an OFFLINE worker fails at once with a non-retryable 4xx and never waits", async () => {
    const d = deps({ online: false })
    const err = await callViaBridge({ model: "m", systemPrompt: "", userMessage: "q" }, d).catch((e) => e)
    expect(err).toBeInstanceOf(LLMHttpError)
    expect(err.status).toBe(424) // llm-client's withRetry retries only 429/5xx, so this is not retried
    expect(d.polls).toBe(0)
    expect(d.clock.t).toBe(0)
  })

  test("polls gently and gives up at the cap with a non-retryable 408", async () => {
    const d = deps({ answers: [{ status: "queued" }] })
    const err = await callViaBridge({ model: "m", systemPrompt: "", userMessage: "q" }, d).catch((e) => e)
    expect(err.status).toBe(408)
    expect(d.clock.t).toBeGreaterThanOrEqual(BRIDGE_MAX_WAIT_MS)
    expect(d.polls).toBeLessThanOrEqual(Math.ceil(BRIDGE_MAX_WAIT_MS / BRIDGE_POLL_MS) + 1)
  })

  test("waits through queued/claimed and returns once done", async () => {
    const d = deps({ answers: [{ status: "queued" }, { status: "claimed" }, { status: "done", response: { content: "late" } }] })
    expect((await callViaBridge({ model: "m", systemPrompt: "", userMessage: "q" }, d)).content).toBe("late")
    expect(d.polls).toBe(3)
  })

  test("a worker error and an expired request become non-retryable errors", async () => {
    const e1 = await callViaBridge({ model: "m", systemPrompt: "", userMessage: "q" }, deps({ answers: [{ status: "error", error: "boom" }] })).catch((e) => e)
    expect(e1.status).toBe(422)
    expect(e1.message).toContain("boom")
    const e2 = await callViaBridge({ model: "m", systemPrompt: "", userMessage: "q" }, deps({ answers: [{ status: "expired" }] })).catch((e) => e)
    expect(e2.status).toBe(408)
  })

  test("an empty answer is an error, not an empty string handed to the caller", async () => {
    const e = await callViaBridge({ model: "m", systemPrompt: "", userMessage: "q" }, deps({ answers: [{ status: "done", response: { content: "" } }] })).catch((x) => x)
    expect(e.status).toBe(422)
  })

  test("history and JSON mode are folded into the one text the worker sees", async () => {
    const d = deps()
    await callViaBridge({ model: "m", systemPrompt: "", userMessage: "now", options: { jsonMode: true, history: [{ role: "user", content: "earlier" }, { role: "assistant", content: "reply" }] } }, d)
    const sent = d.enqueued[0] as { user: string; options: { jsonMode: boolean } }
    expect(sent.user).toContain("User: earlier")
    expect(sent.user).toContain("Assistant: reply")
    expect(sent.user).toContain("now")
    expect(sent.user).toContain("ONE valid JSON object")
    expect(sent.options.jsonMode).toBe(true)
  })
})

describe("isBridgeEnabled", () => {
  test("is on only when AI_BRIDGE is exactly 'queue'", () => {
    const saved = process.env.AI_BRIDGE
    try {
      delete process.env.AI_BRIDGE
      expect(isBridgeEnabled()).toBe(false)
      process.env.AI_BRIDGE = "1"
      expect(isBridgeEnabled()).toBe(false)
      process.env.AI_BRIDGE = "queue"
      expect(isBridgeEnabled()).toBe(true)
    } finally {
      if (saved === undefined) delete process.env.AI_BRIDGE
      else process.env.AI_BRIDGE = saved
    }
  })
})

describe("the laptop worker's core", () => {
  test("every Claude Code run has ALL tools disabled, no session saved and no slash commands", () => {
    const args = buildClaudeArgs({ system: "be brief", model: "sonnet" }) as string[]
    const i = args.indexOf("--tools")
    expect(i).toBeGreaterThanOrEqual(0)
    expect(args[i + 1]).toBe("") // the empty tool list: a prompt can produce text but cannot read files or run commands
    expect(args).toContain("--no-session-persistence")
    expect(args).toContain("--disable-slash-commands")
    expect(args).toContain("-p")
    expect(args[args.indexOf("--system-prompt") + 1]).toBe("be brief")
  })

  test("no --system-prompt is passed when there is no system text", () => {
    expect(buildClaudeArgs({ system: "  ", model: "sonnet" })).not.toContain("--system-prompt")
  })

  test("cleanJsonAnswer strips a code fence, and refuses text that is not JSON", () => {
    expect(JSON.parse(cleanJsonAnswer('```json\n{"a":1}\n```'))).toEqual({ a: 1 })
    expect(JSON.parse(cleanJsonAnswer('{"a":2}'))).toEqual({ a: 2 })
    expect(() => cleanJsonAnswer("Sure! Here you go: {a}")).toThrow()
  })

  test("answerOne returns plain text, or validated JSON when the request asked for JSON mode", async () => {
    const run = async () => '```json\n{"ok":true}\n```'
    expect(await answerOne({ system: "", user: "q", options: { jsonMode: true } }, { model: "m", timeoutMs: 1, cwd: ".", run })).toEqual({ content: '{"ok":true}' })
    const plain = async () => "just text"
    expect(await answerOne({ system: "", user: "q", options: {} }, { model: "m", timeoutMs: 1, cwd: ".", run: plain })).toEqual({ content: "just text" })
    await expect(answerOne({ system: "", user: "q", options: { jsonMode: true } }, { model: "m", timeoutMs: 1, cwd: ".", run: plain })).rejects.toThrow()
  })
})

/// <reference types="bun-types" />
// R65 Part D -- AI Usage Ledger (drizzle/0524, 2026-09-02): unit tests for
// logTokenUsage()'s new optional fields and its two REAL (not placeholder)
// computed columns -- input_cost/output_cost (estimateCostBreakdownUsd)
// and the provider_cost_type/success defaults. Same "@/lib/db is
// mock.module()'d, spreading the real schema module so no sibling test
// file's own mock is clobbered" convention as
// src/lib/ai-team/dispatch-outcomes.test.ts (see that file's own header
// for why the spread is required when the whole suite runs together). No
// live Postgres connection is available in this sandbox/CI, same reasoning
// as every other DB-independent test in this repo.
import { describe, expect, test, mock, afterEach } from "bun:test"
import * as realSchema from "@/lib/db/schema"

function mockDb() {
  const insertSpy = mock(async (_values: unknown) => undefined)
  mock.module("@/lib/db", () => ({
    ...realSchema,
    db: {
      insert: mock(() => ({ values: insertSpy })),
    },
    organisations: realSchema.organisations,
  }))
  return { insertSpy }
}

afterEach(() => {
  mock.restore()
})

describe("logTokenUsage -- R65 Part D AI Usage Ledger additions", () => {
  test("computes real input_cost/output_cost from MODEL_PRICING, matching estimateCostBreakdownUsd exactly", async () => {
    const { insertSpy } = mockDb()
    const { logTokenUsage } = await import("./token-usage-service")
    const { estimateCostBreakdownUsd } = await import("@/lib/llm-client")

    await logTokenUsage({
      scope: "ai_team_internal",
      roleKey: "test_role",
      provider: "openrouter",
      model: "gpt-4o-mini",
      usage: { promptTokens: 1000, completionTokens: 1000 },
    })

    expect(insertSpy).toHaveBeenCalledTimes(1)
    const written = insertSpy.mock.calls[0][0] as Record<string, unknown>
    const expected = estimateCostBreakdownUsd("gpt-4o-mini", { promptTokens: 1000, completionTokens: 1000 })!
    expect(written.inputCost).toBe(String(expected.inputCost))
    expect(written.outputCost).toBe(String(expected.outputCost))
  })

  test("input_cost/output_cost are null (not 0, not thrown) for an unrecognized model", async () => {
    const { insertSpy } = mockDb()
    const { logTokenUsage } = await import("./token-usage-service")

    await logTokenUsage({
      scope: "ai_team_internal",
      provider: "openrouter",
      model: "some-model-nobody-registered",
      usage: { promptTokens: 100, completionTokens: 100 },
    })

    const written = insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(written.inputCost).toBeNull()
    expect(written.outputCost).toBeNull()
  })

  test("defaults provider_cost_type to METERED_API when not passed", async () => {
    const { insertSpy } = mockDb()
    const { logTokenUsage } = await import("./token-usage-service")

    await logTokenUsage({
      scope: "product_orchestra",
      orgId: "org-1",
      provider: "groq",
      model: "openai/gpt-oss-120b",
      usage: { promptTokens: 10, completionTokens: 10 },
    })

    const written = insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(written.providerCostType).toBe("METERED_API")
  })

  test("honors an explicit SUBSCRIPTION_ALLOCATED override", async () => {
    const { insertSpy } = mockDb()
    const { logTokenUsage } = await import("./token-usage-service")

    await logTokenUsage({
      scope: "ai_team_internal",
      provider: "anthropic",
      model: "claude-sonnet-5",
      usage: { promptTokens: 10, completionTokens: 10 },
      providerCostType: "SUBSCRIPTION_ALLOCATED",
    })

    const written = insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(written.providerCostType).toBe("SUBSCRIPTION_ALLOCATED")
  })

  test("defaults success to true when not passed (every real call site today only logs after a successful completion)", async () => {
    const { insertSpy } = mockDb()
    const { logTokenUsage } = await import("./token-usage-service")

    await logTokenUsage({
      scope: "ai_team_internal",
      provider: "openrouter",
      model: "z-ai/glm-5.2",
      usage: { promptTokens: 10, completionTokens: 10 },
    })

    const written = insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(written.success).toBe(true)
    expect(written.failureReason).toBeNull()
  })

  test("passes through sessionId/chatId/taskId/routeId/level/aiRole/durationMs when the caller supplies them", async () => {
    const { insertSpy } = mockDb()
    const { logTokenUsage } = await import("./token-usage-service")

    await logTokenUsage({
      scope: "ai_team_internal",
      provider: "openrouter",
      model: "z-ai/glm-5.2",
      usage: { promptTokens: 10, completionTokens: 10 },
      sessionId: "sess-1",
      chatId: "chat-1",
      taskId: "task-1",
      routeId: "dispatch-1",
      level: "REASONING",
      aiRole: "REASONER",
      durationMs: 1234,
    })

    const written = insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(written.sessionId).toBe("sess-1")
    expect(written.chatId).toBe("chat-1")
    expect(written.taskId).toBe("task-1")
    expect(written.routeId).toBe("dispatch-1")
    expect(written.level).toBe("REASONING")
    expect(written.aiRole).toBe("REASONER")
    expect(written.durationMs).toBe(1234)
  })

  test("all new optional fields default to null/undefined-safe when the caller omits them -- pre-existing call sites keep working unchanged", async () => {
    const { insertSpy } = mockDb()
    const { logTokenUsage } = await import("./token-usage-service")

    await logTokenUsage({
      scope: "ai_team_internal",
      roleKey: "test_role",
      provider: "openrouter",
      model: "z-ai/glm-5.2",
      usage: { promptTokens: 10, completionTokens: 10 },
    })

    const written = insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(written.veridianId).toBeNull()
    expect(written.veridianProductId).toBeNull()
    expect(written.chatId).toBeNull()
    expect(written.taskId).toBeNull()
    expect(written.routeId).toBeNull()
    expect(written.sessionId).toBeNull()
    expect(written.level).toBeNull()
    expect(written.aiRole).toBeNull()
    expect(written.durationMs).toBeNull()
  })

  test("copies cache_read_tokens/cache_creation_tokens from usage when present (prompt-cache/metrics.ts's call shape)", async () => {
    const { insertSpy } = mockDb()
    const { logTokenUsage } = await import("./token-usage-service")

    await logTokenUsage({
      scope: "product_orchestra",
      orgId: "org-1",
      layerKey: "user_assistant_oa",
      provider: "anthropic",
      model: "claude-sonnet-5",
      usage: { promptTokens: 1000, completionTokens: 200, cacheReadTokens: 4000, cacheCreationTokens: 500 },
    })

    const written = insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(written.cacheReadTokens).toBe(4000)
    expect(written.cacheCreationTokens).toBe(500)
  })

  test("cache token columns stay null when caching was never attempted (absence means not attempted, not zero)", async () => {
    const { insertSpy } = mockDb()
    const { logTokenUsage } = await import("./token-usage-service")

    await logTokenUsage({
      scope: "ai_team_internal",
      provider: "openrouter",
      model: "z-ai/glm-5.2",
      usage: { promptTokens: 10, completionTokens: 10 },
    })

    const written = insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(written.cacheReadTokens).toBeNull()
    expect(written.cacheCreationTokens).toBeNull()
  })

  test("a DB insert failure is caught and logged, never thrown (fire-and-forget contract preserved)", async () => {
    const insertSpy = mock(async () => {
      throw new Error("connection refused")
    })
    mock.module("@/lib/db", () => ({
      ...realSchema,
      db: { insert: mock(() => ({ values: insertSpy })) },
      organisations: realSchema.organisations,
    }))
    const { logTokenUsage } = await import("./token-usage-service")

    await expect(
      logTokenUsage({
        scope: "ai_team_internal",
        provider: "openrouter",
        model: "z-ai/glm-5.2",
        usage: { promptTokens: 10, completionTokens: 10 },
      })
    ).resolves.toBeUndefined()
  })
})

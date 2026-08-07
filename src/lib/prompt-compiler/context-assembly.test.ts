/// <reference types="bun-types" />
// VERIDIAN_Architecture_v2.0 phase_2: pipeline-context-assembly pure unit
// tests (port of context_engine.py + the new business/user context merge).
import { describe, expect, test } from "bun:test"
import { assembleContext, computeRelevance, hydrateTemplate, pruneContext } from "./context-assembly"
import type { ContextMessage } from "./types"

describe("computeRelevance (port of context_engine.py's RelevanceScorer)", () => {
  test("a message sharing keywords with the query scores higher than an unrelated one", () => {
    const related = computeRelevance("fix the authentication bug in login", "authentication login error", 0, 2)
    const unrelated = computeRelevance("what is the weather today", "authentication login error", 0, 2)
    expect(related).toBeGreaterThan(unrelated)
  })

  test("more recent messages score at least as high as older ones, all else equal", () => {
    const older = computeRelevance("some unrelated content here", "totally different query", 0, 5)
    const newer = computeRelevance("some unrelated content here", "totally different query", 4, 5)
    expect(newer).toBeGreaterThanOrEqual(older)
  })

  test("a single message (total=1) always gets full recency", () => {
    const score = computeRelevance("anything", "", 0, 1)
    expect(score).toBe(1.0)
  })
})

describe("pruneContext (port of context_engine.py's ContextWindow.prune())", () => {
  function msg(content: string, i: number): ContextMessage {
    return { role: "user", content, id: `m${i}` }
  }

  test("never prunes below minMessages even when everything scores low", () => {
    const messages = Array.from({ length: 10 }, (_, i) => msg(`irrelevant filler content number ${i}`, i))
    const { messages: pruned, stats } = pruneContext(messages, "completely unrelated topic zzz", { minMessages: 3 })
    expect(pruned.length).toBeGreaterThanOrEqual(3)
    expect(stats.messagesAfter).toBe(pruned.length)
  })

  test("keeps highly relevant messages over irrelevant ones when pruning by relevance", () => {
    const messages = [
      msg("discuss the quarterly picnic plans", 0),
      msg("fix the authentication login bug", 1),
      msg("random unrelated chatter about lunch", 2),
      msg("more login authentication debugging details", 3),
    ]
    const { messages: pruned } = pruneContext(messages, "authentication login bug", { minMessages: 1, pruneThreshold: 0.3 })
    expect(pruned.some((m) => m.content.includes("authentication"))).toBe(true)
  })

  test("empty input returns empty output with zeroed stats", () => {
    const { messages: pruned, stats } = pruneContext([], "query")
    expect(pruned).toEqual([])
    expect(stats.messagesBefore).toBe(0)
  })
})

describe("hydrateTemplate", () => {
  test("substitutes a known {{token}}", () => {
    expect(hydrateTemplate("Hello {{userName}}", { userName: "Alex" })).toBe("Hello Alex")
  })

  test("leaves an unresolved token intact", () => {
    expect(hydrateTemplate("Hello {{unknownVar}}", {})).toBe("Hello {{unknownVar}}")
  })
})

describe("assembleContext", () => {
  test("merges business/user context into hydratedTemplate variables", () => {
    const result = assembleContext({
      business: { orgId: "org1", orgName: "Acme Corp", country: "IN" },
      user: { userId: "u1", displayName: "Alex", roles: ["veridian_admin"] },
      sessionMessages: [],
      currentQuery: "hello",
      template: "Welcome {{userName}} from {{orgName}} ({{country}})",
    })
    expect(result.hydratedTemplate).toBe("Welcome Alex from Acme Corp (IN)")
  })

  test("hydratedTemplate is null when no template is given", () => {
    const result = assembleContext({
      business: { orgId: null, orgName: null, country: null },
      user: { userId: "u1", displayName: null, roles: [] },
      sessionMessages: [],
      currentQuery: "hello",
    })
    expect(result.hydratedTemplate).toBeNull()
  })
})

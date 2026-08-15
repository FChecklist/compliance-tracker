/// <reference types="bun-types" />
// VERIDIAN_Architecture_v2.0 phase_2: engine-prompt-ranking +
// engine-prompt-recommendation pure unit tests.
import { describe, expect, test } from "bun:test"
import { rankPromptVersions, recommendRelatedTemplates } from "./prompt-ranking-recommendation"

const NOW = new Date("2026-07-25T00:00:00Z")

describe("rankPromptVersions", () => {
  test("a version with higher quality, lower cost, lower latency, and fresher creation ranks first", () => {
    const ranked = rankPromptVersions(
      [
        { promptVersionId: "good", passRate: 0.95, avgCostUsd: 0.01, avgLatencyMs: 200, createdAt: NOW },
        { promptVersionId: "bad", passRate: 0.4, avgCostUsd: 0.4, avgLatencyMs: 9000, createdAt: new Date("2025-01-01T00:00:00Z") },
      ],
      NOW
    )
    expect(ranked[0].promptVersionId).toBe("good")
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
  })

  test("unknown cost/latency (null) score neutrally, not punitively", () => {
    const ranked = rankPromptVersions([{ promptVersionId: "v1", passRate: 0.9, avgCostUsd: null, avgLatencyMs: null, createdAt: NOW }], NOW)
    expect(ranked[0].breakdown.cost).toBe(0.5)
    expect(ranked[0].breakdown.latency).toBe(0.5)
  })

  test("older versions have a lower freshness score than newer ones", () => {
    const ranked = rankPromptVersions(
      [
        { promptVersionId: "old", passRate: 0.9, avgCostUsd: 0.01, avgLatencyMs: 100, createdAt: new Date("2025-01-01T00:00:00Z") },
        { promptVersionId: "new", passRate: 0.9, avgCostUsd: 0.01, avgLatencyMs: 100, createdAt: NOW },
      ],
      NOW
    )
    const old = ranked.find((r) => r.promptVersionId === "old")!
    const fresh = ranked.find((r) => r.promptVersionId === "new")!
    expect(fresh.breakdown.freshness).toBeGreaterThan(old.breakdown.freshness)
  })
})

describe("recommendRelatedTemplates", () => {
  test("recommends a semantically similar template", () => {
    const recs = recommendRelatedTemplates("chat.system", [], [{ templateKey: "chat.followup", similarityScore: 0.9 }])
    expect(recs.some((r) => r.templateKey === "chat.followup")).toBe(true)
  })

  test("excludes the current template from its own recommendations", () => {
    const recs = recommendRelatedTemplates("chat.system", [], [{ templateKey: "chat.system", similarityScore: 0.99 }])
    expect(recs.length).toBe(0)
  })

  test("does not recommend a frequently-used template with a poor pass rate", () => {
    const recs = recommendRelatedTemplates("chat.system", [{ templateKey: "chat.broken", runCount: 100, passRate: 0.2 }], [])
    expect(recs.length).toBe(0)
  })

  test("recommends a genuinely popular, well-performing template", () => {
    const recs = recommendRelatedTemplates(
      "chat.system",
      [
        { templateKey: "chat.followup", runCount: 50, passRate: 0.95 },
        { templateKey: "chat.rare", runCount: 1, passRate: 1.0 },
      ],
      []
    )
    expect(recs.some((r) => r.templateKey === "chat.followup")).toBe(true)
    expect(recs.some((r) => r.templateKey === "chat.rare")).toBe(false)
  })

  test("merges a template recommended by both similarity and usage into one entry", () => {
    const recs = recommendRelatedTemplates(
      "chat.system",
      [{ templateKey: "chat.followup", runCount: 50, passRate: 0.95 }],
      [{ templateKey: "chat.followup", similarityScore: 0.9 }]
    )
    expect(recs.filter((r) => r.templateKey === "chat.followup").length).toBe(1)
  })
})

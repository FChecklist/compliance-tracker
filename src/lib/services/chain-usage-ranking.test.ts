/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { computePathUsageScores, rankNodesByUsage, applyUsageRanking, USAGE_HALF_LIFE_DAYS, type ChainUsageEvent } from "./chain-usage-ranking"
import type { CapabilityNode } from "./capability-tree-service"

function node(key: string, extra: Partial<CapabilityNode> = {}): CapabilityNode {
  return { key, label: key, leaf: false, ...extra }
}

function daysAgo(days: number, from = new Date("2026-07-11T00:00:00Z")): Date {
  return new Date(from.getTime() - days * 86_400_000)
}

describe("computePathUsageScores", () => {
  test("empty event list produces an empty score map", () => {
    expect(computePathUsageScores([]).size).toBe(0)
  })

  test("a single event credits every prefix of its path, not just the leaf", () => {
    const now = new Date("2026-07-11T00:00:00Z")
    const scores = computePathUsageScores([{ pathKeys: ["compliance", "gst_return", "file"], createdAt: now }], now)
    expect(scores.get(JSON.stringify(["compliance"]))).toBeCloseTo(1, 5)
    expect(scores.get(JSON.stringify(["compliance", "gst_return"]))).toBeCloseTo(1, 5)
    expect(scores.get(JSON.stringify(["compliance", "gst_return", "file"]))).toBeCloseTo(1, 5)
  })

  test("events with an empty or non-array pathKeys are ignored, not crashed on", () => {
    const now = new Date("2026-07-11T00:00:00Z")
    const events: ChainUsageEvent[] = [
      { pathKeys: [], createdAt: now },
      { pathKeys: undefined as unknown as unknown[], createdAt: now },
    ]
    expect(computePathUsageScores(events).size).toBe(0)
  })

  test("repeated usage of the same path accumulates score", () => {
    const now = new Date("2026-07-11T00:00:00Z")
    const events: ChainUsageEvent[] = [
      { pathKeys: ["sales", "lead"], createdAt: now },
      { pathKeys: ["sales", "lead"], createdAt: now },
      { pathKeys: ["sales", "lead"], createdAt: now },
    ]
    const scores = computePathUsageScores(events, now)
    expect(scores.get(JSON.stringify(["sales", "lead"]))).toBeCloseTo(3, 5)
  })

  test("older usage decays toward zero at the documented half-life, more recent usage stays close to full weight", () => {
    const now = new Date("2026-07-11T00:00:00Z")
    const events: ChainUsageEvent[] = [
      { pathKeys: ["finance"], createdAt: daysAgo(USAGE_HALF_LIFE_DAYS, now) }, // exactly one half-life old
      { pathKeys: ["hr"], createdAt: daysAgo(1, now) }, // one day old
    ]
    const scores = computePathUsageScores(events, now)
    const financeScore = scores.get(JSON.stringify(["finance"]))!
    const hrScore = scores.get(JSON.stringify(["hr"]))!
    expect(financeScore).toBeCloseTo(0.5, 2)
    expect(hrScore).toBeGreaterThan(0.9)
    expect(hrScore).toBeGreaterThan(financeScore)
  })

  test("different parents with an identically-named child never collide", () => {
    const now = new Date("2026-07-11T00:00:00Z")
    const events: ChainUsageEvent[] = [
      { pathKeys: ["gst_return", "file"], createdAt: now },
      { pathKeys: ["tds_return", "file"], createdAt: now },
    ]
    const scores = computePathUsageScores(events, now)
    expect(scores.get(JSON.stringify(["gst_return", "file"]))).toBeCloseTo(1, 5)
    expect(scores.get(JSON.stringify(["tds_return", "file"]))).toBeCloseTo(1, 5)
  })
})

describe("rankNodesByUsage", () => {
  test("with an empty score map, returns the exact same array reference (documented fast no-op)", () => {
    const nodes = [node("a"), node("b")]
    expect(rankNodesByUsage(nodes, [], new Map())).toBe(nodes)
  })

  test("sorts higher-scored nodes first", () => {
    const nodes = [node("a"), node("b"), node("c")]
    const scores = new Map([
      [JSON.stringify(["a"]), 1],
      [JSON.stringify(["b"]), 5],
      [JSON.stringify(["c"]), 2],
    ])
    const ranked = rankNodesByUsage(nodes, [], scores)
    expect(ranked.map((n) => n.key)).toEqual(["b", "c", "a"])
  })

  test("nodes with equal (including zero) score preserve their original relative order", () => {
    const nodes = [node("first"), node("second"), node("third")]
    const scores = new Map([[JSON.stringify(["second"]), 3]])
    const ranked = rankNodesByUsage(nodes, [], scores)
    // second jumps to the front; first/third (both score 0) keep their relative order
    expect(ranked.map((n) => n.key)).toEqual(["second", "first", "third"])
  })

  test("scoring is scoped by parentPath, so a key match at the wrong depth doesn't apply", () => {
    const nodes = [node("file"), node("other")]
    const scores = new Map([[JSON.stringify(["different_parent", "file"]), 99]])
    const ranked = rankNodesByUsage(nodes, ["actual_parent"], scores)
    expect(ranked.map((n) => n.key)).toEqual(["file", "other"]) // no match at this parentPath -> falls back to stable original order
  })
})

describe("applyUsageRanking", () => {
  test("with no usage data, returns the exact same tree reference untouched", () => {
    const tree = [node("a", { children: [node("a1"), node("a2")] })]
    expect(applyUsageRanking(tree, new Map())).toBe(tree)
  })

  test("re-orders both the top level and nested children by their own scoped scores", () => {
    const tree: CapabilityNode[] = [
      node("sales", { children: [node("lead"), node("deal")] }),
      node("hr", { children: [node("onboarding"), node("payroll")] }),
    ]
    const scores = new Map([
      [JSON.stringify(["hr"]), 10], // hr outranks sales at the top level
      [JSON.stringify(["sales"]), 1],
      [JSON.stringify(["hr", "payroll"]), 5], // within hr, payroll outranks onboarding
    ])
    const ranked = applyUsageRanking(tree, scores)
    expect(ranked.map((n) => n.key)).toEqual(["hr", "sales"])
    const hrNode = ranked.find((n) => n.key === "hr")!
    expect(hrNode.children!.map((n) => n.key)).toEqual(["payroll", "onboarding"])
  })

  test("leaf nodes (no children) are left structurally alone besides reordering at their own level", () => {
    const tree: CapabilityNode[] = [node("x", { leaf: true }), node("y", { leaf: true })]
    const scores = new Map([[JSON.stringify(["y"]), 1]])
    const ranked = applyUsageRanking(tree, scores)
    expect(ranked.map((n) => n.key)).toEqual(["y", "x"])
    expect(ranked[0].leaf).toBe(true)
  })
})

/// <reference types="bun-types" />
// VERIDIAN Review Framework remediation (AI Model Routing gap, 2026-07-18):
// detectMissedEscalations() is the pure decision function this loop's
// missed-escalation sample is built on -- see byo-model-audit.ts's own
// header comment for the full reasoning. Tested directly here rather than
// through the DB-touching runByoModelAudit(), matching this codebase's
// established split (e.g. ai-performance-report-service.ts's
// computeFailureRate/averageNumericColumn tests).
import { describe, expect, test } from "bun:test"
import { detectMissedEscalations, type ChatReplyRow } from "./byo-model-audit"

function row(overrides: Partial<ChatReplyRow> & Pick<ChatReplyRow, "id">): ChatReplyRow {
  return { orgId: "org-1", conversationId: "conv-1", escalated: false, signals: [], ...overrides }
}

describe("detectMissedEscalations", () => {
  test("empty input -> no pairs, nothing missed", () => {
    expect(detectMissedEscalations([])).toEqual({ eligiblePairs: 0, missed: [] })
  })

  test("a single reply with no follow-up is not an eligible pair", () => {
    const result = detectMissedEscalations([row({ id: "r1" })])
    expect(result.eligiblePairs).toBe(0)
    expect(result.missed).toEqual([])
  })

  test("non-escalated reply followed by a reask_correction in the SAME conversation is flagged missed", () => {
    const result = detectMissedEscalations([
      row({ id: "r1" }),
      row({ id: "r2", signals: ["reask_correction"] }),
    ])
    expect(result.eligiblePairs).toBe(1)
    expect(result.missed).toEqual([{ id: "r1", orgId: "org-1", conversationId: "conv-1", nextReplySignals: ["reask_correction"] }])
  })

  test("already-escalated replies are never flagged, even with a correction next -- not a miss, it already escalated", () => {
    const result = detectMissedEscalations([
      row({ id: "r1", escalated: true }),
      row({ id: "r2", signals: ["reask_correction"] }),
    ])
    expect(result.eligiblePairs).toBe(0)
    expect(result.missed).toEqual([])
  })

  test("a correction in a DIFFERENT conversation never pairs across the boundary", () => {
    const result = detectMissedEscalations([
      row({ id: "r1", conversationId: "conv-1" }),
      row({ id: "r2", conversationId: "conv-2", signals: ["reask_correction"] }),
    ])
    expect(result.eligiblePairs).toBe(0)
    expect(result.missed).toEqual([])
  })

  test("null conversationId never pairs (can't prove adjacency)", () => {
    const result = detectMissedEscalations([
      row({ id: "r1", conversationId: null }),
      row({ id: "r2", conversationId: null, signals: ["reask_correction"] }),
    ])
    expect(result.eligiblePairs).toBe(0)
    expect(result.missed).toEqual([])
  })

  test("a non-escalated reply followed by a reply with OTHER signals (not reask_correction) is eligible but not missed", () => {
    const result = detectMissedEscalations([
      row({ id: "r1" }),
      row({ id: "r2", signals: ["low_confidence"] }),
    ])
    expect(result.eligiblePairs).toBe(1)
    expect(result.missed).toEqual([])
  })

  test("BYO orgs never flag: signals are always [] on both sides, so the pair is eligible but can never match", () => {
    const result = detectMissedEscalations([
      row({ id: "r1", orgId: "byo-org", signals: [] }),
      row({ id: "r2", orgId: "byo-org", signals: [] }),
    ])
    expect(result.eligiblePairs).toBe(1)
    expect(result.missed).toEqual([])
  })

  test("a longer conversation only pairs ADJACENT rows -- each row is both a 'current' and a 'next' exactly once", () => {
    const result = detectMissedEscalations([
      row({ id: "r1" }),                                  // (r1, r2) pair: eligible, r2 has no signals -> not missed
      row({ id: "r2", signals: [] }),                      // (r2, r3) pair: eligible, r3 has reask_correction -> missed
      row({ id: "r3", signals: ["reask_correction"] }),
    ])
    expect(result.eligiblePairs).toBe(2)
    expect(result.missed.map((m) => m.id)).toEqual(["r2"])
  })

  test("multiple independent conversations are scored independently", () => {
    const result = detectMissedEscalations([
      row({ id: "a1", conversationId: "conv-a" }),
      row({ id: "a2", conversationId: "conv-a", signals: ["reask_correction"] }),
      row({ id: "b1", conversationId: "conv-b" }),
      row({ id: "b2", conversationId: "conv-b", signals: [] }),
    ])
    expect(result.eligiblePairs).toBe(2)
    expect(result.missed.map((m) => m.id)).toEqual(["a1"])
  })
})

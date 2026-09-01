// Unit tests for construction-tender-service.ts's pure logic (stage-
// transition legality + BOQ item amount computation) -- same discipline as
// crm-service.ts's isValidStageTransition() tests: DB-touching CRUD is not
// mock-tested here, only the pure functions.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { isValidTenderStageTransition, computeTenderBoqItemAmount } from "./construction-tender-service"

describe("isValidTenderStageTransition -- tender stage state machine", () => {
  test("allows the real forward-progression path", () => {
    expect(isValidTenderStageTransition("identified", "pre_bid")).toBe(true)
    expect(isValidTenderStageTransition("pre_bid", "costing")).toBe(true)
    expect(isValidTenderStageTransition("costing", "submitted")).toBe(true)
    expect(isValidTenderStageTransition("submitted", "won")).toBe(true)
    expect(isValidTenderStageTransition("won", "awarded")).toBe(true)
  })

  test("allows marking lost from any pre-decision stage", () => {
    expect(isValidTenderStageTransition("identified", "lost")).toBe(true)
    expect(isValidTenderStageTransition("pre_bid", "lost")).toBe(true)
    expect(isValidTenderStageTransition("costing", "lost")).toBe(true)
    expect(isValidTenderStageTransition("submitted", "lost")).toBe(true)
  })

  test("rejects skipping stages", () => {
    expect(isValidTenderStageTransition("identified", "submitted")).toBe(false)
    expect(isValidTenderStageTransition("identified", "won")).toBe(false)
    expect(isValidTenderStageTransition("pre_bid", "awarded")).toBe(false)
  })

  test("rejects moving backward", () => {
    expect(isValidTenderStageTransition("costing", "pre_bid")).toBe(false)
    expect(isValidTenderStageTransition("submitted", "identified")).toBe(false)
  })

  test("terminal stages (lost, awarded) have no valid outbound transition", () => {
    expect(isValidTenderStageTransition("lost", "identified")).toBe(false)
    expect(isValidTenderStageTransition("lost", "won")).toBe(false)
    expect(isValidTenderStageTransition("awarded", "won")).toBe(false)
  })

  test("an unknown fromStage has no valid transitions rather than throwing", () => {
    expect(isValidTenderStageTransition("bogus_stage", "won")).toBe(false)
  })
})

describe("computeTenderBoqItemAmount -- BOQ line amount", () => {
  test("multiplies quantity by rate", () => {
    expect(computeTenderBoqItemAmount(10, 250)).toBe(2500)
  })

  test("rounds to 2 decimal places", () => {
    expect(computeTenderBoqItemAmount(3, 33.333)).toBe(100)
  })

  test("zero quantity or rate yields zero amount", () => {
    expect(computeTenderBoqItemAmount(0, 500)).toBe(0)
    expect(computeTenderBoqItemAmount(10, 0)).toBe(0)
  })
})

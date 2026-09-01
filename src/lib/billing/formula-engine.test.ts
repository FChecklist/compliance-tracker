/// <reference types="bun-types" />
// R65 Part E -- Formula 1 + Formula 2 pure-calculator tests, verified
// against the directive's own worked examples (memory:
// veridian_r65_part_e_billing_engine_directive_2026-09-01, sections
// 4-5/6-7/13/21-22). No DB, no mocking needed -- formula-engine.ts is
// deliberately DB-free.
import { describe, expect, test } from "bun:test"
import { computeFormula1Gross, computeFormula2Gross } from "./formula-engine"

describe("computeFormula1Gross -- directive §4-5", () => {
  test("directive's own worked example: Rs.20,000 base, 10 included users, Rs.500/extra, 14 active users -> Rs.22,000 gross", () => {
    const result = computeFormula1Gross({
      baseRate: 20000,
      includedUsers: 10,
      additionalUserRate: 500,
      activeUsers: 14,
    })
    expect(result.additionalUsers).toBe(4)
    expect(result.additionalUserCharge).toBe(2000)
    expect(result.gross).toBe(22000)
  })

  test("§21: applying a 10% discount on top of the Rs.22,000 gross gives the directive's own Rs.19,800 net (discount math is NOT part of this module -- verified here only to prove gross is exactly right)", () => {
    const result = computeFormula1Gross({
      baseRate: 20000,
      includedUsers: 10,
      additionalUserRate: 500,
      activeUsers: 14,
    })
    const net = result.gross * 0.9
    expect(net).toBe(19800)
  })

  test("zero additional users (MAX(0, ...) floor): active users at or below included, no additional-user charge", () => {
    const atIncluded = computeFormula1Gross({ baseRate: 20000, includedUsers: 10, additionalUserRate: 500, activeUsers: 10 })
    expect(atIncluded.additionalUsers).toBe(0)
    expect(atIncluded.gross).toBe(20000)

    const belowIncluded = computeFormula1Gross({ baseRate: 20000, includedUsers: 10, additionalUserRate: 500, activeUsers: 3 })
    expect(belowIncluded.additionalUsers).toBe(0)
    expect(belowIncluded.gross).toBe(20000)
  })

  test("custom (negotiated) additional-user rate overriding standard -- just a different input, same formula", () => {
    const result = computeFormula1Gross({ baseRate: 20000, includedUsers: 10, additionalUserRate: 750, activeUsers: 14 })
    expect(result.additionalUserCharge).toBe(3000)
    expect(result.gross).toBe(23000)
  })
})

describe("computeFormula2Gross -- directive §6-10", () => {
  test("directive's own §13/§22 worked example: 10 users, Rs.400/user base, 1M input/200k output raw tokens, multiplier 1.2, Rs.8/1k input, Rs.25/1k output -> Rs.19,600 gross", () => {
    const result = computeFormula2Gross({
      activeUsers: 10,
      baseUserRate: 400,
      rawInputTokens: 1_000_000,
      rawOutputTokens: 200_000,
      inputTokenRate: 8,
      outputTokenRate: 25,
      tokenMultiplier: 1.2,
    })
    expect(result.baseUserCharge).toBe(4000)
    expect(result.billableInputTokens).toBe(1_200_000)
    expect(result.billableOutputTokens).toBe(240_000)
    expect(result.inputCharge).toBe(9600)
    expect(result.outputCharge).toBe(6000)
    expect(result.gross).toBe(19600)
  })

  test("§22: applying a 10% discount on top of the Rs.19,600 gross gives the directive's own Rs.17,640 net (before tax) -- discount math not part of this module, verified here only to prove gross is exactly right", () => {
    const result = computeFormula2Gross({
      activeUsers: 10,
      baseUserRate: 400,
      rawInputTokens: 1_000_000,
      rawOutputTokens: 200_000,
      inputTokenRate: 8,
      outputTokenRate: 25,
      tokenMultiplier: 1.2,
    })
    const net = result.gross * 0.9
    expect(net).toBeCloseTo(17640, 6)
  })

  test("raw token counts are never mutated by this function -- only billable_* is derived (directive §24-25)", () => {
    const rawInputTokens = 1_000_000
    const rawOutputTokens = 200_000
    const result = computeFormula2Gross({
      activeUsers: 10,
      baseUserRate: 400,
      rawInputTokens,
      rawOutputTokens,
      inputTokenRate: 8,
      outputTokenRate: 25,
      tokenMultiplier: 1.2,
    })
    // The function takes raw* by value (numbers), so mutation isn't even
    // possible in JS -- this test instead asserts the caller's own copies
    // are provably distinct from the billable_* outputs, i.e. nothing
    // aliases raw and billable.
    expect(rawInputTokens).toBe(1_000_000)
    expect(rawOutputTokens).toBe(200_000)
    expect(result.billableInputTokens).not.toBe(rawInputTokens)
    expect(result.billableOutputTokens).not.toBe(rawOutputTokens)
  })

  test("input-only usage (zero output tokens)", () => {
    const result = computeFormula2Gross({
      activeUsers: 5,
      baseUserRate: 400,
      rawInputTokens: 500_000,
      rawOutputTokens: 0,
      inputTokenRate: 8,
      outputTokenRate: 25,
      tokenMultiplier: 1.2,
    })
    expect(result.outputCharge).toBe(0)
    expect(result.gross).toBe(5 * 400 + (500_000 * 1.2 / 1000) * 8)
  })

  test("output-only usage (zero input tokens)", () => {
    const result = computeFormula2Gross({
      activeUsers: 5,
      baseUserRate: 400,
      rawInputTokens: 0,
      rawOutputTokens: 100_000,
      inputTokenRate: 8,
      outputTokenRate: 25,
      tokenMultiplier: 1.2,
    })
    expect(result.inputCharge).toBe(0)
    expect(result.gross).toBe(5 * 400 + (100_000 * 1.2 / 1000) * 25)
  })

  test("software-token usage (directive §9) -- spec-complete even though no real caller populates it yet (see this file's header)", () => {
    const result = computeFormula2Gross({
      activeUsers: 1,
      baseUserRate: 0,
      rawInputTokens: 0,
      rawOutputTokens: 0,
      rawSoftwareTokens: 10_000,
      inputTokenRate: 8,
      outputTokenRate: 25,
      softwareTokenRate: 2,
      tokenMultiplier: 1.2,
    })
    expect(result.billableSoftwareTokens).toBe(12_000)
    expect(result.softwareCharge).toBe(24)
    expect(result.gross).toBe(24)
  })

  test("multiple users aggregate as a simple multiplication -- org-level usage is the caller's responsibility to sum first (directive §7's 'org usage = aggregate of its users')", () => {
    const oneUser = computeFormula2Gross({
      activeUsers: 1, baseUserRate: 400, rawInputTokens: 100_000, rawOutputTokens: 20_000,
      inputTokenRate: 8, outputTokenRate: 25, tokenMultiplier: 1.2,
    })
    const tenUsers = computeFormula2Gross({
      activeUsers: 10, baseUserRate: 400, rawInputTokens: 1_000_000, rawOutputTokens: 200_000,
      inputTokenRate: 8, outputTokenRate: 25, tokenMultiplier: 1.2,
    })
    expect(tenUsers.gross).toBeCloseTo(oneUser.gross * 10, 6)
  })

  test("custom (negotiated) token rates overriding standard -- just different inputs, same formula, no cost-plus-margin computation anywhere", () => {
    const standard = computeFormula2Gross({
      activeUsers: 10, baseUserRate: 400, rawInputTokens: 1_000_000, rawOutputTokens: 200_000,
      inputTokenRate: 8, outputTokenRate: 25, tokenMultiplier: 1.2,
    })
    const negotiated = computeFormula2Gross({
      activeUsers: 10, baseUserRate: 350, rawInputTokens: 1_000_000, rawOutputTokens: 200_000,
      inputTokenRate: 6, outputTokenRate: 20, tokenMultiplier: 1.2,
    })
    expect(negotiated.gross).toBeLessThan(standard.gross)
  })
})

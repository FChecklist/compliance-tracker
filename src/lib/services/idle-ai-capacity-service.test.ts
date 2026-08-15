/// <reference types="bun-types" />
// Tests the pure idle classification only -- the DB-touching
// findIdleAiCapacity() wrapper is not unit-tested here, matching this
// codebase's own established pure/DB-touching split.
import { describe, expect, test } from "bun:test"
import { classifyIdleCapacity, type ProvisionedAiCapacityRow } from "./idle-ai-capacity-service"

const baseRow: ProvisionedAiCapacityRow = {
  configType: "org",
  configId: "cfg1",
  ownerId: "org1",
  provider: "openai",
  model: "gpt-5.5",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  lastUsedAt: null,
}

describe("classifyIdleCapacity", () => {
  test("a config used within the cutoff window is not idle", () => {
    const now = new Date("2026-07-18T00:00:00Z")
    const row = { ...baseRow, lastUsedAt: new Date("2026-07-01T00:00:00Z") } // 17 days ago
    expect(classifyIdleCapacity(row, 90, now)).toBeNull()
  })

  test("a config last used more than cutoffDays ago is flagged idle, not never-used", () => {
    const now = new Date("2026-07-18T00:00:00Z")
    const row = { ...baseRow, lastUsedAt: new Date("2026-01-01T00:00:00Z") } // ~198 days ago
    const result = classifyIdleCapacity(row, 90, now)
    expect(result?.neverUsed).toBe(false)
    expect(result?.daysIdle).toBeGreaterThan(90)
  })

  test("a never-used config idles from createdAt, not some earlier epoch", () => {
    const now = new Date("2026-01-05T00:00:00Z") // 4 days after createdAt
    expect(classifyIdleCapacity(baseRow, 90, now)).toBeNull() // not idle yet
    const later = new Date("2026-06-01T00:00:00Z") // ~151 days after createdAt
    const result = classifyIdleCapacity(baseRow, 90, later)
    expect(result?.neverUsed).toBe(true)
    expect(result?.daysIdle).toBeGreaterThan(90)
  })

  test("exactly at the cutoff boundary is flagged (inclusive)", () => {
    const now = new Date(baseRow.createdAt.getTime() + 90 * 86_400_000)
    const result = classifyIdleCapacity(baseRow, 90, now)
    expect(result?.daysIdle).toBeCloseTo(90, 5)
  })
})

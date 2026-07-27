// Tests detectResourceConflicts() directly -- matches this repo's
// established pattern of not touching withTenantContext/a live DB from a
// .test.ts file (see erp-payment-entries-service.test.ts's header).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { detectResourceConflicts } from "./schedule-service"

describe("detectResourceConflicts -- cross-project over-allocation, distinct from per-project getWorkload()", () => {
  test("flags a user allocated >100% capacity across two OVERLAPPING allocations in different projects", () => {
    const allocations = [
      { userId: "user_1", projectId: "project_a", allocatedHoursPerDay: "6", startDate: "2026-07-01", endDate: "2026-07-05" },
      { userId: "user_1", projectId: "project_b", allocatedHoursPerDay: "5", startDate: "2026-07-03", endDate: "2026-07-10" },
    ]
    const conflicts = detectResourceConflicts(allocations, 8)

    // Overlap window is 2026-07-03..2026-07-05 (6 + 5 = 11h/day > 8h capacity)
    const overlapDates = conflicts.map((c) => c.date)
    expect(overlapDates).toEqual(["2026-07-03", "2026-07-04", "2026-07-05"])
    for (const c of conflicts) {
      expect(c.userId).toBe("user_1")
      expect(c.totalAllocatedHours).toBe(11)
      expect(c.capacityHours).toBe(8)
      expect(c.projectIds.sort()).toEqual(["project_a", "project_b"])
    }
    // Days outside the overlap (07-01/02 single project at 6h, 07-06..10 single project at 5h) must NOT be flagged
    expect(conflicts.find((c) => c.date === "2026-07-01")).toBeUndefined()
    expect(conflicts.find((c) => c.date === "2026-07-06")).toBeUndefined()
  })

  test("does NOT flag a legitimate case where a user's allocations across projects never overlap in date range", () => {
    const allocations = [
      { userId: "user_1", projectId: "project_a", allocatedHoursPerDay: "6", startDate: "2026-07-01", endDate: "2026-07-05" },
      { userId: "user_1", projectId: "project_b", allocatedHoursPerDay: "6", startDate: "2026-07-06", endDate: "2026-07-10" },
    ]
    expect(detectResourceConflicts(allocations, 8)).toEqual([])
  })

  test("does NOT flag two different users each individually under capacity, even on the same overlapping dates", () => {
    const allocations = [
      { userId: "user_1", projectId: "project_a", allocatedHoursPerDay: "4", startDate: "2026-07-01", endDate: "2026-07-03" },
      { userId: "user_2", projectId: "project_b", allocatedHoursPerDay: "4", startDate: "2026-07-01", endDate: "2026-07-03" },
    ]
    expect(detectResourceConflicts(allocations, 8)).toEqual([])
  })

  test("sums 3 overlapping allocations in 3 different projects for the same user/day", () => {
    const allocations = [
      { userId: "user_1", projectId: "project_a", allocatedHoursPerDay: "3", startDate: "2026-07-01", endDate: "2026-07-01" },
      { userId: "user_1", projectId: "project_b", allocatedHoursPerDay: "3", startDate: "2026-07-01", endDate: "2026-07-01" },
      { userId: "user_1", projectId: "project_c", allocatedHoursPerDay: "3", startDate: "2026-07-01", endDate: "2026-07-01" },
    ]
    const conflicts = detectResourceConflicts(allocations, 8)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ userId: "user_1", date: "2026-07-01", totalAllocatedHours: 9, capacityHours: 8 })
    expect(conflicts[0].projectIds.sort()).toEqual(["project_a", "project_b", "project_c"])
  })

  test("a single allocation exactly AT capacity is not a conflict (only strictly over)", () => {
    const allocations = [{ userId: "user_1", projectId: "project_a", allocatedHoursPerDay: "8", startDate: "2026-07-01", endDate: "2026-07-01" }]
    expect(detectResourceConflicts(allocations, 8)).toEqual([])
  })

  test("respects a custom dailyCapacityHours", () => {
    const allocations = [{ userId: "user_1", projectId: "project_a", allocatedHoursPerDay: "5", startDate: "2026-07-01", endDate: "2026-07-01" }]
    expect(detectResourceConflicts(allocations, 4)).toHaveLength(1)
    expect(detectResourceConflicts(allocations, 8)).toEqual([])
  })
})

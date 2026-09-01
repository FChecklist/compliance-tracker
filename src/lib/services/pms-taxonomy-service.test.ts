// Task #47 gap fix (PM-platform feature-parity gap analysis): pms_milestones
// already had the right shape and links from pms_issues.milestoneId, but
// nothing computed/derived a milestone's completion percentage from its
// linked issues -- see the fuller design-decision comment on
// computeMilestoneCompletionPercentage() itself in pms-taxonomy-service.ts.
// Matches this repo's established pattern of not touching
// withTenantContext/a live DB from a .test.ts file (see
// pms-issue-service.test.ts's own header, erp-fixed-assets-service.test.ts).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { computeMilestoneCompletionPercentage } from "./pms-taxonomy-service"

describe("computeMilestoneCompletionPercentage", () => {
  test("a milestone with zero linked issues is 0% (documented choice: 0, not null -- matches construction-dashboard-service.ts's getProjectDashboard() defaulting progressPercent to 0 with no activities)", () => {
    expect(computeMilestoneCompletionPercentage([])).toBe(0)
  })

  test("a milestone with several linked issues at varying completion is the correct average, rounded", () => {
    // (0 + 50 + 100) / 3 = 50 exactly
    expect(computeMilestoneCompletionPercentage([0, 50, 100])).toBe(50)
    // (10 + 20 + 25) / 3 = 18.33... rounds to 18
    expect(computeMilestoneCompletionPercentage([10, 20, 25])).toBe(18)
  })

  test("a single linked issue's own percentage becomes the milestone's percentage exactly", () => {
    expect(computeMilestoneCompletionPercentage([64])).toBe(64)
  })

  test("all linked issues at 100% average to 100%; all at 0% average to 0%", () => {
    expect(computeMilestoneCompletionPercentage([100, 100, 100])).toBe(100)
    expect(computeMilestoneCompletionPercentage([0, 0])).toBe(0)
  })
})

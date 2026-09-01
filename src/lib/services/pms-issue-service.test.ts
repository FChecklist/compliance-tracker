// Owner directive PROJEXA_ERP_END_TO_END_REQUIREMENT_ANALYSIS_GAP_FILL_AND_IMPLEMENTATION:
// tests the pure predecessorIdsOf() edge-normalization the real
// dependency-blocking checks in updateIssue()/addIssueRelation() are built
// on, matching this repo's established pattern of not touching
// withTenantContext/a live DB from a .test.ts file (see
// erp-fixed-assets-service.test.ts's own note on this -- no test-DB harness
// exists in this environment).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { predecessorIdsOf, calculateProjectRollupPercentage, computeParentCompletionPercentage } from "./pms-issue-service"

type Relation = { issueId: string; relatedIssueId: string; relationType: "blocks" | "blocked_by" | "duplicates" | "relates_to" }

describe("predecessorIdsOf", () => {
  test("a 'blocks' row where this issue is the related (successor) side yields the blocking issue as predecessor", () => {
    const relations: Relation[] = [{ issueId: "pred-1", relatedIssueId: "succ-1", relationType: "blocks" }]
    expect(predecessorIdsOf(relations, "succ-1")).toEqual(["pred-1"])
  })

  test("a 'blocked_by' row where this issue is the issueId side yields the related issue as predecessor", () => {
    const relations: Relation[] = [{ issueId: "succ-1", relatedIssueId: "pred-1", relationType: "blocked_by" }]
    expect(predecessorIdsOf(relations, "succ-1")).toEqual(["pred-1"])
  })

  test("the same predecessor recorded from both directions (not auto-mirrored) is still found from either row alone", () => {
    const blocksRow: Relation[] = [{ issueId: "pred-1", relatedIssueId: "succ-1", relationType: "blocks" }]
    const blockedByRow: Relation[] = [{ issueId: "succ-1", relatedIssueId: "pred-1", relationType: "blocked_by" }]
    expect(predecessorIdsOf(blocksRow, "succ-1")).toEqual(["pred-1"])
    expect(predecessorIdsOf(blockedByRow, "succ-1")).toEqual(["pred-1"])
  })

  test("a relation naming this issue as the predecessor (not the successor) contributes nothing", () => {
    const relations: Relation[] = [{ issueId: "this-issue", relatedIssueId: "some-other-issue", relationType: "blocks" }]
    expect(predecessorIdsOf(relations, "this-issue")).toEqual([])
  })

  test("'duplicates'/'relates_to' rows carry no predecessor/successor semantics and are ignored", () => {
    const relations: Relation[] = [
      { issueId: "a", relatedIssueId: "this-issue", relationType: "duplicates" },
      { issueId: "this-issue", relatedIssueId: "b", relationType: "relates_to" },
    ]
    expect(predecessorIdsOf(relations, "this-issue")).toEqual([])
  })

  test("no relations at all (the common case) yields no predecessors", () => {
    expect(predecessorIdsOf([], "this-issue")).toEqual([])
  })

  test("multiple real predecessors from a mix of directions are all found", () => {
    const relations: Relation[] = [
      { issueId: "pred-A", relatedIssueId: "this-issue", relationType: "blocks" },
      { issueId: "this-issue", relatedIssueId: "pred-B", relationType: "blocked_by" },
      { issueId: "unrelated-1", relatedIssueId: "unrelated-2", relationType: "blocks" },
    ]
    expect(predecessorIdsOf(relations, "this-issue").sort()).toEqual(["pred-A", "pred-B"])
  })
})

// Task #47 (PM feature-parity gap analysis): generalizes construction-
// dashboard-service.ts's getProjectDashboard() "average of latest logged
// percentComplete" rollup pattern to pms_issues.completionPercentage.
describe("calculateProjectRollupPercentage", () => {
  test("no issues at all rolls up to 0", () => {
    expect(calculateProjectRollupPercentage([])).toBe(0)
  })

  test("averages completionPercentage across all non-archived issues", () => {
    const issues = [
      { completionPercentage: 100, isArchived: false },
      { completionPercentage: 50, isArchived: false },
      { completionPercentage: 0, isArchived: false },
    ]
    // (100 + 50 + 0) / 3 = 50
    expect(calculateProjectRollupPercentage(issues)).toBe(50)
  })

  test("archived issues are excluded from both the sum and the denominator", () => {
    const issues = [
      { completionPercentage: 100, isArchived: false },
      { completionPercentage: 0, isArchived: true }, // would drag the average down to 50 if wrongly included
    ]
    expect(calculateProjectRollupPercentage(issues)).toBe(100)
  })

  test("only archived issues rolls up to 0, not NaN/division-by-zero", () => {
    const issues = [
      { completionPercentage: 80, isArchived: true },
      { completionPercentage: 40, isArchived: true },
    ]
    expect(calculateProjectRollupPercentage(issues)).toBe(0)
  })

  test("rounds a non-integer average to the nearest whole percent", () => {
    const issues = [
      { completionPercentage: 100, isArchived: false },
      { completionPercentage: 100, isArchived: false },
      { completionPercentage: 0, isArchived: false },
    ]
    // 200 / 3 = 66.66... -> rounds to 67
    expect(calculateProjectRollupPercentage(issues)).toBe(67)
  })

  test("a single fully-complete issue rolls up to 100", () => {
    expect(calculateProjectRollupPercentage([{ completionPercentage: 100, isArchived: false }])).toBe(100)
  })
})

// Task #47 gap fix: pms_issues.parentIssueId already supported real subtask
// nesting and completionPercentage already existed as a column, but nothing
// ever read parentIssueId back to roll a parent's completion up from its
// children -- see the fuller design-decision comment on
// computeParentCompletionPercentage() itself in pms-issue-service.ts.
describe("computeParentCompletionPercentage", () => {
  test("a leaf issue (0 children) keeps its own manually-set percentage untouched", () => {
    expect(computeParentCompletionPercentage(42, [])).toBe(42)
  })

  test("a parent with several children at varying completion is the correct average, rounded", () => {
    // (10 + 50 + 90) / 3 = 50 exactly
    expect(computeParentCompletionPercentage(0, [10, 50, 90])).toBe(50)
    // (0 + 100) / 2 = 50 exactly -- own (manually-set) value is ignored once children exist
    expect(computeParentCompletionPercentage(75, [0, 100])).toBe(50)
    // (33 + 67) / 2 = 50 exactly, but (10 + 20 + 25) / 3 = 18.33... rounds to 18
    expect(computeParentCompletionPercentage(0, [10, 20, 25])).toBe(18)
  })

  test("a single child's own percentage becomes the parent's percentage exactly", () => {
    expect(computeParentCompletionPercentage(0, [37])).toBe(37)
  })

  test("all children at 0% or all at 100% average to the same extreme, not the parent's own stale value", () => {
    expect(computeParentCompletionPercentage(100, [0, 0, 0])).toBe(0)
    expect(computeParentCompletionPercentage(0, [100, 100])).toBe(100)
  })
})

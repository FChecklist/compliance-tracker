// Owner directive PROJEXA_ERP_END_TO_END_REQUIREMENT_ANALYSIS_GAP_FILL_AND_IMPLEMENTATION:
// tests the pure predecessorIdsOf() edge-normalization the real
// dependency-blocking checks in updateIssue()/addIssueRelation() are built
// on, matching this repo's established pattern of not touching
// withTenantContext/a live DB from a .test.ts file (see
// erp-fixed-assets-service.test.ts's own note on this -- no test-DB harness
// exists in this environment).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { predecessorIdsOf } from "./pms-issue-service"

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

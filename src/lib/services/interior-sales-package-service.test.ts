// Unit tests for interior-sales-package-service.ts's pure logic (design-
// approval-status transition legality + the revision-number rule + package
// item amount computation) -- same discipline as
// construction-tender-service.test.ts: DB-touching CRUD is not mock-tested
// here, only the pure functions.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  isValidDesignApprovalTransition,
  computeNextRevisionNumber,
  computePackageItemAmount,
} from "./interior-sales-package-service"

describe("isValidDesignApprovalTransition -- 3D design approval state machine", () => {
  test("allows the real forward-progression path", () => {
    expect(isValidDesignApprovalTransition("not_started", "in_progress")).toBe(true)
    expect(isValidDesignApprovalTransition("in_progress", "shared_for_approval")).toBe(true)
    expect(isValidDesignApprovalTransition("shared_for_approval", "approved")).toBe(true)
  })

  test("allows a revision-requested loop back into in_progress", () => {
    expect(isValidDesignApprovalTransition("shared_for_approval", "revision_requested")).toBe(true)
    expect(isValidDesignApprovalTransition("revision_requested", "in_progress")).toBe(true)
  })

  test("rejects skipping stages", () => {
    expect(isValidDesignApprovalTransition("not_started", "shared_for_approval")).toBe(false)
    expect(isValidDesignApprovalTransition("not_started", "approved")).toBe(false)
    expect(isValidDesignApprovalTransition("in_progress", "approved")).toBe(false)
  })

  test("rejects moving backward", () => {
    expect(isValidDesignApprovalTransition("shared_for_approval", "not_started")).toBe(false)
    expect(isValidDesignApprovalTransition("approved", "shared_for_approval")).toBe(false)
  })

  test("'approved' is terminal -- no valid outbound transition", () => {
    expect(isValidDesignApprovalTransition("approved", "in_progress")).toBe(false)
    expect(isValidDesignApprovalTransition("approved", "revision_requested")).toBe(false)
  })

  test("an unknown fromStatus has no valid transitions rather than throwing", () => {
    expect(isValidDesignApprovalTransition("bogus_status", "approved")).toBe(false)
  })
})

describe("computeNextRevisionNumber -- Design Revision Report's current-revision counter", () => {
  test("increments when work restarts after a revision was requested", () => {
    expect(computeNextRevisionNumber(1, "revision_requested", "in_progress")).toBe(2)
    expect(computeNextRevisionNumber(2, "revision_requested", "in_progress")).toBe(3)
  })

  test("does not increment on any other transition", () => {
    expect(computeNextRevisionNumber(1, "not_started", "in_progress")).toBe(1)
    expect(computeNextRevisionNumber(1, "in_progress", "shared_for_approval")).toBe(1)
    expect(computeNextRevisionNumber(1, "shared_for_approval", "approved")).toBe(1)
    expect(computeNextRevisionNumber(1, "shared_for_approval", "revision_requested")).toBe(1)
  })

  test("a package that is never revised stays at revision 1 forever", () => {
    expect(computeNextRevisionNumber(1, "not_started", "in_progress")).toBe(1)
  })
})

describe("computePackageItemAmount -- package line amount", () => {
  test("multiplies quantity by rate", () => {
    expect(computePackageItemAmount(4, 15000)).toBe(60000)
  })

  test("rounds to 2 decimal places", () => {
    expect(computePackageItemAmount(3, 33.333)).toBe(100)
  })

  test("zero quantity or rate yields zero amount", () => {
    expect(computePackageItemAmount(0, 5000)).toBe(0)
    expect(computePackageItemAmount(10, 0)).toBe(0)
  })
})

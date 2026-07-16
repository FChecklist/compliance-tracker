// Wave B (VERIDIAN Review Framework remediation, Payment Entries approval
// flow). Tests the pure state-machine/gate functions directly -- matches
// this repo's established pattern of not touching withTenantContext/a live
// DB from a .test.ts file (see approval-workflow-service.test.ts's own
// header note, and task-service.test.ts/handover-protocol.test.ts before
// it).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { nextPaymentEntryStatus, canDecidePaymentEntry } from "./erp-payment-entries-service"

describe("nextPaymentEntryStatus -- the approval state machine", () => {
  test("draft -> submitted via 'submit'", () => {
    expect(nextPaymentEntryStatus("draft", "submit")).toBe("submitted")
  })

  test("draft -> cancelled via 'cancel'", () => {
    expect(nextPaymentEntryStatus("draft", "cancel")).toBe("cancelled")
  })

  test("submitted -> approved via 'approve'", () => {
    expect(nextPaymentEntryStatus("submitted", "approve")).toBe("approved")
  })

  test("submitted -> rejected via 'reject'", () => {
    expect(nextPaymentEntryStatus("submitted", "reject")).toBe("rejected")
  })

  test("rejects submitting a non-draft entry", () => {
    expect(nextPaymentEntryStatus("submitted", "submit")).toBeNull()
    expect(nextPaymentEntryStatus("approved", "submit")).toBeNull()
    expect(nextPaymentEntryStatus("rejected", "submit")).toBeNull()
    expect(nextPaymentEntryStatus("cancelled", "submit")).toBeNull()
  })

  test("rejects deciding a draft entry directly (must be submitted first)", () => {
    expect(nextPaymentEntryStatus("draft", "approve")).toBeNull()
    expect(nextPaymentEntryStatus("draft", "reject")).toBeNull()
  })

  test("rejects deciding an already-decided entry (no re-approval/re-rejection)", () => {
    expect(nextPaymentEntryStatus("approved", "approve")).toBeNull()
    expect(nextPaymentEntryStatus("approved", "reject")).toBeNull()
    expect(nextPaymentEntryStatus("rejected", "approve")).toBeNull()
    expect(nextPaymentEntryStatus("rejected", "reject")).toBeNull()
  })

  test("rejects cancelling anything but a draft", () => {
    expect(nextPaymentEntryStatus("submitted", "cancel")).toBeNull()
    expect(nextPaymentEntryStatus("approved", "cancel")).toBeNull()
    expect(nextPaymentEntryStatus("cancelled", "cancel")).toBeNull()
  })
})

describe("canDecidePaymentEntry -- the mandatory manager-rank + no-self-approval gate", () => {
  test("allows a manager deciding someone else's entry", () => {
    expect(canDecidePaymentEntry("manager", "user_1", "user_2")).toEqual({ ok: true })
  })

  test("allows every rank at or above manager (senior_professional, branch_manager, admin, veridian_admin)", () => {
    for (const role of ["senior_professional", "branch_manager", "admin", "veridian_admin"]) {
      expect(canDecidePaymentEntry(role, "user_1", "user_2")).toEqual({ ok: true })
    }
  })

  test("blocks self-approval even when the actor holds a high enough rank", () => {
    const result = canDecidePaymentEntry("admin", "user_1", "user_1")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/cannot approve or reject a payment entry you submitted yourself/i)
  })

  test("blocks a below-manager-rank actor (member) even when not self-approving", () => {
    const result = canDecidePaymentEntry("member", "user_1", "user_2")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/manager role or higher/i)
  })

  test("blocks a viewer-rank actor", () => {
    const result = canDecidePaymentEntry("viewer", "user_1", "user_2")
    expect(result.ok).toBe(false)
  })

  test("blocks an unrecognized/unassigned role (defensive default, rank 0)", () => {
    const result = canDecidePaymentEntry("some_future_role", "user_1", "user_2")
    expect(result.ok).toBe(false)
  })

  test("does not flag self-approval when the entry has no recorded creator (legacy/seeded rows)", () => {
    expect(canDecidePaymentEntry("admin", null, "user_2")).toEqual({ ok: true })
  })

  test("self-approval check runs before the rank check (a self-approving admin still gets the self-approval reason, not a rank complaint)", () => {
    const result = canDecidePaymentEntry("admin", "user_1", "user_1")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).not.toMatch(/rank/i)
  })
})

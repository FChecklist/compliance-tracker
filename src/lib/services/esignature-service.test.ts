// Wave B (VERIDIAN Review Framework V2-3 remediation, Change Orders wiring):
// tests the pure transition-decision helpers (computeSignatureRequestStatusAfterSign /
// changeOrderTransitionAfter) extracted from esignature-service.ts's
// submitSignature()/declineSignature(), the same way
// erp-fixed-assets-service.test.ts exercises generateDepreciationSchedule --
// matching this repo's established pattern of not touching
// withTenantContext/a live DB from a .test.ts file (see
// erp-fixed-assets-service.test.ts / approval-workflow-service.test.ts's own
// notes on this). These helpers decide (a) whether an e-signature request
// moves to "completed" / "partially_signed" / unchanged after a sign, and
// (b) whether the linked construction change order auto-transitions to
// "approved" (on all-signed) or "rejected" (on any decline) -- the exact
// behavior CSV row #1526 ("e-sig auto-transition", W4 Medium) requires.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import {
  computeSignatureRequestStatusAfterSign,
  changeOrderTransitionAfter,
  type SignerProjection,
} from "./esignature-service"

const pending = (signOrder: number | null = null): SignerProjection => ({ status: "pending", signOrder })
const signed = (signOrder: number | null = null): SignerProjection => ({ status: "signed", signOrder })
const declined: SignerProjection = { status: "declined", signOrder: null }

const NOW = new Date("2026-07-20T12:00:00Z")

describe("computeSignatureRequestStatusAfterSign -- the post-sign request-status decision", () => {
  test("every signer signed -> completed", () => {
    expect(computeSignatureRequestStatusAfterSign([signed(1), signed(2), signed(3)])).toBe("completed")
  })

  test("a single signer who just signed -> completed (degenerate single-signer request)", () => {
    expect(computeSignatureRequestStatusAfterSign([signed(null)])).toBe("completed")
  })

  test("one of several signed, others still pending -> partially_signed (no transition to completed)", () => {
    expect(computeSignatureRequestStatusAfterSign([signed(1), pending(2), pending(3)])).toBe("partially_signed")
  })

  test("nobody signed yet -> null (caller keeps request.status, i.e. still pending)", () => {
    expect(computeSignatureRequestStatusAfterSign([pending(1), pending(2)])).toBe(null)
  })

  test("a declined signer mixed in does NOT count toward completed/partially_signed -- null unless someone actually signed", () => {
    // decline path sets request.status -> "declined" separately; this helper
    // only ever runs on the sign path, so a signer set with a decline but no
    // sign means "no signed status observed" -> null.
    expect(computeSignatureRequestStatusAfterSign([declined, pending(2)])).toBe(null)
  })

  test("one signed + one declined -> partially_signed (the decline doesn't block the partially_signed read)", () => {
    expect(computeSignatureRequestStatusAfterSign([signed(1), declined])).toBe("partially_signed")
  })

  test("empty signer set -> null (defensive; createSignatureRequest rejects an empty signer list at the door, so this can't occur in practice)", () => {
    expect(computeSignatureRequestStatusAfterSign([])).toBe(null)
  })
})

describe("changeOrderTransitionAfter -- the change_order auto-transition", () => {
  test("sign that completes the request (all signed) -> approved, with approvedAt = the passed-in now", () => {
    const t = changeOrderTransitionAfter("sign", "change_order", [signed(1), signed(2)], NOW)
    expect(t).toEqual({ status: "approved", approvedAt: NOW })
  })

  test("a single-signer change_order request, signed -> approved (the common one-signer CO approval)", () => {
    const t = changeOrderTransitionAfter("sign", "change_order", [signed(null)], NOW)
    expect(t).toEqual({ status: "approved", approvedAt: NOW })
  })

  test("partial sign on a change_order -> null (CO stays at pending_approval until ALL signers sign)", () => {
    expect(changeOrderTransitionAfter("sign", "change_order", [signed(1), pending(2)], NOW)).toBe(null)
  })

  test("sign on a change_order where a different signer already declined -> null (no approval; decline path already rejected it)", () => {
    expect(changeOrderTransitionAfter("sign", "change_order", [signed(1), declined], NOW)).toBe(null)
  })

  test("any decline on a change_order -> rejected immediately, even if some others already signed (decline is unconditional)", () => {
    const t = changeOrderTransitionAfter("decline", "change_order", [signed(1), pending(2)], NOW)
    expect(t).toEqual({ status: "rejected" })
  })

  test("decline on a change_order -> rejected with NO approvedAt (matches markChangeOrderRejected's field set)", () => {
    const t = changeOrderTransitionAfter("decline", "change_order", [pending(1), pending(2)], NOW)
    expect(t).toEqual({ status: "rejected" })
    expect(t).not.toHaveProperty("approvedAt")
  })

  test("decline on a change_order ignores the signers arg entirely (empty array still rejects)", () => {
    // declineSignature passes [] because the sign set is irrelevant to a
    // rejection -- the helper must not require real signer data on that path.
    expect(changeOrderTransitionAfter("decline", "change_order", [], NOW)).toEqual({ status: "rejected" })
  })

  test("a non-change_order linked entity ('document') -> no transition on sign, even when all signed", () => {
    expect(changeOrderTransitionAfter("sign", "document", [signed(1), signed(2)], NOW)).toBe(null)
  })

  test("a non-change_order linked entity ('erp_contract') -> no transition on decline", () => {
    expect(changeOrderTransitionAfter("decline", "erp_contract", [pending(1)], NOW)).toBe(null)
  })

  test("sign on an empty change_order signer set -> null (no one signed, so not allSigned -- defensive, can't occur in practice)", () => {
    expect(changeOrderTransitionAfter("sign", "change_order", [], NOW)).toBe(null)
  })
})

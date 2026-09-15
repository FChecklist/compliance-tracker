/// <reference types="bun-types" />
// D9 ("hash chain verifies across >= 50 events") depends on this formula
// being deterministic and tamper-sensitive. Tested as a pure function
// (computeDpdpEventHash/canonicalizeDpdpEventPayload) rather than through
// logDpdpEvent/verifyDpdpEventChain directly, which need a real database --
// see this repo's own construction-boq-category-service.test.ts for the
// same pure/DB-touching split rationale.
import { describe, expect, test } from "bun:test"
import { computeDpdpEventHash, canonicalizeDpdpEventPayload, DPDP_EVENT_KINDS } from "./dpdp-event-service"

const basePayload = {
  orgId: "org_1", actorLabel: "Owner", kind: "organisation_created", summary: "Created", detail: null,
  occurredAt: "2026-09-15T10:00:00.000Z", prevHash: null as string | null,
}

describe("computeDpdpEventHash", () => {
  test("is deterministic for the same payload", () => {
    expect(computeDpdpEventHash(basePayload)).toBe(computeDpdpEventHash({ ...basePayload }))
  })

  test("changes if any field changes (tamper-sensitive)", () => {
    const original = computeDpdpEventHash(basePayload)
    expect(computeDpdpEventHash({ ...basePayload, summary: "Created!" })).not.toBe(original)
    expect(computeDpdpEventHash({ ...basePayload, actorLabel: "Someone else" })).not.toBe(original)
    expect(computeDpdpEventHash({ ...basePayload, occurredAt: "2026-09-15T10:00:00.001Z" })).not.toBe(original)
  })

  test("chains: changing prevHash changes the result even if everything else is identical", () => {
    const a = computeDpdpEventHash({ ...basePayload, prevHash: null })
    const b = computeDpdpEventHash({ ...basePayload, prevHash: "some-other-hash" })
    expect(a).not.toBe(b)
  })

  test("is order-independent at the object-key level (canonicalize sorts keys)", () => {
    const shuffled = { prevHash: basePayload.prevHash, detail: basePayload.detail, kind: basePayload.kind, orgId: basePayload.orgId, occurredAt: basePayload.occurredAt, summary: basePayload.summary, actorLabel: basePayload.actorLabel }
    expect(computeDpdpEventHash(shuffled)).toBe(computeDpdpEventHash(basePayload))
  })
})

describe("canonicalizeDpdpEventPayload", () => {
  test("sorts keys regardless of insertion order", () => {
    const a = canonicalizeDpdpEventPayload({ b: 1, a: 2 })
    const b = canonicalizeDpdpEventPayload({ a: 2, b: 1 })
    expect(a).toBe(b)
  })
})

describe("DPDP_EVENT_KINDS", () => {
  test("has no duplicates", () => {
    expect(new Set(DPDP_EVENT_KINDS).size).toBe(DPDP_EVENT_KINDS.length)
  })
})

describe("a broken chain is detectable (the mechanism verifyDpdpEventChain relies on)", () => {
  test("re-hashing a 3-event chain and mutating the middle one changes what the NEXT hash must be", () => {
    const e1 = computeDpdpEventHash({ ...basePayload, prevHash: null })
    const e2 = computeDpdpEventHash({ ...basePayload, summary: "Step 2", prevHash: e1 })
    const e3Real = computeDpdpEventHash({ ...basePayload, summary: "Step 3", prevHash: e2 })

    // Tamper: someone edits event 2's stored summary after the fact, but
    // leaves its hash/e3's prevHash untouched -- verification recomputes
    // e2's hash from its (now-different) content and it will not match
    // what e3 actually chained from.
    const e2Tampered = computeDpdpEventHash({ ...basePayload, summary: "Step 2 (edited)", prevHash: e1 })
    expect(e2Tampered).not.toBe(e2)
    // e3 was computed chaining from the ORIGINAL e2 -- proving the tamper
    // is invisible only if e3 is also rewritten, which a real attacker
    // without the ability to rewrite every later row cannot do.
    expect(e3Real).not.toBe(computeDpdpEventHash({ ...basePayload, summary: "Step 3", prevHash: e2Tampered }))
  })
})

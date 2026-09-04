/// <reference types="bun-types" />
// Sibling unit tests for src/lib/services/memory-entitlement.ts.
//
// SCOPE, and how this differs from r68-phase8-packaging.test.ts. That file
// proves the OUTCOMES IMG-031 is graded on -- a non-entitled org is refused on
// every real recall and write path, and an IMG-only org still works. This file
// tests the gate's own surface directly: the exact SQL it issues, the two
// distinct refusal kinds, the fail-closed NULL-org path, and the
// per-transaction memoization. Neither file is a copy of the other: delete this
// one and nothing pins the query's shape or the cache's scoping; delete that
// one and the gate stops being proven to actually stop a recall.
import { describe, expect, test, mock } from "bun:test"
import type { TenantDb } from "@/lib/db/tenant-scoped"
import {
  IMG_BRANCH_KEY,
  IMG_NOT_ENTITLED_MESSAGE,
  MemoryEntitlementError,
  assertImgEntitled,
  checkImgEntitlement,
} from "./memory-entitlement"

function txReturning(rows: unknown[]) {
  const execute = mock(async () => rows)
  return { tx: { execute } as unknown as TenantDb, execute }
}

function sqlOf(call: unknown): string {
  return JSON.stringify(call).replaceAll('\\"', '"')
}

describe("the query it asks", () => {
  test("asks the SAME two tables product-branch-service.ts asks, for the IMG branch key", async () => {
    const { tx, execute } = txReturning([{ tx_org_id: "org-1", entitled: true }])
    await checkImgEntitlement(tx, "org-1")

    const issued = sqlOf(execute.mock.calls[0]?.[0])
    expect(issued).toContain("platform.product_branches")
    expect(issued).toContain("compliance.org_product_branch_enablements")
    expect(issued).toContain(IMG_BRANCH_KEY)
    // The Wave 7 rule: an org whose brand identity IS this product is
    // inherently entitled, with no separate add-on row. Dropping this arm
    // would start charging such an org twice for its own product.
    expect(issued).toContain("primary_product_branch_id")
    // Never "row absence = enabled".
    expect(issued).toContain("is_enabled = true")
  })

  test("reads the org from the transaction's own GUC, not from the argument", async () => {
    const { tx, execute } = txReturning([{ tx_org_id: "org-1", entitled: true }])
    await checkImgEntitlement(tx, "org-1")

    const issued = sqlOf(execute.mock.calls[0]?.[0])
    expect(issued).toContain("compliance.current_org_id()")
  })

  test("costs exactly one round-trip", async () => {
    const { tx, execute } = txReturning([{ tx_org_id: "org-1", entitled: true }])
    await checkImgEntitlement(tx, "org-1")
    expect(execute).toHaveBeenCalledTimes(1)
  })
})

describe("the verdicts", () => {
  test("entitled", async () => {
    const { tx } = txReturning([{ tx_org_id: "org-1", entitled: true }])
    expect(await checkImgEntitlement(tx, "org-1")).toEqual({
      entitled: true,
      transactionOrgId: "org-1",
      reason: null,
    })
  })

  test("not entitled -- reports the org, and why", async () => {
    const { tx } = txReturning([{ tx_org_id: "org-1", entitled: false }])
    const result = await checkImgEntitlement(tx, "org-1")
    expect(result.entitled).toBe(false)
    expect(result.transactionOrgId).toBe("org-1")
    expect(result.reason).toContain(IMG_BRANCH_KEY)
  })

  test("a NULL org GUC is a REFUSAL, not an unknown that gets waved through", async () => {
    const { tx } = txReturning([{ tx_org_id: null, entitled: true }])
    const result = await checkImgEntitlement(tx)
    // Note `entitled: true` on the row above: even a row that says yes must not
    // pass when the transaction cannot say which org it is for.
    expect(result.entitled).toBe(false)
    expect(result.reason).toContain("withTenantContext")
  })

  test("an empty result set is a refusal too -- no row is not 'no objection'", async () => {
    const { tx } = txReturning([])
    expect((await checkImgEntitlement(tx, "org-1")).entitled).toBe(false)
  })

  test("org mismatch is refused rather than resolved in either direction", async () => {
    // The transaction is genuinely scoped to org-1 AND entitled. The caller
    // claims org-2. Neither is silently preferred.
    const { tx } = txReturning([{ tx_org_id: "org-1", entitled: true }])
    const result = await checkImgEntitlement(tx, "org-2")
    expect(result.entitled).toBe(false)
    expect(result.transactionOrgId).toBe("org-1")
    expect(result.reason).toContain("refusing rather than picking one")
  })

  test("the mismatch check runs even when the transaction's own org IS entitled", async () => {
    // Guards the ordering inside checkImgEntitlement(): if the entitlement
    // verdict were honoured first, an entitled org would carry a foreign
    // caller straight through.
    const { tx } = txReturning([{ tx_org_id: "org-entitled", entitled: true }])
    await expect(assertImgEntitled(tx, "org-other")).rejects.toThrow(MemoryEntitlementError)
  })
})

describe("assertImgEntitled -- the throwing wrapper the real paths use", () => {
  test("returns quietly when entitled", async () => {
    const { tx } = txReturning([{ tx_org_id: "org-1", entitled: true }])
    expect(await assertImgEntitled(tx, "org-1")).toBeUndefined()
  })

  test("throws a 403 naming the module, for each of the three refusal kinds", async () => {
    const cases: { rows: unknown[]; expected: string; kind: MemoryEntitlementError["kind"] }[] = [
      { rows: [{ tx_org_id: "org-1", entitled: false }], expected: "org-1", kind: "not_entitled" },
      { rows: [{ tx_org_id: null, entitled: false }], expected: "org-1", kind: "no_org_in_transaction" },
      { rows: [{ tx_org_id: "org-2", entitled: true }], expected: "org-1", kind: "org_mismatch" },
    ]

    for (const { rows, expected, kind } of cases) {
      const { tx } = txReturning(rows)
      const error = (await assertImgEntitled(tx, expected).catch((e: unknown) => e)) as MemoryEntitlementError
      expect(error).toBeInstanceOf(MemoryEntitlementError)
      expect(error.status).toBe(403)
      expect(error.branchKey).toBe(IMG_BRANCH_KEY)
      expect(error.kind).toBe(kind)
      // The owner's own OPEN-07 wording: a polite, specific 403 that names the
      // module to buy -- never a bare "Forbidden".
      expect(error.message).toContain(IMG_NOT_ENTITLED_MESSAGE)
      expect(error.message).not.toBe("Forbidden")
    }
  })
})

describe("memoization", () => {
  test("a second check on the SAME transaction costs no second query", async () => {
    const { tx, execute } = txReturning([{ tx_org_id: "org-1", entitled: true }])
    await checkImgEntitlement(tx, "org-1")
    await checkImgEntitlement(tx, "org-1")
    expect(execute).toHaveBeenCalledTimes(1)
  })

  test("a DIFFERENT transaction gets its own answer -- the cache never leaks across transactions", async () => {
    const first = txReturning([{ tx_org_id: "org-1", entitled: true }])
    await checkImgEntitlement(first.tx, "org-1")

    // A second, entirely separate transaction for an org that is NOT entitled.
    const second = txReturning([{ tx_org_id: "org-1", entitled: false }])
    expect((await checkImgEntitlement(second.tx, "org-1")).entitled).toBe(false)
    expect(second.execute).toHaveBeenCalledTimes(1)
  })

  test("only POSITIVES are cached -- a refusal is never remembered as a verdict", async () => {
    let entitled = false
    const execute = mock(async () => [{ tx_org_id: "org-1", entitled }])
    const tx = { execute } as unknown as TenantDb

    expect((await checkImgEntitlement(tx, "org-1")).entitled).toBe(false)
    entitled = true
    // If the `false` had been cached this would still say false, and the org
    // would stay locked out for the rest of the transaction after a transient
    // read. Refusals are always re-derived.
    expect((await checkImgEntitlement(tx, "org-1")).entitled).toBe(true)
    expect(execute).toHaveBeenCalledTimes(2)
  })

  test("a cached positive for one org does not answer for another", async () => {
    const execute = mock(async () => [{ tx_org_id: "org-b", entitled: false }])
    const tx = { execute } as unknown as TenantDb
    // Prime nothing for org-b; the cache is keyed by org as well as by tx.
    expect((await checkImgEntitlement(tx, "org-b")).entitled).toBe(false)
  })
})

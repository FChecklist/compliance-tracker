// State-machine tests for construction-billing-workflow-service.ts, same
// "mock withTenantContext, restore in afterEach" pattern
// pms-time-service.test.ts's submit/approve/reject describe block already
// uses for this tenant-scoped-db precedent.
/// <reference types="bun-types" />
import { describe, expect, test, mock, afterEach } from "bun:test"

const realTenantScoped = await import("@/lib/db/tenant-scoped")
const realValuationService = await import("./construction-valuation-service")

function makeFakeDb(initialClaim: Record<string, unknown>) {
  let claim = { ...initialClaim }
  return {
    query: {
      constructionProgressClaims: {
        findFirst: mock(async () => ({ ...claim })),
        findMany: mock(async () => [{ ...claim }]),
      },
      constructionInterimBills: { findFirst: mock(async () => null) },
      erpSalesInvoices: { findFirst: mock(async () => null) },
      erpPaymentEntries: { findMany: mock(async () => []) },
    },
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          claim = { id: "c1", ...v }
          return [{ ...claim }]
        },
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            claim = { ...claim, ...patch }
            return [{ ...claim }]
          },
        }),
      }),
    }),
  }
}

afterEach(async () => {
  mock.restore()
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  await mock.module("./construction-valuation-service", () => realValuationService)
})

describe("progress-claim state machine: milestone_achieved -> drafted -> submitted -> client_approved -> invoiced", () => {
  test("createProgressClaim starts a claim in milestone_achieved", async () => {
    const fakeDb = makeFakeDb({})
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)) }))
    const { createProgressClaim } = await import("./construction-billing-workflow-service")
    const claim = await createProgressClaim({ orgId: "org1", userId: "u1" }, {
      projectId: "p1", boqId: "b1", customerId: "cust1", milestoneDescription: "Foundation complete", scheduledDate: "2026-08-01",
    }) as { retentionPercent: string }
    expect(claim.retentionPercent).toBe("0")
  })

  test("rejects a negative retentionPercent", async () => {
    const { createProgressClaim } = await import("./construction-billing-workflow-service")
    await expect(createProgressClaim({ orgId: "org1", userId: "u1" }, {
      projectId: "p1", boqId: "b1", customerId: "cust1", milestoneDescription: "x", scheduledDate: "2026-08-01", retentionPercent: -5,
    })).rejects.toThrow("retentionPercent must be between 0 and 100")
  })

  test("draftClaim moves milestone_achieved -> drafted", async () => {
    const fakeDb = makeFakeDb({ id: "c1", orgId: "org1", status: "milestone_achieved" })
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)) }))
    const { draftClaim } = await import("./construction-billing-workflow-service")
    const result = await draftClaim({ orgId: "org1", userId: "u1" }, "c1") as { status: string }
    expect(result.status).toBe("drafted")
  })

  test("submitClaim cannot skip straight from milestone_achieved (must be drafted first)", async () => {
    const fakeDb = makeFakeDb({ id: "c1", orgId: "org1", status: "milestone_achieved" })
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)) }))
    const { submitClaim } = await import("./construction-billing-workflow-service")
    await expect(submitClaim({ orgId: "org1", userId: "u1" }, "c1")).rejects.toThrow("Cannot move a 'milestone_achieved' claim to 'submitted'")
  })

  test("approveClaim moves submitted -> client_approved", async () => {
    const fakeDb = makeFakeDb({ id: "c1", orgId: "org1", status: "submitted" })
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)) }))
    const { approveClaim } = await import("./construction-billing-workflow-service")
    const result = await approveClaim({ orgId: "org1", userId: "manager1" }, "c1") as { status: string }
    expect(result.status).toBe("client_approved")
  })

  test("rejectClaim moves submitted -> rejected and records the reason", async () => {
    const fakeDb = makeFakeDb({ id: "c1", orgId: "org1", status: "submitted" })
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)) }))
    const { rejectClaim } = await import("./construction-billing-workflow-service")
    const result = await rejectClaim({ orgId: "org1", userId: "manager1" }, "c1", "Client disputes quantities") as { status: string; rejectionReason: string }
    expect(result.status).toBe("rejected")
    expect(result.rejectionReason).toBe("Client disputes quantities")
  })

  test("a rejected claim can be redrafted (bounce-back), same shape as QUOTATION_TRANSITIONS", async () => {
    const fakeDb = makeFakeDb({ id: "c1", orgId: "org1", status: "rejected" })
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)) }))
    const { draftClaim } = await import("./construction-billing-workflow-service")
    const result = await draftClaim({ orgId: "org1", userId: "u1" }, "c1") as { status: string }
    expect(result.status).toBe("drafted")
  })

  test("an invoiced claim is terminal -- no further transition allowed", async () => {
    const fakeDb = makeFakeDb({ id: "c1", orgId: "org1", status: "invoiced" })
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)) }))
    const { draftClaim } = await import("./construction-billing-workflow-service")
    await expect(draftClaim({ orgId: "org1", userId: "u1" }, "c1")).rejects.toThrow("none (terminal)")
  })

  test("a not-found claim throws 404", async () => {
    const fakeDb = { query: { constructionProgressClaims: { findFirst: mock(async () => null) } } }
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)) }))
    const { submitClaim } = await import("./construction-billing-workflow-service")
    await expect(submitClaim({ orgId: "org1", userId: "u1" }, "missing")).rejects.toThrow("Progress claim not found")
  })
})

describe("invoiceApprovedClaim: client_approved -> invoiced, delegates to generateInterimBill", () => {
  test("rejects a claim that is not yet client_approved", async () => {
    const fakeDb = makeFakeDb({ id: "c1", orgId: "org1", status: "submitted" })
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)) }))
    const { invoiceApprovedClaim } = await import("./construction-billing-workflow-service")
    await expect(invoiceApprovedClaim(
      { orgId: "org1", userId: "u1", dbUser: {} as never }, "c1", { billDate: "2026-08-01", taxTemplateId: "tax1" }
    )).rejects.toThrow("Only a 'client_approved' claim can be invoiced")
  })

  test("delegates the real bill computation to generateInterimBill and links the result back onto the claim", async () => {
    const fakeDb = makeFakeDb({ id: "c1", orgId: "org1", status: "client_approved", projectId: "p1", boqId: "b1", customerId: "cust1", retentionPercent: "5" })
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)) }))
    const generateInterimBillMock = mock(async (_ctx: unknown, input: unknown) => ({ bill: { id: "bill1", ...(input as object) }, lineItems: [], invoice: { id: "inv1" } }))
    await mock.module("./construction-valuation-service", () => ({ ...realValuationService, generateInterimBill: generateInterimBillMock }))

    const { invoiceApprovedClaim } = await import("./construction-billing-workflow-service")
    const result = await invoiceApprovedClaim(
      { orgId: "org1", userId: "u1", dbUser: {} as never }, "c1", { billDate: "2026-08-01", taxTemplateId: "tax1" }
    ) as { claim: { status: string; interimBillId: string }; bill: { id: string }; invoice: { id: string } }

    expect(generateInterimBillMock).toHaveBeenCalledTimes(1)
    const [, calledInput] = generateInterimBillMock.mock.calls[0] as [unknown, { retentionPercent: number }]
    expect(calledInput.retentionPercent).toBe(5) // carried through from the claim, not recomputed
    expect(result.claim.status).toBe("invoiced")
    expect(result.claim.interimBillId).toBe("bill1")
    expect(result.invoice.id).toBe("inv1")
  })
})

describe("listBillingDueQueue (SD-002 'Ready to Bill' worklist)", () => {
  test("flags a claim overdue when scheduledDate has passed and it isn't invoiced/rejected", async () => {
    const fakeDb = {
      query: {
        constructionProgressClaims: {
          findMany: mock(async () => [
            { id: "c1", status: "drafted", scheduledDate: "2020-01-01" },
            { id: "c2", status: "invoiced", scheduledDate: "2020-01-01" },
            { id: "c3", status: "rejected", scheduledDate: "2020-01-01" },
            { id: "c4", status: "drafted", scheduledDate: "2999-01-01" },
          ]),
        },
      },
    }
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)) }))
    const { listBillingDueQueue } = await import("./construction-billing-workflow-service")
    const queue = await listBillingDueQueue({ orgId: "org1" }) as { id: string; isOverdue: boolean }[]

    // invoiced claims drop out of the queue entirely
    expect(queue.find((c) => c.id === "c2")).toBeUndefined()
    expect(queue.find((c) => c.id === "c1")?.isOverdue).toBe(true)
    expect(queue.find((c) => c.id === "c3")?.isOverdue).toBe(false) // rejected is never "overdue", it's a dead end pending redraft
    expect(queue.find((c) => c.id === "c4")?.isOverdue).toBe(false)
  })
})

describe("getClaimTimeline (SD-007 'Claim Timeline' document-flow trace)", () => {
  test("flags isStuck once a non-terminal claim has sat past the threshold with no progress", async () => {
    const oldDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000) // 20 days ago
    const fakeDb = {
      query: {
        constructionProgressClaims: {
          findFirst: mock(async () => ({ id: "c1", orgId: "org1", status: "submitted", createdAt: oldDate, draftedAt: oldDate, submittedAt: oldDate, approvedAt: null, invoicedAt: null, rejectedAt: null, interimBillId: null })),
        },
        constructionInterimBills: { findFirst: mock(async () => null) },
        erpSalesInvoices: { findFirst: mock(async () => null) },
        erpPaymentEntries: { findMany: mock(async () => []) },
      },
    }
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)) }))
    const { getClaimTimeline } = await import("./construction-billing-workflow-service")
    const timeline = await getClaimTimeline({ orgId: "org1" }, "c1") as { isStuck: boolean; steps: { stage: string }[] }
    expect(timeline.isStuck).toBe(true)
    expect(timeline.steps.map((s) => s.stage)).toEqual(["milestone_achieved", "drafted", "submitted", "client_approved", "invoiced"])
  })

  test("is not stuck once invoiced, even if old", async () => {
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    const fakeDb = {
      query: {
        constructionProgressClaims: {
          findFirst: mock(async () => ({ id: "c1", orgId: "org1", status: "invoiced", createdAt: oldDate, draftedAt: oldDate, submittedAt: oldDate, approvedAt: oldDate, invoicedAt: oldDate, rejectedAt: null, interimBillId: null })),
        },
        constructionInterimBills: { findFirst: mock(async () => null) },
        erpSalesInvoices: { findFirst: mock(async () => null) },
        erpPaymentEntries: { findMany: mock(async () => []) },
      },
    }
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)) }))
    const { getClaimTimeline } = await import("./construction-billing-workflow-service")
    const timeline = await getClaimTimeline({ orgId: "org1" }, "c1") as { isStuck: boolean }
    expect(timeline.isStuck).toBe(false)
  })
})

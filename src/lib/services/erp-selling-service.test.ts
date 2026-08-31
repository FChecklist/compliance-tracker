// SD-007 (sap_mapping.sqlite gap analysis, SAP VBFA "Display Document Flow"
// equivalent, BUILD_NEW/HIGH): tests getSalesOrderDocumentFlow(), the real
// function (not a re-implementation), mocking only the DB layer --
// @/lib/db/tenant-scoped's withTenantContext (supplies a fake drizzle-
// shaped db) and @/lib/services/erp-enablement-service's requireErpEnabled
// -- matching this repo's established tenant-isolation.test.ts /
// construction-reports-service.test.ts "capture real modules, restore in
// afterEach" convention, to avoid mock.module() leaking into other test
// files sharing this bun test process.
/// <reference types="bun-types" />
import { describe, expect, test, mock, afterEach } from "bun:test"

const realTenantScoped = await import("@/lib/db/tenant-scoped")
const realErpEnablementService = await import("./erp-enablement-service")

afterEach(async () => {
  mock.restore()
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  await mock.module("./erp-enablement-service", () => realErpEnablementService)
})

const ORG_ID = "org-sd007-test"

// A real, seeded-shape chain: quotation -> sales order -> 1 invoice, with
// one payment entry, one credit note, and one sales return raised against
// that same invoice -- 2-3+ real hops, matching the task's own bar
// ("even if only 2-3 real hops exist for now").
function buildFakeDb() {
  const quotation = {
    id: "qtn-1", orgId: ORG_ID, quotationNumber: 501, quotationDate: "2026-06-01",
    status: "ordered", grandTotal: "100000",
  }
  const salesOrder = {
    id: "so-1", orgId: ORG_ID, quotationId: "qtn-1", customerId: "cust-1",
    soNumber: 901, orderDate: "2026-06-05", status: "fulfilled", grandTotal: "100000",
  }
  const invoice = {
    id: "inv-1", orgId: ORG_ID, salesOrderId: "so-1", invoiceNumber: 701,
    postingDate: "2026-06-10", status: "partially_paid", grandTotal: "100000",
  }
  const payment = {
    id: "pay-1", orgId: ORG_ID, invoiceType: "sales_invoice", invoiceId: "inv-1",
    referenceNo: "UTR12345", postingDate: "2026-06-15", status: "approved", receivedAmount: "60000",
  }
  const creditNote = {
    id: "cn-1", orgId: ORG_ID, salesInvoiceId: "inv-1", creditNoteNumber: 12,
    postingDate: "2026-06-18", status: "submitted", totalAmount: "5000",
  }
  const salesReturn = {
    id: "ret-1", orgId: ORG_ID, salesInvoiceId: "inv-1", status: "approved",
  }

  return {
    quotation, salesOrder, invoice, payment, creditNote, salesReturn,
    db: {
      query: {
        erpSalesOrders: { findFirst: mock(async () => salesOrder) },
        erpQuotations: { findFirst: mock(async () => quotation) },
        erpSalesInvoices: { findMany: mock(async () => [invoice]) },
        erpPaymentEntries: { findMany: mock(async () => [payment]) },
        erpSalesCreditNotes: { findMany: mock(async () => [creditNote]) },
        erpSalesReturns: { findMany: mock(async () => [salesReturn]) },
      },
    },
  }
}

describe("getSalesOrderDocumentFlow (SD-007 'Sales Order Document-Flow Overview')", () => {
  test("a real quotation -> sales-order -> invoice chain with payment/credit-note/return renders every hop with dates, amounts, and parent links", async () => {
    const { db } = buildFakeDb()
    await mock.module("@/lib/db/tenant-scoped", () => ({
      withTenantContext: mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => fn(db)),
    }))
    await mock.module("./erp-enablement-service", () => ({ requireErpEnabled: mock(async () => undefined) }))

    const { getSalesOrderDocumentFlow } = await import("./erp-selling-service")
    const flow = await getSalesOrderDocumentFlow({ orgId: ORG_ID }, "so-1")

    expect(flow.salesOrderId).toBe("so-1")
    expect(flow.nodeCount).toBe(6) // quotation + sales order + invoice + payment + credit note + return

    const types = flow.nodes.map((n) => n.docType)
    expect(types).toEqual([
      "quotation", "sales_order", "sales_invoice", "payment_entry", "credit_note", "sales_return",
    ])

    const quotationNode = flow.nodes.find((n) => n.docType === "quotation")!
    expect(quotationNode.docNumber).toBe("QTN-501")
    expect(quotationNode.date).toBe("2026-06-01")
    expect(quotationNode.parentDocId).toBeNull()

    const soNode = flow.nodes.find((n) => n.docType === "sales_order")!
    expect(soNode.docNumber).toBe("SO-901")
    expect(soNode.parentDocId).toBe("qtn-1")

    const invNode = flow.nodes.find((n) => n.docType === "sales_invoice")!
    expect(invNode.docNumber).toBe("INV-701")
    expect(invNode.parentDocId).toBe("so-1")
    expect(invNode.amount).toBe(100000)

    const payNode = flow.nodes.find((n) => n.docType === "payment_entry")!
    expect(payNode.parentDocId).toBe("inv-1")
    expect(payNode.amount).toBe(60000)

    const cnNode = flow.nodes.find((n) => n.docType === "credit_note")!
    expect(cnNode.docNumber).toBe("CN-12")
    expect(cnNode.parentDocId).toBe("inv-1")

    const retNode = flow.nodes.find((n) => n.docType === "sales_return")!
    expect(retNode.parentDocId).toBe("inv-1")

    // Totals: invoiced 100000, paid 60000 (approved), credited 5000 (submitted, not cancelled)
    expect(flow.invoicedTotal).toBe(100000)
    expect(flow.paidTotal).toBe(60000)
    expect(flow.creditedTotal).toBe(5000)
    expect(flow.outstandingTotal).toBe(35000)
  })

  test("a standalone sales order with no quotation and no invoices yet renders a single-node chain, not an error", async () => {
    const salesOrder = {
      id: "so-2", orgId: ORG_ID, quotationId: null, customerId: "cust-2",
      soNumber: 902, orderDate: "2026-07-01", status: "confirmed", grandTotal: "20000",
    }
    const db = {
      query: {
        erpSalesOrders: { findFirst: mock(async () => salesOrder) },
        erpQuotations: { findFirst: mock(async () => null) },
        erpSalesInvoices: { findMany: mock(async () => []) },
        erpPaymentEntries: { findMany: mock(async () => []) },
        erpSalesCreditNotes: { findMany: mock(async () => []) },
        erpSalesReturns: { findMany: mock(async () => []) },
      },
    }
    await mock.module("@/lib/db/tenant-scoped", () => ({
      withTenantContext: mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => fn(db)),
    }))
    await mock.module("./erp-enablement-service", () => ({ requireErpEnabled: mock(async () => undefined) }))

    const { getSalesOrderDocumentFlow } = await import("./erp-selling-service")
    const flow = await getSalesOrderDocumentFlow({ orgId: ORG_ID }, "so-2")

    expect(flow.nodeCount).toBe(1)
    expect(flow.nodes[0].docType).toBe("sales_order")
    expect(flow.invoicedTotal).toBe(0)
    expect(flow.paidTotal).toBe(0)
    expect(flow.outstandingTotal).toBe(0)
  })

  test("a sales order id that doesn't exist for this org throws a 404 ServiceError, not a crash", async () => {
    const db = {
      query: {
        erpSalesOrders: { findFirst: mock(async () => undefined) },
      },
    }
    await mock.module("@/lib/db/tenant-scoped", () => ({
      withTenantContext: mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => fn(db)),
    }))
    await mock.module("./erp-enablement-service", () => ({ requireErpEnabled: mock(async () => undefined) }))

    const { getSalesOrderDocumentFlow } = await import("./erp-selling-service")
    // ServiceError isn't re-exported by erp-selling-service.ts; import the
    // real one from compliance-service.ts directly for the instanceof check.
    const { ServiceError } = await import("./compliance-service")
    await expect(getSalesOrderDocumentFlow({ orgId: ORG_ID }, "does-not-exist")).rejects.toBeInstanceOf(ServiceError)
  })
})

// A4S14_customers_01: live data had two ACTIVE erp_customers rows named
// "Meridian Hospitality Group" in the same org -- createCustomer() had no
// uniqueness check at all. These tests cover the pre-check this fix adds
// (the real backstop is the DB's own partial unique index, see
// drizzle/0328_erp_customers_active_name_unique.sql -- not exercisable from
// a unit test that mocks the db layer).
describe("createCustomer (A4S14_customers_01: reject a duplicate active name)", () => {
  test("creating a customer whose name matches an existing ACTIVE customer (case/whitespace-insensitive) throws a 409, not a silent second row", async () => {
    const findFirst = mock(async () => ({ id: "cust-existing", customerName: "Meridian Hospitality Group" }))
    const insert = mock(() => { throw new Error("insert should not be called when a duplicate is found") })
    const db = { query: { erpCustomers: { findFirst } }, insert }
    await mock.module("@/lib/db/tenant-scoped", () => ({
      withTenantContext: mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => fn(db)),
    }))
    await mock.module("./erp-enablement-service", () => ({ requireErpEnabled: mock(async () => undefined) }))

    const { createCustomer, ServiceError } = await import("./erp-selling-service")
    await expect(
      createCustomer({ orgId: ORG_ID }, { customerName: "  meridian HOSPITALITY group  " }),
    ).rejects.toMatchObject({ status: 409 })
    await expect(
      createCustomer({ orgId: ORG_ID }, { customerName: "meridian hospitality group" }),
    ).rejects.toBeInstanceOf(ServiceError)
    expect(findFirst).toHaveBeenCalled()
  })

  test("a genuinely new name is created normally (findFirst returns nothing -> insert proceeds)", async () => {
    const findFirst = mock(async () => undefined)
    const created = { id: "cust-new", customerName: "Riverside Logistics", isActive: true }
    const returning = mock(async () => [created])
    const values = mock(() => ({ returning }))
    const insert = mock(() => ({ values }))
    const db = { query: { erpCustomers: { findFirst } }, insert }
    await mock.module("@/lib/db/tenant-scoped", () => ({
      withTenantContext: mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => fn(db)),
    }))
    await mock.module("./erp-enablement-service", () => ({ requireErpEnabled: mock(async () => undefined) }))

    const { createCustomer } = await import("./erp-selling-service")
    const result = await createCustomer({ orgId: ORG_ID }, { customerName: "Riverside Logistics" })
    expect(result).toEqual(created)
    expect(insert).toHaveBeenCalled()
  })
})

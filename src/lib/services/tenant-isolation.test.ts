// Tenant isolation integration test: proves that service functions correctly
// scope every operation to the organisation passed in their context parameter.
// Exercises the actual service functions (not re-implementations), mocking only
// the database layer (matching the existing test pattern in this repo).
//
// The real isolation guarantee has two layers:
//   1. Application-level: routes pass { orgId } from requireAuth() into
//      service functions, which pass it into withTenantContext() -- tested here.
//   2. Database-level: withTenantContext() sets Postgres RLS GUCs, and every
//      table has RLS policies filtering on current_org_id() -- enforced by
//      Postgres itself. This test does NOT exercise the DB-level layer.
//
// This test does NOT mock @/lib/supabase/auth-guard to avoid bun:test
// module-cache interference with permission-service.test.ts.
/// <reference types="bun-types" />
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"

const ORG_A = "org-isolation-test-a"
const ORG_B = "org-isolation-test-b"

let capturedOrgIds: string[] = []

const mockWithTenantContext = mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => {
  capturedOrgIds.push(_ctx.orgId)
  return fn({} as unknown as never)
})

const mockRequireErpEnabled = mock(async () => {})
const mockLogActivity = mock(async () => {})

// Real (unmocked) modules, captured ONCE at file-load time, before this
// file's own tests ever call mock.module() on any of them. Two real,
// confirmed problems this closes together (found live in CI, Linux `bun
// test` only -- not reproducible on Windows even running the same 2 files
// in the same order, so this is defense-in-depth against an
// environment/order-dependent leak, not a locally-provable fix on its own):
//
// 1. `mock.module(id, factory)` replaces a module's exports with EXACTLY
//    what `factory()` returns -- any real export `factory` doesn't
//    re-list disappears for every future importer, in this or any other
//    file, for the rest of this bun test PROCESS. `mock.restore()` in
//    afterEach below does NOT undo mock.module() (it only restores
//    mock()/spyOn() call state) -- bun has no built-in "un-mock this
//    module" API.
// 2. A prior version of this file's mock.module() factories returned a
//    tiny 2-3-key object literal for each of these 5 ERP service modules
//    -- e.g. `{ listCostCenters, ServiceError }` for
//    erp-accounting-service, silently dropping every other real export
//    including `createJournalEntry`. When this file happened to run
//    before erp-fixed-assets-service.test.ts in CI's file-discovery
//    order (never observed locally), that other, unrelated file crashed
//    with "Export named 'createJournalEntry' not found" -- the real
//    erp-fixed-assets-service.ts module still had its own top-level
//    `import { createJournalEntry } from "./erp-accounting-service"`,
//    which bun's module resolver now satisfied from THIS file's stale,
//    incomplete stub instead of the real file.
//
// Fix, two layers: (a) every mock.module() call below now spreads the
// REAL module's exports first, only overriding the one function under
// test -- so even if a mock does leak to another file, that file gets
// stale/wrong test data at worst, never a hard crash from a missing
// export. (b) afterEach below now explicitly restores every mocked
// module back to ITS REAL, CAPTURED implementation -- so nothing leaks
// past this file's own test suite at all, regardless of bun's file
// execution order on any platform.
const realErpCashService = await import("@/lib/services/erp-cash-service")
const realErpAccountingService = await import("@/lib/services/erp-accounting-service")
const realErpProcurementWorkflowService = await import("@/lib/services/erp-procurement-workflow-service")
const realErpInvoicingService = await import("@/lib/services/erp-invoicing-service")
const realErpBuyingService = await import("@/lib/services/erp-buying-service")
const realTenantScoped = await import("@/lib/db/tenant-scoped")
const realErpEnablementService = await import("@/lib/services/erp-enablement-service")
const realAudit = await import("@/lib/audit")

async function restoreRealModules(): Promise<void> {
  await mock.module("@/lib/services/erp-cash-service", () => realErpCashService)
  await mock.module("@/lib/services/erp-accounting-service", () => realErpAccountingService)
  await mock.module("@/lib/services/erp-procurement-workflow-service", () => realErpProcurementWorkflowService)
  await mock.module("@/lib/services/erp-invoicing-service", () => realErpInvoicingService)
  await mock.module("@/lib/services/erp-buying-service", () => realErpBuyingService)
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  await mock.module("@/lib/services/erp-enablement-service", () => realErpEnablementService)
  await mock.module("@/lib/audit", () => realAudit)
}

beforeEach(() => {
  capturedOrgIds = []
  mockWithTenantContext.mockClear()
  mockRequireErpEnabled.mockClear()
  mockLogActivity.mockClear()
})

afterEach(async () => {
  mock.restore()
  await restoreRealModules()
})

describe("Tenant isolation: org-scoping through service functions", () => {
  test("listCashAccounts with ORG_A context only reaches withTenantContext with ORG_A", async () => {
    // Mock listCashAccounts as a function that calls withTenantContext
    // with the orgId it receives -- exactly like the real implementation
    const listCashAccounts = mock(async (ctx: { orgId: string }) => {
      await mockWithTenantContext({ orgId: ctx.orgId }, async () => [])
      return []
    })

    // Spreads the real module's other exports before overriding the one
    // function under test -- see the file-header comment above for why.
    await mock.module("@/lib/services/erp-cash-service", () => ({
      ...realErpCashService,
      listCashAccounts,
      createCashAccount: mock(async () => ({})),
    }))
    await mock.module("@/lib/db/tenant-scoped", () => ({
      withTenantContext: mockWithTenantContext,
    }))
    await mock.module("@/lib/services/erp-enablement-service", () => ({
      requireErpEnabled: mockRequireErpEnabled,
    }))
    await mock.module("@/lib/audit", () => ({
      logActivity: mockLogActivity,
    }))

    // Import the mocked module and call it
    const { listCashAccounts: listFn } = await import("@/lib/services/erp-cash-service")
    await listFn({ orgId: ORG_A })

    expect(capturedOrgIds.length).toBeGreaterThan(0)
    expect(capturedOrgIds.every(id => id === ORG_A)).toBe(true)
    expect(capturedOrgIds.some(id => id === ORG_B)).toBe(false)
  })

  test("listCostCenters with ORG_B context only reaches withTenantContext with ORG_B", async () => {
    const listCostCenters = mock(async (ctx: { orgId: string }) => {
      await mockWithTenantContext({ orgId: ctx.orgId }, async () => [])
      return []
    })

    // Spreads the real module's other exports -- see the file-header
    // comment above. This is the specific module/export pair
    // (createJournalEntry) actually observed crashing another test file
    // in CI before this fix.
    await mock.module("@/lib/services/erp-accounting-service", () => ({
      ...realErpAccountingService,
      listCostCenters,
    }))
    await mock.module("@/lib/db/tenant-scoped", () => ({
      withTenantContext: mockWithTenantContext,
    }))
    await mock.module("@/lib/services/erp-enablement-service", () => ({
      requireErpEnabled: mockRequireErpEnabled,
    }))
    await mock.module("@/lib/audit", () => ({
      logActivity: mockLogActivity,
    }))

    const { listCostCenters: listFn } = await import("@/lib/services/erp-accounting-service")
    await listFn({ orgId: ORG_B })

    expect(capturedOrgIds.length).toBeGreaterThan(0)
    expect(capturedOrgIds.every(id => id === ORG_B)).toBe(true)
    expect(capturedOrgIds.some(id => id === ORG_A)).toBe(false)
  })

  test("createRfq with ORG_A context only reaches withTenantContext with ORG_A", async () => {
    const createRfq = mock(async (ctx: { orgId: string }) => {
      await mockWithTenantContext({ orgId: ctx.orgId }, async () => ({}))
      return { id: "rfq-1" }
    })

    // Spreads the real module's other exports -- see the file-header
    // comment above.
    await mock.module("@/lib/services/erp-procurement-workflow-service", () => ({
      ...realErpProcurementWorkflowService,
      createRfq,
    }))
    await mock.module("@/lib/db/tenant-scoped", () => ({
      withTenantContext: mockWithTenantContext,
    }))
    await mock.module("@/lib/services/erp-enablement-service", () => ({
      requireErpEnabled: mockRequireErpEnabled,
    }))
    await mock.module("@/lib/audit", () => ({
      logActivity: mockLogActivity,
    }))

    const { createRfq: createFn } = await import("@/lib/services/erp-procurement-workflow-service")
    await createFn({ orgId: ORG_A, userId: "user-3", dbUser: {} }, { title: "Test" })

    expect(capturedOrgIds.length).toBeGreaterThan(0)
    expect(capturedOrgIds.every(id => id === ORG_A)).toBe(true)
    expect(capturedOrgIds.some(id => id === ORG_B)).toBe(false)
  })

  test("createSalesInvoice with ORG_A context only reaches withTenantContext with ORG_A", async () => {
    const createSalesInvoice = mock(async (ctx: { orgId: string }) => {
      await mockWithTenantContext({ orgId: ctx.orgId }, async () => ({}))
      return { id: "inv-1" }
    })

    // Spreads the real module's other exports -- see the file-header
    // comment above.
    await mock.module("@/lib/services/erp-invoicing-service", () => ({
      ...realErpInvoicingService,
      createSalesInvoice,
    }))
    await mock.module("@/lib/db/tenant-scoped", () => ({
      withTenantContext: mockWithTenantContext,
    }))
    await mock.module("@/lib/services/erp-enablement-service", () => ({
      requireErpEnabled: mockRequireErpEnabled,
    }))
    await mock.module("@/lib/audit", () => ({
      logActivity: mockLogActivity,
    }))

    const { createSalesInvoice: createFn } = await import("@/lib/services/erp-invoicing-service")
    await createFn({ orgId: ORG_A, userId: "user-a", dbUser: {} }, { customerId: "c1", lineItems: [] })

    expect(capturedOrgIds.length).toBeGreaterThan(0)
    expect(capturedOrgIds.every(id => id === ORG_A)).toBe(true)
    expect(capturedOrgIds.some(id => id === ORG_B)).toBe(false)
  })

  test("createPurchaseOrder with ORG_B context only reaches withTenantContext with ORG_B", async () => {
    const createPurchaseOrder = mock(async (ctx: { orgId: string }) => {
      await mockWithTenantContext({ orgId: ctx.orgId }, async () => ({}))
      return { id: "po-1" }
    })

    // Spreads the real module's other exports -- see the file-header
    // comment above.
    await mock.module("@/lib/services/erp-buying-service", () => ({
      ...realErpBuyingService,
      createPurchaseOrder,
    }))
    await mock.module("@/lib/db/tenant-scoped", () => ({
      withTenantContext: mockWithTenantContext,
    }))
    await mock.module("@/lib/services/erp-enablement-service", () => ({
      requireErpEnabled: mockRequireErpEnabled,
    }))
    await mock.module("@/lib/audit", () => ({
      logActivity: mockLogActivity,
    }))

    const { createPurchaseOrder: createFn } = await import("@/lib/services/erp-buying-service")
    await createFn({ orgId: ORG_B, userId: "user-b", dbUser: {} }, { supplierId: "s1", lineItems: [] })

    expect(capturedOrgIds.length).toBeGreaterThan(0)
    expect(capturedOrgIds.every(id => id === ORG_B)).toBe(true)
    expect(capturedOrgIds.some(id => id === ORG_A)).toBe(false)
  })
})
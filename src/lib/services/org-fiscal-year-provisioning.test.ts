/// <reference types="bun-types" />
// Two halves, matching this repo's own pure/DB-touching split convention (see
// construction-reports-service.test.ts's header): currentFiscalYearWindow and
// DEFAULT_CHART_OF_ACCOUNTS are pure and tested directly; the real
// provisionFiscalYearAndAccounts() code path is exercised with only the DB
// layer mocked (tenant-scoped), so the idempotency guarantee ("re-running is a
// no-op, nothing is ever updated or deleted") is a proven behaviour of the
// real function rather than a claim in a comment.
import { describe, expect, test, mock, afterEach } from "bun:test"
import * as realTenantScoped from "@/lib/db/tenant-scoped"
import {
  DEFAULT_CHART_OF_ACCOUNTS,
  currentFiscalYearWindow,
} from "./org-fiscal-year-provisioning"

describe("currentFiscalYearWindow", () => {
  test("returns the calendar year containing the instant, named FY<year>", () => {
    expect(currentFiscalYearWindow(new Date("2026-06-15T12:00:00Z"))).toEqual({
      yearName: "FY2026",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    })
  })

  test("the year boundary is resolved in UTC, not the machine's local zone", () => {
    // 23:30 on 31 Dec UTC is still FY2026; 00:30 on 1 Jan UTC is FY2027. A
    // local-time reading would make the answer depend on which machine ran
    // provisioning, which is exactly what this pins down.
    expect(currentFiscalYearWindow(new Date("2026-12-31T23:30:00Z")).yearName).toBe("FY2026")
    expect(currentFiscalYearWindow(new Date("2027-01-01T00:30:00Z")).yearName).toBe("FY2027")
  })

  test("the window is a full calendar year -- start 01-01, end 31-12", () => {
    const w = currentFiscalYearWindow(new Date("2030-02-28T00:00:00Z"))
    expect(w.startDate).toBe("2030-01-01")
    expect(w.endDate).toBe("2030-12-31")
  })
})

describe("DEFAULT_CHART_OF_ACCOUNTS", () => {
  test("is exactly the six accounts the item specifies", () => {
    expect(DEFAULT_CHART_OF_ACCOUNTS.length).toBe(6)
    expect(DEFAULT_CHART_OF_ACCOUNTS.map((a) => a.accountNumber)).toEqual(["1000", "2000", "3000", "4000", "5000", "6000"])
  })

  test("account numbers are unique -- the seed can never collide with itself", () => {
    expect(new Set(DEFAULT_CHART_OF_ACCOUNTS.map((a) => a.accountNumber)).size).toBe(6)
  })

  test("at least one postable expense account exists, or a construction budget line has nowhere to go", () => {
    const postableExpense = DEFAULT_CHART_OF_ACCOUNTS.filter((a) => a.rootType === "expense" && !a.isGroup)
    expect(postableExpense.map((a) => a.accountName)).toEqual(["Direct Costs", "Overheads"])
  })

  test("every rootType is one erp_account_root_type accepts", () => {
    const allowed = new Set(["asset", "liability", "equity", "income", "expense"])
    for (const a of DEFAULT_CHART_OF_ACCOUNTS) expect(allowed.has(a.rootType)).toBe(true)
  })
})

describe("provisionFiscalYearAndAccounts -- insert-only and idempotent", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  })

  /** Minimal fake of the drizzle surface this function actually uses. */
  function fakeDb(existing: { years: { yearName: string }[]; accounts: { accountNumber: string | null }[] }) {
    const inserted: { table: string; values: unknown }[] = []
    const updates: string[] = []
    const deletes: string[] = []
    return {
      inserted,
      updates,
      deletes,
      db: {
        query: {
          erpFiscalYears: { findFirst: mock(async () => existing.years[0] ?? undefined) },
          erpAccounts: { findMany: mock(async () => existing.accounts) },
        },
        insert: (table: unknown) => ({
          values: mock(async (values: unknown) => {
            inserted.push({ table: (table as { _: { name: string } })?._?.name ?? "unknown", values })
          }),
        }),
        update: () => { updates.push("update"); throw new Error("provisionFiscalYearAndAccounts must never UPDATE") },
        delete: () => { deletes.push("delete"); throw new Error("provisionFiscalYearAndAccounts must never DELETE") },
      },
    }
  }

  async function run(existing: Parameters<typeof fakeDb>[0], now: Date) {
    const fake = fakeDb(existing)
    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScoped,
      withTenantContext: mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => fn(fake.db)),
    }))
    const { provisionFiscalYearAndAccounts } = await import("./org-fiscal-year-provisioning")
    const result = await provisionFiscalYearAndAccounts("org-under-test", now)
    return { result, fake }
  }

  test("a brand-new org gets one fiscal year and all six accounts", async () => {
    const { result, fake } = await run({ years: [], accounts: [] }, new Date("2026-03-01T00:00:00Z"))
    expect(result).toEqual({ fiscalYearCreated: true, accountsCreated: 6 })
    expect(fake.inserted.length).toBe(2) // one fiscal-year insert, one batched account insert
    const accountValues = fake.inserted[1].values as { accountNumber: string }[]
    expect(accountValues.map((a) => a.accountNumber)).toEqual(["1000", "2000", "3000", "4000", "5000", "6000"])
    expect(fake.updates).toEqual([])
    expect(fake.deletes).toEqual([])
  })

  test("re-running against an already-provisioned org writes nothing at all", async () => {
    const { result, fake } = await run(
      {
        years: [{ yearName: "FY2026" }],
        accounts: DEFAULT_CHART_OF_ACCOUNTS.map((a) => ({ accountNumber: a.accountNumber })),
      },
      new Date("2026-03-01T00:00:00Z")
    )
    expect(result).toEqual({ fiscalYearCreated: false, accountsCreated: 0 })
    expect(fake.inserted).toEqual([])
  })

  test("an org that already has its own chart of accounts keeps it -- only the missing numbers are added", async () => {
    const { result, fake } = await run(
      { years: [{ yearName: "FY2026" }], accounts: [{ accountNumber: "5000" }, { accountNumber: "9910" }, { accountNumber: null }] },
      new Date("2026-03-01T00:00:00Z")
    )
    expect(result.fiscalYearCreated).toBe(false)
    expect(result.accountsCreated).toBe(5)
    const accountValues = fake.inserted[0].values as { accountNumber: string }[]
    expect(accountValues.map((a) => a.accountNumber)).toEqual(["1000", "2000", "3000", "4000", "6000"])
  })

  test("an org with accounts but no fiscal year gets only the year", async () => {
    const { result, fake } = await run(
      { years: [], accounts: DEFAULT_CHART_OF_ACCOUNTS.map((a) => ({ accountNumber: a.accountNumber })) },
      new Date("2027-07-04T00:00:00Z")
    )
    expect(result).toEqual({ fiscalYearCreated: true, accountsCreated: 0 })
    expect(fake.inserted.length).toBe(1)
    expect(fake.inserted[0].values).toMatchObject({ yearName: "FY2027", startDate: "2027-01-01", endDate: "2027-12-31", isClosed: false })
  })
})

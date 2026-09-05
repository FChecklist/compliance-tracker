/// <reference types="bun-types" />
// R-61 (R75 batch W103, "currency as org data, not hardcoded logic"):
// pins the two structural facts that make R-61's claim true rather than
// aspirational.
//
//   1. compliance.erp_currencies is a REAL per-org data table (org_id,
//      code, is_base_currency columns all NOT NULL, is_base_currency
//      defaulting false) -- introspected via drizzle's own getTableConfig
//      against the schema.ts table object, not re-typed by hand, so this
//      breaks the moment the actual column shape drifts.
//   2. getBaseCurrency() (this file, R53 / R48_NO_CURRENCY_UI_01) resolves
//      an org's currency by reading THAT org's own erp_currencies row --
//      two different orgIds genuinely get two different, org-specific
//      results back, proving the value is stored per-org data flowing
//      through the query, not a shared constant or hardcoded branch.
//
// getBaseCurrency is NOT gated behind requireErpEnabled (see this file's
// own doc comment above it), so only @/lib/db/tenant-scoped's
// withTenantContext needs mocking here -- same minimal-mock shape as
// erp-budget-service.test.ts's "constant query count" describe block
// (capture the real module, spread it, override just withTenantContext,
// restore in afterEach).
import { describe, test, expect, mock, afterEach } from "bun:test"
import { getTableConfig } from "drizzle-orm/pg-core"
import { erpCurrencies, organisations } from "@/lib/db/schema"

describe("compliance.erp_currencies -- currency lives in an org-scoped data row, not hardcoded logic", () => {
  test("erp_currencies is a table in the 'compliance' schema with org_id, code and is_base_currency columns", () => {
    const cfg = getTableConfig(erpCurrencies)
    expect(cfg.schema).toBe("compliance")
    expect(cfg.name).toBe("erp_currencies")

    const byName = new Map(cfg.columns.map((c) => [c.name, c]))
    expect(byName.has("org_id")).toBe(true)
    expect(byName.get("org_id")?.notNull).toBe(true)
    expect(byName.has("code")).toBe(true)
    expect(byName.get("code")?.notNull).toBe(true)
    // The stored field an org declares its operating currency via.
    expect(byName.has("is_base_currency")).toBe(true)
    expect(byName.get("is_base_currency")?.notNull).toBe(true)
    expect(byName.get("is_base_currency")?.default).toBe(false)
  })

  test("compliance.organisations has NO currency column of its own -- currency is not duplicated as org-table logic", () => {
    const orgCfg = getTableConfig(organisations)
    const currencyLike = orgCfg.columns.filter((c) => c.name.toLowerCase().includes("currency"))
    expect(currencyLike).toEqual([])
  })
})

const realTenantScoped = await import("@/lib/db/tenant-scoped")

describe("getBaseCurrency -- reads the calling org's OWN stored row, not a shared/hardcoded value", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  })

  test("two different orgs each get back their own distinct, stored currency code", async () => {
    const STORE: Record<string, { code: string; name: string } | undefined> = {
      "org-aed": { code: "AED", name: "UAE Dirham" },
      "org-usd": { code: "USD", name: "US Dollar" },
    }

    const withTenantContext = mock(async (ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) =>
      fn({
        query: {
          erpCurrencies: {
            findFirst: mock(async () => {
              const row = STORE[ctx.orgId]
              return row ? { id: `${ctx.orgId}-cur`, code: row.code, name: row.name, symbol: row.code } : undefined
            }),
          },
          organisations: { findFirst: mock(async () => ({ id: ctx.orgId, country: null })) },
        },
      })
    )
    await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext }))

    const { getBaseCurrency } = await import("./erp-accounting-service")

    const aed = await getBaseCurrency({ orgId: "org-aed" })
    const usd = await getBaseCurrency({ orgId: "org-usd" })

    expect(aed.baseCurrency?.code).toBe("AED")
    expect(usd.baseCurrency?.code).toBe("USD")
    // The point of R-61: these differ because each org's own stored row is
    // read, not because of any hardcoded per-call branch.
    expect(aed.baseCurrency?.code).not.toBe(usd.baseCurrency?.code)
  })
})

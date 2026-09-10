/// <reference types="bun-types" />
// R-63 (R75 batch W103, "org with no erp_currencies isBaseCurrency=true row
// -> UI currency lookup falls back to rupee"), service-level reproduction
// with a synthetic test org rather than reading the real projexa_demo_org
// row (that org's live data is not something a .test.ts file should assert
// on, and its state can drift independently of this code path).
//
// getClientPortalData() (this file) is the one place THE FIRM's tokenized,
// no-session client-portal route resolves an org's base currency --
// directly querying erp_currencies for a row with isBaseCurrency=true (see
// this function's own header comment: "Priority 17 re-sweep fix ... queried
// directly here"). Its result is returned to the browser completely
// unwrapped by /api/client-portal/[token]/route.ts
// (`NextResponse.json(data)`, no transform), and
// src/app/client-portal/[token]/page.tsx:24 renders it through:
//
//     function currencyLabel(baseCurrencyCode: string | null): string {
//       return baseCurrencyCode ? `${baseCurrencyCode} ` : "₹";
//     }
//
// -- i.e. a null baseCurrencyCode IS, concretely, the rupee-symbol
// fallback on screen. That page.tsx helper is not exported and lives
// outside this task's allowed src/lib|src/app/api test-file scope, so it
// cannot be exercised directly from here -- this test instead pins the
// service-level root cause precisely at the boundary this task's file
// restrictions allow: for a test org with NO erp_currencies row with
// isBaseCurrency=true, getClientPortalData() returns baseCurrencyCode:
// null, which is exactly the value that page.tsx's currencyLabel() above
// turns into "₹".
//
// Mocks @/lib/db's `db` export only (spreading the REAL module for every
// other export -- firm-client-portal-service.ts's own dependency chain
// reaches @/lib/supabase/auth-guard.ts -> ./api-key-auth.ts, which needs
// `apiKeyRequestLog` from this same module, so replacing the whole module
// with a hand-picked subset breaks that unrelated import; spreading the
// real module and overriding just `db`, same shape as
// erp-budget-service.test.ts's "capture the real module, override one
// export" pattern applied to @/lib/db instead of @/lib/db/tenant-scoped),
// matching org-branding-service.test.ts's established "mock @/lib/db,
// dynamic-import the service after" shape for the underlying "never touch
// a live DB from a .test.ts file" reason.
import { describe, test, expect, mock, afterEach } from "bun:test"

const realDb = await import("@/lib/db")

function futureDate(): Date {
  return new Date(Date.now() + 1000 * 60 * 60 * 24 * 7)
}

afterEach(async () => {
  mock.restore()
  await mock.module("@/lib/db", () => realDb)
})

describe("getClientPortalData -- org with no isBaseCurrency=true row (R-63 root cause)", () => {
  test("a test org with zero erp_currencies rows gets baseCurrencyCode: null -- the value the UI renders as the rupee-fallback", async () => {
    const LINK = { clientId: "client-1", revokedAt: null, expiresAt: futureDate(), token: "tok-test-org-no-currency" }
    const CLIENT = { id: "client-1", name: "Test Co", orgId: "org-test-no-currency-row" }

    mock.module("@/lib/db", () => ({
      ...realDb,
      db: {
        query: {
          firmClientPortalLinks: { findFirst: mock(async () => LINK) },
          clients: { findFirst: mock(async () => CLIENT) },
          firmEngagements: { findMany: mock(async () => []) },
          firmEngagementDeliverables: { findMany: mock(async () => []) },
          firmInvoices: { findMany: mock(async () => []) },
          documents: { findMany: mock(async () => []) },
          // The R-63 condition itself: this org has no row where
          // isBaseCurrency=true, so the query genuinely finds nothing.
          erpCurrencies: { findFirst: mock(async () => undefined) },
        },
      },
    }))

    const { getClientPortalData } = await import("./firm-client-portal-service")
    const result = await getClientPortalData("tok-test-org-no-currency")

    expect(result.baseCurrencyCode).toBeNull()
  })

  test("contrast: a test org that DOES have an isBaseCurrency=true row gets that row's own code back, not null", async () => {
    const LINK = { clientId: "client-2", revokedAt: null, expiresAt: futureDate(), token: "tok-test-org-with-currency" }
    const CLIENT = { id: "client-2", name: "Other Co", orgId: "org-test-with-currency-row" }

    mock.module("@/lib/db", () => ({
      ...realDb,
      db: {
        query: {
          firmClientPortalLinks: { findFirst: mock(async () => LINK) },
          clients: { findFirst: mock(async () => CLIENT) },
          firmEngagements: { findMany: mock(async () => []) },
          firmEngagementDeliverables: { findMany: mock(async () => []) },
          firmInvoices: { findMany: mock(async () => []) },
          documents: { findMany: mock(async () => []) },
          erpCurrencies: { findFirst: mock(async () => ({ id: "cur-1", code: "AED", name: "UAE Dirham", symbol: "AED" })) },
        },
      },
    }))

    const { getClientPortalData } = await import("./firm-client-portal-service")
    const result = await getClientPortalData("tok-test-org-with-currency")

    expect(result.baseCurrencyCode).toBe("AED")
  })
})

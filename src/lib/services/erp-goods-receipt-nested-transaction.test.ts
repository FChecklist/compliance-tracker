/// <reference types="bun-types" />
// R81_F25 REGRESSION TEST -- two services sharing ONE withTenantContext
// transaction, against a REAL database.
//
// THE DEFECT. submitPurchaseReceipt (erp-goods-receipt-service.ts) holds a
// withTenantContext transaction and calls recordStockReceipt (erp-inventory-
// service.ts) for every receipt line that names a stock item.
// recordStockReceipt used to open a SECOND transaction for the same org;
// assertNotNested (src/lib/db/tenant-scoped.ts) throws on that in dev and
// test. In production the whole submit 500'd and left the database in the
// worst possible shape: PO still at 'draft', received_quantity 0, the receipt
// stranded at 'draft', and zero erp_stock_ledger_entries rows. Fixed in
// 6b56c00b by threading the open handle down (recordStockReceipt's optional
// third `existingDb` argument).
//
// WHY THIS TEST HAS TO TOUCH A REAL DATABASE. The bug shipped because nothing
// in this suite exercises two services sharing one transaction. It cannot be
// caught with a mocked db: the failure only exists when a real
// withTenantContext is ALREADY open, because the guard it trips
// (AsyncLocalStorage in tenant-scoped.ts) is armed by withTenantContext
// itself -- mock that away and the guard never arms. Browser E2E did catch it,
// but only after it reached the product, and it needs ~1GB of RAM. So this
// sits at the service layer, against a live app_runtime connection, and calls
// the same exported functions the route handlers call.
//
// WHY IT SKIPS INSTEAD OF FAILING WITHOUT A DATABASE. CI runs
// `bun test --isolate` with placeholder DB env vars (see .github/workflows/
// ci.yml -- postgresql://app_runtime:placeholder@localhost:5432/postgres),
// deliberately, so that importing src/lib/db/index.ts does not throw at module
// load. Nothing is listening there. A test that went red in CI for want of a
// database would be worse than no test at all: it would be turned off. So this
// file probes the connection first and skips the whole describe with a printed
// reason when it cannot reach one. The reason is always printed -- a silent
// skip is how a test quietly stops testing.
//
// WHY IT LOADS .env.local ITSELF. `bun test` sets NODE_ENV=test, and bun does
// not read .env.local under NODE_ENV=test (confirmed empirically in this repo:
// inside `bun test`, APP_RUNTIME_DATABASE_URL is undefined with no explicit
// env, while `bun run` sees it). Existing scripts here rely on the `bun run`
// behaviour instead -- scripts/backfill-platform-assets.ts's own header says
// "reads .env.local automatically, same as `bun run dev`". This is the same
// source of truth, read explicitly, and only for keys the environment has not
// already set -- so CI's placeholders always win and a real CI value is never
// overridden.
//
// NODE_ENV MATTERS TO THE ASSERTION ITSELF. assertNotNested throws only when
// NODE_ENV is "development" or "test"; in production it warns and continues.
// `bun test` gives us "test", which is exactly the branch that throws -- that
// is what makes this file able to fail when the fix is reverted, and it is
// asserted explicitly below rather than assumed.
import { describe, expect, test, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

// bun's default 5 s per test/hook is a mocked-db budget. The setup hook here
// makes ~15 round trips to a remote Postgres (Supabase's ap-south-1 pooler in
// this repo's case) through the real service layer, and the teardown hook makes
// several more. 120 s is generous on purpose: a slow link must not turn into a
// flaky red that gets the file disabled. When the database is unreachable the
// whole describe is skipped before any of this runs, so nothing ever sits here
// waiting out a timeout.
setDefaultTimeout(120_000)

const REPO_ROOT = join(import.meta.dir, "..", "..", "..")

/** Fills in DB connection strings from .env.local for keys the environment has
 *  not already set. Never overrides an existing value (CI's placeholders win). */
function loadDbEnvFromEnvLocalIfAbsent(): void {
  const path = join(REPO_ROOT, ".env.local")
  if (!existsSync(path)) return
  const wanted = new Set(["APP_RUNTIME_DATABASE_URL", "DATABASE_URL"])
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    const key = match[1]
    if (!wanted.has(key) || process.env[key]) continue
    let value = match[2].trim()
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
    if (quoted) value = value.slice(1, -1)
    if (value.length > 0) process.env[key] = value
  }
}
loadDbEnvFromEnvLocalIfAbsent()

// The org this runs against. Overridable so the file is not welded to one
// database: R81_F25_TEST_ORG_ID wins when set. The default is this repo's
// long-standing ERP-enabled E2E tenant (compliance.organisations
// 4ecc472f-4152-4310-ae8d-cf8b7c52ab6d, "Meridian Construction Group (E2E Test
// Org)") -- the same org the ERP Playwright specs already drive.
const ORG_ID = process.env.R81_F25_TEST_ORG_ID ?? "4ecc472f-4152-4310-ae8d-cf8b7c52ab6d"

/** A distinctive rate, so a valuation layer that opened at 0 -- the silent-
 *  corruption case where the PO-rate fallback failed but nothing threw --
 *  cannot be mistaken for a real one. */
const PO_LINE_RATE = 211

const RECEIVED_QTY = 5
const ORDERED_QTY = 8 // deliberately more than received, so the PO lands on partially_received
const FREE_TEXT_QTY = 3
const FREE_TEXT_RATE = 40

/** Returns null when a database answered, else the reason to skip.
 *
 *  Retried, because a single dropped connection to a remote pooler would
 *  otherwise silently downgrade this file to "8 skipped" and it would look
 *  green while testing nothing. Three attempts with a short backoff separates
 *  a blip from a genuinely absent database; CI's placeholder host refuses the
 *  connection immediately, so all three attempts there cost milliseconds. */
async function probeDatabase(): Promise<string | null> {
  const url = process.env.APP_RUNTIME_DATABASE_URL
  if (!url) return "APP_RUNTIME_DATABASE_URL is not set"
  const postgres = (await import("postgres")).default
  let lastError = "unknown error"
  for (let attempt = 1; attempt <= 3; attempt++) {
    const probe = postgres(url, {
      prepare: false,
      ssl: { rejectUnauthorized: false },
      max: 1,
      connect_timeout: 20,
      idle_timeout: 1,
    })
    try {
      await probe`select 1`
      await probe.end({ timeout: 5 })
      return null
    } catch (error) {
      // postgres.js often reports a bare code (ECONNREFUSED) with an empty
      // message, which would make the skip line say nothing useful.
      const code = (error as { code?: unknown } | null)?.code
      const message = error instanceof Error ? error.message : String(error)
      lastError = [code, message].filter((part) => part !== undefined && part !== "").join(" ") || "unknown error"
      try {
        await probe.end({ timeout: 5 })
      } catch {
        // the probe already failed; how it closes is not interesting
      }
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }
  return `no reachable database after 3 attempts (${lastError})`
}

let skipReason = await probeDatabase()

// Imported only once a database has answered: importing these transitively
// builds the src/lib/db/index.ts client at module load, which throws without a
// connection string.
const goodsReceipt = skipReason ? null : await import("./erp-goods-receipt-service")
const enablement = skipReason ? null : await import("./erp-enablement-service")
const tenantScoped = skipReason ? null : await import("@/lib/db/tenant-scoped")
const dbSchema = skipReason ? null : await import("@/lib/db")
const orm = skipReason ? null : await import("drizzle-orm")

type UserRow = { id: string; name: string; role: string }

/** Confirms the org is usable before anything is written: ERP enabled, plus one
 *  each of the master records this flow needs. Returns a skip reason, or null. */
async function checkOrgIsUsable(): Promise<string | null> {
  const { withTenantContext } = tenantScoped!
  const { erpItems, erpWarehouses, erpSuppliers, users } = dbSchema!
  const { and, eq } = orm!

  if (!(await enablement!.isErpEnabledForOrg(ORG_ID))) {
    return `the 'erp' product branch is not enabled for org ${ORG_ID}`
  }

  return withTenantContext({ orgId: ORG_ID }, async (db) => {
    const user = await db.query.users.findFirst({ where: and(eq(users.orgId, ORG_ID), eq(users.isActive, true)) })
    if (!user) return `org ${ORG_ID} has no active user to act as`
    const supplier = await db.query.erpSuppliers.findFirst({ where: eq(erpSuppliers.orgId, ORG_ID) })
    if (!supplier) return `org ${ORG_ID} has no erp_suppliers row`
    // A batch/serial-tracked item would demand extra input from
    // recordStockReceipt; a non-stock item posts no ledger row at all.
    const item = await db.query.erpItems.findFirst({
      where: and(
        eq(erpItems.orgId, ORG_ID),
        eq(erpItems.isStockItem, true),
        eq(erpItems.hasBatchNo, false),
        eq(erpItems.hasSerialNo, false)
      ),
    })
    if (!item) return `org ${ORG_ID} has no plain (non-batch, non-serial) stock item`
    const warehouse = await db.query.erpWarehouses.findFirst({
      where: and(eq(erpWarehouses.orgId, ORG_ID), eq(erpWarehouses.isGroup, false)),
    })
    if (!warehouse) return `org ${ORG_ID} has no leaf erp_warehouses row`
    return null
  })
}

if (!skipReason) skipReason = await checkOrgIsUsable()
if (skipReason) {
  console.warn(
    `[R81_F25 integration test] SKIPPED -- ${skipReason}. This file needs a live app_runtime database; ` +
      `it skips rather than fails so CI's placeholder credentials stay green.`
  )
}

describe.skipIf(skipReason !== null)(
  "R81_F25: submitPurchaseReceipt and recordStockReceipt share one transaction (real DB)",
  () => {
    const created = {
      purchaseOrderId: null as string | null,
      receiptId: null as string | null,
      ledgerEntryIds: [] as string[],
    }
    let itemId = ""
    let stockPoItemId = ""
    let freeTextPoItemId = ""
    /** null means submitPurchaseReceipt resolved; anything else is what it threw. */
    let submitError: unknown = null
    let submittedReceipt: { status?: string } | null = null

    beforeAll(async () => {
      const { withTenantContext } = tenantScoped!
      const {
        erpPurchaseOrders,
        erpPurchaseOrderItems,
        erpStockLedgerEntries,
        erpItems,
        erpWarehouses,
        erpSuppliers,
        users,
      } = dbSchema!
      const { and, eq, sql } = orm!

      // Fixtures: reuse this org's existing master data and create only the two
      // documents under test, so cleanup is a closed, enumerable set of rows.
      const seeded = await withTenantContext({ orgId: ORG_ID }, async (db) => {
        const user = (await db.query.users.findFirst({
          where: and(eq(users.orgId, ORG_ID), eq(users.isActive, true)),
        }))!
        const supplier = (await db.query.erpSuppliers.findFirst({ where: eq(erpSuppliers.orgId, ORG_ID) }))!
        const item = (await db.query.erpItems.findFirst({
          where: and(
            eq(erpItems.orgId, ORG_ID),
            eq(erpItems.isStockItem, true),
            eq(erpItems.hasBatchNo, false),
            eq(erpItems.hasSerialNo, false)
          ),
        }))!
        const warehouse = (await db.query.erpWarehouses.findFirst({
          where: and(eq(erpWarehouses.orgId, ORG_ID), eq(erpWarehouses.isGroup, false)),
        }))!

        const [{ maxNumber }] = await db
          .select({ maxNumber: sql<number>`coalesce(max(${erpPurchaseOrders.poNumber}), 0)` })
          .from(erpPurchaseOrders)
          .where(eq(erpPurchaseOrders.orgId, ORG_ID))

        const [po] = await db
          .insert(erpPurchaseOrders)
          .values({
            orgId: ORG_ID,
            supplierId: supplier.id,
            poNumber: Number(maxNumber) + 1,
            orderDate: "2026-09-08",
            status: "draft",
            grandTotal: (ORDERED_QTY * PO_LINE_RATE + FREE_TEXT_QTY * FREE_TEXT_RATE).toString(),
            createdById: user.id,
          })
          .returning()

        const poItems = await db
          .insert(erpPurchaseOrderItems)
          .values([
            {
              purchaseOrderId: po.id,
              itemId: item.id,
              description: "R81_F25 integration test -- stock line",
              quantity: ORDERED_QTY.toString(),
              rate: PO_LINE_RATE.toString(),
              amount: (ORDERED_QTY * PO_LINE_RATE).toString(),
            },
            {
              // itemId deliberately absent: the free-text half of the split
              // this fix rests on -- it must credit the order and post no stock.
              purchaseOrderId: po.id,
              description: "R81_F25 integration test -- free-text line (no stock item)",
              quantity: FREE_TEXT_QTY.toString(),
              rate: FREE_TEXT_RATE.toString(),
              amount: (FREE_TEXT_QTY * FREE_TEXT_RATE).toString(),
            },
          ])
          .returning()

        return { user: user as unknown as UserRow, supplier, item, warehouse, po, poItems }
      })

      itemId = seeded.item.id
      created.purchaseOrderId = seeded.po.id
      stockPoItemId = seeded.poItems.find((i) => i.itemId !== null)!.id
      freeTextPoItemId = seeded.poItems.find((i) => i.itemId === null)!.id

      const ctx = {
        orgId: ORG_ID,
        userId: seeded.user.id,
        dbUser: seeded.user as unknown as Parameters<typeof goodsReceipt.createPurchaseReceipt>[0]["dbUser"],
      }

      // Created through the real service rather than hand-inserted, so what is
      // submitted is shaped exactly like a receipt the product would produce.
      const receipt = await goodsReceipt!.createPurchaseReceipt(ctx, {
        supplierId: seeded.supplier.id,
        purchaseOrderId: created.purchaseOrderId!,
        postingDate: "2026-09-08",
        items: [
          {
            // `rate` deliberately OMITTED: this forces submitPurchaseReceipt's
            // PO-item rate fallback, which is what must reach recordStockReceipt
            // for the valuation layer to open at 211 instead of 0.
            purchaseOrderItemId: stockPoItemId,
            itemId,
            quantity: RECEIVED_QTY,
            warehouseId: seeded.warehouse.id,
          },
          {
            purchaseOrderItemId: freeTextPoItemId,
            quantity: FREE_TEXT_QTY,
            warehouseId: seeded.warehouse.id,
          },
        ],
      })
      created.receiptId = receipt.id

      // THE CALL UNDER TEST. Recorded rather than allowed to throw out of
      // beforeAll, so every assertion below still runs and reports the real
      // post-failure database state -- which IS the production symptom (PO at
      // draft, 0 received, no ledger rows), not merely "it threw".
      try {
        submittedReceipt = await goodsReceipt!.submitPurchaseReceipt(ctx, created.receiptId!)
      } catch (error) {
        submitError = error
      }

      const ledgerRows = await withTenantContext({ orgId: ORG_ID }, (db) =>
        db.query.erpStockLedgerEntries.findMany({
          where: and(
            eq(erpStockLedgerEntries.orgId, ORG_ID),
            eq(erpStockLedgerEntries.voucherId, created.receiptId!)
          ),
        })
      )
      created.ledgerEntryIds = ledgerRows.map((r) => r.id)
    })

    afterAll(async () => {
      if (!tenantScoped) return
      const { withTenantContext } = tenantScoped
      const {
        erpPurchaseOrders,
        erpPurchaseOrderItems,
        erpPurchaseReceipts,
        erpPurchaseReceiptItems,
        erpStockLedgerEntries,
        erpStockValuationLayers,
      } = dbSchema!
      const { and, eq, inArray } = orm!

      // Every row this file created, removed in dependency order. Nothing else
      // in the org is touched: the master records were reused, never written.
      //
      // THE ONE EXCEPTION, DISCLOSED RATHER THAN HIDDEN: the audit_logs rows
      // logActivity() writes from inside createPurchaseReceipt /
      // submitPurchaseReceipt / recordStockReceipt are NOT deleted, because
      // they cannot be -- compliance.audit_logs grants app_runtime only
      // INSERT and SELECT (verified: information_schema.role_table_grants
      // shows INSERT,SELECT for app_runtime and service_role; only `postgres`
      // holds DELETE). That is the audit trail being deliberately append-only,
      // not an oversight here, and attempting the delete raises 42501
      // "permission denied for table audit_logs". So a passing run leaves up
      // to three audit rows behind, each pointing at an entity id that no
      // longer exists -- which is exactly what audit_logs' own denormalised-
      // snapshot design expects of any deleted entity.
      await withTenantContext({ orgId: ORG_ID }, async (db) => {
        if (created.ledgerEntryIds.length > 0) {
          await db
            .delete(erpStockValuationLayers)
            .where(inArray(erpStockValuationLayers.stockLedgerEntryId, created.ledgerEntryIds))
        }
        if (created.receiptId) {
          await db
            .delete(erpStockLedgerEntries)
            .where(and(eq(erpStockLedgerEntries.orgId, ORG_ID), eq(erpStockLedgerEntries.voucherId, created.receiptId)))
          await db.delete(erpPurchaseReceiptItems).where(eq(erpPurchaseReceiptItems.receiptId, created.receiptId))
          await db
            .delete(erpPurchaseReceipts)
            .where(and(eq(erpPurchaseReceipts.orgId, ORG_ID), eq(erpPurchaseReceipts.id, created.receiptId)))
        }
        if (created.purchaseOrderId) {
          await db
            .delete(erpPurchaseOrderItems)
            .where(eq(erpPurchaseOrderItems.purchaseOrderId, created.purchaseOrderId))
          await db
            .delete(erpPurchaseOrders)
            .where(and(eq(erpPurchaseOrders.orgId, ORG_ID), eq(erpPurchaseOrders.id, created.purchaseOrderId)))
        }
      })
    })

    // Precondition, not decoration: assertNotNested only THROWS under
    // development/test. Under any other NODE_ENV it merely warns, every
    // assertion below would pass against the BROKEN code, and this file would
    // be proving nothing. So assert the branch we are on rather than assume it.
    test("runs under NODE_ENV=test, the branch where assertNotNested actually throws", () => {
      expect(process.env.NODE_ENV).toBe("test")
    })

    test("1. submitPurchaseReceipt completes without throwing", () => {
      if (submitError) {
        const message = submitError instanceof Error ? submitError.message : String(submitError)
        throw new Error(`submitPurchaseReceipt threw instead of completing: ${message}`)
      }
      expect(submitError).toBeNull()
      expect(submittedReceipt?.status).toBe("submitted")
    })

    test("2. the purchase order advances past 'draft'", async () => {
      const { withTenantContext } = tenantScoped!
      const { erpPurchaseOrders } = dbSchema!
      const { and, eq } = orm!
      const po = await withTenantContext({ orgId: ORG_ID }, (db) =>
        db.query.erpPurchaseOrders.findFirst({
          where: and(eq(erpPurchaseOrders.orgId, ORG_ID), eq(erpPurchaseOrders.id, created.purchaseOrderId!)),
        })
      )
      expect(po?.status).not.toBe("draft")
      expect(["partially_received", "completed"]).toContain(po?.status)
    })

    test("3. erp_purchase_order_items.received_quantity is credited on both lines", async () => {
      const { withTenantContext } = tenantScoped!
      const { erpPurchaseOrderItems } = dbSchema!
      const { eq } = orm!
      const rows = await withTenantContext({ orgId: ORG_ID }, (db) =>
        db.query.erpPurchaseOrderItems.findMany({
          where: eq(erpPurchaseOrderItems.purchaseOrderId, created.purchaseOrderId!),
        })
      )
      const stockLine = rows.find((r) => r.id === stockPoItemId)
      const freeTextLine = rows.find((r) => r.id === freeTextPoItemId)
      expect(Number(stockLine?.receivedQuantity)).toBe(RECEIVED_QTY)
      // 5a. The complementary half of the split: a free-text line still credits
      // the order it was raised against.
      expect(Number(freeTextLine?.receivedQuantity)).toBe(FREE_TEXT_QTY)
    })

    test("4. a stock ledger entry exists at the PO line's real rate, not 0", async () => {
      const { withTenantContext } = tenantScoped!
      const { erpStockLedgerEntries, erpStockValuationLayers } = dbSchema!
      const { and, eq, inArray } = orm!
      const entries = await withTenantContext({ orgId: ORG_ID }, (db) =>
        db.query.erpStockLedgerEntries.findMany({
          where: and(
            eq(erpStockLedgerEntries.orgId, ORG_ID),
            eq(erpStockLedgerEntries.voucherId, created.receiptId!)
          ),
        })
      )
      expect(entries.length).toBeGreaterThanOrEqual(1)
      const entry = entries.find((e) => e.itemId === itemId)
      expect(entry).toBeDefined()
      expect(Number(entry!.quantityChange)).toBe(RECEIVED_QTY)
      // THE LOAD-BEARING ASSERTION. A FIFO layer opening at 0 means the PO-rate
      // fallback silently failed -- the silent-corruption case, which no HTTP
      // status code would ever have revealed.
      expect(Number(entry!.valuationRate)).toBe(PO_LINE_RATE)
      expect(Number(entry!.valuationRate)).not.toBe(0)

      const layers = await withTenantContext({ orgId: ORG_ID }, (db) =>
        db.query.erpStockValuationLayers.findMany({
          where: inArray(
            erpStockValuationLayers.stockLedgerEntryId,
            entries.map((e) => e.id)
          ),
        })
      )
      expect(layers.length).toBe(1)
      expect(Number(layers[0].rate)).toBe(PO_LINE_RATE)
      expect(Number(layers[0].originalQty)).toBe(RECEIVED_QTY)
    })

    test("5. the free-text line (no itemId) posts NO stock ledger row", async () => {
      const { withTenantContext } = tenantScoped!
      const { erpStockLedgerEntries } = dbSchema!
      const { and, eq } = orm!
      const entries = await withTenantContext({ orgId: ORG_ID }, (db) =>
        db.query.erpStockLedgerEntries.findMany({
          where: and(
            eq(erpStockLedgerEntries.orgId, ORG_ID),
            eq(erpStockLedgerEntries.voucherId, created.receiptId!)
          ),
        })
      )
      // Two received lines, one of them free-text -> exactly one ledger row,
      // belonging to the stock line. This is what would catch a "fix" that
      // simply posted stock for every line regardless of itemId.
      expect(entries.length).toBe(1)
      expect(entries[0].itemId).toBe(itemId)
    })
  }
)

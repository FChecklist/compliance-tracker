# PROGRESS -- task-20260727-122632-projexa-e2e--hierarchical-boq-breakdown

## Completed
- [x] Read ai-os/boss/ACTIVE-CLAIMS.yaml, confirmed no collision, registered claim
- [x] Explored existing code: constructionBoqLineItems schema, construction-boq-service.ts,
      erp-invoicing-service.ts (createSalesInvoice -- reused for interim-bill invoice emission,
      NOT firm-billing-service.ts's firm_invoices, since erpSalesInvoices already has a
      projectId column from Wave 120 PROJEXA Revenue Report -- confirmed by
      construction-dashboard-service.ts already reading it for per-project revenue),
      spreadsheet-adapter.ts/column-mapper.ts/ingest/parser.ts (Excel import pattern)
- [x] bun was missing from this sandbox (only bunx existed) -- installed via bun.sh/install,
      added to PATH; `bun install` ran clean (1220 packages)
- [x] Schema: added parentLineItemId + breakdownPercentage to constructionBoqLineItems;
      new constructionInterimBills + constructionInterimBillLineItems tables + relations
- [x] Migration drizzle/0265_construction_boq_hierarchy_interim_billing.sql -- HAND-WRITTEN,
      not raw drizzle-kit output: discovered drizzle/meta/ is missing every per-migration
      snapshot from 0001-0264 (only 0000_snapshot.json ever committed -- a prior repair
      commit fixed _journal.json's tags but not the snapshots), so `drizzle-kit generate`
      diffs against a near-empty baseline and tries to recreate the entire 457-table schema.
      Wrote a minimal correct migration by hand instead (ALTER TABLE x2 + CREATE TABLE x2 +
      indexes + RLS, modeled on 0101_wave115_construction_boq_progress_diary.sql's exact
      conventions) and kept the freshly-generated 0265_snapshot.json (verified accurate: 457
      tables, has the new columns/tables) as the new baseline for future `generate` calls.
      Did NOT attempt to backfill the other 264 missing historical snapshots -- out of scope.
- [x] construction-boq-service.ts: computeHierarchicalAmount() (root-Main-based formula,
      handles multi-level nesting + circular-ref/missing-parent errors), insertLineItems()
      rewritten for parent-before-child topological insert order (real DB ids for
      parentLineItemId), diffLineItems() extracted as a pure hierarchy-aware diff
      (breakdownPercentageChange + isSubItem flag)
- [x] construction-boq-service.test.ts: 11 tests, all passing -- exact Owner formula
      (40/35/25% summing to main amount), multi-level nesting, circular-ref/missing-parent
      errors, diff detecting breakdown-%-only changes

## Remaining
- [ ] construction-valuation-service.ts: interim/RA billing + retention % + invoice emission
      via erp-invoicing-service.ts's createSalesInvoice
- [ ] API routes for hierarchical BoQ create/revision (verify existing routes still pass
      parentItemCode/breakdownPercentage through) + interim-bill generation route
- [ ] Excel BoQ importer: service + API route (model on spreadsheet-adapter.ts, infer
      parent from dot-delimited item codes e.g. "2.1" under "2")
- [ ] Tests: interim-bill + retention math, Excel import (hierarchical rows)
- [ ] npx tsc --noEmit clean, bun test passing, get_advisors(security) clean
- [ ] Open PR

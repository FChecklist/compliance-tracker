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

- [x] construction-valuation-service.ts: interim/RA billing + retention % + invoice emission
      via erp-invoicing-service.ts's createSalesInvoice (reuses erpSalesInvoices, not a new
      table). 10 pure-function tests, all passing.
- [x] Verified existing /api/construction/boq and /api/v1/construction/boq routes need no
      changes -- they already pass the request body straight through to
      createBoq/createBoqRevision, so parentItemCode/breakdownPercentage flow through
      transparently.
- [x] New API routes: GET/POST /api/construction/interim-bills, GET
      /api/construction/interim-bills/[id], POST /api/construction/boq/import (multipart
      xlsx/csv upload -> parse -> createBoq or createBoqRevision)
- [x] Excel BoQ importer: construction-boq-import-service.ts + API route. 5 tests including
      a real in-memory xlsx buffer parsed end to end.
- [x] npx tsc --noEmit clean (had to raise Node heap via NODE_OPTIONS=--max-old-space-size,
      default heap OOMs on this project's size), bun test: 2128 pass / 0 fail (full suite,
      no regressions), eslint clean on all new/changed files

## Remaining / handed back to the Owner
- [ ] This task's migration (drizzle/0265_*.sql) has NOT been applied to any live Supabase
      project (verdian-ai / evpckeuxgvahguwsaeul). Applying a migration to production is a
      not-cleanly-reversible action outside a worker session's authority per this repo's own
      deploy-gate convention (AGENTS.md Rule 7(e)) -- needs the Owner's explicit go-ahead, same
      as every other schema change in this repo's history that touched a live project.
- [ ] Because the migration is unapplied, `get_advisors(security)` has NOT been run
      post-migration (running it now would only show the pre-existing baseline, not evaluate
      the new tables' RLS -- and applying the migration itself requires the sign-off above).
      The new tables' RLS policies were hand-verified against
      0101_wave115_construction_boq_progress_diary.sql's exact established pattern instead
      (tenant-isolation policy on construction_interim_bills directly by org_id; EXISTS-join
      policy on construction_interim_bill_line_items via its parent, matching
      construction_boq_line_items' own policy shape).
- [ ] Open PR

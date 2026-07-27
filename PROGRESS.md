# PROGRESS -- task-20260727-101123-erp-project-management-gaps--timesheet-t

## Completed
- [x] Gap 1 -- PMS timesheet -> client invoice: `src/lib/services/pms-invoice-service.ts`
  (`generateInvoiceFromUnbilledProjectTime`), modeled on
  `firm-billing-service.ts`'s `generateInvoiceFromUnbilledTime()`. Reuses the
  existing `erp_sales_invoices`/`erp_sales_invoice_items` schema/service --
  no new invoice table. Added 3 additive columns to `pms_time_entries`
  (`billable`, `hourlyRateSnapshot`, `invoiceItemId`) mirroring
  `firm_time_entries`'s existing trio, migration
  `drizzle/0264_pms_timesheet_invoice_link.sql` (hand-authored -- see note
  below on why `drizzle-kit generate` wasn't used). `requireAuth()`-gated
  route: `POST /api/pms/invoices/generate`. Pure-function unit tests:
  `pms-time-service.test.ts` (rate resolution), `pms-invoice-service.test.ts`
  (line-building, rounding, missing-rate error, org-default fallback).
- [x] Gap 2 -- Gantt/critical-path UI: **already existed, no changes made.**
  Confirmed `getGanttData()` (`schedule-service.ts`) already returns
  `isCritical`/`floatDays` per task via `calculateCriticalPath()` -- did NOT
  extend it. Confirmed PROJEXA (`FChecklist/projexa`) already has a real,
  merged Gantt UI consuming `GET /api/v1/projexa/schedule/gantt`:
  `src/components/ScheduleGanttClient.tsx` + `src/app/(app)/schedule/page.tsx`
  (Timeline tab), proxied via `src/app/api/schedule/gantt/route.ts`, merged
  2026-07-09 as commit `e1572a4` on `origin/main` -- shows critical path as a
  grid column (isCritical/floatDays), a stats bar, and Capture Baseline.
  The task SPEC's KNOWN_CONTEXT claim of "zero .tsx Gantt matches" was based
  on grepping compliance-tracker itself, which has no UI at all (correct,
  but not the relevant repo) -- the real UI lives in the separate PROJEXA
  repo and was already shipped 18 days before this task's Phase 0
  investigation. No PROJEXA PR opened -- there is nothing to change.
- [x] Gap 3 -- Resource-allocation conflict/over-allocation detection:
  `detectResourceConflicts()`/`getResourceConflicts()` added to
  `schedule-service.ts`. Existing `getWorkload()` was scoped to a SINGLE
  project only -- the real, previously-undetected gap is a user who looks
  fine in every individual project's workload view while being double-/
  triple-booked once their allocations across ALL of an org's projects are
  summed for the same day. New pure function sums `allocatedHoursPerDay`
  per user per calendar day across every project passed in. Wired to:
  - `GET /api/pms/schedule/resource-conflicts` (compliance-tracker,
    `requireAuthOrApiKey`, which calls `requireAuth()` internally --
    same convention as every other route in `/api/pms/schedule/*`)
  - `GET /api/v1/projexa/schedule/resource-conflicts` (PROJEXA-facing v1
    surface, same convention as sibling `gantt`/`workload` routes)
  - `POST /api/pms/schedule/resource-allocations` and
    `POST /api/v1/projexa/schedule/workload` now both return a `conflicts`
    array in their response immediately after creating an allocation.
  Unit tests: `schedule-service.test.ts` -- deliberately-constructed
  overlapping over-allocation (flagged, correct total + project attribution,
  correct date-range boundary), non-overlapping legitimate case (not
  flagged), two-under-capacity-users case (not flagged), exactly-at-capacity
  boundary (not flagged, only strictly over), custom capacity override.

- `bunx tsc --noEmit` clean (0 errors) across the whole compliance-tracker
  repo -- confirmed via `NODE_OPTIONS="--max-old-space-size=8192"` (default
  heap OOMs on this repo's size in this sandbox; that's a sandbox-memory
  fact, not a code issue).
- `bun test` on all new/touched service test files: 17 pass / 0 fail.
- Migration numbering: `drizzle-kit generate` produced a full-schema dump
  (not an incremental diff) because this repo's `drizzle/meta/` only keeps
  a `0000_snapshot.json` baseline -- migrations 0001-0263 are hand-authored
  SQL with journal entries only, no per-migration snapshot. Followed that
  established convention: hand-wrote `drizzle/0264_pms_timesheet_invoice_link.sql`
  (ALTER TABLE + forward-referenced FK + index, same shape as
  `drizzle/0086`'s `firm_time_entries.invoice_line_item_id`), manually
  appended `drizzle/meta/_journal.json`. `node scripts/check-migration-collision.mjs`
  passes. **Not applied live** -- left for the supervising session/owner,
  same convention drizzle/0262 and drizzle/0263 already used for untested
  migrations in this repo.

## Remaining
- [ ] Real live-DB verification of the migration + invoice generation flow
  (this session only has pure-function unit coverage, per this repo's own
  "no live DB in .test.ts" convention -- confirmed via
  `erp-payment-entries-service.test.ts`'s own header note).
- [ ] Open the compliance-tracker PR (branch already pushed) and get the
  independent (non-self) audit comment per AGENTS.md Rule 7(c)/Rule 10.
- [ ] No PROJEXA PR needed (see Gap 2 above) -- confirm with owner this is
  understood as "nothing to build," not "skipped."

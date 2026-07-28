# PROGRESS -- task-20260727-190032-scope-of-works-revision-variation-tracki

## Completed
- Investigated first: PR #596 (`worker/task-20260727-122632-projexa-e2e--hierarchical-boq-breakdown`,
  merged as `df665722`) turned out to have **already built** most of what this task's SCOPE section
  asked for -- `constructionBoqs.parentBoqId`/`version` IS the revision chain, `createBoqRevision()`
  already exists, `diffLineItems()`/`compareBoq()` already compute an added/removed/changed diff with
  a per-item `netVariation`, and a "warn if scope already executed" check already joins against
  `constructionWorkProgressEntries.percentComplete` (the real work-progress data source the SCOPE
  section told me to look for before inventing a fake one -- it already exists, so no TODO/no-op
  needed here). Re-reading the SCOPE section against this, the real gaps were narrower than "build a
  revision/variation tracking feature from scratch":
  1. **The negative-variation guard was a soft warning only** -- `compareBoq()` returned a `warnings`
     string array, but `createBoqRevision()` never looked at it, so a revision that reduced or removed
     already-completed scope was applied silently unless a caller separately called `GET .../compare`
     afterwards. This directly contradicted the Owner's explicit "should be blocked or require explicit
     override, not silently applied."
  2. **`compareBoq()` only compared a revision against its immediate parent** -- not "given two revision
     labels" (any two revisions in a project), which is what SCOPE item 3 actually asks for.
  3. **No "running total variation value"** was exposed anywhere in the comparison response.
  4. **PROJEXA's stable-facing v1 surface (`/api/v1/projexa/scope/*`) only had list+create** (a pure
     re-export of `/api/v1/construction/boq/route.ts`'s GET/POST) -- revision-create, compare, and
     single-BOQ-get were internal-only (`/api/construction/boq/[id]/...`), unreachable from PROJEXA
     itself. This is the real reason SCOPE item 4 ("real API routes + a real PROJEXA screen") was
     still open even though the underlying service logic mostly existed.
- Closed gap 1: `findScopeReductionViolations()` (pure, unit-tested) is now enforced as a hard
  `409 ServiceError` inside `createBoqRevision()`'s own transaction (so a block rolls back the whole
  revision, not just the offending line items), with an explicit `allowScopeReductionOverride: true`
  escape hatch for when a PM genuinely intends to descope executed work. `compareBoq()` now calls the
  exact same pure helper for its `warnings`, so the warning shown in a comparison and what actually
  gets blocked at creation time can never drift apart.
- Closed gap 2: `compareBoq(ctx, boqId, { against })` -- `against` may be ANY BOQ id in the same
  project (not just the immediate parent); omitting it keeps the original adjacent-revision behavior
  for every existing caller.
- Closed gap 3: `computeTotalVariation()` (pure, unit-tested) sums added-item amounts minus
  removed-item amounts plus every changed item's `netVariation` -- kept as a read-time computation
  (matching this file's own documented "live aggregation, not a denormalized diff table" convention),
  not a new stored column.
- Closed gap 4: added the missing v1 routes and their `/api/v1/projexa/scope/*` re-exports --
  `GET /api/v1/construction/boq/[id]` (+ `.../projexa/scope/[id]`), `POST .../[id]/revisions`
  (+ `.../projexa/scope/[id]/revisions`), `GET .../[id]/compare?against=<boqId>`
  (+ `.../projexa/scope/[id]/compare`) -- so PROJEXA can now actually create a revision, list a single
  BOQ, and compare any two revisions through its one stable API surface.
- Tests added to `construction-boq-service.test.ts` (pure, no DB, matching this file's existing
  convention): `computeTotalVariation` (added-only, removed-only, and combined added+removed+changed
  cases) and `findScopeReductionViolations` (positive variation never blocks; a removed item with
  completed progress blocks; a negative-amount changed item with completed progress blocks; 0%/no
  progress-entry items are never blocked; an item with no `activityId` at all -- no progress source to
  check -- is never blocked).
- Did NOT touch `computeHierarchicalAmount()`/breakdown-percentage logic (constraint honored).
- Did NOT modify any cron entry or systemd `.timer` unit (constraint honored -- no such files touched).
- Verified: `bun test src/lib/services/construction-boq-service.test.ts` -- 19/19 pass (was 14 before
  this task, +5 new). `bun test` scoped to the touched service + its sibling BOQ-family services
  (`construction-boq-import-service.test.ts`, `construction-valuation-service.test.ts`) -- 35/35 pass,
  no regressions. `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit` -- clean (this repo's
  `schema.ts` is large enough that the default Node heap OOMs; documenting the workaround here rather
  than letting the next invocation rediscover it). `node scripts/check-terminology-guardrail.mjs
  --diff-only`, `check-guardrail-presence.mjs`, `check-asset-registry-coverage.mjs` -- all pass (no new
  tables, so asset-registry coverage is untouched). `npx eslint` on every touched file -- 0 errors.

## Remaining / honest limitations
- Did NOT add a "Rev0/Rev1/..." labeled name distinct from the existing `version` integer + free-text
  `title` columns -- SCOPE item 1 asked for "matching this codebase's existing naming conventions,"
  and the existing convention (from PR #596, already shipped) is `version`+`title`, not a separate
  `revisionLabel` enum/column. Adding a parallel naming scheme on top of an already-shipped, already-
  in-use chain felt like exactly the kind of premature parallel structure this repo's own conventions
  (see `diffLineItems`'s "don't build a denormalized diff table" comment) argue against. If the Owner
  specifically wants "Rev0"/"Rev1" as literal stored/displayed strings rather than `Draft #1`/`Draft #2`
  style titles a user types themselves, that's a small follow-up (a computed `Rev${version - 1}` label
  is trivial to add at read time), not a schema change.
- The PROJEXA-side screen (a project's list of revisions + running variation totals) is NOT built in
  this branch -- it belongs in the `projexa` repo (per this task's own EXPECTED_OUTPUT section
  weighing "or compliance-tracker... check PR #596's file locations before deciding" -- PR #596's own
  file locations, and this repo's `AGENTS.md`, confirm ALL construction domain data/logic lives here,
  in VERIDIAN/compliance-tracker, never in PROJEXA's own schema/services). That screen is being added
  in a separate commit on the `projexa` repo's own branch for this same task, calling the new
  `/api/v1/projexa/scope/[id]/revisions` and `.../compare` endpoints added here.
- `submitBoq()`/`approveBoq()` were NOT re-exposed at the v1/projexa surface -- out of scope for what
  this task's SUCCESS_CRITERIA actually asks to be verified (revision creation + comparison), and
  adding an approval-workflow screen was not requested. Flagging so it isn't mistaken for an oversight.

# PROGRESS -- task-20260727-122632-projexa-e2e--hierarchical-boq-breakdown
# PROGRESS -- task-20260727-101145-reporting-api-gateway--external-ai-scope
## Completed
- [x] Read governance docs (CLAUDE.md/AGENTS.md/CONSTITUTION.yaml/ACTIVE-CLAIMS.yaml), claim
      already registered (`ai-os/boss/ACTIVE-CLAIMS.yaml` line ~43) from invocation 1.
- [x] Built `src/app/api/v1/reports/catalog/route.ts` (GET) -- lists the caller's visible
      report_definitions catalog. Auth via `requireAuthOrApiKey()` + new
      `requireReportsReadAccess()` gate (accepts `read` OR the new `read:reports` scope).
      Zero new execution logic: wraps the existing `getFullReportCatalog({ orgId })`.
- [x] Built `src/app/api/v1/reports/definitions/[id]/run/route.ts` (POST) -- executes a
      report_definitions row via the existing `executeReportDefinition()`. STRICT_TENANT_ISOLATION:
      `orgId` is always `ctx.orgId` from the authenticated caller, never from the request body/query
      (verified by an automated spoofing test, see below). Supports `?format=json|csv|xlsx`.
- [x] `src/lib/report-export-shared.ts` -- server-safe (no browser APIs) `rowsToCSV`/
      `rowsToXLSXBuffer` builders, same `xlsx` package + ExportRow[] convention as
      `report-export.ts`/`reports/page.tsx`, just without the client-side download trigger so an
      API route can return the bytes directly.
- [x] `requireReportsReadAccess()` added to `src/lib/supabase/auth-guard.ts` -- OR-semantics gate
      (broad `read` OR narrow `read:reports`), session always passes.
- [x] `compliance.api_keys.scopes` extended (comma-separated) to accept `read:reports` in
      `POST /api/settings/api-keys` -- no schema/table change needed, the existing free-text
      scopes column already expresses it (`src/lib/db/schema.ts` comment updated to document it).
- [x] `src/lib/openapi/generate.ts` -- documented `/reports/catalog` and
      `/reports/definitions/{id}/run` in the public OpenAPI doc.
- [x] Tests: `catalog/route.test.ts` (3), `definitions/[id]/run/route.test.ts` (6, incl. the
      required tenant-isolation spoofing test + cross-org test), `report-export-shared.test.ts` (5),
      `auth-guard.test.ts` (6 for `requireReportsReadAccess`). All pure-mock, no live DB, matching
      repo convention.
- [x] Fixed bugs found while verifying inherited invocation-1 work: (a) `NextResponse` body-type
      TS error on the raw XLSX `Buffer` (wrapped in `Blob`+`Uint8Array.from`, matching the existing
... more files changed

# PROGRESS -- task-20260727-153107-re-audit-projexa-erp-e2e-for-100pct-comp

## Completed
- [x] Read ai-os/boss/ACTIVE-CLAIMS.yaml, registered this session's claim, committed+pushed
- [x] Located both repos: /opt/veridian/repos/projexa, this workspace (compliance-tracker)
- [x] Confirmed projexa main HEAD includes PR #52, #54, #56 merges + fix-forward commits
       (b5014d9 PR54 per-user/mutex fix, 114d0ee last-owner/admin demotion guard)
- [x] Verified projexa PR #52 (AppShellFrame/homeThreadSlot header fix) -- COMPLETE
- [x] Verified projexa PR #54 (PWA/SW/IndexedDB sync queue) incl. per-user scoping +
      concurrent-sync mutex re-checks -- both PASS, COMPLETE
- [x] Verified projexa PR #56 (role gating) incl. full-codebase PATCH/DELETE endpoint
      sweep -- all in-scope PASS, COMPLETE; 1 pre-existing out-of-scope gap noted
      (access-review/certifications/[id] PATCH has no requireRole() gate)
- [x] Verified compliance-tracker PR #596 (BoQ/valuation) incl. nonzero-tax and
      retention-not-taxable-reducing re-checks -- both PASS, COMPLETE
- [x] Verified compliance-tracker PR #597 (timesheet budget-vs-actual) -- COMPLETE
- [x] Ran npx tsc --noEmit in both repos -- clean in both
- [x] Ran bun test scoped to touched files in both repos -- projexa: 10+10+9 pass/0 fail
      across 3 suites; compliance-tracker: 40 pass/0 fail across 5 suites (independently
      re-run by this session, matches sub-agent report exactly)
- [x] Collected real supervisor PASS/FAIL verdicts (PR comments) for all 5 PRs, quoted
- [x] Wrote ai-os/audits/projexa_erp_e2e_reaudit_2026-07-27.md -- all 5 PRs COMPLETE

## Remaining
- [ ] Commit report + PROGRESS.md, push, open PR (report-only, no other file changes)

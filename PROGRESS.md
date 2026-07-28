# PROGRESS -- task-20260727-182023-fix-veri-erp-product-chain-bug--shows-pr
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
- [x] Registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` (no live collision found; several older
      entries touch ChainSelector.tsx/VeriComposer.tsx for unrelated concerns and are stale).
- [x] Root-caused the bug: `buildProductNodes()` in `src/lib/services/capability-tree-service.ts`
      sourced the "Product" chain-selector branch from the `products`/`projects` tables -- an
      unrelated PMS product-line/project grouping (schema.ts's `products`/`projects`, used to
      organize internal delivery projects under a named product line) -- instead of `erpItems`,
      the real ERP sellable-item/product master (item_code, standard_selling_rate, stock flags,
      HSN/SAC -- see erp-inventory-service.ts). Confirmed via `MODULE_SCOPE_TOP_LEVEL_KEYS.erp =
      ["customer", "vendor", "product", ...]` that "Product" is a top-level ERP entity-type
      sibling to Customer/Vendor (which correctly source from erpCustomers/erpSuppliers), not a
      PMS feature. This is exactly the "wrong table" bug class the task spec anticipated.
- [x] Fixed `buildProductNodes()` to query `erpItems` (org-scoped, isActive) and attach a new
      `GENERIC_PRODUCT_ACTIONS` leaf set ("Update price/stock", "Create a quotation") -- mirrors
      `buildEntityNodes()`'s existing Customer/Vendor -> `GENERIC_ENTITY_ACTIONS` pattern exactly
      (a placeholder leaf set feeding the free-text AI-dispatch path, same as Customer/Vendor's
      own generic actions -- no fabricated codeReference/engineKey/real dispatcher was invented,
      per the task's explicit "don't invent fake actions" instruction).
- [x] Removed the now-dead `genericProjectActions()` helper (only caller was the old
      `buildProductNodes()`); updated the file's header comment and the nearby
      `buildConstructionNodes()` comment (it referenced `genericProjectActions()`'s shape) so
      nothing dangling references removed code. Did NOT touch `products`/`projects` tables,
      `buildConstructionNodes()`, or `buildEntityNodes()` (Customer/Vendor) themselves.
- [x] Exported `GENERIC_ENTITY_ACTIONS`/`GENERIC_PRODUCT_ACTIONS` (were module-private) so both
      are directly unit-testable, matching this file's own established `markDeterministic()`
      export precedent.
- [x] Added regression tests in `capability-tree-service.test.ts` (9 tests total, all passing):
      GENERIC_PRODUCT_ACTIONS carries product actions not the old project actions (no "Status
      update"/"Log a task"/"Flag a risk", no projectId field), falls through markDeterministic()
      to the AI-planned path same as Customer/Vendor's own generic actions; GENERIC_ENTITY_ACTIONS
      unchanged (regression guard) and structurally distinct from GENERIC_PRODUCT_ACTIONS.
      `buildProductNodes()`/`buildEntityNodes()` themselves stay untested per this repo's own
      established convention (no withTenantContext/live-DB exercise from a .test.ts file --
      see this file's header note and task-service.test.ts's precedent).
- [x] Verified:
      - `NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit` -- clean, 0 errors (plain
        `npx tsc --noEmit` OOMs on this repo's size regardless of my change; not a regression).
      - `bun test src/lib/services/capability-tree-service.test.ts` -- 9 pass, 0 fail.
      - `bun test` (full suite) -- 2216 pass, 0 fail, 199 files (stderr noise in the output is
        from unrelated tests intentionally simulating failures for fail-closed behavior).
      - `bun x eslint src/lib/services/capability-tree-service.ts src/lib/services/capability-tree-service.test.ts` -- clean.
      - `grep -rn "demo_project_website" src/` -- no matches (id was never hardcoded in source;
        it's live demo-org DB data, confirming the fix is a real root-cause fix, not an exclusion
        hack).
- [x] Constraint check: did not touch any cron/systemd `.timer` state (no such files touched at
      all in this task). Did not touch Customer/Vendor chain-selector code paths beyond adding
      the regression test specified by the task spec.

- [x] Committed, pushed, opened PR #607 against main:
      https://github.com/FChecklist/compliance-tracker/pull/607. Not merged (requires fresh
      supervisor audit first, per task spec / Rule 6).

## Remaining
- [ ] Fresh supervisor audit of PR #607, then merge (not by this session).

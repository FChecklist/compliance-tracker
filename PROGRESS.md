# PROGRESS -- task-20260727-182023-fix-veri-erp-product-chain-bug--shows-pr

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

## Remaining
- [ ] Commit + push branch, open PR against main per EXPECTED_OUTPUT. Do NOT merge (requires
      fresh supervisor audit first, per task spec).

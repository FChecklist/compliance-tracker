# task-20260718-120006-retry-2--ai-engineering-quality--overal

## Task
VERIDIAN Review Framework gap-closure: "AI Engineering Quality / Overall Code
Quality" (Medium). Finding: "Strong documentation discipline offset by
monolithic files and low test coverage." Recommended approach: split
schema.ts by domain module and task-execution-engine.ts by responsibility;
raise test coverage on the largest files first.

## Investigation (re-verified against current code, not the original finding text)
- `src/lib/db/schema.ts` is ~10,200 lines. BUT: 306 files import table
  defs via the `@/lib/db` barrel (`src/lib/db/index.ts` does
  `export * from './schema'`), not directly from `./schema`. A domain-module
  split is mechanically possible without touching those 306 consumers.
  However: `ai-os/boss/ACTIVE-CLAIMS.yaml` currently has 20+ *active*
  parallel-session claims that add new tables/columns directly into
  schema.ts (grep hits at many line numbers throughout the file, spread
  across the whole file). A same-session full physical split of a
  10,000+ line file that many other in-flight branches are concurrently
  patching would create a rebase/merge-conflict cascade across the fleet
  (AGENTS.md Rule 11 exists specifically to prevent sessions from creating
  this kind of collision). **Decision: NOT splitting schema.ts in this PR.**
  This needs a coordinated, fleet-wide freeze window on schema.ts edits,
  not a single opportunistic task — flagging it back to the tracker/owner
  as a separate, coordinated follow-up rather than doing it unilaterally
  and unsafely here.
- `src/lib/task-execution-engine.ts` (2,437 lines) WAS a real match for
  "monolithic": `dispatchEngine()` was one ~1,150-line function containing
  24 sequential `switch (engineKey) { ... }` blocks (186 case labels total),
  one per computation-engine category (GST, Mathematical, Costing, Payroll,
  Inventory, HR, ...). Each block's cases only ever touch `inputs`/
  `engineKey` (never `db`/`orgId` -- confirmed via grep), so each category
  was a clean, self-contained extraction with zero DB-touching risk.

## Completed
- [x] Split `dispatchEngine()`'s 24 category switch blocks out of
      `task-execution-engine.ts` into `src/lib/task-execution/dispatch-
      <category>-engines.ts` (24 files) + a shared `dispatch-helpers.ts`
      (the `NOT_HANDLED` sentinel + the two small helpers, `truthy()` and
      `parseNumberList()`, that were previously private to
      task-execution-engine.ts). Case bodies moved verbatim -- not
      rewritten -- to minimize risk of a behavior change.
  - `dispatchEngine()` itself is now ~35 lines: the one pre-existing
    DB-touching special case (`gst_return_validation_engine`) unchanged,
    then a fixed-order loop over the 24 category dispatchers, first
    non-`NOT_HANDLED` result wins -- semantically identical to the
    original single-switch fallthrough (engineKey values are unique
    across categories, so dispatch order never changes behavior).
  - task-execution-engine.ts: 2,437 -> 1,350 lines.
- [x] Added real unit tests for the split-out dispatch modules (previously
      0% covered beyond `buildNovelUmrHint()`; no test file existed for
      any `src/lib/engines/*.ts` module either). Coverage strategy,
      matching this codebase's own established convention (DB-touching
      code stays untested at this layer, see task-execution-engine.test.ts's
      own header): since these dispatch functions only touch
      `inputs`/`engineKey`, they're pure and directly testable. Tests
      focus on the actual refactor risk surface -- routing (`NOT_HANDLED`
      for a foreign key, shared-case fallthrough groups like
      cgst/sgst/igst/gst_split) and validation branches (array/object type
      guards, enum checks) -- rather than re-deriving exact business-logic
      numbers the underlying `@/lib/engines/*` modules already own.
  - Test files added so far (each colocated next to its dispatch module,
    `bun test` green): dispatch-mathematical-engines.test.ts,
    dispatch-costing-engines.test.ts, dispatch-gst-engines.test.ts,
    dispatch-income-tax-engines.test.ts, dispatch-tds-engines.test.ts,
    dispatch-accounting-engines.test.ts.
  - `bun x tsc --noEmit` clean (needed `NODE_OPTIONS=--max-old-space-size=6144`
    in this environment -- the default heap OOMs on this repo's full
    project graph regardless of this change).
  - Pre-existing `task-execution-engine.test.ts` (buildNovelUmrHint, 7
    tests) still green, unmodified.

- [x] Added dispatch-routing test coverage for all remaining 18 category
      files: payroll, inventory, hr, banking, procurement, security,
      audit, ai-support, compliance, analytics, logistics, marketing,
      project-management, crm, sales, fixed-asset, data-quality,
      document-processing. All 24 category files now have a colocated
      `.test.ts`.
- [x] Full-repo verification, clean:
      - `NODE_OPTIONS=--max-old-space-size=6144 bun x tsc --noEmit` -- 0
        errors (default heap OOMs on this repo's project graph regardless
        of this change -- pre-existing environment quirk, not caused by
        this PR).
      - `bun test` (whole repo, 127 files) -- 1558 pass, 0 fail. The 3
        console.error lines in the output are tests deliberately
        exercising fail-closed error paths (connector-data-service,
        dispatch-completion-monitor, vercel-deployment webhook), not
        failures.
      - `bun test src/lib/task-execution/` -- 144 pass, 0 fail, across the
        24 new dispatch modules' test files.
- [x] Committed (checkpoint + final) and pushed to
      `worker/task-20260718-120006-retry-2--ai-engineering-quality--overal`.

## Remaining
- [ ] Open PR against `main`.
- schema.ts split: explicitly NOT attempted here (see Investigation
      above) -- noting this in the PR description as a deliberate scope
      decision, not an oversight, and flagging the coordination need back
      to MASTER-TRACKER.yaml / the owner.

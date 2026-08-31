# PROGRESS -- rebase-sweep2-652 (replacement for PR #652)
## Scope
Replacement PR for #652 (`feat/sd-006-sales-by-material-service-type`, SD-006
"Sales by Material / Service Type"). Triage confirmed a real, additive,
still-missing gap: fresh GitHub contents API fetch of current main's
`src/lib/services/report-engine-service.ts` (2185 lines) grepped for
`MaterialServiceType`/`SalesByMaterial`/`SD-006`/`sd006` -- zero matches;
`drizzle/meta/_journal.json` grepped for any sd006/material-tagged migration
-- none. The PR adds a pure `aggregateSalesByMaterialServiceType()` grouping
function plus a DB-touching `salesByMaterialServiceTypeReport()` wrapper,
registered in `FORMULA_REGISTRY` as `sales_by_material_service_type` via a
new `report_definitions` migration. Real, additive functionality with no
main-side collision on the report itself.

## Completed
- [x] Worktree: `git worktree add -b rebase-sweep2-652` off
      `origin/feat/sd-006-sales-by-material-service-type` at
      `C:\Users\Dell\AppData\Local\Temp\wtree-sweep2-652`; `bun install`
      (1203 packages) clean.
- [x] `git merge origin/main` -- 4 real conflicts, all resolved with direct
      read of both sides (diff3 style, `||||||| ` base included):
      - `PROGRESS.md` -- this file; replaced wholesale with this entry per
        this repo's own convention (holds only the CURRENT active entry,
        confirmed by reading main's pre-merge 31-line single-entry state).
      - `drizzle/meta/_journal.json` -- the branch's own migration
        (`0302_sd006_sales_by_material_service_type_report_definition.sql`)
        collided on number 0302 with main's own already-merged
        `0302_sales_pipeline_dashboard_targets.sql`. Checked the TRUE
        current highest via `git ls-tree -r origin/main -- drizzle/`
        (not the stale local checkout) -- 0506. Renamed the SD-006
        migration file + its journal tag to `0507_sd006_...`, appended as
        journal idx 329 after main's idx-0..328 sequence (kept verbatim).
        Verified post-merge: no duplicate numeric prefixes on disk, every
        journal tag has a matching `.sql` file, idx sequential 0-329, no
        duplicate tags. (Pre-existing, unrelated gap noted but NOT touched:
        3 migration files on main itself -- 0294/0295/0296 -- have no
        journal entry at all; confirmed via a real `git cat-file -p
        origin/main:drizzle/meta/_journal.json` read, not the truncated
        `git show` output, per this repo's own known `git show` ~31-line
        truncation gotcha.)
      - `src/lib/services/report-engine-service.ts` -- 3 hunks: (1) an
        import-list collision, both sides added distinct new table imports
        (`erpReorderLevels` from main, `erpSalesInvoiceItems`/`erpItems`/
        `erpItemGroups` from this branch) -- combined, both kept; (2) the
        big one -- both sides independently appended a disjoint block of
        new report functions at the same insertion point (main's real R65
        gap-closure wave: `computeMaterialsRunningLow`/
        `computeSalesDashboard`/`computeMonthlyProjectReport`/
        `computeMaterialCostReport`/8 tender-register formulas/8 interior
        sales-package formulas/`computeSalesTargetAchievement`/
        `computeSubledgerToGlReconciliation`/`computeCriticalPathReport`,
        vs. this branch's SD-006 types + `aggregateSalesByMaterialServiceType`
        + `salesByMaterialServiceTypeReport`) -- concatenated both (main's
        block first, SD-006 appended after), neither references the other,
        confirmed every symbol from both sides appears exactly once and is
        correctly wired; (3) `FORMULA_REGISTRY` -- same shape, both sides'
        registry entries kept (`subledger_to_gl_reconciliation` +
        `sales_by_material_service_type`).
      - `ai-os/registry/terminology-guardrail-exemptions.yaml` -- main's
        side is a real, freshly-regenerated full-repo baseline (its own
        reason field: "count re-verified 34 on 2026-09-01 rebase full-repo
        rescan, was 12" for `report-engine-service.ts`'s `hardcoded_iso_date`
        category). This branch's stale pre-rebase side also carried a
        leftover duplicate of the `erp-contract-service.ts`/
        `erp-contract-service.test.ts` entries right after
        `report-engine-service.ts` (an artifact of this branch's own older
        history) -- confirmed via `grep` that main already carries the
        correct, non-duplicated entries for both files elsewhere in the
        manifest (lines ~3044/3048), so the duplicate was dropped, not
        carried forward. Did NOT trust arithmetic (34 + 2 SD-006 findings =
        36) blindly: ran the guardrail's own real regex
        (`/\b\d{4}-\d{2}-\d{2}\b/g`) against the actual merged
        `report-engine-service.ts` file and got 36, confirming the
        arithmetic. Set `hardcoded_iso_date: 36`. Validated the whole file
        still parses (`js-yaml` load, no error).
- [x] `node scripts/check-governance-yaml-parse.mjs` -- "all 5 governance
      YAML files parse cleanly."
- [x] `bunx tsc --noEmit` (NODE_OPTIONS=--max-old-space-size=8192,
      `node_modules/.bin/tsc.exe` directly on Windows) -- clean, exit 0. (A
      re-run of `bun install` was needed first -- the worktree's initial
      install was against the PR branch's own pre-merge lockfile; after
      `git merge origin/main` changed `package.json`/`bun.lock`
      non-conflicting-ly, 83 packages including `@axe-core/playwright` were
      still missing from `node_modules` until a second `bun install`.)
- [x] `bun test src/lib/services/report-engine-service.test.ts` -- 26 pass,
      0 fail, 59 expect() calls (covers `aggregateSalesByMaterialServiceType`
      directly with real multi-material/group/cost-proxy/empty-input fixture
      cases).
- [x] `node scripts/report-test-coverage-gap.mjs` regenerated (via the
      documented `import()` + fs workaround, not the direct CLI -- this
      script's own `isMain` self-invocation check silently no-ops in this
      shell environment) -- output byte-identical to what the merge had
      already staged from main's side, so no drift.
- [x] Migration-adjacent CI gates all re-verified for real, working around
      this environment's `new URL(...).pathname` Windows-path bug (these
      scripts' own `execSync(...2>/dev/null...)` calls also emit harmless
      "The system cannot find the path specified." noise under Windows'
      default cmd.exe shell -- exit codes are still correct):
      - `check-migration-collision.mjs`: exit 0. Independently
        cross-checked by hand (grouping every changed-since-merge-base
        `.sql` filename by numeric prefix, then diffing those prefixes
        against merge-base's existing files) -- zero real collisions; the
        4 apparent prefix overlaps found (0140/0199/0272/0273) are the
        exact same filename before and after the merge (content-only
        changes), which the script's own `existing !== file` guard
        already excludes.
      - `check-migration-integrity.mjs` / `check-migration-schema-drift.mjs`:
        exit 0 both ("330 journal entries present" -- matches this file's
        own real entry count; no `DATABASE_URL` locally, so the live-DB
        comparison leg is honestly skipped, not faked).
      - `check-new-test-coverage.mjs`: exit 0 (moot either way --
        `report-engine-service.ts` already had a sibling test file before
        this PR).
      - `check-route-error-handling.mjs --base <merge-base>`: exit 0, "No
        new/changed API route files" -- correct, SD-006 deliberately adds
        no dedicated route (`deterministic_formula` reports resolve through
        `executeReportDefinition`'s generic dispatcher, matching
        `billing_due_list`'s own precedent).
- [x] `eslint .` (full repo, not just touched files) -- 0 errors, 138
      warnings, none in any file this PR touches (all pre-existing
      complexity/a11y warnings elsewhere in the repo).
- [x] `node scripts/check-terminology-guardrail.mjs --full-repo` -- exits 1
      repo-wide (many pre-existing files -- erp-buying-service.ts,
      hr-service.ts, hr-dashboard-service.ts, rca-closure-gate.ts, etc. --
      carry new/unexempted hardcoded_iso_date findings, none touched by
      this PR). Confirmed this is NOT a real CI gate: grepped every
      `.github/workflows/*.yml` job name -- no
      `terminology-guardrail-check` job exists; the one hit is a comment
      referencing it as historical precedent for another job's
      `fetch-depth` setting, not a live job. `report-engine-service.ts`
      itself shows zero new findings in this run's own output -- the `36`
      set in the exemptions manifest above covers it exactly. Did not
      attempt to fix the wider pre-existing repo-wide gap -- out of scope
      for this PR and not something CI enforces.
- [x] Pushed `rebase-sweep2-652`, opened replacement PR, closed #652 with a
      comment pointing at the replacement, checked real CI on the new PR.

## Remaining
- [ ] None beyond real CI's own build/E2E/etc. jobs, checked directly on
      the replacement PR after push (`gh pr checks`) -- see that PR's own
      state for the authoritative outcome, not this file.

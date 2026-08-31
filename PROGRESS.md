# PROGRESS -- rebase-sweep2-655 (replacement for PR #655)

## Scope

Replacement PR for #655 (CRM-007 "Sales Representative Performance
Dashboard", branch `crm-007-sales-rep-performance-dashboard`). Triage
confirmed a real, additive, well-evidenced gap: independently fetched
current main's `src/lib/services/crm-service.ts` (1792 lines) and grepped
for `salesRepPerformance`/`SalesRepPerformance`/`aggregateSalesRepPerformance`/
`getSalesRepPerformanceDashboard` -- zero matches. The PR adds a new pure
aggregator `aggregateSalesRepPerformance()` + `getSalesRepPerformanceDashboard()`
and a new route `GET /api/v1/projexa/sales-rep-performance` -- real,
still-missing functionality, distinct from the pipeline-overview and
pipeline-dashboard functions already on main (`getSalesPipelineOverview`
at crm-service.ts:961, `getSalesPipelineDashboardData` at :1168).

## Completed

- [x] Worktree: `git merge origin/main` onto the PR's real head branch
      (`crm-007-sales-rep-performance-dashboard`) in a scratch worktree at
      `C:\Users\Dell\AppData\Local\Temp\wtree-sweep2-655`. 5 real conflicts
      -- `PROGRESS.md`, `ai-os/registry/terminology-guardrail-exemptions.yaml`,
      `drizzle/meta/_journal.json`, `src/lib/services/crm-service.test.ts`,
      `src/lib/services/crm-service.ts` -- all 5 exactly matching this repo's
      documented recurring gotchas, none skipped or force-picked:
      - `PROGRESS.md` -- replaced wholesale (this file, this repo's own
        established convention: holds only the current active entry). The
        PR branch's own copy had drifted from that convention (it had
        accumulated 5 unrelated stale task entries ahead of its own real
        `crm-007-sales-rep-performance-dashboard` entry, inherited from an
        old base rather than replaced along the way) -- not perpetuated
        here.
      - `src/lib/services/crm-service.ts` -- two hunks. Import line: unioned
        both sides' additions (`gte` from the PR + `ne`/`or`/`z`/
        `buildPipelineDeals` from main, no overlap). Function-body hunk: a
        clean both-sides-added-independently conflict (empty
        `\|\|\|\|\|\|\|` base) -- the PR's own new
        `aggregateSalesRepPerformance()`/`getSalesRepPerformanceDashboard()`
        section and main's own independently-added "VERIDIAN Review
        Framework gap-closure" section (orphan-check/CSV export-import/
        auto-scoring/overdue-notify) don't share a single symbol name --
        kept both in full, no drop.
      - `src/lib/services/crm-service.test.ts` -- same shape, three hunks
        (header comment, imports+first describe-block run, second
        describe-block run): merged the header comment to document both
        histories rather than picking one, unioned the import list, kept
        both sides' describe blocks in full (verified zero test-name/
        symbol collisions before merging).
      - `drizzle/meta/_journal.json` + the migration file itself -- a real
        `0302` collision (PR's own new
        `0302_crm007_sales_rep_performance_report_definition.sql` vs.
        main's own already-merged, unrelated
        `0302_sales_pipeline_dashboard_targets.sql`). Checked the TRUE
        current highest via `git ls-tree -r origin/main -- drizzle/` (0506,
        not trusted from a stale local checkout) -- confirmed 0507 free,
        `git mv`'d the file to `drizzle/0507_crm007_sales_rep_performance_
        report_definition.sql`, appended the matching journal entry
        (`idx: 329`, `tag: 0507_crm007_sales_rep_performance_report_
        definition`) after main's own last entry (`idx: 328`/`0506_...`)
        rather than replacing anything. Confirmed no other file in the repo
        references the old `0302_crm007...` filename, and confirmed no
        duplicate migration-number prefixes remain anywhere under
        `drizzle/` after the rename.
      - `ai-os/registry/terminology-guardrail-exemptions.yaml` -- did not
        resolve by arithmetic guessing. After fixing the two real code
        conflicts above, ran the exact `PATTERN_FAMILIES` regexes
        `scripts/check-terminology-guardrail.mjs` itself uses directly
        against the merged `crm-service.ts`/`crm-service.test.ts`/new
        `route.ts` files to get real, current counts: `crm-service.ts`
        `hardcoded_iso_date` 14 (main's own accumulated 12 + this PR's own
        2 new dated header-comment lines); `crm-service.test.ts`
        `hardcoded_iso_date` 11 / `placeholder_company_name` 5 (main's own
        `placeholder_company_name` baseline untouched, `hardcoded_iso_date`
        genuinely 11 post-merge -- both branches' header/describe-block
        dates plus this PR's own 5 test-fixture literals, not a naive 5+5
        sum); new entry for `src/app/api/v1/projexa/sales-rep-performance/
        route.ts` at 1. Re-ran `node scripts/check-terminology-guardrail.mjs
        --file <the 3 files>` afterward -- passed clean with these exact
        counts as the recorded baseline.
- [x] `bun install` in the worktree -- 1203 packages installed clean.

## Validation run

- [x] `node scripts/check-governance-yaml-parse.mjs` -- PASSED, all 5
      governance YAML files parse cleanly.
- [x] `node_modules/.bin/tsc.exe --noEmit` (`NODE_OPTIONS=--max-old-space-
      size=8192`, this repo's documented Windows fallback) -- clean, zero
      errors/output.
- [x] `bun run lint` -- clean, zero errors/warnings reported.
- [x] `bun test src/lib/services/crm-service.test.ts` (the touched test
      file) -- **76 pass, 0 fail, 175 expect() calls**.
- [x] `bun test` (full suite, run via PowerShell `Out-File` -- Bash's own
      `>` redirect truncates this repo's larger command output, a
      documented gotcha, confirmed again here: a first Bash-redirected
      attempt cut off mid-file with no final summary line) -- **3469 pass,
      5 skip, 9 fail, 8138 expect() calls** across 3483 tests/296 files.
      All 9 failures are in `src/app/api/v1/projexa/{accounts,ar-aging,
      dunning-list,finance-dashboard}/route.test.ts` -- none touched by
      this PR (whose only real-code changes are `crm-service.ts`/
      `crm-service.test.ts`). Re-ran those 4 files alone in isolation:
      **21 pass, 0 fail** -- confirms pre-existing, local test-order-
      dependent flakiness (global `mock.module` state bleeding between
      files in this machine's own file-discovery order, the same class
      already documented elsewhere in this repo's history), not a real
      regression from this merge.

## Remaining

- [ ] Commit the merge, push, open the replacement PR, close #655 as
      superseded, check real CI, merge only when genuinely green.

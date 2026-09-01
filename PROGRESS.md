# PROGRESS -- rebase-review-1013 (real rebase-merge for PR #1013)

## Scope
Real rebase-merge of PR #1013 (`worker/task-20260718-082002-crm---sales-modules--sales-dashboard`,
"Sales Dashboard" VERIDIAN Review Framework gap-closure) onto current main, per this repo's
standard rebase-sweep protocol. PR #1013 fixes a real, currently-live authorization bug: main's
`src/app/api/crm/sales-pipeline/route.ts` had zero role scoping (any org user with sales-module
access could see the WHOLE org's pipeline data, not just their own), plus 6 hardcoded `₹`
currency literals on the dashboard page ignoring org currency settings. The PR adds
`resolveViewerScope()` (reused across the GET pipeline route, the new summary route, the new
trend route, and CSV export -- verified directly against the diff, not just the route list, see
below), a new `/api/crm/sales-pipeline/summary` (AI weekly narrative) and
`/api/crm/sales-pipeline/trend` (week-over-week alert) route, client-side CSV export, and the
currency-hook fix.

## Completed
- [x] `gh pr view 1013 --json headRefName` -> `worker/task-20260718-082002-crm---sales-modules--sales-dashboard`.
- [x] Worktree: `git worktree add -b rebase-review-1013` from that branch at
      `C:\Users\Dell\AppData\Local\Temp\wtree-review-1013`, `bun install` (1203 packages).
- [x] `git merge origin/main` -- 4 real conflicts, resolved with genuine per-file judgment, not
      blind ours/theirs:
      - PROGRESS.md: this repo's convention is single-current-entry, not concatenation --
        replaced wholesale with this entry (confirmed the convention by reading the prior
        rebase-sweep entry this same conflict surfaced, `rebase-sweep2-618`'s own section, which
        documents the identical resolution rule).
      - ai-os/boss/ACTIVE-CLAIMS.yaml: git presented the ENTIRE file as one conflict block
        (start-of-file marker to end-of-file marker) despite base/HEAD/main being byte-identical
        except for a tail append on each side -- confirmed by splitting all 3 versions out and
        diffing HEAD-vs-base and main-vs-base independently (44 and 61 diff lines respectively,
        both pure tail-appends at the same anchor line). This is an append-only rolling log by
        design (see the file's own header), so resolved as a union: base's shared header/body +
        main's own appended entries (its independent claims, unrelated to this PR) + HEAD's own
        appended claim entry for this task, in that order. Verified: parses as valid YAML
        (`yaml.safe_load`), single top-level `active` key intact.
      - ai-os/registry/terminology-guardrail-exemptions.yaml: same whole-file-conflict pattern as
        ACTIVE-CLAIMS.yaml, same root cause (pure tail-appends on both sides from an identical
        base). Took main's full, far-more-current version (3613 lines vs base's 1146) as the
        working baseline, then merged in HEAD's real additions: 4 brand-new file entries for
        this PR's new route files (`src/app/api/crm/sales-pipeline/{route.ts,route.test.ts,
        summary/route.ts,trend/route.ts}`, none of which exist in main's version at all -- these
        are new files only this PR introduces), inserted at their correct alphabetical position
        (`src/app/api/crm/pipeline/export/route.ts` < `src/app/api/crm/sales-pipeline/*` <
        `src/app/api/documents/route.ts`, verified against main's own file ordering directly).
        For the 2 files both sides independently bumped from the same 4-and-1 baseline
        (`crm-service.ts`: main's own chain of unrelated PRs had already bumped 4 -> 14; HEAD's
        own PR #1013 diff independently bumps 4 -> 7 for 3 different, non-overlapping dated
        comments -- role-scoping fix, WoW alert data, AI narrative. `page.tsx`: main left it at
        the 1 baseline; HEAD bumps 1 -> 4 for 3 different dated comments -- role scoping, CSV
        export, currency fix) -- summed the two independent additive deltas on top of the shared
        baseline rather than picking one side or naively overwriting (crm-service.ts: 4 + (14-4)
        + (7-4) = 17; page.tsx: 1 + (4-1) = 4, main had no independent delta here), and documented
        the additive bump inline in each entry's own `reason` text, same convention this file's
        other multi-PR bump entries already use. Verified: parses as valid YAML; re-ran
        `node scripts/check-governance-yaml-parse.mjs` post-merge (pass, all 5 files clean).
      - src/lib/services/crm-service.ts: small, correctly-localized 3-way import conflict.
        HEAD added `gte` (drizzle-orm) and 3 more named imports from
        `./sales-pipeline-dashboard-service` (`normalizePipelineStatus`, `computeKpis`,
        `computePipelineStatusOverview`) for its own new `getSalesPipelineTrend()`/
        `generateSalesPipelineSummary()` code. main independently added `ne, or` (drizzle-orm)
        and a new `import { z } from "zod"` for unrelated work. Verified all 4 of HEAD's named
        imports are genuinely exported by main's current
        `sales-pipeline-dashboard-service.ts` (confirmed via `git cat-file -p` -- `git show
        <ref>:<path>` silently truncates blob output at ~31 lines with no warning, a
        previously-documented gotcha that bit this exact lookup once before falling back to
        `cat-file`) before merging both sides' import additions together: final line combines
        `eq, and, ilike, inArray, sql, lte, gte, isNotNull, isNull, ne, or` from drizzle-orm, adds
        `import { z } from "zod"`, and imports all 4 names from
        `./sales-pipeline-dashboard-service`.
- [x] Migration renumbering: this PR's own `drizzle/0313_sales_pipeline_summary_prompt.sql`
      collided with main's real, unrelated `0313_ai_team_role_overrides_rollout.sql`. Checked the
      TRUE current highest via `git ls-tree -r origin/main -- drizzle/` (not a stale local
      checkout): `0510_register_prompt_marketplace_listings` (numeric sort, not lexical).
      Renamed the file to `0511_sales_pipeline_summary_prompt.sql` (`git mv`, no internal
      self-references to fix -- pure `INSERT ... ON CONFLICT DO NOTHING` data migration, no
      snapshot file exists for either number). Separately discovered and fixed a real gap in the
      PR's OWN original commit (445f04e9): it added the `0313_*.sql` file to disk but never
      registered it in `drizzle/meta/_journal.json` at all -- confirmed via `git cat-file -p
      445f04e9^:drizzle/meta/_journal.json` (no `0313`/`0312` entry, journal topped out at
      `0311_content_search_view` at that commit) and via `git show 445f04e9 --stat` (only the
      `.sql` file listed, journal untouched). Appended a new journal entry (`idx: 333`, tag
      `0511_sales_pipeline_summary_prompt`) after the merge's own `idx: 332`
      (`0510_register_prompt_marketplace_listings`) with a `when` timestamp 100000ms later.
      Verified: valid JSON, `idx` sequential 0-333 with no gaps/dupes, all 334 `tag` values
      unique. `node scripts/check-migration-collision.mjs --base origin/main` itself silently
      no-ops on Windows (`execSync` shell-redirection incompatibility, prints "The system cannot
      find the path specified." twice but still exits 0 -- previously-documented gotcha) --
      reproduced its logic by hand instead: `git diff --name-status origin/main -- drizzle/`
      shows only `0511_sales_pipeline_summary_prompt.sql` (added) and `_journal.json` (modified)
      as new/changed under `drizzle/`, and no other file on disk or in the diff shares the
      `0511` prefix.
- [x] RBAC verification (this PR's actual point): read the real diff for every route that returns
      pipeline data. `resolveViewerScope()` (exported from
      `src/app/api/crm/sales-pipeline/route.ts`) is genuinely invoked in: the GET handler in that
      same file, the new GET `.../trend/route.ts`, the new POST `.../summary/route.ts`, and the
      page's CSV export path (client-side export of the already role-scoped, already-fetched
      deal list returned by the GET route -- not a separate unscoped data fetch). No pipeline-data
      code path found that bypasses it. `getSalesPipelineDashboardData()`/
      `getSalesPipelineTrend()`/`generateSalesPipelineSummary()` all accept and honor the
      `restrictToOwnerId` parameter threaded from that same scope resolution.
- [x] `node scripts/check-governance-yaml-parse.mjs` -- pass, 5/5 files clean, post-merge.
- [ ] `bunx tsc --noEmit` -- running next.
- [ ] `bun test` on touched test files -- running next.

## Remaining
- [ ] Full validation pass (tsc, targeted bun test), commit, push `rebase-review-1013`, open
      replacement PR citing #1013, close #1013, check real CI, merge only when genuinely green.

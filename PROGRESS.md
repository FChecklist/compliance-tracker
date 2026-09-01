# PROGRESS -- rebase-sweep2b-1212 (real rebase-merge for PR #1212)

## Scope
Real rebase-merge of PR #1212 (`worker/task-20260718-062003-ai-cost-governance---finops--cost-visibi`,
"AI Cost Governance & FinOps": per-tenant Finance cost-visibility UI, manual monthly invoice
reconciliation against provider bills, and the measured-vs-estimated cost-accuracy KPI) onto current
main, per this repo's standard rebase-sweep protocol. Prior triage + adversarial-verify (already
complete before this sweep, not re-done here) confirmed: every new file (page, API route, service+test,
migration, doc) returns 404 on main -- genuinely new, not already-shipped; this is a clean rebase of a
previously `AUDIT: PASS`'d PR (#687, the branch's original PR before being reopened as #1212 once
#687 itself went stale/`CONFLICTING`); CI on #1212 was all-green except Vercel (rate-limited infra,
not a code defect); no 0304 migration-number collision existed on main as of the day #1212 was audited.

## Rebase (this session, `rebase-sweep2b-1212`)
- [x] Got the PR's real head branch via `gh pr view 1212 --json headRefName`:
      `worker/task-20260718-062003-ai-cost-governance---finops--cost-visibi`.
- [x] Worktree: `git worktree add -b rebase-sweep2b-1212` from that branch, off the reference checkout
      at `C:/ct/ct` (this session's own ambient cwd is not a git repo, so no tool-level
      worktree-isolation mechanism was used -- plain `git worktree add`, per protocol).
- [x] `bun install` in the worktree (1203 packages) immediately post-creation.
- [x] `git fetch origin main && git merge origin/main` -- **6 real conflicts, resolved with actual
      judgment, not blind pick-one-side:**

  1. **`PROGRESS.md`** -- this repo's single-current-entry convention: replaced wholesale with this
     file (this section), did not concatenate with either the stale merge-base entry or origin/main's
     own then-current entry.

  2. **`ai-os/boss/ACTIVE-CLAIMS.yaml`** -- this branch's own diff from merge-base carried the file's
     old, pre-Phase-5, ~10,800-line bloated state (its own claim entry for this task was buried inside
     it, unchanged since 2026-08-15). Origin/main had independently pruned this file down to its
     current, much smaller `active:` list (confirmed by diffing the merge-base against origin/main --
     same "many rebase-sweep sessions have already pruned this file" pattern already recorded inside
     the file itself for other same-day rebases). Did NOT reintroduce the stale bloated version: took
     main's current pruned content as-is and appended this branch's one real claim entry at the end of
     `active:`, updated with a `rebase_note` documenting this whole merge (matching the
     `[rebase-merging via rebase-sweep2b-1212, was PR #1212, ...]` convention already used by sibling
     entries in the same file).

  3. **`ai-os/registry/terminology-guardrail-exemptions.yaml`** -- same situation as #2: this branch's
     side was the old, small, pre-Phase-5 exemptions manifest (51 file entries); origin/main carries the
     current, freshly-regenerated Phase 5 full-repo baseline (907 file entries, per PR #554's rebase
     the same day). Took main's regenerated file as the base rather than the branch's stale copy, and
     added only what main's baseline genuinely lacked because the files don't exist on main yet:
     `src/app/(app)/ai-cost-governance/page.tsx` (2 dated comments) and
     `src/lib/services/cost-reconciliation-service.test.ts` (3 dated test-fixture literals) -- both new
     entries, verified false-positive/benign on direct read, same as this branch's own original
     reasoning. Checked `src/components/AppSidebar.tsx` (this branch's own diff just adds a nav-link
     object, no new dated comment) against main's already-current baseline (7) -- no bump needed, left
     as-is. For `src/lib/db/schema.ts`, ran the real check post-merge (`node
     scripts/check-terminology-guardrail.mjs --file src/lib/db/schema.ts`): main's baseline was 101,
     real merged count is 102 (the one new dated comment on the `aiCostReconciliations` table, line
     ~10080, "2026-08-01") -- bumped 101 -> 102 with a cited reason, then re-ran the checker clean.

  4. **`drizzle/meta/_journal.json`** -- this branch's own migration entry (idx 282,
     `0304_ai_cost_reconciliation`) was appended at the wrong position relative to main's real current
     history. Checked the TRUE current highest migration number the hard way, per this repo's own
     documented gotcha (never trust a stale local checkout or the journal file's own idx sequence):
     `git ls-tree -r origin/main -- drizzle/` shows main's real highest numbered file is
     `0517_register_erp_statistical_key_figure_types` (idx 339). `0304` is free on main (`git ls-tree`
     found zero `0304_*` files) but out of chronological order against everything main has shipped
     since -- renamed the migration file `drizzle/0304_ai_cost_reconciliation.sql` ->
     `drizzle/0518_ai_cost_reconciliation.sql` (`git mv`, next free slot after main's real 517) and
     added the matching journal entry (idx 340) after main's real idx-339 entry, instead of splicing
     into the middle of main's list. Updated the one other reference to the old number
     (`docs/AI_COST_GOVERNANCE_FINOPS.md` §3, "migration `drizzle/0304`" -> `drizzle/0518`).

  5. **`src/lib/db/schema.ts`** -- a clean additive conflict: both sides added a new table
     (`aiCostReconciliations` from this branch; `platformBillingPlans`/`platformBillingInvoices` +
     relations from origin/main's own separate PM-Billing feature) at the identical insertion point
     right after `tokenUsageLedger`'s closing brace. No real semantic collision -- kept both blocks
     (this branch's `aiCostReconciliations` table first, then main's platform-billing tables), exactly
     as each side wrote them.

  6. **`src/lib/services/token-usage-service.ts`** -- only the import lines conflicted. This branch's
     own change (byOrg's `groupLabel` left-join to `organisations`, closing the "per-tenant visibility"
     finding) needed `organisations` from `@/lib/db` and `eq` from `drizzle-orm`. Origin/main's own
     independent addition (`getOrgUsageForPeriod`, for its platform-billing feature, appended further
     down the file and auto-merged cleanly with zero conflict) also needed `eq` but not `organisations`.
     Took the union of both import lines (`{ db, tokenUsageLedger, organisations }` +
     `{ sql, gte, and, isNotNull, eq }`) -- satisfies both sides' real usage, nothing dropped.

- [x] Re-ran `bun install` after the merge (78 packages: `@axe-core/playwright`, `jscpd`, `knip`,
      `@fchecklist/veridian-ui-kit`, `xlsx`) -- the pre-merge install only saw this branch's own
      `package.json`; merging in main's `package.json` added devDependencies this branch never had.
      Without this, `tsc` falsely reports `Cannot find module '@axe-core/playwright'` in
      `e2e/accessibility.spec.ts` (a file this PR doesn't touch) -- same known gotcha already
      documented from a prior same-day rebase (rebase-sweep2b-1202).
- [x] Real validation, re-run fresh on the merged worktree (not assumed carried over from either
      side's own CI):
  - `node scripts/check-governance-yaml-parse.mjs` -- clean, all 5 governance YAML files parse.
  - `node scripts/check-terminology-guardrail.mjs --file src/lib/db/schema.ts` -- clean after the
    101->102 bump above. `--file "src/app/(app)/ai-cost-governance/page.tsx" --file
    src/lib/services/cost-reconciliation-service.test.ts --file src/components/AppSidebar.tsx` --
    clean, 0 new findings across all 3.
  - `node scripts/check-migration-collision.mjs --base origin/main` -- exits 0 (the script's own
    `head -100`/`2>/dev/null` shell pipeline throws "system cannot find the path specified" on
    Windows execSync's default cmd.exe shell and falls through to its own try/catch fallback path,
    a pre-existing script portability quirk unrelated to this PR's content) -- manually confirmed no
    real collision: exactly one `0518_*` file exists in `drizzle/`, matching the renumbered migration
    from item 4 above.
  - `NODE_OPTIONS=--max-old-space-size=4096 node_modules/.bin/tsc.exe --noEmit` -- first attempt: 1
    real error (`@axe-core/playwright` missing, described above); after the post-merge `bun install`,
    re-run clean, **0 errors**.
  - `bun test src/lib/services/cost-reconciliation-service.test.ts` -- 10 pass, 0 fail, 17 expect()
    calls. No `token-usage-service.test.ts` exists to re-run (this branch's own change there is a
    small additive join with no dedicated test file, same as before this rebase).
  - `bun run lint` -- run for real on the merged worktree as part of this sweep's own validation.

## Remaining
- [ ] Commit this merge, push `rebase-sweep2b-1212` to origin, open a replacement PR titled
      "... [was #1212]" citing the original, close #1212 as superseded, then check real CI on the new
      PR (`gh pr checks`) and merge only once genuinely green (modulo the known-ambient E2E
      Tests/Vercel/pre-existing Secret Scanning/Promptfoo Evals lines).

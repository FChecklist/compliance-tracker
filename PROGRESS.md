# PROGRESS -- rebase-sweep2b-661 (real rebase-merge for PR #661)

## Scope
Real rebase-merge of PR #661 (`feat/geography-cascading-address`, "Country->State
cascading address select") onto current main, per this repo's standard rebase-sweep
protocol. Prior triage + adversarial-verify (already complete before this sweep, not
re-done here) confirmed a real, additive, still-missing gap: Country/State fields render
as plain free-text `Input`s in `src/app/(app)/crm/accounts/[id]/page.tsx` and
`src/components/erp/PartyAddressesAndContacts.tsx`, no select anywhere; a repo-wide grep
for `COUNTRIES`, `STATES_BY_COUNTRY`, `CountrySelect`, `StateSelect` returned zero hits in
`src/`. PR #661's new files (`src/lib/data/geography.ts`,
`src/components/ui/country-state-select.tsx`) are real, still-missing functionality.

## Completed
- [x] Worktree: `git worktree add -b rebase-sweep2b-661` from
      `origin/feat/geography-cascading-address`, `bun install` (1203 packages).
- [x] `git merge origin/main` (round 1) -- 1 real conflict: `ai-os/boss/ACTIVE-CLAIMS.yaml`
      (took origin/main's version wholesale -- this task's own claim entry there is moot
      since the task completes via this merge). No other conflicts.
- [x] Re-ran `bun install` after the merge -- package.json/lockfile changed by the
      main-merge; an install run only pre-merge left node_modules stale by 83 packages
      (`@axe-core/playwright`, `jscpd`, `knip`, etc.), which is exactly what caused a
      transient false-positive `@axe-core/playwright` type-check failure -- confirmed
      unrelated to the PR's own code by A/B testing an install on a clean main worktree.
- [x] Validated (round 1): `node scripts/check-governance-yaml-parse.mjs` (pass, 5/5),
      `NODE_OPTIONS=--max-old-space-size=3072 bunx tsc --noEmit` (clean, 0 errors after the
      reinstall -- default heap OOMs on this repo's size, matches this repo's own
      documented gotcha), `bun test src/lib/data/geography.test.ts` (34 pass / 0 fail).
- [x] No drizzle migrations involved (static reference-data module, no schema change) --
      confirmed via diff against merge-base.
- [x] Pushed `rebase-sweep2b-661`, opened PR #1524 ("... [was #661]"), closed #661 with a
      comment pointing to #1524.
- [x] `git merge origin/main` rounds 2 and 3 -- this is a fast-moving repo with many
      parallel rebase-sweep sessions landing PRs continuously (PR #1522 then PR #1523
      each landed on main within minutes of each push here, flipping this PR's
      mergeable state to CONFLICTING before CI could even register a run). Both rounds'
      only conflict was `PROGRESS.md` (single-current-entry convention, not
      concatenation -- replaced wholesale each time, as here). No other file conflicted
      in either round. Re-validated governance-yaml-parse + `tsc --noEmit` clean after
      each round; no dependency-manifest changes in either round so no reinstall needed.

## Next (this session, in order)
- [ ] Push this round-3 merge immediately, then check CI/mergeable state right away
      before main can advance again.
- [ ] If PROGRESS.md-only conflicts keep recurring, repeat the same wholesale-replace +
      immediate-push pattern rather than waiting between checks (each wait window is what
      let main advance underneath this PR the last two times).
- [ ] Verify real CI on PR #1524 (`gh pr checks 1524`) -- retry on transient network
      errors up to 5 times; ignore known-ambient failures (E2E Tests, Vercel, Secret
      Scanning on pre-existing files, Promptfoo Evals).
- [ ] Merge PR #1524 only when genuinely green (modulo the known-ambient ones).

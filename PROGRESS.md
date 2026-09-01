# PROGRESS -- rebase-sweep2b-1202 (real rebase-merge for PR #1202)

## Scope
Real rebase-merge of PR #1202
(`worker/task-20260815-041523-z-ai-gtm-findings-files-are-now-real-and`,
"docs+fix: Z.AI GTM merge/enumeration status, 139 points, plus carry forward PR 1200 closure fixes")
onto current main, per this repo's standard rebase-sweep protocol. Prior triage + adversarial-verify
(already complete before this sweep, not re-done here) confirmed: main's `next.config.ts` had no
`headers()`/CSP/X-Frame-Options at all; `robots.ts` hardcoded the wrong sitemap domain vs
`sitemap.ts`'s own `BASE` constant (a real, live mismatch); all 18 checks passed on the original PR
including `audit-check` and a genuinely successful (non-rate-limited) Vercel deployment.

## Rebase (this session, `rebase-sweep2b-1202`)
- [x] Got the PR's real head branch via `gh pr view 1202 --json headRefName`:
      `worker/task-20260815-041523-z-ai-gtm-findings-files-are-now-real-and`.
- [x] Worktree: `git worktree add -b rebase-sweep2b-1202` from that branch, off the reference
      checkout at `C:/ct/ct` (this session's own ambient cwd is not a git repo, so no
      tool-level worktree-isolation mechanism was used -- plain `git worktree add`, per protocol).
- [x] `bun install` in the worktree (1203 packages) immediately post-creation.
- [x] `git fetch origin main && git merge origin/main` -- main had advanced from `115466b3` to
      `815ae1c5` since this branch's own last main-sync. **4 real conflicts, resolved with actual
      judgment (not blind pick-one-side), plus 1 real SILENT collision `git merge` did not flag
      that `tsc` caught:**

  1. **`PROGRESS.md`** -- this repo's single-current-entry convention: replaced wholesale with
     this file, did not concatenate with either the stale merge-base entry or origin/main's own
     then-current entry (for PR #1197's rebase-cleanup).

  2. **`ai-os/boss/ACTIVE-CLAIMS.yaml`** -- this branch's own diff from merge-base was a clean
     61-line pure addition (one active-claim entry for this task). Origin/main had independently
     pruned this file from ~10,825 lines to ~1,150 lines via many other rebase-sweep sessions
     since this branch's merge-base. Per same-day precedent already recorded inside the file
     itself (rebase-1530-final / rebase-sweep2b-1015 / rebase-cleanup-1199 / rebase-sweep2b-1037
     / rebase-cleanup-1197 entries -- did NOT merge/concatenate the stale bloated version
     wholesale, which would have reintroduced thousands of lines of long-archived claims): took
     main's current pruned file as-is and appended this branch's one real claim entry at the end
     of `active:`, updating its `session_label` to the `[rebase-merging via rebase-sweep2b-1202,
     was PR #1202 ...]` convention and adding a `rebase_note` documenting this whole merge
     (including item 4 below) inside the entry itself.
     - Gotcha hit while investigating this file: `git show <ref>:<path>` truncated its own
       output to ~31 lines with no warning (a previously-logged gotcha, reproduced fresh here)
       and made the file look like a 31-line corrupted stub. `git cat-file -p <blob-sha>`
       returned the real, full 1206-line content. Likewise `git diff`/`git show -p` in this
       environment only ever printed a stat summary, never real patch hunks, for any file --
       worked around by extracting full blobs with `git cat-file -p <ref>:<path>` per side and
       diffing those with plain coreutils `diff`, not `git diff`.

  3. **`ai-os/registry/terminology-guardrail-exemptions.yaml`** -- kept main's current content;
     main already carried an existing `next.config.ts` exemption entry (`hardcoded_iso_date: 1`,
     from an unrelated PR #554 baseline regen) -- folded this branch's genuine dated comment into
     that *existing* entry (raised count to 2, reason updated) instead of adding a duplicate
     `file:` key, since this manifest's own established practice (verified: zero pre-existing
     duplicate `file:` keys anywhere in it) is one entry per file, even though the checker script
     (`loadExemptions()` keys a `Map` by filename, last entry wins) would have tolerated a
     duplicate. `src/app/sitemap.ts` was a genuinely new entry, added as-is (count 1).

  4. **`src/app/sitemap.ts`** -- both sides independently landed the identical real fix (`BASE`
     changed from the wrong `https://veridian-ai-os.vercel.app` to the real
     `https://projexa-ai.com`) -- kept this branch's version since it carries the fuller
     explanatory comment and the value already matched main's exactly.

  5. **`next.config.ts` -- auto-merged with NO conflict reported, but the result was broken.**
     Main's own PR #1526 (merged the same day, 10:21, *before* this merge started) had
     independently shipped a `headers()` fix for the identical CB-02/CB-03 findings this branch
     was also fixing -- exactly the "two independent workers would collide on the same file"
     scenario the governing PM decision's own closed_note (rows 92/93) explicitly warned about
     and tried to prevent. Both additions were pure insertions at different line ranges inside
     the same `nextConfig` object literal, so git's line-based 3-way merge combined both without
     detecting a conflict, silently producing a file with **two `async headers()` methods on the
     same object** -- syntactically valid-looking, semantically broken (duplicate object key;
     only the last one would actually apply at runtime, and TypeScript rejects it outright).
     Caught this via `bunx tsc --noEmit`: `next.config.ts(160,9): error TS2300: Duplicate
     identifier 'headers'`.
     - Real judgment applied, not a mechanical pick: main's copy is already merged, already
       live-verified end-to-end per its own commit message (`bun run build` exit 0, `tsc
       --noEmit` clean, lint clean, 2512/2512 tests, plus a live `bunx next start` + `curl -sD`
       check against the real deployed headers), and matches the PM's explicit
       Report-Only/do-not-break-production mandate. This branch's copy shipped a more aggressive
       **enforcing** CSP (not Report-Only) that was never PM-approved for enforcing mode and was
       only verified pre-merge, never against the live site.
     - Resolution: kept main's `headers()` block as the sole one; deleted this branch's
       duplicate/superseded block entirely; folded its one real, non-duplicative contribution
       forward into main's block -- 3 extra headers (`X-Content-Type-Options`, `Referrer-Policy`,
       `Permissions-Policy`) that close a distinct real finding, P1-OBS-004, which PR #1526 did
       not cover. Left an explanatory comment in `next.config.ts` itself documenting the
       collision and this resolution for the next person who reads the file.
     - Also fixed a related, real, downstream cause of a *different* false error: the first
       `bunx tsc --noEmit` run (before this fix) reported `Cannot find module
       '@axe-core/playwright'` in `e2e/accessibility.spec.ts`. Root cause: the pre-merge `bun
       install` only saw this branch's own `package.json` deps; merging in main's `package.json`
       added several devDependencies (`@axe-core/playwright`, `jscpd`, `knip`,
       `@fchecklist/veridian-ui-kit`, `xlsx`) this branch didn't have. A second `bun install`
       after the merge (78 packages) resolved it for real -- not a stale-cache fluke.
- [x] Checked `drizzle/`: `git diff <merge-base> HEAD --stat -- drizzle/` returned completely
      empty -- this branch touches zero migration files (all the `drizzle/` changes visible in
      `git status` came from origin/main's own history). No migration-number renumbering needed.
- [x] Real validation, re-run fresh on the merged worktree (not assumed carried over from either
      side's own CI):
  - `node scripts/check-governance-yaml-parse.mjs` -- clean, all 5 governance YAML files parse
    (re-run 3 times across this session's edits to `ACTIVE-CLAIMS.yaml` /
    `terminology-guardrail-exemptions.yaml`, clean every time).
  - `node scripts/check-terminology-guardrail.mjs --file next.config.ts --file
    src/app/sitemap.ts --file src/app/robots.ts` -- clean, 0 new findings. Also ran
    `--full-repo` out of caution (the script's own header claims CI wiring): it surfaced 1 real
    new finding inside `ai-os/boss/ACTIVE-CLAIMS.yaml` (a file this PR touches) -- a
    pre-existing `@example.com` test-account address, already present in origin/main before
    this merge, that its exemption entry's baseline never covered for that category. Fixed by
    adding the missing category to that entry (real-count correction, same established pattern
    used throughout that file). The same `--full-repo` run also surfaced ~15 other files with
    unrelated pre-existing staleness (docs/master/*.md, docs/runbooks/rollback.md, several
    `progress/*.md` files, a services test file, etc.) -- none touched by this PR's own diff;
    confirmed via `grep -n "^  [a-z][a-z0-9-]*:$" .github/workflows/ci.yml` that no
    `terminology-guardrail-check` job actually exists in real CI right now (the script's
    "Phase 3 CI enforcement wiring" / "ci.yml now invokes --full-repo" header comments are
    stale/aspirational, not current fact) -- so left that unrelated, pre-existing, non-gating
    staleness alone rather than scope-creeping this PR into fixing it.
  - `bunx tsc --noEmit` -- **first attempt: real OOM crash** (`FATAL ERROR: Ineffective
    mark-compacts near heap limit`) on this laptop under real concurrent memory pressure from
    several other active sessions/worktree sweeps (`~2.8-2.9GB` free of 8GB total at the time,
    multiple `claude` processes + Windows Defender + browsers competing) -- consistent with this
    repo's known laptop-memory gotcha, not a code problem. Retried with
    `NODE_OPTIONS=--max-old-space-size=2600 node_modules/.bin/tsc.exe --noEmit`: real errors
    surfaced (the `next.config.ts` duplicate-`headers()` bug and the `@axe-core/playwright`
    missing-dependency issue, both described above and both fixed for real). Final clean run:
    **0 errors.**
  - No test files were touched by this branch's own diff (confirmed: the only files this PR
    changes are `next.config.ts`, `src/app/forgot-password/page.tsx`, `src/app/login/login-
    form.tsx`, `src/app/sitemap.ts`, `src/app/robots.ts`, `messages/en.json`, `messages/hi.json`,
    this file, `ai-os/boss/ACTIVE-CLAIMS.yaml`, `ai-os/registry/terminology-guardrail-
    exemptions.yaml`, and this task's own `progress/*.md`) -- no `bun test` run against
    non-existent touched test files.

## Remaining
- [ ] Push `rebase-sweep2b-1202`, open replacement PR "... [was #1202]" citing the original,
      close #1202 pointing to the replacement.
- [ ] Check real CI on the replacement PR; ignore known-ambient failures (E2E Tests, Vercel
      platform-wide block, Secret Scanning on pre-existing files, Promptfoo Evals timeout). Any
      other red (Type Check, Lint, Unit Tests, Test Coverage Gap Report Check, Migration checks,
      Governance YAML Parse, audit-check) is real and must be fixed before merging.
- [ ] Merge only when genuinely green (modulo the known-ambient ones); independently re-verify via
      `gh pr view --json state,mergedAt` rather than trusting the merge command's exit code alone.
- [ ] The 3 fix claims this PR carries forward (P8-CB-09 sitemap domain, P8-CB-10/P1-OBS-003
      `/forgot-password` 404, P1-OBS-004 extra security headers) still need a live retest against
      the deployed site post-merge before any of them can be boolean-certified closed -- explicitly
      held open by this branch's own prior cycle, unchanged by this rebase.
- [ ] P8-CB-02/P8-CB-03 (CSP/X-Frame-Options) are treated as **already closed** by main's PR
      #1526, independently of this PR -- this rebase intentionally dropped this branch's own
      duplicate fix for those two rather than re-closing them a second time; do not re-open work
      on them from this branch's history.
- [ ] Everything this branch's own prior cycle already logged as out-of-scope/blocked (P8-CB-01
      demo credentials, P8-CB-05/06/07 Supabase/PWA items, P8-CB-08 brand-name decision, the
      remaining ~128 of 139 total Z.AI GTM points) is unchanged by this rebase -- see
      `progress/task-20260815-041523-z-ai-gtm-findings-files-are-now-real-and.md` for the full
      original accounting.

# PROGRESS -- rebase-sweep3-1536 (real rebase-merge for PR #1536, was PR #965)

## Scope
Real rebase-merge of PR #1536 (`rebase-sweep2b-965`, "fix(OCID-020): resolve
real per-host brand mismatch on /signup and /mfa-challenge [was #965]") onto
current main, per this repo's standard rebase-sweep protocol. Already-
verified-real finding, not re-litigated here: `/signup` and `/mfa-challenge`
`page.tsx` hardcoded "VERIDIAN AI" instead of calling
`resolvePreAuthBrandByHost()`, the same per-host brand-mismatch class already
fixed on `/login`.

## Completed
- [x] Cloned the repo fresh, fetched `rebase-sweep2b-965` (PR #1536's own
      head branch) and `main`, branched `rebase-sweep3-1536` off the PR head.
- [x] `git merge origin/main`, round 1 (main at `a97ed388`) -- 4 real
      conflicts:
      - `PROGRESS.md` (this repo's single-current-entry convention) --
        replaced wholesale with this entry, per the known gotcha.
      - `ai-os/boss/ACTIVE-CLAIMS.yaml` -- main's current pruned `active:`
        list kept as base; this PR's own claim entry appended at the end.
        (Note: neither this branch's nor main's prior tip actually carried
        an entry specific to PR #965/#1536 -- both sides' pre-merge content
        was leftover from unrelated concurrent tasks [#1530/#579
        delegation-expiry on the branch side], so there was nothing of this
        PR's "own" to preserve beyond adding a fresh entry.)
      - `src/app/signup/page.tsx` and `src/app/signup/signup-form.tsx` --
        substantive, not mechanical: main had independently landed an
        identical real fix for the same `/signup` gap while this PR sat
        open (separate concurrent session, same OCID-020/OCID-038 finding
        lineage, UMR-20260804-090421-c647). Confirmed via direct blob diff
        (`git cat-file -p` on both sides -- `git show` truncates blob
        output silently in this environment, per the known gotcha) that the
        only differences were cosmetic: comment wording, a `brandName`
        local extracted once vs. repeated inline `brand?.brandName ??
        "VERIDIAN AI"`, and export style (this PR's `export default
        function SignupPage` + default-imported `SignupForm` vs. main's
        `export function SignupPageClient`, a named export). Grepped for
        other importers of either name -- none exist outside these two
        files. Resolved by taking main's already-existing implementation
        verbatim (`git checkout --theirs`) rather than reintroducing a
        functionally-redundant duplicate under a different name.
      - `src/app/mfa-challenge/page.tsx` + new `mfa-challenge-form.tsx`
        merged automatically with **no conflict** -- main had not
        independently touched `/mfa-challenge`, so this PR's real,
        still-missing contribution there is untouched. Verified post-merge:
        `resolvePreAuthBrandByHost()` is called, the hardcoded "VERIDIAN AI"
        string is gone from the rendered wordmark/title.
      - Checked `drizzle/`: this PR touches zero migration files -- no
        migration-number renumbering needed (confirmed via
        `git ls-tree -r origin/main -- drizzle/` and the PR's own diff).
- [x] `bun install` -- clean, 1273 packages.
- [x] `node scripts/check-governance-yaml-parse.mjs` -- passed, all 5
      governance YAML files parse cleanly.
- [x] `bunx tsc --noEmit` -- clean, no errors (ran with
      `NODE_OPTIONS=--max-old-space-size=2500` after an initial OOM crash
      caused by leftover `node.exe`/`bun.exe` processes from a prior
      concurrent session still holding memory on this laptop -- killed
      those first, matching this repo's known low-RAM gotcha).
- [x] `bun test` on touched test files -- no-op, confirmed correctly: diffed
      this PR's own commits against their merge-base with main
      (`git diff <merge-base> rebase-sweep2b-965`) -- 7 files touched, zero
      `*.test.ts` and zero `src/lib/services/*.ts` (the `check-new-test-
      coverage.mjs` gate's scope), so no new test coverage is required.
- [x] Pushed `rebase-sweep3-1536` -> `origin/rebase-sweep2b-965` (fast-
      forward, `ece38d48..3bd5924e`) -- PR #1536 picked it up directly.
- [x] Re-checked PR #1536's mergeable state post-push: still
      `CONFLICTING`/`DIRTY` -- main had advanced again by one more commit
      (`7c96552d`, PR #1202's own rebase-sweep) in the few minutes between
      round-1's merge and its push landing, confirming this repo's
      unusually heavy concurrent rebase-sweep traffic today.
- [x] `git merge origin/main`, round 2 (main at `7c96552d`) -- 2 conflicts,
      both the same convention files again (`PROGRESS.md`, this file);
      resolved the same way. PR #1202 touched `next.config.ts`,
      `src/app/login/login-form.tsx`, `src/app/sitemap.ts`,
      `src/app/robots.ts`, and `messages/*.json` -- none overlapping this
      PR's `src/app/signup/*` / `src/app/mfa-challenge/*` scope; confirmed
      no conflict was reported in either directory this round.

## Remaining
- [ ] Re-run validation after round 2 (governance YAML parse, tsc) before
      pushing again.
- [ ] Push round-2 merge to `rebase-sweep2b-965`, re-check PR #1536's
      mergeable state immediately (main may advance again).
- [ ] Check real CI on PR #1536; retry transient network errors up to 5
      times. Ignore known-ambient non-blocking failures (E2E Tests, Vercel
      org-wide deployment-blocked, Secret Scanning if pre-existing,
      Promptfoo Evals).
- [ ] Merge only when genuinely green (modulo ambient ones):
      `gh pr merge --squash --delete-branch`.
- [ ] Independently re-verify via `gh pr view --json state,mergedAt` rather
      than trusting the merge command's exit code alone.

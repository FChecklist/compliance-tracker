# PROGRESS -- task-20260718-123002-retry-2--ai-engineering-quality--techni

VERIDIAN Review Framework gap-closure: AI Engineering Quality / Technical
Debt & Complexity (5 findings, closed as one coherent PR).

## Completed
- [x] Read ai-os/boss/ACTIVE-CLAIMS.yaml, registered this task's own claim
      (no overlapping in-flight work found -- all other `active:` entries
      are >4h stale per that file's own staleness rule), committed+pushed
      it ahead of the real work commit per that file's own protocol.
- [x] Re-verified all 5 findings against current code before changing
      anything (per this task's own instructions -- codebase has moved
      since the evaluation was written): grepped for "knip"/"jscpd" repo-wide
      -- zero existing matches, confirming findings 1+2 are genuinely still
      open, not already resolved.
- [x] **Finding 1 (Medium, Dead Code Detection) -- implemented.** Added
      `knip` as a devDependency, `knip.jsonc` config (entry additions for
      `scripts/**` + `ai-os/scripts/**` so real CLI tools aren't
      misreported as dead files; `ignore`/`ignoreDependencies`/
      `ignoreBinaries` for confirmed false-positive categories -- shadcn/ui
      components, `sharp`/`tailwindcss` build-tool-only deps, `promptfoo`
      [deliberately global-installed per `ai-prompt-evals.yml`'s own header,
      confirmed NOT a knip false-negative to "fix"]). `scripts/check-dead-code.mjs`
      wraps it as a count ratchet against `ai-os/registry/dead-code-baseline.yaml`
      (same enforcement class as `check-terminology-guardrail.mjs`'s own
      ratchet -- honest limitation documented in both files' headers: a
      COUNT ratchet, not a fingerprint ratchet). Wired into `ci.yml` as
      `dead-code-check`. Along the way, knip surfaced 4 genuinely real
      `unlisted dependencies` findings (`js-yaml`, `esbuild`, `playwright`
      used directly by several scripts but only resolved via `overrides`/
      transitive hoisting) -- fixed those for real (added as explicit
      devDependencies) rather than just baselining past them, tightening
      the ratchet to lock in the improvement.
- [x] **Finding 2 (High, Duplicate Code Detection) -- implemented.** Added
      `jscpd` as a devDependency, `.jscpd.json` config (scope: `src/**/*.{ts,tsx}`,
      excluding tests/schema.ts/shadcn-ui -- see that file's own comments
      for why), threshold 6% (measured 5.40% at authoring time, small
      headroom for organic growth). `scripts/check-duplicate-code.mjs`
      wraps jscpd's own native `--threshold` gating for consistent
      check-*.mjs-style output. Wired into `ci.yml` as `duplicate-code-check`.
- [x] **Finding 3 (Medium, Technical Debt Score) -- implemented.**
      `scripts/compute-technical-debt-score.mjs` derives a live composite
      score from the 3 existing trackers the finding names verbatim: open
      `ai-os/MASTER-TRACKER.yaml` items (79, structurally counted), the
      already-established "empty-guardrail %" metric from
      `ai-os/system-tree/50-merged-tree.yaml` (51.1%, matches
      `SYSTEM-AUDIT-ROUND-2.md`'s own prior hand-count of 48/94 -- now
      live-computed instead of hand-counted prose), and
      `ai-os/registry/stale-doc-manifest.yaml`'s entry count (44). Reporting
      tool only (always exits 0, no CI gate -- see its own header for why a
      debt score isn't the kind of thing a pass/fail threshold fits
      honestly); wired into `ci.yml` as an informational `technical-debt-score`
      job so the trend is visible in CI history over time.
- [x] **Finding 4 (Medium, Code Complexity Score) -- implemented.** Added
      ESLint's built-in `complexity` rule (core rule, no plugin needed --
      an `eslint-plugin-complexity` devDependency was added by mistake
      first, found to be an unrelated niche package, removed) at `"warn"`
      with threshold 20 (ESLint's own documented default). `"warn"` not
      `"error"` deliberately: `bun run lint` only fails on errors, so this
      surfaces every over-threshold function without breaking CI on day one
      across a codebase never measured against this rule before. Confirmed
      real signal, not noise: 93 warnings, concentrated exactly where the
      finding predicted ("largest orchestration files") -- e.g.
      `POST /api/ai/team/dispatch` complexity 107, `dispatchEngine`
      complexity 398, `executeTask` complexity 50, `GET /api/me`
      complexity 51.
- [x] **Finding 5 (Medium, Refactoring Readiness) -- implemented.**
      `scripts/list-refactor-priority-candidates.mjs` ranks every
      `src/lib/**/*.ts` file with no co-located `.test.ts` by
      `LOC x commit-change-frequency` (one batched `git log --name-only`
      call, not 360 individual subprocess calls) -- directly operationalizes
      "prioritize adding tests to the largest/most-changed untested files."
      `src/lib/db/schema.ts` excluded (hundreds of table definitions,
      dominates by an order of magnitude, not meaningful "refactor risk" in
      the same sense as service logic). Top of the real, current ranking:
      `erp-accounting-service.ts`, `report-catalog-service.ts`,
      `compliance-service.ts`. Reporting/prioritization tool, not a CI gate
      -- writing the actual tests for these files is real, substantial
      follow-up work (domain-logic-dependent, not mechanical), deliberately
      out of scope for this tooling-focused gap-closure PR; the tool itself
      is the deliverable this finding asks for.
- [x] Added `package.json` scripts for all 4 new tools (`check:dead-code`,
      `check:duplicate-code`, `debt:score`, `refactor:priority`) so they're
      discoverable and runnable outside CI too.
- [x] Full verification before commit: `bun run lint` (0 errors, 96
      warnings incl. the new complexity ones), `bunx tsc --noEmit` (0
      errors -- first attempt OOM'd on this shared box's available memory,
      unrelated to these changes; passed clean with more heap headroom),
      `bun test` (2596 pass / 0 fail across 226 files), and all 4 new
      scripts run clean against the real repo state.
- [x] Did NOT touch `src/lib/services/permission-service.ts` or any other
      in-flight worker's declared scope, per this task's own constraint --
      confirmed via `git grep` before starting.

## Remaining
- [ ] **CI wiring for the 3 new jobs (`dead-code-check`, `duplicate-code-check`,
      `technical-debt-score`) in `.github/workflows/ci.yml` is written and
      committed locally (commit on top of the pushed branch tip) but NOT
      pushed** -- this session's `gh` token lacks the `workflow` OAuth
      scope, and GitHub rejects any push that touches
      `.github/workflows/*.yml` without it (confirmed: `git push` rejected
      with "refusing to allow an OAuth App to... update workflow
      `.github/workflows/ci.yml` without `workflow` scope"). All 4 tools
      themselves (`knip.jsonc`, `.jscpd.json`, the 4 `scripts/*.mjs`, the
      `package.json` scripts) ARE pushed and runnable locally/manually
      right now (`bun run check:dead-code`, `check:duplicate-code`,
      `debt:score`, `refactor:priority`) -- only the CI job registration is
      blocked. **Needs the Owner (or a session with `workflow` scope) to
      either push this branch's local `ci.yml` commit, or manually add the
      3 job blocks** (see this branch's local git log for the exact diff,
      or re-derive from this progress file's "Completed" section above --
      each job is a straightforward `bun install --frozen-lockfile` +
      `node scripts/check-*.mjs` step, matching every existing job in that
      file). Real follow-up work this PR's tools make
      visible (not this PR's job): (a) verify/clean up the 234 src/lib +
      17 src/app files knip currently reports as fully unused (plausibly a
      mix of real dead code and false positives from this codebase's
      dynamic, string-keyed dispatch pattern -- see
      `dead-code-baseline.yaml`'s own header); (b) write real tests for
      the top-ranked files `refactor:priority` surfaces, starting with
      `erp-accounting-service.ts`; (c) consider whether any of the 93
      `complexity` warnings (especially the >100-complexity outliers:
      `POST /api/ai/team/dispatch` at 107, `dispatchEngine` at 398) are
      worth a dedicated refactor PR.

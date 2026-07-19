# PROGRESS -- task-20260719-052950: real root-cause fix for PR #417's ajv/promptfoo conflict

Task: do NOT accept "ajv/promptfoo dependency conflict, pre-existing, non-blocking" as a
permanent answer (that was the prior rescue session's conclusion, task-20260718-185248) --
genuinely attempt the root-cause fix, with real command-output evidence either way.

## Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml` -- no other active claim on PR #417 or this file
      scope found.
- [x] PR #417's real head branch was already checked out in another task's worktree
      (`task-20260718-051002-...`), and a THIRD worktree (`task-20260718-185248-rescue-pr--417`)
      had already done a prior rescue pass -- fetched `refs/pull/417/head` into a fresh local
      branch `pr417-fix` instead of `gh pr checkout`, same commit.
- [x] The prior rescue session's work was already pushed to the PR (merge + migration
      renumber + a `923cb6c1` commit that removed a duplicate migration and left an
      undocumented, unfixed claim in its message about "documenting the ajv v6/v8 constraint
      honestly" -- checked: no actual code change accompanied that claim, just a commit
      message). Re-merged current `origin/main` (37 commits behind) into the PR branch:
      real 3-way conflicts in `PROGRESS.md` (kept ours), `ai-os/CONSTITUTION.yaml` (both sides
      independently edited GP-08/GP-09's status text -- merged both substances: kept main's
      newer claim-verification.ts addition, folded back in this PR's own hasGroundingData()
      specifics that main's version had dropped), `ai-os/boss/ACTIVE-CLAIMS.yaml` (both sides
      appended new claim entries -- kept both, pure list append). No conflict in
      `src/lib/services/report-engine-service.ts` (clean auto-merge).
- [x] Re-verified the drizzle migration situation (task step 6) from scratch rather than
      trusting the prior session's "already merged as 0224 via a different PR" claim at face
      value: confirmed the exact byte-identical content of the deleted
      `drizzle/0224_erp_exchange_rates_source.sql` genuinely already exists on `origin/main`
      today (merged via PR #411, "FX live rate feed") under that same filename -- main also
      independently has an unrelated, pre-existing, still-unresolved duplicate
      `drizzle/0224_crm_accounts_contacts_actor_columns_no_fk.sql` at the same number (not
      introduced by this PR, not touched, consistent with 2 other sessions' own notes on that
      same pre-existing main-level duplicate). The prior session's deletion was correct; no
      migration was actually lost. Confirmed no migrations remain in this PR's own diff vs
      `origin/main` (`git diff origin/main...pr417-fix -- drizzle/` shows only a deletion).

- [x] **Root-caused the ajv conflict for real** (not just re-describing it). Root cause:
      `package.json`'s `overrides` block force-pins `"ajv": "6.14.0"` at the tree root
      (originally added in `023bf1c1` to satisfy eslint's `^6.14.0` requirement via a forced
      single hoisted version -- bun does not support npm-style nested/per-parent-scoped
      overrides, confirmed by the task brief and re-confirmed here). promptfoo needs
      `ajv@^8.18.0` + `ajv-formats@^3.0.1` (which itself needs `ajv@^8`). Removed just the
      `"ajv"` line from `overrides`, did a clean `rm -rf node_modules bun.lock && bun install`:
      bun correctly resolved ajv@6.15.0 at the root (still satisfies eslint's `^6.14.0`) AND
      gave promptfoo/ajv-formats/ajv-keywords/schema-utils their own independently-nested
      ajv@8.20.0 copies. `bun run lint` still passed clean (0 errors, same 3 pre-existing
      warnings) -- eslint's own resolution genuinely unaffected.
- [x] That fix alone was NOT sufficient -- `bunx promptfoo --version` (via a real, fully
      re-installed tree) crashed with a **different, deeper** error:
      `TypeError: Cannot read properties of undefined (reading 'identify')` at
      `node_modules/promptfoo/dist/.../logger-*.js`, tracked to
      `yaml.setTag.identify`/`yaml.legacyMapTag`/`yaml.defineMappingTag` -- js-yaml v5-only
      APIs that promptfoo's own bundled code calls (`import * as yaml from "js-yaml"`,
      promptfoo's own `package.json` pins `"js-yaml": "5.2.1"` exactly). `package.json`'s
      `overrides` ALSO force-pins `"js-yaml": "^4.2.0"` root-wide -- a real, still-necessary
      CVE fix (`950ede21`, Dependabot alert) for `@mdxeditor/editor`'s own **exact** pin
      `"js-yaml": "4.1.1"` (confirmed still true at `@mdxeditor/editor`'s current latest,
      3.55.0 -- no newer release exists that drops this pin). Since `@mdxeditor/editor` pins
      an *exact* version (not a range), and bun has no per-parent override scoping, there is
      **no single root-level pin** that can simultaneously satisfy eslint (ajv v6), promptfoo
      (ajv v8 + js-yaml v5), and `@mdxeditor/editor` (needs its vulnerable js-yaml v4.1.1
      forced up to a safe v4.2.0+, not v5) in one shared `node_modules` tree. This is the same
      class of problem as the ajv conflict, one layer deeper -- confirmed via real
      `rm -rf node_modules bun.lock && bun install` + `grep version` on the resolved
      `node_modules/js-yaml/package.json` (4.3.0, forced) and promptfoo's crash trace, not
      assumed.
- [x] Given that, reverted the `ajv` override removal (restored `"ajv": "6.14.0"` exactly as
      it was -- unnecessary once promptfoo is isolated) and took the task's documented
      fallback: **isolate promptfoo from the app's shared dependency tree entirely.**
      `promptfooconfig.yaml` is fully self-contained (inline prompt/test text only, provider
      is a generic `openai:chat:...` pointed at Groq -- no imports of `src/lib/*`, confirmed
      by reading the whole file), so this is safe. Removed `"promptfoo": "^0.121.17"` from
      `package.json` devDependencies entirely (kept `test:prompts` script text unchanged --
      still valid, just now expects `promptfoo` to be resolved via `$PATH`, e.g. a global
      install, rather than the project's own `node_modules`). Clean reinstall confirmed:
      `node_modules/js-yaml` back to 4.3.0 (root override intact, protecting
      `@mdxeditor/editor`), `node_modules/ajv` back to 6.14.0 (root pin intact, unmodified),
      zero `promptfoo` directories anywhere in the tree, `bun run lint` still 0 errors.
- [x] **Real, isolated verification** (not just "should work"): `npm install -g
      promptfoo@0.121.19 --prefix /tmp/promptfoo-isolated-test/global` (a directory
      completely outside this repo's own tree) -- installed clean, 698 packages, its own
      independent `js-yaml@5.2.1` + `ajv@8.20.0`. `promptfoo --version` -> `0.121.19`, no
      crash. `promptfoo eval -c promptfooconfig.yaml` (against this repo's real
      `promptfooconfig.yaml`, using a real `GROQ_API_KEY` present in this session's own
      environment) genuinely starts, parses the 25-test-case matrix, and dispatches real
      HTTP calls to `https://api.groq.com` -- confirmed via a `-j 1 -n 1` smoke run that
      completed a full pass in 8s with real graded output (1 pass / 4 fail on that filtered
      slice -- see "Known, separate, out-of-scope issue" below for what that number means).
      **No ajv/ajv-formats/js-yaml resolution error at any point.** This is the actual,
      demonstrated root-cause fix, not a workaround: eslint and `@mdxeditor/editor` keep
      their real, currently-necessary root overrides untouched; promptfoo runs in total
      isolation and never touches bun's tree at all.
- [x] Updated `.github/workflows/ai-prompt-evals.yml`: removed the `oven-sh/setup-bun` +
      `bun install --frozen-lockfile` steps (unneeded -- the eval doesn't touch the app's own
      dependency tree at all now), replaced with `actions/setup-node@v5` +
      `npm install -g promptfoo@0.121.19`, and the run step now calls `promptfoo eval -c
      promptfooconfig.yaml` directly (same underlying command `test:prompts` already ran,
      just no longer routed through `bun run`). Documented the real root cause (both the ajv
      AND the js-yaml conflict, and why bun's lack of nested overrides makes a shared-tree fix
      impossible here) directly in the workflow file's own header comment, matching this
      repo's own convention of self-documenting CI gates.
- [x] `bunx tsc --noEmit` -- clean, 0 errors.
- [x] `bun run lint` -- 0 errors, same 3 pre-existing warnings (litigation route, data-table
      incompatible-library note, VeriComposer unused eslint-disable), none introduced.
- [x] `bun test` -- **1757 pass, 0 fail**, 3465 expect() calls across 141 files. Console noise
      during the run (APP_RUNTIME_DATABASE_URL warnings, "db unreachable"/"simulated network
      failure" errors) is expected fail-closed logging from tests exercising their own error
      paths, not failures.
- [x] `bun run build` -- clean production build, all routes compiled.
- [x] All 6 local governance/guardrail scripts pass: `check-asset-registry-coverage.mjs`
      (421 tables, 142 registered + 302 exempted), `check-doc-cross-references.mjs` (340
      refs), `check-doc-quarantine-banner.mjs` (44 files), `check-guardrail-presence.mjs`
      (88/88 markers), `check-metadata-index-coverage.mjs` (31 items), `check-migration-
      collision.mjs` (21 files, no collisions).

## Known, separate, out-of-scope issue found along the way (documented, not silently fixed)
While verifying a real `promptfoo eval` run, found that `promptfooconfig.yaml` defines 5
unrelated prompts (chat / document-extraction / reports-recipe / reports-builder /
capability-audit) and 5 corresponding test entries, but promptfoo's `TestCase` schema has no
per-prompt scoping field (confirmed against the installed package's own `.d.ts`) -- so by
design promptfoo cross-multiplies every test against every prompt (5x5 = "Running 25 test
cases"), not just the 5 intended 1:1 pairs. Confirmed via a `-j 1 -n 1` filtered run: the
"first" test's chat-only vars got applied to all 5 prompt columns, and 4 of 5 predictably
failed their (prompt-specific) rubric assertions, since document/report/audit prompts never
received their own real vars in that slice. This is a genuine pre-existing content/design
issue in the PR's own `promptfooconfig.yaml` (present since it was authored, orthogonal to
and not caused by the ajv/js-yaml dependency conflict this task targets), and would need its
own fix (e.g. splitting into 5 separate config files, one real `promptfoo eval` invocation
per prompt+its own tests) to make the full 25-case matrix genuinely green in CI. A full,
unfiltered 25-test run was attempted in this sandbox (`-j 2`, real `GROQ_API_KEY`) to get a
definitive real/vs/mismatched pass count, but did not complete within this session's time
budget (see below) -- so the exact full-matrix pass count is not confirmed, only the smoke
slice's 1/5 pattern, which is consistent with what the "5 real diagonal pairs out of 25"
structural analysis predicts. **Left unfixed and out of scope for this task** (task brief was
explicitly the ajv/promptfoo *dependency* conflict) -- flagged here for whoever picks up
`promptfooconfig.yaml` next.

## Also observed, not part of this task's scope
A full unfiltered `promptfoo eval -c promptfooconfig.yaml --no-cache -j 2` run against the
real Groq API in this sandboxed session did not finish within ~10 minutes and was killed by
its own `timeout 580` wrapper, despite a direct `curl` to the same Groq chat-completions
endpoint with the same API key returning a normal response in well under a second, and a
smaller `-j 1 -n 1` slice completing cleanly in 8s. This looks like either promptfoo's own
internal request-queue behavior under concurrency in this specific sandbox, or Groq-side
throttling triggered by this exact key/session -- not an ajv/js-yaml/dependency-resolution
issue (no crash, no stack trace, no dependency-related error at any point; process stayed
alive and consumed real CPU/network the whole time). Noted honestly rather than guessed away;
does not affect the conclusion that the dependency conflict itself is fixed.

## SECURITY NOTE (self-reported)
While checking whether `GROQ_API_KEY` was set in this session's shell, an earlier command in
this session used `${GROQ_API_KEY:-no}` (intending to print "no" only if unset) -- that syntax
still expands to the REAL value when the variable IS set, and the actual key value was briefly
printed into this session's tool output/transcript. Flagged immediately to the user in-session.
No further commands in this task printed the value (later checks used
`if [ -n "$GROQ_API_KEY" ]` instead). Recommend the Owner rotate this key out of an abundance
of caution, standard practice after any accidental secret exposure, even a low-risk one
confined to a single session's own tool transcript.

## Remaining
- [ ] Push the merged + fixed branch to PR #417
- [ ] Post structured `AUDIT: PASS` PR comment (8 required fields)
- [ ] Wait for CI via `gh run watch --exit-status`, including the now-fixed "Promptfoo Evals"
      job (non-required but should now genuinely run without a dependency crash; full-matrix
      content pass rate is a separate, documented, out-of-scope issue above)
- [ ] Classify TIER (no schema/migration touch remains in this PR's own diff vs main -- only
      `.github/workflows/ai-prompt-evals.yml`, `package.json`, `bun.lock`,
      `ai-os/CONSTITUTION.yaml`, `ai-os/boss/ACTIVE-CLAIMS.yaml`, `PROGRESS.md`, plus this
      PR's own original file scope -- re-classify tier accordingly before merge)
- [ ] Report final status with real command-output evidence

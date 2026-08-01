# PROGRESS -- task-20260801-173859-retry-ai-engineering-quality-ai-modifica

PR: https://github.com/FChecklist/compliance-tracker/pull/683 (open, awaiting CI)

SPEC: VERIDIAN Review Framework gap-closure: AI Engineering Quality / AI-Modification Readiness (2 findings).

Redispatch of task-20260718-064006 (original attempt blocked at first invocation by the
OpenRouter/Cerebras balance hard-stop, removed from preflight-guard.py in commit 7ff5be8,
2026-08-01). Read ai-os/boss/ACTIVE-CLAIMS.yaml first (per protocol) -- no active claim
overlaps this scope (comment-discipline tooling / CLAUDE.md high-risk-file doc).

## Verified against current code (both findings still real, not already resolved)
- Grepped all 300 files in `src/lib/services/` for a header comment: 299/300 already follow
  the convention (a narrative `//` block above imports explaining WHY the file exists), only
  `context.ts` doesn't -- confirms the finding's premise (real convention, zero tooling
  enforcement) rather than assuming the CSV description was still accurate.
- Computed real large+untested files (>=400 lines, no dedicated `<file>.test.ts` sibling)
  across `src/lib/` + `src/lib/services/` -- 8 files, listed below. Cross-checked each
  against every `*.test.ts` file's imports (not just its own missing sibling) so the CLAUDE.md
  note doesn't overstate "zero coverage" for files that do get indirect/partial coverage from
  a cross-cutting test file (e.g. `tenant-isolation.test.ts`).

## Completed
- [x] `scripts/check-service-header-comment.mjs` -- new CI check, same reviewable-diff-ratchet
      class as `check-terminology-guardrail.mjs` (--diff-only, only NEW files matter, existing
      files grandfathered). Fails if a file newly added directly under `src/lib/services/`
      (excluding `*.test.ts`) doesn't open with a `//` or `/*` header comment totaling >=40
      chars of real text. Verified manually: correctly flags `context.ts` (the one existing
      file without a header) when passed via `--file`, passes on a real service file, exits 0
      on `--diff-only` in this branch (0 new files). `node --check` passes; `js-yaml` isn't
      installed in this sandbox but `python3 -c "import yaml; yaml.safe_load(...)"` confirms
      `.github/workflows/ci.yml` still parses after the edit.
- [x] Drafted the CI job to wire the new check in as `service-header-comment-check`, matching
      `terminology-guardrail-check`'s job shape (fetch-depth 0, no bun install needed -- script
      only uses node built-ins). **Not committed to this branch** -- see Remaining below.
- [x] Added a "High-Risk Files (AI Modification Caution)" section to `CLAUDE.md`: explicit
      table of the 8 files matching >=400 lines + no dedicated test file, each annotated with
      real cross-reference-checked coverage notes (3 have zero references in any test file;
      the rest get partial/indirect coverage from a different file's test suite, not full
      coverage of their own). Includes the exact one-liner to regenerate the list before
      trusting it, dated snapshot (2026-08-01), and an explicit note that this is a manual
      snapshot, not a live/automated score (no readiness-scoring tool was built -- out of this
      gap's stated scope, which asks only to "flag high-risk files explicitly in CLAUDE.md").
- [x] Did not touch `src/lib/services/permission-service.ts` or any other in-flight worker's
      declared scope. No permission-service changes were needed for this task at all.

## Remaining
- [ ] **BLOCKED on this session's gh token (no `workflow` scope):** first push attempt (with
      `.github/workflows/ci.yml` wired in) was rejected outright by GitHub -- "refusing to allow
      an OAuth App to create or update workflow `ci.yml` without `workflow` scope" (known
      limitation, see memory `gh-token-lacks-workflow-scope`). A same-branch revert commit on
      top was *also* rejected (GitHub blocks the push if *any* commit in the pushed range
      touches a workflow file, not just the net diff) -- so the ci.yml change was dropped
      entirely via `git reset --soft` + `git checkout --` before the first push, never committed
      to this branch at all. `scripts/check-service-header-comment.mjs` itself is included and
      correct (verified standalone), but it is **not yet wired into CI** -- a session/token with
      `workflow` scope (or the repo owner) needs to add this job to `.github/workflows/ci.yml`,
      in the same place as `terminology-guardrail-check` (right before `migration-collision-check`):

      ```yaml
        service-header-comment-check:
          name: Service File Header Comment Check
          runs-on: ubuntu-latest
          steps:
            - uses: actions/checkout@v7
              with: { fetch-depth: 0 }
            - run: node scripts/check-service-header-comment.mjs --diff-only
      ```

## Environment limitations
- `bun` is not installed in this sandbox, so `bun run lint` / `bunx tsc --noEmit` / `bun test`
  could not be run locally; validated the new script with `node --check` and a manual
  `--file`/`--diff-only` smoke test instead, and validated CI YAML edits parse with `python3`'s
  yaml module. CI's own Lint/Type Check/Unit Tests jobs will run for real on the PR.

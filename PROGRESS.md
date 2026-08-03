# PROGRESS -- task-20260803-142324-pm-decision--add-real-yaml-safe-load-ci

## Completed
- [x] Read CLAUDE.md/AGENTS.md governance docs; confirmed task is a mechanical CI addition, not blocked by OCID-021
- [x] Surveyed existing guardrail-check script family (scripts/check-*.mjs) + ci.yml wiring pattern to reuse
- [x] Scoped target file list to the governance YAML files this session's CLAUDE.md "Read Before Starting Work" list actually depends on
- [x] Registered claim in ai-os/boss/ACTIVE-CLAIMS.yaml, committed+pushed separately per protocol
- [x] Wrote scripts/check-yaml-safe-load.mjs (js-yaml safe `load()` against ACTIVE-CLAIMS.yaml/CONSTITUTION.yaml/OS.yaml/MASTER-TRACKER.yaml; clear file+line+column error on parse failure)
- [x] Wired new `YAML Safe Load Check` job into .github/workflows/ci.yml following existing job pattern (Guardrail Presence Check style)
- [x] Ran the new check against `main`'s real files with `bun install` + `node`: found 4 genuine pre-existing duplicate-key parse failures in ACTIVE-CLAIMS.yaml (distinct from the PR #818 bug), fixed all 4 by restoring the correct entry boundaries (mirrors the check-migration-collision.mjs precedent of fixing pre-existing violations in the same PR that adds the new guardrail check) -- CONSTITUTION.yaml/OS.yaml/MASTER-TRACKER.yaml had no issues
- [x] Confirmed guardrail-presence + metadata-index-coverage checks and `bun run lint` still pass after the ACTIVE-CLAIMS.yaml fixes (0 errors, pre-existing unrelated warnings only)

## Blocker (known, per memory `gh-token-lacks-workflow-scope`)
This session's `gh`/git push token (account FChecklist) has scopes
`gist, read:org, repo` -- **not `workflow`** -- so GitHub rejects any
`git push` whose branch contains a commit touching `.github/workflows/*.yml`
("refusing to allow an OAuth App to create or update workflow ... without
`workflow` scope"). Confirmed by direct push attempt this session (remote
rejected `HEAD`, no SSH deploy key configured as an alternate path either).
Splitting the change per that memory's documented option (B): push
everything real except the one-line `ci.yml` job wiring now (script
itself, the pre-existing YAML fixes it surfaced, this file); the `ci.yml`
diff is committed **locally only** (not pushed) on this branch as a
clearly-labeled follow-up commit, with its exact diff also duplicated in
the PR description, for the Owner or a session with `workflow` scope to
apply directly to this branch or cherry-pick.

- [x] Pushed everything except ci.yml (commit 55253a27)
- [x] Independently verified via a dedicated real git branch (`verify/yaml-safe-load-negative-test`, local only, deleted after use): intentionally inserted a duplicate `claimed_at:` key into `ai-os/boss/ACTIVE-CLAIMS.yaml`, ran `node scripts/check-yaml-safe-load.mjs` -> genuinely failed (exit 1, clear file+line+column error), committed that state, then `git revert`'d it and re-ran -> genuinely passed (exit 0, "4 governance YAML file(s) parse cleanly")
- [x] Opened PR #821 describing the workflow-scope split + included the exact `ci.yml` diff verbatim in the PR description for the Owner/a workflow-scoped session to apply directly to this branch
- [x] Updated ACTIVE-CLAIMS.yaml claim status to `[PUSHED, PR #821 OPEN -- ci.yml wiring itself blocked on workflow-scope handoff]`

## Remaining
- [ ] Push this final ACTIVE-CLAIMS.yaml/PROGRESS.md status update
- [ ] Owner or a workflow-scoped session applies the `ci.yml` diff from PR #821's description to this branch and pushes it, so the "YAML Safe Load Check" job actually runs in GitHub Actions on this PR
- [ ] Once that job is live: re-run the break/restore verification against the real GitHub Actions job (not just the local script) for full end-to-end confirmation, then merge
- [ ] Update COMPLETED.yaml (doer + auditor entries) once merged, per AGENTS.md Rule 7(d)

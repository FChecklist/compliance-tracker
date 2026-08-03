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

## Remaining
- [ ] Push everything except ci.yml (this commit)
- [ ] Independently verify the script itself (already done locally: fails on real pre-existing dupes, passes after fix, passes on all 4 target files)
- [ ] Open PR describing the split + include the exact ci.yml diff for the Owner/workflow-scoped agent to apply, so the real CI job step can actually go live and then be verified end-to-end (break/restore) on GitHub Actions
- [ ] Update ACTIVE-CLAIMS.yaml claim status, update COMPLETED.yaml per protocol

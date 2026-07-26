# PROGRESS -- task-20260726-171926-remove-anthropic-api-key-dead-code-path

V2-23-REMOVE-DEAD-ANTHROPIC-PATH: remove the dead `ANTHROPIC_API_KEY` / `claude-task`
agent-dispatch path.

PR: https://github.com/FChecklist/compliance-tracker/pull/578 (WIP -- see blocker below).

## Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml` -- no collision on this file scope; registered
      a claim entry for this task before starting real edits.
- [x] Re-verified the dead path live in the repo (did not trust the triage evidence blindly):
  - `.github/workflows/ai-dispatch.yml` lists `claude-task` as an accepted
    `repository_dispatch` type, but only `dispatch-log` (generic logging for every event
    type) and `zai-agent` jobs exist -- there is no `claude-agent`/equivalent job. Confirmed
    dead.
  - `.github/workflows/claude.yml` -- a *separate* workflow (official
    `anthropics/claude-code-action@v1`, triggered by `@claude` PR/issue comments), authenticated
    via `secrets.ANTHROPIC_API_KEY`. `gh run list --workflow=claude.yml` shows every historical
    run concluded `skipped` -- the job's `if:` condition (requires a literal `@claude` mention)
    has never once been true, so this workflow has never actually invoked Claude either.
    Confirmed dead, and this is the actual site AGENTS.md's "Claude Code (Secondary Agent) ...
    API key: stored as ANTHROPIC_API_KEY" describes.
  - `ai-os/MASTER_INDEX.yaml` (credit-ledger doc) independently confirms: "ANTHROPIC_API_KEY is
    explicitly disabled on this server, no ANTHROPIC_BASE_URL override exists" -- the key was
    never funded/activated anywhere.
  - `src/lib/ai-team/roster.ts` and `.github/workflows/ai-team-workforce.yml` each carry one
    comment that names the dead event/secret literally (historical-context comments, not call
    sites).
- [x] **Judgment call, documented per this task's own "re-verify, don't assume" instruction:**
      `src/lib/orchestra-model-resolver.ts:200` (`case "anthropic": return
      process.env.ANTHROPIC_API_KEY`) also references the same env var, but it is **NOT** part
      of this dead path -- verified it is one branch of a genuinely live, actively-implemented,
      customer-facing multi-provider LLM abstraction:
      - `src/app/api/settings/{model-config,tenant-ai-config,ai-config}/route.ts` all list
        `"anthropic"` as a valid, selectable BYO-key provider for a customer org's Orchestra
        Layer model config (encrypted key stored in `customerModelConfig`).
      - `src/lib/llm-client.ts` has fully-implemented `callAnthropic`/`callVisionAnthropic`
        functions wired into `callLLM`/`callLLMVision`'s provider switch.
      - `src/lib/prompt-compiler/prompt-portability.ts` has a real Anthropic-shape adapter.
      - `src/lib/services/prompt-eval-service.ts`'s `EVAL_PROVIDERS` includes `"anthropic"`.
      - `platformApiKeyFor()` (where the `ANTHROPIC_API_KEY` read lives) is the *generic*
        platform/shared-pool key resolver used across all of the above, exactly parallel to its
        `groq`/`openai`/`google`/`cerebras` cases -- not specific to the AGENTS.md agent-dispatch
        mechanism at all.
      Removing this would delete a real, live, unrelated product feature (customer BYOK for the
      Anthropic provider), which is explicitly out of scope ("do NOT remove the legitimate
      path" / additive-only unless the original prompt calls for a fix) and would be a mistake,
      not dead-code removal. **Left untouched, on purpose.**
- [x] Prepared the removal: drop `claude-task` from `.github/workflows/ai-dispatch.yml`'s
      `repository_dispatch` types (+ trim the now-stale `claude|` out of the matching
      `workflow_dispatch.engine` input description -- that manual-trigger option never routed
      to any job either), delete `.github/workflows/claude.yml` entirely, and add
      `scripts/no-dead-anthropic-dispatch-path.test.ts` as a permanent regression guard
      (bun:test, zero dependencies; asserts `ai-dispatch.yml` has no `claude-task` trigger,
      `claude.yml` no longer exists, and no `.github/workflows/*.yml` references either the
      removed event or the secret). Ran standalone: `bun test
      scripts/no-dead-anthropic-dispatch-path.test.ts` -- 3 pass / 0 fail.
- [x] Reworded the two remaining comment references so they no longer name the removed
      event/secret literally, while preserving the historical context:
      `src/lib/ai-team/roster.ts` (`DEEPSEEK_V4_PRO` comment) and (pending, see blocker below)
      `.github/workflows/ai-team-workforce.yml` (header comment).
- [x] Updated `AGENTS.md`'s "Claude Code (Secondary Agent)" entry to record this as pending
      removal (see blocker below), with an explicit note distinguishing it from the still-live
      "Super Boss" `CLAUDE_CODE_OAUTH_TOKEN` path and the still-live
      `orchestra-model-resolver.ts` BYOK `anthropic` provider option, so a future reader doesn't
      conflate the three.
- [x] Verified the success-criteria grep is clean except for the one intentionally-preserved,
      legitimate hit explained above (once the blocked workflow-file half below lands):
      `grep -rn "ANTHROPIC_API_KEY\|claude-task" src .github/workflows` returns exactly one
      remaining line, `src/lib/orchestra-model-resolver.ts:200`, which is the deliberately-kept
      BYOK code path.
- [x] Validated YAML syntax of both edited workflow files
      (`python3 -c "yaml.safe_load(...)"`) before committing them locally.

## BLOCKER (real, verified -- not routed around)
This session's `gh`/`git` push credential (account FChecklist) has OAuth scopes `gist,
read:org, repo` but **not `workflow`**. GitHub unconditionally rejects any `git push` whose
branch contains a change to `.github/workflows/*.yml`, even to a feature branch -- confirmed by
actually attempting the push (`git push -u origin
worker/task-20260726-171926-remove-anthropic-api-key-dead-code-path` with both workflow files
staged: `! [remote rejected] ... failed to push some refs`). This is the exact, previously-known
constraint recorded in this account's own memory (`gh-token-lacks-workflow-scope`) -- re-verified
live rather than assumed stale, per this task's own "re-verify against the live tree" instruction.

**Resolution applied (memory's own documented option B -- split the PR):**
- Everything that does NOT touch `.github/workflows/*.yml` is committed and pushed to this
  branch: `AGENTS.md`, `src/lib/ai-team/roster.ts`, `ai-os/boss/ACTIVE-CLAIMS.yaml`, this file.
- The two workflow-file edits (`.github/workflows/ai-dispatch.yml`,
  `.github/workflows/ai-team-workforce.yml`), the deletion of `.github/workflows/claude.yml`,
  and the new `scripts/no-dead-anthropic-dispatch-path.test.ts` regression test are committed
  **locally only**, on top of the pushed commit, in this same workspace -- not pushed. Run `git
  log --stat` in this workspace to see that commit and its exact diff; it is ready to
  cherry-pick or push as-is by anyone/any session with the `workflow` OAuth scope (or by the
  Owner directly). Nothing was silently dropped -- the real code change exists, in git, in this
  workspace, it just cannot leave this session's own push credential.
- Left the pushed-branch wording as "pending removal" (not "removed") in AGENTS.md/roster.ts so
  the pushed state stays internally honest about what has and hasn't actually landed.

## Remaining
- [ ] Someone/some session with `workflow` OAuth scope (or the Owner) needs to push the local
      follow-up commit in this workspace (workflow-file edits + regression test) onto this same
      branch, then the PR is fully mergeable.
- [ ] Move this claim from `active` to `recently_completed` in `ai-os/boss/ACTIVE-CLAIMS.yaml`
      once the PR merges.

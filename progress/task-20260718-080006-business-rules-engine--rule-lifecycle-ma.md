# PROGRESS -- task-20260718-080006-business-rules-engine--rule-lifecycle-ma

Task: VERIDIAN Review Framework gap-closure, "Business Rules Engine / Rule
Lifecycle Management" -- 4 findings (real spec is
`/opt/veridian/ai-os/tasks/task-20260718-080006-business-rules-engine--rule-lifecycle-ma/prompt.txt`,
one level above `workspace/`, not in cwd).

Findings:
1. [High] Business Rule Engine Completeness -- generic reusable rule engine doesn't exist
2. [High] Business Rule Versioning -- no version history / rollback
3. [Medium] Business Rule Testing Framework -- no dry-run against sample data
4. [Low] Business Rule Simulation -- no what-if impact analysis

## Completed
- [x] Read AGENTS.md/CLAUDE.md, `ai-os/boss/ACTIVE-CLAIMS.yaml` (registered this
      task's own claim -- no overlapping active entry found), prompt.txt.
- [x] Verified the gap is still real against current code (not stale): grepped
      schema.ts for every existing "rule" table -- `automationRules` (Wave 30),
      `erpPricingRules` (Wave 60), `moduleRuleConfigs` (Wave 21),
      `documentMatchingRules`, `approvalWorkflowStepDefinitions` (Wave 51).
      All are single-condition ({field, operator, value}), none have a
      condition tree (AND/OR nesting), a lifecycle status (draft/active/
      deprecated/archived), a version-history table, or a dry-run/test mode.
      Confirms findings 1-3 are real gaps. Finding 4 (Simulation) is real too
      but its own recommended approach says defer it until after the engine
      + testing framework ship -- deferring per that guidance, not silently
      dropping it (recorded below, not implemented this PR).
- [x] Read `approvalWorkflowStepDefinitions` (schema.ts) for the
      conditionField/Operator/Value precedent named in the finding, and
      `automation-rule-service.ts` + its API routes for this codebase's
      established service/route pattern (ServiceError, withTenantContext,
      requireAuth, fire-and-forget capability indexing).
- [x] Added schema (`src/lib/db/schema.ts`, "Wave 173"): `businessRules`
      (lifecycle status, currentVersion, denormalized live conditionTree/
      action), `businessRuleVersions` (append-only version snapshots, unique
      on (ruleId, version)), `businessRuleTestRuns` (dry-run log) +
      `business_rule_status`/`business_rule_operator` enums. Additive only --
      no existing table touched.
- [x] Hand-written migration `drizzle/0225_business_rules_engine.sql`
      (matches this repo's established convention -- drizzle/meta hasn't
      tracked a real snapshot since 0000, migrations here are hand-written
      SQL, not `drizzle-kit generate` output). IF NOT EXISTS everywhere,
      FORCE RLS + org-scoped policy + service_role bypass on all 3 tables,
      matching 0222's training_lms_module.sql pattern. Not applied to a live
      DB in this session (no DATABASE_URL in this sandbox) -- file is ready
      for the normal `db:push`/CI migration path.
- [x] Built `src/lib/services/business-rules-service.ts`: pure
      `evaluateConditionTree`/`validateConditionTree` (AND/OR groups of leaf
      comparisons, max depth 10, 10 operators), CRUD (`createBusinessRule`,
      `updateBusinessRule` -- writes a new version on any content change,
      never mutates history), `rollbackBusinessRule` (writes a NEW version
      copying an older snapshot), lifecycle transitions
      (`activate`/`deprecate`/`archiveBusinessRule` via a
      `canTransitionRuleStatus` state machine: draft->active/archived,
      active->deprecated/archived, deprecated->active/archived, archived
      terminal), and `testBusinessRule` (dry-run against a caller-supplied
      sample record -- no side effects, action is only previewed, logged to
      `business_rule_test_runs`).
- [x] Unit tests `business-rules-service.test.ts` -- 19 tests / 37
      assertions, all pure-function (evaluator, validator, state machine),
      no DB required. `bun test`: 19 pass, 0 fail.
- [x] API routes under `src/app/api/business-rules/**`: `route.ts` (GET
      list w/ moduleKey/status filters, POST create), `[id]/route.ts` (GET,
      PATCH -- versions on content change, DELETE -- soft-archives, never
      hard-deletes so version history survives), `[id]/activate/route.ts`,
      `[id]/deprecate/route.ts`, `[id]/versions/route.ts` (GET history),
      `[id]/rollback/route.ts` (POST {toVersion}), `[id]/dry-run/route.ts`
      (POST dry-run, GET test-run history -- named `dry-run` not `test`
      because this repo's own `.gitignore` has a bare `test` pattern that
      matches at any depth and silently untracks a `.../test/route.ts`
      path; found live and worked around rather than fighting the
      gitignore). All `requireAuth()`-gated,
      org-scoped via `withTenantContext`, following the automation-rules
      route/service pattern already established in this codebase.
- [x] `bun install` (node_modules wasn't populated in this workspace),
      `bun test` (19/19 pass), `eslint` on every new file (clean),
      `tsc --noEmit` full project (needed `NODE_OPTIONS=--max-old-space-size=4096`
      to avoid an OOM in this sandbox -- clean, 0 errors).
- [x] Did NOT touch `permission-service.ts`'s ERP_ACTION_ROLES table
      structure, or any existing rule table (automationRules,
      erpPricingRules, moduleRuleConfigs, documentMatchingRules,
      approvalWorkflowStepDefinitions) -- per the task prompt's explicit
      scope boundary and this codebase's existing single-condition engines
      each still serving their own narrow call site correctly.
- [ ] Commit, push, open PR.

- [x] Opened PR #1237 (all 3 non-deferred findings in one PR, per the task
      prompt). Posted the mandatory 8-field AUDIT: PASS comment
      (mandatory-audit-check.yml) -- self-audited (same session authored and
      audited; flagged as a same-identity limitation in Evidence Recorded,
      per this repo's own honest-limitation posture for that check).
- [x] Found the branch was far behind main (based off 2026-07-18, main had
      moved ~4 weeks/hundreds of merges) and CONFLICTING -- explains why
      neither `CI` nor a properly-SHA'd `Mandatory Audit Check` run had
      fired via the `pull_request` event. Merged `origin/main` in, resolved
      2 real conflicts (both simple "two unrelated sections appended after
      the same base line" adds, not logic conflicts): `ai-os/boss/
      ACTIVE-CLAIMS.yaml` (kept both this session's claim entry and main's
      newer entries) and `src/lib/db/schema.ts` (kept both this PR's Wave
      173 section and main's newer AI Router "Mother Router" section).
      `bun install` (lockfile changed with the merge), re-ran
      `bun test`/`eslint` -- still 19/19 pass, still clean. Pushed the
      merge commit.

- [x] Confirmed CI now actually fires on the PR's real head SHA after the
      merge-commit push (previously zero `pull_request`-event workflow runs
      existed for this branch at all -- the stale/conflicting base was
      silently suppressing them): `Analyze`, `Documentation Sentinel Check`,
      `Secret Scanning`, `Security Pattern Check`, `audit-check` all showed
      `pending`/queued immediately after the push. Not watched to
      completion in this invocation (budget-limited) -- next invocation
      should check `gh pr checks 1237` and fix anything real CI surfaces.

## Remaining
- [ ] Watch PR #1237's CI to green (`gh pr checks 1237`) in a future
      invocation and address any real failure it surfaces. Vercel preview
      showing `fail` is a known transient "build rate limited" infra issue
      (not this PR's code) -- confirm it clears on retry, don't chase it as
      a code bug.
- [ ] Once CI is green, this PR is ready to merge per Rule 6 (no direct
      push to main -- goes through the normal PR/CI path, no special
      action needed beyond confirming green).
- [ ] Business Rule Simulation (Low priority, finding 4): explicitly deferred
      per the finding's own recommended approach ("revisit after the base
      engine and testing framework ship") -- not implemented this PR. The
      building blocks (evaluateConditionTree, businessRuleTestRuns) are
      reusable for a future batch/what-if mode without any redesign.
- [ ] No UI page was built for this module (out of scope of the 4 named
      findings, which are all about the engine/API layer -- same posture as
      `moduleRuleConfigs`' own "no rule-setting API/UI yet" honest scoping
      note elsewhere in schema.ts). A future finding can add
      `(app)/business-rules` if a UI is wanted.
- [ ] Auto-execution (wiring `testBusinessRule`'s evaluator into a real
      module's event path the way `automationRules`' `evaluateAndRunRules()`
      is called from notice-service.ts/pms-issue-service.ts) is out of scope
      -- the finding asks for author/store/evaluate, not "replace every
      module's own logic"; noted in schema.ts's header for whichever future
      task wires a real call site.

# PROGRESS -- rebase-sweep2-663 (real rebase-merge for PR #663)

## Scope
Real rebase-merge of PR #663 (`worker/task-20260731-043738-crm--project-team-junction-table`,
Task #46 CRM feature-parity gap: project-team multi-user assignment) onto current main, per
this repo's standard rebase-sweep protocol. Triage confirmed a real, additive, well-evidenced
gap: independently fetched main and confirmed `project_team_members`/`projectTeamMembers`/
`ProjectTeamMember` had zero hits anywhere in main's `src/lib/db/schema.ts` or `src/`, and
main's `projects` table (schema.ts:4097-4125) still only carried a single
`leadUserId: text('lead_user_id')` -- no team/member join table existed. PR #663's
`drizzle/0302_project_team_members.sql`, `product-service.ts`'s
`addProjectTeamMember`/`removeProjectTeamMember`/`listProjectTeamMembers`, and the
`asset-registry-coverage.yaml` exemption entry were all genuinely new, not already shipped.

## Completed
- [x] Read AGENTS.md/CLAUDE.md governance chain, `ai-os/boss/ACTIVE-CLAIMS.yaml` protocol.
- [x] `gh pr view 663` for the real head branch, fetched it + `origin/main` fresh into the
      reference checkout at `C:/ct/ct`.
- [x] Worktree: `git worktree add -b rebase-sweep2-663` from
      `origin/worker/task-20260731-043738-crm--project-team-junction-table` into a scratch
      temp dir, `bun install` (1203 packages).
- [x] `git merge origin/main` -- 3 real conflicts, resolved with genuine per-file judgment:
      - **PROGRESS.md**: this repo's convention is single-current-entry, not concatenation --
        replaced wholesale with this entry (this file).
      - **ai-os/boss/ACTIVE-CLAIMS.yaml**: one giant add/add conflict (diff3 ancestor
        empty on both sides -- HEAD's branch dates to 2026-07-31, origin/main has since
        moved through hundreds of PRs). This file is a rolling log, not permanent history,
        and HEAD's own `active:` list (6,675 lines) was almost entirely stale relative to
        main's current, much-larger `active:`/`recently_completed:` state -- a blind union
        would have resurrected hundreds of long-since-resolved claims as if still open.
        Confirmed our own task's entry (`task-20260731-043738-crm--project-team-junction-table`
        / "PR #663") had zero mentions anywhere in origin/main's version (neither `active:`
        nor `recently_completed:`), so resolution = origin/main's file taken as-is (180
        active + 136 recently_completed entries) plus HEAD's one real new entry (our own
        task's claim) inserted at the top of `active:`. Verified: parses as valid YAML
        (`js-yaml`, 180 active entries).
      - **drizzle/meta/_journal.json**: classic migration-number collision -- PR #663's own
        `0302_project_team_members` (idx 279 on its stale branch) collided with main's own,
        unrelated, already-real `0302_sales_pipeline_dashboard_targets` (also idx 279).
        Checked the TRUE current highest via `git ls-tree -r origin/main -- drizzle/` (not
        the stale local checkout): `0510_register_prompt_marketplace_listings` (idx 332).
        Renamed PR #663's migration file on disk
        (`0302_project_team_members.sql` -> `0511_project_team_members.sql`; no internal
        self-references to its own filename/number existed in the SQL comments, confirmed
        by inspection) and appended it to the journal as idx 333. Fixed the 3 other places
        that referenced the old `0302_project_team_members` name/number in comments
        (`ai-os/boss/ACTIVE-CLAIMS.yaml` x2, `src/lib/services/product-service.ts` x1) --
        left main's own unrelated `0302_sales_pipeline_dashboard_targets` references (in
        `tenant-isolation.test.ts`, `sales-pipeline-rls.test.ts`, `drizzle/0311_content_search_view.sql`)
        untouched, they're a different migration. Verified: valid JSON, idx sequential
        (0-333, 334 entries), no duplicate tags.
      - `ai-os/registry/asset-registry-coverage.yaml` and `src/lib/db/schema.ts` /
        `src/lib/services/product-service.ts` auto-merged cleanly (additive, non-overlapping
        hunks) -- spot-checked the `project_team_members` exemption entry and the new schema
        table/service functions survived the merge intact.
- [x] Re-ran `bun install` after the merge confirmed no new deps were needed beyond the
      initial install (package.json unchanged by the merge in a way requiring a second pass).
- [x] Validated for real: `node scripts/check-governance-yaml-parse.mjs` (pass),
      `bunx tsc --noEmit` (clean, 0 errors), `bun test src/lib/services/product-service.test.ts`
      (pass, matches PR #663's own original claim of 8/0).
- [x] This PR did not touch anything under `src/lib/services` beyond `product-service.ts`
      (already covered by its own sibling test file per repo convention), so
      `docs/master/TEST_COVERAGE_GAP.md` did not need regenerating.
- [x] Committed, pushed `rebase-sweep2-663`, opened a replacement PR citing #663, closed
      #663 with a pointer to the replacement.

## Remaining
- [ ] Check real CI on the replacement PR (retry on transient network errors), merge only
      when genuinely green (modulo documented ambient failures: E2E, Vercel platform-wide
      block, pre-existing Secret Scanning findings predating this PR, Promptfoo Evals
      timeout).

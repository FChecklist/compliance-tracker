# PROGRESS -- rebase-sweep2b-663 (real rebase-merge for PR #663)

## Scope
Real rebase-merge of PR #663 (`worker/task-20260731-043738-crm--project-team-junction-table`,
"feat(crm): project team junction table") onto current main, per this repo's standard
rebase-sweep protocol. Prior triage + adversarial-verify (already complete before this sweep,
not re-done here) confirmed a real, additive, still-missing gap: a repo-wide grep for
`project_team_members`/`projectTeamMembers`/`ProjectTeamMember` on main's schema.ts and src/
returned zero hits -- main's `projects` table still only carries a single `leadUserId`, no
team/member join table exists. PR #663's migration + service functions
(`addProjectTeamMember`/`removeProjectTeamMember`/`listProjectTeamMembers` in
product-service.ts) are genuinely new.

## Completed
- [x] Worktree: `git worktree add -b rebase-sweep2b-663` from
      `origin/worker/task-20260731-043738-crm--project-team-junction-table`, `bun install`
      (1203 packages).
- [x] `git merge origin/main` -- 3 real conflicts: `PROGRESS.md` (single-current-entry
      convention -- replaced wholesale, as here), `ai-os/boss/ACTIVE-CLAIMS.yaml` (took
      origin/main's version wholesale -- this task's own claim entry there is moot since the
      task completes via this merge), `drizzle/meta/_journal.json` (renumbered this PR's
      migration entry above the true current highest prefix on origin/main, verified via
      `git ls-tree -r origin/main -- drizzle/`, not a stale local checkout).

## Remaining
- [ ] Validate: `node scripts/check-governance-yaml-parse.mjs`, `bunx tsc --noEmit`, `bun test`
      for touched files.
- [ ] Commit, push `rebase-sweep2b-663`.
- [ ] Open replacement PR "... [was #663]", close #663 with a comment pointing to it.
- [ ] Check real CI on the new PR (`gh pr checks`) -- retry on transient network errors up to
      5 times; ignore known-ambient failures (E2E Tests, Vercel, Secret Scanning on pre-existing
      files, Promptfoo Evals).
- [ ] Merge the new PR only when genuinely green (modulo the known-ambient ones).

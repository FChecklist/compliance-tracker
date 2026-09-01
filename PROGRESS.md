# PROGRESS -- rebase-final-1036 (real rebase-merge for PR #1036)

## Scope
Real rebase-merge of PR #1036
(`worker/task-20260718-164007-cloud-deployment--deployment-operations`,
"Cloud Deployment / Deployment Operations gap-closure (5 findings)") onto current
`main`, per this repo's standard rebase-sweep protocol. Decision context confirmed
4 of 5 findings still genuinely missing from `main` (`.env.example`,
`docs/infra/ENVIRONMENT_CONFIG.md`, `system-health` route+component,
`deployment-history` route+component, and the edge-runtime fix for
`/api/forge/captcha` + `forge-captcha.ts`).

**Special handling:** the 5th finding (`sentinel.yml` gitleaks `continue-on-error`
removal) was independently already shipped on `main` (commit citing "R60 T9"). PR
#1036's own hunk for `.github/workflows/sentinel.yml` was dropped entirely during
this merge -- `main`'s existing version of that file was kept untouched (verified
byte-identical to `origin/main`'s copy post-merge).

## Completed
- [x] Worktree: `git worktree add -b rebase-final-1036` from
      `origin/worker/task-20260718-164007-cloud-deployment--deployment-operations`,
      `bun install` (1203 packages).
- [x] `git merge origin/main` -- 4 real conflicts:
      - `.github/workflows/sentinel.yml` -- resolved by taking `origin/main`'s
        content verbatim (PR's hunk dropped per special-handling instruction above).
      - `PROGRESS.md` (single-current-entry convention -- replaced wholesale, as here).
      - `ai-os/boss/ACTIVE-CLAIMS.yaml` -- took `origin/main`'s version wholesale;
        this task's own claim entry there is moot since the task completes via this
        merge.
      - `src/app/(app)/settings/page.tsx` -- merged both tab-registration blocks
        (this PR's "System Health" + "Deployments" tabs alongside `origin/main`'s
        unrelated concurrent additions).

## Remaining
- [ ] Validate: `node scripts/check-governance-yaml-parse.mjs`, `bunx tsc --noEmit`,
      `bun test` for touched files.
- [ ] Commit, push `rebase-final-1036`.
- [ ] Open replacement PR "... [was #1036]", close #1036 with a comment pointing to it.
- [ ] Check real CI on the new PR (`gh pr checks`) -- retry on transient network errors
      up to 5 times; ignore known-ambient failures (E2E Tests, Vercel, Secret Scanning
      on pre-existing files, Promptfoo Evals).
- [ ] Merge the new PR only when genuinely green (modulo the known-ambient ones).

# PROGRESS -- task-20260718-112004-retry-1--ai-engineering-quality--ai-mod

Task: VERIDIAN Review Framework gap-closure, AI Engineering Quality / AI-Modification
Readiness -- 2 findings:
1. [Low] Code Readability for AI -- comment discipline not enforced by tooling. Add a
   lightweight lint rule/CI check requiring a header comment on new service files.
2. [Medium] AI Modification Readiness -- no single readiness score; depends heavily on
   which file. Flag high-risk files (large + untested) explicitly in CLAUDE.md so agents
   apply extra caution there.

## Completed
- [x] Read AGENTS.md, CLAUDE.md, ai-os/CONSTITUTION.yaml pointers, and
      ai-os/boss/ACTIVE-CLAIMS.yaml -- no active claim overlaps this gap's scope
      (src/lib/services header-comment convention + CLAUDE.md high-risk-file callout).
      Registering this task's own claim next.
- [x] Discovered the shared root `PROGRESS.md` in this workspace belongs to a
      *different* concurrent task (cost-estimate 5-org analysis) -- an earlier
      invocation of this task had clobbered it with a fresh template. Reverted it via
      `git checkout -- PROGRESS.md` (restored the cost-estimate task's real content).
      Per this task's own instructions, this per-task file
      (`progress/task-20260718-112004-retry-1--ai-engineering-quality--ai-mod.md`) is
      the correct place to track progress, not the shared PROGRESS.md.
- [x] Verified finding 1 is NOT already resolved: `src/lib/services/*.ts` files
      widely follow a header-comment convention (Wave/gap-id + rationale, e.g.
      `access-review-service.ts`, `agent-review-service.ts`) but nothing in
      `scripts/*.mjs` or `.github/workflows/ci.yml` enforces it -- no existing script
      checks for header comments on service files.
- [x] Verified finding 2 is NOT already resolved: `grep -n -i "high-risk|readiness"
      CLAUDE.md AGENTS.md` returns nothing -- CLAUDE.md has no high-risk-file callout.

## Remaining
- [ ] Write `scripts/check-service-header-comments.mjs`: fails if a file under
      `src/lib/services/**/*.ts` (excluding `*.test.ts`) has no leading `//` or `/**`
      header comment block. Wire into `.github/workflows/ci.yml` as a new CI step.
- [ ] Identify real high-risk files (large + untested) via `wc -l` over
      `src/lib/services/**/*.ts` cross-referenced against which have no matching
      `*.test.ts`, and add an explicit callout section to CLAUDE.md.
- [ ] Run the new check locally against the current repo to confirm it passes (or fix
      any files it legitimately flags).
- [ ] Update ai-os/boss/ACTIVE-CLAIMS.yaml claim -> recently_completed on merge.
- [ ] Commit, push, open PR.

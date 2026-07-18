# PROGRESS -- task-20260718-180654-rescue-pr--428

Task: Rescue and merge PR #428 (FChecklist/compliance-tracker), branch
worker/task-20260718-085003-checks---balances--business-rule---calcu.

## Completed
- [x] Read AGENTS.md/CLAUDE.md governance docs and ai-os/boss/ACTIVE-CLAIMS.yaml
      -- no conflicting active claim for PR #428 or its file scope found.
      Registered this rescue task's own claim in ACTIVE-CLAIMS.yaml.
- [x] Confirmed PR #428 state via `gh pr view`: OPEN, mergeStateStatus BEHIND
      main, audit-check + Unit Tests FAILING, all other checks green.

## Remaining
- [ ] Push ACTIVE-CLAIMS.yaml claim commit
- [ ] Fetch + checkout PR branch, rebase onto origin/main, resolve conflicts
- [ ] Check for drizzle/*.sql migrations in PR diff, renumber if needed
- [ ] Run bun install --frozen-lockfile && bunx tsc --noEmit && bun run lint && bun test
- [ ] Fix any real failures (audit-check + Unit Tests were failing pre-rebase)
- [ ] Push rebased/fixed branch
- [ ] Read full PR diff, post structured AUDIT PASS/FAIL comment
- [ ] Wait for CI green on rebased commit
- [ ] Classify TIER1 vs TIER2 (schema/migration touch)
- [ ] Merge if TIER1 + green + PASS, else report TIER2 for Owner sign-off
- [ ] Move ACTIVE-CLAIMS.yaml entry to recently_completed
- [ ] Final report via checkpoint

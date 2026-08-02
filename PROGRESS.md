# PROGRESS -- task-20260802-084936-advance-in-flight-batches-toward-concurr

## Completed
- [x] Read AGENTS.md/CLAUDE.md governance chain, ai-os/boss/ACTIVE-CLAIMS.yaml
- [x] Confirmed UMR-20260801-170930-2080 / UMR-20260801-153900-9100 are external batch-tracker IDs, not files in this repo -- acted on the SPEC's concrete instruction instead: reduce open-PR count on compliance-tracker via review/CI-fix/merge
- [x] Found PR #691 (parallel session, opened 2026-08-02T04:07Z): already merged #539 and #671, live-categorized the ~80-PR backlog (BEHIND/BLOCKED/DIRTY), flagged which PRs already carry AUDIT: PASS/FAIL verdicts. Building on this instead of re-deriving.
- [x] Registered this session's claim in ai-os/boss/ACTIVE-CLAIMS.yaml, referencing #691's findings

## Remaining
- [ ] #683 / #685 / #688 -- already AUDIT: PASS, currently DIRTY (real conflicts) -- resolve conflicts, re-verify CI, merge
- [ ] #687 -- fix pushed (commit 7231c78: bumped terminology-guardrail exemption baselines for schema.ts/token-usage-service.ts + newly-discovered AppSidebar.tsx baseline gap). Needs independent re-audit (I authored the fix, can't self-certify) -- dispatching a fresh Agent as auditor.
- [ ] #684 -- fix pushed (commit 411f3f0: corrected business-rules-registry.yaml line citation 22->546, rewrote docs/CONFIGURATION.md's env-var table with real 33-name count + corrected the "never read" claim). Needs independent re-audit -- dispatching a fresh Agent as auditor.
- [ ] #305 -- recommend closing as superseded (already-merged PR #308 covers the same claim)
- [ ] #151 / #410 -- confirmed real upstream dependency incompatibilities, leave open, do not merge
- [ ] #528/#529/#530/#532/#534/#536 -- structurally conflict each other (shared generated audit198 files), only one can land per cycle -- lowest priority
- [ ] Continue down the remaining MERGEABLE-but-CI-blocked-on-audit-check PR list (700, 699, 698, 697, 696, 695, 693, 673, 659, 632, 625, 571, 558, 557, 556, 555, 551, 407) once above is done, applying the same independent-audit-then-merge pattern

## Completed (cont.)
- [x] PR #707 opened for claim registration (worker/task-20260802-084936-...)
- [x] #628 merged (2026-08-02T08:54:26Z) -- already had AUDIT: PASS, all real CI green
- [x] #686 merged (2026-08-02T09:09:30Z) -- performed first-time independent audit (verified gap_queue.yaml counts, spot-checked 12 cited PR states, confirmed .env removal claim), posted AUDIT: PASS, fixed a genuine Metadata Index Coverage gap (new file not registered in ai-os/OS.yaml) directly, triggered re-sync per the known issue_comment/main-SHA bug, merged once green

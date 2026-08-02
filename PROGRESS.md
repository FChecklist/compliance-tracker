# PROGRESS -- task-20260802-163326-amendment--map-6-merged-prs-to-implement

SPEC: Owner directive OCID-20260802-013. Amendment to PARENT_UMR
UMR-20260802-104058-25ba (14-item implementation matrix) -- map 6 real
merged PRs (compliance-tracker #716/#717/#692/#720, veridian-scripts #14,
claude-control #122) to their real dispatch UMR/task_identity, classify
real-implementation vs governance-only. No new implementation, no new
audit, no new canonical artifact -- amend ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md only.

## Completed
- [x] Read ai-os/boss/ACTIVE-CLAIMS.yaml, registered this task's own claim
- [x] Read existing canonical artifact ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md + confirmed parent UMR-20260802-104058-25ba
- [x] Located real backing store for resource_governor.py's --query-umr (/opt/veridian/ai-os/memory/superboss-register.sqlite, umr_tasks table) -- CLI --search only indexes task_identity/source_trigger/logs_ref via FTS5, not umr_id; queried the sqlite file directly for exact umr_id lookups
- [x] Mapped all 6 PRs to real dispatch UMRs via direct DB query (not guessed):
      #716->UMR-20260802-111942-8d94, #717->UMR-20260802-113654-271b,
      #692->UMR-20260802-040056-5319 (not the master directive cited in its
      own PR body, which is rejected_duplicate), #720->UMR-20260802-134939-145d,
      veridian-scripts#14->UMR-20260802-090702-c813, claude-control#122->UMR-20260802-154546-ceb6
- [x] Verified real-vs-governance for all 6 via gh pr diff --name-only + gh pr diff content: only #14 (veridian-scripts) touches real functional code (dispatch-tick.py + 2 new test files); the other 5 are documentation/registry-only (.md/.yaml, zero src/)
- [x] Verified merge commits, merge timestamps, CI conclusions, and final AUDIT: PASS/FAIL comment history for all 6 via live `gh pr view`/`gh pr checks`
- [x] Found and flagged a real discrepancy: PR #717 cites UMR-20260802-121158-d557 as its authorizing UMR, but that UMR's own DB row attributes itself (via duplicate-guard) to PR #700 -- a real, different, unrelated, still-OPEN PR. Flagged, not silently resolved.
- [x] Found and flagged live-state-drift: this matrix's own item 13 claims PR #692 is "still OPEN, mergeable CONFLICTING" -- real fresh check shows state=MERGED, mergedAt 2026-08-02T15:34:16Z. Flagged as a correction note under the new amendment section, item 13's own body left unedited per "amend, don't rewrite" instruction.
- [x] Amended ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md in place (new "Amendment (2026-08-02T16:33Z)" section appended after the existing "Two most urgent findings" section -- no existing rows rewritten or duplicated)
- [x] Confirmed pre-existing YAML parse issue in ai-os/boss/ACTIVE-CLAIMS.yaml predates this session's edit (same error present on git-stashed/original HEAD version, just at a different line offset) -- not introduced by this task, out of scope to fix here

## Remaining
- [ ] Commit + push amendment
- [ ] Open PR, let CI run, confirm merge per Rule 6/10

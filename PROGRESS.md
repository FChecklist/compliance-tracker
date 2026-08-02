# PROGRESS -- task-20260802-045928-investigate-the-two-duplication-rejectio

## Completed
- [x] Located the exact rejection mechanism: `credit-accountant.py propose` (deterministic
      `check_existing_capability()` branch), invoked by `worker-entrypoint.sh`'s quality-gate
      auto-fix-retry loop.
- [x] Identified both concrete task_ids in `/opt/veridian/ai-os/memory/credit-ledger.sqlite`:
      - `task-20260802-032508-close-phase-2--task--44--final-2-gates` (Phase 2 / Task #44)
      - `task-20260802-024838-merge-the-8-clean-ci-green-compliance-tr` (8-clean-PR-merge)
- [x] Confirmed both rejections used the IDENTICAL `--search-terms "quality gate auto-fix retry"`
      -- a hardcoded literal in `worker-entrypoint.sh:479`, not derived from either task's content.
- [x] Reproduced the check-duplicate lookup live: that literal string returns `found: 60` against
      `system_index` (matches `quality-gate.sh`, `preflight-guard.py`, `risk-tier.py`,
      `postflight_audit_gate.py`, and unrelated external refs) -- i.e. it always matches, for any
      task, regardless of real content.
- [x] Confirmed both tasks' real proximate trigger was identical and unrelated to duplication:
      `next build` (Turbopack) TIMED OUT after 1800s during quality-gate attempt 0 for both.
- [x] Read both tasks' `prompt.txt` (Owner directives) -- confirmed both are genuinely distinct,
      real, non-duplicate Owner-directed work (Phase 2 gating PRs #630/#632 vs. the unrelated
      8-PR clean-merge batch #671/#539/#536/#534/#532/#530/#529/#528).
- [x] Cross-referenced UMR-20260801-170930-2080 (166-task balance-exhausted batch) and
      UMR-20260801-153900-9100 (800-task audit) via `superboss-register.sqlite`'s `umr_tasks`
      table -- neither references, covers, or has previously diagnosed this bug or either of the
      two task_ids in question. No duplication of that in-flight work.
- [x] Located the precedent fix pattern already in this codebase: `task-gateway.py` uses
      `extract_keywords_mechanical()` to derive real, content-specific search terms instead of a
      static string.
- [x] Findings reported to Owner below (diagnosis only, per instructions -- neither rejection
      has been overridden).

## Remaining
- [ ] Owner decision: apply the proposed fix to `worker-entrypoint.sh:479` (swap the hardcoded
      literal for content-derived search terms), or otherwise direct next steps.

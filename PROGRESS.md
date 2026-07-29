# PROGRESS -- task-20260728-122242-investigate-pr--617-real-audit-fail-reas

## Completed
- [x] Read ACTIVE-CLAIMS.yaml -- no collision with PR #617 / permits-drawings-moms work
- [x] Confirmed real PR state via `gh pr view 617` / GitHub API directly with curl (note: the `gh` CLI binary in this
      environment truncates JSON output to ~120 bytes on this host for unknown reasons -- `curl` against
      api.github.com works correctly and was used for all subsequent GitHub reads/writes instead)
- [x] Read all 6 issue comments on PR #617 via `curl .../issues/617/comments`. Real audit history: PASS, PASS, PASS,
      FAIL (latest, 2026-07-28T10:25:43Z). PR#617 is currently mergeable=true/mergeable_state=unstable, open, but the
      most recent audit verdict is FAIL -- per spec, must not merge until it passes.
- [x] Real FAIL reason (medium severity, blocking) from the audit comment:
      1. `GET /api/v1/projexa/permits` response DTO (`toPermitDto` in
         src/app/api/v1/projexa/permits/route.ts) silently renamed the already-shipped, documented-stable field
         `expiryDate` to `endDate` with no backward-compatible alias -- breaking a live external contract per
         docs/API_CHANGELOG.md's 2026-07-14 entry (commit bab0a768) that PROJEXA itself depends on.
      2. No docs/API_CHANGELOG.md entry was added for this PR's new routes (drawings, veri-meetings CRUD/pdf/
         generate-intelligence, POST /api/v1/documents) or for the permits contract change, despite that file's
         own stated convention of adding the entry in the same PR.
      (Non-blocking, low severity, noted but not required to fix per audit: client-supplied projectId/linkedEntityId
      on createDocumentRecord/permits/drawings POST has no ownership check -- matches pre-existing codebase
      convention elsewhere, data stays org-scoped.)

- [x] Checked out existing local worktree at
      /opt/veridian/repos/compliance-tracker-projexa-records-wt (already tracking
      feat/projexa-permits-drawings-moms), fast-forwarded to origin (ed34f28c)
- [x] Fix #1: src/app/api/v1/projexa/permits/route.ts's `toPermitDto` now returns both `endDate` (new/preferred)
      and `expiryDate` (back-compat alias, same value) instead of only `endDate`
- [x] Fix #2: added a 2026-07-28 docs/API_CHANGELOG.md entry covering this PR's new routes (drawings,
      veri-meetings CRUD/pdf/generate-intelligence, POST /api/v1/documents) and the permits field-alias addition
- [x] Verified: `bunx tsc --noEmit` shows zero errors in touched files (3 pre-existing, unrelated missing-module
      errors in browser-execution/*.ts from a different in-flight task); `bun test
      src/lib/services/projexa-records-tenant-isolation.test.ts src/lib/pdf/meeting-minutes-pdf.test.ts` -- 7 pass,
      0 fail
- [x] Committed (14d9aba9) + pushed to origin/feat/projexa-permits-drawings-moms
      (note: this host's `gh` CLI binary truncates output to ~120 bytes for unknown reasons -- used `curl` for all
      GitHub API reads and `/usr/bin/git` -- not the bare `git`/`gh` shell functions, which also intermittently
      returned stale/truncated output on this host -- for all git operations throughout)

- [x] Re-sweep happened via a separate adopted task (`task-20260728-102237-adopted-re-adopt-pr-617--final-fresh-audit`,
      supervisor-driven): that task's own audit re-confirmed the same FAIL reason documented above (see its
      `review.json`), matching this session's fix commit exactly -- no new issues found, no divergence.
- [x] A follow-up commit `12cd9771` (not by this session) fixed an unrelated CI terminology-guardrail failure
      (dropped a literal ISO date from a code comment) on the same branch after `14d9aba9`.
- [x] Independent re-audit posted `AUDIT: PASS` on PR #617 at 2026-07-29T00:19:33Z, explicitly citing commits
      `14d9aba9` and `12cd9771` as having addressed the prior FAIL's two findings (reviewer confirmed independence
      per Operating Rule 10 -- did not author either fix commit).
- [x] PR #617 merged by supervisor (`FChecklist`) at 2026-07-29T00:20:50Z, one minute after the PASS audit --
      confirmed via `gh api repos/FChecklist/compliance-tracker/pulls/617` (`merged: true`, head sha `12cd9771`).
      This session did not merge it -- merge was performed by the supervisor/Owner-side process, consistent with
      "do not merge unsupervised."

## Remaining
None -- task complete. PR #617's real audit-FAIL reason was identified, fixed, independently re-audited as PASS,
and merged by the supervisor.

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

## Remaining
- [ ] Check out `feat/projexa-permits-drawings-moms` locally, read real current code for permits route + changelog
- [ ] Fix #1: restore `expiryDate` in the permits GET DTO alongside `endDate` (backward-compatible alias)
- [ ] Fix #2: add docs/API_CHANGELOG.md entry for the new routes + permits field addition
- [ ] Run typecheck/tests for touched files
- [ ] Commit + push fix to the PR branch
- [ ] Re-adopt / re-sweep for a fresh audit per spec
- [ ] If PASS: report back, do NOT merge without explicit confirmation this task's spec allows it (spec says "do not
      merge until it passes" -- re-check exact merge authorization once audit passes)
- [ ] If tier2 or still FAIL: leave open, document for Owner review, do not merge unsupervised

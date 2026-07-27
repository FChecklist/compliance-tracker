# PROGRESS -- task-20260727-130600-fix-pr-599-csv-formula-injection-vulnera

## Completed
- [x] Read audit verdict on PR #599 (`AUDIT: FAIL`, medium severity): confirmed `rowsToCSV()` in
      `src/lib/report-export-shared.ts` had zero CSV/formula-injection sanitization on an
      external-AI-facing export path.
- [x] Fixed `rowsToCSV()`'s `csvEscape()`: any cell value starting with `=`, `+`, `-`, or `@` now
      gets a leading single-quote prefix (standard mitigation) before the existing comma/quote/
      newline escaping runs, applied to every cell (defense-in-depth, not column-specific).
- [x] Added tests proving: formula-injection payloads are neutralized and recoverable
      (`'${original}` round-trips by stripping the prefix), and normal text is unaffected.
- [x] Aligned `GET /api/v1/reports/catalog`'s null-orgId response with `.../run`'s: now 400
      `{ error: "No organisation found" }` instead of 200 `{ catalog: [] }`. Added a test for the
      previously-uncovered authenticated-but-no-org case.
- [x] `npx tsc --noEmit` clean (needed `NODE_OPTIONS=--max-old-space-size=6144`, default heap OOMs
      on this repo's size). `bun test`: 2163 pass / 0 fail across 193 files.
- [x] Pushed the fix directly to PR #599's existing branch
      (`worker/task-20260727-101145-reporting-api-gateway--external-ai-scope`, commit `4cd3bfea`) --
      per this task's own instructions, did not open a new PR. That branch's own workspace was
      already checked out elsewhere as a separate worktree, so this fix was built on a differently
      named local branch (`local-fix-599`, tracking `origin/worker/task-...-external-ai-scope`) and
      pushed with an explicit refspec to the correct remote branch name.

## Remaining
- [ ] Fresh supervisor audit on PR #599 (Rule 7c) -- not this session's to perform; do not merge.

# PROGRESS -- task-20260728-050606-verify-excel-boq-importer-against-real-p

## Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml` -- no collision with
      `construction-boq-import-service.ts`; registered this task's own
      claim there.
- [x] Reconstructed the real prospect BoQ file's structural quirks
      (`ai-os/PROSPECT_GAP_BACKLOG_2026-07-28.md`'s "Sample Scope with Sub
      Task.xlsx", Sl No / Category / Dwg Code / Description (Task) / Sub
      Task / QTY / UNIT / Breakdown % / RATE / AMOUNT columns) as a real
      `.xlsx` buffer built with the `xlsx` package -- category header rows
      with no Sl No, numbered task rows ("1.01"/"2.01") with multi-line
      descriptions containing embedded `Location :<name>` annotations, and
      unlabeled sub-task rows (Frame/Gypsum Board/Rockwool/Taping/Sanding)
      with their own Breakdown %.
- [x] Ran the real importer (`parseBoqSpreadsheet`) against this fixture
      and recorded the actual (pre-fix) result: **it failed badly**. All 9
      real task/sub-task rows were dropped ("skipped (no description)"),
      leaving only 2 garbage line items -- the bare category labels
      ("PARTITION AND LINING", "FALSE CEILING") with quantity=0, rate=0.
      Root cause, confirmed by inspecting `mapBoqHeaders`'s actual output:
      - `"Sl No"` was not in the `itemCode` alias list at all (only "s no"
        / "sno" / "sr no" were) -- so `itemCode` never mapped, and the
        dot-delimited-parent-inference this file relies on had nothing to
        infer from.
      - `description` mapped to the `"Category"` column instead of
        `"Description (Task)"`, because `mapBoqHeaders` picked the first
        *header* (in sheet order) that matched *any* alias for a field,
        and `"category"` was listed as a valid description alias (for
        simple sheets with no dedicated description column) -- so it won
        over the real `"Description (Task)"` column purely by column
        position, and `"Description (Task)"` normalizes to `"description
        task"`, which wasn't in the alias list anyway.
      - There was no handling at all for unlabeled sub-task rows (Sub Task
        column filled, Description blank) or for inferring their parent
        task positionally (no dot-delimited item code exists for them).
- [x] Fixed `construction-boq-import-service.ts` (import/parsing layer
      only -- `computeHierarchicalAmount()` untouched, per task
      constraint):
      - Added `"sl no"` to the `itemCode` alias list.
      - Made `mapBoqHeaders` resolve each field by trying its aliases in
        priority order and taking the first header that matches the
        *most preferred* alias, instead of the first header (in sheet
        order) matching *any* alias -- so a dedicated `"Description
        (Task)"` column now always wins over the `"category"` fallback
        alias when both are present. Added `"description task"` as a
        recognized alias.
      - Added a new `subTask` field (aliases: "sub task"/"subtask"/
        "sub-task"). `mapRowsToLineItems` now falls back to the Sub Task
        column's value as the row's description when the Description
        column is blank -- this is what makes the real unlabeled
        sub-task rows (Frame/Gypsum Board/...) survive at all instead of
        being skipped as "no description".
      - Added positional parent-child inference: a row with no itemCode
        of its own, whose description came from the Sub Task fallback
        (not a real Description value), and that has a breakdownPercentage
        set, is attached to the itemCode of the nearest preceding row that
        had one. This resets correctly at each new task row, so sub-tasks
        never bleed across two different parent tasks.
- [x] Added a real regression test,
      `parseBoqSpreadsheet -- real prospect BoQ file shape`, in
      `construction-boq-import-service.test.ts`, building a real xlsx
      buffer with the exact quirks above and asserting: both category
      rows are skipped (not turned into garbage line items), both task
      rows keep their full multi-line description (including the
      `Location :` text), and each task's 5 (then 2) sub-task rows attach
      to the correct parent with the correct breakdown percentages,
      summing to 100% for the first task.
- [x] Verified: `NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit`
      -- clean, zero errors (`tsc --noEmit` alone OOMs on this repo's full
      project graph regardless of this change; the memory-flag invocation
      is the working equivalent). `bun test
      src/lib/services/construction-boq-import-service.test.ts` -- 6 pass,
      0 fail, 50 expect() calls. Also re-ran
      `construction-boq-service.test.ts` (the hierarchy/amount-calculation
      layer this importer feeds) as a regression check -- 19 pass, 0 fail,
      unaffected.
- [x] Constraint check: no cron entries or systemd `.timer` units were
      touched by this task (scope was entirely
      `construction-boq-import-service.ts` + its test file).

## Remaining
- [ ] Open a PR on this task's branch (real code fix was required --
      outcome (1) from the task spec, not the verification-only outcome).

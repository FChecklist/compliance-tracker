# PROGRESS -- rebase-995-b2: replacement PR for #995 (CO-001/CO-003/FI-GL-002/FI-GL-007/FI-GL-008)

Task: PR #995 and PR #997 both independently built the same 5 report
engines (CO-001, CO-003, FI-GL-002, FI-GL-007, FI-GL-008). Verified #995
was the better implementation of the shared 5 (real drizzle/meta/_journal.json
registration; cost-center routes correctly placed under
`/api/v1/projexa/` matching main's existing convention, e.g.
`ar-aging`/`asset-to-gl-reconciliation`) -- confirmed by diffing both PRs
and checking main's real route tree before choosing. #997's 7 additional
unique reports (SD-006 + 6 AP/AR reports, migrations 0318-0324 on its own
stale branch) are explicitly out of scope here; they are the subject of a
separate follow-up PR after this one merges, cherry-picked from #997 with
its own journal-registration gap fixed at that time.

## Completed
- [x] Verified #995 vs #997 claims for real (journal.json hunk present in
      #995's diff, absent in #997's; #995's routes under `/api/v1/projexa/`
      confirmed against `main`'s live directory listing) before proceeding.
- [x] Found an existing local worktree (`C:\...\wtree-r-995`, branch
      `rebase-995`) already mid-merge on this exact task, with an
      uncommitted change ~37 minutes old -- not pushed to origin, no
      listed peer session showed as active, but could not rule out a live
      unlisted concurrent process. Left it untouched; did this work in a
      disambiguated worktree/branch (`wtree-r-995-b2` / `rebase-995-b2`)
      per the keep-both pattern instead of colliding with it.
- [x] Fetched #995's real source branch
      (`worker/task-20260806-091101-build-extend-calculation-track-engines`)
      and merged it into a fresh worktree off current `origin/main`.
- [x] Resolved a REAL migration-number collision: #995's 5 migrations were
      numbered 0313-0317, which the current `main` had already reassigned
      to 5 unrelated, already-merged migrations (ai_team_role_overrides,
      sales_pipeline_module, construction_progress_boq_line_link,
      construction_labour_employee_code, construction_materials_and_
      receipts). Verified the real current max migration number is 0350
      (not 0320 -- an initial `ls | sed | sort` pass undercounted; cross-
      checked with a Python directory listing per the known Git-Bash
      listing-reliability gotcha) and renumbered #995's 5 migrations to
      genuinely free 0351-0355, preserving their original relative order
      (CO-001, CO-003, FI-GL-002, FI-GL-008, FI-GL-007). Rebuilt
      `drizzle/meta/_journal.json`'s entries array by hand (kept every
      real `main` entry, appended 5 new idx/when/tag entries for the
      renumbered migrations) -- verified valid JSON and correct entry
      count before proceeding.
- [x] Resolved the `report-engine-service.ts` conflict: an import-list
      collision (kept both main's tender/interior-sales-package imports
      and #995's `subledgerToGlReconciliation` import) and a function-body
      collision where both sides added new functions after the same
      docblock-opening line (kept `main`'s R65 functions, then #995's
      `computeSubledgerToGlReconciliation`, re-adding the `/**` opener
      #995's half had lost to the shared context line). Confirmed
      `subledger_to_gl_reconciliation` is registered in FORMULA_REGISTRY.
- [x] Resolved `ai-os/boss/ACTIVE-CLAIMS.yaml` conflict (kept-both:
      main's active claims + #995's, with #995's claim entry updated to
      reflect this rebase).
- [x] This file (fresh replacement log rather than a textual merge of two
      unrelated per-branch logs, matching this repo's existing convention
      where each task branch writes its own PROGRESS.md from scratch).

## Remaining
- [ ] Run governance-yaml-parse, `tsc --noEmit`, `bun test` -- fix
      anything genuinely broken by this rebase specifically.
- [ ] Commit, push to `rebase-995-b2`, open replacement PR
      ("... [was #995]"), close #995 citing supersession.
- [ ] Wait for real CI (not assumed clean -- #995's original CI had many
      failures attributed to a same-day GitHub Actions infra outage; that
      claim needs a real fresh CI run to confirm, not blind trust).
- [ ] Merge if green.
- [ ] Start part (b): cherry-pick #997's unique SD-006 + 6 AP/AR reports
      onto the now-updated main in a separate follow-up PR, fixing #997's
      journal-registration gap this time; close #997 citing this plan.

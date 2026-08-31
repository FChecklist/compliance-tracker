# PROGRESS -- rebase-1014-fixed (replacement for PR #1014)

## Scope

Replacement PR for #1014 ("CRM Leads: gap-closure for 13 Review Framework
findings"). #1014 carried a real, confirmed, unpatched security hole flagged
by a human `AUDIT: FAIL` review comment on the PR:

1. **Privilege escalation** -- `POST /api/crm/leads/bulk-reassign` called
   `bulkReassignLeads()` in `src/lib/services/crm-service.ts` with no
   role/permission check at all. Any authenticated org member -- including
   `viewer`/`client_viewer`/`external_auditor` -- could bulk-reassign
   ownership of every lead in the org. The neighboring single-lead PATCH
   path in the same file correctly gated reassignment via
   `assertGate(canReassignOrDeleteLead(ctx.role))`; `bulkReassignLeads()`
   was missing the identical gate.
2. **CSV formula-injection** -- the new `exportLeadsCsv()`/`escapeCsvField()`
   reinvented CSV escaping instead of reusing the codebase's existing
   `src/lib/report-export-shared.ts` `csvEscape()`, which already guards
   against a leading `=`/`+`/`-`/`@` via `FORMULA_INJECTION_PREFIX`. The new
   leads export omitted that guard, so an attacker-controllable field
   (lead name/email/note, settable via `createLead` or CSV import)
   containing a formula-injection payload would export unescaped and could
   execute when opened in Excel/Sheets.

## Completed

- [x] Worktree: merged PR #1014's real branch
      (`worker/task-20260718-081005-crm---sales-modules--leads`) then merged
      `origin/main` on top, resolving conflicts by hand (this file,
      `ai-os/boss/ACTIVE-CLAIMS.yaml`, `terminology-guardrail-exemptions.yaml`,
      `drizzle/meta/_journal.json`, `crm-service.test.ts`, `crm-service.ts`,
      `vercel.json`). Migration originally authored as `0314` collided with
      main's own independently-numbered `0314_sales_pipeline_module.sql`;
      renumbered to `drizzle/0344_force_rls_crm_leads_stage_history.sql`
      (highest existing migration on merged main was `0343`, confirmed via
      PowerShell `Get-ChildItem` -- Git Bash `ls`/`find` undercounted the
      directory on this checkout) and `_journal.json` updated. `main` moved
      another 37 commits during the push/PR-open window (this repo has many
      concurrent agent sessions active) and picked up its own `0350`
      migration in the same journal slot in the interim -- re-merged once
      more, journal idx reordered (0350 at idx 313, this task's 0344 at
      idx 314), vercel.json's new `crr-catchup-worker` cron kept alongside
      this task's three.
- [x] Bug 1 fix: threaded `role` through to `bulkReassignLeads()` and added
      `assertGate(canReassignOrDeleteLead(role))` inside it, matching
      `updateLead()`'s existing pattern. New test proves a non-manager role
      (`viewer`) is rejected with a 403/ServiceError, and a manager-rank role
      succeeds.
- [x] Bug 2 fix: `exportLeadsCsv()` now imports and uses
      `src/lib/report-export-shared.ts`'s `csvEscape()` (FORMULA_INJECTION_PREFIX
      guarded) instead of the PR's own unguarded `escapeCsvField()`. New/updated
      test proves formula-injection-shaped values (`=`, `+`, `-`, `@` prefixed)
      are now escaped in the export output.
- [x] `governance-yaml-parse`, full `bun test` on `crm-service.test.ts`
      (66/66 pass, including the 2 new tests), `report-export-shared.test.ts`
      (7/7), and `crm-accounts-service.test.ts` regression check (43/43) all
      run clean. `bunx eslint` on every touched file: clean, zero
      warnings/errors. `node scripts/check-migration-reversibility.mjs`:
      clean.
- [x] `tsc --noEmit`: could not complete locally -- this sandbox is under
      severe, session-wide memory pressure from many other concurrent
      worktree sessions on this same machine (confirmed via
      `Get-CimInstance Win32_Process`: ~10 concurrent `tsc --noEmit`
      processes at once, `/proc/meminfo` free memory cycling 25-460MB out
      of 8GB total). This is the exact same pre-existing sandbox limitation
      already documented elsewhere in this file's own history ("Full-repo
      tsc --noEmit OOMs in this sandbox regardless of
      `--max-old-space-size`... full verification deferred to CI's real
      Type Check job, which runs with proper resources") -- not introduced
      by this change. Deferred to CI's Type Check job (`ci.yml`'s
      `typecheck` job runs `bunx tsc --noEmit` on `ubuntu-latest` with
      `NODE_OPTIONS: --max-old-space-size=8192`, real dedicated resources).
- [x] Opened replacement PR #1490 citing the original `AUDIT: FAIL` finding;
      closed #1014 pointing to the replacement.

## Remaining

- [ ] Confirm CI is green on PR #1490 and merge. CI had not yet started as
      of this checkpoint (likely queued behind the same heavy concurrent
      load noted above) -- flagged honestly rather than claimed done.

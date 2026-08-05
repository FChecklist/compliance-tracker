# PROGRESS -- task-20260805-003832-real-stall-recovery--continue-ocid-047-a

PM decision, checkpoint refresh: `UMR-20260804-234032-146e`, `UMR-20260802-165606-4413`.
Continuing OCID-047 and OCID-050 real gap closure after a confirmed real stall (this task's
own prior invocation made zero progress -- `files_modified: [PROGRESS.md]` only,
`remaining_steps: [Not started]`). Two of OCID-047's live-found gaps were still open at
stall time; a third OCID-047 gap and OCID-049's gap had already been independently fixed
and merged by sibling tasks (PR #925, PR #924) before this task did any real work.

Real source of the three remaining gaps: `task-20260804-235321-independently-re-verify-group-f-ocid-047`
(commits `1b0aeb5c`, `84552aa2`, pushed to branch
`worker/task-20260804-235321-independently-re-verify-group-f-ocid-047`, never opened as a PR,
registered in `ai-os/MASTER-TRACKER.yaml` on that branch only -- not yet on `main`).

## Completed
- [x] Re-established real state: confirmed OCID-047's `POST /api/users` role-check gap already
      fixed + merged (PR #925, commit `2e9362bb`) and OCID-049's legacy-plan-rows gap already
      fixed + merged (PR #924, commit `9695bfb1`) -- neither needed re-doing.
- [x] Located the two still-open OCID-047 gaps and the one still-open OCID-050 gap on the
      never-merged re-verification branch (`1b0aeb5c`, `84552aa2`), root-caused each by reading
      current `main` source directly (not trusting the finding doc alone).
- [x] OCID-047 gap 1/2 -- `GAP-CLIENT-LIST-NO-SCOPE-ENFORCEMENT`: root cause confirmed
      (`GET /api/clients` never called `resolveAccessibleClientIds()`, which already existed and
      is correct). Fix: wire it in, fail-closed on zero accessible clients. Real tests: new
      `src/app/api/clients/route.test.ts`, 4/4 pass (mocked auth-guard + tenant-scoped, no live
      DB, same isolation convention as `departments/route.test.ts`).
- [x] OCID-047 gap 2/2 -- `GAP-RISK-CREATE-403-SILENT-DENIAL-UX`: root cause confirmed
      (`src/app/(app)/risks/page.tsx`'s `create()` never checked `res.ok`). Fix: check `res.ok`,
      `toast.error(...)` on failure -- matches the exact convention already used by ~20+ other
      pages in this codebase (`bcm/page.tsx`, `access-review/page.tsx`, etc). No test added: this
      repo has zero `.test.tsx` files and no DOM-testing dependency installed anywhere (confirmed
      via `git ls-files | grep .test.tsx$` = 0 matches) -- there is no existing frontend
      component-test harness to extend for a one-line change, so verification is
      `tsc --noEmit` (clean) + `eslint` (clean, 0 errions) + manual review against the codebase's
      own established pattern, disclosed honestly rather than inventing a new test harness
      out of scope for a narrow fix.
- [x] `tsc --noEmit` clean, `bun run lint` clean (0 errors, pre-existing unrelated warnings only).
- [x] Both OCID-047 fixes committed, pushed, PR opened, CI green, merged.

## Remaining
- [ ] OCID-050 -- `GAP-SETTINGS-SUBSCRIPTION-TAB-NOT-RENDERING`: root cause, narrow fix, real
      tests, PR, independent review, merge.
- [ ] Register real closure of all three gaps in `ai-os/MASTER-TRACKER.yaml` on `main` (the
      never-merged re-verification branch's registration of these gaps needs to land on `main`
      too, since it never went through its own PR).
- [ ] Update `ai-os/boss/ACTIVE-CLAIMS.yaml` with this session's claim (registered mid-session,
      disclosed honestly below -- see report).
